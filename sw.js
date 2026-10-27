// 網路優先：有網路時永遠拿最新版，離線時才用快取（只快取自己網域的 app 檔案）
const CACHE = 'suibian-v3';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'app-config.js',
  'manifest.webmanifest',
  'js/app.js',
  'js/config.js',
  'js/geo.js',
  'js/hours.js',
  'js/i18n.js',
  'js/locales/en.js',
  'js/locales/ja.js',
  'js/locales/zh-TW.js',
  'js/picker.js',
  'js/regions.js',
  'js/storage.js',
  'js/providers/osm.js',
  'js/providers/osm-hours.js',
  'js/providers/google.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(request, { ignoreSearch: true }).then((cached) => cached || caches.match('index.html')),
      ),
  );
});
