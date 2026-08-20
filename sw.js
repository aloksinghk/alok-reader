/**
 * sw.js — Service Worker for Alok Reader
 * Cache version bumped for kiro-improvements (v3.0.0)
 */
const CACHE = 'alok-reader-v3-1-0';

const PRECACHE_URLS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './src/utils.js',
  './src/db.js',
  './src/extractor.js',
  './src/paginator.js',
  './src/highlights.js',
  './src/library.js',
  './src/reader.js',
  './src/backup.js',
  './src/dictionary.js',
];

self.addEventListener('install', e =>
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE_URLS))
  )
);

self.addEventListener('activate', e =>
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  )
);

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
