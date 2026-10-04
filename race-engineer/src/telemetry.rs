//! Simulator-independent telemetry model.
//!
//! Every source normalises into this struct. Fields a simulator does not expose
//! are `None` (never invented). Tyre arrays are ordered FL, FR, RL, RR.

use std::sync::Arc;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SimId {
    #[default]
    Unknown,
    IRacing,
    Acc,
    F1_25,
    Forza,
    Lmu,
    AcEvo,
    Wrc,
    Synthetic,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct TelemetryFrame {
    pub sim: SimId,
    /// Monotonic capture time, seconds (see `clock::monotonic_s`).
    pub t_s: f64,
    pub speed_kmh: f32,
    pub rpm: f32,
    /// -1 reverse, 0 neutral, 1.. forward gears.
    pub gear: i8,
    /// 0..1
    pub throttle: f32,
    /// 0..1
    pub brake: f32,
    /// Normalised steering where the simulator provides it (right positive when known).
    pub steering: Option<f32>,
    pub tyre_temp_c: Option<[f32; 4]>,
    pub tyre_pressure_kpa: Option<[f32; 4]>,
    pub fuel_l: Option<f32>,
    /// Track position 0..1.
    pub lap_dist_pct: Option<f32>,
    pub lap: Option<u32>,
    pub lap_time_s: Option<f32>,
    pub last_lap_s: Option<f32>,
    pub best_lap_s: Option<f32>,
    pub in_pit: bool,
    /// Position in metres in a local frame (east, north), when the sim exposes one.
    pub pos_m: Option<[f32; 2]>,
    /// Rev limit when the simulator publishes it (scales the RPM bar).
    pub max_rpm: Option<f32>,
    /// Static session data (car, track, setup); shared, cheap to clone.
    pub session: Option<Arc<SessionInfo>>,
}

/// Car/track/setup text published by simulators that expose it. Nothing is invented:
/// every entry comes from the simulator's own data.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct SessionInfo {
    pub car: Option<String>,
    pub track: Option<String>,
    pub track_length_m: Option<f32>,
    /// Why the setup list is empty, or a note about its units (shown in the UI).
    pub setup_note: Option<String>,
    /// (parameter, value) in the simulator's order.
    pub setup: Vec<(String, String)>,
}

pub const PSI_TO_KPA: f32 = 6.894_757;
