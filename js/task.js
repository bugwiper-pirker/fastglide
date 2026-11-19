// Wettbewerbsaufgaben: SeeYou-CUP (Soaring Spot, LX9000, SeeYou Navigator) und XCSoar-.tsk lesen,
// Wendezonen geometrisch aufbereiten.
//
// CUP-Aufgabe (nach "-----Related Tasks-----"):
//   "Tag 1","Abflug","Start","WP1","WP2","Ziel","Landung"   Name, dann Abflug, Kurs, Landung
//   Options,NoStart=12:30:00,TaskTime=03:00:00,WpDis=True
//   ObsZone=0,Style=2,R1=5000m,A1=180,Line=1       0 = Start, 1 = erste Wende, …, n = Ziel
//   ObsZone=1,Style=1,R1=500m,A1=180
//   Point=1,"WP1","CODE",AT,4806.533N,01656.017E,180.0m,1,...   (optional: Punkt direkt in der Aufgabe)
// Style: 0 feste Richtung (A12), 1 symmetrisch, 2 zum nächsten, 3 zum vorigen, 4 zum Start.
//
// Soaring-Spot-Aufgabenseiten (HTML) werden ebenfalls gelesen, siehe parseSoaringSpotTask.

import { parseCup, splitCsv, parseCupCoord, parseElev, cupTextFromBuffer, distanceKm } from "./waypoints.js";

const STORE_KEY = "ts-task";

function parseDist(s) {
  const m = /^(-?\d+(?:\.\d+)?)\s*(m|km|nm|ml|ft)?$/i.exec((s || "").trim());
  if (!m) return null;
  const v = Number(m[1]), u = (m[2] || "m").toLowerCase();
  return u === "km" ? v * 1000 : u === "nm" ? v * 1852 : u === "ml" ? v * 1609.344 : u === "ft" ? v * 0.3048 : v;
}

function defaultOz(i, n) {
  if (i === 0) return { style: 2, r1: 1000, a1: 90, line: true };      // Startlinie 2 km
  if (i === n - 1) return { style: 3, r1: 3000, a1: 180, line: false }; // Zielkreis 3 km
  return { style: 1, r1: 500, a1: 180, line: false };                   // Wendekreis 500 m
}

