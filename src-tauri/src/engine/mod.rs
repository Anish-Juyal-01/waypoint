//! Everything Waypoint decides, minus the UI: the priority rules, one controller per flow, profiles, settings and
//! the snapshot the UI renders. Single-threaded: it all runs on the runtime thread, so nothing needs locks.
//!
//! Delayed work (debounces, settle delays, retries) goes through a [`Scheduler`] as plain [`Task`] values that are
//! handed back to the service when due, which keeps the engine deterministic under test.

pub mod controller;
pub mod priority;
pub mod runtime;
pub mod service;
#[cfg(test)]
pub mod testing;
#[cfg(test)]
mod tests;
pub mod types;

use std::time::Duration;

use chrono::{DateTime, FixedOffset};

use crate::audio::{AudioFlow, AudioSystem};
use crate::persistence::activity::{ActivityKind, ActivityLog};
use crate::persistence::settings::{AppSettings, SettingsStore};
use types::ServiceEvent;

pub type Time = DateTime<FixedOffset>;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct TimerId(pub u64);

/// Work the engine scheduled for later.
#[derive(Clone, Debug, PartialEq)]
pub enum Task {
    Controller(AudioFlow, ControllerTask),
    Publish,
}

#[derive(Clone, Debug, PartialEq)]
pub enum ControllerTask {
    Topology,
    CheckDefaults,
    Evaluate(String),
    Resume,
    AppCheck { recheck: bool },
}

/// Clock + delayed execution.
pub trait Scheduler {
    fn now(&self) -> Time;
    fn schedule(&mut self, delay: Duration, task: Task) -> TimerId;
    fn cancel(&mut self, id: TimerId);
}

/// "Start with Windows" registration (a null object in tests).
pub trait StartupRegistration {
    fn is_enabled(&mut self) -> bool;
    /// The existing startup command when it points at a different executable (e.g. another copy).
    fn foreign_command(&mut self) -> Option<String>;
    fn set_enabled(&mut self, enabled: bool) -> Result<(), String>;
}

/// The Start menu shortcut (a null object in tests).
pub trait ShortcutRegistration {
    fn exists(&self) -> bool;
    /// Creates the shortcut if missing (or if the program it opens is gone).
    fn ensure_present(&mut self) -> Result<(), String>;
    fn set_enabled(&mut self, enabled: bool) -> Result<(), String>;
}

/// The state the controllers share: audio, settings, the log, the clock and the outgoing events.
pub struct Core {
    pub audio: Box<dyn AudioSystem>,
    pub settings: AppSettings,
    pub log: ActivityLog,
    pub sched: Box<dyn Scheduler>,
    pub store: Option<SettingsStore>,
    pub events: Vec<ServiceEvent>,
    publish_pending: bool,
}

impl Core {
    pub fn new(audio: Box<dyn AudioSystem>, settings: AppSettings, log: ActivityLog, sched: Box<dyn Scheduler>, store: Option<SettingsStore>) -> Self {
        Self { audio, settings, log, sched, store, events: Vec::new(), publish_pending: false }
    }

    pub fn now(&self) -> Time {
        self.sched.now()
    }

    pub fn log(&mut self, kind: ActivityKind, title: impl Into<String>, detail: Option<String>, device_id: Option<String>, flow: Option<AudioFlow>) {
        let entry = self.log.add(kind, title, detail, device_id, flow);
        self.events.push(ServiceEvent::ActivityAdded(entry));
    }

    pub fn save(&mut self) {
        if let Some(store) = &self.store {
            if let Err(e) = store.save(&mut self.settings) {
                self.log.add(ActivityKind::Warning, "Couldn't save settings", Some(e.to_string()), None, None);
            }
        }
    }

    /// Coalesces bursts of changes (a switch touches both state and log) into one snapshot.
    pub fn schedule_publish(&mut self) {
        if self.publish_pending {
            return;
        }
        self.publish_pending = true;
        self.sched.schedule(Duration::ZERO, Task::Publish);
    }

    pub(crate) fn publish_done(&mut self) {
        self.publish_pending = false;
    }
}

pub(crate) fn delta(d: Duration) -> chrono::TimeDelta {
    chrono::TimeDelta::from_std(d).unwrap_or(chrono::TimeDelta::MAX)
}
