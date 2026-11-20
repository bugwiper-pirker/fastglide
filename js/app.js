import { AIRCRAFT, ALTIMETER, VARIO, DEFAULT_WAYPOINTS, DEFAULT_AIRSPACE, SOARINGSPOT_PROXY, DEMO_FLIGHT } from "./config.js";
import { createAirspeed } from "./instruments/airspeed.js";
import { createAltimeter, ftText, flText } from "./instruments/altimeter.js";
import { createVario } from "./instruments/vario.js";
import { createClimbCalculator } from "./climb.js";
import { createVarioAudio } from "./audio.js";
import { createFinalGlide } from "./finalglide.js";
import { readWaypointFile, fetchDefaultWaypoints, saveWaypoints, loadWaypoints, clearWaypoints, cupTextFromBuffer, parseCup, distanceKm, LANDABLE } from "./waypoints.js";
import { readTaskBuffer, saveTask, loadTask, clearTask, isSoaringSpotPage, soaringSpotTaskUrl, zoneText } from "./task.js";
import { startGps, startSimulation, bearingDeg } from "./sources.js";
import { isIgc, parseIgc } from "./igc.js";
import { createReplay } from "./replay.js";
import { createMap3d } from "./map3d.js";
import { createCockpitPanel, fanout } from "./cockpit.js";
import { createMapView } from "./map.js";
import { POLARS, getPolarDef, makePolar, refWingLoading, CUSTOM_ID, customDef, checkPolar } from "./polar.js";
import { createFlightAnalyzer } from "./flight.js";
import { createTaskTracker } from "./taskspeed.js";
import { readAirspaceBuffer, readAirspaceFile, fetchDefaultAirspace, saveAirspace, loadAirspace, clearAirspace, checkAirspace, CATEGORIES, DEFAULT_WARN, altText, asKey, findByNames } from "./airspace.js";

// ---------- Einstellungen (lokal im Browser gespeichert) ----------
const DEFAULTS = { altOffset: 0, day: false, sim: false, varioWindow: 4, sound: false, volume: 60, sinkTone: false, sinkThreshold: -2.5, safetyHeight: 150, target: null, wpCleared: false,
  polar: POLARS[0].id, customPolar: null, mc: 1, wingLoading: null, bugs: 0, stfTone: true, igcAir: true,
  asWarnKm: 2, asVMargin: 150, asAlertSound: true, asWarnCats: DEFAULT_WARN,
  asIgnore: [], asTraActive: false, asCleared: false,
  showAirspace: true, showTask: true, page: "inst", mapSource: "osm", map3d: false, map3dImagery: "sat" };
function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem("ts-settings") || "{}") }; }
  catch { return { ...DEFAULTS }; }
}
const settings = loadSettings();
function saveSettings() {
  try { localStorage.setItem("ts-settings", JSON.stringify(settings)); } catch {}
}

// ---------- Instrumente ----------
// Neue Instrumente: Datei in js/instruments/ anlegen und hier eintragen.
// Jedes Instrument gibt es zweimal: auf der Instrumentenseite und im Pilz der Cockpitansicht (3D).
const cockpitPanel = createCockpitPanel(document.getElementById("cockpit"));
const instruments = [
  { el: "asi", create: (svg) => createAirspeed(svg, AIRCRAFT.asi), value: (d) => d.airKmh },
  { el: "vario", create: (svg) => createVario(svg, VARIO), value: (d) => d.vario, extra: (d) => ({ avg: d.varioAvg }) },
  { el: "alt", create: (svg) => createAltimeter(svg, ALTIMETER), value: (d) => d.altitude },
].map((i) => {
  const o = { ...i, main: i.create(document.getElementById(i.el)), ck: i.create(cockpitPanel.slots[i.el]), shown: null, target: null, extraVal: null };
  o.inst = fanout(() => [o.main, o.ck]);
  return o;
});
const climb = createClimbCalculator();
const varioInst = instruments.find((i) => i.el === "vario");
const audio = createVarioAudio();
const asiInst = instruments.find((i) => i.el === "asi");

// ---------- Polare, Flugauswertung, Schnitt ----------
let polar = buildPolar();
function buildPolar() {
  const def = getPolarDef(settings.polar, settings.customPolar);
  return makePolar(def, { wingLoading: settings.wingLoading ?? refWingLoading(def), bugs: settings.bugs });
}
// Fahrtmesser passend zum Flugzeug: Arcus M laut Flughandbuch, sonst nur v_NO
let asiFor = null;
function setupAsi() {
  const def = polar.def;
  const key = def.asi === "arcus" ? "arcus" : `${def.id}|${def.vno}|${def.vMax}`;
  if (asiFor === key) return;
  asiFor = key;
  const cfg = def.asi === "arcus" ? AIRCRAFT.asi : { max: def.vMax > 285 ? 300 : 285, vno: def.vno || null };
  const svg = document.getElementById("asi"), ck = cockpitPanel.slots.asi;
  svg.replaceChildren(); ck.replaceChildren();
  asiInst.main = createAirspeed(svg, cfg);
  asiInst.ck = createAirspeed(ck, cfg);
}
setupAsi();
const analyzer = createFlightAnalyzer();
analyzer.setUseLogger(settings.igcAir);
const tracker = createTaskTracker();
let fixLog = [];     // verarbeitete Punkte, damit eine neu geladene Aufgabe nachgerechnet werden kann
let perf = null;     // letzte Werte für die Anzeige
function feedFix(f) {
  analyzer.process(f, polar);
  tracker.process(f);
  fixLog.push(f);
  if (fixLog.length > 60000) fixLog = fixLog.filter((_, i) => i % 2 === 0);
}
function resetAnalysis() {
  analyzer.reset();
  tracker.reset();
  fixLog = [];
  perf = null;
}
function setTrackerTask(t) {
  if (tracker.task === t) return;
  tracker.setTask(t);
  for (const f of fixLog) tracker.process(f);
}

// ---------- Endanflug ----------
const fg = createFinalGlide({
  box: document.getElementById("fg"),
  picker: document.getElementById("picker"),
  getSettings: () => ({ safetyHeight: settings.safetyHeight, polar, mc: settings.mc, wind: analyzer.wind }),
  onSelect: (t) => { settings.target = t; saveSettings(); mapView?.setTarget(t); },
  onMc: () => openStf(),
});
let waypoints = loadWaypoints()?.points || [];
let airspaces = loadAirspace()?.spaces || [];
let task = loadTask()?.task || null;
tracker.setTask(task);
fg.setPoints(waypoints, settings.target);

