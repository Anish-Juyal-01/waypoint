using System.ComponentModel;
using System.IO;
using System.Reflection;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Waypoint.App.Bridge;
using Waypoint.App.Shell;
using Waypoint.App.Tray;
using Waypoint.Core.Audio;
using Waypoint.Core.Engine;
using Waypoint.Core.Persistence;
using Waypoint.Core.Platform;

namespace Waypoint.App;

/// <summary>Composition root: single instance → runtime → tray → window (created lazily).</summary>
public partial class App : Application
{
    public static string Version { get; } =
        typeof(App).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion.Split('+')[0] ?? "1.0.0";

    private SingleInstance? _instance;
    private WaypointRuntime? _runtime;
    private TrayController? _tray;
    private MainWindow? _window;
    private UiBridge? _bridge;
    private System.Drawing.Icon? _trayIcon;
    private HotkeyManager? _hotkeys;
    private OsdWindow? _osd;
    private DateTime _lastHotkeyAt = DateTime.MinValue;
    private string _themePref = Themes.System;
    private bool? _lightApplied;
    private bool _exiting;
    private bool _toldAboutTray;

    public static ImageSource LoadIconImage()
    {
        using var stream = typeof(App).Assembly.GetManifestResourceStream("app.ico")!;
        var decoder = new IconBitmapDecoder(stream, BitmapCreateOptions.None, BitmapCacheOption.OnLoad);
        return decoder.Frames.OrderByDescending(f => f.PixelWidth).First();
    }

    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        DispatcherUnhandledException += (_, ex) =>
        {
            WriteCrashLog(ex.Exception);
            ex.Handled = true;
        };

        _instance = SingleInstance.TryAcquire(() => Dispatcher.BeginInvoke(() => _ = ShowWindowAsync()));
        if (_instance is null)
        {
            Shutdown();
            return;
        }

        var startup = new StartupManager();
        try
        {
            startup.MigrateLegacyEntry();
        }
        catch (Exception ex) when (ex is System.Security.SecurityException or UnauthorizedAccessException or IOException)
        {
            // Not fatal; the user can re-enable "Start with Windows" in Settings.
        }

        _runtime = new WaypointRuntime(() => new CoreAudioSystem(), AppPaths.Default, startup);
        _runtime.StateChanged += s => Dispatcher.BeginInvoke(() => OnState(s));
        _runtime.Switched += ev => Dispatcher.BeginInvoke(() => OnSwitched(ev));
        _runtime.Osd += m => Dispatcher.BeginInvoke(() => ShowOsd(m));
        _runtime.Start();

        try
        {
            await _runtime.Ready;
        }
        catch (Exception ex)
        {
            WriteCrashLog(ex);
            MessageBox.Show($"Waypoint couldn't access Windows audio devices.\n\n{ex.Message}", "Waypoint", MessageBoxButton.OK, MessageBoxImage.Error);
            QuitApp();
            return;
        }

        using (var iconStream = typeof(App).Assembly.GetManifestResourceStream("app.ico")!)
            _trayIcon = new System.Drawing.Icon(iconStream, System.Windows.Forms.SystemInformation.SmallIconSize);
        _tray = new TrayController(_runtime, _trayIcon, () => _ = ShowWindowAsync(), QuitApp);
        if (_runtime.LastSnapshot is { } snap) _tray.Update(snap);

        _window = new MainWindow();
        _bridge = new UiBridge(_window, _runtime, QuitApp);
        _window.Closing += OnWindowClosing;
        _window.StateChanged += (_, _) => _runtime.SetMeterEnabled(_window.IsVisible && _window.WindowState != WindowState.Minimized);
        _window.SystemResumed += () => _runtime.Post(c => c.Rescan());

        _hotkeys = new HotkeyManager();
        _hotkeys.Pressed += OnHotkey;
        _bridge.HotkeyRecording += recording =>
        {
            if (_hotkeys.Suspend(recording) is { } statuses) _runtime.Post(c => c.SetHotkeyStatuses(statuses));
        };
        if (_runtime.LastSnapshot is { } first) OnState(first);
        Microsoft.Win32.SystemEvents.UserPreferenceChanged += (_, args) =>
        {
            if (args.Category == Microsoft.Win32.UserPreferenceCategory.General) Dispatcher.BeginInvoke(ApplyTheme);
        };

