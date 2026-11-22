// Flugauswertung aus den GPS-Punkten: Kreisen, Wind, Fahrt durch die Luft, Netto, Abflug/Ausklinken
// und die freie Strecke (6 Schenkel) für den Schnitt ohne Aufgabe.
//
// Wind: Beim Kreisen mit gleichbleibender Fahrt ist der Versatz über einen vollen Kreis der Wind.
// Fahrt durch die Luft (TAS) = Geschwindigkeit über Grund − Wind, IAS aus der Normatmosphäre.
// Netto = Gesamtenergie-Steigen (Höhe + TAS²/2g) + Eigensinken laut Polare.

const G = 9.81;
const KMH = 3.6;
const TURN_RATE = 4;       // °/s, ab hier wird gekreist
const CIRCLE_ON_S = 15;    // so lange muss gedreht werden, bis „Kreisen“ gilt
const CIRCLE_OFF_S = 10;   // so lange geradeaus, bis wieder „Vorflug“ gilt
const ENL_ON = 500;        // Motorgeräusch (0–999) ab hier: Motor läuft
const WIND_SPAN = 240;     // ° gleichsinnige Drehung für eine Windmessung (auch Wenden am Hang)
const WIND_MAX_S = 60;     // so lange darf die Drehung höchstens dauern
const WIND_STALE_MIN = 20; // älterer Wind gilt als unbekannt

// Kreis durch Punkte (x, y) nach Kåsa: Mittelpunkt, Radius, mittlere Abweichung
function circleFit(pts) {
  const n = pts.length;
  if (n < 8) return null;
  let mx = 0, my = 0;
  for (const p of pts) { mx += p.x; my += p.y; }
  mx /= n; my /= n;
  let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const p of pts) {
    const u = p.x - mx, v = p.y - my;
    suu += u * u; svv += v * v; suv += u * v;
    suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-9) return null;
  const a = 0.5 * (suuu + suvv), b = 0.5 * (svvv + svuu);
  const uc = (a * svv - b * suv) / det, vc = (b * suu - a * suv) / det;
  const x = uc + mx, y = vc + my;
  const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / n);
  let e = 0;
  for (const p of pts) e += (Math.hypot(p.x - x, p.y - y) - r) ** 2;
  return { x, y, r, rms: Math.sqrt(e / n) };
}

export function iasFromTas(tas, alt) {
  const r = Math.pow(1 - 2.25577e-5 * Math.min(Math.max(alt || 0, 0), 11000), 4.2559);
  return tas * Math.sqrt(r);
}

const toRad = (d) => (d * Math.PI) / 180;
const wrap180 = (a) => ((a % 360) + 540) % 360 - 180;

// lineare Regression (Steigung je Sekunde)
function slope(buf) {
  const n = buf.length;
  if (n < 3) return null;
  const t0 = buf[0].t;
  let st = 0, sv = 0, stt = 0, stv = 0;
  for (const s of buf) { const t = (s.t - t0) / 1000; st += t; sv += s.v; stt += t * t; stv += t * s.v; }
  const den = n * stt - st * st;
  return den ? (n * stv - st * sv) / den : null;
}

// Einheitsvektor auf der Erdkugel, für schnelle Entfernungen
const R_KM = 6371;
function vec(lat, lon) {
  const p = toRad(lat), l = toRad(lon);
  return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
}
const chordKm = (a, b) => R_KM * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// Größte Strecke über bis zu 6 Schenkel durch Punkte in zeitlicher Reihenfolge, letzter Punkt = cur
// Teil 1 (aufwendig, nur wenn neue Punkte dazukommen): beste Strecke mit legs−1 Schenkeln bis Punkt j
function bestLegs(pts, legs) {
  const n = pts.length, v = pts.map((p) => p.v);
  let best = new Float64Array(n); // 0 Schenkel bis Punkt j
  for (let k = 1; k < legs; k++) {
    const next = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      let m = 0;
      for (let i = 0; i <= j; i++) { const x = best[i] + chordKm(v[i], v[j]); if (x > m) m = x; }
      next[j] = m;
    }
    best = next;
  }
  return best;
}
// Teil 2 (billig, bei jedem Punkt): letzter Schenkel zur aktuellen Position
function lastLeg(pts, best, cur) {
  let out = 0;
  for (let j = 0; j < pts.length; j++) out = Math.max(out, best[j] + chordKm(pts[j].v, cur));
  return out;
}
export function freeDistanceKm(pts, cur, legs = 6) {
  return pts.length ? lastLeg(pts, bestLegs(pts, legs), cur.v) : 0;
}

