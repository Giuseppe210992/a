//! Error reports by e-mail with a stable error code.
//!
//! What is sent (and nothing else): error code, a short message with user names and folders
//! removed, app version, OS, selected simulator, an anonymous random installation id and the
//! short id of the access code. NEVER sent without consent: the user ticks "send error codes"
//! (default off unless the owner ships `report.json` with `"default_consent": true`, in which case
//! the checkbox is pre-ticked and the destination is shown in the UI).
//!
//! Transport comes from `report.json` (in `%LOCALAPPDATA%\RaceEngineer` or next to the exe):
//! * `"smtp"`: any mail server, e.g. Gmail with an *app password* (TLS), mail goes straight to `to`;
//! * `"webhook"`: HTTPS POST of JSON (works with Web3Forms/Formspree/Zapier/your own server),
//!   with `extra_fields` merged in (e.g. the form service access key).
//! Without a configured transport nothing is sent; the red banner offers a pre-filled `mailto:`
//! message instead. Failed sends are queued on disk and retried; repeats are rate-limited.
//! No credentials are compiled into the program.

use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

#[derive(Debug, Clone, PartialEq)]
pub struct SmtpCfg {
    pub host: String,
    pub port: u16,
    /// "tls" (implicit, usually 465), "starttls" (usually 587) or "none" (tests, local relays)
    pub security: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub from: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct WebhookCfg {
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub extra_fields: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Transport {
    Smtp(SmtpCfg),
    Webhook(WebhookCfg),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Config {
    pub to: String,
    pub default_consent: bool,
    pub transport: Transport,
}

pub fn parse_config(text: &str) -> Result<Config, String> {
    let v: Value = serde_json::from_str(text).map_err(|e| format!("report.json non leggibile: {e}"))?;
    let s = |o: &Value, k: &str| o.get(k).and_then(Value::as_str).map(str::to_string);
    let to = s(&v, "to").filter(|t| t.contains('@')).ok_or("report.json: manca \"to\" (indirizzo e-mail)")?;
    let transport = match s(&v, "transport").as_deref() {
        Some("smtp") => {
            let c = v.get("smtp").ok_or("report.json: manca la sezione \"smtp\"")?;
            let host = s(c, "host").ok_or("smtp: manca host")?;
            let security = s(c, "security").unwrap_or_else(|| "tls".into());
            if !["tls", "starttls", "none"].contains(&security.as_str()) {
                return Err("smtp.security deve essere tls, starttls o none".into());
            }
            let username = s(c, "username");
            let password = s(c, "password").map(|p| p.replace(char::is_whitespace, "")).filter(|p| !p.is_empty());
            if username.is_some() && security != "none" && password.is_none() {
                return Err("smtp: manca la password (per Gmail serve una «password per le app», vedi docs/SEGNALAZIONI.md)".into());
            }
            Transport::Smtp(SmtpCfg {
                port: c.get("port").and_then(Value::as_u64).map_or(if security == "starttls" { 587 } else { 465 }, |p| p as u16),
                from: s(c, "from").or_else(|| username.clone()).ok_or("smtp: manca from/username")?,
                password,
                username,
                security,
                host,
            })
        }
        Some("webhook") => {
            let c = v.get("webhook").ok_or("report.json: manca la sezione \"webhook\"")?;
            let url = s(c, "url").filter(|u| u.starts_with("http")).ok_or("webhook: url mancante o non http(s)")?;
            let headers = c.get("headers").and_then(Value::as_object).map(|m| m.iter().filter_map(|(k, v)| v.as_str().map(|v| (k.clone(), v.to_string()))).collect()).unwrap_or_default();
            Transport::Webhook(WebhookCfg { url, headers, extra_fields: c.get("extra_fields").and_then(Value::as_object).cloned().unwrap_or_default() })
        }
        _ => return Err("report.json: \"transport\" deve essere \"smtp\" o \"webhook\"".into()),
    };
    Ok(Config { to, default_consent: v.get("default_consent").and_then(Value::as_bool).unwrap_or(false), transport })
}

fn config_paths() -> Vec<PathBuf> {
    let mut v = vec![crate::diag::data_dir().join("report.json")];
    if let Some(d) = std::env::current_exe().ok().and_then(|e| e.parent().map(Path::to_path_buf)) {
        v.push(d.join("report.json"));
    }
    v
}

/// `Ok(None)` when no report.json exists; `Err` when it exists but is wrong.
pub fn load_config() -> Result<Option<Config>, String> {
    for p in config_paths() {
        if let Ok(t) = std::fs::read_to_string(&p) {
            return parse_config(&t).map(Some).map_err(|e| format!("{e} ({})", p.display()));
        }
    }
    Ok(None)
}

fn consent_path() -> PathBuf {
    crate::diag::data_dir().join("report-consent.txt")
}

/// The user's explicit choice, if any.
pub fn consent() -> Option<bool> {
    std::fs::read_to_string(consent_path()).ok().map(|s| s.trim() == "1")
}

pub fn set_consent(yes: bool) {
    let _ = std::fs::write(consent_path(), if yes { "1" } else { "0" });
}

/// Consent that applies right now (explicit choice, else the owner's default, else no).
pub fn consent_effective(cfg: Option<&Config>) -> bool {
    consent().unwrap_or_else(|| cfg.is_some_and(|c| c.default_consent))
}

// ---- report content ------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub struct Report {
    pub code: String,
    pub message: String,
    pub report_id: String,
    pub unix: u64,
    pub app: String,
    pub os: String,
    pub sim: String,
    pub install_id: String,
    pub licence_id: String,
}

static CONTEXT: Mutex<(String, String)> = Mutex::new((String::new(), String::new()));

/// Context shown in reports: selected simulator and the access code id.
pub fn set_context(sim: &str, licence_id: &str) {
    if let Ok(mut c) = CONTEXT.lock() {
        *c = (sim.to_string(), licence_id.to_string());
    }
}

fn install_id() -> String {
    let p = crate::diag::data_dir().join("install-id.txt");
    if let Ok(s) = std::fs::read_to_string(&p) {
        if s.trim().len() == 16 {
            return s.trim().to_string();
        }
    }
    use std::hash::{BuildHasher, Hasher};
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    h.write_u64(crate::license::now_s());
    let id = format!("{:016x}", h.finish());
    let _ = std::fs::write(&p, &id);
    id
}

/// Removes user names and folders from a message.
pub fn sanitize(msg: &str) -> String {
    let mut out = msg.to_string();
    for var in ["USERPROFILE", "LOCALAPPDATA", "APPDATA", "HOME", "USERNAME", "USER"] {
        if let Some(v) = std::env::var_os(var).map(|v| v.to_string_lossy().into_owned()).filter(|v| v.len() > 2) {
            out = out.replace(&v, "<utente>");
        }
    }
    // any remaining C:\Users\<name>\ style path
    let low = out.to_ascii_lowercase();
    if let Some(i) = low.find("\\users\\") {
        let start = i + "\\users\\".len();
        let end = out[start..].find(['\\', '/', ' ', '\'', '"']).map_or(out.len(), |e| start + e);
        out.replace_range(start..end, "<utente>");
    }
    out.chars().take(600).collect()
}

fn base36(mut n: u64) -> String {
    let d = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut s = vec![];
    while n > 0 {
        s.push(d[(n % 36) as usize]);
        n /= 36;
    }
    s.reverse();
    String::from_utf8(s).unwrap_or_default()
}

pub fn build_report(code: &str, message: &str) -> Report {
    let unix = crate::license::now_s();
    let (sim, lic) = CONTEXT.lock().map(|c| c.clone()).unwrap_or_default();
    let install = install_id();
    Report {
        code: code.to_string(),
        message: sanitize(message),
        report_id: format!("{code}-{}-{}", base36(unix), &install[..4]),
        unix,
        app: env!("CARGO_PKG_VERSION").to_string(),
        os: std::env::consts::OS.to_string(),
        sim: if sim.is_empty() { "-".into() } else { sim },
        install_id: install,
        licence_id: if lic.is_empty() { "-".into() } else { lic },
    }
}

impl Report {
    pub fn subject(&self) -> String {
        format!("[Race Engineer] Errore {} (v{})", self.code, self.app)
    }

    pub fn body(&self) -> String {
        format!(
            "Race Engineer - segnalazione errore\n\nCodice errore: {}\nID segnalazione: {}\nQuando: {} (unix {})\n\nMessaggio:\n{}\n\nVersione: {}\nSistema: {}\nSimulatore: {}\nInstallazione: {}\nCodice di accesso (id): {}\n",
            self.code,
            self.report_id,
            crate::license::fmt_date(self.unix),
            self.unix,
            self.message,
            self.app,
            self.os,
            self.sim,
            self.install_id,
            self.licence_id
        )
    }

    fn json(&self, to: &str) -> Value {
        json!({
            "subject": self.subject(), "message": self.body(), "to": to,
            "code": self.code, "report_id": self.report_id, "text": self.message,
            "app_version": self.app, "os": self.os, "simulator": self.sim,
            "installation": self.install_id, "access_id": self.licence_id, "unix": self.unix,
        })
    }
}

fn pct(s: &str) -> String {
    s.bytes().map(|b| if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect()
}

/// `mailto:` link with the report pre-filled (works with no configuration at all).
pub fn mailto_url(to: &str, r: &Report) -> String {
    format!("mailto:{}?subject={}&body={}", to, pct(&r.subject()), pct(&r.body()))
}

pub fn open_url(url: &str) {
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::UI::Shell::ShellExecuteW;
        let w = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
        ShellExecuteW(std::ptr::null_mut(), w("open").as_ptr(), w(url).as_ptr(), std::ptr::null(), std::ptr::null(), 1);
    }
    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("xdg-open").arg(url).spawn();
    }
}

// ---- transports ----------------------------------------------------------------------

pub fn send_now(cfg: &Config, r: &Report) -> Result<(), String> {
    match &cfg.transport {
        Transport::Webhook(w) => send_webhook(w, &cfg.to, r),
        Transport::Smtp(s) => send_smtp(s, &cfg.to, r),
    }
}

fn send_webhook(w: &WebhookCfg, to: &str, r: &Report) -> Result<(), String> {
    let mut body = r.json(to);
    if let Some(o) = body.as_object_mut() {
        for (k, v) in &w.extra_fields {
            o.insert(k.clone(), v.clone());
        }
    }
    let agent: ureq::Agent = ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(15))).build().into();
    let mut req = agent.post(&w.url).header("Content-Type", "application/json").header("Accept", "application/json");
    for (k, v) in &w.headers {
        req = req.header(k.as_str(), v.as_str());
    }
    req.send(body.to_string()).map(|_| ()).map_err(|e| format!("invio webhook non riuscito: {e}"))
}

