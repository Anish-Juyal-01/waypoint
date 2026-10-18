using Waypoint.Core.Audio;
using Waypoint.Core.Persistence;

namespace Waypoint.Core.Tests;

public sealed class PersistenceTests : IDisposable
{
    private readonly AppPaths _paths = new(Path.Combine(Path.GetTempPath(), "waypoint-tests-" + Guid.NewGuid().ToString("N")));

    public void Dispose()
    {
        try { Directory.Delete(_paths.DataDirectory, true); } catch (IOException) { }
    }

    [Fact]
    public void Settings_round_trip()
    {
        var store = new SettingsStore(_paths);
        var s = new AppSettings { SettleDelayMs = 2500 };
        s.Output.Mode = SwitchMode.Strict;
        s.Output.Priority = ["a", "b"];
        s.Output.Excluded = ["b"];
        s.Input.Priority = ["mic"];
        s.Devices["a"] = new DeviceMemory { Alias = "My buds", FirstSeen = DateTimeOffset.Now, SwitchVolume = 0.3f };
        s.Normalize();
        store.Save(s);

        var loaded = store.Load();
        Assert.Equal(SwitchMode.Strict, loaded.Output.Mode);
        Assert.Equal(["a", "b"], loaded.Output.Priority);
        Assert.Contains("b", loaded.Output.Excluded);
        Assert.Equal(["mic"], loaded.Input.Priority);
        Assert.Equal(0.3f, loaded.Devices["a"].SwitchVolume);
        Assert.Single(loaded.Profiles);
        Assert.Equal(["a", "b"], loaded.ActiveProfile!.Output.Priority);
        Assert.Equal("My buds", loaded.Devices["a"].Alias);
        Assert.Equal(2500, loaded.SettleDelayMs);
    }

    [Fact]
    public void Corrupt_settings_are_backed_up_and_defaults_used()
    {
        File.WriteAllText(_paths.SettingsFile, "{ not json");
        var store = new SettingsStore(_paths);

        var loaded = store.Load();

        Assert.Equal(SwitchMode.Balanced, loaded.Output.Mode);
        Assert.NotNull(store.RecoveredFromCorruption);
        Assert.Single(Directory.GetFiles(_paths.DataDirectory, "settings.json.corrupt-*"));
    }

    [Fact]
    public void Schema1_settings_are_migrated()
    {
        File.WriteAllText(_paths.SettingsFile, """{"schemaVersion":1,"mode":"strict","priority":["x","y"],"excluded":["y"],"settleDelayMs":900}""");

        var loaded = new SettingsStore(_paths).Load();

        Assert.Equal(SwitchMode.Strict, loaded.Output.Mode);
        Assert.Equal(["x", "y"], loaded.Output.Priority);
        Assert.Contains("y", loaded.Output.Excluded);
        Assert.Equal(SwitchMode.Off, loaded.Input.Mode);
        Assert.Null(loaded.Priority);
        Assert.Equal(AppSettings.CurrentSchema, loaded.SchemaVersion);
        Assert.Equal("Default", loaded.ActiveProfile!.Name);
        Assert.NotNull(loaded.Hotkeys[HotkeyActions.NextOutput]);
    }

    [Fact]
    public void Activity_log_persists_and_skips_torn_lines()
    {
        var log = new ActivityLog(_paths);
        log.Add(ActivityKind.Switched, "one");
        log.Add(ActivityKind.Connected, "two");
        File.AppendAllText(_paths.ActivityFile, "{\"broken\":");

        var reloaded = new ActivityLog(_paths);
        Assert.Equal(["one", "two"], reloaded.Entries.Select(e => e.Title));
        Assert.Equal(3, reloaded.Add(ActivityKind.Info, "three").Id);
    }

    [Fact]
    public void Activity_log_is_capped()
    {
        var log = new ActivityLog(_paths);
        for (int i = 0; i < ActivityLog.Capacity + 50; i++) log.Add(ActivityKind.Info, $"e{i}");
        Assert.Equal(ActivityLog.Capacity, log.Entries.Count);
        Assert.Equal("e50", log.Entries[0].Title);
    }
}

