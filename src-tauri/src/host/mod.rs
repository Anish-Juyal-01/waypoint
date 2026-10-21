//! The Tauri host: single instance → runtime thread → tray → window (created on demand, destroyed when hidden to
//! save memory) plus the Windows integrations around it. A port of the C# App / MainWindow / UiBridge.
//!
//! The runtime thread's output callback never waits on the main thread (the main thread may itself be waiting on
//! the runtime during startup), so window state it needs is mirrored in [`Shared`] and tray updates are posted.

pub mod bridge;
mod tray;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};

use crate::audio::AudioFlow;
use crate::engine::runtime::{Output, Runtime};
use crate::engine::types::{glyphs, OsdMessage, RuntimeSnapshot, ServiceEvent, SettingsView, SwitchEvent};
use crate::persistence::settings::{hotkey_actions, themes};
use crate::persistence::AppPaths;
use crate::platform::native::{self, Native};
use crate::platform::shortcut::StartMenuShortcut;
use crate::platform::startup::StartupManager;

pub const MAIN: &str = "main";
/// Passed by the sign-in task: start in the tray if the user asked for that.
pub const MINIMIZED_ARG: &str = "--minimized";
/// Toast notifications from an unpackaged app need its AppUserModelID registered (matches tauri.conf.json).
const APP_ID: &str = "app.waypoint.desktop";

/// State the runtime thread's output callback shares with the rest of the host.
#[derive(Default)]
pub struct Shared {
    ui_ready: AtomicBool,
    quitting: AtomicBool,
    told_about_tray: AtomicBool,
    focused: AtomicBool,
    maximized: AtomicBool,
    last: Mutex<Option<RuntimeSnapshot>>,
    tray_signature: Mutex<String>,
    last_hotkey_at: Mutex<Option<Instant>>,
    native: OnceLock<Native>,
}

impl Shared {
    fn settings(&self) -> Option<SettingsView> {
        self.last.lock().unwrap().as_ref().map(|s| s.settings.clone())
    }

    /// Resolves the theme preference ("system" reads Windows' app theme) for the native pieces.
    fn light(&self) -> bool {
        match self.settings().map(|s| s.theme) {
            Some(t) if t == themes::LIGHT => true,
            Some(t) if t == themes::DARK => false,
            _ => windows_uses_light_theme(),
        }
    }

    fn show_osd(&self, message: OsdMessage) {
        if self.settings().is_none_or(|s| s.show_osd) {
            if let Some(n) = self.native.get() {
                n.send(native::Command::Osd { message, light: self.light() });
            }
        }
    }
}

pub struct Host {
    pub runtime: Runtime,
    pub shared: Arc<Shared>,
    pub paths_dir: PathBuf,
}

impl Host {
    pub fn set_ui_ready(&self, ready: bool) {
        self.shared.ui_ready.store(ready, Ordering::Relaxed);
    }

    pub fn emit(&self, app: &AppHandle, message: serde_json::Value) {
        emit(&self.shared, app, message);
    }

    /// Pushes the complete current state (after the UI loads).
    pub fn send_hello(&self, app: &AppHandle) {
        let app = app.clone();
        let shared = self.shared.clone();
        self.runtime.run(move |s| {
            let message = json!({
                "type": "hello",
                "version": env!("CARGO_PKG_VERSION"),
                "maximized": shared.maximized.load(Ordering::Relaxed),
                "state": s.snapshot(),
                "activity": s.activity(),
            });
            emit(&shared, &app, message);
        });
    }

    /// The UI pauses global hotkeys while it records a new combination.
    pub fn hotkeys_recording(&self, active: bool) {
        if let Some(n) = self.shared.native.get() {
            n.send(native::Command::SuspendHotkeys(active));
        }
    }

    pub fn quit(&self, app: &AppHandle) {
        if self.shared.quitting.swap(true, Ordering::SeqCst) {
            return;
        }
        if let Some(w) = app.get_webview_window(MAIN) {
            let _ = w.destroy();
        }
        self.runtime.shutdown(); // saves settings
        app.exit(0);
    }

    fn on_hotkey(&self, app: &AppHandle, action: &str) {
        *self.shared.last_hotkey_at.lock().unwrap() = Some(Instant::now());
        if action == hotkey_actions::SHOW_WINDOW {
            // Toggles: a focused window goes back to the tray.
            match app.get_webview_window(MAIN) {
                Some(w) if self.shared.focused.load(Ordering::Relaxed) => {
                    let _ = w.close();
                }
                _ => show_window(app),
            }
            return;
        }
        let action = action.to_string();
        self.runtime.run(move |s| s.execute_hotkey(&action));
    }
}

fn emit(shared: &Shared, app: &AppHandle, message: serde_json::Value) {
    if shared.ui_ready.load(Ordering::Relaxed) {
        let _ = app.emit_to(MAIN, "host", message);
    }
}

/// Opens a URI or folder with the shell (ms-settings: pages, the data folder).
pub fn shell_open(target: &str) {
    use windows::core::HSTRING;
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    unsafe {
        ShellExecuteW(None, &HSTRING::from("open"), &HSTRING::from(target), None, None, SW_SHOWNORMAL);
    }
}

