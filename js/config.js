// Flugzeugdaten. Für ein anderes Muster nur diese Werte anpassen.
// Quelle: Arcus M Flughandbuch, Abschnitt 2.2 und 2.3 (Okt. 2011), Werte in km/h IAS.
export const AIRCRAFT = {
  name: "Arcus M",
  bestGlide: 50,       // beste Gleitzahl (ca.), für die Farbe der Endanflug-Anzeige
  asi: {
    max: 285,          // Skalenende
    whiteArc: [88, 180],   // Betriebsbereich positive Klappen
    greenArc: [96, 180],   // Normaler Betriebsbereich
    yellowArc: [180, 280], // Vorsichtsbereich
    redLine: 280,          // VNE
    blueLine: 95,          // VY, bestes Steigen
    yellowTriangle: 105,   // Anfluggeschwindigkeit
  },
};

// Mitgelieferte Wendepunktdatei. Wird geladen, wenn am Handy noch keine Datei gespeichert ist.
export const DEFAULT_WAYPOINTS = {
  url: "data/2021_LOXN_Alle.cup",
  name: "2021_LOXN_Alle.cup",
};

// Mitgelieferte Luftraumdatei (Austro Control, OpenAir). Bei jedem AIRAC-Wechsel ersetzen.
export const DEFAULT_AIRSPACE = {
  url: "data/austria_acg_airspaces_20261126.txt",
  name: "austria_acg_airspaces_20261126.txt",
  label: "Austro Control, gültig ab 26.11.2026",
};

// Proxy für Soaring-Spot-Links (Cloudflare Worker aus proxy/soaringspot-worker.js).
// Soaring Spot erlaubt keinen direkten Abruf aus dem Browser. Leer = Links von Soaring Spot gehen nicht.
export const SOARINGSPOT_PROXY = "https://glidewise-soaringspot.gliderpilotmp.workers.dev";

export const ALTIMETER = {
  max: 10000, // m
};

export const VARIO = {
  max: 5, // m/s, Skala von -max bis +max
};
