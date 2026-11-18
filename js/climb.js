// Berechnet Steigen/Sinken (m/s) aus GPS-Höhen.
// Methode: lineare Regression der Höhe über die Zeit in einem gleitenden Fenster.
// Das glättet das Rauschen der GPS-Höhe besser als eine einfache Differenz.

function slope(samples) {
  const n = samples.length;
  const t0 = samples[0].t;
  let st = 0, sa = 0, stt = 0, sta = 0;
  for (const s of samples) {
    const t = (s.t - t0) / 1000;
    st += t; sa += s.alt; stt += t * t; sta += t * s.alt;
  }
  const den = n * stt - st * st;
  return den === 0 ? null : (n * sta - st * sa) / den;
}

export function createClimbCalculator() {
  let buf = [];
  const KEEP_MS = 30000;

  function window(ms, minSpanMs, now) {
    const s = buf.filter((x) => x.t >= now - ms);
    if (s.length < 3 || s[s.length - 1].t - s[0].t < minSpanMs) return null;
    return slope(s);
  }

  return {
    reset() { buf = []; },
    // windowSec: Dämpfung des Zeigers
    add(t, alt, windowSec) {
      if (alt == null || Number.isNaN(alt)) return { vario: null, avg: null };
      if (buf.length && t <= buf[buf.length - 1].t) return this.current(windowSec);
      buf.push({ t, alt });
      buf = buf.filter((x) => x.t >= t - KEEP_MS);
      return this.current(windowSec);
    },
    current(windowSec) {
      if (!buf.length) return { vario: null, avg: null };
      const now = buf[buf.length - 1].t;
      return {
        vario: window(windowSec * 1000, Math.min(2000, windowSec * 500), now),
        avg: window(20000, 10000, now),
      };
    },
  };
}
