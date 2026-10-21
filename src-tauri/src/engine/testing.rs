//! Test doubles: an in-memory audio system, a manual clock, and a harness that wires them to a [`Service`] the way
//! the runtime does. Time only moves when a test advances it.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::time::Duration;

use chrono::{TimeZone, Utc};

use crate::audio::*;
use crate::persistence::activity::{ActivityKind, ActivityLog};
use crate::persistence::settings::{AppSettings, SwitchMode};

use super::service::Service;
use super::{delta, Core, Scheduler, Task, Time, TimerId};

#[derive(Default)]
pub struct FakeState {
    pub endpoints: HashMap<String, AudioEndpoint>,
    pub order: Vec<String>,
    pub defaults: HashMap<bool, [Option<String>; 3]>, // keyed by "is capture"
    pub volumes: HashMap<String, VolumeInfo>,
    pub sessions: HashMap<String, Vec<AudioSessionInfo>>,
    pub routes: HashMap<u32, String>,
    pub cannot_switch: bool,
    pub fail_next_switch: bool,
    pub switch_calls: usize,
}

#[derive(Clone, Default)]
pub struct FakeAudio(pub Rc<RefCell<FakeState>>);

impl FakeAudio {
    fn defaults_of(&self, flow: AudioFlow) -> [Option<String>; 3] {
        self.0.borrow().defaults.get(&(flow == AudioFlow::Capture)).cloned().unwrap_or_default()
    }
}

impl AudioSystem for FakeAudio {
    fn can_switch(&self) -> bool {
        !self.0.borrow().cannot_switch
    }

    fn switch_unavailable_reason(&self) -> Option<String> {
        self.0.borrow().cannot_switch.then(|| "test".into())
    }

    fn endpoints(&mut self, flow: AudioFlow) -> Vec<AudioEndpoint> {
        let s = self.0.borrow();
        s.order.iter().filter_map(|id| s.endpoints.get(id)).filter(|e| e.flow == flow).cloned().collect()
    }

    fn defaults(&mut self, flow: AudioFlow) -> DefaultEndpoints {
        let [console, multimedia, communications] = self.defaults_of(flow);
        DefaultEndpoints { console, multimedia, communications }
    }

    fn set_default(&mut self, flow: AudioFlow, device_id: &str, include_communications: bool) -> SwitchResult {
        {
            let mut s = self.0.borrow_mut();
            s.switch_calls += 1;
            if s.fail_next_switch {
                s.fail_next_switch = false;
                drop(s);
                return SwitchResult { observed: Some(self.defaults(flow)), ..SwitchResult::fail("simulated failure") };
            }
            let d = s.defaults.entry(flow == AudioFlow::Capture).or_default();
            d[0] = Some(device_id.into());
            d[1] = Some(device_id.into());
            if include_communications {
                d[2] = Some(device_id.into());
            }
        }
        SwitchResult::ok("ok", self.defaults(flow))
    }

    fn peak(&mut self, _device_id: &str) -> Option<f32> {
        Some(0.0)
    }

    fn volume(&mut self, device_id: &str) -> Option<VolumeInfo> {
        let s = self.0.borrow();
        s.endpoints.get(device_id).filter(|e| e.is_available()).and_then(|_| s.volumes.get(device_id).copied())
    }

    fn set_volume(&mut self, device_id: &str, level: f32) -> Option<VolumeInfo> {
        let v = VolumeInfo { level: level.clamp(0.0, 1.0), ..self.volume(device_id)? };
        self.0.borrow_mut().volumes.insert(device_id.into(), v);
        Some(v)
    }

    fn set_mute(&mut self, device_id: &str, muted: bool) -> Option<VolumeInfo> {
        let v = VolumeInfo { muted, ..self.volume(device_id)? };
        self.0.borrow_mut().volumes.insert(device_id.into(), v);
        Some(v)
    }

