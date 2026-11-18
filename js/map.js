// Kartenseite: Flugzeug mit Flugrichtung, Wendepunkte, Linie zum Ziel.
// Verwendet Leaflet (vendor/leaflet) als globales L.

import { LANDABLE } from "./waypoints.js";
import { CATEGORIES, airspacesAt } from "./airspace.js";
import { zoneShapes, zoneText } from "./task.js";

export const MAP_SOURCES = {
  osm: {
    name: "OpenStreetMap",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende',
  },
  topo: {
    name: "OpenTopoMap (Gelände)",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    subdomains: "abc",
    maxZoom: 17,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende, SRTM | Stil: © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
  },
};

// Punkt in gegebener Richtung und Entfernung (km) – für die Kurslinie
function destination(lat, lon, bearing, km) {
  const R = 6371.0088, toRad = (d) => (d * Math.PI) / 180, toDeg = (r) => (r * 180) / Math.PI;
  const d = km / R, b = toRad(bearing), p1 = toRad(lat), l1 = toRad(lon);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [toDeg(p2), toDeg(l2)];
}

const GLIDER_SVG = `<svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">
  <path d="M20 3 L21.6 13.5 L38 15.2 L38 18 L21.6 18.6 L21.1 30 L26.5 31.4 L26.5 33.4 L20 32.8 L13.5 33.4 L13.5 31.4 L18.9 30 L18.4 18.6 L2 18 L2 15.2 L18.4 13.5 Z"/>
</svg>`;

