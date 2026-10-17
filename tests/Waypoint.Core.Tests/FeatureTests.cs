using Waypoint.Core.Audio;
using Waypoint.Core.Engine;
using Waypoint.Core.Persistence;

namespace Waypoint.Core.Tests;

/// <summary>Microphones, profiles, per-device volume and hotkey actions.</summary>
public sealed class FeatureTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "waypoint-tests-" + Guid.NewGuid().ToString("N"));
    private readonly FakeAudioSystem _audio = new();
    private readonly ManualScheduler _clock = new();
    private readonly List<OsdMessage> _osd = [];
    private WaypointService _svc = null!;

    public void Dispose()
    {
        try { Directory.Delete(_dir, true); } catch (IOException) { }
    }

    private WaypointService Start(Action<AppSettings>? configure = null)
    {
        var settings = new AppSettings { SettleDelayMs = 1000 };
        configure?.Invoke(settings);
        _svc = new WaypointService(_audio, settings, new ActivityLog(new AppPaths(_dir)), _clock);
        _svc.Osd += _osd.Add;
        _audio.Notification += _svc.OnAudioNotification;
        _svc.Initialize();
        _clock.Flush();
        return _svc;
    }

    // ── Microphones ──

    [Fact]
    public void Microphones_are_managed_independently_of_outputs()
    {
        _audio.Add("buds").Add("speaker", ConnectionType.BuiltIn, DeviceKind.Speakers)
              .AddMic("usb-mic", ConnectionType.Usb).AddMic("array");
        _audio.SetDefaultSilently("speaker");
        _audio.SetDefaultSilently("array");

        var svc = Start(s =>
        {
            s.Output.Priority = ["buds", "speaker"];
            s.Input.Mode = SwitchMode.Balanced;
            s.Input.Priority = ["usb-mic", "array"];
        });

        Assert.Equal("buds", _audio.Console);
        Assert.Equal("usb-mic", _audio.Mic);
        Assert.Equal(["usb-mic", "array"], svc.Input.Settings.Priority);
        Assert.DoesNotContain("usb-mic", svc.Output.Settings.Priority);
    }

    [Fact]
    public void Microphone_mode_defaults_to_off()
    {
        _audio.AddMic("usb-mic", ConnectionType.Usb).AddMic("array");
        _audio.SetDefaultSilently("array");

        var svc = Start(s => s.Input.Priority = ["usb-mic", "array"]);

        Assert.Equal(SwitchMode.Off, svc.Input.Settings.Mode);
        Assert.Equal("array", _audio.Mic);
    }

    [Fact]
    public void Hands_free_is_only_ignored_for_outputs()
    {
        _audio.Add("hf-out", ConnectionType.BluetoothHandsFree, DeviceKind.Headset)
              .AddMic("hf-mic", ConnectionType.BluetoothHandsFree).AddMic("array");
        _audio.SetDefaultSilently("array");

        var svc = Start(s =>
        {
            s.Input.Mode = SwitchMode.Balanced;
            s.Input.Priority = ["hf-mic", "array"];
        });

        Assert.Equal("hf-mic", _audio.Mic);
        Assert.True(svc.Output.Snapshot().Devices.Single(d => d.Id == "hf-out").AutoExcluded);
        Assert.False(svc.Input.Snapshot().Devices.Single(d => d.Id == "hf-mic").AutoExcluded);
    }

    // ── Apps that don't follow ──

    [Fact]
    public void Apps_left_on_the_old_device_are_reported_after_a_switch()
    {
        _audio.Add("buds", active: false).Add("speaker", ConnectionType.BuiltIn, DeviceKind.Speakers);
        _audio.SetDefaultSilently("speaker");
        var svc = Start(s => s.Output.Priority = ["buds", "speaker"]);
        _audio.PlayOn("speaker", "Discord", 42);   // Discord chose "speaker" in its own settings
        _audio.PlayOn("speaker", "brave", 7);

        _audio.SetState("buds", true);
        _clock.Advance(TimeSpan.FromSeconds(1.5));
        _audio.PlayOn("buds", "brave", 7);          // the browser follows the default…
        _clock.Advance(PriorityController.AppCheckDelay);

        var stuck = svc.Snapshot().Output.StuckApps;
        Assert.Equal("buds", _audio.Console);
        var discord = Assert.Single(stuck);         // …Discord doesn't
        Assert.Equal("Discord", discord.ProcessName);
        Assert.False(discord.PinnedInWindows);
        Assert.Contains(svc.Activity, a => a.Kind == ActivityKind.Warning && a.Title.Contains("Discord is still on"));
    }

    [Fact]
    public void Windows_pinned_app_can_be_released()
    {
        _audio.Add("buds").Add("speaker", ConnectionType.BuiltIn, DeviceKind.Speakers);
        var svc = Start(s => s.Output.Priority = ["buds", "speaker"]);
        _audio.PlayOn("speaker", "Discord", 42, pinnedTo: "speaker");

        svc.Output.RecheckApps();
        _clock.Flush();
        Assert.True(Assert.Single(svc.Snapshot().Output.StuckApps).PinnedInWindows);

        svc.ReleaseApp(AudioFlow.Render, 42);
        Assert.Equal("", _audio.GetAppRoute(42, AudioFlow.Render));
    }

    [Fact]
    public void No_stuck_apps_when_everything_follows()
    {
        _audio.Add("buds", active: false).Add("speaker", ConnectionType.BuiltIn, DeviceKind.Speakers);
        _audio.SetDefaultSilently("speaker");
        var svc = Start(s => s.Output.Priority = ["buds", "speaker"]);

        _audio.SetState("buds", true);
        _clock.Advance(TimeSpan.FromSeconds(1.5));
        _audio.PlayOn("buds", "brave", 7);
        _clock.Flush();

        Assert.Empty(svc.Snapshot().Output.StuckApps);
    }

    // ── Profiles ──

    [Fact]
    public void Switching_profiles_applies_its_ranking()
    {
        _audio.Add("buds").Add("speaker", ConnectionType.BuiltIn, DeviceKind.Speakers);
        var svc = Start(s => s.Output.Priority = ["buds", "speaker"]);
        var defaultId = svc.Settings.ActiveProfileId!;
        Assert.Equal("buds", _audio.Console);

        var gaming = svc.CreateProfile("Gaming");
        svc.Output.Reorder(["speaker", "buds"]);
        _clock.Flush();
        Assert.Equal("speaker", _audio.Console);

        svc.SwitchProfile(defaultId);
        _clock.Flush();
        Assert.Equal("buds", _audio.Console);
        Assert.Equal(["buds", "speaker"], svc.Settings.Output.Priority);

        svc.SwitchProfile(gaming);
        _clock.Flush();
        Assert.Equal("speaker", _audio.Console);
        Assert.Contains(_osd, m => m.Title == "Gaming");
    }

    [Fact]
    public void Deleting_active_profile_falls_back_and_last_profile_is_kept()
    {
        _audio.Add("buds");
        var svc = Start();
        var first = svc.Settings.ActiveProfileId!;
        var second = svc.CreateProfile("Second");

        svc.DeleteProfile(second);
        Assert.Equal(first, svc.Settings.ActiveProfileId);
        Assert.Single(svc.Settings.Profiles);

        svc.DeleteProfile(first);
        Assert.Single(svc.Settings.Profiles);
    }

    [Fact]
    public void Profile_pal_is_saved_and_reported()
    {
        _audio.Add("buds");
        var svc = Start();
        var id = svc.Settings.ActiveProfileId!;

        svc.SetProfilePal(id, "sprout");
        Assert.Equal("sprout", svc.Snapshot().Profiles.Single(p => p.Id == id).Pal);

        svc.SetProfilePal(id, null);
        Assert.Null(svc.Snapshot().Profiles.Single(p => p.Id == id).Pal);
    }

    [Fact]
    public void Next_profile_cycles()
    {
        _audio.Add("buds");
        var svc = Start();
        var a = svc.Settings.ActiveProfileId;
        var b = svc.CreateProfile("B");

        svc.ExecuteHotkey(HotkeyActions.NextProfile);
        Assert.Equal(a, svc.Settings.ActiveProfileId);
        svc.ExecuteHotkey(HotkeyActions.NextProfile);
        Assert.Equal(b, svc.Settings.ActiveProfileId);
    }

    // ── Volume ──

    [Fact]
    public void Switch_volume_is_applied_when_switching_to_device()
    {
        _audio.Add("buds", active: false).Add("speaker", ConnectionType.BuiltIn, DeviceKind.Speakers);
        _audio.SetDefaultSilently("speaker");
        var svc = Start(s => s.Output.Priority = ["buds", "speaker"]);

        svc.SetSwitchVolume("buds", 0.25f);
        _audio.SetState("buds", true);
        _clock.Flush();

        Assert.Equal("buds", _audio.Console);
        Assert.Equal(0.25f, _audio.GetVolume("buds")!.Level);
        Assert.Contains(svc.Activity, a => a.Kind == ActivityKind.Switched && a.Detail!.Contains("volume set to 25"));
    }

    [Fact]
    public void Devices_without_switch_volume_keep_their_volume()
    {
        _audio.Add("buds", active: false).Add("speaker", ConnectionType.BuiltIn, DeviceKind.Speakers);
        _audio.SetDefaultSilently("speaker");
        Start(s => s.Output.Priority = ["buds", "speaker"]);

        _audio.SetState("buds", true);
        _clock.Flush();

        Assert.Equal(0.5f, _audio.GetVolume("buds")!.Level);
    }

    [Fact]
    public void Snapshot_reports_live_volume_for_connected_devices_only()
    {
        _audio.Add("buds").Add("old", active: false);
        var svc = Start(s => s.Output.Priority = ["buds", "old"]);
        svc.SetVolume("buds", 0.8f);

        var devices = svc.Snapshot().Output.Devices;
        Assert.Equal(0.8f, devices.Single(d => d.Id == "buds").Volume!.Level);
        Assert.Null(devices.Single(d => d.Id == "old").Volume);
    }

    // ── Hotkeys ──

    [Fact]
    public void Next_and_previous_output_cycle_connected_devices()
    {
        _audio.Add("a").Add("b").Add("gone", active: false).Add("c", ConnectionType.BuiltIn, DeviceKind.Speakers);
        var svc = Start(s => s.Output.Priority = ["a", "b", "gone", "c"]);
        Assert.Equal("a", _audio.Console);

        svc.ExecuteHotkey(HotkeyActions.NextOutput);
        Assert.Equal("b", _audio.Console);
        svc.ExecuteHotkey(HotkeyActions.NextOutput);
        Assert.Equal("c", _audio.Console); // skips the disconnected device
        svc.ExecuteHotkey(HotkeyActions.NextOutput);
        Assert.Equal("a", _audio.Console); // wraps
        svc.ExecuteHotkey(HotkeyActions.PreviousOutput);
        Assert.Equal("c", _audio.Console);

        Assert.Equal(OverrideSource.App, svc.Output.Override?.Source);
        Assert.Equal("c", _osd[^1].Title);
    }

    [Fact]
    public void Hotkey_selection_is_respected_in_strict_until_restore()
    {
        _audio.Add("a").Add("b");
        var svc = Start(s =>
        {
            s.Output.Mode = SwitchMode.Strict;
            s.Output.Priority = ["a", "b"];
        });

        svc.ExecuteHotkey(HotkeyActions.NextOutput);
        _clock.Flush();
        Assert.Equal("b", _audio.Console);

        svc.ExecuteHotkey(HotkeyActions.RestorePriority);
        _clock.Flush();
        Assert.Equal("a", _audio.Console);
    }

    [Fact]
    public void Toggle_mic_mute_mutes_default_microphone()
    {
        _audio.Add("buds").AddMic("array");
        _audio.SetDefaultSilently("array");
        var svc = Start();

        svc.ExecuteHotkey(HotkeyActions.ToggleMicMute);
        Assert.True(_audio.GetVolume("array")!.Muted);
        Assert.Equal("Microphone muted", _osd[^1].Title);

        svc.ExecuteHotkey(HotkeyActions.ToggleMicMute);
        Assert.False(_audio.GetVolume("array")!.Muted);
    }

    [Fact]
    public void Cycle_mode_rotates_output_mode()
    {
        _audio.Add("buds");
        var svc = Start();
        Assert.Equal(SwitchMode.Balanced, svc.Settings.Output.Mode);

        svc.ExecuteHotkey(HotkeyActions.CycleMode);
        Assert.Equal(SwitchMode.Strict, svc.Settings.Output.Mode);
        svc.ExecuteHotkey(HotkeyActions.CycleMode);
        Assert.Equal(SwitchMode.Off, svc.Settings.Output.Mode);
    }

    [Fact]
    public void Binding_a_combination_unbinds_it_elsewhere()
    {
        _audio.Add("buds");
        var svc = Start();
        var combo = svc.Settings.Hotkeys[HotkeyActions.NextOutput]!;

        svc.SetHotkey(HotkeyActions.ShowWindow, combo);

        Assert.Equal(combo, svc.Settings.Hotkeys[HotkeyActions.ShowWindow]);
        Assert.Null(svc.Settings.Hotkeys[HotkeyActions.NextOutput]);
    }

    [Fact]
    public void Hotkey_status_reflects_host_registration()
    {
        _audio.Add("buds");
        var svc = Start();
        svc.SetHotkeyStatuses(new() { [HotkeyActions.NextOutput] = HotkeyStatus.Conflict });

        var views = svc.Snapshot().Hotkeys;
        Assert.Equal(HotkeyStatus.Conflict, views.Single(h => h.Action == HotkeyActions.NextOutput).Status);
        Assert.Equal(HotkeyStatus.Unbound, views.Single(h => h.Action == HotkeyActions.ShowWindow).Status);
    }
}
