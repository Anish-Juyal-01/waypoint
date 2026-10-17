using System.Runtime.InteropServices;

namespace Waypoint.Core.Audio.Interop;

// Hand-written COM interop for the Windows Core Audio (MMDevice) API.
// Documented interfaces: https://learn.microsoft.com/windows/win32/api/mmdeviceapi/
// IPolicyConfig is undocumented; see PolicyConfig.cs.

internal enum EDataFlow
{
    Render = 0,
    Capture = 1,
    All = 2,
}

internal enum ERole
{
    Console = 0,
    Multimedia = 1,
    Communications = 2,
}

internal static class DeviceStateMask
{
    public const uint Active = 0x1;
    public const uint Disabled = 0x2;
    public const uint NotPresent = 0x4;
    public const uint Unplugged = 0x8;
    public const uint All = 0xF;
}

internal static class HResult
{
    public const int S_OK = 0;
    public const int E_NOTFOUND = unchecked((int)0x80070490);
}

[ComImport]
[Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
internal class MMDeviceEnumeratorComObject
{
}

[ComImport]
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDeviceEnumerator
{
    [PreserveSig]
    int EnumAudioEndpoints(EDataFlow dataFlow, uint stateMask, out IMMDeviceCollection devices);

    [PreserveSig]
    int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice endpoint);

    [PreserveSig]
    int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);

    [PreserveSig]
    int RegisterEndpointNotificationCallback(IMMNotificationClient client);

    [PreserveSig]
    int UnregisterEndpointNotificationCallback(IMMNotificationClient client);
}

