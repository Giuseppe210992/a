# Protocol research — what is verified and what is not

Method: web search summaries + public repositories. Several primary sources (Forza,
EA, Steam guides, vendor pages) were unreachable from the build environment, so
anything not marked "verified" must be confirmed against the primary spec on a Windows PC.

## Simulators

Sources actually read in this session: F1 25 UDP specification (packet structs and sizes), a public C# mapping of the
ACC/AC shared-memory structs (Physics, Graphics, StaticInfo, `Pack = 4`), the pyirsdk reader (iRacing header, var
buffers incl. `tickCountBegin`, YAML session info sections), the community FM7 "dash" parser and the rF2 plugin header.

| Sim | Mechanism | Rate | Verified | Open points |
|---|---|---|---|---|
| iRacing | `Local\IRSDKMemMapFileName`; header (tickRate@8, sessionInfo update/len/offset@12/16/20, numVars@24, varHeaderOffset@28, numBuf@32, bufLen@36, 4 x {tickCount, bufOffset, tickCountBegin}@48); var headers {type, offset, count, name@16, desc@48, unit@112}; YAML sections WeekendInfo / DriverInfo / CarSetup | 60 Hz; 360 Hz with `irsdkEnableMem=1`, `irsdkLog360Hz=1` | header and buffer layout (pyirsdk) | variable availability per car (tyre temps, Lat/Lon names assumed from the public variable list), CarSetup content per car |
| ACC / AC | `acpmf_physics`, `acpmf_graphics`, `acpmf_static` | physics per sim step, graphics per frame | all offsets used (physics 0..167, graphics up to carCoordinates@252, static car@68 track@134 maxRpm@412) | real-game check; steerAngle sign/scale; ACC has no setup in shared memory |
| F1 25 | UDP 20777, format 2025, 10–60 Hz | configurable | Motion 1349, Session 753, Lap Data 1285, Car Setups 1133, Car Telemetry 1352, Car Status 1239 bytes and every field offset used | real-game check; other packets unused |
| Forza Motorsport | Data Out UDP "Dash" 311 B (FM7) / 331 B (2023) | ~60 Hz | layout of the first 311 bytes from a community parser | gear mapping, tyre temperature units, FM2023 extra fields; no track position |
| Le Mans Ultimate / rF2 | rF2 Shared Memory Map plugin (`$rFactor2SMMP_*$`) | ~50 Hz | struct field layouts of the telemetry vehicle readable | the fetched header does not show whether each buffer starts with the begin/end version block; needs the game to settle → not implemented |
| AC Evo, EA WRC | — | — | nothing verifiable | not implemented |

## Heart rate / smartwatch

No specific watch is assumed. The integration targets the **Bluetooth SIG Heart Rate
Profile** (service 0x180D, Heart Rate Measurement 0x2A37, optional RR intervals in 1/1024 s),
read directly by the PC over BLE (Windows exposes BLE natively; `btleplug` wraps it).

- Works with: BLE chest straps (e.g. Polar H10 documented to use the standard service) and
  any watch/band that has a *broadcast/share heart rate over Bluetooth* mode **enabled on the device**
  (vendors with such a mode per their own documentation/search results: Polar, Amazfit "Heart Rate Push",
  Xiaomi "Share HR", some Huawei models; support varies per model and some models do not offer it).
- Not verified: whether each of those watches uses the *standard* GATT service or a proprietary one,
  and whether first-time setup needs a phone. Check per model before purchase.
- Limit to document for users: no major wearable vendor publishes a PC-side API for advanced
  metrics (stress score, sleep, SpO2). Only HR (+RR where offered) is available without a phone;
  vendor cloud APIs would require internet and an account.
- Many devices accept a single BLE connection: close other apps first.

## Audio / offline

Everything runs locally: shared memory / loopback UDP, rule-based engineer, Windows speech
synthesis (`tts` crate, OS voices) and pre-decoded WAV clips for critical calls. A cloud LLM
is not used anywhere and, if added later, must stay optional.
