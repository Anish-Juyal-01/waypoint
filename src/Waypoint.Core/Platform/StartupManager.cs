using System.Diagnostics;
using System.Security;
using System.Security.Principal;
using System.Xml.Linq;
using Microsoft.Win32;

namespace Waypoint.Core.Platform;

/// <summary>
/// "Start with Windows" as a per-user Task Scheduler task with a sign-in trigger (no admin rights needed).
///
/// Earlier versions used HKCU\...\CurrentVersion\Run. Explorer only launches Run entries it already knows from its
/// startup-app inventory (the list Task Manager shows), which Windows rebuilds only occasionally, so a new or renamed
/// entry can be skipped at sign-in for days. A sign-in task runs reliably. Any old Run entry for this app is removed
/// when the task is created, so the app is never launched twice.
/// </summary>
public sealed class StartupManager(string name = "Waypoint") : Waypoint.Core.Engine.IStartupRegistration
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ApprovedKey = @"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
    private static readonly XNamespace TaskNs = "http://schemas.microsoft.com/windows/2004/02/mit/task";
    public const string MinimizedArg = "--minimized";

    /// <summary>The Run value the app used when it was called EchoLock.</summary>
    public const string LegacyValueName = "EchoLock";

    public static string ExecutablePath => Environment.ProcessPath ?? throw new InvalidOperationException("Unknown process path.");

    /// <summary>True when the sign-in task exists, is enabled, and starts this executable.</summary>
    public bool IsEnabled => ReadTask() is { Enabled: true } task && SamePath(task.Command, ExecutablePath);

    /// <summary>The existing startup command when it points at a different executable (e.g. another copy), else null.</summary>
    public string? ForeignCommand =>
        ReadTask() is { } task && !SamePath(task.Command, ExecutablePath) ? task.Command
        : ReadRunCommand() is { } run && !SamePath(ExtractExecutable(run), ExecutablePath) ? run
        : null;

    public void SetEnabled(bool enabled)
    {
        if (enabled)
        {
            CreateTask(ExecutablePath);
            RemoveRunEntry(name);
        }
        else
        {
            ForgetTask();
            if (ReadTask() is not null) Schtasks("/Delete", "/TN", name, "/F");
            RemoveRunEntry(name);
        }

        ForgetTask();
    }

    /// <summary>
    /// Upgrades older registrations. A Run entry (from 1.1.x, or named "EchoLock" from before the rename) that starts
    /// this executable or one that no longer exists becomes a sign-in task for this executable; entries that start a
    /// different program that still exists are left alone. Returns true when something was migrated.
    /// </summary>
    public bool MigrateLegacyEntry()
    {
        bool wanted = false;
        foreach (var value in new[] { name, LegacyValueName })
        {
            if (ReadRunCommand(value) is not { } command) continue;
            var exe = ExtractExecutable(command);
            if (exe is not null && File.Exists(exe) && !SamePath(exe, ExecutablePath)) continue;
            RemoveRunEntry(value);
            wanted = true;
        }

        if (wanted && ReadTask() is null) CreateTask(ExecutablePath);
        ForgetTask();
        return wanted;
    }

    // ── Task Scheduler ─────────────────────────────────────────

    internal sealed record TaskInfo(string? Command, bool Enabled);

    // The settings view reads this on every state update, so the lookup is cached briefly (changes made here
    // invalidate it immediately; changes made in Task Scheduler itself show up within the cache window).
    private static readonly TimeSpan TaskCacheFor = TimeSpan.FromSeconds(30);
    private TaskInfo? _task;
    private DateTime _taskReadAt = DateTime.MinValue;

    private TaskInfo? ReadTask()
    {
        if (DateTime.UtcNow - _taskReadAt < TaskCacheFor) return _task;
        var (code, output) = Schtasks("/Query", "/TN", name, "/XML");
        _task = code == 0 ? ParseTask(output) : null;
        _taskReadAt = DateTime.UtcNow;
        return _task;
    }

    private void ForgetTask() => _taskReadAt = DateTime.MinValue;

    private void CreateTask(string exe)
    {
        var file = Path.Combine(Path.GetTempPath(), $"waypoint-task-{Guid.NewGuid():N}.xml");
        try
        {
            File.WriteAllText(file, BuildTaskXml(WindowsIdentity.GetCurrent().Name, exe), System.Text.Encoding.Unicode);
            var (code, output) = Schtasks("/Create", "/TN", name, "/XML", file, "/F");
            if (code != 0) throw new InvalidOperationException($"Couldn't create the sign-in task: {output.Trim()}");
        }
        finally
        {
            try { File.Delete(file); } catch (IOException) { }
        }
    }

    /// <summary>Per-user sign-in task: runs only in the user's own session, normal priority, no time limit.</summary>
    internal static string BuildTaskXml(string user, string exe)
    {
        var u = SecurityElement.Escape(user);
        var x = SecurityElement.Escape(exe);
        return $"""
            <?xml version="1.0" encoding="UTF-16"?>
            <Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
              <RegistrationInfo>
                <Author>Waypoint</Author>
                <Description>Starts Waypoint in the notification area when you sign in. Turn it off in Waypoint → Settings → Start with Windows.</Description>
              </RegistrationInfo>
              <Triggers>
                <LogonTrigger><Enabled>true</Enabled><UserId>{u}</UserId></LogonTrigger>
              </Triggers>
              <Principals>
                <Principal id="Author"><UserId>{u}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal>
              </Principals>
              <Settings>
                <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
                <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
                <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
                <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
                <Priority>5</Priority>
                <Enabled>true</Enabled>
              </Settings>
              <Actions Context="Author">
                <Exec><Command>{x}</Command><Arguments>{MinimizedArg}</Arguments></Exec>
              </Actions>
            </Task>
            """;
    }

    internal static TaskInfo? ParseTask(string xml)
    {
        try
        {
            var doc = XDocument.Parse(xml);
            var command = doc.Descendants(TaskNs + "Exec").Elements(TaskNs + "Command").FirstOrDefault()?.Value.Trim().Trim('"');
            var enabled = doc.Root?.Element(TaskNs + "Settings")?.Element(TaskNs + "Enabled")?.Value;
            return new TaskInfo(command, !string.Equals(enabled, "false", StringComparison.OrdinalIgnoreCase));
        }
        catch (System.Xml.XmlException)
        {
            return null;
        }
    }

    private static (int Code, string Output) Schtasks(params string[] args)
    {
        var psi = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "schtasks.exe"))
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        foreach (var a in args) psi.ArgumentList.Add(a);
        using var p = Process.Start(psi)!;
        var stdout = p.StandardOutput.ReadToEndAsync();
        var stderr = p.StandardError.ReadToEndAsync();
        if (!p.WaitForExit(15_000))
        {
            try { p.Kill(); } catch (InvalidOperationException) { }
            return (-1, "schtasks timed out");
        }

        return (p.ExitCode, stdout.Result + stderr.Result);
    }

    // ── Legacy Run entries ─────────────────────────────────────

    private string? ReadRunCommand(string? value = null)
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKey);
        return key?.GetValue(value ?? name) as string;
    }

    private static void RemoveRunEntry(string value)
    {
        using (var key = Registry.CurrentUser.OpenSubKey(RunKey, writable: true))
        {
            if (key?.GetValue(value) is not null) key.DeleteValue(value);
        }

        using var approved = Registry.CurrentUser.OpenSubKey(ApprovedKey, writable: true);
        if (approved?.GetValue(value) is not null) approved.DeleteValue(value);
    }

    private static bool SamePath(string? a, string? b)
    {
        if (a is null || b is null) return false;
        try
        {
            return string.Equals(Path.GetFullPath(a), Path.GetFullPath(b), StringComparison.OrdinalIgnoreCase);
        }
        catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException)
        {
            return false;
        }
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
