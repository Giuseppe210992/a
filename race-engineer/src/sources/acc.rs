//! Assetto Corsa Competizione (and Assetto Corsa) shared memory.
//!
//! Mappings: `Local\acpmf_physics` (updated every simulation step),
//! `Local\acpmf_graphics` (every rendered frame), `Local\acpmf_static` (session constants).
//!
//! Offsets below follow the public shared-memory documentation (`SPageFilePhysics` /
//! `SPageFileGraphic`, 4-byte packing). They are kept in ONE table so that, if a game
//! update changes the layout, only these constants need to change.
//! **Validate on a Windows machine with the game running** (see `docs/VALIDATION.md`):
//! the parser applies plausibility checks and drops frames that fail them instead of
//! publishing wrong numbers.

use super::TelemetrySource;
use crate::clock::monotonic_s;
use crate::telemetry::{SessionInfo, SimId, TelemetryFrame, PSI_TO_KPA};
use std::sync::Arc;

pub const PHYSICS_MAP: &str = "Local\\acpmf_physics";
pub const GRAPHICS_MAP: &str = "Local\\acpmf_graphics";
pub const STATIC_MAP: &str = "Local\\acpmf_static";

pub mod phys {
    pub const PACKET_ID: usize = 0;
    pub const GAS: usize = 4;
    pub const BRAKE: usize = 8;
    pub const FUEL: usize = 12;
    pub const GEAR: usize = 16; // 0 = R, 1 = N, 2 = 1st ...
    pub const RPMS: usize = 20;
    pub const STEER_ANGLE: usize = 24;
    pub const SPEED_KMH: usize = 28;
    pub const WHEELS_PRESSURE: usize = 88; // [4] psi, FL FR RL RR
    pub const TYRE_CORE_TEMP: usize = 152; // [4] °C
    pub const MIN_LEN: usize = 168;
}

pub mod stat {
    // SPageFileStatic (Pack = 4, wchar_t strings; offsets confirmed against a public C# mapping)
    pub const CAR_MODEL: usize = 68; // wchar[33]
    pub const TRACK: usize = 134; // wchar[33]
    pub const MAX_RPM: usize = 412; // int
    pub const MIN_LEN: usize = 420;
}

pub mod gfx {
    pub const STATUS: usize = 4; // 0 off, 1 replay, 2 live, 3 pause
    pub const COMPLETED_LAPS: usize = 132;
    pub const I_CURRENT_TIME: usize = 140; // ms
    pub const I_LAST_TIME: usize = 144; // ms
    pub const I_BEST_TIME: usize = 148; // ms
    pub const IS_IN_PIT: usize = 160;
    pub const NORM_CAR_POS: usize = 248;
    pub const CAR_COORDS: usize = 252; // [3] f32 world x, y, z (metres)
    pub const MIN_LEN: usize = 264;
}

fn f32_at(b: &[u8], o: usize) -> Option<f32> {
    Some(f32::from_le_bytes(b.get(o..o + 4)?.try_into().ok()?))
}
fn i32_at(b: &[u8], o: usize) -> Option<i32> {
    Some(i32::from_le_bytes(b.get(o..o + 4)?.try_into().ok()?))
}
fn f32x4(b: &[u8], o: usize) -> Option<[f32; 4]> {
    Some([f32_at(b, o)?, f32_at(b, o + 4)?, f32_at(b, o + 8)?, f32_at(b, o + 12)?])
}

fn utf16_at(b: &[u8], o: usize, chars: usize) -> Option<String> {
    let raw = b.get(o..o + chars * 2)?;
    let units: Vec<u16> = raw.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).take_while(|&u| u != 0).collect();
    Some(String::from_utf16_lossy(&units)).filter(|s| !s.trim().is_empty())
}

/// Car, track and rev limit from the static page. ACC does not expose the setup in shared memory.
pub fn parse_static(page: &[u8]) -> Option<(SessionInfo, Option<f32>)> {
    if page.len() < stat::MIN_LEN {
        return None;
    }
    let info = SessionInfo {
        car: utf16_at(page, stat::CAR_MODEL, 33),
        track: utf16_at(page, stat::TRACK, 33),
        track_length_m: None,
        setup_note: Some("ACC non espone il setup nella memoria condivisa: non è disponibile.".into()),
        setup: vec![],
    };
    let rpm = i32_at(page, stat::MAX_RPM).filter(|r| (1000..=30_000).contains(r)).map(|r| r as f32);
    Some((info, rpm))
}

pub fn physics_packet_id(physics: &[u8]) -> Option<i32> {
    i32_at(physics, phys::PACKET_ID)
}

pub fn graphics_status(graphics: &[u8]) -> Option<i32> {
    i32_at(graphics, gfx::STATUS)
}

