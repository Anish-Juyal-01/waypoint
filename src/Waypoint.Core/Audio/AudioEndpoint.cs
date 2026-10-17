namespace Waypoint.Core.Audio;

/// <summary>Which side of the audio pipeline an endpoint is on.</summary>
public enum AudioFlow
{
    /// <summary>Outputs: speakers, headphones, earbuds…</summary>
    Render,

    /// <summary>Inputs: microphones, headset mics…</summary>
    Capture,
}

/// <summary>Endpoint state as reported by IMMDevice::GetState.</summary>
public enum EndpointState
{
    Active,
    Disabled,
    NotPresent,
    Unplugged,
}

/// <summary>How the endpoint is attached to the PC (derived from PnP enumerator / KS instance path).</summary>
public enum ConnectionType
{
    Bluetooth,
    BluetoothHandsFree,
    Usb,
    BuiltIn,
    Display,
    Virtual,
    Other,
}

/// <summary>What the endpoint physically is (derived from PKEY_AudioEndpoint_FormFactor + name).</summary>
public enum DeviceKind
{
    Speakers,
    Headphones,
    Earbuds,
    Headset,
    Display,
    LineOut,
    Digital,
    Microphone,
    Other,
}

/// <summary>Immutable snapshot of one render endpoint.</summary>
public sealed record AudioEndpoint
{
    public required string Id { get; init; }

    /// <summary>Full Windows name, e.g. "Headphones (OnePlus Nord Buds 3 Pro)".</summary>
    public required string FriendlyName { get; init; }

    /// <summary>Endpoint description, e.g. "Headphones" or "Speaker".</summary>
    public string Description { get; init; } = "";

    /// <summary>Adapter / product name, e.g. "OnePlus Nord Buds 3 Pro" or "Realtek(R) Audio".</summary>
    public string AdapterName { get; init; } = "";

    public AudioFlow Flow { get; init; } = AudioFlow.Render;
    public EndpointState State { get; init; }
    public ConnectionType Connection { get; init; }
    public DeviceKind Kind { get; init; }
    public int FormFactor { get; init; } = -1;

    public bool IsAvailable => State == EndpointState.Active;
    public bool IsHandsFree => Connection == ConnectionType.BluetoothHandsFree;
}

/// <summary>An app's audio session on an endpoint (state: 0 inactive, 1 active, 2 expired).</summary>
public sealed record AudioSessionInfo(uint ProcessId, string ProcessName, int State, bool IsSystemSounds);

/// <summary>Master volume of an endpoint (scalar 0..1, as shown in the Windows volume slider).</summary>
public sealed record VolumeInfo(float Level, bool Muted);

/// <summary>The default endpoint for each role the app manages.</summary>
public sealed record DefaultEndpoints(string? Console, string? Multimedia, string? Communications);
