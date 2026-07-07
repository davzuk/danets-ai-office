const CACHE_NAME = "danets-ai-v1";
const PRECACHE_URLS = ["/", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/_next/webpack-hmr")) return;

  if (url.pathname.startsWith("/api/") || request.mode === "navigate") {
    event.respondWith(
      fetch(request).then((response) => {
        if (response.ok) { const clone = response.clone(); caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)); }
        return response;
      }).catch(() => caches.match(request).then((cached) => cached || caches.match("/")))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) { const clone = response.clone(); caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)); }
      return response;
    }))
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: "Danets AI", body: event.data?.text() || "New notification" }; }
  const options = { body: data.body || data.message || "You have a new notification", icon: "/icon-192.png", badge: "/icon-192.png", vibrate: [100, 50, 100], data: { url: data.url || "/" }, actions: [{ action: "view", title: "View" }, { action: "dismiss", title: "Dismiss" }] };
  event.waitUntil(self.registration.showNotification(data.title || "Danets AI Automation", options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "dismiss") return;
  const url = event.notification.data?.url || "/";
  event.waitUntil(self.clients.matchAll({ type: "window" }).then((clients) => {
    for (const client of clients) { if (client.url.includes(url) && "focus" in client) return client.focus(); }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  }));
});