/// Builds a frame, or `None` if the data fails plausibility checks (wrong layout,
/// half-written page, game not in a live session).
pub fn parse(physics: &[u8], graphics: Option<&[u8]>, t_s: f64) -> Option<TelemetryFrame> {
    if physics.len() < phys::MIN_LEN {
        return None;
    }
    let speed = f32_at(physics, phys::SPEED_KMH)?;
    let gas = f32_at(physics, phys::GAS)?;
    let brake = f32_at(physics, phys::BRAKE)?;
    // `rpms` is an int in SPageFilePhysics.
    let rpm = i32_at(physics, phys::RPMS)? as f32;
    if !(speed.is_finite() && (0.0..=600.0).contains(&speed))
        || !(-0.01..=1.01).contains(&gas)
        || !(-0.01..=1.01).contains(&brake)
        || !(0.0..=30_000.0).contains(&rpm)
    {
        return None;
    }
    let gear = i32_at(physics, phys::GEAR)? - 1;
    if !(-1..=10).contains(&gear) {
        return None;
    }
    let mut f = TelemetryFrame {
        sim: SimId::Acc,
        t_s,
        speed_kmh: speed,
        rpm,
        gear: gear as i8,
        throttle: gas.clamp(0.0, 1.0),
        brake: brake.clamp(0.0, 1.0),
        steering: f32_at(physics, phys::STEER_ANGLE).filter(|s| s.is_finite()),
        tyre_temp_c: f32x4(physics, phys::TYRE_CORE_TEMP).filter(|t| t.iter().all(|v| (-50.0..=300.0).contains(v))),
        tyre_pressure_kpa: f32x4(physics, phys::WHEELS_PRESSURE)
            .filter(|p| p.iter().all(|v| (0.0..=60.0).contains(v)))
            .map(|p| p.map(|v| v * PSI_TO_KPA)),
        fuel_l: f32_at(physics, phys::FUEL).filter(|v| (0.0..=500.0).contains(v)),
        ..Default::default()
    };
    if let Some(g) = graphics.filter(|g| g.len() >= gfx::MIN_LEN) {
        if let Some(st) = i32_at(g, gfx::STATUS) {
            if !(0..=3).contains(&st) {
                return None;
            }
        }
        let ms = |o| i32_at(g, o).filter(|&v| v > 0).map(|v| v as f32 / 1000.0);
        f.lap = i32_at(g, gfx::COMPLETED_LAPS).filter(|&l| l >= 0).map(|l| l as u32);
        f.lap_time_s = ms(gfx::I_CURRENT_TIME);
        f.last_lap_s = ms(gfx::I_LAST_TIME);
        f.best_lap_s = ms(gfx::I_BEST_TIME);
        f.in_pit = i32_at(g, gfx::IS_IN_PIT).unwrap_or(0) != 0;
        f.lap_dist_pct = f32_at(g, gfx::NORM_CAR_POS).filter(|p| (0.0..=1.0).contains(p));
        // Horizontal plane is x/z (y is height).
        f.pos_m = f32_at(g, gfx::CAR_COORDS)
            .zip(f32_at(g, gfx::CAR_COORDS + 8))
            .filter(|(x, z)| x.is_finite() && z.is_finite() && (x.abs() + z.abs()) < 1.0e6 && (*x != 0.0 || *z != 0.0))
            .map(|(x, z)| [x, z]);
    }
    Some(f)
}

pub struct AccSource<P, G, S>
where
    P: FnMut() -> Option<Vec<u8>> + Send,
    G: FnMut() -> Option<Vec<u8>> + Send,
    S: FnMut() -> Option<Vec<u8>> + Send,
{
    physics: P,
    graphics: G,
    statics: S,
    last_packet: i32,
    last_static_read: f64,
    session: Option<Arc<SessionInfo>>,
    max_rpm: Option<f32>,
}

impl<P, G, S> AccSource<P, G, S>
where
    P: FnMut() -> Option<Vec<u8>> + Send,
    G: FnMut() -> Option<Vec<u8>> + Send,
    S: FnMut() -> Option<Vec<u8>> + Send,
{
    pub fn new(physics: P, graphics: G, statics: S) -> Self {
        Self { physics, graphics, statics, last_packet: -1, last_static_read: f64::MIN, session: None, max_rpm: None }
    }
}

impl<P, G, S> TelemetrySource for AccSource<P, G, S>
where
    P: FnMut() -> Option<Vec<u8>> + Send,
    G: FnMut() -> Option<Vec<u8>> + Send,
    S: FnMut() -> Option<Vec<u8>> + Send,
{
    fn name(&self) -> &'static str {
        "Assetto Corsa Competizione"
    }
    fn poll(&mut self) -> Option<TelemetryFrame> {
        let p = (self.physics)()?;
        let id = physics_packet_id(&p)?;
        if id == self.last_packet {
            return None;
        }
        let now = monotonic_s();
        // The static page only changes when a session loads: re-read it every 2 s.
        if now - self.last_static_read > 2.0 {
            self.last_static_read = now;
            if let Some((info, rpm)) = (self.statics)().and_then(|s| parse_static(&s)) {
                self.session = Some(Arc::new(info));
                self.max_rpm = rpm;
            }
        }
        let g = (self.graphics)();
        let mut frame = parse(&p, g.as_deref(), now)?;
        frame.session = self.session.clone();
        frame.max_rpm = self.max_rpm;
        // Only mark the packet consumed once it parsed, so a transient bad read retries.
        self.last_packet = id;
        Some(frame)
    }
}

