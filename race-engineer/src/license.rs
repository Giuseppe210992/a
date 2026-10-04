//! Access codes: signed, offline-verifiable, with an expiry.
//!
//! The owner creates codes with `tools/generatore-codici.html` (Ed25519 signature made in the
//! browser with a PRIVATE key that never leaves the owner's machine). This app only contains the
//! PUBLIC key (`license/pubkey.txt`, embedded at build time), so codes cannot be forged from the
//! executable. If the embedded key is empty, access control is OFF and the app starts directly.
//!
//! Code format: `RE1-` + Base32 (RFC 4648, no padding, grouped by 8 with dashes) of
//! `payload || signature`, payload (big-endian):
//! `version(1)=1 | issued_at u32 | expires_at u32 (0 = never) | flags u8 | id[8] | label_len u8 | label`
//! signature = Ed25519 over `"RE-ACCESS-v1" || payload`.
//!
//! Limits (by design of an offline scheme): a code cannot be revoked before it expires, and a
//! user who controls the PC could patch the program. Rolling the clock back is detected
//! (the latest time seen is stored); use short expiries for tight control.

use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

pub const PUBLIC_KEY_HEX: &str = include_str!("../license/pubkey.txt");
const DOMAIN: &[u8] = b"RE-ACCESS-v1";
const VERSION: u8 = 1;
const CLOCK_SLACK_S: u64 = 24 * 3600;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Licence {
    /// Hex of the 8 random bytes: lets the owner tell codes apart in the generator history.
    pub id: String,
    pub label: String,
    pub issued_at: u64,
    pub expires_at: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AccessError {
    Malformed,
    BadSignature,
    Expired(Licence),
    /// The system clock is earlier than a time this installation has already seen.
    ClockTampered,
}

impl AccessError {
    /// Support-friendly code, also used in error reports.
    pub fn code(&self) -> &'static str {
        match self {
            Self::Malformed => "RE-ACC-01",
            Self::BadSignature => "RE-ACC-02",
            Self::Expired(_) => "RE-ACC-03",
            Self::ClockTampered => "RE-ACC-04",
        }
    }

    pub fn message(&self) -> String {
        match self {
            Self::Malformed => "Codice non valido: controlla di averlo copiato per intero.".into(),
            Self::BadSignature => "Codice non valido (firma non riconosciuta da questa versione).".into(),
            Self::Expired(l) => format!("Codice scaduto il {}.", fmt_date(l.expires_at.unwrap_or(0))),
            Self::ClockTampered => "L'orologio del PC è indietro rispetto all'ultimo utilizzo: correggi data e ora.".into(),
        }
    }
}

pub fn now_s() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

/// `dd/mm/yyyy hh:mm` (UTC) without a date library.
pub fn fmt_date(unix: u64) -> String {
    let days = (unix / 86_400) as i64;
    let rem = unix % 86_400;
    // civil-from-days (Howard Hinnant)
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{d:02}/{m:02}/{y} {:02}:{:02} UTC", rem / 3600, (rem % 3600) / 60)
}

const B32: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

pub fn base32_encode(data: &[u8]) -> String {
    let (mut out, mut acc, mut bits) = (String::new(), 0u32, 0u32);
    for &b in data {
        acc = (acc << 8) | b as u32;
        bits += 8;
        while bits >= 5 {
            out.push(B32[((acc >> (bits - 5)) & 31) as usize] as char);
            bits -= 5;
        }
    }
    if bits > 0 {
        out.push(B32[((acc << (5 - bits)) & 31) as usize] as char);
    }
    out
}

pub fn base32_decode(s: &str) -> Option<Vec<u8>> {
    let (mut out, mut acc, mut bits) = (vec![], 0u32, 0u32);
    for c in s.bytes() {
        let v = B32.iter().position(|&x| x == c)? as u32;
        acc = (acc << 5) | v;
        bits += 5;
        if bits >= 8 {
            out.push((acc >> (bits - 8)) as u8);
            bits -= 8;
        }
    }
    Some(out)
}

