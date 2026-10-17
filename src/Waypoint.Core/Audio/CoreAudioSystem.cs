using System.Diagnostics;
using System.Runtime.InteropServices;
using Waypoint.Core.Audio.Interop;

namespace Waypoint.Core.Audio;

/// <summary>
/// <see cref="IAudioSystem"/> backed by the real Windows Core Audio API, for both outputs and inputs.
/// Create and use it from a single MTA thread (see <c>WaypointRuntime</c>).
/// </summary>
public sealed class CoreAudioSystem : IAudioSystem
{
    private const uint ClsCtxAll = 0x17;
    private const uint StgmRead = 0;
    private static readonly Guid AudioMeterIid = typeof(IAudioMeterInformation).GUID;
    private static readonly Guid EndpointVolumeIid = typeof(IAudioEndpointVolume).GUID;
    private static readonly Guid AudioClientIid = typeof(IAudioClient).GUID;
    private const long MonitorBufferHns = 2_000_000; // 200 ms

    /// <summary>Event context passed to volume changes so they can be told apart from the user's own.</summary>
    private static Guid _eventContext = new("6f1c1c39-6b0a-4c43-9f52-5e3c4f2b7a11");

    private readonly IMMDeviceEnumerator _enumerator;
    private readonly NotificationClient _client;
    private readonly PolicyConfigClient? _policy;

    // Activated per-device interfaces are cached; they are invalidated when a device disappears.
    private readonly Dictionary<string, IAudioMeterInformation> _meters = [];
    private IAudioClient? _monitor;
    private string? _monitorId;
    private readonly Dictionary<string, IAudioEndpointVolume> _volumes = [];
    private bool _disposed;

    public CoreAudioSystem()
    {
        if (Thread.CurrentThread.GetApartmentState() != ApartmentState.MTA)
            throw new InvalidOperationException("CoreAudioSystem must be created on an MTA thread.");

        _enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
        _client = new NotificationClient(this);
        Marshal.ThrowExceptionForHR(_enumerator.RegisterEndpointNotificationCallback(_client));

        _policy = PolicyConfigClient.TryCreate(out var error);
        SwitchUnavailableReason = _policy is null ? error : null;
        PolicyVariant = _policy?.Variant;
    }

    public event Action<AudioNotification>? Notification;

    public bool CanSwitch => _policy is not null;
    public string? SwitchUnavailableReason { get; }
    public string? PolicyVariant { get; }

    public IReadOnlyList<AudioEndpoint> GetEndpoints(AudioFlow flow)
    {
        var list = new List<AudioEndpoint>();
        Marshal.ThrowExceptionForHR(_enumerator.EnumAudioEndpoints(ToDataFlow(flow), DeviceStateMask.All, out var collection));
        try
        {
            collection.GetCount(out var count);
            for (uint i = 0; i < count; i++)
            {
                if (collection.Item(i, out var device) != HResult.S_OK) continue;
                try
                {
                    var endpoint = ReadEndpoint(device, flow);
                    if (endpoint is not null) list.Add(endpoint);
                }
                finally
                {
                    Marshal.ReleaseComObject(device);
                }
            }
        }
        finally
        {
            Marshal.ReleaseComObject(collection);
        }

        return list;
    }

    public DefaultEndpoints GetDefaults(AudioFlow flow) =>
        new(GetDefaultId(flow, ERole.Console), GetDefaultId(flow, ERole.Multimedia), GetDefaultId(flow, ERole.Communications));

