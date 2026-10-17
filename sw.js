const PREFIX = `tabata-${self.registration.scope}-`;
const CACHE = `${PREFIX}v21`;
// 이미지는 파일 이름 기준으로 한 번만 받는다. 같은 이름의 이미지 내용을 바꾸면 이 버전을 올려야 새 이미지가 반영된다.
const IMAGE_CACHE = `${PREFIX}images-v1`;
const FILES = [
  './', './index.html', './styles.css', './app.js', './segments.js', './store.js', './audio-render.js',
  './memo.js', './exercise-display.js', './audio-cache.js', './data/exercises.json',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
  ...['prepare', 'work', 'rest', 'cycle_rest', 'cooldown', 'done', 'three', 'two', 'one'].map(key => `./audio/${key}.wav`),
];
self.addEventListener('install', event => {
  // 새 버전을 바로 활성화한다. 화면 새로고침 시점은 app.js가 운동 중이 아닐 때로 고른다.
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(FILES);
    const db = await (await cache.match('./data/exercises.json')).json();
    const images = await caches.open(IMAGE_CACHE);
    // 누락/오프라인 이미지는 앱 설치를 막지 않으며 다음 요청 때 다시 저장한다.
    for (const path of new Set(db.flatMap(item => item.images || []))) {
      const url = new URL(path, self.registration.scope).href;
      try {
        if (await images.match(url)) continue;
        const response = await fetch(url);
        if (response.ok) await images.put(url, response);
      } catch { /* 다음 온라인 요청에서 재시도 */ }
    }
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE && key !== IMAGE_CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.registration.scope)) return;
  const isImage = event.request.url.startsWith(`${self.registration.scope}images/`);
  event.respondWith(caches.open(isImage ? IMAGE_CACHE : CACHE).then(async cache => {
    const cached = await cache.match(event.request, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const response = await fetch(event.request);
      if (isImage && response.ok) {
        try { await cache.put(event.request, response.clone()); } catch { /* 저장 공간이 없어도 이미지는 표시 */ }
      }
      return response;
    }
    catch {
      if (event.request.mode === 'navigate') return cache.match('./index.html');
      return Response.error();
    }
  }));
});
