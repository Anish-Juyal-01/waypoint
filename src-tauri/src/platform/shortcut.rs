//! A per-user Start menu shortcut (…\Start Menu\Programs\Waypoint.lnk) so Windows search finds the portable exe.
//! A port of the C# StartMenuShortcut, through IShellLinkW instead of WScript.Shell; no admin rights needed.

use std::path::{Path, PathBuf};

use windows::core::{Interface, HSTRING, PWSTR};
use windows::Win32::System::Com::{CoCreateInstance, CoTaskMemFree, IPersistFile, CLSCTX_INPROC_SERVER, STGM_READ};
use windows::Win32::UI::Shell::{FOLDERID_Programs, IShellLinkW, SHGetKnownFolderPath, ShellLink, KF_FLAG_DEFAULT};

use crate::engine::ShortcutRegistration;

pub struct StartMenuShortcut {
    exe: PathBuf,
    path: Option<PathBuf>,
}

impl StartMenuShortcut {
    pub fn new() -> Self {
        let path = programs_folder().map(|p| p.join("Waypoint.lnk"));
        Self { exe: std::env::current_exe().unwrap_or_default(), path }
    }

    fn path(&self) -> Result<&Path, String> {
        self.path.as_deref().ok_or_else(|| "The Start menu folder couldn't be found.".to_string())
    }

    fn read_target(&self) -> Option<PathBuf> {
        let path = self.path.as_ref().filter(|p| p.exists())?;
        unsafe {
            let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).ok()?;
            link.cast::<IPersistFile>().ok()?.Load(&HSTRING::from(path.as_os_str()), STGM_READ).ok()?;
            let mut buf = [0u16; 1024];
            link.GetPath(&mut buf, std::ptr::null_mut(), 0).ok()?;
            let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
            Some(PathBuf::from(String::from_utf16_lossy(&buf[..len])))
        }
    }

    fn create(&self) -> Result<(), String> {
        let path = self.path()?;
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let exe = HSTRING::from(self.exe.as_os_str());
        let dir = HSTRING::from(self.exe.parent().unwrap_or(Path::new("")).as_os_str());
        unsafe {
            let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).map_err(|e| e.message())?;
            link.SetPath(&exe).map_err(|e| e.message())?;
            link.SetWorkingDirectory(&dir).map_err(|e| e.message())?;
            link.SetIconLocation(&exe, 0).map_err(|e| e.message())?;
            link.SetDescription(&HSTRING::from("Audio priority manager for Windows")).map_err(|e| e.message())?;
            link.cast::<IPersistFile>().map_err(|e| e.message())?.Save(&HSTRING::from(path.as_os_str()), true).map_err(|e| e.message())?;
        }
        Ok(())
    }
}

impl ShortcutRegistration for StartMenuShortcut {
    fn exists(&self) -> bool {
        self.path.as_ref().is_some_and(|p| p.exists())
    }

    /// Creates the shortcut if missing, or repoints it if the program it opens is gone. A shortcut to another copy
    /// of Waypoint that still exists is left alone (turning the setting on in that copy replaces it).
    fn ensure_present(&mut self) -> Result<(), String> {
        match self.read_target() {
            Some(target) if target.exists() => Ok(()),
            _ => self.create(),
        }
    }

    fn set_enabled(&mut self, enabled: bool) -> Result<(), String> {
        if enabled {
            self.create()
        } else if self.exists() {
            std::fs::remove_file(self.path()?).map_err(|e| e.to_string())
        } else {
            Ok(())
        }
    }
}

fn programs_folder() -> Option<PathBuf> {
    unsafe {
        let p: PWSTR = SHGetKnownFolderPath(&FOLDERID_Programs, KF_FLAG_DEFAULT, None).ok()?;
        let s = p.to_string().ok();
        CoTaskMemFree(Some(p.0 as *const _));
        s.map(PathBuf::from)
    }
}