// ---------------- CUP ----------------
export function parseCupTask(text, extraWaypoints = []) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const sep = lines.findIndex((l) => /^-+\s*related tasks/i.test(l.trim()));
  if (sep < 0) return null;
  const fileWps = parseCup(lines.slice(0, sep).join("\n"));
  const byName = new Map();
  for (const w of [...extraWaypoints, ...fileWps]) byName.set(w.name.trim().toLowerCase(), w);

  const tasks = [];
  let cur = null;
  for (const raw of lines.slice(sep + 1)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^options\b/i.test(line)) {
      if (!cur) continue;
      for (const kv of splitCsv(line).slice(1)) {
        const [k, v] = kv.split("=");
        if (k) cur.options[k.trim()] = (v || "").trim();
      }
    } else if (/^obszone=/i.test(line)) {
      if (!cur) continue;
      const o = {};
      for (const kv of splitCsv(line)) {
        const [k, v] = kv.split("=");
        if (k) o[k.trim().toLowerCase()] = (v || "").trim();
      }
      cur.zones[Number(o.obszone)] = {
        style: o.style != null ? Number(o.style) : 1,
        r1: parseDist(o.r1) ?? 500,
        a1: o.a1 != null && o.a1 !== "" ? Number(o.a1) : 180,
        r2: parseDist(o.r2) ?? 0,
        a2: o.a2 != null && o.a2 !== "" ? Number(o.a2) : 0,
        a12: o.a12 != null && o.a12 !== "" ? Number(o.a12) : null,
        line: o.line === "1" || /true/i.test(o.line || ""),
      };
    } else if (/^point=/i.test(line)) {
      if (!cur) continue;
      const f = splitCsv(line);
      // Point=n,"Name","Code",Land,Breite,Länge,Höhe,Stil,...
      const lat = parseCupCoord(f[4] || "", true), lon = parseCupCoord(f[5] || "", false);
      if (lat != null && lon != null) {
        cur.points.set(f[1].trim().toLowerCase(), { name: f[1], code: f[2] || "", lat, lon, elev: parseElev(f[6]), style: Number(f[7]) || 1 });
      }
    } else if (/^starts=/i.test(line)) {
      // mehrere Startpunkte: wird ignoriert
    } else {
      const f = splitCsv(line);
      cur = { name: f[0] || "Aufgabe", names: f.slice(1), options: {}, zones: [], points: new Map() };
      tasks.push(cur);
    }
  }
  if (!tasks.length) return null;
  const t = tasks[0];

  // Abflug und Landung abtrennen
  // Normal: Abflug, Kurs…, Landung. Passt die Zahl der Zonen nur ohne Landung, bleibt der letzte Punkt.
  let names = t.names;
  const maxZone = t.zones.length - 1;
  if (maxZone >= 0 && maxZone === names.length - 2) names = names.slice(1);
  else if (names.length >= 4) names = names.slice(1, -1);
  names = names.filter((n) => n && n.trim() && n !== "???");
  const missing = [];
  const pts = names.map((n) => {
    const k = n.trim().toLowerCase();
    const w = t.points.get(k) || byName.get(k);
    if (!w) missing.push(n);
    return w;
  });
  if (missing.length) throw new Error(`Diese Wendepunkte der Aufgabe fehlen in der Datei und in der Wendepunktliste: ${missing.join(", ")}`);
  if (pts.length < 2) throw new Error("Die Aufgabe hat zu wenige Punkte.");

  const tt = t.options.TaskTime || t.options.tasktime;
  const ns = t.options.NoStart || t.options.nostart;
  const facts = [];
  if (tt && tt !== "00:00:00") facts.push(["Mindestzeit", `${tt.slice(0, 5)} h`]);
  if (ns) facts.push(["Abflug frühestens", ns.slice(0, 5)]);
  return finishTask({
    name: t.name,
    aat: !!tt && tt !== "00:00:00",
    taskTime: tt || null,
    info: { facts },
    points: pts.map((w, i) => ({
      name: w.name, code: w.code || "", lat: w.lat, lon: w.lon, elev: w.elev ?? null,
      oz: t.zones[i] || defaultOz(i, pts.length),
    })),
  });
}

// ---------------- XCSoar .tsk ----------------
export function parseXcsoarTask(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const taskEl = doc.querySelector("Task");
  if (!taskEl) return null;
  const pts = [];
  for (const p of taskEl.querySelectorAll(":scope > Point")) {
    const wp = p.querySelector("Waypoint"), loc = p.querySelector("Location"), z = p.querySelector("ObservationZone");
    if (!wp || !loc) continue;
    const type = (z?.getAttribute("type") || "Cylinder").toLowerCase();
    const num = (a, d) => (z?.getAttribute(a) != null ? Number(z.getAttribute(a)) : d);
    let oz;
    if (type === "line") oz = { style: 1, r1: num("length", 1000) / 2, a1: 90, line: true };
    else if (type === "cylinder" || type === "matcylinder") oz = { style: 1, r1: num("radius", 500), a1: 180 };
    else if (type === "sector") {
      const s = num("start_radial", 0), e = num("end_radial", 90);
      const span = (e - s + 360) % 360;
      oz = { style: 0, r1: num("radius", 10000), a1: span / 2, a12: (s + span / 2) % 360, r2: num("inner_radius", 0), a2: 180 };
    } else if (type === "symmetricquadrant") oz = { style: 1, r1: num("radius", 10000), a1: num("angle", 90) / 2 };
    else if (type === "faisector") oz = { style: 1, r1: 10000, a1: 45 };
    else if (type.startsWith("keyhole") || type.startsWith("bga")) oz = { style: 1, r1: num("radius", 10000), a1: 45, r2: num("inner_radius", 500), a2: 180 };
    else oz = { style: 1, r1: num("radius", 500), a1: 180 };
    pts.push({
      name: wp.getAttribute("name") || "?", code: "",
      lat: Number(loc.getAttribute("latitude")), lon: Number(loc.getAttribute("longitude")),
      elev: wp.getAttribute("altitude") != null ? Number(wp.getAttribute("altitude")) : null,
      oz,
    });
  }
  if (pts.length < 2) throw new Error("Die Aufgabe hat zu wenige Punkte.");
  const type = (taskEl.getAttribute("type") || "").toUpperCase();
  const minT = Number(taskEl.getAttribute("aat_min_time") || 0);
  const hh = (s) => `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:00`;
  return finishTask({ name: "XCSoar-Aufgabe", aat: type === "AAT", taskTime: minT ? hh(minT) : null, points: pts });
}

