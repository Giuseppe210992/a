//! F1 25 UDP telemetry (default port 20777, "UDP Format" must be set to 2025 in-game).
//!
//! Layouts follow the F1 25 UDP specification (packet sizes cross-checked: Motion 1349,
//! Lap Data 1285, Car Telemetry 1352, Car Status 1239 bytes). Packets used:
//! Motion (0, world position for the map), Session (1, track length), Lap Data (2, lap,
//! lap time, distance), Car Setups (5, setup list), Car Telemetry (6, the frame trigger),
//! Car Status (7, rev limit). Everything is for the player's own car.
//!
//! Tyre order in F1 packets is RL, RR, FL, FR; it is reordered to FL, FR, RL, RR.

use super::TelemetrySource;
use crate::clock::monotonic_s;
use crate::telemetry::{SessionInfo, SimId, TelemetryFrame, PSI_TO_KPA};
use std::net::UdpSocket;
use std::sync::Arc;

pub const DEFAULT_PORT: u16 = 20777;
const HEADER_LEN: usize = 29;
const CAR_LEN: usize = 60;
const NUM_CARS: usize = 22;
const PACKET_CAR_TELEMETRY: u8 = 6;
const PACKET_MOTION: u8 = 0;
const PACKET_SESSION: u8 = 1;
const PACKET_LAP_DATA: u8 = 2;
const PACKET_CAR_SETUPS: u8 = 5;
const PACKET_CAR_STATUS: u8 = 7;
const MOTION_LEN: usize = 1349;
const MOTION_CAR: usize = 60;
const LAP_LEN: usize = 1285;
const LAP_CAR: usize = 57;
const STATUS_LEN: usize = 1239;
const STATUS_CAR: usize = 55;
const SETUP_LEN: usize = 1133;
const SETUP_CAR: usize = 50;
pub const CAR_TELEMETRY_PACKET_LEN: usize = HEADER_LEN + NUM_CARS * CAR_LEN + 3;

fn u16_at(b: &[u8], o: usize) -> Option<u16> {
    Some(u16::from_le_bytes(b.get(o..o + 2)?.try_into().ok()?))
}
fn f32_at(b: &[u8], o: usize) -> Option<f32> {
    Some(f32::from_le_bytes(b.get(o..o + 4)?.try_into().ok()?))
}

/// Returns the player's frame if `packet` is an F1 25 car-telemetry packet.
pub fn parse_car_telemetry(packet: &[u8], t_s: f64) -> Option<TelemetryFrame> {
    if packet.len() < CAR_TELEMETRY_PACKET_LEN || u16_at(packet, 0)? != 2025 {
        return None;
    }
    if *packet.get(6)? != PACKET_CAR_TELEMETRY {
        return None;
    }
    let player = *packet.get(27)? as usize;
    if player >= NUM_CARS {
        return None;
    }
    let c = HEADER_LEN + player * CAR_LEN;
    let car = packet.get(c..c + CAR_LEN)?;
    // CarTelemetryData: speed u16 | throttle f32 | steer f32 | brake f32 | clutch u8 |
    // gear i8 | engineRPM u16 | drs u8 | revLightsPercent u8 | revLightsBitValue u16 |
    // brakesTemp[4] u16 | tyresSurfaceTemp[4] u8 | tyresInnerTemp[4] u8 | engineTemp u16 |
    // tyresPressure[4] f32 | surfaceType[4] u8
    let speed = u16_at(car, 0)? as f32;
    let throttle = f32_at(car, 2)?;
    let steer = f32_at(car, 6)?;
    let brake = f32_at(car, 10)?;
    let gear = *car.get(15)? as i8;
    let rpm = u16_at(car, 16)? as f32;
    let surf = |i: usize| *car.get(30 + i).unwrap_or(&0) as f32;
    let psi = |i: usize| f32_at(car, 40 + i * 4).map(|v| v * PSI_TO_KPA);
    // [RL, RR, FL, FR] -> [FL, FR, RL, RR]
    let order = [2usize, 3, 0, 1];
    let temps = order.map(surf);
    let press = [psi(order[0])?, psi(order[1])?, psi(order[2])?, psi(order[3])?];
    if !(throttle.is_finite() && brake.is_finite() && steer.is_finite()) {
        return None;
    }
    Some(TelemetryFrame {
        sim: SimId::F1_25,
        t_s,
        speed_kmh: speed,
        rpm,
        gear,
        throttle: throttle.clamp(0.0, 1.0),
        brake: brake.clamp(0.0, 1.0),
        steering: Some(steer.clamp(-1.0, 1.0)),
        tyre_temp_c: Some(temps),
        tyre_pressure_kpa: Some(press),
        ..Default::default()
    })
}

