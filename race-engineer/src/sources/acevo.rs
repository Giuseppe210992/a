//! Assetto Corsa EVO shared memory: `Local\acevo_pmf_physics`, `Local\acevo_pmf_graphics`,
//! `Local\acevo_pmf_static`.
//!
//! The physics page starts with exactly the ACC `SPageFilePhysics` fields (same offsets, so the
//! ACC decoder is reused for pedals, speed, gear, rpm, tyre pressure/temperature). The graphics
//! page is a new, larger structure (`SPageFileGraphicEvo`, 4900 bytes) and the static page is
//! `SPageFileStaticEvo` (208 bytes). Offsets were computed by compiling the struct definitions of
//! the MIT-licensed `acevo-shared-memory` crate (github.com/dSyncro/acevo-shared-memory,
//! `src/bindings/source/wrapper.hpp`, `#pragma pack(4)`) and printing `offsetof`; units and ranges
//! come from that header's field documentation. Not yet run against the game: AC Evo is in
//! early access and its layout may change between builds, so values are range-checked.

use super::acc;
use super::TelemetrySource;
use crate::clock::monotonic_s;
use crate::telemetry::{SessionInfo, SimId, TelemetryFrame};
use std::sync::Arc;

pub const PHYSICS_MAP: &str = "Local\\acevo_pmf_physics";
pub const GRAPHICS_MAP: &str = "Local\\acevo_pmf_graphics";
pub const STATIC_MAP: &str = "Local\\acevo_pmf_static";

pub mod phys {
    pub const CURRENT_MAX_RPM: usize = 588; // int
    pub const MIN_LEN: usize = 800;
}

pub mod gfx {
    pub const PACKET_ID: usize = 0;
    pub const STATUS: usize = 4; // 0 off, 1 replay, 2 live, 3 pause
    pub const PLAYER_CAR_ID: usize = 24; // u64 a, u64 b
    pub const STEERING_PERCENT: usize = 92; // -1 left .. +1 right
    pub const CURRENT_LAP_TIME_MS: usize = 188;
    pub const NPOS: usize = 1244; // 0..1 around the lap
    pub const TOTAL_LAP_COUNT: usize = 2384;
    pub const LAST_LAP_MS: usize = 2396;
    pub const BEST_LAP_MS: usize = 2400;
    pub const DRIVER_NAME: usize = 3020; // char[33]
    pub const CAR_MODEL: usize = 3086; // char[33]
    pub const IS_IN_PIT_LANE: usize = 3120; // bool
    pub const CAR_COORDINATES: usize = 3124; // [60][3] f32
    pub const ACTIVE_CARS: usize = 3852; // u8
    pub const CAR_IDS: usize = 3940; // [60][2] u64
    pub const MAX_CARS: usize = 60;
    pub const SIZE: usize = 4900;
}

pub mod stat {
    pub const TRACK: usize = 136; // char[33]
    pub const TRACK_CONFIGURATION: usize = 169; // char[33]
    pub const TRACK_LENGTH_M: usize = 204; // f32
    pub const SIZE: usize = 208;
}

fn i32_at(b: &[u8], o: usize) -> Option<i32> {
    Some(i32::from_le_bytes(b.get(o..o + 4)?.try_into().ok()?))
}
fn u64_at(b: &[u8], o: usize) -> Option<u64> {
    Some(u64::from_le_bytes(b.get(o..o + 8)?.try_into().ok()?))
}
fn f32_at(b: &[u8], o: usize) -> Option<f32> {
    Some(f32::from_le_bytes(b.get(o..o + 4)?.try_into().ok()?))
}
fn cstr(b: &[u8], o: usize, n: usize) -> Option<String> {
    let s = b.get(o..o + n)?;
    let end = s.iter().position(|&c| c == 0).unwrap_or(n);
    Some(String::from_utf8_lossy(&s[..end]).trim().to_string()).filter(|s| !s.is_empty())
}

