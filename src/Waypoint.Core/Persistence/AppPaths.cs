namespace Waypoint.Core.Persistence;

/// <summary>Locations of Waypoint's on-disk state. Overridable for tests.</summary>
public sealed class AppPaths
{
    /// <summary>The app was called EchoLock before; its data folder is moved over on first run.</summary>
    public const string LegacyFolderName = "EchoLock";

    public AppPaths(string dataDirectory)
    {
        DataDirectory = dataDirectory;
        Directory.CreateDirectory(dataDirectory);
    }

    /// <summary>%APPDATA%\Waypoint (migrated from %APPDATA%\EchoLock if needed).</summary>
    public static AppPaths Default { get; } = CreateDefault();

    public string DataDirectory { get; }
    public string SettingsFile => Path.Combine(DataDirectory, "settings.json");
    public string ActivityFile => Path.Combine(DataDirectory, "activity.jsonl");

    /// <summary>Set when this run moved data from the legacy folder.</summary>
    public static string? MigratedFrom { get; private set; }

    private static AppPaths CreateDefault()
    {
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var target = Path.Combine(appData, "Waypoint");
        MigratedFrom = MigrateLegacy(Path.Combine(appData, LegacyFolderName), target);
        return new AppPaths(target);
    }

    /// <summary>
    /// Moves the old data folder to the new location when only the old one exists. Never overwrites existing data;
    /// falls back to copying if the folder can't be moved (e.g. a file is open). Returns the source when it migrated.
    /// </summary>
    internal static string? MigrateLegacy(string legacy, string target)
    {
        if (!Directory.Exists(legacy)) return null;
        if (Directory.Exists(target) && File.Exists(Path.Combine(target, "settings.json"))) return null;

        try
        {
            if (!Directory.Exists(target))
            {
                Directory.Move(legacy, target);
                return legacy;
            }
        }
        catch (IOException)
        {
            // fall through to copy
        }
        catch (UnauthorizedAccessException)
        {
        }

        try
        {
            Directory.CreateDirectory(target);
            foreach (var file in Directory.GetFiles(legacy))
            {
                var dest = Path.Combine(target, Path.GetFileName(file));
                if (!File.Exists(dest)) File.Copy(file, dest);
            }

            return legacy;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }
}
