using Waypoint.Core.Audio;
using Waypoint.Core.Persistence;

namespace Waypoint.Core.Engine;

/// <summary>
/// Everything Waypoint does, minus the UI: one <see cref="PriorityController"/> per flow (outputs, microphones),
/// profiles, per-device volume, global settings, hotkey actions and the combined snapshot. Single-threaded
/// (runs on the <see cref="WaypointRuntime"/> thread).
/// </summary>
public sealed class WaypointService
{
    private readonly IAudioSystem _audio;
    private readonly AppSettings _settings;
    private readonly ActivityLog _log;
    private readonly IRuntimeScheduler _scheduler;
    private readonly SettingsStore? _store;
    private readonly IStartupRegistration? _startup;
    private readonly IShortcutRegistration? _shortcut;

    private Dictionary<string, HotkeyStatus> _hotkeyStatus = [];
    private VolumeInfo? _lastOutputVolume;
    private VolumeInfo? _lastInputVolume;
    private bool _publishPending;

    public WaypointService(
        IAudioSystem audio,
        AppSettings settings,
        ActivityLog log,
        IRuntimeScheduler scheduler,
        SettingsStore? store = null,
        IStartupRegistration? startup = null,
        IShortcutRegistration? shortcut = null)
    {
        _audio = audio;
        _settings = settings;
        _log = log;
        _scheduler = scheduler;
        _store = store;
        _startup = startup;
        _shortcut = shortcut;
        _settings.Normalize();

        Output = new PriorityController(AudioFlow.Render, audio, settings, log, scheduler, Save);
        Input = new PriorityController(AudioFlow.Capture, audio, settings, log, scheduler, Save);
        foreach (var c in new[] { Output, Input })
        {
            c.Changed += SchedulePublish;
            c.ActivityAdded += e => ActivityAdded?.Invoke(e);
            c.Switched += OnSwitched;
        }
    }

    public event Action<RuntimeSnapshot>? StateChanged;
    public event Action<ActivityEntry>? ActivityAdded;
    public event Action<SwitchEvent>? Switched;

    /// <summary>Feedback to show on screen (hotkeys, and automatic switches when the window isn't focused).</summary>
    public event Action<OsdMessage>? Osd;

    public PriorityController Output { get; }
    public PriorityController Input { get; }
    public AppSettings Settings => _settings;
    public IReadOnlyList<ActivityEntry> Activity => _log.Entries;

    public PriorityController For(AudioFlow flow) => flow == AudioFlow.Capture ? Input : Output;

    // ───────────────────────────── lifecycle ─────────────────────────────

    public void Initialize()
    {
        Output.Initialize();
        Input.Initialize();

        if (!_audio.CanSwitch)
            Log(ActivityKind.Warning, "Automatic switching unavailable", _audio.SwitchUnavailableReason);

        if (_settings.StartMenuShortcut) TryShortcut(s => s.EnsurePresent());

        var profile = _settings.ActiveProfile?.Name ?? "Default";
        Log(ActivityKind.Info, $"Waypoint started in {PriorityController.ModeName(_settings.Output.Mode)} mode",
            $"Profile: {profile} · Output: {Output.NameOf(Output.CurrentDefaultId)}");
        Save();
        Publish();
    }

    public void OnAudioNotification(AudioNotification n)
    {
        Output.OnAudioNotification(n);
        Input.OnAudioNotification(n);
    }

    // ───────────────────────────── devices ─────────────────────────────

    public void ReleaseApp(AudioFlow flow, uint processId) => For(flow).ReleaseApp(processId);

    public void RecheckApps(AudioFlow flow) => For(flow).RecheckApps();

    public void Rename(string id, string? alias)
    {
        alias = string.IsNullOrWhiteSpace(alias) ? null : alias.Trim();
        if (alias is { Length: > 64 }) alias = alias[..64];
        var memory = MemoryFor(id);
        if (memory.Alias == alias) return;
        memory.Alias = alias;
        Save();
        SchedulePublish();
    }

    public VolumeInfo? SetVolume(string id, float level)
    {
        var result = _audio.SetVolume(id, level);
        SchedulePublish();
        return result;
    }

    public VolumeInfo? SetMute(string id, bool muted)
    {
        var result = _audio.SetMute(id, muted);
        SchedulePublish();
        return result;
    }