    fn sessions(&mut self, device_id: &str) -> Vec<AudioSessionInfo> {
        self.0.borrow().sessions.get(device_id).cloned().unwrap_or_default()
    }

    fn app_route(&mut self, pid: u32, _flow: AudioFlow) -> Option<String> {
        Some(self.0.borrow().routes.get(&pid).cloned().unwrap_or_default())
    }

    fn set_app_route(&mut self, pid: u32, _flow: AudioFlow, endpoint_id: &str, _include_communications: bool) -> i32 {
        let mut s = self.0.borrow_mut();
        if endpoint_id.is_empty() {
            s.routes.remove(&pid);
        } else {
            s.routes.insert(pid, endpoint_id.into());
        }
        0
    }
}

struct Item {
    id: u64,
    due: Time,
    task: Task,
}

#[derive(Default)]
pub struct ClockState {
    now: Option<Time>,
    next_id: u64,
    items: Vec<Item>,
}

#[derive(Clone)]
pub struct ManualClock(Rc<RefCell<ClockState>>);

impl ManualClock {
    pub fn new() -> Self {
        let start = Utc.with_ymd_and_hms(2026, 1, 1, 12, 0, 0).unwrap().fixed_offset();
        Self(Rc::new(RefCell::new(ClockState { now: Some(start), ..ClockState::default() })))
    }

    /// Removes and returns the earliest task due at or before `until`, moving the clock to its due time.
    fn pop_due(&self, until: Time) -> Option<Task> {
        let mut s = self.0.borrow_mut();
        let index = s.items.iter().enumerate().filter(|(_, i)| i.due <= until).min_by_key(|(_, i)| (i.due, i.id)).map(|(n, _)| n)?;
        let item = s.items.remove(index);
        if Some(item.due) > s.now {
            s.now = Some(item.due);
        }
        Some(item.task)
    }
}

impl Scheduler for ManualClock {
    fn now(&self) -> Time {
        self.0.borrow().now.unwrap()
    }

    fn schedule(&mut self, delay: Duration, task: Task) -> TimerId {
        let mut s = self.0.borrow_mut();
        s.next_id += 1;
        let id = s.next_id;
        let due = s.now.unwrap() + delta(delay);
        s.items.push(Item { id, due, task });
        TimerId(id)
    }

    fn cancel(&mut self, id: TimerId) {
        self.0.borrow_mut().items.retain(|i| i.id != id.0);
    }
}

/// A fake world plus a service, driven like the runtime drives the real one.
pub struct Harness {
    pub audio: FakeAudio,
    pub clock: ManualClock,
    pub svc: Option<Service>,
}

impl Harness {
    pub fn new() -> Self {
        Self { audio: FakeAudio::default(), clock: ManualClock::new(), svc: None }
    }

    pub fn svc(&mut self) -> &mut Service {
        self.svc.as_mut().expect("call start() first")
    }

    // ── world setup ──

    pub fn add(&mut self, id: &str, connection: ConnectionType, kind: DeviceKind, active: bool, flow: AudioFlow) -> &mut Self {
        let mut s = self.audio.0.borrow_mut();
        s.endpoints.insert(
            id.into(),
            AudioEndpoint {
                id: id.into(),
                friendly_name: id.into(),
                description: String::new(),
                adapter_name: String::new(),
                flow,
                state: if active { EndpointState::Active } else { EndpointState::Unplugged },
                connection,
                kind,
                form_factor: -1,
            },
        );
        if !s.order.iter().any(|o| o == id) {
            s.order.push(id.into());
        }
        s.volumes.entry(id.into()).or_insert(VolumeInfo { level: 0.5, muted: false });
        drop(s);
        self
    }

    pub fn buds(&mut self, id: &str, active: bool) -> &mut Self {
        self.add(id, ConnectionType::Bluetooth, DeviceKind::Earbuds, active, AudioFlow::Render)
    }