// ---------- Kartenseite ----------
let mapView = null; // wird beim ersten Anzeigen der Karte erzeugt
let lastPos = null;
const instPage = document.querySelector(".gauges");
const mapPage = document.getElementById("mapview");
const pageBtn = document.getElementById("page");
const digi = {
  spdK: document.getElementById("d-spd-k"),
  spdS: document.getElementById("d-spd-s"),
  ph: document.getElementById("d-ph"),
  phK: document.getElementById("d-ph-k"),
  phU: document.getElementById("d-ph-u"),
  phS: document.getElementById("d-ph-s"),
  phBox: document.querySelector(".d-phase"),
  stf: document.getElementById("d-stf"),
  stfCmd: document.getElementById("d-stf-cmd"),
  stfS: document.getElementById("d-stf-s"),
  windK: document.getElementById("d-wind-k"),
  wind: document.getElementById("d-wind"),
  windArr: document.getElementById("d-wind-arr"),
  windS: document.getElementById("d-wind-s"),
  dist: document.getElementById("d-dist"),
  distS: document.getElementById("d-dist-s"),
  olc: document.getElementById("d-olc"),
  olcS: document.getElementById("d-olc-s"),
  olcv: document.getElementById("d-olcv"),
  olcvS: document.getElementById("d-olcv-s"),
  task: document.getElementById("d-task"),
  taskS: document.getElementById("d-task-s"),
  taskv: document.getElementById("d-taskv"),
  taskvS: document.getElementById("d-taskv-s"),
  spd: document.getElementById("d-spd"),
  var: document.getElementById("d-var"),
  avg: document.getElementById("d-avg"),
  alt: document.getElementById("d-alt"),
  altFt: document.getElementById("d-altft"),
  altU: document.getElementById("d-alt-u"),
  varK: document.getElementById("d-var-k"),
  ldK: document.getElementById("d-ld-k"),
  ld: document.getElementById("d-ld"),
  ldS: document.getElementById("d-ld-s"),
};
// Antippen von Fahrt, Höhe, Vario, Bart/Gleiten und Gleitzahl tauscht obere und untere Anzeige
const swapped = (k) => !!settings.swap?.[k];
document.querySelector(".digi").addEventListener("click", (e) => {
  const b = e.target.closest(".d-swap");
  if (!b) return;
  settings.swap = { ...settings.swap, [b.dataset.swap]: !swapped(b.dataset.swap) };
  saveSettings();
  updateDigital();
  renderPerf();
});
function ensureMap() {
  if (mapView) return mapView;
  if (!window.L) { showToast("Die Karte konnte nicht geladen werden."); return null; }
  mapView = createMapView({
    container: document.getElementById("map"),
    recenterBtn: document.getElementById("recenter"),
    onPickTarget: (p) => fg.selectPoint(p),
    getSource: () => settings.mapSource,
    isIgnored: (a) => settings.asIgnore.includes(asKey(a)),
    toggleIgnore: (a) => setIgnored(a, !settings.asIgnore.includes(asKey(a))),
    isTaskInactive: (a) => taskInactiveSpaces().keys.has(asKey(a)),
  });
  mapView.setAirspaces(airspaces);
  mapView.setTask(task);
  mapView.setLayerVisible("airspace", settings.showAirspace);
  mapView.setLayerVisible("task", settings.showTask);
  mapView.setPoints(waypoints);
  mapView.setTarget(settings.target);
  if (replayFlight) mapView.setFlight(replayFlight.fixes.map((f) => [f.lat, f.lon]));
  if (lastPos) mapView.update(lastPos);
  return mapView;
}
// ---------- 3D-Ansicht ----------
let map3d = null, map3dLoading = null;
const map2dEl = document.getElementById("map"), map3dEl = document.getElementById("map3d");
const tg3d = document.getElementById("tg-3d");
const recenterEl = document.getElementById("recenter");
function setMapTask(t) { mapView?.setTask(t); map3d?.setTask(t); setTrackerTask(t); }
async function ensureMap3d() {
  if (map3d) return map3d;
  if (!map3dLoading) {
    map3dLoading = createMap3d({
      container: map3dEl,
      followBtn: document.getElementById("follow3d"),
      getImagery: () => settings.map3dImagery,
    }).then((m) => {
      map3d = m;
      m.setAirspaces(airspaces);
      m.setTask(task);
      m.setLayerVisible("airspace", settings.showAirspace);
      m.setLayerVisible("task", settings.showTask);
      if (replayFlight) m.setFlight(replayFlight, replayOffset);
      if (lastPos) m.update({ ...lastPos, speedKmh: last?.speedKmh, time: last?.time });
      return m;
    });
  }
  return map3dLoading;
}
async function setView3d(on) {
  settings.map3d = on;
  saveSettings();
  tg3d.setAttribute("aria-pressed", on);
  map2dEl.hidden = on;
  map3dEl.hidden = !on;
  tgCockpit.hidden = !on;
  cockpitEl.hidden = !(on && settings.cockpit);
  if (on) recenterEl.hidden = true;
  if (!on) { document.getElementById("follow3d").hidden = true; mapView?.shown(); return; }
  try { const m = await ensureMap3d(); m.setCockpit(!!settings.cockpit); m.shown(); }
  catch (e) {
    showToast(e.message || "Die 3D-Ansicht konnte nicht geladen werden.");
    setView3d(false);
  }
}
tg3d.addEventListener("click", () => setView3d(!settings.map3d));
// Cockpitansicht: Blick aus dem Cockpit, unten der Instrumentenpilz
const tgCockpit = document.getElementById("tg-cockpit"), cockpitEl = document.getElementById("cockpit");
function setCockpit(on) {
  settings.cockpit = on;
  saveSettings();
  tgCockpit.setAttribute("aria-pressed", on);
  cockpitEl.hidden = !(on && settings.map3d);
  map3d?.setCockpit(on);
}
tgCockpit.addEventListener("click", () => setCockpit(!settings.cockpit));
tgCockpit.setAttribute("aria-pressed", !!settings.cockpit);

function showPage(page) {
  settings.page = page;
  saveSettings();
  const isMap = page === "map";
  document.body.classList.toggle("map-page", isMap);
  instPage.hidden = isMap;
  mapPage.hidden = !isMap;
  pageBtn.textContent = isMap ? "◎" : "🗺";
  pageBtn.title = isMap ? "Instrumente" : "Karte";
  pageBtn.setAttribute("aria-label", pageBtn.title);
  if (isMap && ensureMap()) requestAnimationFrame(() => mapView.shown());
  if (isMap && settings.map3d) setView3d(true);
}
pageBtn.addEventListener("click", () => showPage(settings.page === "map" ? "inst" : "map"));

const fmtVar = (v) => (v > 0.05 ? "+" : v < -0.05 ? "−" : "") + Math.abs(v).toFixed(1);
const fmtAlt = (a) => Math.round(a).toLocaleString("de-AT").replace(/[.,\u202f\u00a0]/g, " ");
function updateDigital() {
  const by = (id) => instruments.find((i) => i.el === id).shown;
  const spd = by("asi"), v = by("vario"), alt = by("alt");
  // Fahrt: IAS (Logger oder aus Wind) oben, GPS-Fahrt unten – oder getauscht
  const p = perf, iasName = p?.logger ? "IAS Logger" : "IAS ber.";
  if (swapped("spd") && p?.ias != null) {
    digi.spdK.textContent = "Fahrt GS";
    digi.spd.textContent = p.gs == null ? "---" : Math.round(p.gs);
    digi.spdS.textContent = spd == null ? "---" : `${iasName.replace(" Logger", "")} ${Math.round(spd)}`;
  } else {
    digi.spdK.textContent = p?.ias != null ? iasName : "Fahrt GS";
    digi.spd.textContent = spd == null ? "---" : Math.round(spd);
    digi.spdS.textContent = !p || p.gs == null ? "---" : p.ias != null ? `GS ${Math.round(p.gs)}` : "über Grund";
  }
  // Höhe: m oder ft oben
  if (swapped("alt")) {
    digi.alt.textContent = alt == null ? "-----" : fmtAlt(alt / 0.3048);
    digi.altU.textContent = "ft";
    digi.altFt.textContent = alt == null ? "---- m · FL ---" : `${fmtAlt(alt)} m · ${flText(alt)}`;
  } else {
    digi.alt.textContent = alt == null ? "-----" : fmtAlt(alt);
    digi.altU.textContent = "m";
    digi.altFt.textContent = alt == null ? "---- ft · FL ---" : `${ftText(alt)} · ${flText(alt)}`;
  }
  // Vario: aktuell oder Mittel oben
  const avg = varioInst.extraVal?.avg;
  const vTxt = v == null ? "---" : fmtVar(v), aTxt = avg == null ? "---" : fmtVar(avg);
  const sw = swapped("var");
  digi.varK.textContent = sw ? "Vario Ø" : "Vario";
  digi.var.textContent = sw ? aTxt : vTxt;
  digi.avg.textContent = sw ? `jetzt ${vTxt}` : `Ø ${aTxt}`;
}

