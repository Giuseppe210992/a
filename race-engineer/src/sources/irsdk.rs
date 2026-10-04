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
use crate::telemetry::{SimId, TelemetryFrame, PSI_TO_KPA};
use std::collections::HashMap;

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
        Ok(Self { tick_rate, num_buf: num_buf as usize, buf_len: buf_len as usize, vars })
    }

    /// (tickCount, bufOffset) of the most recently written buffer.
    fn latest_buf(&self, mem: &[u8]) -> Option<(i32, usize)> {
        (0..self.num_buf)
            .filter_map(|i| {
                let o = 48 + i * 16;
                Some((i32_at(mem, o)?, i32_at(mem, o + 4)? as usize))
            })
            .max_by_key(|&(tick, _)| tick)
    }

    /// Copies the newest buffer into `scratch` and re-checks the tick counter so a
    /// frame being overwritten by the simulator is discarded rather than returned torn.
    /// Returns the tick count of the copied frame.
    pub fn copy_latest(&self, mem: &[u8], scratch: &mut Vec<u8>) -> Option<i32> {
        let (tick, off) = self.latest_buf(mem)?;
        let slice = mem.get(off..off.checked_add(self.buf_len)?)?;
        scratch.clear();
        scratch.extend_from_slice(slice);
        let (tick_after, _) = self.latest_buf(mem)?;
        // The SDK keeps 3-4 rotating buffers: if the one we copied was re-used in
        // the meantime, its tick count changed.
        let still = (0..self.num_buf).any(|i| {
            let o = 48 + i * 16;
            i32_at(mem, o) == Some(tick) && i32_at(mem, o + 4) == Some(off as i32)
        });
        if still && tick_after >= tick {
            Some(tick)
        } else {
            None
        }
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
        }
    }
}

/// Poll-style source over any byte view of the mapping (real mapping on Windows,
/// a synthetic buffer in tests).
pub struct IrsdkSource<M: FnMut() -> Option<Vec<u8>> + Send> {
    snapshot: M,
    layout: Option<IrsdkLayout>,
    last_tick: i32,
    scratch: Vec<u8>,
}

impl<M: FnMut() -> Option<Vec<u8>> + Send> IrsdkSource<M> {
    pub fn new(snapshot: M) -> Self {
        Self { snapshot, layout: None, last_tick: -1, scratch: Vec::new() }
    }
}

impl<M: FnMut() -> Option<Vec<u8>> + Send> TelemetrySource for IrsdkSource<M> {
    fn name(&self) -> &'static str {
        "iRacing"
    }
    fn poll(&mut self) -> Option<TelemetryFrame> {
        let mem = (self.snapshot)()?;
        if self.layout.is_none() {
            self.layout = IrsdkLayout::parse(&mem).ok();
        }
        let layout = self.layout.as_ref()?;
        let tick = layout.copy_latest(&mem, &mut self.scratch)?;
        if tick == self.last_tick {
            return None;
        }
        self.last_tick = tick;
        Some(layout.frame(&self.scratch, monotonic_s()))
    }
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

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub fn put_i32(b: &mut [u8], o: usize, v: i32) {
        b[o..o + 4].copy_from_slice(&v.to_le_bytes());
    }

    /// Builds a minimal but structurally faithful irsdk mapping.
    pub fn synthetic(vars: &[(&str, i32, &str)], buf_len: usize, ticks: [i32; 2]) -> (Vec<u8>, Vec<usize>) {
        let var_off = HEADER_LEN;
        let data_start = var_off + vars.len() * VAR_HEADER_LEN;
        let mut m = vec![0u8; data_start + 2 * buf_len];
        put_i32(&mut m, 0, 2);
        put_i32(&mut m, 4, ST_CONNECTED);
        put_i32(&mut m, 8, 60);
        put_i32(&mut m, 24, vars.len() as i32);
        put_i32(&mut m, 28, var_off as i32);
        put_i32(&mut m, 32, 2);
        put_i32(&mut m, 36, buf_len as i32);
        for i in 0..2 {
            put_i32(&mut m, 48 + i * 16, ticks[i]);
            put_i32(&mut m, 48 + i * 16 + 4, (data_start + i * buf_len) as i32);
        }
        let mut offsets = vec![];
        for (i, (name, ty, unit)) in vars.iter().enumerate() {
            let o = var_off + i * VAR_HEADER_LEN;
            let off = i * 8; // 8 bytes per var keeps floats/doubles/ints aligned
            offsets.push(off);
            put_i32(&mut m, o, *ty);
            put_i32(&mut m, o + 4, off as i32);
            put_i32(&mut m, o + 8, 1);
            m[o + 16..o + 16 + name.len()].copy_from_slice(name.as_bytes());
            m[o + 112..o + 112 + unit.len()].copy_from_slice(unit.as_bytes());
        }
        (m, offsets)
    }

    #[test]
    fn parses_named_variables_and_picks_newest_buffer() {
        let vars = [("Speed", 4, "m/s"), ("Gear", 2, ""), ("LFpressure", 4, "psi"), ("Brake", 4, "%")];
        let (mut m, offs) = synthetic(&vars, 64, [10, 11]);
        let data_start = HEADER_LEN + vars.len() * VAR_HEADER_LEN;
        // buffer 1 has tick 11 -> newest
        let b1 = data_start + 64;
        m[b1 + offs[0]..b1 + offs[0] + 4].copy_from_slice(&50.0f32.to_le_bytes());
        put_i32(&mut m, b1 + offs[1], 4);
        m[b1 + offs[2]..b1 + offs[2] + 4].copy_from_slice(&30.0f32.to_le_bytes());
        m[b1 + offs[3]..b1 + offs[3] + 4].copy_from_slice(&0.5f32.to_le_bytes());
        // buffer 0 (older) holds different data that must be ignored
        m[data_start + offs[0]..data_start + offs[0] + 4].copy_from_slice(&1.0f32.to_le_bytes());

        let layout = IrsdkLayout::parse(&m).unwrap();
        assert_eq!(layout.tick_rate, 60);
        let mut scratch = vec![];
        assert_eq!(layout.copy_latest(&m, &mut scratch), Some(11));
        let f = layout.frame(&scratch, 1.0);
        assert!((f.speed_kmh - 180.0).abs() < 1e-3);
        assert_eq!(f.gear, 4);
        assert!((f.brake - 0.5).abs() < 1e-6);
        assert!(f.tyre_pressure_kpa.is_none(), "needs all four wheels, others missing");
        assert!(f.lap.is_none());
        // psi -> kPa conversion is driven by the unit string of the variable
        assert!((layout.pressure_kpa(&scratch, "LFpressure").unwrap() - 30.0 * PSI_TO_KPA).abs() < 1e-3);
    }

    #[test]
    fn rejects_disconnected_and_truncated() {
        let (mut m, _) = synthetic(&[("Speed", 4, "m/s")], 16, [1, 2]);
        assert_eq!(IrsdkLayout::parse(&m[..50]).unwrap_err(), IrsdkError::TooShort);
        put_i32(&mut m, 4, 0);
        assert_eq!(IrsdkLayout::parse(&m).unwrap_err(), IrsdkError::NotConnected);
    }

    #[test]
    fn source_skips_unchanged_ticks() {
        let (m, _) = synthetic(&[("Speed", 4, "m/s")], 16, [5, 6]);
        let mut src = IrsdkSource::new(move || Some(m.clone()));
        assert!(src.poll().is_some());
        assert!(src.poll().is_none());
    }
}
