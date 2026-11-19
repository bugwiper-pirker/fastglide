// Lufträume: OpenAir-Dateien lesen, speichern, geometrisch prüfen.
//
// OpenAir (Auszug):
//   AC D                     Klasse (oder Typ: CTR, R, Q, P, TMZ, RMZ, W, GP …)
//   AY CTR                   Typ (erweitertes Format, optional)
//   AN WIEN TMA 1            Name
//   AL 3500ft MSL            Untergrenze
//   AH FL95                  Obergrenze
//   AF 123.800               Frequenz (optional)
//   DP 48:00:00 N 016:00:00 E   Polygonpunkt
//   V X=48:00:00 N 016:00:00 E  Mittelpunkt für Bögen und Kreise
//   V D=-                    Bogenrichtung (+ im, - gegen den Uhrzeigersinn)
//   DA r,a1,a2               Bogen mit Radius r (NM) von Winkel a1 bis a2
//   DB p1,p2                 Bogen von p1 nach p2 um den Mittelpunkt
//   DC r                     Kreis mit Radius r (NM)

const STORE_KEY = "ts-airspace";
const NM = 1.852; // km
const FT = 0.3048;

// ---- Kategorien: Farbe, Bezeichnung ----
export const CATEGORIES = {
  A:   { label: "Klasse A", color: "#b0001e" },
  B:   { label: "Klasse B", color: "#b0001e" },
  C:   { label: "Klasse C", color: "#1d4fd8" },
  D:   { label: "Klasse D", color: "#2f7de1" },
  CTR: { label: "Kontrollzone (CTR)", color: "#d6203a" },
  E:   { label: "Klasse E", color: "#5f7a96" },
  F:   { label: "Klasse F", color: "#5f7a96" },
  G:   { label: "Klasse G", color: "#8a9aab" },
  R:   { label: "Flugbeschränkungsgebiet (R)", color: "#e0262e" },
  P:   { label: "Luftsperrgebiet (P)", color: "#7a0010" },
  Q:   { label: "Gefahrengebiet (Q)", color: "#ef7d00" },
  TMZ: { label: "Transponderpflicht (TMZ)", color: "#7b3fbf" },
  RMZ: { label: "Funkpflicht (RMZ)", color: "#16a05a" },
  W:   { label: "TRA / Segelflugbereich (W)", color: "#0aa3a3" },
  GP:  { label: "Segelflugverbot (GP)", color: "#7a0010" },
  OTHER: { label: "Sonstiger Luftraum", color: "#8a9aab" },
};

// Für VFR ohne Freigabe nicht erlaubt (Standard der Warnung)
export const DEFAULT_WARN = ["A", "B", "C", "D", "CTR", "R", "P", "GP"];

function categorize(ac, ay, name) {
  // Der Name ist am verlässlichsten: Austro Control führt z. B. RMZ und TMZ als Klasse R
  const n = (name || "").toUpperCase().trim();
  if (/^RMZ\b/.test(n)) return "RMZ";
  if (/^TMZ\b/.test(n)) return "TMZ";
  if (/^TRA\b/.test(n)) return "W";
  if (/^M?CTR\b/.test(n)) return "CTR";
  if (/^LOR\d/.test(n)) return "R";
  if (/^LOD\d/.test(n)) return "Q";
  if (/^LOP\d/.test(n)) return "P";
  const t = (ay || "").toUpperCase().trim();
  const c = (ac || "").toUpperCase().trim();
  const map = {
    CTR: "CTR", TMZ: "TMZ", RMZ: "RMZ", RESTRICTED: "R", R: "R", DANGER: "Q", Q: "Q",
    PROHIBITED: "P", P: "P", GP: "GP", "GLIDER_PROHIBITED": "GP", W: "W", WAVE: "W", GSEC: "W", GLIDING_SECTOR: "W",
  };
  if (map[t]) return map[t];
  if (map[c]) return map[c];
  if (/^[A-G]$/.test(c)) return /\bCTR\b/i.test(name) ? "CTR" : c;
  return "OTHER";
}

