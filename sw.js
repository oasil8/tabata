const PREFIX = `tabata-${self.registration.scope}-`;
const CACHE = `${PREFIX}v19`;
const FILES = [
  './', './index.html', './styles.css', './app.js', './segments.js', './store.js', './audio-render.js',
  './memo.js', './exercise-display.js', './audio-cache.js', './data/exercises.json',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
  ...['prepare', 'work', 'rest', 'cycle_rest', 'cooldown', 'done', 'three', 'two', 'one'].map(key => `./audio/${key}.wav`),
];
self.addEventListener('install', event => {
  // 새 버전을 바로 활성화한다. 화면 새로고침 시점은 app.js가 운동 중이 아닐 때로 고른다.
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.registration.scope)) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(event.request, { ignoreSearch: true });
    if (cached) return cached;
    try { return await fetch(event.request); }
    catch {
      if (event.request.mode === 'navigate') return cache.match('./index.html');
      return Response.error();
    }
  }));
});
