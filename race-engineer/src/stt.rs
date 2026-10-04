//! Offline voice commands with the Windows speech recognizer (WinRT `SpeechRecognizer`,
//! list constraint = the closed phrase set in `commands`). EXPERIMENTAL: written against the
//! public API but not yet run on a Windows machine. Needs a microphone, microphone access for
//! desktop apps, and a speech language pack matching the phrases (Italian or English).
//! Any failure is reported through `diag` and never affects telemetry or audio output.

use std::sync::mpsc::Sender;

use crate::commands::VoiceCommand;

#[cfg(windows)]
pub fn start(tx: Sender<VoiceCommand>) -> Result<SttHandle, String> {
    use windows_collections::IIterable;
    use windows::Foundation::TypedEventHandler;
    use windows::Media::SpeechRecognition::*;
    use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};
    use windows::core::HSTRING;

    let e = |ctx: &str, err: windows::core::Error| format!("{ctx}: {err}");
    // Runs on the caller's thread; the recognizer keeps its own callbacks afterwards.
    let _ = unsafe { RoInitialize(RO_INIT_MULTITHREADED) };
    let recognizer = SpeechRecognizer::new().map_err(|x| e("riconoscitore vocale non disponibile", x))?;
    let phrases: Vec<HSTRING> = crate::commands::phrases().into_iter().map(HSTRING::from).collect();
    let list = SpeechRecognitionListConstraint::Create(&IIterable::<HSTRING>::from(phrases)).map_err(|x| e("elenco comandi", x))?;
    recognizer.Constraints().map_err(|x| e("vincoli", x))?.Append(&list).map_err(|x| e("vincoli", x))?;
    let compiled = recognizer.CompileConstraintsAsync().map_err(|x| e("compilazione comandi", x))?.join().map_err(|x| e("compilazione comandi", x))?;
    if compiled.Status().map_err(|x| e("compilazione comandi", x))? != SpeechRecognitionResultStatus::Success {
        return Err("compilazione dei comandi vocali non riuscita (lingua del riconoscimento vocale non installata?)".into());
    }
    let session = recognizer.ContinuousRecognitionSession().map_err(|x| e("sessione", x))?;
    session
        .ResultGenerated(&TypedEventHandler::new(move |_, args: windows::core::Ref<SpeechContinuousRecognitionResultGeneratedEventArgs>| {
            if let Some(args) = args.as_ref() {
                let r = args.Result()?;
                let ok = matches!(r.Confidence()?, SpeechRecognitionConfidence::High | SpeechRecognitionConfidence::Medium);
                if ok {
                    if let Some(cmd) = crate::commands::parse_phrase(&r.Text()?.to_string()) {
                        let _ = tx.send(cmd);
                    }
                }
            }
            Ok(())
        }))
        .map_err(|x| e("evento di riconoscimento", x))?;
    session.StartAsync().map_err(|x| e("avvio ascolto", x))?.join().map_err(|x| e("avvio ascolto (microfono non consentito?)", x))?;
    Ok(SttHandle { recognizer })
}

/// Keeps the recognizer alive; stops listening when dropped.
#[cfg(windows)]
pub struct SttHandle {
    recognizer: windows::Media::SpeechRecognition::SpeechRecognizer,
}

#[cfg(windows)]
impl Drop for SttHandle {
    fn drop(&mut self) {
        if let Ok(s) = self.recognizer.ContinuousRecognitionSession() {
            if let Ok(op) = s.StopAsync() {
                let _ = op.join();
            }
        }
    }
}

#[cfg(not(windows))]
pub struct SttHandle;

#[cfg(not(windows))]
pub fn start(_tx: Sender<VoiceCommand>) -> Result<SttHandle, String> {
    Err("il riconoscimento vocale richiede Windows".into())
}
