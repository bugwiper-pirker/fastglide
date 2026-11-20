// Offline-Cache. Bei jeder Änderung an der App VERSION erhöhen,
// damit die Handys die neue Version laden.
const VERSION = "fastglide-v34";
const FILES = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/style.css",
  "js/app.js",
  "js/config.js",
  "js/sources.js",
  "js/instruments/svg.js",
  "js/instruments/airspeed.js",
  "js/instruments/altimeter.js",
  "js/instruments/vario.js",
  "js/cockpit.js",
  "js/climb.js",
  "js/audio.js",
  "js/waypoints.js",
  "js/finalglide.js",
  "js/map.js",
  "js/airspace.js",
  "js/task.js",
  "js/igc.js",
  "js/replay.js",
  "js/map3d.js",
  "js/polar.js",
  "js/polars-xcsoar.js",
  "js/flight.js",
  "js/taskspeed.js",
  "data/2021_LOXN_Alle.cup",
  "data/austria_acg_airspaces_20261126.txt",
  "data/beispielflug_2025-07-06.igc",
  "vendor/leaflet/leaflet.js",
  "vendor/leaflet/leaflet.css",
  "fonts/B612-Regular.woff2",
  "fonts/B612-Bold.woff2",
  "fonts/B612Mono-Bold.woff2",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== TILE_CACHE && k !== SHARE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Kartenkacheln: beim Ansehen speichern, damit sie später ohne Empfang da sind.
// Kein Vorab-Download ganzer Gebiete (Nutzungsbedingungen der Kartenserver).
// Name aus der Zeit als „GlideWise“ beibehalten, damit gespeicherte Kacheln erhalten bleiben
const TILE_CACHE = "glidewise-tiles";
const TILE_MAX = 2000;
const isTile = (url) => /(^|\.)tile\.(openstreetmap|opentopomap)\.org$/.test(url.hostname);

async function tileResponse(req) {
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok || res.type === "opaque") {
      await cache.put(req, res.clone());
      const keys = await cache.keys();
      if (keys.length > TILE_MAX) {
        for (const k of keys.slice(0, keys.length - TILE_MAX)) await cache.delete(k);
      }
    }
    return res;
  } catch {
    return new Response("", { status: 504 });
  }
}

// „Teilen → FastGlide“: geteilte Datei ablegen und die App öffnen
const SHARE_CACHE = "glidewise-share"; // alter Name, siehe TILE_CACHE
async function receiveShare(req) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    const cache = await caches.open(SHARE_CACHE);
    if (file && file.size) {
      await cache.put("shared-file", new Response(file, { headers: { "X-Name": encodeURIComponent(file.name || "datei") } }));
    } else {
      // Geteilter Link (z. B. Soaring-Spot-Aufgabe aus Chrome): steht in "url" oder im Text
      const link = /https?:\/\/\S+/.exec(`${form.get("url") || ""} ${form.get("text") || ""}`);
      if (link) await cache.put("shared-url", new Response(link[0]));
    }
  } catch {}
  return Response.redirect("./?share=1", 303);
}

self.addEventListener("fetch", (e) => {
  if (e.request.method === "POST" && new URL(e.request.url).pathname.endsWith("/share-target")) {
    e.respondWith(receiveShare(e.request));
    return;
  }
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (isTile(url)) { e.respondWith(tileResponse(e.request)); return; }
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request))
  );
});