pub fn run() {
    let started_minimized = std::env::args().any(|a| a.eq_ignore_ascii_case(MINIMIZED_ARG));
    register_app_id();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // A copy started at sign-in exits quietly; one the user starts brings the running window forward.
            if !argv.iter().any(|a| a.eq_ignore_ascii_case(MINIMIZED_ARG)) {
                show_window_async(app);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![bridge::ui_message])
        .setup(move |app| {
            let handle = app.handle().clone();
            let shared = Arc::new(Shared::default());
            let paths = AppPaths::default_location();
            let paths_dir = paths.data_dir.clone();

            let out_shared = shared.clone();
            let out_app = handle.clone();
            let registrations = || {
                let mut startup = StartupManager::new();
                startup.migrate_legacy_entry();
                let startup: Box<dyn crate::engine::StartupRegistration> = Box::new(startup);
                let shortcut: Box<dyn crate::engine::ShortcutRegistration> = Box::new(StartMenuShortcut::new());
                (Some(startup), Some(shortcut))
            };
            let runtime = Runtime::start(paths, registrations, move |o| on_output(&out_app, &out_shared, o));
            let (start_minimized, onboarded) =
                runtime.call(|s| (s.core.settings.start_minimized, s.core.settings.onboarding_done)).unwrap_or((false, false));
            app.manage(Arc::new(Host { runtime, shared: shared.clone(), paths_dir }));

            tray::create(&handle)?;
            start_native(&handle, &shared);
            if let Some(s) = shared.last.lock().unwrap().clone() {
                apply_state(&handle, &shared, &s);
            }

            if !(started_minimized && start_minimized && onboarded) {
                show_window(&handle);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != MAIN {
                return;
            }
            let app = window.app_handle();
            let host = app.state::<Arc<Host>>();
            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    if host.shared.quitting.load(Ordering::SeqCst) {
                        return;
                    }
                    if host.shared.settings().is_none_or(|s| s.close_to_tray) {
                        // Let it close: the webview is destroyed (freeing its memory) and re-created on demand.
                        host.set_ui_ready(false);
                        host.runtime.set_metering(false);
                        if !host.shared.told_about_tray.swap(true, Ordering::Relaxed) {
                            notify(app, "Waypoint is still running", "It keeps managing your audio from the notification area.");
                        }
                    } else {
                        api.prevent_close();
                        host.quit(app);
                    }
                }
                WindowEvent::Destroyed => {
                    host.set_ui_ready(false);
                    host.shared.focused.store(false, Ordering::Relaxed);
                    host.runtime.set_metering(false);
                    // Once the webview's pages are gone, hand back what's left of them.
                    std::thread::spawn(|| {
                        std::thread::sleep(Duration::from_secs(2));
                        native::trim_working_set();
                    });
                }
                WindowEvent::Focused(f) => host.shared.focused.store(*f, Ordering::Relaxed),
                WindowEvent::Resized(_) => {
                    let Some(w) = app.get_webview_window(MAIN) else { return };
                    let minimized = w.is_minimized().unwrap_or(false);
                    host.runtime.set_metering(!minimized && w.is_visible().unwrap_or(false));
                    if !minimized {
                        let maximized = w.is_maximized().unwrap_or(false);
                        host.shared.maximized.store(maximized, Ordering::Relaxed);
                        host.emit(app, json!({ "type": "window", "maximized": maximized }));
                    }
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Waypoint");

    app.run(|app, event| {
        if let RunEvent::ExitRequested { code: None, api, .. } = event {
            // Closing the window keeps Waypoint running in the tray.
            if app.try_state::<Arc<Host>>().is_some_and(|h| !h.shared.quitting.load(Ordering::SeqCst)) {
                api.prevent_exit();
            }
        }
    });
}

fn start_native(app: &AppHandle, shared: &Arc<Shared>) {
    let (a, b, c) = (app.clone(), app.clone(), app.clone());
    let n = Native::start(native::Events {
        hotkey: Box::new(move |action| a.state::<Arc<Host>>().on_hotkey(&a, action)),
        hotkey_status: Box::new(move |status| b.state::<Arc<Host>>().runtime.run(move |s| s.set_hotkey_statuses(status))),
        // Devices may have come and gone while asleep.
        resumed: Box::new(move || c.state::<Arc<Host>>().runtime.run(|s| s.rescan())),
    });
    let _ = shared.native.set(n);
}

/// Shows the main window, creating it (and its webview) if it was closed to the tray.
pub fn show_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    } else {
        let built = WebviewWindowBuilder::new(app, MAIN, WebviewUrl::App("index.html".into()))
            .title("Waypoint")
            .inner_size(1180.0, 780.0)
            .min_inner_size(720.0, 540.0)
            .decorations(false)
            .center()
            .build();
        if let Ok(w) = built {
            let _ = w.set_focus();
        }
    }
    if let Some(host) = app.try_state::<Arc<Host>>() {
        host.runtime.set_metering(true);
    }
}

/// For event handlers on the main thread, where building a webview window synchronously can deadlock.
pub fn show_window_async(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || show_window(&app));
}

