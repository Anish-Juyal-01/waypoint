//! Everything Waypoint does, minus the UI: one controller per flow (outputs, microphones), profiles, per-device
//! volume, global settings, hotkey actions and the combined snapshot. A port of the C# WaypointService.

use std::collections::BTreeMap;

use crate::audio::{AudioFlow, AudioNotification, DeviceKind, VolumeInfo};
use crate::persistence::activity::{ActivityEntry, ActivityKind};
use crate::persistence::settings::{hotkey_actions as hk, themes, DeviceMemory, HotkeyBinding, Profile, SwitchMode};

use super::controller::Controller;
use super::priority;
use super::types::*;
use super::{Core, ShortcutRegistration, StartupRegistration, Task};

pub struct Service {
    pub core: Core,
    pub output: Controller,
    pub input: Controller,
    startup: Option<Box<dyn StartupRegistration>>,
    shortcut: Option<Box<dyn ShortcutRegistration>>,
    hotkey_status: BTreeMap<String, HotkeyStatus>,
    last_output_volume: Option<VolumeInfo>,
    last_input_volume: Option<VolumeInfo>,
}

impl Service {
    pub fn new(mut core: Core, startup: Option<Box<dyn StartupRegistration>>, shortcut: Option<Box<dyn ShortcutRegistration>>) -> Self {
        core.settings.normalize();
        Self {
            core,
            output: Controller::new(AudioFlow::Render),
            input: Controller::new(AudioFlow::Capture),
            startup,
            shortcut,
            hotkey_status: BTreeMap::new(),
            last_output_volume: None,
            last_input_volume: None,
        }
    }

    /// The controller for a flow plus the shared core, borrowed separately.
    pub fn flow(&mut self, flow: AudioFlow) -> (&mut Controller, &mut Core) {
        let c = if flow == AudioFlow::Capture { &mut self.input } else { &mut self.output };
        (c, &mut self.core)
    }

    pub fn activity(&self) -> &[ActivityEntry] {
        self.core.log.entries()
    }

    /// Takes the events produced since the last call (activity, switches, OSD messages, snapshots).
    pub fn drain_events(&mut self) -> Vec<ServiceEvent> {
        std::mem::take(&mut self.core.events)
    }

    // ───────────────────────────── lifecycle ─────────────────────────────

    pub fn initialize(&mut self) {
        self.output.initialize(&mut self.core);
        self.input.initialize(&mut self.core);

        if !self.core.audio.can_switch() {
            let reason = self.core.audio.switch_unavailable_reason();
            self.core.log(ActivityKind::Warning, "Automatic switching unavailable", reason, None, None);
        }
        if self.core.settings.start_menu_shortcut {
            self.try_shortcut(|s| s.ensure_present());
        }

        let profile = self.core.settings.active_profile().map(|p| p.name.clone()).unwrap_or_else(|| "Default".into());
        let current = self.output.name_of(&self.core, self.output.current_default_id());
        let mode = self.core.settings.output.mode.name();
        self.core.log(ActivityKind::Info, format!("Waypoint started in {mode} mode"), Some(format!("Profile: {profile} · Output: {current}")), None, None);
        self.core.save();
        self.publish();
    }

    pub fn on_audio_notification(&mut self, n: &AudioNotification) {
        self.core.audio.on_notification(n);
        self.output.on_audio_notification(&mut self.core, n);
        self.input.on_audio_notification(&mut self.core, n);
    }

    /// Runs a task that came due on the scheduler.
    pub fn run_task(&mut self, task: Task) {
        match task {
            Task::Publish => self.publish(),
            Task::Controller(flow, t) => {
                let (c, core) = self.flow(flow);
                c.run(core, t);
            }
        }
    }

    // ───────────────────────────── devices ─────────────────────────────

    pub fn rename(&mut self, id: &str, alias: Option<String>) {
        let alias = alias.map(|a| a.trim().chars().take(64).collect::<String>()).filter(|a| !a.is_empty());
        let memory = self.memory_for(id);
        if memory.alias == alias {
            return;
        }
        memory.alias = alias;
        self.core.save();
        self.core.schedule_publish();
    }

