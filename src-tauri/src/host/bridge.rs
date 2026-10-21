//! The UI ⇄ host contract (see ui/src/bridge/protocol.ts). The UI sends every command through the `ui_message`
//! command; everything the host pushes goes out as a `host` event to the main window.

use std::sync::Arc;

use serde::Deserialize;
use serde_json::json;
use tauri::{AppHandle, Manager, WebviewWindow};

use crate::audio::AudioFlow;
use crate::engine::types::SettingsPatch;
use crate::persistence::settings::{HotkeyBinding, SwitchMode};

use super::{Host, MAIN};

#[derive(Clone, Copy, Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum Flow {
    #[default]
    Output,
    Input,
}

impl Flow {
    fn audio(self) -> AudioFlow {
        match self {
            Flow::Output => AudioFlow::Render,
            Flow::Input => AudioFlow::Capture,
        }
    }

    pub fn name(flow: AudioFlow) -> &'static str {
        if flow == AudioFlow::Capture {
            "input"
        } else {
            "output"
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum UiMessage {
    Ready,
    SetMode { flow: Flow, mode: SwitchMode },
    Reorder { flow: Flow, ids: Vec<String> },
    SetExcluded { flow: Flow, id: String, excluded: bool },
    SelectDevice { flow: Flow, id: String },
    RestorePriority { flow: Flow },
    ResetPriorities { flow: Flow },
    Rename { id: String, alias: Option<String> },
    SetVolume { id: String, level: f32 },
    SetMute { id: String, muted: bool },
    MicMonitor { on: bool },
    SetSwitchVolume { id: String, level: Option<f32> },
    CreateProfile { #[serde(default)] name: String },
    RenameProfile { id: String, name: String },
    DeleteProfile { id: String },
    SetProfilePal { id: String, pal: Option<String> },
    ReleaseApp { flow: Flow, pid: u32 },
    RecheckApps { flow: Flow },
    SwitchProfile { id: String },
    SetHotkey { action: String, binding: Option<HotkeyBinding> },
    ResetHotkeys,
    HotkeyRecording { active: bool },
    UpdateSettings { patch: SettingsPatch },
    ClearLog,
    ExportLog,
    Rescan,
    OpenSettings { page: Option<String> },
    OpenDataFolder,
    Window { action: String, edge: Option<String> },
}

#[tauri::command]
pub async fn ui_message(app: AppHandle, window: WebviewWindow, message: serde_json::Value) -> Result<(), String> {
    let host = app.state::<Arc<Host>>().inner().clone();
    let m: UiMessage = serde_json::from_value(message).map_err(|e| format!("bad UI message: {e}"))?;
    let rt = &host.runtime;
    match m {
        UiMessage::Ready => {
            host.set_ui_ready(true);
            host.send_hello(&app);
        }
        UiMessage::SetMode { flow, mode } => rt.run(move |s| {
            let (c, core) = s.flow(flow.audio());
            c.set_mode(core, mode);
        }),
        UiMessage::Reorder { flow, ids } => rt.run(move |s| {
            let (c, core) = s.flow(flow.audio());
            c.reorder(core, &ids);
        }),
        UiMessage::SetExcluded { flow, id, excluded } => rt.run(move |s| {
            let (c, core) = s.flow(flow.audio());
            c.set_excluded(core, &id, excluded);
        }),
        UiMessage::SelectDevice { flow, id } => rt.run(move |s| {
            let (c, core) = s.flow(flow.audio());
            c.select_device(core, &id, "manual");
        }),
        UiMessage::RestorePriority { flow } => rt.run(move |s| {
            let (c, core) = s.flow(flow.audio());
            c.restore_priority(core);
        }),
        UiMessage::ResetPriorities { flow } => rt.run(move |s| {
            let (c, core) = s.flow(flow.audio());
            c.reset_priorities(core);
        }),
        UiMessage::Rename { id, alias } => rt.run(move |s| s.rename(&id, alias)),
        UiMessage::SetVolume { id, level } => rt.run(move |s| {
            s.set_volume(&id, level);
        }),
        UiMessage::SetMute { id, muted } => rt.run(move |s| {
            s.set_mute(&id, muted);
        }),
        UiMessage::MicMonitor { on } => rt.set_mic_monitor(on),
        UiMessage::SetSwitchVolume { id, level } => rt.run(move |s| s.set_switch_volume(&id, level)),
        UiMessage::CreateProfile { name } => rt.run(move |s| {
            s.create_profile(&name);
        }),
        UiMessage::RenameProfile { id, name } => rt.run(move |s| s.rename_profile(&id, &name)),
        UiMessage::DeleteProfile { id } => rt.run(move |s| s.delete_profile(&id)),
        UiMessage::SetProfilePal { id, pal } => rt.run(move |s| s.set_profile_pal(&id, pal)),
        UiMessage::ReleaseApp { flow, pid } => rt.run(move |s| s.release_app(flow.audio(), pid)),
        UiMessage::RecheckApps { flow } => rt.run(move |s| s.recheck_apps(flow.audio())),
        UiMessage::SwitchProfile { id } => rt.run(move |s| s.switch_profile(&id, true)),
        UiMessage::SetHotkey { action, binding } => rt.run(move |s| s.set_hotkey(&action, binding)),
        UiMessage::ResetHotkeys => rt.run(|s| s.reset_hotkeys()),
        UiMessage::HotkeyRecording { active } => host.hotkeys_recording(active),
        UiMessage::UpdateSettings { patch } => rt.run(move |s| s.update_settings(patch)),
        UiMessage::ClearLog => {
            rt.run(|s| s.clear_activity());
            host.emit(&app, json!({ "type": "activityCleared" }));
        }
        UiMessage::ExportLog => export_log(&app, &host, &window),
        UiMessage::Rescan => rt.run(|s| s.rescan()),
        UiMessage::OpenSettings { page } => {
            let uri = match page.as_deref() {
                Some("bluetooth") => "ms-settings:bluetooth",
                Some("volume") => "ms-settings:apps-volume",
                _ => "ms-settings:sound",
            };
            super::shell_open(uri);
        }
        UiMessage::OpenDataFolder => super::shell_open(&host.paths_dir.to_string_lossy()),
        UiMessage::Window { action, edge } => handle_window(&app, &host, &window, &action, edge.as_deref()),
    }
    Ok(())
}

fn handle_window(app: &AppHandle, host: &Host, window: &WebviewWindow, action: &str, edge: Option<&str>) {
    if window.label() != MAIN {
        return;
    }
    let _ = match action {
        "drag" => match edge.unwrap_or("caption") {
            "caption" => window.start_dragging(),
            edge => match (resize_hit(edge), window.hwnd()) {
                (Some(hit), Ok(hwnd)) if !window.is_maximized().unwrap_or(false) => start_resize(app, hwnd.0 as isize, hit),
                _ => Ok(()),
            },
        },
        "minimize" => window.minimize(),
        "maximize" => {
            if window.is_maximized().unwrap_or(false) {
                window.unmaximize()
            } else {
                window.maximize()
            }
        }
        "close" => window.close(), // the close handler decides between tray and exit
        "quit" => {
            host.quit(app);
            Ok(())
        }
        _ => Ok(()),
    };
}

/// The WM_NCHITTEST code for a resize edge.
fn resize_hit(edge: &str) -> Option<u32> {
    use windows::Win32::UI::WindowsAndMessaging::*;
    Some(match edge {
        "left" => HTLEFT,
        "right" => HTRIGHT,
        "top" => HTTOP,
        "bottom" => HTBOTTOM,
        "top-left" => HTTOPLEFT,
        "top-right" => HTTOPRIGHT,
        "bottom-left" => HTBOTTOMLEFT,
        "bottom-right" => HTBOTTOMRIGHT,
        _ => return None,
    })
}

/// Hands the pressed mouse button to Windows' own resize loop, as if the frame edge had been grabbed. Runs on the UI
/// thread, which owns the mouse capture.
fn start_resize(app: &AppHandle, hwnd: isize, hit: u32) -> tauri::Result<()> {
    app.run_on_main_thread(move || unsafe {
        use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
        use windows::Win32::UI::Input::KeyboardAndMouse::ReleaseCapture;
        use windows::Win32::UI::WindowsAndMessaging::{PostMessageW, WM_NCLBUTTONDOWN};
        let _ = ReleaseCapture();
        let _ = PostMessageW(Some(HWND(hwnd as *mut _)), WM_NCLBUTTONDOWN, WPARAM(hit as usize), LPARAM(0));
    })
}

fn export_log(app: &AppHandle, host: &Host, window: &WebviewWindow) {
    use tauri_plugin_dialog::DialogExt;
    let Some(text) = host.runtime.call(|s| s.export_activity()) else { return };
    let name = format!("Waypoint-activity-{}.txt", chrono::Local::now().format("%Y%m%d-%H%M"));
    let Some(path) = app.dialog().file().set_parent(window).set_file_name(&name).add_filter("Text file", &["txt"]).blocking_save_file() else {
        return;
    };
    let Ok(path) = path.into_path() else { return };
    let notice = match std::fs::write(&path, text) {
        Ok(()) => json!({ "type": "notice", "tone": "success", "text": format!("Activity exported to {}", path.file_name().unwrap_or_default().to_string_lossy()) }),
        Err(e) => json!({ "type": "notice", "tone": "error", "text": format!("Export failed: {e}") }),
    };
    host.emit(app, notice);
}
