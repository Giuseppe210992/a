//! Native Windows dashboard (egui/eframe, OpenGL).
//!
//! The UI never touches the simulator, BLE or audio paths: it reads a snapshot that the
//! engineer thread refreshes at ~30 Hz and repaints at a capped rate (15/30/60 fps).

mod layout;
mod widgets;

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::{Duration, Instant};

use eframe::egui::{self, Color32, RichText, Ui};

use crate::biometrics::{ArousalLevel, BiometricConfig};
use crate::engineer::EngineerConfig;
use crate::runtime::{EngineerMode, Runtime, RuntimeConfig, Snapshot};
use crate::sources::{self, SourceKind};
use widgets::{card, color};

/// Sends the test message on a worker thread; on success, optionally turns automatic reports on.
fn spawn_report_test(slot: Arc<std::sync::Mutex<Option<Result<String, String>>>>, busy: Arc<AtomicBool>, enable_on_success: bool) {
    std::thread::spawn(move || {
        let r = crate::report::send_test();
        if enable_on_success && r.is_ok() {
            crate::report::set_consent(true);
        }
        let r = r.map(|m| if enable_on_success { format!("{m}. Invio automatico degli errori attivato.") } else { m });
        if let Ok(mut g) = slot.lock() {
            *g = Some(r);
        }
        busy.store(false, std::sync::atomic::Ordering::Relaxed);
    });
}

struct SetupState {
    kind: SourceKind,
    synthetic_speedup: f64,
    /// 0 = the default port of the selected UDP simulator.
    udp_port: u16,
    hr_ble: bool,
    hr_demo: bool,
    hr_name: String,
    voice: bool,
    /// Offline voice commands (microphone), experimental.
    stt: bool,
    resting_hr: f32,
    max_hr: f32,
    tyre_hot_c: f32,
    tyre_cold_c: f32,
    brake_lead_s: f32,
    save_laps: bool,
    lap_dir: String,
    error: Option<String>,
    wrc_msg: Option<Result<String, String>>,
    report_result: Arc<std::sync::Mutex<Option<Result<String, String>>>>,
    report_busy: Arc<AtomicBool>,
    gmail_addr: String,
    gmail_pw: String,
    show_gmail: bool,
}

impl Default for SetupState {
    fn default() -> Self {
        let def = EngineerConfig::default();
        let bio = BiometricConfig::default();
        Self {
            kind: if cfg!(windows) { SourceKind::IRacing } else { SourceKind::Synthetic },
            synthetic_speedup: 10.0,
            udp_port: 0,
            hr_ble: false,
            hr_demo: true,
            hr_name: String::new(),
            voice: crate::voice_sinks::CAN_SPEAK,
            stt: false,
            resting_hr: bio.resting_hr,
            max_hr: bio.max_hr,
            tyre_hot_c: def.tyre_hot_c,
            tyre_cold_c: def.tyre_cold_c,
            brake_lead_s: def.brake_call_lead_s,
            save_laps: true,
            lap_dir: crate::diag::default_lap_dir().display().to_string(),
            error: None,
            wrc_msg: None,
            report_result: Arc::new(std::sync::Mutex::new(None)),
            report_busy: Arc::new(AtomicBool::new(false)),
            gmail_addr: crate::report::gmail_prefill().unwrap_or_default(),
            gmail_pw: String::new(),
            show_gmail: false,
        }
    }
}

impl SetupState {
    fn path() -> std::path::PathBuf {
        crate::diag::data_dir().join("settings.txt")
    }

    fn kind_key(k: SourceKind) -> &'static str {
        match k {
            SourceKind::Synthetic => "synthetic",
            SourceKind::IRacing => "iracing",
            SourceKind::Acc => "acc",
            SourceKind::F1 => "f1",
            SourceKind::Forza => "forza",
            SourceKind::Lmu => "lmu",
            SourceKind::AcEvo => "acevo",
            SourceKind::Wrc => "wrc",
        }
    }

    fn save(&self, fps: u32) {
        let t = format!(
            "kind={}\nsynthetic_speedup={}\nudp_port={}\nhr_ble={}\nhr_demo={}\nhr_name={}\nvoice={}\nstt={}\nresting_hr={}\nmax_hr={}\ntyre_hot_c={}\ntyre_cold_c={}\nbrake_lead_s={}\nsave_laps={}\nlap_dir={}\nfps={}\n",
            Self::kind_key(self.kind), self.synthetic_speedup, self.udp_port, self.hr_ble, self.hr_demo, self.hr_name.replace('\n', " "),
            self.voice, self.stt, self.resting_hr, self.max_hr, self.tyre_hot_c, self.tyre_cold_c, self.brake_lead_s, self.save_laps,
            self.lap_dir.replace('\n', " "), fps
        );
        let _ = std::fs::write(Self::path(), t);
    }

    /// Reads `settings.txt`; unknown or invalid lines are ignored so a bad file never blocks startup.
    fn load(fps: &mut u32) -> Self {
        let mut s = Self::default();
        let Ok(text) = std::fs::read_to_string(Self::path()) else { return s };
        for line in text.lines() {
            let Some((k, v)) = line.split_once('=') else { continue };
            let v = v.trim();
            match k.trim() {
                "kind" => {
                    if let Some(kind) = SourceKind::ALL.into_iter().find(|k| Self::kind_key(*k) == v && k.available_here()) {
                        s.kind = kind;
                    }
                }
                "synthetic_speedup" => s.synthetic_speedup = v.parse().ok().filter(|x: &f64| (1.0..=60.0).contains(x)).unwrap_or(s.synthetic_speedup),
                "udp_port" => s.udp_port = v.parse().unwrap_or(0),
                "hr_ble" => s.hr_ble = v == "true",
                "hr_demo" => s.hr_demo = v == "true",
                "hr_name" => s.hr_name = v.to_string(),
                "voice" => s.voice = v == "true" && crate::voice_sinks::CAN_SPEAK,
                "stt" => s.stt = v == "true",
                "resting_hr" => s.resting_hr = v.parse().ok().filter(|x: &f32| (35.0..=100.0).contains(x)).unwrap_or(s.resting_hr),
                "max_hr" => s.max_hr = v.parse().ok().filter(|x: &f32| (120.0..=230.0).contains(x)).unwrap_or(s.max_hr),
                "tyre_hot_c" => s.tyre_hot_c = v.parse().ok().filter(|x: &f32| (60.0..=160.0).contains(x)).unwrap_or(s.tyre_hot_c),
                "tyre_cold_c" => s.tyre_cold_c = v.parse().ok().filter(|x: &f32| (20.0..=90.0).contains(x)).unwrap_or(s.tyre_cold_c),
                "brake_lead_s" => s.brake_lead_s = v.parse().ok().filter(|x: &f32| (0.3..=2.5).contains(x)).unwrap_or(s.brake_lead_s),
                "save_laps" => s.save_laps = v == "true",
                "lap_dir" if !v.is_empty() => s.lap_dir = v.to_string(),
                "fps" => *fps = v.parse().ok().filter(|f| [15, 30, 60].contains(f)).unwrap_or(*fps),
                _ => {}
            }
        }
        s
    }
}

