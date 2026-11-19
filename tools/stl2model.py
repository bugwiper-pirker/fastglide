#!/usr/bin/env python3
"""Segelflugzeug-Modell aus einem STL (z. B. Fusion-360-Export) für die 3D-Ansicht umwandeln.

Aufruf: python3 tools/stl2model.py "Arcus Model Version 2 v15.stl" models/arcus.bin --span 20

Erwartet im STL: x von der Nase nach hinten, y nach oben, z entlang der Spannweite (so wie das Arcus-Modell).
Ergebnis in echter Größe (Maßstab aus der Spannweite) und in den Achsen der App:
  +Y = Nase, +X = rechter Flügel, +Z = oben, Ursprung etwa im Schwerpunkt, Einheit m.

Dateiformat (little endian):
  uint32 Anzahl Punkte, uint32 Dreiecke Rumpf/Flügel, uint32 Dreiecke Haube
  float32[3·Punkte] Koordinaten, uint16[3·Dreiecke] Indizes (erst Rumpf/Flügel, dann Haube)
"""
import argparse
import struct


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("stl")
    ap.add_argument("out")
    ap.add_argument("--span", type=float, default=20.0, help="echte Spannweite in m")
    a = ap.parse_args()

    b = open(a.stl, "rb").read()
    n = struct.unpack("<I", b[80:84])[0]
    if len(b) != 84 + n * 50:
        raise SystemExit("Nur binäre STL-Dateien werden unterstützt.")
    tris = [struct.unpack("<9f", b[84 + i * 50 + 12:84 + i * 50 + 48]) for i in range(n)]

    xs = [t[k] for t in tris for k in (0, 3, 6)]
    zs = [t[k] for t in tris for k in (2, 5, 8)]
    span_mm = max(zs) - min(zs)
    s = a.span / span_mm  # mm im Modell -> m echt
    length = max(xs) - min(xs)
    x0 = min(xs) + 0.33 * length  # Bezugspunkt etwa am Flügel
    # Rumpfmitte (Höhe) beim Bezugspunkt
    mid = [t[k + 1] for t in tris for k in (0, 3, 6) if abs(t[k] - x0) < 40 and abs(t[k + 2]) < 40]
    y0 = (min(mid) + max(mid)) / 2 if mid else 0

    # Haube: oben auf dem Rumpf, vor dem Flügel, nahe der Mitte
    def is_canopy(t):
        cx = (t[0] + t[3] + t[6]) / 3
        cy = (t[1] + t[4] + t[7]) / 3
        cz = (t[2] + t[5] + t[8]) / 3
        rel = (cx - min(xs)) / length
        return 0.05 < rel < 0.30 and abs(cz) < 0.09 * length and cy > y0 + 0.02 * length

    index = {}
    pts = []

    def vid(x, y, z):
        key = (round(x, 2), round(y, 2), round(z, 2))
        if key not in index:
            index[key] = len(pts)
            # App-Achsen: X = Spannweite, Y = nach vorne, Z = oben
            pts.append(((z) * s, -(x - x0) * s, (y - y0) * s))
        return index[key]

    body, canopy = [], []
    for t in tris:
        ids = [vid(t[k], t[k + 1], t[k + 2]) for k in (0, 3, 6)]
        if len(set(ids)) < 3:
            continue
        (canopy if is_canopy(t) else body).append(ids)

    if len(pts) > 65535:
        raise SystemExit("Zu viele Punkte für 16-Bit-Indizes, Modell vereinfachen.")
    with open(a.out, "wb") as f:
        f.write(struct.pack("<3I", len(pts), len(body), len(canopy)))
        for p in pts:
            f.write(struct.pack("<3f", *p))
        for tri in body + canopy:
            f.write(struct.pack("<3H", *tri))
    print(f"{len(pts)} Punkte, {len(body)} + {len(canopy)} Dreiecke (Haube), Maßstab des STL 1:{s * 1000:.2f}")


if __name__ == "__main__":
    main()
