//! Native Windows dashboard (egui/eframe, OpenGL).
//!
//! The UI never touches the simulator, BLE or audio paths: it reads a snapshot that the
//! engineer thread refreshes at ~30 Hz and repaints at a capped rate (15/30/60 fps).

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

struct SetupState {
    kind: SourceKind,
    synthetic_speedup: f64,
    hr_ble: bool,
    hr_demo: bool,
    hr_name: String,
    voice: bool,
    resting_hr: f32,
    max_hr: f32,
    tyre_hot_c: f32,
    tyre_cold_c: f32,
    brake_lead_s: f32,
    save_laps: bool,
    lap_dir: String,
    error: Option<String>,
}

impl Default for SetupState {
    fn default() -> Self {
        let def = EngineerConfig::default();
        let bio = BiometricConfig::default();
        Self {
            kind: if cfg!(windows) { SourceKind::IRacing } else { SourceKind::Synthetic },
            synthetic_speedup: 10.0,
            hr_ble: false,
            hr_demo: true,
            hr_name: String::new(),
            voice: crate::voice_sinks::CAN_SPEAK,
            resting_hr: bio.resting_hr,
            max_hr: bio.max_hr,
            tyre_hot_c: def.tyre_hot_c,
            tyre_cold_c: def.tyre_cold_c,
            brake_lead_s: def.brake_call_lead_s,
            save_laps: true,
            lap_dir: "laps".into(),
            error: None,
        }
    }
}

struct Session {
    runtime: Runtime,
    /// Helper threads (BLE client, demo heart rate) and the flag that stops them.
    aux: Vec<std::thread::JoinHandle<()>>,
    aux_stop: Arc<AtomicBool>,
    tyre_hot_c: f32,
    tyre_cold_c: f32,
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

pub struct ReApp {
    setup: SetupState,
    session: Option<Session>,
    view: Snapshot,
    fps: u32,
    /// Live path while the first lap has not produced a reference map yet.
    trail: Vec<[f32; 2]>,
    last_frames_in: u64,
    last_frames_change: Instant,
}

impl Default for ReApp {
    fn default() -> Self {
        Self {
            setup: SetupState::default(),
            session: None,
            view: Snapshot::default(),
            fps: 30,
            trail: vec![],
            last_frames_in: 0,
            last_frames_change: Instant::now(),
        }
    }
}

pub fn run() -> eframe::Result {
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default().with_inner_size([1360.0, 820.0]).with_min_inner_size([1000.0, 640.0]).with_title("Race Engineer"),
        renderer: eframe::Renderer::Glow,
        ..Default::default()
    };
    eframe::run_native(
        "Race Engineer",
        options,
        Box::new(|cc| {
            cc.egui_ctx.set_visuals(egui::Visuals::dark());
            let mut app = ReApp::default();
            // `--autostart synthetic|f1|iracing|acc` skips the setup screen (kiosk / testing).
            let args: Vec<String> = std::env::args().collect();
            if let Some(i) = args.iter().position(|a| a == "--autostart") {
                app.setup.kind = match args.get(i + 1).map(String::as_str) {
                    Some("f1") => SourceKind::F1,
                    Some("iracing") => SourceKind::IRacing,
                    Some("acc") => SourceKind::Acc,
                    _ => SourceKind::Synthetic,
                };
                app.start();
            }
            Ok(Box::new(app))
        }),
    )
}

