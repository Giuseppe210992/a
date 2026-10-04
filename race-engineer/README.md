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
| Le Mans Ultimate (native `LMU_Data`, no plugin; needs *Settings > Gameplay > Enable Plugins* ON + restart) | structs from the MIT `lmu-pitwall` project, pinned by compile-time size checks to the sizes it verified against LMU 1.4 (ScoringInfo 548, VehicleScoring 584, VehicleTelemetry 1888, mapping 324 820 B); torn-read witness; E2E (Wine); **not run against the game**. Exposes electronics, not the full setup |
| AC EVO (`acevo_pmf_*`) | offsets computed by compiling the `acevo-shared-memory` header (physics prefix identical to ACC, graphics 4900 B, static 208 B); E2E (Wine); **not run against the game** (early access: layout may change; values are range-checked). No setup exposed |
| EA SPORTS WRC (UDP) | **experimental, self-describing**: channel types are read from the game's own `channels.json`; «Prepara EA WRC» writes our structure and a `config.json` entry (backup kept). Verified: packed-LE decoding of 3 channels against a public decoder. NOT verified: `channels.json`/`config.json` schemas, other channel names/units (speed assumed m/s). No 3D position (no live map) |
| rFactor 2 | **not implemented** (different struct sizes than LMU; not requested) |
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
re-cli --source lmu | acevo | wrc        # wrc: first `re-cli --prepare-wrc`
# Test without the games (Windows or Wine): re-fakesim --sim iracing|acc|lmu|acevo|f1|forza|wrc
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