    pub fn set_volume(&mut self, id: &str, level: f32) -> Option<VolumeInfo> {
        let r = self.core.audio.set_volume(id, level);
        self.core.schedule_publish();
        r
    }

    pub fn set_mute(&mut self, id: &str, muted: bool) -> Option<VolumeInfo> {
        let r = self.core.audio.set_mute(id, muted);
        self.core.schedule_publish();
        r
    }

    /// Sets (or clears, with None) the volume applied whenever Waypoint switches to the device.
    pub fn set_switch_volume(&mut self, id: &str, level: Option<f32>) {
        let level = level.map(|l| l.clamp(0.0, 1.0));
        self.memory_for(id).switch_volume = level;
        let name = self.name_of(id);
        let title = match level {
            None => format!("{name}: volume left as is when switching"),
            Some(l) => format!("{name}: volume set to {:.0}% when switched to", l * 100.0),
        };
        self.core.log(ActivityKind::Settings, title, None, Some(id.to_string()), None);
        self.core.save();
        self.core.schedule_publish();
    }

    pub fn release_app(&mut self, flow: AudioFlow, pid: u32) {
        let (c, core) = self.flow(flow);
        c.release_app(core, pid);
    }

    pub fn recheck_apps(&mut self, flow: AudioFlow) {
        let (c, core) = self.flow(flow);
        c.recheck_apps(core);
    }

    // ───────────────────────────── profiles ─────────────────────────────

    pub fn create_profile(&mut self, name: &str) -> String {
        self.core.settings.sync_active_profile();
        let fallback = format!("Profile {}", self.core.settings.profiles.len() + 1);
        let profile = Profile {
            name: clean_name(name, &fallback),
            output: self.core.settings.output.clone(),
            input: self.core.settings.input.clone(),
            ..Profile::default()
        };
        let id = profile.id.clone();
        let created = profile.name.clone();
        self.core.settings.profiles.push(profile);
        self.core.log(ActivityKind::Settings, format!("Profile created: {created}"), Some("Starts as a copy of your current rankings.".into()), None, None);
        self.switch_profile(&id, false);
        id
    }

    pub fn rename_profile(&mut self, id: &str, name: &str) {
        let Some(p) = self.core.settings.profiles.iter_mut().find(|p| p.id == id) else { return };
        p.name = clean_name(name, &p.name.clone());
        self.core.save();
        self.core.schedule_publish();
    }

    /// Sets the profile's creature. Names are validated by the UI's sprite table; length-capped here.
    pub fn set_profile_pal(&mut self, id: &str, pal: Option<String>) {
        let Some(p) = self.core.settings.profiles.iter_mut().find(|p| p.id == id) else { return };
        p.pal = pal.map(|s| s.trim().chars().take(32).collect::<String>()).filter(|s| !s.is_empty());
        self.core.save();
        self.core.schedule_publish();
    }

    pub fn delete_profile(&mut self, id: &str) {
        if self.core.settings.profiles.len() <= 1 {
            return;
        }
        let Some(index) = self.core.settings.profiles.iter().position(|p| p.id == id) else { return };
        let was_active = self.core.settings.active_profile_id.as_deref() == Some(id);
        let removed = self.core.settings.profiles.remove(index);
        self.core.log(ActivityKind::Settings, format!("Profile deleted: {}", removed.name), None, None, None);
        if was_active {
            self.core.settings.active_profile_id = None; // don't sync the live state into the deleted profile
            let first = self.core.settings.profiles[0].id.clone();
            self.switch_profile(&first, true);
        } else {
            self.core.save();
            self.core.schedule_publish();
        }
    }

