//! Fake simulators for exercising the real Windows code paths (named shared memory, UDP)
//! without the games installed:
//!   re-fakesim --sim iracing|acc|f1|forza [--seconds N] [--speedup X]
//! iRacing/ACC publish the same shared-memory layouts the readers parse; f1/forza send UDP to
//! 127.0.0.1 (port 20777 / 5300). Shared memory only exists on Windows (also under Wine).

#[cfg(not(windows))]
fn main() {
    // The UDP simulators work anywhere; shared memory needs Windows.
    fakes::run_udp_or_exit();
}

#[cfg(windows)]
fn main() {
    fakes::run();
}

mod fakes {
    use race_engineer::sources::sim::SyntheticCar;
    use race_engineer::telemetry::TelemetryFrame;
    use std::net::UdpSocket;
    use std::time::{Duration, Instant};

    pub fn arg(name: &str) -> Option<String> {
        let a: Vec<String> = std::env::args().collect();
        a.iter().position(|x| x == name).and_then(|i| a.get(i + 1).cloned())
    }

    /// Steps the synthetic car in real time, `speedup` times faster, at ~60 Hz.
    pub fn drive(mut emit: impl FnMut(&TelemetryFrame, u32)) {
        let secs: f64 = arg("--seconds").and_then(|s| s.parse().ok()).unwrap_or(60.0);
        let speedup: f64 = arg("--speedup").and_then(|s| s.parse().ok()).unwrap_or(10.0);
        let mut car = SyntheticCar::default();
        let start = Instant::now();
        let mut n = 0u32;
        while start.elapsed().as_secs_f64() < secs {
            let mut f = None;
            for _ in 0..((speedup * 16.0 / 10.0).ceil() as usize).max(1) {
                f = Some(car.step(0.01));
            }
            n += 1;
            emit(f.as_ref().unwrap(), n);
            std::thread::sleep(Duration::from_millis(16));
        }
    }

    pub fn send_f1(udp: &UdpSocket, f: &TelemetryFrame, n: u32) {
        let to = ("127.0.0.1", 20777);
        let header = |id: u8, len: usize| {
            let mut p = vec![0u8; len];
            p[0..2].copy_from_slice(&2025u16.to_le_bytes());
            p[6] = id;
            p[27] = 0;
            p
        };
        // telemetry (player = car 0)
        let mut t = header(6, 1352);
        let c = 29;
        t[c..c + 2].copy_from_slice(&(f.speed_kmh as u16).to_le_bytes());
        t[c + 2..c + 6].copy_from_slice(&f.throttle.to_le_bytes());
        t[c + 10..c + 14].copy_from_slice(&f.brake.to_le_bytes());
        t[c + 15] = f.gear as u8;
        t[c + 16..c + 18].copy_from_slice(&(f.rpm as u16).to_le_bytes());
        for i in 0..4 {
            t[c + 30 + i] = f.tyre_temp_c.map_or(90.0, |t| t[i]) as u8;
            t[c + 40 + i * 4..c + 44 + i * 4].copy_from_slice(&23.0f32.to_le_bytes());
        }
        let _ = udp.send_to(&t, to);
        if n % 4 == 0 {
            let mut m = header(0, 1349);
            let pos = f.pos_m.unwrap_or([0.0, 0.0]);
            m[29..33].copy_from_slice(&pos[0].to_le_bytes());
            m[37..41].copy_from_slice(&pos[1].to_le_bytes());
            let _ = udp.send_to(&m, to);
            let mut l = header(2, 1285);
            let dist = f.lap_dist_pct.unwrap_or(0.0) * 4000.0;
            l[29..33].copy_from_slice(&((f.last_lap_s.unwrap_or(0.0) * 1000.0) as u32).to_le_bytes());
            l[33..37].copy_from_slice(&((f.lap_time_s.unwrap_or(0.0) * 1000.0) as u32).to_le_bytes());
            l[49..53].copy_from_slice(&dist.to_le_bytes());
            l[62] = f.lap.unwrap_or(0) as u8 + 1;
            let _ = udp.send_to(&l, to);
        }
        if n % 30 == 0 {
            let mut s = header(1, 753);
            s[33..35].copy_from_slice(&4000u16.to_le_bytes());
            let _ = udp.send_to(&s, to);
            let mut st = header(7, 1239);
            st[29 + 17..29 + 19].copy_from_slice(&12_000u16.to_le_bytes());
            let _ = udp.send_to(&st, to);
            let mut su = header(5, 1133);
            su[29] = 7;
            su[29 + 27] = 56;
            let _ = udp.send_to(&su, to);
        }
    }

