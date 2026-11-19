// IGC-Flugaufzeichnung lesen (Logger von LX, Naviter, Flarm, XCSoar …).
//
//   HFDTEDATE:090725,02          Datum (TTMMJJ)
//   HFPLTPILOTINCHARGE:Name      Pilot, ebenso GTY (Muster), GID (Kennzeichen), CID (Wettbewerbskennzeichen)
//   HFTZNTIMEZONE:2.0            Zeitzone des Loggers (optional)
//   B 103031 4621138N 01410716E A 00463 00546 …
//     Zeit (UTC), Breite (GGMMmmm), Länge (GGGMMmmm), A = 3D-Fix, Druckhöhe, GPS-Höhe (m)

import { distanceKm } from "./waypoints.js";
import { bearingDeg } from "./sources.js";

export function isIgc(text) { return /^A\w/.test(text) && /^B\d{6}\d{7}[NS]\d{8}[EW]/m.test(text); }

export function parseIgc(text) {
  const lines = text.split(/\r?\n/);
  const head = {};
  let date = null;
  const fixes = [];
  let dayOffset = 0, lastSec = -1;
  for (const l of lines) {
    if (l.startsWith("H")) {
      const key = l.slice(2, 5).toUpperCase();
      const val = l.includes(":") ? l.slice(l.indexOf(":") + 1).trim() : l.slice(5).trim();
      if (key === "DTE") {
        const m = /(\d{2})(\d{2})(\d{2})/.exec(val);
        if (m) date = Date.UTC(2000 + Number(m[3]), Number(m[2]) - 1, Number(m[1]));
      } else if (val) head[key] = val;
    } else if (l.startsWith("B") && l.length >= 35) {
      const m = /^B(\d{2})(\d{2})(\d{2})(\d{2})(\d{5})([NS])(\d{3})(\d{5})([EW])([AV])([-\d]\d{4})([-\d]\d{4})/.exec(l);
      if (!m) continue;
      const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
      if (sec < lastSec - 3600) dayOffset += 86400; // über Mitternacht (UTC)
      lastSec = sec;
      const lat = (Number(m[4]) + Number(m[5]) / 60000) * (m[6] === "S" ? -1 : 1);
      const lon = (Number(m[7]) + Number(m[8]) / 60000) * (m[9] === "W" ? -1 : 1);
      if (!lat && !lon) continue;
      fixes.push({ t: (date ?? 0) + (sec + dayOffset) * 1000, lat, lon, baro: Number(m[11]), gps: Number(m[12]), valid: m[10] === "A" });
    }
  }
  if (fixes.length < 10) throw new Error("In der IGC-Datei wurden zu wenige Positionen gefunden.");

  // Höhe: GPS-Höhe wie beim Handy, ohne gültige GPS-Höhe die Druckhöhe
  const useGps = fixes.filter((f) => f.gps !== 0).length > fixes.length * 0.8;
  for (const f of fixes) f.alt = useGps ? f.gps : f.baro;

  // Geschwindigkeit und Kurs über ±2 s geglättet
  for (let i = 0; i < fixes.length; i++) {
    let a = i, b = i;
    while (a > 0 && fixes[i].t - fixes[a].t < 2000) a--;
    while (b < fixes.length - 1 && fixes[b].t - fixes[i].t < 2000) b++;
    const A = fixes[a], B = fixes[b], dt = (B.t - A.t) / 1000;
    const km = distanceKm(A.lat, A.lon, B.lat, B.lon);
    fixes[i].speedKmh = dt > 0 ? (km / dt) * 3600 : 0;
    fixes[i].track = km > 0.005 ? bearingDeg(A.lat, A.lon, B.lat, B.lon) : null;
  }

  // Abflug: erste Stelle, ab der 30 s lang schneller als 50 km/h
  let takeoff = 0;
  for (let i = 0; i < fixes.length; i++) {
    let j = i;
    while (j < fixes.length && fixes[j].speedKmh > 50 && fixes[j].t - fixes[i].t < 30000) j++;
    if (j < fixes.length && fixes[j].t - fixes[i].t >= 30000) { takeoff = i; break; }
  }

  const tz = Number((head.TZN || "").replace(/[^-\d.]/g, ""));
  return {
    pilot: head.PLT || head.CM2 || "", glider: [head.GTY, head.GID].filter(Boolean).join(" "), cid: head.CID || "",
    date, tzHours: Number.isFinite(tz) && head.TZN ? tz : null,
    altSource: useGps ? "GPS" : "Druck",
    fixes, takeoffIndex: takeoff,
  };
}

// Position zum Zeitpunkt t (linear zwischen zwei Punkten)
export function fixAt(flight, t) {
  const f = flight.fixes;
  if (t <= f[0].t) return { ...f[0], i: 0 };
  if (t >= f[f.length - 1].t) return { ...f[f.length - 1], i: f.length - 1 };
  let lo = 0, hi = f.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (f[mid].t <= t) lo = mid; else hi = mid; }
  const a = f[lo], b = f[hi], k = (t - a.t) / (b.t - a.t || 1);
  const lerp = (x, y) => x + (y - x) * k;
  return { t, lat: lerp(a.lat, b.lat), lon: lerp(a.lon, b.lon), alt: lerp(a.alt, b.alt), speedKmh: lerp(a.speedKmh, b.speedKmh), track: a.track, i: lo };
}