const fmt1 = (v) => v.toLocaleString("de-AT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtKmT = (km) => km.toLocaleString("de-AT", { maximumFractionDigits: km < 100 ? 1 : 0 });
// Uhrzeit: beim Abspielen in der Zeitzone des Fluges
function clockText(ms) {
  if (ms == null) return "--:--";
  const tz = replayFlight ? (replayFlight.tzHours != null ? replayFlight.tzHours * 3600000 : -new Date(ms).getTimezoneOffset() * 60000) : -new Date(ms).getTimezoneOffset() * 60000;
  const d = new Date(ms + tz);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
const windText = (w) => w ? `${String(Math.round(w.from / 10) * 10 % 360).padStart(3, "0")}°/${Math.round(w.speed * 3.6)}` : null;

// Sollfahrt, Schnitt und Wind aus der Flugauswertung
function updatePerf(d) {
  const air = analyzer.airspeed, wind = analyzer.wind;
  const ias = air.fromWind ? air.ias : null;
  const netto = analyzer.netto;
  // beim Kreisen die Sollfahrt für den nächsten Gleitflug (ohne Netto)
  const stf = polar.stf(settings.mc, analyzer.circling ? 0 : netto ?? 0) * 3.6;
  const speed = ias ?? d.speedKmh;
  perf = { ias, gs: d.speedKmh, wind, netto, stf, speed, circling: analyzer.circling, logger: air.logger };
  asiInst.inst.setLabel(air.logger ? "IAS Logger" : ias != null ? "IAS ber." : "GS");
  asiInst.inst.setBug(d.speedKmh == null ? null : stf);
  const flying = d.speedKmh != null && d.speedKmh > 40;
  audio.setStf(settings.stfTone && flying && !perf.circling && speed != null ? speed - stf : null);
}

// Windpfeil: zeigt, wohin der Wind weht (Karte nordausgerichtet), immer auf dem kürzeren Weg drehen
let windArrAngle = 0;
function setWindArrow(from) {
  if (from == null) { digi.windArr.dataset.off = ""; return; }
  delete digi.windArr.dataset.off;
  windArrAngle += ((from - windArrAngle) % 360 + 540) % 360 - 180;
  digi.windArr.style.transform = `rotate(${windArrAngle}deg)`;
}
const dir3 = (deg) => `${String(Math.round(deg / 5) * 5 % 360).padStart(3, "0")}°`;
const avg60 = (v) => `Ø60 ${v == null ? "---" : Math.round(v)}`;

function renderPerf() {
  const p = perf;

  // Wind: aktuell groß, darunter das Mittel der letzten 60 min
  const w = p?.wind, w60 = analyzer.wind60();
  digi.windK.textContent = w ? `Wind ${dir3(w.from)}` : "Wind";
  digi.wind.textContent = w ? Math.round(w.speed * 3.6) : "--";
  setWindArrow(w ? w.from : null);
  digi.windS.textContent = w60 ? `Ø60 ${dir3(w60.from)}/${Math.round(w60.speed * 3.6)}` : "Ø60 ---";

  // Bart: mittleres Steigen seit Beginn des Kreisens; Gleitflug: Strecke, Schnitt, Gleitzahl
  const ph = analyzer.phase();
  const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
  digi.phBox.dataset.mode = ph?.mode || "";
  const swPh = swapped("ph");
  if (ph?.mode === "thermal") {
    const climbTxt = ph.climb == null ? "---" : fmtVar(ph.climb);
    const gainTxt = `${ph.gain >= 0 ? "+" : "−"}${Math.abs(Math.round(ph.gain))}`;
    digi.phK.textContent = swPh ? "Bart Gewinn" : "Bartsteigen";
    digi.ph.textContent = swPh ? gainTxt : climbTxt;
    digi.phU.textContent = swPh ? "m" : "m/s";
    if (ph.climb < 0) digi.phBox.dataset.sink = ""; else delete digi.phBox.dataset.sink;
    digi.phS.textContent = `${mmss(ph.sec)} · ${swPh ? `${climbTxt} m/s` : `${gainTxt} m`}`;
  } else if (ph?.mode === "glide") {
    const spdTxt = ph.speed == null ? "--" : Math.round(ph.speed);
    const ldTxt = `GZ ${ph.ld == null || ph.ld > 200 ? "--" : Math.round(ph.ld)}`;
    digi.phK.textContent = swPh ? "Gleitflug Schnitt" : "Gleitflug";
    digi.ph.textContent = swPh ? spdTxt : fmt1(ph.km);
    digi.phU.textContent = swPh ? "km/h" : "km";
    digi.phS.textContent = swPh ? `${fmt1(ph.km)} km · ${ldTxt}` : `${spdTxt} km/h · ${ldTxt}`;
  } else {
    digi.phK.textContent = "Bart / Gleiten";
    digi.ph.textContent = "---";
    digi.phU.textContent = "";
    digi.phS.textContent = "---";
  }

  // Gleitzahl über Grund: letzte 30 s und Mittel über 2 min (beim Kreisen keine)
  const fmtLd = (g) => (!g ? "---" : g.ld >= 200 ? "∞" : Math.round(g.ld));
  const g30 = analyzer.glideRatio(30), g120 = analyzer.glideRatio(120);
  const swLd = swapped("ld");
  // am Handy „GZ“ statt „Gleitzahl“, sonst wird die Überschrift abgeschnitten
  digi.ldK.innerHTML = `<span class="d-long">Gleitzahl</span><span class="d-short">GZ</span> ${swLd ? "2 min" : "30 s"}`;
  digi.ld.textContent = fmtLd(swLd ? g120 : g30);
  digi.ldS.textContent = analyzer.circling ? "Kreisen" : swLd ? `30 s ${fmtLd(g30)}` : `Ø 2 min ${fmtLd(g120)}`;

  // Weg geflogen (ganze Spur) und OLC (6 Schenkel)
  const fw = analyzer.flown();
  digi.dist.textContent = fw ? fmtKmT(fw.km) : "---";
  digi.distS.textContent = avg60(fw?.speed60);
  const fr = analyzer.free();
  const h = fr.startT != null ? (fr.t - fr.startT) / 3600000 : 0;
  digi.olc.textContent = fr.startT != null ? fmtKmT(fr.km) : "---";
  digi.olcS.textContent = fr.startT != null ? `ab ${clockText(fr.startT)}` : fr.src;
  digi.olcv.textContent = fr.startT != null && h > 1 / 60 ? fmt1(fr.km / h) : "---";
  digi.olcvS.textContent = avg60(analyzer.freeSpeed60());

  // Aufgabe
  const r = tracker.result();
  document.body.classList.toggle("has-task", !!r);
  if (r) {
    digi.task.textContent = r.state === "pre" ? "---" : fmtKmT(r.km);
    digi.taskS.textContent = r.state === "pre" ? "vor dem Abflug" : r.state === "done" ? `Ziel ${clockText(r.finishT)}` : `ab ${clockText(r.startT)}`;
    digi.taskv.textContent = r.speedKmh != null ? fmt1(r.speedKmh) : "---";
    digi.taskvS.textContent = avg60(r.speed60);
  }

  digi.stf.textContent = p ? Math.round(p.stf) : "---";
  let cmd = "", dir = "";
  if (p && !p.circling && p.speed != null && p.gs > 40) {
    const diff = p.speed - p.stf;
    if (diff > 5) { cmd = `▲${Math.round(diff)}`; dir = "pull"; }
    else if (diff < -5) { cmd = `▼${Math.round(-diff)}`; dir = "push"; }
    else cmd = "●";
  }
  digi.stfCmd.textContent = cmd;
  digi.stfCmd.dataset.dir = dir;
  digi.stfCmd.title = dir === "pull" ? "zu schnell: ziehen" : dir === "push" ? "zu langsam: drücken" : "";
  digi.stfS.textContent = `MC ${fmt1(settings.mc)}` + (!p ? "" : p.circling ? " · Kreisen" : p.netto != null ? ` · Netto ${fmtVar(p.netto)}` : " · ohne Wind");
}

// ---------- Datenfluss ----------
const STALE_MS = 5000;
let last = null;      // letzter Rohwert
let lastTime = 0;
const statusEl = document.getElementById("status");
const statusText = document.getElementById("status-text");

function onData(d) {
  last = d;
  lastTime = Date.now();
  // Flug abspielen: nach einem Sprung neu anfangen, Zwischenpunkte fürs Vario einrechnen
  if (d.reset) climb.reset();
  for (const s of d.samples || []) climb.add(s.t, s.alt, settings.varioWindow);
  const c = climb.add(d.time, d.altitude, settings.varioWindow);
  // Flugauswertung: beim Abspielen die echten Punkte der Datei, nach einem Sprung neu ab Beginn
  if (d.replay && replayFlight) {
    if (d.reset) {
      const lastT = fixLog.at(-1)?.t ?? -Infinity;
      if (d.time < lastT || !fixLog.length) resetAnalysis();
      const from = fixLog.at(-1)?.t ?? -Infinity;
      for (const x of replayFlight.fixes) {
        if (x.t > d.time) break;
        if (x.t > from) feedFix({ t: x.t, lat: x.lat, lon: x.lon, alt: x.alt + replayOffset, speedKmh: x.speedKmh, track: x.track, enl: x.enl, tas: x.tas, ias: x.ias, wind: x.wind });
      }
    } else for (const x of d.samples || []) feedFix(x);
  } else if (d.lat != null) {
    feedFix({ t: d.time, lat: d.lat, lon: d.lon, alt: d.altitude == null ? null : d.altitude + settings.altOffset, speedKmh: d.speedKmh, track: d.track });
  }
  updatePerf(d);

  const data = {
    airKmh: perf?.speed ?? d.speedKmh,
    speedKmh: d.speedKmh,
    // die Höhe aus der IGC-Datei ist schon auf die Platzhöhe abgeglichen
    altitude: d.altitude == null ? null : d.altitude + (d.replay ? 0 : settings.altOffset),
    vario: c.vario,
    varioAvg: c.avg,
  };
  for (const i of instruments) {
    i.target = i.value(data);
    if (i.extra) i.extraVal = i.extra(data);
  }
  const pos = d.lat == null ? null : {
    lat: d.lat, lon: d.lon, alt: data.altitude,
    // Kurs nur verwenden, wenn wir uns bewegen
    track: d.track != null && (d.speedKmh == null || d.speedKmh > 15) ? d.track : null,
  };
  fg.update(pos);
  if (pos) { lastPos = pos; mapView?.update(pos); }
  if (pos && map3d && settings.map3d && settings.page === "map") {
    // Blickrichtung beim Kreisen: zur nächsten Wende bzw. zum Ziel
    const r = tracker.result();
    const ahead = r?.state === "run" ? task.points[r.next] : settings.target;
    map3d.update({
      ...pos, speedKmh: d.speedKmh, vario: c.vario, time: d.time, circling: analyzer.circling,
      aheadBearing: ahead ? bearingDeg(pos.lat, pos.lon, ahead.lat, ahead.lon) : null,
    });
  }
  updateAirspaceWarnings(pos ? { ...pos, speedKmh: d.speedKmh } : null);
  setStatus("ok", d.replay ? `FLUG ${replay?.speed ?? ""}×` : settings.sim ? "SIMULATION" : `GPS ±${Math.round(d.accuracy)} m`);
}

function onError(msg, code) {
  setStatus("err", code === 1 ? "GPS GESPERRT" : "KEIN GPS");
  showToast(msg);
}

function setStatus(state, text) {
  statusEl.dataset.state = state;
  statusText.textContent = text;
}

let stopSource = null;
function startSource() {
  stopReplay();
  if (stopSource) stopSource();
  last = null;
  climb.reset();
  resetAnalysis();
  for (const i of instruments) { i.target = null; i.extraVal = null; }
  setStatus("wait", settings.sim ? "SIMULATION" : "GPS SUCHT …");
  stopSource = settings.sim ? startSimulation(onData) : startGps(onData, onError);
}

// Zeiger weich nachführen; veraltete Daten deutlich anzeigen
let frameCount = 0;
function frame() {
  const stale = last && Date.now() - lastTime > STALE_MS;
  document.body.classList.toggle("stale", !last || stale);
  if (stale && statusText.textContent !== "GPS VERALTET") {
    setStatus("err", "GPS VERALTET");
    fg.update(null);
    updateAirspaceWarnings(null);
  }
  for (const i of instruments) {
    if (i.target == null || stale) { i.shown = null; i.inst.update(null, null); continue; }
    i.shown = i.shown == null ? i.target : i.shown + (i.target - i.shown) * 0.15;
    i.inst.update(i.shown, i.extraVal);
  }
  audio.setValue(stale ? null : varioInst.target);
  if (stale) audio.setStf(null);
  if (settings.page === "map") updateDigital();
  if (frameCount++ % 10 === 0) renderPerf();
  requestAnimationFrame(frame);
}

// ---------- Luftraumwarnung ----------
const asBanner = document.getElementById("aswarn");
const asTitle = document.getElementById("aswarn-title");
const asDetail = document.getElementById("aswarn-detail");
const alerted = new Map();   // Luftraum -> { level, time, seen }
const acked = new Map();     // Luftraum -> bestätigt bis (ms)
const ACK_MS = 5 * 60 * 1000;
let currentWarnings = [];

// unter 1 km in Metern (auf 10 m gerundet), sonst km
const fmtKm = (km) => (km < 0.995 ? `${Math.round(km * 100) * 10} m` : (km < 10 ? km.toFixed(1).replace(".", ",") : Math.round(km)) + " km");

// Lufträume, die laut Aufgabe inaktiv sind. Gilt nur am Tag der Aufgabe.
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
let taskInactive = { day: null, matches: new Map(), keys: new Set() };
function taskInactiveSpaces() {
  const names = task?.info?.inactiveAirspaces || [];
  const day = todayIso();
  if (taskInactive.task !== task || taskInactive.spaces !== airspaces || taskInactive.day !== day) {
    const active = names.length && (!task.info.date || task.info.date === day);
    const matches = active ? findByNames(airspaces, names) : new Map();
    const keys = new Set([...matches.values()].flat().map(asKey));
    taskInactive = { task, spaces: airspaces, day, matches, keys, active: !!active };
  }
  return taskInactive;
}

function warnOpts() {
  const cats = new Set(settings.asWarnCats);
  if (cats.has("C")) { cats.add("A"); cats.add("B"); }
  if (cats.has("P")) cats.add("GP");
  return {
    warnCats: cats, warnKm: settings.asWarnKm, vMargin: settings.asVMargin, lookaheadS: 60,
    ignore: new Set([...settings.asIgnore, ...taskInactiveSpaces().keys]), traActive: settings.asTraActive,
  };
}

function setIgnored(a, on) {
  const k = asKey(a);
  const set = new Set(settings.asIgnore);
  if (on) set.add(k); else set.delete(k);
  settings.asIgnore = [...set];
  saveSettings();
  mapView?.setWarned(currentWarnings.filter((w) => !set.has(asKey(w.space)) && !taskInactiveSpaces().keys.has(asKey(w.space))).map((w) => w.space));
  showToast(on ? `Keine Warnung mehr für „${a.name}“. Rückgängig in ⚙ oder auf der Karte.` : `Warnung für „${a.name}“ wieder aktiv.`);
}

function updateAirspaceWarnings(pos) {
  const now = Date.now();
  const list = pos && airspaces.length ? checkAirspace(airspaces, pos, warnOpts()) : [];
  currentWarnings = list;
  mapView?.setWarned(list.map((w) => w.space));

  // Ton/Vibration: bei neuer Warnung, beim Einflug und alle 30 s solange man drin ist
  let alarm = null;
  for (const w of list) {
    const prev = alerted.get(w.space);
    const isAcked = (acked.get(w.space) || 0) > now;
    const fire = !prev || (prev.level === "near" && w.level === "inside") ||
      (w.level === "inside" && now - prev.time > 30000);
    if (fire && !isAcked) {
      alerted.set(w.space, { level: w.level, time: now, seen: now });
      if (!alarm || w.level === "inside") alarm = w.level;
    } else if (prev) prev.seen = now;
  }
  // Lufträume, die seit 60 s nicht mehr gemeldet wurden, vergessen (verhindert Flackern am Rand)
  for (const [a, v] of alerted) if (now - v.seen > 60000) alerted.delete(a);
  if (alarm) {
    if (settings.asAlertSound) audio.alert(alarm);
    // Vibration ist erst nach einer Berührung des Bildschirms erlaubt
    if (navigator.userActivation?.hasBeenActive) {
      try { navigator.vibrate?.(alarm === "inside" ? [400, 150, 400, 150, 400] : [300, 150, 300]); } catch {}
    }
  }

  const visible = list.filter((w) => (acked.get(w.space) || 0) <= now);
  if (!visible.length) { asBanner.hidden = true; return; }
  const w = visible[0], a = w.space;
  const cat = CATEGORIES[a.cat] || CATEGORIES.OTHER;
  asBanner.hidden = false;
  asBanner.dataset.level = w.level;
  if (w.level === "inside") asTitle.textContent = "IM LUFTRAUM";
  else if (w.dist > 0.05) asTitle.textContent = `LUFTRAUM IN ${fmtKm(w.dist)}` + (w.vgap > 0 ? ` · ${Math.round(w.vgap)} m Abstand` : "");
  else asTitle.textContent = w.vgap > 0 ? `LUFTRAUM ${Math.round(w.vgap)} m ${(lastPos?.alt ?? 0) < a.lower.m ? "ÜBER" : "UNTER"} DIR` : "LUFTRAUM VORAUS";
  asDetail.textContent = `${a.name} · ${cat.label} · ${altText(a)}` + (visible.length > 1 ? ` · +${visible.length - 1} weitere` : "");
}
document.getElementById("aswarn-ignore").addEventListener("click", (e) => {
  e.stopPropagation();
  const now = Date.now();
  const w = currentWarnings.find((x) => (acked.get(x.space) || 0) <= now);
  if (w) setIgnored(w.space, true);
  asBanner.hidden = true;
  updateAirspaceWarnings(lastPos && now - lastTime < STALE_MS ? { ...lastPos, speedKmh: last?.speedKmh } : null);
});
asBanner.addEventListener("click", () => {
  const until = Date.now() + ACK_MS;
  for (const w of currentWarnings) acked.set(w.space, until);
  asBanner.hidden = true;
  showToast("Warnung für 5 Minuten bestätigt.");
});

// ---------- Bildschirm anlassen ----------
let wakeLock = null;
async function keepAwake() {
  try {
    if ("wakeLock" in navigator && document.visibilityState === "visible") {
      wakeLock = await navigator.wakeLock.request("screen");
    }
  } catch { /* nicht unterstützt oder abgelehnt */ }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") keepAwake();
});

// ---------- Bedienung ----------
const toastEl = document.getElementById("toast");
let toastTimer;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), 6000);
}