    public SwitchResult SetDefault(AudioFlow flow, string deviceId, bool includeCommunications)
    {
        if (_policy is null)
            return SwitchResult.Fail($"Switching is unavailable on this system: {SwitchUnavailableReason}");

        if (_enumerator.GetDevice(deviceId, out var device) != HResult.S_OK)
            return SwitchResult.Fail("Device not found.");
        device.GetState(out var state);
        Marshal.ReleaseComObject(device);
        if (state != DeviceStateMask.Active)
            return SwitchResult.Fail("Device is not connected.");

        var roles = includeCommunications
            ? new[] { ERole.Console, ERole.Multimedia, ERole.Communications }
            : new[] { ERole.Console, ERole.Multimedia };

        foreach (var role in roles)
        {
            // The policy client infers the flow from the endpoint ID itself.
            int hr = _policy.SetDefaultEndpoint(deviceId, role);
            if (hr != HResult.S_OK)
                return SwitchResult.Fail($"SetDefaultEndpoint({role}) failed with 0x{hr:X8}.", hr, GetDefaults(flow));
        }

        // Verify by re-reading the defaults. The change is normally visible immediately,
        // but give the audio service up to ~2 s before declaring failure.
        var sw = Stopwatch.StartNew();
        DefaultEndpoints observed;
        do
        {
            observed = GetDefaults(flow);
            bool ok = observed.Console == deviceId && observed.Multimedia == deviceId
                      && (!includeCommunications || observed.Communications == deviceId);
            if (ok) return new SwitchResult(true, $"Verified in {sw.ElapsedMilliseconds} ms", observed);
            Thread.Sleep(50);
        } while (sw.ElapsedMilliseconds < 2000);

        return SwitchResult.Fail("Windows accepted the request but the default device did not change.", null, observed);
    }

    public float? GetPeak(string deviceId)
    {
        var meter = Activate(_meters, deviceId, AudioMeterIid, o => (IAudioMeterInformation)o);
        if (meter is null) return null;
        try
        {
            if (meter.GetPeakValue(out var peak) == HResult.S_OK) return peak;
        }
        catch (COMException)
        {
        }

        // A disconnected device invalidates the interface (AUDCLNT_E_DEVICE_INVALIDATED) — drop it, retry next time.
        Release(_meters, deviceId);
        return null;
    }

    /// <summary>Why the last <see cref="SetCaptureMonitor"/> failed (step and HRESULT), for diagnostics.</summary>
    public string? MonitorError { get; private set; }

    public bool SetCaptureMonitor(string? deviceId)
    {
        if (deviceId == _monitorId) return _monitor is not null || deviceId is null;
        StopMonitor();
        _monitorId = deviceId;
        MonitorError = null;
        if (deviceId is null) return true;
        if (_enumerator.GetDevice(deviceId, out var device) != HResult.S_OK) return false;
        IAudioClient? client = null;
        var format = IntPtr.Zero;
        try
        {
            var iid = AudioClientIid;
            int hr;
            if ((hr = device.Activate(ref iid, ClsCtxAll, IntPtr.Zero, out var obj)) != HResult.S_OK) return MonitorFailed("Activate", hr);
            client = (IAudioClient)obj;
            if ((hr = client.GetMixFormat(out format)) != HResult.S_OK) return MonitorFailed("GetMixFormat", hr);
            // Shared mode, no event callback: the buffer is never read, Windows just overwrites it.
            if ((hr = client.Initialize(0, 0, MonitorBufferHns, 0, format, IntPtr.Zero)) != HResult.S_OK) return MonitorFailed("Initialize", hr);
            if ((hr = client.Start()) != HResult.S_OK) return MonitorFailed("Start", hr);
            _monitor = client;
            client = null;
            return true;
        }
        catch (COMException ex)
        {
            return MonitorFailed("COM", ex.HResult);
        }
        finally
        {
            if (format != IntPtr.Zero) Marshal.FreeCoTaskMem(format);
            if (client is not null) Marshal.ReleaseComObject(client);
            Marshal.ReleaseComObject(device);
        }
    }

    private bool MonitorFailed(string step, int hr)
    {
        MonitorError = $"{step} failed (0x{hr:X8})";
        return false;
    }

    private void StopMonitor()
    {
        if (_monitor is null) return;
        try { _monitor.Stop(); } catch (COMException) { }
        Marshal.ReleaseComObject(_monitor);
        _monitor = null;
    }

    public VolumeInfo? GetVolume(string deviceId)
    {
        var volume = Activate(_volumes, deviceId, EndpointVolumeIid, o => (IAudioEndpointVolume)o);
        if (volume is null) return null;
        try
        {
            if (volume.GetMasterVolumeLevelScalar(out var level) == HResult.S_OK && volume.GetMute(out var muted) == HResult.S_OK)
                return new VolumeInfo(level, muted);
        }
        catch (COMException)
        {
        }

        Release(_volumes, deviceId);
        return null;
    }