        var settings = _runtime.LastSnapshot?.Settings;
        bool launchedAtLogin = e.Args.Contains(StartupManager.MinimizedArg, StringComparer.OrdinalIgnoreCase);
        bool startHidden = launchedAtLogin && settings is { StartMinimized: true, OnboardingDone: true };
        if (!startHidden) await ShowWindowAsync();
    }

    private async Task ShowWindowAsync()
    {
        if (_window is null || _bridge is null || _runtime is null || _exiting) return;

        _window.BringToFront();
        try
        {
            await _window.EnsureWebAsync();
        }
        catch (Exception ex)
        {
            WriteCrashLog(ex);
            return;
        }

        _window.Resume();
        _bridge.Active = true;
        _runtime.SetMeterEnabled(true);
        await _bridge.SendFullStateAsync();
    }

    private async void HideToTray()
    {
        if (_window is null || _bridge is null || _runtime is null) return;
        _bridge.Active = false;
        _runtime.SetMeterEnabled(false);
        _window.Hide();
        await _window.SuspendAsync(); // frees CPU while only the tray is visible

        if (!_toldAboutTray)
        {
            _toldAboutTray = true;
            _tray?.Notify("Waypoint is still running", "It keeps managing your audio from the notification area.", error: false);
        }
    }

    private void OnWindowClosing(object? sender, CancelEventArgs e)
    {
        if (_exiting) return;
        if (_runtime?.LastSnapshot?.Settings.CloseToTray ?? true)
        {
            e.Cancel = true;
            HideToTray();
        }
        else
        {
            e.Cancel = true;
            QuitApp();
        }
    }

    private void OnState(RuntimeSnapshot s)
    {
        _tray?.Update(s);
        _themePref = s.Settings.Theme;
        ApplyTheme();
        if (_hotkeys?.Apply(s.Hotkeys, s.Settings.HotkeysEnabled) is { } statuses)
            _runtime?.Post(c => c.SetHotkeyStatuses(statuses));
    }

    /// <summary>Resolves "system" from Windows' app theme and themes the native pieces (frame, OSD, tray).</summary>
    private void ApplyTheme()
    {
        bool light = _themePref switch
        {
            Themes.Light => true,
            Themes.Dark => false,
            _ => WindowsUsesLightTheme(),
        };
        if (_lightApplied == light) return;
        _lightApplied = light;
        _window?.ApplyTheme(light);
        _osd?.ApplyTheme(light);
        _tray?.ApplyTheme(light);
    }

    private static bool WindowsUsesLightTheme()
    {
        using var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
        return key?.GetValue("AppsUseLightTheme") is int v && v == 1;
    }

    private void OnHotkey(string action)
    {
        _lastHotkeyAt = DateTime.UtcNow;
        if (action == Core.Persistence.HotkeyActions.ShowWindow)
        {
            if (_window is { IsVisible: true, IsActive: true }) _window.Close(); // toggles: hide to tray
            else _ = ShowWindowAsync();
            return;
        }

        _runtime?.Post(c => c.ExecuteHotkey(action));
    }

    private void ShowOsd(OsdMessage message)
    {
        if (!(_runtime?.LastSnapshot?.Settings.ShowOsd ?? true)) return;
        if (_osd is null)
        {
            _osd = new OsdWindow();
            _osd.ApplyTheme(_lightApplied ?? false);
        }

        _osd.ShowMessage(message);
    }

    private void OnSwitched(SwitchEvent ev)
    {
        // Hotkey actions already show their own on-screen message.
        if (DateTime.UtcNow - _lastHotkeyAt < TimeSpan.FromSeconds(1.5)) return;

        var settings = _runtime?.LastSnapshot?.Settings;
        bool windowFocused = _window is { IsVisible: true, IsActive: true };
        if (settings is null || windowFocused) return;

        bool input = ev.Flow == AudioFlow.Capture;
        // Only report what was verified; failures are always worth surfacing.
        if (ev.Result.Verified)
        {
            if (settings.ShowOsd)
                ShowOsd(new OsdMessage(ev.DeviceName, input ? "Microphone switched by Waypoint" : "Switched by Waypoint", Glyphs.For(ev.Kind)));
            else if (settings.NotifyOnSwitch)
                _tray?.Notify(input ? $"Recording from {ev.DeviceName}" : $"Now playing on {ev.DeviceName}", "Switched by Waypoint", error: false);
        }
        else if (settings.NotifyOnSwitch || settings.ShowOsd)
        {
            _tray?.Notify($"Couldn't switch to {ev.DeviceName}", ev.Result.Message, error: true);
        }
    }

    private void QuitApp()
    {
        if (_exiting) return;
        _exiting = true;
        _hotkeys?.Dispose();
        _osd?.Close();
        _tray?.Dispose();
        _runtime?.Dispose();
        _trayIcon?.Dispose();
        _window?.Close();
        _instance?.Dispose();
        Shutdown();
    }

    private static void WriteCrashLog(Exception ex)
    {
        try
        {
            File.AppendAllText(Path.Combine(AppPaths.Default.DataDirectory, "error.log"), $"[{DateTime.Now:O}] {ex}{Environment.NewLine}");
        }
        catch (IOException)
        {
        }
    }
}
