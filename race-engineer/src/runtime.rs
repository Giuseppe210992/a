//! Thread layout. Everything that touches the simulator or the audio path is isolated
//! from the UI: hand-offs are bounded channels that DROP when full instead of blocking,
//! and the UI only ever reads a small shared snapshot (updated at most ~30 times/s).
//!
//!   source thread --frames--> engineer thread --utterances--> voice thread --> audio
//!   BLE thread ----HR------->/        \--snapshot (Mutex, read by UI at its own pace)

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::mpsc::{channel, sync_channel, Receiver, TrySendError};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use crate::biometrics::{BiometricConfig, BiometricEngine, BiometricState, HrMeasurement};
use crate::clock::monotonic_s;
use crate::engineer::{Analysis, Engineer, EngineerConfig};
use crate::sources::TelemetrySource;
use crate::telemetry::TelemetryFrame;
use crate::voice::{run_voice_loop, AudioSink, Priority, VOICE_SPEAKING};

/// How much the engineer talks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EngineerMode {
    /// Never speaks (UI still shows what it would say).
    Silent = 0,
    /// Only critical calls ("Frena!" ...).
    CriticalOnly = 1,
    /// Everything.
    Full = 2,
}

impl EngineerMode {
    pub fn label(self) -> &'static str {
        match self {
            Self::Silent => "Silenzioso",
            Self::CriticalOnly => "Solo critici",
            Self::Full => "Completo",
        }
    }
    fn from_u8(v: u8) -> Self {
        match v {
            0 => Self::Silent,
            1 => Self::CriticalOnly,
            _ => Self::Full,
        }
    }
    fn allows(self, p: Priority) -> bool {
        match self {
            Self::Silent => false,
            Self::CriticalOnly => p == Priority::Critical,
            Self::Full => true,
        }
    }
}

/// Live controls the UI can change while running.
pub struct Controls {
    mode: AtomicU8,
    muted: AtomicBool,
    pub voice_status: AtomicU8,
}