[ComImport]
[Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDeviceCollection
{
    [PreserveSig]
    int GetCount(out uint count);

    [PreserveSig]
    int Item(uint index, out IMMDevice device);
}

[ComImport]
[Guid("D666063F-1587-4E43-81F1-B948E807363F")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDevice
{
    [PreserveSig]
    int Activate(ref Guid iid, uint clsCtx, IntPtr activationParams,
        [MarshalAs(UnmanagedType.IUnknown)] out object instance);

    [PreserveSig]
    int OpenPropertyStore(uint stgmAccess, out IPropertyStore properties);

    [PreserveSig]
    int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);

    [PreserveSig]
    int GetState(out uint state);
}

[ComImport]
[Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IPropertyStore
{
    [PreserveSig]
    int GetCount(out uint count);

    [PreserveSig]
    int GetAt(uint index, out PropertyKey key);

    [PreserveSig]
    int GetValue(ref PropertyKey key, out PropVariant value);

    [PreserveSig]
    int SetValue(ref PropertyKey key, ref PropVariant value);

    [PreserveSig]
    int Commit();
}

[ComImport]
[Guid("7991EEC9-7E89-4D85-8390-6C703CEC60C0")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMNotificationClient
{
    [PreserveSig]
    int OnDeviceStateChanged([MarshalAs(UnmanagedType.LPWStr)] string deviceId, uint newState);

    [PreserveSig]
    int OnDeviceAdded([MarshalAs(UnmanagedType.LPWStr)] string deviceId);

    [PreserveSig]
    int OnDeviceRemoved([MarshalAs(UnmanagedType.LPWStr)] string deviceId);

    [PreserveSig]
    int OnDefaultDeviceChanged(EDataFlow flow, ERole role, [MarshalAs(UnmanagedType.LPWStr)] string? defaultDeviceId);

    [PreserveSig]
    int OnPropertyValueChanged([MarshalAs(UnmanagedType.LPWStr)] string deviceId, PropertyKey key);
}

[ComImport]
[Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioMeterInformation
{
    [PreserveSig]
    int GetPeakValue(out float peak);

    [PreserveSig]
    int GetMeteringChannelCount(out uint channelCount);

    [PreserveSig]
    int GetChannelsPeakValues(uint channelCount, [Out, MarshalAs(UnmanagedType.LPArray)] float[] peakValues);

    [PreserveSig]
    int QueryHardwareSupport(out uint hardwareSupportMask);
}

/// <summary>Endpoint master volume (documented: endpointvolume.h). Only the members Waypoint uses are called.</summary>
[ComImport]
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioEndpointVolume
{
    [PreserveSig] int RegisterControlChangeNotify(IntPtr notify);
    [PreserveSig] int UnregisterControlChangeNotify(IntPtr notify);
    [PreserveSig] int GetChannelCount(out uint channelCount);
    [PreserveSig] int SetMasterVolumeLevel(float levelDb, ref Guid eventContext);
    [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid eventContext);
    [PreserveSig] int GetMasterVolumeLevel(out float levelDb);
    [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
    [PreserveSig] int SetChannelVolumeLevel(uint channel, float levelDb, ref Guid eventContext);
    [PreserveSig] int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid eventContext);
    [PreserveSig] int GetChannelVolumeLevel(uint channel, out float levelDb);
    [PreserveSig] int GetChannelVolumeLevelScalar(uint channel, out float level);
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid eventContext);
    [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}

[StructLayout(LayoutKind.Sequential)]
internal struct PropertyKey
{
    public Guid FormatId;
    public uint PropertyId;

    public PropertyKey(Guid formatId, uint propertyId)
    {
        FormatId = formatId;
        PropertyId = propertyId;
    }

    public override string ToString() => $"{{{FormatId}}},{PropertyId}";
}

/// <summary>
/// Minimal PROPVARIANT. Size is 16 bytes on x86 and 24 bytes on x64, so the union is padded
/// with two pointer-sized fields. Values must be released with <see cref="NativeMethods.PropVariantClear"/>.
/// </summary>
[StructLayout(LayoutKind.Explicit)]
internal struct PropVariant
{
    public const ushort VT_EMPTY = 0;
    public const ushort VT_I4 = 3;
    public const ushort VT_BOOL = 11;
    public const ushort VT_UI4 = 19;
    public const ushort VT_LPWSTR = 31;
    public const ushort VT_CLSID = 72;

    [FieldOffset(0)] public ushort VarType;
    [FieldOffset(8)] public IntPtr Pointer;
    [FieldOffset(8)] public uint UInt32;
    [FieldOffset(8)] public int Int32;
    [FieldOffset(8)] public short Bool;
    [FieldOffset(8)] private IntPtr _pad0;
    [FieldOffset(16)] private IntPtr _pad1;

    public object? ToObject() => VarType switch
    {
        VT_LPWSTR => Marshal.PtrToStringUni(Pointer),
        VT_UI4 => UInt32,
        VT_I4 => Int32,
        VT_BOOL => Bool != 0,
        VT_CLSID => Pointer == IntPtr.Zero ? null : Marshal.PtrToStructure<Guid>(Pointer),
        VT_EMPTY => null,
        _ => $"<vt {VarType}>",
    };
}

internal static partial class NativeMethods
{
    [LibraryImport("ole32.dll")]
    public static partial int PropVariantClear(ref PropVariant value);
}

internal static class PropertyKeys
{
    private static readonly Guid DeviceGuid = new("a45c254e-df1c-4efd-8020-67d146a850e0");
    private static readonly Guid AudioEndpointGuid = new("1da5d803-d492-4edd-8c23-e0c0ffee7f0e");

    /// <summary>"Headphones (OnePlus Nord Buds 3 Pro)"</summary>
    public static readonly PropertyKey DeviceFriendlyName = new(DeviceGuid, 14);

    /// <summary>"Headphones"</summary>
    public static readonly PropertyKey DeviceDescription = new(DeviceGuid, 2);

    /// <summary>"OnePlus Nord Buds 3 Pro" — the adapter/interface name.</summary>
    public static readonly PropertyKey DeviceInterfaceFriendlyName = new(new Guid("026e516e-b814-414b-83cd-856d6fef4822"), 2);

    public static readonly PropertyKey DeviceEnumeratorName = new(DeviceGuid, 24);

    public static readonly PropertyKey AudioEndpointFormFactor = new(AudioEndpointGuid, 0);

    public static readonly PropertyKey AudioEndpointJackSubType = new(AudioEndpointGuid, 8);

    public static readonly PropertyKey DeviceClassIconPath = new(new Guid("259abffc-50a7-47ce-af08-68c9a7d73366"), 12);

    /// <summary>
    /// PKEY_AudioEndpoint_Association-adjacent key that holds the PnP instance path of the
    /// kernel-streaming filter backing the endpoint, e.g. "{1}.BTHENUM\{0000110b-...}".
    /// Used as a transport hint when the enumerator name is unavailable.
    /// </summary>
    public static readonly PropertyKey EndpointKsInstance = new(new Guid("b3f8fa53-0004-438e-9003-51a46e139bfc"), 2);
}

[ComImport]
[Guid("1CB9AD4C-DBFA-4C32-B178-C2F568A703B2")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioClient
{
    [PreserveSig]
    int Initialize(int shareMode, uint streamFlags, long bufferDuration, long periodicity, IntPtr format, IntPtr audioSessionGuid);

    [PreserveSig]
    int GetBufferSize(out uint frames);

    [PreserveSig]
    int GetStreamLatency(out long latency);

    [PreserveSig]
    int GetCurrentPadding(out uint padding);

    [PreserveSig]
    int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closestMatch);

    [PreserveSig]
    int GetMixFormat(out IntPtr format);

    [PreserveSig]
    int GetDevicePeriod(out long defaultPeriod, out long minimumPeriod);

    [PreserveSig]
    int Start();

    [PreserveSig]
    int Stop();

    [PreserveSig]
    int Reset();

    [PreserveSig]
    int SetEventHandle(IntPtr eventHandle);

    [PreserveSig]
    int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
}
