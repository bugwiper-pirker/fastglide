import { AIRCRAFT, ALTIMETER, VARIO, DEFAULT_WAYPOINTS, DEFAULT_AIRSPACE, SOARINGSPOT_PROXY } from "./config.js";
import { createAirspeed } from "./instruments/airspeed.js";
import { createAltimeter, ftText, flText } from "./instruments/altimeter.js";
import { createVario } from "./instruments/vario.js";
import { createClimbCalculator } from "./climb.js";
import { createVarioAudio } from "./audio.js";
import { createFinalGlide } from "./finalglide.js";
import { readWaypointFile, fetchDefaultWaypoints, saveWaypoints, loadWaypoints, clearWaypoints, cupTextFromBuffer, parseCup } from "./waypoints.js";
import { readTaskBuffer, saveTask, loadTask, clearTask, isSoaringSpotPage, soaringSpotTaskUrl } from "./task.js";
import { startGps, startSimulation } from "./sources.js";
import { createMapView } from "./map.js";
import { readAirspaceBuffer, readAirspaceFile, fetchDefaultAirspace, saveAirspace, loadAirspace, clearAirspace, checkAirspace, CATEGORIES, DEFAULT_WARN, altText, asKey } from "./airspace.js";

// ---------- Einstellungen (lokal im Browser gespeichert) ----------
const DEFAULTS = { altOffset: 0, day: false, sim: false, varioWindow: 4, sound: false, volume: 60, sinkTone: false, sinkThreshold: -2.5, safetyHeight: 150, safeGlide: 35, target: null, wpCleared: false,
  asWarnKm: 2, asVMargin: 150, asAlertSound: true, asWarnCats: DEFAULT_WARN,
  asIgnore: [], asTraActive: false, asCleared: false,
  showAirspace: true, showTask: true, page: "inst", mapSource: "osm" };
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
let airspaces = loadAirspace()?.spaces || [];
let task = loadTask()?.task || null;
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
  altFt: document.getElementById("d-altft"),
};
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
  });
  mapView.setAirspaces(airspaces);
  mapView.setTask(task);
  mapView.setLayerVisible("airspace", settings.showAirspace);
  mapView.setLayerVisible("task", settings.showTask);
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
  digi.altFt.textContent = alt == null ? "---- ft · FL ---" : `${ftText(alt)} · ${flText(alt)}`;
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
  updateAirspaceWarnings(pos ? { ...pos, speedKmh: d.speedKmh } : null);
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
    updateAirspaceWarnings(null);
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

// ---------- Luftraumwarnung ----------
const asBanner = document.getElementById("aswarn");
const asTitle = document.getElementById("aswarn-title");
const asDetail = document.getElementById("aswarn-detail");
const alerted = new Map();   // Luftraum -> { level, time, seen }
const acked = new Map();     // Luftraum -> bestätigt bis (ms)
const ACK_MS = 5 * 60 * 1000;
let currentWarnings = [];

const fmtKm = (km) => (km < 10 ? km.toFixed(1).replace(".", ",") : Math.round(km)) + " km";

function warnOpts() {
  const cats = new Set(settings.asWarnCats);
  if (cats.has("C")) { cats.add("A"); cats.add("B"); }
  if (cats.has("P")) cats.add("GP");
  return {
    warnCats: cats, warnKm: settings.asWarnKm, vMargin: settings.asVMargin, lookaheadS: 60,
    ignore: new Set(settings.asIgnore), traActive: settings.asTraActive,
  };
}

function setIgnored(a, on) {
  const k = asKey(a);
  const set = new Set(settings.asIgnore);
  if (on) set.add(k); else set.delete(k);
  settings.asIgnore = [...set];
  saveSettings();
  mapView?.setWarned(currentWarnings.filter((w) => !set.has(asKey(w.space))).map((w) => w.space));
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
  showAirspaceIn.checked = settings.showAirspace;
  showTaskIn.checked = settings.showTask;
}
function setLayer(name, on) {
  if (name === "airspace") settings.showAirspace = on; else settings.showTask = on;
  saveSettings();
  mapView?.setLayerVisible(name, on);
  updateLayerUi();
}
tgAirspace.addEventListener("click", () => setLayer("airspace", !settings.showAirspace));
tgTask.addEventListener("click", () => setLayer("task", !settings.showTask));
showAirspaceIn.addEventListener("change", () => setLayer("airspace", showAirspaceIn.checked));
showTaskIn.addEventListener("change", () => setLayer("task", showTaskIn.checked));
taskChip.addEventListener("click", () => mapView?.fitTask());

function useTask(fileName, t) {
  task = t;
  try { saveTask(fileName, t); } catch {}
  settings.showTask = true;
  saveSettings();
  if (dlg.open) dlg.close();
  showPage("map");
  mapView?.setTask(t);
  mapView?.setLayerVisible("task", true);
  updateLayerUi();
  mapView?.fitTask();
  showToast(`Aufgabe geladen: ${taskSummary(t)}`);
}

// Beliebige Datei erkennen: Aufgabe, Wendepunkte oder Lufträume
async function importAnyFile(buf, name) {
  const text = await cupTextFromBuffer(buf);
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
  mapView?.setTask(null);
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
      : "Der Server erlaubt den direkten Abruf nicht. Bitte die Aufgabendatei im Browser herunterladen und mit „Teilen → GlideWise“ oder „Aufgabendatei laden“ öffnen.");
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

// „Teilen → GlideWise“: der Service Worker legt die Datei im Cache ab
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
