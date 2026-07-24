// Cache-first service worker for the app shell (the trainer is fully client-side,
// so once cached it runs offline). Bump CACHE to ship an update.
const CACHE = "poker-trainer-v52";
const SHELL = [
  "./", "./index.html", "./styles.css", "./manifest.webmanifest",
  "./icon.svg", "./icon-180.png", "./icon-192.png", "./app.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      // Only cache successful responses — a transient 404/500 must not poison the
      // cached shell and get served forever.
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      }
      return res;
    }).catch(() => e.request.mode === "navigate" ? caches.match("./index.html") : Response.error())),
  );
});