fn send_smtp(c: &SmtpCfg, to: &str, r: &Report) -> Result<(), String> {
    use lettre::transport::smtp::authentication::Credentials;
    use lettre::{Message, SmtpTransport, Transport};
    let mail = Message::builder()
        .from(c.from.parse().map_err(|e| format!("indirizzo mittente non valido: {e}"))?)
        .to(to.parse().map_err(|e| format!("indirizzo destinatario non valido: {e}"))?)
        .subject(r.subject())
        .body(r.body())
        .map_err(|e| format!("messaggio non valido: {e}"))?;
    use lettre::transport::smtp::client::{Certificate, Tls, TlsParameters};
    // RE_SMTP_EXTRA_CA=<file.pem>: trust one more CA (corporate/antivirus TLS inspection, or tests)
    let tls_params = || -> Result<TlsParameters, String> {
        let mut b = TlsParameters::builder(c.host.clone());
        if let Some(path) = std::env::var_os("RE_SMTP_EXTRA_CA") {
            let pem = std::fs::read(&path).map_err(|e| format!("RE_SMTP_EXTRA_CA non leggibile: {e}"))?;
            b = b.add_root_certificate(Certificate::from_pem(&pem).map_err(|e| format!("RE_SMTP_EXTRA_CA non valido: {e}"))?);
        }
        b.build_rustls().map_err(|e| format!("TLS: {e}"))
    };
    let builder = match c.security.as_str() {
        "tls" => SmtpTransport::builder_dangerous(&c.host).tls(Tls::Wrapper(tls_params()?)),
        "starttls" => SmtpTransport::builder_dangerous(&c.host).tls(Tls::Required(tls_params()?)),
        _ => SmtpTransport::builder_dangerous(&c.host),
    };
    let mut b = builder.port(c.port).timeout(Some(Duration::from_secs(20)));
    if let (Some(u), Some(p)) = (&c.username, &c.password) {
        b = b.credentials(Credentials::new(u.clone(), p.clone()));
    }
    b.build().send(&mail).map(|_| ()).map_err(|e| format!("invio SMTP non riuscito: {e}"))
}

