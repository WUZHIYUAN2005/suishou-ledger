const REVISION = "__LEDGER_REVISION__";
const CACHE_NAME = `suishou-ledger-static-${REVISION}`;
const ENTRY_URL = new URL(
  `./index.html?v=${REVISION}`,
  self.registration.scope,
);
const MATERIAL_URLS = [
  new URL("./src/preview-bridge.js", self.registration.scope),
  new URL("./src/ledger.js", self.registration.scope),
  new URL("./src/actions.js", self.registration.scope),
  new URL("./src/drive.js", self.registration.scope),
  new URL("./src/covers.js", self.registration.scope),
  new URL("./auth-client.js", self.registration.scope),
  new URL("./liquid-ledger.css?v=studio-20261122-v5", self.registration.scope),
  new URL("./liquid-ledger.js?v=studio-20261122-v5", self.registration.scope),
  new URL("./liquid-nav-optics.js?v=optics-20261122-v3", self.registration.scope),
  new URL("./v29-ledger.css?v=release-20261122-v1", self.registration.scope),
  new URL("./v29-integrate.js?v=release-20261122-v1", self.registration.scope),
  new URL("./assets/wallpapers/garden-dark-mobile.webp", self.registration.scope),
  new URL("./assets/wallpapers/garden-dark-desktop.webp", self.registration.scope),
  new URL("./assets/wallpapers/garden-light-mobile.webp", self.registration.scope),
  new URL("./assets/wallpapers/garden-light-desktop.webp", self.registration.scope),
  new URL("./assets/wallpapers/cosmos-dark-mobile.webp", self.registration.scope),
  new URL("./assets/wallpapers/cosmos-dark-desktop.webp", self.registration.scope),
  new URL("./assets/wallpapers/cosmos-light-mobile.webp", self.registration.scope),
  new URL("./assets/wallpapers/cosmos-light-desktop.webp", self.registration.scope),
  new URL("./assets/wallpapers/tech-dark-mobile.webp", self.registration.scope),
  new URL("./assets/wallpapers/tech-dark-desktop.webp", self.registration.scope),
  new URL("./assets/wallpapers/tech-light-mobile.webp", self.registration.scope),
  new URL("./assets/wallpapers/tech-light-desktop.webp", self.registration.scope),
];
const MATERIAL_PATHS = new Set(MATERIAL_URLS.map((item) => item.pathname));
const ENTRY_PATHS = new Set(
  ["./", "./index.html", "./cloud.html"].map(
    (path) => new URL(path, self.registration.scope).pathname,
  ),
);

self.addEventListener("install", (event) => {
  // Either entry can be restored from this one self-contained page.
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll([new Request(ENTRY_URL, { cache: "reload" }), ...MATERIAL_URLS.map((url) => new Request(url, { cache: "reload" }))]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith("suishou-ledger-static-") && key !== CACHE_NAME,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== ENTRY_URL.origin) return;
  if (MATERIAL_PATHS.has(url.pathname)) {
    event.respondWith(
      fetch(request).then(async (response) => {
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }
        return response;
      }).catch(async (error) => {
        const cached = await caches.match(request, { cacheName: CACHE_NAME, ignoreSearch: true });
        if (cached) return cached;
        throw error;
      }),
    );
    return;
  }
  if (request.mode !== "navigate" || !ENTRY_PATHS.has(url.pathname)) return;

  event.respondWith(
    fetch(request)
      .then(async (response) => {
        if (response.status < 500) return response;
        return (
          (await caches.match(ENTRY_URL, { cacheName: CACHE_NAME })) ?? response
        );
      })
      .catch(async (error) => {
        const cached = await caches.match(ENTRY_URL, { cacheName: CACHE_NAME });
        if (cached) return cached;
        throw error;
      }),
  );
});
