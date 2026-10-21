//! "Start with Windows" as a per-user Task Scheduler task with a sign-in trigger (no admin rights needed). A port of
//! the C# StartupManager, using the same task name and XML so either build sees the other's registration.
//!
//! Older versions used HKCU\...\CurrentVersion\Run. Explorer only launches Run entries it already knows from its
//! startup-app inventory, which Windows rebuilds only occasionally, so a new entry can be skipped at sign-in for days.
//! A sign-in task runs reliably. Any old Run entry for this app is removed when the task is created.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use windows::core::{BSTR, HSTRING, PCWSTR, PWSTR};
use windows::Win32::Security::Authentication::Identity::{GetUserNameExW, NameSamCompatible};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
use windows::Win32::System::Registry::{RegDeleteKeyValueW, RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_SZ};
use windows::Win32::System::TaskScheduler::{ITaskFolder, ITaskService, TaskScheduler, TASK_CREATE_OR_UPDATE, TASK_LOGON_INTERACTIVE_TOKEN};
use windows::Win32::System::Variant::VARIANT;

use crate::engine::StartupRegistration;
use crate::host::MINIMIZED_ARG;

const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const APPROVED_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
/// The Run value the app used when it was called EchoLock.
const LEGACY_VALUE_NAME: &str = "EchoLock";
/// The settings view reads this on every state update, so the lookup is cached briefly.
const TASK_CACHE_FOR: Duration = Duration::from_secs(30);

#[derive(Clone, Debug, PartialEq)]
struct TaskInfo {
    command: Option<String>,
    enabled: bool,
}

pub struct StartupManager {
    name: String,
    exe: PathBuf,
    cached: Option<(Instant, Option<TaskInfo>)>,
}

impl StartupManager {
    pub fn new() -> Self {
        Self { name: "Waypoint".into(), exe: std::env::current_exe().unwrap_or_default(), cached: None }
    }

    /// Upgrades older registrations: a Run entry (from 1.1.x, or named "EchoLock") that starts this executable or one
    /// that no longer exists becomes a sign-in task for this executable. Entries for another existing program stay.
    pub fn migrate_legacy_entry(&mut self) -> bool {
        let mut wanted = false;
        for value in [self.name.clone(), LEGACY_VALUE_NAME.to_string()] {
            let Some(command) = read_run_command(&value) else { continue };
            if let Some(exe) = extract_executable(&command) {
                if Path::new(&exe).exists() && !same_path(&exe, &self.exe) {
                    continue;
                }
            }
            remove_run_entry(&value);
            wanted = true;
        }
        if wanted && self.read_task().is_none() {
            let _ = self.create_task();
        }
        self.cached = None;
        wanted
    }

    fn read_task(&mut self) -> Option<TaskInfo> {
        if let Some((at, task)) = &self.cached {
            if at.elapsed() < TASK_CACHE_FOR {
                return task.clone();
            }
        }
        // Reading the startup state must never stop the app: any failure counts as "off".
        let task = with_root_folder(|folder| unsafe {
            let task = folder.GetTask(&BSTR::from(self.name.as_str()))?;
            let xml = task.Xml()?.to_string();
            let enabled = task.Enabled()?.as_bool();
            Ok(parse_task(&xml).map(|t| TaskInfo { enabled: t.enabled && enabled, ..t }))
        })
        .ok()
        .flatten();
        self.cached = Some((Instant::now(), task.clone()));
        task
    }

    fn create_task(&mut self) -> Result<(), String> {
        let xml = build_task_xml(&user_name(), &self.exe.to_string_lossy());
        with_root_folder(|folder| unsafe {
            let empty = VARIANT::default();
            folder.RegisterTask(&BSTR::from(self.name.as_str()), &BSTR::from(xml.as_str()), TASK_CREATE_OR_UPDATE.0, &empty, &empty, TASK_LOGON_INTERACTIVE_TOKEN, &empty)?;
            Ok(())
        })
        .map_err(|e| format!("Couldn't create the sign-in task (0x{:08X}): {}", e.code().0 as u32, e.message()))
    }

    fn delete_task(&mut self) {
        // A missing task is fine: it's already gone.
        let _ = with_root_folder(|folder| unsafe { folder.DeleteTask(&BSTR::from(self.name.as_str()), 0) });
    }
}

impl StartupRegistration for StartupManager {
    fn is_enabled(&mut self) -> bool {
        let exe = self.exe.clone();
        self.read_task().is_some_and(|t| t.enabled && t.command.as_deref().is_some_and(|c| same_path(c, &exe)))
    }

    fn foreign_command(&mut self) -> Option<String> {
        let exe = self.exe.clone();
        if let Some(command) = self.read_task().and_then(|t| t.command) {
            return (!same_path(&command, &exe)).then_some(command);
        }
        let run = read_run_command(&self.name)?;
        let points_here = extract_executable(&run).is_some_and(|e| same_path(&e, &exe));
        (!points_here).then_some(run)
    }

    fn set_enabled(&mut self, enabled: bool) -> Result<(), String> {
        let result = if enabled { self.create_task() } else { Ok(self.delete_task()) };
        remove_run_entry(&self.name.clone());
        self.cached = None;
        result
    }
}

