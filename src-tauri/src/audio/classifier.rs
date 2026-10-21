//! Pure heuristics that turn raw endpoint properties into a connection type and device kind. Kept apart from the
//! COM code so they can be unit tested.

use super::{ConnectionType, DeviceKind};

// EndpointFormFactor values from mmdeviceapi.h
pub const FF_SPEAKERS: i32 = 1;
pub const FF_LINE_LEVEL: i32 = 2;
pub const FF_HEADPHONES: i32 = 3;
pub const FF_MICROPHONE: i32 = 4;
pub const FF_HEADSET: i32 = 5;
pub const FF_HANDSET: i32 = 6;
pub const FF_UNKNOWN_DIGITAL_PASSTHROUGH: i32 = 7;
pub const FF_SPDIF: i32 = 8;
pub const FF_DIGITAL_AUDIO_DISPLAY_DEVICE: i32 = 9;

pub fn classify_connection(enumerator: Option<&str>, ks_instance: Option<&str>, friendly_name: &str, form_factor: i32) -> ConnectionType {
    let e = enumerator.unwrap_or("").to_uppercase();
    let ks = ks_instance.unwrap_or("").to_uppercase();
    let name = friendly_name.to_uppercase();

    // Bluetooth Hands-Free profile (HFP) endpoints come from BTHHFENUM; the "Hands-Free" suffix is a backup signal.
    if e == "BTHHFENUM" || ks.contains("BTHHFENUM") || name.contains("HANDS-FREE") {
        return ConnectionType::BluetoothHandsFree;
    }
    if matches!(e.as_str(), "BTHENUM" | "BTHLEDEVICE" | "BTHLE") || ks.contains("BTHENUM") || ks.contains("BTHLE") {
        return ConnectionType::Bluetooth;
    }
    if e == "USB" || ks.contains("\\USB") || ks.starts_with("{1}.USB") || ks.contains("USB\\") {
        return ConnectionType::Usb;
    }
    if form_factor == FF_DIGITAL_AUDIO_DISPLAY_DEVICE || e == "DISPLAY" || ks.contains("DISPLAY") {
        return ConnectionType::Display;
    }
    if matches!(e.as_str(), "HDAUDIO" | "INTELAUDIO" | "ACPI" | "PCI") || ks.contains("HDAUDIO") || ks.contains("INTELAUDIO") {
        return ConnectionType::BuiltIn;
    }
    if matches!(e.as_str(), "ROOT" | "SWD") || ks.contains("ROOT\\") {
        return ConnectionType::Virtual;
    }
    ConnectionType::Other
}

pub fn classify_kind(form_factor: i32, friendly_name: &str, adapter_name: &str, connection: ConnectionType) -> DeviceKind {
    let text = format!("{friendly_name} {adapter_name}").to_uppercase();
    let earbud_hint = ["BUDS", "POD", "TWS", "EARBUD", "AIRDOPES", "EARPHONE", "IN-EAR"].iter().any(|h| text.contains(h));

    match form_factor {
        FF_HEADPHONES if earbud_hint => DeviceKind::Earbuds,
        FF_HEADPHONES => DeviceKind::Headphones,
        FF_HEADSET | FF_HANDSET if earbud_hint => DeviceKind::Earbuds,
        FF_HEADSET | FF_HANDSET => DeviceKind::Headset,
        FF_SPEAKERS => DeviceKind::Speakers,
        FF_LINE_LEVEL => DeviceKind::LineOut,
        FF_MICROPHONE => DeviceKind::Microphone,
        FF_SPDIF | FF_UNKNOWN_DIGITAL_PASSTHROUGH => DeviceKind::Digital,
        FF_DIGITAL_AUDIO_DISPLAY_DEVICE => DeviceKind::Display,
        _ if connection == ConnectionType::Display => DeviceKind::Display,
        _ if earbud_hint => DeviceKind::Earbuds,
        _ if matches!(connection, ConnectionType::Bluetooth | ConnectionType::BluetoothHandsFree) => DeviceKind::Headphones,
        _ => DeviceKind::Other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bluetooth_hands_free_wins_over_plain_bluetooth() {
        assert_eq!(classify_connection(Some("BTHHFENUM"), None, "Headset", 5), ConnectionType::BluetoothHandsFree);
        assert_eq!(classify_connection(Some("BTHENUM"), None, "Headset (Buds Hands-Free AG Audio)", 5), ConnectionType::BluetoothHandsFree);
        assert_eq!(classify_connection(Some("BTHENUM"), None, "Headphones (Buds)", 3), ConnectionType::Bluetooth);
    }

    #[test]
    fn usb_builtin_display_virtual() {
        assert_eq!(classify_connection(Some("USB"), None, "Speakers (USB Audio)", 1), ConnectionType::Usb);
        assert_eq!(classify_connection(None, Some("{1}.USB\\VID_1234"), "Speakers", 1), ConnectionType::Usb);
        assert_eq!(classify_connection(Some("HDAUDIO"), None, "Speaker (Realtek(R) Audio)", 1), ConnectionType::BuiltIn);
        assert_eq!(classify_connection(Some("HDAUDIO"), None, "LG (NVIDIA)", FF_DIGITAL_AUDIO_DISPLAY_DEVICE), ConnectionType::Display);
        assert_eq!(classify_connection(Some("ROOT"), None, "CABLE Input", 1), ConnectionType::Virtual);
        assert_eq!(classify_connection(None, None, "Mystery", 0), ConnectionType::Other);
    }

    #[test]
    fn kinds_from_form_factor_and_name() {
        assert_eq!(classify_kind(FF_HEADPHONES, "Headphones (OnePlus Nord Buds 3 Pro)", "", ConnectionType::Bluetooth), DeviceKind::Earbuds);
        assert_eq!(classify_kind(FF_HEADPHONES, "Headphones (WH-1000XM5)", "", ConnectionType::Bluetooth), DeviceKind::Headphones);
        assert_eq!(classify_kind(FF_HEADSET, "Headset (Airdopes 131)", "", ConnectionType::BluetoothHandsFree), DeviceKind::Earbuds);
        assert_eq!(classify_kind(FF_SPEAKERS, "Speaker", "Realtek", ConnectionType::BuiltIn), DeviceKind::Speakers);
        assert_eq!(classify_kind(0, "Unknown", "", ConnectionType::Display), DeviceKind::Display);
        assert_eq!(classify_kind(0, "Unknown", "", ConnectionType::Bluetooth), DeviceKind::Headphones);
        assert_eq!(classify_kind(0, "Unknown", "", ConnectionType::Other), DeviceKind::Other);
    }
}
