//! Applies the mode rules for ONE side of the audio pipeline (outputs or microphones): reacts to device and
//! default-endpoint changes and performs verified switches. A port of the C# PriorityController.
//!
//! * OFF: monitor only. Manual selection and "Restore priority" still work.
//! * BALANCED: switch to the best device when devices connect/disconnect or rules change. A default chosen outside
//!   Waypoint is respected (external override) until the next device connects or the user restores priority.
//! * STRICT: the priority list always wins; external changes are reverted. A device picked in Waypoint stays pinned
//!   until "Restore priority" or until it disconnects. A loop guard pauses enforcement if another program keeps
//!   fighting.

use std::collections::{HashMap, HashSet, VecDeque};
use std::time::Duration;

use crate::audio::{AudioEndpoint, AudioFlow, ConnectionType, DefaultEndpoints, NotificationKind, AudioNotification, SwitchResult};
use crate::persistence::activity::ActivityKind;
use crate::persistence::settings::{DeviceMemory, FlowSettings, SwitchMode};

use super::priority;
use super::types::{DeviceView, FlowSnapshot, ManualOverride, OverrideSource, ServiceEvent, StuckApp, SwitchEvent};
use super::{delta, ControllerTask, Core, Task, Time, TimerId};

/// Topology changes within this window make a default change "system-driven" rather than a manual choice.
pub const SYSTEM_CHANGE_WINDOW: Duration = Duration::from_secs(4);
pub const ECHO_WINDOW: Duration = Duration::from_secs(3);
pub const TOPOLOGY_DEBOUNCE: Duration = Duration::from_millis(250);
pub const DEFAULT_DEBOUNCE: Duration = Duration::from_millis(300);
pub const DISCONNECT_DELAY: Duration = Duration::from_millis(400);
pub const RETRY_DELAY: Duration = Duration::from_millis(1500);
pub const LOOP_WINDOW: Duration = Duration::from_secs(30);
pub const LOOP_PAUSE: Duration = Duration::from_secs(60);
pub const LOOP_LIMIT: usize = 5;
pub const MAX_RETRIES: u32 = 2;
/// Apps (Discord, games…) need a moment to re-open their streams after the default changes.
pub const APP_CHECK_DELAY: Duration = Duration::from_secs(3);
pub const APP_RECHECK_DELAY: Duration = Duration::from_secs(8);

/// Processes that never count as "stuck" (Waypoint itself, Windows audio plumbing).
const IGNORED_PROCESSES: [&str; 4] = ["waypoint", "audiodg", "system", "idle"];

pub struct Controller {
    flow: AudioFlow,
    endpoints: HashMap<String, AudioEndpoint>,
    defaults: DefaultEndpoints,
    override_: Option<ManualOverride>,
    topology_timer: Option<TimerId>,
    default_timer: Option<TimerId>,
    evaluate_timer: Option<TimerId>,
    resume_timer: Option<TimerId>,
    app_check_timer: Option<TimerId>,
    pending_reason: Option<String>,
    last_switch_target: Option<String>,
    last_switch_at: Option<Time>,
    last_topology_change_at: Option<Time>,
    strict_reverts: VecDeque<Time>,
    paused_until: Option<Time>,
    retry_count: u32,
    warned_no_target: bool,
    stuck_apps: Vec<StuckApp>,
    reported_stuck: HashSet<String>,
}

impl Controller {
    pub fn new(flow: AudioFlow) -> Self {
        Self {
            flow,
            endpoints: HashMap::new(),
            defaults: DefaultEndpoints::default(),
            override_: None,
            topology_timer: None,
            default_timer: None,
            evaluate_timer: None,
            resume_timer: None,
            app_check_timer: None,
            pending_reason: None,
            last_switch_target: None,
            last_switch_at: None,
            last_topology_change_at: None,
            strict_reverts: VecDeque::new(),
            paused_until: None,
            retry_count: 0,
            warned_no_target: false,
            stuck_apps: Vec::new(),
            reported_stuck: HashSet::new(),
        }
    }

    pub fn flow(&self) -> AudioFlow {
        self.flow
    }

    pub fn override_(&self) -> Option<&ManualOverride> {
        self.override_.as_ref()
    }

    pub fn current_default_id(&self) -> Option<&str> {
        self.defaults.console.as_deref()
    }

    pub fn endpoints(&self) -> &HashMap<String, AudioEndpoint> {
        &self.endpoints
    }

