//! Append-only JSON-lines activity log, capped at [`CAPACITY`] entries in memory. The file is compacted when it
//! grows to twice the capacity. Same format as the C# version (activity.jsonl).

use std::io::Write;
use std::path::{Path, PathBuf};

use chrono::{DateTime, FixedOffset};
use serde::{Deserialize, Serialize};

use crate::audio::AudioFlow;

pub const CAPACITY: usize = 2000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ActivityKind {
    Connected,
    Disconnected,
    Discovered,
    Switched,
    SwitchFailed,
    ExternalChange,
    Reverted,
    Override,
    Restored,
    ModeChanged,
    PriorityChanged,
    Settings,
    Warning,
    Info,
}

impl ActivityKind {
    /// The C# enum name, used in exported text.
    fn label(self) -> &'static str {
        match self {
            ActivityKind::Connected => "Connected",
            ActivityKind::Disconnected => "Disconnected",
            ActivityKind::Discovered => "Discovered",
            ActivityKind::Switched => "Switched",
            ActivityKind::SwitchFailed => "SwitchFailed",
            ActivityKind::ExternalChange => "ExternalChange",
            ActivityKind::Reverted => "Reverted",
            ActivityKind::Override => "Override",
            ActivityKind::Restored => "Restored",
            ActivityKind::ModeChanged => "ModeChanged",
            ActivityKind::PriorityChanged => "PriorityChanged",
            ActivityKind::Settings => "Settings",
            ActivityKind::Warning => "Warning",
            ActivityKind::Info => "Info",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityEntry {
    pub id: i64,
    pub time: DateTime<FixedOffset>,
    pub kind: ActivityKind,
    pub title: String,
    #[serde(default)]
    pub detail: Option<String>,
    #[serde(default)]
    pub device_id: Option<String>,
    /// Set for microphone (capture) events; None for outputs and general events.
    #[serde(default)]
    pub flow: Option<AudioFlow>,
}

pub struct ActivityLog {
    file: Option<PathBuf>,
    entries: Vec<ActivityEntry>,
    next_id: i64,
    lines_on_disk: usize,
}

impl ActivityLog {
    /// A log kept only in memory (tests).
    pub fn in_memory() -> Self {
        Self { file: None, entries: Vec::new(), next_id: 1, lines_on_disk: 0 }
    }

    pub fn open(file: impl AsRef<Path>) -> Self {
        let mut log = Self { file: Some(file.as_ref().to_path_buf()), ..Self::in_memory() };
        log.load_existing();
        log
    }

    pub fn entries(&self) -> &[ActivityEntry] {
        &self.entries
    }

    pub fn add(&mut self, kind: ActivityKind, title: impl Into<String>, detail: Option<String>, device_id: Option<String>, flow: Option<AudioFlow>) -> ActivityEntry {
        let entry = ActivityEntry {
            id: self.next_id,
            time: chrono::Local::now().fixed_offset(),
            kind,
            title: title.into(),
            detail,
            device_id,
            flow: flow.filter(|f| *f == AudioFlow::Capture),
        };
        self.next_id += 1;
        self.entries.push(entry.clone());
        if self.entries.len() > CAPACITY {
            let extra = self.entries.len() - CAPACITY;
            self.entries.drain(..extra);
        }

        // Logging must never break switching: write errors are ignored.
        if let Some(file) = &self.file {
            if let Ok(line) = serde_json::to_string(&entry) {
                let ok = std::fs::OpenOptions::new().create(true).append(true).open(file).and_then(|mut f| writeln!(f, "{line}")).is_ok();
                if ok {
                    self.lines_on_disk += 1;
                    if self.lines_on_disk > CAPACITY * 2 {
                        self.compact();
                    }
                }
            }
        }
        entry
    }

    pub fn clear(&mut self) {
        self.entries.clear();
        if let Some(file) = &self.file {
            let _ = std::fs::write(file, "");
        }
        self.lines_on_disk = 0;
    }

    pub fn export_text(&self) -> String {
        self.entries
            .iter()
            .map(|e| {
                format!(
                    "{}\t{}\t{}{}",
                    e.time.format("%Y-%m-%d %H:%M:%S"),
                    e.kind.label(),
                    e.title,
                    e.detail.as_ref().map(|d| format!(" - {d}")).unwrap_or_default()
                )
            })
            .collect::<Vec<_>>()
            .join("\r\n")
    }

    fn load_existing(&mut self) {
        let Some(file) = &self.file else { return };
        let Ok(text) = std::fs::read_to_string(file) else { return };
        for line in text.lines() {
            self.lines_on_disk += 1;
            if line.trim().is_empty() {
                continue;
            }
            // Skip a torn line (power loss mid-write).
            if let Ok(e) = serde_json::from_str::<ActivityEntry>(line.trim_start_matches('\u{feff}')) {
                self.entries.push(e);
            }
        }
        if self.entries.len() > CAPACITY {
            let extra = self.entries.len() - CAPACITY;
            self.entries.drain(..extra);
        }
        self.next_id = self.entries.iter().map(|e| e.id).max().map_or(1, |m| m + 1);
        if self.lines_on_disk > CAPACITY * 2 {
            self.compact();
        }
    }

    fn compact(&mut self) {
        let Some(file) = &self.file else { return };
        let temp = file.with_extension("jsonl.tmp");
        let body: String = self.entries.iter().filter_map(|e| serde_json::to_string(e).ok()).map(|l| l + "\n").collect();
        if std::fs::write(&temp, body).is_ok() && std::fs::rename(&temp, file).is_ok() {
            self.lines_on_disk = self.entries.len();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_csharp_lines_and_continues_ids() {
        let dir = std::env::temp_dir().join(format!("waypoint-log-{}", crate::persistence::settings::new_profile_id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("activity.jsonl");
        std::fs::write(
            &file,
            "{\"id\":341,\"time\":\"2026-10-17T23:22:52.3505384+05:30\",\"kind\":\"switched\",\"title\":\"Switched to A\",\"detail\":\"Selected manually · Verified in 26 ms\",\"deviceId\":\"x\",\"flow\":null}\n\
             {torn line\n\
             {\"id\":342,\"time\":\"2026-10-17T23:22:53.9553956+05:30\",\"kind\":\"connected\",\"title\":\"Mic connected\",\"detail\":null,\"deviceId\":null,\"flow\":\"capture\"}\n",
        )
        .unwrap();
        let mut log = ActivityLog::open(&file);
        assert_eq!(log.entries().len(), 2);
        assert_eq!(log.entries()[1].flow, Some(AudioFlow::Capture));
        let e = log.add(ActivityKind::Info, "hello", None, None, Some(AudioFlow::Render));
        assert_eq!(e.id, 343);
        assert_eq!(e.flow, None, "only capture events carry a flow");
        assert!(std::fs::read_to_string(&file).unwrap().lines().last().unwrap().contains("\"title\":\"hello\""));
        assert!(log.export_text().contains("Switched\tSwitched to A - Selected manually"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn capped_in_memory() {
        let mut log = ActivityLog::in_memory();
        for i in 0..CAPACITY + 10 {
            log.add(ActivityKind::Info, format!("{i}"), None, None, None);
        }
        assert_eq!(log.entries().len(), CAPACITY);
        assert_eq!(log.entries()[0].title, "10");
    }
}
