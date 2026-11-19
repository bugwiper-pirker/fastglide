# GlideWise

PWA fürs Android-Handy im Segelflugzeug. Zeigt Fahrt, Höhe und Steigen analog und digital an (in dieser Reihenfolge). Die Werte kommen vom GPS des Handys.

**Wichtig:** Die Fahrt ist die GPS-Geschwindigkeit über Grund (GS), nicht die angezeigte Fahrt (IAS). Bei Gegenwind ist sie kleiner, bei Rückenwind größer als am Fahrtmesser. GlideWise ersetzt keine zugelassenen Instrumente.

## Funktionen

- Fahrtmesser 0–285 km/h mit den Markierungen des Arcus M (Flughandbuch 2.3): weißer Bogen 88–180, grüner Bogen 96–180, gelber Bogen 180–280, roter Strich 280, blauer Strich 95 (VY), gelbes Dreieck 105.
- Variometer −5 bis +5 m/s. Null liegt links, Steigen geht nach oben (grün), Sinken nach unten (rot). Darunter steht der Mittelwert der letzten 20 s. Das Steigen wird per linearer Regression aus der GPS-Höhe berechnet. Die Dämpfung lässt sich in den Einstellungen auf 2, 4, 6 oder 8 s stellen. Weil die GPS-Höhe nur einmal pro Sekunde kommt und rauscht, reagiert das Vario träger als ein echtes, druckbasiertes Variometer.
- Vario-Ton (🔊 oben): Ab +0,2 m/s piept es, je stärker das Steigen, desto höher (650–1550 Hz) und schneller. Optional gibt es einen tiefen Dauerton beim Sinken mit einstellbarer Schwelle. Die Lautstärke ist einstellbar und folgt der Medien-Lautstärke des Handys.
- Standard-Wendepunkte: Die Datei `data/2021_LOXN_Alle.cup` ist in der App enthalten. Sind am Handy noch keine Wendepunkte gespeichert, wird sie beim Start automatisch geladen. Mit ⚙ → „Standard-Wendepunkte laden“ lässt sie sich jederzeit neu laden. Hat man die Wendepunkte bewusst gelöscht, lädt die App sie nicht von selbst wieder. Eine andere Standarddatei trägt man in `js/config.js` (`DEFAULT_WAYPOINTS`) und in `sw.js` ein.
- Endanflug-Box oben: In ⚙ eine Wendepunktdatei im SeeYou-Format laden (`.cup` oder `.cupx`, auch von LX-Geräten). Ein Tippen auf die Box öffnet die Zielauswahl, sortiert nach Entfernung, mit Suche und Filter „Nur Landeplätze“. Angezeigt werden Name und Kürzel des Ziels, die Distanz, die erforderliche Gleitzahl und die Zielhöhe.
  - Erforderliche Gleitzahl = Distanz / (eigene Höhe − Zielhöhe − Sicherheitshöhe). Die Sicherheitshöhe ist einstellbar, Standard 150 m.
  - Farbe: grün bis zur „sicheren Gleitzahl“ (einstellbar, Standard 35), gelb bis zur besten Gleitzahl des Flugzeugs (`js/config.js`, Arcus M: 50), sonst rot. „∞“ heißt unter der Zielhöhe plus Reserve.
  - Richtungspfeil: zeigt die Richtung zum Ziel relativ zum GPS-Kurs über Grund (Pfeil nach oben = geradeaus). Darunter steht, um wie viel Grad nach links (L) oder rechts (R) gedreht werden muss. Ohne Bewegung (unter 15 km/h) ist der Pfeil grau und nach Norden ausgerichtet, darunter steht der Kurs zum Ziel (z. B. 095°).
  - Mindest-Ankunftshöhe: kommt aus der IGC-Datei (siehe unten) oder bei Soaring Spot aus den Aufgabennotizen, z. B. „Ziellinie: min. 570 MSL“, „Zielhöhe mind. 600 m“ oder „Finish: min 2000 ft“. Gesucht wird nach Ziel/Finish/Ankunft zusammen mit „min“ und einer Höhe; Angaben in ft werden umgerechnet.
  - Ist das Ziel einer Aufgabe mit Mindest-Ankunftshöhe gewählt (Tippen auf „Z“ → „Als Ziel wählen“), rechnet der Endanflug auf diese Höhe statt auf Platzhöhe plus Sicherheitshöhe, wenn sie höher liegt. Die Box zeigt sie als Zielhöhe, darunter „Ankunft mind. … m“.
  - Wind, Polare, MacCready und Sinken werden nicht berücksichtigt. Die Rechnung ist rein geometrisch.
  - Die eigene Höhe ist die kalibrierte GPS-Höhe. Vor dem Flug unbedingt kalibrieren.