struct Session {
    runtime: Runtime,
    /// Helper threads (BLE client, demo heart rate) and the flag that stops them.
    aux: Vec<std::thread::JoinHandle<()>>,
    aux_stop: Arc<AtomicBool>,
    #[cfg(feature = "stt")]
    _stt: Option<crate::stt::SttHandle>,
    tyre_hot_c: f32,
    tyre_cold_c: f32,
    hr_requested: bool,
    started: Instant,
}

impl Session {
    fn stop(self) {
        self.aux_stop.store(true, Ordering::Relaxed);
        for h in self.aux {
            let _ = h.join();
        }
        self.runtime.shutdown();
    }
}

/// Access-code gate (see `license`). `licence == None` while the gate is shown.
struct Access {
    licence: Option<crate::license::Licence>,
    input: String,
    message: Option<String>,
    /// last time the expiry was evaluated while running
    last_check: Instant,
}

impl Access {
    fn startup() -> Self {
        use crate::license::Startup;
        let (licence, message) = match crate::license::startup() {
            Startup::Open => (Some(crate::license::Licence { id: String::new(), label: String::new(), issued_at: 0, expires_at: None }), None),
            Startup::Granted(l) => (Some(l), None),
            Startup::NeedsCode(e) => (None, e.map(|e| format!("{} ({})", e.message(), e.code()))),
        };
        Self { licence, input: String::new(), message, last_check: Instant::now() }
    }

    fn open(&self) -> bool {
        self.licence.is_some()
    }

    fn try_code(&mut self) {
        match crate::license::validate(&self.input) {
            Ok(l) => {
                crate::license::save_code(&self.input);
                crate::diag::log(&format!("accesso consentito (id {})", l.id));
                self.licence = Some(l);
                self.message = None;
                self.input.clear();
            }
            Err(e) => {
                crate::diag::log(&format!("codice rifiutato: {}", e.code()));
                self.message = Some(format!("{} ({})", e.message(), e.code()));
            }
        }
    }

    /// One-line summary for the header / setup screen.
    fn summary(&self) -> Option<(String, bool)> {
        let l = self.licence.as_ref()?;
        let exp = l.expires_at?;
        let left = exp.saturating_sub(crate::license::now_s());
        let who = if l.label.is_empty() { String::new() } else { format!("{} · ", l.label) };
        Some((format!("{who}accesso valido fino al {} ({})", crate::license::fmt_date(exp), if left >= 86_400 { format!("{} giorni", left / 86_400) } else { format!("{} ore", left / 3600) }), left < 3 * 86_400))
    }
}

pub struct ReApp {
    access: Access,
    setup: SetupState,
    session: Option<Session>,
    view: Snapshot,
    fps: u32,
    layout: layout::Layout,
    layout_dirty: bool,
    /// Bumped when the menu changes the layout, so egui forgets dragged panel sizes and takes the new ones.
    layout_gen: u32,
    /// Live path while the first lap has not produced a reference map yet.
    trail: Vec<[f32; 2]>,
    last_frames_in: u64,
    last_frames_change: Instant,
}

impl Default for ReApp {
    fn default() -> Self {
        let mut fps = 30;
        let setup = SetupState::load(&mut fps);
        Self {
            access: Access::startup(),
            setup,
            session: None,
            view: Snapshot::default(),
            fps,
            layout: layout::Layout::load(),
            layout_dirty: false,
            layout_gen: 0,
            trail: vec![],
            last_frames_in: 0,
            last_frames_change: Instant::now(),
        }
    }
}

fn native_options(renderer: eframe::Renderer) -> eframe::NativeOptions {
    eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default().with_inner_size([1360.0, 820.0]).with_min_inner_size([1000.0, 640.0]).with_title("Race Engineer"),
        renderer,
        ..Default::default()
    }
}

fn create_app(cc: &eframe::CreationContext<'_>) -> Result<Box<dyn eframe::App>, Box<dyn std::error::Error + Send + Sync>> {
    // Always dark: the cards use fixed dark colours, so following a light Windows theme would clash.
    cc.egui_ctx.set_theme(egui::ThemePreference::Dark);
    let mut app = ReApp::default();
    // `--autostart synthetic|f1|forza|iracing|acc` skips the setup screen (kiosk / testing).
    let args: Vec<String> = std::env::args().collect();
    if let Some(i) = args.iter().position(|a| a == "--autostart") {
        app.setup.kind = match args.get(i + 1).map(String::as_str) {
            Some("f1") => SourceKind::F1,
            Some("forza") => SourceKind::Forza,
            Some("lmu") => SourceKind::Lmu,
            Some("acevo") => SourceKind::AcEvo,
            Some("wrc") => SourceKind::Wrc,
            Some("iracing") => SourceKind::IRacing,
            Some("acc") => SourceKind::Acc,
            _ => SourceKind::Synthetic,
        };
        app.start();
    }
    if std::env::var_os("RE_DEBUG_RAISE").is_some() {
        crate::diag::error("RE-TEST-01", "errore di prova (RE_DEBUG_RAISE)");
    }
    Ok(Box::new(app))
}

pub fn run() -> eframe::Result {
    crate::diag::init("re-gui.log");
    crate::report::start();
    let r = eframe::run_native("Race Engineer", native_options(eframe::Renderer::Glow), Box::new(create_app));
    if let Err(e) = &r {
        let msg = format!("Impossibile aprire la finestra grafica (serve OpenGL 2.0 o superiore; aggiorna i driver video): {e}");
        crate::diag::error("RE-GUI-01", msg.clone());
        #[cfg(windows)]
        crate::diag::message_box("Race Engineer", &msg);
    }
    r
}

