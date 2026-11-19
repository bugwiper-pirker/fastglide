// 3D-Ansicht: Gelände mit Luftbild, Segelflugzeug von hinten wie im Flugsimulator, Flugspur in der Luft.
// MapLibre GL (vendor/maplibre) für Karte, Gelände und Kamera, three.js (vendor/three) für Flugzeug und Spur.
// Beides wird erst geladen, wenn die 3D-Ansicht zum ersten Mal geöffnet wird.
//
// Geländedaten: AWS Terrain Tiles (Terrarium, aus SRTM u. a.), Luftbild: Sentinel-2 cloudless (EOX).

import { zoneShapes } from "./task.js";
import { CATEGORIES } from "./airspace.js";

const IMAGERY = {
  sat: {
    tiles: ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/g/{z}/{y}/{x}.jpg"],
    maxzoom: 15,
    attribution: '<a href="https://s2maps.eu">Sentinel-2 cloudless</a> by EOX IT Services GmbH (Copernicus Sentinel-Daten 2023)',
  },
  topo: {
    tiles: ["https://a.tile.opentopomap.org/{z}/{x}/{y}.png", "https://b.tile.opentopomap.org/{z}/{x}/{y}.png"],
    maxzoom: 17,
    attribution: '© OpenStreetMap-Mitwirkende, SRTM | Stil: © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
  },
};
const TERRAIN = {
  tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
  encoding: "terrarium",
  tileSize: 256,
  maxzoom: 14,
  attribution: 'Gelände: <a href="https://registry.opendata.aws/terrain-tiles/">AWS Terrain Tiles</a> (SRTM, EU-DEM u. a.)',
};

let libs = null;
function loadScript(src) {
  return new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = src; s.onload = ok; s.onerror = () => fail(new Error(`${src} konnte nicht geladen werden.`));
    document.head.appendChild(s);
  });
}
async function loadLibs() {
  if (libs) return libs;
  const css = document.createElement("link");
  css.rel = "stylesheet"; css.href = "vendor/maplibre/maplibre-gl.css";
  document.head.appendChild(css);
  const [, THREE] = await Promise.all([loadScript("vendor/maplibre/maplibre-gl.js"), import("../vendor/three/three.module.min.js")]);
  libs = { ml: window.maplibregl, THREE };
  return libs;
}

// ---- Flugzeugmodell, Maße in m: Nase +Y, rechter Flügel +X, oben +Z ----
// models/arcus.bin: Arcus M aus dem Fusion-360-Modell (umgewandelt mit tools/stl2model.py).
const MODEL_URL = "models/arcus.bin";
export async function loadModel(THREE, url = MODEL_URL) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const buf = await res.arrayBuffer();
  const [n, nBody, nCanopy] = new Uint32Array(buf, 0, 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(buf, 12, n * 3), 3));
  geo.setIndex(new THREE.BufferAttribute(new Uint16Array(buf, 12 + n * 12, (nBody + nCanopy) * 3), 1));
  geo.addGroup(0, nBody * 3, 0);      // Rumpf und Flügel
  geo.addGroup(nBody * 3, nCanopy * 3, 1); // Haube
  geo.computeVertexNormals();
  return geo;
}

// Wettbewerbskennzeichen auf beiden Seiten des Seitenleitwerks
function addLabel(THREE, g, label, x, y, z) {
  if (!label) return;
  const cv = document.createElement("canvas");
  cv.width = 256; cv.height = 128;
  const c = cv.getContext("2d");
  c.fillStyle = "#16181b"; c.font = "bold 96px Arial, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
  c.fillText(label, 128, 70);
  const mat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, side: THREE.DoubleSide });
  for (const sx of [1, -1]) {
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.45), mat);
    pl.rotation.set(Math.PI / 2, sx * Math.PI / 2, 0);
    pl.position.set(sx * x, y, z);
    g.add(pl);
  }
}

