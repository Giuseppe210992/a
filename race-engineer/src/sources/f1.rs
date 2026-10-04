//! F1 25 UDP telemetry (default port 20777, "UDP Format" must be set to 2025 in-game).
//!
//! Implemented: header + Car Telemetry packet (id 6). Layout used:
//! header 29 bytes (packetFormat u16, gameYear u8, gameMajor u8, gameMinor u8,
//! packetVersion u8, packetId u8, sessionUID u64, sessionTime f32, frameIdentifier u32,
//! overallFrameIdentifier u32, playerCarIndex u8, secondaryPlayerCarIndex u8);
//! 22 x CarTelemetryData of 60 bytes + 3 trailing bytes = 1352 bytes, which matches the
//! packet size published by third-party F1 25 parsers.
//!
//! NOT implemented (no verified spec available in this session): Lap Data, Session,
//! Car Status. Without Lap Data there is no track position, so brake-zone advice is
//! unavailable for F1 25 until those packets are added from the official EA spec.
//!
//! Tyre order in F1 packets is RL, RR, FL, FR; it is reordered to FL, FR, RL, RR.

use super::TelemetrySource;
use crate::clock::monotonic_s;
use crate::telemetry::{SimId, TelemetryFrame, PSI_TO_KPA};
use std::net::UdpSocket;

pub const DEFAULT_PORT: u16 = 20777;
const HEADER_LEN: usize = 29;
const CAR_LEN: usize = 60;
const NUM_CARS: usize = 22;
const PACKET_CAR_TELEMETRY: u8 = 6;
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

pub struct F1UdpSource {
    sock: UdpSocket,
    buf: Vec<u8>,
}

impl F1UdpSource {
    pub fn bind(port: u16) -> std::io::Result<Self> {
        let sock = UdpSocket::bind(("0.0.0.0", port))?;
        sock.set_nonblocking(true)?;
        Ok(Self { sock, buf: vec![0u8; 2048] })
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
            if let Some(f) = parse_car_telemetry(&self.buf[..n], monotonic_s()) {
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