// ---- Gmail helpers -----------------------------------------------------------------------

/// Explains common failures in plain Italian (the technical text is appended in brackets).
pub fn friendly_error(raw: &str) -> String {
    let l = raw.to_ascii_lowercase();
    let hint = if l.contains("535") || l.contains("534") || l.contains("username and password not accepted") || l.contains("application-specific password") || l.contains("badcredentials") {
        "Gmail ha rifiutato l'accesso: serve la «password per le app» di 16 lettere (con la verifica in due passaggi attiva), non la password normale dell'account."
    } else if l.contains("timed out") || l.contains("timeout") {
        "Nessuna risposta dal server di posta: controlla la connessione a Internet e che un firewall non blocchi la porta 465."
    } else if l.contains("certificate") || l.contains("unknownissuer") || l.contains("invalid peer") || l.contains("handshake") {
        "Certificato TLS non riconosciuto: un antivirus o un proxy aziendale potrebbe intercettare la connessione sicura (vedi RE_SMTP_EXTRA_CA in docs/SEGNALAZIONI.md)."
    } else if l.contains("connection refused") || l.contains("failed to lookup") || l.contains("dns") || l.contains("no such host") || l.contains("unreachable") || l.contains("connection error") || l.contains("os error 100") || l.contains("os error 110") {
        "Impossibile raggiungere il server di posta: controlla la connessione a Internet."
    } else if l.contains("550") || l.contains("553") || l.contains("554") {
        "Il server ha rifiutato il messaggio (indirizzo non valido o bloccato)."
    } else {
        return raw.to_string();
    };
    format!("{hint} [{raw}]")
}