impl ReApp {
    fn start(&mut self) {
        let s = &self.setup;
        let source = match sources::open(s.kind, s.synthetic_speedup, s.kind.default_udp_port().map(|d| if s.udp_port == 0 { d } else { s.udp_port })) {
            Ok(src) => src,
            Err(e) => {
                self.setup.error = Some(e);
                return;
            }
        };
        let aux_stop = Arc::new(AtomicBool::new(false));
        let mut aux = vec![];
        #[allow(unused_mut)]
        let mut hr_rx = None;
        if s.kind == SourceKind::Synthetic && s.hr_demo {
            let (tx, rx) = std::sync::mpsc::channel();
            hr_rx = Some(rx);
            aux.push(sources::sim::spawn_hr_demo(tx, aux_stop.clone()));
        }
        #[cfg(feature = "ble")]
        if s.hr_ble {
            let (tx, rx) = std::sync::mpsc::channel();
            hr_rx = Some(rx);
            let name = Some(s.hr_name.trim().to_string()).filter(|n| !n.is_empty());
            aux.push(crate::ble::spawn_hr_listener(crate::ble::BleConfig { name_filter: name, ..Default::default() }, tx, aux_stop.clone()));
        }
        let cfg = RuntimeConfig {
            engineer: EngineerConfig {
                tyre_hot_c: s.tyre_hot_c,
                tyre_cold_c: s.tyre_cold_c,
                brake_call_lead_s: s.brake_lead_s,
                ..Default::default()
            },
            biometrics: BiometricConfig { resting_hr: s.resting_hr, max_hr: s.max_hr, ..Default::default() },
            lap_dir: s.save_laps.then(|| s.lap_dir.clone().into()),
            ..Default::default()
        };
        // an old amber warning is stale once a new session starts; a red error stays until the user closes it
        crate::diag::clear_severity(crate::diag::Severity::Warning);
        crate::report::set_context(s.kind.label(), &self.access.licence.as_ref().map(|l| l.id.clone()).unwrap_or_default());
        s.save(self.fps);
        let runtime = Runtime::spawn(source, hr_rx, crate::voice_sinks::default_factory(s.voice), cfg);
        #[cfg(feature = "stt")]
        let stt = if s.stt {
            match crate::stt::start(runtime.command_tx.clone()) {
                Ok(h) => Some(h),
                Err(e) => {
                    crate::diag::warn("RE-STT-01", format!("comandi vocali non attivi: {e}"));
                    None
                }
            }
        } else {
            None
        };
        #[cfg(not(feature = "stt"))]
        if s.stt {
            crate::diag::warn("RE-STT-02", "questa build non include i comandi vocali (feature stt)");
        }
        self.trail.clear();
        self.view = Snapshot::default();
        self.session = Some(Session {
            runtime,
            aux,
            aux_stop,
            #[cfg(feature = "stt")]
            _stt: stt,
            tyre_hot_c: s.tyre_hot_c,
            tyre_cold_c: s.tyre_cold_c,
            hr_requested: s.hr_ble || (s.kind == SourceKind::Synthetic && s.hr_demo),
            started: Instant::now(),
        });
        self.setup.error = None;
    }

    fn stop(&mut self) {
        if let Some(s) = self.session.take() {
            s.stop();
        }
    }

    fn pull_snapshot(&mut self) {
        let Some(s) = &self.session else { return };
        if let Ok(g) = s.runtime.snapshot.lock() {
            self.view = g.clone();
        }
        if self.view.frames_in != self.last_frames_in {
            self.last_frames_in = self.view.frames_in;
            self.last_frames_change = Instant::now();
        }
        let has_reference_map = self.view.analysis.track.as_ref().is_some_and(|t| t.path.len() > 10);
        if has_reference_map {
            self.trail.clear();
        } else if let Some(p) = self.view.frame.as_ref().and_then(|f| f.pos_m) {
            let far = self.trail.last().is_none_or(|l| (l[0] - p[0]).hypot(l[1] - p[1]) > 3.0);
            if far && self.trail.len() < 6000 {
                self.trail.push(p);
            }
        }
    }
}

impl eframe::App for ReApp {
    fn ui(&mut self, ui: &mut Ui, _frame: &mut eframe::Frame) {
        ui.ctx().request_repaint_after(Duration::from_millis(1000 / self.fps.max(1) as u64));
        // expiry while running: stop everything and ask for a new code
        if self.access.open() && self.access.last_check.elapsed() >= Duration::from_secs(1) {
            self.access.last_check = Instant::now();
            if let Some(exp) = self.access.licence.as_ref().and_then(|l| l.expires_at) {
                if crate::license::now_s() >= exp {
                    self.stop();
                    self.access.message = Some(format!("{} ({})", "Il codice è scaduto: inserisci un nuovo codice.", "RE-ACC-03"));
                    self.access.licence = None;
                }
            }
        }
        if !self.access.open() {
            self.access_screen(ui);
            return;
        }
        if self.session.is_some() {
            self.pull_snapshot();
            self.dashboard(ui);
        } else {
            self.setup_screen(ui);
        }
    }

    fn on_exit(&mut self, _gl: Option<&eframe::glow::Context>) {
        self.setup.save(self.fps);
        self.layout.save();
        self.stop();
    }
}

fn hint(kind: SourceKind) -> &'static str {
    match kind {
        SourceKind::Synthetic => "Genera una vettura e una pista simulate: serve a provare dashboard, voce e analisi senza simulatore.",
        SourceKind::IRacing => "Nessuna impostazione necessaria: avvia iRacing e vai in pista. (Opzionale: 360 Hz con irsdkEnableMem=1 e irsdkLog360Hz=1 in app.ini.)",
        SourceKind::Acc => "Nessuna impostazione necessaria: avvia ACC e vai in pista. Gli offset della memoria condivisa vanno validati (docs/VALIDATION.md).",
        SourceKind::Lmu => "Nel gioco: Impostazioni > Gameplay > «Abilita plugin» = ON, poi riavvia Le Mans Ultimate (serve anche senza plugin). Poi avvia una sessione. Nessun altro file da installare.",
        SourceKind::AcEvo => "Nessuna impostazione nel gioco: avvia AC EVO e vai in pista. Il gioco è in accesso anticipato: il formato può cambiare tra una build e l'altra (i valori fuori scala vengono scartati).",
        SourceKind::Wrc => "Sperimentale. Avvia EA WRC almeno una volta, poi premi «Prepara EA WRC» qui sotto (scrive la struttura di telemetria e una voce in config.json, con backup) e riavvia il gioco. Non c'è posizione 3D: mappa dal vivo non disponibile.",
        SourceKind::Forza => "In gioco: Impostazioni > Gameplay e HUD > Data Out (telemetria UDP) attivo, IP 127.0.0.1, la porta qui sotto, formato \"Dash\". Formato non verificato su un PC reale: niente curve/delta (il gioco non invia la posizione sul giro), ma dashboard, pedali, giri e mappa dal vivo.",
        SourceKind::F1 => "In gioco: Impostazioni > Telemetria > UDP attivo, IP 127.0.0.1, porta 20777, formato 2025, frequenza 60 Hz. Curve, delta e chiamate di frenata funzionano grazie ai pacchetti Lap Data e Sessione.",
    }
}

