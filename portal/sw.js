// Service worker du portail : rend l'app installable et lui permet de s'ouvrir
// sans réseau. Il ne gère QUE les fichiers du portail : l'overlay (/overlay/,
// même origine) et l'API (autre origine) passent sans être touchés.
const CACHE = "rs-portal-v4";
const SHELL = [
  "./",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/favicon.svg",
  "./icons/apple-touch-icon.png",
  // Scoreur sans montre (doit s'ouvrir et compter sans réseau) et page club.
  "./scoreur.html",
  "./club.html",
  "./engine/engine.js",
  "./engine/rules.js",
  "./engine/sports.js",
  "./engine/stats.js",
  "./engine/sync.js",
  "./vendor/qrcode.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const scope = new URL(self.registration.scope).pathname;
  const page = url.pathname === scope || url.pathname === scope + "index.html";
  const shell = SHELL.some((p) => new URL(p, self.registration.scope).pathname === url.pathname);
  if (!page && !shell) return;
  // Clé de cache sans « ?… » : club.html?c=bcparis s'ouvre aussi hors ligne.
  const key = page ? "./" : url.origin + url.pathname;
  // Réseau d'abord (le portail est toujours à jour), cache si hors ligne.
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(key, copy));
        }
        return res;
      })
      .catch(() => caches.match(key)),
  );
});
