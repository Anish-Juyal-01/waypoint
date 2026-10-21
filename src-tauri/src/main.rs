// Waypoint's host: a Tauri shell around the React UI. Audio, rules and Windows integration live in the modules
// below; this file only wires them together.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio;
mod persistence;
mod diag;
mod engine;

fn main() {
    if std::env::args().any(|a| a == "--list") {
        std::process::exit(diag::run_list());
    }
    tauri::Builder::default()
        .setup(|app| {
            use tauri::{WebviewUrl, WebviewWindowBuilder};
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Waypoint")
                .inner_size(1180.0, 780.0)
                .min_inner_size(720.0, 540.0)
                .decorations(false)
                .center()
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Waypoint");
}
