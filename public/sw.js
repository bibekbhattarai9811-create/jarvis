// Service worker: lets phones install Jarvis as an app, and keeps Field Assist usable with no signal.
// - App code (/_next/static) is cached after first use.
// - Field Assist pages and incident data are network-first, falling back to the last copy seen.
// - Everything else always goes to the network; offline you get a short message instead of an error page.
const CACHE = "jarvis-v2";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
);

const offlinePage = () =>
  new Response(
    '<!doctype html><meta name="viewport" content="width=device-width"><body style="background:#03080f;color:#cfefff;font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0;text-align:center;padding:24px"><div><h2 style="color:#3fd8ff;letter-spacing:.2em">J.A.R.V.I.S.</h2><p>Can\'t reach your PC.<br>Make sure it\'s on and on the same Wi-Fi, then try again.</p></div>',
    { headers: { "content-type": "text/html" } }
  );

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req);
    if (hit) return hit;
    if (req.mode === "navigate") return offlinePage();
    return new Response(JSON.stringify({ error: "offline" }), { status: 503, headers: { "content-type": "application/json" } });
  }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/_next/static/")) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => (res.ok && caches.open(CACHE).then((c) => c.put(req, res.clone())), res))));
    return;
  }
  // Field Assist: pages, incident data, and its photos stay readable offline.
  if (url.pathname.startsWith("/field") || /^\/api\/field(\/(?!translate|settings)[a-z0-9]+)?$/.test(url.pathname) || url.pathname === "/api/field/photo") {
    e.respondWith(networkFirst(req));
    return;
  }
  if (req.mode === "navigate") e.respondWith(fetch(req).catch(offlinePage));
});
