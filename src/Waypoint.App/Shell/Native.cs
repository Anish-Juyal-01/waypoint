using System.Runtime.InteropServices;

namespace Waypoint.App.Shell;

internal static partial class Native
{
    public const int WM_NCLBUTTONDOWN = 0x00A1;
    public const int WM_GETMINMAXINFO = 0x0024;
    public const int WM_POWERBROADCAST = 0x0218;
    public const int PBT_APMRESUMEAUTOMATIC = 0x0012;

    public const int HTCAPTION = 2;

    public const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;
    public const int DWMWA_WINDOW_CORNER_PREFERENCE = 33;
    public const int DWMWA_BORDER_COLOR = 34;
    public const int DWMWCP_ROUND = 2;

    public const uint MONITOR_DEFAULTTONEAREST = 2;

    public static int HitTestFor(string? edge) => edge switch
    {
        "left" => 10,
        "right" => 11,
        "top" => 12,
        "top-left" => 13,
        "top-right" => 14,
        "bottom" => 15,
        "bottom-left" => 16,
        "bottom-right" => 17,
        _ => HTCAPTION,
    };

    [LibraryImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool ReleaseCapture();

    [LibraryImport("user32.dll", EntryPoint = "SendMessageW")]
    public static partial IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

    [LibraryImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool SetForegroundWindow(IntPtr hWnd);

    [LibraryImport("dwmapi.dll")]
    public static partial int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

    [LibraryImport("user32.dll")]
    public static partial IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);

    [LibraryImport("user32.dll", EntryPoint = "GetMonitorInfoW")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT
    {
        public int Left, Top, Right, Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT
    {
        public int X, Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MINMAXINFO
    {
        public POINT Reserved;
        public POINT MaxSize;
        public POINT MaxPosition;
        public POINT MinTrackSize;
        public POINT MaxTrackSize;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MONITORINFO
    {
        public int Size;
        public RECT Monitor;
        public RECT WorkArea;
        public uint Flags;
    }

    public static void ApplyFrame(IntPtr hwnd, bool light)
    {
        int dark = light ? 0 : 1;
        DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, ref dark, sizeof(int));
        int corner = DWMWCP_ROUND;
        DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, ref corner, sizeof(int));
        int border = light ? 0x00B3CBD9 : 0x00532E4B; // COLORREF 0x00BBGGRR → #D9CBB3 / #4B2E53
        DwmSetWindowAttribute(hwnd, DWMWA_BORDER_COLOR, ref border, sizeof(int));
    }

    /// <summary>Keeps a borderless window from covering the taskbar when maximized.</summary>
    public static void ConstrainMaximizedToWorkArea(IntPtr hwnd, IntPtr lParam, int minWidthPx, int minHeightPx)
    {
        var mmi = Marshal.PtrToStructure<MINMAXINFO>(lParam);
        var monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        if (monitor != IntPtr.Zero)
        {
            var info = new MONITORINFO { Size = Marshal.SizeOf<MONITORINFO>() };
            if (GetMonitorInfo(monitor, ref info))
            {
                mmi.MaxPosition.X = info.WorkArea.Left - info.Monitor.Left;
                mmi.MaxPosition.Y = info.WorkArea.Top - info.Monitor.Top;
                mmi.MaxSize.X = info.WorkArea.Right - info.WorkArea.Left;
                mmi.MaxSize.Y = info.WorkArea.Bottom - info.WorkArea.Top;
            }
        }

        mmi.MinTrackSize.X = minWidthPx;
        mmi.MinTrackSize.Y = minHeightPx;
        Marshal.StructureToPtr(mmi, lParam, true);
    }
}
