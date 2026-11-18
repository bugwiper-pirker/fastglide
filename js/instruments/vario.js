// Variometer, analog + digital. Wert in m/s.
// Null liegt links (9 Uhr), Steigen im Uhrzeigersinn nach oben, Sinken nach unten.
// +max und -max liegen rechts, getrennt durch eine kleine Lücke.
import { C, el, pt, arcPath, radialLine, createDial, createNeedle, createHub, createWindow } from "./svg.js";

const fmt = (v) => (v > 0.05 ? "+" : v < -0.05 ? "−" : "") + Math.abs(v).toFixed(1);

export function createVario(svg, cfg) {
  const SWEEP = 165; // Grad von 0 bis ±max
  const ang = (v) => -90 + (Math.min(Math.max(v, -cfg.max), cfg.max) / cfg.max) * SWEEP;

  createDial(svg);

  // dezente Farbbögen: Steigen grün, Sinken rot
  el("path", { d: arcPath(88.5, ang(0), ang(cfg.max)), class: "arc-climb" }, svg);
  el("path", { d: arcPath(88.5, ang(-cfg.max), ang(0)), class: "arc-sink" }, svg);

  const step = 0.5;
  for (let v = -cfg.max; v <= cfg.max + 1e-9; v += step) {
    const major = Math.abs(v % 1) < 1e-9;
    radialLine(svg, 84, major ? 72 : 78, ang(v), { class: "tick", "stroke-width": major ? 2 : 0.8 });
    if (major) {
      const [x, y] = pt(61, ang(v));
      el("text", { x, y, class: "lbl", "font-size": v === 0 ? 17 : 14 }, svg).textContent = Math.abs(v);
    }
  }
  el("text", { x: C + 22, y: 82, class: "sub" }, svg).textContent = "m/s";
  const dig = createWindow(svg, 67, 112, 66, 25, 17);
  const avg = el("text", { x: C, y: 146, class: "sub avg" }, svg);
  const needle = createNeedle(svg, 82, 3.2, 14);
  createHub(svg);

  return {
    update(v, extra) {
      avg.textContent = extra && extra.avg != null ? `Ø 20 s  ${fmt(extra.avg)}` : "Ø 20 s  ---";
      if (v == null || Number.isNaN(v)) { dig.textContent = "---"; return; }
      needle.set(ang(v));
      dig.textContent = fmt(v);
    },
  };
}
