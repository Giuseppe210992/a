//! Windows audio sinks. Both talk to the local OS only; no network.
//!
//! * `TtsSink` (feature `tts`): Windows speech synthesis for free-form sentences.
//! * `ClipSink` (feature `audio`): pre-decoded WAV buffers for the critical calls, played
//!   through the default Windows output device, with TTS as fallback for everything else.
//!   Put `brake.wav`, `lift.wav`, `throttle.wav`, `attention.wav` in a `clips/` folder.
//!   Latency of this path (and of TTS) must be measured on the target PC.

#[cfg(feature = "tts")]
mod tts_impl {
    use crate::voice::{AudioSink, Priority, Utterance};

    pub struct TtsSink {
        tts: tts::Tts,
    }

    impl TtsSink {
        pub fn new() -> Result<Self, tts::Error> {
            Ok(Self { tts: tts::Tts::default()? })
        }
    }

    impl AudioSink for TtsSink {
        fn play(&mut self, u: &Utterance) {
            let _ = self.tts.speak(&u.text, u.priority >= Priority::High);
        }
        fn stop(&mut self) {
            let _ = self.tts.stop();
        }
        fn is_busy(&mut self) -> bool {
            self.tts.is_speaking().unwrap_or(false)
        }
    }
}
#[cfg(feature = "tts")]
pub use tts_impl::TtsSink;

#[cfg(feature = "audio")]
mod clip_impl {
    use crate::voice::{AudioSink, Clip, Utterance};
    use rodio::{buffer::SamplesBuffer, Decoder, OutputStream, OutputStreamHandle, Sink, Source};
    use std::collections::HashMap;
    use std::path::Path;

    struct Decoded {
        channels: u16,
        rate: u32,
        samples: Vec<f32>,
    }

    pub struct ClipSink<F: AudioSink> {
        _stream: OutputStream,
        handle: OutputStreamHandle,
        clips: HashMap<Clip, Decoded>,
        playing: Option<Sink>,
        fallback: F,
    }

    impl<F: AudioSink> ClipSink<F> {
        pub fn new(dir: &Path, fallback: F) -> Result<Self, Box<dyn std::error::Error>> {
            let (_stream, handle) = OutputStream::try_default()?;
            let mut clips = HashMap::new();
            for c in [Clip::Brake, Clip::Lift, Clip::Throttle, Clip::Attention] {
                let path = dir.join(format!("{}.wav", c.file_stem()));
                if let Ok(file) = std::fs::File::open(&path) {
                    let dec = Decoder::new(std::io::BufReader::new(file))?;
                    let (channels, rate) = (dec.channels(), dec.sample_rate());
                    clips.insert(c, Decoded { channels, rate, samples: dec.convert_samples::<f32>().collect() });
                }
            }
            Ok(Self { _stream, handle, clips, playing: None, fallback })
        }
    }

    impl<F: AudioSink> AudioSink for ClipSink<F> {
        fn play(&mut self, u: &Utterance) {
            if let Some(d) = u.clip.and_then(|c| self.clips.get(&c)) {
                self.fallback.stop();
                if let Ok(sink) = Sink::try_new(&self.handle) {
                    sink.append(SamplesBuffer::new(d.channels, d.rate, d.samples.clone()));
                    self.playing = Some(sink);
                    return;
                }
            }
            self.fallback.play(u);
        }
        fn stop(&mut self) {
            if let Some(s) = self.playing.take() {
                s.stop();
            }
            self.fallback.stop();
        }
        fn is_busy(&mut self) -> bool {
            self.playing.as_ref().is_some_and(|s| !s.empty()) || self.fallback.is_busy()
        }
    }
}
#[cfg(feature = "audio")]
pub use clip_impl::ClipSink;
