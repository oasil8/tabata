const PREFIX = `tabata-${self.registration.scope}-`;
const CACHE = `${PREFIX}v22`;
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
  // 설치는 앱 파일만으로 끝내 새 버전이 바로 적용되게 한다. 이미지는 활성화 뒤 앱이 요청할 때 채운다.
  // (설치 중에 이미지 147장을 받으면 그동안 예전 버전이 계속 보이고, 앱을 닫으면 설치가 처음부터 다시 시작된다.)
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});
// 오프라인용 이미지 채우기: 없는 것만, 6장씩 동시에 받는다. 실패한 이미지는 다음 요청 때 다시 시도한다.
async function fillImages() {
  const db = await (await caches.match('./data/exercises.json')).json();
  const images = await caches.open(IMAGE_CACHE);
  const missing = [];
  for (const path of new Set(db.flatMap(item => item.images || []))) {
    const url = new URL(path, self.registration.scope).href;
    if (!(await images.match(url))) missing.push(url);
  }
  for (let i = 0; i < missing.length; i += 6) {
    await Promise.all(missing.slice(i, i + 6).map(async url => {
      try {
        const response = await fetch(url);
        if (response.ok) await images.put(url, response);
      } catch { /* 다음 온라인 요청에서 재시도 */ }
    }));
  }
}
self.addEventListener('message', event => {
  if (event.data === 'cache-images') event.waitUntil(fillImages().catch(() => {}));
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