- Kartenseite (🗺 oben, zurück mit ◎): Karte mit Flugzeugsymbol in Flugrichtung, Kurslinie (15 km voraus) und gestrichelter Linie zum Ziel. Wendepunkte aus der Datei sind eingezeichnet (grün = Landeplatz), Namen ab Zoomstufe 10. Ein Tippen auf einen Wendepunkt zeigt Name und Höhe sowie „Als Ziel wählen“. Die Karte folgt dem Flugzeug, nach dem Verschieben bringt ⌖ sie zurück. Die Endanflug-Box bleibt oben, Fahrt, Höhe und Vario stehen digital unter der Karte, auch im Querformat. Die Kartenseite nutzt die volle Fensterbreite. Kartenstil OpenStreetMap oder OpenTopoMap (Gelände), umschaltbar in ⚙. Angesehene Kartenkacheln werden gespeichert, bis zu 2000 Stück.
- 3D-Ansicht (Knopf „3D“ auf der Karte): Gelände aus Höhendaten mit Luftbild, das Segelflugzeug (3D-Modell des Arcus M aus Fusion 360, `models/arcus.bin`, in echter Größe mit 20 m Spannweite, Wettbewerbskennzeichen am Seitenleitwerk, beim Abspielen aus der IGC-Datei) wird von hinten gezeigt wie im Flugsimulator. Die Kamera fliegt hinter dem Flugzeug mit, die Querneigung ergibt sich aus der Kurvenrate.
  - Die Kamera kreist immer um das Flugzeug: Ziehen (Finger oder Maus) dreht waagrecht um das Flugzeug und neigt die Ansicht senkrecht. Zoomen mit zwei Fingern, Mausrad, Doppeltippen oder +/−. ⌖ setzt die Kamera wieder hinter das Flugzeug.
  - Das Flugzeug ist vergrößert dargestellt (in der Grundansicht etwa ein Drittel der Kartenbreite), damit man es gut sieht. Zoomen macht es größer oder kleiner, mindestens bleibt es 50 Pixel breit.
  - Lufträume als halbtransparente Wände von der Unter- bis zur Obergrenze in der Farbe ihrer Kategorie, dazu ihr Umriss am Boden. GND-Untergrenzen reichen bis unter das Gelände, „unbegrenzt“ endet bei 10 000 m. FL wird wie bei der Warnung mit Standardatmosphäre in Meter umgerechnet, AGL-Grenzen werden ohne Geländehöhe wie MSL gezeichnet. Der Knopf „Luftraum“ blendet sie aus.
  - Beim Abspielen eines Flugs ist die Flugspur in der Luft eingezeichnet, gefärbt nach Steigen (grün) und Sinken (rot), dazu ihr Schatten am Boden. Die Aufgabe liegt als Linie auf dem Gelände und lässt sich mit „Aufgabe“ ausblenden.
  - Anderes Flugzeug: ein binäres STL mit `python3 tools/stl2model.py modell.stl models/arcus.bin --span <Spannweite in m>` umwandeln. Im STL muss x von der Nase nach hinten, y nach oben und z entlang der Spannweite zeigen. Die Haube wird anhand ihrer Lage erkannt und blau gefärbt. Fehlt die Datei, zeigt die App ein einfaches, nachgebautes Modell.
  - Bild in ⚙ → Karte wählbar: Luftbild (Sentinel-2 cloudless, ca. 10 m Auflösung) oder OpenTopoMap.
  - Braucht Internet (Gelände und Bild werden nicht offline gespeichert) und belastet Akku und Grafik stärker als die 2D-Karte. MapLibre und three.js werden erst geladen, wenn man 3D zum ersten Mal einschaltet.