    pub fn switch_profile(&mut self, id: &str, announce: bool) {
        let Some(target) = self.core.settings.profiles.iter().find(|p| p.id == id).cloned() else { return };
        if self.core.settings.active_profile_id.as_deref() == Some(id) && announce {
            return;
        }
        self.core.settings.sync_active_profile();
        self.core.settings.active_profile_id = Some(id.to_string());
        self.core.settings.output = target.output.clone();
        self.core.settings.input = target.input.clone();
        self.output.on_settings_replaced(&mut self.core);
        self.input.on_settings_replaced(&mut self.core);

        if announce {
            self.core.log(
                ActivityKind::ModeChanged,
                format!("Profile: {}", target.name),
                Some(format!("Output mode {} · Microphone mode {}", target.output.mode.name(), target.input.mode.name())),
                None,
                None,
            );
            self.core.events.push(ServiceEvent::Osd(OsdMessage::new(target.name.clone(), "Profile activated", glyphs::PROFILE)));
        }
        self.core.save();
        self.core.schedule_publish();
    }

    pub fn next_profile(&mut self) {
        let list = &self.core.settings.profiles;
        if list.len() < 2 {
            let name = list.first().map(|p| p.name.clone()).unwrap_or_else(|| "Default".into());
            self.core.events.push(ServiceEvent::Osd(OsdMessage::new(name, "Only one profile — create more in Waypoint", glyphs::PROFILE)));
            return;
        }
        let index = list.iter().position(|p| Some(p.id.as_str()) == self.core.settings.active_profile_id.as_deref()).map_or(0, |i| i + 1) % list.len();
        let id = list[index].id.clone();
        self.switch_profile(&id, true);
    }

    // ───────────────────────────── hotkeys ─────────────────────────────

    pub fn set_hotkey(&mut self, action: &str, binding: Option<HotkeyBinding>) {
        if !hk::ALL.contains(&action) {
            return;
        }
        // A combination can only do one thing: unbind it from any other action.
        if binding.is_some() {
            for (other, b) in self.core.settings.hotkeys.iter_mut() {
                if other != action && *b == binding {
                    *b = None;
                }
            }
        }
        self.core.settings.hotkeys.insert(action.to_string(), binding);
        self.core.save();
        self.core.schedule_publish();
    }

    pub fn reset_hotkeys(&mut self) {
        self.core.settings.hotkeys = crate::persistence::settings::default_hotkeys();
        self.core.save();
        self.core.schedule_publish();
    }

    /// Called by the host after (re)registering hotkeys with Windows.
    pub fn set_hotkey_statuses(&mut self, statuses: BTreeMap<String, HotkeyStatus>) {
        self.hotkey_status = statuses;
        self.core.schedule_publish();
    }

    /// Runs a hotkey action and reports what happened on screen. "showWindow" is handled by the host.
    pub fn execute_hotkey(&mut self, action: &str) {
        match action {
            hk::NEXT_OUTPUT | hk::PREVIOUS_OUTPUT => {
                let direction = if action == hk::NEXT_OUTPUT { 1 } else { -1 };
                let result = self.output.cycle(&mut self.core, direction);
                match result {
                    None => self.osd(OsdMessage::error("No connected outputs", "Nothing to switch to")),
                    Some(r) if !r.verified => self.osd(OsdMessage::error("Couldn't switch", r.message)),
                    Some(_) => self.osd_for_current(AudioFlow::Render, "Selected with hotkey"),
                }
            }
            hk::RESTORE_PRIORITY => match self.output.restore_priority(&mut self.core) {
                Some(r) if !r.verified => self.osd(OsdMessage::error("Couldn't restore priority", r.message)),
                _ => self.osd_for_current(AudioFlow::Render, "Priority restored"),
            },
            hk::TOGGLE_MIC_MUTE => {
                let mic = self.input.current_default_id().map(str::to_string);
                let current = mic.as_deref().and_then(|m| self.core.audio.volume(m));
                let (Some(mic), Some(current)) = (mic, current) else {
                    self.osd(OsdMessage::error("No microphone", "Nothing to mute"));
                    return;
                };
                let name = self.input.name_of(&self.core, Some(&mic));
                let Some(after) = self.core.audio.set_mute(&mic, !current.muted) else {
                    self.osd(OsdMessage::error("Couldn't change mute", name));
                    return;
                };
                let title = if after.muted { "Microphone muted" } else { "Microphone unmuted" };
                self.core.log(ActivityKind::Settings, title, Some(name.clone()), Some(mic.clone()), Some(AudioFlow::Capture));
                let (t, g) = if after.muted { ("Microphone muted", glyphs::MIC_OFF) } else { ("Microphone on", glyphs::MIC) };
                self.osd(OsdMessage::new(t, name, g));
                self.core.schedule_publish();
            }
            hk::CYCLE_MODE => {
                let next = match self.core.settings.output.mode {
                    SwitchMode::Off => SwitchMode::Balanced,
                    SwitchMode::Balanced => SwitchMode::Strict,
                    SwitchMode::Strict => SwitchMode::Off,
                };
                self.output.set_mode(&mut self.core, next);
                let subtitle = match next {
                    SwitchMode::Off => "Automatic switching paused",
                    SwitchMode::Balanced => "Switches on connect, respects your changes",
                    SwitchMode::Strict => "Your priority list always wins",
                };
                let glyph = if next == SwitchMode::Strict { glyphs::LOCK } else { glyphs::SYNC };
                self.osd(OsdMessage::new(format!("{} mode", next.name()), subtitle, glyph));
            }
            hk::NEXT_PROFILE => self.next_profile(),
            _ => {}
        }
    }

