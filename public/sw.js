// Driftline service worker
// - Pages load network-first (updates show right away) with an offline fallback.
// - Map tiles are cache-first, so areas you've viewed or saved work with no signal.
// - Push notifications for flow alerts and crew posts.
const CACHE = "driftline-v10";
const TILES = "driftline-tiles-v1";
const SHELL = ["/", "/manifest.webmanifest", "/favicon.svg", "/apple-touch-icon.png", "/icon-192.png", "/icon-512.png"];
const TILE_HOSTS = ["server.arcgisonline.com", "gis.blm.gov"];
const LIBS = ["cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== TILES).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function cacheFirst(req, name) {
  const hit = await caches.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok || res.type === "opaque") {
      const c = await caches.open(name);
      c.put(req, res.clone());
    }
    return res;
  } catch (e) {
    return new Response("", { status: 504 });
  }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (TILE_HOSTS.includes(url.hostname) && url.pathname.includes("/tile/")) { e.respondWith(cacheFirst(req, TILES)); return; }
  if (LIBS.includes(url.hostname)) { e.respondWith(cacheFirst(req, CACHE)); return; }
  if (url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  if (req.mode === "navigate" || url.pathname === "/" || url.pathname.endsWith(".html")) {
    e.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put("/", copy)); return res; })
        .catch(() => caches.match("/"))
    );
    return;
  }
  e.respondWith(cacheFirst(req, CACHE));
});

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: "Driftline", body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "Driftline", {
    body: d.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: d.tag,
    data: { url: d.url || "/#home" },
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/#home";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ("focus" in c) { c.navigate(url).catch(() => {}); return c.focus(); } }
      return self.clients.openWindow(url);
    })
  );
});