- Lufträume: Mitgeliefert ist `data/austria_acg_airspaces_20261126.txt`, die OpenAir-Datei der Austro Control (gültig ab 26.11.2026). Sie wird automatisch geladen, wenn am Handy keine Luftraumdatei gespeichert ist. Eigene OpenAir-Dateien (.txt) lassen sich in ⚙ laden, SeeYou-CUB (Binärformat) wird nicht unterstützt.
  - Höhenangaben in ft und FL stehen auch in Metern dabei, z. B. „3500 ft MSL (1 067 m)“ oder „FL 95 (2 896 m)“.
  - Karte: Ränder nach Kategorie gefärbt. CTR rot, C dunkelblau, D blau, R rot, P dunkelrot, Q orange gestrichelt, TMZ violett gestrichelt, RMZ grün gestrichelt, TRA türkis gestrichelt. Tippen auf die Karte zeigt alle Lufträume an dieser Stelle mit Name, Untergrenze, Obergrenze, Kategorie und Frequenz.
  - Die Austro-Control-Datei führt RMZ und TMZ als Klasse R und TRAs als Klasse W. Die App ordnet sie deshalb nach dem Namen zu (RMZ, TMZ, TRA, CTR, LOR, LOD, LOP).
  - Warnung (Banner, Ton, Vibration) bei Lufträumen, die für VFR ohne Freigabe nicht erlaubt sind. Standard sind A, B, C, D, CTR, R, P, die Liste ist in ⚙ einstellbar. „Nähert sich“ heißt: seitlich näher als der Warnabstand (Standard 2 km) oder in 60 s laut Kurs drin, und dabei höchstens 150 m über oder unter den Grenzen. „Im Luftraum“ gibt eine rote, pulsierende Warnung und wiederholt den Ton alle 30 s.
  - Tippen auf die Warnung schaltet sie 5 Minuten stumm. „Nicht mehr warnen“ setzt einen Luftraum dauerhaft auf die Ausnahmeliste, z. B. die MATZ am Heimatplatz. Rückgängig geht das in ⚙ oder im Popup auf der Karte.
  - Optional „TRAs als aktiv behandeln“: In einer TRA gibt es keine C/D-Warnung.
  - Inaktive Lufträume aus der Aufgabe: Nennt eine Soaring-Spot-Aufgabe „Inaktive Lufträume“, warnt die App für diese nicht, aber nur am Tag der Aufgabe. Zugeordnet wird über den Namen oder die Kennung vor der Klammer (z. B. „LOD28“). Im Aufgaben-Info-Fenster steht bei jedem Luftraum, ob er in der Luftraumdatei gefunden wurde. Auf der Karte steht im Popup „Laut Aufgabe heute inaktiv“.
  - Grenzen der Prüfung: Verglichen wird mit der GPS-Höhe. FL ist Druckhöhe und kann um 100–300 m abweichen. AGL-Untergrenzen werden ohne Geländedaten ab Meereshöhe gerechnet, AGL-Obergrenzen als unbegrenzt. NOTAMs, MTAs und die Aktivierung von TRAs werden nicht berücksichtigt.
