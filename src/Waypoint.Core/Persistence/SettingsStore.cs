using System.Text.Json;

namespace Waypoint.Core.Persistence;

/// <summary>Loads and atomically saves <see cref="AppSettings"/>.</summary>
public sealed class SettingsStore(AppPaths paths)
{
    /// <summary>Set when the settings file was unreadable and was moved aside.</summary>
    public string? RecoveredFromCorruption { get; private set; }

    public AppSettings Load()
    {
        var file = paths.SettingsFile;
        if (!File.Exists(file))
        {
            var fresh = new AppSettings();
            fresh.Normalize();
            return fresh;
        }

        try
        {
            var settings = JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(file), Json.Options) ?? new AppSettings();
            settings.Normalize();
            return settings;
        }
        catch (Exception ex) when (ex is JsonException or IOException or NotSupportedException)
        {
            // Keep the broken file for inspection and start fresh rather than crash at startup.
            var backup = file + $".corrupt-{DateTime.Now:yyyyMMddHHmmss}";
            try { File.Move(file, backup, overwrite: true); } catch (IOException) { }
            RecoveredFromCorruption = $"Settings file was unreadable ({ex.Message}); backed up to {Path.GetFileName(backup)}.";
            var fresh = new AppSettings();
            fresh.Normalize();
            return fresh;
        }
    }

    public void Save(AppSettings settings)
    {
        var file = paths.SettingsFile;
        settings.SyncActiveProfile();
        var temp = file + ".tmp";
        File.WriteAllText(temp, JsonSerializer.Serialize(settings, Json.Indented));
        File.Move(temp, file, overwrite: true); // atomic replace on NTFS
    }
}
