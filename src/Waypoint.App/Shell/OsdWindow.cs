using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Threading;
using Waypoint.Core.Engine;

namespace Waypoint.App.Shell;

/// <summary>
/// Small click-through on-screen indicator (like the Windows volume flyout) shown above the taskbar when a
/// hotkey fires or Waypoint switches devices while its window isn't in front. Never takes focus.
/// </summary>
internal sealed partial class OsdWindow : Window
{
    private readonly TextBlock _glyph;
    private readonly TextBlock _title;
    private readonly TextBlock _subtitle;
    private readonly Border _badge;
    private readonly TranslateTransform _offset = new();
    private readonly DispatcherTimer _hideTimer = new() { Interval = TimeSpan.FromMilliseconds(1700) };

    public OsdWindow()
    {
        WindowStyle = WindowStyle.None;
        AllowsTransparency = true;
        Background = Brushes.Transparent;
        Topmost = true;
        ShowInTaskbar = false;
        ShowActivated = false;
        Focusable = false;
        ResizeMode = ResizeMode.NoResize;
        SizeToContent = SizeToContent.WidthAndHeight;
        Opacity = 0;

        _glyph = new TextBlock
        {
            FontFamily = new FontFamily("Segoe Fluent Icons, Segoe MDL2 Assets"),
            FontSize = 18,
            Foreground = new SolidColorBrush(Color.FromRgb(0x1A, 0x22, 0x66)),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        _badge = new Border
        {
            Width = 38,
            Height = 38,
            CornerRadius = new CornerRadius(9),
            Background = Lime,
            BorderBrush = Ink,
            BorderThickness = new Thickness(1.6),
            Child = _glyph,
        };

        _title = new TextBlock
        {
            FontFamily = new FontFamily("Segoe UI Variable Display, Segoe UI"), // the web fonts live inside WebView2
            FontSize = 15,
            FontWeight = FontWeights.Bold,
            Foreground = new SolidColorBrush(Color.FromRgb(0xFF, 0xE4, 0xEF)),
            TextTrimming = TextTrimming.CharacterEllipsis,
            MaxWidth = 300,
        };
        _subtitle = new TextBlock
        {
            FontFamily = new FontFamily("Segoe UI Variable Text, Segoe UI"),
            FontSize = 12,
            Foreground = new SolidColorBrush(Color.FromRgb(0xB8, 0x93, 0xA9)),
            Margin = new Thickness(0, 2, 0, 0),
            TextTrimming = TextTrimming.CharacterEllipsis,
            MaxWidth = 300,
        };

        var text = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(12, 0, 4, 0) };
        text.Children.Add(_title);
        text.Children.Add(_subtitle);

        var row = new StackPanel { Orientation = Orientation.Horizontal };
        row.Children.Add(_badge);
        row.Children.Add(text);

        Content = _card = new Border
        {
            Margin = new Thickness(12, 12, 12, 18), // room for the hard shadow
            Padding = new Thickness(10, 10, 18, 10),
            CornerRadius = new CornerRadius(14),
            Background = new SolidColorBrush(Color.FromRgb(0x29, 0x17, 0x2F)),
            BorderBrush = new SolidColorBrush(Color.FromRgb(0xFF, 0xE4, 0xEF)),
            BorderThickness = new Thickness(1.6),
            // Hard offset shadow (no blur) in pink, like a slightly misregistered riso plate.
            Effect = _shadow,
            Child = row,
            RenderTransform = _offset,
        };

        _hideTimer.Tick += (_, _) =>
        {
            _hideTimer.Stop();
            Animate(0, 8, TimeSpan.FromMilliseconds(220), hideWhenDone: true);
        };

        SourceInitialized += (_, _) =>
        {
            // Click-through, never activated, hidden from Alt+Tab.
            var hwnd = new WindowInteropHelper(this).Handle;
            var ex = GetWindowLongPtr(hwnd, GWL_EXSTYLE).ToInt64();
            SetWindowLongPtr(hwnd, GWL_EXSTYLE, new IntPtr(ex | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE));
        };
    }

    private readonly Border _card;

