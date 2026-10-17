namespace Waypoint.Core.Audio;

/// <summary>
/// Pure heuristics that turn raw endpoint properties into <see cref="ConnectionType"/> and
/// <see cref="DeviceKind"/>. Kept separate from COM code so it can be unit tested.
/// </summary>
public static class EndpointClassifier
{
    // EndpointFormFactor values from mmdeviceapi.h
    public const int FfRemoteNetworkDevice = 0;
    public const int FfSpeakers = 1;
    public const int FfLineLevel = 2;
    public const int FfHeadphones = 3;
    public const int FfMicrophone = 4;
    public const int FfHeadset = 5;
    public const int FfHandset = 6;
    public const int FfUnknownDigitalPassthrough = 7;
    public const int FfSpdif = 8;
    public const int FfDigitalAudioDisplayDevice = 9;

    public static ConnectionType ClassifyConnection(string? enumerator, string? ksInstance, string friendlyName, int formFactor)
    {
        var e = (enumerator ?? "").ToUpperInvariant();
        var ks = (ksInstance ?? "").ToUpperInvariant();
        var name = friendlyName.ToUpperInvariant();

        // Bluetooth Hands-Free profile (HFP) endpoints come from BTHHFENUM; the "Hands-Free" suffix is a backup signal.
        if (e == "BTHHFENUM" || ks.Contains("BTHHFENUM") || name.Contains("HANDS-FREE"))
            return ConnectionType.BluetoothHandsFree;

        if (e is "BTHENUM" or "BTHLEDEVICE" or "BTHLE" || ks.Contains("BTHENUM") || ks.Contains("BTHLE"))
            return ConnectionType.Bluetooth;

        if (e == "USB" || ks.Contains("\\USB") || ks.StartsWith("{1}.USB") || ks.Contains("USB\\"))
            return ConnectionType.Usb;

        if (formFactor == FfDigitalAudioDisplayDevice || e == "DISPLAY" || ks.Contains("DISPLAY"))
            return ConnectionType.Display;

        if (e is "HDAUDIO" or "INTELAUDIO" or "ACPI" or "PCI" || ks.Contains("HDAUDIO") || ks.Contains("INTELAUDIO"))
            return ConnectionType.BuiltIn;

        if (e is "ROOT" or "SWD" || ks.Contains("ROOT\\"))
            return ConnectionType.Virtual;

        return ConnectionType.Other;
    }

    public static DeviceKind ClassifyKind(int formFactor, string friendlyName, string adapterName, ConnectionType connection)
    {
        var text = $"{friendlyName} {adapterName}".ToUpperInvariant();
        bool earbudHint = text.Contains("BUDS") || text.Contains("POD") || text.Contains("TWS") || text.Contains("EARBUD")
                          || text.Contains("AIRDOPES") || text.Contains("EARPHONE") || text.Contains("IN-EAR");

        return formFactor switch
        {
            FfHeadphones when earbudHint => DeviceKind.Earbuds,
            FfHeadphones => DeviceKind.Headphones,
            FfHeadset or FfHandset when earbudHint => DeviceKind.Earbuds,
            FfHeadset or FfHandset => DeviceKind.Headset,
            FfSpeakers => DeviceKind.Speakers,
            FfLineLevel => DeviceKind.LineOut,
            FfMicrophone => DeviceKind.Microphone,
            FfSpdif or FfUnknownDigitalPassthrough => DeviceKind.Digital,
            FfDigitalAudioDisplayDevice => DeviceKind.Display,
            _ when connection == ConnectionType.Display => DeviceKind.Display,
            _ when earbudHint => DeviceKind.Earbuds,
            _ when connection is ConnectionType.Bluetooth or ConnectionType.BluetoothHandsFree => DeviceKind.Headphones,
            _ => DeviceKind.Other,
        };
    }
}
