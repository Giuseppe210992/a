//! Voice engine: priority queue + audio sink abstraction.
//!
//! Latency design: critical calls ("Frena!", "Gas!", "Rilascia!", "Attenzione!") carry a
//! [`Clip`] id so a sink can play a pre-rendered, already-decoded audio buffer straight to
//! the Windows audio device, without going through speech synthesis. They preempt anything
//! less urgent that is currently being spoken and expire quickly: a "Frena!" that would
//! play after the braking point is worse than silence, so it is dropped.

use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::time::Duration;

use crate::clock::monotonic_s;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Priority {
    Low,
    Normal,
    High,
    Critical,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Clip {
    Brake,
    Lift,
    Throttle,
    Attention,
}

impl Clip {
    /// File stem looked up by clip-capable sinks (e.g. `clips/brake.wav`).
    pub fn file_stem(self) -> &'static str {
        match self {
            Clip::Brake => "brake",
            Clip::Lift => "lift",
            Clip::Throttle => "throttle",
            Clip::Attention => "attention",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Utterance {
    pub priority: Priority,
    pub text: String,
    pub clip: Option<Clip>,
    pub created_s: f64,
    /// Seconds after creation beyond which the message is no longer worth saying.
    pub ttl_s: f64,
}

impl Utterance {
    pub fn critical(clip: Clip, text: &str, now: f64) -> Self {
        Self { priority: Priority::Critical, text: text.into(), clip: Some(clip), created_s: now, ttl_s: 0.5 }
    }
    pub fn new(priority: Priority, text: impl Into<String>, now: f64) -> Self {
        let ttl_s = match priority {
            Priority::Critical => 0.5,
            Priority::High => 2.0,
            Priority::Normal => 8.0,
            Priority::Low => 20.0,
        };
        Self { priority, text: text.into(), clip: None, created_s: now, ttl_s }
    }
    fn expired(&self, now: f64) -> bool {
        now - self.created_s > self.ttl_s
    }
}

#[derive(Default)]
pub struct VoiceQueue {
    items: Vec<Utterance>,
}

impl VoiceQueue {
    pub fn push(&mut self, u: Utterance) {
        // A repeated critical clip already waiting adds nothing.
        if let Some(c) = u.clip {
            if self.items.iter().any(|x| x.clip == Some(c)) {
                return;
            }
        }
        self.items.push(u);
    }

    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    fn purge(&mut self, now: f64) {
        self.items.retain(|u| !u.expired(now));
    }

    /// Highest priority first, oldest first within a priority. Expired items are dropped.
    pub fn pop_next(&mut self, now: f64) -> Option<Utterance> {
        self.purge(now);
        let best = self
            .items
            .iter()
            .enumerate()
            .max_by(|(_, a), (_, b)| a.priority.cmp(&b.priority).then(b.created_s.total_cmp(&a.created_s)))
            .map(|(i, _)| i)?;
        Some(self.items.remove(best))
    }

    /// True if something more urgent than `current` is waiting.
    pub fn more_urgent_than(&mut self, current: Priority, now: f64) -> bool {
        self.purge(now);
        self.items.iter().any(|u| u.priority > current)
    }
}

pub trait AudioSink {
    fn play(&mut self, u: &Utterance);
    fn stop(&mut self);
    fn is_busy(&mut self) -> bool;
}

/// Prints instead of speaking: used for headless runs and tests.
#[derive(Default)]
pub struct ConsoleSink;

impl AudioSink for ConsoleSink {
    fn play(&mut self, u: &Utterance) {
        println!("[VOICE {:?}] {}", u.priority, u.text);
    }
    fn stop(&mut self) {}
    fn is_busy(&mut self) -> bool {
        false
    }
}

/// Runs until the sender side of `rx` is dropped.
pub fn run_voice_loop(rx: Receiver<Utterance>, mut sink: Box<dyn AudioSink>) {
    let mut queue = VoiceQueue::default();
    let mut playing: Option<Priority> = None;
    loop {
        match rx.recv_timeout(Duration::from_millis(5)) {
            Ok(u) => queue.push(u),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
        while let Ok(u) = rx.try_recv() {
            queue.push(u);
        }
        let now = monotonic_s();
        if playing.is_some() && !sink.is_busy() {
            playing = None;
        }
        if let Some(cur) = playing {
            if queue.more_urgent_than(cur, now) {
                sink.stop();
                playing = None;
            }
        }
        if playing.is_none() {
            if let Some(u) = queue.pop_next(now) {
                sink.play(&u);
                playing = Some(u.priority);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn orders_by_priority_then_age() {
        let mut q = VoiceQueue::default();
        q.push(Utterance::new(Priority::Low, "low", 0.0));
        q.push(Utterance::new(Priority::Normal, "n1", 0.1));
        q.push(Utterance::new(Priority::Normal, "n2", 0.2));
        q.push(Utterance::critical(Clip::Brake, "Frena!", 0.3));
        let order: Vec<String> = std::iter::from_fn(|| q.pop_next(0.4)).map(|u| u.text).collect();
        assert_eq!(order, ["Frena!", "n1", "n2", "low"]);
    }

    #[test]
    fn expired_messages_are_dropped_not_spoken_late() {
        let mut q = VoiceQueue::default();
        q.push(Utterance::critical(Clip::Brake, "Frena!", 0.0));
        assert!(q.pop_next(0.6).is_none(), "critical ttl is 0.5 s");
        q.push(Utterance::new(Priority::Normal, "info", 0.0));
        assert!(q.pop_next(7.0).is_some());
    }

    #[test]
    fn duplicate_clip_is_collapsed_and_preemption_detected() {
        let mut q = VoiceQueue::default();
        q.push(Utterance::critical(Clip::Brake, "Frena!", 0.0));
        q.push(Utterance::critical(Clip::Brake, "Frena!", 0.01));
        assert_eq!(q.len(), 1);
        assert!(q.more_urgent_than(Priority::Normal, 0.1));
        assert!(!q.more_urgent_than(Priority::Critical, 0.1));
    }
}