#[cfg(windows)]
pub fn open_windows() -> AccSource<impl FnMut() -> Option<Vec<u8>> + Send, impl FnMut() -> Option<Vec<u8>> + Send, impl FnMut() -> Option<Vec<u8>> + Send> {
    use super::winshm::LazyMapping;
    let (mut p, mut g, mut st) = (LazyMapping::new(PHYSICS_MAP), LazyMapping::new(GRAPHICS_MAP), LazyMapping::new(STATIC_MAP));
    AccSource::new(move || p.bytes(), move || g.bytes(), move || st.bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn put_f(b: &mut [u8], o: usize, v: f32) {
        b[o..o + 4].copy_from_slice(&v.to_le_bytes());
    }
    fn put_i(b: &mut [u8], o: usize, v: i32) {
        b[o..o + 4].copy_from_slice(&v.to_le_bytes());
    }

    fn pages() -> (Vec<u8>, Vec<u8>) {
        let mut p = vec![0u8; 800];
        put_i(&mut p, phys::PACKET_ID, 7);
        put_f(&mut p, phys::GAS, 0.8);
        put_f(&mut p, phys::BRAKE, 0.0);
        put_i(&mut p, phys::GEAR, 4); // 3rd gear
        put_i(&mut p, phys::RPMS, 7200);
        put_f(&mut p, phys::SPEED_KMH, 187.5);
        put_f(&mut p, phys::FUEL, 41.0);
        for i in 0..4 {
            put_f(&mut p, phys::WHEELS_PRESSURE + i * 4, 27.5);
            put_f(&mut p, phys::TYRE_CORE_TEMP + i * 4, 80.0 + i as f32);
        }
        let mut g = vec![0u8; 400];
        put_i(&mut g, gfx::STATUS, 2);
        put_i(&mut g, gfx::COMPLETED_LAPS, 3);
        put_i(&mut g, gfx::I_LAST_TIME, 92_345);
        put_f(&mut g, gfx::NORM_CAR_POS, 0.42);
        put_f(&mut g, gfx::CAR_COORDS, 120.5);
        put_f(&mut g, gfx::CAR_COORDS + 4, 3.0);
        put_f(&mut g, gfx::CAR_COORDS + 8, -80.25);
        (p, g)
    }

    #[test]
    fn parses_and_normalises() {
        let (p, g) = pages();
        let f = parse(&p, Some(&g), 0.0).unwrap();
        assert_eq!(f.gear, 3);
        assert_eq!(f.rpm, 7200.0);
        assert!((f.tyre_pressure_kpa.unwrap()[0] - 27.5 * PSI_TO_KPA).abs() < 1e-3);
        assert_eq!(f.tyre_temp_c.unwrap()[3], 83.0);
        assert_eq!(f.lap, Some(3));
        assert!((f.last_lap_s.unwrap() - 92.345).abs() < 1e-4);
        assert_eq!(f.lap_time_s, None, "0 ms = no valid current lap time");
        assert_eq!(f.lap_dist_pct, Some(0.42));
        assert_eq!(f.pos_m, Some([120.5, -80.25]), "x and z, y is height");
    }

    fn put_utf16(b: &mut [u8], o: usize, s: &str) {
        for (i, u) in s.encode_utf16().enumerate() {
            b[o + i * 2..o + i * 2 + 2].copy_from_slice(&u.to_le_bytes());
        }
    }

    #[test]
    fn static_page_gives_car_track_and_rev_limit() {
        let mut st = vec![0u8; 500];
        put_utf16(&mut st, stat::CAR_MODEL, "amr_v8_vantage_gt3");
        put_utf16(&mut st, stat::TRACK, "monza");
        put_i(&mut st, stat::MAX_RPM, 7600);
        let (info, rpm) = parse_static(&st).unwrap();
        assert_eq!(info.car.as_deref(), Some("amr_v8_vantage_gt3"));
        assert_eq!(info.track.as_deref(), Some("monza"));
        assert_eq!(rpm, Some(7600.0));
        assert!(info.setup.is_empty() && info.setup_note.is_some());
        assert!(parse_static(&st[..100]).is_none());
    }

    #[test]
    fn rejects_implausible_data_instead_of_publishing_it() {
        let (mut p, g) = pages();
        put_f(&mut p, phys::SPEED_KMH, 9.0e9);
        assert!(parse(&p, Some(&g), 0.0).is_none());
        let (p, mut g) = pages();
        put_i(&mut g, gfx::STATUS, 77);
        assert!(parse(&p, Some(&g), 0.0).is_none());
        assert!(parse(&p[..10], None, 0.0).is_none());
    }

    #[test]
    fn source_only_emits_new_packets() {
        let (p, g) = pages();
        let (p2, g2) = (p.clone(), g.clone());
        let mut s = AccSource::new(move || Some(p2.clone()), move || Some(g2.clone()), || None);
        assert!(s.poll().is_some());
        assert!(s.poll().is_none());
        let _ = (p, g);
    }
}