pub fn parse_static(page: &[u8]) -> Option<SessionInfo> {
    if page.len() < stat::SIZE {
        return None;
    }
    let track = match (cstr(page, stat::TRACK, 33), cstr(page, stat::TRACK_CONFIGURATION, 33)) {
        (Some(t), Some(c)) => Some(format!("{t} ({c})")),
        (t, _) => t,
    };
    Some(SessionInfo {
        car: None,
        track,
        track_length_m: f32_at(page, stat::TRACK_LENGTH_M).filter(|l| l.is_finite() && (100.0..100_000.0).contains(l)),
        setup_note: Some("AC Evo non espone il setup nella memoria condivisa: non è disponibile.".into()),
        setup: vec![],
    })
}

/// Merges the physics frame with the graphics page; `None` unless the sim is live.
pub fn parse(physics: &[u8], graphics: &[u8], t_s: f64) -> Option<TelemetryFrame> {
    if graphics.len() < gfx::SIZE || physics.len() < phys::MIN_LEN {
        return None;
    }
    if i32_at(graphics, gfx::STATUS)? != 2 {
        return None; // off / replay / paused
    }
    let mut f = acc::parse(physics, None, t_s)?;
    f.sim = SimId::AcEvo;
    f.max_rpm = i32_at(physics, phys::CURRENT_MAX_RPM).filter(|r| (1000..=30_000).contains(r)).map(|r| r as f32);
    f.steering = f32_at(graphics, gfx::STEERING_PERCENT).filter(|s| s.is_finite()).map(|s| s.clamp(-1.0, 1.0));
    f.lap_dist_pct = f32_at(graphics, gfx::NPOS).filter(|p| (0.0..=1.0).contains(p));
    f.lap = i32_at(graphics, gfx::TOTAL_LAP_COUNT).filter(|&l| (0..10_000).contains(&l)).map(|l| l as u32);
    let ms = |o| i32_at(graphics, o).filter(|&v| v > 0).map(|v| v as f32 / 1000.0);
    f.lap_time_s = ms(gfx::CURRENT_LAP_TIME_MS);
    f.last_lap_s = ms(gfx::LAST_LAP_MS);
    f.best_lap_s = ms(gfx::BEST_LAP_MS);
    f.in_pit = graphics.get(gfx::IS_IN_PIT_LANE).is_some_and(|&b| b == 1);
    // the player's own entry in the 60-car coordinate table
    let ids = (u64_at(graphics, gfx::PLAYER_CAR_ID)?, u64_at(graphics, gfx::PLAYER_CAR_ID + 8)?);
    let active = (*graphics.get(gfx::ACTIVE_CARS)? as usize).min(gfx::MAX_CARS);
    f.pos_m = (0..active).find_map(|i| {
        let o = gfx::CAR_IDS + i * 16;
        (u64_at(graphics, o)? == ids.0 && u64_at(graphics, o + 8)? == ids.1).then_some(i)
    })
    .and_then(|i| {
        let o = gfx::CAR_COORDINATES + i * 12;
        let (x, z) = (f32_at(graphics, o)?, f32_at(graphics, o + 8)?);
        (x.is_finite() && z.is_finite() && (x.abs() + z.abs()) < 1.0e6 && (x != 0.0 || z != 0.0)).then_some([x, z])
    });
    Some(f)
}

pub struct AcEvoSource<P, G, S>
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
}

impl<P, G, S> AcEvoSource<P, G, S>
where
    P: FnMut() -> Option<Vec<u8>> + Send,
    G: FnMut() -> Option<Vec<u8>> + Send,
    S: FnMut() -> Option<Vec<u8>> + Send,
{
    pub fn new(physics: P, graphics: G, statics: S) -> Self {
        Self { physics, graphics, statics, last_packet: -1, last_static_read: f64::MIN, session: None }
    }
}

