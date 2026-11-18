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

export const ALTIMETER = {
  max: 10000, // m
};

export const VARIO = {
  max: 5, // m/s, Skala von -max bis +max
};
