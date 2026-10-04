pub mod acc;
pub mod f1;
pub mod irsdk;
pub mod sim;
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
}

impl SourceKind {
    pub const ALL: [SourceKind; 4] = [Self::Synthetic, Self::IRacing, Self::Acc, Self::F1];

    pub fn label(self) -> &'static str {
        match self {
            Self::Synthetic => "Demo sintetica (nessun simulatore)",
            Self::IRacing => "iRacing (memoria condivisa)",
            Self::Acc => "Assetto Corsa Competizione (memoria condivisa)",
            Self::F1 => "F1 25 (UDP 20777)",
        }
    }

    pub fn available_here(self) -> bool {
        match self {
            Self::Synthetic | Self::F1 => true,
            Self::IRacing | Self::Acc => cfg!(windows),
        }
    }
}

/// Opens a source; shared-memory sims only exist on Windows.
pub fn open(kind: SourceKind, synthetic_speedup: f64) -> Result<Box<dyn TelemetrySource>, String> {
    match kind {
        SourceKind::Synthetic => Ok(Box::new(sim::SyntheticSource::new(synthetic_speedup))),
        SourceKind::F1 => f1::F1UdpSource::bind(f1::DEFAULT_PORT)
            .map(|s| Box::new(s) as Box<dyn TelemetrySource>)
            .map_err(|e| format!("impossibile aprire UDP {}: {e} (porta già in uso?)", f1::DEFAULT_PORT)),
        #[cfg(windows)]
        SourceKind::IRacing => Ok(Box::new(irsdk::open_windows())),
        #[cfg(windows)]
        SourceKind::Acc => Ok(Box::new(acc::open_windows())),
        #[cfg(not(windows))]
        SourceKind::IRacing | SourceKind::Acc => Err("questa sorgente richiede Windows".into()),
    }
}