impl ReApp {
    fn access_screen(&mut self, ui: &mut Ui) {
        egui::CentralPanel::default().show(ui, |ui| {
            ui.vertical_centered(|ui| {
                ui.add_space(60.0);
                ui.label(RichText::new("Race Engineer").size(30.0).strong());
                ui.label(RichText::new("Inserisci il tuo codice di accesso").color(color::TEXT_DIM));
                ui.add_space(18.0);
                ui.add(
                    egui::TextEdit::multiline(&mut self.access.input)
                        .desired_width(560.0)
                        .desired_rows(4)
                        .hint_text("RE1-XXXXXXXX-XXXXXXXX-…")
                        .font(egui::TextStyle::Monospace),
                );
                ui.add_space(8.0);
                if let Some(m) = &self.access.message {
                    ui.label(RichText::new(m).color(color::RED));
                    ui.add_space(6.0);
                }
                if ui.add_sized([200.0, 36.0], egui::Button::new(RichText::new("Accedi").size(16.0))).clicked() {
                    self.access.try_code();
                }
                ui.add_space(16.0);
                ui.label(RichText::new(format!("Il codice ti viene fornito da chi ti ha dato il programma. Impronta chiave: {}", crate::license::key_fingerprint())).size(11.0).color(color::TEXT_DIM));
            });
        });
    }

    fn setup_screen(&mut self, ui: &mut Ui) {
        egui::CentralPanel::default().show(ui, |ui| {
            ui.vertical_centered(|ui| {
                ui.add_space(24.0);
                ui.label(RichText::new("Race Engineer").size(30.0).strong());
                ui.label(RichText::new("AI Race Engineer + Co-Driver · tutto in locale sul PC").color(color::TEXT_DIM));
                if let Some((txt, soon)) = self.access.summary() {
                    ui.label(RichText::new(txt).size(12.0).color(if soon { color::AMBER } else { color::TEXT_DIM }));
                }
                ui.add_space(16.0);
            });
            // scrollable: the form grows when the Gmail fields are open, and windows can be small
            egui::ScrollArea::vertical().auto_shrink([false, false]).show(ui, |ui| {
                ui.horizontal(|ui| {
                    ui.add_space((ui.available_width() - 640.0).max(0.0) / 2.0);
                    ui.vertical(|ui| {
                        ui.set_width(640.0);
                        self.setup_form(ui);
                        ui.add_space(24.0);
                    });
                });
            });
        });
    }

