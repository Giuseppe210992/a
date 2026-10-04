pub mod acc;
pub mod acevo;
pub mod f1;
pub mod forza;
pub mod irsdk;
pub mod lmu;
pub mod lmu_layout;
pub mod sim;
pub mod wrc;
#[cfg(windows)]
pub mod winshm;

use crate::telemetry::TelemetryFrame;

/// A pull-style telemetry source, polled by a dedicated thread.
pub trait TelemetrySource: Send {
    fn name(&self) -> &'static str;
    /// Returns the newest frame if there is one since the last call.
    /// Must never block for long (the runtime owns the polling cadence).
    fn poll(&mut self) -> Option<TelemetryFrame>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceKind {
    Synthetic,
    IRacing,
    Acc,
    F1,
    Forza,
    Lmu,
    AcEvo,
    Wrc,
}

impl SourceKind {
    pub const ALL: [SourceKind; 8] = [Self::Synthetic, Self::IRacing, Self::Acc, Self::Lmu, Self::AcEvo, Self::F1, Self::Forza, Self::Wrc];

    pub fn label(self) -> &'static str {
        match self {
            Self::Synthetic => "Demo sintetica (nessun simulatore)",
            Self::IRacing => "iRacing (memoria condivisa)",
            Self::Acc => "Assetto Corsa Competizione (memoria condivisa)",
            Self::F1 => "F1 25 (UDP)",
            Self::Forza => "Forza Motorsport (UDP, sperimentale)",
            Self::Lmu => "Le Mans Ultimate (memoria condivisa)",
            Self::AcEvo => "Assetto Corsa EVO (memoria condivisa)",
            Self::Wrc => "EA SPORTS WRC (UDP, sperimentale)",
        }
    }

    /// UDP port the simulator must be configured to send to (None for shared-memory sims).
    pub fn default_udp_port(self) -> Option<u16> {
        match self {
            Self::F1 => Some(f1::DEFAULT_PORT),
            Self::Forza => Some(forza::DEFAULT_PORT),
            Self::Wrc => Some(wrc::DEFAULT_PORT),
            _ => None,
        }
    }

    pub fn available_here(self) -> bool {
        match self {
            Self::Synthetic | Self::F1 | Self::Forza | Self::Wrc => true,
            Self::IRacing | Self::Acc | Self::Lmu | Self::AcEvo => cfg!(windows),
        }
    }
}

/// Opens a source; shared-memory sims only exist on Windows. `udp_port` overrides the
/// default for the UDP simulators.
pub fn open(kind: SourceKind, synthetic_speedup: f64, udp_port: Option<u16>) -> Result<Box<dyn TelemetrySource>, String> {
    let port_err = |p: u16, e: std::io::Error| format!("impossibile aprire la porta UDP {p}: {e} (già in uso da un altro programma?)");
    match kind {
        SourceKind::Synthetic => Ok(Box::new(sim::SyntheticSource::new(synthetic_speedup))),
        SourceKind::F1 => {
            let p = udp_port.unwrap_or(f1::DEFAULT_PORT);
            f1::F1UdpSource::bind(p).map(|s| Box::new(s) as Box<dyn TelemetrySource>).map_err(|e| port_err(p, e))
        }
        SourceKind::Forza => {
            let p = udp_port.unwrap_or(forza::DEFAULT_PORT);
            forza::ForzaUdpSource::bind(p).map(|s| Box::new(s) as Box<dyn TelemetrySource>).map_err(|e| port_err(p, e))
        }
        SourceKind::Wrc => {
            let p = udp_port.unwrap_or(wrc::DEFAULT_PORT);
            wrc::WrcUdpSource::bind(p, &wrc::telemetry_dir()).map(|s| Box::new(s) as Box<dyn TelemetrySource>)
        }
        #[cfg(windows)]
        SourceKind::Lmu => Ok(Box::new(lmu::open_windows())),
        #[cfg(windows)]
        SourceKind::AcEvo => Ok(Box::new(acevo::open_windows())),
        #[cfg(windows)]
        SourceKind::IRacing => Ok(Box::new(irsdk::open_windows())),
        #[cfg(windows)]
        SourceKind::Acc => Ok(Box::new(acc::open_windows())),
        #[cfg(not(windows))]
        SourceKind::IRacing | SourceKind::Acc | SourceKind::Lmu | SourceKind::AcEvo => Err("questa sorgente richiede Windows".into()),
    }
}