    /// <summary>Sets (or clears, with null) the volume applied whenever Waypoint switches to the device.</summary>
    public void SetSwitchVolume(string id, float? level)
    {
        var memory = MemoryFor(id);
        memory.SwitchVolume = level is { } l ? Math.Clamp(l, 0f, 1f) : null;
        Log(ActivityKind.Settings,
            level is null ? $"{NameOf(id)}: volume left as is when switching" : $"{NameOf(id)}: volume set to {memory.SwitchVolume:P0} when switched to",
            deviceId: id);
        Save();
        SchedulePublish();
    }

    // ───────────────────────────── profiles ─────────────────────────────

    public string CreateProfile(string name)
    {
        _settings.SyncActiveProfile();
        var profile = new Profile
        {
            Name = CleanName(name, $"Profile {_settings.Profiles.Count + 1}"),
            Output = _settings.Output.Clone(),
            Input = _settings.Input.Clone(),
        };
        _settings.Profiles.Add(profile);
        Log(ActivityKind.Settings, $"Profile created: {profile.Name}", "Starts as a copy of your current rankings.");
        SwitchProfile(profile.Id, announce: false);
        return profile.Id;
    }

    public void RenameProfile(string id, string name)
    {
        if (_settings.Profiles.FirstOrDefault(p => p.Id == id) is not { } profile) return;
        profile.Name = CleanName(name, profile.Name);
        Save();
        SchedulePublish();
    }

    /// <summary>Sets the profile's creature. Names are validated by the UI's sprite table; length-capped here.</summary>
    public void SetProfilePal(string id, string? pal)
    {
        if (_settings.Profiles.FirstOrDefault(p => p.Id == id) is not { } profile) return;
        profile.Pal = string.IsNullOrWhiteSpace(pal) ? null : pal.Trim()[..Math.Min(pal.Trim().Length, 32)];
        Save();
        SchedulePublish();
    }

    public void DeleteProfile(string id)
    {
        if (_settings.Profiles.Count <= 1) return;
        if (_settings.Profiles.FirstOrDefault(p => p.Id == id) is not { } profile) return;
        bool wasActive = _settings.ActiveProfileId == id;
        _settings.Profiles.Remove(profile);
        Log(ActivityKind.Settings, $"Profile deleted: {profile.Name}");
        if (wasActive)
        {
            _settings.ActiveProfileId = null; // don't sync the live state into the deleted profile
            SwitchProfile(_settings.Profiles[0].Id, announce: true);
        }
        else
        {
            Save();
            SchedulePublish();
        }
    }

    public void SwitchProfile(string id, bool announce = true)
    {
        if (_settings.Profiles.FirstOrDefault(p => p.Id == id) is not { } target) return;
        if (_settings.ActiveProfileId == id && announce) return;

        _settings.SyncActiveProfile();
        _settings.ActiveProfileId = id;
        _settings.Output.CopyFrom(target.Output);
        _settings.Input.CopyFrom(target.Input);
        Output.OnSettingsReplaced();
        Input.OnSettingsReplaced();

        if (announce)
        {
            Log(ActivityKind.ModeChanged, $"Profile: {target.Name}",
                $"Output mode {PriorityController.ModeName(target.Output.Mode)} · Microphone mode {PriorityController.ModeName(target.Input.Mode)}");
            Osd?.Invoke(new OsdMessage(target.Name, "Profile activated", Glyphs.Profile));
        }

        Save();
        SchedulePublish();
    }

    public void NextProfile()
    {
        var list = _settings.Profiles;
        if (list.Count < 2)
        {
            Osd?.Invoke(new OsdMessage(list.FirstOrDefault()?.Name ?? "Default", "Only one profile — create more in Waypoint", Glyphs.Profile));
            return;
        }

        int index = list.FindIndex(p => p.Id == _settings.ActiveProfileId);
        SwitchProfile(list[(index + 1) % list.Count].Id);
    }

    // ───────────────────────────── hotkeys ─────────────────────────────

    public void SetHotkey(string action, HotkeyBinding? binding)
    {
        if (!HotkeyActions.All.Contains(action)) return;
        // A combination can only do one thing: unbind it from any other action.
        if (binding is not null)
        {
            foreach (var other in _settings.Hotkeys.Where(kv => kv.Key != action && kv.Value == binding).Select(kv => kv.Key).ToList())
                _settings.Hotkeys[other] = null;
        }

        _settings.Hotkeys[action] = binding;
        Save();
        SchedulePublish();
    }

    public void ResetHotkeys()
    {
        _settings.Hotkeys = HotkeyActions.Defaults();
        Save();
        SchedulePublish();
    }

    /// <summary>Called by the host after (re)registering hotkeys with Windows.</summary>
    public void SetHotkeyStatuses(Dictionary<string, HotkeyStatus> statuses)
    {
        _hotkeyStatus = statuses;
        SchedulePublish();
    }