function applyDay() {
  document.body.classList.toggle("day", settings.day);
  document.getElementById("day").setAttribute("aria-pressed", settings.day);
  document.querySelector('meta[name="theme-color"]').content = settings.day ? "#e9ecef" : "#15181c";
}

const dlg = document.getElementById("settings");
const offsetIn = document.getElementById("alt-offset");
const fieldIn = document.getElementById("field-elev");
const simIn = document.getElementById("sim");
const varioWinIn = document.getElementById("vario-window");
const gpsAltOut = document.getElementById("gps-alt");
const soundBtn = document.getElementById("sound");
const volumeIn = document.getElementById("volume");
const sinkToneIn = document.getElementById("sink-tone");
const sinkThrIn = document.getElementById("sink-threshold");
const imagery3dIn = document.getElementById("map3d-imagery");
imagery3dIn.addEventListener("change", () => {
  settings.map3dImagery = imagery3dIn.value;
  saveSettings();
  map3d?.setImagery(settings.map3dImagery);
});
const mapSrcIn = document.getElementById("map-source");
mapSrcIn.addEventListener("change", () => {
  settings.mapSource = mapSrcIn.value;
  saveSettings();
  mapView?.setSource(settings.mapSource);
});

// ---------- Vario-Ton ----------
function applyAudioSettings() {
  audio.setVolume(settings.volume / 100);
  audio.setSinkTone(settings.sinkTone, settings.sinkThreshold);
}
function updateSoundBtn() {
  const running = audio.isRunning();
  soundBtn.setAttribute("aria-pressed", settings.sound);
  soundBtn.textContent = settings.sound ? "🔊" : "🔇";
  soundBtn.classList.toggle("pending", settings.sound && !running);
}
async function startSound() {
  try {
    const ok = await audio.enable();
    if (!ok) showToast("Ton noch nicht aktiv. Bitte einmal auf den Bildschirm tippen.");
  } catch {
    showToast("Dieses Gerät kann hier keinen Ton abspielen.");
  }
  updateSoundBtn();
}
soundBtn.addEventListener("click", async () => {
  settings.sound = !settings.sound;
  saveSettings();
  if (settings.sound) {
    await startSound();
    if (audio.isRunning()) showToast("Vario-Ton ein. Lautstärke über die Medien-Lautstärke des Handys.");
  } else {
    audio.disable();
    updateSoundBtn();
  }
});
// Endanflug-Box: Tippen öffnet die Zielauswahl
const fgBox = document.getElementById("fg");
function openPicker() {
  if (!fg.open()) showToast("Zuerst in ⚙ eine Wendepunktdatei laden.");
}
fgBox.addEventListener("click", openPicker);
fgBox.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPicker(); } });
document.getElementById("wp-none").addEventListener("click", () => {
  settings.target = null; saveSettings();
  fg.setPoints(waypoints, null);
  mapView?.setTarget(null);
  document.getElementById("picker").close();
});

