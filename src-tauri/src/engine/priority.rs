//! Pure, side-effect-free priority rules (a port of the C# PriorityEngine). Everything here is unit tested.

use std::collections::{HashMap, HashSet};

use crate::audio::{AudioEndpoint, AudioFlow, ConnectionType, DeviceKind};
use crate::persistence::settings::{AppSettings, FlowSettings};

use super::types::ManualOverride;

/// Whether a device may be chosen automatically.
pub fn is_eligible(e: &AudioEndpoint, app: &AppSettings, flow: &FlowSettings) -> bool {
    e.is_available() && !is_excluded(e, app, flow)
}

pub fn is_excluded(e: &AudioEndpoint, app: &AppSettings, flow: &FlowSettings) -> bool {
    flow.excluded.contains(&e.id) || is_auto_excluded(e, app)
}

/// Excluded by a global rule rather than the user's toggle. Hands-Free endpoints are only ignored for outputs: for
/// inputs the Hands-Free endpoint is the only way to use a Bluetooth headset's microphone.
pub fn is_auto_excluded(e: &AudioEndpoint, app: &AppSettings) -> bool {
    (app.ignore_hands_free && e.is_hands_free() && e.flow == AudioFlow::Render) || (!app.show_virtual_devices && e.connection == ConnectionType::Virtual)
}

/// The device Waypoint wants as default: an active manual override if its device is still available, otherwise the
/// highest-ranked eligible device. None if nothing ranked is available.
pub fn select_target<'a>(
    endpoints: &'a HashMap<String, AudioEndpoint>,
    app: &AppSettings,
    flow: &FlowSettings,
    manual: Option<&ManualOverride>,
) -> Option<&'a AudioEndpoint> {
    if let Some(m) = manual {
        if let Some(pinned) = endpoints.get(&m.device_id) {
            if pinned.is_available() {
                return Some(pinned);
            }
        }
    }
    flow.priority.iter().filter_map(|id| endpoints.get(id)).find(|e| is_eligible(e, app, flow))
}

/// The top eligible device ignoring any override (what "Restore priority" would pick).
pub fn select_priority_target<'a>(endpoints: &'a HashMap<String, AudioEndpoint>, app: &AppSettings, flow: &FlowSettings) -> Option<&'a AudioEndpoint> {
    select_target(endpoints, app, flow, None)
}

/// The next/previous connected device after `current` in priority order (wrapping), for cycling with a hotkey.
/// Auto-ignored endpoints are skipped; user exclusions are not (cycling is manual).
pub fn cycle<'a>(
    endpoints: &'a HashMap<String, AudioEndpoint>,
    app: &AppSettings,
    flow: &FlowSettings,
    current: Option<&str>,
    direction: i32,
) -> Option<&'a AudioEndpoint> {
    let candidates: Vec<&AudioEndpoint> =
        flow.priority.iter().filter_map(|id| endpoints.get(id)).filter(|e| e.is_available() && !is_auto_excluded(e, app)).collect();
    if candidates.is_empty() {
        return None;
    }
    let n = candidates.len() as i32;
    let next = match candidates.iter().position(|e| Some(e.id.as_str()) == current) {
        None if direction > 0 => 0,
        None => n - 1,
        Some(i) => ((i as i32 + direction.signum()) % n + n) % n,
    };
    Some(candidates[next as usize])
}

/// The priority list with any unknown endpoints added. On a first run (empty list) devices are seeded in a sensible
/// default order; afterwards new devices are appended so the user's ranking is never reshuffled. Also returns the
/// endpoints that were added.
pub fn merge_new_devices<'a>(priority: &[String], endpoints: impl IntoIterator<Item = &'a AudioEndpoint>) -> (Vec<String>, Vec<AudioEndpoint>) {
    let known: HashSet<&String> = priority.iter().collect();
    let mut added: Vec<AudioEndpoint> = endpoints.into_iter().filter(|e| !known.contains(&e.id)).cloned().collect();
    if added.is_empty() {
        return (priority.to_vec(), added);
    }
    added.sort_by(|a, b| {
        default_rank(a)
            .cmp(&default_rank(b))
            .then_with(|| (!a.is_available()).cmp(&!b.is_available()))
            .then_with(|| a.friendly_name.to_lowercase().cmp(&b.friendly_name.to_lowercase()))
    });
    let mut merged = priority.to_vec();
    merged.extend(added.iter().map(|e| e.id.clone()));
    (merged, added)
}

/// Applies a user reorder: ids in the given order, followed by any known ids the UI did not send.
pub fn apply_reorder(current: &[String], requested: &[String]) -> Vec<String> {
    let known: HashSet<&String> = current.iter().collect();
    let mut seen = HashSet::new();
    let mut result: Vec<String> = requested.iter().filter(|id| known.contains(id) && seen.insert((*id).clone())).cloned().collect();
    result.extend(current.iter().filter(|id| !seen.contains(*id)).cloned());
    result
}

