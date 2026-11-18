# TravelSpeed

PWA fürs Android-Handy im Segelflugzeug. Zeigt Fahrt, Steigen und Höhe analog und digital an. Die Werte kommen vom GPS des Handys.

**Wichtig:** Die Fahrt ist die GPS-Geschwindigkeit über Grund (GS), nicht die angezeigte Fahrt (IAS). Bei Gegenwind ist sie kleiner, bei Rückenwind größer als am Fahrtmesser. TravelSpeed ersetzt keine zugelassenen Instrumente.

## Funktionen

- Fahrtmesser 0–285 km/h mit den Markierungen des Arcus M (Flughandbuch 2.3): weißer Bogen 88–180, grüner Bogen 96–180, gelber Bogen 180–280, roter Strich 280, blauer Strich 95 (VY), gelbes Dreieck 105.
- Variometer −5 bis +5 m/s. Null liegt links, Steigen geht nach oben (grün), Sinken nach unten (rot). Darunter steht der Mittelwert der letzten 20 s. Das Steigen wird per linearer Regression aus der GPS-Höhe berechnet. Die Dämpfung lässt sich in den Einstellungen auf 2, 4, 6 oder 8 s stellen. Weil die GPS-Höhe nur einmal pro Sekunde kommt und rauscht, reagiert das Vario träger als ein echtes, druckbasiertes Variometer.
- Höhenmesser 0–10 000 m. Der große Zeiger zeigt 100 m, der kleine 1000 m.
- Höhenkorrektur: Am Boden die Platzhöhe eingeben und „Kalibrieren“ tippen. Viele Handys liefern die Höhe über dem Ellipsoid, das sind in Österreich etwa 45–50 m mehr als über Meer.
- Der Bildschirm bleibt an.
- Läuft nach dem ersten Laden auch ohne Internet.
- Tagmodus für Sonnenlicht und eine Vollbild-Taste.
- Simulation zum Testen am Boden (in den Einstellungen).
- Fehlen GPS-Daten länger als 5 Sekunden, werden die Zeiger ausgeblendet und die Zahlen rot.

## Veröffentlichen mit GitHub Pages

1. Im Repository auf **Settings → Pages** gehen.
2. Unter „Build and deployment“ als Quelle **Deploy from a branch** wählen, dann den Branch `main` und den Ordner `/ (root)`.
3. Nach ein bis zwei Minuten ist die App unter `https://bugwiper-pirker.github.io/travelspeed/` erreichbar.

## Am Handy installieren

1. Die Adresse in **Chrome** öffnen.
2. Den Standortzugriff erlauben.
3. Im Menü (⋮) **App installieren** oder **Zum Startbildschirm hinzufügen** wählen.

Tipp: Unter Android in den App-Einstellungen von Chrome den Standort auf „Genau“ stellen. Für den Flug sollte der Akku-Sparmodus aus sein.

## Aufbau

```
index.html                  Bildschirm und Einstellungsdialog
css/style.css               Farben (Nacht/Tag) und Layout
js/config.js                Flugzeugdaten (Geschwindigkeiten aus dem Flughandbuch)
js/sources.js               Datenquellen: GPS und Simulation
js/climb.js                 Steigen/Sinken aus der GPS-Höhe
js/app.js                   Ablauf, Einstellungen, Bildschirm-an
js/instruments/svg.js       Zeichenhilfen für Rundinstrumente
js/instruments/airspeed.js  Fahrtmesser
js/instruments/altimeter.js Höhenmesser
js/instruments/vario.js     Variometer
sw.js                       Offline-Cache
```

So kommt ein neues Instrument dazu:

1. Eine Datei in `js/instruments/` anlegen.
2. Das Instrument in `js/app.js` in die Liste `instruments` eintragen.
3. Ein `<svg>` in `index.html` hinzufügen.
4. Die neue Datei in `sw.js` eintragen und `VERSION` erhöhen.

## Lizenzen

Die Schrift ist B612 von Airbus, lizenziert unter der SIL Open Font License 1.1.
