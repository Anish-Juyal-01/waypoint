using Microsoft.Win32;

namespace Waypoint.Core.Platform;

/// <summary>
/// Per-user "start with Windows" via HKCU\Software\Microsoft\Windows\CurrentVersion\Run, plus Windows' own on/off
/// switch for that entry (Explorer\StartupApproved\Run — what Task Manager and Settings → Apps → Startup toggle).
/// Explorer skips a Run entry that switch marks disabled, and on current Windows 11 builds also one that has no
/// approval record at all, so both are written together.
/// </summary>
public sealed class StartupManager(string valueName = "Waypoint") : Waypoint.Core.Engine.IStartupRegistration
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ApprovedKey = @"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
    public const string MinimizedArg = "--minimized";

    /// <summary>The Run value the app used when it was called EchoLock.</summary>
    public const string LegacyValueName = "EchoLock";

    /// <summary>Approval record meaning "enabled": 0x02 followed by an empty timestamp (as Task Manager writes it).</summary>
    private static readonly byte[] Approved = [0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

    public static string ExecutablePath => Environment.ProcessPath ?? throw new InvalidOperationException("Unknown process path.");

    /// <summary>True only when the Run entry points at this executable and Windows hasn't switched it off.</summary>
    public bool IsEnabled => PointsHere && !DisabledByWindows;

    private bool PointsHere => ReadCommand() is { } command && command.Contains(ExecutablePath, StringComparison.OrdinalIgnoreCase);

    /// <summary>Windows' startup switch for the entry is off (Task Manager / Settings), or was never approved.</summary>
    public bool DisabledByWindows => !IsApproved(ReadApproval(valueName));

    public string? ForeignCommand => ReadCommand() is { } command && !PointsHere ? command : null;

    public string? ReadCommand()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKey);
        return key?.GetValue(valueName) as string;
    }

    public void SetEnabled(bool enabled)
    {
        using var key = Registry.CurrentUser.CreateSubKey(RunKey, writable: true);
        using var approved = Registry.CurrentUser.CreateSubKey(ApprovedKey, writable: true);
        if (enabled)
        {
            key.SetValue(valueName, $"\"{ExecutablePath}\" {MinimizedArg}");
            approved.SetValue(valueName, Approved, RegistryValueKind.Binary);
        }
        else
        {
            if (key.GetValue(valueName) is not null) key.DeleteValue(valueName);
            if (approved.GetValue(valueName) is not null) approved.DeleteValue(valueName);
        }
    }

    /// <summary>
    /// After the rename: if the old "EchoLock" startup entry points at an executable that no longer exists (the
    /// pre-rename build), replace it with a "Waypoint" entry for this executable. Entries that point at a program
    /// that still exists are someone else's and are left untouched. Windows' on/off record for the old name is carried
    /// over to the new one, so a choice made in Task Manager survives. Returns true when it migrated.
    /// </summary>
    public bool MigrateLegacyEntry()
    {
        bool migrated = false;
        using (var key = Registry.CurrentUser.OpenSubKey(RunKey, writable: true))
        {
            if (key?.GetValue(LegacyValueName) is string legacy)
            {
                var exe = ExtractExecutable(legacy);
                if (exe is null || File.Exists(exe)) return false;
                key.DeleteValue(LegacyValueName);
                if (key.GetValue(valueName) is null) key.SetValue(valueName, $"\"{ExecutablePath}\" {MinimizedArg}");
                migrated = true;
            }
            else if (key?.GetValue(LegacyValueName) is not null)
            {
                return false;
            }
        }

        // The old Run value is gone (just now or by an earlier version): move its approval record across.
        using var approved = Registry.CurrentUser.OpenSubKey(ApprovedKey, writable: true);
        if (approved?.GetValue(LegacyValueName) is byte[] record)
        {
            if (approved.GetValue(valueName) is null) approved.SetValue(valueName, record, RegistryValueKind.Binary);
            approved.DeleteValue(LegacyValueName);
            migrated = true;
        }

        return migrated;
    }

    private byte[]? ReadApproval(string name)
    {
        using var key = Registry.CurrentUser.OpenSubKey(ApprovedKey);
        return key?.GetValue(name) as byte[];
    }

    /// <summary>The first byte is even (0x02, 0x06) when enabled and odd (0x03, 0x07) when switched off.</summary>
    internal static bool IsApproved(byte[]? record) => record is { Length: > 0 } && record[0] % 2 == 0;

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
