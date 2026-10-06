//! Configurable dashboard layout: every panel can sit in the left column, the right column or be
//! hidden, column widths and the bottom strip are adjustable, and the choice is remembered in
//! `layout.txt`. Pure data (no egui), so it can be unit-tested.

use std::path::PathBuf;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Slot {
    Left,
    Right,
    Hidden,
}

impl Slot {
    fn key(self) -> &'static str {
        match self {
            Slot::Left => "left",
            Slot::Right => "right",
            Slot::Hidden => "hidden",
        }
    }
    fn parse(s: &str) -> Option<Self> {
        [Slot::Left, Slot::Right, Slot::Hidden].into_iter().find(|x| x.key() == s)
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Pane {
    Car,
    Tyres,
    Heart,
    Setup,
    Hints,
    Engineer,
}

impl Pane {
    pub const ALL: [Pane; 6] = [Pane::Car, Pane::Tyres, Pane::Heart, Pane::Setup, Pane::Hints, Pane::Engineer];

    pub fn label(self) -> &'static str {
        match self {
            Pane::Car => "Vettura",
            Pane::Tyres => "Gomme",
            Pane::Heart => "Pilota · battito",
            Pane::Setup => "Setup corrente",
            Pane::Hints => "Suggerimenti",
            Pane::Engineer => "Race Engineer (messaggi)",
        }
    }

    fn key(self) -> &'static str {
        match self {
            Pane::Car => "car",
            Pane::Tyres => "tyres",
            Pane::Heart => "heart",
            Pane::Setup => "setup",
            Pane::Hints => "hints",
            Pane::Engineer => "engineer",
        }
    }
}

pub const LEFT_W: std::ops::RangeInclusive<f32> = 140.0..=520.0;
pub const BOTTOM_H: std::ops::RangeInclusive<f32> = 70.0..=400.0;

#[derive(Clone, Debug, PartialEq)]
pub struct Layout {
    pub slots: [Slot; 6],
    pub left_w: f32,
    pub right_w: f32,
    /// Speed/pedal traces strip under the map.
    pub bottom: bool,
    pub bottom_h: f32,
    /// Lap / time / delta tiles above the map.
    pub times: bool,
    /// Top bar without latency, dropped frames and fps picker.
    pub compact_top: bool,
    /// Temporary "map only" view; not saved.
    pub focus: bool,
}

impl Default for Layout {
    fn default() -> Self {
        Self::full()
    }
}

impl Layout {
    pub fn slot(&self, p: Pane) -> Slot {
        self.slots[p as usize]
    }

    pub fn set_slot(&mut self, p: Pane, s: Slot) {
        self.slots[p as usize] = s;
    }

    /// Whether the given column has to be drawn.
    pub fn column(&self, s: Slot) -> bool {
        !self.focus && Pane::ALL.iter().any(|p| self.slot(*p) == s)
    }

    pub fn show_bottom(&self) -> bool {
        !self.focus && self.bottom
    }

    /// Everything visible (the original layout).
    pub fn full() -> Self {
        Self {
            slots: [Slot::Left, Slot::Left, Slot::Right, Slot::Right, Slot::Right, Slot::Right],
            left_w: 300.0,
            right_w: 330.0,
            bottom: true,
            bottom_h: 170.0,
            times: true,
            compact_top: false,
            focus: false,
        }
    }

    /// Big central map: only speed/gear on the left and the messages on the right, both narrow.
    pub fn big_map() -> Self {
        Self {
            slots: [Slot::Left, Slot::Hidden, Slot::Hidden, Slot::Hidden, Slot::Hidden, Slot::Right],
            left_w: 200.0,
            right_w: 230.0,
            bottom: true,
            bottom_h: 110.0,
            times: true,
            compact_top: true,
            focus: false,
        }
    }

    /// Nothing but the map and the time tiles.
    pub fn map_only() -> Self {
        Self { slots: [Slot::Hidden; 6], bottom: false, times: true, compact_top: true, ..Self::full() }
    }

    pub const PRESETS: [(&'static str, fn() -> Layout); 3] = [("Completo", Layout::full), ("Mappa grande", Layout::big_map), ("Solo mappa", Layout::map_only)];

    fn path() -> PathBuf {
        crate::diag::data_dir().join("layout.txt")
    }

    pub fn to_text(&self) -> String {
        let mut t = String::new();
        for p in Pane::ALL {
            t += &format!("pane.{}={}\n", p.key(), self.slot(p).key());
        }
        t += &format!(
            "left_w={}\nright_w={}\nbottom={}\nbottom_h={}\ntimes={}\ncompact_top={}\n",
            self.left_w, self.right_w, self.bottom, self.bottom_h, self.times, self.compact_top
        );
        t
    }

    /// Unknown or invalid lines are ignored; numbers are clamped to sane ranges.
    pub fn from_text(text: &str) -> Self {
        let mut l = Self::full();
        for line in text.lines() {
            let Some((k, v)) = line.split_once('=') else { continue };
            let (k, v) = (k.trim(), v.trim());
            if let Some(name) = k.strip_prefix("pane.") {
                if let (Some(p), Some(s)) = (Pane::ALL.into_iter().find(|p| p.key() == name), Slot::parse(v)) {
                    l.set_slot(p, s);
                }
                continue;
            }
            let num = |lo: f32, hi: f32| v.parse::<f32>().ok().filter(|x| x.is_finite()).map(|x| x.clamp(lo, hi));
            match k {
                "left_w" => l.left_w = num(*LEFT_W.start(), *LEFT_W.end()).unwrap_or(l.left_w),
                "right_w" => l.right_w = num(*LEFT_W.start(), *LEFT_W.end()).unwrap_or(l.right_w),
                "bottom_h" => l.bottom_h = num(*BOTTOM_H.start(), *BOTTOM_H.end()).unwrap_or(l.bottom_h),
                "bottom" => l.bottom = v == "true",
                "times" => l.times = v == "true",
                "compact_top" => l.compact_top = v == "true",
                _ => {}
            }
        }
        l
    }

    pub fn load() -> Self {
        std::fs::read_to_string(Self::path()).map(|t| Self::from_text(&t)).unwrap_or_default()
    }

    pub fn save(&self) {
        let _ = std::fs::write(Self::path(), self.to_text());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_roundtrip() {
        for l in [Layout::full(), Layout::big_map(), Layout::map_only()] {
            assert_eq!(Layout::from_text(&l.to_text()), l);
        }
    }

    #[test]
    fn bad_input_is_ignored_and_clamped() {
        let l = Layout::from_text("pane.car=sideways\npane.nope=left\nleft_w=99999\nright_w=abc\nbottom_h=1\ngarbage\n");
        assert_eq!(l.slot(Pane::Car), Slot::Left, "invalid slot keeps the default");
        assert_eq!(l.left_w, *LEFT_W.end());
        assert_eq!(l.right_w, Layout::full().right_w);
        assert_eq!(l.bottom_h, *BOTTOM_H.start());
    }

    #[test]
    fn columns_follow_slots_and_focus() {
        let mut l = Layout::map_only();
        assert!(!l.column(Slot::Left) && !l.column(Slot::Right) && !l.show_bottom());
        l.set_slot(Pane::Engineer, Slot::Left);
        assert!(l.column(Slot::Left) && !l.column(Slot::Right));
        l.bottom = true;
        assert!(l.show_bottom());
        l.focus = true;
        assert!(!l.column(Slot::Left) && !l.show_bottom(), "focus hides every panel");
    }
}
