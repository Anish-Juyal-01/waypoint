//! The runtime thread: owns the [`Service`] and the Core Audio objects (COM, multithreaded apartment) and runs
//! everything on one thread, so the engine never needs locks. The host talks to it by sending jobs; whatever the
//! engine produces comes back through the output callback.

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use crate::audio::{AudioFlow, AudioNotification, AudioSystem, DefaultEndpoints, SwitchResult, VolumeInfo};
use crate::persistence::activity::ActivityLog;
use crate::persistence::settings::SettingsStore;
use crate::persistence::AppPaths;

use super::service::Service;
use super::types::ServiceEvent;
use super::{Core, Scheduler, ShortcutRegistration, StartupRegistration, Task, Time, TimerId};

/// ~30 Hz for the level meters while the window is visible.
const METER_INTERVAL: Duration = Duration::from_millis(33);
/// Volume keys and the Windows mixer don't notify; look for changes this often.
const VOLUME_POLL: Duration = Duration::from_secs(1);
const IDLE_WAIT: Duration = Duration::from_secs(5);

pub enum Output {
    Event(ServiceEvent),
    /// Peak levels of the default output and microphone (only while metering is on).
    Levels { output: Option<f32>, input: Option<f32> },
}

pub type Job = Box<dyn FnOnce(&mut Service) + Send>;
pub type Registrations = (Option<Box<dyn StartupRegistration>>, Option<Box<dyn ShortcutRegistration>>);

enum Msg {
    Job(Job),
    Notification(AudioNotification),
    Shutdown,
}

pub struct Runtime {
    tx: Sender<Msg>,
    metering: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Runtime {
    /// Starts the thread. `registrations` runs on it (after COM is initialised) to build the startup / Start menu
    /// integrations.
    pub fn start(
        paths: AppPaths,
        registrations: impl FnOnce() -> Registrations + Send + 'static,
        output: impl Fn(Output) + Send + 'static,
    ) -> Self {
        let (tx, rx) = mpsc::channel::<Msg>();
        let metering = Arc::new(AtomicBool::new(false));
        let notify_tx = tx.clone();
        let meter_flag = metering.clone();

        let thread = std::thread::Builder::new()
            .name("waypoint-runtime".into())
            .spawn(move || {
                #[cfg(windows)]
                unsafe {
                    let _ = windows::Win32::System::Com::CoInitializeEx(None, windows::Win32::System::Com::COINIT_MULTITHREADED);
                }
                let sink: crate::audio::core_audio::NotificationSink = Arc::new(move |n| {
                    let _ = notify_tx.send(Msg::Notification(n));
                });
                let audio: Box<dyn AudioSystem> = match crate::audio::core_audio::CoreAudioSystem::new(sink) {
                    Ok(a) => Box::new(a),
                    Err(e) => Box::new(NoAudio(format!("Windows audio couldn't be opened: {e}"))),
                };

                let mut store = SettingsStore::new(paths.settings_file());
                let settings = store.load();
                let log = ActivityLog::open(paths.activity_file());
                let timers = Timers::default();
                let core = Core::new(audio, settings, log, Box::new(timers.clone()), Some(store));
                let (startup, shortcut) = registrations();
                let mut svc = Service::new(core, startup, shortcut);
                svc.initialize();

                let mut was_metering = false;
                let mut next_meter = Instant::now();
                let mut next_poll = Instant::now() + VOLUME_POLL;

                loop {
                    while let Some(task) = timers.pop_due(Instant::now()) {
                        svc.run_task(task);
                    }
                    for e in svc.drain_events() {
                        output(Output::Event(e));
                    }

                    let metering = meter_flag.load(Ordering::Relaxed);
                    if metering != was_metering {
                        was_metering = metering;
                        svc.sync_capture_monitor(metering);
                        next_meter = Instant::now();
                    }

                    let now = Instant::now();
                    let mut deadline = timers.next_due().unwrap_or(now + IDLE_WAIT).min(next_poll);
                    if metering {
                        deadline = deadline.min(next_meter);
                    }
                    match rx.recv_timeout(deadline.saturating_duration_since(now)) {
                        Ok(Msg::Job(job)) => job(&mut svc),
                        Ok(Msg::Notification(n)) => {
                            svc.on_audio_notification(&n);
                            if metering {
                                svc.sync_capture_monitor(true); // the default mic may have changed
                            }
                        }
                        Ok(Msg::Shutdown) | Err(RecvTimeoutError::Disconnected) => break,
                        Err(RecvTimeoutError::Timeout) => {}
                    }

                    let now = Instant::now();
                    if metering && now >= next_meter {
                        let (o, i) = svc.sample_levels();
                        output(Output::Levels { output: o, input: i });
                        next_meter = now + METER_INTERVAL;
                    }
                    if now >= next_poll {
                        svc.poll_volumes();
                        next_poll = now + VOLUME_POLL;
                    }
                }

                svc.sync_capture_monitor(false);
                svc.core.save();
                for e in svc.drain_events() {
                    output(Output::Event(e));
                }
                drop(svc);
                #[cfg(windows)]
                unsafe {
                    windows::Win32::System::Com::CoUninitialize();
                }
            })
            .expect("couldn't start the runtime thread");

        Self { tx, metering, thread: Some(thread) }
    }

    /// Runs `job` on the runtime thread.
    pub fn run(&self, job: impl FnOnce(&mut Service) + Send + 'static) {
        let _ = self.tx.send(Msg::Job(Box::new(job)));
    }

    /// Runs `job` on the runtime thread and waits for its result.
    pub fn call<R: Send + 'static>(&self, job: impl FnOnce(&mut Service) -> R + Send + 'static) -> Option<R> {
        let (tx, rx) = mpsc::channel();
        self.run(move |svc| {
            let _ = tx.send(job(svc));
        });
        rx.recv().ok()
    }

