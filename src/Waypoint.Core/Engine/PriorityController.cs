using Waypoint.Core.Audio;
using Waypoint.Core.Persistence;

namespace Waypoint.Core.Engine;

/// <summary>
/// Applies the mode rules for ONE side of the audio pipeline (outputs or microphones): reacts to device and
/// default-endpoint changes and performs verified switches. <see cref="WaypointService"/> owns one per flow.
/// Single-threaded — every public method must be called on the runtime thread, and the scheduler must call back on it.
/// </summary>
/// <remarks>
/// Mode rules:
/// <list type="bullet">
/// <item>OFF — monitor only. Manual selection and "Restore priority" still work.</item>
/// <item>BALANCED — switch to the best device when devices connect/disconnect or rules change. A default chosen
/// outside Waypoint is respected (external override) until the next device connects or the user restores priority.</item>
/// <item>STRICT — the priority list always wins; external changes are reverted. A device the user picks in Waypoint
/// stays pinned until "Restore priority" or until it disconnects. A loop guard pauses enforcement if another
/// program keeps fighting.</item>
/// </list>
/// </remarks>
public sealed class PriorityController
{
    /// <summary>Topology changes within this window make a default change "system-driven" rather than a manual choice.</summary>
    internal static readonly TimeSpan SystemChangeWindow = TimeSpan.FromSeconds(4);

    internal static readonly TimeSpan EchoWindow = TimeSpan.FromSeconds(3);
    internal static readonly TimeSpan TopologyDebounce = TimeSpan.FromMilliseconds(250);
    internal static readonly TimeSpan DefaultDebounce = TimeSpan.FromMilliseconds(300);
    internal static readonly TimeSpan DisconnectDelay = TimeSpan.FromMilliseconds(400);
    internal static readonly TimeSpan RetryDelay = TimeSpan.FromMilliseconds(1500);
    internal static readonly TimeSpan LoopWindow = TimeSpan.FromSeconds(30);
    internal static readonly TimeSpan LoopPause = TimeSpan.FromSeconds(60);
    internal const int LoopLimit = 5;
    internal const int MaxRetries = 2;

    private readonly AudioFlow _flow;
    private readonly IAudioSystem _audio;
    private readonly ActivityLog _log;
    private readonly IRuntimeScheduler _scheduler;
    private readonly AppSettings _app;
    private readonly Action _save;

    private Dictionary<string, AudioEndpoint> _endpoints = [];
    private DefaultEndpoints _defaults = new(null, null, null);
    private ManualOverride? _override;

    private IDisposable? _topologyTimer;
    private IDisposable? _defaultTimer;
    private IDisposable? _evaluateTimer;
    private IDisposable? _resumeTimer;
    private string? _pendingReason;

    private string? _lastSwitchTarget;
    private DateTimeOffset _lastSwitchAt = DateTimeOffset.MinValue;
    private DateTimeOffset _lastTopologyChangeAt = DateTimeOffset.MinValue;
    private readonly Queue<DateTimeOffset> _strictReverts = new();
    private DateTimeOffset? _pausedUntil;
    private int _retryCount;
    private bool _warnedNoTarget;
    private IReadOnlyList<StuckApp> _stuckApps = [];
    private IDisposable? _appCheckTimer;
    private readonly HashSet<string> _reportedStuck = [];

    /// <summary>Apps (Discord, games…) need a moment to re-open their streams after the default changes.</summary>
    internal static readonly TimeSpan AppCheckDelay = TimeSpan.FromSeconds(3);
    internal static readonly TimeSpan AppRecheckDelay = TimeSpan.FromSeconds(8);

    /// <summary>Processes that never count as "stuck" (Waypoint itself, Windows audio plumbing).</summary>
    private static readonly HashSet<string> IgnoredProcesses = new(StringComparer.OrdinalIgnoreCase) { "Waypoint", "audiodg", "System", "Idle" };

    public PriorityController(AudioFlow flow, IAudioSystem audio, AppSettings app, ActivityLog log, IRuntimeScheduler scheduler, Action? save = null)
    {
        _flow = flow;
        _audio = audio;
        _app = app;
        _log = log;
        _scheduler = scheduler;
        _save = save ?? (() => { });
    }

    /// <summary>Something visible changed; the owner should publish a new snapshot.</summary>
    public event Action? Changed;