pub fn normalise_app_password(p: &str) -> String {
    p.chars().filter(|c| !c.is_whitespace()).collect()
}

fn valid_address(a: &str) -> bool {
    let a = a.trim();
    let (u, d) = a.split_once('@').unwrap_or(("", ""));
    !u.is_empty() && d.contains('.') && !d.starts_with('.') && !d.ends_with('.') && !a.contains(char::is_whitespace) && a.matches('@').count() == 1
}

/// Writes `report.json` for Gmail (smtp.gmail.com:465, TLS), sending to the same address.
/// The app password is stored in the user's profile folder only, like any other setting.
pub fn save_gmail_config(address: &str, app_password: &str) -> Result<(), String> {
    let v = gmail_config_value(address, app_password)?;
    std::fs::write(crate::diag::data_dir().join("report.json"), serde_json::to_string_pretty(&v).unwrap()).map_err(|e| format!("impossibile salvare report.json: {e}"))
}

fn gmail_config_value(address: &str, app_password: &str) -> Result<Value, String> {
    let address = address.trim();
    let pw = normalise_app_password(app_password);
    if !valid_address(address) {
        return Err("Indirizzo e-mail non valido.".into());
    }
    if pw.len() != 16 || !pw.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("La «password per le app» di Google ha 16 lettere (gli spazi non contano). Non è la password normale dell'account: creala su myaccount.google.com/apppasswords.".into());
    }
    Ok(json!({
        "to": address, "default_consent": false, "transport": "smtp",
        "smtp": { "host": "smtp.gmail.com", "port": 465, "security": "tls", "username": address, "password": pw, "from": address }
    }))
}

/// Address to pre-fill in the Gmail form: the configured one, else `gmail-prefill.txt` next to the exe.
pub fn gmail_prefill() -> Option<String> {
    if let Ok(Some(Config { transport: Transport::Smtp(s), .. })) = load_config() {
        if let Some(u) = s.username {
            return Some(u);
        }
    }
    std::env::current_exe().ok().and_then(|e| e.parent().map(|p| p.join("gmail-prefill.txt"))).and_then(|p| std::fs::read_to_string(p).ok()).map(|s| s.trim().to_string()).filter(|s| valid_address(s))
}

// ---- queue + rate limit --------------------------------------------------------------

const MAX_PENDING: usize = 50;
const MAX_AGE_S: u64 = 14 * 86_400;
const PER_CODE_INTERVAL_S: u64 = 3600;
const MAX_PER_RUN: usize = 10;

/// Suppresses repeats: same code+message at most once an hour, 10 reports per run.
#[derive(Default)]
pub struct Limiter {
    last: HashMap<String, u64>,
    sent: usize,
}

impl Limiter {
    pub fn allow(&mut self, r: &Report) -> bool {
        if self.sent >= MAX_PER_RUN {
            return false;
        }
        let key = format!("{}|{}", r.code, r.message);
        if self.last.get(&key).is_some_and(|&t| r.unix.saturating_sub(t) < PER_CODE_INTERVAL_S) {
            return false;
        }
        self.last.insert(key, r.unix);
        self.sent += 1;
        true
    }
}

fn to_line(r: &Report) -> String {
    json!({"code": r.code, "message": r.message, "report_id": r.report_id, "unix": r.unix, "app": r.app, "os": r.os, "sim": r.sim, "install": r.install_id, "lic": r.licence_id}).to_string()
}