    // ───────────────────────────── settings ─────────────────────────────

    pub fn update_settings(&mut self, p: SettingsPatch) {
        let mut reevaluate = false;
        let mut changes: Vec<&'static str> = Vec::new();

        if let (Some(on), Some(startup)) = (p.start_with_windows, self.startup.as_mut()) {
            if startup.is_enabled() != on {
                let replaced = if on { startup.foreign_command() } else { None };
                match startup.set_enabled(on) {
                    Ok(()) => {
                        changes.push(if on { "Start with Windows on" } else { "Start with Windows off" });
                        if let Some(r) = replaced {
                            self.core.log(ActivityKind::Settings, "Replaced previous startup entry", Some(format!("It launched: {r}")), None, None);
                        }
                    }
                    Err(e) => self.core.log(ActivityKind::Warning, "Couldn't change Start with Windows", Some(e), None, None),
                }
            }
        }

        if let Some(menu) = p.start_menu_shortcut {
            if self.core.settings.start_menu_shortcut != menu {
                self.core.settings.start_menu_shortcut = menu;
                if self.try_shortcut(|s| s.set_enabled(menu)) {
                    changes.push(if menu { "Added to the Start menu" } else { "Removed from the Start menu" });
                }
            }
        }

        let s = &mut self.core.settings;
        if let Some(v) = p.start_minimized {
            s.start_minimized = v;
        }
        if let Some(v) = p.close_to_tray {
            s.close_to_tray = v;
        }
        if let Some(v) = p.notify_on_switch {
            s.notify_on_switch = v;
        }
        if let Some(v) = p.show_osd {
            s.show_osd = v;
        }
        if let Some(v) = p.show_disconnected {
            s.show_disconnected = v;
        }
        if let Some(v) = p.onboarding_done {
            s.onboarding_done = v;
        }
        if let Some(t) = p.theme.filter(|t| themes::is_valid(t)) {
            s.theme = t;
        }
        if let Some(v) = p.hotkeys_enabled.filter(|v| *v != s.hotkeys_enabled) {
            s.hotkeys_enabled = v;
            changes.push(if v { "Keyboard shortcuts on" } else { "Keyboard shortcuts off" });
        }
        let mut reset_guard = false;
        if let Some(v) = p.strict_loop_guard {
            s.strict_loop_guard = v;
            reset_guard = !v;
        }
        if let Some(d) = p.settle_delay_ms {
            s.settle_delay_ms = d.clamp(0, 5000);
        }
        if let Some(v) = p.include_communications_role.filter(|v| *v != s.include_communications_role) {
            s.include_communications_role = v;
            changes.push(if v { "Calls & chat apps follow Waypoint" } else { "Calls & chat apps left alone" });
            reevaluate = true;
        }
        if let Some(v) = p.ignore_hands_free.filter(|v| *v != s.ignore_hands_free) {
            s.ignore_hands_free = v;
            changes.push(if v { "Hands-Free outputs ignored" } else { "Hands-Free outputs allowed" });
            reevaluate = true;
        }
        if let Some(v) = p.show_virtual_devices.filter(|v| *v != s.show_virtual_devices) {
            s.show_virtual_devices = v;
            changes.push(if v { "Virtual devices included" } else { "Virtual devices hidden" });
            reevaluate = true;
        }
        if reset_guard {
            self.output.reset_loop_guard(&mut self.core);
            self.input.reset_loop_guard(&mut self.core);
        }

        for c in changes {
            self.core.log(ActivityKind::Settings, c, None, None, None);
        }
        self.core.save();
        if reevaluate {
            self.output.reevaluate(&mut self.core, "rules");
            self.input.reevaluate(&mut self.core, "rules");
        }
        self.core.schedule_publish();
    }

