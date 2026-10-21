//! Notification-area icon and menu: open, profile, mode, quick device switch, mic mute, restore, quit. A port of the
//! C# TrayController (the menu is the native Windows one rather than a custom-drawn one).

use std::sync::Arc;

use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

use crate::audio::{AudioFlow, EndpointState};
use crate::engine::types::{FlowSnapshot, RuntimeSnapshot};
use crate::persistence::settings::SwitchMode;

use super::Host;

const ID: &str = "waypoint";

pub fn create(app: &AppHandle) -> tauri::Result<TrayIcon> {
    let mut builder = TrayIconBuilder::with_id(ID)
        .tooltip("Waypoint")
        .show_menu_on_left_click(false)
        .on_menu_event(on_menu)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                super::show_window_async(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    let tray = builder.build(app)?;
    let _ = tray.set_menu(Some(Menu::with_items(app, &[&MenuItem::with_id(app, "open", "Open Waypoint", true, None::<&str>)?])?));
    Ok(tray)
}

/// Everything the menu and tooltip show; they're rebuilt only when this changes (snapshots arrive often).
pub fn signature(s: &RuntimeSnapshot) -> String {
    let flow = |f: &FlowSnapshot| {
        f.devices.iter().filter(|d| d.state == EndpointState::Active && !d.auto_excluded).map(|d| format!("{}:{}:{}:{}", d.id, d.name, d.rank, d.is_default)).collect::<Vec<_>>().join(",")
    };
    let mic_muted = s.input.devices.iter().find(|d| d.is_default).and_then(|d| d.volume).map(|v| v.muted);
    let profiles = s.profiles.iter().map(|p| format!("{}:{}", p.id, p.name)).collect::<Vec<_>>().join(",");
    format!("{:?}|{}|{}|{:?}|{}|{:?}|{}", s.output.mode, flow(&s.output), flow(&s.input), mic_muted, profiles, s.active_profile_id, s.can_switch)
}

/// Rebuilds the tooltip and menu. Must run on the main thread.
pub fn update(app: &AppHandle, s: &RuntimeSnapshot) {
    let Some(tray) = app.tray_by_id(ID) else { return };
    let current = s.output.devices.iter().find(|d| d.is_default).map_or("No output".to_string(), |d| d.name.clone());
    let profile = if s.profiles.len() > 1 {
        s.profiles.iter().find(|p| Some(&p.id) == s.active_profile_id.as_ref()).map(|p| format!(" · {}", p.name)).unwrap_or_default()
    } else {
        String::new()
    };
    let tip: String = format!("Waypoint · {}{profile}\n{current}", s.output.mode.name()).chars().take(127).collect(); // NotifyIcon limit
    let _ = tray.set_tooltip(Some(tip));
    if let Ok(menu) = build_menu(app, s, &current) {
        let _ = tray.set_menu(Some(menu));
    }
}

fn build_menu(app: &AppHandle, s: &RuntimeSnapshot, current: &str) -> tauri::Result<Menu<Wry>> {
    let mut items: Vec<Box<dyn IsMenuItem<Wry>>> = Vec::new();
    let has_output = s.output.devices.iter().any(|d| d.is_default);
    items.push(Box::new(MenuItem::new(app, if has_output { format!("Playing on {current}") } else { "No output device".into() }, false, None::<&str>)?));
    items.push(Box::new(PredefinedMenuItem::separator(app)?));
    items.push(Box::new(MenuItem::with_id(app, "open", "Open Waypoint", true, None::<&str>)?));
    items.push(Box::new(PredefinedMenuItem::separator(app)?));

    if s.profiles.len() > 1 {
        let active = s.profiles.iter().find(|p| Some(&p.id) == s.active_profile_id.as_ref()).map_or("", |p| p.name.as_str());
        let sub = Submenu::new(app, format!("Profile: {active}"), true)?;
        for p in &s.profiles {
            sub.append(&CheckMenuItem::with_id(app, format!("profile:{}", p.id), &p.name, true, Some(&p.id) == s.active_profile_id.as_ref(), None::<&str>)?)?;
        }
        items.push(Box::new(sub));
    }

    let mode = Submenu::new(app, format!("Mode: {}", s.output.mode.name()), true)?;
    for m in [SwitchMode::Off, SwitchMode::Balanced, SwitchMode::Strict] {
        mode.append(&CheckMenuItem::with_id(app, format!("mode:{}", m.name()), m.name(), true, s.output.mode == m, None::<&str>)?)?;
    }
    items.push(Box::new(mode));
    items.push(Box::new(device_menu(app, "Switch output to", &s.output, s.can_switch, "out")?));

    let mic = device_menu(app, "Microphone", &s.input, s.can_switch, "mic")?;
    if let Some(v) = s.input.devices.iter().find(|d| d.is_default).and_then(|d| d.volume) {
        mic.append(&PredefinedMenuItem::separator(app)?)?;
        mic.append(&MenuItem::with_id(app, "micmute", if v.muted { "Unmute microphone" } else { "Mute microphone" }, true, None::<&str>)?)?;
    }
    items.push(Box::new(mic));
    items.push(Box::new(MenuItem::with_id(app, "restore", "Restore priority", s.can_switch, None::<&str>)?));
    items.push(Box::new(PredefinedMenuItem::separator(app)?));
    items.push(Box::new(MenuItem::with_id(app, "quit", "Quit Waypoint", true, None::<&str>)?));

    let refs: Vec<&dyn IsMenuItem<Wry>> = items.iter().map(|b| b.as_ref()).collect();
    Menu::with_items(app, &refs)
}

fn device_menu(app: &AppHandle, title: &str, flow: &FlowSnapshot, can_switch: bool, prefix: &str) -> tauri::Result<Submenu<Wry>> {
    let sub = Submenu::new(app, title, true)?;
    let available: Vec<_> = flow.devices.iter().filter(|d| d.state == EndpointState::Active && !d.auto_excluded).collect();
    if available.is_empty() {
        let none = if flow.flow == AudioFlow::Capture { "No connected microphones" } else { "No connected devices" };
        sub.append(&MenuItem::new(app, none, false, None::<&str>)?)?;
    }
    for d in available {
        sub.append(&CheckMenuItem::with_id(app, format!("{prefix}:{}", d.id), format!("#{}  {}", d.rank, d.name), can_switch, d.is_default, None::<&str>)?)?;
    }
    Ok(sub)
}

fn on_menu(app: &AppHandle, event: MenuEvent) {
    let host = app.state::<Arc<Host>>().inner().clone();
    let id = event.id().as_ref().to_string();
    let rt = &host.runtime;
    match id.split_once(':') {
        Some(("profile", p)) => {
            let p = p.to_string();
            rt.run(move |s| s.switch_profile(&p, true));
        }
        Some(("mode", m)) => {
            let mode = match m {
                "Off" => SwitchMode::Off,
                "Strict" => SwitchMode::Strict,
                _ => SwitchMode::Balanced,
            };
            rt.run(move |s| {
                let (c, core) = s.flow(AudioFlow::Render);
                c.set_mode(core, mode);
            });
        }
        Some((prefix @ ("out" | "mic"), device)) => {
            let flow = if prefix == "mic" { AudioFlow::Capture } else { AudioFlow::Render };
            let device = device.to_string();
            rt.run(move |s| {
                let (c, core) = s.flow(flow);
                c.select_device(core, &device, "manual");
            });
        }
        _ => match id.as_str() {
            "open" => super::show_window_async(app),
            "restore" => rt.run(|s| {
                let (c, core) = s.flow(AudioFlow::Render);
                c.restore_priority(core);
            }),
            "micmute" => rt.run(|s| {
                let Some(mic) = s.input.current_default_id().map(str::to_string) else { return };
                if let Some(v) = s.core.audio.volume(&mic) {
                    s.set_mute(&mic, !v.muted);
                }
            }),
            "quit" => host.quit(app),
            _ => {}
        },
    }
}
