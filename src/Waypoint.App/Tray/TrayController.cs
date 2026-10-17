using System.Drawing;
using System.Windows.Forms;
using Waypoint.Core.Audio;
using Waypoint.Core.Engine;
using Waypoint.Core.Persistence;

namespace Waypoint.App.Tray;

/// <summary>Notification-area icon with a dark context menu: open, mode, quick device switch, restore, exit.</summary>
internal sealed class TrayController : IDisposable
{
    private readonly NotifyIcon _icon;
    private readonly ContextMenuStrip _menu;
    private readonly WaypointRuntime _runtime;
    private readonly Action _open;
    private readonly Action _exit;

    public TrayController(WaypointRuntime runtime, Icon icon, Action open, Action exit)
    {
        _runtime = runtime;
        _open = open;
        _exit = exit;

        _menu = new ContextMenuStrip
        {
            Renderer = new DarkMenuRenderer(),
            ShowImageMargin = false,
            ShowCheckMargin = true,
            Font = new Font("Segoe UI", 9.5f),
            Padding = new Padding(4),
        };
        _menu.Opening += (_, e) =>
        {
            Rebuild();
            e.Cancel = false;
        };

        _icon = new NotifyIcon
        {
            Icon = icon,
            Text = "Waypoint",
            ContextMenuStrip = _menu,
            Visible = true,
        };
        _icon.MouseClick += (_, e) =>
        {
            if (e.Button == MouseButtons.Left) _open();
        };
        _icon.BalloonTipClicked += (_, _) => _open();
    }

    public void Update(RuntimeSnapshot s)
    {
        var current = s.Output.Devices.FirstOrDefault(d => d.IsDefault)?.Name ?? "No output";
        var profile = s.Profiles.Count > 1 ? $" · {s.Profiles.FirstOrDefault(p => p.Id == s.ActiveProfileId)?.Name}" : "";
        var text = $"Waypoint · {Mode(s.Output.Mode)}{profile}\n{current}";
        _icon.Text = text.Length > 127 ? text[..127] : text; // NotifyIcon limit
    }

    /// <summary>Menu colours follow the app theme (applied the next time the menu opens).</summary>
    public void ApplyTheme(bool light) => DarkMenuRenderer.UsePalette(light);

    public void Notify(string title, string text, bool error)
    {
        _icon.ShowBalloonTip(3000, title, text, error ? ToolTipIcon.Warning : ToolTipIcon.None);
    }

    public void Dispose()
    {
        _icon.Visible = false;
        _icon.Dispose();
        _menu.Dispose();
    }

    private void Rebuild()
    {
        _menu.Items.Clear();
        var s = _runtime.LastSnapshot;

        var header = new ToolStripLabel("Waypoint") { Font = new Font("Segoe UI Semibold", 10f), ForeColor = DarkMenuRenderer.Text, Padding = new Padding(2, 4, 2, 2) };
        _menu.Items.Add(header);
        if (s is not null)
        {
            var current = s.Output.Devices.FirstOrDefault(d => d.IsDefault);
            _menu.Items.Add(new ToolStripLabel(current is null ? "No output device" : $"Playing on {current.Name}") { ForeColor = DarkMenuRenderer.Muted });
        }

        _menu.Items.Add(new ToolStripSeparator());
        _menu.Items.Add(Item("Open Waypoint", _open, bold: true));
        _menu.Items.Add(new ToolStripSeparator());

        if (s is not null)
        {
            if (s.Profiles.Count > 1)
            {
                var active = s.Profiles.FirstOrDefault(p => p.Id == s.ActiveProfileId);
                var profiles = new ToolStripMenuItem($"Profile: {active?.Name}");
                foreach (var p in s.Profiles)
                {
                    var id = p.Id;
                    profiles.DropDownItems.Add(new ToolStripMenuItem(p.Name, null, (_, _) => _runtime.Post(c => c.SwitchProfile(id))) { Checked = p.Id == s.ActiveProfileId });
                }

                StyleDropDown(profiles);
                _menu.Items.Add(profiles);
            }

            var modeMenu = new ToolStripMenuItem($"Mode: {Mode(s.Output.Mode)}");
            foreach (var m in Enum.GetValues<SwitchMode>())
            {
                var mode = m;
                modeMenu.DropDownItems.Add(new ToolStripMenuItem(Mode(m), null, (_, _) => _runtime.Post(c => c.Output.SetMode(mode))) { Checked = s.Output.Mode == m });
            }

            StyleDropDown(modeMenu);
            _menu.Items.Add(modeMenu);

            _menu.Items.Add(DeviceMenu("Switch output to", s.Output, s.CanSwitch, AudioFlow.Render));
            var micMenu = DeviceMenu("Microphone", s.Input, s.CanSwitch, AudioFlow.Capture);
            var mic = s.Input.Devices.FirstOrDefault(d => d.IsDefault);
            if (mic?.Volume is { } vol)
            {
                micMenu.DropDownItems.Add(new ToolStripSeparator());
                var micId = mic.Id;
                micMenu.DropDownItems.Add(new ToolStripMenuItem(vol.Muted ? "Unmute microphone" : "Mute microphone", null,
                    (_, _) => _runtime.Post(c => c.SetMute(micId, !vol.Muted))));
            }

            _menu.Items.Add(micMenu);

            var restore = Item("Restore priority", () => _runtime.Post(c => c.Output.RestorePriority()));
            restore.Enabled = s.CanSwitch;
            _menu.Items.Add(restore);
        }

        _menu.Items.Add(new ToolStripSeparator());
        _menu.Items.Add(Item("Quit Waypoint", _exit));
    }

