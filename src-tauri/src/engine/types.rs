//! What the engine publishes to the UI and host. Field names match ui/src/bridge/protocol.ts (camelCase JSON).

use chrono::{DateTime, FixedOffset};
use serde::{Deserialize, Serialize};

use crate::audio::{AudioFlow, ConnectionType, DeviceKind, EndpointState, SwitchResult, VolumeInfo};
use crate::persistence::activity::ActivityEntry;
use crate::persistence::settings::{HotkeyBinding, SwitchMode};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OverrideSource {
    /// The user picked a device inside Waypoint (window, tray or hotkey).
    App,
    /// The default was changed outside Waypoint and BALANCED respected it.
    External,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualOverride {
    pub device_id: String,
    pub source: OverrideSource,
    pub since: DateTime<FixedOffset>,
}

/// A device as presented to the UI, in priority order.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceView {
    pub id: String,
    pub name: String,
    pub friendly_name: String,
    pub alias: Option<String>,
    pub adapter_name: String,
    pub description: String,
    pub kind: DeviceKind,
    pub connection: ConnectionType,
    pub state: EndpointState,
    pub rank: usize,
    pub is_default: bool,
    pub is_communications_default: bool,
    pub excluded: bool,
    pub auto_excluded: bool,
    pub is_target: bool,
    pub last_connected: Option<DateTime<FixedOffset>>,
    /// Live master volume (connected devices only).
    pub volume: Option<VolumeInfo>,
    /// Volume applied when Waypoint switches to this device.
    pub switch_volume: Option<f32>,
}

/// An app still playing/recording on a device other than the one Waypoint switched to.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StuckApp {
    pub process_name: String,
    pub process_id: u32,
    pub device_id: String,
    pub device_name: String,
    /// True when Windows' per-app setting pins it (Waypoint can release that).
    pub pinned_in_windows: bool,
}

/// State of one side of the pipeline (outputs or inputs).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowSnapshot {
    pub flow: AudioFlow,
    pub devices: Vec<DeviceView>,
    pub mode: SwitchMode,
    pub default_id: Option<String>,
    pub target_id: Option<String>,
    pub priority_target_id: Option<String>,
    #[serde(rename = "override")]
    pub override_: Option<ManualOverride>,
    pub enforcement_paused_until: Option<DateTime<FixedOffset>>,
    pub busy: bool,
    pub pending_reason: Option<String>,
    pub stuck_apps: Vec<StuckApp>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    pub start_with_windows: bool,
    /// Set when a "start with Windows" entry exists but launches a different copy of Waypoint.
    pub startup_conflict: Option<String>,
    pub start_minimized: bool,
    pub start_menu_shortcut: bool,
    pub close_to_tray: bool,
    pub notify_on_switch: bool,
    pub show_osd: bool,
    pub include_communications_role: bool,
    pub ignore_hands_free: bool,
    pub strict_loop_guard: bool,
    pub show_disconnected: bool,
    pub show_virtual_devices: bool,
    pub settle_delay_ms: i32,
    pub onboarding_done: bool,
    pub hotkeys_enabled: bool,
    pub theme: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileView {
    pub id: String,
    pub name: String,
    pub pal: Option<String>,
    pub top_output: Option<String>,
    pub top_input: Option<String>,
    pub output_mode: SwitchMode,
    pub input_mode: SwitchMode,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum HotkeyStatus {
    Unbound,
    Registered,
    /// RegisterHotKey failed: another program already owns the combination.
    Conflict,
    Disabled,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyView {
    pub action: String,
    pub binding: Option<HotkeyBinding>,
    pub status: HotkeyStatus,
}

/// Everything the UI needs to render, published after every change.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSnapshot {
    pub output: FlowSnapshot,
    pub input: FlowSnapshot,
    pub settings: SettingsView,
    pub profiles: Vec<ProfileView>,
    pub active_profile_id: Option<String>,
    pub hotkeys: Vec<HotkeyView>,
    pub can_switch: bool,
    pub switch_unavailable_reason: Option<String>,
}

/// Partial settings update from the UI. None = unchanged.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SettingsPatch {
    pub start_with_windows: Option<bool>,
    pub start_minimized: Option<bool>,
    pub start_menu_shortcut: Option<bool>,
    pub close_to_tray: Option<bool>,
    pub notify_on_switch: Option<bool>,
    pub show_osd: Option<bool>,
    pub hotkeys_enabled: Option<bool>,
    pub include_communications_role: Option<bool>,
    pub ignore_hands_free: Option<bool>,
    pub strict_loop_guard: Option<bool>,
    pub show_disconnected: Option<bool>,
    pub show_virtual_devices: Option<bool>,
    pub settle_delay_ms: Option<i32>,
    pub onboarding_done: Option<bool>,
    pub theme: Option<String>,
}

/// Raised after every attempted switch so the host can notify the user.
#[derive(Clone, Debug, PartialEq)]
pub struct SwitchEvent {
    pub flow: AudioFlow,
    pub device_id: String,
    pub device_name: String,
    pub kind: DeviceKind,
    pub cause: String,
    pub result: SwitchResult,
}

/// A short on-screen message (hotkey feedback, automatic switches).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OsdMessage {
    pub title: String,
    pub subtitle: String,
    pub glyph: String,
    pub is_error: bool,
}

impl OsdMessage {
    pub fn new(title: impl Into<String>, subtitle: impl Into<String>, glyph: &str) -> Self {
        Self { title: title.into(), subtitle: subtitle.into(), glyph: glyph.into(), is_error: false }
    }

    pub fn error(title: impl Into<String>, subtitle: impl Into<String>) -> Self {
        Self { title: title.into(), subtitle: subtitle.into(), glyph: glyphs::ERROR.into(), is_error: true }
    }
}

/// What the engine tells the host, drained after every command.
#[derive(Clone, Debug)]
pub enum ServiceEvent {
    StateChanged(Box<RuntimeSnapshot>),
    ActivityAdded(ActivityEntry),
    Switched(SwitchEvent),
    Osd(OsdMessage),
}

/// Segoe Fluent Icons / MDL2 code points used by the on-screen indicator.
pub mod glyphs {
    use crate::audio::DeviceKind;

    pub const SPEAKERS: &str = "\u{E7F5}";
    pub const HEADPHONES: &str = "\u{E7F6}";
    pub const DISPLAY: &str = "\u{E7F4}";
    pub const MIC: &str = "\u{E720}";
    pub const MIC_OFF: &str = "\u{EC54}";
    pub const VOLUME: &str = "\u{E767}";
    pub const LOCK: &str = "\u{E72E}";
    pub const SYNC: &str = "\u{E895}";
    pub const PROFILE: &str = "\u{E77B}";
    pub const ERROR: &str = "\u{E783}";

    pub fn for_kind(kind: DeviceKind) -> &'static str {
        match kind {
            DeviceKind::Speakers | DeviceKind::LineOut => SPEAKERS,
            DeviceKind::Headphones | DeviceKind::Earbuds | DeviceKind::Headset => HEADPHONES,
            DeviceKind::Display => DISPLAY,
            DeviceKind::Microphone => MIC,
            _ => VOLUME,
        }
    }
}