    public event Action<ActivityEntry>? ActivityAdded;
    public event Action<SwitchEvent>? Switched;

    public AudioFlow Flow => _flow;
    public FlowSettings Settings => _app.For(_flow);
    public ManualOverride? Override => _override;
    public string? CurrentDefaultId => _defaults.Console;
    public IReadOnlyCollection<AudioEndpoint> Endpoints => _endpoints.Values;
    public DateTimeOffset? EnforcementPausedUntil => _pausedUntil;

    private bool IsInput => _flow == AudioFlow.Capture;
    private string Noun => IsInput ? "microphone" : "output";
    private string ModeScope => IsInput ? "Microphone mode" : "Mode";

    // ───────────────────────────── lifecycle ─────────────────────────────

    public void Initialize()
    {
        var endpoints = _audio.GetEndpoints(_flow);
        _endpoints = endpoints.ToDictionary(e => e.Id);
        _defaults = _audio.GetDefaults(_flow);

        bool firstRun = Settings.Priority.Count == 0;
        MergeNewDevices(logEach: !firstRun);
        foreach (var e in endpoints.Where(e => e.IsAvailable)) Remember(e, connected: true);
        if (firstRun && endpoints.Count > 0)
            Log(ActivityKind.Discovered, $"Found {endpoints.Count} audio {(IsInput ? "inputs" : "outputs")}", "Ranked automatically — drag to reorder.");

        ScheduleEvaluate(TimeSpan.Zero, "startup");
    }

    /// <summary>Feed raw notifications (already marshalled to this thread).</summary>
    public void OnAudioNotification(AudioNotification n)
    {
        if (n.Kind == AudioNotificationKind.DefaultChanged)
        {
            if (n.Flow is { } f && f != _flow) return;
            _defaultTimer?.Dispose();
            _defaultTimer = _scheduler.Schedule(DefaultDebounce, CheckDefaults);
        }
        else
        {
            _topologyTimer?.Dispose();
            _topologyTimer = _scheduler.Schedule(TopologyDebounce, RefreshTopology);
        }
    }

    // ───────────────────────────── user commands ─────────────────────────────

    public void SetMode(SwitchMode mode)
    {
        if (Settings.Mode == mode) return;
        Settings.Mode = mode;
        _override = null;
        ResetLoopGuard();
        Log(ActivityKind.ModeChanged, $"{ModeScope} set to {ModeName(mode)}", ModeDescription(mode));
        _save();
        ScheduleEvaluate(TimeSpan.Zero, "mode");
        Changed?.Invoke();
    }

    public void Reorder(IReadOnlyList<string> ids)
    {
        var next = PriorityEngine.ApplyReorder(Settings.Priority, ids);
        if (next.SequenceEqual(Settings.Priority)) return;
        Settings.Priority = next;
        var top = PriorityEngine.SelectPriorityTarget(_endpoints.Values, _app, Settings);
        Log(ActivityKind.PriorityChanged, IsInput ? "Microphone priority updated" : "Priority order updated",
            top is null ? null : $"Top available: {DisplayName(top)}");
        _save();
        ScheduleEvaluate(TimeSpan.Zero, "priority");
        Changed?.Invoke();
    }

    public void SetExcluded(string id, bool excluded)
    {
        bool changed = excluded ? Settings.Excluded.Add(id) : Settings.Excluded.Remove(id);
        if (!changed) return;
        Log(ActivityKind.Settings, excluded ? $"{NameOf(id)} excluded from auto-switching" : $"{NameOf(id)} included in auto-switching", deviceId: id);
        _save();
        ScheduleEvaluate(TimeSpan.Zero, "rules");
        Changed?.Invoke();
    }