    fn setup_form(&mut self, ui: &mut Ui) {
        let s = &mut self.setup;
        card(ui, "Simulatore", |ui| {
            egui::ComboBox::from_id_salt("source")
                .width(520.0)
                .selected_text(s.kind.label())
                .show_ui(ui, |ui| {
                    for k in SourceKind::ALL {
                        let label = if k.available_here() { k.label().to_string() } else { format!("{} — solo Windows", k.label()) };
                        ui.add_enabled_ui(k.available_here(), |ui| ui.selectable_value(&mut s.kind, k, label));
                    }
                });
            ui.label(RichText::new(hint(s.kind)).size(12.0).color(color::TEXT_DIM));
            if let Some(def) = s.kind.default_udp_port() {
                ui.horizontal(|ui| {
                    ui.label("Porta UDP (0 = predefinita");
                    ui.label(format!("{def})"));
                    ui.add(egui::DragValue::new(&mut s.udp_port).range(0..=65535));
                });
            }
            if s.kind == SourceKind::Wrc {
                ui.horizontal(|ui| {
                    if ui.button("Prepara EA WRC").clicked() {
                        let port = if s.udp_port == 0 { crate::sources::wrc::DEFAULT_PORT } else { s.udp_port };
                        s.wrc_msg = Some(match crate::sources::wrc::prepare(&crate::sources::wrc::telemetry_dir(), port) {
                            Ok(r) => Ok(format!("Fatto: {} canali (non trovati: {}). Riavvia EA WRC, poi premi Avvia.", r.channels.len(), if r.missing.is_empty() { "nessuno".to_string() } else { r.missing.join(", ") })),
                            Err(e) => Err(e),
                        });
                    }
                    ui.label(RichText::new(crate::sources::wrc::telemetry_dir().display().to_string()).size(11.0).color(color::TEXT_DIM));
                });
                match &s.wrc_msg {
                    Some(Ok(m)) => ui.label(RichText::new(m).color(color::GREEN).size(12.0)),
                    Some(Err(e)) => ui.label(RichText::new(e).color(color::RED).size(12.0)),
                    None => ui.label(""),
                };
            }
            if s.kind == SourceKind::Synthetic {
                ui.checkbox(&mut s.hr_demo, "Battito simulato (per provare il pannello del pilota)");
                ui.horizontal(|ui| {
                    ui.label("Velocità demo");
                    ui.add(egui::Slider::new(&mut s.synthetic_speedup, 1.0..=60.0).suffix("×"));
                });
            }
        });
        ui.add_space(8.0);
        card(ui, "Battito (opzionale)", |ui| {
            ui.add_enabled_ui(cfg!(feature = "ble"), |ui| {
                ui.checkbox(&mut s.hr_ble, "Collega un sensore/orologio Bluetooth LE direttamente al PC");
                ui.horizontal(|ui| {
                    ui.label("Nome dispositivo (parte del nome, vuoto = primo trovato)");
                    ui.text_edit_singleline(&mut s.hr_name);
                });
            });
            if !cfg!(feature = "ble") {
                ui.label(RichText::new("Questa build non include il Bluetooth (feature ble).").color(color::AMBER).size(12.0));
            }
            ui.label(
                RichText::new("L'orologio deve avere attiva sul dispositivo la trasmissione del battito (profilo standard Heart Rate). Sono usati solo battito e intervalli RR.")
                    .size(12.0)
                    .color(color::TEXT_DIM),
            );
            ui.horizontal(|ui| {
                ui.label("Battito a riposo");
                ui.add(egui::DragValue::new(&mut s.resting_hr).range(35.0..=100.0).suffix(" bpm"));
                ui.label("massimo");
                ui.add(egui::DragValue::new(&mut s.max_hr).range(120.0..=230.0).suffix(" bpm"));
            });
        });
        ui.add_space(8.0);
        card(ui, "Voce e soglie", |ui| {
            ui.add_enabled_ui(crate::voice_sinks::CAN_SPEAK, |ui| ui.checkbox(&mut s.voice, "Parla attraverso l'audio di Windows (cuffie predefinite)"));
            if !crate::voice_sinks::CAN_SPEAK {
                ui.label(RichText::new("Questa build non include la sintesi vocale (feature tts): i messaggi restano a schermo.").color(color::AMBER).size(12.0));
            }
            ui.add_enabled_ui(cfg!(feature = "stt"), |ui| {
                ui.checkbox(&mut s.stt, "Comandi vocali (microfono, sperimentale): «silenzio», «solo critici», «completo», «muto», «stato»")
            });
            if !cfg!(feature = "stt") {
                ui.label(RichText::new("Questa build non include i comandi vocali (feature stt).").color(color::AMBER).size(12.0));
            }
            ui.horizontal(|ui| {
                ui.label("Gomme: fredda sotto");
                ui.add(egui::DragValue::new(&mut s.tyre_cold_c).range(20.0..=90.0).suffix(" °C"));
                ui.label("calda sopra");
                ui.add(egui::DragValue::new(&mut s.tyre_hot_c).range(60.0..=160.0).suffix(" °C"));
            });
            ui.horizontal(|ui| {
                ui.label("Anticipo chiamata frenata");
                ui.add(egui::DragValue::new(&mut s.brake_lead_s).range(0.3..=2.5).speed(0.05).suffix(" s"));
            });
            ui.horizontal(|ui| {
                ui.checkbox(&mut s.save_laps, "Salva i giri (CSV) in");
                ui.add_enabled(s.save_laps, egui::TextEdit::singleline(&mut s.lap_dir).desired_width(380.0));
            });
        });
        ui.add_space(8.0);
        card(ui, "Segnalazione errori", |ui| {
            let cfg = crate::report::load_config();
            let show_form = !matches!(cfg, Ok(Some(_))) || s.show_gmail;
            if let Ok(Some(c)) = &cfg {
                let mut yes = crate::report::consent_effective(Some(c));
                if ui.checkbox(&mut yes, format!("Invia automaticamente i codici di errore a {}", c.to)).changed() {
                    crate::report::set_consent(yes);
                }
                ui.label(RichText::new("Contenuto: codice errore, messaggio senza nomi utente o cartelle, versione, sistema, simulatore, un ID casuale dell'installazione e l'ID del codice di accesso. Nessun altro dato.").size(11.0).color(color::TEXT_DIM));
                ui.horizontal(|ui| {
                    if ui.button("Invia messaggio di prova").clicked() && !s.report_busy.swap(true, std::sync::atomic::Ordering::Relaxed) {
                        spawn_report_test(s.report_result.clone(), s.report_busy.clone(), false);
                    }
                    if ui.button(if s.show_gmail { "Chiudi" } else { "Cambia account Gmail…" }).clicked() {
                        s.show_gmail = !s.show_gmail;
                    }
                });
            } else if let Err(e) = &cfg {
                ui.label(RichText::new(e).size(12.0).color(color::AMBER));
            } else {
                ui.label(RichText::new("Non configurata: senza un account gli errori restano solo nel file di log.").size(12.0).color(color::TEXT_DIM));
            }
            if show_form {
                ui.add_space(4.0);
                ui.label(RichText::new("Invio con Gmail").strong());
                ui.horizontal(|ui| {
                    ui.label("Indirizzo Gmail");
                    ui.add(egui::TextEdit::singleline(&mut s.gmail_addr).desired_width(300.0).hint_text("nome@gmail.com"));
                });
                ui.horizontal(|ui| {
                    ui.label("Password per le app");
                    ui.add(egui::TextEdit::singleline(&mut s.gmail_pw).password(true).desired_width(220.0).hint_text("16 lettere"));
                    if ui.small_button("Come si ottiene").clicked() {
                        crate::report::open_url("https://myaccount.google.com/apppasswords");
                    }
                });
                ui.label(RichText::new("Serve la verifica in due passaggi sull'account Google. Non è la password normale: è una password a parte, revocabile in ogni momento, salvata solo su questo PC. L'e-mail arriva allo stesso indirizzo.").size(11.0).color(color::TEXT_DIM));
                ui.horizontal(|ui| {
                    if ui.button("Salva e invia messaggio di prova").clicked() && !s.report_busy.swap(true, std::sync::atomic::Ordering::Relaxed) {
                        match crate::report::save_gmail_config(&s.gmail_addr, &s.gmail_pw) {
                            Ok(()) => spawn_report_test(s.report_result.clone(), s.report_busy.clone(), true),
                            Err(e) => {
                                if let Ok(mut g) = s.report_result.lock() {
                                    *g = Some(Err(e));
                                }
                                s.report_busy.store(false, std::sync::atomic::Ordering::Relaxed);
                            }
                        }
                    }
                });
            }
            if s.report_busy.load(std::sync::atomic::Ordering::Relaxed) {
                ui.label(RichText::new("invio in corso…").size(12.0).color(color::TEXT_DIM));
            }
            if let Some(r) = s.report_result.lock().ok().and_then(|g| g.clone()) {
                match r {
                    Ok(m) => ui.label(RichText::new(m).size(12.0).color(color::GREEN)),
                    Err(e) => ui.label(RichText::new(e).size(12.0).color(color::RED)),
                };
            }
        });
        if let Some(e) = &s.error {
            ui.add_space(6.0);
            ui.label(RichText::new(e).color(color::RED));
        }
        ui.add_space(10.0);
        ui.vertical_centered(|ui| {
            if ui.add_sized([220.0, 40.0], egui::Button::new(RichText::new("Avvia").size(18.0))).clicked() {
                self.start();
            }
        });
    }

