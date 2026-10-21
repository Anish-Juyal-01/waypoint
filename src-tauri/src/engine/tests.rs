//! Behaviour of the controllers and service against the fake audio system (ports of the C# engine tests).

use std::time::Duration;

use crate::audio::{AudioFlow, ConnectionType as C, DeviceKind};
use crate::persistence::activity::ActivityKind;
use crate::persistence::settings::{hotkey_actions as hk, AppSettings, SwitchMode};

use super::controller::{LOOP_LIMIT, LOOP_PAUSE};
use super::testing::Harness;
use super::types::OverrideSource;

fn ms(n: u64) -> Duration {
    Duration::from_millis(n)
}

fn some(id: &str) -> Option<String> {
    Some(id.to_string())
}

#[test]
fn startup_switches_to_top_available_device_in_balanced() {
    let mut h = Harness::new();
    h.buds("buds", true).speaker("speaker", C::BuiltIn);
    h.set_default_silently("speaker");
    h.start(SwitchMode::Balanced, &["buds", "speaker"]);
    assert_eq!(h.console(), some("buds"));
    assert!(h.logged(ActivityKind::Switched));
}

#[test]
fn off_mode_never_switches_automatically() {
    let mut h = Harness::new();
    h.buds("buds", false).speaker("speaker", C::BuiltIn);
    h.set_default_silently("speaker");
    h.start(SwitchMode::Off, &["buds", "speaker"]);
    h.set_state("buds", true);
    h.flush();
    assert_eq!(h.console(), some("speaker"));
    assert_eq!(h.switch_calls(), 0);
}

#[test]
fn connecting_higher_priority_device_switches_after_settle_delay() {
    let mut h = Harness::new();
    h.buds("buds", false).speaker("speaker", C::BuiltIn);
    h.set_default_silently("speaker");
    h.start(SwitchMode::Balanced, &["buds", "speaker"]);
    h.set_state("buds", true);
    h.advance(ms(500)); // debounce passed, settle not yet
    assert_eq!(h.console(), some("speaker"));
    h.advance(ms(1000));
    assert_eq!(h.console(), some("buds"));
}

#[test]
fn disconnect_falls_back_to_next_available_device() {
    let mut h = Harness::new();
    h.buds("buds", true).speaker("usb", C::Usb).speaker("speaker", C::BuiltIn);
    h.start(SwitchMode::Balanced, &["buds", "usb", "speaker"]);
    assert_eq!(h.console(), some("buds"));
    h.set_state("buds", false);
    h.set_default_silently("speaker"); // Windows picks something on its own
    h.flush();
    assert_eq!(h.console(), some("usb"));
}

#[test]
fn excluded_and_hands_free_devices_are_skipped() {
    let mut h = Harness::new();
    h.add("hf", C::BluetoothHandsFree, DeviceKind::Headset, true, AudioFlow::Render).buds("buds", true).speaker("speaker", C::BuiltIn);
    h.set_default_silently("speaker");
    h.start(SwitchMode::Balanced, &["hf", "buds", "speaker"]);
    assert_eq!(h.console(), some("buds"));
    let (c, core) = h.svc().flow(AudioFlow::Render);
    c.set_excluded(core, "buds", true);
    h.flush();
    assert_eq!(h.console(), some("speaker"));
}

#[test]
fn balanced_respects_external_change_until_next_connect() {
    let mut h = Harness::new();
    h.buds("buds", true).buds("headphones", false).speaker("speaker", C::BuiltIn);
    h.start(SwitchMode::Balanced, &["buds", "headphones", "speaker"]);
    assert_eq!(h.console(), some("buds"));
    h.external_set_default("speaker");
    h.flush();
    assert_eq!(h.console(), some("speaker"));
    assert_eq!(h.svc().output.override_().map(|o| o.source), Some(OverrideSource::External));
    h.set_state("headphones", true);
    h.flush();
    assert!(h.svc().output.override_().is_none());
    assert_eq!(h.console(), some("buds"));
}

#[test]
fn strict_reverts_external_change() {
    let mut h = Harness::new();
    h.buds("buds", true).speaker("speaker", C::BuiltIn);
    h.start(SwitchMode::Strict, &["buds", "speaker"]);
    h.external_set_default("speaker");
    h.flush();
    assert_eq!(h.console(), some("buds"));
    assert!(h.logged(ActivityKind::Reverted));
}

