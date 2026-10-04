//! Headless runner.
//!   re-cli --prepare-wrc [--port N]     (EA WRC: writes the telemetry structure + config entry)
//!   re-cli --source synthetic|f1|forza|wrc|lmu|acevo|acc|iracing [--seconds N] [--lap-dir DIR]
//!          [--hr-ble [NAME]]   (feature `ble`: direct BLE heart-rate sensor/watch)
//!          [--voice]           (features `tts`/`audio`: speak through Windows instead of printing)
use race_engineer::runtime::{Runtime, RuntimeConfig};
use race_engineer::sources::{self, SourceKind};
use std::time::Duration;

fn arg(name: &str) -> Option<String> {
    let a: Vec<String> = std::env::args().collect();
    a.iter().position(|x| x == name).and_then(|i| a.get(i + 1).cloned())
}

fn flag(name: &str) -> bool {
    std::env::args().any(|x| x == name)
}

fn which_label() -> String {
    arg("--source").unwrap_or_else(|| "synthetic".into())
}

fn main() {
    race_engineer::diag::init("re-cli.log");
    race_engineer::report::start();
    if flag("--raise-test-error") {
        // debugging aid: raises a coded error and gives the background sender time to deliver it
        race_engineer::diag::error("RE-TEST-01", "errore di prova generato con --raise-test-error");
        std::thread::sleep(Duration::from_secs(arg("--wait").and_then(|s| s.parse().ok()).unwrap_or(6)));
        return;
    }
    if flag("--test-report") {
        match race_engineer::report::send_test() {
            Ok(m) => println!("{m}"),
            Err(e) => {
                eprintln!("{e}");
                std::process::exit(2);
            }
        }
        return;
    }
    // --check-code CODE: prints what a code is (signature, label, expiry) without needing access
    if let Some(code) = arg("--check-code") {
        use race_engineer::license::*;
        let Some(key) = verifying_key(PUBLIC_KEY_HEX) else {
            println!("controllo accessi non attivo in questa build");
            return;
        };
        match parse_and_verify(&code, &key) {
            Ok(l) => {
                let exp = l.expires_at.map_or("mai".to_string(), fmt_date);
                let state = match check(&code, now_s(), 0, &key) {
                    Ok(_) => "VALIDO".to_string(),
                    Err(e) => format!("NON VALIDO ({})", e.code()),
                };
                println!("{state} · id {} · etichetta '{}' · scade: {exp}", l.id, l.label);
            }
            Err(e) => {
                println!("NON VALIDO ({}): {}", e.code(), e.message());
                std::process::exit(1);
            }
        }
        return;
    }
    // access gate for the command-line runner too: --code CODE, RE_ACCESS_CODE, or the code saved by the GUI
    if race_engineer::license::enforced() {
        use race_engineer::license::*;
        let code = arg("--code").or_else(|| std::env::var("RE_ACCESS_CODE").ok()).or_else(load_saved_code);
        match code.as_deref().map(validate) {
            Some(Ok(l)) => {
                race_engineer::report::set_context(&which_label(), &l.id);
                if arg("--code").is_some() {
                    save_code(&arg("--code").unwrap());
                }
                if let Some(e) = l.expires_at {
                    eprintln!("accesso valido fino al {}", fmt_date(e));
                }
            }
            Some(Err(e)) => {
                eprintln!("{} ({})", e.message(), e.code());
                std::process::exit(3);
            }
            None => {
                eprintln!("serve un codice di accesso: --code CODICE (oppure variabile RE_ACCESS_CODE)");
                std::process::exit(3);
            }
        }
    }
    if flag("--prepare-wrc") {
        let port = arg("--port").and_then(|p| p.parse().ok()).unwrap_or(race_engineer::sources::wrc::DEFAULT_PORT);
        match race_engineer::sources::wrc::prepare(&race_engineer::sources::wrc::telemetry_dir(), port) {
            Ok(r) => println!("EA WRC pronto: {} canali (mancanti: {:?}), porta {}. Riavvia il gioco.", r.channels.len(), r.missing, r.port),
            Err(e) => {
                eprintln!("{e}");
                std::process::exit(2);
            }
        }
        return;
    }
    let which = arg("--source").unwrap_or_else(|| "synthetic".into());
    let kind = match which.as_str() {
        "synthetic" => SourceKind::Synthetic,
        "f1" => SourceKind::F1,
        "forza" => SourceKind::Forza,
        "lmu" => SourceKind::Lmu,
        "acevo" => SourceKind::AcEvo,
        "wrc" => SourceKind::Wrc,
        "acc" => SourceKind::Acc,
        "iracing" => SourceKind::IRacing,
        other => {
            eprintln!("unknown source '{other}' (synthetic|f1|forza|wrc|lmu|acevo|acc|iracing)");
            std::process::exit(2);
        }
    };
    let speedup = arg("--speedup").and_then(|s| s.parse().ok()).unwrap_or(10.0);
    let source = sources::open(kind, speedup, arg("--port").and_then(|p| p.parse().ok())).unwrap_or_else(|e| {
        eprintln!("{e}");
        std::process::exit(2);
    });

    let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    #[allow(unused_mut)]
    let mut hr_rx = None;
    #[cfg(feature = "ble")]
    let ble_handle = if flag("--hr-ble") {
        let (tx, rx) = std::sync::mpsc::channel();
        hr_rx = Some(rx);
        let name = arg("--hr-ble").filter(|n| !n.starts_with("--"));
        Some(race_engineer::ble::spawn_hr_listener(
            race_engineer::ble::BleConfig { name_filter: name, ..Default::default() },
            tx,
            stop.clone(),
        ))
    } else {
        None
    };
    #[cfg(not(feature = "ble"))]
    if flag("--hr-ble") {
        eprintln!("built without the `ble` feature: rebuild with --features ble");
    }

    let lap_dir = arg("--lap-dir").map(std::path::PathBuf::from);
    let rt = Runtime::spawn(source, hr_rx, race_engineer::voice_sinks::default_factory(flag("--voice")), RuntimeConfig { lap_dir, ..Default::default() });
    let secs: u64 = arg("--seconds").and_then(|s| s.parse().ok()).unwrap_or(30);
    for _ in 0..secs {
        std::thread::sleep(Duration::from_secs(1));
        let s = rt.snapshot.lock().unwrap().clone();
        if let Some(f) = &s.frame {
            let hr = s.bio.map_or("--".to_string(), |b| format!("{} bpm{}", b.bpm, if b.reliable { "" } else { "?" }));
            println!(
                "{:>5.0} km/h  gear {:>2}  thr {:>3.0}%  brk {:>3.0}%  lap {:?}  HR {}  latency {:.2} ms  dropped {}",
                f.speed_kmh, f.gear, f.throttle * 100.0, f.brake * 100.0, f.lap, hr, s.pipeline_latency_ms, s.frames_dropped
            );
        }
    }
    stop.store(true, std::sync::atomic::Ordering::Relaxed);
    rt.shutdown();
    #[cfg(feature = "ble")]
    if let Some(h) = ble_handle {
        let _ = h.join();
    }
}
