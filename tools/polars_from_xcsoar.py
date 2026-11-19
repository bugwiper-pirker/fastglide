#!/usr/bin/env python3
"""Polaren aus XCSoar übernehmen (src/Polar/PolarStore.cpp, GPL-2.0-or-later).

Aufruf: python3 tools/polars_from_xcsoar.py PolarStore.cpp js/polars-xcsoar.js
Quelle: https://github.com/XCSoar/XCSoar/blob/master/src/Polar/PolarStore.cpp
"""
import json
import re
import sys

src, out = sys.argv[1], sys.argv[2]
text = open(src, encoding="utf-8").read()
body = text[text.index("internal_polars[]"):]
row = re.compile(r'\{\s*"([^"]+)"\s*,([^}]*)\}\s*,?\s*(?://\s*(.*))?')
items = []
for m in row.finditer(body):
    nums = [float(x) for x in m.group(2).split(",") if x.strip()]
    if len(nums) != 12:
        continue
    mass, ballast, v1, w1, v2, w2, v3, w3, area, vno, handicap, empty = nums
    if area <= 0:
        continue  # ohne Flügelfläche keine Flächenbelastung
    items.append({
        "name": m.group(1),
        "refMass": mass, "maxBallast": ballast,
        "points": [[v1, -w1], [v2, -w2], [v3, -w3]],
        "area": area,
        "vno": round(vno * 3.6) if vno else None,   # km/h, Grenze des grünen Bogens
        "handicap": int(handicap) or None,
        "emptyMass": int(empty) or None,
        "source": (m.group(3) or "").strip() or None,
    })

with open(out, "w", encoding="utf-8") as f:
    f.write("// Polaren aus XCSoar (src/Polar/PolarStore.cpp), GPL-2.0-or-later, Copyright The XCSoar Project.\n")
    f.write("// Erzeugt mit tools/polars_from_xcsoar.py, nicht von Hand ändern.\n")
    f.write("// Punkte: [Fahrt km/h, Sinken m/s] bei refMass (kg), area in m², vno in km/h.\n")
    f.write("export const XCSOAR_POLARS = [\n")
    for it in items:
        f.write("  " + json.dumps(it, ensure_ascii=False, separators=(", ", ": ")) + ",\n")
    f.write("];\n")
print(len(items), "Polaren")
