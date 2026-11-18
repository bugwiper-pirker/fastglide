// Offline-Cache. Bei jeder Änderung an der App VERSION erhöhen,
// damit die Handys die neue Version laden.
const VERSION = "travelspeed-v4";
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
  "js/climb.js",
  "js/audio.js",
  "js/waypoints.js",
  "js/finalglide.js",
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
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request))
  );
});
