using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Threading;
using Waypoint.App.Shell;
using Waypoint.Core.Audio;
using Waypoint.Core.Engine;
using Waypoint.Core.Persistence;

namespace Waypoint.App.Bridge;

/// <summary>
/// JSON message protocol between the React UI and the runtime. Messages are <c>{ "type": "...", ... }</c>.
/// See ui/src/bridge/protocol.ts for the TypeScript side of the contract.
/// </summary>
internal sealed class UiBridge
{
    private readonly MainWindow _window;
    private readonly WaypointRuntime _runtime;
    private readonly Dispatcher _dispatcher;
    private readonly Action _requestExit;

    private bool _uiReady;
    private bool _levelQueued;
    private float? _latestOutput;
    private float? _latestInput;

    public UiBridge(MainWindow window, WaypointRuntime runtime, Action requestExit)
    {
        _window = window;
        _runtime = runtime;
        _requestExit = requestExit;
        _dispatcher = window.Dispatcher;

        window.WebMessage += OnMessage;
        window.MaximizedChanged += max => Send(new { type = "window", maximized = max });

        runtime.StateChanged += s => OnUi(() => Send(new { type = "state", state = s }));
        runtime.ActivityAdded += e => OnUi(() => Send(new { type = "activityAdded", entry = e }));
        runtime.Switched += e => OnUi(() => Send(new
        {
            type = "switchResult",
            flow = FlowName(e.Flow),
            deviceId = e.DeviceId,
            name = e.DeviceName,
            verified = e.Result.Verified,
            message = e.Result.Message,
        }));
        runtime.Levels += OnLevels;
    }

    /// <summary>True while the window is visible; nothing is pushed to a hidden/suspended WebView.</summary>
    public bool Active { get; set; }

    /// <summary>UI asked to pause global hotkeys while it records a new combination.</summary>
    public event Action<bool>? HotkeyRecording;

    /// <summary>Pushes the complete current state (after the UI loads or the window is re-shown).</summary>
    public async Task SendFullStateAsync()
    {
        if (!_uiReady) return;
        var (snapshot, activity) = await _runtime.Query(c => (c.Snapshot(), c.Activity.ToArray()));
        Send(new
        {
            type = "hello",
            version = App.Version,
            maximized = _window.WindowState == WindowState.Maximized,
            state = snapshot,
            activity,
        });
    }

    private void OnLevels(float? output, float? input)
    {
        _latestOutput = output;
        _latestInput = input;
        if (_levelQueued) return;
        _levelQueued = true;
        _dispatcher.BeginInvoke(DispatcherPriority.Render, () =>
        {
            _levelQueued = false;
            Send(new { type = "level", output = Round(_latestOutput), input = Round(_latestInput) });
        });
    }

    private static double? Round(float? v) => v is { } f ? Math.Round(f, 3) : null;

    private void OnUi(Action action) => _dispatcher.BeginInvoke(action);

    private void Send(object message)
    {
        if (!_uiReady || !Active) return;
        _window.Post(JsonSerializer.Serialize(message, Json.Options));
    }

    private static string FlowName(AudioFlow flow) => flow == AudioFlow.Capture ? "input" : "output";

    private static AudioFlow ParseFlow(JsonElement m) =>
        m.TryGetProperty("flow", out var f) && f.GetString() == "input" ? AudioFlow.Capture : AudioFlow.Render;

    private static string Str(JsonElement m, string name) => m.GetProperty(name).GetString()!;

