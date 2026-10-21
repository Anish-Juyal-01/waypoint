//! Everything persisted to settings.json. The JSON shape matches the C# version exactly (camelCase, enums as
//! camelCase strings), so a settings file from Waypoint 1.x loads unchanged.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use chrono::{DateTime, FixedOffset};
use serde::{Deserialize, Serialize};

use crate::audio::AudioFlow;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SwitchMode {
    /// Monitor only. Never switches automatically.
    Off,
    /// Switch on connect/disconnect; respect manual changes until the next connection.
    #[default]
    Balanced,
    /// Always enforce the priority list; revert external changes.
    Strict,
}

impl SwitchMode {
    pub fn name(self) -> &'static str {
        match self {
            SwitchMode::Off => "Off",
            SwitchMode::Balanced => "Balanced",
            SwitchMode::Strict => "Strict",
        }
    }
}

/// Mode + ranking for one side of the pipeline (outputs or inputs).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FlowSettings {
    pub mode: SwitchMode,
    /// Endpoint IDs, highest priority first.
    pub priority: Vec<String>,
    /// Endpoint IDs that are never chosen automatically.
    pub excluded: BTreeSet<String>,
}

impl FlowSettings {
    pub fn off() -> Self {
        Self { mode: SwitchMode::Off, ..Self::default() }
    }
}

/// A named set of output + input rankings the user can switch between ("Work", "Gaming").
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Profile {
    pub id: String,
    pub name: String,
    /// The profile's pixel creature; None = default by position.
    pub pal: Option<String>,
    pub output: FlowSettings,
    pub input: FlowSettings,
}

impl Default for Profile {
    fn default() -> Self {
        Self { id: new_profile_id(), name: "Default".into(), pal: None, output: FlowSettings::default(), input: FlowSettings::off() }
    }
}

/// 12 lowercase hex characters, like the C# version's `Guid.NewGuid().ToString("N")[..12]`.
pub fn new_profile_id() -> String {
    use rand::Rng;
    let n: u64 = rand::thread_rng().gen();
    format!("{:012x}", n & 0xFFFF_FFFF_FFFF)
}

/// Per-device metadata Waypoint remembers across sessions.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DeviceMemory {
    pub alias: Option<String>,
    pub last_known_name: Option<String>,
    pub first_seen: DateTime<FixedOffset>,
    pub last_connected: Option<DateTime<FixedOffset>>,
    /// Volume (0..1) applied whenever Waypoint switches to this device; None = leave Windows' volume alone.
    pub switch_volume: Option<f32>,
}

impl Default for DeviceMemory {
    fn default() -> Self {
        Self { alias: None, last_known_name: None, first_seen: DateTime::UNIX_EPOCH.fixed_offset(), last_connected: None, switch_volume: None }
    }
}

/// A global keyboard shortcut. Modifiers use RegisterHotKey's MOD_* flags (Alt=1, Ctrl=2, Shift=4, Win=8).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct HotkeyBinding {
    pub modifiers: i32,
    pub key: i32,
}

pub mod hotkey_actions {
    pub const NEXT_OUTPUT: &str = "nextOutput";
    pub const PREVIOUS_OUTPUT: &str = "previousOutput";
    pub const RESTORE_PRIORITY: &str = "restorePriority";
    pub const TOGGLE_MIC_MUTE: &str = "toggleMicMute";
    pub const CYCLE_MODE: &str = "cycleMode";
    pub const NEXT_PROFILE: &str = "nextProfile";
    pub const SHOW_WINDOW: &str = "showWindow";

    pub const ALL: [&str; 7] = [NEXT_OUTPUT, PREVIOUS_OUTPUT, RESTORE_PRIORITY, TOGGLE_MIC_MUTE, CYCLE_MODE, NEXT_PROFILE, SHOW_WINDOW];
}