public sealed class ClassifierTests
{
    [Theory]
    [InlineData("BTHENUM", "{1}.BTHENUM\\{0000110B}", "Headphones (Airdopes 131)", 3, ConnectionType.Bluetooth)]
    [InlineData("BTHHFENUM", "{1}.BTHHFENUM\\BTHHFPAUDIO", "Headset (HBTS001 Hands-Free)", 5, ConnectionType.BluetoothHandsFree)]
    [InlineData("USB", "{1}.USB\\VID_1", "Speakers (USB Audio)", 1, ConnectionType.Usb)]
    [InlineData("HDAUDIO", "{1}.HDAUDIO\\FUNC_01", "Speaker (Realtek(R) Audio)", 1, ConnectionType.BuiltIn)]
    [InlineData("HDAUDIO", "{1}.HDAUDIO\\FUNC_01", "NVIDIA Output", 9, ConnectionType.Display)]
    [InlineData("ROOT", "{1}.ROOT\\MEDIA\\0000", "Dummy Output (Voicemod)", 2, ConnectionType.Virtual)]
    public void Classifies_connection(string enumerator, string ks, string name, int ff, ConnectionType expected) =>
        Assert.Equal(expected, EndpointClassifier.ClassifyConnection(enumerator, ks, name, ff));

    [Theory]
    [InlineData(3, "Headphones (OnePlus Nord Buds 3 Pro)", DeviceKind.Earbuds)]
    [InlineData(3, "Headphones (SH-525BT)", DeviceKind.Headphones)]
    [InlineData(1, "Speaker (Realtek(R) Audio)", DeviceKind.Speakers)]
    [InlineData(5, "Headset (Generic)", DeviceKind.Headset)]
    public void Classifies_kind(int ff, string name, DeviceKind expected) =>
        Assert.Equal(expected, EndpointClassifier.ClassifyKind(ff, name, "", ConnectionType.Bluetooth));
}

public sealed class RenameMigrationTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "waypoint-migrate-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        try { Directory.Delete(_root, true); } catch (IOException) { }
    }

    [Fact]
    public void Legacy_folder_moves_when_new_one_is_missing()
    {
        var legacy = Path.Combine(_root, "EchoLock");
        var target = Path.Combine(_root, "Waypoint");
        Directory.CreateDirectory(legacy);
        File.WriteAllText(Path.Combine(legacy, "settings.json"), "{\"x\":1}");

        Assert.Equal(legacy, AppPaths.MigrateLegacy(legacy, target));
        Assert.Equal("{\"x\":1}", File.ReadAllText(Path.Combine(target, "settings.json")));
        Assert.False(Directory.Exists(legacy));
    }

    [Fact]
    public void Existing_new_settings_are_never_overwritten()
    {
        var legacy = Path.Combine(_root, "EchoLock");
        var target = Path.Combine(_root, "Waypoint");
        Directory.CreateDirectory(legacy);
        Directory.CreateDirectory(target);
        File.WriteAllText(Path.Combine(legacy, "settings.json"), "old");
        File.WriteAllText(Path.Combine(target, "settings.json"), "new");

        Assert.Null(AppPaths.MigrateLegacy(legacy, target));
        Assert.Equal("new", File.ReadAllText(Path.Combine(target, "settings.json")));
    }

    [Theory]
    [InlineData(@"""C:\Apps\EchoLock.exe"" --minimized", @"C:\Apps\EchoLock.exe")]
    [InlineData(@"C:\Apps\EchoLock.exe --minimized", @"C:\Apps\EchoLock.exe")]
    [InlineData(@"C:\Apps\EchoLock.exe", @"C:\Apps\EchoLock.exe")]
    public void Run_command_executable_is_parsed(string command, string exe) =>
        Assert.Equal(exe, Waypoint.Core.Platform.StartupManager.ExtractExecutable(command));

    [Theory]
    [InlineData(new byte[] { 0x02, 0, 0, 0 }, true)]
    [InlineData(new byte[] { 0x06, 0, 0, 0 }, true)]
    [InlineData(new byte[] { 0x03, 0, 0, 0 }, false)]
    [InlineData(new byte[] { 0x07, 0, 0, 0 }, false)]
    [InlineData(new byte[0], false)]
    public void Windows_startup_switch_is_read(byte[] record, bool approved) =>
        Assert.Equal(approved, Waypoint.Core.Platform.StartupManager.IsApproved(record));

    [Fact]
    public void Missing_startup_approval_counts_as_off() =>
        Assert.False(Waypoint.Core.Platform.StartupManager.IsApproved(null));
}
