//! iRacing telemetry from the `Local\IRSDKMemMapFileName` memory-mapped file.
//!
//! Layout (public iRacing SDK, `irsdk_defines.h`):
//! * header, 112 bytes: ver, status, tickRate, sessionInfoUpdate, sessionInfoLen,
//!   sessionInfoOffset, numVars, varHeaderOffset, numBuf, bufLen, pad[2],
//!   varBuf[4] = { tickCount, bufOffset, pad[2] };
//! * `numVars` variable headers of 144 bytes: type, offset, count, countAsTime(+pad),
//!   name[32], desc[64], unit[32].
//!
//! Variables are looked up **by name** at runtime, so no field offset is hard-coded;
//! a variable the running car/build does not publish simply yields `None`.
//! Sample rate is `tickRate` (60 Hz default, 360 Hz when enabled in app.ini).

use super::TelemetrySource;
use crate::clock::monotonic_s;
use crate::telemetry::{SessionInfo, SimId, TelemetryFrame, PSI_TO_KPA};
use std::collections::HashMap;
use std::sync::Arc;

pub const MAP_NAME: &str = "Local\\IRSDKMemMapFileName";
const HEADER_LEN: usize = 112;
const VAR_HEADER_LEN: usize = 144;
const ST_CONNECTED: i32 = 1;
const MS_TO_KMH: f32 = 3.6;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum VarType {
    Char,
    Bool,
    Int,
    Bitfield,
    Float,
    Double,
}