/// Ctrl+Alt+F-keys: rarely used by other apps or graphics drivers (unlike Ctrl+Alt+arrows).
pub fn default_hotkeys() -> BTreeMap<String, Option<HotkeyBinding>> {
    use hotkey_actions::*;
    const ALT: i32 = 1;
    const CTRL: i32 = 2;
    let b = |key| Some(HotkeyBinding { modifiers: CTRL | ALT, key });
    BTreeMap::from([
        (PREVIOUS_OUTPUT.to_string(), b(0x77)), // F8
        (NEXT_OUTPUT.to_string(), b(0x78)),     // F9
        (RESTORE_PRIORITY.to_string(), b(0x79)), // F10
        (TOGGLE_MIC_MUTE.to_string(), b(0x7A)), // F11
        (CYCLE_MODE.to_string(), b(0x76)),      // F7
        (NEXT_PROFILE.to_string(), b(0x75)),    // F6
        (SHOW_WINDOW.to_string(), None),
    ])
}

pub mod themes {
    pub const SYSTEM: &str = "system";
    pub const LIGHT: &str = "light";
    pub const DARK: &str = "dark";

    pub fn is_valid(t: &str) -> bool {
        matches!(t, SYSTEM | LIGHT | DARK)
    }
}

pub const CURRENT_SCHEMA: i32 = 2;

/// Everything persisted to settings.json. Mutated only on the runtime thread.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub schema_version: i32,
    /// Live output ranking (mirrors the active profile).
    pub output: FlowSettings,
    /// Live microphone ranking. Off by default: a Bluetooth headset mic downgrades earbud audio.
    pub input: FlowSettings,
    pub profiles: Vec<Profile>,
    pub active_profile_id: Option<String>,
    pub devices: BTreeMap<String, DeviceMemory>,
    pub hotkeys_enabled: bool,
    pub hotkeys: BTreeMap<String, Option<HotkeyBinding>>,
    pub start_minimized: bool,
    /// Keep a Start menu shortcut (recreated at startup if it went missing, unless turned off).
    pub start_menu_shortcut: bool,
    pub close_to_tray: bool,
    pub notify_on_switch: bool,
    pub show_osd: bool,
    pub include_communications_role: bool,
    pub ignore_hands_free: bool,
    pub strict_loop_guard: bool,
    pub show_disconnected: bool,
    pub show_virtual_devices: bool,
    /// Delay after a device connects before switching to it (Bluetooth reports ACTIVE before it is ready).
    pub settle_delay_ms: i32,
    pub onboarding_done: bool,
    /// "system" (follow Windows), "light" or "dark".
    pub theme: String,

    // Schema 1 fields (a single output list). Read for migration only, never written.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<SwitchMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub excluded: Option<BTreeSet<String>>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            schema_version: CURRENT_SCHEMA,
            output: FlowSettings::default(),
            input: FlowSettings::off(),
            profiles: Vec::new(),
            active_profile_id: None,
            devices: BTreeMap::new(),
            hotkeys_enabled: true,
            hotkeys: default_hotkeys(),
            start_minimized: true,
            start_menu_shortcut: true,
            close_to_tray: true,
            notify_on_switch: true,
            show_osd: true,
            include_communications_role: true,
            ignore_hands_free: true,
            strict_loop_guard: true,
            show_disconnected: true,
            show_virtual_devices: false,
            settle_delay_ms: 1500,
            onboarding_done: false,
            theme: themes::SYSTEM.into(),
            mode: None,
            priority: None,
            excluded: None,
        }
    }
}

impl AppSettings {
    pub fn flow(&self, flow: AudioFlow) -> &FlowSettings {
        if flow == AudioFlow::Capture {
            &self.input
        } else {
            &self.output
        }
    }

    pub fn flow_mut(&mut self, flow: AudioFlow) -> &mut FlowSettings {
        if flow == AudioFlow::Capture {
            &mut self.input
        } else {
            &mut self.output
        }
    }

