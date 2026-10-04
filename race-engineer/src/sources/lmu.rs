//! Le Mans Ultimate through the game's built-in `LMU_Data` shared memory (100 Hz telemetry,
//! 5 Hz scoring). Requires "Settings > Gameplay > Enable Plugins = ON" and a game restart;
//! no plugin DLL is needed. Layout: see `lmu_layout` (sizes verified upstream against LMU 1.4).
//!
//! The mapping has no version block, so a torn read is detected by re-reading the
//! `mElapsedTime` of the player's telemetry slot (and `mCurrentET` for scoring) after the copy.
//! Only the needed regions are copied (the mapping is 324 KB).

use super::lmu_layout::*;
use super::TelemetrySource;
use crate::clock::monotonic_s;
use crate::telemetry::{SessionInfo, SimId, TelemetryFrame};
use std::mem::size_of;
use std::sync::Arc;

const KELVIN: f64 = 273.15;
const SCORING_PERIOD_S: f64 = 0.2;

fn cstr(b: &[u8]) -> String {
    let end = b.iter().position(|&c| c == 0).unwrap_or(b.len());
    String::from_utf8_lossy(&b[..end]).trim().to_string()
}

fn f64_at(b: &[u8], o: usize) -> Option<f64> {
    Some(f64::from_le_bytes(b.get(o..o + 8)?.try_into().ok()?))
}

fn read_struct<T: Copy>(b: &[u8]) -> Option<T> {
    // packed(4) POD read from a byte copy: unaligned read is required
    (b.len() >= size_of::<T>()).then(|| unsafe { std::ptr::read_unaligned(b.as_ptr() as *const T) })
}

#[derive(Default, Clone)]
struct Scoring {
    lap_dist_m: Option<f64>,
    /// Laps completed, from the SAME scoring record as `lap_dist_m`: the pair flips together.
    laps: Option<u32>,
    track_len_m: Option<f64>,
    last_lap_s: Option<f32>,
    best_lap_s: Option<f32>,
    in_pits: bool,
    track: Option<String>,
    /// When `lap_dist_m` was read: scoring updates only 5 times a second.
    at_s: f64,
}

pub struct LmuSource<R: FnMut(usize, usize) -> Option<Vec<u8>> + Send> {
    read: R,
    last_elapsed: f64,
    last_scoring_t: f64,
    scoring: Scoring,
}

impl<R: FnMut(usize, usize) -> Option<Vec<u8>> + Send> LmuSource<R> {
    pub fn new(read: R) -> Self {
        Self { read, last_elapsed: f64::NAN, last_scoring_t: f64::MIN, scoring: Scoring::default() }
    }

    fn refresh_scoring(&mut self) {
        let info_off = OFF_SCORING_INFO;
        let Some(raw) = (self.read)(info_off, size_of::<rF2ScoringInfo>()) else { return };
        let Some(info) = read_struct::<rF2ScoringInfo>(&raw) else { return };
        let n = (info.mNumVehicles.max(0) as usize).min(MAX_MAPPED_VEHICLES);
        let et = info.mCurrentET;
        let Some(vraw) = (self.read)(OFF_VEH_SCORING, n * size_of::<rF2VehicleScoring>()) else { return };
        // witness: the scoring clock must not have moved while we copied
        if (self.read)(OFF_SCORING_ET, 8).and_then(|b| f64_at(&b, 0)) != Some(et) {
            return;
        }
        let player = (0..n).find_map(|i| {
            let v = read_struct::<rF2VehicleScoring>(&vraw[i * size_of::<rF2VehicleScoring>()..])?;
            (v.mIsPlayer != 0).then_some(v)
        });
        let lap_len = info.mLapDist;
        let track = cstr(&info.mTrackName);
        self.scoring = Scoring {
            at_s: monotonic_s(),
            track_len_m: (lap_len.is_finite() && lap_len > 100.0).then_some(lap_len),
            track: Some(track).filter(|t| !t.is_empty()),
            ..player
                .map(|v| Scoring {
                    lap_dist_m: Some(v.mLapDist).filter(|d| d.is_finite() && *d >= 0.0),
                    laps: Some(v.mTotalLaps).filter(|&l| l >= 0).map(|l| l as u32),
                    last_lap_s: Some(v.mLastLapTime as f32).filter(|t| *t > 0.0),
                    best_lap_s: Some(v.mBestLapTime as f32).filter(|t| *t > 0.0),
                    in_pits: v.mInPits != 0,
                    ..Default::default()
                })
                .unwrap_or_default()
        };
        // keep the fields from `info` that the struct update above overwrote with defaults
        if self.scoring.track_len_m.is_none() {
            self.scoring.track_len_m = (lap_len.is_finite() && lap_len > 100.0).then_some(lap_len);
        }
    }
}