// Mit model (aus loadModel) das echte Modell, sonst ein einfaches, nachgebautes Arcus-Modell:
// weiß, blau getönte Haube, Flügel mit Knick und Winglets, T-Leitwerk.
export function buildGlider(THREE, label, model = null) {
  const g = new THREE.Group();
  const white = new THREE.MeshLambertMaterial({ color: 0xf6f7f8, side: THREE.DoubleSide });
  const glass = new THREE.MeshPhongMaterial({ color: 0x1d8fd0, specular: 0xffffff, shininess: 80, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
  if (model) {
    g.add(new THREE.Mesh(model, [white, glass]));
    addLabel(THREE, g, label, 0.07, -5.3, 0.72);
    return g;
  }

  // Rumpf: Drehkörper, 8,7 m lang, vorne Kabine, hinten schlanker Leitwerksträger
  const prof = [[0, 0], [0.2, 0.12], [0.36, 0.45], [0.44, 1.1], [0.43, 2.3], [0.32, 3.4], [0.17, 4.8], [0.11, 7.4], [0.08, 8.7], [0, 8.7]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  const fus = new THREE.Mesh(new THREE.LatheGeometry(prof, 18), white);
  fus.position.y = 3.0; fus.rotation.x = Math.PI; // Lathe-Achse ist +Y: umdrehen, damit die Nase vorne ist
  g.add(fus);
  const cab = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 10), glass);
  cab.scale.set(0.37, 1.45, 0.33); cab.position.set(0, 1.35, 0.2);
  g.add(cab);

  // Flügelteil als flaches Prisma: Grundriss in der x/y-Ebene (x = Spannweite), Dicke in z
  function panel(len, c0, c1, thick) {
    const sh = new THREE.Shape();
    sh.moveTo(0, c0 * 0.35); sh.lineTo(len, c1 * 0.35); sh.lineTo(len, -c1 * 0.65); sh.lineTo(0, -c0 * 0.65);
    const geo = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: false });
    geo.translate(0, 0, -thick / 2);
    return new THREE.Mesh(geo, white);
  }
  // Innenflügel 6,3 m (2,5° V-Form), Außenflügel 3,5 m (7,5°), Winglet 0,7 m nach oben
  function wing(side) {
    const root = new THREE.Group();
    root.position.set(0, 0.15, 0.36);
    root.scale.x = side;
    const inner = panel(6.3, 0.95, 0.68, 0.13);
    inner.rotation.y = -(2.5 * Math.PI) / 180;
    root.add(inner);
    const outer = panel(3.5, 0.68, 0.38, 0.09);
    outer.position.set(6.3, 0, 0);
    outer.rotation.y = -(5 * Math.PI) / 180;
    inner.add(outer);
    const wl = panel(0.7, 0.36, 0.18, 0.05);
    wl.position.set(3.5, -0.03, 0);
    wl.rotation.y = -(70 * Math.PI) / 180;
    outer.add(wl);
    return root;
  }
  g.add(wing(1), wing(-1));

  // Seitenleitwerk (gepfeilt) und T-Höhenleitwerk
  const finShape = new THREE.Shape();
  finShape.moveTo(-0.1, 0); finShape.lineTo(-1.25, 0); finShape.lineTo(-0.95, 1.35); finShape.lineTo(-0.35, 1.35);
  const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.07, bevelEnabled: false });
  finGeo.translate(0, 0, -0.035);
  const fin = new THREE.Mesh(finGeo, white);
  fin.rotation.set(Math.PI / 2, Math.PI / 2, 0); // Fläche in die y/z-Ebene
  fin.position.set(0, -4.55, 0.12);
  g.add(fin);
  const stab = panel(1.65, 0.62, 0.38, 0.05);
  const stabL = panel(1.65, 0.62, 0.38, 0.05);
  stabL.scale.x = -1;
  for (const st of [stab, stabL]) { st.position.set(0, -5.45, 1.5); g.add(st); }

  addLabel(THREE, g, label, 0.045, -5.35, 0.75);
  return g;
}

