// Endanflugrechner: zeigt Ziel, Distanz, Zielhöhe und erforderliche Gleitzahl.
//
// Erforderliche Gleitzahl = Distanz / (eigene Höhe − Zielhöhe − Sicherheitshöhe)
// Ohne Wind und ohne Polare: eine reine geometrische Rechnung.

import { distanceKm, LANDABLE } from "./waypoints.js";

const fmtDist = (km) => (km < 10 ? km.toFixed(1) : Math.round(km).toString());

export function createFinalGlide({ box, picker, getSettings, onSelect }) {
  const $ = (sel) => box.querySelector(sel);
  const nameEl = $(".fg-name"), codeEl = $(".fg-code");
  const distEl = $("#fg-dist"), ldEl = $("#fg-ld"), elevEl = $("#fg-elev"), noteEl = $(".fg-note");

  let points = [];
  let target = null;
  let pos = null; // { lat, lon, alt }

  function render() {
    const s = getSettings();
    box.dataset.state = "none";
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
    elevEl.textContent = target.elev == null ? "?" : Math.round(target.elev);

    if (!pos) {
      distEl.textContent = ldEl.textContent = "--";
      noteEl.textContent = "Warte auf GPS";
      return;
    }
    const d = distanceKm(pos.lat, pos.lon, target.lat, target.lon);
    distEl.textContent = fmtDist(d);

    if (pos.alt == null || target.elev == null) {
      ldEl.textContent = "--";
      noteEl.textContent = target.elev == null ? "Zielhöhe fehlt in der Datei" : "Keine GPS-Höhe";
      return;
    }
    const usable = pos.alt - target.elev - s.safetyHeight;
    const reserve = `inkl. ${s.safetyHeight} m Reserve`;
    if (d < 0.3) {
      ldEl.textContent = "--";
      box.dataset.state = "ok";
      noteEl.textContent = "Ziel erreicht";
    } else if (usable <= 0) {
      ldEl.textContent = "∞";
      box.dataset.state = "bad";
      noteEl.textContent = `${Math.round(-usable)} m zu tief · ${reserve}`;
    } else {
      const ld = (d * 1000) / usable;
      ldEl.textContent = ld > 99 ? ">99" : Math.round(ld);
      box.dataset.state = ld <= s.safeGlide ? "ok" : ld <= s.bestGlide ? "warn" : "bad";
      noteEl.textContent = reserve;
    }
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
    onSelect(target ? { name: target.name, code: target.code, lat: target.lat, lon: target.lon } : null);
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
          Math.abs(x.lat - saved.lat) < 1e-4 && Math.abs(x.lon - saved.lon) < 1e-4) || null;
      }
      render();
    },
    update(p) { pos = p; render(); },
    render,
  };
}