pub fn verifying_key(hex: &str) -> Option<VerifyingKey> {
    let h = hex.trim();
    if h.len() != 64 {
        return None;
    }
    let mut k = [0u8; 32];
    for (i, b) in k.iter_mut().enumerate() {
        *b = u8::from_str_radix(h.get(2 * i..2 * i + 2)?, 16).ok()?;
    }
    VerifyingKey::from_bytes(&k).ok()
}

/// Access control is enforced only when a valid public key is embedded.
pub fn enforced() -> bool {
    verifying_key(PUBLIC_KEY_HEX).is_some()
}

/// Short fingerprint of the embedded key, to compare with the generator page.
pub fn key_fingerprint() -> String {
    PUBLIC_KEY_HEX.trim().chars().take(12).collect::<String>().to_uppercase()
}

fn normalise(code: &str) -> String {
    code.chars().filter(|c| !c.is_whitespace() && *c != '-').collect::<String>().to_ascii_uppercase()
}

/// Checks format and signature (no time checks).
pub fn parse_and_verify(code: &str, key: &VerifyingKey) -> Result<Licence, AccessError> {
    let n = normalise(code);
    let body = n.strip_prefix("RE1").ok_or(AccessError::Malformed)?;
    let raw = base32_decode(body).ok_or(AccessError::Malformed)?;
    if raw.len() < 19 + 64 || raw[0] != VERSION {
        return Err(AccessError::Malformed);
    }
    let label_len = raw[18] as usize;
    let payload_len = 19 + label_len;
    if raw.len() != payload_len + 64 {
        return Err(AccessError::Malformed);
    }
    let (payload, sig) = raw.split_at(payload_len);
    let sig = Signature::from_slice(sig).map_err(|_| AccessError::Malformed)?;
    let mut msg = DOMAIN.to_vec();
    msg.extend_from_slice(payload);
    key.verify(&msg, &sig).map_err(|_| AccessError::BadSignature)?;
    let u32_at = |o: usize| u32::from_be_bytes(payload[o..o + 4].try_into().unwrap()) as u64;
    let expires = u32_at(5);
    Ok(Licence {
        id: payload[10..18].iter().map(|b| format!("{b:02x}")).collect(),
        label: String::from_utf8_lossy(&payload[19..]).into_owned(),
        issued_at: u32_at(1),
        expires_at: (expires != 0).then_some(expires),
    })
}

/// Full check: signature, expiry and clock tampering (`last_seen` = latest time seen so far).
pub fn check(code: &str, now: u64, last_seen: u64, key: &VerifyingKey) -> Result<Licence, AccessError> {
    let lic = parse_and_verify(code, key)?;
    if now + CLOCK_SLACK_S < last_seen {
        return Err(AccessError::ClockTampered);
    }
    if lic.expires_at.is_some_and(|e| now >= e) {
        return Err(AccessError::Expired(lic));
    }
    Ok(lic)
}

fn dir() -> PathBuf {
    crate::diag::data_dir()
}

pub fn load_saved_code() -> Option<String> {
    std::fs::read_to_string(dir().join("access-code.txt")).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

pub fn save_code(code: &str) {
    let _ = std::fs::write(dir().join("access-code.txt"), code.trim());
}

pub fn forget_code() {
    let _ = std::fs::remove_file(dir().join("access-code.txt"));
}

fn last_seen() -> u64 {
    std::fs::read_to_string(dir().join("last-seen.txt")).ok().and_then(|s| s.trim().parse().ok()).unwrap_or(0)
}

fn touch(now: u64) {
    if now > last_seen() {
        let _ = std::fs::write(dir().join("last-seen.txt"), now.to_string());
    }
}

/// Validates `code` against the embedded key, updating the stored "latest time seen".
/// When access control is off every call succeeds with an open licence.
pub fn validate(code: &str) -> Result<Licence, AccessError> {
    let Some(key) = verifying_key(PUBLIC_KEY_HEX) else {
        return Ok(Licence { id: String::new(), label: "accesso libero".into(), issued_at: 0, expires_at: None });
    };
    let now = now_s();
    let r = check(code, now, last_seen(), &key);
    if r.is_ok() {
        touch(now);
    }
    r
}

/// Outcome of the start-up check with the code stored on this PC.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Startup {
    Open,
    Granted(Licence),
    NeedsCode(Option<AccessError>),
}