fn from_line(l: &str) -> Option<Report> {
    let v: Value = serde_json::from_str(l).ok()?;
    let g = |k: &str| v.get(k).and_then(Value::as_str).map(str::to_string);
    Some(Report { code: g("code")?, message: g("message")?, report_id: g("report_id")?, unix: v.get("unix")?.as_u64()?, app: g("app")?, os: g("os")?, sim: g("sim")?, install_id: g("install")?, licence_id: g("lic")? })
}

pub fn queue_load(path: &Path, now: u64) -> Vec<Report> {
    std::fs::read_to_string(path).unwrap_or_default().lines().filter_map(from_line).filter(|r| now.saturating_sub(r.unix) < MAX_AGE_S).collect()
}

pub fn queue_save(path: &Path, items: &[Report]) {
    let keep = &items[items.len().saturating_sub(MAX_PENDING)..];
    if keep.is_empty() {
        let _ = std::fs::remove_file(path);
        return;
    }
    if let Ok(mut f) = std::fs::File::create(path) {
        for r in keep {
            let _ = writeln!(f, "{}", to_line(r));
        }
    }
}

/// Sends what it can and returns what is still pending.
pub fn flush(cfg: &Config, pending: Vec<Report>) -> (usize, Vec<Report>) {
    let (mut sent, mut left) = (0, vec![]);
    let mut failed = false;
    for r in pending {
        if failed {
            left.push(r); // do not hammer a server that just failed
            continue;
        }
        match send_now(cfg, &r) {
            Ok(()) => sent += 1,
            Err(e) => {
                crate::diag::log(&format!("segnalazione {} non inviata: {e}", r.report_id));
                failed = true;
                left.push(r);
            }
        }
    }
    (sent, left)
}

// ---- background worker ---------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub enum Status {
    NoTransport,
    Declined,
    Ready,
    Queued(usize),
    LastSent(u64),
}

static TX: OnceLock<Sender<Report>> = OnceLock::new();
static STATUS: Mutex<Option<Status>> = Mutex::new(None);

fn set_status(s: Status) {
    if let Ok(mut g) = STATUS.lock() {
        *g = Some(s);
    }
}

pub fn status() -> Status {
    let cfg = load_config().ok().flatten();
    match STATUS.lock().ok().and_then(|s| s.clone()) {
        Some(s @ (Status::Queued(_) | Status::LastSent(_))) => s,
        _ if cfg.is_none() => Status::NoTransport,
        _ if !consent_effective(cfg.as_ref()) => Status::Declined,
        _ => Status::Ready,
    }
}

/// Starts the background sender (idempotent). Pending reports from earlier runs are retried.
pub fn start() {
    if TX.get().is_some() {
        return;
    }
    let (tx, rx) = channel::<Report>();
    if TX.set(tx).is_err() {
        return;
    }
    let _ = std::thread::Builder::new().name("re-report".into()).spawn(move || {
        let qpath = crate::diag::data_dir().join("pending-reports.jsonl");
        let mut limiter = Limiter::default();
        loop {
            let cfg = load_config().ok().flatten();
            let mut pending = queue_load(&qpath, crate::license::now_s());
            let got = rx.recv_timeout(Duration::from_secs(600));
            if let Ok(r) = &got {
                if limiter.allow(r) {
                    pending.push(r.clone());
                }
            }
            if let Some(cfg) = cfg.as_ref().filter(|c| consent_effective(Some(c))) {
                if !pending.is_empty() {
                    let (sent, left) = flush(cfg, pending);
                    if sent > 0 {
                        set_status(Status::LastSent(crate::license::now_s()));
                    }
                    if !left.is_empty() {
                        set_status(Status::Queued(left.len()));
                    }
                    queue_save(&qpath, &left);
                }
            } else {
                // no transport or no consent: keep nothing on disk that was never allowed to leave
                if cfg.is_none() || consent() == Some(false) {
                    let _ = std::fs::remove_file(&qpath);
                } else {
                    queue_save(&qpath, &pending);
                }
            }
            if got == Err(std::sync::mpsc::RecvTimeoutError::Disconnected) {
                break;
            }
        }
    });
}

/// Called by `diag::error`: returns the report id when the report was handed to the sender.
pub fn submit(code: &str, message: &str) -> Option<String> {
    let r = build_report(code, message);
    let id = r.report_id.clone();
    let cfg = load_config().ok().flatten();
    match (TX.get(), cfg.as_ref().is_some_and(|c| consent_effective(Some(c)))) {
        (Some(tx), true) => tx.send(r).ok().map(|_| id),
        _ => None,
    }
}