    private async void OnMessage(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var m = doc.RootElement;
            var type = m.GetProperty("type").GetString();
            var flow = ParseFlow(m);

            switch (type)
            {
                case "ready":
                    _uiReady = true;
                    await SendFullStateAsync();
                    break;

                // ── per-flow device management ──
                case "setMode":
                    var mode = JsonSerializer.Deserialize<SwitchMode>(m.GetProperty("mode").GetRawText(), Json.Options);
                    _runtime.Post(c => c.For(flow).SetMode(mode));
                    break;

                case "reorder":
                    var ids = m.GetProperty("ids").EnumerateArray().Select(x => x.GetString()!).ToList();
                    _runtime.Post(c => c.For(flow).Reorder(ids));
                    break;

                case "setExcluded":
                    var exId = Str(m, "id");
                    var excluded = m.GetProperty("excluded").GetBoolean();
                    _runtime.Post(c => c.For(flow).SetExcluded(exId, excluded));
                    break;

                case "selectDevice":
                    var selId = Str(m, "id");
                    _runtime.Post(c => c.For(flow).SelectDevice(selId));
                    break;

                case "restorePriority":
                    _runtime.Post(c => c.For(flow).RestorePriority());
                    break;

                case "resetPriorities":
                    _runtime.Post(c => c.For(flow).ResetPriorities());
                    break;

                // ── devices (shared) ──
                case "rename":
                    var renId = Str(m, "id");
                    var alias = m.TryGetProperty("alias", out var a) && a.ValueKind == JsonValueKind.String ? a.GetString() : null;
                    _runtime.Post(c => c.Rename(renId, alias));
                    break;

                case "micMonitor":
                    _runtime.SetMicMonitor(m.GetProperty("on").GetBoolean());
                    break;

                case "setVolume":
                    var volId = Str(m, "id");
                    var level = m.GetProperty("level").GetSingle();
                    _runtime.Post(c => c.SetVolume(volId, level));
                    break;

                case "setMute":
                    var muteId = Str(m, "id");
                    var muted = m.GetProperty("muted").GetBoolean();
                    _runtime.Post(c => c.SetMute(muteId, muted));
                    break;

                case "setSwitchVolume":
                    var svId = Str(m, "id");
                    float? svLevel = m.TryGetProperty("level", out var l) && l.ValueKind == JsonValueKind.Number ? l.GetSingle() : null;
                    _runtime.Post(c => c.SetSwitchVolume(svId, svLevel));
                    break;

                // ── profiles ──
                case "createProfile":
                    var newName = m.TryGetProperty("name", out var n) ? n.GetString() ?? "" : "";
                    _runtime.Post(c => c.CreateProfile(newName));
                    break;

                case "renameProfile":
                    var rpId = Str(m, "id");
                    var rpName = Str(m, "name");
                    _runtime.Post(c => c.RenameProfile(rpId, rpName));
                    break;

                case "releaseApp":
                    var relPid = m.GetProperty("pid").GetUInt32();
                    _runtime.Post(c => c.ReleaseApp(flow, relPid));
                    break;

                case "recheckApps":
                    _runtime.Post(c => c.RecheckApps(flow));
                    break;

                case "setProfilePal":
                    var ppId = Str(m, "id");
                    var pal = m.TryGetProperty("pal", out var palEl) && palEl.ValueKind == JsonValueKind.String ? palEl.GetString() : null;
                    _runtime.Post(c => c.SetProfilePal(ppId, pal));
                    break;

                case "deleteProfile":
                    var dpId = Str(m, "id");
                    _runtime.Post(c => c.DeleteProfile(dpId));
                    break;

                case "switchProfile":
                    var spId = Str(m, "id");
                    _runtime.Post(c => c.SwitchProfile(spId));
                    break;

                // ── hotkeys ──
                case "setHotkey":
                    var action = Str(m, "action");
                    HotkeyBinding? binding = m.TryGetProperty("binding", out var b) && b.ValueKind == JsonValueKind.Object
                        ? new HotkeyBinding(b.GetProperty("modifiers").GetInt32(), b.GetProperty("key").GetInt32())
                        : null;
                    _runtime.Post(c => c.SetHotkey(action, binding));
                    break;

                case "resetHotkeys":
                    _runtime.Post(c => c.ResetHotkeys());
                    break;

                case "hotkeyRecording":
                    HotkeyRecording?.Invoke(m.GetProperty("active").GetBoolean());
                    break;

                // ── app ──
                case "updateSettings":
                    var patch = JsonSerializer.Deserialize<SettingsPatch>(m.GetProperty("patch").GetRawText(), Json.Options)!;
                    _runtime.Post(c => c.UpdateSettings(patch));
                    break;

                case "clearLog":
                    _runtime.Post(c => c.ClearActivity());
                    Send(new { type = "activityCleared" });
                    break;

                case "exportLog":
                    await ExportLogAsync();
                    break;

                case "rescan":
                    _runtime.Post(c => c.Rescan());
                    break;

                case "openSettings":
                    var page = m.TryGetProperty("page", out var p) ? p.GetString() : "sound";
                    OpenSystemSettings(page);
                    break;

                case "openDataFolder":
                    Process.Start(new ProcessStartInfo(AppPaths.Default.DataDirectory) { UseShellExecute = true });
                    break;

                case "window":
                    HandleWindow(m.GetProperty("action").GetString(), m.TryGetProperty("edge", out var edge) ? edge.GetString() : null);
                    break;
            }
        }
        catch (Exception ex) when (ex is JsonException or KeyNotFoundException or InvalidOperationException or FormatException)
        {
            Debug.WriteLine($"Bad UI message: {ex.Message} :: {json}");
        }
    }

    private void HandleWindow(string? action, string? edge)
    {
        switch (action)
        {
            case "drag":
                _window.BeginDrag(edge ?? "caption");
                break;
            case "minimize":
                _window.WindowState = WindowState.Minimized;
                break;
            case "maximize":
                _window.ToggleMaximize();
                break;
            case "close":
                _window.Close(); // App decides between hide-to-tray and exit
                break;
            case "quit":
                _requestExit();
                break;
        }
    }

    private async Task ExportLogAsync()
    {
        var text = await _runtime.Query(c => c.ExportActivity());
        var dialog = new Microsoft.Win32.SaveFileDialog
        {
            FileName = $"Waypoint-activity-{DateTime.Now:yyyyMMdd-HHmm}.txt",
            Filter = "Text file (*.txt)|*.txt",
            DefaultExt = ".txt",
        };

        if (dialog.ShowDialog(_window) != true) return;
        try
        {
            await File.WriteAllTextAsync(dialog.FileName, text);
            Send(new { type = "notice", tone = "success", text = $"Activity exported to {Path.GetFileName(dialog.FileName)}" });
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            Send(new { type = "notice", tone = "error", text = $"Export failed: {ex.Message}" });
        }
    }

    private static void OpenSystemSettings(string? page)
    {
        var uri = page switch
        {
            "bluetooth" => "ms-settings:bluetooth",
            "volume" => "ms-settings:apps-volume",
            _ => "ms-settings:sound",
        };
        Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true });
    }
}
