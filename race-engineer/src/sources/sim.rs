//! Deterministic synthetic car: lets the whole pipeline (engineer, voice, recorder, UI)
//! be exercised and tested without any simulator running.

use super::TelemetrySource;
use crate::clock::monotonic_s;
use crate::telemetry::{SimId, TelemetryFrame};

/// (track position 0..1, minimum corner speed m/s)
const CORNERS: [(f64, f64); 4] = [(0.15, 25.0), (0.35, 33.0), (0.55, 19.0), (0.80, 42.0)];
const TRACK_LEN_M: f64 = 4000.0;
const V_MAX: f64 = 83.0; // ~300 km/h
const BRAKE_DECEL: f64 = 25.0;

pub struct SyntheticCar {
    s: f64,
    v: f64,
    t: f64,
    lap: u32,
    lap_t: f64,
    last_lap: Option<f32>,
    best_lap: Option<f32>,
    tyre_temp: f32,
}

impl Default for SyntheticCar {
    fn default() -> Self {
        Self { s: 0.0, v: 30.0, t: 0.0, lap: 0, lap_t: 0.0, last_lap: None, best_lap: None, tyre_temp: 80.0 }
    }
}

impl SyntheticCar {
    pub fn track_len_m() -> f64 {
        TRACK_LEN_M
    }

    /// Speed the driver may carry now so as to still reach every corner at its speed.
    fn allowed_speed(&self) -> f64 {
        let pct = self.s / TRACK_LEN_M;
        CORNERS
            .iter()
            .map(|&(cp, cv)| {
                let mut d = (cp - pct) * TRACK_LEN_M;
                if d < -50.0 {
                    d += TRACK_LEN_M; // corner ahead on the next lap
                }
                if d < 0.0 {
                    cv
                } else {
                    (cv * cv + 2.0 * BRAKE_DECEL * d).sqrt()
                }
            })
            .fold(V_MAX, f64::min)
    }

    pub fn step(&mut self, dt: f64) -> TelemetryFrame {
        let allowed = self.allowed_speed();
        let (throttle, brake) = if self.v > allowed + 0.5 {
            (0.0, 1.0)
        } else if self.v < allowed - 1.0 {
            (1.0, 0.0)
        } else {
            (0.4, 0.0)
        };
        let accel = if brake > 0.0 { -BRAKE_DECEL } else { throttle * (9.0 * (1.0 - self.v / (V_MAX + 10.0))) };
        self.v = (self.v + accel * dt).max(5.0);
        self.s += self.v * dt;
        self.t += dt;
        self.lap_t += dt;
        if self.s >= TRACK_LEN_M {
            self.s -= TRACK_LEN_M;
            let lt = self.lap_t as f32;
            self.last_lap = Some(lt);
            self.best_lap = Some(self.best_lap.map_or(lt, |b| b.min(lt)));
            self.lap += 1;
            self.lap_t = 0.0;
        }
        self.tyre_temp = (self.tyre_temp + 0.05 * dt as f32 + 0.01 * brake as f32).min(125.0);
        let gear = ((self.v / 14.0) as i8 + 1).clamp(1, 7);
        TelemetryFrame {
            sim: SimId::Synthetic,
            t_s: self.t,
            speed_kmh: (self.v * 3.6) as f32,
            rpm: 4000.0 + (self.v % 14.0) as f32 * 450.0,
            gear,
            throttle: throttle as f32,
            brake: brake as f32,
            steering: Some(0.0),
            tyre_temp_c: Some([self.tyre_temp, self.tyre_temp + 1.0, self.tyre_temp - 2.0, self.tyre_temp - 1.0]),
            tyre_pressure_kpa: Some([165.0; 4]),
            fuel_l: Some(60.0 - self.t as f32 * 0.02),
            lap_dist_pct: Some((self.s / TRACK_LEN_M) as f32),
            lap: Some(self.lap),
            lap_time_s: Some(self.lap_t as f32),
            last_lap_s: self.last_lap,
            best_lap_s: self.best_lap,
            in_pit: false,
        }
    }
}

/// Real-time wrapper: yields a frame per poll using wall-clock time, optionally sped up.
pub struct SyntheticSource {
    car: SyntheticCar,
    last: f64,
    speedup: f64,
}

impl SyntheticSource {
    pub fn new(speedup: f64) -> Self {
        Self { car: SyntheticCar::default(), last: monotonic_s(), speedup }
    }
}

impl TelemetrySource for SyntheticSource {
    fn name(&self) -> &'static str {
        "synthetic"
    }
    fn poll(&mut self) -> Option<TelemetryFrame> {
        let now = monotonic_s();
        let dt = (now - self.last) * self.speedup;
        self.last = now;
        // keep the integration step small so the synthetic physics stays stable
        let mut f = None;
        let mut left = dt;
        while left > 0.0 {
            let h = left.min(0.01);
            f = Some(self.car.step(h));
            left -= h;
        }
        f
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn completes_laps_and_brakes_before_corners() {
        let mut car = SyntheticCar::default();
        let mut braked_before_first_corner = false;
        let mut laps = 0;
        for _ in 0..30_000 {
            let f = car.step(0.01);
            let p = f.lap_dist_pct.unwrap();
            if p < 0.15 && f.brake > 0.5 {
                braked_before_first_corner = true;
            }
            laps = f.lap.unwrap();
        }
        assert!(braked_before_first_corner);
        assert!(laps >= 2, "300 s should cover >= 2 laps, got {laps}");
        let f = car.step(0.01);
        assert!(f.last_lap_s.unwrap() > 30.0 && f.last_lap_s.unwrap() < 150.0);
    }
}