#[derive(Default)]
struct PlayerState {
    pos: Option<[f32; 2]>,
    track_length_m: Option<f32>,
    lap: Option<u32>,
    cur_lap_ms: Option<u32>,
    last_lap_ms: Option<u32>,
    lap_dist_m: Option<f32>,
    in_pit: bool,
    max_rpm: Option<f32>,
    session: Option<Arc<SessionInfo>>,
}

/// Merges the packet types into one frame per Car Telemetry packet.
#[derive(Default)]
pub struct F1Decoder {
    st: PlayerState,
}

fn u32_at(b: &[u8], o: usize) -> Option<u32> {
    Some(u32::from_le_bytes(b.get(o..o + 4)?.try_into().ok()?))
}

fn player_slice<'a>(p: &'a [u8], total_len: usize, per_car: usize) -> Option<&'a [u8]> {
    if p.len() < total_len || u16_at(p, 0)? != 2025 {
        return None;
    }
    let idx = *p.get(27)? as usize;
    if idx >= NUM_CARS {
        return None;
    }
    let o = HEADER_LEN + idx * per_car;
    p.get(o..o + per_car)
}

impl F1Decoder {
    /// Feeds one datagram; returns a frame when it was a car-telemetry packet.
    pub fn feed(&mut self, p: &[u8], t_s: f64) -> Option<TelemetryFrame> {
        if p.len() < HEADER_LEN || u16_at(p, 0)? != 2025 {
            return None;
        }
        match *p.get(6)? {
            PACKET_MOTION => {
                if let Some(c) = player_slice(p, MOTION_LEN, MOTION_CAR) {
                    // world X and Z span the ground plane (Y is height)
                    let (x, z) = (f32_at(c, 0)?, f32_at(c, 8)?);
                    self.st.pos = (x.is_finite() && z.is_finite()).then_some([x, z]);
                }
                None
            }
            PACKET_SESSION => {
                let len = u16_at(p, 33)? as f32;
                self.st.track_length_m = (len > 100.0).then_some(len);
                None
            }
            PACKET_LAP_DATA => {
                if let Some(c) = player_slice(p, LAP_LEN, LAP_CAR) {
                    self.st.last_lap_ms = u32_at(c, 0).filter(|&v| v > 0);
                    self.st.cur_lap_ms = u32_at(c, 4);
                    self.st.lap_dist_m = f32_at(c, 20).filter(|d| d.is_finite() && *d >= 0.0);
                    self.st.lap = c.get(33).map(|&l| l as u32).filter(|&l| l > 0);
                    self.st.in_pit = c.get(34).is_some_and(|&v| v != 0);
                }
                None
            }
            PACKET_CAR_STATUS => {
                if let Some(c) = player_slice(p, STATUS_LEN, STATUS_CAR) {
                    self.st.max_rpm = u16_at(c, 17).filter(|&r| r > 1000).map(|r| r as f32);
                }
                None
            }
            PACKET_CAR_SETUPS => {
                if let Some(c) = player_slice(p, SETUP_LEN, SETUP_CAR) {
                    self.st.session = Some(Arc::new(setup_info(c)));
                }
                None
            }
            PACKET_CAR_TELEMETRY => {
                let mut f = parse_car_telemetry(p, t_s)?;
                f.pos_m = self.st.pos;
                f.lap = self.st.lap;
                f.lap_time_s = self.st.cur_lap_ms.map(|m| m as f32 / 1000.0);
                f.last_lap_s = self.st.last_lap_ms.map(|m| m as f32 / 1000.0);
                f.in_pit = self.st.in_pit;
                f.max_rpm = self.st.max_rpm;
                f.lap_dist_pct = match (self.st.lap_dist_m, self.st.track_length_m) {
                    (Some(d), Some(l)) => Some((d / l).clamp(0.0, 1.0)),
                    _ => None,
                };
                f.session = self.st.session.clone();
                Some(f)
            }
            _ => None,
        }
    }
}

fn setup_info(c: &[u8]) -> SessionInfo {
    let u = |o: usize| c.get(o).copied().unwrap_or(0).to_string();
    let fl = |o: usize| f32_at(c, o).map_or("--".to_string(), |v| format!("{v:.2}"));
    let psi = |o: usize| f32_at(c, o).map_or("--".to_string(), |v| format!("{v:.1} psi"));
    let rows: [(&str, String); 21] = [
        ("Ala anteriore", u(0)),
        ("Ala posteriore", u(1)),
        ("Differenziale in accelerazione (%)", u(2)),
        ("Differenziale in rilascio (%)", u(3)),
        ("Campanatura anteriore", fl(4)),
        ("Campanatura posteriore", fl(8)),
        ("Convergenza anteriore", fl(12)),
        ("Convergenza posteriore", fl(16)),
        ("Sospensione anteriore", u(20)),
        ("Sospensione posteriore", u(21)),
        ("Barra antirollio anteriore", u(22)),
        ("Barra antirollio posteriore", u(23)),
        ("Altezza anteriore", u(24)),
        ("Altezza posteriore", u(25)),
        ("Pressione freni (%)", u(26)),
        ("Bilanciamento freni (%)", u(27)),
        ("Freno motore (%)", u(28)),
        ("Pressione gomma ant. sx", psi(37)),
        ("Pressione gomma ant. dx", psi(41)),
        ("Pressione gomma post. sx", psi(29)),
        ("Pressione gomma post. dx", psi(33)),
    ];
    SessionInfo {
        car: None,
        track: None,
        track_length_m: None,
        setup_note: None,
        setup: rows.into_iter().map(|(k, v)| (k.to_string(), v)).collect(),
    }
}

