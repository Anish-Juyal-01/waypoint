// Waypoint's host: a Tauri shell around the React UI. Audio, rules and Windows integration live in the modules
// below; this file only picks between the diagnostic listing and the app.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio;
mod diag;
mod engine;
mod host;
mod persistence;

fn main() {
    if std::env::args().any(|a| a == "--list") {
        std::process::exit(diag::run_list());
    }
    host::run();
}
