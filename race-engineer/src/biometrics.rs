//! Biometrics from any device that exposes the standard Bluetooth SIG Heart Rate
//! Profile (service 0x180D, characteristic Heart Rate Measurement 0x2A37).
//!
//! The engine is deliberately device-agnostic: chest straps, optical armbands and
//! watches that broadcast heart rate over BLE all look the same. Anything beyond HR and
//! RR intervals (stress score, sleep, SpO2) is vendor-specific and out of scope.
//!
//! Heart Rate Measurement format (Bluetooth SIG GATT spec):
//! flags u8: bit0 = HR value is u16 (else u8); bits1-2 = sensor contact
//! (2 = supported/not detected, 3 = supported/detected, 0/1 = not supported);
//! bit3 = energy expended u16 present; bit4 = RR-interval u16 values present (1/1024 s).

use std::collections::VecDeque;

pub const HR_SERVICE_UUID: u128 = 0x0000_180D_0000_1000_8000_0080_5F9B_34FB;
pub const HR_MEASUREMENT_UUID: u128 = 0x0000_2A37_0000_1000_8000_0080_5F9B_34FB;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Contact {
    Unsupported,
    NotDetected,
    Detected,
}

#[derive(Debug, Clone, PartialEq)]
pub struct HrMeasurement {
    pub bpm: u16,
    pub contact: Contact,
    pub rr_ms: Vec<f32>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum HrParseError {
    Truncated,
}

pub fn parse_hr_measurement(data: &[u8]) -> Result<HrMeasurement, HrParseError> {
    let flags = *data.first().ok_or(HrParseError::Truncated)?;
    let mut i = 1usize;
    let bpm = if flags & 0x01 != 0 {
        let v = u16::from_le_bytes(data.get(i..i + 2).ok_or(HrParseError::Truncated)?.try_into().unwrap());
        i += 2;
        v
    } else {
        let v = *data.get(i).ok_or(HrParseError::Truncated)? as u16;
        i += 1;
        v
    };
    let contact = match (flags >> 1) & 0b11 {
        2 => Contact::NotDetected,
        3 => Contact::Detected,
        _ => Contact::Unsupported,
    };
    if flags & 0x08 != 0 {
        i += 2; // energy expended, unused
    }
    let mut rr_ms = Vec::new();
    if flags & 0x10 != 0 {
        while let Some(b) = data.get(i..i + 2) {
            let raw = u16::from_le_bytes([b[0], b[1]]);
            rr_ms.push(raw as f32 * 1000.0 / 1024.0);
            i += 2;
        }
    }
    Ok(HrMeasurement { bpm, contact, rr_ms })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArousalLevel {
    Relaxed,
    Focused,
    Elevated,
    High,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BiometricState {
    pub bpm: u16,
    /// Beats per minute gained per minute over the last ~30 s (positive = rising).
    pub trend_bpm_per_min: f32,
    pub rmssd_ms: Option<f32>,
    pub level: ArousalLevel,
    /// False when contact is lost, data is stale or the value is physiologically implausible.
    /// The engineer must not act on unreliable data.
    pub reliable: bool,
}

#[derive(Debug, Clone, Copy)]
pub struct BiometricConfig {
    /// Defaults are generic placeholders: set them per driver for meaningful levels.
    pub resting_hr: f32,
    pub max_hr: f32,
    pub stale_after_s: f64,
    pub rmssd_window_s: f64,
}

impl Default for BiometricConfig {
    fn default() -> Self {
        Self { resting_hr: 60.0, max_hr: 190.0, stale_after_s: 5.0, rmssd_window_s: 60.0 }
    }
}

pub struct BiometricEngine {
    cfg: BiometricConfig,
    last: Option<(f64, HrMeasurement)>,
    hr_hist: VecDeque<(f64, u16)>,
    rr_hist: VecDeque<(f64, f32)>,
}

impl BiometricEngine {
    pub fn new(cfg: BiometricConfig) -> Self {
        Self { cfg, last: None, hr_hist: VecDeque::new(), rr_hist: VecDeque::new() }
    }

    pub fn ingest(&mut self, m: HrMeasurement, t_s: f64) {
        if (30..=230).contains(&m.bpm) && m.contact != Contact::NotDetected {
            self.hr_hist.push_back((t_s, m.bpm));
            for &rr in &m.rr_ms {
                // Plausible inter-beat interval 260..2000 ms (30..230 bpm).
                if (260.0..=2000.0).contains(&rr) {
                    self.rr_hist.push_back((t_s, rr));
                }
            }
        }
        while self.hr_hist.front().is_some_and(|&(t, _)| t_s - t > 60.0) {
            self.hr_hist.pop_front();
        }
        while self.rr_hist.front().is_some_and(|&(t, _)| t_s - t > self.cfg.rmssd_window_s) {
            self.rr_hist.pop_front();
        }
        self.last = Some((t_s, m));
    }

    fn rmssd(&self) -> Option<f32> {
        if self.rr_hist.len() < 8 {
            return None;
        }
        let rr: Vec<f32> = self.rr_hist.iter().map(|&(_, r)| r).collect();
        // Ectopic/artifact rejection: skip successive differences larger than 20 % of the interval.
        let diffs: Vec<f32> = rr
            .windows(2)
            .filter(|w| (w[1] - w[0]).abs() <= 0.2 * w[0])
            .map(|w| (w[1] - w[0]).powi(2))
            .collect();
        if diffs.len() < 5 {
            return None;
        }
        Some((diffs.iter().sum::<f32>() / diffs.len() as f32).sqrt())
    }

    fn trend(&self, now: f64) -> f32 {
        let recent: Vec<&(f64, u16)> = self.hr_hist.iter().filter(|(t, _)| now - t <= 30.0).collect();
        match (recent.first(), recent.last()) {
            (Some(a), Some(b)) if b.0 - a.0 >= 10.0 => (b.1 as f32 - a.1 as f32) / ((b.0 - a.0) as f32 / 60.0),
            _ => 0.0,
        }
    }

    pub fn state(&self, now: f64) -> Option<BiometricState> {
        let (t, m) = self.last.as_ref()?;
        let fresh = now - t <= self.cfg.stale_after_s;
        let plausible = (30..=230).contains(&m.bpm);
        let contact_ok = m.contact != Contact::NotDetected;
        // Heart-rate reserve (Karvonen) fraction.
        let reserve = ((m.bpm as f32 - self.cfg.resting_hr) / (self.cfg.max_hr - self.cfg.resting_hr)).clamp(0.0, 1.5);
        let level = match reserve {
            r if r < 0.30 => ArousalLevel::Relaxed,
            r if r < 0.50 => ArousalLevel::Focused,
            r if r < 0.70 => ArousalLevel::Elevated,
            _ => ArousalLevel::High,
        };
        Some(BiometricState {
            bpm: m.bpm,
            trend_bpm_per_min: self.trend(now),
            rmssd_ms: self.rmssd(),
            level,
            reliable: fresh && plausible && contact_ok,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_u8_hr_no_rr() {
        let m = parse_hr_measurement(&[0x00, 72]).unwrap();
        assert_eq!((m.bpm, m.contact), (72, Contact::Unsupported));
        assert!(m.rr_ms.is_empty());
    }

    #[test]
    fn parses_u16_hr_contact_energy_and_rr() {
        // flags: u16 hr (1) | contact detected (3<<1) | energy (8) | rr (16) = 0x1F
        let data = [0x1F, 0x2C, 0x01, 0x05, 0x00, 0x00, 0x04, 0x00, 0x03];
        let m = parse_hr_measurement(&data).unwrap();
        assert_eq!(m.bpm, 300);
        assert_eq!(m.contact, Contact::Detected);
        assert_eq!(m.rr_ms.len(), 2);
        assert!((m.rr_ms[0] - 1000.0).abs() < 1e-3); // 0x0400 = 1024 -> exactly 1 s
        assert!((m.rr_ms[1] - 768.0 * 1000.0 / 1024.0).abs() < 1e-3); // 0x0300 = 768
    }

    #[test]
    fn rejects_truncated() {
        assert_eq!(parse_hr_measurement(&[]), Err(HrParseError::Truncated));
        assert_eq!(parse_hr_measurement(&[0x01, 0x40]), Err(HrParseError::Truncated));
    }

    fn feed(e: &mut BiometricEngine, bpm: u16, t: f64, contact: Contact, rr: Vec<f32>) {
        e.ingest(HrMeasurement { bpm, contact, rr_ms: rr }, t);
    }

    #[test]
    fn levels_follow_heart_rate_reserve() {
        let mut e = BiometricEngine::new(BiometricConfig::default());
        feed(&mut e, 70, 0.0, Contact::Detected, vec![]);
        assert_eq!(e.state(0.1).unwrap().level, ArousalLevel::Relaxed);
        feed(&mut e, 165, 1.0, Contact::Detected, vec![]);
        assert_eq!(e.state(1.1).unwrap().level, ArousalLevel::High);
    }

    #[test]
    fn unreliable_when_stale_or_contact_lost() {
        let mut e = BiometricEngine::new(BiometricConfig::default());
        feed(&mut e, 90, 0.0, Contact::Detected, vec![]);
        assert!(e.state(1.0).unwrap().reliable);
        assert!(!e.state(10.0).unwrap().reliable, "stale");
        feed(&mut e, 90, 11.0, Contact::NotDetected, vec![]);
        assert!(!e.state(11.5).unwrap().reliable, "contact lost");
        feed(&mut e, 12, 12.0, Contact::Detected, vec![]);
        assert!(!e.state(12.5).unwrap().reliable, "implausible bpm");
    }

    #[test]
    fn rmssd_of_alternating_intervals_and_artifact_rejection() {
        let mut e = BiometricEngine::new(BiometricConfig::default());
        // 800/840 alternating -> |diff| = 40 -> RMSSD = 40
        for i in 0..12 {
            feed(&mut e, 75, i as f64, Contact::Detected, vec![if i % 2 == 0 { 800.0 } else { 840.0 }]);
        }
        let r = e.state(12.0).unwrap().rmssd_ms.unwrap();
        assert!((r - 40.0).abs() < 1e-3, "{r}");
        // a single ectopic-like jump (800 -> 1500) is excluded from the successive differences
        feed(&mut e, 75, 12.0, Contact::Detected, vec![1500.0]);
        let r2 = e.state(12.5).unwrap().rmssd_ms.unwrap();
        assert!((r2 - 40.0).abs() < 1e-3, "{r2}");
    }

    #[test]
    fn trend_detects_rising_hr() {
        let mut e = BiometricEngine::new(BiometricConfig::default());
        for i in 0..=20 {
            feed(&mut e, 100 + i as u16, i as f64, Contact::Detected, vec![]);
        }
        let t = e.state(20.0).unwrap().trend_bpm_per_min;
        assert!((t - 60.0).abs() < 1.0, "{t}");
    }
}
