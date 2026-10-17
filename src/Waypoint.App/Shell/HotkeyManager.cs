using System.Runtime.InteropServices;
using System.Windows.Interop;
using Waypoint.Core.Engine;
using Waypoint.Core.Persistence;

namespace Waypoint.App.Shell;

/// <summary>
/// System-wide shortcuts via RegisterHotKey on a hidden message-only window, so they work while Waypoint is
/// in the tray. Registration fails (and is reported as a conflict) when another program owns the combination.
/// Must be used on the UI thread.
/// </summary>
internal sealed partial class HotkeyManager : IDisposable
{
    private const int WM_HOTKEY = 0x0312;
    private const int MOD_NOREPEAT = 0x4000;
    private static readonly IntPtr HWND_MESSAGE = new(-3);

    private readonly HwndSource _source;
    private readonly Dictionary<int, string> _registered = [];
    private string _signature = "";
    private bool _suspended;
    private IReadOnlyDictionary<string, HotkeyBinding?> _bindings = new Dictionary<string, HotkeyBinding?>();
    private bool _enabled;

    public HotkeyManager()
    {
        _source = new HwndSource(new HwndSourceParameters("Waypoint.Hotkeys")
        {
            ParentWindow = HWND_MESSAGE,
            Width = 0,
            Height = 0,
            WindowStyle = 0,
        });
        _source.AddHook(WndProc);
    }

    public event Action<string>? Pressed;

    /// <summary>Applies bindings if they changed. Returns per-action status, or null when nothing changed.</summary>
    public Dictionary<string, HotkeyStatus>? Apply(IReadOnlyList<HotkeyView> hotkeys, bool enabled)
    {
        var signature = enabled + "|" + string.Join(";", hotkeys.Select(h => $"{h.Action}={h.Binding?.Modifiers}:{h.Binding?.Key}"));
        if (signature == _signature) return null;
        _signature = signature;
        _bindings = hotkeys.ToDictionary(h => h.Action, h => h.Binding);
        _enabled = enabled;
        return Register();
    }

    /// <summary>Temporarily releases every hotkey (while the user records a new combination in the UI).</summary>
    public Dictionary<string, HotkeyStatus>? Suspend(bool suspended)
    {
        if (_suspended == suspended) return null;
        _suspended = suspended;
        return Register();
    }

    public void Dispose()
    {
        UnregisterAll();
        _source.RemoveHook(WndProc);
        _source.Dispose();
    }

    private Dictionary<string, HotkeyStatus> Register()
    {
        UnregisterAll();
        var status = new Dictionary<string, HotkeyStatus>();
        int id = 1;
        foreach (var (action, binding) in _bindings)
        {
            if (binding is null)
            {
                status[action] = HotkeyStatus.Unbound;
                continue;
            }

            if (!_enabled || _suspended)
            {
                status[action] = HotkeyStatus.Disabled;
                continue;
            }

            if (RegisterHotKey(_source.Handle, id, (uint)(binding.Modifiers | MOD_NOREPEAT), (uint)binding.Key))
            {
                _registered[id] = action;
                status[action] = HotkeyStatus.Registered;
            }
            else
            {
                status[action] = HotkeyStatus.Conflict;
            }

            id++;
        }

        // While suspended the UI is recording, so report the real (enabled) state to avoid flicker.
        if (_suspended)
            foreach (var key in status.Keys.ToList())
                if (status[key] == HotkeyStatus.Disabled && _enabled) status[key] = HotkeyStatus.Registered;

        return status;
    }

    private void UnregisterAll()
    {
        foreach (var id in _registered.Keys) UnregisterHotKey(_source.Handle, id);
        _registered.Clear();
    }

    private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (msg == WM_HOTKEY && _registered.TryGetValue(wParam.ToInt32(), out var action))
        {
            handled = true;
            Pressed?.Invoke(action);
        }

        return IntPtr.Zero;
    }

    [LibraryImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool RegisterHotKey(IntPtr hWnd, int id, uint modifiers, uint vk);

    [LibraryImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool UnregisterHotKey(IntPtr hWnd, int id);
}
