namespace Waypoint.Core.Audio;

public enum AudioNotificationKind
{
    StateChanged,
    Added,
    Removed,
    DefaultChanged,
    PropertyChanged,
}

/// <param name="Flow">Known for <see cref="AudioNotificationKind.DefaultChanged"/>; null for topology events
/// (Windows doesn't say which flow a device belongs to in those callbacks).</param>
public sealed record AudioNotification(AudioNotificationKind Kind, string? DeviceId, AudioFlow? Flow = null);

/// <summary>Outcome of a default-device change, after re-reading the actual defaults.</summary>
public sealed record SwitchResult(bool Verified, string Message, DefaultEndpoints? Observed = null, int? HResult = null)
{
    public static SwitchResult Fail(string message, int? hr = null, DefaultEndpoints? observed = null) => new(false, message, observed, hr);
}

/// <summary>
/// Abstraction over the Windows audio endpoint system so the runtime can be tested without hardware.
/// Implementations may require that all calls happen on one MTA thread.
/// </summary>
public interface IAudioSystem : IDisposable
{
    /// <summary>False when the undocumented policy interface could not be activated.</summary>
    bool CanSwitch { get; }

    string? SwitchUnavailableReason { get; }

    IReadOnlyList<AudioEndpoint> GetEndpoints(AudioFlow flow);

    DefaultEndpoints GetDefaults(AudioFlow flow);

    /// <summary>Sets the default endpoint for the flow and verifies it actually took effect.</summary>
    SwitchResult SetDefault(AudioFlow flow, string deviceId, bool includeCommunications);

    /// <summary>Peak sample value 0..1 on the endpoint, or null if unavailable.</summary>
    float? GetPeak(string deviceId);

    /// <summary>
    /// Windows only meters a microphone while some app has it open. This opens (or, with null, closes) a silent
    /// shared-mode capture stream on the device purely so <see cref="GetPeak"/> reports its level; no audio is read
    /// or kept. Returns false if the stream couldn't be opened (e.g. microphone access is off in Windows privacy).
    /// </summary>
    bool SetCaptureMonitor(string? deviceId) => false;

    /// <summary>Master volume of an active endpoint, or null if unavailable.</summary>
    VolumeInfo? GetVolume(string deviceId);

    /// <summary>Sets master volume (0..1). Returns the volume read back afterwards, or null on failure.</summary>
    VolumeInfo? SetVolume(string deviceId, float level);

    /// <summary>Sets mute. Returns the volume read back afterwards, or null on failure.</summary>
    VolumeInfo? SetMute(string deviceId, bool muted);

    /// <summary>Apps with an audio session on an endpoint.</summary>
    IReadOnlyList<AudioSessionInfo> GetSessions(string deviceId) => [];

    /// <summary>Endpoint an app is pinned to in Windows' per-app settings ("" = follows default; null = unknown).</summary>
    string? GetAppRoute(uint processId, AudioFlow flow) => null;

    /// <summary>Pins an app to an endpoint, or "" to make it follow the system default again. Returns an HRESULT.</summary>
    int SetAppRoute(uint processId, AudioFlow flow, string endpointId, bool includeCommunications) => unchecked((int)0x80004001);

    /// <summary>Raised on an arbitrary COM thread. Handlers must not block or call back into the audio system.</summary>
    event Action<AudioNotification>? Notification;
}
