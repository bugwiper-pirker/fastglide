// Instrumentenpilz für die Cockpitansicht in 3D.
// Eine feste Grafik unten mittig über der 3D-Ansicht, höchstens ein Drittel so hoch wie das Fenster.
// Darin stecken dieselben Instrumente wie auf der Instrumentenseite (Fahrtmesser, Vario, Höhenmesser).
import { el } from "./instruments/svg.js";

// Pilz: oben ein breiter Bogen mit Blendschutzkante, die Seiten laufen nach unten leicht zusammen
const W = 1000, H = 360;
const TOP = `M105 205 C100 92 262 30 500 28 C738 30 900 92 895 205`;
const SHAPE = `M122 ${H} L105 205 C100 92 262 30 500 28 C738 30 900 92 895 205 L878 ${H} Z`;
const SLOTS = { asi: [270, 214], vario: [500, 206], alt: [730, 214] }; // Mittelpunkte
const SIZE = 216;                                                       // Durchmesser im Pilz

export function createCockpitPanel(host) {
  const svg = el("svg", {
    viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "xMidYMax meet", class: "ck-svg",
    role: "img", "aria-label": "Instrumentenbrett",
  }, host);
  const defs = el("defs", {}, svg);
  const g = el("linearGradient", { id: "ck-fill", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  el("stop", { offset: 0, "stop-color": "#3a4045" }, g);
  el("stop", { offset: 0.35, "stop-color": "#2d3337" }, g);
  el("stop", { offset: 1, "stop-color": "#22272b" }, g);
  const side = el("linearGradient", { id: "ck-side", x1: 0, y1: 0, x2: 1, y2: 0 }, defs);
  el("stop", { offset: 0, "stop-color": "#000", "stop-opacity": 0.35 }, side);
  el("stop", { offset: 0.08, "stop-color": "#000", "stop-opacity": 0 }, side);
  el("stop", { offset: 0.92, "stop-color": "#000", "stop-opacity": 0 }, side);
  el("stop", { offset: 1, "stop-color": "#000", "stop-opacity": 0.35 }, side);

  el("path", { d: SHAPE, fill: "url(#ck-fill)" }, svg);
  el("path", { d: SHAPE, fill: "url(#ck-side)" }, svg);
  // Blendschutz: helle Kante oben, darunter eine feine Schattenlinie
  el("path", { d: TOP, fill: "none", stroke: "#1a1e21", "stroke-width": 22 }, svg);
  el("path", { d: TOP, fill: "none", stroke: "#4c5359", "stroke-width": 14 }, svg);
  el("path", { d: TOP, fill: "none", stroke: "#7b848b", "stroke-width": 2, transform: "translate(0 -5)" }, svg);

  const slots = {};
  for (const [id, [cx, cy]] of Object.entries(SLOTS)) {
    // Einbauöffnung mit vier Schrauben
    el("circle", { cx, cy, r: SIZE / 2 + 5, fill: "#15181b" }, svg);
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const d = SIZE / 2 * 0.86;
      el("circle", { cx: cx + dx * d, cy: cy + dy * d, r: 6, fill: "#14171a" }, svg);
      el("circle", { cx: cx + dx * d, cy: cy + dy * d, r: 4, fill: "#5d656b" }, svg);
    }
    slots[id] = el("svg", { x: cx - SIZE / 2, y: cy - SIZE / 2, width: SIZE, height: SIZE }, svg);
  }
  return { slots };
}

// Ein Objekt, das jeden Aufruf an mehrere Instrumente weitergibt (Instrumentenseite und Cockpit)
export function fanout(list) {
  return new Proxy({}, {
    get: (_, name) => (...args) => { for (const x of list()) x?.[name]?.(...args); },
  });
}
