// Waypoint's host: a Tauri shell around the React UI. Audio, rules and Windows integration live in the modules
// below; this file only picks between the diagnostic listing and the app.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio;
mod diag;
mod engine;
mod host;
mod persistence;
mod platform;

fn main() {
    if std::env::args().any(|a| a == "--list") {
        std::process::exit(diag::run_list());
    }
    log_panics();
    host::run();
}

/// Appends crash details to %APPDATA%\Waypoint\error.log (there's no console in a release build).
fn log_panics() {
    let file = persistence::AppPaths::default_location().error_log();
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&file) {
            let _ = writeln!(f, "[{}] {info}\n{}\n", chrono::Local::now().to_rfc3339(), std::backtrace::Backtrace::force_capture());
        }
        default(info);
    }));
}
