using System.Text.Json.Serialization;

namespace Waypoint.Core.Persistence;

public enum SwitchMode
{
    /// <summary>Monitor only. Never switches automatically.</summary>
    Off,

    /// <summary>Switch on connect/disconnect; respect manual changes until the next connection.</summary>
    Balanced,

    /// <summary>Always enforce the priority list; revert external changes.</summary>
    Strict,
}

/// <summary>Mode + ranking for one side of the pipeline (outputs or inputs). Instances are kept stable and copied into.</summary>
public sealed class FlowSettings
{
    public SwitchMode Mode { get; set; } = SwitchMode.Balanced;

    /// <summary>Endpoint IDs, highest priority first.</summary>
    public List<string> Priority { get; set; } = [];

    /// <summary>Endpoint IDs that are never chosen automatically.</summary>
    public HashSet<string> Excluded { get; set; } = [];

    public FlowSettings Clone() => new() { Mode = Mode, Priority = [.. Priority], Excluded = [.. Excluded] };

    public void CopyFrom(FlowSettings other)
    {
        Mode = other.Mode;
        Priority = [.. other.Priority];
        Excluded = [.. other.Excluded];
    }
}

/// <summary>A named set of output + input rankings the user can switch between (e.g. "Work", "Gaming").</summary>
public sealed class Profile
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N")[..12];
    public string Name { get; set; } = "Default";

    /// <summary>The profile's pixel creature (a cast creature name); null = default by position.</summary>
    public string? Pal { get; set; }

    public FlowSettings Output { get; set; } = new();
    public FlowSettings Input { get; set; } = new() { Mode = SwitchMode.Off };
}

/// <summary>Per-device metadata Waypoint remembers across sessions.</summary>
public sealed class DeviceMemory
{
    public string? Alias { get; set; }
    public string? LastKnownName { get; set; }
    public DateTimeOffset FirstSeen { get; set; }
    public DateTimeOffset? LastConnected { get; set; }

    /// <summary>Volume (0..1) applied whenever Waypoint switches to this device; null = leave Windows' volume alone.</summary>
    public float? SwitchVolume { get; set; }
}

/// <summary>A global keyboard shortcut. Modifiers use RegisterHotKey's MOD_* flags (Alt=1, Ctrl=2, Shift=4, Win=8).</summary>
public sealed record HotkeyBinding(int Modifiers, int Key);

public static class HotkeyActions
{
    public const string NextOutput = "nextOutput";
    public const string PreviousOutput = "previousOutput";
    public const string RestorePriority = "restorePriority";
    public const string ToggleMicMute = "toggleMicMute";
    public const string CycleMode = "cycleMode";
    public const string NextProfile = "nextProfile";
    public const string ShowWindow = "showWindow";

    public static readonly string[] All = [NextOutput, PreviousOutput, RestorePriority, ToggleMicMute, CycleMode, NextProfile, ShowWindow];

    private const int Alt = 1, Ctrl = 2;

    /// <summary>Ctrl+Alt+F-keys: rarely used by other apps or graphics drivers (unlike Ctrl+Alt+arrows).</summary>
    public static Dictionary<string, HotkeyBinding?> Defaults() => new()
    {
        [PreviousOutput] = new(Ctrl | Alt, 0x77), // F8
        [NextOutput] = new(Ctrl | Alt, 0x78),     // F9
        [RestorePriority] = new(Ctrl | Alt, 0x79), // F10
        [ToggleMicMute] = new(Ctrl | Alt, 0x7A),  // F11
        [CycleMode] = new(Ctrl | Alt, 0x76),      // F7
        [NextProfile] = new(Ctrl | Alt, 0x75),    // F6
        [ShowWindow] = null,
    };
}

public static class Themes
{
    public const string System = "system";
    public const string Light = "light";
    public const string Dark = "dark";

    public static bool IsValid(string? theme) => theme is System or Light or Dark;
}

/// <summary>Everything persisted to settings.json. Mutated only on the runtime thread.</summary>
public sealed class AppSettings
{
    public const int CurrentSchema = 2;