#[test]
fn strict_honours_in_app_selection_until_restore() {
    let mut h = Harness::new();
    h.buds("buds", true).speaker("speaker", C::BuiltIn);
    h.start(SwitchMode::Strict, &["buds", "speaker"]);
    let (c, core) = h.svc().flow(AudioFlow::Render);
    c.select_device(core, "speaker", "manual");
    h.flush();
    assert_eq!(h.console(), some("speaker"));
    assert_eq!(h.svc().output.override_().map(|o| o.source), Some(OverrideSource::App));

    // An outside change back to buds is reverted to the pinned speaker.
    h.external_set_default("buds");
    h.flush();
    assert_eq!(h.console(), some("speaker"));

    let (c, core) = h.svc().flow(AudioFlow::Render);
    c.restore_priority(core);
    h.flush();
    assert!(h.svc().output.override_().is_none());
    assert_eq!(h.console(), some("buds"));
}

#[test]
fn override_ends_when_its_device_disconnects() {
    let mut h = Harness::new();
    h.buds("buds", true).speaker("usb", C::Usb).speaker("speaker", C::BuiltIn);
    h.start(SwitchMode::Strict, &["buds", "usb", "speaker"]);
    let (c, core) = h.svc().flow(AudioFlow::Render);
    c.select_device(core, "usb", "manual");
    h.flush();
    h.set_state("usb", false);
    h.flush();
    assert!(h.svc().output.override_().is_none());
    assert_eq!(h.console(), some("buds"));
}

#[test]
fn strict_loop_guard_pauses_enforcement() {
    let mut h = Harness::new();
    h.buds("buds", true).speaker("speaker", C::BuiltIn);
    h.start(SwitchMode::Strict, &["buds", "speaker"]);
    for _ in 0..=LOOP_LIMIT {
        h.external_set_default("speaker");
        h.advance(ms(1000));
    }
    assert_eq!(h.console(), some("speaker"));
    assert!(h.svc().output.enforcement_paused_until().is_some());
    h.advance(LOOP_PAUSE);
    assert!(h.svc().output.enforcement_paused_until().is_none());
    assert_eq!(h.console(), some("buds"));
}

#[test]
fn windows_auto_switch_on_connect_is_not_treated_as_manual_choice() {
    let mut h = Harness::new();
    h.buds("buds", true).buds("headphones", false).speaker("speaker", C::BuiltIn);
    h.start(SwitchMode::Balanced, &["buds", "headphones", "speaker"]);
    // Windows makes the newly connected (lower priority) device default by itself.
    h.set_state("headphones", true);
    h.external_set_default("headphones");
    h.flush();
    assert!(h.svc().output.override_().is_none());
    assert_eq!(h.console(), some("buds"));
}

#[test]
fn failed_switch_is_reported_and_retried() {
    let mut h = Harness::new();
    h.buds("buds", false).speaker("speaker", C::BuiltIn);
    h.set_default_silently("speaker");
    h.start(SwitchMode::Balanced, &["buds", "speaker"]);
    h.audio.0.borrow_mut().fail_next_switch = true;
    h.set_state("buds", true);
    h.flush();
    assert!(h.logged(ActivityKind::SwitchFailed));
    assert_eq!(h.console(), some("buds"));
}

#[test]
fn manual_selection_of_disconnected_device_fails_cleanly() {
    let mut h = Harness::new();
    h.buds("buds", false).speaker("speaker", C::BuiltIn);
    h.start(SwitchMode::Balanced, &["buds", "speaker"]);
    let (c, core) = h.svc().flow(AudioFlow::Render);
    let r = c.select_device(core, "buds", "manual");
    assert!(!r.verified);
    assert!(h.logged(ActivityKind::SwitchFailed));
    assert_eq!(h.console(), some("speaker"));
}

#[test]
fn reorder_applies_new_priority() {
    let mut h = Harness::new();
    h.buds("buds", true).speaker("speaker", C::BuiltIn);
    h.start(SwitchMode::Balanced, &["buds", "speaker"]);
    let (c, core) = h.svc().flow(AudioFlow::Render);
    c.reorder(core, &["speaker".into(), "buds".into()]);
    h.flush();
    assert_eq!(h.console(), some("speaker"));
    assert_eq!(h.svc().core.settings.output.priority, vec!["speaker", "buds"]);
}

#[test]
fn new_devices_are_appended_and_first_run_is_seeded() {
    let mut h = Harness::new();
    h.speaker("speaker", C::BuiltIn).buds("buds", true);
    h.start(SwitchMode::Off, &[]);
    assert_eq!(h.svc().core.settings.output.priority, vec!["buds", "speaker"]); // Bluetooth before built-in
    h.add("usb", C::Usb, DeviceKind::Headphones, false, AudioFlow::Render);
    h.set_state("usb", true);
    h.flush();
    assert_eq!(h.svc().core.settings.output.priority, vec!["buds", "speaker", "usb"]);
}

#[test]
fn off_mode_restore_priority_still_switches_once() {
    let mut h = Harness::new();
    h.buds("buds", true).speaker("speaker", C::BuiltIn);
    h.set_default_silently("speaker");
    h.start(SwitchMode::Off, &["buds", "speaker"]);
    let (c, core) = h.svc().flow(AudioFlow::Render);
    c.restore_priority(core);
    assert_eq!(h.console(), some("buds"));
}