    /// "Layout" menu: presets, per-panel placement, sizes. Changes are saved straight away.
    fn layout_menu(&mut self, ui: &mut Ui) {
        let before = self.layout.clone();
        ui.menu_button("Layout", |ui| {
            ui.label(RichText::new("Schemi pronti").size(11.0).color(color::TEXT_DIM));
            ui.horizontal(|ui| {
                for (name, make) in layout::Layout::PRESETS {
                    if ui.button(name).clicked() {
                        self.layout = make();
                    }
                }
            });
            ui.separator();
            ui.label(RichText::new("Posizione dei pannelli").size(11.0).color(color::TEXT_DIM));
            egui::Grid::new("layout_panes").num_columns(2).spacing([12.0, 4.0]).show(ui, |ui| {
                for p in layout::Pane::ALL {
                    ui.label(p.label());
                    ui.horizontal(|ui| {
                        let mut s = self.layout.slot(p);
                        ui.selectable_value(&mut s, layout::Slot::Left, "Sinistra");
                        ui.selectable_value(&mut s, layout::Slot::Right, "Destra");
                        ui.selectable_value(&mut s, layout::Slot::Hidden, "Nascosto");
                        self.layout.set_slot(p, s);
                    });
                    ui.end_row();
                }
            });
            ui.separator();
            ui.checkbox(&mut self.layout.bottom, "Tracce velocità/pedali sotto la mappa");
            ui.checkbox(&mut self.layout.times, "Riga tempi sopra la mappa (giro, delta, curva)");
            ui.checkbox(&mut self.layout.compact_top, "Barra in alto compatta");
            ui.add(egui::Slider::new(&mut self.layout.left_w, layout::LEFT_W).text("larghezza sinistra"));
            ui.add(egui::Slider::new(&mut self.layout.right_w, layout::LEFT_W).text("larghezza destra"));
            ui.add(egui::Slider::new(&mut self.layout.bottom_h, layout::BOTTOM_H).text("altezza tracce"));
            ui.separator();
            ui.label(RichText::new("Tasto F: mappa a tutto schermo / torna ai pannelli. Trascina i bordi dei pannelli per ridimensionarli.").size(11.0).color(color::TEXT_DIM));
        });
        if self.layout != before {
            self.layout_dirty = true;
            self.layout_gen += 1;
        }
    }

