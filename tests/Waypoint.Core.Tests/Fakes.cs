using Waypoint.Core.Audio;
using Waypoint.Core.Engine;

namespace Waypoint.Core.Tests;

/// <summary>In-memory audio system. Test-only; models Windows' behaviour closely enough for the controller rules.</summary>
internal sealed class FakeAudioSystem : IAudioSystem
{
    private readonly Dictionary<string, AudioEndpoint> _endpoints = [];
    private readonly Dictionary<AudioFlow, string?[]> _defaults = new()
    {
        [AudioFlow.Render] = new string?[3],
        [AudioFlow.Capture] = new string?[3],
    };
    private readonly Dictionary<string, VolumeInfo> _volumes = [];
    private readonly Dictionary<string, List<AudioSessionInfo>> _sessions = [];
    private readonly Dictionary<uint, string> _routes = [];

    /// <summary>Puts an app's active session on a device (and optionally pins it via Windows' per-app setting).</summary>
    public void PlayOn(string deviceId, string process, uint pid, string? pinnedTo = null)
    {
        foreach (var list in _sessions.Values) list.RemoveAll(s => s.ProcessId == pid);
        if (!_sessions.TryGetValue(deviceId, out var l)) _sessions[deviceId] = l = [];
        l.Add(new AudioSessionInfo(pid, process, 1, false));
        if (pinnedTo is not null) _routes[pid] = pinnedTo;
    }

    public IReadOnlyList<AudioSessionInfo> GetSessions(string deviceId) => _sessions.TryGetValue(deviceId, out var l) ? l : [];

    public string? GetAppRoute(uint processId, AudioFlow flow) => _routes.TryGetValue(processId, out var r) ? r : "";

    public int SetAppRoute(uint processId, AudioFlow flow, string endpointId, bool includeCommunications)
    {
        if (endpointId.Length == 0) _routes.Remove(processId);
        else _routes[processId] = endpointId;
        return 0;
    }

    public string? Console => _defaults[AudioFlow.Render][0];
    public string? Multimedia => _defaults[AudioFlow.Render][1];
    public string? Communications => _defaults[AudioFlow.Render][2];
    public string? Mic => _defaults[AudioFlow.Capture][0];

    public bool CanSwitch { get; set; } = true;
    public string? SwitchUnavailableReason => CanSwitch ? null : "test";
    public bool FailNextSwitch { get; set; }
    public int SwitchCalls { get; private set; }
    public event Action<AudioNotification>? Notification;

    public FakeAudioSystem Add(string id, ConnectionType conn = ConnectionType.Bluetooth, DeviceKind kind = DeviceKind.Earbuds, bool active = true, AudioFlow flow = AudioFlow.Render)
    {
        _endpoints[id] = new AudioEndpoint
        {
            Id = id,
            FriendlyName = id,
            Connection = conn,
            Kind = kind,
            Flow = flow,
            State = active ? EndpointState.Active : EndpointState.Unplugged,
        };
        _volumes.TryAdd(id, new VolumeInfo(0.5f, false));
        return this;
    }

    public FakeAudioSystem AddMic(string id, ConnectionType conn = ConnectionType.BuiltIn, bool active = true) =>
        Add(id, conn, DeviceKind.Microphone, active, AudioFlow.Capture);

    public void SetState(string id, bool active)
    {
        _endpoints[id] = _endpoints[id] with { State = active ? EndpointState.Active : EndpointState.Unplugged };
        Notification?.Invoke(new AudioNotification(AudioNotificationKind.StateChanged, id));
    }

    /// <summary>Simulates Windows Settings / another app changing the default.</summary>
    public void ExternalSetDefault(string id)
    {
        var flow = _endpoints[id].Flow;
        _defaults[flow] = [id, id, id];
        Notification?.Invoke(new AudioNotification(AudioNotificationKind.DefaultChanged, id, flow));
    }

    public void SetDefaultSilently(string id) => _defaults[_endpoints[id].Flow] = [id, id, id];

    public IReadOnlyList<AudioEndpoint> GetEndpoints(AudioFlow flow) => _endpoints.Values.Where(e => e.Flow == flow).ToList();

    public DefaultEndpoints GetDefaults(AudioFlow flow) => new(_defaults[flow][0], _defaults[flow][1], _defaults[flow][2]);

    public SwitchResult SetDefault(AudioFlow flow, string deviceId, bool includeCommunications)
    {
        SwitchCalls++;
        if (FailNextSwitch)
        {
            FailNextSwitch = false;
            return SwitchResult.Fail("simulated failure", observed: GetDefaults(flow));
        }

        _defaults[flow][0] = _defaults[flow][1] = deviceId;
        if (includeCommunications) _defaults[flow][2] = deviceId;
        return new SwitchResult(true, "ok", GetDefaults(flow));
    }

    public float? GetPeak(string deviceId) => 0;

    public VolumeInfo? GetVolume(string deviceId) =>
        _endpoints.TryGetValue(deviceId, out var e) && e.IsAvailable ? _volumes[deviceId] : null;

    public VolumeInfo? SetVolume(string deviceId, float level)
    {
        if (GetVolume(deviceId) is not { } v) return null;
        return _volumes[deviceId] = v with { Level = Math.Clamp(level, 0, 1) };
    }

    public VolumeInfo? SetMute(string deviceId, bool muted)
    {
        if (GetVolume(deviceId) is not { } v) return null;
        return _volumes[deviceId] = v with { Muted = muted };
    }

    public void Dispose()
    {
    }
}

/// <summary>Deterministic scheduler: time only moves when the test calls <see cref="Advance"/>.</summary>
internal sealed class ManualScheduler : IRuntimeScheduler
{
    private readonly List<Item> _items = [];

    public DateTimeOffset Now { get; private set; } = new(2026, 1, 1, 12, 0, 0, TimeSpan.Zero);

    public IDisposable Schedule(TimeSpan delay, Action action)
    {
        var item = new Item(Now + delay, action);
        _items.Add(item);
        return item;
    }

    public void Advance(TimeSpan by)
    {
        var until = Now + by;
        while (true)
        {
            var next = _items.Where(i => !i.Cancelled && i.Due <= until).OrderBy(i => i.Due).FirstOrDefault();
            if (next is null) break;
            _items.Remove(next);
            if (next.Due > Now) Now = next.Due;
            next.Action();
        }

        Now = until;
        _items.RemoveAll(i => i.Cancelled);
    }

    /// <summary>Run everything due now plus settle delays up to 10 s.</summary>
    public void Flush() => Advance(TimeSpan.FromSeconds(10));

    private sealed class Item(DateTimeOffset due, Action action) : IDisposable
    {
        public DateTimeOffset Due { get; } = due;
        public Action Action { get; } = action;
        public bool Cancelled { get; private set; }
        public void Dispose() => Cancelled = true;
    }
}
