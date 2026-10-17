using Microsoft.Win32;

namespace Waypoint.Core.Platform;

/// <summary>Per-user "start with Windows" via HKCU\Software\Microsoft\Windows\CurrentVersion\Run.</summary>
public sealed class StartupManager(string valueName = "Waypoint") : Waypoint.Core.Engine.IStartupRegistration
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    public const string MinimizedArg = "--minimized";

    /// <summary>The Run value the app used when it was called EchoLock.</summary>
    public const string LegacyValueName = "EchoLock";

    public static string ExecutablePath => Environment.ProcessPath ?? throw new InvalidOperationException("Unknown process path.");

    /// <summary>True only when the Run entry exists and points at this executable.</summary>
    public bool IsEnabled => ReadCommand() is { } command && command.Contains(ExecutablePath, StringComparison.OrdinalIgnoreCase);

    public string? ForeignCommand => ReadCommand() is { } command && !IsEnabled ? command : null;

    public string? ReadCommand()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKey);
        return key?.GetValue(valueName) as string;
    }

    public void SetEnabled(bool enabled)
    {
        using var key = Registry.CurrentUser.CreateSubKey(RunKey, writable: true);
        if (enabled)
            key.SetValue(valueName, $"\"{ExecutablePath}\" {MinimizedArg}");
        else if (key.GetValue(valueName) is not null)
            key.DeleteValue(valueName);
    }

    /// <summary>
    /// After the rename: if the old "EchoLock" startup entry points at an executable that no longer exists (the
    /// pre-rename build), replace it with a "Waypoint" entry for this executable. Entries that point at a program
    /// that still exists are someone else's and are left untouched. Returns true when it migrated.
    /// </summary>
    public bool MigrateLegacyEntry()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKey, writable: true);
        if (key?.GetValue(LegacyValueName) is not string legacy) return false;
        var exe = ExtractExecutable(legacy);
        if (exe is null || File.Exists(exe)) return false;

        key.DeleteValue(LegacyValueName);
        if (key.GetValue(valueName) is null) key.SetValue(valueName, $"\"{ExecutablePath}\" {MinimizedArg}");
        return true;
    }

    internal static string? ExtractExecutable(string command)
    {
        command = command.Trim();
        if (command.StartsWith('"'))
        {
            var end = command.IndexOf('"', 1);
            return end > 1 ? command[1..end] : null;
        }

        var space = command.IndexOf(' ');
        return space > 0 ? command[..space] : command;
    }
}