export function createMapView({ container, recenterBtn, onPickTarget, getSource, isIgnored, toggleIgnore }) {
  const L = window.L;
  const map = L.map(container, {
    zoomControl: true,
    attributionControl: true,
    preferCanvas: true,
    zoomSnap: 0.5,
  }).setView([47.5, 14.5], 8);
  map.attributionControl.setPrefix(false);

  let tiles = null;
  function setSource(key) {
    const src = MAP_SOURCES[key] || MAP_SOURCES.osm;
    if (tiles) map.removeLayer(tiles);
    tiles = L.tileLayer(src.url, {
      maxZoom: src.maxZoom,
      subdomains: src.subdomains || "abc",
      attribution: src.attribution,
      crossOrigin: true,
    }).addTo(map);
    tiles.bringToBack();
  }
  setSource(getSource());

  // ---- Lufträume (eigene Ebene unter den Wendepunkten) ----
  map.createPane("airspace");
  map.getPane("airspace").style.zIndex = 350;
  const asRenderer = L.canvas({ pane: "airspace", padding: 0.5 });
  const asLayer = L.layerGroup().addTo(map);
  let spaces = [];
  const polyOf = new Map();
  const DASHED = new Set(["Q", "TMZ", "RMZ", "W", "E", "F", "G", "OTHER"]);

  function drawAirspaces() {
    asLayer.clearLayers();
    polyOf.clear();
    // große zuerst, damit kleine darüber liegen
    const sorted = [...spaces].sort((a, b) =>
      (b.bbox[2] - b.bbox[0]) * (b.bbox[3] - b.bbox[1]) - (a.bbox[2] - a.bbox[0]) * (a.bbox[3] - a.bbox[1]));
    for (const a of sorted) {
      const c = (CATEGORIES[a.cat] || CATEGORIES.OTHER).color;
      const poly = L.polygon(a.points, {
        renderer: asRenderer, pane: "airspace", interactive: false,
        color: c, weight: 2, opacity: isIgnored(a) ? 0.35 : 0.9, fillColor: c, fillOpacity: 0.06,
        dashArray: DASHED.has(a.cat) ? "7 5" : null,
      }).addTo(asLayer);
      polyOf.set(a, poly);
    }
  }

  // ---- Aufgabe (eigene Ebene über den Lufträumen) ----
  map.createPane("task");
  map.getPane("task").style.zIndex = 380;
  const taskRenderer = L.canvas({ pane: "task", padding: 0.5 });
  const taskLayer = L.layerGroup().addTo(map);
  const TASK = "#5b21b6";
  let task = null;
  let showAirspace = true, showTask = true;

  function taskPopup(p, i, n) {
    const div = document.createElement("div");
    div.className = "wp-pop";
    const h = document.createElement("b");
    h.textContent = `${i === 0 ? "Start" : i === n - 1 ? "Ziel" : "Wende " + i}: ${p.name}`;
    const m = document.createElement("div");
    m.textContent = [zoneText(p.oz, i, n), p.elev == null ? "" : `${Math.round(p.elev)} m`].filter(Boolean).join(" · ");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Als Ziel wählen";
    btn.addEventListener("click", () => { onPickTarget(p); map.closePopup(); });
    div.append(h, m, btn);
    return div;
  }

  function drawTask() {
    taskLayer.clearLayers();
    if (!task || !showTask) return;
    const n = task.points.length;
    const shapes = zoneShapes(task);
    for (const list of shapes) {
      for (const s of list) {
        if (s.kind === "line") {
          L.polyline(s.latlngs, { renderer: taskRenderer, pane: "task", color: TASK, weight: 5, interactive: false }).addTo(taskLayer);
        } else {
          L.polygon(s.latlngs, { renderer: taskRenderer, pane: "task", color: TASK, weight: 2, fillColor: TASK, fillOpacity: 0.12, interactive: false }).addTo(taskLayer);
        }
      }
    }
    const ll = task.points.map((p) => [p.lat, p.lon]);
    L.polyline(ll, { renderer: taskRenderer, pane: "task", color: "#ffffff", weight: 8, opacity: 0.9, interactive: false }).addTo(taskLayer);
    L.polyline(ll, { renderer: taskRenderer, pane: "task", color: TASK, weight: 4, interactive: false }).addTo(taskLayer);
    const first = task.points[0], last = task.points[n - 1];
    const sameStartFinish = Math.abs(first.lat - last.lat) < 1e-5 && Math.abs(first.lon - last.lon) < 1e-5;
    task.points.forEach((p, i) => {
      if (i === n - 1 && sameStartFinish) return; // Start = Ziel: ein gemeinsamer Punkt
      const label = i === 0 ? (sameStartFinish ? "S/Z" : "S") : i === n - 1 ? "Z" : String(i);
      const w = label.length > 1 ? 38 : 26;
      L.marker([p.lat, p.lon], {
        icon: L.divIcon({ className: "task-pt", html: label, iconSize: [w, 26], iconAnchor: [w / 2, 13] }),
        keyboard: false, zIndexOffset: 500, bubblingMouseEvents: false,
      }).bindPopup(() => taskPopup(p, i, n)).addTo(taskLayer);
    });
  }

  // Tippen auf die Karte: alle Lufträume an dieser Stelle anzeigen
  map.on("click", (e) => {
    if (!showAirspace) return;
    const hits = airspacesAt(spaces, e.latlng.lat, e.latlng.lng);
    if (!hits.length) return;
    hits.sort((a, b) => a.lower.m - b.lower.m);
    const div = document.createElement("div");
    div.className = "as-pop";
    for (const a of hits) {
      const cat = CATEGORIES[a.cat] || CATEGORIES.OTHER;
      const item = document.createElement("div");
      item.className = "as-item";
      item.style.setProperty("--c", cat.color);
      const name = document.createElement("b");
      name.textContent = a.name || "(ohne Namen)";
      const alt = document.createElement("div");
      alt.className = "as-alt";
      alt.textContent = `von ${a.lower.text} bis ${a.upper.text}`;
      const meta = document.createElement("div");
      meta.className = "as-meta";
      meta.textContent = [cat.label + (a.ac && !/^[A-G]$/.test(a.cat) && /^[A-G]$/i.test(a.ac) ? ` · Klasse ${a.ac}` : ""),
        a.freq, a.callsign].filter(Boolean).join(" · ");
      item.append(name, alt, meta);
      if (!["A", "B", "C", "D", "CTR", "R", "P", "GP", "Q", "TMZ", "RMZ"].includes(a.cat)) { div.appendChild(item); continue; }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "as-ign";
      const label = () => (btn.textContent = isIgnored(a) ? "Wieder warnen" : "Nicht warnen");
      label();
      btn.addEventListener("click", (ev) => { ev.stopPropagation(); toggleIgnore(a); label(); });
      item.appendChild(btn);
      div.appendChild(item);
    }
    L.popup({ maxWidth: 280, maxHeight: 300, autoPanPadding: [20, 20] }).setLatLng(e.latlng).setContent(div).openOn(map);
  });

  // ---- Wendepunkte ----
  const wpLayer = L.layerGroup().addTo(map);
  const labelLayer = L.layerGroup().addTo(map);
  let points = [];
  let target = null;

  function popupFor(p) {
    const div = document.createElement("div");
    div.className = "wp-pop";
    const h = document.createElement("b");
    h.textContent = p.name;
    const m = document.createElement("div");
    m.textContent = [p.code, p.elev == null ? "Höhe ?" : `${Math.round(p.elev)} m`, LANDABLE.has(p.style) ? "Landeplatz" : ""]
      .filter(Boolean).join(" · ");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Als Ziel wählen";
    btn.addEventListener("click", () => { onPickTarget(p); map.closePopup(); });
    div.append(h, m, btn);
    return div;
  }

  function drawPoints() {
    wpLayer.clearLayers();
    for (const p of points) {
      const land = LANDABLE.has(p.style);
      L.circleMarker([p.lat, p.lon], {
        radius: land ? 5 : 3.5,
        color: land ? "#0b5d22" : "#2b3440",
        weight: 1.2,
        fillColor: land ? "#2fbf5b" : "#9aa6b4",
        fillOpacity: 0.95,
        bubblingMouseEvents: false, // Tippen auf Wendepunkt öffnet nicht die Luftraum-Info
      }).bindPopup(() => popupFor(p)).addTo(wpLayer);
    }
    drawLabels();
  }

  // Namen nur bei genug Zoom und nur für sichtbare Punkte (sonst wird es zu voll)
  function drawLabels() {
    labelLayer.clearLayers();
    if (map.getZoom() < 10 || !points.length) return;
    const b = map.getBounds();
    const vis = points.filter((p) => b.contains([p.lat, p.lon]));
    vis.sort((a, c) => (LANDABLE.has(c.style) ? 1 : 0) - (LANDABLE.has(a.style) ? 1 : 0));
    for (const p of vis.slice(0, 120)) {
      L.marker([p.lat, p.lon], {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({ className: "wp-label" + (target && p.name === target.name && p.lat === target.lat ? " is-target" : ""), html: "", iconSize: null, iconAnchor: [-7, 7] }),
      }).addTo(labelLayer).getElement().textContent = p.name;
    }
  }
  map.on("zoomend moveend", drawLabels);

  // ---- Ziel ----
  const targetRing = L.circleMarker([0, 0], { radius: 11, color: "#d63ad6", weight: 3, fill: false, interactive: false });
  const targetLine = L.polyline([], { color: "#d63ad6", weight: 3, dashArray: "8 6", interactive: false });

  // ---- Flugzeug ----
  const gliderIcon = L.divIcon({ className: "glider", html: `<div class="glider-rot">${GLIDER_SVG}</div>`, iconSize: [40, 40], iconAnchor: [20, 20] });
  const glider = L.marker([0, 0], { icon: gliderIcon, interactive: false, keyboard: false, zIndexOffset: 1000 });
  const trackLine = L.polyline([], { color: "#f2b84b", weight: 3, opacity: 0.9, interactive: false });

  let pos = null;
  let follow = true;
  let firstFix = true;

  function setFollow(on) {
    follow = on;
    recenterBtn.hidden = on;
    if (on && pos) map.panTo([pos.lat, pos.lon], { animate: true });
  }
  map.on("dragstart", () => setFollow(false));
  recenterBtn.addEventListener("click", () => setFollow(true));

  function draw() {
    if (!pos) {
      [glider, trackLine, targetLine].forEach((l) => map.hasLayer(l) && map.removeLayer(l));
    } else {
      glider.setLatLng([pos.lat, pos.lon]);
      if (!map.hasLayer(glider)) glider.addTo(map);
      const rot = glider.getElement()?.querySelector(".glider-rot");
      if (rot) {
        rot.style.transform = `rotate(${pos.track ?? 0}deg)`;
        rot.classList.toggle("no-track", pos.track == null);
      }
      if (pos.track != null) {
        trackLine.setLatLngs([[pos.lat, pos.lon], destination(pos.lat, pos.lon, pos.track, 15)]);
        if (!map.hasLayer(trackLine)) trackLine.addTo(map);
      } else if (map.hasLayer(trackLine)) map.removeLayer(trackLine);
    }
    if (target) {
      targetRing.setLatLng([target.lat, target.lon]);
      if (!map.hasLayer(targetRing)) targetRing.addTo(map);
      if (pos) {
        targetLine.setLatLngs([[pos.lat, pos.lon], [target.lat, target.lon]]);
        if (!map.hasLayer(targetLine)) targetLine.addTo(map);
      }
    } else {
      [targetRing, targetLine].forEach((l) => map.hasLayer(l) && map.removeLayer(l));
    }
  }

  return {
    update(p) {
      pos = p;
      draw();
      if (!pos) return;
      if (firstFix) { firstFix = false; map.setView([pos.lat, pos.lon], 11, { animate: false }); }
      else if (follow) map.panTo([pos.lat, pos.lon], { animate: true, duration: 0.5 });
    },
    setPoints(p) { points = p || []; drawPoints(); },
    setAirspaces(a) { spaces = a || []; drawAirspaces(); },
    setTask(t) { task = t; drawTask(); },
    // Ebenen ein-/ausblenden
    setLayerVisible(name, on) {
      if (name === "airspace") {
        showAirspace = on;
        if (on && !map.hasLayer(asLayer)) asLayer.addTo(map);
        if (!on && map.hasLayer(asLayer)) map.removeLayer(asLayer);
      } else if (name === "task") {
        showTask = on;
        drawTask();
      }
    },
    fitTask() {
      if (!task) return;
      firstFix = false; // erste GPS-Position soll die Übersicht nicht überschreiben
      map.stop();
      map.fitBounds(task.points.map((p) => [p.lat, p.lon]), { padding: [40, 40], animate: false });
      setFollow(false);
    },
    // gewarnte Lufträume hervorheben
    setWarned(list) {
      for (const [a, poly] of polyOf) {
        const w = list.includes(a);
        poly.setStyle({ weight: w ? 5 : 2, fillOpacity: w ? 0.18 : 0.06, opacity: isIgnored(a) ? 0.35 : 0.9 });
      }
    },
    setTarget(t) { target = t; draw(); drawLabels(); },
    setSource,
    // Nach dem Einblenden muss Leaflet die Größe neu messen
    shown() { map.invalidateSize(); if (pos && follow) map.setView([pos.lat, pos.lon]); },
  };
}