fn session_info(v: &rF2VehicleTelemetry, track: Option<&str>, track_len: Option<f64>) -> SessionInfo {
    let name = cstr(&v.mVehicleName);
    let model = cstr(&v.mVehicleModel);
    let row = |k: &str, val: String| (k.to_string(), val);
    let mut setup = vec![];
    let level = |cur: u8, max: u8| (max > 0).then(|| format!("{cur} / {max}"));
    if let Some(x) = level(v.mTC, v.mTCMax) {
        setup.push(row("Controllo di trazione", x));
    }
    if let Some(x) = level(v.mTCCut, v.mTCCutMax) {
        setup.push(row("Taglio TC", x));
    }
    if let Some(x) = level(v.mTCSlip, v.mTCSlipMax) {
        setup.push(row("Slittamento TC", x));
    }
    if let Some(x) = level(v.mABS, v.mABSMax) {
        setup.push(row("ABS", x));
    }
    if let Some(x) = level(v.mMotorMap, v.mMotorMapMax) {
        setup.push(row("Mappa motore", x));
    }
    if let Some(x) = level(v.mMigration, v.mMigrationMax) {
        setup.push(row("Migrazione freni", x));
    }
    if let Some(x) = level(v.mFrontAntiSway, v.mFrontAntiSwayMax) {
        setup.push(row("Barra antirollio ant.", x));
    }
    if let Some(x) = level(v.mRearAntiSway, v.mRearAntiSwayMax) {
        setup.push(row("Barra antirollio post.", x));
    }
    let rear = v.mRearBrakeBias;
    if rear.is_finite() && (0.1..0.9).contains(&rear) {
        setup.push(row("Bilanciamento freni (ant. %)", format!("{:.1}", (1.0 - rear) * 100.0)));
    }
    let ve = v.mVirtualEnergy;
    if ve.is_finite() && (0.0..=1.0).contains(&ve) && ve > 0.0 {
        setup.push(row("Energia virtuale (%)", format!("{:.0}", ve * 100.0)));
    }
    SessionInfo {
        car: Some(if model.is_empty() { name } else { model }).filter(|s| !s.is_empty()),
        track: track.map(str::to_string),
        track_length_m: track_len.map(|l| l as f32),
        setup_note: Some("LMU espone nella memoria condivisa solo elettronica e regolazioni di guida, non il setup completo.".into()),
        setup,
    }
}

