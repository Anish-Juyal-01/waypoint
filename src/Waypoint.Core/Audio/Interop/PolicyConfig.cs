using System.Runtime.InteropServices;

namespace Waypoint.Core.Audio.Interop;

// IPolicyConfig is an UNDOCUMENTED interface exposed by the Windows audio policy client
// (CPolicyConfigClient). It is the only programmatic way to change the system default audio
// endpoint and is what the Windows Sound control panel itself uses. It has been stable since
// Windows 7 and is used by widely-deployed tools, but Microsoft may change it at any time.
//
// Waypoint therefore:
//   * tries IPolicyConfig (Win7+) first, then the older IPolicyConfigVista layout,
//   * never assumes success — every call is verified by re-reading GetDefaultAudioEndpoint,
//   * reports "switching unavailable" in the UI if neither interface can be activated.
//
// Only SetDefaultEndpoint is called. The preceding vtable slots are declared purely so the
// slot index is correct; their signatures are irrelevant and they are never invoked.

[ComImport]
[Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")]
internal class PolicyConfigClientComObject
{
}

[ComImport]
[Guid("294935CE-F637-4E7C-A41B-AB255460B862")]
internal class PolicyConfigVistaClientComObject
{
}

[ComImport]
[Guid("f8679f50-850a-41cf-9c72-430f290290c8")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IPolicyConfig
{
    [PreserveSig] int GetMixFormat([MarshalAs(UnmanagedType.LPWStr)] string deviceId, IntPtr format);
    [PreserveSig] int GetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string deviceId, int isDefault, IntPtr format);
    [PreserveSig] int ResetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string deviceId);
    [PreserveSig] int SetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string deviceId, IntPtr endpointFormat, IntPtr mixFormat);
    [PreserveSig] int GetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string deviceId, int isDefault, IntPtr defaultPeriod, IntPtr minimumPeriod);
    [PreserveSig] int SetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string deviceId, IntPtr period);
    [PreserveSig] int GetShareMode([MarshalAs(UnmanagedType.LPWStr)] string deviceId, IntPtr mode);
    [PreserveSig] int SetShareMode([MarshalAs(UnmanagedType.LPWStr)] string deviceId, IntPtr mode);
    [PreserveSig] int GetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string deviceId, IntPtr key, IntPtr value);
    [PreserveSig] int SetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string deviceId, IntPtr key, IntPtr value);
    [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string deviceId, ERole role);
    [PreserveSig] int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string deviceId, int visible);
}

[ComImport]
[Guid("568b9108-44bf-40b4-9006-86afe5b5a620")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IPolicyConfigVista
{
    [PreserveSig] int GetMixFormat([MarshalAs(UnmanagedType.LPWStr)] string deviceId, IntPtr format);
    [PreserveSig] int GetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string deviceId, int isDefault, IntPtr format);
    [PreserveSig] int SetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string deviceId, IntPtr endpointFormat, IntPtr mixFormat);
    [PreserveSig] int GetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string deviceId, int isDefault, IntPtr defaultPeriod, IntPtr minimumPeriod);
    [PreserveSig] int SetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string deviceId, IntPtr period);
    [PreserveSig] int GetShareMode([MarshalAs(UnmanagedType.LPWStr)] string deviceId, IntPtr mode);
    [PreserveSig] int SetShareMode([MarshalAs(UnmanagedType.LPWStr)] string deviceId, IntPtr mode);
    [PreserveSig] int GetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string deviceId, IntPtr key, IntPtr value);
    [PreserveSig] int SetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string deviceId, IntPtr key, IntPtr value);
    [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string deviceId, ERole role);
    [PreserveSig] int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string deviceId, int visible);
}

/// <summary>Thin wrapper choosing whichever IPolicyConfig variant activates on this build of Windows.</summary>
internal sealed class PolicyConfigClient
{
    private readonly IPolicyConfig? _policy;
    private readonly IPolicyConfigVista? _vista;

    private PolicyConfigClient(IPolicyConfig? policy, IPolicyConfigVista? vista, string variant)
    {
        _policy = policy;
        _vista = vista;
        Variant = variant;
    }

    public string Variant { get; }

    /// <summary>Returns null (with a reason) if neither interface can be activated.</summary>
    public static PolicyConfigClient? TryCreate(out string? error)
    {
        error = null;
        try
        {
            if (new PolicyConfigClientComObject() is IPolicyConfig policy)
                return new PolicyConfigClient(policy, null, "IPolicyConfig");
        }
        catch (Exception ex)
        {
            error = $"IPolicyConfig: {ex.Message}";
        }

        try
        {
            if (new PolicyConfigVistaClientComObject() is IPolicyConfigVista vista)
                return new PolicyConfigClient(null, vista, "IPolicyConfigVista");
        }
        catch (Exception ex)
        {
            error = (error is null ? "" : error + "; ") + $"IPolicyConfigVista: {ex.Message}";
        }

        error ??= "No IPolicyConfig variant could be activated.";
        return null;
    }

    public int SetDefaultEndpoint(string deviceId, ERole role) =>
        _policy is not null ? _policy.SetDefaultEndpoint(deviceId, role) : _vista!.SetDefaultEndpoint(deviceId, role);
}
