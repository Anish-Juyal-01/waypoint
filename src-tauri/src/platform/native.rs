//! A thread with one hidden top-level window for the Windows integrations that need a message loop:
//!
//! * global hotkeys (RegisterHotKey), so they work while Waypoint is in the tray;
//! * resume from sleep (a broadcast only top-level windows receive);
//! * the on-screen indicator: a small click-through card above the taskbar, like the Windows volume flyout, shown
//!   when a hotkey fires or Waypoint switches devices while its window isn't in front. It is drawn with Direct2D into
//!   a layered window (a webview just for this would cost ~100 MB while the app sits in the tray).
//!
//! A port of the C# HotkeyManager and OsdWindow.

use std::cell::RefCell;
use std::collections::{BTreeMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use windows::core::{w, BOOL, HSTRING};
use windows_numerics::Vector2;
use windows::Win32::Foundation::*;
use windows::Win32::Graphics::Direct2D::Common::*;
use windows::Win32::Graphics::Direct2D::*;
use windows::Win32::Graphics::DirectWrite::*;
use windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_B8G8R8A8_UNORM;
use windows::Win32::Graphics::Gdi::*;
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
use windows::Win32::UI::Input::KeyboardAndMouse::{RegisterHotKey, UnregisterHotKey, HOT_KEY_MODIFIERS, MOD_NOREPEAT};
use windows::Win32::UI::WindowsAndMessaging::*;

use crate::engine::types::{HotkeyStatus, HotkeyView, OsdMessage};

const WM_COMMANDS: u32 = WM_APP + 1;
const ANIMATION_TIMER: usize = 1;
const FADE_IN_MS: f32 = 260.0;
const HOLD_MS: f32 = 1700.0;
const FADE_OUT_MS: f32 = 220.0;

pub enum Command {
    /// Applies hotkey bindings (re-registers only when they changed).
    Hotkeys { hotkeys: Vec<HotkeyView>, enabled: bool },
    /// Releases every hotkey while the UI records a new combination.
    SuspendHotkeys(bool),
    Osd { message: OsdMessage, light: bool },
}

pub struct Events {
    pub hotkey: Box<dyn Fn(&str) + Send>,
    pub hotkey_status: Box<dyn Fn(BTreeMap<String, HotkeyStatus>) + Send>,
    pub resumed: Box<dyn Fn() + Send>,
}

#[derive(Clone)]
pub struct Native {
    hwnd: isize,
    queue: Arc<Mutex<VecDeque<Command>>>,
}

impl Native {
    pub fn start(events: Events) -> Native {
        let queue: Arc<Mutex<VecDeque<Command>>> = Arc::default();
        let (tx, rx) = std::sync::mpsc::channel();
        let q = queue.clone();
        std::thread::Builder::new()
            .name("waypoint-native".into())
            .spawn(move || unsafe {
                let hwnd = create_window();
                STATE.with(|s| *s.borrow_mut() = Some(State::new(hwnd, events, q)));
                let _ = tx.send(hwnd.0 as isize);
                let mut msg = MSG::default();
                while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            })
            .expect("couldn't start the native thread");
        Native { hwnd: rx.recv().unwrap_or(0), queue }
    }

    pub fn send(&self, command: Command) {
        self.queue.lock().unwrap().push_back(command);
        unsafe {
            let _ = PostMessageW(Some(HWND(self.hwnd as *mut _)), WM_COMMANDS, WPARAM(0), LPARAM(0));
        }
    }
}

// ───────────────────────────── window thread state ─────────────────────────────

thread_local! {
    static STATE: RefCell<Option<State>> = const { RefCell::new(None) };
}

struct State {
    hwnd: HWND,
    events: Events,
    queue: Arc<Mutex<VecDeque<Command>>>,
    hotkeys: Hotkeys,
    osd: Option<Osd>,
}

impl State {
    fn new(hwnd: HWND, events: Events, queue: Arc<Mutex<VecDeque<Command>>>) -> Self {
        Self { hwnd, events, queue, hotkeys: Hotkeys::default(), osd: None }
    }

    fn drain(&mut self) {
        loop {
            let Some(cmd) = self.queue.lock().unwrap().pop_front() else { break };
            match cmd {
                Command::Hotkeys { hotkeys, enabled } => {
                    if let Some(status) = self.hotkeys.apply(self.hwnd, hotkeys, enabled) {
                        (self.events.hotkey_status)(status);
                    }
                }
                Command::SuspendHotkeys(on) => {
                    if let Some(status) = self.hotkeys.suspend(self.hwnd, on) {
                        (self.events.hotkey_status)(status);
                    }
                }
                Command::Osd { message, light } => {
                    if self.osd.is_none() {
                        self.osd = Osd::new().ok();
                    }
                    if let Some(osd) = self.osd.as_mut() {
                        osd.show(self.hwnd, &message, light);
                    }
                }
            }
        }
    }
}

unsafe fn create_window() -> HWND {
    let instance = GetModuleHandleW(None).unwrap_or_default();
    let class = w!("Waypoint.Native");
    let wc = WNDCLASSW { lpfnWndProc: Some(wndproc), hInstance: instance.into(), lpszClassName: class, ..Default::default() };
    RegisterClassW(&wc);
    // Layered (per-pixel alpha), click-through, never activated, hidden from Alt+Tab and the taskbar.
    CreateWindowExW(
        WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TOPMOST,
        class,
        w!("Waypoint"),
        WS_POPUP,
        0,
        0,
        0,
        0,
        None,
        None,
        Some(instance.into()),
        None,
    )
    .unwrap_or_default()
}

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    let handled = STATE.with(|s| {
        let Ok(mut guard) = s.try_borrow_mut() else { return false };
        let Some(state) = guard.as_mut() else { return false };
        match msg {
            WM_COMMANDS => state.drain(),
            WM_HOTKEY => {
                if let Some(action) = state.hotkeys.registered.get(&(wparam.0 as i32)) {
                    (state.events.hotkey)(action);
                }
            }
            WM_TIMER if wparam.0 == ANIMATION_TIMER => {
                if let Some(osd) = state.osd.as_mut() {
                    osd.tick(hwnd);
                    if !osd.visible {
                        // Shown a few times a day at most: free Direct2D/DirectWrite until the next one.
                        state.osd = None;
                        trim_working_set();
                    }
                }
            }
            WM_POWERBROADCAST if wparam.0 == PBT_APMRESUMEAUTOMATIC as usize => (state.events.resumed)(),
            _ => return false,
        }
        true
    });
    if handled {
        LRESULT(0)
    } else {
        DefWindowProcW(hwnd, msg, wparam, lparam)
    }
}

