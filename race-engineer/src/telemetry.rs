//! Simulator-independent telemetry model.
//!
//! Every source normalises into this struct. Fields a simulator does not expose
//! are `None` (never invented). Tyre arrays are ordered FL, FR, RL, RR.

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SimId {
    #[default]
    Unknown,
    IRacing,
    Acc,
    F1_25,
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
}

pub const PSI_TO_KPA: f32 = 6.894_757;
