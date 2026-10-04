// This worker caches only an explicit list of public resources. Notebook records
// live in IndexedDB; API responses, page HTML and account credentials stay out.
const CACHE = "forma-public-v1";
const PUBLIC_RESOURCES = [
  "/offline.html",
  "/icons/forma-192.png",
  "/icons/forma-512.png",
  "/icons/forma-maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/fonts/geist-regular.ttf",
  "/fonts/geist-medium.ttf",
  "/fonts/geist-semibold.ttf",
  "/fonts/geist-bold.ttf",
  "/fonts/geist-mono-regular.ttf",
  "/fonts/geist-mono-medium.ttf",
  "/fonts/instrument-regular.ttf",
  "/fonts/instrument-italic.ttf",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        cache.addAll(
          PUBLIC_RESOURCES.map(
            (path) =>
              new Request(path, { credentials: "omit", cache: "reload" }),
          ),
        ),
      ),
  );
  // Updates wait. The page offers an explicit activation when practice is safe.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("forma-public-") && name !== CACHE)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "ACTIVATE_UPDATE") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    request.headers.has("Authorization")
  )
    return;
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const fallback = await caches.match("/offline.html", {
          cacheName: CACHE,
        });
        return (
          fallback ??
          new Response(
            "Forma is offline. Reconnect to open your notebook; saved records remain on this device.",
            {
              status: 503,
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            },
          )
        );
      }),
    );
    return;
  }
  if (url.search || !PUBLIC_RESOURCES.includes(url.pathname)) return;
  event.respondWith(
    (async () => {
      const cached = await caches.match(url.pathname, { cacheName: CACHE });
      return cached ?? fetch(new Request(url.href, { credentials: "omit" }));
    })(),
  );
});