    fn dashboard(&mut self, ui: &mut Ui) {
        let (hot, cold) = self.session.as_ref().map_or((110.0, 60.0), |s| (s.tyre_hot_c, s.tyre_cold_c));
        let live = self.last_frames_change.elapsed() < Duration::from_millis(1500);
        let mut stop = false;
        let mut fps = self.fps;
        let hr_requested = self.session.as_ref().is_some_and(|s| s.hr_requested);
        let (mode, muted, speaking) = {
            let c = &self.session.as_ref().unwrap().runtime.controls;
            (c.mode(), c.muted(), c.speaking())
        };
        let (mut new_mode, mut new_muted) = (mode, muted);

        if ui.input(|i| i.key_pressed(egui::Key::F)) {
            self.layout.focus = !self.layout.focus;
        }
        let engineer_hidden = self.layout.focus || self.layout.slot(layout::Pane::Engineer) == layout::Slot::Hidden;
        egui::Panel::top("top").show(ui, |ui| {
            ui.horizontal_wrapped(|ui| {
                ui.label(RichText::new("Race Engineer").strong().size(16.0));
                if let Some((txt, soon)) = self.access.summary() {
                    ui.label(RichText::new(txt).size(11.0).color(if soon { color::AMBER } else { color::TEXT_DIM }));
                }
                ui.separator();
                let (txt, c) = if live { ("telemetria attiva", color::GREEN) } else { ("in attesa del simulatore", color::AMBER) };
                widgets::status(ui, c, txt);
                ui.label(RichText::new(&self.view.source).color(color::TEXT_DIM));
                if let Some(si) = self.view.frame.as_ref().and_then(|f| f.session.as_deref()) {
                    let label = [si.car.as_deref(), si.track.as_deref()].into_iter().flatten().collect::<Vec<_>>().join(" · ");
                    if !label.is_empty() {
                        ui.label(RichText::new(label).strong());
                    }
                }
                ui.separator();
                if !self.layout.compact_top {
                    ui.label(format!("latenza interna {:.2} ms", self.view.pipeline_latency_ms));
                }
                if !self.layout.compact_top || self.view.frames_dropped > 0 {
                    ui.label(RichText::new(format!("frame persi {}", self.view.frames_dropped)).color(if self.view.frames_dropped > 0 { color::AMBER } else { color::TEXT_DIM }));
                }
                ui.separator();
                let (vt, vc) = if muted {
                    ("voce: muta", color::TEXT_DIM)
                } else if speaking {
                    ("voce: sta parlando", color::CYAN)
                } else {
                    ("voce: pronta", color::GREEN)
                };
                widgets::status(ui, vc, vt);
                if engineer_hidden {
                    if let Some(m) = self.view.messages.back() {
                        let c = match m.priority {
                            crate::voice::Priority::Critical => color::RED,
                            crate::voice::Priority::High => color::AMBER,
                            _ => Color32::WHITE,
                        };
                        ui.label(RichText::new(format!("«{}»", m.text)).strong().color(c));
                    }
                }
                ui.separator();
                ui.label("Modalità");
                egui::ComboBox::from_id_salt("mode").selected_text(new_mode.label()).show_ui(ui, |ui| {
                    for m in [EngineerMode::Full, EngineerMode::CriticalOnly, EngineerMode::Silent] {
                        ui.selectable_value(&mut new_mode, m, m.label());
                    }
                });
                ui.checkbox(&mut new_muted, "Muto");
                ui.separator();
                if !self.layout.compact_top {
                    egui::ComboBox::from_id_salt("fps").selected_text(format!("UI {fps} fps")).show_ui(ui, |ui| {
                        for f in [15u32, 30, 60] {
                            ui.selectable_value(&mut fps, f, format!("{f} fps"));
                        }
                    });
                }
                self.layout_menu(ui);
                if ui.button("Ferma").clicked() {
                    stop = true;
                }
            });
        });
        self.fps = fps;
        if let Some(s) = &self.session {
            s.runtime.controls.set_mode(new_mode);
            s.runtime.controls.set_muted(new_muted);
        }
        if stop {
            self.stop();
            return;
        }

        for n in crate::diag::notices() {
            let err = n.severity == crate::diag::Severity::Error;
            egui::Panel::top(if err { "notice_err" } else { "notice_warn" }).show(ui, |ui| {
                ui.horizontal_wrapped(|ui| {
                    ui.label(RichText::new(format!("[{}] {}", n.code, n.message)).color(if err { color::RED } else { color::AMBER }));
                    if err {
                        let st = match &n.report_id {
                            Some(id) => format!("Segnalazione inviata allo sviluppatore (ID {id})"),
                            None => match crate::report::status() {
                                crate::report::Status::Declined => "Segnalazione non inviata (non hai acconsentito)".to_string(),
                                crate::report::Status::NoTransport => "Segnalazione automatica non configurata".to_string(),
                                _ => String::new(),
                            },
                        };
                        if !st.is_empty() {
                            ui.label(RichText::new(st).size(11.0).color(color::TEXT_DIM));
                        }
                        if let Ok(Some(cfg)) = crate::report::load_config() {
                            if ui.small_button("Invia per e-mail").clicked() {
                                let r = crate::report::build_report(n.code, &n.message);
                                crate::report::open_url(&crate::report::mailto_url(&cfg.to, &r));
                            }
                        }
                    }
                    if ui.small_button("Chiudi").clicked() {
                        crate::diag::clear_severity(n.severity);
                    }
                });
            });
        }

let layout = self.layout.clone();
        let ctx = PaneCtx { v: &self.view, hot, cold, hr_requested };
        let v = ctx.v;
        let f = v.frame.as_ref();
        let mut left_w = layout.left_w;
        let mut right_w = layout.right_w;
        let mut bottom_h = layout.bottom_h;
        for (slot, id) in [(layout::Slot::Left, "left"), (layout::Slot::Right, "right")] {
            if !layout.column(slot) {
                continue;
            }
            let w = if slot == layout::Slot::Left { layout.left_w } else { layout.right_w };
            let pid = egui::Id::new((id, self.layout_gen));
            let panel = if slot == layout::Slot::Left { egui::Panel::left(pid) } else { egui::Panel::right(pid) };
            let r = panel
                .resizable(true)
                .default_size(w)
                .size_range(layout::LEFT_W)
                .show(ui, |ui| {
                    let mut first = true;
                    for p in layout::Pane::ALL.into_iter().filter(|p| layout.slot(*p) == slot) {
                        if !first {
                            ui.add_space(6.0);
                        }
                        first = false;
                        pane_ui(ui, p, &ctx);
                    }
                });
            let width = r.response.rect.width();
            if slot == layout::Slot::Left { left_w = width } else { right_w = width }
        }
        if layout.show_bottom() {
            let r = egui::Panel::bottom(egui::Id::new(("bottom", self.layout_gen))).resizable(true).default_size(layout.bottom_h).size_range(layout::BOTTOM_H).show(ui, |ui| {
                widgets::trace_plot(ui, &v.trace);
            });
            bottom_h = r.response.rect.height();
        }

        egui::CentralPanel::default().show(ui, |ui| {
            if layout.times {
                ui.horizontal_wrapped(|ui| {
                    let lap_txt = f.and_then(|f| f.lap).map_or("-".to_string(), |l| l.to_string());
                    stat(ui, "Giro", &lap_txt, Color32::WHITE);
                    stat(ui, "Tempo", &widgets::fmt_lap(f.and_then(|f| f.lap_time_s)), Color32::WHITE);
                    stat(ui, "Ultimo", &widgets::fmt_lap(f.and_then(|f| f.last_lap_s)), Color32::WHITE);
                    stat(ui, "Miglior", &widgets::fmt_lap(f.and_then(|f| f.best_lap_s).or(v.analysis.best_lap_s)), color::GREEN);
                    let (dt, dc) = match v.analysis.delta_s {
                        Some(d) => (format!("{d:+.3}"), if d > 0.0 { color::RED } else { color::GREEN }),
                        None => ("--".into(), color::TEXT_DIM),
                    };
                    stat(ui, "Delta", &dt, dc);
                    let corner = v.analysis.corner.map_or("—".to_string(), |c| format!("Curva {c}"));
                    stat(ui, "Posizione", &corner, color::AMBER);
                });
                ui.add_space(6.0);
            }
            widgets::track_map(ui, v.analysis.track.as_deref(), &self.trail, f, v.analysis.corner);
        });
        // remember dragged sizes (the focus view hides the panels, so it never overwrites them)
        if !layout.focus {
            let l = &mut self.layout;
            for (cur, new) in [(&mut l.left_w, left_w), (&mut l.right_w, right_w), (&mut l.bottom_h, bottom_h)] {
                if (*cur - new).abs() > 0.5 {
                    *cur = new;
                    self.layout_dirty = true;
                }
            }
        }
        if self.layout_dirty && !ui.input(|i| i.pointer.any_down()) {
            self.layout.save();
            self.layout_dirty = false;
        }
        let _ = self.session.as_ref().map(|s| s.started);
    }
}

/// Everything a panel needs to draw itself.
struct PaneCtx<'a> {
    v: &'a Snapshot,
    hot: f32,
    cold: f32,
    hr_requested: bool,
}

