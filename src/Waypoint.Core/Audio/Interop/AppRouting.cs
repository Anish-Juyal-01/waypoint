using System.Runtime.InteropServices;

namespace Waypoint.Core.Audio.Interop;

// Per-app audio routing — what Windows' "App volume and device preferences" page uses.
//
// IAudioPolicyConfigFactory is an UNDOCUMENTED WinRT activation factory
// ("Windows.Media.Internal.AudioPolicyConfig"). Tools like EarTrumpet use it to move an app's default-device
// streams to another endpoint. Its IID changed in Windows 10 21H2; both are tried. All calls are verified
// (read back + re-checking which endpoint the app's session is on), and if activation fails the feature reports
// itself unavailable instead of guessing.
//
// Only the last three methods are used; the preceding slots exist to keep the vtable layout right.

[ComImport]
[Guid("ab3d4648-e242-459f-b02f-541c70306324")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioPolicyConfigFactory
{
    // IInspectable (declared explicitly: .NET can't marshal InterfaceIsIInspectable)
    [PreserveSig] int GetIids(out int count, out IntPtr iids);
    [PreserveSig] int GetRuntimeClassName(out IntPtr className);
    [PreserveSig] int GetTrustLevel(out int trustLevel);

    [PreserveSig] int __incomplete__add_CtxVolumeChange();
    [PreserveSig] int __incomplete__remove_CtxVolumeChanged();
    [PreserveSig] int __incomplete__add_RingerVibrateStateChanged();
    [PreserveSig] int __incomplete__remove_RingerVibrateStateChange();
    [PreserveSig] int __incomplete__SetVolumeGroupGainForId();
    [PreserveSig] int __incomplete__GetVolumeGroupGainForId();
    [PreserveSig] int __incomplete__GetActiveVolumeGroupForEndpointId();
    [PreserveSig] int __incomplete__GetVolumeGroupsForEndpoint();
    [PreserveSig] int __incomplete__GetCurrentVolumeContext();
    [PreserveSig] int __incomplete__SetVolumeGroupMuteForId();
    [PreserveSig] int __incomplete__GetVolumeGroupMuteForId();
    [PreserveSig] int __incomplete__SetRingerVibrateState();
    [PreserveSig] int __incomplete__GetRingerVibrateState();
    [PreserveSig] int __incomplete__SetPreferredChatApplication();
    [PreserveSig] int __incomplete__ResetPreferredChatApplication();
    [PreserveSig] int __incomplete__GetPreferredChatApplication();
    [PreserveSig] int __incomplete__GetCurrentChatApplications();
    [PreserveSig] int __incomplete__add_ChatContextChanged();
    [PreserveSig] int __incomplete__remove_ChatContextChanged();
    [PreserveSig] int SetPersistedDefaultAudioEndpoint(uint processId, EDataFlow flow, ERole role, IntPtr deviceId);
    [PreserveSig] int GetPersistedDefaultAudioEndpoint(uint processId, EDataFlow flow, ERole role, out IntPtr deviceId);
    [PreserveSig] int ClearAllPersistedApplicationDefaultEndpoints();
}

[ComImport]
[Guid("2a59116d-6c4f-45e0-a74f-707e3fef9258")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioPolicyConfigFactoryLegacy
{
    // IInspectable (declared explicitly: .NET can't marshal InterfaceIsIInspectable)
    [PreserveSig] int GetIids(out int count, out IntPtr iids);
    [PreserveSig] int GetRuntimeClassName(out IntPtr className);
    [PreserveSig] int GetTrustLevel(out int trustLevel);

    [PreserveSig] int __incomplete__add_CtxVolumeChange();
    [PreserveSig] int __incomplete__remove_CtxVolumeChanged();
    [PreserveSig] int __incomplete__add_RingerVibrateStateChanged();
    [PreserveSig] int __incomplete__remove_RingerVibrateStateChange();
    [PreserveSig] int __incomplete__SetVolumeGroupGainForId();
    [PreserveSig] int __incomplete__GetVolumeGroupGainForId();
    [PreserveSig] int __incomplete__GetActiveVolumeGroupForEndpointId();
    [PreserveSig] int __incomplete__GetVolumeGroupsForEndpoint();
    [PreserveSig] int __incomplete__GetCurrentVolumeContext();
    [PreserveSig] int __incomplete__SetVolumeGroupMuteForId();
    [PreserveSig] int __incomplete__GetVolumeGroupMuteForId();
    [PreserveSig] int __incomplete__SetRingerVibrateState();
    [PreserveSig] int __incomplete__GetRingerVibrateState();
    [PreserveSig] int __incomplete__SetPreferredChatApplication();
    [PreserveSig] int __incomplete__ResetPreferredChatApplication();
    [PreserveSig] int __incomplete__GetPreferredChatApplication();
    [PreserveSig] int __incomplete__GetCurrentChatApplications();
    [PreserveSig] int __incomplete__add_ChatContextChanged();
    [PreserveSig] int __incomplete__remove_ChatContextChanged();
    [PreserveSig] int SetPersistedDefaultAudioEndpoint(uint processId, EDataFlow flow, ERole role, IntPtr deviceId);
    [PreserveSig] int GetPersistedDefaultAudioEndpoint(uint processId, EDataFlow flow, ERole role, out IntPtr deviceId);
    [PreserveSig] int ClearAllPersistedApplicationDefaultEndpoints();
}

internal static partial class WinRt
{
    [LibraryImport("combase.dll")]
    public static partial int RoGetActivationFactory(IntPtr activatableClassId, ref Guid iid, out IntPtr factory);

    [LibraryImport("combase.dll", StringMarshalling = StringMarshalling.Utf16)]
    public static partial int WindowsCreateString(string source, int length, out IntPtr hstring);

    [LibraryImport("combase.dll")]
    public static partial int WindowsDeleteString(IntPtr hstring);

    [LibraryImport("combase.dll")]
    public static partial IntPtr WindowsGetStringRawBuffer(IntPtr hstring, out uint length);

    public static IntPtr CreateHString(string s)
    {
        if (s.Length == 0) return IntPtr.Zero; // the null HSTRING is the empty string
        Marshal.ThrowExceptionForHR(WindowsCreateString(s, s.Length, out var h));
        return h;
    }

    public static string ReadHString(IntPtr h)
    {
        if (h == IntPtr.Zero) return "";
        var buffer = WindowsGetStringRawBuffer(h, out var length);
        return Marshal.PtrToStringUni(buffer, (int)length) ?? "";
    }
}

/// <summary>Wraps whichever IAudioPolicyConfigFactory layout this Windows build exposes.</summary>
internal sealed class AppRouter
{
    private const string RenderInterface = "{e6327cad-dcec-4949-ae8a-991e976a79d2}";
    private const string CaptureInterface = "{2eef81be-33fa-4800-9670-1cd474972c3f}";

    private readonly IAudioPolicyConfigFactory? _modern;
    private readonly IAudioPolicyConfigFactoryLegacy? _legacy;

    private AppRouter(IAudioPolicyConfigFactory? modern, IAudioPolicyConfigFactoryLegacy? legacy)
    {
        _modern = modern;
        _legacy = legacy;
    }

    public static AppRouter? TryCreate(out string? error)
    {
        error = null;
        IntPtr className = IntPtr.Zero;
        try
        {
            className = WinRt.CreateHString("Windows.Media.Internal.AudioPolicyConfig");
            var iid = typeof(IAudioPolicyConfigFactory).GUID;
            if (WinRt.RoGetActivationFactory(className, ref iid, out var ptr) == 0 && ptr != IntPtr.Zero)
            {
                var obj = Marshal.GetObjectForIUnknown(ptr);
                Marshal.Release(ptr);
                return new AppRouter((IAudioPolicyConfigFactory)obj, null);
            }

            iid = typeof(IAudioPolicyConfigFactoryLegacy).GUID;
            if (WinRt.RoGetActivationFactory(className, ref iid, out ptr) == 0 && ptr != IntPtr.Zero)
            {
                var obj = Marshal.GetObjectForIUnknown(ptr);
                Marshal.Release(ptr);
                return new AppRouter(null, (IAudioPolicyConfigFactoryLegacy)obj);
            }

            error = "Per-app audio routing isn't available on this version of Windows.";
            return null;
        }
        catch (Exception ex) when (ex is COMException or InvalidCastException or DllNotFoundException or EntryPointNotFoundException or PlatformNotSupportedException)
        {
            error = $"Per-app audio routing unavailable: {ex.Message}";
            return null;
        }
        finally
        {
            if (className != IntPtr.Zero) WinRt.WindowsDeleteString(className);
        }
    }

    /// <summary>Converts an MMDevice endpoint ID to the device-interface path this API expects.</summary>
    public static string InterfacePath(string endpointId, EDataFlow flow) =>
        $@"\\?\SWD#MMDEVAPI#{endpointId}#{(flow == EDataFlow.Capture ? CaptureInterface : RenderInterface)}";

    /// <summary>Endpoint ID an app is pinned to for a role, or "" when it follows the system default.</summary>
    public int Get(uint pid, EDataFlow flow, ERole role, out string endpointId)
    {
        endpointId = "";
        IntPtr h;
        int hr = _modern is not null ? _modern.GetPersistedDefaultAudioEndpoint(pid, flow, role, out h) : _legacy!.GetPersistedDefaultAudioEndpoint(pid, flow, role, out h);
        if (hr != 0) return hr;
        try
        {
            var path = WinRt.ReadHString(h);
            // "\\?\SWD#MMDEVAPI#{0.0.0.00000000}.{guid}#{interface}" → "{0.0.0.00000000}.{guid}"
            var parts = path.Split('#');
            endpointId = parts.Length >= 3 ? parts[2] : path;
        }
        finally
        {
            if (h != IntPtr.Zero) WinRt.WindowsDeleteString(h);
        }

        return 0;
    }

    /// <summary>Routes the app's default-device audio for a role to an endpoint ("" = follow the system default again).</summary>
    public int Set(uint pid, EDataFlow flow, ERole role, string endpointId)
    {
        var h = endpointId.Length == 0 ? IntPtr.Zero : WinRt.CreateHString(InterfacePath(endpointId, flow));
        try
        {
            return _modern is not null ? _modern.SetPersistedDefaultAudioEndpoint(pid, flow, role, h) : _legacy!.SetPersistedDefaultAudioEndpoint(pid, flow, role, h);
        }
        finally
        {
            if (h != IntPtr.Zero) WinRt.WindowsDeleteString(h);
        }
    }
}
