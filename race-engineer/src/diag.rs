//! Diagnostics for a GUI app that has no console: log file, panic hook, notices with stable
//! error codes. `error()` also files a (consent-gated) report, see `report`; `warn()` is for
//! things that must not alarm anyone or generate mail (e.g. no smartwatch found).

use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Severity {
    /// Shown in amber, logged, never reported.
    Warning,
    /// Shown in red, logged, reported (when the user has consented and a transport is configured).
    Error,
}

#[derive(Debug, Clone)]
pub struct Notice {
    pub code: &'static str,
    pub message: String,
    pub severity: Severity,
    pub report_id: Option<String>,
}

/// One slot per severity: an amber warning must never hide a red error.
static NOTICE_ERR: Mutex<Option<Notice>> = Mutex::new(None);
static NOTICE_WARN: Mutex<Option<Notice>> = Mutex::new(None);
static LOG_PATH: Mutex<Option<PathBuf>> = Mutex::new(None);

/// `RE_DATA_DIR`, else `%LOCALAPPDATA%\RaceEngineer` (or the temp dir when unavailable).
pub fn data_dir() -> PathBuf {
    let dir = match std::env::var_os("RE_DATA_DIR") {
        Some(d) => PathBuf::from(d),
        None => std::env::var_os("LOCALAPPDATA")
            .or_else(|| std::env::var_os("XDG_DATA_HOME"))
            .map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir)
            .join("RaceEngineer"),
    };
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

fn slot(sev: Severity) -> &'static Mutex<Option<Notice>> {
    match sev {
        Severity::Error => &NOTICE_ERR,
        Severity::Warning => &NOTICE_WARN,
    }
}

fn set_notice(n: Notice) {
    if let Ok(mut g) = slot(n.severity).lock() {
        *g = Some(n);
    }
}

/// Soft problem (amber banner, log only). Example: the heart-rate device is not found.
pub fn warn(code: &'static str, msg: impl Into<String>) {
    let message = msg.into();
    log(&format!("WARN {code}: {message}"));
    set_notice(Notice { code, message, severity: Severity::Warning, report_id: None });
}

/// A bug or a failure that matters (red banner, log, report).
pub fn error(code: &'static str, msg: impl Into<String>) {
    let message = msg.into();
    log(&format!("ERROR {code}: {message}"));
    let report_id = crate::report::submit(code, &message);
    set_notice(Notice { code, message, severity: Severity::Error, report_id });
}

/// Current notices, error first.
pub fn notices() -> Vec<Notice> {
    [Severity::Error, Severity::Warning].into_iter().filter_map(|sv| slot(sv).lock().ok().and_then(|n| n.clone())).collect()
}

/// The most important notice (error before warning).
pub fn notice() -> Option<Notice> {
    notices().into_iter().next()
}

pub fn clear_severity(sev: Severity) {
    if let Ok(mut e) = slot(sev).lock() {
        *e = None;
    }
}

pub fn clear_notice() {
    clear_severity(Severity::Error);
    clear_severity(Severity::Warning);
}

/// Installs the log file and a panic hook that logs and reports instead of vanishing (a GUI build
/// has no console). On Windows a fatal panic on the main thread also shows a message box.
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
        error("RE-PANIC", format!("panic in thread '{thread}' at {loc}: {msg}"));
        #[cfg(windows)]
        if thread == "main" {
            message_box("Race Engineer", &format!("Errore interno (RE-PANIC): {msg}\n\nDettagli in {}", shown.display()));
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
    fn warn_never_reports_and_error_sets_a_coded_notice() {
        clear_notice();
        warn("RE-BLE-01", "nessun orologio");
        let n = notice().unwrap();
        assert_eq!((n.code, n.severity, n.report_id.is_none()), ("RE-BLE-01", Severity::Warning, true));
        error("RE-TEST-01", "boom");
        let n = notice().unwrap();
        assert_eq!((n.code, n.severity), ("RE-TEST-01", Severity::Error));
        warn("RE-BLE-01", "again");
        let all = notices();
        assert_eq!(all.len(), 2, "a later warning must not hide the error");
        assert_eq!((all[0].code, all[1].code), ("RE-TEST-01", "RE-BLE-01"));
        clear_notice();
        assert!(notice().is_none());
    }
}
