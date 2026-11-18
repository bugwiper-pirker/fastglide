// Höhenmesser, analog + digital. Wert in m.
// Großer Zeiger: 100 m (eine Umdrehung = 1000 m), kleiner Zeiger: 1000 m (eine Umdrehung = 10 000 m).
import { C, el, pt, radialLine, createDial, createNeedle, createHub, createWindow } from "./svg.js";

const fmt = (a) => Math.round(a).toLocaleString("de-AT").replace(/[.,  ]/g, " ");

export function createAltimeter(svg, cfg) {
  createDial(svg);
  for (let i = 0; i < 50; i++) {
    const deg = i * 7.2, major = i % 5 === 0;
    radialLine(svg, 88, major ? 74 : 82, deg, { class: "tick", "stroke-width": major ? 2 : 0.8 });
    if (major) {
      const [x, y] = pt(63, deg);
      el("text", { x, y, class: "lbl", "font-size": 16 }, svg).textContent = i / 5;
    }
  }
  el("text", { x: C, y: 64, class: "sub" }, svg).textContent = "× 1000 m";
  el("text", { x: C, y: 73, class: "sub" }, svg).textContent = "× 100 m";
  const dig = createWindow(svg, 64, 112, 72, 25, 17);
  el("text", { x: C, y: 144, class: "sub" }, svg).textContent = "m · GPS";
  const kNeedle = createNeedle(svg, 52, 4.5, 10);
  const hNeedle = createNeedle(svg, 82, 2.6, 16);
  createHub(svg);

  return {
    update(alt) {
      if (alt == null || Number.isNaN(alt)) { dig.textContent = "-----"; return; }
      const a = Math.min(Math.max(alt, 0), cfg.max);
      hNeedle.set(((a % 1000) / 1000) * 360);
      kNeedle.set((a / cfg.max) * 360);
      dig.textContent = fmt(alt);
    },
  };
}
