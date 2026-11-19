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
  const P = new Float32Array(buf, 12, n * 3);
  const I = new Uint16Array(buf, 12 + n * 12, (nBody + nCanopy) * 3);
  return creasedGeometry(THREE, P, I, 35);
}

// Normalen mit Knickwinkel: Flächen, die stärker als crease° abknicken (Endleisten, Leitwerk,
// Winglets), bekommen eine scharfe Kante, gewölbte Flächen (Rumpf, Profil) bleiben glatt.
function creasedGeometry(THREE, P, I, crease) {
  const nTri = I.length / 3;
  const fn = new Float32Array(nTri * 3);
  const byVertex = new Map();
  for (let t = 0; t < nTri; t++) {
    const [a, b, c] = [I[t * 3], I[t * 3 + 1], I[t * 3 + 2]];
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    // nicht normiert gewichtet nach Fläche, für den Winkelvergleich normiert
    fn[t * 3] = nx / l; fn[t * 3 + 1] = ny / l; fn[t * 3 + 2] = nz / l;
    for (const v of [a, b, c]) { let list = byVertex.get(v); if (!list) byVertex.set(v, (list = [])); list.push(t); }
  }
  const cos = Math.cos((crease * Math.PI) / 180);
  const pos = new Float32Array(nTri * 9), nor = new Float32Array(nTri * 9);
  for (let t = 0; t < nTri; t++) {
    for (let k = 0; k < 3; k++) {
      const v = I[t * 3 + k];
      let nx = 0, ny = 0, nz = 0;
      for (const o of byVertex.get(v)) {
        const d = fn[t * 3] * fn[o * 3] + fn[t * 3 + 1] * fn[o * 3 + 1] + fn[t * 3 + 2] * fn[o * 3 + 2];
        if (d >= cos) { nx += fn[o * 3]; ny += fn[o * 3 + 1]; nz += fn[o * 3 + 2]; }
      }
      const l = Math.hypot(nx, ny, nz) || 1;
      const j = t * 9 + k * 3;
      pos[j] = P[v * 3]; pos[j + 1] = P[v * 3 + 1]; pos[j + 2] = P[v * 3 + 2];
      nor[j] = nx / l; nor[j + 1] = ny / l; nor[j + 2] = nz / l;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  return geo;
}

// Haube: wird nicht aus Dreiecken bestimmt (das ergibt einen gezackten Rand), sondern je Bildpunkt
// aus ihrem Umriss laut Foto. Modellachsen: y nach vorne (Nase bei +2,88 m), z nach oben.
// Von der Seite: lange Verglasung bis etwa halbe Rumpfhöhe, Unterkante fast waagrecht (z −0,02 hinten,
// +0,04 vorne). Vorne endet sie gut 0,7 m hinter der Nase mit schräger Vorderkante (oben weiter vorne),
// hinten knapp vor dem Flügel, unten leicht abgerundet.
function canopyMaterial(THREE) {
  const mat = new THREE.MeshPhongMaterial({ color: 0xf6f7f8, specular: 0x333333, shininess: 30, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vModel;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvModel = position;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
varying vec3 vModel;
float canopyMask(vec3 p) {
  if (abs(p.x) > 0.36 || p.y < -0.1 || p.y > 2.4) return 0.0;
  float t = clamp(p.y / 2.15, 0.0, 1.0);
  float zLow = -0.02 + 0.06 * t;
  float aa = fwidth(p.z) * 1.2 + 1e-4, ab = fwidth(p.y) * 1.2 + 1e-4;
  float h = max(p.z - zLow, 0.0);
  float side = smoothstep(zLow - aa, zLow + aa, p.z);
  // Vorderkante schräg: oben weiter vorne
  float yF = 2.05 + 0.55 * h;
  float front = 1.0 - smoothstep(yF - ab, yF + ab, p.y);
  // Hinterkante fast senkrecht, unten leicht abgerundet
  float yR = 0.05 + 0.12 * (1.0 - clamp(h / 0.15, 0.0, 1.0));
  float back = smoothstep(yR - ab, yR + ab, p.y);
  return side * front * back;
}`)
      .replace("#include <color_fragment>", `#include <color_fragment>
float cm = canopyMask(vModel);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.07, 0.42, 0.66), cm);`)
      .replace("#include <lights_fragment_begin>", `material.specularStrength = mix(0.25, 1.0, cm);
material.specularShininess = mix(30.0, 90.0, cm);
#include <lights_fragment_begin>`);
  };
  return mat;
}

// Wettbewerbskennzeichen auf beiden Seiten des Seitenleitwerks
function addLabel(THREE, g, label, x, y, z) {
  if (!label) return;
  // hoch aufgelöst und mit Mipmaps, damit es auch nah scharf ist; leicht vor der Fläche und mit
  // Polygon-Versatz, damit es nicht mit dem Seitenleitwerk um die Tiefe kämpft (Flackern)
  const cv = document.createElement("canvas");
  cv.width = 1024; cv.height = 512;
  const c = cv.getContext("2d");
  c.fillStyle = "#16181b"; c.font = "600 384px 'Helvetica Neue', Arial, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
  c.fillText(label, 512, 280);
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8,
  });
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
    g.add(new THREE.Mesh(model, canopyMaterial(THREE)));
    addLabel(THREE, g, label, 0.075, -5.3, 0.72);
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
    // Kantenglättung, sonst wirkt das Flugzeug von nah ausgefranst
    canvasContextAttributes: { antialias: true },
    // Kamera steuert dieses Modul selbst: sie kreist immer um das Flugzeug
    interactive: false,
  });

  // ---- Zustand ----
  let target = null;            // letzte Position vom GPS / aus dem Flug
  let cur = null;               // geglättet für die Darstellung
  let bank = 0, prevTrack = null, prevTime = null;
  // Ruhige Kamera beim Kreisen: Blick bleibt in der weiteren Flugrichtung, Mitte ist die Bartmitte
  let circling = false, holdBearing = null, ahead = null;
  let recent = [];                 // letzte Positionen (Zeit, Ort, Kurs)
  let thermalC = null;             // geglättete Bartmitte
  let blend = 0;                   // 0 = dem Flugzeug folgen, 1 = Bartmitte
  let view = null;                 // { bearing } der Kamera
  let zoomOut = 0;                 // beim Kreisen weiter weg (Zoomstufen)
  // Kamera um das Flugzeug: Drehung gegenüber „von hinten“, Neigung, Zoom
  const PITCH = 78, ZOOM = 16;
  let bearingOffset = 0, viewPitch = PITCH, zoom = ZOOM;
  let flight = null, task = null, spaces = [];
  const vis = { airspace: true, task: true };
  function applyVisibility() {
    if (asGroup) asGroup.visible = vis.airspace;
    if (!map.getLayer("airspace")) return;
    map.setLayoutProperty("airspace", "visibility", vis.airspace ? "visible" : "none");
    map.setLayoutProperty("task", "visibility", vis.task ? "visible" : "none");
  }

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  function viewChanged() {
    const off = ((bearingOffset % 360) + 540) % 360 - 180; // −180 … 180
    followBtn.hidden = Math.abs(off) < 1 && Math.abs(viewPitch - PITCH) < 1 && Math.abs(zoom - ZOOM) < 0.05;
  }
  followBtn.title = "Ansicht zurücksetzen (von hinten)";
  followBtn.addEventListener("click", () => { bearingOffset = 0; viewPitch = PITCH; zoom = ZOOM; viewChanged(); });

  // Ziehen: um das Flugzeug drehen (waagrecht) und neigen (senkrecht).
  // Zwei Finger: zoomen und drehen. Mausrad und +/−: zoomen.
  const el = map.getCanvasContainer();
  el.style.touchAction = "none";
  const ptrs = new Map();
  let pinch = null;
  const two = () => { const [a, b] = [...ptrs.values()]; return { d: Math.hypot(b.x - a.x, b.y - a.y), a: Math.atan2(b.y - a.y, b.x - a.x) }; };
  el.addEventListener("pointerdown", (e) => {
    el.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2) { const t = two(); pinch = { ...t, zoom, bearing: bearingOffset }; }
  });
  el.addEventListener("pointermove", (e) => {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (ptrs.size === 1) {
      bearingOffset -= dx * 0.35;
      viewPitch = clamp(viewPitch - dy * 0.25, 0, 85);
    } else if (pinch && ptrs.size === 2) {
      const t = two();
      zoom = clamp(pinch.zoom + Math.log2(t.d / pinch.d), 9, 19);
      bearingOffset = pinch.bearing - ((t.a - pinch.a) * 180) / Math.PI;
    }
    viewChanged();
  });
  const up = (e) => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; };
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  el.addEventListener("wheel", (e) => { e.preventDefault(); zoom = clamp(zoom - e.deltaY * 0.002, 9, 19); viewChanged(); }, { passive: false });
  el.addEventListener("dblclick", () => { zoom = clamp(zoom + 1, 9, 19); viewChanged(); });
  const ctrl = document.createElement("div");
  ctrl.className = "m3-ctrl";
  for (const [txt, d, label] of [["+", 1, "Hineinzoomen"], ["−", -1, "Hinauszoomen"]]) {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = txt; b.setAttribute("aria-label", label);
    b.addEventListener("click", () => { zoom = clamp(zoom + d, 9, 19); viewChanged(); });
    ctrl.appendChild(b);
  }
  container.appendChild(ctrl);

  // ---- three.js-Ebene ----
  // Flugzeug in eigener Szene: Ort und Maßstab stecken in der (in doppelter Genauigkeit gerechneten)
  // Projektion, das Modell selbst bleibt in Metern. Sonst runden die Mercator-Koordinaten im
  // Grafikchip auf etwa 1 m, und das Flugzeug wird zackig und streifig.
  let renderer, scene, gliderScene, camera, glider, trackLine = null;
  function setGlider(label) {
    if (glider) gliderScene.remove(glider);
    glider = buildGlider(THREE, label, model);
    glider.matrixAutoUpdate = false;
    glider.visible = false;
    gliderScene.add(glider);
  }
  const layer = {
    id: "glider3d",
    type: "custom",
    renderingMode: "3d",
    onAdd(m, gl) {
      camera = new THREE.Camera();
      scene = new THREE.Scene();
      gliderScene = new THREE.Scene();
      gliderScene.add(new THREE.AmbientLight(0xffffff, 1.6));
      const sun = new THREE.DirectionalLight(0xffffff, 2.2);
      sun.position.set(0.4, 0.6, 1).normalize();
      gliderScene.add(sun);
      setGlider(flight?.cid || "PV");
      renderer = new THREE.WebGLRenderer({ canvas: m.getCanvas(), context: gl, antialias: true });
      renderer.autoClear = false;
    },
    render(gl, args) {
      const proj = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix);
      let gliderProj = null;
      if (cur) {
        const mc = ml.MercatorCoordinate.fromLngLat([cur.lon, cur.lat], cur.alt);
        const unit = mc.meterInMercatorCoordinateUnits();
        // Größe wie im Flugsimulator: in der Grundansicht etwa ein Drittel der Kartenbreite.
        // Zoomen ändert die Bildgröße nur halb so stark wie die Landschaft (auch beim Kreisen),
        // mindestens 50 Pixel, höchstens 80 % der Breite, damit die Kamera nie ins Flugzeug gerät.
        // Ist das echte Flugzeug (20 m) größer, wird es in echter Größe gezeichnet.
        const mpp = (z) => (40075016.7 * Math.cos((cur.lat * Math.PI) / 180)) / (512 * 2 ** z);
        const want = Math.min(300, Math.max(130, container.clientWidth * 0.33));
        const z = map.getZoom();
        const px = clamp(want * 2 ** ((z - ZOOM) * 0.5), 50, container.clientWidth * 0.8);
        const s = Math.max(1, (px * mpp(z)) / 20);
        const rad = (d) => (d * Math.PI) / 180;
        // Ort und Maßstab (Meter → Mercator, Norden nach oben) in die Projektion
        const place = new THREE.Matrix4().makeTranslation(mc.x, mc.y, mc.z)
          .scale(new THREE.Vector3(unit * s, -unit * s, unit * s));
        // Lage des Flugzeugs: Kurs, Querneigung, Längsneigung (in Metern, x Osten, y Norden, z oben)
        glider.matrix.copy(new THREE.Matrix4().makeRotationZ(-rad(cur.track))
          .multiply(new THREE.Matrix4().makeRotationY(rad(bank)))
          .multiply(new THREE.Matrix4().makeRotationX(Math.atan2(cur.vario || 0, Math.max(10, cur.speed / 3.6)))));
        glider.matrixWorldNeedsUpdate = true;
        glider.visible = true;
        gliderProj = proj.clone().multiply(place);
      }
      camera.projectionMatrix = proj;
      renderer.resetState();
      renderer.render(scene, camera);
      if (gliderProj) {
        camera.projectionMatrix = gliderProj;
        renderer.render(gliderScene, camera);
      }
      map.triggerRepaint();
    },
  };

  // Lufträume als halbtransparente Wände von der Unter- bis zur Obergrenze, Ränder als Linien
  let asGroup = null;
  function airspaceGeometry() {
    if (asGroup) { scene.remove(asGroup); asGroup.traverse((o) => o.geometry?.dispose()); asGroup = null; }
    if (!scene || !spaces.length) return;
    const wall = [], wallCol = [], edge = [], edgeCol = [];
    const merc = (lat, lon, alt) => { const m = ml.MercatorCoordinate.fromLngLat([lon, lat], alt); return [m.x, m.y, m.z]; };
    for (const a of spaces) {
      // GND und AGL ohne Geländedaten: ab knapp unter Meereshöhe bzw. wie MSL; offen nach oben: bis 10 000 m
      const lo = a.lower.ref === "GND" ? -200 : a.lower.m;
      const hi = Number.isFinite(a.upper.m) ? a.upper.m : 10000;
      if (!(hi > lo)) continue;
      const c = new THREE.Color((CATEGORIES[a.cat] || CATEGORIES.OTHER).color);
      const step = Math.max(1, Math.floor(a.points.length / 240));
      const ring = a.points.filter((_, i) => i % step === 0);
      ring.push(ring[0]);
      for (let i = 0; i < ring.length - 1; i++) {
        const [la1, lo1] = ring[i], [la2, lo2] = ring[i + 1];
        const p1 = merc(la1, lo1, lo), p2 = merc(la2, lo2, lo), q1 = merc(la1, lo1, hi), q2 = merc(la2, lo2, hi);
        wall.push(...p1, ...p2, ...q2, ...p1, ...q2, ...q1);
        for (let k = 0; k < 6; k++) wallCol.push(c.r, c.g, c.b);
        edge.push(...q1, ...q2, ...p1, ...p2);
        for (let k = 0; k < 4; k++) edgeCol.push(c.r, c.g, c.b);
      }
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute("position", new THREE.Float32BufferAttribute(wall, 3));
    wg.setAttribute("color", new THREE.Float32BufferAttribute(wallCol, 3));
    const walls = new THREE.Mesh(wg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
    const eg = new THREE.BufferGeometry();
    eg.setAttribute("position", new THREE.Float32BufferAttribute(edge, 3));
    eg.setAttribute("color", new THREE.Float32BufferAttribute(edgeCol, 3));
    const edges = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8 }));
    for (const o of [walls, edges]) { o.frustumCulled = false; o.renderOrder = 2; }
    asGroup = new THREE.Group();
    asGroup.add(walls, edges);
    asGroup.visible = vis.airspace;
    scene.add(asGroup);
  }

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
    map.addLayer({ id: "airspace", type: "line", source: "airspace", paint: { "line-color": ["get", "color"], "line-width": 1.5, "line-opacity": 0.5 } });
    map.addLayer({ id: "task", type: "line", source: "task", paint: { "line-color": "#a1189f", "line-width": 3 } });
    map.addLayer({ id: "shadow", type: "line", source: "shadow", paint: { "line-color": "#000", "line-width": 2, "line-opacity": 0.35 } });
    map.addLayer(layer);
    airspaceGeometry();
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

    // Kamera: geradeaus hinter dem Flugzeug (gedämpft), beim Kreisen fest in die weitere Richtung
    // und auf die Bartmitte, das Flugzeug kreist dann im Bild
    blend = jump ? (circling ? 1 : 0) : clamp(blend + (circling && thermalC ? dt : -dt) / 2.5, 0, 1);
    const wantBearing = circling && holdBearing != null ? holdBearing : cur.track;
    if (!view || jump) view = { bearing: wantBearing };
    else view.bearing = (view.bearing + angDiff(wantBearing, view.bearing) * Math.min(1, dt * (circling ? 0.8 : 1.5)) + 360) % 360;
    const ease = blend * blend * (3 - 2 * blend);
    // schmale Bildschirme (Handy hochkant) brauchen mehr Abstand, damit der Kreis seitlich Platz hat
    zoomOut = (container.clientWidth < container.clientHeight * 1.2 ? 1.7 : 1.2) * ease;
    const cLat = thermalC ? cur.lat + (thermalC.lat - cur.lat) * ease : cur.lat;
    const cLon = thermalC ? cur.lon + (thermalC.lon - cur.lon) * ease : cur.lon;
    // Flugzeug im unteren Drittel, darüber Gelände und Horizont
    map.jumpTo({
      // beim Kreisen etwas weiter weg, damit der ganze Kreis ins Bild passt
      center: [cLon, cLat], elevation: cur.alt, zoom: zoom - zoomOut, bearing: view.bearing + bearingOffset, pitch: viewPitch,
      padding: { top: container.clientHeight * 0.3 * (viewPitch / 85), bottom: 0, left: 0, right: 0 },
    });
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

      // Verlauf für Bartmitte und Kurs vor dem Kreisen; nach einem Sprung neu
      const t = p.time ?? Date.now();
      if (recent.length && (t < recent.at(-1).t || t - recent.at(-1).t > 120000)) { recent = []; thermalC = null; }
      recent.push({ t, lat: p.lat, lon: p.lon, track });
      while (recent.length && recent[0].t < t - 90000) recent.shift();
      ahead = p.aheadBearing ?? null;
      if (p.circling && !circling) {
        // Kurs vor dem Kreisen (Erkennung braucht etwa 15 s), sonst Richtung zur nächsten Wende
        const before = recent.find((x) => x.t >= t - 25000) || recent[0];
        holdBearing = ahead ?? before.track;
      }
      if (p.circling && ahead != null && holdBearing != null) holdBearing = (holdBearing + angDiff(ahead, holdBearing) * 0.05 + 360) % 360;
      circling = !!p.circling;
      if (circling) {
        // Bartmitte: Mittel der Positionen der letzten 30 s (etwa ein Kreis)
        const pts = recent.filter((x) => x.t >= t - 30000);
        const c = { lat: pts.reduce((a, x) => a + x.lat, 0) / pts.length, lon: pts.reduce((a, x) => a + x.lon, 0) / pts.length };
        thermalC = thermalC ? { lat: thermalC.lat + (c.lat - thermalC.lat) * 0.15, lon: thermalC.lon + (c.lon - thermalC.lon) * 0.15 } : c;
      } else if (blend <= 0) thermalC = null;
      if (!cur) map.jumpTo({ center: [p.lon, p.lat], elevation: target.alt, zoom, bearing: track, pitch: viewPitch });
    },
    setFlight(f, altOffset = 0) {
      flight = f ? { ...f, altOffset } : null;
      if (scene) setGlider(f?.cid || "PV");
      trackGeometry(); setGround();
    },
    setTask(t) { task = t; setGround(); },
    setAirspaces(a) { spaces = a || []; airspaceGeometry(); setGround(); },
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