// ───────────────────────────── hotkeys ─────────────────────────────

#[derive(Default)]
struct Hotkeys {
    registered: BTreeMap<i32, String>,
    signature: String,
    bindings: Vec<HotkeyView>,
    enabled: bool,
    suspended: bool,
}

impl Hotkeys {
    fn apply(&mut self, hwnd: HWND, hotkeys: Vec<HotkeyView>, enabled: bool) -> Option<BTreeMap<String, HotkeyStatus>> {
        let signature = format!("{enabled}|{}", hotkeys.iter().map(|h| format!("{}={:?}", h.action, h.binding)).collect::<Vec<_>>().join(";"));
        if signature == self.signature {
            return None;
        }
        self.signature = signature;
        self.bindings = hotkeys;
        self.enabled = enabled;
        Some(self.register(hwnd))
    }

    fn suspend(&mut self, hwnd: HWND, suspended: bool) -> Option<BTreeMap<String, HotkeyStatus>> {
        if self.suspended == suspended {
            return None;
        }
        self.suspended = suspended;
        Some(self.register(hwnd))
    }

    fn register(&mut self, hwnd: HWND) -> BTreeMap<String, HotkeyStatus> {
        for id in self.registered.keys() {
            unsafe {
                let _ = UnregisterHotKey(Some(hwnd), *id);
            }
        }
        self.registered.clear();
        let mut status = BTreeMap::new();
        for (n, h) in self.bindings.iter().enumerate() {
            let id = n as i32 + 1;
            let s = match h.binding {
                None => HotkeyStatus::Unbound,
                // While suspended the UI is recording, so report the real (enabled) state to avoid flicker.
                Some(_) if self.suspended => {
                    if self.enabled {
                        HotkeyStatus::Registered
                    } else {
                        HotkeyStatus::Disabled
                    }
                }
                Some(_) if !self.enabled => HotkeyStatus::Disabled,
                Some(b) => {
                    let mods = HOT_KEY_MODIFIERS(b.modifiers as u32) | MOD_NOREPEAT;
                    if unsafe { RegisterHotKey(Some(hwnd), id, mods, b.key as u32) }.is_ok() {
                        self.registered.insert(id, h.action.clone());
                        HotkeyStatus::Registered
                    } else {
                        HotkeyStatus::Conflict // another program owns the combination
                    }
                }
            };
            status.insert(h.action.clone(), s);
        }
        status
    }
}

