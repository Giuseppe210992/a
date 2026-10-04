//! Forza Motorsport "Data Out" (UDP, "Dash" packet). EXPERIMENTAL.
//!
//! Layout: the FM7 car-dash format (311 bytes) as published in community parsers, and the
//! Forza Motorsport (2023) packet of 331 bytes, which appends tyre wear and two 16-bit
//! values after the same first 311 bytes. All values little-endian.
//! Not verified against the game on a real machine; known uncertainties:
//! * gear byte: 0 is assumed to mean reverse (shown as R), 1.. forward gears;
//! * tyre temperature units are not confirmed, so tyre data is left empty;
//! * the format has no track length, so there is no track position: no corners, delta or
//!   brake calls. Dashboard, pedals, laps and the live map (from world position) work.
//! Configure in-game: Settings > Gameplay & HUD > Data Out: ON, IP 127.0.0.1, the port
//! chosen here (default 5300), format "Dash".

use super::TelemetrySource;
use crate::clock::monotonic_s;
use crate::telemetry::{SimId, TelemetryFrame};
use std::net::UdpSocket;

pub const DEFAULT_PORT: u16 = 5300;
const LEN_FM7: usize = 311;
const LEN_FM2023: usize = 331;

fn f32_at(b: &[u8], o: usize) -> Option<f32> {
    Some(f32::from_le_bytes(b.get(o..o + 4)?.try_into().ok()?))
}

pub fn parse(p: &[u8], t_s: f64) -> Option<TelemetryFrame> {
    if p.len() != LEN_FM7 && p.len() != LEN_FM2023 {
        return None;
    }
    if i32::from_le_bytes(p[0..4].try_into().ok()?) == 0 {
        return None; // not in a race (menu / paused)
    }
    let rpm = f32_at(p, 16)?;
    let max_rpm = f32_at(p, 8)?;
    let speed = f32_at(p, 244)? * 3.6;
    if !(rpm.is_finite() && (0.0..=30_000.0).contains(&rpm) && speed.is_finite() && (0.0..=700.0).contains(&speed)) {
        return None;
    }
    let (x, z) = (f32_at(p, 232)?, f32_at(p, 240)?);
    let pos = (x.is_finite() && z.is_finite()).then_some([x, z]);
    let secs = |o: usize| f32_at(p, o).filter(|v| v.is_finite() && *v > 0.0);
    let gear = match p[307] {
        0 => -1,
        g => g as i8,
    };
    Some(TelemetryFrame {
        sim: SimId::Forza,
        t_s,
        speed_kmh: speed,
        rpm,
        gear,
        throttle: p[303] as f32 / 255.0,
        brake: p[304] as f32 / 255.0,
        steering: Some((p[308] as i8 as f32 / 127.0).clamp(-1.0, 1.0)),
        lap: Some(u16::from_le_bytes([p[300], p[301]]) as u32),
        lap_time_s: secs(292),
        last_lap_s: secs(288),
        best_lap_s: secs(284),
        pos_m: pos,
        max_rpm: (max_rpm > 1000.0).then_some(max_rpm),
        ..Default::default()
    })
}

pub struct ForzaUdpSource {
    sock: UdpSocket,
    buf: Vec<u8>,
}

impl ForzaUdpSource {
    pub fn bind(port: u16) -> std::io::Result<Self> {
        let sock = UdpSocket::bind(("0.0.0.0", port))?;
        sock.set_nonblocking(true)?;
        Ok(Self { sock, buf: vec![0u8; 2048] })
    }
    pub fn local_port(&self) -> u16 {
        self.sock.local_addr().map(|a| a.port()).unwrap_or(0)
    }
}

impl TelemetrySource for ForzaUdpSource {
    fn name(&self) -> &'static str {
        "Forza (UDP, sperimentale)"
    }
    fn poll(&mut self) -> Option<TelemetryFrame> {
        let mut latest = None;
        while let Ok(n) = self.sock.recv(&mut self.buf) {
            if let Some(f) = parse(&self.buf[..n], monotonic_s()) {
                latest = Some(f);
            }
        }
        latest
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn packet(len: usize) -> Vec<u8> {
        let mut p = vec![0u8; len];
        p[0..4].copy_from_slice(&1i32.to_le_bytes());
        p[8..12].copy_from_slice(&8500.0f32.to_le_bytes());
        p[16..20].copy_from_slice(&6200.0f32.to_le_bytes());
        p[232..236].copy_from_slice(&100.0f32.to_le_bytes());
        p[240..244].copy_from_slice(&(-50.0f32).to_le_bytes());
        p[244..248].copy_from_slice(&50.0f32.to_le_bytes()); // m/s
        p[284..288].copy_from_slice(&88.5f32.to_le_bytes());
        p[288..292].copy_from_slice(&90.25f32.to_le_bytes());
        p[292..296].copy_from_slice(&12.0f32.to_le_bytes());
        p[300..302].copy_from_slice(&2u16.to_le_bytes());
        p[303] = 255;
        p[304] = 0;
        p[307] = 4;
        p[308] = (-64i8) as u8;
        p
    }

    #[test]
    fn parses_fm7_and_fm2023_sizes() {
        for len in [LEN_FM7, LEN_FM2023] {
            let f = parse(&packet(len), 0.0).unwrap();
            assert!((f.speed_kmh - 180.0).abs() < 1e-3);
            assert_eq!((f.rpm, f.gear, f.lap), (6200.0, 4, Some(2)));
            assert_eq!(f.throttle, 1.0);
            assert!((f.steering.unwrap() + 64.0 / 127.0).abs() < 1e-5);
            assert_eq!(f.pos_m, Some([100.0, -50.0]));
            assert_eq!(f.max_rpm, Some(8500.0));
            assert_eq!(f.best_lap_s, Some(88.5));
            assert!(f.tyre_temp_c.is_none() && f.lap_dist_pct.is_none());
        }
    }

    #[test]
    fn rejects_menu_wrong_size_and_garbage() {
        let mut p = packet(LEN_FM7);
        p[0..4].copy_from_slice(&0i32.to_le_bytes());
        assert!(parse(&p, 0.0).is_none());
        assert!(parse(&vec![1u8; 300], 0.0).is_none());
        let mut p = packet(LEN_FM7);
        p[244..248].copy_from_slice(&f32::NAN.to_le_bytes());
        assert!(parse(&p, 0.0).is_none());
    }

    #[test]
    fn udp_loopback() {
        let mut src = ForzaUdpSource::bind(0).unwrap();
        let tx = UdpSocket::bind("127.0.0.1:0").unwrap();
        tx.send_to(&packet(LEN_FM2023), ("127.0.0.1", src.local_port())).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(50));
        assert!(src.poll().is_some());
    }
}