impl<R: FnMut(usize, usize) -> Option<Vec<u8>> + Send> TelemetrySource for LmuSource<R> {
    fn name(&self) -> &'static str {
        "Le Mans Ultimate"
    }

    fn poll(&mut self) -> Option<TelemetryFrame> {
        let hdr = (self.read)(OFF_ACTIVE_VEHICLES, 3)?;
        let (idx, has_vehicle) = (hdr[1] as usize, hdr[2]);
        if has_vehicle == 0 || idx >= MAX_MAPPED_VEHICLES {
            return None;
        }
        let tel_off = OFF_TELEM_INFO + idx * size_of::<rF2VehicleTelemetry>();
        let raw = (self.read)(tel_off, size_of::<rF2VehicleTelemetry>())?;
        let v = read_struct::<rF2VehicleTelemetry>(&raw)?;
        let elapsed = v.mElapsedTime;
        // torn-read witness
        if (self.read)(tel_off + OFF_VEH_ELAPSED, 8).and_then(|b| f64_at(&b, 0)) != Some(elapsed) {
            return None;
        }
        if elapsed == self.last_elapsed || !elapsed.is_finite() {
            return None;
        }
        let now = monotonic_s();
        if now - self.last_scoring_t >= SCORING_PERIOD_S {
            self.last_scoring_t = now;
            self.refresh_scoring();
        }

        let vel = v.mLocalVel;
        let speed_ms = (vel.x * vel.x + vel.y * vel.y + vel.z * vel.z).sqrt();
        let (rpm, gear) = (v.mEngineRPM, v.mGear);
        let (thr, brk, steer) = (v.mUnfilteredThrottle, v.mUnfilteredBrake, v.mUnfilteredSteering);
        let plausible = speed_ms.is_finite()
            && speed_ms < 200.0
            && rpm.is_finite()
            && (0.0..=30_000.0).contains(&rpm)
            && (-1..=12).contains(&gear)
            && thr.is_finite()
            && (-0.01..=1.01).contains(&thr)
            && brk.is_finite()
            && (-0.01..=1.01).contains(&brk);
        if !plausible {
            return None;
        }
        self.last_elapsed = elapsed;

        // tyres: surface temperature (average of left/centre/right), Kelvin -> Celsius; kPa as is
        let wheels = v.mWheels;
        let mut temps = [0f32; 4];
        let mut press = [0f32; 4];
        let mut tyres_ok = true;
        for (i, w) in wheels.iter().enumerate() {
            let t = w.mTemperature;
            let avg = (t[0] + t[1] + t[2]) / 3.0;
            let p = w.mPressure;
            if !(avg.is_finite() && (200.0..=500.0).contains(&avg) && p.is_finite() && (0.0..=600.0).contains(&p)) {
                tyres_ok = false; // idle/zeroed or layout drift: show no tyre data rather than wrong data
                break;
            }
            temps[i] = (avg - KELVIN) as f32;
            press[i] = p as f32;
        }

        let lap_len = self.scoring.track_len_m;
        // Scoring is 5 Hz (about 16 m steps at 300 km/h): advance the last lap distance with the
        // 100 Hz speed between updates, so brake-point calls are not quantised.
        let pct = match (self.scoring.lap_dist_m, lap_len) {
            (Some(d), Some(l)) => {
                let ahead = speed_ms * (now - self.scoring.at_s).clamp(0.0, 0.5);
                // never run past the line before scoring itself says the lap changed
                Some(((d + ahead).min(l - 0.01) / l).clamp(0.0, 1.0) as f32)
            }
            _ => None,
        };
        let lap_t = v.mElapsedTime - v.mLapStartET;
        let pos = v.mPos;
        let car_session = session_info(&v, self.scoring.track.as_deref(), lap_len);
        Some(TelemetryFrame {
            sim: SimId::Lmu,
            t_s: now,
            speed_kmh: (speed_ms * 3.6) as f32,
            rpm: rpm as f32,
            gear: gear as i8,
            throttle: thr.clamp(0.0, 1.0) as f32,
            brake: brk.clamp(0.0, 1.0) as f32,
            steering: steer.is_finite().then(|| steer.clamp(-1.0, 1.0) as f32),
            tyre_temp_c: tyres_ok.then_some(temps),
            tyre_pressure_kpa: tyres_ok.then_some(press),
            fuel_l: Some(v.mFuel as f32).filter(|f| f.is_finite() && (0.0..=500.0).contains(f)),
            lap_dist_pct: pct,
            // lap number and lap distance come from the same 5 Hz scoring record so they change together
            lap: self.scoring.laps.or_else(|| Some(v.mLapNumber).filter(|&l| l >= 0).map(|l| l as u32)),
            lap_time_s: Some(lap_t as f32).filter(|t| t.is_finite() && (0.0..3600.0).contains(t)),
            last_lap_s: self.scoring.last_lap_s,
            best_lap_s: self.scoring.best_lap_s,
            in_pit: self.scoring.in_pits,
            pos_m: (pos.x.is_finite() && pos.z.is_finite()).then_some([pos.x as f32, pos.z as f32]),
            max_rpm: Some(v.mEngineMaxRPM as f32).filter(|r| r.is_finite() && *r > 1000.0),
            session: Some(Arc::new(car_session)),
        })
    }
}

