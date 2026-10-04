//! Voice commands: the closed phrase set (Italian + English) and what each one does.
//! Recognition itself is a separate component (`stt`, Windows speech recognizer); this module
//! is pure so the mapping can be tested everywhere.

use crate::runtime::EngineerMode;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VoiceCommand {
    SetMode(EngineerMode),
    Mute(bool),
    /// Spoken summary: best lap, delta, tyres, heart rate.
    Status,
}

const TABLE: &[(&str, VoiceCommand)] = &[
    ("silenzio", VoiceCommand::SetMode(EngineerMode::Silent)),
    ("zitto", VoiceCommand::SetMode(EngineerMode::Silent)),
    ("silent", VoiceCommand::SetMode(EngineerMode::Silent)),
    ("solo critici", VoiceCommand::SetMode(EngineerMode::CriticalOnly)),
    ("solo chiamate critiche", VoiceCommand::SetMode(EngineerMode::CriticalOnly)),
    ("critical only", VoiceCommand::SetMode(EngineerMode::CriticalOnly)),
    ("completo", VoiceCommand::SetMode(EngineerMode::Full)),
    ("parla", VoiceCommand::SetMode(EngineerMode::Full)),
    ("riattiva", VoiceCommand::SetMode(EngineerMode::Full)),
    ("full", VoiceCommand::SetMode(EngineerMode::Full)),
    ("muto", VoiceCommand::Mute(true)),
    ("mute", VoiceCommand::Mute(true)),
    ("voce attiva", VoiceCommand::Mute(false)),
    ("unmute", VoiceCommand::Mute(false)),
    ("stato", VoiceCommand::Status),
    ("situazione", VoiceCommand::Status),
    ("status", VoiceCommand::Status),
];

/// All phrases the recognizer is asked to listen for.
pub fn phrases() -> Vec<&'static str> {
    TABLE.iter().map(|(p, _)| *p).collect()
}

pub fn parse_phrase(text: &str) -> Option<VoiceCommand> {
    let t = text.trim().trim_end_matches(['.', '!', '?']).to_lowercase();
    TABLE.iter().find(|(p, _)| *p == t).map(|(_, c)| *c)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_phrases_case_and_punctuation_insensitively() {
        assert_eq!(parse_phrase("Silenzio."), Some(VoiceCommand::SetMode(EngineerMode::Silent)));
        assert_eq!(parse_phrase("  solo critici "), Some(VoiceCommand::SetMode(EngineerMode::CriticalOnly)));
        assert_eq!(parse_phrase("STATUS"), Some(VoiceCommand::Status));
        assert_eq!(parse_phrase("voce attiva"), Some(VoiceCommand::Mute(false)));
        assert_eq!(parse_phrase("frena"), None);
        assert_eq!(parse_phrase(""), None);
    }

    #[test]
    fn every_listed_phrase_parses_to_itself() {
        for p in phrases() {
            assert!(parse_phrase(p).is_some(), "{p}");
        }
    }
}
