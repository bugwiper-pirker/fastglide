// Vario-Ton mit der Web Audio API.
// Steigen: Pieptöne, je stärker das Steigen, desto höher und schneller.
// Sinken (optional): durchgehender tiefer Ton unterhalb einer Schwelle.
// Dazwischen: Stille.
// Sollfahrtton (Geradeausflug, wie beim LX): zu schnell = Pieptöne (ziehen),
// zu langsam = tiefer Dauerton (drücken), innerhalb ±5 km/h still.

const CLIMB_START = 0.2;   // m/s, ab hier piept es
const MAX = 6;             // m/s, ab hier ändert sich der Ton nicht mehr
const STF_DEAD = 5;        // km/h ohne Ton
const STF_MAX = 40;        // km/h Abweichung, ab hier ändert sich der Ton nicht mehr
// Tonhöhe logarithmisch (gleiche Tonschritte je m/s, wie bei guten Varios): 0 m/s ≈ 520 Hz,
// jede m/s etwa ein Ganzton bis eine kleine Terz höher, 6 m/s ≈ 1500 Hz
const F0 = 520, F_MAX = 1500;
const SINK_F0 = 400, SINK_MIN = 190; // Sinkton fällt ebenso logarithmisch
const TAU = 0.9;           // s, zusätzliche Mittelung des Werts für den Ton