// ---- Koordinaten ----
const COORD_RE = /(\d+(?:\.\d+)?)(?::(\d+(?:\.\d+)?))?(?::(\d+(?:\.\d+)?))?\s*([NS])[\s,]*(\d+(?:\.\d+)?)(?::(\d+(?:\.\d+)?))?(?::(\d+(?:\.\d+)?))?\s*([EW])/i;
function parseCoord(s) {
  const m = COORD_RE.exec(s);
  if (!m) return null;
  let lat = Number(m[1]) + Number(m[2] || 0) / 60 + Number(m[3] || 0) / 3600;
  let lon = Number(m[5]) + Number(m[6] || 0) / 60 + Number(m[7] || 0) / 3600;
  if (/S/i.test(m[4])) lat = -lat;
  if (/W/i.test(m[8])) lon = -lon;
  return [lat, lon];
}

// ---- Höhen ----
// Ergebnis: { text, ref: "GND"|"MSL"|"AGL"|"FL"|"UNL", m }  (m = Meter, bei FL Druckhöhe)
export function parseAlt(raw) {
  const text = (raw || "").trim();
  const s = text.toUpperCase().replace(/\s+/g, " ");
  if (!s || /^(GND|SFC|GROUND)$/.test(s) || /^0+\s*(FT|M)?\s*(AGL|GND|SFC)?$/.test(s)) return { text: "GND", ref: "GND", m: 0 };
  if (/^(UNL|UNLIM|UNLTD|UNLIMITED)/.test(s)) return { text: "UNL", ref: "UNL", m: Infinity };
  let m = /^FL\s*(\d+)/.exec(s);
  if (m) return { text: `FL ${Number(m[1])}`, ref: "FL", m: Number(m[1]) * 100 * FT };
  m = /^(\d+(?:\.\d+)?)\s*(FT|F|M)?\s*(AGL|AGND|GND|SFC|AMSL|MSL|ALT)?/.exec(s);
  if (m) {
    const v = Number(m[1]);
    const meters = m[2] === "M" ? v : v * FT;
    const agl = /AGL|AGND|GND|SFC/.test(m[3] || "");
    const unit = m[2] === "M" ? "m" : "ft";
    return { text: `${m[1]} ${unit} ${agl ? "AGL" : "MSL"}`, ref: agl ? "AGL" : "MSL", m: meters };
  }
  return { text, ref: "MSL", m: 0 }; // unbekannt: vorsichtshalber ab Boden
}

// Für die Warnung: Untergrenze/Obergrenze in m über Meer, vorsichtig geschätzt.
// AGL-Untergrenzen: ohne Geländedaten wird angenommen, das Gelände liegt auf Meereshöhe (Grenze eher zu tief).
// AGL-Obergrenzen: unbekannt, daher als unbegrenzt behandelt (lieber eine Warnung zu viel).
function lowerMsl(a) { return a.ref === "GND" ? -Infinity : a.m; }
function upperMsl(a) { return a.ref === "AGL" || a.ref === "UNL" ? Infinity : a.m; }

// ---- Geometrie auf der Kugel ----
function destination(lat, lon, bearing, km) {
  const R = 6371.0088, toRad = (d) => (d * Math.PI) / 180, toDeg = (r) => (r * 180) / Math.PI;
  const d = km / R, b = toRad(bearing), p1 = toRad(lat), l1 = toRad(lon);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [toDeg(p2), toDeg(l2)];
}
function distBearing(a, b) {
  const R = 6371.0088, toRad = (d) => (d * Math.PI) / 180;
  const p1 = toRad(a[0]), p2 = toRad(b[0]), dl = toRad(b[1] - a[1]);
  const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  const dist = 2 * R * Math.asin(Math.sqrt(h));
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return { dist, brg: ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360 };
}
function arcPoints(center, radiusKm, a1, a2, cw) {
  const pts = [];
  let span = cw ? (a2 - a1 + 360) % 360 : (a1 - a2 + 360) % 360;
  if (span === 0) span = 360;
  const steps = Math.max(2, Math.ceil(span / 5));
  for (let i = 0; i <= steps; i++) {
    const a = cw ? a1 + (span * i) / steps : a1 - (span * i) / steps;
    pts.push(destination(center[0], center[1], a, radiusKm));
  }
  return pts;
}

