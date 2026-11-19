// Endanflugrechner: zeigt Ziel, Distanz, erforderliche Gleitzahl und Ankunftshöhe.
//
// Erforderliche Gleitzahl = Distanz / (eigene Höhe − Zielhöhe − Sicherheitshöhe)
// Hat das Ziel einer Aufgabe eine Mindest-Ankunftshöhe (minAlt, MSL), wird darauf gerechnet,
// wenn sie höher liegt (darunter gibt es im Wettbewerb Strafpunkte).
// Ankunft: nach MacCready mit Polare, MC-Wert und Gegen-/Rückenwind (sobald geschätzt).

import { distanceKm, LANDABLE } from "./waypoints.js";
import { bearingDeg } from "./sources.js";

const fmtDist = (km) => (km < 10 ? km.toFixed(1) : Math.round(km).toString());
const fmtSigned = (m) => (m > 0.5 ? "+" : m < -0.5 ? "−" : "") + Math.abs(Math.round(m));
const fmtMc = (v) => v.toLocaleString("de-AT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function createFinalGlide({ box, picker, getSettings, onSelect }) {
  const $ = (sel) => box.querySelector(sel);
  const nameEl = $(".fg-name"), codeEl = $(".fg-code");
  const distEl = $("#fg-dist"), ldEl = $("#fg-ld"), elevEl = $("#fg-arr"), noteEl = $(".fg-note");
  const dirEl = $(".fg-dir"), arrowEl = $(".fg-arrow"), turnEl = $(".fg-turn");
  let arrowAngle = 0; // aktuell gezeichneter Winkel (fortlaufend, ohne Sprung bei 360°)

  // Pfeil drehen, immer auf dem kürzeren Weg
  function setArrow(deg) {
    const delta = ((deg - arrowAngle) % 360 + 540) % 360 - 180;
    arrowAngle += delta;
    arrowEl.style.transform = `rotate(${arrowAngle}deg)`;
  }

  function renderDirection(d) {
    if (!target || !pos || d < 0.3) { dirEl.dataset.mode = "off"; turnEl.textContent = ""; return; }
    const brg = bearingDeg(pos.lat, pos.lon, target.lat, target.lon);
    if (pos.track == null) {
      // Kein Kurs (z. B. am Boden): Pfeil nordausgerichtet, Kurs als Zahl
      dirEl.dataset.mode = "north";
      setArrow(brg);
      turnEl.textContent = `${String(Math.round(brg) % 360).padStart(3, "0")}°`;
      return;
    }
    dirEl.dataset.mode = "rel";
    const rel = ((brg - pos.track) % 360 + 540) % 360 - 180; // −180..180, + = rechts
    setArrow(rel);
    const a = Math.round(Math.abs(rel));
    turnEl.textContent = a <= 5 ? "gerade" : `${a}° ${rel > 0 ? "R" : "L"}`;
  }

  let points = [];
  let target = null;
  let pos = null; // { lat, lon, alt }

  function render() {
    const s = getSettings();
    box.dataset.state = "none";
    if (!target || !pos) renderDirection(Infinity);
    if (!points.length) {
      nameEl.textContent = "Endanflug";
      codeEl.textContent = "";
      noteEl.textContent = "Wendepunktdatei in ⚙ laden";
      distEl.textContent = ldEl.textContent = elevEl.textContent = "--";
      return;
    }
    if (!target) {
      nameEl.textContent = "Ziel wählen";
      codeEl.textContent = "›";
      noteEl.textContent = `${points.length} Wendepunkte geladen`;
      distEl.textContent = ldEl.textContent = elevEl.textContent = "--";
      return;
    }
    nameEl.textContent = target.name;
    codeEl.textContent = target.code;
    const minAlt = target.minAlt ?? null;
    elevEl.textContent = "--";

    if (!pos) {
      distEl.textContent = ldEl.textContent = "--";
      noteEl.textContent = "Warte auf GPS";
      return;
    }
    const d = distanceKm(pos.lat, pos.lon, target.lat, target.lon);
    distEl.textContent = fmtDist(d);
    renderDirection(d);

    if (pos.alt == null || (target.elev == null && minAlt == null)) {
      ldEl.textContent = "--";
      noteEl.textContent = pos.alt == null ? "Keine GPS-Höhe" : "Zielhöhe fehlt in der Datei";
      return;
    }
    const ground = target.elev == null ? -Infinity : target.elev + s.safetyHeight;
    const floor = Math.max(ground, minAlt ?? -Infinity);
    const usable = pos.alt - floor;
    const reserve = minAlt != null && minAlt >= ground ? `Ankunft mind. ${Math.round(minAlt)} m` : `Ziel ${Math.round(target.elev)} + ${s.safetyHeight} m`;
    if (d < 0.3) {
      ldEl.textContent = "--";
      box.dataset.state = "ok";
      noteEl.textContent = "Ziel erreicht";
      return;
    }
    ldEl.textContent = usable <= 0 ? "∞" : (d * 1000) / usable > 99 ? ">99" : Math.round((d * 1000) / usable);

    // MacCready mit Wind: Gegenwind-Komponente auf dem Kurs zum Ziel
    const w = s.wind;
    const hw = w ? w.speed * Math.cos(((w.from - bearingDeg(pos.lat, pos.lon, target.lat, target.lon)) * Math.PI) / 180) : 0;
    const g = s.polar.glide(s.mc, hw), g0 = s.polar.glide(0, hw);
    const need = (ld) => (ld > 0 ? (d * 1000) / ld : Infinity);
    const arrival = usable - need(g.ld), arrival0 = usable - need(g0.ld);
    elevEl.textContent = Number.isFinite(arrival) ? fmtSigned(arrival) : "−∞";
    box.dataset.state = arrival >= 0 ? "ok" : arrival0 >= 0 ? "warn" : "bad";
    const windTxt = Math.abs(hw) * 3.6 >= 3 ? ` · ${hw > 0 ? "Gegen" : "Rücken"}wind ${Math.round(Math.abs(hw) * 3.6)}` : w ? "" : " · ohne Wind";
    noteEl.textContent = `${reserve} · MC ${fmtMc(s.mc)} → ${Math.round(g.v * 3.6)} km/h${windTxt}` +
      (arrival < 0 && arrival0 >= 0 ? ` · mit MC 0: ${fmtSigned(arrival0)} m` : "");
  }

  // ---- Auswahl-Dialog ----
  const search = picker.querySelector("#wp-search");
  const list = picker.querySelector("#wp-list");
  const onlyLand = picker.querySelector("#wp-landable");

  function fillList() {
    const q = search.value.trim().toLowerCase();
    let items = points.map((p, i) => ({ p, i, d: pos ? distanceKm(pos.lat, pos.lon, p.lat, p.lon) : null }));
    if (onlyLand.checked) items = items.filter((x) => LANDABLE.has(x.p.style));
    if (q) items = items.filter((x) => x.p.name.toLowerCase().includes(q) || x.p.code.toLowerCase().includes(q));
    items.sort((a, b) => (a.d != null && b.d != null ? a.d - b.d : a.p.name.localeCompare(b.p.name)));
    list.replaceChildren();
    for (const { p, i, d } of items.slice(0, 200)) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "wp-item" + (target === p ? " current" : "");
      btn.innerHTML = `<span class="wp-n"></span><span class="wp-m"></span>`;
      btn.querySelector(".wp-n").textContent = p.name + (LANDABLE.has(p.style) ? "  ✈" : "");
      btn.querySelector(".wp-m").textContent =
        [p.code, p.elev == null ? "Höhe ?" : `${Math.round(p.elev)} m`, d == null ? "" : `${fmtDist(d)} km`]
          .filter(Boolean).join(" · ");
      btn.addEventListener("click", () => { select(i); picker.close(); });
      li.appendChild(btn);
      list.appendChild(li);
    }
    if (!items.length) {
      const li = document.createElement("li");
      li.className = "wp-empty";
      li.textContent = "Kein Wendepunkt gefunden.";
      list.appendChild(li);
    }
  }
  search.addEventListener("input", fillList);
  onlyLand.addEventListener("change", fillList);

  function select(i) {
    target = points[i] || null;
    onSelect(target ? { name: target.name, code: target.code, lat: target.lat, lon: target.lon, elev: target.elev } : null);
    render();
  }

  function open() {
    if (!points.length) return false;
    search.value = "";
    fillList();
    picker.showModal();
    return true;
  }

  return {
    open,
    setPoints(p, saved) {
      points = p || [];
      target = null;
      if (saved) {
        target = points.find((x) => x.name === saved.name && x.code === saved.code &&
          Math.abs(x.lat - saved.lat) < 1e-4 && Math.abs(x.lon - saved.lon) < 1e-4) ||
          // Ziel außerhalb der Liste (z. B. Wende aus der Aufgabe)
          (saved.elev !== undefined ? { style: 0, ...saved } : null);
        // Mindest-Ankunftshöhe gehört zur Aufgabe, nicht zum Wendepunkt
        if (target && saved.minAlt != null) target = { ...target, minAlt: saved.minAlt };
      }
      render();
    },
    update(p) { pos = p; render(); },
    // beliebigen Punkt als Ziel (z. B. Wende aus der Aufgabe)
    selectPoint(p) {
      target = p || null;
      onSelect(target ? { name: target.name, code: target.code, lat: target.lat, lon: target.lon, elev: target.elev, minAlt: target.minAlt ?? null } : null);
      render();
    },
    render,
  };
}
