//! Direct PC <-> device Bluetooth LE heart-rate client (no phone involved).
//! Uses `btleplug`, which talks to the native Windows BLE stack (WinRT) on Windows.
//!
//! Works with any peripheral that advertises the standard Heart Rate service (0x180D):
//! chest straps, and watches/bands that have a "broadcast / share heart rate" mode
//! switched ON on the device itself. The watch must be in that mode, and many devices
//! accept only one connection at a time (disconnect other apps first).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

use btleplug::api::{Central, Manager as _, Peripheral as _, ScanFilter};
use btleplug::platform::Manager;
use futures_util::StreamExt;
use uuid::Uuid;

use crate::biometrics::{parse_hr_measurement, HrMeasurement, HR_MEASUREMENT_UUID, HR_SERVICE_UUID};
use crate::clock::monotonic_s;

#[derive(Debug, Clone)]
pub struct BleConfig {
    /// Case-insensitive substring of the advertised name; `None` = first device with the HR service.
    pub name_filter: Option<String>,
    pub scan: Duration,
}

impl Default for BleConfig {
    fn default() -> Self {
        Self { name_filter: None, scan: Duration::from_secs(8) }
    }
}

async fn session(cfg: &BleConfig, tx: &Sender<(f64, HrMeasurement)>, stop: &AtomicBool) -> Result<(), btleplug::Error> {
    let service = Uuid::from_u128(HR_SERVICE_UUID);
    let ch_uuid = Uuid::from_u128(HR_MEASUREMENT_UUID);
    let adapter = Manager::new()
        .await?
        .adapters()
        .await?
        .into_iter()
        .next()
        .ok_or(btleplug::Error::DeviceNotFound)?;
    adapter.start_scan(ScanFilter { services: vec![service] }).await?;
    tokio::time::sleep(cfg.scan).await;
    let _ = adapter.stop_scan().await;

    let mut target = None;
    for p in adapter.peripherals().await? {
        let Some(props) = p.properties().await? else { continue };
        let name = props.local_name.clone().unwrap_or_default().to_lowercase();
        let name_ok = cfg.name_filter.as_ref().is_none_or(|f| name.contains(&f.to_lowercase()));
        if props.services.contains(&service) && name_ok {
            target = Some(p);
            break;
        }
    }
    let p = target.ok_or(btleplug::Error::DeviceNotFound)?;
    p.connect().await?;
    p.discover_services().await?;
    let ch = p
        .characteristics()
        .into_iter()
        .find(|c| c.uuid == ch_uuid)
        .ok_or(btleplug::Error::NoSuchCharacteristic)?;
    p.subscribe(&ch).await?;
    let mut notifications = p.notifications().await?;
    while !stop.load(Ordering::Relaxed) {
        match tokio::time::timeout(Duration::from_secs(1), notifications.next()).await {
            Err(_) => continue, // no data this second; re-check stop flag
            Ok(None) => break,  // link dropped
            Ok(Some(n)) if n.uuid == ch_uuid => {
                if let Ok(m) = parse_hr_measurement(&n.value) {
                    if tx.send((monotonic_s(), m)).is_err() {
                        return Ok(());
                    }
                }
            }
            Ok(Some(_)) => {}
        }
    }
    let _ = p.disconnect().await;
    Ok(())
}

/// Runs a reconnecting listener on its own thread until `stop` is set.
pub fn spawn_hr_listener(cfg: BleConfig, tx: Sender<(f64, HrMeasurement)>, stop: Arc<AtomicBool>) -> JoinHandle<()> {
    std::thread::Builder::new()
        .name("re-ble".into())
        .spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().expect("tokio runtime");
            while !stop.load(Ordering::Relaxed) {
                if let Err(e) = rt.block_on(session(&cfg, &tx, &stop)) {
                    eprintln!("[ble] {e}; retrying in 3 s");
                }
                for _ in 0..30 {
                    if stop.load(Ordering::Relaxed) {
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
            }
        })
        .expect("spawn ble thread")
}