impl<P, G, S> TelemetrySource for AcEvoSource<P, G, S>
where
    P: FnMut() -> Option<Vec<u8>> + Send,
    G: FnMut() -> Option<Vec<u8>> + Send,
    S: FnMut() -> Option<Vec<u8>> + Send,
{
    fn name(&self) -> &'static str {
        "Assetto Corsa EVO"
    }

    fn poll(&mut self) -> Option<TelemetryFrame> {
        let p = (self.physics)()?;
        let id = acc::physics_packet_id(&p)?;
        if id == self.last_packet {
            return None;
        }
        let now = monotonic_s();
        let g = (self.graphics)()?;
        if now - self.last_static_read > 2.0 {
            self.last_static_read = now;
            if let Some(mut info) = (self.statics)().and_then(|s| parse_static(&s)) {
                info.car = cstr(&g, gfx::CAR_MODEL, 33);
                self.session = Some(Arc::new(info));
            }
        }
        let mut f = parse(&p, &g, now)?;
        f.session = self.session.clone();
        self.last_packet = id;
        Some(f)
    }
}

#[cfg(windows)]
pub fn open_windows() -> AcEvoSource<impl FnMut() -> Option<Vec<u8>> + Send, impl FnMut() -> Option<Vec<u8>> + Send, impl FnMut() -> Option<Vec<u8>> + Send> {
    use super::winshm::LazyMapping;
    let (mut p, mut g, mut s) = (LazyMapping::new(PHYSICS_MAP), LazyMapping::new(GRAPHICS_MAP), LazyMapping::new(STATIC_MAP));
    AcEvoSource::new(move || p.bytes(), move || g.bytes(), move || s.bytes())
}

/// Page builders shared by the tests and `re-fakesim --sim acevo`.
pub mod fake {
    use super::*;

    fn putf(b: &mut [u8], o: usize, v: f32) {
        b[o..o + 4].copy_from_slice(&v.to_le_bytes());
    }
    fn puti(b: &mut [u8], o: usize, v: i32) {
        b[o..o + 4].copy_from_slice(&v.to_le_bytes());
    }
    fn putu64(b: &mut [u8], o: usize, v: u64) {
        b[o..o + 8].copy_from_slice(&v.to_le_bytes());
    }
    fn putstr(b: &mut [u8], o: usize, s: &str) {
        b[o..o + s.len()].copy_from_slice(s.as_bytes());
    }

    pub fn physics(f: &TelemetryFrame, packet: i32) -> Vec<u8> {
        let mut p = vec![0u8; phys::MIN_LEN];
        puti(&mut p, 0, packet);
        putf(&mut p, 4, f.throttle);
        putf(&mut p, 8, f.brake);
        putf(&mut p, 12, f.fuel_l.unwrap_or(40.0));
        puti(&mut p, 16, f.gear as i32 + 1);
        puti(&mut p, 20, f.rpm as i32);
        putf(&mut p, 28, f.speed_kmh);
        for i in 0..4 {
            putf(&mut p, 88 + i * 4, 27.0);
            putf(&mut p, 152 + i * 4, f.tyre_temp_c.map_or(85.0, |t| t[i]));
        }
        puti(&mut p, phys::CURRENT_MAX_RPM, 9800);
        p
    }

    pub fn graphics(f: &TelemetryFrame, packet: i32) -> Vec<u8> {
        let mut g = vec![0u8; gfx::SIZE];
        puti(&mut g, gfx::PACKET_ID, packet);
        puti(&mut g, gfx::STATUS, 2);
        putu64(&mut g, gfx::PLAYER_CAR_ID, 0xAAAA);
        putu64(&mut g, gfx::PLAYER_CAR_ID + 8, 0xBBBB);
        putf(&mut g, gfx::STEERING_PERCENT, f.steering.unwrap_or(0.0));
        puti(&mut g, gfx::CURRENT_LAP_TIME_MS, (f.lap_time_s.unwrap_or(0.0) * 1000.0) as i32);
        putf(&mut g, gfx::NPOS, f.lap_dist_pct.unwrap_or(0.0));
        puti(&mut g, gfx::TOTAL_LAP_COUNT, f.lap.unwrap_or(0) as i32);
        puti(&mut g, gfx::LAST_LAP_MS, (f.last_lap_s.unwrap_or(0.0) * 1000.0) as i32);
        puti(&mut g, gfx::BEST_LAP_MS, (f.best_lap_s.unwrap_or(0.0) * 1000.0) as i32);
        putstr(&mut g, gfx::CAR_MODEL, "fake_evo_gt");
        g[gfx::ACTIVE_CARS] = 3;
        // the player is car #2 in the table: decoys before it must not be picked
        for (i, (a, b)) in [(1u64, 1u64), (2, 2), (0xAAAA, 0xBBBB)].into_iter().enumerate() {
            putu64(&mut g, gfx::CAR_IDS + i * 16, a);
            putu64(&mut g, gfx::CAR_IDS + i * 16 + 8, b);
        }
        let pos = f.pos_m.unwrap_or([0.0, 0.0]);
        for i in 0..2 {
            putf(&mut g, gfx::CAR_COORDINATES + i * 12, 9999.0);
            putf(&mut g, gfx::CAR_COORDINATES + i * 12 + 8, 9999.0);
        }
        putf(&mut g, gfx::CAR_COORDINATES + 2 * 12, pos[0]);
        putf(&mut g, gfx::CAR_COORDINATES + 2 * 12 + 4, 5.0);
        putf(&mut g, gfx::CAR_COORDINATES + 2 * 12 + 8, pos[1]);
        g
    }

