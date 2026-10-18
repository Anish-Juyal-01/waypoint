namespace Waypoint.Core.Engine;

/// <summary>Clock + delayed execution, abstracted so the controller can be tested deterministically.</summary>
public interface IRuntimeScheduler
{
    DateTimeOffset Now { get; }

    /// <summary>Runs <paramref name="action"/> on the controller's thread after <paramref name="delay"/>. Dispose to cancel.</summary>
    IDisposable Schedule(TimeSpan delay, Action action);
}

/// <summary>Partial settings update from the UI. Null = unchanged.</summary>
public sealed record SettingsPatch
{
    public bool? StartWithWindows { get; init; }
    public bool? StartMinimized { get; init; }
    public bool? StartMenuShortcut { get; init; }
    public bool? CloseToTray { get; init; }
    public bool? NotifyOnSwitch { get; init; }
    public bool? ShowOsd { get; init; }
    public bool? HotkeysEnabled { get; init; }
    public bool? IncludeCommunicationsRole { get; init; }
    public bool? IgnoreHandsFree { get; init; }
    public bool? StrictLoopGuard { get; init; }
    public bool? ShowDisconnected { get; init; }
    public bool? ShowVirtualDevices { get; init; }
    public int? SettleDelayMs { get; init; }
    public bool? OnboardingDone { get; init; }
    public string? Theme { get; init; }
}

/// <summary>Abstraction over the "start with Windows" registration (null object in tests).</summary>
public interface IStartupRegistration
{
    bool IsEnabled { get; }

    /// <summary>The existing startup command when it points at a different executable (e.g. another copy), else null.</summary>
    string? ForeignCommand { get; }

    void SetEnabled(bool enabled);
}

/// <summary>Abstraction over the Start menu shortcut (null object in tests).</summary>
public interface IShortcutRegistration
{
    bool Exists { get; }

    /// <summary>Creates the shortcut if missing (or if the program it opens is gone).</summary>
    void EnsurePresent();

    void SetEnabled(bool enabled);
}