    pub fn active_profile(&self) -> Option<&Profile> {
        let id = self.active_profile_id.as_deref()?;
        self.profiles.iter().find(|p| p.id == id)
    }

    /// Brings older files up to date and repairs inconsistent state. Idempotent.
    pub fn normalize(&mut self) {
        if self.schema_version < 2 || self.priority.is_some() || self.mode.is_some() {
            if let Some(m) = self.mode.take() {
                self.output.mode = m;
            }
            if let Some(p) = self.priority.take() {
                self.output.priority = p;
            }
            if let Some(e) = self.excluded.take() {
                self.output.excluded = e;
            }
            self.schema_version = CURRENT_SCHEMA;
        }

        for f in [&mut self.output, &mut self.input] {
            let mut seen = BTreeSet::new();
            f.priority.retain(|id| !id.trim().is_empty() && seen.insert(id.clone()));
        }

        for (action, binding) in default_hotkeys() {
            self.hotkeys.entry(action).or_insert(binding);
        }

        self.settle_delay_ms = self.settle_delay_ms.clamp(0, 5000);
        if !themes::is_valid(&self.theme) {
            self.theme = themes::SYSTEM.into();
        }

        if self.profiles.is_empty() {
            self.profiles.push(Profile { output: self.output.clone(), input: self.input.clone(), ..Profile::default() });
        }
        if self.active_profile().is_none() {
            self.active_profile_id = Some(self.profiles[0].id.clone());
        }
    }

    /// Writes the live rankings into the active profile (called before every save).
    pub fn sync_active_profile(&mut self) {
        let Some(id) = self.active_profile_id.clone() else { return };
        let (output, input) = (self.output.clone(), self.input.clone());
        if let Some(p) = self.profiles.iter_mut().find(|p| p.id == id) {
            p.output = output;
            p.input = input;
        }
    }
}

/// Loads and atomically saves [`AppSettings`].
pub struct SettingsStore {
    file: std::path::PathBuf,
    /// Set when the settings file was unreadable and was moved aside.
    pub recovered_from_corruption: Option<String>,
}

impl SettingsStore {
    pub fn new(file: impl AsRef<Path>) -> Self {
        Self { file: file.as_ref().to_path_buf(), recovered_from_corruption: None }
    }

    pub fn load(&mut self) -> AppSettings {
        let fresh = || {
            let mut s = AppSettings::default();
            s.normalize();
            s
        };
        let Ok(text) = std::fs::read_to_string(&self.file) else { return fresh() };
        match serde_json::from_str::<AppSettings>(text.trim_start_matches('\u{feff}')) {
            Ok(mut s) => {
                s.normalize();
                s
            }
            Err(e) => {
                // Keep the broken file for inspection and start fresh rather than fail at startup.
                let backup = self.file.with_extension(format!("json.corrupt-{}", chrono::Local::now().format("%Y%m%d%H%M%S")));
                let _ = std::fs::rename(&self.file, &backup);
                self.recovered_from_corruption = Some(format!(
                    "Settings file was unreadable ({e}); backed up to {}.",
                    backup.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
                ));
                fresh()
            }
        }
    }

