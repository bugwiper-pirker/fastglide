// Datenquellen. Jede Quelle ruft onData({ speedKmh, altitude, accuracy, time }) auf.

// ---- GPS des Handys ----
function haversine(a, b) {
  const R = 6371000, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude), dLon = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function startGps(onData, onError) {
  if (!("geolocation" in navigator)) {
    onError("Dieses Gerät bietet kein GPS im Browser.");
    return () => {};
  }
  let prev = null;
  const id = navigator.geolocation.watchPosition(
    (pos) => {
      const c = pos.coords;
      let speed = c.speed; // m/s, kann null sein
      if ((speed == null || Number.isNaN(speed)) && prev) {
        const dt = (pos.timestamp - prev.timestamp) / 1000;
        if (dt > 0.2) speed = haversine(prev.coords, c) / dt;
      }
      prev = pos;
      onData({
        speedKmh: speed == null || Number.isNaN(speed) ? null : speed * 3.6,
        altitude: c.altitude, // m, kann null sein
        accuracy: c.accuracy,
        altitudeAccuracy: c.altitudeAccuracy,
        time: pos.timestamp,
      });
    },
    (err) => {
      const msg = {
        1: "GPS-Zugriff verweigert. Bitte in den Browser-Einstellungen erlauben.",
        2: "Keine GPS-Position verfügbar.",
        3: "GPS antwortet nicht (Zeitüberschreitung).",
      }[err.code] || err.message;
      onError(msg, err.code);
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
  );
  return () => navigator.geolocation.clearWatch(id);
}

// ---- Simulation zum Testen am Boden ----
// Abwechselnd Kreisen in der Thermik (langsam, steigend) und Vorflug (schnell, sinkend).
export function startSimulation(onData) {
  let t = 0, alt = 1640;
  const id = setInterval(() => {
    t += 1;
    const climbing = t % 60 < 35;
    const speed = climbing
      ? 95 + 8 * Math.sin(t * 0.6) + Math.random() * 3
      : 165 + 10 * Math.sin(t * 0.2) + Math.random() * 4;
    alt += climbing ? 1.8 : -1.1;
    onData({ speedKmh: speed, altitude: alt, accuracy: 5, time: Date.now() });
  }, 1000);
  return () => clearInterval(id);
}
