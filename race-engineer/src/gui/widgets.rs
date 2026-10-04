//! Painter-based widgets. Pure drawing: no state, no I/O, cheap enough to run at 30 fps.

use eframe::egui::{self, Align2, Color32, FontId, Pos2, Rect, Sense, Shape, Stroke, StrokeKind, Ui, Vec2};

use crate::runtime::TracePoint;
use crate::telemetry::TelemetryFrame;
use crate::track::TrackModel;

pub mod color {
    use eframe::egui::Color32;
    pub const CARD: Color32 = Color32::from_rgb(32, 36, 44);
    pub const TRACK: Color32 = Color32::from_rgb(70, 78, 92);
    pub const TEXT_DIM: Color32 = Color32::from_rgb(150, 158, 172);
    pub const GREEN: Color32 = Color32::from_rgb(70, 200, 110);
    pub const RED: Color32 = Color32::from_rgb(235, 80, 80);
    pub const AMBER: Color32 = Color32::from_rgb(245, 180, 60);
    pub const BLUE: Color32 = Color32::from_rgb(90, 160, 245);
    pub const CYAN: Color32 = Color32::from_rgb(80, 210, 220);
}

pub fn card<R>(ui: &mut Ui, title: &str, add: impl FnOnce(&mut Ui) -> R) -> R {
    egui::Frame::new()
        .fill(color::CARD)
        .corner_radius(8.0)
        .inner_margin(10.0)
        .show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.label(egui::RichText::new(title.to_uppercase()).size(11.0).color(color::TEXT_DIM));
            ui.add_space(4.0);
            add(ui)
        })
        .inner
}

/// Horizontal value bar, 0..1.
pub fn bar(ui: &mut Ui, label: &str, value: f32, fill: Color32) {
    let (rect, _) = ui.allocate_exact_size(Vec2::new(ui.available_width(), 20.0), Sense::hover());
    let p = ui.painter();
    p.rect_filled(rect, 4.0, Color32::from_rgb(18, 20, 25));
    let v = value.clamp(0.0, 1.0);
    if v > 0.0 {
        let mut r = rect;
        r.set_width(rect.width() * v);
        p.rect_filled(r, 4.0, fill);
    }
    p.text(rect.left_center() + Vec2::new(6.0, 0.0), Align2::LEFT_CENTER, label, FontId::proportional(12.0), Color32::WHITE);
    p.text(
        rect.right_center() - Vec2::new(6.0, 0.0),
        Align2::RIGHT_CENTER,
        format!("{:.0}%", v * 100.0),
        FontId::monospace(12.0),
        Color32::WHITE,
    );
}

pub fn rpm_bar(ui: &mut Ui, rpm: f32, max_seen: f32) {
    let max = max_seen.max(1000.0);
    let frac = rpm / max;
    let c = if frac > 0.94 { color::RED } else if frac > 0.85 { color::AMBER } else { color::BLUE };
    bar_text(ui, &format!("{rpm:.0} rpm"), frac, c);
}

fn bar_text(ui: &mut Ui, text: &str, value: f32, fill: Color32) {
    let (rect, _) = ui.allocate_exact_size(Vec2::new(ui.available_width(), 20.0), Sense::hover());
    let p = ui.painter();
    p.rect_filled(rect, 4.0, Color32::from_rgb(18, 20, 25));
    let mut r = rect;
    r.set_width(rect.width() * value.clamp(0.0, 1.0));
    p.rect_filled(r, 4.0, fill);
    p.text(rect.center(), Align2::CENTER_CENTER, text, FontId::monospace(12.0), Color32::WHITE);
}