const wpFile = document.getElementById("wp-file");
const wpInfo = document.getElementById("wp-info");
function showWpInfo() {
  const stored = loadWaypoints();
  wpInfo.textContent = stored ? `${stored.points.length} Wendepunkte aus „${stored.fileName}“` : "Keine Datei geladen";
}
function useWaypoints(fileName, points, keepTarget) {
  try { saveWaypoints(fileName, points); }
  catch { showToast("Die Datei ist zu groß zum Speichern. Sie gilt nur bis zum Schließen der App."); }
  if (!keepTarget) settings.target = null;
  settings.wpCleared = false;
  saveSettings();
  waypoints = points;
  fg.setPoints(points, settings.target);
  mapView?.setPoints(points);
  mapView?.setTarget(settings.target);
  wpInfo.textContent = `${points.length} Wendepunkte aus „${fileName}“`;
}
wpFile.addEventListener("change", async () => {
  const file = wpFile.files[0];
  if (!file) return;
  try {
    const points = await readWaypointFile(file);
    useWaypoints(file.name, points, false);
    showToast(`${points.length} Wendepunkte geladen. Tippe oben auf die Endanflug-Box, um ein Ziel zu wählen.`);
  } catch (e) {
    showToast(e.message || "Die Datei konnte nicht gelesen werden.");
  }
  wpFile.value = "";
});
async function loadDefaultWaypoints(quiet) {
  try {
    const points = await fetchDefaultWaypoints(DEFAULT_WAYPOINTS.url);
    useWaypoints(DEFAULT_WAYPOINTS.name, points, true);
    if (!quiet) showToast(`${points.length} Standard-Wendepunkte geladen.`);
  } catch (e) {
    if (!quiet) showToast(e.message || "Die Standard-Wendepunktdatei konnte nicht geladen werden.");
  }
}
document.getElementById("wp-default").addEventListener("click", () => loadDefaultWaypoints(false));
document.getElementById("wp-clear").addEventListener("click", () => {
  clearWaypoints();
  settings.target = null;
  settings.wpCleared = true; // nach bewusstem Löschen nicht automatisch neu laden
  saveSettings();
  waypoints = [];
  fg.setPoints([], null);
  mapView?.setPoints([]);
  mapView?.setTarget(null);
  showWpInfo();
});
// ---------- Luftraum-Einstellungen ----------
const asFile = document.getElementById("as-file");
const asInfo = document.getElementById("as-info");
function showAsInfo() {
  const stored = loadAirspace();
  asInfo.textContent = stored ? `${stored.spaces.length} Lufträume aus „${stored.fileName}“` : "Keine Luftraumdatei geladen";
  asIgnInfo.textContent = settings.asIgnore.length
    ? `Keine Warnung für: ${settings.asIgnore.map((k) => k.split("|")[0]).join(", ")}`
    : "Keine Ausnahmen.";
}
const asIgnInfo = document.getElementById("as-ign-info");
document.getElementById("as-ign-reset").addEventListener("click", () => {
  settings.asIgnore = [];
  saveSettings();
  if (mapView) mapView.setAirspaces(airspaces);
  showAsInfo();
});
async function loadDefaultAirspace(quiet) {
  try {
    const { text, spaces } = await fetchDefaultAirspace(DEFAULT_AIRSPACE.url);
    try { saveAirspace(DEFAULT_AIRSPACE.name, text); } catch {}
    settings.asCleared = false; saveSettings();
    useAirspaces(spaces);
    showAsInfo();
    if (!quiet) showToast(`${spaces.length} Lufträume geladen (${DEFAULT_AIRSPACE.label}).`);
  } catch (e) {
    if (!quiet) showToast(e.message || "Die Standard-Luftraumdatei konnte nicht geladen werden.");
  }
}
document.getElementById("as-default").addEventListener("click", () => loadDefaultAirspace(false));
function useAirspaces(list) {
  airspaces = list;
  alerted.clear(); acked.clear();
  mapView?.setAirspaces(list);
  map3d?.setAirspaces(list);
  updateAirspaceWarnings(lastPos && Date.now() - lastTime < STALE_MS ? { ...lastPos, speedKmh: last?.speedKmh } : null);
}
asFile.addEventListener("change", async () => {
  const file = asFile.files[0];
  if (!file) return;
  try {
    const { text, spaces } = await readAirspaceFile(file);
    settings.asCleared = false; saveSettings();
    try { saveAirspace(file.name, text); }
    catch { showToast("Die Luftraumdatei ist zu groß zum Speichern. Sie gilt nur bis zum Schließen der App."); }
    useAirspaces(spaces);
    showAsInfo();
    if (!loadAirspace()) asInfo.textContent = `${spaces.length} Lufträume aus „${file.name}“ (nicht gespeichert)`;
    showToast(`${spaces.length} Lufträume geladen.`);
  } catch (e) {
    showToast(e.message || "Die Luftraumdatei konnte nicht gelesen werden.");
  }
  asFile.value = "";
});
document.getElementById("as-clear").addEventListener("click", () => {
  clearAirspace();
  settings.asCleared = true; saveSettings();
  useAirspaces([]);
  showAsInfo();
});
const asKmIn = document.getElementById("as-km");
const asVIn = document.getElementById("as-vmargin");
const asSoundIn = document.getElementById("as-sound");
const asCatsEl = document.getElementById("as-cats");
const WARN_CHOICES = [
  ["C", "Klasse C (und A, B)"], ["D", "Klasse D"], ["CTR", "Kontrollzonen (CTR)"],
  ["R", "Beschränkungsgebiete (R)"], ["P", "Sperrgebiete (P, GP)"], ["Q", "Gefahrengebiete (Q)"],
  ["TMZ", "TMZ"], ["RMZ", "RMZ"],
];
for (const [key, label] of WARN_CHOICES) {
  const l = document.createElement("label");
  l.className = "row";
  const cb = document.createElement("input");
  cb.type = "checkbox"; cb.value = key; cb.id = `as-cat-${key}`;
  cb.addEventListener("change", () => {
    const set = new Set(settings.asWarnCats);
    if (cb.checked) set.add(key); else set.delete(key);
    settings.asWarnCats = [...set];
    saveSettings();
  });
  const sw = document.createElement("i");
  sw.className = "as-swatch";
  sw.style.setProperty("--c", CATEGORIES[key].color);
  l.append(cb, sw, document.createTextNode(label));
  asCatsEl.appendChild(l);
}
asKmIn.addEventListener("change", () => { settings.asWarnKm = Number(asKmIn.value) || 2; saveSettings(); });
asVIn.addEventListener("change", () => { settings.asVMargin = Number(asVIn.value) || 150; saveSettings(); });
asSoundIn.addEventListener("change", () => { settings.asAlertSound = asSoundIn.checked; saveSettings(); });
const asTraIn = document.getElementById("as-tra");
asTraIn.addEventListener("change", () => { settings.asTraActive = asTraIn.checked; saveSettings(); });
document.getElementById("as-test").addEventListener("click", async () => {
  await audio.unlock();
  if (!audio.alert("near")) showToast("Ton nicht verfügbar. Bitte einmal auf den Bildschirm tippen.");
});

const safetyIn = document.getElementById("safety-height");
safetyIn.addEventListener("change", () => {
  settings.safetyHeight = Math.max(0, Number(safetyIn.value) || 0);
  saveSettings(); fg.render();
});

