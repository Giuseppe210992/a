//! Track model learned from recorded laps: corners, live delta, per-corner lap comparison.
//! Nothing here needs a track database: everything is derived from the driver's own laps.

use crate::recorder::{Lap, Sample};

#[derive(Debug, Clone, PartialEq)]
pub struct Corner {
    /// 1-based, in lap order.
    pub number: u32,
    pub start_pct: f32,
    pub apex_pct: f32,
    pub end_pct: f32,
    pub apex_speed_ms: f32,
}

#[derive(Debug, Clone, Default)]
pub struct TrackModel {
    pub length_m: f32,
    /// (track position, local position in metres) of the reference lap, for the map.
    pub path: Vec<(f32, [f32; 2])>,
    pub corners: Vec<Corner>,
    pub brake_zones: Vec<crate::engineer::BrakeZone>,
}

const WINDOW_PCT: f32 = 0.08;
const MIN_PROMINENCE_MS: f32 = 2.2; // ~8 km/h
const DEDUP_PCT: f32 = 0.02;

fn smoothed(samples: &[Sample]) -> Vec<f32> {
    let n = samples.len();
    (0..n)
        .map(|i| {
            let (a, b) = (i.saturating_sub(2), (i + 3).min(n));
            samples[a..b].iter().map(|s| s.speed_ms).sum::<f32>() / (b - a) as f32
        })
        .collect()
}

/// Corners = speed minima with enough prominence on both sides; extent = where speed
/// has recovered half of the prominence.
pub fn detect_corners(lap: &Lap) -> Vec<Corner> {
    let s = &lap.samples;
    if s.len() < 20 {
        return vec![];
    }
    let v = smoothed(s);
    let mut found: Vec<(usize, f32)> = vec![];
    for i in 0..s.len() {
        let p = s[i].pct;
        let (mut left_max, mut right_max, mut is_min) = (v[i], v[i], true);
        for (j, &vj) in v.iter().enumerate() {
            let d = s[j].pct - p;
            if d.abs() <= DEDUP_PCT && vj < v[i] {
                is_min = false;
                break;
            }
            if (-WINDOW_PCT..=0.0).contains(&d) {
                left_max = left_max.max(vj);
            }
            if (0.0..=WINDOW_PCT).contains(&d) {
                right_max = right_max.max(vj);
            }
        }
        let prom = left_max.min(right_max) - v[i];
        if is_min && prom >= MIN_PROMINENCE_MS {
            if found.last().is_some_and(|&(k, _)| s[i].pct - s[k].pct < DEDUP_PCT) {
                continue;
            }
            found.push((i, prom));
        }
    }
    found
        .into_iter()
        .enumerate()
        .map(|(n, (i, prom))| {
            let thr = v[i] + 0.5 * prom;
            let mut a = i;
            while a > 0 && v[a] < thr {
                a -= 1;
            }
            let mut b = i;
            while b + 1 < s.len() && v[b] < thr {
                b += 1;
            }
            Corner { number: n as u32 + 1, start_pct: s[a].pct, apex_pct: s[i].pct, end_pct: s[b].pct, apex_speed_ms: v[i] }
        })
        .collect()
}

/// Lap time at track position `pct` on `lap`, linearly interpolated.
pub fn time_at(lap: &Lap, pct: f32) -> Option<f32> {
    let s = &lap.samples;
    let i = s.partition_point(|x| x.pct < pct);
    if i == 0 || i >= s.len() {
        return None;
    }
    let (a, b) = (&s[i - 1], &s[i]);
    let span = b.pct - a.pct;
    if span <= 0.0 {
        return Some(b.lap_t);
    }
    Some(a.lap_t + (b.lap_t - a.lap_t) * (pct - a.pct) / span)
}

/// Live delta: positive = slower than the reference lap at this point.
pub fn live_delta(reference: &Lap, pct: f32, lap_time_s: f32) -> Option<f32> {
    Some(lap_time_s - time_at(reference, pct)?)
}

/// Time spent in each reference corner, lap vs reference (positive = this lap lost time).
pub fn corner_deltas(reference: &Lap, lap: &Lap, corners: &[Corner]) -> Vec<Option<f32>> {
    corners
        .iter()
        .map(|c| {
            let span = |l: &Lap| Some(time_at(l, c.end_pct)? - time_at(l, c.start_pct)?);
            Some(span(lap)? - span(reference)?)
        })
        .collect()
}

pub fn corner_at(corners: &[Corner], pct: f32) -> Option<&Corner> {
    corners.iter().find(|c| pct >= c.start_pct && pct <= c.end_pct)
}

pub fn path_of(lap: &Lap) -> Vec<(f32, [f32; 2])> {
    lap.samples.iter().filter_map(|s| s.pos.map(|p| (s.pct, p))).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sources::sim::SyntheticCar;

    fn lap(offset: f32, from_pct: f32) -> Lap {
        let mut car = SyntheticCar::default();
        let mut rec = crate::recorder::LapRecorder::new();
        loop {
            if let Some(mut l) = rec.push(&car.step(0.01)) {
                if l.valid {
                    // fabricate a slower lap: +offset seconds from `from_pct` onwards
                    for s in &mut l.samples {
                        if s.pct > from_pct {
                            s.lap_t += offset;
                        }
                    }
                    return l;
                }
            }
        }
    }

    #[test]
    fn finds_the_four_corners_in_order() {
        let l = lap(0.0, 0.0);
        let c = detect_corners(&l);
        assert_eq!(c.len(), 4, "{c:?}");
        for (k, expected) in [0.15, 0.35, 0.55, 0.80].iter().enumerate() {
            assert!((c[k].apex_pct - expected).abs() < 0.02, "corner {k}: {:?}", c[k]);
            assert_eq!(c[k].number, k as u32 + 1);
            assert!(c[k].start_pct < c[k].apex_pct && c[k].apex_pct < c[k].end_pct);
        }
    }

    #[test]
    fn delta_is_zero_against_itself_and_positive_when_slower() {
        let r = lap(0.0, 0.0);
        let slower = lap(0.5, 0.5);
        let mid = r.samples[r.samples.len() / 4];
        assert!(live_delta(&r, mid.pct, mid.lap_t).unwrap().abs() < 1e-3);
        let late = slower.samples[slower.samples.len() * 3 / 4];
        let d = live_delta(&r, late.pct, late.lap_t).unwrap();
        assert!((d - 0.5).abs() < 0.02, "{d}");
    }

    #[test]
    fn corner_deltas_attribute_loss_to_the_right_corner() {
        let r = lap(0.0, 0.0);
        let corners = detect_corners(&r);
        // lose 0.5 s between the apex of corner 2 and the end of that corner
        let slower = lap(0.5, corners[1].apex_pct);
        let d = corner_deltas(&r, &slower, &corners);
        assert_eq!(d.len(), 4);
        assert!((d[1].unwrap() - 0.5).abs() < 0.03, "{d:?}");
        for k in [0, 2, 3] {
            assert!(d[k].unwrap().abs() < 0.03, "corner {k}: {d:?}");
        }
        assert!(corner_at(&corners, corners[1].apex_pct).is_some());
        assert!(corner_at(&corners, 0.0).is_none());
    }
}