- Kartenebenen: Auf der Karte schalten „Luftraum“ und „Aufgabe“ (oben rechts) die Ebenen ein und aus, ebenso in ⚙ → Kartenebenen. Ausgeblendete Lufträume werden weiter überwacht.
- Aufgaben: SeeYou-/LX9000-Aufgaben (.cup mit „Related Tasks“, auch .cupx, so wie Soaring Spot sie liefert) und XCSoar-Aufgaben (.tsk).
  - Laden über ⚙ → Aufgabe, über einen Link oder per **Teilen → GlideWise** aus dem Browser oder dem Datei-Manager. Die App ist dafür als Teilen-Ziel registriert (Web Share Target), für Dateien und für Links.
  - Soaring Spot: Den Link der Aufgabenseite einfügen oder in Chrome teilen, z. B. `https://www.soaringspot.com/de/aac2026/tasks/offene/task-1-on-2026-06-13`. Ein Link auf die Tagesergebnisse geht auch. Die App liest Punkte, Koordinaten, Höhen und Zonen direkt aus der Seite, die Wendepunktliste wird dafür nicht gebraucht. Das braucht den Proxy (siehe unten).
  - Andere Download-Links gehen nur, wenn der Server den direkten Abruf erlaubt.
  - Beim Teilen erkennt die App den Dateityp selbst: Aufgabe, Wendepunkte (.cup) oder Lufträume (OpenAir .txt).
  - Darstellung: Kurslinie, Start-/Ziellinie, Zylinder und Sektoren (Style 0–4, A1/R1, R2 für Schlüsselloch), nummerierte Punkte (S, 1, 2, …, Z). Tippen auf einen Punkt zeigt Zone und Höhe und bietet „Als Ziel wählen“ für den Endanflug. Der lila Balken unten zeigt Name, Wenden und Strecke.
  - Aufgaben-Info: Ein Tippen auf den lila Balken (oder ⚙ → „Aufgaben-Info anzeigen“) öffnet ein Fenster mit allem, was zur Aufgabe bekannt ist: Punkte mit Schenkellängen und Zonen, Aufgabentyp, Abflugzeit, QNH, Aufgabenversion, inaktive Lufträume und die Aufgabennotizen (Frequenzen, Telefonnummern, Ausklinkhöhe …). Bei Soaring-Spot-Aufgaben kommt das alles von der Aufgabenseite, bei CUP-Dateien nur Mindestzeit und Abflugzeit. „Ganze Aufgabe auf der Karte“ zoomt auf die Aufgabe.
  - Die Strecke ist von Punktmitte zu Punktmitte gerechnet. Bei AAT ist das die nominelle Strecke, die Mindestzeit steht dabei.
  - CUP: Takeoff und Landing im Aufgabenkopf werden übersprungen. ObsZone=0 ist der Start. Wendepunkte werden aus `Point=`-Zeilen, aus dem Wendepunktteil der Datei oder aus der geladenen Wendepunktliste genommen.
