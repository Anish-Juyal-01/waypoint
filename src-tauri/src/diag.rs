//! `Waypoint.exe --list`: prints every endpoint and the current defaults (replaces `waypoint-cli list`). Handy for
//! checking what Windows reports without opening the window.

use crate::audio::{AudioFlow, AudioSystem};

pub fn run_list() -> i32 {
    #[cfg(windows)]
    unsafe {
        // A GUI-subsystem exe has no console of its own; borrow the parent's so the output shows up.
        let _ = windows::Win32::System::Console::AttachConsole(windows::Win32::System::Console::ATTACH_PARENT_PROCESS);
        let _ = windows::Win32::System::Com::CoInitializeEx(None, windows::Win32::System::Com::COINIT_MULTITHREADED);
    }
    let mut audio = match crate::audio::core_audio::CoreAudioSystem::new(std::sync::Arc::new(|_| {})) {
        Ok(a) => a,
        Err(e) => {
            eprintln!("Couldn't open Windows audio: {e}");
            return 1;
        }
    };
    println!("Switching available: {}{}", audio.can_switch(), audio.switch_unavailable_reason().map(|r| format!(" ({r})")).unwrap_or_default());
    for flow in [AudioFlow::Render, AudioFlow::Capture] {
        let defaults = audio.defaults(flow);
        println!("\n{} defaults: console={:?} multimedia={:?} communications={:?}", if flow == AudioFlow::Render { "Output" } else { "Input" }, defaults.console, defaults.multimedia, defaults.communications);
        for e in audio.endpoints(flow) {
            let volume = if e.is_available() { audio.volume(&e.id) } else { None };
            println!(
                "  [{:?}] {} | {:?} {:?} | ff={} | adapter={:?}{}",
                e.state,
                e.friendly_name,
                e.connection,
                e.kind,
                e.form_factor,
                e.adapter_name,
                volume.map(|v| format!(" | vol {:.0}%{}", v.level * 100.0, if v.muted { " muted" } else { "" })).unwrap_or_default()
            );
        }
    }
    0
}