fn with_root_folder<T>(f: impl FnOnce(&ITaskFolder) -> windows::core::Result<T>) -> windows::core::Result<T> {
    unsafe {
        let service: ITaskService = CoCreateInstance(&TaskScheduler, None, CLSCTX_INPROC_SERVER)?;
        let empty = VARIANT::default();
        service.Connect(&empty, &empty, &empty, &empty)?;
        let folder = service.GetFolder(&BSTR::from("\\"))?;
        f(&folder)
    }
}

fn user_name() -> String {
    unsafe {
        let mut len = 0u32;
        let _ = GetUserNameExW(NameSamCompatible, None, &mut len);
        let mut buf = vec![0u16; len as usize + 1];
        if GetUserNameExW(NameSamCompatible, Some(PWSTR(buf.as_mut_ptr())), &mut len) {
            return String::from_utf16_lossy(&buf[..len as usize]);
        }
    }
    std::env::var("USERNAME").unwrap_or_default()
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;")
}

/// Per-user sign-in task: runs only in the user's own session, normal priority, no time limit.
fn build_task_xml(user: &str, exe: &str) -> String {
    let (u, x) = (xml_escape(user), xml_escape(exe));
    format!(
        r#"<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Author>Waypoint</Author>
    <Description>Starts Waypoint in the notification area when you sign in. Turn it off in Waypoint: Settings, Start with Windows.</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger><Enabled>true</Enabled><UserId>{u}</UserId></LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author"><UserId>{u}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>5</Priority>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author">
    <Exec><Command>{x}</Command><Arguments>{MINIMIZED_ARG}</Arguments></Exec>
  </Actions>
</Task>"#
    )
}

/// Text of the first `<tag>…</tag>` after `from` (the task XML is machine-written, so no full parser is needed).
fn element<'a>(xml: &'a str, tag: &str, from: usize) -> Option<&'a str> {
    let open = format!("<{tag}>");
    let start = xml[from..].find(&open)? + from + open.len();
    let end = xml[start..].find(&format!("</{tag}>"))? + start;
    Some(&xml[start..end])
}

fn xml_unescape(s: &str) -> String {
    s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&")
}

fn parse_task(xml: &str) -> Option<TaskInfo> {
    let exec = xml.find("<Exec>")?;
    let command = element(xml, "Command", exec).map(|c| xml_unescape(c.trim()).trim_matches('"').to_string());
    let enabled = xml.find("<Settings>").and_then(|s| {
        // Settings' own <Enabled>, not a trigger's.
        let end = xml[s..].find("</Settings>")? + s;
        element(&xml[..end], "Enabled", s)
    });
    Some(TaskInfo { command, enabled: !enabled.is_some_and(|e| e.trim().eq_ignore_ascii_case("false")) })
}

fn wide(s: &str) -> HSTRING {
    HSTRING::from(s)
}

fn read_run_command(value: &str) -> Option<String> {
    unsafe {
        let mut size = 0u32;
        let key = wide(RUN_KEY);
        let name = wide(value);
        if RegGetValueW(HKEY_CURRENT_USER, &key, &name, RRF_RT_REG_SZ, None, None, Some(&mut size)).is_err() {
            return None;
        }
        let mut buf = vec![0u16; size as usize / 2 + 1];
        RegGetValueW(HKEY_CURRENT_USER, &key, &name, RRF_RT_REG_SZ, None, Some(buf.as_mut_ptr().cast()), Some(&mut size)).ok().ok()?;
        let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        Some(String::from_utf16_lossy(&buf[..len]))
    }
}

fn remove_run_entry(value: &str) {
    unsafe {
        let name = wide(value);
        let _ = RegDeleteKeyValueW(HKEY_CURRENT_USER, &wide(RUN_KEY), PCWSTR(name.as_ptr()));
        let _ = RegDeleteKeyValueW(HKEY_CURRENT_USER, &wide(APPROVED_KEY), PCWSTR(name.as_ptr()));
    }
}

fn same_path(a: impl AsRef<Path>, b: impl AsRef<Path>) -> bool {
    let full = |p: &Path| std::path::absolute(p).map(|p| p.to_string_lossy().to_lowercase()).ok();
    matches!((full(a.as_ref()), full(b.as_ref())), (Some(x), Some(y)) if x == y)
}

pub fn extract_executable(command: &str) -> Option<String> {
    let command = command.trim();
    if let Some(rest) = command.strip_prefix('"') {
        let end = rest.find('"')?;
        return (end > 0).then(|| rest[..end].to_string());
    }
    Some(command.split(' ').next().unwrap_or(command).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task_xml_round_trips() {
        let xml = build_task_xml(r"PC\A & B", r"C:\Apps\Wäypoint <1>\Waypoint.exe");
        let t = parse_task(&xml).unwrap();
        assert_eq!(t.command.as_deref(), Some(r"C:\Apps\Wäypoint <1>\Waypoint.exe"));
        assert!(t.enabled);
        let off = xml.replace("<Priority>5</Priority>\n    <Enabled>true</Enabled>", "<Priority>5</Priority>\n    <Enabled>false</Enabled>");
        assert!(!parse_task(&off).unwrap().enabled);
    }

    #[test]
    fn extracts_executables_from_run_commands() {
        assert_eq!(extract_executable(r#""C:\A B\W.exe" --minimized"#).as_deref(), Some(r"C:\A B\W.exe"));
        assert_eq!(extract_executable(r"C:\W.exe --minimized").as_deref(), Some(r"C:\W.exe"));
    }
}