// ---------- Sollfahrt: Polare, MC, Flächenbelastung, Mücken ----------
const polarIn = document.getElementById("polar");
const stfToneIn = document.getElementById("stf-tone");
const stfDlg = document.getElementById("stf-dlg");
const mcIn = document.getElementById("mc"), wlIn = document.getElementById("wing-loading"), bugsIn = document.getElementById("bugs");
const polarSearch = document.getElementById("polar-search");
const customBox = document.getElementById("custom-polar");
// Liste: Arcus zuerst, dann alle aus XCSoar, am Ende die eigene Polare; die Suche filtert
function fillPolarList() {
  const q = polarSearch.value.trim().toLowerCase().replace(/[\s-]+/g, "");
  const match = (p) => !q || p.name.toLowerCase().replace(/[\s-]+/g, "").includes(q) || p.id === settings.polar;
  const group = (label, items) => {
    const g = document.createElement("optgroup");
    g.label = label;
    g.append(...items.map((p) => new Option(p.name + (p.handicap ? ` · Index ${p.handicap}` : ""), p.id)));
    return items.length ? [g] : [];
  };
  const own = customDef(settings.customPolar);
  polarIn.replaceChildren(
    ...group("Flughandbuch", POLARS.filter((p) => p.asi && match(p))),
    ...group("XCSoar", POLARS.filter((p) => !p.asi && match(p))),
    ...group("Eigene", [{ id: CUSTOM_ID, name: own ? `${own.name} (eigene)` : "Eigene Polare eingeben …" }].filter((p) => !q || match(p) || "eigene".includes(q))),
  );
  polarIn.value = settings.polar;
}
polarSearch.addEventListener("input", fillPolarList);
function fillCustom() {
  const d = settings.customPolar || polar.def; // zum Anpassen mit der aktuellen Polare vorbelegen
  const $ = (id) => document.getElementById(id);
  $("cp-name").value = settings.customPolar?.name || `${polar.def.name} (angepasst)`;
  $("cp-mass").value = d.refMass; $("cp-area").value = d.area;
  d.points.forEach(([v, s], i) => { $(`cp-v${i + 1}`).value = v; $(`cp-s${i + 1}`).value = s; });
  $("cp-vno").value = d.vno ?? ""; $("cp-vne").value = settings.customPolar?.vne ?? "";
}
document.getElementById("cp-save").addEventListener("click", () => {
  const num = (id) => Number(document.getElementById(id).value.replace(",", "."));
  const c = {
    name: document.getElementById("cp-name").value.trim() || "Eigene Polare",
    refMass: num("cp-mass"), area: num("cp-area"),
    points: [1, 2, 3].map((i) => [num(`cp-v${i}`), Math.abs(num(`cp-s${i}`))]),
    vno: num("cp-vno") || null, vne: num("cp-vne") || null,
  };
  const def = customDef(c);
  const vs = c.points.map((p) => p[0]);
  if (!def || !(vs[0] < vs[1] && vs[1] < vs[2]) || !checkPolar(def)) {
    showToast("Die Werte ergeben keine brauchbare Polare. Bitte Masse, Fläche und drei Punkte mit steigender Fahrt prüfen.");
    return;
  }
  settings.customPolar = c;
  settings.polar = CUSTOM_ID;
  settings.wingLoading = null;
  applyStf();
  fillPolarList();
  showToast(`Eigene Polare „${c.name}“ übernommen: beste Gleitzahl ${Math.round(polar.bestGlide)}.`);
});
function showPolarInfo() {
  const d = polar.def;
  const wl0 = refWingLoading(d);
  customBox.hidden = polarIn.value !== CUSTOM_ID;
  document.getElementById("polar-info").textContent =
    `${d.source}. Bezug ${fmt1(wl0)} kg/m² (${Math.round(d.refMass)} kg), Fläche ${fmt1(d.area)} m²` +
    (d.maxMass ? `, höchstens ${d.maxMass} kg (${fmt1(d.maxMass / d.area)} kg/m²)` : "") +
    (d.maxBallast ? `, Wasser bis ${Math.round(d.maxBallast)} l` : "") +
    (d.emptyMass ? `, Leermasse ca. ${d.emptyMass} kg` : "") +
    (d.vno ? `, v_NO ${d.vno} km/h` : "") +
    `. Beste Gleitzahl ${Math.round(polar.bestGlide)} bei ${Math.round(polar.vBestGlide * 3.6)} km/h (bei der eingestellten Flächenbelastung).`;
  document.getElementById("stf-info").textContent =
    `${Math.round(polar.mass)} kg Flugmasse · beste Gleitzahl ${Math.round(polar.bestGlide)} bei ${Math.round(polar.vBestGlide * 3.6)} km/h · ` +
    `Sollfahrt in ruhiger Luft bei MC ${fmt1(settings.mc)}: ${Math.round(polar.stf(settings.mc) * 3.6)} km/h. ` +
    `Polare ${d.name}, Bezug ${fmt1(wl0)} kg/m²` + (d.maxMass ? `, höchstens ${fmt1(d.maxMass / d.area)} kg/m²` : "") + ".";
}
function applyStf() {
  polar = buildPolar();
  setupAsi();
  saveSettings();
  showPolarInfo();
  fg.render();
  if (last) updatePerf(last);
  renderPerf();
}
function fillStfDlg() {
  mcIn.value = settings.mc.toFixed(1);
  wlIn.value = (settings.wingLoading ?? refWingLoading(polar.def)).toFixed(1);
  bugsIn.value = settings.bugs;
  showPolarInfo();
}
const clampNum = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
function setStfValue(key, v) {
  if (!Number.isFinite(v)) return;
  if (key === "mc") settings.mc = Math.round(clampNum(v, 0, 6) * 10) / 10;
  if (key === "wl") settings.wingLoading = Math.round(clampNum(v, 20, 80) * 10) / 10;
  if (key === "bugs") settings.bugs = Math.round(clampNum(v, 0, 50));
  fillStfDlg();
  applyStf();
}
stfDlg.addEventListener("click", (e) => {
  const b = e.target.closest("[data-step]");
  if (!b) return;
  const [key, step] = b.dataset.step.split(":");
  const cur = key === "mc" ? settings.mc : key === "wl" ? (settings.wingLoading ?? refWingLoading(polar.def)) : settings.bugs;
  setStfValue(key, cur + Number(step));
});
mcIn.addEventListener("change", () => setStfValue("mc", Number(mcIn.value.replace(",", "."))));
wlIn.addEventListener("change", () => setStfValue("wl", Number(wlIn.value.replace(",", "."))));
bugsIn.addEventListener("change", () => setStfValue("bugs", Number(bugsIn.value)));
function openStf() { fillStfDlg(); stfDlg.showModal(); }
document.getElementById("d-stf-box").addEventListener("click", openStf);
document.getElementById("open-stf").addEventListener("click", openStf);
polarIn.addEventListener("change", () => {
  if (polarIn.value === CUSTOM_ID && !customDef(settings.customPolar)) {
    // noch keine eigene Polare: Eingabe zeigen, mit der aktuellen vorbelegt
    fillCustom();
    customBox.hidden = false;
    return;
  }
  settings.polar = polarIn.value;
  settings.wingLoading = null;
  applyStf();
  if (settings.polar === CUSTOM_ID) fillCustom();
  showToast(`Polare: ${polar.def.name}. Flächenbelastung auf ${fmt1(polar.wingLoading)} kg/m² (Bezugsmasse) gesetzt.`);
});
const igcAirIn = document.getElementById("igc-air");
igcAirIn.addEventListener("change", () => {
  settings.igcAir = igcAirIn.checked;
  saveSettings();
  analyzer.setUseLogger(settings.igcAir);
  // bisherige Punkte mit der neuen Quelle nachrechnen
  const log = fixLog;
  resetAnalysis();
  for (const f of log) feedFix(f);
  if (last) updatePerf(last);
  renderPerf();
});
stfToneIn.addEventListener("change", () => { settings.stfTone = stfToneIn.checked; saveSettings(); if (last) updatePerf(last); });

// ---------- Schnitt: Details und Start von Hand ----------
const avgDlg = document.getElementById("avg-dlg");
function showAvg() {
  const facts = document.getElementById("avg-facts");
  facts.replaceChildren();
  const add = (k, v) => { const dt = document.createElement("dt"); dt.textContent = k; const dd = document.createElement("dd"); dd.textContent = v; facts.append(dt, dd); };
  const r = tracker.result();
  if (r) {
    add("Aufgabe", taskSummary(task));
    if (r.state === "pre") add("Abflug", "noch nicht");
    else {
      add("Abflug", clockText(r.startT));
      add("Geflogen", `${fmtKmT(r.km)} km`);
      if (r.state === "done") add("Ziel", clockText(r.finishT));
      else add("Nächster Punkt", task.points[r.next]?.name || "-");
      if (r.speedKmh != null) add("Schnitt", `${fmt1(r.speedKmh)} km/h`);
    }
  }
  if (r?.speed60 != null) add("Schnitt 60 min", `${fmt1(r.speed60)} km/h`);
  const fr = analyzer.free();
  if (fr.startT != null) {
    const h = (fr.t - fr.startT) / 3600000;
    add("OLC ab", `${clockText(fr.startT)} (${fr.src})`);
    add("OLC-Strecke", `${fmtKmT(fr.km)} km über 6 Schenkel`);
    if (h > 1 / 60) add("Schnitt OLC", `${fmt1(fr.km / h)} km/h`);
    const v60 = analyzer.freeSpeed60();
    if (v60 != null) add("OLC 60 min", `${fmt1(v60)} km/h`);
  } else add("OLC", fr.src);
  const fw = analyzer.flown();
  if (fw) add("Weg geflogen", `${fmtKmT(fw.km)} km` + (fw.speed60 != null ? ` (60 min: ${fmt1(fw.speed60)} km/h)` : ""));
  const w60 = analyzer.wind60();
  if (w60) add("Wind Ø 60 min", `${windText(w60)} km/h`);
  const w = analyzer.wind;
  add("Wind", w ? `${windText(w)} km/h (${w.logger ? "vom Logger" : `geschätzt ${clockText(w.t)}`})` : "noch nicht geschätzt");
  avgDlg.showModal();
}
for (const id of ["d-wind-box", "d-dist-box", "d-olc-box", "d-olcv-box", "d-task-box", "d-taskv-box"]) document.getElementById(id).addEventListener("click", showAvg);
document.getElementById("avg-now").addEventListener("click", () => {
  if (!last) { showToast("Noch keine Position."); return; }
  analyzer.setManualStart(fixLog.at(-1)?.t ?? last.time);
  renderPerf(); avgDlg.close();
  showToast("Schnitt ohne Aufgabe beginnt jetzt.");
});
document.getElementById("avg-auto").addEventListener("click", () => {
  analyzer.setManualStart(null);
  // automatische Erkennung über die bisherigen Punkte neu rechnen
  const log = fixLog;
  resetAnalysis();
  for (const f of log) feedFix(f);
  renderPerf(); avgDlg.close();
});