- Flug abspielen (IGC): In ⚙ → „Flug abspielen“ eine IGC-Datei laden, oder sie per Teilen → GlideWise öffnen. Der Flug läuft dann statt des GPS als Datenquelle: Instrumente, Vario-Ton, Endanflug, Aufgabe und Luftraumwarnung reagieren wie im echten Flug. Die Karte zeigt die ganze Flugspur und folgt dem Flugzeug.
  - Unten erscheint die Zeitachse mit dem Barogramm. Tippen oder Ziehen springt an die Stelle, ⏪/⏩ springen 1 Minute (bei hoher Geschwindigkeit mehr), die Geschwindigkeit ist von 1× bis 100× wählbar. ✕ beendet das Abspielen und schaltet zurück aufs GPS.
  - Die Wiedergabe beginnt 1 Minute vor dem Abflug. Die Uhrzeit ist Ortszeit laut Logger (Zeitzone aus der Datei, sonst die des Handys).
  - Höhe: die GPS-Höhe aus der Datei, wie beim Handy (ohne GPS-Höhe die Druckhöhe). Liegt ein Landeplatz aus der Wendepunktliste höchstens 3 km vom Abflugort entfernt, wird die Höhe am Boden auf dessen Platzhöhe abgeglichen, wie beim Kalibrieren. Die Höhenkorrektur aus ⚙ gilt beim Abspielen nicht.
  - Das Vario wird wie im Flug aus der Höhe berechnet, auch bei hoher Geschwindigkeit mit allen Punkten der Datei. Nach einem Sprung beginnt die Mittelung neu.
  - Erklärte Aufgabe: Steht im Logger eine Aufgabe (C-Zeilen der IGC-Datei), wird sie fürs Abspielen übernommen, mit Zonen und AAT-Zeit, wenn der Logger sie mitschreibt (LXNAV `LLXVOZ`, SeeYou `LSEEYOU OZ`). Sonst gelten Standardzonen (Startlinie 2 km, Wendezylinder 500 m, Zielkreis 3 km). Eine Erklärung, deren Start der Flug nie auf 30 km nahekommt, wird ignoriert (alte oder allgemeine Erklärungen im Logger). Die Aufgabe wird nicht gespeichert, nach ✕ ist wieder die eigene Aufgabe da.
  - Zielhöhe: Schreibt der Logger beim Ziel eine Höhe mit (LXNAV `Elev=`), ist das die Mindest-Ankunftshöhe (MSL). Darunter ist die Aufgabe zwar beendet, es gibt aber Strafpunkte. Sie steht im Aufgaben-Info-Fenster und bei der Zielzone („Ankunft mind. 785 m“).
  - Der Flug wird nicht gespeichert. Nach einem Neustart der App muss die Datei neu geladen werden.
  - Beispielflug: Ohne eigene Datei startet ⚙ → „Beispielflug abspielen“ den mitgelieferten Flug `data/beispielflug_2025-07-06.igc` (Arcus M D-KRPK, Lesce, 6. Juli 2025). Er ist im Offline-Cache, geht also auch ohne Internet. Ein anderer Beispielflug wird in `js/config.js` (`DEMO_FLIGHT`) und in `sw.js` eingetragen.
- Höhenmesser 0–10 000 m. Der große Zeiger zeigt 100 m, der kleine 1000 m. Unter der Meteranzeige steht die Höhe in Fuß, oben im kleinen Fenster die Flugfläche. Auch die Kartenseite zeigt Fuß und FL.
  - Die Flugfläche ist aus der GPS-Höhe gerechnet (Höhe in ft / 100), ohne QNH und Temperatur. Die echte Flugfläche ist Druckhöhe und kann je nach Wetter um mehrere hundert Fuß abweichen. Für die Einhaltung von Luftraumgrenzen nur als Anhalt verwenden.
- Höhenkorrektur: Am Boden die Platzhöhe eingeben und „Kalibrieren“ tippen. Viele Handys liefern die Höhe über dem Ellipsoid, das sind in Österreich etwa 45–50 m mehr als über Meer.
- Der Bildschirm bleibt an.
- Läuft nach dem ersten Laden auch ohne Internet.
- Tagmodus für Sonnenlicht. Vollbild lässt sich in ⚙ umschalten.
- Simulation zum Testen am Boden (in den Einstellungen).
- Fehlen GPS-Daten länger als 5 Sekunden, werden die Zeiger ausgeblendet und die Zahlen rot.

## Veröffentlichen mit GitHub Pages

1. Im Repository auf **Settings → Pages** gehen.
2. Unter „Build and deployment“ als Quelle **Deploy from a branch** wählen, dann den Branch `main` und den Ordner `/ (root)`.
3. Nach ein bis zwei Minuten ist die App unter `https://bugwiper-pirker.github.io/glidewise/` erreichbar.

## Aufgaben von Soaring Spot (Proxy einrichten)

Soaring Spot erlaubt Browsern keinen direkten Abruf seiner Seiten (kein CORS). Darum holt ein kleiner Cloudflare Worker die Aufgabenseite. Er lässt nur Adressen von soaringspot.com zu. Der Gratis-Tarif reicht.

