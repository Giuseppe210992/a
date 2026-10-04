//! Thread layout. Everything that touches the simulator or the audio path is isolated
//! from the UI: hand-offs are bounded channels that DROP when full instead of blocking,
//! and the UI only ever reads a small shared snapshot.
//!
//!   source thread --frames--> engineer thread --utterances--> voice thread --> audio
//!   BLE thread ----HR------->/        \--snapshot (Mutex, read by UI at its own pace)

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{channel, sync_channel, Receiver, TrySendError};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use crate::biometrics::{BiometricConfig, BiometricEngine, BiometricState, HrMeasurement};
use crate::clock::monotonic_s;
use crate::engineer::{Engineer, EngineerConfig};
use crate::sources::TelemetrySource;
use crate::telemetry::TelemetryFrame;
use crate::voice::{run_voice_loop, AudioSink};

#[derive(Debug, Clone, Default)]
pub struct Snapshot {
    pub source: String,
    pub frame: Option<TelemetryFrame>,
    pub bio: Option<BiometricState>,
    /// Newest last; capped.
    pub messages: VecDeque<String>,
    pub frames_in: u64,
    pub frames_dropped: u64,
    /// Smoothed internal delay between a frame leaving the source thread and the engineer
    /// having processed it. Excludes sim->memory delay and the poll interval.
    pub pipeline_latency_ms: f32,
    pub laps_recorded: usize,
}

pub struct RuntimeConfig {
    pub poll_interval: Duration,
    pub engineer: EngineerConfig,
    pub biometrics: BiometricConfig,
    /// Where finished laps are written as CSV (written off the hot path).
    pub lap_dir: Option<std::path::PathBuf>,
}

impl Default for RuntimeConfig {
    fn default() -> Self {
        Self {
            poll_interval: Duration::from_millis(4),
            engineer: EngineerConfig::default(),
            biometrics: BiometricConfig::default(),
            lap_dir: None,
        }
    }
}

/// Built on the voice thread itself: OS audio streams are generally not `Send`.
pub type SinkFactory = Box<dyn FnOnce() -> Box<dyn AudioSink> + Send>;

pub struct Runtime {
    stop: Arc<AtomicBool>,
    pub snapshot: Arc<Mutex<Snapshot>>,
    handles: Vec<JoinHandle<()>>,
}

impl Runtime {
    pub fn spawn(
        mut source: Box<dyn TelemetrySource>,
        hr_rx: Option<Receiver<(f64, HrMeasurement)>>,
        sink_factory: SinkFactory,
        cfg: RuntimeConfig,
    ) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let snapshot = Arc::new(Mutex::new(Snapshot { source: source.name().into(), ..Default::default() }));
        let dropped = Arc::new(AtomicU64::new(0));
        let (frame_tx, frame_rx) = sync_channel::<(Instant, TelemetryFrame)>(16);
        let (voice_tx, voice_rx) = channel();
        let mut handles = vec![];

        // Source: poll, never wait for anyone downstream.
        {
            let (stop, dropped, interval) = (stop.clone(), dropped.clone(), cfg.poll_interval);
            handles.push(thread::Builder::new().name("re-source".into()).spawn(move || {
                while !stop.load(Ordering::Relaxed) {
                    if let Some(f) = source.poll() {
                        match frame_tx.try_send((Instant::now(), f)) {
                            Ok(()) => {}
                            Err(TrySendError::Full(_)) => {
                                dropped.fetch_add(1, Ordering::Relaxed);
                            }
                            Err(TrySendError::Disconnected(_)) => break,
                        }
                    }
                    thread::sleep(interval);
                }
            }).expect("spawn source thread"));
        }

        // Engineer: analysis + decisions.
        {
            let (stop, snap, dropped) = (stop.clone(), snapshot.clone(), dropped.clone());
            let lap_dir = cfg.lap_dir.clone();
            handles.push(thread::Builder::new().name("re-engineer".into()).spawn(move || {
                let mut eng = Engineer::new(cfg.engineer);
                let mut bio = BiometricEngine::new(cfg.biometrics);
                let (mut frames_in, mut lat) = (0u64, 0.0f32);
                let mut written = 0usize;
                while !stop.load(Ordering::Relaxed) {
                    if let Some(rx) = &hr_rx {
                        while let Ok((t, m)) = rx.try_recv() {
                            bio.ingest(m, t);
                        }
                    }
                    let Ok((captured, f)) = frame_rx.recv_timeout(Duration::from_millis(50)) else { continue };
                    frames_in += 1;
                    let st = bio.state(monotonic_s());
                    let msgs = eng.on_frame(&f, st);
                    let delay_ms = captured.elapsed().as_secs_f32() * 1000.0;
                    lat = if frames_in == 1 { delay_ms } else { lat * 0.95 + delay_ms * 0.05 };
                    for u in &msgs {
                        let _ = voice_tx.send(u.clone());
                    }
                    if let Some(dir) = &lap_dir {
                        while written < eng.completed_laps.len() {
                            let lap = eng.completed_laps[written].clone();
                            let dir = dir.clone();
                            // CSV on its own short-lived thread: disk I/O must not delay calls.
                            let _ = thread::Builder::new().name("re-lapwriter".into()).spawn(move || {
                                let _ = crate::recorder::write_csv(&lap, &dir);
                            });
                            written += 1;
                        }
                    }
                    if let Ok(mut s) = snap.lock() {
                        s.frame = Some(f);
                        s.bio = st;
                        s.frames_in = frames_in;
                        s.frames_dropped = dropped.load(Ordering::Relaxed);
                        s.pipeline_latency_ms = lat;
                        s.laps_recorded = eng.completed_laps.len();
                        for u in msgs {
                            if s.messages.len() >= 8 {
                                s.messages.pop_front();
                            }
                            s.messages.push_back(u.text);
                        }
                    }
                }
            }).expect("spawn engineer thread"));
        }

        // Voice
        handles.push(thread::Builder::new().name("re-voice".into()).spawn(move || run_voice_loop(voice_rx, sink_factory())).expect("spawn voice thread"));

        Self { stop, snapshot, handles }
    }

    pub fn shutdown(self) {
        self.stop.store(true, Ordering::Relaxed);
        for h in self.handles {
            let _ = h.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sources::sim::SyntheticSource;
    use crate::voice::{AudioSink, Utterance};

    struct Rec(Arc<Mutex<Vec<String>>>);
    impl AudioSink for Rec {
        fn play(&mut self, u: &Utterance) {
            self.0.lock().unwrap().push(u.text.clone());
        }
        fn stop(&mut self) {}
        fn is_busy(&mut self) -> bool {
            false
        }
    }

    #[test]
    fn end_to_end_threads_produce_speech_and_snapshot() {
        let spoken = Arc::new(Mutex::new(vec![]));
        let rt = Runtime::spawn(
            Box::new(SyntheticSource::new(60.0)),
            None,
            { let s2 = spoken.clone(); Box::new(move || Box::new(Rec(s2)) as Box<dyn AudioSink>) },
            RuntimeConfig::default(),
        );
        thread::sleep(Duration::from_millis(5000));
        let snap = rt.snapshot.lock().unwrap().clone();
        rt.shutdown();
        assert!(snap.frames_in > 100, "frames {}", snap.frames_in);
        assert!(snap.pipeline_latency_ms < 100.0, "latency {}", snap.pipeline_latency_ms);
        let spoken = spoken.lock().unwrap();
        assert!(spoken.iter().any(|s| s.starts_with("Giro")), "{spoken:?}");
    }
}