// ---------------- IGC (im Logger erklärte Aufgabe) ----------------
//   C060725095746000000000304            Kopf: …, zuletzt Zahl der Wenden (04)
//   C0000000N00000000E                   Abflugort (oft leer)
//   C4624167N01415083E010 Huje           Start, Wenden …, Ziel
//   C0000000N00000000E                   Landeort (oft leer)
// Zonen, falls vorhanden: LLXVOZ=-1,Style=2,R1=5000m,… (LXNAV, -1 = Start) oder LSEEYOU OZ=0,… (0 = Start)
//   LLXVTSK,TaskTime=10800s              AAT-Mindestzeit
export function parseIgcTask(text) {
  const lines = text.split(/\r?\n/);
  const head = lines.find((l) => /^C\d{23}/.test(l));
  if (!head) return null;
  const nTp = Number(head.slice(23, 25));
  const all = lines
    .map((l) => /^C(\d{7}[NS])(\d{8}[EW])(.*)$/.exec(l))
    .filter(Boolean)
    .map((m) => {
      const lat = (Number(m[1].slice(0, 2)) + Number(m[1].slice(2, 7)) / 60000) * (m[1][7] === "S" ? -1 : 1);
      const lon = (Number(m[2].slice(0, 3)) + Number(m[2].slice(3, 8)) / 60000) * (m[2][8] === "W" ? -1 : 1);
      return { name: m[3].trim(), lat, lon };
    });
  // Normal: Abflug, Start, Wenden, Ziel, Landung. Abflug und Landung weglassen.
  let pts = all.length >= nTp + 4 ? all.slice(1, nTp + 3) : all;
  pts = pts.filter((p) => p.lat || p.lon);
  if (pts.length < 2) return null;

  const zones = [];
  for (const l of lines) {
    const m = /^L(?:LXV|SEEYOU )OZ=(-?\d+),(.*)$/.exec(l);
    if (!m) continue;
    const o = {};
    for (const kv of m[2].split(",")) {
      const [k, v] = kv.split("=");
      if (k) o[k.trim().toLowerCase()] = (v || "").trim();
    }
    zones.push({
      style: o.style != null ? Number(o.style) : 1,
      r1: parseDist(o.r1) ?? 500,
      a1: o.a1 != null && o.a1 !== "" ? Number(o.a1) : 180,
      r2: parseDist(o.r2) ?? 0,
      a2: o.a2 != null && o.a2 !== "" ? Number(o.a2) : 0,
      a12: o.a12 != null && o.a12 !== "" ? Number(o.a12) : null,
      line: o.line === "1" || /true/i.test(o.line || ""),
      // beim Ziel: Mindest-Ankunftshöhe (MSL), darunter gibt es Strafpunkte
      minAlt: o.elev ? parseElev(o.elev) : null,
    });
  }
  const useZones = zones.length === pts.length;
  for (const z of zones.slice(0, -1)) delete z.minAlt;

  const tm = /^L(?:LXVTSK|SEEYOU TSK).*TaskTime=(\d+)(s)?/m.exec(text);
  let taskTime = null;
  if (tm) {
    const s = Number(tm[1]);
    if (s > 0) taskTime = `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:00`;
  }
  const facts = [["Quelle", "Im Logger erklärte Aufgabe (IGC)"]];
  if (taskTime) facts.push(["Mindestzeit", `${taskTime.slice(0, 5)} h`]);
  if (!useZones) facts.push(["Zonen", "nicht in der Datei, Standardwerte"]);
  const minAlt = useZones ? zones.at(-1).minAlt : null;
  if (minAlt != null) facts.push(["Zielhöhe (Ankunft mind.)", `${Math.round(minAlt)} m MSL`]);
  return finishTask({
    name: "Aufgabe aus IGC",
    aat: !!taskTime,
    taskTime,
    points: pts.map((p, i) => ({
      ...p, code: "", elev: null, oz: useZones ? zones[i] : defaultOz(i, pts.length),
      minAlt: i === pts.length - 1 ? minAlt : null,
    })),
    info: { facts },
  });
}

