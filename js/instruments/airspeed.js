// Fahrtmesser, analog + digital. Wert in km/h: GPS-Fahrt über Grund oder mit Wind berechnete IAS.
// Dazu eine Marke (Speed-Bug) für die Sollfahrt.
import { C, el, pt, arcPath, radialLine, createDial, createNeedle, createHub, createWindow } from "./svg.js";

export function createAirspeed(svg, cfg) {
  const A0 = -155, A1 = 155;
  const ang = (v) => A0 + (Math.min(Math.max(v, 0), cfg.max) / cfg.max) * (A1 - A0);

  createDial(svg);

  // Farbbögen gemäß Flughandbuch (nur was bekannt ist)
  if (cfg.whiteArc) el("path", { d: arcPath(84, ang(cfg.whiteArc[0]), ang(cfg.whiteArc[1])), class: "arc-white" }, svg);
  if (cfg.greenArc) el("path", { d: arcPath(88.5, ang(cfg.greenArc[0]), ang(cfg.greenArc[1])), class: "arc-green" }, svg);
  if (cfg.yellowArc) el("path", { d: arcPath(88.5, ang(cfg.yellowArc[0]), ang(cfg.yellowArc[1])), class: "arc-yellow" }, svg);
  if (cfg.redLine) radialLine(svg, 91, 72, ang(cfg.redLine), { class: "mark-red" });
  if (cfg.blueLine) radialLine(svg, 91, 76, ang(cfg.blueLine), { class: "mark-blue" });
  if (cfg.vno) radialLine(svg, 91, 74, ang(cfg.vno), { class: "mark-yellow" });

  // Skala
  for (let v = 0; v <= cfg.max; v += 5) {
    const major = v % 50 === 0, mid = v % 10 === 0;
    radialLine(svg, 81, major ? 70 : mid ? 75 : 78, ang(v), {
      class: "tick", "stroke-width": major ? 2 : mid ? 1.2 : 0.6,
    });
    if (major) {
      const [x, y] = pt(58, ang(v));
      el("text", { x, y, class: "lbl", "font-size": 13 }, svg).textContent = v;
    }
  }

  // Gelbes Dreieck (Anfluggeschwindigkeit), Spitze zur Skala
  if (cfg.yellowTriangle) {
    const a = ang(cfg.yellowTriangle);
    const [tx, ty] = pt(80, a), [b1x, b1y] = pt(91, a - 2.6), [b2x, b2y] = pt(91, a + 2.6);
    el("path", { d: `M${tx} ${ty} L${b1x} ${b1y} L${b2x} ${b2y} Z`, class: "mark-tri" }, svg);
  }

  el("text", { x: C, y: 68, class: "sub" }, svg).textContent = "km/h";
  const label = el("text", { x: C, y: 77, class: "sub" }, svg);
  label.textContent = "GS";
  // Sollfahrt-Marke außen an der Skala
  const bug = el("path", { class: "stf-bug", d: "" }, svg);
  const dig = createWindow(svg, 67, 112, 66, 25, 17);
  const needle = createNeedle(svg, 82, 3.2, 14);
  createHub(svg);

  return {
    setLabel(t) { if (label.textContent !== t) label.textContent = t; },
    setBug(v) {
      if (v == null) { bug.setAttribute("d", ""); return; }
      const a = ang(v);
      const [tx, ty] = pt(82, a), [b1x, b1y] = pt(94, a - 4), [b2x, b2y] = pt(94, a + 4);
      bug.setAttribute("d", `M${tx} ${ty} L${b1x} ${b1y} L${b2x} ${b2y} Z`);
    },
    update(v) {
      if (v == null || Number.isNaN(v)) { dig.textContent = "---"; return; }
      needle.set(ang(v));
      dig.textContent = Math.round(v);
    },
  };
}