    /// <summary>User picked a device in Waypoint (window, tray or hotkey). Becomes a manual override (pinned in STRICT).</summary>
    public SwitchResult SelectDevice(string id, string cause = "manual")
    {
        if (!_endpoints.TryGetValue(id, out var device) || !device.IsAvailable)
        {
            Log(ActivityKind.SwitchFailed, $"Can't switch to {NameOf(id)}", "The device is not connected.", id);
            Changed?.Invoke();
            return SwitchResult.Fail("The device is not connected.");
        }

        var priorityTop = PriorityEngine.SelectPriorityTarget(_endpoints.Values, _app, Settings);
        if (Settings.Mode != SwitchMode.Off)
        {
            if (priorityTop?.Id == id)
            {
                _override = null; // choosing the top device is the same as following priority
            }
            else
            {
                _override = new ManualOverride(id, OverrideSource.App, _scheduler.Now);
                Log(ActivityKind.Override, $"Manual override: {DisplayName(device)}",
                    Settings.Mode == SwitchMode.Strict
                        ? "Pinned until you restore priority or the device disconnects."
                        : "Held until another device connects or you restore priority.", id);
            }
        }

        _retryCount = 0;
        if (InSync(id))
        {
            Changed?.Invoke();
            return new SwitchResult(true, "Already the default", _defaults);
        }

        return PerformSwitch(device, cause);
    }

    /// <summary>Selects the next/previous connected device in priority order.</summary>
    public SwitchResult? Cycle(int direction)
    {
        var next = PriorityEngine.Cycle(_endpoints.Values, _app, Settings, _defaults.Console, direction);
        if (next is null) return null;
        return SelectDevice(next.Id, "hotkey");
    }

    /// <summary>Drop any override and switch to the top priority device — works in every mode.</summary>
    public SwitchResult? RestorePriority()
    {
        bool hadOverride = _override is not null;
        _override = null;
        ResetLoopGuard();
        var target = PriorityEngine.SelectPriorityTarget(_endpoints.Values, _app, Settings);
        Log(ActivityKind.Restored, IsInput ? "Microphone priority restored" : "Priority restored",
            target is null ? $"No ranked {Noun} is connected." : $"Target: {DisplayName(target)}{(hadOverride ? " (override cleared)" : "")}");
        if (target is not null && !InSync(target.Id))
        {
            _retryCount = 0;
            return PerformSwitch(target, "restore");
        }

        Changed?.Invoke();
        return target is null ? null : new SwitchResult(true, "Already the default", _defaults);
    }

    public void ResetPriorities()
    {
        Settings.Priority.Clear();
        Settings.Excluded.Clear();
        _override = null;
        MergeNewDevices(logEach: false);
        Log(ActivityKind.PriorityChanged, IsInput ? "Microphone list reset to the recommended order" : "Priority list reset to the recommended order");
        _save();
        ScheduleEvaluate(TimeSpan.Zero, "priority");
        Changed?.Invoke();
    }

    /// <summary>The flow settings were replaced (profile switch): drop overrides, add unknown devices, apply.</summary>
    public void OnSettingsReplaced()
    {
        _override = null;
        ResetLoopGuard();
        MergeNewDevices(logEach: false);
        ScheduleEvaluate(TimeSpan.Zero, "profile");
    }

    /// <summary>Re-applies the rules after a global setting changed.</summary>
    public void Reevaluate(string reason) => ScheduleEvaluate(TimeSpan.Zero, reason);

    /// <summary>Re-reads everything from Windows (e.g. after resume from sleep).</summary>
    public void Rescan() => RefreshTopology();

    public void ResetLoopGuard()
    {
        _strictReverts.Clear();
        _pausedUntil = null;
        _resumeTimer?.Dispose();
        _resumeTimer = null;
    }

    public FlowSnapshot Snapshot()
    {
        var target = PriorityEngine.SelectTarget(_endpoints.Values, _app, Settings, _override);
        var priorityTarget = PriorityEngine.SelectPriorityTarget(_endpoints.Values, _app, Settings);
        var devices = new List<DeviceView>();
        int rank = 0;

        foreach (var id in Settings.Priority)
        {
            if (!_endpoints.TryGetValue(id, out var e)) continue; // removed endpoint (driver uninstalled)
            if (e.Connection == ConnectionType.Virtual && !_app.ShowVirtualDevices) continue;
            rank++;
            _app.Devices.TryGetValue(id, out var mem);
            devices.Add(new DeviceView
            {
                Id = id,
                Name = DisplayName(e),
                FriendlyName = e.FriendlyName,
                Alias = mem?.Alias,
                AdapterName = e.AdapterName,
                Description = e.Description,
                Kind = e.Kind,
                Connection = e.Connection,
                State = e.State,
                Rank = rank,
                IsDefault = _defaults.Console == id,
                IsCommunicationsDefault = _defaults.Communications == id,
                Excluded = Settings.Excluded.Contains(id),
                AutoExcluded = PriorityEngine.IsAutoExcluded(e, _app),
                IsTarget = target?.Id == id,
                LastConnected = mem?.LastConnected,
                Volume = e.IsAvailable ? _audio.GetVolume(id) : null,
                SwitchVolume = mem?.SwitchVolume,
            });
        }

        return new FlowSnapshot
        {
            Flow = _flow,
            Devices = devices,
            Mode = Settings.Mode,
            DefaultId = _defaults.Console,
            TargetId = target?.Id,
            PriorityTargetId = priorityTarget?.Id,
            Override = _override,
            EnforcementPausedUntil = _pausedUntil,
            Busy = _evaluateTimer is not null,
            PendingReason = _pendingReason,
            StuckApps = _stuckApps,
        };
    }