    /// <summary>Runs a hotkey action and reports what happened on screen. <see cref="HotkeyActions.ShowWindow"/> is handled by the host.</summary>
    public void ExecuteHotkey(string action)
    {
        switch (action)
        {
            case HotkeyActions.NextOutput:
            case HotkeyActions.PreviousOutput:
                {
                    var result = Output.Cycle(action == HotkeyActions.NextOutput ? 1 : -1);
                    if (result is null)
                        Osd?.Invoke(new OsdMessage("No connected outputs", "Nothing to switch to", Glyphs.Error, IsError: true));
                    else if (!result.Verified)
                        Osd?.Invoke(new OsdMessage("Couldn't switch", result.Message, Glyphs.Error, IsError: true));
                    else
                        OsdForCurrent(Output, "Selected with hotkey");
                    break;
                }

            case HotkeyActions.RestorePriority:
                {
                    var result = Output.RestorePriority();
                    if (result is { Verified: false })
                        Osd?.Invoke(new OsdMessage("Couldn't restore priority", result.Message, Glyphs.Error, IsError: true));
                    else
                        OsdForCurrent(Output, "Priority restored");
                    break;
                }

            case HotkeyActions.ToggleMicMute:
                {
                    var mic = Input.CurrentDefaultId;
                    var current = mic is null ? null : _audio.GetVolume(mic);
                    if (mic is null || current is null)
                    {
                        Osd?.Invoke(new OsdMessage("No microphone", "Nothing to mute", Glyphs.Error, IsError: true));
                        break;
                    }

                    var after = _audio.SetMute(mic, !current.Muted);
                    if (after is null)
                    {
                        Osd?.Invoke(new OsdMessage("Couldn't change mute", Input.NameOf(mic), Glyphs.Error, IsError: true));
                        break;
                    }

                    Log(ActivityKind.Settings, after.Muted ? "Microphone muted" : "Microphone unmuted", Input.NameOf(mic), mic, AudioFlow.Capture);
                    Osd?.Invoke(new OsdMessage(after.Muted ? "Microphone muted" : "Microphone on", Input.NameOf(mic), after.Muted ? Glyphs.MicOff : Glyphs.Mic));
                    SchedulePublish();
                    break;
                }

            case HotkeyActions.CycleMode:
                {
                    var next = _settings.Output.Mode switch
                    {
                        SwitchMode.Off => SwitchMode.Balanced,
                        SwitchMode.Balanced => SwitchMode.Strict,
                        _ => SwitchMode.Off,
                    };
                    Output.SetMode(next);
                    Osd?.Invoke(new OsdMessage($"{PriorityController.ModeName(next)} mode", next switch
                    {
                        SwitchMode.Off => "Automatic switching paused",
                        SwitchMode.Balanced => "Switches on connect, respects your changes",
                        _ => "Your priority list always wins",
                    }, next == SwitchMode.Strict ? Glyphs.Lock : Glyphs.Sync));
                    break;
                }

            case HotkeyActions.NextProfile:
                NextProfile();
                break;
        }
    }

    // ───────────────────────────── settings ─────────────────────────────

