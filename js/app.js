import { AIRCRAFT, ALTIMETER, VARIO } from "./config.js";
import { createAirspeed } from "./instruments/airspeed.js";
import { createAltimeter } from "./instruments/altimeter.js";
import { createVario } from "./instruments/vario.js";
import { createClimbCalculator } from "./climb.js";
import { createVarioAudio } from "./audio.js";
import { createFinalGlide } from "./finalglide.js";
import { readWaypointFile, saveWaypoints, loadWaypoints, clearWaypoints } from "./waypoints.js";
import { startGps, startSimulation } from "./sources.js";
import { createMapView } from "./map.js";

// ---------- Einstellungen (lokal im Browser gespeichert) ----------
const DEFAULTS = { altOffset: 0, day: false, sim: false, varioWindow: 4, sound: false, volume: 60, sinkTone: false, sinkThreshold: -2.5, safetyHeight: 150, safeGlide: 35, target: null, page: "inst", mapSource: "osm" };
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
const instruments = [
  { el: "asi", create: (svg) => createAirspeed(svg, AIRCRAFT.asi), value: (d) => d.speedKmh },
  { el: "vario", create: (svg) => createVario(svg, VARIO), value: (d) => d.vario, extra: (d) => ({ avg: d.varioAvg }) },
  { el: "alt", create: (svg) => createAltimeter(svg, ALTIMETER), value: (d) => d.altitude },
].map((i) => ({ ...i, inst: i.create(document.getElementById(i.el)), shown: null, target: null, extraVal: null }));
const climb = createClimbCalculator();
const varioInst = instruments.find((i) => i.el === "vario");
const audio = createVarioAudio();

// ---------- Endanflug ----------
const fg = createFinalGlide({
  box: document.getElementById("fg"),
  picker: document.getElementById("picker"),
  getSettings: () => ({ safetyHeight: settings.safetyHeight, safeGlide: settings.safeGlide, bestGlide: AIRCRAFT.bestGlide }),
  onSelect: (t) => { settings.target = t; saveSettings(); mapView?.setTarget(t); },
});
let waypoints = loadWaypoints()?.points || [];
fg.setPoints(waypoints, settings.target);

// ---------- Kartenseite ----------
let mapView = null; // wird beim ersten Anzeigen der Karte erzeugt
let lastPos = null;
const instPage = document.querySelector(".gauges");
const mapPage = document.getElementById("mapview");
const pageBtn = document.getElementById("page");
const digi = {
  spd: document.getElementById("d-spd"),
  var: document.getElementById("d-var"),
  avg: document.getElementById("d-avg"),
  alt: document.getElementById("d-alt"),
};
function ensureMap() {
  if (mapView) return mapView;
  if (!window.L) { showToast("Die Karte konnte nicht geladen werden."); return null; }
  mapView = createMapView({
    container: document.getElementById("map"),
    recenterBtn: document.getElementById("recenter"),
    onPickTarget: (p) => fg.selectPoint(p),
    getSource: () => settings.mapSource,
  });
  mapView.setPoints(waypoints);
  mapView.setTarget(settings.target);
  if (lastPos) mapView.update(lastPos);
  return mapView;
}
function showPage(page) {
  settings.page = page;
  saveSettings();
  const isMap = page === "map";
  instPage.hidden = isMap;
  mapPage.hidden = !isMap;
  pageBtn.textContent = isMap ? "◎" : "🗺";
  pageBtn.title = isMap ? "Instrumente" : "Karte";
  pageBtn.setAttribute("aria-label", pageBtn.title);
  if (isMap && ensureMap()) requestAnimationFrame(() => mapView.shown());
}
pageBtn.addEventListener("click", () => showPage(settings.page === "map" ? "inst" : "map"));