impl ReApp {
    fn start(&mut self) {
        let s = &self.setup;
        let source = match sources::open(s.kind, s.synthetic_speedup) {
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
        let runtime = Runtime::spawn(source, hr_rx, crate::voice_sinks::default_factory(s.voice), cfg);
        self.trail.clear();
        self.view = Snapshot::default();
        self.session = Some(Session {
            runtime,
            aux,
            aux_stop,
            tyre_hot_c: s.tyre_hot_c,
            tyre_cold_c: s.tyre_cold_c,
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
        if self.session.is_some() {
            self.pull_snapshot();
            self.dashboard(ui);
        } else {
            self.setup_screen(ui);
        }
    }

    fn on_exit(&mut self, _gl: Option<&eframe::glow::Context>) {
        self.stop();
    }
}

fn hint(kind: SourceKind) -> &'static str {
    match kind {
        SourceKind::Synthetic => "Genera una vettura e una pista simulate: serve a provare dashboard, voce e analisi senza simulatore.",
        SourceKind::IRacing => "Nessuna impostazione necessaria: avvia iRacing e vai in pista. (Opzionale: 360 Hz con irsdkEnableMem=1 e irsdkLog360Hz=1 in app.ini.)",
        SourceKind::Acc => "Nessuna impostazione necessaria: avvia ACC e vai in pista. Gli offset della memoria condivisa vanno validati (docs/VALIDATION.md).",
        SourceKind::F1 => "In gioco: Impostazioni > Telemetria > UDP attivo, IP 127.0.0.1, porta 20777, formato 2025, frequenza 60 Hz. Sono letti solo i dati vettura (niente curve/delta senza il pacchetto Lap Data).",
    }
}

impl ReApp {
    fn setup_screen(&mut self, ui: &mut Ui) {
        egui::CentralPanel::default().show(ui, |ui| {
            ui.vertical_centered(|ui| {
                ui.add_space(24.0);
                ui.label(RichText::new("Race Engineer").size(30.0).strong());
                ui.label(RichText::new("AI Race Engineer + Co-Driver · tutto in locale sul PC").color(color::TEXT_DIM));
                ui.add_space(16.0);
            });
            ui.horizontal(|ui| {
                ui.add_space((ui.available_width() - 640.0).max(0.0) / 2.0);
                ui.vertical(|ui| {
                    ui.set_width(640.0);
                    self.setup_form(ui);
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
                ui.add_enabled(s.save_laps, egui::TextEdit::singleline(&mut s.lap_dir).desired_width(200.0));
            });
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

    fn dashboard(&mut self, ui: &mut Ui) {
        let (hot, cold) = self.session.as_ref().map_or((110.0, 60.0), |s| (s.tyre_hot_c, s.tyre_cold_c));
        let live = self.last_frames_change.elapsed() < Duration::from_millis(1500);
        let mut stop = false;
        let mut fps = self.fps;
        let (mode, muted, speaking) = {
            let c = &self.session.as_ref().unwrap().runtime.controls;
            (c.mode(), c.muted(), c.speaking())
        };
        let (mut new_mode, mut new_muted) = (mode, muted);

        egui::Panel::top("top").show(ui, |ui| {
            ui.horizontal_wrapped(|ui| {
                ui.label(RichText::new("Race Engineer").strong().size(16.0));
                ui.separator();
                let (txt, c) = if live { ("telemetria attiva", color::GREEN) } else { ("in attesa del simulatore", color::AMBER) };
                widgets::status(ui, c, txt);
                ui.label(RichText::new(&self.view.source).color(color::TEXT_DIM));
                ui.separator();
                ui.label(format!("latenza interna {:.2} ms", self.view.pipeline_latency_ms));
                ui.label(RichText::new(format!("frame persi {}", self.view.frames_dropped)).color(if self.view.frames_dropped > 0 { color::AMBER } else { color::TEXT_DIM }));
                ui.separator();
                let (vt, vc) = if muted {
                    ("voce: muta", color::TEXT_DIM)
                } else if speaking {
                    ("voce: sta parlando", color::CYAN)
                } else {
                    ("voce: pronta", color::GREEN)
                };
                widgets::status(ui, vc, vt);
                ui.separator();
                ui.label("Modalità");
                egui::ComboBox::from_id_salt("mode").selected_text(new_mode.label()).show_ui(ui, |ui| {
                    for m in [EngineerMode::Full, EngineerMode::CriticalOnly, EngineerMode::Silent] {
                        ui.selectable_value(&mut new_mode, m, m.label());
                    }
                });
                ui.checkbox(&mut new_muted, "Muto");
                ui.separator();
                egui::ComboBox::from_id_salt("fps").selected_text(format!("UI {fps} fps")).show_ui(ui, |ui| {
                    for f in [15u32, 30, 60] {
                        ui.selectable_value(&mut fps, f, format!("{f} fps"));
                    }
                });
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

        let v = &self.view;
        let f = v.frame.as_ref();

        egui::Panel::left("left").exact_size(300.0).show(ui, |ui| {
            card(ui, "Vettura", |ui| {
                ui.horizontal(|ui| {
                    ui.label(RichText::new(format!("{:.0}", f.map_or(0.0, |f| f.speed_kmh))).size(56.0).strong());
                    ui.label(RichText::new("km/h").color(color::TEXT_DIM));
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        let g = f.map_or("-".to_string(), |f| match f.gear {
                            -1 => "R".into(),
                            0 => "N".into(),
                            g => g.to_string(),
                        });
                        ui.label(RichText::new(g).size(56.0).strong().color(color::AMBER));
                        ui.label(RichText::new("marcia").color(color::TEXT_DIM));
                    });
                });
                widgets::rpm_bar(ui, f.map_or(0.0, |f| f.rpm), v.rpm_max_seen);
                ui.add_space(4.0);
                widgets::bar(ui, "Gas", f.map_or(0.0, |f| f.throttle), color::GREEN);
                widgets::bar(ui, "Freno", f.map_or(0.0, |f| f.brake), color::RED);
                widgets::steering(ui, f.and_then(|f| f.steering));
            });
            ui.add_space(6.0);
            card(ui, "Gomme", |ui| {
                let (t, p) = (f.and_then(|f| f.tyre_temp_c), f.and_then(|f| f.tyre_pressure_kpa));
                let names = ["Ant. sx", "Ant. dx", "Post. sx", "Post. dx"];
                egui::Grid::new("tyres").num_columns(2).spacing([6.0, 6.0]).min_col_width(130.0).show(ui, |ui| {
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
        });

        egui::Panel::right("right").exact_size(330.0).show(ui, |ui| {
            card(ui, "Pilota · battito", |ui| match v.bio {
                None => {
                    ui.label(RichText::new("Nessun dispositivo collegato").color(color::TEXT_DIM));
                    ui.label(RichText::new("Attiva il Bluetooth LE e la trasmissione del battito sull'orologio.").size(12.0).color(color::TEXT_DIM));
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
            ui.add_space(6.0);
            card(ui, "Setup corrente", |ui| {
                ui.label(RichText::new("Non disponibile").color(color::TEXT_DIM));
                ui.label(
                    RichText::new("I simulatori supportati non espongono il setup nei dati letti da questa versione; non viene inventato.")
                        .size(12.0)
                        .color(color::TEXT_DIM),
                );
            });
            ui.add_space(6.0);
            card(ui, "Suggerimenti", |ui| {
                if v.suggestions.is_empty() {
                    ui.label(RichText::new(if v.analysis.track.is_some() { "Nessuna perdita rilevante nell'ultimo giro." } else { "Servono due giri validi per confrontare le curve." }).color(color::TEXT_DIM));
                }
                for s in &v.suggestions {
                    ui.label(RichText::new(format!("• {s}")).color(color::AMBER));
                }
            });
            ui.add_space(6.0);
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
        });

        egui::Panel::bottom("bottom").exact_size(170.0).show(ui, |ui| {
            widgets::trace_plot(ui, &v.trace);
        });

        egui::CentralPanel::default().show(ui, |ui| {
            ui.horizontal(|ui| {
                let lap_txt = f.and_then(|f| f.lap).map_or("-".to_string(), |l| l.to_string());
                stat(ui, "Giro", &lap_txt, Color32::WHITE);
                stat(ui, "Tempo", &widgets::fmt_lap(f.and_then(|f| f.lap_time_s)), Color32::WHITE);
                stat(ui, "Ultimo", &widgets::fmt_lap(f.and_then(|f| f.last_lap_s)), Color32::WHITE);
                stat(ui, "Miglior", &widgets::fmt_lap(f.and_then(|f| f.best_lap_s)), color::GREEN);
                let (dt, dc) = match v.analysis.delta_s {
                    Some(d) => (format!("{d:+.3}"), if d > 0.0 { color::RED } else { color::GREEN }),
                    None => ("--".into(), color::TEXT_DIM),
                };
                stat(ui, "Delta", &dt, dc);
                let corner = v.analysis.corner.map_or("—".to_string(), |c| format!("Curva {c}"));
                stat(ui, "Posizione", &corner, color::AMBER);
            });
            ui.add_space(6.0);
            widgets::track_map(ui, v.analysis.track.as_deref(), &self.trail, f, v.analysis.corner);
        });
        let _ = self.session.as_ref().map(|s| s.started);
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
