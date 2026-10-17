using Waypoint.Core.Audio;
using Waypoint.Core.Engine;
using Waypoint.Core.Persistence;

namespace Waypoint.Core.Tests;

public sealed class PriorityControllerTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "waypoint-tests-" + Guid.NewGuid().ToString("N"));
    private readonly FakeAudioSystem _audio = new();
    private readonly ManualScheduler _clock = new();
    private WaypointService _svc = null!;
    private PriorityController _c = null!;

    public void Dispose()
    {
        try { Directory.Delete(_dir, true); } catch (IOException) { }
    }

    private PriorityController Start(SwitchMode mode, params string[] priority)
    {
        var settings = new AppSettings { SettleDelayMs = 1000 };
        settings.Output.Mode = mode;
        settings.Output.Priority = [.. priority];
        _svc = new WaypointService(_audio, settings, new ActivityLog(new AppPaths(_dir)), _clock);
        _audio.Notification += _svc.OnAudioNotification;
        _svc.Initialize();
        _clock.Flush();
        _c = _svc.Output;
        return _c;
    }

    private bool Logged(ActivityKind kind) => _svc.Activity.Any(a => a.Kind == kind);

    [Fact]
    public void Startup_switches_to_top_available_device_in_balanced()
    {
        _audio.Add("buds").Add("speaker", ConnectionType.BuiltIn, DeviceKind.Speakers);
        _audio.SetDefaultSilently("speaker");

        Start(SwitchMode.Balanced, "buds", "speaker");

        Assert.Equal("buds", _audio.Console);
        Assert.True(Logged(ActivityKind.Switched));
    }

    [Fact]
    public void Off_mode_never_switches_automatically()
    {
        _audio.Add("buds", active: false).Add("speaker", ConnectionType.BuiltIn, DeviceKind.Speakers);
        _audio.SetDefaultSilently("speaker");
        Start(SwitchMode.Off, "buds", "speaker");

        _audio.SetState("buds", true);
        _clock.Flush();

        Assert.Equal("speaker", _audio.Console);
        Assert.Equal(0, _audio.SwitchCalls);
    }

    [Fact]
    public void Connecting_higher_priority_device_switches_after_settle_delay()
    {
        _audio.Add("buds", active: false).Add("speaker", ConnectionType.BuiltIn, DeviceKind.Speakers);
        _audio.SetDefaultSilently("speaker");
        Start(SwitchMode.Balanced, "buds", "speaker");

        _audio.SetState("buds", true);
        _clock.Advance(TimeSpan.FromMilliseconds(500)); // debounce passed, settle not yet
        Assert.Equal("speaker", _audio.Console);

        _clock.Advance(TimeSpan.FromSeconds(1));
        Assert.Equal("buds", _audio.Console);
    }

    [Fact]
    public void Disconnect_falls_back_to_next_available_device()
    {
        _audio.Add("buds").Add("usb", ConnectionType.Usb, DeviceKind.Speakers).Add("speaker", ConnectionType.BuiltIn, DeviceKind.Speakers);
        Start(SwitchMode.Balanced, "buds", "usb", "speaker");
        Assert.Equal("buds", _audio.Console);

        _audio.SetState("buds", false);
        _audio.SetDefaultSilently("speaker"); // Windows picks something on its own
        _clock.Flush();

        Assert.Equal("usb", _audio.Console);
    }

    [Fact]
    public void Excluded_and_hands_free_devices_are_skipped()
    {
        _audio.Add("hf", ConnectionType.BluetoothHandsFree, DeviceKind.Headset)
              .Add("buds")
              .Add("speaker", ConnectionType.BuiltIn, DeviceKind.Speakers);
        _audio.SetDefaultSilently("speaker");
        var c = Start(SwitchMode.Balanced, "hf", "buds", "speaker");
        Assert.Equal("buds", _audio.Console);

        c.SetExcluded("buds", true);
        _clock.Flush();
        Assert.Equal("speaker", _audio.Console);
    }

    [Fact]
    public void Balanced_respects_external_change_until_next_connect()
    {
        _audio.Add("buds").Add("headphones", active: false).Add("speaker", ConnectionType.BuiltIn, DeviceKind.Speakers);
        var c = Start(SwitchMode.Balanced, "buds", "headphones", "speaker");
        Assert.Equal("buds", _audio.Console);

        _audio.ExternalSetDefault("speaker");
        _clock.Flush();
        Assert.Equal("speaker", _audio.Console);
        Assert.Equal(OverrideSource.External, c.Override?.Source);

        _audio.SetState("headphones", true);
        _clock.Flush();
        Assert.Null(c.Override);
        Assert.Equal("buds", _audio.Console);
    }

    [Fact]
    public void Strict_reverts_external_change()
    {
        _audio.Add("buds").Add("speaker", ConnectionType.BuiltIn, DeviceKind.Speakers);
        Start(SwitchMode.Strict, "buds", "speaker");

        _audio.ExternalSetDefault("speaker");
        _clock.Flush();

        Assert.Equal("buds", _audio.Console);
        Assert.True(Logged(ActivityKind.Reverted));
    }

    [Fact]
    public void Strict_honours_in_app_selection_until_restore()
    {
        _audio.Add("buds").Add("speaker", ConnectionType.BuiltIn, DeviceKind.Speakers);
        var c = Start(SwitchMode.Strict, "buds", "speaker");

        c.SelectDevice("speaker");
        _clock.Flush();
        Assert.Equal("speaker", _audio.Console);
        Assert.Equal(OverrideSource.App, c.Override?.Source);

        // An outside change back to buds is reverted to the pinned speaker.
        _audio.ExternalSetDefault("buds");
        _clock.Flush();
        Assert.Equal("speaker", _audio.Console);

        c.RestorePriority();
        _clock.Flush();
        Assert.Null(c.Override);
        Assert.Equal("buds", _audio.Console);
    }

    [Fact]
    public void Override_ends_when_its_device_disconnects()
    {
        _audio.Add("buds").Add("usb", ConnectionType.Usb, DeviceKind.Speakers).Add("speaker", ConnectionType.BuiltIn, DeviceKind.Speakers);
        var c = Start(SwitchMode.Strict, "buds", "usb", "speaker");
        c.SelectDevice("usb");
        _clock.Flush();

        _audio.SetState("usb", false);
        _clock.Flush();

        Assert.Null(c.Override);
        Assert.Equal("buds", _audio.Console);
    }

    [Fact]
    public void Strict_loop_guard_pauses_enforcement()
    {
        _audio.Add("buds").Add("speaker", ConnectionType.BuiltIn, DeviceKind.Speakers);
        var c = Start(SwitchMode.Strict, "buds", "speaker");

        for (int i = 0; i < PriorityController.LoopLimit + 1; i++)
        {
            _audio.ExternalSetDefault("speaker");
            _clock.Advance(TimeSpan.FromSeconds(1));
        }

        Assert.Equal("speaker", _audio.Console);
        Assert.NotNull(c.EnforcementPausedUntil);

        _clock.Advance(PriorityController.LoopPause);
        Assert.Null(c.EnforcementPausedUntil);
        Assert.Equal("buds", _audio.Console);
    }

    [Fact]
    public void Windows_auto_switch_on_connect_is_not_treated_as_manual_choice()
    {
        _audio.Add("buds").Add("headphones", active: false).Add("speaker", ConnectionType.BuiltIn, DeviceKind.Speakers);
        var c = Start(SwitchMode.Balanced, "buds", "headphones", "speaker");

        // Windows makes the newly connected (lower priority) device default by itself.
        _audio.SetState("headphones", true);
        _audio.ExternalSetDefault("headphones");
        _clock.Flush();

        Assert.Null(c.Override);
        Assert.Equal("buds", _audio.Console);
    }

    [Fact]
    public void Failed_switch_is_reported_and_retried()
    {
        _audio.Add("buds", active: false).Add("speaker", ConnectionType.BuiltIn, DeviceKind.Speakers);
        _audio.SetDefaultSilently("speaker");
        Start(SwitchMode.Balanced, "buds", "speaker");

        _audio.FailNextSwitch = true;
        _audio.SetState("buds", true);
        _clock.Flush();

        Assert.True(Logged(ActivityKind.SwitchFailed));
        Assert.Equal("buds", _audio.Console);
    }

    [Fact]
    public void Manual_selection_of_disconnected_device_fails_cleanly()
    {
        _audio.Add("buds", active: false).Add("speaker", ConnectionType.BuiltIn, DeviceKind.Speakers);
        var c = Start(SwitchMode.Balanced, "buds", "speaker");

        c.SelectDevice("buds");

        Assert.True(Logged(ActivityKind.SwitchFailed));
        Assert.Equal("speaker", _audio.Console);
    }

    [Fact]
    public void Reorder_applies_new_priority()
    {
        _audio.Add("buds").Add("speaker", ConnectionType.BuiltIn, DeviceKind.Speakers);
        var c = Start(SwitchMode.Balanced, "buds", "speaker");

        c.Reorder(["speaker", "buds"]);
        _clock.Flush();

        Assert.Equal("speaker", _audio.Console);
        Assert.Equal(["speaker", "buds"], c.Settings.Priority);
    }

    [Fact]
    public void New_devices_are_appended_and_first_run_is_seeded()
    {
        _audio.Add("speaker", ConnectionType.BuiltIn, DeviceKind.Speakers).Add("buds");
        var c = Start(SwitchMode.Off);
        Assert.Equal(["buds", "speaker"], c.Settings.Priority); // seeded: Bluetooth audio before built-in speakers

        _audio.Add("usb", ConnectionType.Usb, DeviceKind.Headphones);
        _audio.SetState("usb", true);
        _clock.Flush();
        Assert.Equal(["buds", "speaker", "usb"], c.Settings.Priority);
    }

    [Fact]
    public void Off_mode_restore_priority_still_switches_once()
    {
        _audio.Add("buds").Add("speaker", ConnectionType.BuiltIn, DeviceKind.Speakers);
        _audio.SetDefaultSilently("speaker");
        var c = Start(SwitchMode.Off, "buds", "speaker");

        c.RestorePriority();

        Assert.Equal("buds", _audio.Console);
    }

    [Fact]
    public void Switching_unavailable_never_attempts_switch()
    {
        _audio.CanSwitch = false;
        _audio.Add("buds").Add("speaker", ConnectionType.BuiltIn, DeviceKind.Speakers);
        _audio.SetDefaultSilently("speaker");
        var c = Start(SwitchMode.Strict, "buds", "speaker");

        Assert.Equal(0, _audio.SwitchCalls);
        Assert.False(_svc.Snapshot().CanSwitch);
    }
}