const fmtVar = (v) => (v > 0.05 ? "+" : v < -0.05 ? "−" : "") + Math.abs(v).toFixed(1);
const fmtAlt = (a) => Math.round(a).toLocaleString("de-AT").replace(/[.,\u202f\u00a0]/g, " ");
function updateDigital() {
  const by = (id) => instruments.find((i) => i.el === id).shown;
  const spd = by("asi"), v = by("vario"), alt = by("alt");
  digi.spd.textContent = spd == null ? "---" : Math.round(spd);
  digi.var.textContent = v == null ? "---" : fmtVar(v);
  digi.alt.textContent = alt == null ? "-----" : fmtAlt(alt);
  const avg = varioInst.extraVal?.avg;
  digi.avg.textContent = avg == null ? "Ø ---" : `Ø ${fmtVar(avg)}`;
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
  const c = climb.add(d.time, d.altitude, settings.varioWindow);
  const data = {
    speedKmh: d.speedKmh,
    altitude: d.altitude == null ? null : d.altitude + settings.altOffset,
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
  setStatus("ok", settings.sim ? "SIMULATION" : `GPS ±${Math.round(d.accuracy)} m`);
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
  if (stopSource) stopSource();
  last = null;
  climb.reset();
  for (const i of instruments) { i.target = null; i.extraVal = null; }
  setStatus("wait", settings.sim ? "SIMULATION" : "GPS SUCHT …");
  stopSource = settings.sim ? startSimulation(onData) : startGps(onData, onError);
}

// Zeiger weich nachführen; veraltete Daten deutlich anzeigen
function frame() {
  const stale = last && Date.now() - lastTime > STALE_MS;
  document.body.classList.toggle("stale", !last || stale);
  if (stale && statusText.textContent !== "GPS VERALTET") {
    setStatus("err", "GPS VERALTET");
    fg.update(null);
  }
  for (const i of instruments) {
    if (i.target == null || stale) { i.shown = null; i.inst.update(null, null); continue; }
    i.shown = i.shown == null ? i.target : i.shown + (i.target - i.shown) * 0.15;
    i.inst.update(i.shown, i.extraVal);
  }
  audio.setValue(stale ? null : varioInst.target);
  if (settings.page === "map") updateDigital();
  requestAnimationFrame(frame);
}

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
wpFile.addEventListener("change", async () => {
  const file = wpFile.files[0];
  if (!file) return;
  try {
    const points = await readWaypointFile(file);
    try { saveWaypoints(file.name, points); }
    catch { showToast("Die Datei ist zu groß zum Speichern. Sie gilt nur bis zum Schließen der App."); }
    settings.target = null; saveSettings();
    waypoints = points;
    fg.setPoints(points, null);
    mapView?.setPoints(points);
    mapView?.setTarget(null);
    wpInfo.textContent = `${points.length} Wendepunkte aus „${file.name}“`;
    showToast(`${points.length} Wendepunkte geladen. Tippe oben auf die Endanflug-Box, um ein Ziel zu wählen.`);
  } catch (e) {
    showToast(e.message || "Die Datei konnte nicht gelesen werden.");
  }
  wpFile.value = "";
});
document.getElementById("wp-clear").addEventListener("click", () => {
  clearWaypoints();
  settings.target = null; saveSettings();
  waypoints = [];
  fg.setPoints([], null);
  mapView?.setPoints([]);
  mapView?.setTarget(null);
  showWpInfo();
});
const safetyIn = document.getElementById("safety-height");
const safeGlideIn = document.getElementById("safe-glide");
safetyIn.addEventListener("change", () => {
  settings.safetyHeight = Math.max(0, Number(safetyIn.value) || 0);
  saveSettings(); fg.render();
});
safeGlideIn.addEventListener("change", () => {
  settings.safeGlide = Math.max(5, Number(safeGlideIn.value) || 35);
  saveSettings(); fg.render();
});

// Browser erlauben Ton erst nach einer Berührung: beim ersten Tippen nachholen
document.addEventListener("pointerdown", () => {
  if (settings.sound && !audio.isRunning()) startSound();
}, true);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && settings.sound && !audio.isRunning()) startSound();
});

document.getElementById("open-settings").addEventListener("click", () => {
  offsetIn.value = settings.altOffset;
  simIn.checked = settings.sim;
  varioWinIn.value = String(settings.varioWindow);
  safetyIn.value = settings.safetyHeight;
  safeGlideIn.value = settings.safeGlide;
  showWpInfo();
  volumeIn.value = settings.volume;
  sinkToneIn.checked = settings.sinkTone;
  sinkThrIn.value = String(settings.sinkThreshold);
  mapSrcIn.value = settings.mapSource;
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

// ---------- Start ----------
applyDay();
showPage(settings.page);
applyAudioSettings();
updateSoundBtn();
if (settings.sound) startSound();
startSource();
keepAwake();
requestAnimationFrame(frame);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
