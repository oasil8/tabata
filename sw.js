const PREFIX = `tabata-${self.registration.scope}-`;
const CACHE = `${PREFIX}v2`;
const FILES = [
  './', './index.html', './styles.css', './app.js', './segments.js', './store.js', './audio-render.js',
  './memo.js', './exercise-display.js', './data/exercises.json',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
  ...['prepare', 'work', 'rest', 'cycle_rest', 'cooldown', 'done', 'three', 'two', 'one'].map(key => `./audio/${key}.wav`),
];
self.addEventListener('install', event => {
  // 운동 중 버전을 바꾸지 않는다. 기존 탭을 모두 닫으면 새 버전이 활성화된다.
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)));
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
