//! Offline lap recording: keeps decimated samples of the current lap, detects lap
//! completion, keeps the best valid lap as reference and writes every lap to CSV.

use crate::telemetry::TelemetryFrame;
use std::io::Write;
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Sample {
    pub pct: f32,
    pub lap_t: f32,
    pub speed_ms: f32,
    pub throttle: f32,
    pub brake: f32,
    pub pos: Option<[f32; 2]>,
}

#[derive(Debug, Clone)]
pub struct Lap {
    pub number: u32,
    pub time_s: f32,
    /// Track length estimated by integrating speed over the lap (works on any sim).
    pub length_m: f32,
    pub valid: bool,
    pub samples: Vec<Sample>,
}

pub struct LapRecorder {
    cur_lap: Option<u32>,
    samples: Vec<Sample>,
    dist_m: f64,
    last_t: Option<f64>,
    last_kept_t: f64,
    saw_pit: bool,
    best: Option<Lap>,
}

const SAMPLE_PERIOD_S: f64 = 0.05;

impl Default for LapRecorder {
    fn default() -> Self {
        Self::new()
    }
}

impl LapRecorder {
    pub fn new() -> Self {
        Self { cur_lap: None, samples: vec![], dist_m: 0.0, last_t: None, last_kept_t: f64::MIN, saw_pit: false, best: None }
    }

    pub fn best(&self) -> Option<&Lap> {
        self.best.as_ref()
    }

    /// Feeds a frame; returns the lap that just finished, if any.
    pub fn push(&mut self, f: &TelemetryFrame) -> Option<Lap> {
        let (Some(lap), Some(pct)) = (f.lap, f.lap_dist_pct) else {
            return None;
        };
        let mut finished = None;
        if self.cur_lap.is_some_and(|l| l != lap) {
            finished = self.finish(f);
        }
        if self.cur_lap != Some(lap) {
            self.cur_lap = Some(lap);
            self.samples.clear();
            self.dist_m = 0.0;
            self.last_t = None;
            self.last_kept_t = f64::MIN;
            self.saw_pit = false;
        }
        if let Some(lt) = self.last_t {
            self.dist_m += f.speed_kmh as f64 / 3.6 * (f.t_s - lt).max(0.0);
        }
        self.last_t = Some(f.t_s);
        self.saw_pit |= f.in_pit;
        if f.t_s - self.last_kept_t >= SAMPLE_PERIOD_S {
            self.last_kept_t = f.t_s;
            self.samples.push(Sample {
                pct,
                lap_t: f.lap_time_s.unwrap_or(0.0),
                speed_ms: f.speed_kmh / 3.6,
                throttle: f.throttle,
                brake: f.brake,
                pos: f.pos_m,
            });
        }
        finished
    }

    fn finish(&mut self, new_frame: &TelemetryFrame) -> Option<Lap> {
        let number = self.cur_lap?;
        let samples = std::mem::take(&mut self.samples);
        let first = samples.first()?.pct;
        let last = samples.last()?.pct;
        let time_s = new_frame
            .last_lap_s
            .or_else(|| samples.last().map(|s| s.lap_t))
            .filter(|&t| t > 0.0)?;
        let complete = first < 0.1 && last > 0.9;
        let lap = Lap { number, time_s, length_m: self.dist_m as f32, valid: complete && !self.saw_pit, samples };
        if lap.valid && self.best.as_ref().is_none_or(|b| lap.time_s < b.time_s) {
            self.best = Some(lap.clone());
        }
        Some(lap)
    }
}

pub fn write_csv(lap: &Lap, dir: &Path) -> std::io::Result<std::path::PathBuf> {
    std::fs::create_dir_all(dir)?;
    let path = dir.join(format!("lap_{:03}_{:.3}.csv", lap.number, lap.time_s));
    let mut w = std::io::BufWriter::new(std::fs::File::create(&path)?);
    writeln!(w, "lap_dist_pct,lap_time_s,speed_ms,throttle,brake")?;
    for s in &lap.samples {
        writeln!(w, "{:.5},{:.3},{:.2},{:.3},{:.3}", s.pct, s.lap_t, s.speed_ms, s.throttle, s.brake)?;
    }
    w.flush()?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sources::sim::SyntheticCar;

    #[test]
    fn records_laps_keeps_best_and_estimates_length() {
        let mut car = SyntheticCar::default();
        let mut rec = LapRecorder::new();
        let mut done = vec![];
        for _ in 0..30_000 {
            if let Some(l) = rec.push(&car.step(0.01)) {
                done.push(l);
            }
        }
        assert!(done.len() >= 2);
        // lap 0 starts mid-track at t=0 with pct=0 -> valid; length ≈ 4000 m
        let l = done.last().unwrap();
        assert!(l.valid);
        assert!((l.length_m - 4000.0).abs() < 60.0, "{}", l.length_m);
        assert!(rec.best().is_some());
        assert!(l.samples.len() > 100 && l.samples.len() < 3000, "decimated: {}", l.samples.len());
    }

    #[test]
    fn writes_csv() {
        let lap = Lap {
            number: 3,
            time_s: 91.5,
            length_m: 4000.0,
            valid: true,
            samples: vec![Sample { pct: 0.1, lap_t: 9.0, speed_ms: 50.0, throttle: 1.0, brake: 0.0, pos: None }],
        };
        let dir = std::env::temp_dir().join("re_csv_test");
        let p = write_csv(&lap, &dir).unwrap();
        let text = std::fs::read_to_string(p).unwrap();
        assert!(text.starts_with("lap_dist_pct,"));
        assert_eq!(text.lines().count(), 2);
    }
}
