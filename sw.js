/* Scoreline service worker: makes the app installable and lets the app shell open offline.
   Scores are never cached here; they always come live from the network. */
const CACHE = "scoreline-v2";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  // Network first so updates show up right away; fall back to the cached shell when offline.
  event.respondWith(
    fetch(event.request, { cache: event.request.mode === "navigate" ? "no-store" : "no-cache" })   // no-cache: always ask the server if a file changed (a quick 304 if not), so new code shows on the next load
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match("./index.html")))
  );
});

// Tapping a notification opens (or focuses) the app.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "./", self.registration.scope).href;   // "./#g=nfl-401…" opens that game
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const open = wins.find((w) => w.url.startsWith(self.registration.scope));
      if (!open) return self.clients.openWindow(url);
      open.postMessage({ type: "open-link", url });   // already open: the page jumps to the game (no reload)
      return open.focus();
    })
  );
});

// Background score alerts: the GitHub Actions push worker sends these even when the app is closed.
self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { title: "Scoreline", body: event.data ? event.data.text() : "" }; }
  event.waitUntil(self.registration.showNotification(d.title || "Scoreline", {
    body: d.body || "",
    tag: d.tag || "scoreline",
    renotify: true,
    icon: "icon-192.png",
    badge: "icon-192.png",
    data: { url: d.url || "./" },
  }));
});