impl VarType {
    fn from_i32(v: i32) -> Option<Self> {
        Some(match v {
            0 => Self::Char,
            1 => Self::Bool,
            2 => Self::Int,
            3 => Self::Bitfield,
            4 => Self::Float,
            5 => Self::Double,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone)]
struct VarHeader {
    ty: VarType,
    offset: usize,
    unit: String,
}

fn i32_at(b: &[u8], o: usize) -> Option<i32> {
    Some(i32::from_le_bytes(b.get(o..o + 4)?.try_into().ok()?))
}

fn cstr(b: &[u8]) -> String {
    let end = b.iter().position(|&c| c == 0).unwrap_or(b.len());
    String::from_utf8_lossy(&b[..end]).into_owned()
}

#[derive(Debug)]
pub struct IrsdkLayout {
    pub tick_rate: i32,
    num_buf: usize,
    buf_len: usize,
    vars: HashMap<String, VarHeader>,
    session_update_off: usize,
    session_len: usize,
    session_off: usize,
    /// First valid (lat, lon) seen: origin of the local metric frame used for the map.
    origin: std::cell::Cell<Option<(f64, f64)>>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum IrsdkError {
    TooShort,
    NotConnected,
    BadHeader,
}

impl IrsdkLayout {
    /// Parses header + variable table. Call again if iRacing restarts (new session).
    pub fn parse(mem: &[u8]) -> Result<Self, IrsdkError> {
        if mem.len() < HEADER_LEN {
            return Err(IrsdkError::TooShort);
        }
        let status = i32_at(mem, 4).ok_or(IrsdkError::TooShort)?;
        if status & ST_CONNECTED == 0 {
            return Err(IrsdkError::NotConnected);
        }
        let tick_rate = i32_at(mem, 8).ok_or(IrsdkError::BadHeader)?;
        let num_vars = i32_at(mem, 24).ok_or(IrsdkError::BadHeader)?;
        let var_off = i32_at(mem, 28).ok_or(IrsdkError::BadHeader)?;
        let session_len = i32_at(mem, 16).ok_or(IrsdkError::BadHeader)?;
        let session_off = i32_at(mem, 20).ok_or(IrsdkError::BadHeader)?;
        let num_buf = i32_at(mem, 32).ok_or(IrsdkError::BadHeader)?;
        let buf_len = i32_at(mem, 36).ok_or(IrsdkError::BadHeader)?;
        if num_vars < 0 || var_off < 0 || !(1..=4).contains(&num_buf) || buf_len <= 0 {
            return Err(IrsdkError::BadHeader);
        }
        let (num_vars, var_off) = (num_vars as usize, var_off as usize);
        let end = var_off
            .checked_add(num_vars * VAR_HEADER_LEN)
            .ok_or(IrsdkError::BadHeader)?;
        if end > mem.len() {
            return Err(IrsdkError::TooShort);
        }
        let mut vars = HashMap::with_capacity(num_vars);
        for i in 0..num_vars {
            let o = var_off + i * VAR_HEADER_LEN;
            let ty = VarType::from_i32(i32_at(mem, o).ok_or(IrsdkError::BadHeader)?)
                .ok_or(IrsdkError::BadHeader)?;
            let offset = i32_at(mem, o + 4).ok_or(IrsdkError::BadHeader)?;
            if offset < 0 {
                return Err(IrsdkError::BadHeader);
            }
            let name = cstr(&mem[o + 16..o + 48]);
            let unit = cstr(&mem[o + 112..o + 144]);
            vars.insert(name, VarHeader { ty, offset: offset as usize, unit });
        }
        Ok(Self { tick_rate, num_buf: num_buf as usize, buf_len: buf_len as usize, vars,
            session_update_off: 12,
            session_len: session_len.max(0) as usize,
            session_off: session_off.max(0) as usize,
            origin: Default::default(),
        })
    }

    /// (index, tickCount, bufOffset) of the newest buffer that is not being written.
    /// Each var buffer is { tickCount (after write), bufOffset, tickCountBegin (before write) };
    /// older SDKs leave the last field 0.
    fn latest_buf(&self, mem: &[u8]) -> Option<(usize, i32, usize)> {
        (0..self.num_buf)
            .filter_map(|i| {
                let o = 48 + i * 16;
                let (tick, off, begin) = (i32_at(mem, o)?, i32_at(mem, o + 4)?, i32_at(mem, o + 8)?);
                (off >= 0 && (begin == 0 || begin == tick)).then_some((i, tick, off as usize))
            })
            .max_by_key(|&(_, tick, _)| tick)
    }

    /// Copies the newest consistent buffer into `scratch` and re-checks that the simulator
    /// did not start rewriting it meanwhile. Returns the tick count of the copied frame.
    pub fn copy_latest(&self, mem: &[u8], scratch: &mut Vec<u8>) -> Option<i32> {
        let (idx, tick, off) = self.latest_buf(mem)?;
        let slice = mem.get(off..off.checked_add(self.buf_len)?)?;
        scratch.clear();
        scratch.extend_from_slice(slice);
        let o = 48 + idx * 16;
        let (tick2, begin2) = (i32_at(mem, o)?, i32_at(mem, o + 8)?);
        (tick2 == tick && (begin2 == 0 || begin2 == tick)).then_some(tick)
    }

    pub fn session_update(&self, mem: &[u8]) -> i32 {
        i32_at(mem, self.session_update_off).unwrap_or(0)
    }

    /// Parses the YAML "session info" block into car/track/setup text.
    pub fn session_info(&self, mem: &[u8]) -> Option<SessionInfo> {
        let raw = mem.get(self.session_off..self.session_off.checked_add(self.session_len)?)?;
        Some(yaml::session_info(&decode_text(raw)))
    }

    fn f(&self, buf: &[u8], name: &str) -> Option<f32> {
        let v = self.vars.get(name)?;
        match v.ty {
            VarType::Float => Some(f32::from_le_bytes(buf.get(v.offset..v.offset + 4)?.try_into().ok()?)),
            VarType::Double => Some(f64::from_le_bytes(buf.get(v.offset..v.offset + 8)?.try_into().ok()?) as f32),
            VarType::Int | VarType::Bitfield => Some(i32_at(buf, v.offset)? as f32),
            VarType::Bool => Some(*buf.get(v.offset)? as f32),
            VarType::Char => None,
        }
    }

    /// Native f64 read (latitude/longitude need more than f32 precision).
    fn d(&self, buf: &[u8], name: &str) -> Option<f64> {
        let v = self.vars.get(name)?;
        match v.ty {
            VarType::Double => Some(f64::from_le_bytes(buf.get(v.offset..v.offset + 8)?.try_into().ok()?)),
            _ => self.f(buf, name).map(f64::from),
        }
    }

    fn position_m(&self, buf: &[u8]) -> Option<[f32; 2]> {
        let (lat, lon) = (self.d(buf, "Lat")?, self.d(buf, "Lon")?);
        if !(lat.abs() <= 90.0 && lon.abs() <= 180.0) || (lat == 0.0 && lon == 0.0) {
            return None;
        }
        let (lat0, lon0) = match self.origin.get() {
            Some(o) => o,
            None => {
                self.origin.set(Some((lat, lon)));
                (lat, lon)
            }
        };
        const M_PER_DEG: f64 = 111_320.0;
        Some([((lon - lon0) * M_PER_DEG * lat0.to_radians().cos()) as f32, ((lat - lat0) * M_PER_DEG) as f32])
    }

    fn i(&self, buf: &[u8], name: &str) -> Option<i32> {
        let v = self.vars.get(name)?;
        match v.ty {
            VarType::Int | VarType::Bitfield => i32_at(buf, v.offset),
            _ => self.f(buf, name).map(|x| x as i32),
        }
    }

    fn pressure_kpa(&self, buf: &[u8], name: &str) -> Option<f32> {
        let raw = self.f(buf, name)?;
        let unit = self.vars.get(name)?.unit.to_ascii_lowercase();
        Some(if unit == "psi" { raw * PSI_TO_KPA } else { raw })
    }

    /// Builds a normalised frame from a copied buffer. Time-valued variables not
    /// published by the current car are `None`.
    pub fn frame(&self, buf: &[u8], t_s: f64) -> TelemetryFrame {
        let tyre = |names: [&str; 4], get: &dyn Fn(&str) -> Option<f32>| -> Option<[f32; 4]> {
            Some([get(names[0])?, get(names[1])?, get(names[2])?, get(names[3])?])
        };
        let steer = self.f(buf, "SteeringWheelAngle").and_then(|a| {
            let max = self.f(buf, "SteeringWheelAngleMax")?;
            (max > 0.0).then(|| (-a / max).clamp(-1.0, 1.0)) // iRacing: positive = left
        });
        let lap_time = |n: &str| self.f(buf, n).filter(|&t| t > 0.0);
        TelemetryFrame {
            sim: SimId::IRacing,
            t_s,
            speed_kmh: self.f(buf, "Speed").unwrap_or(0.0) * MS_TO_KMH,
            rpm: self.f(buf, "RPM").unwrap_or(0.0),
            gear: self.i(buf, "Gear").unwrap_or(0) as i8,
            throttle: self.f(buf, "Throttle").unwrap_or(0.0).clamp(0.0, 1.0),
            brake: self.f(buf, "Brake").unwrap_or(0.0).clamp(0.0, 1.0),
            steering: steer,
            // Mid-tyre carcass temperature, °C
            tyre_temp_c: tyre(["LFtempCM", "RFtempCM", "LRtempCM", "RRtempCM"], &|n| self.f(buf, n)),
            tyre_pressure_kpa: tyre(["LFpressure", "RFpressure", "LRpressure", "RRpressure"], &|n| {
                self.pressure_kpa(buf, n)
            }),
            fuel_l: self.f(buf, "FuelLevel"),
            lap_dist_pct: self.f(buf, "LapDistPct").filter(|p| (0.0..=1.0).contains(p)),
            lap: self.i(buf, "Lap").filter(|&l| l >= 0).map(|l| l as u32),
            lap_time_s: lap_time("LapCurrentLapTime"),
            last_lap_s: lap_time("LapLastLapTime"),
            best_lap_s: lap_time("LapBestLapTime"),
            in_pit: self.i(buf, "OnPitRoad").unwrap_or(0) != 0,
            pos_m: self.position_m(buf),
            max_rpm: None,
            session: None,
        }
    }
}

/// iRacing writes the session YAML as UTF-8 on current builds and Windows-1252 on old ones.
fn decode_text(raw: &[u8]) -> String {
    let raw = &raw[..raw.iter().position(|&c| c == 0).unwrap_or(raw.len())];
    match std::str::from_utf8(raw) {
        Ok(s) => s.to_string(),
        Err(_) => raw.iter().map(|&b| b as char).collect(),
    }
}

/// Minimal reader for the flat-ish YAML iRacing publishes (no external parser needed).
pub mod yaml {
    use crate::telemetry::SessionInfo;

    /// Lines of the top-level section `key` (without the header line).
    pub fn section<'a>(text: &'a str, key: &str) -> Option<Vec<&'a str>> {
        let header = format!("{key}:");
        let mut lines = text.lines().map(|l| l.trim_end_matches('\r'));
        lines.by_ref().find(|l| *l == header)?;
        Some(lines.take_while(|l| !l.is_empty() && !l.starts_with(|c: char| !c.is_whitespace())).collect())
    }

    fn unquote(v: &str) -> String {
        v.trim().trim_matches(|c| c == '"' || c == '\'').to_string()
    }

    /// First `key: value` anywhere in the section lines.
    pub fn find(lines: &[&str], key: &str) -> Option<String> {
        let pat = format!("{key}:");
        lines.iter().find_map(|l| {
            let t = l.trim_start().trim_start_matches("- ");
            t.strip_prefix(&pat).map(unquote).filter(|v| !v.is_empty())
        })
    }

    /// Flattens nested keys to ("Group › Key", value), keeping the last two group levels.
    pub fn flatten(lines: &[&str]) -> Vec<(String, String)> {
        let mut stack: Vec<(usize, String)> = vec![];
        let mut out = vec![];
        for l in lines {
            let indent = l.len() - l.trim_start().len();
            let t = l.trim_start().trim_start_matches("- ");
            let Some((k, v)) = t.split_once(':') else { continue };
            while stack.last().is_some_and(|(i, _)| *i >= indent) {
                stack.pop();
            }
            let v = unquote(v);
            if v.is_empty() {
                stack.push((indent, k.trim().to_string()));
            } else if k.trim() != "UpdateCount" {
                let groups: Vec<&str> = stack.iter().rev().take(2).map(|(_, g)| g.as_str()).collect::<Vec<_>>().into_iter().rev().collect();
                let label = if groups.is_empty() { k.trim().to_string() } else { format!("{} › {}", groups.join(" › "), k.trim()) };
                out.push((label, v));
            }
        }
        out
    }

    fn leading_number(v: &str) -> Option<f32> {
        v.split_whitespace().next()?.parse().ok()
    }

    /// "4.05 km" / "2.52 mi" -> metres.
    pub fn length_m(v: &str) -> Option<f32> {
        let n = leading_number(v)?;
        let unit = v.split_whitespace().nth(1).unwrap_or("km").to_ascii_lowercase();
        Some(if unit.starts_with("mi") { n * 1609.344 } else if unit == "m" { n } else { n * 1000.0 })
    }

    pub fn session_info(text: &str) -> SessionInfo {
        let mut info = SessionInfo::default();
        if let Some(w) = section(text, "WeekendInfo") {
            info.track = find(&w, "TrackDisplayName");
            if let (Some(t), Some(c)) = (&info.track, find(&w, "TrackConfigName")) {
                info.track = Some(format!("{t} ({c})"));
            }
            info.track_length_m = find(&w, "TrackLength").and_then(|v| length_m(&v));
        }
        if let Some(d) = section(text, "DriverInfo") {
            if let Some(idx) = find(&d, "DriverCarIdx") {
                // CarScreenName of the driver entry whose CarIdx is ours
                let mut in_ours = false;
                for l in &d {
                    let t = l.trim_start().trim_start_matches("- ");
                    if let Some(v) = t.strip_prefix("CarIdx:") {
                        in_ours = unquote(v) == idx;
                    } else if in_ours {
                        if let Some(v) = t.strip_prefix("CarScreenName:") {
                            info.car = Some(unquote(v));
                            break;
                        }
                    }
                }
            }
        }
        match section(text, "CarSetup") {
            Some(s) => info.setup = flatten(&s),
            None => info.setup_note = Some("iRacing non ha pubblicato il setup (è disponibile dopo essere entrati in pista).".into()),
        }
        info
    }
}

/// Poll-style source over any byte view of the mapping (real mapping on Windows,
/// a synthetic buffer in tests).
pub struct IrsdkSource<M: FnMut() -> Option<Vec<u8>> + Send> {
    snapshot: M,
    layout: Option<IrsdkLayout>,
    last_tick: i32,
    scratch: Vec<u8>,
    session_update: i32,
    session: Option<Arc<SessionInfo>>,
    max_rpm: Option<f32>,
}

impl<M: FnMut() -> Option<Vec<u8>> + Send> IrsdkSource<M> {
    pub fn new(snapshot: M) -> Self {
        Self { snapshot, layout: None, last_tick: -1, scratch: Vec::new(), session_update: -1, session: None, max_rpm: None }
    }
}

impl<M: FnMut() -> Option<Vec<u8>> + Send> TelemetrySource for IrsdkSource<M> {
    fn name(&self) -> &'static str {
        "iRacing"
    }
    fn poll(&mut self) -> Option<TelemetryFrame> {
        let mem = (self.snapshot)()?;
        // iRacing closed / left the session: forget the layout so a new one is parsed.
        if i32_at(&mem, 4).is_none_or(|st| st & ST_CONNECTED == 0) {
            self.layout = None;
            self.last_tick = -1;
            return None;
        }
        if self.layout.is_none() {
            self.layout = IrsdkLayout::parse(&mem).ok();
            self.session_update = -1;
        }
        let layout = self.layout.as_ref()?;
        let upd = layout.session_update(&mem);
        if upd != self.session_update {
            if let Some(info) = layout.session_info(&mem) {
                self.session_update = upd;
                self.max_rpm = yaml::section(&decode_text_of(&mem, layout), "DriverInfo")
                    .and_then(|d| yaml::find(&d, "DriverCarRedLine"))
                    .and_then(|v| v.parse::<f32>().ok())
                    .filter(|&r| r > 500.0);
                self.session = Some(Arc::new(info));
            }
        }
        let tick = layout.copy_latest(&mem, &mut self.scratch)?;
        if tick == self.last_tick {
            return None;
        }
        self.last_tick = tick;
        let mut f = layout.frame(&self.scratch, monotonic_s());
        f.max_rpm = self.max_rpm;
        f.session = self.session.clone();
        Some(f)
    }
}