// ---- Parser ----
export function parseOpenAir(text) {
  const out = [];
  let cur = null, center = null, cw = true;
  const finish = () => {
    if (cur && cur.points.length >= 3) {
      const lats = cur.points.map((p) => p[0]), lons = cur.points.map((p) => p[1]);
      cur.bbox = [Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons)];
      cur.cat = categorize(cur.ac, cur.ay, cur.name);
      cur.lower = parseAlt(cur.al);
      cur.upper = parseAlt(cur.ah);
      out.push(cur);
    }
    cur = null;
  };
  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("*")) continue;
    const sp = line.indexOf(" ");
    const key = (sp < 0 ? line : line.slice(0, sp)).toUpperCase();
    const val = (sp < 0 ? "" : line.slice(sp + 1)).replace(/\s*\*.*$/, "").trim();
    if (key === "AC") {
      finish();
      cur = { ac: val, ay: "", name: "", al: "", ah: "", freq: "", points: [] };
      center = null; cw = true;
      continue;
    }
    if (!cur) continue;
    switch (key) {
      case "AN": cur.name = val; break;
      case "AY": cur.ay = val; break;
      case "AL": cur.al = val; break;
      case "AH": cur.ah = val; break;
      case "AF": cur.freq = val; break;
      case "AG": cur.callsign = val; break;
      case "V": {
        const m = /^([XD])\s*=\s*(.+)$/i.exec(val);
        if (!m) break;
        if (m[1].toUpperCase() === "X") center = parseCoord(m[2]);
        else cw = m[2].trim() !== "-";
        break;
      }
      case "DP": { const p = parseCoord(val); if (p) cur.points.push(p); break; }
      case "DC": {
        if (!center) break;
        cur.points.push(...arcPoints(center, Number(val) * NM, 0, 360, true));
        break;
      }
      case "DA": {
        if (!center) break;
        const [r, a1, a2] = val.split(",").map(Number);
        if ([r, a1, a2].some(Number.isNaN)) break;
        cur.points.push(...arcPoints(center, r * NM, a1, a2, cw));
        break;
      }
      case "DB": {
        if (!center) break;
        const [s1, s2] = val.split(",");
        const p1 = parseCoord(s1 || ""), p2 = parseCoord(s2 || "");
        if (!p1 || !p2) break;
        const d1 = distBearing(center, p1), d2 = distBearing(center, p2);
        const pts = arcPoints(center, d1.dist, d1.brg, d2.brg, cw);
        pts[0] = p1; pts[pts.length - 1] = p2;
        cur.points.push(...pts);
        break;
      }
    }
  }
  finish();
  return out;
}

export async function readAirspaceFile(file) {
  return readAirspaceBuffer(await file.arrayBuffer(), file.name);
}

export async function fetchDefaultAirspace(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error("Die Standard-Luftraumdatei konnte nicht geladen werden. Besteht eine Internetverbindung?");
  return readAirspaceBuffer(await res.arrayBuffer(), url);
}

export function readAirspaceBuffer(buf, name) {
  const head = new Uint8Array(buf, 0, Math.min(64, buf.byteLength));
  // CUB (SeeYou) ist ein Binärformat
  if (/\.cub$/i.test(name) || head.some((b) => b === 0)) {
    throw new Error("CUB-Dateien (SeeYou-Binärformat) werden nicht unterstützt. Bitte eine OpenAir-Datei (.txt) verwenden.");
  }
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(buf); }
  catch { text = new TextDecoder("windows-1252").decode(buf); }
  const spaces = parseOpenAir(text);
  if (!spaces.length) throw new Error("In der Datei wurden keine Lufträume gefunden. Ist es eine OpenAir-Datei?");
  return { text, spaces };
}

// Gespeichert wird der Originaltext (kleiner als die berechneten Punkte)
export function saveAirspace(fileName, text) {
  localStorage.setItem(STORE_KEY, JSON.stringify({ fileName, text }));
}
export function loadAirspace() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    return s ? { fileName: s.fileName, spaces: parseOpenAir(s.text) } : null;
  } catch { return null; }
}
export function clearAirspace() {
  try { localStorage.removeItem(STORE_KEY); } catch {}
}

