//! Headless runner.
//!   re-cli --source synthetic|f1|acc|iracing [--seconds N] [--lap-dir DIR]
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

fn main() {
    let which = arg("--source").unwrap_or_else(|| "synthetic".into());
    let kind = match which.as_str() {
        "synthetic" => SourceKind::Synthetic,
        "f1" => SourceKind::F1,
        "forza" => SourceKind::Forza,
        "acc" => SourceKind::Acc,
        "iracing" => SourceKind::IRacing,
        other => {
            eprintln!("unknown source '{other}' (synthetic|f1|forza|acc|iracing)");
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