fn pane_ui(ui: &mut Ui, pane: layout::Pane, c: &PaneCtx) {
    let (v, hot, cold, hr_requested) = (c.v, c.hot, c.cold, c.hr_requested);
    let f = v.frame.as_ref();
    let session = f.and_then(|f| f.session.as_deref());
    let _ = (hot, cold, hr_requested, session);
    match pane {
        layout::Pane::Car => {
            card(ui, "Vettura", |ui| {
                // narrow column: smaller digits, no "marcia" caption
                let narrow = ui.available_width() < 250.0;
                let big = if narrow { 38.0 } else { 56.0 };
                ui.horizontal(|ui| {
                    ui.label(RichText::new(format!("{:.0}", f.map_or(0.0, |f| f.speed_kmh))).size(big).strong());
                    ui.label(RichText::new("km/h").size(if narrow { 10.0 } else { 14.0 }).color(color::TEXT_DIM));
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        let g = f.map_or("-".to_string(), |f| match f.gear {
                            -1 => "R".into(),
                            0 => "N".into(),
                            g => g.to_string(),
                        });
                        ui.label(RichText::new(g).size(big).strong().color(color::AMBER));
                        if !narrow {
                            ui.label(RichText::new("marcia").color(color::TEXT_DIM));
                        }
                    });
                });
                widgets::rpm_bar(ui, f.map_or(0.0, |f| f.rpm), f.and_then(|f| f.max_rpm).unwrap_or(v.rpm_max_seen));
                ui.add_space(4.0);
                widgets::bar(ui, "Gas", f.map_or(0.0, |f| f.throttle), color::GREEN);
                widgets::bar(ui, "Freno", f.map_or(0.0, |f| f.brake), color::RED);
                widgets::steering(ui, f.and_then(|f| f.steering));
            });
        }
        layout::Pane::Tyres => {
            card(ui, "Gomme", |ui| {
                let (t, p) = (f.and_then(|f| f.tyre_temp_c), f.and_then(|f| f.tyre_pressure_kpa));
                let names = ["Ant. sx", "Ant. dx", "Post. sx", "Post. dx"];
                egui::Grid::new("tyres").num_columns(2).spacing([6.0, 6.0]).min_col_width(((ui.available_width() - 6.0) / 2.0).max(60.0)).show(ui, |ui| {
                    for row in 0..2 {
                        for col in 0..2 {
                            let i = row * 2 + col;
                            ui.vertical(|ui| widgets::tyre(ui, names[i], t.map(|a| a[i]), p.map(|a| a[i]), cold, hot));
                        }
                        ui.end_row();
                    }
                });
                if let Some(fuel) = f.and_then(|f| f.fuel_l) {
                    ui.label(RichText::new(format!("Carburante {fuel:.1} l")).color(color::TEXT_DIM));
                }
            });
        }
        layout::Pane::Heart => {
            card(ui, "Pilota · battito", |ui| match v.bio {
                None => {
                    ui.label(RichText::new(if hr_requested { "Smartwatch non collegato" } else { "Smartwatch non usato" }).color(color::TEXT_DIM));
                    ui.label(
                        RichText::new(if hr_requested {
                            "In ricerca. Il Race Engineer funziona normalmente senza battito: gli avvisi sul battito restano spenti finché l'orologio non si collega."
                        } else {
                            "Opzionale: attivalo dalla schermata iniziale. Senza smartwatch tutto il resto funziona normalmente."
                        })
                        .size(12.0)
                        .color(color::TEXT_DIM),
                    );
                }
                Some(b) => {
                    ui.horizontal(|ui| {
                        let (lv, c) = match b.level {
                            ArousalLevel::Relaxed => ("rilassato", color::BLUE),
                            ArousalLevel::Focused => ("concentrato", color::GREEN),
                            ArousalLevel::Elevated => ("elevato", color::AMBER),
                            ArousalLevel::High => ("alto", color::RED),
                        };
                        ui.label(RichText::new(format!("{}", b.bpm)).size(44.0).strong().color(if b.reliable { c } else { color::TEXT_DIM }));
                        ui.vertical(|ui| {
                            ui.label("bpm");
                            ui.label(RichText::new(lv).color(c));
                        });
                    });
                    let trend = if b.trend_bpm_per_min > 5.0 { "in salita" } else if b.trend_bpm_per_min < -5.0 { "in discesa" } else { "stabile" };
                    ui.label(format!("andamento {trend} ({:+.0} bpm/min)", b.trend_bpm_per_min));
                    ui.label(match b.rmssd_ms {
                        Some(r) => format!("HRV (RMSSD) {r:.0} ms"),
                        None => "HRV: dati RR insufficienti o non trasmessi".into(),
                    });
                    if !b.reliable {
                        ui.label(RichText::new("ATTENZIONE: dato non affidabile (contatto perso, vecchio o anomalo), ignorato dal Race Engineer").color(color::AMBER).size(12.0));
                    }
                }
            });
        }
        layout::Pane::Setup => {
            card(ui, "Setup corrente", |ui| match session {
                Some(info) if !info.setup.is_empty() => {
                    if let Some(n) = &info.setup_note {
                        ui.label(RichText::new(n).size(12.0).color(color::TEXT_DIM));
                    }
                    egui::ScrollArea::vertical().id_salt("setup").max_height(170.0).show(ui, |ui| {
                        egui::Grid::new("setup_grid").num_columns(2).spacing([10.0, 2.0]).show(ui, |ui| {
                            for (k, val) in &info.setup {
                                ui.label(RichText::new(k).size(11.0).color(color::TEXT_DIM));
                                ui.label(RichText::new(val).size(12.0));
                                ui.end_row();
                            }
                        });
                    });
                }
                Some(info) => {
                    ui.label(RichText::new("Non disponibile").color(color::TEXT_DIM));
                    if let Some(n) = &info.setup_note {
                        ui.label(RichText::new(n).size(12.0).color(color::TEXT_DIM));
                    }
                }
                None => {
                    ui.label(RichText::new("Non disponibile").color(color::TEXT_DIM));
                    ui.label(RichText::new("Questo simulatore non pubblica il setup nei dati letti; non viene inventato.").size(12.0).color(color::TEXT_DIM));
                }
            });
        }
        layout::Pane::Hints => {
            card(ui, "Suggerimenti", |ui| {
                if v.suggestions.is_empty() {
                    ui.label(RichText::new(if v.analysis.track.is_some() { "Nessuna perdita rilevante nell'ultimo giro." } else { "Servono due giri validi per confrontare le curve." }).color(color::TEXT_DIM));
                }
                for s in &v.suggestions {
                    ui.label(RichText::new(format!("• {s}")).color(color::AMBER));
                }
            });
        }
        layout::Pane::Engineer => {
            card(ui, "Race Engineer", |ui| {
                egui::ScrollArea::vertical().max_height(ui.available_height().max(120.0)).stick_to_bottom(true).show(ui, |ui| {
                    if v.messages.is_empty() {
                        ui.label(RichText::new("Nessun messaggio ancora.").color(color::TEXT_DIM));
                    }
                    for m in &v.messages {
                        let c = match m.priority {
                            crate::voice::Priority::Critical => color::RED,
                            crate::voice::Priority::High => color::AMBER,
                            _ => Color32::WHITE,
                        };
                        let tag = if m.spoken { "" } else { "  (non pronunciato)" };
                        ui.label(RichText::new(format!("{}{tag}", m.text)).color(if m.spoken { c } else { color::TEXT_DIM }));
                    }
                });
            });
        }
    }
}

fn stat(ui: &mut Ui, label: &str, value: &str, c: Color32) {
    egui::Frame::new().fill(color::CARD).corner_radius(8.0).inner_margin(8.0).show(ui, |ui| {
        ui.vertical(|ui| {
            ui.label(RichText::new(label.to_uppercase()).size(10.0).color(color::TEXT_DIM));
            ui.label(RichText::new(value).size(22.0).monospace().color(c));
        });
    });
}