fn decode_text_of(mem: &[u8], layout: &IrsdkLayout) -> String {
    mem.get(layout.session_off..layout.session_off + layout.session_len).map(decode_text).unwrap_or_default()
}

#[cfg(windows)]
pub fn open_windows() -> IrsdkSource<impl FnMut() -> Option<Vec<u8>> + Send> {
    // NOTE: copies the whole mapping (~1 MB) per poll; fine at 60 Hz, to be
    // optimised with an in-place view if 360 Hz sampling is used.
    use super::winshm::Mapping;
    let mut map: Option<Mapping> = None;
    IrsdkSource::new(move || {
        if map.is_none() {
            map = Mapping::open(MAP_NAME);
        }
        map.as_ref().map(|m| m.to_vec())
    })
}

/// Builds a structurally faithful iRacing mapping. Used by unit tests and by the
/// `re-fakesim` tool that lets the Windows build be exercised without the simulator.
pub mod fake {
    use super::*;

    pub fn put_i32(b: &mut [u8], o: usize, v: i32) {
        b[o..o + 4].copy_from_slice(&v.to_le_bytes());
    }

    pub struct Fake {
        pub mem: Vec<u8>,
        pub offsets: Vec<usize>,
        pub data_start: usize,
        pub buf_len: usize,
    }

