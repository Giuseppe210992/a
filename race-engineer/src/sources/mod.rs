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
