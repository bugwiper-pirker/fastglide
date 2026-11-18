// Datenquellen. Jede Quelle ruft onData({ speedKmh, altitude, accuracy, time }) auf.

// Anfangskurs von a nach b in Grad (0 = Nord, 90 = Ost)
export function bearingDeg(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const p1 = toRad(lat1), p2 = toRad(lat2), dl = toRad(lon2 - lon1);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

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
  let trackRef = null; // letzte Position für selbst berechneten Kurs
  const id = navigator.geolocation.watchPosition(
    (pos) => {
      const c = pos.coords;
      let speed = c.speed; // m/s, kann null sein
      if ((speed == null || Number.isNaN(speed)) && prev) {
        const dt = (pos.timestamp - prev.timestamp) / 1000;
        if (dt > 0.2) speed = haversine(prev.coords, c) / dt;
      }
      prev = pos;
      // Kurs über Grund: vom GPS, sonst aus der Bewegung (ab 15 m Strecke)
      let track = c.heading;
      if (track == null || Number.isNaN(track)) {
        track = null;
        if (trackRef && haversine(trackRef.coords, c) > 15) {
          track = bearingDeg(trackRef.coords.latitude, trackRef.coords.longitude, c.latitude, c.longitude);
        }
      }
      if (!trackRef || haversine(trackRef.coords, c) > 15) trackRef = pos;
      onData({
        track,
        speedKmh: speed == null || Number.isNaN(speed) ? null : speed * 3.6,
        altitude: c.altitude, // m, kann null sein
        lat: c.latitude,
        lon: c.longitude,
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
// Abwechselnd Kreisen in der Thermik (langsam, steigend, Linkskreis 25 s)
// und Vorflug (schnell, sinkend, Richtung Osten).
export function startSimulation(onData) {
  // Startpunkt: etwa 25 km westlich von Wiener Neustadt (LOXN), Flug Richtung Osten
  let t = 0, alt = 1640, lat = 47.84, lon = 15.88, track = 90;
  const id = setInterval(() => {
    t += 1;
    const climbing = t % 60 < 35;
    const speed = climbing
      ? 95 + 8 * Math.sin(t * 0.6) + Math.random() * 3
      : 165 + 10 * Math.sin(t * 0.2) + Math.random() * 4;
    alt += climbing ? 1.8 + 1.2 * Math.sin(t * 0.35) : -1.1;
    track = climbing ? (track - 360 / 25 + 360) % 360 : 90 + 8 * Math.sin(t * 0.3);
    const km = speed / 3600, rad = (track * Math.PI) / 180;
    lat += (km * Math.cos(rad)) / 111.32;
    lon += (km * Math.sin(rad)) / (111.32 * Math.cos((lat * Math.PI) / 180));
    // GPS-Höhe rauscht: ein paar Meter Zufall dazu
    onData({ speedKmh: speed, altitude: alt + (Math.random() - 0.5) * 3, lat, lon, track, accuracy: 5, time: Date.now() });
  }, 1000);
  return () => clearInterval(id);
}