/// Steering indicator, -1 (left) .. 1 (right), centre zero.
pub fn steering(ui: &mut Ui, value: Option<f32>) {
    let (rect, _) = ui.allocate_exact_size(Vec2::new(ui.available_width(), 20.0), Sense::hover());
    let p = ui.painter();
    p.rect_filled(rect, 4.0, Color32::from_rgb(18, 20, 25));
    let c = rect.center();
    p.line_segment([Pos2::new(c.x, rect.top()), Pos2::new(c.x, rect.bottom())], Stroke::new(1.0, color::TRACK));
    match value {
        Some(v) => {
            let v = v.clamp(-1.0, 1.0);
            let x = c.x + v * rect.width() * 0.5;
            let r = Rect::from_two_pos(Pos2::new(c.x, rect.top() + 3.0), Pos2::new(x, rect.bottom() - 3.0));
            p.rect_filled(r, 3.0, color::CYAN);
        }
        None => {
            p.text(c, Align2::CENTER_CENTER, "sterzo n/d", FontId::proportional(11.0), color::TEXT_DIM);
        }
    }
}

pub fn tyre_color(temp_c: f32, cold: f32, hot: f32) -> Color32 {
    if temp_c < cold {
        color::BLUE
    } else if temp_c > hot {
        color::RED
    } else if temp_c > hot - 10.0 {
        color::AMBER
    } else {
        color::GREEN
    }
}

pub fn tyre(ui: &mut Ui, name: &str, temp: Option<f32>, pressure_kpa: Option<f32>, cold: f32, hot: f32) {
    let (rect, _) = ui.allocate_exact_size(Vec2::new(ui.available_width(), 62.0), Sense::hover());
    let p = ui.painter();
    let c = temp.map_or(color::TRACK, |t| tyre_color(t, cold, hot));
    p.rect_filled(rect, 6.0, Color32::from_rgb(18, 20, 25));
    p.rect_stroke(rect, 6.0, Stroke::new(2.0, c), StrokeKind::Inside);
    p.text(rect.left_top() + Vec2::new(8.0, 6.0), Align2::LEFT_TOP, name, FontId::proportional(11.0), color::TEXT_DIM);
    let t = temp.map_or("--".to_string(), |t| format!("{t:.0} °C"));
    p.text(rect.center() + Vec2::new(0.0, 2.0), Align2::CENTER_CENTER, t, FontId::proportional(20.0), c);
    let pr = pressure_kpa.map_or("-- kPa".to_string(), |v| format!("{v:.0} kPa ({:.2} bar)", v / 100.0));
    p.text(rect.center_bottom() - Vec2::new(0.0, 6.0), Align2::CENTER_BOTTOM, pr, FontId::proportional(11.0), color::TEXT_DIM);
}

pub fn fmt_lap(t: Option<f32>) -> String {
    match t {
        Some(t) if t > 0.0 => format!("{}:{:06.3}", (t / 60.0) as u32, t % 60.0),
        _ => "--:--.---".into(),
    }
}

/// Rolling traces of the last seconds: speed (blue), throttle (green), brake (red).
pub fn trace_plot(ui: &mut Ui, trace: &[TracePoint]) {
    let (rect, _) = ui.allocate_exact_size(Vec2::new(ui.available_width(), ui.available_height().max(60.0)), Sense::hover());
    let p = ui.painter();
    p.rect_filled(rect, 6.0, Color32::from_rgb(18, 20, 25));
    for k in 1..4 {
        let y = rect.top() + rect.height() * k as f32 / 4.0;
        p.line_segment([Pos2::new(rect.left(), y), Pos2::new(rect.right(), y)], Stroke::new(1.0, Color32::from_rgb(40, 45, 54)));
    }
    if trace.len() < 2 {
        p.text(rect.center(), Align2::CENTER_CENTER, "in attesa di dati…", FontId::proportional(12.0), color::TEXT_DIM);
        return;
    }
    let t_end = trace.last().map_or(0.0, |x| x.t_s);
    let span = 12.0f32;
    let to = |t: f32, v: f32| {
        Pos2::new(rect.right() - (t_end - t) / span * rect.width(), rect.bottom() - 4.0 - v.clamp(0.0, 1.0) * (rect.height() - 8.0))
    };
    let series = |f: &dyn Fn(&TracePoint) -> f32, c: Color32| {
        let pts: Vec<Pos2> = trace.iter().filter(|x| t_end - x.t_s <= span).map(|x| to(x.t_s, f(x))).collect();
        Shape::line(pts, Stroke::new(1.6, c))
    };
    p.add(series(&|x| x.speed_kmh / 350.0, color::BLUE));
    p.add(series(&|x| x.throttle, color::GREEN));
    p.add(series(&|x| x.brake, color::RED));
    let legend = [("velocità (0–350 km/h)", color::BLUE), ("gas", color::GREEN), ("freno", color::RED)];
    let mut x = rect.left() + 8.0;
    for (name, c) in legend {
        p.circle_filled(Pos2::new(x, rect.top() + 10.0), 4.0, c);
        let g = p.text(Pos2::new(x + 8.0, rect.top() + 10.0), Align2::LEFT_CENTER, name, FontId::proportional(11.0), color::TEXT_DIM);
        x += g.width() + 24.0;
    }
}