    public string NameOf(string? id)
    {
        if (id is null) return $"no {Noun}";
        if (_endpoints.TryGetValue(id, out var e)) return DisplayName(e);
        return _app.Devices.TryGetValue(id, out var m) ? m.Alias ?? m.LastKnownName ?? "Unknown device" : "Unknown device";
    }

    // ───────────────────────────── event handling ─────────────────────────────

    private void RefreshTopology()
    {
        _topologyTimer = null;
        var previous = _endpoints;
        var current = _audio.GetEndpoints(_flow).ToDictionary(e => e.Id);
        _endpoints = current;

        var connected = new List<AudioEndpoint>();
        var disconnected = new List<AudioEndpoint>();
        foreach (var e in current.Values)
        {
            bool was = previous.TryGetValue(e.Id, out var old) && old.IsAvailable;
            if (e.IsAvailable && !was) connected.Add(e);
            else if (!e.IsAvailable && was) disconnected.Add(e);
        }

        foreach (var old in previous.Values.Where(o => o.IsAvailable && !current.ContainsKey(o.Id)))
            disconnected.Add(old);

        MergeNewDevices(logEach: true);

        foreach (var e in connected)
        {
            Remember(e, connected: true);
            if (!IsQuiet(e)) Log(ActivityKind.Connected, $"{DisplayName(e)} connected", ConnectionLabel(e.Connection), e.Id);
        }

        foreach (var e in disconnected)
        {
            if (!IsQuiet(e)) Log(ActivityKind.Disconnected, $"{DisplayName(e)} disconnected", null, e.Id);
        }

        if (connected.Count > 0 || disconnected.Count > 0)
        {
            _lastTopologyChangeAt = _scheduler.Now;
            _warnedNoTarget = false;
        }

        // Override lifecycle.
        if (_override is not null)
        {
            if (disconnected.Any(d => d.Id == _override.DeviceId) || !current.ContainsKey(_override.DeviceId))
            {
                Log(ActivityKind.Override, "Override ended", $"{NameOf(_override.DeviceId)} disconnected — following priority again.");
                _override = null;
            }
            else if (Settings.Mode == SwitchMode.Balanced && connected.Any(e => PriorityEngine.IsEligible(e, _app, Settings)))
            {
                Log(ActivityKind.Override, "Override ended", "A device connected — following priority again.");
                _override = null;
            }
        }

        _defaults = _audio.GetDefaults(_flow);
        if (connected.Count > 0 || disconnected.Count > 0) _save();

        if (connected.Any(e => PriorityEngine.IsEligible(e, _app, Settings)))
        {
            _retryCount = 0;
            ScheduleEvaluate(TimeSpan.FromMilliseconds(_app.SettleDelayMs), "connect");
        }
        else if (disconnected.Count > 0)
        {
            _retryCount = 0;
            ScheduleEvaluate(DisconnectDelay, "disconnect");
        }
        else if (connected.Count > 0)
        {
            ScheduleEvaluate(TimeSpan.Zero, "topology");
        }

        Changed?.Invoke();
    }