    public void UpdateSettings(SettingsPatch p)
    {
        bool reevaluate = false;
        var changes = new List<string>();

        if (p.StartWithWindows is { } sw && _startup is not null && _startup.IsEnabled != sw)
        {
            try
            {
                var replaced = sw ? _startup.ForeignCommand : null;
                _startup.SetEnabled(sw);
                changes.Add(sw ? "Start with Windows on" : "Start with Windows off");
                if (replaced is not null) Log(ActivityKind.Settings, "Replaced previous startup entry", $"It launched: {replaced}");
            }
            catch (Exception ex) when (ex is UnauthorizedAccessException or System.Security.SecurityException or IOException
                                           or InvalidOperationException or System.ComponentModel.Win32Exception)
            {
                Log(ActivityKind.Warning, "Couldn't change Start with Windows", ex.Message);
            }
        }

        if (p.StartMenuShortcut is { } menu && _settings.StartMenuShortcut != menu)
        {
            _settings.StartMenuShortcut = menu;
            if (TryShortcut(s => s.SetEnabled(menu))) changes.Add(menu ? "Added to the Start menu" : "Removed from the Start menu");
        }

        if (p.StartMinimized is { } sm) _settings.StartMinimized = sm;
        if (p.CloseToTray is { } ct) _settings.CloseToTray = ct;
        if (p.NotifyOnSwitch is { } ns) _settings.NotifyOnSwitch = ns;
        if (p.ShowOsd is { } osd) _settings.ShowOsd = osd;
        if (p.ShowDisconnected is { } sd) _settings.ShowDisconnected = sd;
        if (p.OnboardingDone is { } od) _settings.OnboardingDone = od;
        if (p.Theme is { } theme && Themes.IsValid(theme)) _settings.Theme = theme;
        if (p.HotkeysEnabled is { } he && he != _settings.HotkeysEnabled)
        {
            _settings.HotkeysEnabled = he;
            changes.Add(he ? "Keyboard shortcuts on" : "Keyboard shortcuts off");
        }

        if (p.StrictLoopGuard is { } lg)
        {
            _settings.StrictLoopGuard = lg;
            if (!lg)
            {
                Output.ResetLoopGuard();
                Input.ResetLoopGuard();
            }
        }

        if (p.SettleDelayMs is { } delay) _settings.SettleDelayMs = Math.Clamp(delay, 0, 5000);

        if (p.IncludeCommunicationsRole is { } comm && comm != _settings.IncludeCommunicationsRole)
        {
            _settings.IncludeCommunicationsRole = comm;
            changes.Add(comm ? "Calls & chat apps follow Waypoint" : "Calls & chat apps left alone");
            reevaluate = true;
        }

        if (p.IgnoreHandsFree is { } hf && hf != _settings.IgnoreHandsFree)
        {
            _settings.IgnoreHandsFree = hf;
            changes.Add(hf ? "Hands-Free outputs ignored" : "Hands-Free outputs allowed");
            reevaluate = true;
        }

        if (p.ShowVirtualDevices is { } sv && sv != _settings.ShowVirtualDevices)
        {
            _settings.ShowVirtualDevices = sv;
            changes.Add(sv ? "Virtual devices included" : "Virtual devices hidden");
            reevaluate = true;
        }

        foreach (var c in changes) Log(ActivityKind.Settings, c);
        Save();
        if (reevaluate)
        {
            Output.Reevaluate("rules");
            Input.Reevaluate("rules");
        }

        SchedulePublish();
    }

    public void ClearActivity()
    {
        _log.Clear();
        SchedulePublish();
    }

    public string ExportActivity() => _log.ExportText();

    public void Rescan()
    {
        Output.Rescan();
        Input.Rescan();
    }

    /// <summary>Peak levels of the current default output and microphone.</summary>
    public (float? Output, float? Input) SampleLevels() =>
        (Output.CurrentDefaultId is { } o ? _audio.GetPeak(o) : null,
         Input.CurrentDefaultId is { } i ? _audio.GetPeak(i) : null);

    /// <summary>Keeps the silent capture stream on the current default mic open (or closes it), so its level can be shown.</summary>
    public void SyncCaptureMonitor(bool wanted) => _audio.SetCaptureMonitor(wanted ? Input.CurrentDefaultId : null);

    /// <summary>Runs a Start menu shortcut operation; failures are logged, never thrown (it's a convenience).</summary>
    private bool TryShortcut(Action<IShortcutRegistration> action)
    {
        if (_shortcut is null) return false;
        try
        {
            action(_shortcut);
            return true;
        }
        catch (Exception ex)
        {
            Log(ActivityKind.Warning, "Couldn't update the Start menu shortcut", ex.Message);
            return false;
        }
    }

    /// <summary>Publishes when the default devices' volume/mute changed outside Waypoint (volume keys, mixer).</summary>
    public void PollVolumes()
    {
        var output = Output.CurrentDefaultId is { } o ? _audio.GetVolume(o) : null;
        var input = Input.CurrentDefaultId is { } i ? _audio.GetVolume(i) : null;
        if (output != _lastOutputVolume || input != _lastInputVolume) SchedulePublish();
        _lastOutputVolume = output;
        _lastInputVolume = input;
    }