// ───────────────────────────── on-screen indicator ─────────────────────────────

fn rgb(hex: u32) -> D2D1_COLOR_F {
    D2D1_COLOR_F { r: ((hex >> 16) & 0xFF) as f32 / 255.0, g: ((hex >> 8) & 0xFF) as f32 / 255.0, b: (hex & 0xFF) as f32 / 255.0, a: 1.0 }
}

const PINK: u32 = 0xFF4F9A; // riso pink
const CORAL: u32 = 0xFF7440;
const INK: u32 = 0x1A2266;

struct Osd {
    d2d: ID2D1Factory,
    dwrite: IDWriteFactory,
    icon_font: &'static str,
    /// Rendered card: a 32-bit premultiplied DIB selected into `dc`.
    dc: HDC,
    bitmap: HBITMAP,
    size: SIZE,
    origin: POINT,
    shown_at: Instant,
    fading_in: bool,
    visible: bool,
    scale: f32,
}

impl Osd {
    fn new() -> windows::core::Result<Self> {
        unsafe {
            let d2d: ID2D1Factory = D2D1CreateFactory(D2D1_FACTORY_TYPE_SINGLE_THREADED, None)?;
            let dwrite: IDWriteFactory = DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED)?;
            let icon_font = if has_font(&dwrite, "Segoe Fluent Icons") { "Segoe Fluent Icons" } else { "Segoe MDL2 Assets" };
            Ok(Self {
                d2d,
                dwrite,
                icon_font,
                dc: CreateCompatibleDC(None),
                bitmap: HBITMAP::default(),
                size: SIZE::default(),
                origin: POINT::default(),
                shown_at: Instant::now(),
                fading_in: false,
                visible: false,
                scale: 1.0,
            })
        }
    }

    fn show(&mut self, hwnd: HWND, m: &OsdMessage, light: bool) {
        unsafe {
            // Monitor under the mouse — that's where the user is looking.
            let mut cursor = POINT::default();
            let _ = GetCursorPos(&mut cursor);
            let monitor = MonitorFromPoint(cursor, MONITOR_DEFAULTTONEAREST);
            let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
            let _ = GetMonitorInfoW(monitor, &mut info);
            let (mut dx, mut dy) = (96u32, 96u32);
            let _ = GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut dx, &mut dy);
            self.scale = dx as f32 / 96.0;

            if self.render(m, light).is_err() {
                return;
            }
            let work = info.rcWork;
            self.origin = POINT {
                x: work.left + ((work.right - work.left) - self.size.cx) / 2,
                y: work.bottom - self.size.cy - (24.0 * self.scale) as i32,
            };

            let was_visible = self.visible && self.opacity_offset().0 > 0.5;
            if !was_visible {
                self.fading_in = true;
            }
            self.shown_at = Instant::now();
            self.visible = true;
            self.present(hwnd);
            let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
            SetTimer(Some(hwnd), ANIMATION_TIMER, 16, None);
        }
    }

    /// Opacity and vertical offset (DIPs) for the current moment of the show → hold → fade-out cycle.
    fn opacity_offset(&self) -> (f32, f32) {
        let t = self.shown_at.elapsed().as_secs_f32() * 1000.0;
        let ease = |x: f32| 1.0 - (1.0 - x.clamp(0.0, 1.0)).powi(3);
        if self.fading_in && t < FADE_IN_MS {
            let k = ease(t / FADE_IN_MS);
            return (k, 12.0 * (1.0 - k));
        }
        if t < HOLD_MS {
            return (1.0, 0.0);
        }
        let k = ease((t - HOLD_MS) / FADE_OUT_MS);
        (1.0 - k, 8.0 * k)
    }

    fn tick(&mut self, hwnd: HWND) {
        let t = self.shown_at.elapsed().as_secs_f32() * 1000.0;
        if t >= HOLD_MS + FADE_OUT_MS {
            self.visible = false;
            self.fading_in = false;
            unsafe {
                let _ = KillTimer(Some(hwnd), ANIMATION_TIMER);
                let _ = ShowWindow(hwnd, SW_HIDE);
            }
            return;
        }
        if t >= FADE_IN_MS {
            self.fading_in = false;
        }
        self.present(hwnd);
    }

    fn present(&self, hwnd: HWND) {
        let (opacity, offset) = self.opacity_offset();
        let pos = POINT { x: self.origin.x, y: self.origin.y + (offset * self.scale) as i32 };
        let blend = BLENDFUNCTION { BlendOp: AC_SRC_OVER as u8, BlendFlags: 0, SourceConstantAlpha: (opacity * 255.0) as u8, AlphaFormat: AC_SRC_ALPHA as u8 };
        unsafe {
            let screen = GetDC(None);
            let _ = UpdateLayeredWindow(hwnd, Some(screen), Some(&pos), Some(&self.size), Some(self.dc), Some(&POINT::default()), COLORREF(0), Some(&blend), ULW_ALPHA);
            ReleaseDC(None, screen);
        }
    }

    fn text_layout(&self, text: &str, family: &str, size: f32, weight: DWRITE_FONT_WEIGHT, max_width: f32) -> windows::core::Result<IDWriteTextLayout> {
        unsafe {
            let format = self.dwrite.CreateTextFormat(&HSTRING::from(family), None, weight, DWRITE_FONT_STYLE_NORMAL, DWRITE_FONT_STRETCH_NORMAL, size, w!("en-us"))?;
            format.SetWordWrapping(DWRITE_WORD_WRAPPING_NO_WRAP)?;
            let sign = self.dwrite.CreateEllipsisTrimmingSign(&format)?;
            let trimming = DWRITE_TRIMMING { granularity: DWRITE_TRIMMING_GRANULARITY_CHARACTER, delimiter: 0, delimiterCount: 0 };
            format.SetTrimming(&trimming, &sign)?;
            let wide: Vec<u16> = text.encode_utf16().collect();
            self.dwrite.CreateTextLayout(&wide, &format, max_width, 100.0)
        }
    }

    /// Draws the card into the DIB. Light: cream paper with blue ink. Dark: plum paper with pink-white ink. The hard
    /// offset shadow is the badge colour, like a slightly misregistered riso plate.
    fn render(&mut self, m: &OsdMessage, light: bool) -> windows::core::Result<()> {
        let (paper, ink, muted) = if light { (0xFDF9F1, 0x1F2A78, 0x5D6599) } else { (0x29172F, 0xFFE4EF, 0xB893A9) };
        let accent = if m.is_error { CORAL } else { PINK };

        let title = self.text_layout(&m.title, "Segoe UI Variable Display", 15.0, DWRITE_FONT_WEIGHT_BOLD, 300.0)?;
        let subtitle = (!m.subtitle.is_empty()).then(|| self.text_layout(&m.subtitle, "Segoe UI Variable Text", 12.0, DWRITE_FONT_WEIGHT_NORMAL, 300.0)).transpose()?;
        let glyph = self.text_layout(&m.glyph, self.icon_font, 18.0, DWRITE_FONT_WEIGHT_NORMAL, 38.0)?;
        unsafe {
            let metrics = |l: &IDWriteTextLayout| -> windows::core::Result<DWRITE_TEXT_METRICS> {
                let mut m = DWRITE_TEXT_METRICS::default();
                l.GetMetrics(&mut m)?;
                Ok(m)
            };
            let tm = metrics(&title)?;
            let sm = subtitle.as_ref().map(metrics).transpose()?;
            let text_w = tm.widthIncludingTrailingWhitespace.min(300.0).max(sm.map_or(0.0, |s| s.widthIncludingTrailingWhitespace.min(300.0)));
            let text_h = tm.height + sm.map_or(0.0, |s| s.height + 2.0);

            // Layout in DIPs: margin (room for the shadow) → card → badge + text.
            let (ml, mt, mr, mb) = (12.0, 12.0, 12.0, 18.0);
            let card_w = 10.0 + 38.0 + 12.0 + text_w + 4.0 + 18.0;
            let card_h = 38f32.max(text_h) + 20.0;
            let (w, h) = (ml + card_w + mr, mt + card_h + mb);
            let px = |v: f32| (v * self.scale).ceil() as i32;
            self.size = SIZE { cx: px(w), cy: px(h) };

            // Fresh 32-bit top-down DIB for this size.
            let bmi = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: self.size.cx,
                    biHeight: -self.size.cy,
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };
            let mut bits = std::ptr::null_mut();
            let bitmap = CreateDIBSection(Some(self.dc), &bmi, DIB_RGB_COLORS, &mut bits, None, 0)?;
            SelectObject(self.dc, bitmap.into());
            if !self.bitmap.is_invalid() {
                let _ = DeleteObject(self.bitmap.into());
            }
            self.bitmap = bitmap;

            let props = D2D1_RENDER_TARGET_PROPERTIES {
                r#type: D2D1_RENDER_TARGET_TYPE_DEFAULT,
                pixelFormat: D2D1_PIXEL_FORMAT { format: DXGI_FORMAT_B8G8R8A8_UNORM, alphaMode: D2D1_ALPHA_MODE_PREMULTIPLIED },
                dpiX: 96.0 * self.scale,
                dpiY: 96.0 * self.scale,
                ..Default::default()
            };
            let rt = self.d2d.CreateDCRenderTarget(&props)?;
            rt.BindDC(self.dc, &RECT { left: 0, top: 0, right: self.size.cx, bottom: self.size.cy })?;
            rt.BeginDraw();
            rt.Clear(Some(&D2D1_COLOR_F::default()));

            let brush = |c: u32| rt.CreateSolidColorBrush(&rgb(c), None);
            let rounded = |x: f32, y: f32, w: f32, h: f32, r: f32| D2D1_ROUNDED_RECT { rect: D2D_RECT_F { left: x, top: y, right: x + w, bottom: y + h }, radiusX: r, radiusY: r };

            let card = rounded(ml, mt, card_w, card_h, 14.0);
            let shadow = rounded(ml + 3.2, mt + 3.8, card_w, card_h, 14.0);
            rt.FillRoundedRectangle(&shadow, &brush(accent)?);
            rt.FillRoundedRectangle(&card, &brush(paper)?);
            rt.DrawRoundedRectangle(&card, &brush(ink)?, 1.6, None);

            let (bx, by) = (ml + 10.0, mt + (card_h - 38.0) / 2.0);
            let badge = rounded(bx, by, 38.0, 38.0, 9.0);
            rt.FillRoundedRectangle(&badge, &brush(accent)?);
            rt.DrawRoundedRectangle(&badge, &brush(INK)?, 1.6, None);
            glyph.SetTextAlignment(DWRITE_TEXT_ALIGNMENT_CENTER)?;
            glyph.SetParagraphAlignment(DWRITE_PARAGRAPH_ALIGNMENT_CENTER)?;
            glyph.SetMaxHeight(38.0)?;
            rt.DrawTextLayout(Vector2 { X: bx, Y: by }, &glyph, &brush(INK)?, D2D1_DRAW_TEXT_OPTIONS_NONE);

            let tx = bx + 38.0 + 12.0;
            let ty = mt + (card_h - text_h) / 2.0;
            title.SetMaxWidth(text_w)?;
            rt.DrawTextLayout(Vector2 { X: tx, Y: ty }, &title, &brush(ink)?, D2D1_DRAW_TEXT_OPTIONS_NONE);
            if let Some(s) = &subtitle {
                s.SetMaxWidth(text_w)?;
                rt.DrawTextLayout(Vector2 { X: tx, Y: ty + tm.height + 2.0 }, s, &brush(muted)?, D2D1_DRAW_TEXT_OPTIONS_NONE);
            }
            rt.EndDraw(None, None)?;
        }
        Ok(())
    }
}