pub struct F1UdpSource {
    sock: UdpSocket,
    buf: Vec<u8>,
    dec: F1Decoder,
}

impl F1UdpSource {
    pub fn bind(port: u16) -> std::io::Result<Self> {
        let sock = UdpSocket::bind(("0.0.0.0", port))?;
        sock.set_nonblocking(true)?;
        Ok(Self { sock, buf: vec![0u8; 2048], dec: F1Decoder::default() })
    }
    pub fn local_port(&self) -> u16 {
        self.sock.local_addr().map(|a| a.port()).unwrap_or(0)
    }
}

impl TelemetrySource for F1UdpSource {
    fn name(&self) -> &'static str {
        "F1 25 (UDP)"
    }
    /// Drains all queued datagrams and returns the newest car-telemetry frame, so a slow
    /// poll never lets the backlog (and the latency) grow.
    fn poll(&mut self) -> Option<TelemetryFrame> {
        let mut latest = None;
        while let Ok(n) = self.sock.recv(&mut self.buf) {
            if let Some(f) = self.dec.feed(&self.buf[..n], monotonic_s()) {
                latest = Some(f);
            }
        }
        latest
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub fn packet(player: u8, speed: u16, throttle: f32, brake: f32, gear: i8, rpm: u16) -> Vec<u8> {
        let mut p = vec![0u8; CAR_TELEMETRY_PACKET_LEN];
        p[0..2].copy_from_slice(&2025u16.to_le_bytes());
        p[6] = PACKET_CAR_TELEMETRY;
        p[27] = player;
        let c = HEADER_LEN + player as usize * CAR_LEN;
        p[c..c + 2].copy_from_slice(&speed.to_le_bytes());
        p[c + 2..c + 6].copy_from_slice(&throttle.to_le_bytes());
        p[c + 6..c + 10].copy_from_slice(&0.25f32.to_le_bytes());
        p[c + 10..c + 14].copy_from_slice(&brake.to_le_bytes());
        p[c + 15] = gear as u8;
        p[c + 16..c + 18].copy_from_slice(&rpm.to_le_bytes());
        // surface temps RL, RR, FL, FR
        for (i, t) in [90u8, 91, 80, 81].iter().enumerate() {
            p[c + 30 + i] = *t;
        }
        // pressures RL, RR, FL, FR (psi)
        for (i, v) in [22.0f32, 22.1, 23.0, 23.1].iter().enumerate() {
            p[c + 40 + i * 4..c + 44 + i * 4].copy_from_slice(&v.to_le_bytes());
        }
        p
    }

    #[test]
    fn packet_size_matches_published_f1_25_size() {
        assert_eq!(CAR_TELEMETRY_PACKET_LEN, 1352);
    }

    #[test]
    fn parses_player_car_and_reorders_tyres() {
        let f = parse_car_telemetry(&packet(5, 250, 1.0, 0.0, 7, 11_500), 0.0).unwrap();
        assert_eq!((f.speed_kmh, f.gear, f.rpm), (250.0, 7, 11_500.0));
        assert_eq!(f.tyre_temp_c.unwrap(), [80.0, 81.0, 90.0, 91.0]);
        assert!((f.tyre_pressure_kpa.unwrap()[0] - 23.0 * PSI_TO_KPA).abs() < 1e-3);
        assert_eq!(f.steering, Some(0.25));
    }

    fn header(id: u8, player: u8, len: usize) -> Vec<u8> {
        let mut p = vec![0u8; len];
        p[0..2].copy_from_slice(&2025u16.to_le_bytes());
        p[6] = id;
        p[27] = player;
        p
    }

    #[test]
    fn merges_motion_lap_session_status_setup_into_the_telemetry_frame() {
        let mut d = F1Decoder::default();
        let pl = 4u8;
        let mut m = header(PACKET_MOTION, pl, MOTION_LEN);
        let c = HEADER_LEN + pl as usize * MOTION_CAR;
        m[c..c + 4].copy_from_slice(&120.5f32.to_le_bytes());
        m[c + 8..c + 12].copy_from_slice(&(-40.0f32).to_le_bytes());
        assert!(d.feed(&m, 0.0).is_none());

        let mut s = header(PACKET_SESSION, pl, 753);
        s[33..35].copy_from_slice(&5000u16.to_le_bytes());
        assert!(d.feed(&s, 0.0).is_none());

        let mut l = header(PACKET_LAP_DATA, pl, LAP_LEN);
        let c = HEADER_LEN + pl as usize * LAP_CAR;
        l[c..c + 4].copy_from_slice(&91_234u32.to_le_bytes()); // last lap
        l[c + 4..c + 8].copy_from_slice(&30_500u32.to_le_bytes()); // current
        l[c + 20..c + 24].copy_from_slice(&1250.0f32.to_le_bytes()); // distance
        l[c + 33] = 3; // lap number
        assert!(d.feed(&l, 0.0).is_none());

        let mut st = header(PACKET_CAR_STATUS, pl, STATUS_LEN);
        let c = HEADER_LEN + pl as usize * STATUS_CAR;
        st[c + 17..c + 19].copy_from_slice(&13_000u16.to_le_bytes());
        assert!(d.feed(&st, 0.0).is_none());

        let mut su = header(PACKET_CAR_SETUPS, pl, SETUP_LEN);
        let c = HEADER_LEN + pl as usize * SETUP_CAR;
        su[c] = 7; // front wing
        su[c + 27] = 56; // brake bias
        su[c + 37..c + 41].copy_from_slice(&22.5f32.to_le_bytes()); // FL pressure
        assert!(d.feed(&su, 0.0).is_none());

        let f = d.feed(&packet(pl, 280, 1.0, 0.0, 6, 11_000), 1.0).unwrap();
        assert_eq!(f.pos_m, Some([120.5, -40.0]));
        assert_eq!(f.lap, Some(3));
        assert!((f.lap_time_s.unwrap() - 30.5).abs() < 1e-4);
        assert!((f.last_lap_s.unwrap() - 91.234).abs() < 1e-4);
        assert!((f.lap_dist_pct.unwrap() - 0.25).abs() < 1e-5);
        assert_eq!(f.max_rpm, Some(13_000.0));
        let setup = &f.session.unwrap().setup;
        assert!(setup.contains(&("Ala anteriore".into(), "7".into())));
        assert!(setup.contains(&("Bilanciamento freni (%)".into(), "56".into())));
        assert!(setup.contains(&("Pressione gomma ant. sx".into(), "22.5 psi".into())));
    }

    #[test]
    fn lap_distance_before_the_line_gives_no_position_and_wrong_players_are_ignored() {
        let mut d = F1Decoder::default();
        let mut l = header(PACKET_LAP_DATA, 0, LAP_LEN);
        l[20..24].copy_from_slice(&(-5.0f32).to_le_bytes()); // car 0 entry... but player is car 0 at offset HEADER
        let c = HEADER_LEN;
        l[c + 20..c + 24].copy_from_slice(&(-5.0f32).to_le_bytes());
        d.feed(&l, 0.0);
        let f = d.feed(&packet(0, 100, 0.5, 0.0, 3, 6000), 1.0).unwrap();
        assert_eq!(f.lap_dist_pct, None);
        // truncated packets of a known type must not panic
        assert!(d.feed(&header(PACKET_LAP_DATA, 0, 200), 2.0).is_none());
        assert!(d.feed(&header(PACKET_MOTION, 21, MOTION_LEN)[..1349 - 5], 2.0).is_none());
    }

    #[test]
    fn ignores_other_formats_and_packets() {
        let mut p = packet(0, 1, 0.0, 0.0, 1, 1000);
        p[0..2].copy_from_slice(&2024u16.to_le_bytes());
        assert!(parse_car_telemetry(&p, 0.0).is_none());
        let mut p = packet(0, 1, 0.0, 0.0, 1, 1000);
        p[6] = 2;
        assert!(parse_car_telemetry(&p, 0.0).is_none());
        assert!(parse_car_telemetry(&p[..100], 0.0).is_none());
        let mut p = packet(0, 1, 0.0, 0.0, 1, 1000);
        p[27] = 30;
        assert!(parse_car_telemetry(&p, 0.0).is_none());
    }

    #[test]
    fn udp_loopback_returns_newest_frame() {
        let mut src = F1UdpSource::bind(0).unwrap();
        let tx = UdpSocket::bind("127.0.0.1:0").unwrap();
        let dst = ("127.0.0.1", src.local_port());
        tx.send_to(&packet(0, 100, 0.5, 0.0, 3, 6000), dst).unwrap();
        tx.send_to(&packet(0, 200, 0.9, 0.0, 5, 9000), dst).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(50));
        assert_eq!(src.poll().unwrap().speed_kmh, 200.0);
        assert!(src.poll().is_none());
    }
}