    private void CheckDefaults()
    {
        _defaultTimer = null;
        var observed = _audio.GetDefaults(_flow);
        if (observed == _defaults)
        {
            Changed?.Invoke();
            return;
        }

        _defaults = observed;
        var now = _scheduler.Now;
        var current = observed.Console;

        // Our own switch echoing back.
        if (current is not null && current == _lastSwitchTarget && now - _lastSwitchAt < EchoWindow)
        {
            Changed?.Invoke();
            return;
        }

        // A switch is already scheduled (device just connected/disconnected) — Windows' own reaction to the
        // topology change, not a user choice. The pending evaluation will decide.
        bool systemDriven = _evaluateTimer is not null || _topologyTimer is not null || now - _lastTopologyChangeAt < SystemChangeWindow;
        var target = PriorityEngine.SelectTarget(_endpoints.Values, _app, Settings, _override);
        if (current is null || target is null || current == target.Id && InSync(target.Id))
        {
            Changed?.Invoke();
            return;
        }

        switch (Settings.Mode)
        {
            case SwitchMode.Off:
                Log(ActivityKind.ExternalChange, $"{(IsInput ? "Microphone" : "Output")} changed to {NameOf(current)}", "Changed outside Waypoint.", current);
                break;

            case SwitchMode.Balanced when systemDriven:
                ScheduleEvaluate(TimeSpan.FromMilliseconds(Math.Max(_app.SettleDelayMs, 300)), "system");
                break;

            case SwitchMode.Balanced:
                if (current == target.Id) break; // only a role (e.g. Communications) drifted — leave it
                _override = new ManualOverride(current, OverrideSource.External, now);
                Log(ActivityKind.ExternalChange, $"Respecting your choice: {NameOf(current)}",
                    "Changed outside Waypoint. Priority resumes when a device connects or you restore it.", current);
                break;

            case SwitchMode.Strict:
                if (systemDriven)
                {
                    ScheduleEvaluate(TimeSpan.FromMilliseconds(Math.Max(_app.SettleDelayMs, 300)), "system");
                    break;
                }

                if (_pausedUntil is { } until && now < until) break;
                if (TripLoopGuard(now)) break;
                Log(ActivityKind.Reverted, $"Reverted change to {NameOf(current)}", $"STRICT keeps {DisplayName(target)} as the {Noun}.", current);
                _retryCount = 0;
                PerformSwitch(target, "strict");
                return;
        }

        Changed?.Invoke();
    }

    private void ScheduleEvaluate(TimeSpan delay, string reason)
    {
        _evaluateTimer?.Dispose();
        _pendingReason = reason;
        _evaluateTimer = _scheduler.Schedule(delay, () =>
        {
            _evaluateTimer = null;
            _pendingReason = null;
            Evaluate(reason);
        });
    }

    private void Evaluate(string reason)
    {
        if (Settings.Mode == SwitchMode.Off || !_audio.CanSwitch)
        {
            Changed?.Invoke();
            return;
        }

        if (Settings.Mode == SwitchMode.Strict && _pausedUntil is { } until && _scheduler.Now < until)
        {
            Changed?.Invoke();
            return;
        }

        var target = PriorityEngine.SelectTarget(_endpoints.Values, _app, Settings, _override);
        if (target is null)
        {
            if (!_warnedNoTarget && reason is "disconnect" or "startup")
            {
                _warnedNoTarget = true;
                Log(ActivityKind.Warning, $"No preferred {Noun} available", $"Leaving Windows on {NameOf(_defaults.Console)}.");
            }

            Changed?.Invoke();
            return;
        }

        if (InSync(target.Id))
        {
            // Windows often falls back on its own when a device disconnects; record that the result matches priority.
            if (reason == "disconnect")
                Log(ActivityKind.Info, $"{(IsInput ? "Now recording from" : "Now playing on")} {DisplayName(target)}", $"Next available {Noun} in your priority list.", target.Id);
            Changed?.Invoke();
            return;
        }

        PerformSwitch(target, reason);
    }

    private SwitchResult PerformSwitch(AudioEndpoint target, string cause)
    {
        var result = _audio.SetDefault(_flow, target.Id, _app.IncludeCommunicationsRole);
        _lastSwitchTarget = target.Id;
        _lastSwitchAt = _scheduler.Now;
        _defaults = result.Observed ?? _audio.GetDefaults(_flow);

        if (result.Verified)
        {
            _retryCount = 0;
            _stuckApps = [];
            _reportedStuck.Clear();
            ScheduleAppCheck(AppCheckDelay, recheck: true);
            var detail = $"{CauseLabel(cause)} · {result.Message}";
            if (ApplySwitchVolume(target) is { } applied) detail += $" · volume set to {applied:P0}";
            Log(ActivityKind.Switched, $"Switched to {DisplayName(target)}", detail, target.Id);
        }
        else
        {
            bool canRetry = cause is "connect" or "system" or "disconnect" or "startup" && _retryCount < MaxRetries;
            Log(ActivityKind.SwitchFailed, $"Couldn't switch to {DisplayName(target)}",
                result.Message + (canRetry ? " Retrying…" : ""), target.Id);
            if (canRetry)
            {
                _retryCount++;
                ScheduleEvaluate(RetryDelay, cause);
            }
        }

        Switched?.Invoke(new SwitchEvent(_flow, target.Id, DisplayName(target), target.Kind, cause, result));
        Changed?.Invoke();
        return result;
    }

