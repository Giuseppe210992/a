//! AI Race Engineer + Co-Driver — PC-only core.
//!
//! Data flow (all local, no network required):
//! simulator -> [`sources`] -> [`telemetry::TelemetryFrame`] -> [`engineer::Engineer`]
//!   -> [`voice::VoiceQueue`] -> audio sink -> headphones
//! heart-rate sensor/watch -> [`biometrics`] -> [`engineer::Engineer`]
//!
//! The simulator-facing threads never wait on the UI, the voice engine or the
//! engineer: every hand-off is a bounded channel with drop-on-full semantics.

#[cfg(feature = "ble")]
pub mod ble;
pub mod biometrics;
pub mod clock;
#[cfg(feature = "gui")]
pub mod gui;
pub mod engineer;
pub mod recorder;
pub mod runtime;
pub mod sources;
pub mod telemetry;
pub mod track;
pub mod voice;
pub mod voice_sinks;