export function createFlightAnalyzer() {
  let s;
  function reset() {
    s = {
      prev: null, rate: 0, circling: false, since: null, turnStart: null,
      circle: null, wind: null, vbuf: [], lastFit: 0,
      energy: [], netto: null, tas: null, ias: null, gs: null,
      airborne: false, fastSince: null, takeoffT: null, takeoffAlt: null, maxAlt: -Infinity,
      enlSeen: false, engineOnSince: null, engineRan: false, engineOffT: null,
      launchT: null, launchSrc: null, manualT: null, glide: [],
      trace: [], traceStep: 10000, olc: null,
      cum: 0, hist: [], free60: null,
      recent: [], thermal: null, seg: null, lastThermal: null, phaseEnd: null,
    };
  }
  reset();

  function localXY(lat, lon, ref) {
    return [(lon - ref.lon) * Math.cos(toRad(ref.lat)) * 111320, (lat - ref.lat) * 110540];
  }

  function updateCircling(f, dt) {
    if (f.track == null || s.prev?.track == null || dt <= 0 || dt > 10) return;
    const r = wrap180(f.track - s.prev.track) / dt;
    s.rate += (r - s.rate) * Math.min(1, dt / 3); // geglättet über ca. 3 s
    const turning = Math.abs(s.rate) > TURN_RATE;
    if (turning !== s.circling) {
      s.since ??= f.t;
      if (f.t - s.since >= (turning ? CIRCLE_ON_S : CIRCLE_OFF_S) * 1000) {
        s.circling = turning;
        s.phaseEnd = s.since; // da hat das Kreisen begonnen bzw. aufgehört
        s.since = null;
        s.circle = null;
        if (turning) s.turnStart = f.t - CIRCLE_ON_S * 1000;
      }
    } else s.since = null;

    // Wind vom Logger (beim Abspielen einer IGC-Datei mit Windaufzeichnung)
    if (useLogger && f.wind) {
      const r = toRad(f.wind.from), v = f.wind.kmh / KMH;
      s.wind = { e: -v * Math.sin(r), n: -v * Math.cos(r), t: f.t, circles: 0, logger: true };
      return;
    }
    updateWind(f, dt);
  }

  // Wind: Beim Drehen mit gleichbleibender Fahrt liegen die Geschwindigkeiten über Grund auf einem
  // Kreis um den Windvektor. Kreis durch die Punkte der letzten Drehung (mind. WIND_SPAN°) legen.
  function updateWind(f, dt) {
    if (f.speedKmh == null || f.track == null || dt <= 0 || dt > 5) { s.vbuf = []; return; }
    const gs = f.speedKmh / KMH;
    const dh = s.prev?.track == null ? 0 : wrap180(f.track - s.prev.track);
    s.vbuf.push({ t: f.t, x: gs * Math.sin(toRad(f.track)), y: gs * Math.cos(toRad(f.track)), dh });
    while (s.vbuf.length && s.vbuf[0].t < f.t - WIND_MAX_S * 1000) s.vbuf.shift();
    if (f.t - s.lastFit < 8000) return;
    // von hinten: so lange gleichsinnig gedreht, bis WIND_SPAN erreicht ist
    let sum = 0, i = s.vbuf.length - 1, sign = Math.sign(dh);
    if (!sign) return;
    for (; i > 0; i--) {
      const d = s.vbuf[i].dh;
      if (Math.sign(d) === -sign && Math.abs(d) > 2) return; // Drehrichtung gewechselt
      sum += Math.abs(d);
      if (sum >= WIND_SPAN) break;
    }
    if (sum < WIND_SPAN) return;
    const pts = s.vbuf.slice(i);
    const fit = circleFit(pts);
    if (!fit || fit.r < 15 || fit.r > 75 || fit.rms > 3 || Math.hypot(fit.x, fit.y) > 40) return;
    s.lastFit = f.t;
    const w = s.wind;
    const k = !w || f.t - w.t > WIND_STALE_MIN * 60000 ? 1 : 0.5;
    s.wind = { e: w && k < 1 ? w.e + (fit.x - w.e) * k : fit.x, n: w && k < 1 ? w.n + (fit.y - w.n) * k : fit.y, t: f.t, circles: (k === 1 ? 0 : w.circles) + 1 };
  }

  function updateAir(f, polar) {
    s.gs = f.speedKmh;
    if (f.speedKmh == null) { s.tas = s.ias = s.netto = null; return; }
    const gs = f.speedKmh / KMH;
    let ve = 0, vn = 0;
    if (f.track != null) { ve = gs * Math.sin(toRad(f.track)); vn = gs * Math.cos(toRad(f.track)); }
    const w = s.wind && f.t - s.wind.t < WIND_STALE_MIN * 60000 ? s.wind : null;
    // Fahrt vom Logger, wenn vorhanden (Fahrtmesser am Logger), sonst aus GPS und Wind
    const logTas = useLogger && f.tas != null ? f.tas / KMH : null;
    s.loggerAir = logTas != null;
    const tas = logTas ?? (w && f.track != null ? Math.hypot(ve - w.e, vn - w.n) : gs);
    s.tas = tas * KMH;
    s.ias = useLogger && f.ias != null ? f.ias : f.alt == null ? s.tas : iasFromTas(tas, f.alt) * KMH;
    // Netto erst mit bekanntem Wind, sonst wäre die Fahrt durch die Luft falsch
    if (f.alt == null) { s.netto = null; return; }
    s.energy.push({ t: f.t, v: f.alt + (tas * tas) / (2 * G) });
    while (s.energy.length && s.energy[0].t < f.t - 6000) s.energy.shift();
    const te = slope(s.energy);
    const ias = s.ias / KMH;
    s.netto = (w || s.loggerAir) && te != null && polar && ias > 15 && ias < 90 ? te + polar.sink(ias) : null;
  }

  // Abheben, Motor/Schlepp-Ende („Ausklinken“) erkennen
  function updateLaunch(f, dt) {
    if (f.alt != null && s.airborne) s.maxAlt = Math.max(s.maxAlt, f.alt);
    if (!s.airborne) {
      if (f.speedKmh > 50) {
        s.fastSince ??= { t: f.t, alt: f.alt };
        if (f.t - s.fastSince.t >= 30000) { s.airborne = true; s.takeoffT = s.fastSince.t; s.takeoffAlt = s.fastSince.alt; }
      } else s.fastSince = null;
      return;
    }
    if (s.launchT != null) return;
    if (f.enl != null) {
      s.enlSeen = true;
      if (f.enl >= ENL_ON) { s.engineOnSince ??= f.t; if (f.t - s.engineOnSince > 20000) s.engineRan = true; s.engineOffT = null; }
      else {
        if (s.engineRan) {
          s.engineOffT ??= f.t;
          if (f.t - s.engineOffT >= 30000) { s.launchT = s.engineOffT; s.launchSrc = "Motor aus"; return; }
        }
        s.engineOnSince = null;
      }
      if (s.engineRan || s.engineOnSince) return; // Motor läuft oder ist gerade aus
    }
    // ohne Motordaten: erster Bart, in dem gekreist wird, oder deutliches Sinken nach dem Steigen
    if (s.circling && s.turnStart) { s.launchT = Math.max(s.takeoffT, s.turnStart); s.launchSrc = "erster Bart"; return; }
    if (f.alt == null) return;
    s.glide.push({ t: f.t, v: f.alt });
    while (s.glide.length && s.glide[0].t < f.t - 20000) s.glide.shift();
    const climbed = s.maxAlt - (s.takeoffAlt ?? f.alt);
    if (climbed > 150 && s.glide.length > 5 && f.t - s.glide[0].t >= 15000) {
      const v = slope(s.glide);
      if (v != null && v < -0.5) { s.launchT = s.glide[0].t; s.launchSrc = "Ende Steigflug"; }
    }
  }

  function startT() { return s.manualT ?? s.launchT; }

  // Bart (beim Kreisen) und Gleitflug (dazwischen): Beginn mit Zeit, Ort und Höhe
  function updatePhase(f) {
    if (f.alt == null) return;
    // mit Strecke entlang der Spur (km) für die Gleitzahl; 150 s reichen für das 2-Minuten-Mittel
    const lr = s.recent.at(-1);
    const cum = lr ? lr.cum + chordKm(vec(lr.lat, lr.lon), vec(f.lat, f.lon)) : 0;
    s.recent.push({ t: f.t, lat: f.lat, lon: f.lon, alt: f.alt, cum });
    while (s.recent.length && s.recent[0].t < f.t - 150000) s.recent.shift();
    const at = (t) => s.recent.find((x) => x.t >= t) || s.recent[0];
    if (s.circling) {
      if (!s.thermal) { s.thermal = { ...at(s.turnStart) }; s.seg = null; }
    } else {
      if (s.thermal) { s.lastThermal = { ...s.thermal, end: at(s.phaseEnd ?? f.t) }; s.thermal = null; s.seg = { ...at(s.phaseEnd ?? f.t) }; }
      // erster Gleitflug: ab Ausklinken bzw. Motor aus
      if (!s.seg && s.launchT != null) s.seg = { ...at(s.launchT) };
    }
  }

  // geflogene Strecke ab Abheben und Verlauf alle 10 s für die 60-Minuten-Mittel
  function updateHistory(f) {
    if (!s.airborne) return;
    const v = vec(f.lat, f.lon);
    if (s.prev && s.prev.t >= s.takeoffT) s.cum += chordKm(vec(s.prev.lat, s.prev.lon), v);
    const last = s.hist.at(-1);
    if (last && f.t - last.t < 10000) return;
    const w = s.wind && f.t - s.wind.t < WIND_STALE_MIN * 60000 ? s.wind : null;
    s.hist.push({ t: f.t, cum: s.cum, v, we: w?.e, wn: w?.n });
    while (s.hist.length && s.hist[0].t < f.t - 61 * 60000) s.hist.shift();
    s.free60 = null;
  }
  const HOUR = 3600000;
  // Verlaufspunkt von vor 60 min (nur wenn der Verlauf so weit reicht)
  function hourAgo(now) {
    const h = s.hist[0];
    return h && now - h.t >= HOUR - 15000 ? s.hist.find((x) => x.t >= now - HOUR) : null;
  }

  function updateTrace(f) {
    const t0 = startT();
    if (t0 == null || f.t < t0) return;
    const last = s.trace.at(-1);
    if (last && f.t - last.t < s.traceStep) return;
    s.trace.push({ t: f.t, lat: f.lat, lon: f.lon, v: vec(f.lat, f.lon) });
    s.olc = null;
    // höchstens 500 Punkte: jeden zweiten weglassen und den Abstand verdoppeln
    if (s.trace.length > 500) { s.trace = s.trace.filter((_, i) => i % 2 === 0); s.traceStep *= 2; }
  }

  let useLogger = true;
  return {
    reset,
    // Fahrt und Wind aus der IGC-Datei verwenden, wenn die Punkte sie mitbringen
    setUseLogger(on) { useLogger = on; },
    // f: { t, lat, lon, alt, speedKmh, track, enl? }
    process(f, polar) {
      if (f.lat == null || f.t == null) return;
      const dt = s.prev ? (f.t - s.prev.t) / 1000 : 0;
      if (s.prev && dt <= 0) return;
      updateCircling(f, dt);
      updateAir(f, polar);
      updateLaunch(f, dt);
      updatePhase(f);
      updateTrace(f);
      updateHistory(f);
      s.prev = f;
    },
    // Start des Schnitts ohne Aufgabe von Hand auf „jetzt“ setzen (null = wieder automatisch)
    setManualStart(t) {
      s.manualT = t;
      s.trace = []; s.traceStep = 10000; s.olc = null;
      if (t != null && s.prev) updateTrace(s.prev);
    },
    get circling() { return s.circling; },
    // Kurvenrate (°/s, über ca. 3 s geglättet), für schnelles Umschalten des Tons
    get turnRate() { return s.rate; },
    get wind() {
      const w = s.wind;
      if (!w || !s.prev || s.prev.t - w.t > WIND_STALE_MIN * 60000) return null;
      const spd = Math.hypot(w.e, w.n);
      return { e: w.e, n: w.n, speed: spd, from: (Math.atan2(-w.e, -w.n) * 180 / Math.PI + 360) % 360, t: w.t, circles: w.circles, logger: !!w.logger };
    },
    get airspeed() { return { tas: s.tas, ias: s.ias, gs: s.gs, fromWind: !!this.wind || !!s.loggerAir, logger: !!s.loggerAir }; },
    get netto() { return s.netto; },
    // Aktueller Abschnitt: im Bart das mittlere Steigen seit Beginn des Kreisens,
    // im Gleitflug Strecke (Luftlinie), Schnitt und Gleitzahl seit dem letzten Bart
    phase() {
      const p = s.prev;
      if (!p || p.alt == null) return null;
      if (s.thermal) {
        const sec = (p.t - s.thermal.t) / 1000;
        return { mode: "thermal", sec, gain: p.alt - s.thermal.alt, climb: sec > 0 ? (p.alt - s.thermal.alt) / sec : null };
      }
      if (s.seg) {
        const g = s.seg, sec = (p.t - g.t) / 1000;
        const km = chordKm(vec(g.lat, g.lon), vec(p.lat, p.lon));
        const lost = g.alt - p.alt;
        const last = s.lastThermal;
        return {
          mode: "glide", sec, km, speed: sec > 10 ? km / (sec / 3600) : null, ld: lost > 20 ? (km * 1000) / lost : null,
          lastClimb: last ? (last.end.alt - last.alt) / Math.max(1, (last.end.t - last.t) / 1000) : null,
        };
      }
      return null;
    },
    // Gleitzahl über Grund der letzten sec Sekunden: Strecke entlang der Spur / Höhenverlust.
    // null beim Kreisen oder wenn der Verlauf noch nicht so weit zurückreicht; ld = Infinity ohne Höhenverlust
    glideRatio(sec) {
      const p = s.recent.at(-1);
      if (!p || s.circling || !s.airborne) return null;
      const a = s.recent.find((x) => x.t >= p.t - sec * 1000);
      if (!a || p.t - a.t < sec * 800) return null;
      const km = p.cum - a.cum, lost = a.alt - p.alt;
      if (km < 0.05) return null;
      return { ld: lost > 1 ? (km * 1000) / lost : Infinity, km, lost };
    },
    // geflogene Strecke seit dem Abheben, dazu Schnitt der letzten 60 min entlang der Spur
    flown() {
      if (!s.airborne || !s.prev) return null;
      const h = hourAgo(s.prev.t);
      return { km: s.cum, speed60: h ? s.cum - h.cum : null };
    },
    // Wind im Mittel der letzten 60 min (Vektormittel der bekannten Werte)
    wind60() {
      if (!s.prev) return null;
      let e = 0, n = 0, k = 0;
      for (const x of s.hist) if (x.t >= s.prev.t - HOUR && x.we != null) { e += x.we; n += x.wn; k++; }
      if (k < 3) return null;
      e /= k; n /= k;
      return { speed: Math.hypot(e, n), from: (Math.atan2(-e, -n) * 180 / Math.PI + 360) % 360 };
    },
    // freie Strecke über 6 Schenkel innerhalb der letzten 60 min, als km/h
    freeSpeed60() {
      const t0 = startT();
      if (t0 == null || !s.prev || s.prev.t - t0 < HOUR - 15000 || !hourAgo(s.prev.t)) return null;
      if (s.free60 == null) {
        const pts = s.hist.filter((x) => x.t >= s.prev.t - HOUR && x.t >= t0);
        s.free60 = pts.length ? bestLegs(pts, 6) : [];
        s.free60pts = pts;
      }
      return s.free60pts.length ? lastLeg(s.free60pts, s.free60, vec(s.prev.lat, s.prev.lon)) : null;
    },
    // freier Flug: Start und Strecke (6 Schenkel) bis jetzt
    free() {
      const t0 = startT();
      if (t0 == null || !s.prev) return { startT: null, src: s.airborne ? "wartet auf Ausklinken" : "am Boden" };
      s.olc ??= bestLegs(s.trace, 6);
      const km = s.trace.length ? lastLeg(s.trace, s.olc, vec(s.prev.lat, s.prev.lon)) : 0;
      return { startT: t0, src: s.manualT != null ? "von Hand" : s.launchSrc, km, t: s.prev.t };
    },
  };
}
