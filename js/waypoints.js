// Wendepunkte: Einlesen von SeeYou-Dateien (.cup, .cupx) und Speichern im Browser.
//
// CUP-Format (eine Zeile pro Punkt, CSV):
//   name,code,country,lat,lon,elev,style,rwdir,rwlen,freq,desc
//   "Spitzerberg","LOAS",AT,4806.533N,01656.017E,180.0m,2,...
// Koordinaten: Breite DDMM.mmmN/S, Länge DDDMM.mmmE/W. Höhe in m oder ft.
// Ab "-----Related Tasks-----" folgen Aufgaben, die ignoriert werden.

const STORE_KEY = "ts-waypoints";

// Landeplätze laut CUP-Style: 2 Flugplatz Gras, 3 Außenlandefeld, 4 Segelfluggelände, 5 Flugplatz Hartbelag
export const LANDABLE = new Set([2, 3, 4, 5]);

function splitCsv(line) {
  const out = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function parseCoord(s, isLat) {
  const re = isLat ? /^(\d{2})(\d{2}(?:\.\d+)?)([NS])$/i : /^(\d{3})(\d{2}(?:\.\d+)?)([EW])$/i;
  const m = re.exec(s.trim());
  if (!m) return null;
  let v = Number(m[1]) + Number(m[2]) / 60;
  if (/[SW]/i.test(m[3])) v = -v;
  return v;
}

function parseElev(s) {
  const m = /^(-?\d+(?:\.\d+)?)\s*(m|ft)?$/i.exec((s || "").trim());
  if (!m) return null;
  const v = Number(m[1]);
  return m[2] && m[2].toLowerCase() === "ft" ? v * 0.3048 : v;
}

export function parseCup(text) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  let idx = { name: 0, code: 1, country: 2, lat: 3, lon: 4, elev: 5, style: 6 };
  const points = [];
  let first = true;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^-+\s*related tasks/i.test(line)) break;
    const f = splitCsv(line);
    if (first) {
      first = false;
      const lower = f.map((x) => x.toLowerCase());
      if (lower.includes("lat") && lower.includes("lon")) {
        idx = {};
        lower.forEach((h, i) => { idx[h] = i; });
        continue;
      }
    }
    const lat = parseCoord(f[idx.lat] || "", true);
    const lon = parseCoord(f[idx.lon] || "", false);
    if (lat == null || lon == null) continue;
    points.push({
      name: f[idx.name] || "?",
      code: f[idx.code] || "",
      lat, lon,
      elev: parseElev(f[idx.elev]),
      style: Number(f[idx.style]) || 0,
    });
  }
  return points;
}

// ---- .cupx (ZIP mit points.cup darin) ----
async function inflateRaw(bytes) {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function extractCupFromZip(buf) {
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Keine gültige ZIP-Datei");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buf, p + 46, nlen));
    p += 46 + nlen + xlen + clen;
    if (!/\.cup$/i.test(name)) continue;
    const lnlen = dv.getUint16(local + 26, true), lxlen = dv.getUint16(local + 28, true);
    const data = new Uint8Array(buf, local + 30 + lnlen + lxlen, csize);
    if (method === 0) return data;
    if (method === 8) return inflateRaw(data);
    throw new Error("Unbekannte Komprimierung in der .cupx-Datei");
  }
  throw new Error("Keine .cup-Datei in der .cupx-Datei gefunden");
}

function decodeText(bytes) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return new TextDecoder("windows-1252").decode(bytes); } // ältere Dateien
}

export async function readWaypointFile(file) {
  return readWaypointBuffer(await file.arrayBuffer());
}

// Mitgelieferte Standard-Wendepunktdatei vom Server (bzw. aus dem Offline-Cache) laden
export async function fetchDefaultWaypoints(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error("Die Standard-Wendepunktdatei konnte nicht geladen werden. Besteht eine Internetverbindung?");
  return readWaypointBuffer(await res.arrayBuffer());
}

export async function readWaypointBuffer(buf) {
  const head = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
  const isZip = head[0] === 0x50 && head[1] === 0x4b; // "PK"
  const bytes = isZip ? await extractCupFromZip(buf) : new Uint8Array(buf);
  const points = parseCup(decodeText(bytes));
  if (!points.length) throw new Error("In der Datei wurden keine Wendepunkte gefunden. Ist es eine SeeYou-Datei (.cup)?");
  return points;
}

// ---- Speichern ----
export function saveWaypoints(fileName, points) {
  localStorage.setItem(STORE_KEY, JSON.stringify({ fileName, points }));
}
export function loadWaypoints() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch { return null; }
}
export function clearWaypoints() {
  try { localStorage.removeItem(STORE_KEY); } catch {}
}

// ---- Geometrie ----
export function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371.0088, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
