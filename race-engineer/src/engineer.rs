//! Rule-based race engineer. Fully local: needs no network and no language model.
//! (An optional cloud/LLM layer can sit on top later; nothing here depends on it.)
//!
//! Rules are deliberately conservative: a wrong or late call is worse than silence.
//! Thresholds are generic defaults, to be tuned per car/compound/driver.

use std::collections::HashMap;
use std::sync::Arc;

use crate::biometrics::{ArousalLevel, BiometricState};
use crate::recorder::{Lap, LapRecorder};
use crate::telemetry::TelemetryFrame;
use crate::track::{self, TrackModel};
use crate::voice::{Clip, Priority, Utterance};

#[derive(Debug, Clone)]
pub struct EngineerConfig {
    /// Time between the call and the braking point the driver should hear it
    /// (audio latency + reaction time).
    pub brake_call_lead_s: f32,
    pub tyre_hot_c: f32,
    pub tyre_cold_c: f32,
    pub hr_high_hold_s: f64,
    pub min_call_speed_kmh: f32,
}

impl Default for EngineerConfig {
    fn default() -> Self {
        Self { brake_call_lead_s: 0.9, tyre_hot_c: 110.0, tyre_cold_c: 60.0, hr_high_hold_s: 15.0, min_call_speed_kmh: 80.0 }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BrakeZone {
    pub start_pct: f32,
    pub entry_speed_ms: f32,
    /// Where the reference lap let go of the brake.
    pub release_pct: f32,
    /// Where the reference lap got back on the throttle (> 50 %) after this zone.
    pub throttle_pct: Option<f32>,
}

/// Braking points of a reference lap: brake > 30 % held for at least 0.4 s.
pub fn brake_zones(lap: &Lap) -> Vec<BrakeZone> {
    let s = &lap.samples;
    let mut zones: Vec<BrakeZone> = vec![];
    let mut start: Option<(usize, f32, f32, f32)> = None; // (index, pct, speed, lap_t)
    for (i, x) in s.iter().enumerate() {
        match (start, x.brake) {
            (None, b) if b > 0.3 => start = Some((i, x.pct, x.speed_ms, x.lap_t)),
            (Some((_, p, v, t0)), b) if b < 0.1 => {
                if x.lap_t - t0 >= 0.4 && zones.last().is_none_or(|z| p - z.start_pct > 0.01) {
                    let next_brake = s[i..].iter().position(|y| y.brake > 0.3).map_or(s.len(), |k| i + k);
                    let throttle_pct = s[i..next_brake].iter().find(|y| y.throttle > 0.5).map(|y| y.pct);
                    zones.push(BrakeZone { start_pct: p, entry_speed_ms: v, release_pct: x.pct, throttle_pct });
                }
                start = None;
            }
            _ => {}
        }
    }
    zones
}

/// Per-frame analysis results for the UI (cheap to clone).
#[derive(Debug, Clone, Default)]
pub struct Analysis {
    pub track: Option<Arc<TrackModel>>,
    /// Seconds vs the reference (best valid) lap; positive = slower.
    pub delta_s: Option<f32>,
    /// 1-based number of the corner the car is in, if any.
    pub corner: Option<u32>,
    /// Last completed lap vs the reference lap, per corner (positive = time lost).
    pub corner_deltas: Vec<Option<f32>>,
    /// Time of the reference (best valid) lap, for sims that do not publish a best lap.
    pub best_lap_s: Option<f32>,
}

fn fmt_time(t: f32) -> String {
    format!("{}:{:06.3}", (t / 60.0) as u32, t % 60.0)
}

pub struct Engineer {
    cfg: EngineerConfig,
    pub recorder: LapRecorder,
    reference: Option<Lap>,
    track: Option<Arc<TrackModel>>,
    zones: Vec<BrakeZone>,
    zone_length_m: f32,
    zone_fired: Vec<[bool; 3]>, // [Frena!, Rilascia!, Gas!] already called for this zone this lap
    last_lap: Option<u32>,
    best_seen_s: Option<f32>,
    cooldown: HashMap<&'static str, f64>,
    hr_high_since: Option<f64>,
    analysis: Analysis,
    pub completed_laps: Vec<Lap>,
}

impl Engineer {
    pub fn new(cfg: EngineerConfig) -> Self {
        Self {
            cfg,
            recorder: LapRecorder::new(),
            reference: None,
            track: None,
            zones: vec![],
            zone_length_m: 0.0,
            zone_fired: vec![],
            last_lap: None,
            best_seen_s: None,
            cooldown: HashMap::new(),
            hr_high_since: None,
            analysis: Analysis::default(),
            completed_laps: vec![],
        }
    }

    pub fn brake_zones(&self) -> &[BrakeZone] {
        &self.zones
    }

    pub fn analysis(&self) -> &Analysis {
        &self.analysis
    }

    /// Where the last lap lost the most time against the reference lap.
    pub fn suggestions(&self) -> Vec<String> {
        let mut losses: Vec<(usize, f32)> = self
            .analysis
            .corner_deltas
            .iter()
            .enumerate()
            .filter_map(|(i, d)| d.filter(|&d| d > 0.05).map(|d| (i, d)))
            .collect();
        losses.sort_by(|a, b| b.1.total_cmp(&a.1));
        losses
            .into_iter()
            .take(3)
            .map(|(i, d)| format!("Curva {}: {:+.2} s rispetto al miglior giro", i + 1, d))
            .collect()
    }

    fn adopt_reference(&mut self, lap: &Lap) {
        let corners = track::detect_corners(lap);
        self.zones = brake_zones(lap);
        self.zone_length_m = lap.length_m;
        self.track = Some(Arc::new(TrackModel {
            length_m: lap.length_m,
            path: track::path_of(lap),
            corners,
            brake_zones: self.zones.clone(),
        }));
        self.analysis.track = self.track.clone();
        self.analysis.best_lap_s = Some(lap.time_s);
        self.reference = Some(lap.clone());
    }

    fn ready(&mut self, key: &'static str, now: f64, every_s: f64) -> bool {
        match self.cooldown.get(key) {
            Some(&t) if now - t < every_s => false,
            _ => {
                self.cooldown.insert(key, now);
                true
            }
        }
    }

    /// High driver workload: do not talk about anything non-critical now.
    fn busy(f: &TelemetryFrame) -> bool {
        f.brake > 0.1 || f.steering.is_some_and(|s| s.abs() > 0.3)
    }

    pub fn on_frame(&mut self, f: &TelemetryFrame, bio: Option<BiometricState>) -> Vec<Utterance> {
        let now = f.t_s;
        let mut out = vec![];

        if let Some(lap) = self.recorder.push(f) {
            if lap.valid {
                if let (Some(r), Some(t)) = (&self.reference, &self.track) {
                    self.analysis.corner_deltas = track::corner_deltas(r, &lap, &t.corners);
                }
                out.push(Utterance::new(Priority::Normal, self.lap_message(&lap), now));
                if self.reference.as_ref().is_none_or(|r| lap.time_s < r.time_s) {
                    self.adopt_reference(&lap);
                }
            }
            self.completed_laps.push(lap);
        }

        self.analysis.delta_s = match (&self.reference, f.lap_dist_pct, f.lap_time_s) {
            (Some(r), Some(p), Some(t)) => track::live_delta(r, p, t),
            _ => None,
        };
        self.analysis.corner = match (&self.track, f.lap_dist_pct) {
            (Some(t), Some(p)) => track::corner_at(&t.corners, p).map(|c| c.number),
            _ => None,
        };

        if f.lap != self.last_lap {
            self.last_lap = f.lap;
            self.zone_fired = vec![[false; 3]; self.zones.len()];
        }
        if self.zone_fired.len() != self.zones.len() {
            self.zone_fired = vec![[false; 3]; self.zones.len()];
        }

        self.brake_calls(f, now, &mut out);
        if !Self::busy(f) {
            self.tyre_calls(f, now, &mut out);
            self.biometric_calls(bio, now, &mut out);
        }
        out
    }

    fn lap_message(&mut self, lap: &Lap) -> String {
        let t = lap.time_s;
        let base = format!("Giro {}: {}", lap.number, fmt_time(t));
        let msg = match self.best_seen_s {
            None => base,
            Some(b) if t < b => format!("{base}, nuovo miglior giro"),
            Some(b) => format!("{base}, più {:.2} dal migliore", t - b),
        };
        self.best_seen_s = Some(self.best_seen_s.map_or(t, |b| b.min(t)));
        msg
    }

    /// Reference-lap behaviour over the stretch `[pct - back, pct]`: (max brake, min throttle).
    fn reference_window(&self, pct: f32, back: f32) -> Option<(f32, f32)> {
        let r = self.reference.as_ref()?;
        let lo = pct - back;
        if lo < 0.0 {
            return None;
        }
        let i = r.samples.partition_point(|x| x.pct < lo);
        let j = r.samples.partition_point(|x| x.pct <= pct);
        let w = r.samples.get(i..j).filter(|w| !w.is_empty())?;
        Some((w.iter().map(|x| x.brake).fold(0.0, f32::max), w.iter().map(|x| x.throttle).fold(1.0, f32::min)))
    }

    /// "Frena!" before each reference braking point. Corrections are made only in the stretch just
    /// after the best lap's own release / throttle pick-up points (0.35 s .. ~120 m later): "Rilascia!"
    /// when still braking although the best lap was off the brake for that whole stretch, "Gas!" when
    /// still off the throttle although the best lap was on it (> 50 %). Comparing point by point
    /// keeps identical laps silent, and braking earlier than the best lap is never called wrong.
    fn brake_calls(&mut self, f: &TelemetryFrame, now: f64, out: &mut Vec<Utterance>) {
        let (Some(pct), true) = (f.lap_dist_pct, self.zone_length_m > 0.0) else {
            return;
        };
        let v = f.speed_kmh / 3.6;
        let lead_pct = v * self.cfg.brake_call_lead_s / self.zone_length_m;
        let back = v * 0.35 / self.zone_length_m;
        let window = self.reference_window(pct, back);
        for i in 0..self.zones.len() {
            let z = self.zones[i];
            if !self.zone_fired[i][0] && f.speed_kmh >= self.cfg.min_call_speed_kmh && f.brake <= 0.1 {
                let dist = (z.start_pct - pct).rem_euclid(1.0);
                if dist > 0.0 && dist <= lead_pct {
                    self.zone_fired[i][0] = true;
                    out.push(Utterance::critical(Clip::Brake, "Frena!", now));
                }
            }
            let Some((ref_brake, ref_throttle)) = window else { continue };
            let past = |p: f32| (pct - p).rem_euclid(1.0);
            let in_stretch = |p: f32| past(p) >= back && past(p) <= 0.03;
            let next_brake_close = (z.start_pct - pct).rem_euclid(1.0) < 2.0 * lead_pct;
            if !self.zone_fired[i][1] && in_stretch(z.release_pct) && !next_brake_close && f.brake > 0.3 && ref_brake < 0.1 {
                self.zone_fired[i][1] = true;
                out.push(Utterance::critical(Clip::Lift, "Rilascia!", now));
            }
            if let Some(tp) = z.throttle_pct {
                if !self.zone_fired[i][2] && in_stretch(tp) && f.throttle < 0.2 && f.brake <= 0.1 && f.speed_kmh > 40.0 && ref_throttle > 0.5 {
                    self.zone_fired[i][2] = true;
                    out.push(Utterance::critical(Clip::Throttle, "Gas!", now));
                }
            }
        }
    }

    /// Spoken summary for the "stato" voice command.
    pub fn status_message(&self, f: Option<&TelemetryFrame>, bio: Option<BiometricState>, now: f64) -> Utterance {
        let mut parts: Vec<String> = vec![];
        if let Some(b) = self.analysis.best_lap_s {
            parts.push(format!("miglior giro {}", fmt_time(b)));
        }
        if let Some(d) = self.analysis.delta_s {
            parts.push(format!("delta {:+.2}", d));
        }
        if let Some(t) = f.and_then(|f| f.tyre_temp_c) {
            let hot = t.iter().copied().fold(f32::MIN, f32::max);
            parts.push(format!("gomme fino a {hot:.0} gradi"));
        }
        if let Some(b) = bio.filter(|b| b.reliable) {
            parts.push(format!("battito {}", b.bpm));
        }
        if parts.is_empty() {
            parts.push("ancora nessun dato utile".into());
        }
        Utterance::new(Priority::High, parts.join(", "), now)
    }

    fn tyre_calls(&mut self, f: &TelemetryFrame, now: f64, out: &mut Vec<Utterance>) {
        let Some(temps) = f.tyre_temp_c else { return };
        const NAMES: [&str; 4] = ["anteriore sinistra", "anteriore destra", "posteriore sinistra", "posteriore destra"];
        let (hi_i, hi) = temps.iter().copied().enumerate().fold((0, f32::MIN), |a, (i, t)| if t > a.1 { (i, t) } else { a });
        if hi > self.cfg.tyre_hot_c && self.ready("tyre_hot", now, 90.0) {
            out.push(Utterance::new(Priority::Normal, format!("Gomma {} calda, {:.0} gradi", NAMES[hi_i], hi), now));
        }
        let (lo_i, lo) = temps.iter().copied().enumerate().fold((0, f32::MAX), |a, (i, t)| if t < a.1 { (i, t) } else { a });
        // only meaningful once the car is actually moving at pace
        if lo < self.cfg.tyre_cold_c && f.speed_kmh > 100.0 && self.ready("tyre_cold", now, 120.0) {
            out.push(Utterance::new(Priority::Low, format!("Gomma {} fredda, {:.0} gradi", NAMES[lo_i], lo), now));
        }
    }

    fn biometric_calls(&mut self, bio: Option<BiometricState>, now: f64, out: &mut Vec<Utterance>) {
        let Some(b) = bio.filter(|b| b.reliable) else {
            self.hr_high_since = None; // never act on unreliable data
            return;
        };
        if b.level == ArousalLevel::High {
            let since = *self.hr_high_since.get_or_insert(now);
            if now - since >= self.cfg.hr_high_hold_s && self.ready("hr_high", now, 180.0) {
                out.push(Utterance::new(Priority::Low, "Battito alto: respira e rilassa le mani", now));
            }
        } else {
            self.hr_high_since = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::biometrics::BiometricState;
    use crate::sources::sim::SyntheticCar;

    fn run(laps_secs: usize, eng: &mut Engineer) -> Vec<(f64, f32, Utterance)> {
        let mut car = SyntheticCar::default();
        let mut all = vec![];
        for _ in 0..laps_secs * 100 {
            let f = car.step(0.01);
            for u in eng.on_frame(&f, None) {
                all.push((f.t_s, f.lap_dist_pct.unwrap(), u));
            }
        }
        all
    }

    #[test]
    fn announces_laps_and_calls_brake_before_every_known_zone() {
        let mut e = Engineer::new(EngineerConfig::default());
        let msgs = run(400, &mut e);
        assert!(msgs.iter().any(|(_, _, u)| u.text.starts_with("Giro 0")));
        assert_eq!(e.brake_zones().len(), 4, "4 corners -> 4 brake zones: {:?}", e.brake_zones());
        let calls: Vec<_> = msgs.iter().filter(|(_, _, u)| u.clip == Some(Clip::Brake)).collect();
        assert!(calls.len() >= 4 * 3, "several laps of 4 calls each, got {}", calls.len());
        // every call happens shortly before a recorded brake point
        for (_, pct, _) in &calls {
            let d = e.brake_zones().iter().map(|z| (z.start_pct - pct).rem_euclid(1.0)).fold(f32::MAX, f32::min);
            assert!(d > 0.0 && d < 0.04, "call at pct {pct} is {d} before a zone");
        }
    }

    #[test]
    fn identical_laps_never_trigger_corrections_but_sloppy_driving_does() {
        let mut e = Engineer::new(EngineerConfig::default());
        let msgs = run(400, &mut e);
        assert!(
            msgs.iter().all(|(_, _, u)| u.clip != Some(Clip::Lift) && u.clip != Some(Clip::Throttle)),
            "no Gas!/Rilascia! when the lap repeats the best lap"
        );
        let z = e.brake_zones()[0];
        assert!(z.release_pct > z.start_pct && z.throttle_pct.is_some_and(|t| t >= z.release_pct), "{z:?}");
        let v = 50.0f32;
        let back = v * 0.35 / 4000.0;
        let mk = |pct: f32, brake: f32, throttle: f32, lap: u32, t: f64| TelemetryFrame {
            t_s: t,
            speed_kmh: v * 3.6,
            brake,
            throttle,
            lap: Some(lap),
            lap_dist_pct: Some(pct),
            ..Default::default()
        };
        // still braking just after the point where the best lap let go of the brake
        let late_brake = e.on_frame(&mk(z.release_pct + back + 0.003, 0.8, 0.0, 500, 9000.0), None);
        assert!(late_brake.iter().any(|u| u.clip == Some(Clip::Lift)), "{late_brake:?}");
        // still off the throttle just after the best lap's pick-up point
        let tp = z.throttle_pct.unwrap();
        let late_gas = e.on_frame(&mk(tp + back + 0.003, 0.0, 0.0, 500, 9001.0), None);
        assert!(late_gas.iter().any(|u| u.clip == Some(Clip::Throttle)), "{late_gas:?}");
        // each call once per zone per lap
        let again = e.on_frame(&mk(tp + back + 0.004, 0.0, 0.0, 500, 9001.1), None);
        assert!(again.iter().all(|u| u.clip != Some(Clip::Throttle)));
        // braking early for the next corner is not "Rilascia!"
        let early = e.on_frame(&mk(e.brake_zones()[1].start_pct - 0.01, 0.8, 0.0, 501, 9002.0), None);
        assert!(early.iter().all(|u| u.clip != Some(Clip::Lift)), "{early:?}");
    }

    #[test]
    fn status_message_summarises_available_data() {
        let mut e = Engineer::new(EngineerConfig::default());
        assert!(e.status_message(None, None, 0.0).text.contains("nessun dato"));
        let _ = run(200, &mut e);
        let m = e.status_message(None, None, 1.0);
        assert!(m.text.starts_with("miglior giro 1:1"), "{}", m.text);
    }

    #[test]
    fn no_brake_call_while_already_braking() {
        let mut e = Engineer::new(EngineerConfig::default());
        let _ = run(200, &mut e);
        let z = e.brake_zones()[0];
        let f = TelemetryFrame {
            t_s: 1000.0,
            speed_kmh: 250.0,
            brake: 0.8,
            lap: Some(99),
            lap_dist_pct: Some(z.start_pct - 0.005),
            ..Default::default()
        };
        assert!(e.on_frame(&f, None).iter().all(|u| u.clip.is_none()));
    }

    #[test]
    fn tyre_warning_respects_workload_gate_and_cooldown() {
        let mut e = Engineer::new(EngineerConfig::default());
        let mut f = TelemetryFrame {
            t_s: 0.0,
            speed_kmh: 200.0,
            tyre_temp_c: Some([112.0, 100.0, 100.0, 100.0]),
            ..Default::default()
        };
        f.brake = 0.5;
        assert!(e.on_frame(&f, None).is_empty(), "driver busy: stay quiet");
        f.brake = 0.0;
        f.t_s = 1.0;
        let m = e.on_frame(&f, None);
        assert_eq!(m.len(), 1);
        assert!(m[0].text.contains("anteriore sinistra"));
        f.t_s = 2.0;
        assert!(e.on_frame(&f, None).is_empty(), "cooldown");
        f.t_s = 100.0;
        assert_eq!(e.on_frame(&f, None).len(), 1);
    }

    #[test]
    fn heart_rate_message_only_for_sustained_reliable_high() {
        let mut e = Engineer::new(EngineerConfig::default());
        let high = |reliable| {
            Some(BiometricState { bpm: 175, trend_bpm_per_min: 0.0, rmssd_ms: None, level: ArousalLevel::High, reliable })
        };
        let mut f = TelemetryFrame { speed_kmh: 150.0, ..Default::default() };
        let mut said = 0;
        for i in 0..40 {
            f.t_s = i as f64;
            said += e.on_frame(&f, high(false)).len();
        }
        assert_eq!(said, 0, "unreliable data must never trigger advice");
        for i in 40..80 {
            f.t_s = i as f64;
            said += e.on_frame(&f, high(true)).len();
        }
        assert_eq!(said, 1);
    }
}