export function createVarioAudio() {
  let ctx = null, osc = null, gain = null, timer = null;
  let value = null;          // aktuelles Steigen in m/s, null = keine Daten
  let smooth = null;         // für den Ton gemittelt
  let lastTick = 0;
  let stf = null;            // Fahrt minus Sollfahrt (km/h), null = Vario-Ton
  let volume = 0.6;          // 0..1
  let sinkTone = false;
  let sinkThreshold = -2.5;  // m/s
  let nextBeat = 0;
  let mode = "silent";       // "silent" | "climb" | "sink"

  const level = () => 0.55 * volume * volume;

  function ensure() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error("Web Audio wird nicht unterstützt");
    ctx = new AC();
    osc = ctx.createOscillator();
    // Weicher, runder Klang: Grundton mit wenigen leisen Obertönen statt Rechteck
    osc.setPeriodicWave(ctx.createPeriodicWave(new Float32Array([0, 0, 0, 0, 0, 0]),
      new Float32Array([0, 1, 0.28, 0.12, 0.05, 0.02])));
    osc.frequency.value = F0;
    // Höhen etwas abrunden, damit es nicht „digital“ klingt
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 3200; lp.Q.value = 0.5;
    gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(lp).connect(gain).connect(ctx.destination);
    osc.start();
  }

  const logScale = (k, a, b) => a * (b / a) ** k; // k 0..1 → a..b, logarithmisch

  function tick() {
    if (!ctx || ctx.state !== "running") return;
    const now = ctx.currentTime;
    const dt = lastTick ? Math.min(0.5, now - lastTick) : 0.04;
    lastTick = now;
    // Sollfahrtton auf dieselben Töne abbilden: ziehen wie Steigen, drücken wie Sinken
    const raw = stf == null ? value
      : stf > STF_DEAD ? CLIMB_START + (Math.min(stf - STF_DEAD, STF_MAX) / STF_MAX) * (MAX - CLIMB_START)
      : stf < -STF_DEAD ? -(Math.min(-stf - STF_DEAD, STF_MAX) / STF_MAX) * MAX - 0.01
      : 0;
    // Mitteln (Tiefpass), damit der Ton ruhig bleibt und nicht mit jedem Messwert springt
    if (raw == null) smooth = null;
    else smooth = smooth == null ? raw : smooth + (raw - smooth) * (1 - Math.exp(-dt / TAU));
    const v = smooth;
    const sinkOn = stf != null ? v < 0 : sinkTone && v <= sinkThreshold;

    if (v != null && v >= CLIMB_START) {
      const k = Math.min(v, MAX) / MAX;           // 0..1
      // Tonhöhe gleitet stufenlos, auch während eines Pieps
      osc.frequency.setTargetAtTime(logScale(k, F0, F_MAX), now, 0.12);
      // Pieptakt: schwach langsam und kurz, stark schnell und länger (etwa 1,6 … 7 pro Sekunde)
      const period = logScale(k, 0.62, 0.15);
      const duty = 0.45 + k * 0.2;
      if (mode !== "climb") {
        mode = "climb";
        gain.gain.cancelScheduledValues(now);
        gain.gain.setTargetAtTime(0, now, 0.01);
        nextBeat = now + 0.03;
      }
      // Töne knapp im Voraus planen, damit es nicht stottert; weiche Flanken, kein Klicken
      while (nextBeat < now + 0.12) {
        const on = period * duty, edge = Math.min(0.025, on * 0.25);
        gain.gain.setValueAtTime(0, nextBeat);
        gain.gain.linearRampToValueAtTime(level(), nextBeat + edge);
        gain.gain.setValueAtTime(level(), nextBeat + on - edge);
        gain.gain.linearRampToValueAtTime(0, nextBeat + on);
        nextBeat += period;
      }
    } else if (v != null && sinkOn) {
      const k = Math.min(Math.abs(v), MAX) / MAX;
      osc.frequency.setTargetAtTime(logScale(k, SINK_F0, SINK_MIN), now, 0.15);
      if (mode !== "sink") {
        mode = "sink";
        gain.gain.cancelScheduledValues(now);
        gain.gain.setTargetAtTime(level() * 0.7, now, 0.05);
      }
    } else if (mode !== "silent") {
      mode = "silent";
      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(0, now, 0.03);
    }
  }

  return {
    // Muss aus einer Benutzeraktion (Tippen) heraus aufgerufen werden
    async enable() {
      ensure();
      if (ctx.state !== "running") await ctx.resume();
      if (!timer) timer = setInterval(tick, 40);
      return ctx.state === "running";
    },
    disable() {
      // Nur den Vario-Ton stoppen; der Audio-Kontext bleibt für Luftraumwarnungen aktiv
      if (timer) { clearInterval(timer); timer = null; }
      if (ctx) {
        gain.gain.cancelScheduledValues(ctx.currentTime);
        gain.gain.setValueAtTime(0, ctx.currentTime);
      }
      mode = "silent"; smooth = null; lastTick = 0;
    },
    // Audio freischalten (nach Berührung), ohne Vario-Ton zu starten
    async unlock() {
      try { ensure(); if (ctx.state !== "running") await ctx.resume(); } catch {}
      return !!ctx && ctx.state === "running";
    },
    // Warnsignal: drei Doppeltöne (inside) bzw. zwei (near), deutlich anders als der Vario-Ton
    alert(level) {
      if (!ctx || ctx.state !== "running") return false;
      const t0 = ctx.currentTime + 0.05;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sawtooth";
      g.gain.value = 0;
      o.connect(g).connect(ctx.destination);
      const n = level === "inside" ? 3 : 2, L = Math.max(0.15, 0.35 * volume);
      for (let i = 0; i < n; i++) {
        const t = t0 + i * 0.5;
        o.frequency.setValueAtTime(980, t);
        o.frequency.setValueAtTime(700, t + 0.18);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(L, t + 0.01);
        g.gain.setValueAtTime(L, t + 0.35);
        g.gain.linearRampToValueAtTime(0, t + 0.37);
      }
      o.start(t0);
      o.stop(t0 + n * 0.5 + 0.1);
      return true;
    },
    isRunning: () => !!ctx && ctx.state === "running" && !!timer,
    setValue(v) { value = v; },
    setStf(diff) { stf = diff; },
    setVolume(v) { volume = Math.min(Math.max(v, 0), 1); },
    setSinkTone(on, threshold) { sinkTone = on; if (threshold != null) sinkThreshold = threshold; },
  };
}