fn notify(app: &AppHandle, title: &str, body: &str) {
    use tauri_plugin_notification::NotificationExt;
    let _ = app.notification().builder().title(title).body(body).show();
}

/// Runs on the runtime thread for everything the engine produces.
fn on_output(app: &AppHandle, shared: &Arc<Shared>, output: Output) {
    match output {
        Output::Levels { output, input } => {
            let round = |v: Option<f32>| v.map(|f| (f * 1000.0).round() / 1000.0);
            emit(shared, app, json!({ "type": "level", "output": round(output), "input": round(input) }));
        }
        Output::Event(ServiceEvent::StateChanged(s)) => {
            emit(shared, app, json!({ "type": "state", "state": &*s }));
            *shared.last.lock().unwrap() = Some((*s).clone());
            apply_state(app, shared, &s);
        }
        Output::Event(ServiceEvent::ActivityAdded(entry)) => emit(shared, app, json!({ "type": "activityAdded", "entry": entry })),
        Output::Event(ServiceEvent::Switched(e)) => {
            emit(
                shared,
                app,
                json!({
                    "type": "switchResult",
                    "flow": bridge::Flow::name(e.flow),
                    "deviceId": e.device_id,
                    "name": e.device_name,
                    "verified": e.result.verified,
                    "message": e.result.message,
                }),
            );
            on_switched(app, shared, &e);
        }
        Output::Event(ServiceEvent::Osd(m)) => shared.show_osd(m),
    }
}

/// Keeps the tray and the registered hotkeys in step with the latest snapshot.
fn apply_state(app: &AppHandle, shared: &Shared, s: &RuntimeSnapshot) {
    if let Some(n) = shared.native.get() {
        n.send(native::Command::Hotkeys { hotkeys: s.hotkeys.clone(), enabled: s.settings.hotkeys_enabled });
    }
    let signature = tray::signature(s);
    let mut last = shared.tray_signature.lock().unwrap();
    if *last != signature {
        *last = signature;
        let (app2, snapshot) = (app.clone(), s.clone());
        let _ = app.run_on_main_thread(move || tray::update(&app2, &snapshot));
    }
}

/// Tells the user about automatic switches while the window isn't in front. Only verified switches are reported
/// as done; failures are always worth surfacing.
fn on_switched(app: &AppHandle, shared: &Shared, e: &SwitchEvent) {
    // Hotkey actions already show their own on-screen message.
    if shared.last_hotkey_at.lock().unwrap().is_some_and(|t| t.elapsed() < Duration::from_millis(1500)) {
        return;
    }
    let Some(settings) = shared.settings() else { return };
    if shared.focused.load(Ordering::Relaxed) {
        return;
    }
    let input = e.flow == AudioFlow::Capture;
    if e.result.verified {
        if settings.show_osd {
            let subtitle = if input { "Microphone switched by Waypoint" } else { "Switched by Waypoint" };
            shared.show_osd(OsdMessage::new(e.device_name.clone(), subtitle, glyphs::for_kind(e.kind)));
        } else if settings.notify_on_switch {
            let title = if input { format!("Recording from {}", e.device_name) } else { format!("Now playing on {}", e.device_name) };
            notify(app, &title, "Switched by Waypoint");
        }
    } else if settings.notify_on_switch || settings.show_osd {
        notify(app, &format!("Couldn't switch to {}", e.device_name), &e.result.message);
    }
}

fn windows_uses_light_theme() -> bool {
    use windows::core::w;
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};
    let mut value = 0u32;
    let mut size = 4u32;
    unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            w!(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"),
            w!("AppsUseLightTheme"),
            RRF_RT_REG_DWORD,
            None,
            Some((&mut value as *mut u32).cast()),
            Some(&mut size),
        )
        .is_ok()
            && value == 1
    }
}

/// Registers the AppUserModelID toasts are sent under, with the name and icon Windows shows on them. An unpackaged
/// app's toasts are dropped without this.
fn register_app_id() {
    use windows::core::HSTRING;
    use windows::Win32::System::Registry::{RegCreateKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_WRITE, REG_OPTION_NON_VOLATILE, REG_SZ};
    let set = |key: HKEY, name: &str, value: &str| unsafe {
        let data: Vec<u8> = value.encode_utf16().chain([0]).flat_map(u16::to_le_bytes).collect();
        let _ = RegSetValueExW(key, &HSTRING::from(name), None, REG_SZ, Some(&data));
    };
    unsafe {
        let mut key = HKEY::default();
        let path = HSTRING::from(format!(r"Software\Classes\AppUserModelId\{APP_ID}"));
        if RegCreateKeyExW(HKEY_CURRENT_USER, &path, None, None, REG_OPTION_NON_VOLATILE, KEY_WRITE, None, &mut key, None).is_ok() {
            set(key, "DisplayName", "Waypoint");
            if let Ok(exe) = std::env::current_exe() {
                set(key, "IconUri", &exe.to_string_lossy());
            }
            let _ = windows::Win32::System::Registry::RegCloseKey(key);
        }
    }
}
