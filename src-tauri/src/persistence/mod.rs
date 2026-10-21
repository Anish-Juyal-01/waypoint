//! Waypoint's on-disk state: settings.json and activity.jsonl in %APPDATA%\Waypoint (the same files the C# app
//! used, so updating keeps rankings, profiles and history).

pub mod activity;
pub mod settings;

use std::path::{Path, PathBuf};

/// The app was called EchoLock before; its data folder is moved over on first run.
pub const LEGACY_FOLDER_NAME: &str = "EchoLock";

pub struct AppPaths {
    pub data_dir: PathBuf,
}

impl AppPaths {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        let data_dir = dir.into();
        let _ = std::fs::create_dir_all(&data_dir);
        Self { data_dir }
    }

    /// %APPDATA%\Waypoint (migrated from %APPDATA%\EchoLock if needed).
    pub fn default_location() -> Self {
        let app_data = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
        let target = app_data.join("Waypoint");
        migrate_legacy(&app_data.join(LEGACY_FOLDER_NAME), &target);
        Self::new(target)
    }

    pub fn settings_file(&self) -> PathBuf {
        self.data_dir.join("settings.json")
    }

    pub fn activity_file(&self) -> PathBuf {
        self.data_dir.join("activity.jsonl")
    }

    pub fn error_log(&self) -> PathBuf {
        self.data_dir.join("error.log")
    }
}

/// Moves the old data folder to the new location when only the old one exists. Never overwrites existing data;
/// falls back to copying files if the folder can't be moved. Returns true when it migrated.
pub fn migrate_legacy(legacy: &Path, target: &Path) -> bool {
    if !legacy.is_dir() || target.join("settings.json").exists() {
        return false;
    }
    if !target.exists() && std::fs::rename(legacy, target).is_ok() {
        return true;
    }
    if std::fs::create_dir_all(target).is_err() {
        return false;
    }
    let Ok(entries) = std::fs::read_dir(legacy) else { return false };
    for entry in entries.flatten() {
        let dest = target.join(entry.file_name());
        if entry.path().is_file() && !dest.exists() {
            let _ = std::fs::copy(entry.path(), dest);
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_the_echolock_folder_but_never_overwrites() {
        let root = std::env::temp_dir().join(format!("waypoint-migrate-{}", settings::new_profile_id()));
        let legacy = root.join("EchoLock");
        let target = root.join("Waypoint");
        std::fs::create_dir_all(&legacy).unwrap();
        std::fs::write(legacy.join("settings.json"), "{}").unwrap();
        assert!(migrate_legacy(&legacy, &target));
        assert!(target.join("settings.json").exists());

        std::fs::create_dir_all(&legacy).unwrap();
        std::fs::write(legacy.join("settings.json"), "{\"old\":1}").unwrap();
        assert!(!migrate_legacy(&legacy, &target));
        assert_eq!(std::fs::read_to_string(target.join("settings.json")).unwrap(), "{}");
        let _ = std::fs::remove_dir_all(&root);
    }
}
