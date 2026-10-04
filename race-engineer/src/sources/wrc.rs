//! EA SPORTS WRC over UDP. EXPERIMENTAL and self-describing.
//!
//! The game builds its UDP packets from a JSON *structure* (`telemetry/udp/<id>.json`: an ordered
//! list of channel names per packet) and a `telemetry/config.json` that assigns structures to
//! IP/port/rate. Every value is little-endian, packed in channel order, with no padding
//! (confirmed by a public decoder: `vehicle_gear_index` u8, `vehicle_engine_rpm_current` f32,
//! `vehicle_engine_rpm_max` f32 decode as `buf[0]`, `buf[1..5]`, `buf[5..9]`).
//!
//! The data type of every other channel is read at runtime from the game's own
//! `telemetry/readme/channels.json` (regenerated at each game start), so no type is hard-coded
//! here. [`prepare`] writes our structure and adds one packet assignment to `config.json`
//! (a backup is kept); restart the game afterwards. What is NOT verified without the game:
//! the exact layout of `channels.json`/`config.json` (parsed tolerantly), channel names other
//! than the three above (missing ones are simply left out), and units (speed assumed m/s,
//! pedals 0..1, gear index 0 = neutral, 1.. forward, >= 10 = reverse).

use super::TelemetrySource;
use crate::clock::monotonic_s;
use crate::telemetry::{SimId, TelemetryFrame};
use serde_json::{json, Value};
use std::net::UdpSocket;
use std::path::{Path, PathBuf};

pub const DEFAULT_PORT: u16 = 20778;
pub const STRUCTURE_ID: &str = "race_engineer";
const PACKET_ID: &str = "session_update";