    public VolumeInfo? SetVolume(string deviceId, float level)
    {
        var volume = Activate(_volumes, deviceId, EndpointVolumeIid, o => (IAudioEndpointVolume)o);
        if (volume is null) return null;
        try
        {
            if (volume.SetMasterVolumeLevelScalar(Math.Clamp(level, 0f, 1f), ref _eventContext) != HResult.S_OK) return null;
        }
        catch (COMException)
        {
            Release(_volumes, deviceId);
            return null;
        }

        return GetVolume(deviceId);
    }

    public VolumeInfo? SetMute(string deviceId, bool muted)
    {
        var volume = Activate(_volumes, deviceId, EndpointVolumeIid, o => (IAudioEndpointVolume)o);
        if (volume is null) return null;
        try
        {
            if (volume.SetMute(muted, ref _eventContext) != HResult.S_OK) return null;
        }
        catch (COMException)
        {
            Release(_volumes, deviceId);
            return null;
        }

        return GetVolume(deviceId);
    }

    private static readonly Guid SessionManagerIid = typeof(IAudioSessionManager2).GUID;

    private AppRouter? _router;
    private string? _routerError;
    private bool _routerTried;

    /// <summary>Per-app routing (undocumented IAudioPolicyConfigFactory); null with a reason if unavailable.</summary>
    private AppRouter? Router
    {
        get
        {
            if (!_routerTried)
            {
                _routerTried = true;
                _router = AppRouter.TryCreate(out _routerError);
            }

            return _router;
        }
    }

    public bool CanRouteApps => Router is not null;
    public string? AppRoutingUnavailableReason => Router is null ? _routerError : null;

    /// <summary>The endpoint an app is pinned to ("" = follows the system default), or null if it can't be read.</summary>
    public string? GetAppRoute(uint pid, AudioFlow flow)
    {
        if (Router is not { } r) return null;
        try
        {
            return r.Get(pid, ToDataFlow(flow), ERole.Console, out var id) == HResult.S_OK ? id : null;
        }
        catch (Exception ex) when (ex is COMException or AccessViolationException)
        {
            return null;
        }
    }

    /// <summary>
    /// Routes an app's default-device audio (Console + Multimedia, and Communications if asked) to an endpoint,
    /// or back to the system default with "". Returns the HRESULT of the first failing call (0 = all succeeded).
    /// </summary>
    public int SetAppRoute(uint pid, AudioFlow flow, string endpointId, bool includeCommunications)
    {
        if (Router is not { } r) return unchecked((int)0x80004001); // E_NOTIMPL
        var roles = includeCommunications ? new[] { ERole.Console, ERole.Multimedia, ERole.Communications } : new[] { ERole.Console, ERole.Multimedia };
        foreach (var role in roles)
        {
            int hr = r.Set(pid, ToDataFlow(flow), role, endpointId);
            if (hr != HResult.S_OK) return hr;
        }

        return HResult.S_OK;
    }

    /// <summary>Apps with an audio session on the endpoint (documented IAudioSessionManager2).</summary>
    public IReadOnlyList<AudioSessionInfo> GetSessions(string deviceId)
    {
        var result = new List<AudioSessionInfo>();
        if (_enumerator.GetDevice(deviceId, out var device) != HResult.S_OK) return result;
        try
        {
            device.GetState(out var devState);
            if (devState != DeviceStateMask.Active) return result;
            var iid = SessionManagerIid;
            if (device.Activate(ref iid, ClsCtxAll, IntPtr.Zero, out var obj) != HResult.S_OK) return result;
            var manager = (IAudioSessionManager2)obj;
            try
            {
                if (manager.GetSessionEnumerator(out var sessions) != HResult.S_OK) return result;
                try
                {
                    sessions.GetCount(out var count);
                    for (int i = 0; i < count; i++)
                    {
                        if (sessions.GetSession(i, out var session) != HResult.S_OK) continue;
                        try
                        {
                            session.GetProcessId(out var pid);
                            session.GetState(out var state);
                            bool system = session.IsSystemSoundsSession() == HResult.S_OK;
                            result.Add(new AudioSessionInfo(pid, ProcessName(pid), state, system));
                        }
                        finally
                        {
                            Marshal.ReleaseComObject(session);
                        }
                    }
                }
                finally
                {
                    Marshal.ReleaseComObject(sessions);
                }
            }
            finally
            {
                Marshal.ReleaseComObject(manager);
            }
        }
        catch (COMException)
        {
        }
        finally
        {
            Marshal.ReleaseComObject(device);
        }

        return result;
    }

