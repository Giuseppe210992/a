# Race Engineer (PC-only, Windows)

AI Race Engineer + Co-Driver that runs entirely on the Windows PC: simulator telemetry in,
voice to the headphones out, optional heart-rate from any BLE heart-rate device. No phone,
no mandatory cloud.

```
SIMULATOR ──► telemetry source thread ──► engineer thread ──► voice thread ──► Windows audio ──► headphones
(shared mem / UDP)      (never waits)      │ rules, lap recorder     (priority queue,
                                           │                          critical clips preempt)
BLE HR sensor/watch ──► BLE thread ────────┘
                                           └─► Snapshot (Mutex) ◄── UI reads at its own pace
```

## Status

Legend: **E2E (Wine)** = the Windows `.exe` was run under Wine against `re-fakesim`, which publishes the real
named shared memory / UDP formats. It proves the Windows code paths (OpenFileMapping, parsing, threads, GUI,
settings, logs) but NOT the real games, real Bluetooth, real speech or real audio hardware (Wine has none).

| Area | State |
|---|---|
| iRacing (shared memory; name-based variables; torn-read check; session YAML → track, car, rev limit, **setup**; Lat/Lon → map) | header/buffer layout confirmed against the pyirsdk reader; E2E (Wine); **not run against iRacing** |
| ACC (physics/graphics/static; car coordinates → map; car, track, rev limit) | offsets confirmed against a public C# mapping of the structs; E2E (Wine); **not run against ACC**. ACC exposes no setup |
| F1 25 UDP (Motion, Session, Lap Data, Car Setups, Car Telemetry, Car Status) | layouts and all packet sizes match the published F1 25 spec; E2E (Wine); gives corners, delta, brake calls, setup |
| Forza Motorsport UDP "Dash" | **experimental**: FM7/FM2023 sizes (311/331); gear 0 assumed reverse, tyre units unconfirmed (tyres left empty), no track position (no corners/delta) |
| Le Mans Ultimate / rFactor 2 | **not implemented**: the plugin header I could fetch is ambiguous about the buffer version block; cannot be validated without the game |
| AC Evo, EA WRC | **not implemented** (no verifiable spec) |
| Heart rate over BLE (standard 0x180D, RR, RMSSD, reliability gating) | parser/engine tested; client compiles for Windows; errors surfaced in the UI; **not run on hardware** |
| Engineer: laps, best-lap reference, `Frena!`, `Rilascia!`, `Gas!`, tyres, HR, workload gating, status report | implemented + tested |
| Track model: corners, live delta, per-corner comparison, suggestions, map | implemented + tested; E2E (Wine) |
| Voice output: priority queue, expiry, preemption, panic-safe sink; Windows TTS + WAV clips | queue tested; Windows backends compile; in Wine TTS is unavailable and the app falls back to text (verified); **not run on real audio** |
| Voice input (offline commands: silenzio / solo critici / completo / muto / stato) | **experimental**, Windows speech recognizer; compiles for Windows; mapping tested; **never run** |
| GUI (`re-gui`) | E2E (Wine) incl. dark theme, settings persistence, log file; not run on a real Windows desktop |
| Offline lap recording (CSV) | implemented + tested + E2E (Wine) |

## Build / test

```
cargo test                                    # Linux or Windows, no simulator needed
cargo run --release --bin re-cli -- --source synthetic --speedup 40 --seconds 10
# Dashboard (Windows, or Linux for development):
cargo run --release --features gui --bin re-gui                 # setup screen
cargo run --release --features gui --bin re-gui -- --autostart synthetic
# Windows, everything:
cargo build --release --features gui,ble,tts,audio,stt
re-cli --source iracing --voice --hr-ble
re-cli --source acc     --voice
re-cli --source f1 --lap-dir laps       # F1 25: Settings > Telemetry: UDP ON, 127.0.0.1:20777, format 2025
re-cli --source forza --port 5300       # Forza: Data Out ON, 127.0.0.1:5300, format Dash
# Test without the games (Windows or Wine): re-fakesim --sim iracing|acc|f1|forza
```

Cross-compile check used here: `cargo check --target x86_64-pc-windows-msvc --features gui,ble,tts,audio,stt --all-targets`.
A prebuilt-style Windows build can also be produced by the `windows-build` GitHub Actions workflow.

See `docs/RESEARCH.md` (what was verified and what was not) and `docs/VALIDATION.md`
(what to measure/confirm on a real Windows PC).

## Files

* `re-gui.exe` — dashboard; settings in `%LOCALAPPDATA%\RaceEngineer\settings.txt`, log in `re-gui.log` there.
* `re-cli.exe` — headless runner, prints calls and a status line per second.
* `re-fakesim.exe` — test tool: fake iRacing/ACC shared memory and F1/Forza UDP.
* Optional `clips\brake.wav`, `lift.wav`, `throttle.wav`, `attention.wav` next to the exe: used for the critical calls
  instead of speech synthesis (lower latency). Laps are saved to `Documents\RaceEngineer\laps`.
