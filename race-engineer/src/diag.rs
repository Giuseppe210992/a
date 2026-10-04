//! Diagnostics for a GUI app that has no console: log file, panic hook, last-error banner.

use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

static LAST_ERROR: Mutex<Option<String>> = Mutex::new(None);
static LOG_PATH: Mutex<Option<PathBuf>> = Mutex::new(None);

/// `%LOCALAPPDATA%\RaceEngineer` (or the temp dir when unavailable).
pub fn data_dir() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA")
        .or_else(|| std::env::var_os("XDG_DATA_HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    let dir = base.join("RaceEngineer");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// The user's real Documents folder (follows OneDrive redirection on Windows).
pub fn documents_dir() -> PathBuf {
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::Com::CoTaskMemFree;
        use windows_sys::Win32::UI::Shell::{FOLDERID_Documents, SHGetKnownFolderPath};
        unsafe {
            let mut p: *mut u16 = std::ptr::null_mut();
            if SHGetKnownFolderPath(&FOLDERID_Documents, 0, std::ptr::null_mut(), &mut p) == 0 && !p.is_null() {
                let len = (0..).take_while(|&i| *p.add(i) != 0).count();
                let s = String::from_utf16_lossy(std::slice::from_raw_parts(p, len));
                CoTaskMemFree(p as *const _);
                return PathBuf::from(s);
            }
        }
    }
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(|h| PathBuf::from(h).join("Documents"))
        .unwrap_or_else(|| PathBuf::from("."))
}

/// Default place for recorded laps: `Documents\RaceEngineer\laps`.
pub fn default_lap_dir() -> PathBuf {
    documents_dir().join("RaceEngineer").join("laps")
}

/// Folder with the optional WAV clips: next to the executable.
pub fn clips_dir() -> PathBuf {
    std::env::current_exe().ok().and_then(|e| e.parent().map(|p| p.join("clips"))).unwrap_or_else(|| PathBuf::from("clips"))
}

pub fn log(msg: &str) {
    eprintln!("{msg}");
    if let Ok(g) = LOG_PATH.lock() {
        if let Some(p) = g.as_ref() {
            if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(p) {
                let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
                let _ = writeln!(f, "[{t}] {msg}");
            }
        }
    }
}

/// Records an error for the UI banner and the log.
pub fn error(msg: impl Into<String>) {
    let m = msg.into();
    log(&format!("ERROR: {m}"));
    if let Ok(mut e) = LAST_ERROR.lock() {
        *e = Some(m);
    }
}

pub fn last_error() -> Option<String> {
    LAST_ERROR.lock().ok().and_then(|e| e.clone())
}

pub fn clear_error() {
    if let Ok(mut e) = LAST_ERROR.lock() {
        *e = None;
    }
}

/// Installs the log file and a panic hook that logs instead of vanishing (a GUI build has
/// no console). On Windows a fatal panic on the main thread also shows a message box.
pub fn init(log_file: &str) -> PathBuf {
    let path = data_dir().join(log_file);
    if let Ok(mut g) = LOG_PATH.lock() {
        *g = Some(path.clone());
    }
    let shown = path.clone();
    std::panic::set_hook(Box::new(move |info| {
        let loc = info.location().map(|l| format!("{}:{}", l.file(), l.line())).unwrap_or_default();
        let payload = info.payload();
        let msg = payload.downcast_ref::<&str>().map(|s| s.to_string()).or_else(|| payload.downcast_ref::<String>().cloned()).unwrap_or_else(|| "panic".into());
        let thread = std::thread::current().name().unwrap_or("?").to_string();
        error(format!("panic in thread '{thread}' at {loc}: {msg}"));
        #[cfg(windows)]
        if thread == "main" {
            message_box("Race Engineer", &format!("Errore interno: {msg}\n\nDettagli in {}", shown.display()));
        }
        #[cfg(not(windows))]
        let _ = &shown;
    }));
    log(&format!("Race Engineer {} avviato", env!("CARGO_PKG_VERSION")));
    path
}

#[cfg(windows)]
pub fn message_box(title: &str, text: &str) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};
    let w = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
    unsafe {
        MessageBoxW(std::ptr::null_mut(), w(text).as_ptr(), w(title).as_ptr(), MB_OK | MB_ICONERROR);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_banner_set_and_cleared() {
        clear_error();
        assert!(last_error().is_none());
        error("boom");
        assert_eq!(last_error().as_deref(), Some("boom"));
        clear_error();
        assert!(last_error().is_none());
    }
}