pub fn startup() -> Startup {
    if !enforced() {
        return Startup::Open;
    }
    match load_saved_code() {
        None => Startup::NeedsCode(None),
        Some(c) => match validate(&c) {
            Ok(l) => Startup::Granted(l),
            Err(e) => Startup::NeedsCode(Some(e)),
        },
    }
}

#[cfg(test)]
pub mod testing {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    pub fn key(seed: u8) -> SigningKey {
        SigningKey::from_bytes(&[seed; 32])
    }

    /// Issues a code exactly like the HTML generator does.
    pub fn issue(sk: &SigningKey, issued: u32, expires: u32, label: &str, id: [u8; 8]) -> String {
        let mut p = vec![VERSION];
        p.extend(issued.to_be_bytes());
        p.extend(expires.to_be_bytes());
        p.push(0);
        p.extend(id);
        p.push(label.len() as u8);
        p.extend(label.as_bytes());
        let mut msg = DOMAIN.to_vec();
        msg.extend(&p);
        let sig = sk.sign(&msg);
        p.extend(sig.to_bytes());
        let b = base32_encode(&p);
        let groups: Vec<&str> = b.as_bytes().chunks(8).map(|c| std::str::from_utf8(c).unwrap()).collect();
        format!("RE1-{}", groups.join("-"))
    }
}

#[cfg(test)]
mod tests {
    use super::testing::*;
    use super::*;

    const NOW: u64 = 1_800_000_000; // 2027-01-15

    #[test]
    fn base32_roundtrip_all_lengths() {
        for n in 0..40usize {
            let d: Vec<u8> = (0..n).map(|i| (i * 37 + 11) as u8).collect();
            assert_eq!(base32_decode(&base32_encode(&d)).unwrap(), d, "len {n}");
        }
        assert!(base32_decode("abc").is_none(), "lowercase / invalid alphabet rejected (input is normalised first)");
    }

    #[test]
    fn valid_code_with_expiry_label_and_id() {
        let sk = key(7);
        let code = issue(&sk, (NOW - 100) as u32, (NOW + 5 * 86_400) as u32, "Mario Rossi", [1, 2, 3, 4, 5, 6, 7, 8]);
        let l = check(&code, NOW, 0, &sk.verifying_key()).unwrap();
        assert_eq!(l.label, "Mario Rossi");
        assert_eq!(l.id, "0102030405060708");
        assert_eq!(l.expires_at, Some(NOW + 5 * 86_400));
        // robust to the way users paste codes: lowercase, spaces, line breaks, missing dashes
        let messy = format!(" {}\n", code.to_lowercase().replace('-', " "));
        assert_eq!(check(&messy, NOW, 0, &sk.verifying_key()).unwrap(), l);
    }

    #[test]
    fn never_expiring_code() {
        let sk = key(7);
        let code = issue(&sk, 1_700_000_000, 0, "", [9; 8]);
        let l = check(&code, NOW + 10 * 365 * 86_400, 0, &sk.verifying_key()).unwrap();
        assert_eq!(l.expires_at, None);
    }

    #[test]
    fn expired_code_is_rejected_exactly_at_expiry() {
        let sk = key(7);
        let exp = (NOW + 1000) as u32;
        let code = issue(&sk, NOW as u32, exp, "x", [3; 8]);
        assert!(check(&code, NOW + 999, 0, &sk.verifying_key()).is_ok());
        let e = check(&code, NOW + 1000, 0, &sk.verifying_key()).unwrap_err();
        assert!(matches!(e, AccessError::Expired(_)));
        assert_eq!(e.code(), "RE-ACC-03");
        assert!(e.message().contains("scaduto"));
    }