impl Drop for Osd {
    fn drop(&mut self) {
        unsafe {
            if !self.bitmap.is_invalid() {
                let _ = DeleteObject(self.bitmap.into());
            }
            let _ = DeleteDC(self.dc);
        }
    }
}

/// Returns pages this process isn't using to Windows (what Task Manager's Memory column shows), e.g. after the
/// window's webview was destroyed. They're paged back in on demand.
pub fn trim_working_set() {
    use windows::Win32::System::ProcessStatus::K32EmptyWorkingSet;
    use windows::Win32::System::Threading::GetCurrentProcess;
    unsafe {
        let _ = K32EmptyWorkingSet(GetCurrentProcess());
    }
}

fn has_font(dwrite: &IDWriteFactory, family: &str) -> bool {
    unsafe {
        let mut collection = None;
        if dwrite.GetSystemFontCollection(&mut collection, false).is_err() {
            return false;
        }
        let Some(collection) = collection else { return false };
        let (mut index, mut exists) = (0u32, BOOL(0));
        collection.FindFamilyName(&HSTRING::from(family), &mut index, &mut exists).is_ok() && exists.as_bool()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Renders the indicator offscreen to PNGs for a visual check: `OSD_PREVIEW_DIR=… cargo test osd -- --ignored`.
    #[test]
    #[ignore]
    fn osd_preview() {
        let dir = std::path::PathBuf::from(std::env::var("OSD_PREVIEW_DIR").expect("set OSD_PREVIEW_DIR"));
        let cases = [
            ("dark", OsdMessage::new("OnePlus Nord Buds 3 Pro", "Switched by Waypoint", glyphs_for_test::HEADPHONES), false),
            ("light", OsdMessage::new("Microphone muted", "Microphone (Realtek(R) Audio)", glyphs_for_test::MIC_OFF), true),
            ("error", OsdMessage::error("Couldn't switch", "The device is not connected."), false),
        ];
        for (name, m, light) in cases {
            let mut osd = Osd::new().unwrap();
            osd.scale = 1.5;
            osd.render(&m, light).unwrap();
            let (w, h) = (osd.size.cx as usize, osd.size.cy as usize);
            let mut px = vec![0u8; w * h * 4];
            unsafe {
                let mut bmi = BITMAPINFO {
                    bmiHeader: BITMAPINFOHEADER { biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32, biWidth: w as i32, biHeight: -(h as i32), biPlanes: 1, biBitCount: 32, biCompression: BI_RGB.0, ..Default::default() },
                    ..Default::default()
                };
                GetDIBits(osd.dc, osd.bitmap, 0, h as u32, Some(px.as_mut_ptr().cast()), &mut bmi, DIB_RGB_COLORS);
            }
            // Premultiplied BGRA over a mid-grey "desktop" → RGB.
            let rgb: Vec<u8> = px.chunks(4).flat_map(|p| { let a = p[3] as u32; [2, 1, 0].map(|i| (p[i] as u32 + 0x80 * (255 - a) / 255) as u8) }).collect();
            let file = std::fs::File::create(dir.join(format!("osd-{name}.png"))).unwrap();
            let mut enc = png::Encoder::new(file, w as u32, h as u32);
            enc.set_color(png::ColorType::Rgb);
            enc.write_header().unwrap().write_image_data(&rgb).unwrap();
        }
    }

    mod glyphs_for_test {
        pub use crate::engine::types::glyphs::*;
    }
}