    pub fn clear_activity(&mut self) {
        self.core.log.clear();
        self.core.schedule_publish();
    }

    pub fn export_activity(&self) -> String {
        self.core.log.export_text()
    }

    pub fn rescan(&mut self) {
        self.output.rescan(&mut self.core);
        self.input.rescan(&mut self.core);
    }

    /// Peak levels of the current default output and microphone.
    pub fn sample_levels(&mut self) -> (Option<f32>, Option<f32>) {
        let o = self.output.current_default_id().map(str::to_string);
        let i = self.input.current_default_id().map(str::to_string);
        (o.and_then(|o| self.core.audio.peak(&o)), i.and_then(|i| self.core.audio.peak(&i)))
    }

    /// Keeps the silent capture stream on the current default mic open (or closes it), so its level can be shown.
    pub fn sync_capture_monitor(&mut self, wanted: bool) {
        let mic = if wanted { self.input.current_default_id().map(str::to_string) } else { None };
        self.core.audio.set_capture_monitor(mic.as_deref());
    }

    /// Publishes when the default devices' volume/mute changed outside Waypoint (volume keys, mixer).
    pub fn poll_volumes(&mut self) {
        let o = self.output.current_default_id().map(str::to_string);
        let i = self.input.current_default_id().map(str::to_string);
        let output = o.and_then(|o| self.core.audio.volume(&o));
        let input = i.and_then(|i| self.core.audio.volume(&i));
        if output != self.last_output_volume || input != self.last_input_volume {
            self.core.schedule_publish();
        }
        self.last_output_volume = output;
        self.last_input_volume = input;
    }

    pub fn snapshot(&mut self) -> RuntimeSnapshot {
        let output = self.output.snapshot(&mut self.core);
        let input = self.input.snapshot(&mut self.core);
        let (start_with_windows, startup_conflict) = match self.startup.as_mut() {
            Some(s) => (s.is_enabled(), s.foreign_command()),
            None => (false, None),
        };
        let s = &self.core.settings;
        let settings = SettingsView {
            start_with_windows,
            startup_conflict,
            start_minimized: s.start_minimized,
            start_menu_shortcut: self.shortcut.as_ref().map_or(s.start_menu_shortcut, |sc| sc.exists()),
            close_to_tray: s.close_to_tray,
            notify_on_switch: s.notify_on_switch,
            show_osd: s.show_osd,
            include_communications_role: s.include_communications_role,
            ignore_hands_free: s.ignore_hands_free,
            strict_loop_guard: s.strict_loop_guard,
            show_disconnected: s.show_disconnected,
            show_virtual_devices: s.show_virtual_devices,
            settle_delay_ms: s.settle_delay_ms,
            onboarding_done: s.onboarding_done,
            hotkeys_enabled: s.hotkeys_enabled,
            theme: s.theme.clone(),
        };
        let profiles = self.core.settings.profiles.iter().map(|p| self.profile_view(p)).collect();
        let hotkeys = hk::ALL
            .iter()
            .map(|a| {
                let binding = self.core.settings.hotkeys.get(*a).copied().flatten();
                let status = if binding.is_none() {
                    HotkeyStatus::Unbound
                } else if !self.core.settings.hotkeys_enabled {
                    HotkeyStatus::Disabled
                } else {
                    self.hotkey_status.get(*a).copied().unwrap_or(HotkeyStatus::Registered)
                };
                HotkeyView { action: a.to_string(), binding, status }
            })
            .collect();
        RuntimeSnapshot {
            output,
            input,
            settings,
            profiles,
            active_profile_id: self.core.settings.active_profile_id.clone(),
            hotkeys,
            can_switch: self.core.audio.can_switch(),
            switch_unavailable_reason: self.core.audio.switch_unavailable_reason(),
        }
    }

