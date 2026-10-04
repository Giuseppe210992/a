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

| Area | State |
|---|---|
| iRacing shared memory (name-based variable lookup) | implemented, unit-tested on synthetic buffers; **not yet run against iRacing** |
| ACC / AC shared memory | implemented from public docs, plausibility-checked; **offsets must be validated on Windows** |
| F1 25 UDP (Car Telemetry packet only) | implemented, size cross-checked (1352 B); Lap Data / Session / Status packets **not implemented** |
| Forza, EA WRC, Le Mans Ultimate / rF2, AC Evo | **not implemented** (see docs/RESEARCH.md) |
| Heart rate (BLE standard 0x180D, RR, RMSSD, reliability) | parser + engine tested; BLE client compiles for Windows (`--features ble`), **not run on hardware** |
| Engineer rules (laps, brake calls from reference lap, tyres, HR) | implemented + tested |
| Voice (priority queue, expiry, preemption; TTS + WAV clips) | queue tested; Windows sinks compile (`--features tts,audio`), **not run on hardware** |
| Offline lap recording (CSV) | implemented + tested |
| Windows GUI dashboard | **not started** (next step) |

## Build / test

```
cargo test                                    # Linux or Windows, no simulator needed
cargo run --release --bin re-cli -- --source synthetic --speedup 40 --seconds 10
# Windows:
cargo build --release --features ble,tts,audio
re-cli --source iracing --voice --hr-ble
re-cli --source acc     --voice
re-cli --source f1 --lap-dir laps       # F1 25: Settings > Telemetry: UDP ON, 127.0.0.1:20777, format 2025
```

Cross-compile check used here: `cargo check --target x86_64-pc-windows-msvc --features ble,tts,audio --all-targets`.

See `docs/RESEARCH.md` (what was verified and what was not) and `docs/VALIDATION.md`
(what to measure/confirm on a real Windows PC).