// ---------------- Soaring Spot (Aufgabenseite) ----------------
// Die Seite enthält die Aufgabe als JSON: Map.SoaringSpot.taskNormalize({...}).
// Koordinaten und Winkel in Bogenmaß, Radien in m. oz_radius1 ist bei Linien die halbe Länge.
const SS_STYLE = { fixed: 0, symmetric: 1, next: 2, previous: 3, start: 4 };

function extractJson(text, from) {
  const start = text.indexOf("{", from);
  if (start < 0) return null;
  let depth = 0, inStr = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

export function isSoaringSpotPage(text) { return /taskNormalize\s*\(/.test(text); }

export function parseSoaringSpotTask(html) {
  const m = /taskNormalize\s*\(/.exec(html);
  if (!m) return null;
  const json = extractJson(html, m.index + m[0].length);
  let data;
  try { data = JSON.parse(json); } catch { throw new Error("Die Aufgabe auf der Soaring-Spot-Seite konnte nicht gelesen werden."); }
  const deg = (r) => (Number(r) * 180) / Math.PI;
  const pts = (data.task_points || [])
    .slice()
    .sort((a, b) => a.point_index - b.point_index)
    .map((p) => ({
      name: p.name, code: "", lat: deg(p.latitude), lon: deg(p.longitude), elev: p.elevation ?? null,
      oz: {
        style: SS_STYLE[p.oz_type] ?? 1,
        r1: Number(p.oz_radius1) || 500,
        a1: Math.round(deg(p.oz_angle1 ?? Math.PI) * 10) / 10,
        r2: Number(p.oz_radius2) || 0,
        a2: Math.round(deg(p.oz_angle2 || 0) * 10) / 10,
        a12: p.oz_angle12 != null ? deg(p.oz_angle12) : null,
        line: !!p.oz_line,
      },
    }));
  if (pts.length < 2) throw new Error("Die Aufgabe hat zu wenige Punkte.");
  const dur = Number(data.task_duration) || 0;
  const hh = (s) => `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:00`;
  const info = soaringSpotInfo(html, data);
  const minAlt = finishMinAlt(info.notes);
  if (minAlt != null) {
    const fin = pts[pts.length - 1];
    fin.minAlt = fin.oz.minAlt = minAlt;
    info.facts.push(["Zielhöhe (Ankunft mind.)", `${Math.round(minAlt)} m MSL (aus den Notizen)`]);
  }
  return finishTask({
    name: data.task_name || `Tag ${data.task_number || ""}`.trim(),
    aat: dur > 0,
    taskTime: dur > 0 ? hh(dur) : null,
    points: pts,
    info,
  });
}

// Mindest-Ankunftshöhe am Ziel aus freiem Text, z. B. „Ziellinie: min. 570 MSL“,
// „Zielhöhe mind. 600 m“, „Finish: min 2000 ft MSL“, „minimum finish height 570m“.
// Gelesen wird je Abschnitt (getrennt durch Zeilenende oder ;), damit z. B. die Ausklinkhöhe nicht stört.
export function finishMinAlt(notes) {
  for (const part of (notes || "").split(/[\n;]/)) {
    if (!/(ziel|finish|arrival|ankunft)/i.test(part) || !/min/i.test(part)) continue;
    const m = /(\d[\d.' ]{1,5}\d)\s*(m|ft|feet|fuß)?\b/i.exec(part.replace(/(\d)[.' ](\d{3})\b/g, "$1$2"));
    if (!m) continue;
    const v = Number(m[1].replace(/\D/g, ""));
    const ft = /^(ft|feet|fuß)$/i.test(m[2] || "");
    const meters = ft ? v * 0.3048 : v;
    if (meters >= 100 && meters <= 5000) return Math.round(meters);
  }
  return null;
}

// Text aus einem HTML-Stück: Zeilenumbrüche aus <br>, Tags weg, Entities auflösen
function htmlText(s) {
  const ent = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return (s || "")
    .replace(/\s+/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) =>
      e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ent[e.toLowerCase()] ?? m);
}

// Zusatzinfos der Seite: Bewerb, Tag, Aufgabennotizen (Frequenzen, Telefon …), inaktive Lufträume usw.
function soaringSpotInfo(html, data) {
  const one = (re) => { const m = re.exec(html); return m ? htmlText(m[1]).replace(/\s+/g, " ").trim() : ""; };
  const facts = [];
  const typ = { polygon: "Racing Task", assigned_area: "AAT (Area Assigned Task)" }[data.task_type] || data.task_type;
  if (typ) facts.push(["Aufgabentyp", typ]);
  if (Number(data.task_duration) > 0) {
    const d = Number(data.task_duration);
    facts.push(["Mindestzeit", `${Math.floor(d / 3600)}:${String(Math.floor((d % 3600) / 60)).padStart(2, "0")} h`]);
  }
  if (data.no_start) facts.push(["Abflug frühestens", String(data.no_start).slice(11, 16)]);
  if (data.qnh) facts.push(["QNH", `${data.qnh} hPa`]);
  if (data.result_status) facts.push(["Ergebnis", { official: "offiziell", preliminary: "vorläufig", unofficial: "inoffiziell" }[data.result_status] || data.result_status]);

  let inactiveAirspaces = [];
  for (const m of html.matchAll(/<div class="task-info ([^"]*)">([\s\S]*?)<\/div>/g)) {
    const t = htmlText(m[2]).replace(/\s+/g, " ").trim();
    const i = t.indexOf(":");
    if (i < 0) continue;
    const k = t.slice(0, i).trim(), v = t.slice(i + 1).trim();
    if (/excluded-airspaces/.test(m[1])) inactiveAirspaces = v.split(/\s*,\s*/).filter(Boolean);
    else if (v) facts.push([k, v]);
  }

  // Aufgabennotizen: der Absatz nach der Überschrift unter der Punkttabelle
  const nm = /<\/table>[\s\S]*?<h3>[^<]*<\/h3>\s*<p>([\s\S]*?)<\/p>/.exec(html);
  const notes = nm
    ? htmlText(nm[1]).split("\n").map((l) => l.trim().replace(/^([=*_#~-])\1{9,}$/, "$1".repeat(10))).join("\n").replace(/^\n+|\n+$/g, "").replace(/\n{3,}/g, "\n\n")
    : "";

  return {
    contest: one(/<div class="contest-title">[\s\S]*?<h1>([\s\S]*?)<\/h1>/),
    day: one(/<h2 class="pull-left">([\s\S]*?)<\/h2>/),
    date: data.task_date || null,
    facts, notes, inactiveAirspaces,
  };
}

// Ergebnisseite → Aufgabenseite: /<sprache>/<bewerb>/results/<klasse>/<tag>/… → …/tasks/<klasse>/<tag>
export function soaringSpotTaskUrl(url) {
  const u = new URL(url);
  const m = /^(\/[^/]+\/[^/]+)\/(?:results|tasks)\/([^/]+)\/([^/]+)/.exec(u.pathname);
  return m ? `${u.origin}${m[1]}/tasks/${m[2]}/${m[3]}` : url;
}

function finishTask(task) {
  let d = 0;
  for (let i = 1; i < task.points.length; i++) {
    const a = task.points[i - 1], b = task.points[i];
    d += distanceKm(a.lat, a.lon, b.lat, b.lon);
  }
  task.distanceKm = d;
  return task;
}

// Datei (Puffer) einlesen: .tsk (XML) oder .cup/.cupx
export async function readTaskBuffer(buf, name, waypoints) {
  const text = await cupTextFromBuffer(buf);
  if (isSoaringSpotPage(text)) return parseSoaringSpotTask(text);
  const t = /\.tsk$/i.test(name) || text.trimStart().startsWith("<")
    ? parseXcsoarTask(text)
    : parseCupTask(text, waypoints);
  if (!t) throw new Error("In der Datei wurde keine Aufgabe gefunden. Eine SeeYou-Datei braucht den Abschnitt „Related Tasks“.");
  return t;
}

export function saveTask(fileName, task) { localStorage.setItem(STORE_KEY, JSON.stringify({ fileName, task })); }
export function loadTask() { try { return JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch { return null; } }
export function clearTask() { try { localStorage.removeItem(STORE_KEY); } catch {} }

// ---------------- Geometrie der Zonen ----------------
function bearing(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const p1 = toRad(a.lat), p2 = toRad(b.lat), dl = toRad(b.lon - a.lon);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
export function destination(lat, lon, brg, m) {
  const R = 6371008.8, toRad = (d) => (d * Math.PI) / 180, toDeg = (r) => (r * 180) / Math.PI;
  const d = m / R, b = toRad(brg), p1 = toRad(lat), l1 = toRad(lon);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [toDeg(p2), toDeg(l2)];
}
const norm = (a) => ((a % 360) + 360) % 360;

// Mittelrichtung der Zone (zeigt vom Punkt weg, in den Sektor hinein)
function zoneAxis(task, i) {
  const pts = task.points, p = pts[i], oz = p.oz;
  const prev = pts[i - 1], next = pts[i + 1];
  if (oz.style === 0 && oz.a12 != null) return norm(oz.a12);
  if (oz.style === 2 && next) return norm(bearing(p, next) + 180);
  if (oz.style === 3 && prev) return norm(bearing(prev, p));
  if (oz.style === 4 && i > 0) return norm(bearing(pts[0], p));
  // symmetrisch
  if (!prev && next) return norm(bearing(p, next) + 180);
  if (prev && !next) return norm(bearing(prev, p));
  if (prev && next) {
    const a = bearing(p, prev), b = bearing(p, next);
    let mid = norm(a + norm(b - a) / 2);
    if (norm(b - a) > 180) mid = norm(mid + 180);
    return norm(mid + 180); // vom Kurs weg
  }
  return 0;
}

// Liefert für jeden Punkt die Form: { kind: "line", latlngs } | { kind: "poly", latlngs } (+ optional inner Kreis)
export function zoneShapes(task) {
  return task.points.map((p, i) => {
    const oz = p.oz;
    const shapes = [];
    const isEnd = i === 0 || i === task.points.length - 1;
    if (oz.line && isEnd) {
      // Linie quer zum ersten bzw. letzten Schenkel
      const other = i === 0 ? task.points[1] : task.points[i - 1];
      const leg = i === 0 ? bearing(p, other) : bearing(other, p);
      shapes.push({ kind: "line", latlngs: [destination(p.lat, p.lon, leg - 90, oz.r1), destination(p.lat, p.lon, leg + 90, oz.r1)] });
      return shapes;
    }
    if (oz.a1 >= 180) {
      const ring = [];
      for (let a = 0; a < 360; a += 6) ring.push(destination(p.lat, p.lon, a, oz.r1));
      shapes.push({ kind: "poly", latlngs: ring });
    } else {
      const axis = zoneAxis(task, i);
      const wedge = [[p.lat, p.lon]];
      const steps = Math.max(4, Math.ceil((2 * oz.a1) / 5));
      for (let k = 0; k <= steps; k++) wedge.push(destination(p.lat, p.lon, axis - oz.a1 + (2 * oz.a1 * k) / steps, oz.r1));
      shapes.push({ kind: "poly", latlngs: wedge });
    }
    if (oz.r2 > 0) {
      const ring = [];
      for (let a = 0; a < 360; a += 8) ring.push(destination(p.lat, p.lon, a, oz.r2));
      shapes.push({ kind: "poly", latlngs: ring });
    }
    return shapes;
  });
}

export function zoneText(oz, i, n) {
  const base = zoneBaseText(oz, i, n);
  return oz.minAlt != null && i === n - 1 ? `${base} · Ankunft mind. ${Math.round(oz.minAlt)} m` : base;
}
function zoneBaseText(oz, i, n) {
  const r = oz.r1 >= 1000 ? `${(oz.r1 / 1000).toLocaleString("de-AT", { maximumFractionDigits: 2 })} km` : `${Math.round(oz.r1)} m`;
  if (oz.line && (i === 0 || i === n - 1)) return `${i === 0 ? "Startlinie" : "Ziellinie"} ${oz.r1 >= 500 ? ((2 * oz.r1) / 1000).toLocaleString("de-AT", { maximumFractionDigits: 2 }) + " km" : Math.round(2 * oz.r1) + " m"}`;
  if (oz.a1 >= 180) return `Zylinder ${r}`;
  return `Sektor ${r}, ${Math.round(oz.a1 * 2)}°` + (oz.r2 > 0 ? ` + Kreis ${Math.round(oz.r2)} m` : "");
}