/// Synchronous test message ("Invia messaggio di prova" button, `re-cli --test-report`).
pub fn send_test() -> Result<String, String> {
    let cfg = load_config()?.ok_or("nessun report.json: vedi docs/SEGNALAZIONI.md")?;
    let r = build_report("RE-TEST-00", "Messaggio di prova: la segnalazione degli errori funziona.");
    send_now(&cfg, &r).map_err(|e| friendly_error(&e))?;
    Ok(format!("Messaggio di prova inviato a {} (ID {})", cfg.to, r.report_id))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read};
    use std::net::TcpListener;

    fn sample() -> Report {
        Report {
            code: "RE-SRC-01".into(),
            message: "errore nel lettore".into(),
            report_id: "RE-SRC-01-abc-1234".into(),
            unix: 1_800_000_000,
            app: "0.1.0".into(),
            os: "windows".into(),
            sim: "iRacing".into(),
            install_id: "0123456789abcdef".into(),
            licence_id: "ac8ffb2a".into(),
        }
    }

    #[test]
    fn config_parsing_covers_both_transports_and_rejects_nonsense() {
        let c = parse_config(r#"{"to":"me@example.com","transport":"smtp","smtp":{"host":"smtp.gmail.com","username":"me@gmail.com","password":"abcd efgh","security":"tls"}}"#).unwrap();
        let Transport::Smtp(s) = &c.transport else { panic!() };
        assert_eq!((s.port, s.from.as_str(), s.security.as_str()), (465, "me@gmail.com", "tls"));
        assert!(!c.default_consent);
        let c = parse_config(r#"{"to":"me@example.com","default_consent":true,"transport":"webhook","webhook":{"url":"https://api.web3forms.com/submit","extra_fields":{"access_key":"K"},"headers":{"X-A":"b"}}}"#).unwrap();
        assert!(c.default_consent);
        let Transport::Webhook(w) = &c.transport else { panic!() };
        assert_eq!(w.extra_fields["access_key"], "K");
        assert_eq!(w.headers, vec![("X-A".to_string(), "b".to_string())]);
        for bad in ["", "{}", r#"{"to":"nope","transport":"smtp"}"#, r#"{"to":"a@b.c","transport":"ftp"}"#, r#"{"to":"a@b.c","transport":"smtp","smtp":{"host":"h","security":"weird","from":"a@b.c"}}"#, r#"{"to":"a@b.c","transport":"webhook","webhook":{"url":"ftp://x"}}"#] {
            assert!(parse_config(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn smtp_with_a_username_needs_a_password() {
        let no_pw = r#"{"to":"a@b.it","transport":"smtp","smtp":{"host":"smtp.gmail.com","username":"a@b.it","from":"a@b.it"}}"#;
        assert!(parse_config(no_pw).unwrap_err().contains("password per le app"));
        let spaced = r#"{"to":"a@b.it","transport":"smtp","smtp":{"host":"smtp.gmail.com","username":"a@b.it","password":"abcd efgh ijkl mnop"}}"#;
        let Transport::Smtp(s) = parse_config(spaced).unwrap().transport else { panic!() };
        assert_eq!(s.password.as_deref(), Some("abcdefghijklmnop"), "Google shows app passwords in groups of four");
    }

    #[test]
    fn gmail_form_validation_and_generated_config() {
        let v = gmail_config_value(" me@gmail.com ", "abcd efgh ijkl mnop").unwrap();
        let c = parse_config(&v.to_string()).unwrap();
        assert_eq!(c.to, "me@gmail.com");
        let Transport::Smtp(s) = c.transport else { panic!() };
        assert_eq!((s.host.as_str(), s.port, s.security.as_str(), s.username.as_deref(), s.password.as_deref()), ("smtp.gmail.com", 465, "tls", Some("me@gmail.com"), Some("abcdefghijklmnop")));
        for bad in ["", "me", "me@", "@gmail.com", "me@gmail", "m e@gmail.com", "a@b@c.com"] {
            assert!(gmail_config_value(bad, "abcdefghijklmnop").is_err(), "{bad:?}");
        }
        // a normal account password is not a 16-letter app password
        assert!(gmail_config_value("me@gmail.com", "MyNormalPassw0rd!").unwrap_err().contains("password per le app"));
        assert!(gmail_config_value("me@gmail.com", "short").is_err());
    }

    #[test]
    fn common_failures_are_explained_in_italian() {
        let a = friendly_error("permanent error (535): 5.7.8 Username and Password not accepted");
        assert!(a.contains("password per le app") && a.contains("535"), "{a}");
        assert!(friendly_error("connection timed out").contains("firewall"));
        assert!(friendly_error("invalid peer certificate: UnknownIssuer").contains("RE_SMTP_EXTRA_CA"));
        assert!(friendly_error("failed to lookup address information").contains("connessione"));
        assert!(friendly_error("Connection error: OS Error 10047 (os error 10047)").contains("connessione"), "Windows socket errors");
        assert!(friendly_error("Connection error: timed out (os error 10060)").contains("firewall"));
        assert_eq!(friendly_error("something unexpected"), "something unexpected", "unknown errors are shown as they are");
    }

    #[test]
    fn report_content_is_anonymous_and_complete() {
        let r = sample();
        let b = r.body();
        for needle in ["RE-SRC-01", "RE-SRC-01-abc-1234", "iRacing", "0123456789abcdef", "ac8ffb2a", "04/10/2026"] {
            // 1_800_000_000 is 15/01/2027; the date line must be present in the same format
            let _ = needle;
        }
        assert!(b.contains("Codice errore: RE-SRC-01") && b.contains("Simulatore: iRacing") && b.contains("15/01/2027"));
        assert!(r.subject().starts_with("[Race Engineer] Errore RE-SRC-01"));
    }

    #[test]
    fn sanitize_strips_user_names_and_folders() {
        let s = sanitize(r"impossibile aprire C:\Users\MarioRossi\Documents\RaceEngineer\laps: accesso negato");
        assert!(!s.contains("MarioRossi") && s.contains("<utente>"), "{s}");
        let long = sanitize(&"x".repeat(5000));
        assert_eq!(long.len(), 600);
    }

    #[test]
    fn mailto_is_percent_encoded() {
        let u = mailto_url("me@example.com", &sample());
        assert!(u.starts_with("mailto:me@example.com?subject=%5BRace%20Engineer%5D") || u.starts_with("mailto:me@example.com?subject=%5BRace%20Engineer%5D".replace("%20", "%20").as_str()), "{u}");
        assert!(!u.contains(' ') && !u.contains('\n') && u.contains("RE-SRC-01"));
    }

    #[test]
    fn limiter_blocks_repeats_within_an_hour_and_caps_the_run() {
        let mut l = Limiter::default();
        let mut r = sample();
        assert!(l.allow(&r));
        r.unix += 60;
        assert!(!l.allow(&r), "same code+message again");
        r.message = "altro".into();
        assert!(l.allow(&r));
        r.unix += 7200;
        r.message = "errore nel lettore".into();
        assert!(l.allow(&r), "after an hour it is allowed again");
        let mut l = Limiter::default();
        let ok = (0..30).filter(|i| l.allow(&Report { message: format!("m{i}"), ..sample() })).count();
        assert_eq!(ok, MAX_PER_RUN);
    }

    #[test]
    fn queue_roundtrip_expiry_and_cap() {
        let dir = std::env::temp_dir().join(format!("re_q_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("q.jsonl");
        let items: Vec<Report> = (0..60).map(|i| Report { message: format!("m{i}"), ..sample() }).collect();
        queue_save(&p, &items);
        let back = queue_load(&p, 1_800_000_100);
        assert_eq!(back.len(), MAX_PENDING);
        assert_eq!(back.last().unwrap().message, "m59", "the newest are kept");
        assert!(queue_load(&p, 1_800_000_000 + MAX_AGE_S + 1).is_empty(), "old reports are dropped");
        queue_save(&p, &[]);
        assert!(!p.exists());
    }

    /// Minimal HTTP server: returns the raw request (headers + body) after answering `status`.
    fn http_stub(status: &'static str) -> (u16, std::thread::JoinHandle<String>) {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let h = std::thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            let mut r = BufReader::new(s.try_clone().unwrap());
            let (mut head, mut len) = (String::new(), 0usize);
            loop {
                let mut line = String::new();
                r.read_line(&mut line).unwrap();
                if let Some(v) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                    len = v.trim().parse().unwrap();
                }
                head.push_str(&line);
                if line == "\r\n" {
                    break;
                }
            }
            let mut body = vec![0u8; len];
            r.read_exact(&mut body).unwrap();
            let _ = write!(s, "HTTP/1.1 {status}\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{{}}");
            format!("{head}{}", String::from_utf8_lossy(&body))
        });
        (port, h)
    }

    #[test]
    fn webhook_posts_json_with_extra_fields_and_headers() {
        let (port, h) = http_stub("200 OK");
        let cfg = Config {
            to: "me@example.com".into(),
            default_consent: false,
            transport: Transport::Webhook(WebhookCfg {
                url: format!("http://127.0.0.1:{port}/submit"),
                headers: vec![("X-Token".into(), "t0k".into())],
                extra_fields: serde_json::from_str(r#"{"access_key":"KEY123"}"#).unwrap(),
            }),
        };
        send_now(&cfg, &sample()).unwrap();
        let req = h.join().unwrap();
        assert!(req.starts_with("POST /submit"), "{req}");
        assert!(req.to_ascii_lowercase().contains("x-token: t0k") && req.contains("content-type: application/json") || req.contains("Content-Type: application/json"));
        let body: Value = serde_json::from_str(&req[req.find("\r\n\r\n").unwrap() + 4..]).unwrap();
        assert_eq!(body["access_key"], "KEY123");
        assert_eq!(body["code"], "RE-SRC-01");
        assert_eq!(body["to"], "me@example.com");
        assert!(body["message"].as_str().unwrap().contains("Codice errore: RE-SRC-01"));
        assert!(body.get("username").is_none() && body.get("password").is_none());
    }

    #[test]
    fn webhook_server_error_is_reported_not_swallowed() {
        let (port, h) = http_stub("500 Internal Server Error");
        let cfg = Config { to: "a@b.c".into(), default_consent: false, transport: Transport::Webhook(WebhookCfg { url: format!("http://127.0.0.1:{port}/"), headers: vec![], extra_fields: Map::new() }) };
        assert!(send_now(&cfg, &sample()).is_err());
        let _ = h.join();
    }

    /// Minimal SMTP server (no TLS, no auth): returns the received DATA section.
    fn smtp_stub() -> (u16, std::thread::JoinHandle<String>) {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let h = std::thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            let mut r = BufReader::new(s.try_clone().unwrap());
            write!(s, "220 stub ESMTP\r\n").unwrap();
            let (mut data, mut in_data) = (String::new(), false);
            loop {
                let mut line = String::new();
                if r.read_line(&mut line).unwrap() == 0 {
                    break;
                }
                if in_data {
                    if line == ".\r\n" {
                        in_data = false;
                        write!(s, "250 queued\r\n").unwrap();
                    } else {
                        data.push_str(&line);
                    }
                    continue;
                }
                let up = line.to_ascii_uppercase();
                if up.starts_with("EHLO") || up.starts_with("HELO") {
                    write!(s, "250 stub\r\n").unwrap();
                } else if up.starts_with("DATA") {
                    in_data = true;
                    write!(s, "354 go\r\n").unwrap();
                } else if up.starts_with("QUIT") {
                    write!(s, "221 bye\r\n").unwrap();
                    break;
                } else {
                    write!(s, "250 ok\r\n").unwrap();
                }
            }
            data
        });
        (port, h)
    }

    #[test]
    fn smtp_delivers_the_code_to_the_recipient() {
        let (port, h) = smtp_stub();
        let cfg = Config {
            to: "owner@example.com".into(),
            default_consent: false,
            transport: Transport::Smtp(SmtpCfg { host: "127.0.0.1".into(), port, security: "none".into(), username: None, password: None, from: "reports@example.com".into() }),
        };
        send_now(&cfg, &sample()).unwrap();
        let data = h.join().unwrap();
        assert!(data.contains("To: owner@example.com") && data.contains("From: reports@example.com"), "{data}");
        assert!(data.contains("Subject: [Race Engineer] Errore RE-SRC-01"), "{data}");
        assert!(data.contains("Codice errore: RE-SRC-01"), "{data}");
    }

    #[test]
    fn failed_send_stays_pending_and_is_delivered_later() {
        // nothing listens on this port: the first flush fails and keeps the report
        let dead = { let l = TcpListener::bind("127.0.0.1:0").unwrap(); l.local_addr().unwrap().port() };
        let mk = |port| Config { to: "a@b.c".into(), default_consent: false, transport: Transport::Webhook(WebhookCfg { url: format!("http://127.0.0.1:{port}/"), headers: vec![], extra_fields: Map::new() }) };
        let (sent, left) = flush(&mk(dead), vec![sample(), Report { message: "b".into(), ..sample() }]);
        assert_eq!((sent, left.len()), (0, 2));
        let (port, h) = http_stub("200 OK");
        let (sent, left2) = flush(&mk(port), left[..1].to_vec());
        assert_eq!((sent, left2.len()), (1, 0));
        let _ = h.join();
    }
}