    #[test]
    fn forged_tampered_and_foreign_codes_fail() {
        let owner = key(7);
        let other = key(8);
        let code = issue(&owner, NOW as u32, 0, "a", [1; 8]);
        // signed by someone else
        let foreign = issue(&other, NOW as u32, 0, "a", [1; 8]);
        assert_eq!(check(&foreign, NOW, 0, &owner.verifying_key()).unwrap_err(), AccessError::BadSignature);
        // extend the expiry by editing a payload byte: signature no longer matches
        let n = normalise(&code);
        let mut raw = base32_decode(&n[3..]).unwrap();
        raw[5] = 0xFF; // expires_at high byte (was 0 = never -> now far future)
        let edited = format!("RE1{}", base32_encode(&raw));
        assert_eq!(check(&edited, NOW, 0, &owner.verifying_key()).unwrap_err(), AccessError::BadSignature);
        // garbage and truncation
        for bad in ["", "hello", "RE1", "RE1-AAAA", &code[..code.len() - 9]] {
            assert!(matches!(check(bad, NOW, 0, &owner.verifying_key()), Err(AccessError::Malformed | AccessError::BadSignature)), "{bad:?}");
        }
    }

    #[test]
    fn clock_rolled_back_more_than_a_day_is_detected() {
        let sk = key(7);
        let code = issue(&sk, 1_700_000_000, (NOW + 30 * 86_400) as u32, "c", [4; 8]);
        // last seen 10 days in the future relative to "now": the user set the clock back
        let e = check(&code, NOW, NOW + 10 * 86_400, &sk.verifying_key()).unwrap_err();
        assert_eq!(e, AccessError::ClockTampered);
        // small differences (time zone changes, DST, drift) are tolerated
        assert!(check(&code, NOW, NOW + 3600, &sk.verifying_key()).is_ok());
    }

    /// Codes produced by tools/generatore-codici.html (real Chromium) with the test seed [7; 32]:
    /// guards against the JavaScript and Rust implementations drifting apart.
    #[test]
    fn codes_made_by_the_html_generator_verify_here() {
        let key = key(7).verifying_key();
        assert_eq!(base32_encode(&[0]), "AA");
        let hexkey: String = key.to_bytes().iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(hexkey, "ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c", "the generator derived the same public key from the seed");
        let never = "RE1-AFSVH4IA-AAAAAAAA-SB3TDMRH-LTUFGB3W-MV2HI33S-MX3A36ZH-JAUK6QYD-UUQUDKAX-CN65PABC-HXTQEJR3-YCJ6CHNH-DKMQESPL-2LLREYLG-M4MR4KZQ-MFCYPDWD-AOXE34JN-UK6MEEVM-JC7JPJQA";
        let l = check(never, NOW, 0, &key).unwrap();
        assert_eq!((l.label.as_str(), l.expires_at, l.issued_at), ("vettore", None, 1_700_000_000));
        assert_eq!(l.id, "907731b2275ce853");
        let dated = "RE1-AFVLCO4A-NNE5EAAA-E56COB6R-54ID6C2N-MFZGS3ZA-KJXXG43J-AD55DJHG-ZAS7IUR4-3LSJIRTM-JLK5NLHF-2JHGOOSJ-27NEIYKG-NGYCVNN3-U3QOA43I-ORADPKJ5-F7Z6P6RF-5VHZ62HE-CYCDNYIO-HHR3SAQ";
        let l = check(dated, 1_799_999_999, 0, &key).unwrap();
        assert_eq!((l.label.as_str(), l.expires_at), ("Mario Rossi", Some(1_800_000_000)));
        assert!(matches!(check(dated, 1_800_000_000, 0, &key), Err(AccessError::Expired(_))));
    }

    #[test]
    fn date_formatting() {
        assert_eq!(fmt_date(0), "01/01/1970 00:00 UTC");
        assert_eq!(fmt_date(1_800_000_000), "15/01/2027 08:00 UTC");
        assert_eq!(fmt_date(951_782_400), "29/02/2000 00:00 UTC", "leap day");
    }

    #[test]
    fn embedded_key_is_a_valid_public_key() {
        assert!(enforced(), "release builds ship with a public key");
        assert_eq!(key_fingerprint().len(), 12);
    }
}
