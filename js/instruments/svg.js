// Gemeinsame Zeichenhilfen für alle Rundinstrumente.
// Koordinatensystem: viewBox 0 0 200 200, Mittelpunkt 100/100,
// Winkel in Grad ab 12 Uhr im Uhrzeigersinn.

export const NS = "http://www.w3.org/2000/svg";
export const C = 100;

export function pt(r, deg) {
  const a = (deg * Math.PI) / 180;
  return [C + r * Math.sin(a), C - r * Math.cos(a)];
}

export function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

export function arcPath(r, a0, a1) {
  const [x0, y0] = pt(r, a0);
  const [x1, y1] = pt(r, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${x0} ${y0} A${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}

export function radialLine(svg, r0, r1, deg, attrs) {
  const [x0, y0] = pt(r0, deg);
  const [x1, y1] = pt(r1, deg);
  return el("line", { x1: x0, y1: y0, x2: x1, y2: y1, ...attrs }, svg);
}

export function createDial(svg) {
  svg.setAttribute("viewBox", "0 0 200 200");
  el("circle", { cx: C, cy: C, r: 99, class: "bezel" }, svg);
  el("circle", { cx: C, cy: C, r: 91, class: "face" }, svg);
  for (let i = 0; i < 4; i++) {
    const [x, y] = pt(95, 45 + i * 90);
    el("circle", { cx: x, cy: y, r: 1.6, class: "screw" }, svg);
  }
}

export function createNeedle(svg, len, w, tail) {
  const g = el("g", { class: "needle-g" }, svg);
  el("path", {
    d: `M${C - w} ${C + tail} L${C - w * 0.55} ${C - len + 6} L${C} ${C - len} L${C + w * 0.55} ${C - len + 6} L${C + w} ${C + tail} Z`,
    class: "needle",
  }, g);
  return {
    set(deg) { g.setAttribute("transform", `rotate(${deg} ${C} ${C})`); },
  };
}

export function createHub(svg) {
  el("circle", { cx: C, cy: C, r: 6, class: "hub" }, svg);
}

export function createWindow(svg, x, y, w, h, fontSize) {
  el("rect", { x, y, width: w, height: h, rx: 3, class: "win" }, svg);
  return el("text", { x: C, y: y + h / 2 + 0.5, class: "dig", "font-size": fontSize }, svg);
}
