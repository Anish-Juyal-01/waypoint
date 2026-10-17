using Waypoint.Core.Audio;
using Waypoint.Core.Persistence;

namespace Waypoint.Core.Engine;

/// <summary>A device as presented to the UI, in priority order.</summary>
public sealed record DeviceView
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public required string FriendlyName { get; init; }
    public string? Alias { get; init; }
    public string AdapterName { get; init; } = "";
    public string Description { get; init; } = "";
    public DeviceKind Kind { get; init; }
    public ConnectionType Connection { get; init; }
    public EndpointState State { get; init; }
    public int Rank { get; init; }
    public bool IsDefault { get; init; }
    public bool IsCommunicationsDefault { get; init; }
    public bool Excluded { get; init; }
    public bool AutoExcluded { get; init; }
    public bool IsTarget { get; init; }
    public DateTimeOffset? LastConnected { get; init; }

    /// <summary>Live master volume (connected devices only).</summary>
    public VolumeInfo? Volume { get; init; }

    /// <summary>Volume applied when Waypoint switches to this device, or null.</summary>
    public float? SwitchVolume { get; init; }
}

/// <summary>An app still playing/recording on a device other than the one Waypoint switched to.</summary>
/// <param name="PinnedInWindows">True when Windows' per-app setting pins it (Waypoint can release that);
/// false when the app chose the device in its own settings (only the app can change it).</param>
public sealed record StuckApp(string ProcessName, uint ProcessId, string DeviceId, string DeviceName, bool PinnedInWindows);

/// <summary>State of one side of the pipeline (outputs or inputs).</summary>
public sealed record FlowSnapshot
{
    public required AudioFlow Flow { get; init; }
    public required IReadOnlyList<DeviceView> Devices { get; init; }
    public required SwitchMode Mode { get; init; }
    public string? DefaultId { get; init; }
    public string? TargetId { get; init; }
    public string? PriorityTargetId { get; init; }
    public ManualOverride? Override { get; init; }
    public DateTimeOffset? EnforcementPausedUntil { get; init; }
    public bool Busy { get; init; }
    public string? PendingReason { get; init; }

    /// <summary>Apps that kept using another device after the last switch (checked a few seconds after it).</summary>
    public IReadOnlyList<StuckApp> StuckApps { get; init; } = [];
}

public sealed record SettingsView
{
    public bool StartWithWindows { get; init; }

    /// <summary>Set when a "start with Windows" entry exists but launches a different copy of Waypoint.</summary>
    public string? StartupConflict { get; init; }

    public bool StartMinimized { get; init; }
    public bool CloseToTray { get; init; }
    public bool NotifyOnSwitch { get; init; }
    public bool ShowOsd { get; init; }
    public bool IncludeCommunicationsRole { get; init; }
    public bool IgnoreHandsFree { get; init; }
    public bool StrictLoopGuard { get; init; }
    public bool ShowDisconnected { get; init; }
    public bool ShowVirtualDevices { get; init; }
    public int SettleDelayMs { get; init; }
    public bool OnboardingDone { get; init; }
    public bool HotkeysEnabled { get; init; }
    public string Theme { get; init; } = Themes.System;
}

public sealed record ProfileView(string Id, string Name, string? Pal, string? TopOutput, string? TopInput, SwitchMode OutputMode, SwitchMode InputMode);

public enum HotkeyStatus
{
    Unbound,
    Registered,

    /// <summary>RegisterHotKey failed — another program already owns the combination.</summary>
    Conflict,

    Disabled,
}

public sealed record HotkeyView(string Action, HotkeyBinding? Binding, HotkeyStatus Status);

/// <summary>Everything the UI needs to render, published after every change.</summary>
public sealed record RuntimeSnapshot
{
    public required FlowSnapshot Output { get; init; }
    public required FlowSnapshot Input { get; init; }
    public required SettingsView Settings { get; init; }
    public required IReadOnlyList<ProfileView> Profiles { get; init; }
    public string? ActiveProfileId { get; init; }
    public required IReadOnlyList<HotkeyView> Hotkeys { get; init; }
    public bool CanSwitch { get; init; }
    public string? SwitchUnavailableReason { get; init; }
}

/// <summary>Raised after every attempted switch so the host can notify the user.</summary>
public sealed record SwitchEvent(AudioFlow Flow, string DeviceId, string DeviceName, DeviceKind Kind, string Cause, SwitchResult Result);

/// <summary>A short on-screen message (hotkey feedback, automatic switches).</summary>
public sealed record OsdMessage(string Title, string Subtitle, string Glyph, bool IsError = false);
