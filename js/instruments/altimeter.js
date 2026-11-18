// Höhenmesser, analog + digital. Wert in m.
// Großer Zeiger: 100 m (eine Umdrehung = 1000 m), kleiner Zeiger: 1000 m (eine Umdrehung = 10 000 m).
import { C, el, pt, radialLine, createDial, createNeedle, createHub, createWindow } from "./svg.js";

const fmt = (a) => Math.round(a).toLocaleString("de-AT").replace(/[.,  ]/g, " ");

const FT = 0.3048;
// Flugfläche aus der GPS-Höhe (wie bei Standarddruck 1013 hPa gerechnet, ohne QNH und Temperatur)
export const flText = (alt) => `FL ${String(Math.max(0, Math.round(alt / FT / 100))).padStart(3, "0")}`;
export const ftText = (alt) => `${fmt(alt / FT)} ft`;

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
  const dig = createWindow(svg, 60, 112, 80, 25, 17);
  el("text", { x: 137, y: 133, class: "sub", "text-anchor": "end" }, svg).textContent = "m";
  const ft = el("text", { x: C, y: 148, class: "sub", "font-size": 9 }, svg);
  const kNeedle = createNeedle(svg, 52, 4.5, 10);
  const hNeedle = createNeedle(svg, 82, 2.6, 16);
  // Flugfläche in eigenem Fenster über den Zeigern, damit sie lesbar bleibt
  const fl = createWindow(svg, 78, 42, 44, 14, 9);
  createHub(svg);

  return {
    update(alt) {
      if (alt == null || Number.isNaN(alt)) { dig.textContent = "-----"; ft.textContent = "---- ft"; fl.textContent = "FL ---"; return; }
      const a = Math.min(Math.max(alt, 0), cfg.max);
      hNeedle.set(((a % 1000) / 1000) * 360);
      kNeedle.set((a / cfg.max) * 360);
      dig.textContent = fmt(alt);
      ft.textContent = ftText(alt);
      fl.textContent = flText(alt);
    },
  };
}