    pub fn speaker(&mut self, id: &str, connection: ConnectionType) -> &mut Self {
        self.add(id, connection, DeviceKind::Speakers, true, AudioFlow::Render)
    }

    pub fn mic(&mut self, id: &str, connection: ConnectionType, active: bool) -> &mut Self {
        self.add(id, connection, DeviceKind::Microphone, active, AudioFlow::Capture)
    }

    fn flow_of(&self, id: &str) -> AudioFlow {
        self.audio.0.borrow().endpoints[id].flow
    }

    pub fn set_default_silently(&mut self, id: &str) {
        let flow = self.flow_of(id);
        let d = Some(id.to_string());
        self.audio.0.borrow_mut().defaults.insert(flow == AudioFlow::Capture, [d.clone(), d.clone(), d]);
    }

    // ── events (delivered to the service like Core Audio callbacks) ──

    pub fn set_state(&mut self, id: &str, active: bool) {
        self.audio.0.borrow_mut().endpoints.get_mut(id).unwrap().state = if active { EndpointState::Active } else { EndpointState::Unplugged };
        self.notify(AudioNotification { kind: NotificationKind::StateChanged, device_id: Some(id.into()), flow: None });
    }

    /// Simulates Windows Settings / another app changing the default.
    pub fn external_set_default(&mut self, id: &str) {
        self.set_default_silently(id);
        let flow = self.flow_of(id);
        self.notify(AudioNotification { kind: NotificationKind::DefaultChanged, device_id: Some(id.into()), flow: Some(flow) });
    }

    pub fn play_on(&mut self, device: &str, process: &str, pid: u32, pinned_to: Option<&str>) {
        let mut s = self.audio.0.borrow_mut();
        for list in s.sessions.values_mut() {
            list.retain(|x| x.process_id != pid);
        }
        s.sessions.entry(device.into()).or_default().push(AudioSessionInfo { process_id: pid, process_name: process.into(), state: 1, is_system_sounds: false });
        if let Some(p) = pinned_to {
            s.routes.insert(pid, p.into());
        }
    }

    fn notify(&mut self, n: AudioNotification) {
        if let Some(svc) = self.svc.as_mut() {
            svc.on_audio_notification(&n);
        }
    }

    // ── observations ──

    pub fn console(&self) -> Option<String> {
        self.audio.defaults_of(AudioFlow::Render)[0].clone()
    }

    pub fn mic_default(&self) -> Option<String> {
        self.audio.defaults_of(AudioFlow::Capture)[0].clone()
    }

    pub fn switch_calls(&self) -> usize {
        self.audio.0.borrow().switch_calls
    }

    pub fn logged(&self, kind: ActivityKind) -> bool {
        self.svc.as_ref().unwrap().activity().iter().any(|a| a.kind == kind)
    }

    // ── running ──

    pub fn start_with(&mut self, settings: AppSettings) -> &mut Service {
        let core = Core::new(Box::new(self.audio.clone()), settings, ActivityLog::in_memory(), Box::new(self.clock.clone()), None);
        let mut svc = Service::new(core, None, None);
        svc.initialize();
        self.svc = Some(svc);
        self.flush();
        self.svc()
    }

    pub fn start(&mut self, mode: SwitchMode, priority: &[&str]) -> &mut Service {
        let mut settings = AppSettings { settle_delay_ms: 1000, ..AppSettings::default() };
        settings.output.mode = mode;
        settings.output.priority = priority.iter().map(|s| s.to_string()).collect();
        self.start_with(settings)
    }

    pub fn advance(&mut self, by: Duration) {
        let until = self.clock.now() + delta(by);
        while let Some(task) = self.clock.pop_due(until) {
            self.svc().run_task(task);
        }
        self.clock.0.borrow_mut().now = Some(until);
    }

    /// Runs everything due now plus settle delays up to 10 s.
    pub fn flush(&mut self) {
        self.advance(Duration::from_secs(10));
    }
}
