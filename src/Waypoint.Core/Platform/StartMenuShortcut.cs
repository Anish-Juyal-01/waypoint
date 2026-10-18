using System.Runtime.InteropServices;

namespace Waypoint.Core.Platform;

/// <summary>
/// A per-user Start menu shortcut (…\Start Menu\Programs\Waypoint.lnk) so Windows search finds the portable exe.
/// Created through the WScript.Shell COM object; no admin rights needed.
/// </summary>
public sealed class StartMenuShortcut(string name = "Waypoint", string? executablePath = null, string? programsFolder = null)
    : Waypoint.Core.Engine.IShortcutRegistration
{
    public string ExecutablePath => executablePath ?? Environment.ProcessPath ?? throw new InvalidOperationException("Unknown process path.");

    public string ShortcutPath =>
        Path.Combine(programsFolder ?? Environment.GetFolderPath(Environment.SpecialFolder.Programs), name + ".lnk");

    public bool Exists => File.Exists(ShortcutPath);

    public void SetEnabled(bool enabled)
    {
        if (enabled) Create();
        else if (Exists) File.Delete(ShortcutPath);
    }

    /// <summary>
    /// Creates the shortcut if it's missing, or repoints it if the program it opens no longer exists. A shortcut that
    /// opens another copy of Waypoint that still exists is left alone (turning the setting on in that copy replaces it).
    /// </summary>
    public void EnsurePresent()
    {
        if (!Exists || ReadTarget() is not { } target || !File.Exists(target)) Create();
    }

    public string? ReadTarget()
    {
        if (!Exists) return null;
        return WithShell(shell =>
        {
            dynamic link = shell.CreateShortcut(ShortcutPath);
            try { return (string)link.TargetPath; }
            finally { Marshal.FinalReleaseComObject(link); }
        });
    }

    private void Create()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(ShortcutPath)!);
        var exe = ExecutablePath;
        WithShell<object?>(shell =>
        {
            dynamic link = shell.CreateShortcut(ShortcutPath);
            try
            {
                link.TargetPath = exe;
                link.WorkingDirectory = Path.GetDirectoryName(exe);
                link.IconLocation = exe + ",0";
                link.Description = "Audio priority manager for Windows";
                link.Save();
            }
            finally
            {
                Marshal.FinalReleaseComObject(link);
            }

            return null;
        });
    }

    private static T WithShell<T>(Func<dynamic, T> action)
    {
        var type = Type.GetTypeFromProgID("WScript.Shell") ?? throw new InvalidOperationException("Windows Script Host isn't available.");
        dynamic shell = Activator.CreateInstance(type)!;
        try
        {
            return action(shell);
        }
        finally
        {
            Marshal.FinalReleaseComObject(shell);
        }
    }
}