    /// <summary>Light: cream paper with blue ink. Dark: plum paper with pink-white ink. Shadow stays pink.</summary>
    public void ApplyTheme(bool light)
    {
        _card.Background = new SolidColorBrush(light ? Color.FromRgb(0xFD, 0xF9, 0xF1) : Color.FromRgb(0x29, 0x17, 0x2F));
        _card.BorderBrush = new SolidColorBrush(light ? Color.FromRgb(0x1F, 0x2A, 0x78) : Color.FromRgb(0xFF, 0xE4, 0xEF));
        _title.Foreground = new SolidColorBrush(light ? Color.FromRgb(0x1F, 0x2A, 0x78) : Color.FromRgb(0xFF, 0xE4, 0xEF));
        _subtitle.Foreground = new SolidColorBrush(light ? Color.FromRgb(0x5D, 0x65, 0x99) : Color.FromRgb(0xB8, 0x93, 0xA9));
    }

    public void ShowMessage(OsdMessage message)
    {
        _glyph.Text = message.Glyph;
        _title.Text = message.Title;
        _subtitle.Text = message.Subtitle;
        _subtitle.Visibility = string.IsNullOrEmpty(message.Subtitle) ? Visibility.Collapsed : Visibility.Visible;
        _badge.Background = message.IsError ? Coral : Lime;
        _shadow.Color = message.IsError ? Coral.Color : Lime.Color;

        bool wasVisible = IsVisible && Opacity > 0.5;
        if (!IsVisible) Show();
        UpdateLayout();
        PlaceAboveTaskbar();
        if (!wasVisible) Animate(1, 0, TimeSpan.FromMilliseconds(260), hideWhenDone: false, from: (0, 12));

        _hideTimer.Stop();
        _hideTimer.Start();
    }

    private static readonly SolidColorBrush Lime = new(Color.FromRgb(0xFF, 0x4F, 0x9A)); // riso pink
    private static readonly SolidColorBrush Coral = new(Color.FromRgb(0xFF, 0x74, 0x40));
    private static readonly SolidColorBrush Ink = new(Color.FromRgb(0x1A, 0x22, 0x66));

    private readonly System.Windows.Media.Effects.DropShadowEffect _shadow = new()
    {
        BlurRadius = 0,
        ShadowDepth = 5,
        Direction = 310,
        Opacity = 1,
        Color = Color.FromRgb(0xFF, 0x4F, 0x9A),
    };

    private void PlaceAboveTaskbar()
    {
        // Monitor under the mouse — that's where the user is looking.
        var cursor = System.Windows.Forms.Cursor.Position;
        var screen = System.Windows.Forms.Screen.FromPoint(cursor).WorkingArea;
        var dpi = VisualTreeHelper.GetDpi(this);
        double left = screen.Left / dpi.DpiScaleX + (screen.Width / dpi.DpiScaleX - ActualWidth) / 2;
        double top = screen.Bottom / dpi.DpiScaleY - ActualHeight - 24;
        Left = left;
        Top = top;
    }

    private void Animate(double opacity, double y, TimeSpan duration, bool hideWhenDone, (double Opacity, double Y)? from = null)
    {
        var ease = new CubicEase { EasingMode = EasingMode.EaseOut };
        var fade = new DoubleAnimation(opacity, duration) { EasingFunction = ease };
        if (from is { } f) fade.From = f.Opacity;
        if (hideWhenDone) fade.Completed += (_, _) => { if (Opacity < 0.05) Hide(); };
        var slide = new DoubleAnimation(y, duration) { EasingFunction = ease };
        if (from is { } g) slide.From = g.Y;
        BeginAnimation(OpacityProperty, fade);
        _offset.BeginAnimation(TranslateTransform.YProperty, slide);
    }

    private const int GWL_EXSTYLE = -20;
    private const long WS_EX_TRANSPARENT = 0x20;
    private const long WS_EX_TOOLWINDOW = 0x80;
    private const long WS_EX_NOACTIVATE = 0x08000000;

    [LibraryImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    private static partial IntPtr GetWindowLongPtr(IntPtr hWnd, int index);

    [LibraryImport("user32.dll", EntryPoint = "SetWindowLongPtrW")]
    private static partial IntPtr SetWindowLongPtr(IntPtr hWnd, int index, IntPtr value);
}