    pub fn send_forza(udp: &UdpSocket, f: &TelemetryFrame) {
        let mut p = vec![0u8; 331];
        p[0..4].copy_from_slice(&1i32.to_le_bytes());
        p[8..12].copy_from_slice(&9000.0f32.to_le_bytes());
        p[16..20].copy_from_slice(&f.rpm.to_le_bytes());
        let pos = f.pos_m.unwrap_or([0.0, 0.0]);
        p[232..236].copy_from_slice(&pos[0].to_le_bytes());
        p[240..244].copy_from_slice(&pos[1].to_le_bytes());
        p[244..248].copy_from_slice(&(f.speed_kmh / 3.6).to_le_bytes());
        p[292..296].copy_from_slice(&f.lap_time_s.unwrap_or(0.0).to_le_bytes());
        p[300..302].copy_from_slice(&(f.lap.unwrap_or(0) as u16).to_le_bytes());
        p[303] = (f.throttle * 255.0) as u8;
        p[304] = (f.brake * 255.0) as u8;
        p[307] = f.gear.max(1) as u8;
        let _ = udp.send_to(&p, ("127.0.0.1", 5300));
    }

    pub fn run_udp_or_exit() {
        let sim = arg("--sim").unwrap_or_default();
        let udp = UdpSocket::bind("127.0.0.1:0").expect("udp");
        match sim.as_str() {
            "f1" => drive(|f, n| send_f1(&udp, f, n)),
            "forza" => drive(|f, _| send_forza(&udp, f)),
            _ => {
                eprintln!("--sim f1|forza (iracing/acc need Windows)");
                std::process::exit(2);
            }
        }
    }

    #[cfg(windows)]
    pub fn run() {
        let sim = arg("--sim").unwrap_or_default();
        match sim.as_str() {
            "iracing" => win::iracing(),
            "acc" => win::acc(),
            _ => run_udp_or_exit(),
        }
    }

    #[cfg(windows)]
    mod win {
        use super::*;
        use race_engineer::sources::acc::{gfx, phys, stat};
        use race_engineer::sources::irsdk::fake;
        use std::ptr;
        use windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE;
        use windows_sys::Win32::System::Memory::{CreateFileMappingW, MapViewOfFile, FILE_MAP_WRITE, PAGE_READWRITE};

        fn create(name: &str, size: usize) -> *mut u8 {
            let w: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
            unsafe {
                let h = CreateFileMappingW(INVALID_HANDLE_VALUE, ptr::null(), PAGE_READWRITE, 0, size as u32, w.as_ptr());
                assert!(!h.is_null(), "CreateFileMappingW failed for {name}");
                let v = MapViewOfFile(h, FILE_MAP_WRITE, 0, 0, 0);
                assert!(!v.Value.is_null(), "MapViewOfFile failed");
                v.Value as *mut u8
            }
        }

        fn write(dst: *mut u8, src: &[u8]) {
            unsafe { ptr::copy_nonoverlapping(src.as_ptr(), dst, src.len()) };
        }

        const YAML: &str = "---\nWeekendInfo:\n TrackDisplayName: Fake Ring\n TrackLength: 4.00 km\n\nDriverInfo:\n DriverCarIdx: 0\n DriverCarRedLine: 10300.000\n Drivers:\n - CarIdx: 0\n   CarScreenName: Fake GT3\n\nCarSetup:\n UpdateCount: 1\n TiresAero:\n  LeftFrontTire:\n   StartingPressure: 20.5 psi\n  AeroSettings:\n   RearWingAngle: 7 deg\n Chassis:\n  Front:\n   ArbSetting: 3\n\nSessionInfo:\n Sessions:\n";