    private static string ProcessName(uint pid)
    {
        if (pid == 0) return "System";
        try
        {
            using var p = System.Diagnostics.Process.GetProcessById((int)pid);
            return p.ProcessName;
        }
        catch (ArgumentException)
        {
            return $"pid {pid}";
        }
        catch (InvalidOperationException)
        {
            return $"pid {pid}";
        }
    }

    /// <summary>Dumps every property in the endpoint's store. Diagnostics only.</summary>
    public IReadOnlyList<(string Key, string Value)> DumpProperties(string deviceId)
    {
        var result = new List<(string, string)>();
        if (_enumerator.GetDevice(deviceId, out var device) != HResult.S_OK) return result;
        try
        {
            if (device.OpenPropertyStore(StgmRead, out var store) != HResult.S_OK) return result;
            try
            {
                store.GetCount(out var count);
                for (uint i = 0; i < count; i++)
                {
                    if (store.GetAt(i, out var key) != HResult.S_OK) continue;
                    result.Add((key.ToString(), ReadProperty(store, key)?.ToString() ?? "<empty>"));
                }
            }
            finally
            {
                Marshal.ReleaseComObject(store);
            }
        }
        finally
        {
            Marshal.ReleaseComObject(device);
        }

        return result;
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        StopMonitor();
        foreach (var id in _meters.Keys.ToList()) Release(_meters, id);
        foreach (var id in _volumes.Keys.ToList()) Release(_volumes, id);
        try { _enumerator.UnregisterEndpointNotificationCallback(_client); } catch (COMException) { }
        Marshal.ReleaseComObject(_enumerator);
    }

    private T? Activate<T>(Dictionary<string, T> cache, string deviceId, Guid iid, Func<object, T> cast) where T : class
    {
        if (cache.TryGetValue(deviceId, out var cached)) return cached;
        if (_enumerator.GetDevice(deviceId, out var device) != HResult.S_OK) return null;
        try
        {
            device.GetState(out var state);
            if (state != DeviceStateMask.Active) return null;
            if (device.Activate(ref iid, ClsCtxAll, IntPtr.Zero, out var obj) != HResult.S_OK) return null;
            var typed = cast(obj);
            cache[deviceId] = typed;
            return typed;
        }
        catch (COMException)
        {
            return null;
        }
        finally
        {
            Marshal.ReleaseComObject(device);
        }
    }

    private static void Release<T>(Dictionary<string, T> cache, string deviceId) where T : class
    {
        if (cache.Remove(deviceId, out var obj)) Marshal.ReleaseComObject(obj);
    }

    /// <summary>Drops cached interfaces for a device whose state changed (they become invalid on disconnect).</summary>
    private void InvalidateDevice(string? deviceId)
    {
        if (deviceId is null) return;
        Release(_meters, deviceId);
        Release(_volumes, deviceId);
    }

    private static EDataFlow ToDataFlow(AudioFlow flow) => flow == AudioFlow.Capture ? EDataFlow.Capture : EDataFlow.Render;

    private string? GetDefaultId(AudioFlow flow, ERole role)
    {
        int hr = _enumerator.GetDefaultAudioEndpoint(ToDataFlow(flow), role, out var device);
        if (hr != HResult.S_OK) return null; // E_NOTFOUND when no endpoint of this flow is active
        try
        {
            return device.GetId(out var id) == HResult.S_OK ? id : null;
        }
        finally
        {
            Marshal.ReleaseComObject(device);
        }
    }