    /// <summary>Applies the device's remembered switch volume, returning the level actually read back.</summary>
    private float? ApplySwitchVolume(AudioEndpoint target)
    {
        if (!_app.Devices.TryGetValue(target.Id, out var mem) || mem.SwitchVolume is not { } level) return null;
        var after = _audio.SetVolume(target.Id, level);
        if (after is null)
        {
            Log(ActivityKind.Warning, $"Couldn't set the volume of {DisplayName(target)}", null, target.Id);
            return null;
        }

        return after.Level;
    }

    /// <summary>Re-checks which apps didn't follow the current default (e.g. after the user changed an app's setting).</summary>
    public void RecheckApps() => ScheduleAppCheck(TimeSpan.Zero, recheck: false);

    /// <summary>Clears Windows' per-app pin for a process so it follows the default (and Waypoint) again.</summary>
    public int ReleaseApp(uint processId)
    {
        int hr = _audio.SetAppRoute(processId, _flow, "", _app.IncludeCommunicationsRole);
        var name = _stuckApps.FirstOrDefault(a => a.ProcessId == processId)?.ProcessName ?? $"pid {processId}";
        if (hr == 0)
            Log(ActivityKind.Settings, $"{name} now follows Waypoint", "Cleared its per-app device in Windows. New audio from it uses your current device.");
        else
            Log(ActivityKind.Warning, $"Couldn't release {name}", $"Windows returned 0x{hr:X8}.");
        ScheduleAppCheck(TimeSpan.FromSeconds(1.5), recheck: false);
        return hr;
    }

    private void ScheduleAppCheck(TimeSpan delay, bool recheck)
    {
        _appCheckTimer?.Dispose();
        _appCheckTimer = _scheduler.Schedule(delay, () =>
        {
            _appCheckTimer = null;
            CheckApps();
            // Some apps re-open their streams lazily; look once more before concluding.
            if (recheck && _stuckApps.Count > 0) ScheduleAppCheck(AppRecheckDelay, recheck: false);
        });
    }

    /// <summary>Finds apps with an ACTIVE session on another connected device of this flow.</summary>
    private void CheckApps()
    {
        var target = _defaults.Console;
        if (target is null)
        {
            _stuckApps = [];
            Changed?.Invoke();
            return;
        }

        var stuck = new List<StuckApp>();
        foreach (var e in _endpoints.Values.Where(e => e.IsAvailable && e.Id != target))
        {
            foreach (var s in _audio.GetSessions(e.Id))
            {
                if (s.State != 1 || s.IsSystemSounds || s.ProcessId == 0 || IgnoredProcesses.Contains(s.ProcessName)) continue;
                if (stuck.Any(x => x.ProcessName.Equals(s.ProcessName, StringComparison.OrdinalIgnoreCase))) continue;
                var route = _audio.GetAppRoute(s.ProcessId, _flow);
                stuck.Add(new StuckApp(s.ProcessName, s.ProcessId, e.Id, DisplayName(e), PinnedInWindows: !string.IsNullOrEmpty(route)));
            }
        }

        _stuckApps = stuck;
        foreach (var app in stuck)
        {
            if (!_reportedStuck.Add(app.ProcessName)) continue;
            Log(ActivityKind.Warning, $"{app.ProcessName} is still on {app.DeviceName}",
                app.PinnedInWindows
                    ? "Windows' per-app setting pins it there. Use \"Let it follow\" in Waypoint to release it."
                    : $"{app.ProcessName} picked that {Noun} in its own settings. Set its {(IsInput ? "input" : "output")} device to \"Default\" so it follows Waypoint.");
        }

        Changed?.Invoke();
    }

    // ───────────────────────────── helpers ─────────────────────────────