1. Auf [dash.cloudflare.com](https://dash.cloudflare.com) ein Konto anlegen und anmelden.
2. **Workers & Pages → Create → Create Worker** wählen, einen Namen vergeben (z. B. `glidewise-soaringspot`) und **Deploy** klicken.
3. **Edit code** öffnen, den Inhalt durch `proxy/soaringspot-worker.js` ersetzen und wieder **Deploy** klicken.
4. Die Adresse des Workers (z. B. `https://glidewise-soaringspot.<konto>.workers.dev`) in `js/config.js` bei `SOARINGSPOT_PROXY` eintragen, in `sw.js` `VERSION` erhöhen, committen und pushen.

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
js/audio.js                 Vario-Ton
js/waypoints.js             Wendepunktdateien (.cup/.cupx) lesen und speichern
js/finalglide.js            Endanflugrechner und Zielauswahl
js/map.js                   Kartenseite (Leaflet)
js/map3d.js                 3D-Ansicht (MapLibre GL, three.js): Gelände, Flugzeug, Flugspur
models/arcus.bin            3D-Modell Arcus M (aus STL umgewandelt)
tools/stl2model.py          STL in das Modellformat der App umwandeln
js/airspace.js              Lufträume: OpenAir lesen, Warnlogik
js/igc.js                   IGC-Flugaufzeichnung lesen
js/replay.js                Flug abspielen: Zeitachse, Barogramm, Geschwindigkeit
js/task.js                  Aufgaben: CUP, XCSoar .tsk und Soaring-Spot-Seiten lesen, Zonen-Geometrie
vendor/leaflet/             Leaflet 1.9.4 (BSD-2-Clause), lokal für Offline-Betrieb
vendor/maplibre/            MapLibre GL JS 5.24.0 (BSD-3-Clause), für die 3D-Ansicht
vendor/three/               three.js r170 (MIT), Flugzeugmodell und Flugspur in 3D
js/app.js                   Ablauf, Einstellungen, Bildschirm-an
js/instruments/svg.js       Zeichenhilfen für Rundinstrumente
js/instruments/airspeed.js  Fahrtmesser
js/instruments/altimeter.js Höhenmesser
js/instruments/vario.js     Variometer
data/2021_LOXN_Alle.cup     Standard-Wendepunktdatei
data/beispielflug_2025-07-06.igc  Beispielflug zum Abspielen
data/austria_acg_airspaces_20261126.txt  Luftraumdatei der Austro Control (bei AIRAC-Wechsel ersetzen, js/config.js und sw.js anpassen)
sw.js                       Offline-Cache
proxy/soaringspot-worker.js Cloudflare Worker für Soaring-Spot-Links
```

So kommt ein neues Instrument dazu:

1. Eine Datei in `js/instruments/` anlegen.
2. Das Instrument in `js/app.js` in die Liste `instruments` eintragen.
3. Ein `<svg>` in `index.html` hinzufügen.
4. Die neue Datei in `sw.js` eintragen und `VERSION` erhöhen.

## Lizenzen

Die Schrift ist B612 von Airbus, lizenziert unter der SIL Open Font License 1.1.

Die Kartenbibliothek ist Leaflet (BSD-2-Clause, siehe `vendor/leaflet/LICENSE`). Kartendaten: © OpenStreetMap-Mitwirkende (ODbL), OpenTopoMap (CC-BY-SA).

3D-Ansicht: MapLibre GL JS (BSD-3-Clause, siehe `vendor/maplibre/LICENSE.txt`), three.js (MIT, siehe `vendor/three/LICENSE`). Gelände: AWS Terrain Tiles (Terrarium, aus SRTM, EU-DEM u. a.). Luftbild: Sentinel-2 cloudless by EOX IT Services GmbH (enthält veränderte Copernicus-Sentinel-Daten 2023, CC BY-NC-SA 4.0, nur nicht-kommerziell).

Luftraumdaten: Austro Control, erzeugt aus dem AIP Österreich. Ohne Gewähr, nur zur Ergänzung der Flugvorbereitung, kommerzielle Nutzung nicht gestattet (siehe Kopf der Datei).
