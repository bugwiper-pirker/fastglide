// Instrumentenpilz für die Cockpitansicht in 3D.
// Eine feste Grafik unten mittig über der 3D-Ansicht, höchstens ein Drittel so hoch wie das Fenster.
// Darin stecken dieselben Instrumente wie auf der Instrumentenseite (Fahrtmesser, Vario, Höhenmesser).
import { el } from "./instruments/svg.js";

// Pilz: oben ein breiter Bogen mit Blendschutzkante, die Seiten laufen nach unten leicht zusammen.
// Am Handy ist das Fenster schmal und niedrig, die Höhe begrenzt den Pilz: dort ist der Bogen flacher
// und die Instrumente füllen fast die ganze Höhe.
const LAYOUTS = {
  normal: {
    w: 1000, h: 360, size: 216,
    top: "M105 205 C100 92 262 30 500 28 C738 30 900 92 895 205", foot: [122, 878],
    slots: { asi: [270, 214], vario: [500, 206], alt: [730, 214] },
  },
  compact: {
    w: 1000, h: 342, size: 290,
    top: "M48 175 C42 62 232 8 500 6 C768 8 958 62 952 175", foot: [70, 930],
    slots: { asi: [208, 196], vario: [500, 170], alt: [792, 196] },
  },
};
const COMPACT_BELOW = 700; // Fensterbreite in px

export function createCockpitPanel(host) {
  const svg = el("svg", { preserveAspectRatio: "xMidYMax meet", class: "ck-svg", role: "img", "aria-label": "Instrumentenbrett" }, host);
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

  const body = el("path", { fill: "url(#ck-fill)" }, svg);
  const shade = el("path", { fill: "url(#ck-side)" }, svg);
  // Blendschutz: helle Kante oben, darunter eine feine Schattenlinie
  const rim = [
    el("path", { fill: "none", stroke: "#1a1e21", "stroke-width": 22 }, svg),
    el("path", { fill: "none", stroke: "#4c5359", "stroke-width": 14 }, svg),
    el("path", { fill: "none", stroke: "#7b848b", "stroke-width": 2, transform: "translate(0 -5)" }, svg),
  ];

  // Einbauöffnung mit vier Schrauben, darin das Instrument
  const slots = {}, parts = {};
  for (const id of Object.keys(LAYOUTS.normal.slots)) {
    const hole = el("circle", { fill: "#15181b" }, svg);
    const screws = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map((d) => ({
      d, a: el("circle", { r: 6, fill: "#14171a" }, svg), b: el("circle", { r: 4, fill: "#5d656b" }, svg),
    }));
    slots[id] = el("svg", {}, svg);
    parts[id] = { hole, screws };
  }

  let current = null;
  function layout(name) {
    if (name === current) return;
    current = name;
    const L = LAYOUTS[name];
    svg.setAttribute("viewBox", `0 0 ${L.w} ${L.h}`);
    const [f0, f1] = L.foot, a = L.top.match(/^M(\S+) (\S+)/);
    const shape = `M${f0} ${L.h} L${a[1]} ${a[2]} ${L.top.slice(a[0].length)} L${f1} ${L.h} Z`;
    body.setAttribute("d", shape);
    shade.setAttribute("d", shape);
    for (const r of rim) r.setAttribute("d", L.top);
    for (const [id, [cx, cy]] of Object.entries(L.slots)) {
      const { hole, screws } = parts[id];
      hole.setAttribute("cx", cx); hole.setAttribute("cy", cy); hole.setAttribute("r", L.size / 2 + 5);
      for (const { d: [dx, dy], a: s1, b: s2 } of screws) {
        const d = (L.size / 2) * 0.86;
        for (const s of [s1, s2]) { s.setAttribute("cx", cx + dx * d); s.setAttribute("cy", cy + dy * d); }
      }
      const s = slots[id];
      s.setAttribute("x", cx - L.size / 2); s.setAttribute("y", cy - L.size / 2);
      s.setAttribute("width", L.size); s.setAttribute("height", L.size);
    }
  }
  const fit = () => layout(host.clientWidth && host.clientWidth < COMPACT_BELOW ? "compact" : "normal");
  fit();
  new ResizeObserver(fit).observe(host);
  return { slots };
}

// Ein Objekt, das jeden Aufruf an mehrere Instrumente weitergibt (Instrumentenseite und Cockpit)
export function fanout(list) {
  return new Proxy({}, {
    get: (_, name) => (...args) => { for (const x of list()) x?.[name]?.(...args); },
  });
}
