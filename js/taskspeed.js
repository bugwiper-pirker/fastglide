// Aufgabe verfolgen: Abflug (letzter Überflug der Startlinie bzw. Verlassen des Startkreises),
// erreichte Wenden, Ziel. Daraus geflogene Aufgabenstrecke und Schnitt.
//
// Racing: Wenden zählen im Mittelpunkt (wie die Aufgabenlänge).
// AAT: in jedem Gebiet zählt der Punkt, der die Strecke bis dahin plus zur nächsten Wende am längsten macht.

import { distanceKm } from "./waypoints.js";
import { bearing, zoneAxis } from "./task.js";

const toRad = (d) => (d * Math.PI) / 180;
const wrap180 = (a) => ((a % 360) + 540) % 360 - 180;
const dist = (a, b) => distanceKm(a.lat, a.lon, b.lat, b.lon);

// Lage eines Punkts zur Linie durch c quer zur Richtung brg: along (m, in Flugrichtung) und quer (m)
function lineCoords(c, brg, p) {
  const x = (p.lon - c.lon) * Math.cos(toRad(c.lat)) * 111320, y = (p.lat - c.lat) * 110540;
  const ux = Math.sin(toRad(brg)), uy = Math.cos(toRad(brg));
  return { along: x * ux + y * uy, cross: Math.abs(-x * uy + y * ux) };
}

function inZone(task, i, p) {
  const c = task.points[i], oz = c.oz;
  const d = dist(c, p) * 1000;
  if (oz.r2 > 0 && d <= oz.r2) return true;
  if (d > oz.r1) return false;
  if (oz.a1 >= 180) return true;
  return Math.abs(wrap180(bearing(c, p) - zoneAxis(task, i))) <= oz.a1;
}

export function createTaskTracker() {
  let task = null, s = null;

  function reset() {
    s = { prev: null, startT: null, next: 1, ach: [], inside: false, finishT: null, pos: null };
  }
  reset();

  function onStart(f) {
    s.startT = f.t;
    s.next = 1;
    s.ach = [task.points[0]];
    s.finishT = null;
  }

  // Strecke über die erreichten Punkte plus Fortschritt Richtung nächster Wende
  function flownKm(pos) {
    const pts = task.points;
    let km = 0;
    for (let i = 1; i < s.ach.length; i++) km += dist(s.ach[i - 1], s.ach[i]);
    if (s.finishT != null) return km;
    const last = s.ach.at(-1), next = pts[s.next];
    if (next && pos) km += Math.max(0, dist(last, next) - dist(pos, next));
    return km;
  }

  function process(f) {
    if (!task || f.lat == null) return;
    const pts = task.points, n = pts.length;
    const prev = s.prev;
    s.prev = f;
    s.pos = f;
    if (!prev || s.finishT != null) return;

    // Abflug, auch erneut (dann zählt der letzte), aber nur bis zur ersten Wende
    const st = pts[0], legBrg = bearing(st, pts[1]);
    if (s.next > 1) { /* schon unterwegs */ } else if (st.oz.line) {
      const a = lineCoords(st, legBrg, prev), b = lineCoords(st, legBrg, f);
      if (a.along < 0 && b.along >= 0 && Math.min(a.cross, b.cross) <= st.oz.r1) { onStart(f); return; }
    } else if (inZone(task, 0, prev) && !inZone(task, 0, f)) { onStart(f); return; }
    if (s.startT == null) return;

    const i = s.next;
    // AAT: im letzten Gebiet den besten Punkt nachführen, solange die nächste Wende nicht erreicht ist
    if (task.aat && s.ach.length > 1 && s.ach.length - 1 === i - 1 && i - 1 >= 1 && inZone(task, i - 1, f)) {
      const k = s.ach.length - 1, before = s.ach[k - 1];
      const score = (p) => dist(before, p) + dist(p, pts[i]);
      if (score(f) > score(s.ach[k])) s.ach[k] = { lat: f.lat, lon: f.lon };
    }
    if (i === n - 1) {
      // Ziel: Linie überfliegen oder in den Kreis
      const fin = pts[i];
      let done;
      if (fin.oz.line) {
        const brg = bearing(pts[i - 1], fin);
        const a = lineCoords(fin, brg, prev), b = lineCoords(fin, brg, f);
        done = a.along < 0 && b.along >= 0 && Math.min(a.cross, b.cross) <= fin.oz.r1;
      } else done = inZone(task, i, f);
      if (done) { s.ach.push(fin); s.finishT = f.t; }
      return;
    }
    if (inZone(task, i, f)) {
      s.ach.push(task.aat ? { lat: f.lat, lon: f.lon } : pts[i]);
      s.next = i + 1;
    }
  }

  return {
    setTask(t) { task = t && t.points?.length >= 2 ? t : null; reset(); },
    get task() { return task; },
    reset,
    process,
    result() {
      if (!task) return null;
      if (s.startT == null) return { state: "pre" };
      const end = s.finishT ?? s.pos?.t;
      const km = flownKm(s.pos);
      const h = (end - s.startT) / 3600000;
      return {
        state: s.finishT != null ? "done" : "run",
        startT: s.startT, finishT: s.finishT, km,
        next: s.next, speedKmh: h > 1 / 60 ? km / h : null,
      };
    },
  };
}
