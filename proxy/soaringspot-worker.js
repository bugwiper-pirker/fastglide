// Cloudflare Worker: holt Soaring-Spot-Seiten für GlideWise und erlaubt den Abruf aus dem Browser (CORS).
// Aufruf: https://<worker>.workers.dev/?url=https://www.soaringspot.com/de/…/tasks/…
// Nur soaringspot.com ist erlaubt, damit der Worker kein offener Proxy ist.
// Einrichtung siehe README, Abschnitt „Aufgaben von Soaring Spot“.

const ALLOWED_HOST = /(^|\.)soaringspot\.com$/i;

export default {
  async fetch(req) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    };
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (req.method !== "GET") return new Response("Nur GET", { status: 405, headers: cors });

    let target;
    try { target = new URL(new URL(req.url).searchParams.get("url") || ""); }
    catch { return new Response("Parameter url fehlt", { status: 400, headers: cors }); }
    if (target.protocol !== "https:" || !ALLOWED_HOST.test(target.hostname)) {
      return new Response("Nur soaringspot.com", { status: 403, headers: cors });
    }

    const res = await fetch(target, { headers: { "User-Agent": "GlideWise" }, cf: { cacheTtl: 60 } });
    const headers = new Headers(cors);
    headers.set("Content-Type", res.headers.get("Content-Type") || "text/html; charset=utf-8");
    return new Response(res.body, { status: res.status, headers });
  },
};