#[cfg(windows)]
pub fn open_windows() -> LmuSource<impl FnMut(usize, usize) -> Option<Vec<u8>> + Send> {
    let mut map = super::winshm::LazyMapping::new(LMU_DATA_NAME);
    LmuSource::new(move |off, len| map.read_at(off, len))
}

/// Builds a full `LMU_Data` image from a frame: used by tests and by `re-fakesim --sim lmu`.
pub mod fake {
    use super::*;
    use std::ptr::write_unaligned;

    pub fn image_size() -> usize {
        size_of::<LmuObjectOut>()
    }

    fn put<T: Copy>(img: &mut [u8], off: usize, v: T) {
        assert!(off + size_of::<T>() <= img.len());
        unsafe { write_unaligned(img.as_mut_ptr().add(off) as *mut T, v) };
    }

    fn name<const N: usize>(s: &str) -> [u8; N] {
        let mut a = [0u8; N];
        a[..s.len().min(N - 1)].copy_from_slice(&s.as_bytes()[..s.len().min(N - 1)]);
        a
    }

    /// `elapsed`: session clock (changes every call, like the game's physics clock).
    pub fn write(img: &mut Vec<u8>, f: &TelemetryFrame, elapsed: f64) {
        if img.len() != image_size() {
            *img = vec![0u8; image_size()];
        }
        // telemetry header + slot 0
        img[OFF_ACTIVE_VEHICLES] = 1;
        img[OFF_PLAYER_IDX] = 0;
        img[OFF_PLAYER_HAS_VEHICLE] = 1;
        let mut v: rF2VehicleTelemetry = unsafe { std::mem::zeroed() };
        v.mID = 0;
        v.mElapsedTime = elapsed;
        v.mLapNumber = f.lap.unwrap_or(0) as i32;
        v.mLapStartET = elapsed - f.lap_time_s.unwrap_or(0.0) as f64;
        v.mVehicleName = name::<64>("Fake Hypercar #7");
        v.mVehicleModel = name::<30>("Fake Hypercar");
        v.mLocalVel = rF2Vec3 { x: 0.0, y: 0.0, z: f.speed_kmh as f64 / 3.6 };
        let pos = f.pos_m.unwrap_or([0.0, 0.0]);
        v.mPos = rF2Vec3 { x: pos[0] as f64, y: 0.0, z: pos[1] as f64 };
        v.mGear = f.gear as i32;
        v.mEngineRPM = f.rpm as f64;
        v.mEngineMaxRPM = 9000.0;
        v.mUnfilteredThrottle = f.throttle as f64;
        v.mUnfilteredBrake = f.brake as f64;
        v.mUnfilteredSteering = f.steering.unwrap_or(0.0) as f64;
        v.mFuel = f.fuel_l.unwrap_or(50.0) as f64;
        v.mTC = 3;
        v.mTCMax = 8;
        v.mABS = 2;
        v.mABSMax = 12;
        v.mRearBrakeBias = 0.44;
        let mut wheels = v.mWheels;
        for (i, w) in wheels.iter_mut().enumerate() {
            let t = f.tyre_temp_c.map_or(85.0, |t| t[i]) as f64 + KELVIN;
            w.mTemperature = [t - 2.0, t, t + 2.0];
            w.mPressure = 165.0;
            w.mWear = 1.0;
        }
        v.mWheels = wheels;
        put(img, OFF_TELEM_INFO, v);

        // scoring info + player vehicle
        let mut info: rF2ScoringInfo = unsafe { std::mem::zeroed() };
        info.mTrackName = name::<64>("Fake Ring");
        info.mCurrentET = elapsed;
        info.mLapDist = 4000.0;
        info.mNumVehicles = 1;
        put(img, OFF_SCORING_INFO, info);
        let mut sv: rF2VehicleScoring = unsafe { std::mem::zeroed() };
        sv.mIsPlayer = 1;
        sv.mTotalLaps = f.lap.unwrap_or(0) as i16;
        sv.mLapDist = f.lap_dist_pct.unwrap_or(0.0) as f64 * 4000.0;
        sv.mLastLapTime = f.last_lap_s.map_or(-1.0, |t| t as f64);
        sv.mBestLapTime = f.best_lap_s.map_or(-1.0, |t| t as f64);
        put(img, OFF_VEH_SCORING, sv);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sources::sim::SyntheticCar;
    use std::mem::offset_of;

    fn source_over(img: std::sync::Arc<std::sync::Mutex<Vec<u8>>>) -> LmuSource<impl FnMut(usize, usize) -> Option<Vec<u8>> + Send> {
        LmuSource::new(move |off, len| img.lock().unwrap().get(off..off + len).map(<[u8]>::to_vec))
    }

    #[test]
    fn decodes_player_slot_scoring_and_electronics() {
        let mut car = SyntheticCar::default();
        let mut f = car.step(0.01);
        for _ in 0..500 {
            f = car.step(0.01);
        }
        let img = std::sync::Arc::new(std::sync::Mutex::new(vec![]));
        fake::write(&mut img.lock().unwrap(), &f, 100.0);
        let mut src = source_over(img.clone());
        let out = src.poll().expect("frame");
        assert_eq!(out.sim, SimId::Lmu);
        assert!((out.speed_kmh - f.speed_kmh).abs() < 0.01);
        assert_eq!(out.gear, f.gear);
        assert!((out.tyre_temp_c.unwrap()[0] - f.tyre_temp_c.unwrap()[0]).abs() < 0.01, "Kelvin -> Celsius");
        assert_eq!(out.tyre_pressure_kpa.unwrap()[0], 165.0);
        assert!((out.lap_dist_pct.unwrap() - f.lap_dist_pct.unwrap()).abs() < 1e-4);
        assert!((out.lap_time_s.unwrap() - f.lap_time_s.unwrap()).abs() < 1e-3);
        assert_eq!(out.pos_m.unwrap(), f.pos_m.unwrap());
        assert_eq!(out.max_rpm, Some(9000.0));
        let s = out.session.unwrap();
        assert_eq!(s.track.as_deref(), Some("Fake Ring"));
        assert_eq!(s.car.as_deref(), Some("Fake Hypercar"));
        assert_eq!(s.track_length_m, Some(4000.0));
        assert!(s.setup.contains(&("Controllo di trazione".into(), "3 / 8".into())));
        assert!(s.setup.contains(&("Bilanciamento freni (ant. %)".into(), "56.0".into())));
        // same physics clock: nothing new
        assert!(src.poll().is_none());
        // new clock tick: new frame
        fake::write(&mut img.lock().unwrap(), &f, 100.01);
        assert!(src.poll().is_some());
    }

    #[test]
    fn lap_position_advances_smoothly_between_5hz_scoring_updates() {
        let mut car = SyntheticCar::default();
        let mut f = car.step(0.01);
        for _ in 0..800 {
            f = car.step(0.01);
        }
        let img = std::sync::Arc::new(std::sync::Mutex::new(vec![]));
        fake::write(&mut img.lock().unwrap(), &f, 50.0);
        let mut src = source_over(img.clone());
        let p0 = src.poll().unwrap().lap_dist_pct.unwrap();
        // only the physics clock moves (scoring distance stays as written)
        std::thread::sleep(std::time::Duration::from_millis(120));
        fake::write(&mut img.lock().unwrap(), &f, 50.12);
        {
            // keep the scoring distance frozen at its old value, like a 5 Hz update not yet arrived
            let mut g = img.lock().unwrap();
            let o = OFF_VEH_SCORING + std::mem::offset_of!(rF2VehicleScoring, mLapDist);
            g[o..o + 8].copy_from_slice(&(p0 as f64 * 4000.0).to_le_bytes());
        }
        let p1 = src.poll().unwrap().lap_dist_pct.unwrap();
        let expected = f.speed_kmh / 3.6 * 0.12 / 4000.0;
        assert!(p1 > p0 && (p1 - p0 - expected).abs() < expected * 0.5 + 1e-5, "p0 {p0} p1 {p1} expected +{expected}");
    }

    #[test]
    fn lap_number_and_distance_flip_together_at_the_line() {
        // telemetry already says "lap 5" but the 5 Hz scoring record still describes the end of lap 4
        let mut car = SyntheticCar::default();
        let mut f = car.step(0.01);
        for _ in 0..100 {
            f = car.step(0.01);
        }
        f.lap = Some(4);
        f.lap_dist_pct = Some(0.998);
        let img = std::sync::Arc::new(std::sync::Mutex::new(vec![]));
        fake::write(&mut img.lock().unwrap(), &f, 60.0);
        {
            let mut g = img.lock().unwrap();
            let o = OFF_TELEM_INFO + offset_of!(rF2VehicleTelemetry, mLapNumber);
            g[o..o + 4].copy_from_slice(&5i32.to_le_bytes());
        }
        let out = source_over(img).poll().unwrap();
        assert_eq!(out.lap, Some(4), "lap comes from scoring, together with the distance");
        assert!(out.lap_dist_pct.unwrap() >= 0.99, "{:?}", out.lap_dist_pct);
        assert!(out.lap_dist_pct.unwrap() < 1.0, "extrapolation must not cross the line by itself");
    }

    #[test]
    fn idle_garage_zeroed_wheels_hide_tyres_and_no_player_means_no_frame() {
        let mut car = SyntheticCar::default();
        let f = car.step(0.01);
        let img = std::sync::Arc::new(std::sync::Mutex::new(vec![]));
        fake::write(&mut img.lock().unwrap(), &f, 5.0);
        // zero the wheel block: LMU does this before the player takes control
        {
            let mut g = img.lock().unwrap();
            let o = OFF_TELEM_INFO + offset_of!(rF2VehicleTelemetry, mWheels);
            for b in &mut g[o..o + 4 * size_of::<rF2Wheel>()] {
                *b = 0;
            }
        }
        let mut src = source_over(img.clone());
        let out = src.poll().unwrap();
        assert!(out.tyre_temp_c.is_none() && out.tyre_pressure_kpa.is_none());
        // player has no vehicle
        img.lock().unwrap()[OFF_PLAYER_HAS_VEHICLE] = 0;
        assert!(source_over(img).poll().is_none());
    }

    #[test]
    fn torn_read_is_skipped() {
        let mut car = SyntheticCar::default();
        let f = car.step(0.01);
        let img = std::sync::Arc::new(std::sync::Mutex::new(vec![]));
        fake::write(&mut img.lock().unwrap(), &f, 7.0);
        // the "game" bumps its clock between our copy and our witness read
        let g = img.clone();
        let mut calls = 0;
        let mut src = LmuSource::new(move |off, len| {
            calls += 1;
            let mut guard = g.lock().unwrap();
            let out = guard.get(off..off + len).map(<[u8]>::to_vec);
            if calls == 2 {
                let o = OFF_TELEM_INFO + OFF_VEH_ELAPSED;
                guard[o..o + 8].copy_from_slice(&8.0f64.to_le_bytes());
            }
            out
        });
        assert!(src.poll().is_none(), "witness differs -> frame dropped, not published");
    }

    #[test]
    fn implausible_values_are_dropped() {
        let mut car = SyntheticCar::default();
        let f = car.step(0.01);
        let img = std::sync::Arc::new(std::sync::Mutex::new(vec![]));
        fake::write(&mut img.lock().unwrap(), &f, 9.0);
        {
            let mut g = img.lock().unwrap();
            let o = OFF_TELEM_INFO + offset_of!(rF2VehicleTelemetry, mEngineRPM);
            g[o..o + 8].copy_from_slice(&f64::NAN.to_le_bytes());
        }
        assert!(source_over(img).poll().is_none());
    }
}
