# Validation checklist (needs a Windows PC with the simulator)

Nothing below has been run on Windows hardware yet.

1. **Build**: `cargo build --release --features ble,tts,audio`.
2. **iRacing**: run `re-cli --source iracing` on track; check speed/RPM/gear/pedals vs the in-game
   display; list which of `LF/RF/LR/RRtempCM`, `*pressure` are published (tyres may be `None`).
   Confirm `tickRate` (60 or 360) and that CPU use of `re-cli` stays negligible.
3. **ACC**: compare speed, gear, rpm, tyre pressure/temperature with the in-game HUD; if any field is
   off, adjust the offsets table in `sources/acc.rs` (frames failing plausibility checks are dropped,
   so wrong offsets appear as "no data", not as wrong data). Check `steerAngle` sign/scale.
4. **F1 25**: set UDP telemetry on, format 2025, rate 60 Hz; confirm speed/gear/pedals; then add
   Lap Data from the official EA spec to enable brake-zone calls.
5. **BLE HR**: enable HR broadcast on the device, run `--hr-ble [name]`; check bpm vs device, contact flag,
   reconnect after moving away, and RR availability (RMSSD only appears if RR intervals arrive).
6. **Audio**: record `clips/brake.wav` etc.; measure call-to-sound latency (loopback recording or
   audio interface) for the clip path and for TTS. Check headphones are the default device.
7. **Simulator impact**: frame-time capture (e.g. CapFrameX/PresentMon) with and without `re-cli`.
   The engineer must not change frame pacing. If it does, lower thread priorities / poll rate.
8. **Thresholds**: tyre temperature limits, HR zones (resting/max HR) and the brake-call lead time
   (`EngineerConfig`) are generic defaults, to be calibrated per car and driver.
9. **GUI**: start `re-gui`, pick the simulator, drive two valid laps; confirm corner numbers on the map,
   delta sign (positive = slower than the best lap), tyre cards, HR card and the "voce" state.
   Check GPU/frame-time impact of the dashboard itself with the "UI 15/30/60 fps" selector (OpenGL via
   `glow`, repaint capped); if the sim is affected, use 15 fps or minimise the window.
10. **Map**: iRacing builds the map from Lat/Lon (names assumed from the public SDK variable list;
    if absent the UI falls back to a schematic ring). ACC and F1 currently give no coordinates → ring.