    /// `vars`: (name, type, unit); every variable gets an 8-byte slot in each buffer.
    pub fn build(vars: &[(&str, i32, &str)], buf_len: usize, ticks: [i32; 2], session_yaml: &str) -> Fake {
        let var_off = HEADER_LEN;
        let session_off = var_off + vars.len() * VAR_HEADER_LEN;
        let data_start = session_off + session_yaml.len() + 1;
        let mut m = vec![0u8; data_start + 2 * buf_len];
        put_i32(&mut m, 0, 2);
        put_i32(&mut m, 4, ST_CONNECTED);
        put_i32(&mut m, 8, 60);
        put_i32(&mut m, 12, 1);
        put_i32(&mut m, 16, session_yaml.len() as i32 + 1);
        put_i32(&mut m, 20, session_off as i32);
        put_i32(&mut m, 24, vars.len() as i32);
        put_i32(&mut m, 28, var_off as i32);
        put_i32(&mut m, 32, 2);
        put_i32(&mut m, 36, buf_len as i32);
        m[session_off..session_off + session_yaml.len()].copy_from_slice(session_yaml.as_bytes());
        for i in 0..2 {
            put_i32(&mut m, 48 + i * 16, ticks[i]);
            put_i32(&mut m, 48 + i * 16 + 4, (data_start + i * buf_len) as i32);
            put_i32(&mut m, 48 + i * 16 + 8, ticks[i]); // tickCountBegin == tickCount: consistent
        }
        let mut offsets = vec![];
        for (i, (name, ty, unit)) in vars.iter().enumerate() {
            let o = var_off + i * VAR_HEADER_LEN;
            let off = i * 8;
            offsets.push(off);
            put_i32(&mut m, o, *ty);
            put_i32(&mut m, o + 4, off as i32);
            put_i32(&mut m, o + 8, 1);
            m[o + 16..o + 16 + name.len()].copy_from_slice(name.as_bytes());
            m[o + 112..o + 112 + unit.len()].copy_from_slice(unit.as_bytes());
        }
        Fake { mem: m, offsets, data_start, buf_len }
    }