        pub fn iracing() {
            let vars: [(&str, i32, &str); 22] = [
                ("Speed", 4, "m/s"), ("RPM", 4, "revs/min"), ("Gear", 2, ""), ("Throttle", 4, "%"), ("Brake", 4, "%"),
                ("SteeringWheelAngle", 4, "rad"), ("SteeringWheelAngleMax", 4, "rad"), ("LapDistPct", 4, "%"), ("Lap", 2, ""),
                ("LapCurrentLapTime", 4, "s"), ("LapLastLapTime", 4, "s"), ("LapBestLapTime", 4, "s"), ("OnPitRoad", 1, ""),
                ("FuelLevel", 4, "l"), ("LFtempCM", 4, "C"), ("RFtempCM", 4, "C"), ("LRtempCM", 4, "C"), ("RRtempCM", 4, "C"),
                ("LFpressure", 4, "kPa"), ("Lat", 5, "deg"), ("Lon", 5, "deg"), ("RFpressure", 4, "kPa"),
            ];
            // pressures for the rear wheels are appended so all four exist
            let mut vars_v = vars.to_vec();
            vars_v.push(("LRpressure", 4, "kPa"));
            vars_v.push(("RRpressure", 4, "kPa"));
            let idx = |n: &str| vars_v.iter().position(|v| v.0 == n).unwrap();
            let buf_len = vars_v.len() * 8;
            let mut fk = fake::build(&vars_v, buf_len, [1, 2], YAML);
            let base = create(race_engineer::sources::irsdk::MAP_NAME, 1164 * 1024);
            write(base, &fk.mem);
            let mut tick = 2i32;
            let mut buf = 0usize;
            drive(|f, _| {
                tick += 1;
                buf ^= 1;
                fk.set_f32(buf, idx("Speed"), f.speed_kmh / 3.6);
                fk.set_f32(buf, idx("RPM"), f.rpm);
                fk.set_i32(buf, idx("Gear"), f.gear as i32);
                fk.set_f32(buf, idx("Throttle"), f.throttle);
                fk.set_f32(buf, idx("Brake"), f.brake);
                fk.set_f32(buf, idx("SteeringWheelAngle"), 0.0);
                fk.set_f32(buf, idx("SteeringWheelAngleMax"), 7.0);
                fk.set_f32(buf, idx("LapDistPct"), f.lap_dist_pct.unwrap_or(0.0));
                fk.set_i32(buf, idx("Lap"), f.lap.unwrap_or(0) as i32);
                fk.set_f32(buf, idx("LapCurrentLapTime"), f.lap_time_s.unwrap_or(0.0));
                fk.set_f32(buf, idx("LapLastLapTime"), f.last_lap_s.unwrap_or(-1.0));
                fk.set_f32(buf, idx("LapBestLapTime"), f.best_lap_s.unwrap_or(-1.0));
                fk.set_f32(buf, idx("FuelLevel"), f.fuel_l.unwrap_or(0.0));
                for (i, n) in ["LFtempCM", "RFtempCM", "LRtempCM", "RRtempCM"].iter().enumerate() {
                    fk.set_f32(buf, idx(n), f.tyre_temp_c.map_or(90.0, |t| t[i]));
                }
                for n in ["LFpressure", "RFpressure", "LRpressure", "RRpressure"] {
                    fk.set_f32(buf, idx(n), 165.0);
                }
                let pos = f.pos_m.unwrap_or([0.0, 0.0]);
                let lat0 = 50.4372f64;
                fk.set_f64(buf, idx("Lat"), lat0 + pos[1] as f64 / 111_320.0);
                fk.set_f64(buf, idx("Lon"), 5.9714 + pos[0] as f64 / (111_320.0 * lat0.to_radians().cos()));
                fk.publish(buf, tick);
                // only the touched buffer + header ticks need copying; copy all for simplicity
                write(base, &fk.mem);
            });
        }

        pub fn acc() {
            let phys_p = create("Local\\acpmf_physics", 800);
            let gfx_p = create("Local\\acpmf_graphics", 1600);
            let stat_p = create("Local\\acpmf_static", 800);
            let mut st = vec![0u8; 800];
            let put16 = |b: &mut [u8], o: usize, s: &str| {
                for (i, u) in s.encode_utf16().enumerate() {
                    b[o + i * 2..o + i * 2 + 2].copy_from_slice(&u.to_le_bytes());
                }
            };
            put16(&mut st, stat::CAR_MODEL, "fake_gt3");
            put16(&mut st, stat::TRACK, "fake_ring");
            st[stat::MAX_RPM..stat::MAX_RPM + 4].copy_from_slice(&9500i32.to_le_bytes());
            write(stat_p, &st);
            drive(|f, n| {
                let mut p = vec![0u8; 800];
                let putf = |b: &mut [u8], o: usize, v: f32| b[o..o + 4].copy_from_slice(&v.to_le_bytes());
                let puti = |b: &mut [u8], o: usize, v: i32| b[o..o + 4].copy_from_slice(&v.to_le_bytes());
                puti(&mut p, phys::PACKET_ID, n as i32);
                putf(&mut p, phys::GAS, f.throttle);
                putf(&mut p, phys::BRAKE, f.brake);
                putf(&mut p, phys::FUEL, f.fuel_l.unwrap_or(50.0));
                puti(&mut p, phys::GEAR, f.gear as i32 + 1);
                puti(&mut p, phys::RPMS, f.rpm as i32);
                putf(&mut p, phys::SPEED_KMH, f.speed_kmh);
                for i in 0..4 {
                    putf(&mut p, phys::WHEELS_PRESSURE + i * 4, 27.5);
                    putf(&mut p, phys::TYRE_CORE_TEMP + i * 4, f.tyre_temp_c.map_or(85.0, |t| t[i]));
                }
                let mut g = vec![0u8; 1600];
                puti(&mut g, gfx::STATUS, 2);
                puti(&mut g, gfx::COMPLETED_LAPS, f.lap.unwrap_or(0) as i32);
                puti(&mut g, gfx::I_CURRENT_TIME, (f.lap_time_s.unwrap_or(0.0) * 1000.0) as i32);
                puti(&mut g, gfx::I_LAST_TIME, (f.last_lap_s.unwrap_or(0.0) * 1000.0) as i32);
                puti(&mut g, gfx::I_BEST_TIME, (f.best_lap_s.unwrap_or(0.0) * 1000.0) as i32);
                putf(&mut g, gfx::NORM_CAR_POS, f.lap_dist_pct.unwrap_or(0.0));
                let pos = f.pos_m.unwrap_or([0.0, 0.0]);
                putf(&mut g, gfx::CAR_COORDS, pos[0]);
                putf(&mut g, gfx::CAR_COORDS + 8, pos[1]);
                write(gfx_p, &g);
                write(phys_p, &p);
            });
        }
    }
}