    pub fn enforcement_paused_until(&self) -> Option<Time> {
        self.paused_until
    }

    fn is_input(&self) -> bool {
        self.flow == AudioFlow::Capture
    }

    fn noun(&self) -> &'static str {
        if self.is_input() {
            "microphone"
        } else {
            "output"
        }
    }

    fn settings<'a>(&self, c: &'a Core) -> &'a FlowSettings {
        c.settings.flow(self.flow)
    }

    // ───────────────────────────── lifecycle ─────────────────────────────

    pub fn initialize(&mut self, c: &mut Core) {
        let endpoints = c.audio.endpoints(self.flow);
        self.endpoints = endpoints.iter().map(|e| (e.id.clone(), e.clone())).collect();
        self.defaults = c.audio.defaults(self.flow);

        let first_run = self.settings(c).priority.is_empty();
        self.merge_new_devices(c, !first_run);
        for e in endpoints.iter().filter(|e| e.is_available()) {
            self.remember(c, e, true);
        }
        if first_run && !endpoints.is_empty() {
            let what = if self.is_input() { "inputs" } else { "outputs" };
            self.log(c, ActivityKind::Discovered, format!("Found {} audio {what}", endpoints.len()), Some("Ranked automatically — drag to reorder.".into()), None);
        }
        self.schedule_evaluate(c, Duration::ZERO, "startup");
    }

    /// Feed raw notifications (already on the runtime thread).
    pub fn on_audio_notification(&mut self, c: &mut Core, n: &AudioNotification) {
        if n.kind == NotificationKind::DefaultChanged {
            if matches!(n.flow, Some(f) if f != self.flow) {
                return;
            }
            Self::reschedule(c, &mut self.default_timer, DEFAULT_DEBOUNCE, Task::Controller(self.flow, ControllerTask::CheckDefaults));
        } else {
            Self::reschedule(c, &mut self.topology_timer, TOPOLOGY_DEBOUNCE, Task::Controller(self.flow, ControllerTask::Topology));
        }
    }

    /// Runs a task this controller scheduled.
    pub fn run(&mut self, c: &mut Core, task: ControllerTask) {
        match task {
            ControllerTask::Topology => {
                self.topology_timer = None;
                self.refresh_topology(c);
            }
            ControllerTask::CheckDefaults => {
                self.default_timer = None;
                self.check_defaults(c);
            }
            ControllerTask::Evaluate(reason) => {
                self.evaluate_timer = None;
                self.pending_reason = None;
                self.evaluate(c, &reason);
            }
            ControllerTask::Resume => {
                self.resume_timer = None;
                self.paused_until = None;
                self.log(c, ActivityKind::Info, "STRICT enforcement resumed", None, None);
                self.evaluate(c, "resume");
            }
            ControllerTask::AppCheck { recheck } => {
                self.app_check_timer = None;
                self.check_apps(c);
                // Some apps re-open their streams lazily; look once more before concluding.
                if recheck && !self.stuck_apps.is_empty() {
                    self.schedule_app_check(c, APP_RECHECK_DELAY, false);
                }
            }
        }
    }

    // ───────────────────────────── user commands ─────────────────────────────

    pub fn set_mode(&mut self, c: &mut Core, mode: SwitchMode) {
        if self.settings(c).mode == mode {
            return;
        }
        c.settings.flow_mut(self.flow).mode = mode;
        self.override_ = None;
        self.reset_loop_guard(c);
        let scope = if self.is_input() { "Microphone mode" } else { "Mode" };
        let description = match mode {
            SwitchMode::Off => "Monitoring only. Waypoint won't switch automatically.".to_string(),
            SwitchMode::Balanced => "Switches on connect and disconnect, and respects manual changes.".to_string(),
            SwitchMode::Strict => format!("Your priority list always wins. Outside changes to the {} are reverted.", self.noun()),
        };
        self.log(c, ActivityKind::ModeChanged, format!("{scope} set to {}", mode.name()), Some(description), None);
        c.save();
        self.schedule_evaluate(c, Duration::ZERO, "mode");
        c.schedule_publish();
    }

    pub fn reorder(&mut self, c: &mut Core, ids: &[String]) {
        let next = priority::apply_reorder(&self.settings(c).priority, ids);
        if next == self.settings(c).priority {
            return;
        }
        c.settings.flow_mut(self.flow).priority = next;
        let top = priority::select_priority_target(&self.endpoints, &c.settings, self.settings(c)).map(|e| self.display_name(c, e));
        let title = if self.is_input() { "Microphone priority updated" } else { "Priority order updated" };
        self.log(c, ActivityKind::PriorityChanged, title, top.map(|t| format!("Top available: {t}")), None);
        c.save();
        self.schedule_evaluate(c, Duration::ZERO, "priority");
        c.schedule_publish();
    }

    pub fn set_excluded(&mut self, c: &mut Core, id: &str, excluded: bool) {
        let set = &mut c.settings.flow_mut(self.flow).excluded;
        let changed = if excluded { set.insert(id.to_string()) } else { set.remove(id) };
        if !changed {
            return;
        }
        let name = self.name_of(c, Some(id));
        let title = if excluded { format!("{name} excluded from auto-switching") } else { format!("{name} included in auto-switching") };
        self.log(c, ActivityKind::Settings, title, None, Some(id.to_string()));
        c.save();
        self.schedule_evaluate(c, Duration::ZERO, "rules");
        c.schedule_publish();
    }

    /// User picked a device in Waypoint (window, tray or hotkey). Becomes a manual override (pinned in STRICT).
    pub fn select_device(&mut self, c: &mut Core, id: &str, cause: &str) -> SwitchResult {
        let Some(device) = self.endpoints.get(id).filter(|e| e.is_available()).cloned() else {
            let name = self.name_of(c, Some(id));
            self.log(c, ActivityKind::SwitchFailed, format!("Can't switch to {name}"), Some("The device is not connected.".into()), Some(id.to_string()));
            c.schedule_publish();
            return SwitchResult::fail("The device is not connected.");
        };

        let priority_top = priority::select_priority_target(&self.endpoints, &c.settings, self.settings(c)).map(|e| e.id.clone());
        let mode = self.settings(c).mode;
        if mode != SwitchMode::Off {
            if priority_top.as_deref() == Some(id) {
                self.override_ = None; // choosing the top device is the same as following priority
            } else {
                self.override_ = Some(ManualOverride { device_id: id.to_string(), source: OverrideSource::App, since: c.now() });
                let detail = if mode == SwitchMode::Strict {
                    "Pinned until you restore priority or the device disconnects."
                } else {
                    "Held until another device connects or you restore priority."
                };
                let name = self.display_name(c, &device);
                self.log(c, ActivityKind::Override, format!("Manual override: {name}"), Some(detail.into()), Some(id.to_string()));
            }
        }

        self.retry_count = 0;
        if self.in_sync(c, id) {
            c.schedule_publish();
            return SwitchResult::ok("Already the default", self.defaults.clone());
        }
        self.perform_switch(c, &device, cause)
    }

    /// Selects the next/previous connected device in priority order.
    pub fn cycle(&mut self, c: &mut Core, direction: i32) -> Option<SwitchResult> {
        let next = priority::cycle(&self.endpoints, &c.settings, self.settings(c), self.defaults.console.as_deref(), direction)?.id.clone();
        Some(self.select_device(c, &next, "hotkey"))
    }

    /// Drop any override and switch to the top priority device. Works in every mode.
    pub fn restore_priority(&mut self, c: &mut Core) -> Option<SwitchResult> {
        let had_override = self.override_.take().is_some();
        self.reset_loop_guard(c);
        let target = priority::select_priority_target(&self.endpoints, &c.settings, self.settings(c)).cloned();
        let title = if self.is_input() { "Microphone priority restored" } else { "Priority restored" };
        let detail = match &target {
            None => format!("No ranked {} is connected.", self.noun()),
            Some(t) => format!("Target: {}{}", self.display_name(c, t), if had_override { " (override cleared)" } else { "" }),
        };
        self.log(c, ActivityKind::Restored, title, Some(detail), None);
        if let Some(t) = &target {
            if !self.in_sync(c, &t.id) {
                self.retry_count = 0;
                return Some(self.perform_switch(c, t, "restore"));
            }
        }
        c.schedule_publish();
        target.map(|_| SwitchResult::ok("Already the default", self.defaults.clone()))
    }

    pub fn reset_priorities(&mut self, c: &mut Core) {
        let f = c.settings.flow_mut(self.flow);
        f.priority.clear();
        f.excluded.clear();
        self.override_ = None;
        self.merge_new_devices(c, false);
        let title = if self.is_input() { "Microphone list reset to the recommended order" } else { "Priority list reset to the recommended order" };
        self.log(c, ActivityKind::PriorityChanged, title, None, None);
        c.save();
        self.schedule_evaluate(c, Duration::ZERO, "priority");
        c.schedule_publish();
    }

    /// The flow settings were replaced (profile switch): drop overrides, add unknown devices, apply.
    pub fn on_settings_replaced(&mut self, c: &mut Core) {
        self.override_ = None;
        self.reset_loop_guard(c);
        self.merge_new_devices(c, false);
        self.schedule_evaluate(c, Duration::ZERO, "profile");
    }

    /// Re-applies the rules after a global setting changed.
    pub fn reevaluate(&mut self, c: &mut Core, reason: &str) {
        self.schedule_evaluate(c, Duration::ZERO, reason);
    }

    /// Re-reads everything from Windows (e.g. after resume from sleep).
    pub fn rescan(&mut self, c: &mut Core) {
        self.refresh_topology(c);
    }

    pub fn reset_loop_guard(&mut self, c: &mut Core) {
        self.strict_reverts.clear();
        self.paused_until = None;
        if let Some(t) = self.resume_timer.take() {
            c.sched.cancel(t);
        }
    }

    pub fn snapshot(&self, c: &mut Core) -> FlowSnapshot {
        let target = priority::select_target(&self.endpoints, &c.settings, self.settings(c), self.override_.as_ref()).map(|e| e.id.clone());
        let priority_target = priority::select_priority_target(&self.endpoints, &c.settings, self.settings(c)).map(|e| e.id.clone());
        let mut devices = Vec::new();
        let mut rank = 0;
        let ids = self.settings(c).priority.clone();

        for id in &ids {
            let Some(e) = self.endpoints.get(id) else { continue }; // removed endpoint (driver uninstalled)
            if e.connection == ConnectionType::Virtual && !c.settings.show_virtual_devices {
                continue;
            }
            rank += 1;
            let memory = c.settings.devices.get(id).cloned();
            let volume = if e.is_available() { c.audio.volume(id) } else { None };
            devices.push(DeviceView {
                id: id.clone(),
                name: self.display_name(c, e),
                friendly_name: e.friendly_name.clone(),
                alias: memory.as_ref().and_then(|m| m.alias.clone()),
                adapter_name: e.adapter_name.clone(),
                description: e.description.clone(),
                kind: e.kind,
                connection: e.connection,
                state: e.state,
                rank,
                is_default: self.defaults.console.as_deref() == Some(id),
                is_communications_default: self.defaults.communications.as_deref() == Some(id),
                excluded: self.settings(c).excluded.contains(id),
                auto_excluded: priority::is_auto_excluded(e, &c.settings),
                is_target: target.as_deref() == Some(id),
                last_connected: memory.as_ref().and_then(|m| m.last_connected),
                volume,
                switch_volume: memory.as_ref().and_then(|m| m.switch_volume),
            });
        }

        FlowSnapshot {
            flow: self.flow,
            devices,
            mode: self.settings(c).mode,
            default_id: self.defaults.console.clone(),
            target_id: target,
            priority_target_id: priority_target,
            override_: self.override_.clone(),
            enforcement_paused_until: self.paused_until,
            busy: self.evaluate_timer.is_some(),
            pending_reason: self.pending_reason.clone(),
            stuck_apps: self.stuck_apps.clone(),
        }
    }

    pub fn name_of(&self, c: &Core, id: Option<&str>) -> String {
        let Some(id) = id else { return format!("no {}", self.noun()) };
        if let Some(e) = self.endpoints.get(id) {
            return self.display_name(c, e);
        }
        c.settings
            .devices
            .get(id)
            .and_then(|m| m.alias.clone().or_else(|| m.last_known_name.clone()))
            .unwrap_or_else(|| "Unknown device".into())
    }

    // ───────────────────────────── event handling ─────────────────────────────

    fn refresh_topology(&mut self, c: &mut Core) {
        let previous = std::mem::take(&mut self.endpoints);
        let current: HashMap<String, AudioEndpoint> = c.audio.endpoints(self.flow).into_iter().map(|e| (e.id.clone(), e)).collect();
        self.endpoints = current;

        let mut connected = Vec::new();
        let mut disconnected = Vec::new();
        for e in self.endpoints.values() {
            let was = previous.get(&e.id).is_some_and(|o| o.is_available());
            if e.is_available() && !was {
                connected.push(e.clone());
            } else if !e.is_available() && was {
                disconnected.push(e.clone());
            }
        }
        for old in previous.values().filter(|o| o.is_available() && !self.endpoints.contains_key(&o.id)) {
            disconnected.push(old.clone());
        }

        self.merge_new_devices(c, true);

        for e in &connected {
            self.remember(c, e, true);
            if !self.is_quiet(c, e) {
                let name = self.display_name(c, e);
                self.log(c, ActivityKind::Connected, format!("{name} connected"), Some(connection_label(e.connection).into()), Some(e.id.clone()));
            }
        }
        for e in &disconnected {
            if !self.is_quiet(c, e) {
                let name = self.display_name(c, e);
                self.log(c, ActivityKind::Disconnected, format!("{name} disconnected"), None, Some(e.id.clone()));
            }
        }

        if !connected.is_empty() || !disconnected.is_empty() {
            self.last_topology_change_at = Some(c.now());
            self.warned_no_target = false;
        }

        // Override lifecycle.
        if let Some(o) = self.override_.clone() {
            if disconnected.iter().any(|d| d.id == o.device_id) || !self.endpoints.contains_key(&o.device_id) {
                let name = self.name_of(c, Some(&o.device_id));
                self.log(c, ActivityKind::Override, "Override ended", Some(format!("{name} disconnected — following priority again.")), None);
                self.override_ = None;
            } else if self.settings(c).mode == SwitchMode::Balanced && connected.iter().any(|e| priority::is_eligible(e, &c.settings, self.settings(c))) {
                self.log(c, ActivityKind::Override, "Override ended", Some("A device connected — following priority again.".into()), None);
                self.override_ = None;
            }
        }

        self.defaults = c.audio.defaults(self.flow);
        if !connected.is_empty() || !disconnected.is_empty() {
            c.save();
        }

        if connected.iter().any(|e| priority::is_eligible(e, &c.settings, self.settings(c))) {
            self.retry_count = 0;
            let settle = Duration::from_millis(c.settings.settle_delay_ms.max(0) as u64);
            self.schedule_evaluate(c, settle, "connect");
        } else if !disconnected.is_empty() {
            self.retry_count = 0;
            self.schedule_evaluate(c, DISCONNECT_DELAY, "disconnect");
        } else if !connected.is_empty() {
            self.schedule_evaluate(c, Duration::ZERO, "topology");
        }
        c.schedule_publish();
    }

    fn check_defaults(&mut self, c: &mut Core) {
        let observed = c.audio.defaults(self.flow);
        if observed == self.defaults {
            c.schedule_publish();
            return;
        }
        self.defaults = observed.clone();
        let now = c.now();
        let current = observed.console.clone();

        // Our own switch echoing back.
        if current.is_some() && current == self.last_switch_target && self.last_switch_at.is_some_and(|t| now - t < delta(ECHO_WINDOW)) {
            c.schedule_publish();
            return;
        }

        // A switch is already scheduled (a device just connected/disconnected): Windows' own reaction to the
        // topology change, not a user choice. The pending evaluation will decide.
        let system_driven = self.evaluate_timer.is_some()
            || self.topology_timer.is_some()
            || self.last_topology_change_at.is_some_and(|t| now - t < delta(SYSTEM_CHANGE_WINDOW));
        let target = priority::select_target(&self.endpoints, &c.settings, self.settings(c), self.override_.as_ref()).cloned();
        let (Some(current), Some(target)) = (current, target) else {
            c.schedule_publish();
            return;
        };
        if current == target.id && self.in_sync(c, &target.id) {
            c.schedule_publish();
            return;
        }

        let system_delay = Duration::from_millis(c.settings.settle_delay_ms.max(300) as u64);
        match self.settings(c).mode {
            SwitchMode::Off => {
                let what = if self.is_input() { "Microphone" } else { "Output" };
                let name = self.name_of(c, Some(&current));
                self.log(c, ActivityKind::ExternalChange, format!("{what} changed to {name}"), Some("Changed outside Waypoint.".into()), Some(current.clone()));
            }
            SwitchMode::Balanced if system_driven => self.schedule_evaluate(c, system_delay, "system"),
            SwitchMode::Balanced => {
                if current != target.id {
                    // (When only a role such as Communications drifted, leave it.)
                    self.override_ = Some(ManualOverride { device_id: current.clone(), source: OverrideSource::External, since: now });
                    let name = self.name_of(c, Some(&current));
                    self.log(
                        c,
                        ActivityKind::ExternalChange,
                        format!("Respecting your choice: {name}"),
                        Some("Changed outside Waypoint. Priority resumes when a device connects or you restore it.".into()),
                        Some(current.clone()),
                    );
                }
            }
            SwitchMode::Strict => {
                if system_driven {
                    self.schedule_evaluate(c, system_delay, "system");
                } else if self.paused_until.is_some_and(|until| now < until) || self.trip_loop_guard(c, now) {
                    // Paused, or the loop guard just tripped.
                } else {
                    let name = self.name_of(c, Some(&current));
                    let keep = self.display_name(c, &target);
                    self.log(c, ActivityKind::Reverted, format!("Reverted change to {name}"), Some(format!("STRICT keeps {keep} as the {}.", self.noun())), Some(current.clone()));
                    self.retry_count = 0;
                    self.perform_switch(c, &target, "strict");
                    return;
                }
            }
        }
        c.schedule_publish();
    }

    fn schedule_evaluate(&mut self, c: &mut Core, delay: Duration, reason: &str) {
        self.pending_reason = Some(reason.to_string());
        Self::reschedule(c, &mut self.evaluate_timer, delay, Task::Controller(self.flow, ControllerTask::Evaluate(reason.to_string())));
    }

    fn evaluate(&mut self, c: &mut Core, reason: &str) {
        let mode = self.settings(c).mode;
        if mode == SwitchMode::Off || !c.audio.can_switch() {
            c.schedule_publish();
            return;
        }
        if mode == SwitchMode::Strict && self.paused_until.is_some_and(|until| c.now() < until) {
            c.schedule_publish();
            return;
        }

        let Some(target) = priority::select_target(&self.endpoints, &c.settings, self.settings(c), self.override_.as_ref()).cloned() else {
            if !self.warned_no_target && matches!(reason, "disconnect" | "startup") {
                self.warned_no_target = true;
                let current = self.name_of(c, self.defaults.console.clone().as_deref());
                self.log(c, ActivityKind::Warning, format!("No preferred {} available", self.noun()), Some(format!("Leaving Windows on {current}.")), None);
            }
            c.schedule_publish();
            return;
        };

        if self.in_sync(c, &target.id) {
            // Windows often falls back on its own when a device disconnects; record that the result matches priority.
            if reason == "disconnect" {
                let verb = if self.is_input() { "Now recording from" } else { "Now playing on" };
                let name = self.display_name(c, &target);
                self.log(c, ActivityKind::Info, format!("{verb} {name}"), Some(format!("Next available {} in your priority list.", self.noun())), Some(target.id.clone()));
            }
            c.schedule_publish();
            return;
        }
        self.perform_switch(c, &target, reason);
    }

    fn perform_switch(&mut self, c: &mut Core, target: &AudioEndpoint, cause: &str) -> SwitchResult {
        let result = c.audio.set_default(self.flow, &target.id, c.settings.include_communications_role);
        self.last_switch_target = Some(target.id.clone());
        self.last_switch_at = Some(c.now());
        self.defaults = result.observed.clone().unwrap_or_else(|| c.audio.defaults(self.flow));
        let name = self.display_name(c, target);

        if result.verified {
            self.retry_count = 0;
            self.stuck_apps.clear();
            self.reported_stuck.clear();
            self.schedule_app_check(c, APP_CHECK_DELAY, true);
            let mut detail = format!("{} · {}", cause_label(cause), result.message);
            if let Some(applied) = self.apply_switch_volume(c, target) {
                detail += &format!(" · volume set to {:.0}%", applied * 100.0);
            }
            self.log(c, ActivityKind::Switched, format!("Switched to {name}"), Some(detail), Some(target.id.clone()));
        } else {
            let can_retry = matches!(cause, "connect" | "system" | "disconnect" | "startup") && self.retry_count < MAX_RETRIES;
            let detail = format!("{}{}", result.message, if can_retry { " Retrying…" } else { "" });
            self.log(c, ActivityKind::SwitchFailed, format!("Couldn't switch to {name}"), Some(detail), Some(target.id.clone()));
            if can_retry {
                self.retry_count += 1;
                self.schedule_evaluate(c, RETRY_DELAY, cause);
            }
        }

        c.events.push(ServiceEvent::Switched(SwitchEvent {
            flow: self.flow,
            device_id: target.id.clone(),
            device_name: name,
            kind: target.kind,
            cause: cause.to_string(),
            result: result.clone(),
        }));
        c.schedule_publish();
        result
    }

    /// Applies the device's remembered switch volume, returning the level actually read back.
    fn apply_switch_volume(&mut self, c: &mut Core, target: &AudioEndpoint) -> Option<f32> {
        let level = c.settings.devices.get(&target.id)?.switch_volume?;
        match c.audio.set_volume(&target.id, level) {
            Some(after) => Some(after.level),
            None => {
                let name = self.display_name(c, target);
                self.log(c, ActivityKind::Warning, format!("Couldn't set the volume of {name}"), None, Some(target.id.clone()));
                None
            }
        }
    }

    /// Re-checks which apps didn't follow the current default (e.g. after the user changed an app's setting).
    pub fn recheck_apps(&mut self, c: &mut Core) {
        self.schedule_app_check(c, Duration::ZERO, false);
    }

    /// Clears Windows' per-app pin for a process so it follows the default (and Waypoint) again.
    pub fn release_app(&mut self, c: &mut Core, pid: u32) -> i32 {
        let hr = c.audio.set_app_route(pid, self.flow, "", c.settings.include_communications_role);
        let name = self.stuck_apps.iter().find(|a| a.process_id == pid).map(|a| a.process_name.clone()).unwrap_or_else(|| format!("pid {pid}"));
        if hr == 0 {
            self.log(
                c,
                ActivityKind::Settings,
                format!("{name} now follows Waypoint"),
                Some("Cleared its per-app device in Windows. New audio from it uses your current device.".into()),
                None,
            );
        } else {
            self.log(c, ActivityKind::Warning, format!("Couldn't release {name}"), Some(format!("Windows returned 0x{:08X}.", hr as u32)), None);
        }
        self.schedule_app_check(c, Duration::from_millis(1500), false);
        hr
    }

    fn schedule_app_check(&mut self, c: &mut Core, delay: Duration, recheck: bool) {
        Self::reschedule(c, &mut self.app_check_timer, delay, Task::Controller(self.flow, ControllerTask::AppCheck { recheck }));
    }

    /// Finds apps with an ACTIVE session on another connected device of this flow.
    fn check_apps(&mut self, c: &mut Core) {
        let Some(target) = self.defaults.console.clone() else {
            self.stuck_apps.clear();
            c.schedule_publish();
            return;
        };

        let mut stuck: Vec<StuckApp> = Vec::new();
        let others: Vec<AudioEndpoint> = self.endpoints.values().filter(|e| e.is_available() && e.id != target).cloned().collect();
        for e in &others {
            for s in c.audio.sessions(&e.id) {
                if s.state != 1 || s.is_system_sounds || s.process_id == 0 || IGNORED_PROCESSES.contains(&s.process_name.to_lowercase().as_str()) {
                    continue;
                }
                if stuck.iter().any(|x| x.process_name.eq_ignore_ascii_case(&s.process_name)) {
                    continue;
                }
                let route = c.audio.app_route(s.process_id, self.flow);
                stuck.push(StuckApp {
                    process_name: s.process_name.clone(),
                    process_id: s.process_id,
                    device_id: e.id.clone(),
                    device_name: self.display_name(c, e),
                    pinned_in_windows: route.is_some_and(|r| !r.is_empty()),
                });
            }
        }

        self.stuck_apps = stuck.clone();
        for app in stuck {
            if !self.reported_stuck.insert(app.process_name.clone()) {
                continue;
            }
            let detail = if app.pinned_in_windows {
                "Windows' per-app setting pins it there. Use \"Let it follow\" in Waypoint to release it.".to_string()
            } else {
                format!(
                    "{} picked that {} in its own settings. Set its {} device to \"Default\" so it follows Waypoint.",
                    app.process_name,
                    self.noun(),
                    if self.is_input() { "input" } else { "output" }
                )
            };
            self.log(c, ActivityKind::Warning, format!("{} is still on {}", app.process_name, app.device_name), Some(detail), None);
        }
        c.schedule_publish();
    }

    // ───────────────────────────── helpers ─────────────────────────────

    fn reschedule(c: &mut Core, slot: &mut Option<TimerId>, delay: Duration, task: Task) {
        if let Some(t) = slot.take() {
            c.sched.cancel(t);
        }
        *slot = Some(c.sched.schedule(delay, task));
    }

    fn trip_loop_guard(&mut self, c: &mut Core, now: Time) -> bool {
        if !c.settings.strict_loop_guard {
            return false;
        }
        while self.strict_reverts.front().is_some_and(|t| now - *t > delta(LOOP_WINDOW)) {
            self.strict_reverts.pop_front();
        }
        self.strict_reverts.push_back(now);
        if self.strict_reverts.len() <= LOOP_LIMIT {
            return false;
        }

        self.paused_until = Some(now + delta(LOOP_PAUSE));
        self.strict_reverts.clear();
        self.log(
            c,
            ActivityKind::Warning,
            "STRICT paused for 60 seconds",
            Some(format!("Another program keeps changing the default {}. Waypoint backed off to avoid a switching loop.", self.noun())),
            None,
        );
        Self::reschedule(c, &mut self.resume_timer, LOOP_PAUSE, Task::Controller(self.flow, ControllerTask::Resume));
        true
    }

    fn in_sync(&self, c: &Core, id: &str) -> bool {
        self.defaults.console.as_deref() == Some(id)
            && self.defaults.multimedia.as_deref() == Some(id)
            && (!c.settings.include_communications_role || self.defaults.communications.as_deref() == Some(id))
    }

    fn merge_new_devices(&mut self, c: &mut Core, log_each: bool) {
        let (merged, added) = priority::merge_new_devices(&self.settings(c).priority, self.endpoints.values());
        c.settings.flow_mut(self.flow).priority = merged;
        for e in added {
            self.memory_for(c, &e.id).last_known_name = Some(e.friendly_name.clone());
            if log_each && !self.is_quiet(c, &e) {
                let name = self.display_name(c, &e);
                self.log(c, ActivityKind::Discovered, format!("New {}: {name}", self.noun()), Some("Added to the bottom of your priority list.".into()), Some(e.id.clone()));
            }
        }
    }

    /// Hands-Free / virtual endpoints mirror a "real" device; logging them separately is noise.
    fn is_quiet(&self, c: &Core, e: &AudioEndpoint) -> bool {
        priority::is_auto_excluded(e, &c.settings)
    }

    fn memory_for<'a>(&self, c: &'a mut Core, id: &str) -> &'a mut DeviceMemory {
        let now = c.now();
        c.settings.devices.entry(id.to_string()).or_insert_with(|| DeviceMemory { first_seen: now, ..DeviceMemory::default() })
    }

    fn remember(&self, c: &mut Core, e: &AudioEndpoint, connected: bool) {
        let now = c.now();
        let m = self.memory_for(c, &e.id);
        m.last_known_name = Some(e.friendly_name.clone());
        if connected {
            m.last_connected = Some(now);
        }
    }

    fn display_name(&self, c: &Core, e: &AudioEndpoint) -> String {
        c.settings.devices.get(&e.id).and_then(|m| m.alias.clone()).unwrap_or_else(|| e.friendly_name.clone())
    }

    fn log(&self, c: &mut Core, kind: ActivityKind, title: impl Into<String>, detail: Option<String>, device_id: Option<String>) {
        c.log(kind, title, detail, device_id, Some(self.flow));
    }
}

fn cause_label(cause: &str) -> &'static str {
    match cause {
        "connect" => "Higher-priority device connected",
        "disconnect" => "Fallback after disconnect",
        "manual" => "Selected manually",
        "hotkey" => "Selected with a hotkey",
        "restore" => "Priority restored",
        "strict" => "STRICT enforcement",
        "startup" => "Applied priority at startup",
        "priority" => "Priority order changed",
        "profile" => "Profile changed",
        "mode" => "Mode changed",
        "rules" => "Rules changed",
        "system" => "Corrected Windows' automatic choice",
        "resume" => "STRICT resumed",
        _ => "Priority applied",
    }
}

pub fn connection_label(c: ConnectionType) -> &'static str {
    match c {
        ConnectionType::Bluetooth => "Bluetooth",
        ConnectionType::BluetoothHandsFree => "Bluetooth Hands-Free",
        ConnectionType::Usb => "USB",
        ConnectionType::BuiltIn => "Built-in",
        ConnectionType::Display => "HDMI / DisplayPort",
        ConnectionType::Virtual => "Virtual",
        ConnectionType::Other => "Other",
    }
}
