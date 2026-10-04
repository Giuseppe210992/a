# Protocol research — what is verified and what is not

Method: web search summaries + public repositories. Several primary sources (Forza,
EA, Steam guides, vendor pages) were unreachable from the build environment, so
anything not marked "verified" must be confirmed against the primary spec on a Windows PC.

## Simulators

| Sim | Mechanism | Rate | Verified | Open points |
|---|---|---|---|---|
| iRacing | Memory-mapped file `Local\IRSDKMemMapFileName`; header with `tickRate`, rotating buffers with `tickCount`; variable table (name/type/offset/unit) | 60 Hz; 360 Hz with `irsdkEnableMem=1`, `irsdkLog360Hz=1` in `app.ini` | Mechanism and header fields (public SDK clone) | Real variable availability per car (tyre temps may be absent); behaviour across sessions |
| ACC / AC | Shared memory `acpmf_physics`, `acpmf_graphics`, `acpmf_static` | physics per sim step, graphics per frame | Page names and roles | Exact field offsets (kept in one table in `sources/acc.rs`), sign convention of `steerAngle` |
| F1 25 | UDP, default port 20777, in-game format 2025, 10–60 Hz | configurable | Port, format setting, Car Telemetry size 1352 B (matches our computed layout) | Lap Data / Session / Car Status layouts (needed for track position) |
| Forza Motorsport | "Data Out" UDP, Sled/Dash formats, ~60 pkt/s, IP/port configurable | 60 Hz | Existence and rate | Byte layout |
| Le Mans Ultimate / rF2 | `rF2SharedMemoryMapPlugin64.dll` buffers `$rFactor2SMMP_Telemetry$`, `_Scoring$`, `_Extended$`; 4-byte packing; version counters | ~50 Hz reported | Mechanism | Struct layouts; plugin must be installed |
| AC Evo | Shared-memory libraries exist | ? | — | Everything |
| EA WRC | Only old forum threads found about future UDP telemetry | ? | — | Whether and how it is available now |

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