    private bool TripLoopGuard(DateTimeOffset now)
    {
        if (!_app.StrictLoopGuard) return false;
        while (_strictReverts.Count > 0 && now - _strictReverts.Peek() > LoopWindow) _strictReverts.Dequeue();
        _strictReverts.Enqueue(now);
        if (_strictReverts.Count <= LoopLimit) return false;

        _pausedUntil = now + LoopPause;
        _strictReverts.Clear();
        Log(ActivityKind.Warning, "STRICT paused for 60 seconds",
            $"Another program keeps changing the default {Noun}. Waypoint backed off to avoid a switching loop.");
        _resumeTimer?.Dispose();
        _resumeTimer = _scheduler.Schedule(LoopPause, () =>
        {
            _resumeTimer = null;
            _pausedUntil = null;
            Log(ActivityKind.Info, "STRICT enforcement resumed");
            Evaluate("resume");
        });
        return true;
    }

    private bool InSync(string id) =>
        _defaults.Console == id && _defaults.Multimedia == id
        && (!_app.IncludeCommunicationsRole || _defaults.Communications == id);

    private void MergeNewDevices(bool logEach)
    {
        Settings.Priority = PriorityEngine.MergeNewDevices(Settings.Priority, _endpoints.Values, out var added);
        foreach (var e in added)
        {
            MemoryFor(e.Id).LastKnownName = e.FriendlyName;
            if (logEach && !IsQuiet(e))
                Log(ActivityKind.Discovered, $"New {Noun}: {DisplayName(e)}", "Added to the bottom of your priority list.", e.Id);
        }
    }

    /// <summary>Hands-Free / virtual endpoints mirror a "real" device; logging them separately is noise.</summary>
    private bool IsQuiet(AudioEndpoint e) => PriorityEngine.IsAutoExcluded(e, _app);

    private DeviceMemory MemoryFor(string id)
    {
        if (!_app.Devices.TryGetValue(id, out var m))
        {
            m = new DeviceMemory { FirstSeen = _scheduler.Now };
            _app.Devices[id] = m;
        }

        return m;
    }

    private void Remember(AudioEndpoint e, bool connected)
    {
        var m = MemoryFor(e.Id);
        m.LastKnownName = e.FriendlyName;
        if (connected) m.LastConnected = _scheduler.Now;
    }

    private string DisplayName(AudioEndpoint e) =>
        _app.Devices.TryGetValue(e.Id, out var m) && m.Alias is { } alias ? alias : e.FriendlyName;

    private void Log(ActivityKind kind, string title, string? detail = null, string? deviceId = null)
    {
        var entry = _log.Add(kind, title, detail, deviceId, _flow);
        ActivityAdded?.Invoke(entry);
    }

    internal static string ModeName(SwitchMode m) => m switch
    {
        SwitchMode.Off => "Off",
        SwitchMode.Balanced => "Balanced",
        _ => "Strict",
    };

    private string ModeDescription(SwitchMode m) => m switch
    {
        SwitchMode.Off => "Monitoring only. Waypoint won't switch automatically.",
        SwitchMode.Balanced => "Switches on connect and disconnect, and respects manual changes.",
        _ => $"Your priority list always wins. Outside changes to the {Noun} are reverted.",
    };

    private static string CauseLabel(string cause) => cause switch
    {
        "connect" => "Higher-priority device connected",
        "disconnect" => "Fallback after disconnect",
        "manual" => "Selected manually",
        "hotkey" => "Selected with a hotkey",
        "restore" => "Priority restored",
        "strict" => "STRICT enforcement",
        "startup" => "Applied priority at startup",
        "priority" => "Priority order changed",
        "profile" => "Profile changed",
        "mode" => "Mode changed",
        "rules" => "Rules changed",
        "system" => "Corrected Windows' automatic choice",
        "resume" => "STRICT resumed",
        _ => "Priority applied",
    };

    private static string ConnectionLabel(ConnectionType c) => c switch
    {
        ConnectionType.Bluetooth => "Bluetooth",
        ConnectionType.BluetoothHandsFree => "Bluetooth Hands-Free",
        ConnectionType.Usb => "USB",
        ConnectionType.BuiltIn => "Built-in",
        ConnectionType.Display => "HDMI / DisplayPort",
        ConnectionType.Virtual => "Virtual",
        _ => "Other",
    };
}