/// (channel name, what we use it for). Only channels that exist in the game's channels.json are used.
pub const WANTED: &[&str] = &[
    "vehicle_gear_index",
    "vehicle_engine_rpm_current",
    "vehicle_engine_rpm_max",
    "vehicle_speed",
    "vehicle_throttle",
    "vehicle_brake",
    "vehicle_steering",
    "stage_current_time",
    "stage_current_distance",
    "stage_length",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChType {
    U8,
    U16,
    U32,
    U64,
    I8,
    I16,
    I32,
    I64,
    F32,
    F64,
    Bool,
}

impl ChType {
    pub fn size(self) -> usize {
        match self {
            Self::U8 | Self::I8 | Self::Bool => 1,
            Self::U16 | Self::I16 => 2,
            Self::U32 | Self::I32 | Self::F32 => 4,
            Self::U64 | Self::I64 | Self::F64 => 8,
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Some(match s.trim().to_ascii_lowercase().as_str() {
            "uint8" | "u8" | "byte" => Self::U8,
            "uint16" | "u16" => Self::U16,
            "uint32" | "u32" => Self::U32,
            "uint64" | "u64" => Self::U64,
            "int8" | "i8" => Self::I8,
            "int16" | "i16" => Self::I16,
            "int32" | "i32" => Self::I32,
            "int64" | "i64" => Self::I64,
            "float32" | "f32" | "float" | "single" => Self::F32,
            "float64" | "f64" | "double" => Self::F64,
            "bool" | "boolean" => Self::Bool,
            _ => return None,
        })
    }

    fn read(self, b: &[u8]) -> f64 {
        match self {
            Self::U8 => b[0] as f64,
            Self::I8 => b[0] as i8 as f64,
            Self::Bool => (b[0] != 0) as u8 as f64,
            Self::U16 => u16::from_le_bytes([b[0], b[1]]) as f64,
            Self::I16 => i16::from_le_bytes([b[0], b[1]]) as f64,
            Self::U32 => u32::from_le_bytes(b[..4].try_into().unwrap()) as f64,
            Self::I32 => i32::from_le_bytes(b[..4].try_into().unwrap()) as f64,
            Self::F32 => f32::from_le_bytes(b[..4].try_into().unwrap()) as f64,
            Self::U64 => u64::from_le_bytes(b[..8].try_into().unwrap()) as f64,
            Self::I64 => i64::from_le_bytes(b[..8].try_into().unwrap()) as f64,
            Self::F64 => f64::from_le_bytes(b[..8].try_into().unwrap()),
        }
    }
}

/// Finds `(name, type)` pairs anywhere in a channels.json: objects with `id`/`name` + `type`,
/// or maps `{ "<name>": { "type": ... } }`.
pub fn parse_channels(json: &Value) -> Vec<(String, ChType)> {
    fn walk(v: &Value, key: Option<&str>, out: &mut Vec<(String, ChType)>) {
        match v {
            Value::Object(m) => {
                let ty = m.get("type").and_then(Value::as_str).and_then(ChType::parse);
                let name = m.get("id").or_else(|| m.get("name")).and_then(Value::as_str).or(key);
                if let (Some(t), Some(n)) = (ty, name) {
                    out.push((n.to_string(), t));
                }
                for (k, c) in m {
                    walk(c, Some(k), out);
                }
            }
            Value::Array(a) => a.iter().for_each(|c| walk(c, None, out)),
            _ => {}
        }
    }
    let mut out = vec![];
    walk(json, None, &mut out);
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out.dedup_by(|a, b| a.0 == b.0);
    out
}

/// Telemetry directory: `RE_WRC_DIR`, else `<Documents>\My Games\WRC\telemetry`.
pub fn telemetry_dir() -> PathBuf {
    std::env::var_os("RE_WRC_DIR").map(PathBuf::from).unwrap_or_else(|| crate::diag::documents_dir().join("My Games").join("WRC").join("telemetry"))
}

#[derive(Debug, PartialEq)]
pub struct Prepared {
    pub channels: Vec<String>,
    pub missing: Vec<String>,
    pub port: u16,
    pub backed_up: bool,
}

/// Writes `udp/race_engineer.json` and registers it in `config.json`. Reversible: the original
/// `config.json` is copied to `config.json.re-backup` the first time.
pub fn prepare(dir: &Path, port: u16) -> Result<Prepared, String> {
    let ch_path = dir.join("readme").join("channels.json");
    let text = std::fs::read_to_string(&ch_path)
        .map_err(|_| format!("manca {}: avvia EA WRC almeno una volta (il gioco crea questo file), poi riprova", ch_path.display()))?;
    let known = parse_channels(&serde_json::from_str(&text).map_err(|e| format!("channels.json non leggibile: {e}"))?);
    if known.is_empty() {
        return Err("channels.json non contiene canali riconoscibili (formato diverso dal previsto)".into());
    }
    let (mut channels, mut missing) = (vec![], vec![]);
    for w in WANTED {
        if known.iter().any(|(n, _)| n == w) {
            channels.push(w.to_string());
        } else {
            missing.push(w.to_string());
        }
    }
    if channels.len() < 3 {
        return Err("troppo pochi canali utili trovati nel channels.json".into());
    }

    // `versions` copied from the game's own wrc.json when present
    let versions = std::fs::read_to_string(dir.join("readme").join("udp").join("wrc.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|v| v.get("versions").cloned())
        .unwrap_or_else(|| json!({ "schema": 1, "data": 3 }));
    let structure = json!({
        "versions": versions,
        "id": STRUCTURE_ID,
        "header": { "channels": [] },
        "packets": [ { "id": PACKET_ID, "channels": channels } ]
    });
    let udp_dir = dir.join("udp");
    std::fs::create_dir_all(&udp_dir).map_err(|e| format!("impossibile creare {}: {e}", udp_dir.display()))?;
    std::fs::write(udp_dir.join(format!("{STRUCTURE_ID}.json")), serde_json::to_string_pretty(&structure).unwrap())
        .map_err(|e| format!("impossibile scrivere la struttura: {e}"))?;

    let cfg_path = dir.join("config.json");
    let mut cfg: Value = match std::fs::read_to_string(&cfg_path) {
        Ok(t) => serde_json::from_str(&t).map_err(|e| format!("config.json non leggibile: {e}"))?,
        Err(_) => json!({}),
    };
    let backup = dir.join("config.json.re-backup");
    let mut backed_up = false;
    if cfg_path.exists() && !backup.exists() {
        std::fs::copy(&cfg_path, &backup).map_err(|e| format!("impossibile salvare il backup di config.json: {e}"))?;
        backed_up = true;
    }
    let packets = cfg
        .as_object_mut()
        .ok_or("config.json: formato inatteso")?
        .entry("udp")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or("config.json: 'udp' non è un oggetto")?
        .entry("packets")
        .or_insert_with(|| json!([]))
        .as_array_mut()
        .ok_or("config.json: 'udp.packets' non è un elenco")?;
    packets.retain(|p| p.get("structure").and_then(Value::as_str) != Some(STRUCTURE_ID));
    // reuse the key names of an existing assignment when there is one
    let mut entry = packets.first().cloned().unwrap_or_else(|| {
        json!({ "structure": "", "packet": "", "ip": "127.0.0.1", "port": 0, "frequencyHz": 60, "bEnabled": true })
    });
    if let Some(o) = entry.as_object_mut() {
        o.insert("structure".into(), json!(STRUCTURE_ID));
        o.insert("packet".into(), json!(PACKET_ID));
        o.insert("ip".into(), json!("127.0.0.1"));
        o.insert("port".into(), json!(port));
        o.insert("frequencyHz".into(), json!(60));
        o.insert("bEnabled".into(), json!(true));
    }
    packets.push(entry);
    std::fs::write(&cfg_path, serde_json::to_string_pretty(&cfg).unwrap()).map_err(|e| format!("impossibile scrivere config.json: {e}"))?;
    Ok(Prepared { channels, missing, port, backed_up })
}

/// Channel layout of our packet, rebuilt from the files on disk.
pub struct Layout {
    fields: Vec<(String, ChType, usize)>,
    pub len: usize,
}

impl Layout {
    pub fn load(dir: &Path) -> Result<Self, String> {
        let st: Value = serde_json::from_str(
            &std::fs::read_to_string(dir.join("udp").join(format!("{STRUCTURE_ID}.json")))
                .map_err(|_| "struttura non trovata: premi «Prepara EA WRC» e riavvia il gioco".to_string())?,
        )
        .map_err(|e| format!("struttura non leggibile: {e}"))?;
        let known = parse_channels(
            &serde_json::from_str(
                &std::fs::read_to_string(dir.join("readme").join("channels.json")).map_err(|_| "channels.json mancante".to_string())?,
            )
            .map_err(|e| format!("channels.json non leggibile: {e}"))?,
        );
        let names: Vec<String> = st["packets"][0]["channels"]
            .as_array()
            .ok_or("struttura senza canali")?
            .iter()
            .filter_map(|c| c.as_str().map(str::to_string))
            .collect();
        let mut fields = vec![];
        let mut off = 0;
        for n in names {
            let ty = known.iter().find(|(k, _)| *k == n).map(|(_, t)| *t).ok_or_else(|| format!("canale sconosciuto: {n}"))?;
            fields.push((n, ty, off));
            off += ty.size();
        }
        Ok(Self { fields, len: off })
    }

    pub fn from_fields(fields: &[(&str, ChType)]) -> Self {
        let mut off = 0;
        let fields = fields
            .iter()
            .map(|(n, t)| {
                let f = (n.to_string(), *t, off);
                off += t.size();
                f
            })
            .collect();
        Self { fields, len: off }
    }

    /// Builds a packet like the game would (used by `re-fakesim --sim wrc`).
    pub fn encode(&self, f: &TelemetryFrame) -> Vec<u8> {
        let mut out = vec![0u8; self.len];
        for (name, ty, off) in &self.fields {
            let v: f64 = match name.as_str() {
                "vehicle_gear_index" => match f.gear {
                    -1 => 10.0,
                    g => g.max(0) as f64,
                },
                "vehicle_engine_rpm_current" => f.rpm as f64,
                "vehicle_engine_rpm_max" => 9000.0,
                "vehicle_speed" => f.speed_kmh as f64 / 3.6,
                "vehicle_throttle" => f.throttle as f64,
                "vehicle_brake" => f.brake as f64,
                "vehicle_steering" => f.steering.unwrap_or(0.0) as f64,
                "stage_current_time" => f.lap_time_s.unwrap_or(0.0) as f64,
                "stage_current_distance" => f.lap_dist_pct.unwrap_or(0.0) as f64 * 4000.0,
                "stage_length" => 4000.0,
                _ => 0.0,
            };
            let b: Vec<u8> = match ty {
                ChType::U8 => vec![v as u8],
                ChType::I8 => vec![v as i8 as u8],
                ChType::Bool => vec![(v != 0.0) as u8],
                ChType::U16 => (v as u16).to_le_bytes().to_vec(),
                ChType::I16 => (v as i16).to_le_bytes().to_vec(),
                ChType::U32 => (v as u32).to_le_bytes().to_vec(),
                ChType::I32 => (v as i32).to_le_bytes().to_vec(),
                ChType::F32 => (v as f32).to_le_bytes().to_vec(),
                ChType::U64 => (v as u64).to_le_bytes().to_vec(),
                ChType::I64 => (v as i64).to_le_bytes().to_vec(),
                ChType::F64 => v.to_le_bytes().to_vec(),
            };
            out[*off..*off + b.len()].copy_from_slice(&b);
        }
        out
    }

    fn get(&self, p: &[u8], name: &str) -> Option<f64> {
        let (_, t, o) = self.fields.iter().find(|(n, _, _)| n == name)?;
        let v = t.read(p.get(*o..*o + t.size())?);
        v.is_finite().then_some(v)
    }

    pub fn decode(&self, p: &[u8], t_s: f64) -> Option<TelemetryFrame> {
        if p.len() != self.len {
            return None; // another structure/packet on this port
        }
        let speed_ms = self.get(p, "vehicle_speed").unwrap_or(0.0);
        let gear = self.get(p, "vehicle_gear_index").map_or(0, |g| match g as i32 {
            0 => 0,
            1..=9 => g as i8,
            _ => -1,
        });
        let rpm = self.get(p, "vehicle_engine_rpm_current").unwrap_or(0.0);
        if !(0.0..=30_000.0).contains(&rpm) || !(0.0..=200.0).contains(&speed_ms) {
            return None;
        }
        let stage_len = self.get(p, "stage_length").filter(|l| *l > 100.0);
        let dist = self.get(p, "stage_current_distance").filter(|d| *d >= 0.0);
        Some(TelemetryFrame {
            sim: SimId::Wrc,
            t_s,
            speed_kmh: (speed_ms * 3.6) as f32,
            rpm: rpm as f32,
            gear,
            throttle: self.get(p, "vehicle_throttle").unwrap_or(0.0).clamp(0.0, 1.0) as f32,
            brake: self.get(p, "vehicle_brake").unwrap_or(0.0).clamp(0.0, 1.0) as f32,
            steering: self.get(p, "vehicle_steering").map(|s| s.clamp(-1.0, 1.0) as f32),
            lap_time_s: self.get(p, "stage_current_time").filter(|t| *t >= 0.0).map(|t| t as f32),
            lap_dist_pct: dist.zip(stage_len).map(|(d, l)| (d / l).clamp(0.0, 1.0) as f32),
            max_rpm: self.get(p, "vehicle_engine_rpm_max").filter(|r| *r > 1000.0).map(|r| r as f32),
            ..Default::default()
        })
    }
}

pub struct WrcUdpSource {
    sock: UdpSocket,
    buf: Vec<u8>,
    layout: Layout,
}

impl WrcUdpSource {
    pub fn bind(port: u16, dir: &Path) -> Result<Self, String> {
        let layout = Layout::load(dir)?;
        let sock = UdpSocket::bind(("0.0.0.0", port)).map_err(|e| format!("porta UDP {port}: {e}"))?;
        sock.set_nonblocking(true).map_err(|e| e.to_string())?;
        Ok(Self { sock, buf: vec![0u8; 2048], layout })
    }
    pub fn local_port(&self) -> u16 {
        self.sock.local_addr().map(|a| a.port()).unwrap_or(0)
    }
}

impl TelemetrySource for WrcUdpSource {
    fn name(&self) -> &'static str {
        "EA WRC (UDP, sperimentale)"
    }
    fn poll(&mut self) -> Option<TelemetryFrame> {
        let mut latest = None;
        while let Ok(n) = self.sock.recv(&mut self.buf) {
            if let Some(f) = self.layout.decode(&self.buf[..n], monotonic_s()) {
                latest = Some(f);
            }
        }
        latest
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("re_wrc_{name}_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("readme").join("udp")).unwrap();
        d
    }

    fn channels_json() -> Value {
        json!({ "versions": {"schema": 1}, "channels": [
            {"id": "vehicle_gear_index", "type": "uint8"},
            {"id": "vehicle_engine_rpm_current", "type": "float32"},
            {"id": "vehicle_engine_rpm_max", "type": "float32"},
            {"id": "vehicle_speed", "type": "float32"},
            {"id": "vehicle_throttle", "type": "float32"},
            {"id": "vehicle_brake", "type": "float32"},
            {"id": "stage_current_time", "type": "float32"},
            {"id": "stage_current_distance", "type": "float64"},
            {"id": "stage_length", "type": "float64"}
        ]})
    }

    #[test]
    fn channel_types_are_found_in_list_and_map_layouts_and_with_aliases() {
        let a = parse_channels(&channels_json());
        assert!(a.contains(&("stage_length".to_string(), ChType::F64)));
        let b = parse_channels(&json!({ "vehicle_speed": {"type": "float"}, "vehicle_gear_index": {"type": "byte"}, "x": {"type": "weird"} }));
        assert_eq!(b, vec![("vehicle_gear_index".to_string(), ChType::U8), ("vehicle_speed".to_string(), ChType::F32)]);
    }

    #[test]
    fn prepare_writes_structure_registers_the_packet_and_keeps_a_backup() {
        let d = tmp("prep");
        std::fs::write(d.join("readme").join("channels.json"), channels_json().to_string()).unwrap();
        std::fs::write(
            d.join("config.json"),
            json!({"other": 1, "udp": {"packets": [{"structure": "wrc", "packet": "session_update", "ip": "127.0.0.1", "port": 20777, "frequencyHz": 30, "bEnabled": true}]}}).to_string(),
        )
        .unwrap();
        let r = prepare(&d, 20778).unwrap();
        assert!(r.backed_up && r.channels.contains(&"vehicle_speed".to_string()));
        assert!(r.missing.contains(&"vehicle_steering".to_string()), "absent channels are skipped, not invented");
        let cfg: Value = serde_json::from_str(&std::fs::read_to_string(d.join("config.json")).unwrap()).unwrap();
        assert_eq!(cfg["other"], 1);
        let pk = cfg["udp"]["packets"].as_array().unwrap();
        assert_eq!(pk.len(), 2, "the game's own assignment is kept");
        assert_eq!(pk[1]["structure"], STRUCTURE_ID);
        assert_eq!(pk[1]["port"], 20778);
        // idempotent: running again does not duplicate or overwrite the backup
        let r2 = prepare(&d, 20778).unwrap();
        assert!(!r2.backed_up);
        let cfg: Value = serde_json::from_str(&std::fs::read_to_string(d.join("config.json")).unwrap()).unwrap();
        assert_eq!(cfg["udp"]["packets"].as_array().unwrap().len(), 2);
        let backup: Value = serde_json::from_str(&std::fs::read_to_string(d.join("config.json.re-backup")).unwrap()).unwrap();
        assert_eq!(backup["udp"]["packets"].as_array().unwrap().len(), 1);
        // structure file shape
        let st: Value = serde_json::from_str(&std::fs::read_to_string(d.join("udp").join("race_engineer.json")).unwrap()).unwrap();
        assert_eq!(st["packets"][0]["id"], PACKET_ID);
        assert_eq!(st["header"]["channels"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn prepare_explains_missing_game_files() {
        let d = tmp("missing");
        assert!(prepare(&d, 1).unwrap_err().contains("avvia EA WRC"));
    }

    #[test]
    fn decodes_packed_little_endian_packet_in_structure_order() {
        let d = tmp("dec");
        std::fs::write(d.join("readme").join("channels.json"), channels_json().to_string()).unwrap();
        let r = prepare(&d, 20778).unwrap();
        let layout = Layout::load(&d).unwrap();
        // build a packet exactly as the game would: channels in structure order, packed
        let mut p = vec![];
        for c in &r.channels {
            match c.as_str() {
                "vehicle_gear_index" => p.push(4u8),
                "vehicle_engine_rpm_current" => p.extend(6500.0f32.to_le_bytes()),
                "vehicle_engine_rpm_max" => p.extend(8200.0f32.to_le_bytes()),
                "vehicle_speed" => p.extend(40.0f32.to_le_bytes()),
                "vehicle_throttle" => p.extend(0.75f32.to_le_bytes()),
                "vehicle_brake" => p.extend(0.0f32.to_le_bytes()),
                "stage_current_time" => p.extend(31.5f32.to_le_bytes()),
                "stage_current_distance" => p.extend(1500.0f64.to_le_bytes()),
                "stage_length" => p.extend(6000.0f64.to_le_bytes()),
                other => panic!("unexpected {other}"),
            }
        }
        assert_eq!(p.len(), layout.len);
        let f = layout.decode(&p, 0.0).unwrap();
        assert_eq!(f.sim, SimId::Wrc);
        assert!((f.speed_kmh - 144.0).abs() < 1e-3);
        assert_eq!((f.gear, f.rpm, f.throttle), (4, 6500.0, 0.75));
        assert!((f.lap_dist_pct.unwrap() - 0.25).abs() < 1e-6);
        assert_eq!(f.lap_time_s, Some(31.5));
        assert_eq!(f.max_rpm, Some(8200.0));
        assert!(layout.decode(&p[..p.len() - 1], 0.0).is_none(), "wrong size = some other packet");
    }

    #[test]
    fn encode_decode_roundtrip_over_udp_loopback() {
        let d = tmp("udp");
        std::fs::write(d.join("readme").join("channels.json"), channels_json().to_string()).unwrap();
        prepare(&d, 0).unwrap();
        let layout = Layout::load(&d).unwrap();
        let mut car = crate::sources::sim::SyntheticCar::default();
        let mut f = car.step(0.01);
        for _ in 0..700 {
            f = car.step(0.01);
        }
        let mut src = WrcUdpSource::bind(0, &d).unwrap();
        let tx = UdpSocket::bind("127.0.0.1:0").unwrap();
        tx.send_to(&layout.encode(&f), ("127.0.0.1", src.local_port())).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(50));
        let out = src.poll().unwrap();
        assert!((out.speed_kmh - f.speed_kmh).abs() < 0.01);
        assert_eq!(out.gear, f.gear);
        assert!((out.lap_dist_pct.unwrap() - f.lap_dist_pct.unwrap()).abs() < 1e-4);
    }

    #[test]
    fn the_three_publicly_documented_channels_match_the_known_offsets() {
        // buf[0] gear u8, buf[1..5] rpm f32, buf[5..9] max rpm f32 (public WRC decoder)
        let l = Layout::from_fields(&[("vehicle_gear_index", ChType::U8), ("vehicle_engine_rpm_current", ChType::F32), ("vehicle_engine_rpm_max", ChType::F32)]);
        let mut p = vec![3u8];
        p.extend(5000.0f32.to_le_bytes());
        p.extend(7500.0f32.to_le_bytes());
        assert_eq!(l.len, 9);
        let f = l.decode(&p, 0.0).unwrap();
        assert_eq!((f.gear, f.rpm, f.max_rpm), (3, 5000.0, Some(7500.0)));
    }
}