    private ToolStripMenuItem DeviceMenu(string title, FlowSnapshot flow, bool canSwitch, AudioFlow kind)
    {
        var menu = new ToolStripMenuItem(title);
        var available = flow.Devices.Where(d => d.State == EndpointState.Active && !d.AutoExcluded).ToList();
        if (available.Count == 0)
            menu.DropDownItems.Add(new ToolStripMenuItem(kind == AudioFlow.Capture ? "No connected microphones" : "No connected devices") { Enabled = false });
        foreach (var d in available)
        {
            var id = d.Id;
            menu.DropDownItems.Add(new ToolStripMenuItem($"#{d.Rank}  {d.Name}", null, (_, _) => _runtime.Post(c => c.For(kind).SelectDevice(id)))
            {
                Checked = d.IsDefault,
                Enabled = canSwitch,
            });
        }

        StyleDropDown(menu);
        return menu;
    }

    private static ToolStripMenuItem Item(string text, Action onClick, bool bold = false)
    {
        var item = new ToolStripMenuItem(text, null, (_, _) => onClick());
        if (bold) item.Font = new Font("Segoe UI Semibold", 9.5f);
        return item;
    }

    private static void StyleDropDown(ToolStripMenuItem item)
    {
        if (item.DropDown is ToolStripDropDownMenu dd)
        {
            dd.ShowImageMargin = false;
            dd.ShowCheckMargin = true;
            dd.Renderer = new DarkMenuRenderer();
        }
    }

    private static string Mode(SwitchMode m) => m switch
    {
        SwitchMode.Off => "Off",
        SwitchMode.Balanced => "Balanced",
        _ => "Strict",
    };

    /// <summary>Dark palette matching the app's design tokens.</summary>
    private sealed class DarkMenuRenderer() : ToolStripProfessionalRenderer(new DarkColors())
    {
        public static Color Back = Color.FromArgb(0x29, 0x17, 0x2F);
        public static readonly Color Hover = Color.FromArgb(0xFF, 0x6F, 0xB5); // pink highlight, ink text (both themes)
        public static Color Border = Color.FromArgb(0xFF, 0xE4, 0xEF);
        public static Color Separator = Color.FromArgb(0x4B, 0x2E, 0x53);
        public static Color Text = Color.FromArgb(0xFF, 0xE4, 0xEF);
        public static Color Muted = Color.FromArgb(0xB8, 0x93, 0xA9);
        public static readonly Color Ink = Color.FromArgb(0x1A, 0x22, 0x66);
        public static Color Accent = Color.FromArgb(0xFF, 0x6F, 0xB5);

        public static void UsePalette(bool light)
        {
            Back = light ? Color.FromArgb(0xFD, 0xF9, 0xF1) : Color.FromArgb(0x29, 0x17, 0x2F);
            Border = light ? Color.FromArgb(0x1F, 0x2A, 0x78) : Color.FromArgb(0xFF, 0xE4, 0xEF);
            Separator = light ? Color.FromArgb(0xD9, 0xCB, 0xB3) : Color.FromArgb(0x4B, 0x2E, 0x53);
            Text = light ? Color.FromArgb(0x1F, 0x2A, 0x78) : Color.FromArgb(0xFF, 0xE4, 0xEF);
            Muted = light ? Color.FromArgb(0x5D, 0x65, 0x99) : Color.FromArgb(0xB8, 0x93, 0xA9);
            Accent = light ? Color.FromArgb(0xC8, 0x10, 0x5A) : Color.FromArgb(0xFF, 0x6F, 0xB5);
        }

        protected override void OnRenderItemText(ToolStripItemTextRenderEventArgs e)
        {
            if (e.Item is ToolStripMenuItem) e.TextColor = !e.Item.Enabled ? Muted : e.Item.Selected ? Ink : Text;
            base.OnRenderItemText(e);
        }

        protected override void OnRenderArrow(ToolStripArrowRenderEventArgs e)
        {
            e.ArrowColor = e.Item is { Selected: true } ? Ink : Muted;
            base.OnRenderArrow(e);
        }

        protected override void OnRenderItemCheck(ToolStripItemImageRenderEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            var r = e.ImageRectangle;
            var cx = r.Left + r.Width / 2f;
            var cy = r.Top + r.Height / 2f;
            // Square pixel marker, like the UI's status dots.
            using var brush = new SolidBrush(e.Item.Selected ? Ink : Accent);
            g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.None;
            g.FillRectangle(brush, (int)(cx - 3), (int)(cy - 3), 7, 7);
        }

        private sealed class DarkColors : ProfessionalColorTable
        {
            public override Color ToolStripDropDownBackground => Back;
            public override Color ImageMarginGradientBegin => Back;
            public override Color ImageMarginGradientMiddle => Back;
            public override Color ImageMarginGradientEnd => Back;
            public override Color MenuBorder => Border;
            public override Color MenuItemBorder => Hover;
            public override Color MenuItemSelected => Hover;
            public override Color MenuItemSelectedGradientBegin => Hover;
            public override Color MenuItemSelectedGradientEnd => Hover;
            public override Color MenuItemPressedGradientBegin => Hover;
            public override Color MenuItemPressedGradientEnd => Hover;
            public override Color SeparatorDark => Separator;
            public override Color SeparatorLight => Back;
            public override Color CheckBackground => Back;
            public override Color CheckSelectedBackground => Hover;
            public override Color CheckPressedBackground => Hover;
        }
    }
}
