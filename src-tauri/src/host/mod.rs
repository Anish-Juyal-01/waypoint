//! The Tauri host: single instance → runtime thread → window (created on demand, destroyed when hidden to save
//! memory) plus the Windows integrations around it. A port of the C# App / MainWindow / UiBridge.

pub mod bridge;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};

use crate::engine::runtime::{Output, Runtime};
use crate::engine::types::{RuntimeSnapshot, ServiceEvent};
use crate::persistence::AppPaths;

pub const MAIN: &str = "main";
/// Passed by the sign-in task: start in the tray if the user asked for that.
pub const MINIMIZED_ARG: &str = "--minimized";

/// State the runtime thread's output callback shares with the rest of the host.
#[derive(Default)]
pub struct Shared {
    ui_ready: AtomicBool,
    quitting: AtomicBool,
    told_about_tray: AtomicBool,
    last: Mutex<Option<RuntimeSnapshot>>,
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
            let state = s.snapshot();
            let maximized = app.get_webview_window(MAIN).and_then(|w| w.is_maximized().ok()).unwrap_or(false);
            let message = json!({
                "type": "hello",
                "version": env!("CARGO_PKG_VERSION"),
                "maximized": maximized,
                "state": state,
                "activity": s.activity(),
            });
            emit(&shared, &app, message);
        });
    }

    /// The UI pauses global hotkeys while it records a new combination.
    pub fn hotkeys_recording(&self, _active: bool) {}

    pub fn settings(&self) -> Option<crate::engine::types::SettingsView> {
        self.shared.last.lock().unwrap().as_ref().map(|s| s.settings.clone())
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

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // A copy started at sign-in exits quietly; one the user starts brings the running window forward.
            if !argv.iter().any(|a| a.eq_ignore_ascii_case(MINIMIZED_ARG)) {
                show_window(app);
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
            let runtime = Runtime::start(paths, || (None, None), move |o| on_output(&out_app, &out_shared, o));
            let (start_minimized, onboarded) =
                runtime.call(|s| (s.core.settings.start_minimized, s.core.settings.onboarding_done)).unwrap_or((false, false));
            app.manage(Arc::new(Host { runtime, shared, paths_dir }));

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
                    if host.settings().is_none_or(|s| s.close_to_tray) {
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
                    host.runtime.set_metering(false);
                }
                WindowEvent::Resized(_) => {
                    let Some(w) = app.get_webview_window(MAIN) else { return };
                    let minimized = w.is_minimized().unwrap_or(false);
                    host.runtime.set_metering(!minimized && w.is_visible().unwrap_or(false));
                    if !minimized {
                        host.emit(app, json!({ "type": "window", "maximized": w.is_maximized().unwrap_or(false) }));
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
            if !app.state::<Arc<Host>>().shared.quitting.load(Ordering::SeqCst) {
                api.prevent_exit();
            }
        }
    });
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

fn notify(app: &AppHandle, title: &str, body: &str) {
    use tauri_plugin_notification::NotificationExt;
    let _ = app.notification().builder().title(title).body(body).show();
}

/// Runs on the runtime thread for everything the engine produces.
fn on_output(app: &AppHandle, shared: &Shared, output: Output) {
    match output {
        Output::Levels { output, input } => {
            let round = |v: Option<f32>| v.map(|f| (f * 1000.0).round() / 1000.0);
            emit(shared, app, json!({ "type": "level", "output": round(output), "input": round(input) }));
        }
        Output::Event(ServiceEvent::StateChanged(s)) => {
            emit(shared, app, json!({ "type": "state", "state": &*s }));
            *shared.last.lock().unwrap() = Some(*s);
        }
        Output::Event(ServiceEvent::ActivityAdded(entry)) => emit(shared, app, json!({ "type": "activityAdded", "entry": entry })),
        Output::Event(ServiceEvent::Switched(e)) => emit(
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
        ),
        Output::Event(ServiceEvent::Osd(_)) => {}
    }
}