    // ───────────────────────────── helpers ─────────────────────────────

    fn publish(&mut self) {
        self.core.publish_done();
        let snapshot = self.snapshot();
        self.core.events.push(ServiceEvent::StateChanged(Box::new(snapshot)));
    }

    fn osd(&mut self, m: OsdMessage) {
        self.core.events.push(ServiceEvent::Osd(m));
    }

    fn osd_for_current(&mut self, flow: AudioFlow, subtitle: &str) {
        let (c, core) = self.flow(flow);
        let id = c.current_default_id().map(str::to_string);
        let kind = id.as_deref().and_then(|i| c.endpoints().get(i)).map_or(DeviceKind::Other, |e| e.kind);
        let name = c.name_of(core, id.as_deref());
        self.osd(OsdMessage::new(name, subtitle, glyphs::for_kind(kind)));
    }

    fn profile_view(&self, p: &Profile) -> ProfileView {
        // The active profile's live rankings may be newer than its stored copy (synced on save).
        let active = self.core.settings.active_profile_id.as_deref() == Some(p.id.as_str());
        let output = if active { &self.core.settings.output } else { &p.output };
        let input = if active { &self.core.settings.input } else { &p.input };
        let top_out = priority::select_priority_target(self.output.endpoints(), &self.core.settings, output).map(|e| self.output.name_of(&self.core, Some(&e.id)));
        let top_in = priority::select_priority_target(self.input.endpoints(), &self.core.settings, input).map(|e| self.input.name_of(&self.core, Some(&e.id)));
        ProfileView {
            id: p.id.clone(),
            name: p.name.clone(),
            pal: p.pal.clone(),
            top_output: top_out,
            top_input: top_in,
            output_mode: output.mode,
            input_mode: input.mode,
        }
    }

    fn name_of(&self, id: &str) -> String {
        if self.output.endpoints().contains_key(id) {
            self.output.name_of(&self.core, Some(id))
        } else {
            self.input.name_of(&self.core, Some(id))
        }
    }

    fn memory_for(&mut self, id: &str) -> &mut DeviceMemory {
        let now = self.core.now();
        self.core.settings.devices.entry(id.to_string()).or_insert_with(|| DeviceMemory { first_seen: now, ..DeviceMemory::default() })
    }

    /// Runs a Start menu shortcut operation; failures are logged, never raised (it's a convenience).
    fn try_shortcut(&mut self, f: impl FnOnce(&mut dyn ShortcutRegistration) -> Result<(), String>) -> bool {
        let Some(s) = self.shortcut.as_mut() else { return false };
        match f(s.as_mut()) {
            Ok(()) => true,
            Err(e) => {
                self.core.log(ActivityKind::Warning, "Couldn't update the Start menu shortcut", Some(e), None, None);
                false
            }
        }
    }
}

fn clean_name(name: &str, fallback: &str) -> String {
    let n = name.trim();
    if n.is_empty() {
        fallback.to_string()
    } else {
        n.chars().take(40).collect()
    }
}
