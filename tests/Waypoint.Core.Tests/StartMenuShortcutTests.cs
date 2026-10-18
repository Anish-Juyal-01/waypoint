using Waypoint.Core.Audio;
using Waypoint.Core.Engine;
using Waypoint.Core.Persistence;
using Waypoint.Core.Platform;

namespace Waypoint.Core.Tests;

/// <summary>Uses a temporary folder in place of the Start menu, and a fake executable.</summary>
public sealed class StartMenuShortcutTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "waypoint-shortcut-" + Guid.NewGuid().ToString("N"));
    private readonly string _programs;
    private readonly string _exe;

    public StartMenuShortcutTests()
    {
        _programs = Path.Combine(_dir, "Programs");
        _exe = Path.Combine(_dir, "App", "Waypoint.exe");
        Directory.CreateDirectory(Path.GetDirectoryName(_exe)!);
        File.WriteAllText(_exe, "");
    }

    public void Dispose()
    {
        try { Directory.Delete(_dir, true); } catch (IOException) { }
    }

    private StartMenuShortcut For(string exe) => new(executablePath: exe, programsFolder: _programs);

    [Fact]
    public void Creates_and_removes_a_shortcut_to_this_exe()
    {
        var shortcut = For(_exe);
        shortcut.SetEnabled(true);
        Assert.True(shortcut.Exists);
        Assert.Equal(_exe, shortcut.ReadTarget(), ignoreCase: true);

        shortcut.SetEnabled(false);
        Assert.False(shortcut.Exists);
    }

    [Fact]
    public void Repoints_a_shortcut_whose_program_is_gone()
    {
        var oldExe = Path.Combine(_dir, "Old", "Waypoint.exe");
        Directory.CreateDirectory(Path.GetDirectoryName(oldExe)!);
        File.WriteAllText(oldExe, "");
        For(oldExe).SetEnabled(true);
        File.Delete(oldExe);

        var shortcut = For(_exe);
        shortcut.EnsurePresent();
        Assert.Equal(_exe, shortcut.ReadTarget(), ignoreCase: true);
    }

    [Fact]
    public void Leaves_a_shortcut_to_another_existing_copy_alone()
    {
        var otherExe = Path.Combine(_dir, "Other", "Waypoint.exe");
        Directory.CreateDirectory(Path.GetDirectoryName(otherExe)!);
        File.WriteAllText(otherExe, "");
        For(otherExe).SetEnabled(true);

        For(_exe).EnsurePresent();
        Assert.Equal(otherExe, For(_exe).ReadTarget(), ignoreCase: true);
    }

    private sealed class FakeShortcut : IShortcutRegistration
    {
        public bool Exists { get; private set; }
        public int Ensured { get; private set; }
        public void EnsurePresent() { Ensured++; Exists = true; }
        public void SetEnabled(bool enabled) => Exists = enabled;
    }

    [Theory]
    [InlineData(true, 1)]
    [InlineData(false, 0)]
    public void Service_creates_the_shortcut_at_startup_only_when_wanted(bool wanted, int expected)
    {
        var fake = new FakeShortcut();
        var settings = new AppSettings { StartMenuShortcut = wanted };
        var svc = new WaypointService(new FakeAudioSystem(), settings, new ActivityLog(new AppPaths(_dir)), new ManualScheduler(), shortcut: fake);
        svc.Initialize();
        Assert.Equal(expected, fake.Ensured);
        Assert.Equal(wanted, svc.Snapshot().Settings.StartMenuShortcut);
    }

    [Fact]
    public void Turning_the_setting_off_removes_the_shortcut_and_is_remembered()
    {
        var fake = new FakeShortcut();
        var settings = new AppSettings();
        var svc = new WaypointService(new FakeAudioSystem(), settings, new ActivityLog(new AppPaths(_dir)), new ManualScheduler(), shortcut: fake);
        svc.Initialize();

        svc.UpdateSettings(new SettingsPatch { StartMenuShortcut = false });
        Assert.False(fake.Exists);
        Assert.False(settings.StartMenuShortcut);
        Assert.False(svc.Snapshot().Settings.StartMenuShortcut);
    }
}
