//! The audio side of Waypoint: endpoint types, the [`AudioSystem`] abstraction the engine talks to, and (on
//! Windows) its Core Audio implementation.

pub mod classifier;
#[cfg(windows)]
pub mod core_audio;
#[cfg(windows)]
mod interop;

use serde::{Deserialize, Serialize};

/// Which side of the audio pipeline an endpoint is on.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AudioFlow {
    /// Outputs: speakers, headphones, earbuds…
    Render,
    /// Inputs: microphones, headset mics…
    Capture,
}

/// Endpoint state as reported by IMMDevice::GetState.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EndpointState {
    Active,
    Disabled,
    NotPresent,
    Unplugged,
}

/// How the endpoint is attached to the PC (derived from the PnP enumerator / KS instance path).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConnectionType {
    Bluetooth,
    BluetoothHandsFree,
    Usb,
    BuiltIn,
    Display,
    Virtual,
    Other,
}

/// What the endpoint physically is (derived from PKEY_AudioEndpoint_FormFactor + name).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DeviceKind {
    Speakers,
    Headphones,
    Earbuds,
    Headset,
    Display,
    LineOut,
    Digital,
    Microphone,
    Other,
}

/// Immutable snapshot of one endpoint.
#[derive(Clone, Debug, PartialEq)]
pub struct AudioEndpoint {
    pub id: String,
    /// Full Windows name, e.g. "Headphones (OnePlus Nord Buds 3 Pro)".
    pub friendly_name: String,
    /// Endpoint description, e.g. "Headphones" or "Speaker".
    pub description: String,
    /// Adapter / product name, e.g. "OnePlus Nord Buds 3 Pro" or "Realtek(R) Audio".
    pub adapter_name: String,
    pub flow: AudioFlow,
    pub state: EndpointState,
    pub connection: ConnectionType,
    pub kind: DeviceKind,
    pub form_factor: i32,
}

impl AudioEndpoint {
    pub fn is_available(&self) -> bool {
        self.state == EndpointState::Active
    }

    pub fn is_hands_free(&self) -> bool {
        self.connection == ConnectionType::BluetoothHandsFree
    }
}

/// An app's audio session on an endpoint (state: 0 inactive, 1 active, 2 expired).
#[derive(Clone, Debug, PartialEq)]
pub struct AudioSessionInfo {
    pub process_id: u32,
    pub process_name: String,
    pub state: i32,
    pub is_system_sounds: bool,
}

/// Master volume of an endpoint (scalar 0..1, as shown in the Windows volume slider).
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct VolumeInfo {
    pub level: f32,
    pub muted: bool,
}

/// The default endpoint for each role the app manages.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DefaultEndpoints {
    pub console: Option<String>,
    pub multimedia: Option<String>,
    pub communications: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NotificationKind {
    StateChanged,
    Added,
    Removed,
    DefaultChanged,
    PropertyChanged,
}

/// A Core Audio callback, already copied out of the COM thread. `flow` is only known for default changes (Windows
/// doesn't say which flow a device belongs to in the topology callbacks).
#[derive(Clone, Debug, PartialEq)]
pub struct AudioNotification {
    pub kind: NotificationKind,
    pub device_id: Option<String>,
    pub flow: Option<AudioFlow>,
}

/// Outcome of a default-device change, after re-reading the actual defaults.
#[derive(Clone, Debug, PartialEq)]
pub struct SwitchResult {
    pub verified: bool,
    pub message: String,
    pub observed: Option<DefaultEndpoints>,
    pub hresult: Option<i32>,
}

impl SwitchResult {
    pub fn ok(message: impl Into<String>, observed: DefaultEndpoints) -> Self {
        Self { verified: true, message: message.into(), observed: Some(observed), hresult: None }
    }

    pub fn fail(message: impl Into<String>) -> Self {
        Self { verified: false, message: message.into(), observed: None, hresult: None }
    }
}

/// E_NOTIMPL, returned when per-app routing isn't available.
pub const E_NOTIMPL: i32 = 0x8000_4001_u32 as i32;

/// The Windows audio endpoint system, abstracted so the engine can be tested without hardware. Implementations may
/// require that every call happens on one thread (the runtime thread).
pub trait AudioSystem {
    /// False when the undocumented policy interface could not be activated.
    fn can_switch(&self) -> bool;
    fn switch_unavailable_reason(&self) -> Option<String>;
    fn endpoints(&mut self, flow: AudioFlow) -> Vec<AudioEndpoint>;
    fn defaults(&mut self, flow: AudioFlow) -> DefaultEndpoints;
    /// Sets the default endpoint for the flow and verifies it actually took effect.
    fn set_default(&mut self, flow: AudioFlow, device_id: &str, include_communications: bool) -> SwitchResult;
    /// Peak sample value 0..1 on the endpoint, or None if unavailable.
    fn peak(&mut self, device_id: &str) -> Option<f32>;
    /// Windows only meters a microphone while some app has it open. This opens (or, with None, closes) a silent
    /// shared-mode capture stream on the device purely so `peak` reports its level; no audio is read or kept.
    fn set_capture_monitor(&mut self, _device_id: Option<&str>) -> bool {
        false
    }
    fn volume(&mut self, device_id: &str) -> Option<VolumeInfo>;
    /// Sets master volume (0..1); returns the volume read back afterwards.
    fn set_volume(&mut self, device_id: &str, level: f32) -> Option<VolumeInfo>;
    /// Sets mute; returns the volume read back afterwards.
    fn set_mute(&mut self, device_id: &str, muted: bool) -> Option<VolumeInfo>;
    /// Apps with an audio session on an endpoint.
    fn sessions(&mut self, _device_id: &str) -> Vec<AudioSessionInfo> {
        Vec::new()
    }
    /// Endpoint an app is pinned to in Windows' per-app settings ("" = follows default; None = unknown).
    fn app_route(&mut self, _pid: u32, _flow: AudioFlow) -> Option<String> {
        None
    }
    /// Pins an app to an endpoint, or "" to make it follow the system default again. Returns an HRESULT.
    fn set_app_route(&mut self, _pid: u32, _flow: AudioFlow, _endpoint_id: &str, _include_communications: bool) -> i32 {
        E_NOTIMPL
    }
    /// Called on the runtime thread for every notification before the engine sees it (drops cached interfaces of
    /// devices that went away).
    fn on_notification(&mut self, _n: &AudioNotification) {}
}