#[test]
fn switching_unavailable_never_attempts_switch() {
    let mut h = Harness::new();
    h.audio.0.borrow_mut().cannot_switch = true;
    h.buds("buds", true).speaker("speaker", C::BuiltIn);
    h.set_default_silently("speaker");
    h.start(SwitchMode::Strict, &["buds", "speaker"]);
    assert_eq!(h.switch_calls(), 0);
    assert!(!h.svc().snapshot().can_switch);
}

// ───────────────────────────── service features ─────────────────────────────

#[test]
fn microphones_follow_their_own_priority() {
    let mut h = Harness::new();
    h.speaker("speaker", C::BuiltIn).mic("builtin", C::BuiltIn, true).mic("usbmic", C::Usb, false);
    h.set_default_silently("builtin");
    let mut s = AppSettings { settle_delay_ms: 1000, ..AppSettings::default() };
    s.input.mode = SwitchMode::Balanced;
    h.start_with(s);
    h.set_state("usbmic", true);
    h.flush();
    assert_eq!(h.mic_default(), some("usbmic")); // USB mics are seeded above built-in ones
}

#[test]
fn profiles_carry_their_own_rankings() {
    let mut h = Harness::new();
    h.buds("buds", true).speaker("speaker", C::BuiltIn);
    h.start(SwitchMode::Balanced, &["buds", "speaker"]);
    let first = h.svc().core.settings.active_profile_id.clone().unwrap();
    let second = h.svc().create_profile("Desk");
    let (c, core) = h.svc().flow(AudioFlow::Render);
    c.reorder(core, &["speaker".into(), "buds".into()]);
    h.flush();
    assert_eq!(h.console(), some("speaker"));

    h.svc().switch_profile(&first, true);
    h.flush();
    assert_eq!(h.console(), some("buds"));
    h.svc().switch_profile(&second, true);
    h.flush();
    assert_eq!(h.console(), some("speaker"));
}

#[test]
fn switch_volume_is_applied_after_switching() {
    let mut h = Harness::new();
    h.buds("buds", false).speaker("speaker", C::BuiltIn);
    h.set_default_silently("speaker");
    h.start(SwitchMode::Balanced, &["buds", "speaker"]);
    h.svc().set_switch_volume("buds", Some(0.3));
    h.set_state("buds", true);
    h.flush();
    let v = h.audio.0.borrow().volumes["buds"];
    assert!((v.level - 0.3).abs() < 1e-6);
}

#[test]
fn hotkeys_cycle_outputs_and_mute_the_mic() {
    let mut h = Harness::new();
    h.buds("buds", true).speaker("speaker", C::BuiltIn).mic("mic", C::BuiltIn, true);
    h.set_default_silently("mic");
    h.start(SwitchMode::Balanced, &["buds", "speaker"]);
    h.svc().execute_hotkey(hk::NEXT_OUTPUT);
    assert_eq!(h.console(), some("speaker"));
    h.svc().execute_hotkey(hk::TOGGLE_MIC_MUTE);
    assert!(h.audio.0.borrow().volumes["mic"].muted);
    h.svc().execute_hotkey(hk::CYCLE_MODE);
    assert_eq!(h.svc().core.settings.output.mode, SwitchMode::Strict);
}

#[test]
fn stuck_apps_are_found_and_released() {
    let mut h = Harness::new();
    h.buds("buds", false).speaker("speaker", C::BuiltIn);
    h.set_default_silently("speaker");
    h.start(SwitchMode::Balanced, &["buds", "speaker"]);
    h.play_on("speaker", "Discord.exe", 42, Some("speaker"));
    h.set_state("buds", true);
    h.flush();
    let svc = h.svc();
    let stuck = svc.output.snapshot(&mut svc.core).stuck_apps;
    assert_eq!(stuck.len(), 1);
    assert!(stuck[0].pinned_in_windows);

    h.svc().release_app(AudioFlow::Render, 42);
    assert!(h.audio.0.borrow().routes.get(&42).is_none());
}

#[test]
fn snapshot_serializes_with_ui_field_names() {
    let mut h = Harness::new();
    h.buds("buds", true).speaker("speaker", C::BuiltIn);
    h.start(SwitchMode::Balanced, &["buds", "speaker"]);
    let json = serde_json::to_value(h.svc().snapshot()).unwrap();
    assert_eq!(json["output"]["defaultId"], "buds");
    assert!(json["output"].get("override").is_some());
    assert_eq!(json["output"]["devices"][0]["isDefault"], true);
    assert_eq!(json["settings"]["settleDelayMs"], 1000);
}
