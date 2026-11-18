import { AIRCRAFT, ALTIMETER, VARIO } from "./config.js";
import { createAirspeed } from "./instruments/airspeed.js";
import { createAltimeter } from "./instruments/altimeter.js";
import { createVario } from "./instruments/vario.js";
import { createClimbCalculator } from "./climb.js";
import { createVarioAudio } from "./audio.js";
import { startGps, startSimulation } from "./sources.js";

// ---------- Einstellungen (lokal im Browser gespeichert) ----------
const DEFAULTS = { altOffset: 0, day: false, sim: false, varioWindow: 4, sound: false, volume: 60, sinkTone: false, sinkThreshold: -2.5 };
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
  if (stale) setStatus("err", "GPS VERALTET");
  for (const i of instruments) {
    if (i.target == null || stale) { i.shown = null; i.inst.update(null, null); continue; }
    i.shown = i.shown == null ? i.target : i.shown + (i.target - i.shown) * 0.15;
    i.inst.update(i.shown, i.extraVal);
  }
  audio.setValue(stale ? null : varioInst.target);
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
  volumeIn.value = settings.volume;
  sinkToneIn.checked = settings.sinkTone;
  sinkThrIn.value = String(settings.sinkThreshold);
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
applyAudioSettings();
updateSoundBtn();
if (settings.sound) startSound();
startSource();
keepAwake();
requestAnimationFrame(frame);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
