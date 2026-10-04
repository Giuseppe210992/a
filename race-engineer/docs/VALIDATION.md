# Validation checklist (needs a Windows PC with the simulator)

Done so far: the Windows executables were run under Wine against `re-fakesim` (shared memory and UDP formats,
GUI, settings, log). NOT done: anything involving the real games, real Bluetooth, real speech/audio hardware, a real
Windows desktop (DPI, GPU drivers). Everything below is for a real Windows PC.

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
11. **Voice commands** (`stt` feature, experimental): enable in the setup screen, say "stato" / "silenzio" / "completo";
    check the banner for errors (microphone access for desktop apps, speech language pack).
12. **Forza**: confirm gear display, that tyres stay empty and that the live map follows the car.
13. **Logs**: `%LOCALAPPDATA%\RaceEngineer\re-gui.log` — attach it when something misbehaves.
14. **LMU**: in LMU turn *Settings > Gameplay > Enable Plugins* ON and restart; check speed/rpm/gear/pedals, tyre
    temperatures (shown only once the wheel block is populated), lap distance (corners/delta after two laps),
    and the "setup" card (electronics only). If `re-gui.log` reports implausible data after a game update, the
    layout changed.
15. **AC EVO**: same checks as ACC; verify the map follows the car (player picked from the car table).
16. **EA WRC**: start the game once, press «Prepara EA WRC» (or `re-cli --prepare-wrc`), restart the game, start
    a stage, then «Avvia». If nothing arrives: open `Documents\My Games\WRC\telemetry\config.json` and
    check our `race_engineer` entry; `config.json.re-backup` restores the original. Verify speed units.
17. **Access code**: start `re-gui.exe` on a clean profile, paste a code from the generator, check the expiry line
    on top; then generate a code that expires in 2 minutes and confirm the app locks (and asks for a new code).
18. **Error e-mail**: put your `report.json` in `%LOCALAPPDATA%\RaceEngineer`, tick the consent box, press
    «Invia messaggio di prova» and check the inbox (also spam). For Gmail use an *app password*.
19. **Smartwatch**: run with the watch off and with «Collega sensore» ticked: the dashboard must work normally and
    show only an amber notice.