// Farbe der Spur nach Steigen: rot = Sinken, weiß = 0, grün = Steigen
function climbColor(THREE, v) {
  const k = Math.max(-1, Math.min(1, v / 3));
  return k >= 0 ? new THREE.Color().setRGB(1 - k * 0.8, 1, 1 - k * 0.8) : new THREE.Color().setRGB(1, 1 + k * 0.75, 1 + k * 0.75);
}

export async function createMap3d({ container, followBtn, getImagery }) {
  const { ml, THREE } = await loadLibs();
  const model = await loadModel(THREE).catch(() => null); // ohne Datei das einfache Modell

  const map = new ml.Map({
    container,
    style: {
      version: 8,
      sources: {
        img: { type: "raster", tileSize: 256, ...IMAGERY[getImagery()] || IMAGERY.sat },
        dem: { type: "raster-dem", ...TERRAIN },
      },
      layers: [{ id: "img", type: "raster", source: "img" }],
      terrain: { source: "dem", exaggeration: 1 },
      sky: {
        "sky-color": "#7fb2e5", "horizon-color": "#d8e6f2", "fog-color": "#d8e6f2",
        "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.6, "fog-ground-blend": 0.4,
      },
    },
    center: [14.5, 47.5], zoom: 10, pitch: 70, maxPitch: 85, elevation: 3000,
    centerClampedToGround: false,
    attributionControl: { compact: true },
  });
  map.addControl(new ml.NavigationControl({ visualizePitch: true }), "top-left");

  // ---- Zustand ----
  let target = null;            // letzte Position vom GPS / aus dem Flug
  let cur = null;               // geglättet für die Darstellung
  let bank = 0, prevTrack = null, prevTime = null;
  let follow = true;
  let bearingOffset = 0;        // Ansicht gedreht (0 = von hinten)
  const PITCH = 78;
  let viewPitch = PITCH;
  let flight = null, task = null, spaces = [];
  const vis = { airspace: true, task: true };
  function applyVisibility() {
    if (!map.getLayer("airspace")) return;
    map.setLayoutProperty("airspace", "visibility", vis.airspace ? "visible" : "none");
    map.setLayoutProperty("task", "visibility", vis.task ? "visible" : "none");
  }

  function setFollow(on) {
    follow = on;
    followBtn.hidden = on;
    if (on) { bearingOffset = 0; viewPitch = PITCH; }
  }
  followBtn.addEventListener("click", () => setFollow(true));
  // Verschieben beendet das Mitfliegen, Drehen und Neigen bleibt als Blickwinkel erhalten
  map.on("dragstart", (e) => { if (e.originalEvent && !e.originalEvent.ctrlKey && e.originalEvent.button !== 2 && !(e.originalEvent.touches?.length > 1)) setFollow(false); });
  map.on("rotate", (e) => { if (e.originalEvent && cur) bearingOffset = map.getBearing() - cur.track; });
  map.on("pitch", (e) => { if (e.originalEvent) viewPitch = map.getPitch(); });

  // ---- three.js-Ebene ----
  let renderer, scene, camera, glider, trackLine = null;
  function setGlider(label) {
    if (glider) scene.remove(glider);
    glider = buildGlider(THREE, label, model);
    glider.matrixAutoUpdate = false;
    glider.visible = false;
    scene.add(glider);
  }
  const layer = {
    id: "glider3d",
    type: "custom",
    renderingMode: "3d",
    onAdd(m, gl) {
      camera = new THREE.Camera();
      scene = new THREE.Scene();
      scene.add(new THREE.AmbientLight(0xffffff, 1.6));
      const sun = new THREE.DirectionalLight(0xffffff, 2.2);
      sun.position.set(0.4, -0.6, 1).normalize();
      scene.add(sun);
      setGlider(flight?.cid || "PV");
      renderer = new THREE.WebGLRenderer({ canvas: m.getCanvas(), context: gl, antialias: true });
      renderer.autoClear = false;
    },
    render(gl, args) {
      const proj = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix);
      if (cur) {
        const mc = ml.MercatorCoordinate.fromLngLat([cur.lon, cur.lat], cur.alt);
        const unit = mc.meterInMercatorCoordinateUnits();
        // Spannweite am Bildschirm mindestens ein Viertel der Kartenbreite (wie im Flugsimulator),
        // beim Hineinzoomen echte Größe
        const mpp = (40075016.7 * Math.cos((cur.lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
        const want = Math.min(300, Math.max(130, container.clientWidth * 0.33));
        const s = Math.max(1, (want * mpp) / 20);
        const rad = (d) => (d * Math.PI) / 180;
        const m = new THREE.Matrix4()
          .makeTranslation(mc.x, mc.y, mc.z)
          .scale(new THREE.Vector3(unit * s, -unit * s, unit * s))
          .multiply(new THREE.Matrix4().makeRotationZ(-rad(cur.track)))
          .multiply(new THREE.Matrix4().makeRotationY(rad(bank)))
          .multiply(new THREE.Matrix4().makeRotationX(Math.atan2(cur.vario || 0, Math.max(10, cur.speed / 3.6))));
        glider.matrix.copy(m);
        glider.visible = true;
      }
      camera.projectionMatrix = proj;
      renderer.resetState();
      renderer.render(scene, camera);
      map.triggerRepaint();
    },
  };

  function trackGeometry() {
    if (trackLine) { scene.remove(trackLine); trackLine.geometry.dispose(); trackLine = null; }
    if (!flight || !scene) return;
    const fx = flight.fixes;
    const step = Math.max(1, Math.floor(fx.length / 6000));
    const pos = [], col = [];
    for (let i = 0; i < fx.length; i += step) {
      const f = fx[i];
      const mc = ml.MercatorCoordinate.fromLngLat([f.lon, f.lat], f.alt + flight.altOffset);
      pos.push(mc.x, mc.y, mc.z);
      const j = Math.min(fx.length - 1, i + Math.max(step, 5)), a = fx[Math.max(0, i - 5)];
      const v = (fx[j].alt - a.alt) / Math.max(1, (fx[j].t - a.t) / 1000);
      const c = climbColor(THREE, v);
      col.push(c.r, c.g, c.b);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    trackLine = new THREE.Line(geo, new THREE.LineBasicMaterial({ vertexColors: true }));
    trackLine.frustumCulled = false;
    scene.add(trackLine);
  }

  // Schatten der Spur, Aufgabe und Lufträume liegen auf dem Gelände
  const empty = { type: "FeatureCollection", features: [] };
  function geo(id) { return map.getSource(id); }
  function setGround() {
    if (!map.isStyleLoaded() || !geo("shadow")) return;
    geo("shadow").setData(flight ? {
      type: "Feature", geometry: { type: "LineString", coordinates: flight.fixes.filter((_, i) => i % 3 === 0).map((f) => [f.lon, f.lat]) },
    } : empty);
    const tf = [];
    if (task) {
      tf.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: task.points.map((p) => [p.lon, p.lat]) } });
      for (const list of zoneShapes(task)) for (const sh of list) {
        const c = sh.latlngs.map(([la, lo]) => [lo, la]);
        if (sh.kind === "poly") c.push(c[0]);
        tf.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: c } });
      }
    }
    geo("task").setData({ type: "FeatureCollection", features: tf });
    geo("airspace").setData({
      type: "FeatureCollection",
      features: spaces.map((a) => ({
        type: "Feature",
        properties: { color: (CATEGORIES[a.cat] || CATEGORIES.OTHER).color },
        geometry: { type: "LineString", coordinates: [...a.points, a.points[0]].map(([la, lo]) => [lo, la]) },
      })),
    });
  }

  map.on("load", () => {
    map.addSource("shadow", { type: "geojson", data: empty });
    map.addSource("task", { type: "geojson", data: empty });
    map.addSource("airspace", { type: "geojson", data: empty });
    map.addLayer({ id: "airspace", type: "line", source: "airspace", paint: { "line-color": ["get", "color"], "line-width": 2, "line-opacity": 0.85 } });
    map.addLayer({ id: "task", type: "line", source: "task", paint: { "line-color": "#a1189f", "line-width": 3 } });
    map.addLayer({ id: "shadow", type: "line", source: "shadow", paint: { "line-color": "#000", "line-width": 2, "line-opacity": 0.35 } });
    map.addLayer(layer);
    trackGeometry();
    setGround();
    applyVisibility();
    // Quellenangabe zugeklappt (ⓘ), sonst verdeckt sie am Handy das Bild
    container.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
  });

  // ---- Bewegung: weich zum neuesten Wert, Kamera hinter dem Flugzeug ----
  let last = performance.now(), raf = 0;
  const angDiff = (a, b) => ((a - b) % 360 + 540) % 360 - 180;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.2, (now - last) / 1000);
    last = now;
    if (!target) return;
    if (!cur) cur = { ...target };
    const k = Math.min(1, dt * 5);
    // große Sprünge (Zeitachse) nicht animieren
    const jump = Math.abs(target.lat - cur.lat) + Math.abs(target.lon - cur.lon) > 0.05;
    for (const key of ["lat", "lon", "alt", "speed", "vario"]) cur[key] = jump ? target[key] : cur[key] + ((target[key] ?? 0) - (cur[key] ?? 0)) * k;
    cur.track = jump ? target.track : (cur.track + angDiff(target.track, cur.track) * k + 360) % 360;
    if (follow) {
      // Flugzeug im unteren Drittel, darüber Gelände und Horizont
      map.jumpTo({
        center: [cur.lon, cur.lat], elevation: cur.alt, bearing: cur.track + bearingOffset, pitch: viewPitch,
        padding: { top: container.clientHeight * 0.3, bottom: 0, left: 0, right: 0 },
      });
    }
  }
  raf = requestAnimationFrame(frame);

  return {
    update(p) {
      if (!p) return;
      const track = p.track ?? target?.track ?? 0;
      // Querneigung aus der Kurvenrate: tan(Neigung) = v · ω / g
      if (prevTrack != null && p.time != null && prevTime != null && p.time > prevTime) {
        const w = (angDiff(track, prevTrack) * Math.PI) / 180 / ((p.time - prevTime) / 1000);
        const v = (p.speedKmh || 0) / 3.6;
        const b = Math.max(-60, Math.min(60, (Math.atan((v * w) / 9.81) * 180) / Math.PI));
        bank += (b - bank) * 0.5;
      }
      prevTrack = track; prevTime = p.time;
      target = { lat: p.lat, lon: p.lon, alt: p.alt ?? 0, track, speed: p.speedKmh || 0, vario: p.vario || 0 };
      if (!cur) map.jumpTo({ center: [p.lon, p.lat], elevation: target.alt, zoom: 15, bearing: track, pitch: viewPitch });
    },
    setFlight(f, altOffset = 0) {
      flight = f ? { ...f, altOffset } : null;
      if (scene) setGlider(f?.cid || "PV");
      trackGeometry(); setGround();
    },
    setTask(t) { task = t; setGround(); },
    setAirspaces(a) { spaces = a || []; setGround(); },
    setImagery(key) {
      const src = IMAGERY[key] || IMAGERY.sat;
      if (!map.getSource("img")) return;
      map.removeLayer("img"); map.removeSource("img");
      map.addSource("img", { type: "raster", tileSize: 256, ...src });
      map.addLayer({ id: "img", type: "raster", source: "img" }, map.getLayer("airspace") ? "airspace" : undefined);
    },
    setLayerVisible(name, on) {
      vis[name] = on;
      applyVisibility();
    },
    shown() { map.resize(); },
    destroy() { cancelAnimationFrame(raf); map.remove(); },
  };
}