    private static AudioEndpoint? ReadEndpoint(IMMDevice device, AudioFlow flow)
    {
        if (device.GetId(out var id) != HResult.S_OK) return null;
        device.GetState(out var rawState);

        string friendly = id, description = "", adapter = "";
        string? enumerator = null, ksInstance = null;
        int formFactor = -1;

        if (device.OpenPropertyStore(StgmRead, out var store) == HResult.S_OK)
        {
            try
            {
                friendly = ReadProperty(store, PropertyKeys.DeviceFriendlyName) as string ?? id;
                description = ReadProperty(store, PropertyKeys.DeviceDescription) as string ?? "";
                adapter = ReadProperty(store, PropertyKeys.DeviceInterfaceFriendlyName) as string ?? "";
                enumerator = ReadProperty(store, PropertyKeys.DeviceEnumeratorName) as string;
                ksInstance = ReadProperty(store, PropertyKeys.EndpointKsInstance) as string;
                if (ReadProperty(store, PropertyKeys.AudioEndpointFormFactor) is uint ff) formFactor = (int)ff;
            }
            finally
            {
                Marshal.ReleaseComObject(store);
            }
        }

        var connection = EndpointClassifier.ClassifyConnection(enumerator, ksInstance, friendly, formFactor);
        var kind = EndpointClassifier.ClassifyKind(formFactor, friendly, adapter, connection);
        if (flow == AudioFlow.Capture && kind is not (DeviceKind.Headset or DeviceKind.Earbuds or DeviceKind.Display)) kind = DeviceKind.Microphone;

        return new AudioEndpoint
        {
            Id = id,
            FriendlyName = friendly,
            Description = description,
            AdapterName = adapter,
            Flow = flow,
            State = rawState switch
            {
                DeviceStateMask.Active => EndpointState.Active,
                DeviceStateMask.Disabled => EndpointState.Disabled,
                DeviceStateMask.Unplugged => EndpointState.Unplugged,
                _ => EndpointState.NotPresent,
            },
            FormFactor = formFactor,
            Connection = connection,
            Kind = kind,
        };
    }

    private static object? ReadProperty(IPropertyStore store, PropertyKey key)
    {
        if (store.GetValue(ref key, out var value) != HResult.S_OK) return null;
        try
        {
            return value.ToObject();
        }
        finally
        {
            NativeMethods.PropVariantClear(ref value);
        }
    }

    private void Raise(AudioNotificationKind kind, string? id, AudioFlow? flow = null)
    {
        try
        {
            Notification?.Invoke(new AudioNotification(kind, id, flow));
        }
        catch
        {
            // Never let a managed exception propagate into the audio service's callback thread.
        }
    }

    /// <summary>COM callback sink. Per the docs, callbacks must return quickly and must not call into MMDevice APIs.</summary>
    [ComVisible(true)]
    private sealed class NotificationClient(CoreAudioSystem owner) : IMMNotificationClient
    {
        public int OnDeviceStateChanged(string deviceId, uint newState)
        {
            owner.Raise(AudioNotificationKind.StateChanged, deviceId);
            return HResult.S_OK;
        }

        public int OnDeviceAdded(string deviceId)
        {
            owner.Raise(AudioNotificationKind.Added, deviceId);
            return HResult.S_OK;
        }

        public int OnDeviceRemoved(string deviceId)
        {
            owner.Raise(AudioNotificationKind.Removed, deviceId);
            return HResult.S_OK;
        }

        public int OnDefaultDeviceChanged(EDataFlow flow, ERole role, string? defaultDeviceId)
        {
            if (flow != EDataFlow.All)
                owner.Raise(AudioNotificationKind.DefaultChanged, defaultDeviceId, flow == EDataFlow.Capture ? AudioFlow.Capture : AudioFlow.Render);
            return HResult.S_OK;
        }

        public int OnPropertyValueChanged(string deviceId, PropertyKey key)
        {
            // Only friendly-name changes matter to the UI; everything else is noise (volume, formats...).
            if (key.FormatId == PropertyKeys.DeviceFriendlyName.FormatId && key.PropertyId == PropertyKeys.DeviceFriendlyName.PropertyId)
                owner.Raise(AudioNotificationKind.PropertyChanged, deviceId);
            return HResult.S_OK;
        }
    }

    /// <summary>Called on the runtime thread for every topology notification, before the controllers see it.</summary>
    public void OnTopologyNotification(AudioNotification n)
    {
        if (n.Kind is AudioNotificationKind.StateChanged or AudioNotificationKind.Removed) InvalidateDevice(n.DeviceId);
    }
}