    public int SchemaVersion { get; set; } = CurrentSchema;

    /// <summary>Live output ranking (mirrors the active profile).</summary>
    public FlowSettings Output { get; set; } = new();

    /// <summary>Live input (microphone) ranking. Off by default: a Bluetooth headset mic downgrades earbud audio.</summary>
    public FlowSettings Input { get; set; } = new() { Mode = SwitchMode.Off };

    public List<Profile> Profiles { get; set; } = [];
    public string? ActiveProfileId { get; set; }

    public Dictionary<string, DeviceMemory> Devices { get; set; } = [];

    public bool HotkeysEnabled { get; set; } = true;
    public Dictionary<string, HotkeyBinding?> Hotkeys { get; set; } = HotkeyActions.Defaults();

    public bool StartMinimized { get; set; } = true;

    /// <summary>Keep a Start menu shortcut (recreated at startup if it went missing, unless turned off).</summary>
    public bool StartMenuShortcut { get; set; } = true;

    public bool CloseToTray { get; set; } = true;
    public bool NotifyOnSwitch { get; set; } = true;
    public bool ShowOsd { get; set; } = true;
    public bool IncludeCommunicationsRole { get; set; } = true;
    public bool IgnoreHandsFree { get; set; } = true;
    public bool StrictLoopGuard { get; set; } = true;
    public bool ShowDisconnected { get; set; } = true;
    public bool ShowVirtualDevices { get; set; } = false;

    /// <summary>Delay after a device connects before switching to it (Bluetooth reports ACTIVE before it is ready).</summary>
    public int SettleDelayMs { get; set; } = 1500;

    public bool OnboardingDone { get; set; }

    /// <summary>"system" (follow Windows), "light" or "dark".</summary>
    public string Theme { get; set; } = Themes.System;

    // ── Schema 1 fields (single output list). Read for migration only, never written. ──

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public SwitchMode? Mode { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public List<string>? Priority { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public HashSet<string>? Excluded { get; set; }

    public FlowSettings For(Audio.AudioFlow flow) => flow == Audio.AudioFlow.Capture ? Input : Output;

    public Profile? ActiveProfile => Profiles.FirstOrDefault(p => p.Id == ActiveProfileId);

    /// <summary>Brings older files up to date and repairs inconsistent state. Idempotent.</summary>
    public void Normalize()
    {
        if (SchemaVersion < 2 || Priority is not null || Mode is not null)
        {
            if (Mode is { } m) Output.Mode = m;
            if (Priority is { } p) Output.Priority = p;
            if (Excluded is { } e) Output.Excluded = e;
            Mode = null;
            Priority = null;
            Excluded = null;
            SchemaVersion = CurrentSchema;
        }

        Output ??= new FlowSettings();
        Input ??= new FlowSettings { Mode = SwitchMode.Off };
        foreach (var f in new[] { Output, Input })
        {
            f.Priority = (f.Priority ?? []).Where(id => !string.IsNullOrWhiteSpace(id)).Distinct().ToList();
            f.Excluded ??= [];
            if (!Enum.IsDefined(f.Mode)) f.Mode = SwitchMode.Balanced;
        }

        Devices ??= [];
        Profiles ??= [];
        Hotkeys ??= HotkeyActions.Defaults();
        foreach (var (action, binding) in HotkeyActions.Defaults())
            Hotkeys.TryAdd(action, binding);

        SettleDelayMs = Math.Clamp(SettleDelayMs, 0, 5000);
        if (!Themes.IsValid(Theme)) Theme = Themes.System;

        if (Profiles.Count == 0)
            Profiles.Add(new Profile { Name = "Default", Output = Output.Clone(), Input = Input.Clone() });
        if (ActiveProfile is null) ActiveProfileId = Profiles[0].Id;
    }

    /// <summary>Writes the live rankings into the active profile (called before every save).</summary>
    public void SyncActiveProfile()
    {
        if (ActiveProfile is not { } profile) return;
        profile.Output.CopyFrom(Output);
        profile.Input.CopyFrom(Input);
    }
}
