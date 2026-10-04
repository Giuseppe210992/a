use std::sync::OnceLock;
use std::time::Instant;

static START: OnceLock<Instant> = OnceLock::new();

/// Monotonic seconds since the first call in this process.
pub fn monotonic_s() -> f64 {
    START.get_or_init(Instant::now).elapsed().as_secs_f64()
}