// Browser erlauben Ton erst nach einer Berührung: beim ersten Tippen nachholen
document.addEventListener("pointerdown", () => {
  if (settings.sound && !audio.isRunning()) startSound();
  else audio.unlock(); // für Luftraumwarnungen
}, true);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && settings.sound && !audio.isRunning()) startSound();
});

document.getElementById("open-settings").addEventListener("click", () => {
  offsetIn.value = settings.altOffset;
  simIn.checked = settings.sim;
  varioWinIn.value = String(settings.varioWindow);
  safetyIn.value = settings.safetyHeight;
  showAsInfo();
  updateLayerUi();
  asKmIn.value = String(settings.asWarnKm);
  asVIn.value = String(settings.asVMargin);
  asSoundIn.checked = settings.asAlertSound;
  asTraIn.checked = settings.asTraActive;
  for (const cb of asCatsEl.querySelectorAll("input")) cb.checked = settings.asWarnCats.includes(cb.value);
  polarSearch.value = "";
  fillPolarList();
  if (settings.polar === CUSTOM_ID) fillCustom();
  stfToneIn.checked = settings.stfTone;
  igcAirIn.checked = settings.igcAir;
  showPolarInfo();
  showWpInfo();
  volumeIn.value = settings.volume;
  sinkToneIn.checked = settings.sinkTone;
  sinkThrIn.value = String(settings.sinkThreshold);
  mapSrcIn.value = settings.mapSource;
  imagery3dIn.value = settings.map3dImagery;
  gpsAltOut.textContent = last && last.altitude != null ? `${Math.round(last.altitude)} m` : "keine";
  dlg.showModal();
});
document.getElementById("close-settings").addEventListener("click", () => dlg.close());

offsetIn.addEventListener("change", () => {
  settings.altOffset = Number(offsetIn.value) || 0;
  saveSettings();
});
document.getElementById("calibrate").addEventListener("click", () => {
  const field = Number(fieldIn.value);
  if (!fieldIn.value || Number.isNaN(field)) { showToast("Bitte zuerst die Platzhöhe in Metern eingeben."); return; }
  if (!last || last.altitude == null) { showToast("Noch keine GPS-Höhe. Bitte warten, bis GPS eine Position hat."); return; }
  settings.altOffset = Math.round(field - last.altitude);
  offsetIn.value = settings.altOffset;
  saveSettings();
  showToast(`Höhe kalibriert: Korrektur ${settings.altOffset > 0 ? "+" : ""}${settings.altOffset} m`);
});
varioWinIn.addEventListener("change", () => {
  settings.varioWindow = Number(varioWinIn.value) || 4;
  saveSettings();
});
volumeIn.addEventListener("input", () => {
  settings.volume = Number(volumeIn.value);
  saveSettings();
  applyAudioSettings();
});
sinkToneIn.addEventListener("change", () => {
  settings.sinkTone = sinkToneIn.checked;
  saveSettings();
  applyAudioSettings();
});
sinkThrIn.addEventListener("change", () => {
  settings.sinkThreshold = Number(sinkThrIn.value);
  saveSettings();
  applyAudioSettings();
});
simIn.addEventListener("change", () => {
  settings.sim = simIn.checked;
  saveSettings();
  startSource();
});
document.getElementById("day").addEventListener("click", () => {
  settings.day = !settings.day;
  saveSettings();
  applyDay();
});
document.getElementById("fullscreen").addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen({ navigationUI: "hide" });
  } catch { showToast("Vollbild wird hier nicht unterstützt."); }
});

// ---------- Aufgabe ----------
const taskInfo = document.getElementById("task-info");
const taskChip = document.getElementById("task-chip");
const tgAirspace = document.getElementById("tg-airspace");
const tgTask = document.getElementById("tg-task");
const showAirspaceIn = document.getElementById("show-airspace");
const showTaskIn = document.getElementById("show-task");

function taskSummary(t) {
  const km = t.distanceKm.toLocaleString("de-AT", { maximumFractionDigits: 1 });
  return `${t.name} · ${t.points.length - 2} Wenden · ${km} km` + (t.aat && t.taskTime ? ` · AAT ${t.taskTime.slice(0, 5)} h` : "");
}
function updateLayerUi() {
  tgAirspace.setAttribute("aria-pressed", settings.showAirspace);
  tgTask.setAttribute("aria-pressed", settings.showTask);
  tgTask.hidden = !task;
  taskChip.hidden = !task || !settings.showTask;
  if (task) taskChip.textContent = taskSummary(task);
  taskInfo.textContent = task ? taskSummary(task) : "Keine Aufgabe geladen";
  document.getElementById("task-show-info").hidden = !task;
  showAirspaceIn.checked = settings.showAirspace;
  showTaskIn.checked = settings.showTask;
}
function setLayer(name, on) {
  if (name === "airspace") settings.showAirspace = on; else settings.showTask = on;
  saveSettings();
  mapView?.setLayerVisible(name, on);
  map3d?.setLayerVisible(name, on);
  updateLayerUi();
}
tgAirspace.addEventListener("click", () => setLayer("airspace", !settings.showAirspace));
tgTask.addEventListener("click", () => setLayer("task", !settings.showTask));
showAirspaceIn.addEventListener("change", () => setLayer("airspace", showAirspaceIn.checked));
showTaskIn.addEventListener("change", () => setLayer("task", showTaskIn.checked));

// Aufgaben-Info: alles, was zur Aufgabe bekannt ist (Punkte, Zonen, Notizen, inaktive Lufträume …)
const taskDlg = document.getElementById("task-dlg");
function showTaskInfo() {
  if (!task) return;
  const info = task.info || {};
  const $ = (id) => document.getElementById(id);
  const add = (tag, parent, text) => { const e = document.createElement(tag); e.textContent = text; parent.appendChild(e); return e; };
  $("ti-title").textContent = info.day || task.name;
  $("ti-sub").textContent = [info.contest, info.day ? task.name : ""].filter(Boolean).join(" · ");
  $("ti-sub").hidden = !$("ti-sub").textContent;

  const facts = $("ti-facts");
  facts.replaceChildren();
  const km = task.distanceKm.toLocaleString("de-AT", { maximumFractionDigits: 1 });
  for (const [k, v] of [["Strecke", `${km} km, ${task.points.length - 2} Wenden`], ...(info.facts || [])]) {
    add("dt", facts, k);
    add("dd", facts, v);
  }

  const as = $("ti-airspace");
  as.replaceChildren();
  as.hidden = !info.inactiveAirspaces?.length;
  if (!as.hidden) {
    const ti = taskInactiveSpaces();
    add("b", as, "Inaktive Lufträume");
    const ul = document.createElement("ul");
    for (const n of info.inactiveAirspaces) {
      const hit = ti.matches.get(n)?.length;
      add("li", ul, ti.active ? `${n} · ${hit ? "keine Warnung" : "nicht in der Luftraumdatei"}` : n);
    }
    as.appendChild(ul);
    add("p", as, ti.active
      ? "Für diese Lufträume warnt die App heute nicht."
      : `Die Aufgabe ist vom ${info.date ? new Date(info.date).toLocaleDateString("de-AT") : "einem anderen Tag"}. Die Lufträume werden deshalb weiter gewarnt.`);
  }

  const rows = $("ti-points");
  rows.replaceChildren();
  task.points.forEach((p, i, pts) => {
    const tr = document.createElement("tr");
    add("td", tr, i === 0 ? "S" : i === pts.length - 1 ? "Z" : String(i));
    add("td", tr, p.name);
    add("td", tr, i === 0 ? "" : distanceKm(pts[i - 1].lat, pts[i - 1].lon, p.lat, p.lon).toFixed(1));
    add("td", tr, zoneText(p.oz, i, pts.length));
    rows.appendChild(tr);
  });

  $("ti-notes").textContent = info.notes || "";
  $("ti-notes").hidden = !info.notes;
  taskDlg.showModal();
}
taskChip.addEventListener("click", showTaskInfo);
document.getElementById("task-show-info").addEventListener("click", showTaskInfo);
document.getElementById("ti-map").addEventListener("click", () => {
  taskDlg.close();
  if (dlg.open) dlg.close();
  showPage("map");
  mapView?.fitTask();
});

function useTask(fileName, t) {
  task = t;
  try { saveTask(fileName, t); } catch {}
  settings.showTask = true;
  saveSettings();
  if (dlg.open) dlg.close();
  showPage("map");
  setMapTask(t);
  mapView?.setLayerVisible("task", true);
  updateLayerUi();
  mapView?.fitTask();
  showToast(`Aufgabe geladen: ${taskSummary(t)}`);
}

