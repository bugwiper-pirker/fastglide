// Polaren und Sollfahrt (MacCready).
//
// Eine Polare ist durch drei gemessene Punkte (Fahrt km/h IAS, Sinken m/s) bei einer
// Bezugsmasse gegeben. Daraus wird eine Parabel s(v) = a·v² + b·v + c (v in m/s, s positiv = Sinken).
//
// Flächenbelastung: Fahrt und Sinken wachsen mit √(W/W₀).
// Mücken: Die Gleitzahl wird um den Prozentwert schlechter, das Sinken also durch (1 − x) geteilt.
//
// Neue Polaren hier eintragen. Später soll man sie in den Einstellungen auswählen können.

export const POLARS = [
  {
    id: "arcus", name: "Arcus / Arcus M",
    source: "Idaflieg-Messung 2025 (aus XCSoar)",
    refMass: 704, area: 15.59, maxMass: 800,
    points: [[100, 0.6097], [130, 0.7199], [170, 1.2116]],
    vMin: 80, vMax: 280, // km/h IAS: kleinste sinnvolle Fahrt bei Bezugsmasse, VNE
  },
];

export const getPolarDef = (id) => POLARS.find((p) => p.id === id) || POLARS[0];
export const refWingLoading = (def) => def.refMass / def.area;

// Parabel durch drei Punkte
function fit(points) {
  const [[v1, s1], [v2, s2], [v3, s3]] = points.map(([v, s]) => [v / 3.6, s]);
  const d = (v1 - v2) * (v1 - v3) * (v2 - v3);
  const a = (v3 * (s2 - s1) + v2 * (s1 - s3) + v1 * (s3 - s2)) / d;
  const b = (v3 * v3 * (s1 - s2) + v2 * v2 * (s3 - s1) + v1 * v1 * (s2 - s3)) / d;
  const c = (v2 * v3 * (v2 - v3) * s1 + v3 * v1 * (v3 - v1) * s2 + v1 * v2 * (v1 - v2) * s3) / d;
  return { a, b, c };
}

// wingLoading in kg/m², bugs in % (0 = sauber)
export function makePolar(def, { wingLoading, bugs = 0 }) {
  const wl0 = refWingLoading(def);
  const wl = Math.min(Math.max(wingLoading || wl0, 20), 80);
  const k = Math.sqrt(wl / wl0);
  const f = 1 / (1 - Math.min(Math.max(bugs, 0), 50) / 100);
  const p0 = fit(def.points);
  const a = (p0.a / k) * f, b = p0.b * f, c = p0.c * k * f;
  const sink = (v) => a * v * v + b * v + c;
  // kleinste Sollfahrt (die Parabel ist unterhalb der Messpunkte nur grob)
  const vMinSink = (def.vMin / 3.6) * k;
  const vMax = def.vMax / 3.6;
  const clamp = (v) => Math.min(Math.max(v, vMinSink), vMax);
  const vBest = Math.sqrt(c / a);

  return {
    def, wingLoading: wl, bugs, mass: wl * def.area,
    sink,              // Sinken (m/s, positiv) bei Fahrt v (m/s IAS)
    vMinSink, vMax,
    vBestGlide: clamp(vBest),
    bestGlide: vBest / sink(vBest),
    // Sollfahrt (m/s) für MC (m/s) und Netto-Steigen der Luftmasse (m/s, + = Steigen)
    stf(mc, netto = 0) {
      const x = c - netto + mc;
      return x <= 0 ? vMinSink : clamp(Math.sqrt(x / a));
    },
    // Endanflug: beste Fahrt bei Gegenwind hw (m/s, − = Rückenwind) und Gleitzahl über Grund
    glide(mc, hw = 0) {
      const x = hw * hw + (b * hw + c + mc) / a;
      const v = clamp(x > 0 ? hw + Math.sqrt(x) : vMinSink);
      const gs = v - hw;
      return { v, ld: gs > 0 ? gs / sink(v) : 0 };
    },
  };
}
