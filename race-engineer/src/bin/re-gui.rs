#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]
//! Windows dashboard. Build: `cargo build --release --features gui,ble,tts,audio`
fn main() -> eframe::Result {
    race_engineer::gui::run()
}
