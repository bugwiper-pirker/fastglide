// Flug nachfliegen: spielt eine IGC-Aufzeichnung als Datenquelle ab.
// Zeitachse mit Barogramm, Tippen oder Ziehen springt an die Stelle, Geschwindigkeit wählbar.

import { fixAt } from "./igc.js";

const TICK_MS = 250;
export const SPEEDS = [1, 2, 5, 10, 20, 50, 100];

// onData bekommt dasselbe wie bei GPS, dazu samples (alle Punkte seit dem letzten Aufruf,
// damit das Vario auch bei hoher Geschwindigkeit genug Werte hat) und reset nach einem Sprung.
export function createReplay({ flight, altOffset, els, onData }) {
  const fx = flight.fixes;
  const t0 = fx[0].t, t1 = fx[fx.length - 1].t;
  let t = Math.max(t0, fx[flight.takeoffIndex].t - 60000); // 1 min vor dem Abflug
  let prevT = t, playing = false, speed = 10, jumped = true;

  const tz = flight.tzHours != null ? flight.tzHours * 3600000 : -new Date(t0).getTimezoneOffset() * 60000;
  const two = (n) => String(n).padStart(2, "0");
  const clock = (ms, sec = true) => {
    const d = new Date(ms + tz);
    return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}` + (sec ? `:${two(d.getUTCSeconds())}` : "");
  };

  function emit() {
    const f = fixAt(flight, t);
    const samples = [];
    if (!jumped) for (let i = f.i; i >= 0 && fx[i].t > prevT; i--) samples.unshift({ t: fx[i].t, alt: fx[i].alt + altOffset });
    onData({
      lat: f.lat, lon: f.lon, altitude: f.alt + altOffset, speedKmh: f.speedKmh, track: f.track,
      time: t, accuracy: 0, replay: true, reset: jumped, samples,
    });
    jumped = false;
    prevT = t;
    els.time.textContent = clock(t);
    drawBaro();
  }

  const timer = setInterval(() => {
    if (playing) {
      t = Math.min(t1, t + TICK_MS * speed);
      if (t >= t1) setPlaying(false);
    }
    emit();
  }, TICK_MS);

  function setPlaying(on) {
    playing = on;
    els.play.textContent = on ? "⏸" : "▶";
    els.play.setAttribute("aria-label", on ? "Pause" : "Abspielen");
  }
  function seek(ms) {
    t = Math.min(t1, Math.max(t0, ms));
    jumped = true;
    emit();
  }

  // ---- Barogramm ----
  const cv = els.baro, ctx = cv.getContext("2d");
  const maxAlt = Math.max(...fx.map((f) => f.alt + altOffset));
  const minAlt = Math.min(0, ...fx.map((f) => f.alt + altOffset));
  const top = Math.ceil(maxAlt / 500) * 500;
  let base = null; // vorgezeichnetes Barogramm, Cursor kommt darüber

  function drawBase() {
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    cv.width = w * dpr; cv.height = h * dpr;
    base = document.createElement("canvas");
    base.width = cv.width; base.height = cv.height;
    const c = base.getContext("2d");
    c.scale(dpr, dpr);
    const css = getComputedStyle(cv);
    const ink = css.getPropertyValue("--muted").trim() || "#8a939e";
    const fill = css.getPropertyValue("--accent").trim() || "#f2b84b";
    const x = (ms) => ((ms - t0) / (t1 - t0)) * w;
    const y = (a) => h - 12 - ((a - minAlt) / (top - minAlt)) * (h - 16);
    // Höhenlinien alle 1000 m
    c.strokeStyle = ink; c.globalAlpha = 0.35; c.lineWidth = 1;
    c.font = "10px B612, sans-serif"; c.fillStyle = ink;
    for (let a = 1000; a <= top; a += 1000) {
      c.beginPath(); c.moveTo(0, Math.round(y(a)) + 0.5); c.lineTo(w, Math.round(y(a)) + 0.5); c.stroke();
    }
    c.globalAlpha = 1;
    for (let a = 1000; a <= top; a += 1000) c.fillText(`${a / 1000}000`, 2, y(a) - 2);
    // volle Stunden
    const hour = 3600000;
    for (let s = Math.ceil((t0 + tz) / hour) * hour - tz; s < t1; s += hour) {
      c.globalAlpha = 0.35; c.beginPath(); c.moveTo(Math.round(x(s)) + 0.5, 0); c.lineTo(Math.round(x(s)) + 0.5, h - 12); c.stroke();
      c.globalAlpha = 1; c.fillText(clock(s, false), x(s) + 2, h - 2);
    }
    // Höhe: pro Pixelspalte der höchste Wert
    c.beginPath(); c.moveTo(0, y(minAlt));
    let i = 0;
    for (let px = 0; px <= w; px++) {
      const tEnd = t0 + ((px + 1) / w) * (t1 - t0);
      let hi = -Infinity;
      while (i < fx.length && fx[i].t <= tEnd) { hi = Math.max(hi, fx[i].alt + altOffset); i++; }
      if (hi > -Infinity) c.lineTo(px, y(hi));
    }
    c.lineTo(w, y(minAlt)); c.closePath();
    c.globalAlpha = 0.25; c.fillStyle = fill; c.fill();
    c.globalAlpha = 1; c.strokeStyle = fill; c.lineWidth = 1.5; c.stroke();
  }

  function drawBaro() {
    if (!base || cv.width !== Math.round(cv.clientWidth * (window.devicePixelRatio || 1))) drawBase();
    if (!base) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(base, 0, 0);
    const px = ((t - t0) / (t1 - t0)) * cv.width;
    ctx.fillStyle = getComputedStyle(cv).getPropertyValue("--ink").trim() || "#fff";
    ctx.fillRect(Math.round(px - dpr), 0, 2 * dpr, cv.height);
  }

  // Tippen/Ziehen auf der Zeitachse
  let dragging = false;
  const tAtX = (e) => {
    const r = cv.getBoundingClientRect();
    return t0 + Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * (t1 - t0);
  };
  const down = (e) => { dragging = true; cv.setPointerCapture(e.pointerId); seek(tAtX(e)); };
  const move = (e) => { if (dragging) seek(tAtX(e)); };
  const up = () => { dragging = false; };
  cv.addEventListener("pointerdown", down);
  cv.addEventListener("pointermove", move);
  cv.addEventListener("pointerup", up);
  cv.addEventListener("pointercancel", up);

  const onPlay = () => { if (t >= t1) seek(t0); setPlaying(!playing); };
  const onSpeed = () => { speed = Number(els.speed.value) || 10; };
  const onBack = () => seek(t - 60000 * Math.max(1, speed / 10));
  const onFwd = () => seek(t + 60000 * Math.max(1, speed / 10));
  const onResize = () => { base = null; drawBaro(); };
  els.play.addEventListener("click", onPlay);
  els.speed.addEventListener("change", onSpeed);
  els.back.addEventListener("click", onBack);
  els.fwd.addEventListener("click", onFwd);
  window.addEventListener("resize", onResize);

  els.speed.replaceChildren(...SPEEDS.map((s) => new Option(`${s}×`, s, false, s === speed)));
  els.title.textContent = [flight.cid, flight.pilot, flight.glider, flight.date ? new Date(flight.date).toLocaleDateString("de-AT", { timeZone: "UTC" }) : ""]
    .filter(Boolean).join(" · ");
  setPlaying(false);
  emit();

  return {
    get speed() { return speed; },
    get playing() { return playing; },
    play() { setPlaying(true); },
    redraw: onResize,
    stop() {
      clearInterval(timer);
      els.play.removeEventListener("click", onPlay);
      els.speed.removeEventListener("change", onSpeed);
      els.back.removeEventListener("click", onBack);
      els.fwd.removeEventListener("click", onFwd);
      window.removeEventListener("resize", onResize);
      cv.removeEventListener("pointerdown", down);
      cv.removeEventListener("pointermove", move);
      cv.removeEventListener("pointerup", up);
      cv.removeEventListener("pointercancel", up);
    },
  };
}