/// Lower is better. Personal audio first, then external speakers, built-in speakers last.
pub fn default_rank(e: &AudioEndpoint) -> i32 {
    use ConnectionType as C;
    use DeviceKind as K;
    match (e.connection, e.kind) {
        (C::Bluetooth, K::Earbuds | K::Headphones) => 0,
        (C::Usb, K::Microphone) => 0,
        (C::Bluetooth, _) => 1,
        (C::Usb, K::Headphones | K::Headset | K::Earbuds) => 2,
        (C::BuiltIn, K::Headphones) => 3,
        (C::Usb, _) => 4,
        (C::Display, _) => 5,
        (C::BuiltIn, K::Microphone) => 5,
        (C::BuiltIn, _) => 6,
        (C::Other, _) => 7,
        (C::BluetoothHandsFree, _) => 8,
        _ => 9,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::EndpointState;
    use crate::engine::types::OverrideSource;

    fn ep(id: &str, connection: ConnectionType, kind: DeviceKind, active: bool) -> AudioEndpoint {
        AudioEndpoint {
            id: id.into(),
            friendly_name: id.into(),
            description: String::new(),
            adapter_name: String::new(),
            flow: AudioFlow::Render,
            state: if active { EndpointState::Active } else { EndpointState::Unplugged },
            connection,
            kind,
            form_factor: -1,
        }
    }

    fn map(list: Vec<AudioEndpoint>) -> HashMap<String, AudioEndpoint> {
        list.into_iter().map(|e| (e.id.clone(), e)).collect()
    }

    fn flow(priority: &[&str]) -> FlowSettings {
        FlowSettings { priority: priority.iter().map(|s| s.to_string()).collect(), ..FlowSettings::default() }
    }

    #[test]
    fn picks_highest_available_and_skips_excluded_and_hands_free() {
        let eps = map(vec![
            ep("hf", ConnectionType::BluetoothHandsFree, DeviceKind::Headset, true),
            ep("buds", ConnectionType::Bluetooth, DeviceKind::Earbuds, false),
            ep("usb", ConnectionType::Usb, DeviceKind::Speakers, true),
            ep("spk", ConnectionType::BuiltIn, DeviceKind::Speakers, true),
        ]);
        let app = AppSettings::default();
        let mut f = flow(&["hf", "buds", "usb", "spk"]);
        assert_eq!(select_target(&eps, &app, &f, None).unwrap().id, "usb");
        f.excluded.insert("usb".into());
        assert_eq!(select_target(&eps, &app, &f, None).unwrap().id, "spk");
    }

    #[test]
    fn override_wins_while_its_device_is_available() {
        let eps = map(vec![ep("a", ConnectionType::Bluetooth, DeviceKind::Earbuds, true), ep("b", ConnectionType::BuiltIn, DeviceKind::Speakers, true)]);
        let app = AppSettings::default();
        let f = flow(&["a", "b"]);
        let o = ManualOverride { device_id: "b".into(), source: OverrideSource::App, since: chrono::Local::now().fixed_offset() };
        assert_eq!(select_target(&eps, &app, &f, Some(&o)).unwrap().id, "b");
        let gone = ManualOverride { device_id: "zzz".into(), ..o };
        assert_eq!(select_target(&eps, &app, &f, Some(&gone)).unwrap().id, "a");
    }

    #[test]
    fn cycles_with_wraparound() {
        let eps = map(vec![
            ep("a", ConnectionType::Bluetooth, DeviceKind::Earbuds, true),
            ep("b", ConnectionType::Usb, DeviceKind::Speakers, false),
            ep("c", ConnectionType::BuiltIn, DeviceKind::Speakers, true),
        ]);
        let app = AppSettings::default();
        let f = flow(&["a", "b", "c"]);
        assert_eq!(cycle(&eps, &app, &f, Some("a"), 1).unwrap().id, "c");
        assert_eq!(cycle(&eps, &app, &f, Some("c"), 1).unwrap().id, "a");
        assert_eq!(cycle(&eps, &app, &f, Some("a"), -1).unwrap().id, "c");
        assert_eq!(cycle(&eps, &app, &f, None, -1).unwrap().id, "c");
    }

    #[test]
    fn first_run_is_seeded_and_new_devices_are_appended() {
        let a = ep("spk", ConnectionType::BuiltIn, DeviceKind::Speakers, true);
        let b = ep("buds", ConnectionType::Bluetooth, DeviceKind::Earbuds, true);
        let (seeded, added) = merge_new_devices(&[], [&a, &b]);
        assert_eq!(seeded, vec!["buds", "spk"]);
        assert_eq!(added.len(), 2);
        let c = ep("usb", ConnectionType::Usb, DeviceKind::Headphones, true);
        let (merged, _) = merge_new_devices(&seeded, [&a, &b, &c]);
        assert_eq!(merged, vec!["buds", "spk", "usb"]);
    }

    #[test]
    fn reorder_keeps_unsent_ids_and_drops_unknown_ones() {
        let current: Vec<String> = ["a", "b", "c"].iter().map(|s| s.to_string()).collect();
        let requested: Vec<String> = ["c", "x", "a", "c"].iter().map(|s| s.to_string()).collect();
        assert_eq!(apply_reorder(&current, &requested), vec!["c", "a", "b"]);
    }
}