    public RuntimeSnapshot Snapshot() => new()
    {
        Output = Output.Snapshot(),
        Input = Input.Snapshot(),
        Settings = new SettingsView
        {
            StartWithWindows = _startup?.IsEnabled ?? false,
            StartupConflict = _startup?.ForeignCommand,
            StartMinimized = _settings.StartMinimized,
            StartMenuShortcut = _shortcut?.Exists ?? _settings.StartMenuShortcut,
            CloseToTray = _settings.CloseToTray,
            NotifyOnSwitch = _settings.NotifyOnSwitch,
            ShowOsd = _settings.ShowOsd,
            IncludeCommunicationsRole = _settings.IncludeCommunicationsRole,
            IgnoreHandsFree = _settings.IgnoreHandsFree,
            StrictLoopGuard = _settings.StrictLoopGuard,
            ShowDisconnected = _settings.ShowDisconnected,
            ShowVirtualDevices = _settings.ShowVirtualDevices,
            SettleDelayMs = _settings.SettleDelayMs,
            OnboardingDone = _settings.OnboardingDone,
            HotkeysEnabled = _settings.HotkeysEnabled,
            Theme = _settings.Theme,
        },
        Profiles = _settings.Profiles.Select(ProfileViewFor).ToList(),
        ActiveProfileId = _settings.ActiveProfileId,
        Hotkeys = HotkeyActions.All.Select(a =>
        {
            var binding = _settings.Hotkeys.GetValueOrDefault(a);
            var status = binding is null ? HotkeyStatus.Unbound
                : !_settings.HotkeysEnabled ? HotkeyStatus.Disabled
                : _hotkeyStatus.GetValueOrDefault(a, HotkeyStatus.Registered);
            return new HotkeyView(a, binding, status);
        }).ToList(),
        CanSwitch = _audio.CanSwitch,
        SwitchUnavailableReason = _audio.SwitchUnavailableReason,
    };

    // ───────────────────────────── helpers ─────────────────────────────

    private void OnSwitched(SwitchEvent e)
    {
        Switched?.Invoke(e);
    }

    private void OsdForCurrent(PriorityController c, string subtitle)
    {
        var id = c.CurrentDefaultId;
        var kind = c.Endpoints.FirstOrDefault(e => e.Id == id)?.Kind ?? DeviceKind.Other;
        Osd?.Invoke(new OsdMessage(c.NameOf(id), subtitle, Glyphs.For(kind)));
    }

    private ProfileView ProfileViewFor(Profile p)
    {
        // The active profile's live rankings may be newer than its stored copy (synced on save).
        bool active = p.Id == _settings.ActiveProfileId;
        var output = active ? _settings.Output : p.Output;
        var input = active ? _settings.Input : p.Input;
        var topOut = PriorityEngine.SelectPriorityTarget(Output.Endpoints, _settings, output);
        var topIn = PriorityEngine.SelectPriorityTarget(Input.Endpoints, _settings, input);
        return new ProfileView(
            p.Id,
            p.Name,
            p.Pal,
            topOut is null ? null : Output.NameOf(topOut.Id),
            topIn is null ? null : Input.NameOf(topIn.Id),
            output.Mode,
            input.Mode);
    }

    private string NameOf(string id) =>
        Output.Endpoints.Any(e => e.Id == id) ? Output.NameOf(id) : Input.NameOf(id);

    private DeviceMemory MemoryFor(string id)
    {
        if (!_settings.Devices.TryGetValue(id, out var m))
        {
            m = new DeviceMemory { FirstSeen = _scheduler.Now };
            _settings.Devices[id] = m;
        }

        return m;
    }

    private static string CleanName(string? name, string fallback)
    {
        var n = (name ?? "").Trim();
        if (n.Length == 0) return fallback;
        return n.Length > 40 ? n[..40] : n;
    }

    private void Log(ActivityKind kind, string title, string? detail = null, string? deviceId = null, AudioFlow? flow = null)
    {
        var entry = _log.Add(kind, title, detail, deviceId, flow);
        ActivityAdded?.Invoke(entry);
    }

    private void Save()
    {
        try
        {
            _store?.Save(_settings);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            _log.Add(ActivityKind.Warning, "Couldn't save settings", ex.Message);
        }
    }

    /// <summary>Coalesces bursts of changes (a switch touches both state and log) into one snapshot.</summary>
    private void SchedulePublish()
    {
        if (_publishPending) return;
        _publishPending = true;
        _scheduler.Schedule(TimeSpan.Zero, Publish);
    }

    private void Publish()
    {
        _publishPending = false;
        StateChanged?.Invoke(Snapshot());
    }
}

/// <summary>Segoe Fluent Icons / MDL2 code points used by the on-screen indicator.</summary>
public static class Glyphs
{
    public const string Speakers = "";
    public const string Headphones = "";
    public const string Display = "";
    public const string Mic = "";
    public const string MicOff = "";
    public const string Volume = "";
    public const string Lock = "";
    public const string Sync = "";
    public const string Profile = "";
    public const string Error = "";

    public static string For(DeviceKind kind) => kind switch
    {
        DeviceKind.Speakers or DeviceKind.LineOut => Speakers,
        DeviceKind.Headphones or DeviceKind.Earbuds or DeviceKind.Headset => Headphones,
        DeviceKind.Display => Display,
        DeviceKind.Microphone => Mic,
        _ => Volume,
    };
}