    pub fn statics() -> Vec<u8> {
        let mut s = vec![0u8; stat::SIZE];
        putstr(&mut s, stat::TRACK, "fake_ring");
        putstr(&mut s, stat::TRACK_CONFIGURATION, "gp");
        putf(&mut s, stat::TRACK_LENGTH_M, 4000.0);
        s
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sources::sim::SyntheticCar;

    fn frame() -> TelemetryFrame {
        let mut car = SyntheticCar::default();
        let mut f = car.step(0.01);
        for _ in 0..800 {
            f = car.step(0.01);
        }
        f
    }

    #[test]
    fn merges_physics_graphics_and_picks_the_players_coordinates() {
        let f = frame();
        let out = parse(&fake::physics(&f, 1), &fake::graphics(&f, 1), 0.0).unwrap();
        assert_eq!(out.sim, SimId::AcEvo);
        assert!((out.speed_kmh - f.speed_kmh).abs() < 0.01);
        assert_eq!(out.gear, f.gear);
        assert!((out.lap_dist_pct.unwrap() - f.lap_dist_pct.unwrap()).abs() < 1e-5);
        assert_eq!(out.lap, f.lap);
        assert!((out.lap_time_s.unwrap() - f.lap_time_s.unwrap()).abs() < 1e-3);
        assert_eq!(out.max_rpm, Some(9800.0));
        assert_eq!(out.pos_m, f.pos_m, "player is table entry #2, not the decoys");
    }

    #[test]
    fn not_live_means_no_frame_and_garbage_is_rejected() {
        let f = frame();
        let mut g = fake::graphics(&f, 1);
        g[gfx::STATUS..gfx::STATUS + 4].copy_from_slice(&3i32.to_le_bytes()); // paused
        assert!(parse(&fake::physics(&f, 1), &g, 0.0).is_none());
        let mut g = fake::graphics(&f, 1);
        g[gfx::NPOS..gfx::NPOS + 4].copy_from_slice(&7.5f32.to_le_bytes());
        assert_eq!(parse(&fake::physics(&f, 1), &g, 0.0).unwrap().lap_dist_pct, None);
        assert!(parse(&fake::physics(&f, 1), &g[..100], 0.0).is_none());
    }

    #[test]
    fn static_page_gives_track_and_length_and_source_adds_car() {
        let info = parse_static(&fake::statics()).unwrap();
        assert_eq!(info.track.as_deref(), Some("fake_ring (gp)"));
        assert_eq!(info.track_length_m, Some(4000.0));
        let f = frame();
        let (p, g, s) = (fake::physics(&f, 5), fake::graphics(&f, 5), fake::statics());
        let mut src = AcEvoSource::new(move || Some(p.clone()), move || Some(g.clone()), move || Some(s.clone()));
        let out = src.poll().unwrap();
        let sess = out.session.unwrap();
        assert_eq!(sess.car.as_deref(), Some("fake_evo_gt"));
        assert_eq!(sess.track.as_deref(), Some("fake_ring (gp)"));
        assert!(src.poll().is_none(), "same packet id");
    }
}