// Beliebige Datei erkennen: Aufgabe, Wendepunkte oder Lufträume
async function importAnyFile(buf, name) {
  const text = await cupTextFromBuffer(buf);
  if (/\.igc$/i.test(name) || isIgc(text)) {
    startReplay(parseIgc(text), name);
    return;
  }
  if (/\.tsk$/i.test(name) || text.trimStart().startsWith("<") || /-+\s*related tasks/i.test(text) || isSoaringSpotPage(text)) {
    useTask(name, await readTaskBuffer(buf, name, waypoints));
    return;
  }
  if (/^\s*AC\s/m.test(text)) {
    const { text: t, spaces } = readAirspaceBuffer(buf, name);
    try { saveAirspace(name, t); } catch {}
    settings.asCleared = false; saveSettings();
    useAirspaces(spaces);
    showToast(`${spaces.length} Lufträume aus „${name}“ geladen.`);
    return;
  }
  const pts = parseCup(text);
  if (pts.length) {
    useWaypoints(name, pts, false);
    showToast(`${pts.length} Wendepunkte aus „${name}“ geladen.`);
    return;
  }
  throw new Error("Die Datei wurde nicht erkannt. Unterstützt: SeeYou/LX .cup (Aufgabe oder Wendepunkte), XCSoar .tsk, OpenAir .txt.");
}

const taskFile = document.getElementById("task-file");
taskFile.addEventListener("change", async () => {
  const f = taskFile.files[0];
  if (!f) return;
  try { useTask(f.name, await readTaskBuffer(await f.arrayBuffer(), f.name, waypoints)); }
  catch (e) { showToast(e.message || "Die Aufgabe konnte nicht gelesen werden."); }
  taskFile.value = "";
});
document.getElementById("task-clear").addEventListener("click", () => {
  task = null;
  clearTask();
  setMapTask(null);
  updateLayerUi();
});
const taskUrl = document.getElementById("task-url");
// Soaring Spot erlaubt keinen direkten Abruf: Aufgabenseite über den eigenen Proxy holen
async function loadTaskUrl(url) {
  let host;
  try { host = /^https?:\/\//i.test(url) && new URL(url).hostname; } catch {}
  if (!host) { showToast("Bitte einen vollständigen Link einfügen (https://…)."); return; }
  const soaringSpot = /(^|\.)soaringspot\.com$/i.test(host);
  if (soaringSpot && !SOARINGSPOT_PROXY) {
    showToast("Für Soaring-Spot-Links fehlt der Proxy (SOARINGSPOT_PROXY in js/config.js).");
    return;
  }
  const fetchUrl = soaringSpot
    ? `${SOARINGSPOT_PROXY}?url=${encodeURIComponent(soaringSpotTaskUrl(url))}`
    : url;
  let res;
  try { res = await fetch(fetchUrl, { mode: "cors" }); }
  catch {
    showToast(soaringSpot
      ? "Soaring Spot ist gerade nicht erreichbar. Ist das Handy online?"
      : "Der Server erlaubt den direkten Abruf nicht. Bitte die Aufgabendatei im Browser herunterladen und mit „Teilen → FastGlide“ oder „Aufgabendatei laden“ öffnen.");
    return;
  }
  if (!res.ok) { showToast(`Der Link liefert einen Fehler (${res.status}).`); return; }
  try {
    const name = decodeURIComponent(new URL(url).pathname.split("/").pop() || "aufgabe.cup");
    await importAnyFile(await res.arrayBuffer(), name);
  } catch (e) {
    showToast(e.message || "Unter diesem Link wurde keine Aufgabe gefunden. Bitte den Link der Aufgabenseite oder der Aufgabendatei verwenden.");
  }
}
document.getElementById("task-url-load").addEventListener("click", () => loadTaskUrl(taskUrl.value.trim()));

// ---------- Flug abspielen (IGC) ----------
let replay = null, replayFlight = null, replayOffset = 0;
const replayEl = document.getElementById("replay");
const rpEls = {
  play: document.getElementById("rp-play"), back: document.getElementById("rp-back"), fwd: document.getElementById("rp-fwd"),
  speed: document.getElementById("rp-speed"), time: document.getElementById("rp-time"), title: document.getElementById("rp-title"),
  baro: document.getElementById("rp-baro"),
};

// Höhe wie beim Kalibrieren am Boden: vor dem Abflug auf die Höhe des nächsten Landeplatzes (bis 3 km) setzen
function replayAltOffset(flight) {
  const ground = flight.fixes.slice(0, Math.max(1, flight.takeoffIndex)).map((f) => f.alt).sort((a, b) => a - b);
  const groundAlt = ground[Math.floor(ground.length / 2)];
  const f0 = flight.fixes[flight.takeoffIndex];
  let best = null, bestKm = 3;
  for (const w of waypoints) {
    if (w.elev == null || !LANDABLE.has(w.style)) continue;
    const km = distanceKm(f0.lat, f0.lon, w.lat, w.lon);
    if (km < bestKm) { best = w; bestKm = km; }
  }
  return best ? { offset: best.elev - groundAlt, field: best } : { offset: 0, field: null };
}

function startReplay(flight, name) {
  stopReplay();
  if (stopSource) stopSource();
  stopSource = null;
  last = null;
  climb.reset();
  resetAnalysis();
  for (const i of instruments) { i.target = null; i.extraVal = null; }
  const { offset, field } = replayAltOffset(flight);
  replayFlight = flight;
  replayEl.hidden = false;
  // Aufgabe aus der Datei nur fürs Abspielen verwenden, nicht speichern
  if (flight.task) {
    task = flight.task;
    settings.showTask = true;
    setMapTask(task);
    mapView?.setLayerVisible("task", true);
    updateLayerUi();
  }
  if (dlg.open) dlg.close();
  showPage("map");
  mapView?.setFlight(flight.fixes.map((f) => [f.lat, f.lon]));
  replayOffset = offset;
  map3d?.setFlight(flight, offset);
  mapView?.follow();
  replay = createReplay({ flight, altOffset: offset, els: rpEls, onData });
  replay.play();
  const h = Math.round((flight.fixes.at(-1).t - flight.fixes[flight.takeoffIndex].t) / 60000);
  showToast(`Flug „${name}“ geladen (${Math.floor(h / 60)}:${String(h % 60).padStart(2, "0")} h). ` +
    (field ? `Höhe auf ${field.name} (${Math.round(field.elev)} m) abgeglichen.` : `${flight.altSource}-Höhe aus der Datei, ohne Abgleich.`) +
    (flight.task ? ` Aufgabe aus der Datei: ${flight.task.points.length - 2} Wenden, ${Math.round(flight.task.distanceKm)} km.` : "") +
    (settings.igcAir && (flight.loggerAir || flight.loggerWind) ? ` ${[flight.loggerAir && "Fahrt", flight.loggerWind && "Wind"].filter(Boolean).join(" und ")} vom Logger.` : ""));
}

function stopReplay() {
  if (!replay) return;
  replay.stop();
  const replayTask = replayFlight?.task;
  replay = null;
  replayFlight = null;
  replayEl.hidden = true;
  mapView?.setFlight(null);
  map3d?.setFlight(null);
  // wieder die gespeicherte Aufgabe
  if (task && task === replayTask) {
    task = loadTask()?.task || null;
    setMapTask(task);
    updateLayerUi();
  }
}
document.getElementById("rp-close").addEventListener("click", () => startSource());
rpEls.speed.addEventListener("change", () => { if (last?.replay) setStatus("ok", `FLUG ${replay?.speed ?? ""}×`); });

document.getElementById("igc-demo-info").textContent = DEMO_FLIGHT.label;
document.getElementById("igc-demo").addEventListener("click", async () => {
  try {
    const res = await fetch(DEMO_FLIGHT.url);
    if (!res.ok) throw new Error();
    startReplay(parseIgc(await cupTextFromBuffer(await res.arrayBuffer())), DEMO_FLIGHT.name);
  } catch (e) {
    showToast(e.message || "Der Beispielflug konnte nicht geladen werden.");
  }
});

const igcFile = document.getElementById("igc-file");
igcFile.addEventListener("change", async () => {
  const f = igcFile.files[0];
  if (!f) return;
  try { startReplay(parseIgc(await cupTextFromBuffer(await f.arrayBuffer())), f.name); }
  catch (e) { showToast(e.message || "Die IGC-Datei konnte nicht gelesen werden."); }
  igcFile.value = "";
});

// „Teilen → FastGlide“: der Service Worker legt die Datei im Cache ab
async function handleShared() {
  if (!new URLSearchParams(location.search).has("share")) return;
  history.replaceState(null, "", location.pathname);
  try {
    const cache = await caches.open("glidewise-share");
    const link = await cache.match("shared-url");
    if (link) {
      await cache.delete("shared-url");
      await loadTaskUrl(await link.text());
      return;
    }
    const res = await cache.match("shared-file");
    if (!res) { showToast("Keine geteilte Datei gefunden."); return; }
    await cache.delete("shared-file");
    const name = decodeURIComponent(res.headers.get("X-Name") || "datei");
    await importAnyFile(await res.arrayBuffer(), name);
  } catch (e) {
    showToast(e.message || "Die geteilte Datei konnte nicht gelesen werden.");
  }
}

// ---------- Start ----------
applyDay();
showPage(settings.page);
applyAudioSettings();
updateSoundBtn();
if (settings.sound) startSound();
startSource();
keepAwake();
// Noch keine Wendepunkte am Handy: mitgelieferte Datei automatisch laden
if (!waypoints.length && !settings.wpCleared) loadDefaultWaypoints(true);
if (!airspaces.length && !settings.asCleared) loadDefaultAirspace(true);
updateLayerUi();
handleShared();
requestAnimationFrame(frame);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