fn bounds(points: &[[f32; 2]]) -> Option<(Pos2, Pos2)> {
    let first = points.first()?;
    let (mut lo, mut hi) = (Pos2::new(first[0], first[1]), Pos2::new(first[0], first[1]));
    for p in points {
        lo.x = lo.x.min(p[0]);
        lo.y = lo.y.min(p[1]);
        hi.x = hi.x.max(p[0]);
        hi.y = hi.y.max(p[1]);
    }
    Some((lo, hi))
}

/// Position on the reference path for a track fraction.
fn path_pos(path: &[(f32, [f32; 2])], pct: f32) -> Option<[f32; 2]> {
    let i = path.partition_point(|x| x.0 < pct);
    path.get(i).or(path.last()).map(|x| x.1)
}

/// Track map. Uses world positions when the simulator provides them (learned path of the
/// best lap, or the live trail on the first lap); otherwise a schematic ring by lap fraction.
pub fn track_map(ui: &mut Ui, track: Option<&TrackModel>, trail: &[[f32; 2]], frame: Option<&TelemetryFrame>, corner: Option<u32>) {
    let size = Vec2::new(ui.available_width(), ui.available_height().max(120.0));
    let (rect, _) = ui.allocate_exact_size(size, Sense::hover());
    let p = ui.painter();
    p.rect_filled(rect, 8.0, Color32::from_rgb(18, 20, 25));

    let ref_pts: Vec<[f32; 2]> = track.map(|t| t.path.iter().map(|x| x.1).collect()).unwrap_or_default();
    let pts: &[[f32; 2]] = if ref_pts.len() > 10 { &ref_pts } else { trail };
    let pct = frame.and_then(|f| f.lap_dist_pct);

    let inner = rect.shrink(26.0);
    // world -> screen transform (keeps aspect ratio, y up)
    let world = bounds(pts).filter(|(lo, hi)| hi.x - lo.x > 1.0 || hi.y - lo.y > 1.0);
    let to_screen: Box<dyn Fn([f32; 2]) -> Pos2> = match world {
        Some((lo, hi)) => {
            let (w, h) = ((hi.x - lo.x).max(1.0), (hi.y - lo.y).max(1.0));
            let s = (inner.width() / w).min(inner.height() / h);
            let off = Vec2::new((inner.width() - w * s) / 2.0, (inner.height() - h * s) / 2.0);
            Box::new(move |q| Pos2::new(inner.left() + off.x + (q[0] - lo.x) * s, inner.bottom() - off.y - (q[1] - lo.y) * s))
        }
        None => {
            let c = inner.center();
            let r = inner.width().min(inner.height()) / 2.0;
            // no coordinates: ring by lap fraction (pct passed through q[0])
            Box::new(move |q| {
                let a = q[0] * std::f32::consts::TAU - std::f32::consts::FRAC_PI_2;
                Pos2::new(c.x + r * a.cos(), c.y + r * a.sin())
            })
        }
    };
    let schematic = world.is_none();
    let at = |pct: f32| -> Option<Pos2> {
        if schematic {
            Some(to_screen([pct, 0.0]))
        } else {
            track.and_then(|t| path_pos(&t.path, pct)).map(&to_screen)
        }
    };

    if schematic {
        p.circle_stroke(inner.center(), inner.width().min(inner.height()) / 2.0, Stroke::new(6.0, color::TRACK));
    } else {
        let line: Vec<Pos2> = pts.iter().map(|&q| to_screen(q)).collect();
        p.add(Shape::line(line, Stroke::new(6.0, color::TRACK)));
    }

    if let Some(t) = track {
        for z in &t.brake_zones {
            if let Some(pos) = at(z.start_pct) {
                p.circle_filled(pos, 4.0, color::RED);
            }
        }
        for c in &t.corners {
            if let Some(pos) = at(c.apex_pct) {
                let active = corner == Some(c.number);
                let col = if active { color::AMBER } else { color::TEXT_DIM };
                p.circle_filled(pos, if active { 11.0 } else { 9.0 }, Color32::from_rgb(18, 20, 25));
                p.circle_stroke(pos, if active { 11.0 } else { 9.0 }, Stroke::new(1.5, col));
                p.text(pos, Align2::CENTER_CENTER, c.number.to_string(), FontId::proportional(11.0), col);
            }
        }
    }

    let car = match (frame.and_then(|f| f.pos_m), schematic, pct) {
        (Some(w), false, _) => Some(to_screen(w)),
        (_, true, Some(pc)) => Some(to_screen([pc, 0.0])),
        (_, false, Some(pc)) => at(pc),
        _ => None,
    };
    match car {
        Some(pos) => {
            p.circle_filled(pos, 8.0, color::CYAN);
            p.circle_stroke(pos, 8.0, Stroke::new(2.0, Color32::WHITE));
        }
        None => {
            p.text(rect.center(), Align2::CENTER_CENTER, "posizione non disponibile", FontId::proportional(12.0), color::TEXT_DIM);
        }
    }
    let note = if schematic { "schema per frazione di giro (il simulatore non fornisce coordinate)" } else if ref_pts.len() > 10 { "mappa dal miglior giro" } else { "traccia live del primo giro" };
    p.text(rect.left_bottom() + Vec2::new(8.0, -6.0), Align2::LEFT_BOTTOM, note, FontId::proportional(10.0), color::TEXT_DIM);
    // legend drawn with shapes: the default font has no ● / ○ glyphs
    let (mut x, y) = (rect.right() - 8.0, rect.top() + 12.0);
    let g = p.text(Pos2::new(x, y), Align2::RIGHT_CENTER, "curva", FontId::proportional(10.0), color::TEXT_DIM);
    x -= g.width() + 10.0;
    p.circle_stroke(Pos2::new(x, y), 4.0, Stroke::new(1.5, color::TEXT_DIM));
    x -= 18.0;
    let g = p.text(Pos2::new(x, y), Align2::RIGHT_CENTER, "frenata", FontId::proportional(10.0), color::TEXT_DIM);
    x -= g.width() + 10.0;
    p.circle_filled(Pos2::new(x, y), 4.0, color::RED);
}

/// Small status dot followed by text.
pub fn status(ui: &mut Ui, c: Color32, text: &str) {
    ui.horizontal(|ui| {
        ui.spacing_mut().item_spacing.x = 4.0;
        let (r, _) = ui.allocate_exact_size(Vec2::splat(12.0), Sense::hover());
        ui.painter().circle_filled(r.center(), 5.0, c);
        ui.label(egui::RichText::new(text).color(c));
    });
}
