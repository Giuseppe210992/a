//! Rule-based race engineer. Fully local: needs no network and no language model.
//! (An optional cloud/LLM layer can sit on top later; nothing here depends on it.)
//!
//! Rules are deliberately conservative: a wrong or late call is worse than silence.
//! Thresholds are generic defaults, to be tuned per car/compound/driver.

use std::collections::HashMap;

use crate::biometrics::{ArousalLevel, BiometricState};
use crate::recorder::{Lap, LapRecorder};
use crate::telemetry::TelemetryFrame;
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
}

/// Braking points of a reference lap: brake > 30 % held for at least 0.4 s.
pub fn brake_zones(lap: &Lap) -> Vec<BrakeZone> {
    let mut zones: Vec<BrakeZone> = vec![];
    let mut start: Option<(f32, f32, f32)> = None; // (pct, speed, lap_t)
    for s in &lap.samples {
        match (start, s.brake) {
            (None, b) if b > 0.3 => start = Some((s.pct, s.speed_ms, s.lap_t)),
            (Some((p, v, t0)), b) if b < 0.1 => {
                if s.lap_t - t0 >= 0.4 {
                    // merge with previous zone if practically the same braking area
                    if zones.last().is_none_or(|z| p - z.start_pct > 0.01) {
                        zones.push(BrakeZone { start_pct: p, entry_speed_ms: v });
                    }
                }
                start = None;
            }
            _ => {}
        }
    }
    zones
}

pub struct Engineer {
    cfg: EngineerConfig,
    pub recorder: LapRecorder,
    zones: Vec<BrakeZone>,
    zone_length_m: f32,
    zone_fired: Vec<bool>,
    last_lap: Option<u32>,
    best_seen_s: Option<f32>,
    cooldown: HashMap<&'static str, f64>,
    hr_high_since: Option<f64>,
    pub completed_laps: Vec<Lap>,
}

impl Engineer {
    pub fn new(cfg: EngineerConfig) -> Self {
        Self {
            cfg,
            recorder: LapRecorder::new(),
            zones: vec![],
            zone_length_m: 0.0,
            zone_fired: vec![],
            last_lap: None,
            best_seen_s: None,
            cooldown: HashMap::new(),
            hr_high_since: None,
            completed_laps: vec![],
        }
    }

    pub fn brake_zones(&self) -> &[BrakeZone] {
        &self.zones
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
                if self.recorder.best().is_some_and(|b| b.number == lap.number) {
                    self.zones = brake_zones(&lap);
                    self.zone_length_m = lap.length_m;
                }
                out.push(Utterance::new(Priority::Normal, self.lap_message(&lap), now));
            }
            self.completed_laps.push(lap);
        }

        if f.lap != self.last_lap {
            self.last_lap = f.lap;
            self.zone_fired = vec![false; self.zones.len()];
        }
        if self.zone_fired.len() != self.zones.len() {
            self.zone_fired = vec![false; self.zones.len()];
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
        let (m, s) = ((t / 60.0) as u32, t % 60.0);
        let base = format!("Giro {}: {}:{:06.3}", lap.number, m, s);
        let msg = match self.best_seen_s {
            None => base,
            Some(b) if t < b => format!("{base}, nuovo miglior giro"),
            Some(b) => format!("{base}, più {:.2} dal migliore", t - b),
        };
        self.best_seen_s = Some(self.best_seen_s.map_or(t, |b| b.min(t)));
        msg
    }

    fn brake_calls(&mut self, f: &TelemetryFrame, now: f64, out: &mut Vec<Utterance>) {
        let (Some(pct), true) = (f.lap_dist_pct, self.zone_length_m > 0.0) else {
            return;
        };
        if f.speed_kmh < self.cfg.min_call_speed_kmh || f.brake > 0.1 {
            return;
        }
        let lead_pct = f.speed_kmh / 3.6 * self.cfg.brake_call_lead_s / self.zone_length_m;
        for (i, z) in self.zones.iter().enumerate() {
            if self.zone_fired[i] {
                continue;
            }
            let dist = (z.start_pct - pct).rem_euclid(1.0);
            if dist > 0.0 && dist <= lead_pct {
                self.zone_fired[i] = true;
                out.push(Utterance::critical(Clip::Brake, "Frena!", now));
            }
        }
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