    impl Fake {
        pub fn set_f32(&mut self, buf: usize, var: usize, v: f32) {
            let o = self.data_start + buf * self.buf_len + self.offsets[var];
            self.mem[o..o + 4].copy_from_slice(&v.to_le_bytes());
        }
        pub fn set_f64(&mut self, buf: usize, var: usize, v: f64) {
            let o = self.data_start + buf * self.buf_len + self.offsets[var];
            self.mem[o..o + 8].copy_from_slice(&v.to_le_bytes());
        }
        pub fn set_i32(&mut self, buf: usize, var: usize, v: i32) {
            let o = self.data_start + buf * self.buf_len + self.offsets[var];
            put_i32(&mut self.mem, o, v);
        }
        /// Publishes `buf` as newest with tick `tick` (end tick written last, like the sim).
        pub fn publish(&mut self, buf: usize, tick: i32) {
            put_i32(&mut self.mem, 48 + buf * 16 + 8, tick);
            put_i32(&mut self.mem, 48 + buf * 16, tick);
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::fake::*;
    use super::*;

    const YAML: &str = "---\nWeekendInfo:\n TrackDisplayName: Spa-Francorchamps\n TrackConfigName: Grand Prix Pits\n TrackLength: 7.00 km\n\nDriverInfo:\n DriverCarIdx: 3\n DriverCarRedLine: 8500.000\n Drivers:\n - CarIdx: 0\n   CarScreenName: Other Car\n - CarIdx: 3\n   CarScreenName: \"Mazda MX-5 Cup\"\n\nCarSetup:\n UpdateCount: 4\n TiresAero:\n  LeftFrontTire:\n   StartingPressure: 20.0 psi\n   LastHotPressure: 27.5 psi\n  AeroSettings:\n   RearWingAngle: 7 deg\n Chassis:\n  Front:\n   ArbSetting: 3\n\nSessionInfo:\n Sessions:\n";

    #[test]
    fn yaml_session_info_track_car_setup() {
        let info = yaml::session_info(YAML);
        assert_eq!(info.track.as_deref(), Some("Spa-Francorchamps (Grand Prix Pits)"));
        assert_eq!(info.track_length_m, Some(7000.0));
        assert_eq!(info.car.as_deref(), Some("Mazda MX-5 Cup"));
        assert!(info.setup.contains(&("TiresAero › LeftFrontTire › StartingPressure".into(), "20.0 psi".into())), "{:?}", info.setup);
        assert!(info.setup.contains(&("TiresAero › AeroSettings › RearWingAngle".into(), "7 deg".into())));
        assert!(info.setup.contains(&("Chassis › Front › ArbSetting".into(), "3".into())));
        assert!(info.setup.iter().all(|(k, _)| !k.contains("UpdateCount")));
        assert!(info.setup_note.is_none());
    }

    #[test]
    fn yaml_without_setup_says_so_and_miles_convert() {
        let info = yaml::session_info("---\nWeekendInfo:\n TrackLength: 2.50 mi\n\nSessionInfo:\n");
        assert!(info.setup.is_empty() && info.setup_note.is_some());
        assert!((info.track_length_m.unwrap() - 4023.36).abs() < 0.1);
    }

    #[test]
    fn parses_named_variables_and_picks_newest_buffer() {
        let vars = [("Speed", 4, "m/s"), ("Gear", 2, ""), ("LFpressure", 4, "psi"), ("Brake", 4, "%")];
        let mut m = build(&vars, 64, [10, 11], "---\n");
        m.set_f32(1, 0, 50.0);
        m.set_i32(1, 1, 4);
        m.set_f32(1, 2, 30.0);
        m.set_f32(1, 3, 0.5);
        m.set_f32(0, 0, 1.0); // older buffer must be ignored
        let layout = IrsdkLayout::parse(&m.mem).unwrap();
        assert_eq!(layout.tick_rate, 60);
        let mut scratch = vec![];
        assert_eq!(layout.copy_latest(&m.mem, &mut scratch), Some(11));
        let f = layout.frame(&scratch, 1.0);
        assert!((f.speed_kmh - 180.0).abs() < 1e-3);
        assert_eq!(f.gear, 4);
        assert!((f.brake - 0.5).abs() < 1e-6);
        assert!(f.tyre_pressure_kpa.is_none(), "needs all four wheels, others missing");
        assert!(f.lap.is_none());
        assert!((layout.pressure_kpa(&scratch, "LFpressure").unwrap() - 30.0 * PSI_TO_KPA).abs() < 1e-3);
    }

    #[test]
    fn buffer_being_written_is_skipped() {
        let vars = [("Speed", 4, "m/s")];
        let mut m = build(&vars, 16, [5, 6], "---\n");
        // sim started rewriting buffer 1: begin tick advanced, end tick not yet
        put_i32(&mut m.mem, 48 + 16 + 8, 7);
        let layout = IrsdkLayout::parse(&m.mem).unwrap();
        let mut scratch = vec![];
        assert_eq!(layout.copy_latest(&m.mem, &mut scratch), Some(5), "falls back to the consistent buffer");
    }

    #[test]
    fn rejects_disconnected_and_truncated() {
        let mut m = build(&[("Speed", 4, "m/s")], 16, [1, 2], "---\n");
        assert_eq!(IrsdkLayout::parse(&m.mem[..50]).unwrap_err(), IrsdkError::TooShort);
        put_i32(&mut m.mem, 4, 0);
        assert_eq!(IrsdkLayout::parse(&m.mem).unwrap_err(), IrsdkError::NotConnected);
    }

    #[test]
    fn source_emits_session_info_and_skips_unchanged_ticks() {
        let vars = [("Speed", 4, "m/s")];
        let m = build(&vars, 16, [5, 6], YAML);
        let mem = m.mem.clone();
        let mut src = IrsdkSource::new(move || Some(mem.clone()));
        let f = src.poll().unwrap();
        let s = f.session.as_ref().unwrap();
        assert_eq!(s.car.as_deref(), Some("Mazda MX-5 Cup"));
        assert_eq!(f.max_rpm, Some(8500.0));
        assert!(src.poll().is_none());
    }
}