impl Controls {
    fn new() -> Self {
        Self { mode: AtomicU8::new(EngineerMode::Full as u8), muted: AtomicBool::new(false), voice_status: AtomicU8::new(0) }
    }
    pub fn mode(&self) -> EngineerMode {
        EngineerMode::from_u8(self.mode.load(Ordering::Relaxed))
    }
    pub fn set_mode(&self, m: EngineerMode) {
        self.mode.store(m as u8, Ordering::Relaxed)
    }
    pub fn muted(&self) -> bool {
        self.muted.load(Ordering::Relaxed)
    }
    pub fn set_muted(&self, m: bool) {
        self.muted.store(m, Ordering::Relaxed)
    }
    pub fn speaking(&self) -> bool {
        self.voice_status.load(Ordering::Relaxed) == VOICE_SPEAKING
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct TracePoint {
    pub t_s: f32,
    pub speed_kmh: f32,
    pub throttle: f32,
    pub brake: f32,
    pub steering: f32,
}

#[derive(Debug, Clone)]
pub struct Message {
    pub t_s: f64,
    pub priority: Priority,
    pub text: String,
    /// False when the current mode / mute kept it from being spoken.
    pub spoken: bool,
}

#[derive(Debug, Clone, Default)]
pub struct Snapshot {
    pub source: String,
    pub frame: Option<TelemetryFrame>,
    pub bio: Option<BiometricState>,
    /// Newest last; capped.
    pub messages: VecDeque<Message>,
    pub frames_in: u64,
    pub frames_dropped: u64,
    /// Smoothed internal delay between a frame leaving the source thread and the engineer
    /// having processed it. Excludes sim->memory delay and the poll interval.
    pub pipeline_latency_ms: f32,
    pub laps_recorded: usize,
    pub analysis: Analysis,
    pub suggestions: Vec<String>,
    /// Last ~12 s at ~30 Hz.
    pub trace: Vec<TracePoint>,
    /// Highest RPM seen, used to scale the RPM bar when the sim does not give a limit.
    pub rpm_max_seen: f32,
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
    pub controls: Arc<Controls>,
    handles: Vec<JoinHandle<()>>,
}

const UI_PERIOD: Duration = Duration::from_millis(33);
const TRACE_PERIOD_S: f64 = 1.0 / 30.0;
const TRACE_LEN: usize = 360;

impl Runtime {
    pub fn spawn(
        mut source: Box<dyn TelemetrySource>,
        hr_rx: Option<Receiver<(f64, HrMeasurement)>>,
        sink_factory: SinkFactory,
        cfg: RuntimeConfig,
    ) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let controls = Arc::new(Controls::new());
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
            let (stop, snap, dropped, controls) = (stop.clone(), snapshot.clone(), dropped.clone(), controls.clone());
            let lap_dir = cfg.lap_dir.clone();
            handles.push(thread::Builder::new().name("re-engineer".into()).spawn(move || {
                let mut eng = Engineer::new(cfg.engineer);
                let mut bio = BiometricEngine::new(cfg.biometrics);
                let (mut frames_in, mut lat) = (0u64, 0.0f32);
                let mut written = 0usize;
                let mut trace: VecDeque<TracePoint> = VecDeque::with_capacity(TRACE_LEN + 1);
                let mut last_trace_t = f64::MIN;
                let mut pending: Vec<Message> = vec![];
                let mut rpm_max = 0.0f32;
                let mut last_ui = Instant::now() - UI_PERIOD;
                let mut last_frame: Option<TelemetryFrame> = None;
                while !stop.load(Ordering::Relaxed) {
                    if let Some(rx) = &hr_rx {
                        while let Ok((t, m)) = rx.try_recv() {
                            bio.ingest(m, t);
                        }
                    }
                    match frame_rx.recv_timeout(Duration::from_millis(50)) {
                        Ok((captured, f)) => {
                            frames_in += 1;
                            let st = bio.state(monotonic_s());
                            let msgs = eng.on_frame(&f, st);
                            let delay_ms = captured.elapsed().as_secs_f32() * 1000.0;
                            lat = if frames_in == 1 { delay_ms } else { lat * 0.95 + delay_ms * 0.05 };
                            let (mode, muted) = (controls.mode(), controls.muted());
                            for u in msgs {
                                let spoken = !muted && mode.allows(u.priority);
                                pending.push(Message { t_s: f.t_s, priority: u.priority, text: u.text.clone(), spoken });
                                if spoken {
                                    let _ = voice_tx.send(u);
                                }
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
                            rpm_max = rpm_max.max(f.rpm);
                            if f.t_s - last_trace_t >= TRACE_PERIOD_S || f.t_s < last_trace_t {
                                last_trace_t = f.t_s;
                                if trace.len() >= TRACE_LEN {
                                    trace.pop_front();
                                }
                                trace.push_back(TracePoint {
                                    t_s: f.t_s as f32,
                                    speed_kmh: f.speed_kmh,
                                    throttle: f.throttle,
                                    brake: f.brake,
                                    steering: f.steering.unwrap_or(0.0),
                                });
                            }
                            last_frame = Some(f);
                        }
                        Err(_) => {}
                    }
                    // UI snapshot: at most ~30 Hz, so the UI never adds per-frame cost.
                    if last_ui.elapsed() >= UI_PERIOD {
                        last_ui = Instant::now();
                        let st = bio.state(monotonic_s());
                        if let Ok(mut s) = snap.lock() {
                            s.frame = last_frame.clone();
                            s.bio = st;
                            s.frames_in = frames_in;
                            s.frames_dropped = dropped.load(Ordering::Relaxed);
                            s.pipeline_latency_ms = lat;
                            s.laps_recorded = eng.completed_laps.len();
                            s.analysis = eng.analysis().clone();
                            s.suggestions = eng.suggestions();
                            s.trace = trace.iter().copied().collect();
                            s.rpm_max_seen = rpm_max;
                            for m in pending.drain(..) {
                                if s.messages.len() >= 50 {
                                    s.messages.pop_front();
                                }
                                s.messages.push_back(m);
                            }
                        }
                    }
                }
            }).expect("spawn engineer thread"));
        }

        // Voice
        {
            let controls = controls.clone();
            handles.push(thread::Builder::new().name("re-voice".into()).spawn(move || {
                run_voice_loop(voice_rx, sink_factory(), &controls.voice_status)
            }).expect("spawn voice thread"));
        }

        Self { stop, snapshot, controls, handles }
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

    fn spawn_with(spoken: &Arc<Mutex<Vec<String>>>, mode: EngineerMode) -> Runtime {
        let s2 = spoken.clone();
        let rt = Runtime::spawn(
            Box::new(SyntheticSource::new(60.0)),
            None,
            Box::new(move || Box::new(Rec(s2)) as Box<dyn AudioSink>),
            RuntimeConfig::default(),
        );
        rt.controls.set_mode(mode);
        rt
    }

    #[test]
    fn end_to_end_threads_produce_speech_and_snapshot() {
        let spoken = Arc::new(Mutex::new(vec![]));
        let rt = spawn_with(&spoken, EngineerMode::Full);
        thread::sleep(Duration::from_millis(5000));
        let snap = rt.snapshot.lock().unwrap().clone();
        rt.shutdown();
        assert!(snap.frames_in > 100, "frames {}", snap.frames_in);
        assert!(snap.pipeline_latency_ms < 100.0, "latency {}", snap.pipeline_latency_ms);
        assert!(snap.analysis.track.as_ref().is_some_and(|t| t.corners.len() == 4));
        assert!(snap.analysis.delta_s.is_some());
        assert!(!snap.trace.is_empty() && snap.trace.len() <= TRACE_LEN);
        assert!(snap.messages.iter().any(|m| m.text.starts_with("Giro")));
        let spoken = spoken.lock().unwrap();
        assert!(spoken.iter().any(|s| s.starts_with("Giro")), "{spoken:?}");
    }

    #[test]
    fn mode_filters_speech_but_ui_still_sees_messages() {
        let spoken = Arc::new(Mutex::new(vec![]));
        let rt = spawn_with(&spoken, EngineerMode::CriticalOnly);
        thread::sleep(Duration::from_millis(4000));
        let snap = rt.snapshot.lock().unwrap().clone();
        rt.shutdown();
        let spoken = spoken.lock().unwrap();
        assert!(spoken.iter().all(|s| s == "Frena!"), "{spoken:?}");
        assert!(snap.messages.iter().any(|m| m.text.starts_with("Giro") && !m.spoken));
    }
}