// Eindeutiger Schlüssel für die Ausnahmeliste („nicht warnen“)
// Lufträume aus einer Namensliste finden (z. B. „Inaktive Lufträume“ von Soaring Spot).
// Passt der ganze Name oder die Kennung vor der Klammer: „LOD28 (MARWIESEN)“ ↔ „LOD28 (MARWIESEN)“ oder „LOD28 …“.
export function findByNames(spaces, names) {
  const norm = (s) => (s || "").toUpperCase().replace(/\s+/g, " ").trim();
  const head = (s) => norm(s).split(/[ (]/)[0];
  const found = new Map(); // Name aus der Liste → Lufträume
  for (const n of names) {
    const full = norm(n), id = head(n);
    found.set(n, spaces.filter((a) => norm(a.name) === full || (id.length >= 4 && head(a.name) === id)));
  }
  return found;
}

export const asKey = (a) => `${a.name}|${a.lower.text}|${a.upper.text}`;

// ---- Prüfungen ----
export function pointInPolygon(lat, lon, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [yi, xi] = pts[i], [yj, xj] = pts[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Kürzeste Entfernung (km) vom Punkt zum Rand des Polygons (ebene Näherung)
function distanceToEdge(lat, lon, pts) {
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180), ky = 110.574;
  let best = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const ax = (pts[j][1] - lon) * kx, ay = (pts[j][0] - lat) * ky;
    const bx = (pts[i][1] - lon) * kx, by = (pts[i][0] - lat) * ky;
    const dx = bx - ax, dy = by - ay;
    const len = dx * dx + dy * dy;
    let t = len ? -(ax * dx + ay * dy) / len : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best) best = d;
  }
  return best;
}

export function airspacesAt(spaces, lat, lon) {
  return spaces.filter((a) =>
    lat >= a.bbox[0] && lat <= a.bbox[2] && lon >= a.bbox[1] && lon <= a.bbox[3] && pointInPolygon(lat, lon, a.points));
}

// Ergebnis: Liste { space, level: "inside"|"near", dist (km), vgap (m), ahead } – schlimmste zuerst
export function checkAirspace(spaces, pos, opts) {
  const { warnCats, warnKm, vMargin, lookaheadS, ignore, traActive } = opts;
  if (!pos || pos.alt == null) return [];
  const out = [];
  // In einer (als aktiv angenommenen) TRA sind C/D-Warnungen unterdrückt
  const inTra = traActive && spaces.some((a) => a.cat === "W" &&
    pos.alt >= lowerMsl(a.lower) && pos.alt <= upperMsl(a.upper) && airspacesAt([a], pos.lat, pos.lon).length);
  const padLat = warnKm / 110.574, padLon = warnKm / (111.32 * Math.cos((pos.lat * Math.PI) / 180));
  // Position in lookaheadS Sekunden, wenn Kurs und Fahrt bekannt
  let ahead = null;
  if (pos.track != null && pos.speedKmh > 20) {
    ahead = destination(pos.lat, pos.lon, pos.track, (pos.speedKmh / 3600) * lookaheadS);
  }
  for (const a of spaces) {
    if (!warnCats.has(a.cat)) continue;
    if (ignore && ignore.has(asKey(a))) continue;
    if (inTra && (a.cat === "C" || a.cat === "D")) continue;
    const b = a.bbox;
    if (pos.lat < b[0] - padLat || pos.lat > b[2] + padLat || pos.lon < b[1] - padLon || pos.lon > b[3] + padLon) {
      if (!ahead || !pointInPolygon(ahead[0], ahead[1], a.points)) continue;
    }
    const lo = lowerMsl(a.lower), hi = upperMsl(a.upper);
    const vgap = pos.alt < lo ? lo - pos.alt : pos.alt > hi ? pos.alt - hi : 0;
    if (vgap > vMargin) continue;
    const inside = pointInPolygon(pos.lat, pos.lon, a.points);
    const dist = inside ? 0 : distanceToEdge(pos.lat, pos.lon, a.points);
    const aheadIn = !inside && ahead && pointInPolygon(ahead[0], ahead[1], a.points);
    if (inside && vgap === 0) out.push({ space: a, level: "inside", dist: 0, vgap: 0 });
    else if (dist <= warnKm || aheadIn) out.push({ space: a, level: "near", dist, vgap, ahead: !!aheadIn });
  }
  out.sort((x, y) => (x.level === y.level ? x.dist + x.vgap / 1000 - (y.dist + y.vgap / 1000) : x.level === "inside" ? -1 : 1));
  return out;
}

// Grenze kompakt mit Meterangabe: "3500ft MSL (1067m)", "FL95 (2896m)", "1000ft AGL (305m AGL)".
// Angaben in m bleiben ohne Umrechnung ("1500m MSL").
export function limitText(x) {
  const t = x.text.replace(/(\d) (ft|m)\b/, "$1$2").replace(/^FL /, "FL");
  if (!Number.isFinite(x.m) || x.ref === "GND" || /\dm\b/.test(t)) return t;
  return `${t} (${Math.round(x.m)}m${x.ref === "AGL" ? " AGL" : ""})`;
}
export const altText = (a) => `${limitText(a.lower)} – ${limitText(a.upper)}`;
