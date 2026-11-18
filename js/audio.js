// Vario-Ton mit der Web Audio API.
// Steigen: Pieptöne, je stärker das Steigen, desto höher und schneller.
// Sinken (optional): durchgehender tiefer Ton unterhalb einer Schwelle.
// Dazwischen: Stille.

const CLIMB_START = 0.2;   // m/s, ab hier piept es
const MAX = 5;             // m/s, ab hier ändert sich der Ton nicht mehr

export function createVarioAudio() {
  let ctx = null, osc = null, gain = null, timer = null;
  let value = null;          // aktuelles Steigen in m/s, null = keine Daten
  let volume = 0.6;          // 0..1
  let sinkTone = false;
  let sinkThreshold = -2.5;  // m/s
  let nextBeat = 0;
  let mode = "silent";       // "silent" | "climb" | "sink"

  const level = () => 0.3 * volume * volume; // Rechteck ist laut, daher gedämpft

  function ensure() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error("Web Audio wird nicht unterstützt");
    ctx = new AC();
    osc = ctx.createOscillator();
    osc.type = "square";
    gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
  }

  function tick() {
    if (!ctx || ctx.state !== "running") return;
    const now = ctx.currentTime;
    const v = value;

    if (v != null && v >= CLIMB_START) {
      const k = Math.min(v, MAX) / MAX;           // 0..1
      const freq = 650 + k * 900;                 // 650..1550 Hz
      const period = 0.55 - k * 0.38;             // 0,55..0,17 s
      if (mode !== "climb") { mode = "climb"; nextBeat = now + 0.02; }
      // Töne knapp im Voraus planen, damit es nicht stottert
      while (nextBeat < now + 0.12) {
        const on = period * 0.55;
        osc.frequency.setValueAtTime(freq, nextBeat);
        gain.gain.setValueAtTime(0, nextBeat);
        gain.gain.linearRampToValueAtTime(level(), nextBeat + 0.008);
        gain.gain.setValueAtTime(level(), nextBeat + on - 0.01);
        gain.gain.linearRampToValueAtTime(0, nextBeat + on);
        nextBeat += period;
      }
    } else if (v != null && sinkTone && v <= sinkThreshold) {
      const k = Math.min(Math.abs(v), MAX) / MAX;
      const freq = 330 - k * 130;                 // 330..200 Hz
      if (mode !== "sink") {
        mode = "sink";
        gain.gain.cancelScheduledValues(now);
        gain.gain.setTargetAtTime(level() * 0.8, now, 0.03);
      }
      osc.frequency.setTargetAtTime(freq, now, 0.1);
    } else if (mode !== "silent") {
      mode = "silent";
      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(0, now, 0.02);
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
      if (timer) { clearInterval(timer); timer = null; }
      if (ctx) {
        gain.gain.cancelScheduledValues(ctx.currentTime);
        gain.gain.setValueAtTime(0, ctx.currentTime);
        ctx.suspend();
      }
      mode = "silent";
    },
    isRunning: () => !!ctx && ctx.state === "running" && !!timer,
    setValue(v) { value = v; },
    setVolume(v) { volume = Math.min(Math.max(v, 0), 1); },
    setSinkTone(on, threshold) { sinkTone = on; if (threshold != null) sinkThreshold = threshold; },
  };
}