    /// Level meters (and the silent mic monitor they need) only run while someone is looking.
    pub fn set_metering(&self, on: bool) {
        self.metering.store(on, Ordering::Relaxed);
        self.run(|_| {}); // wake the loop so it notices
    }

    pub fn shutdown(&mut self) {
        let _ = self.tx.send(Msg::Shutdown);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

impl Drop for Runtime {
    fn drop(&mut self) {
        self.shutdown();
    }
}

// ───────────────────────────── timers ─────────────────────────────

struct Timer {
    id: u64,
    due: Instant,
    task: Task,
}

#[derive(Default)]
struct TimerState {
    next_id: u64,
    items: Vec<Timer>,
}

/// Wall-clock scheduler for the runtime thread (shared between the core and the loop on that one thread).
#[derive(Clone, Default)]
struct Timers(Rc<RefCell<TimerState>>);

impl Timers {
    fn next_due(&self) -> Option<Instant> {
        self.0.borrow().items.iter().map(|t| t.due).min()
    }

    fn pop_due(&self, now: Instant) -> Option<Task> {
        let mut s = self.0.borrow_mut();
        let index = s.items.iter().enumerate().filter(|(_, t)| t.due <= now).min_by_key(|(_, t)| (t.due, t.id)).map(|(n, _)| n)?;
        Some(s.items.remove(index).task)
    }
}

impl Scheduler for Timers {
    fn now(&self) -> Time {
        chrono::Local::now().fixed_offset()
    }

    fn schedule(&mut self, delay: Duration, task: Task) -> TimerId {
        let mut s = self.0.borrow_mut();
        s.next_id += 1;
        let id = s.next_id;
        s.items.push(Timer { id, due: Instant::now() + delay, task });
        TimerId(id)
    }

    fn cancel(&mut self, id: TimerId) {
        self.0.borrow_mut().items.retain(|t| t.id != id.0);
    }
}

/// Stand-in when Core Audio can't be opened at all: the window still works and explains why nothing switches.
struct NoAudio(String);

impl AudioSystem for NoAudio {
    fn can_switch(&self) -> bool {
        false
    }
    fn switch_unavailable_reason(&self) -> Option<String> {
        Some(self.0.clone())
    }
    fn endpoints(&mut self, _flow: AudioFlow) -> Vec<crate::audio::AudioEndpoint> {
        Vec::new()
    }
    fn defaults(&mut self, _flow: AudioFlow) -> DefaultEndpoints {
        DefaultEndpoints::default()
    }
    fn set_default(&mut self, _flow: AudioFlow, _device_id: &str, _include_communications: bool) -> SwitchResult {
        SwitchResult::fail(self.0.clone())
    }
    fn peak(&mut self, _device_id: &str) -> Option<f32> {
        None
    }
    fn volume(&mut self, _device_id: &str) -> Option<VolumeInfo> {
        None
    }
    fn set_volume(&mut self, _device_id: &str, _level: f32) -> Option<VolumeInfo> {
        None
    }
    fn set_mute(&mut self, _device_id: &str, _muted: bool) -> Option<VolumeInfo> {
        None
    }
}