    pub fn save(&self, settings: &mut AppSettings) -> std::io::Result<()> {
        settings.sync_active_profile();
        let temp = self.file.with_extension("json.tmp");
        let json = serde_json::to_string_pretty(settings).map_err(std::io::Error::other)?;
        std::fs::write(&temp, json)?;
        std::fs::rename(&temp, &self.file) // atomic replace on NTFS
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_match_the_csharp_app() {
        let mut s = AppSettings::default();
        s.normalize();
        assert_eq!(s.output.mode, SwitchMode::Balanced);
        assert_eq!(s.input.mode, SwitchMode::Off);
        assert_eq!(s.settle_delay_ms, 1500);
        assert_eq!(s.profiles.len(), 1);
        assert_eq!(s.active_profile_id.as_deref(), Some(s.profiles[0].id.as_str()));
        assert_eq!(s.hotkeys["nextOutput"], Some(HotkeyBinding { modifiers: 3, key: 0x78 }));
        assert_eq!(s.hotkeys["showWindow"], None);
    }

    #[test]
    fn reads_a_csharp_settings_file() {
        let json = r#"{
          "schemaVersion": 2,
          "output": { "mode": "strict", "priority": ["a", "b", "a", ""], "excluded": ["b"] },
          "input": { "mode": "balanced", "priority": ["m"], "excluded": [] },
          "profiles": [{ "id": "abc123def456", "name": "Work", "pal": "fox",
                         "output": { "mode": "strict", "priority": ["a"], "excluded": [] },
                         "input": { "mode": "off", "priority": [], "excluded": [] } }],
          "activeProfileId": "abc123def456",
          "devices": { "a": { "alias": "Desk", "lastKnownName": "Speakers", "firstSeen": "2026-10-17T23:22:52.3505384+05:30",
                              "lastConnected": null, "switchVolume": 0.4 } },
          "hotkeysEnabled": true,
          "hotkeys": { "nextOutput": { "modifiers": 3, "key": 120 }, "showWindow": null },
          "startMinimized": true, "startMenuShortcut": true, "closeToTray": true, "notifyOnSwitch": false,
          "showOsd": true, "includeCommunicationsRole": true, "ignoreHandsFree": true, "strictLoopGuard": true,
          "showDisconnected": true, "showVirtualDevices": false, "settleDelayMs": 9000, "onboardingDone": true,
          "theme": "purple"
        }"#;
        let mut s: AppSettings = serde_json::from_str(json).unwrap();
        s.normalize();
        assert_eq!(s.output.mode, SwitchMode::Strict);
        assert_eq!(s.output.priority, vec!["a", "b"]);
        assert!(s.output.excluded.contains("b"));
        assert_eq!(s.devices["a"].alias.as_deref(), Some("Desk"));
        assert_eq!(s.devices["a"].switch_volume, Some(0.4));
        assert!(!s.notify_on_switch);
        assert_eq!(s.settle_delay_ms, 5000);
        assert_eq!(s.theme, "system");
        assert_eq!(s.hotkeys["previousOutput"], Some(HotkeyBinding { modifiers: 3, key: 0x77 }), "missing actions get their defaults");
        assert_eq!(s.profiles[0].pal.as_deref(), Some("fox"));
    }

    #[test]
    fn migrates_schema_one() {
        let mut s: AppSettings = serde_json::from_str(r#"{ "schemaVersion": 1, "mode": "strict", "priority": ["x", "y"], "excluded": ["y"] }"#).unwrap();
        s.normalize();
        assert_eq!(s.schema_version, 2);
        assert_eq!(s.output.mode, SwitchMode::Strict);
        assert_eq!(s.output.priority, vec!["x", "y"]);
        assert!(s.mode.is_none() && s.priority.is_none());
        let written: serde_json::Value = serde_json::to_value(&s).unwrap();
        for old in ["mode", "priority", "excluded"] {
            assert!(written.get(old).is_none(), "old top-level field {old} isn't written back");
        }
    }

    #[test]
    fn corrupt_file_is_backed_up_and_replaced() {
        let dir = std::env::temp_dir().join(format!("waypoint-test-{}", new_profile_id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("settings.json");
        std::fs::write(&file, "{ not json").unwrap();
        let mut store = SettingsStore::new(&file);
        let s = store.load();
        assert_eq!(s.profiles.len(), 1);
        assert!(store.recovered_from_corruption.is_some());
        assert!(std::fs::read_dir(&dir).unwrap().any(|e| e.unwrap().file_name().to_string_lossy().contains("corrupt")));

        let mut s = s;
        s.output.priority.push("z".into());
        store.save(&mut s).unwrap();
        let mut again = SettingsStore::new(&file);
        assert_eq!(again.load().output.priority, vec!["z"]);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
