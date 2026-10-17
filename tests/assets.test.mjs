import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
const root = new URL('../', import.meta.url);
test('서비스워커 필수 캐시 파일과 운동 DB 포함, 원격 이미지 제외', () => {
  let files;
  const events = {};
  vm.runInNewContext(readFileSync(new URL('sw.js', root), 'utf8'), {
    self: { registration: { scope: 'https://example.test/tabata-app/' }, skipWaiting: async () => {}, addEventListener: (name, handler) => { events[name] = handler; } },
    caches: { open: async () => ({ addAll: async list => { files = list; }, match: async () => ({ json: async () => [] }) }) },
  });
  return new Promise((resolve, reject) => events.install({ waitUntil: promise => promise.then(() => {
    try {
      for (const file of files) assert.ok(existsSync(new URL(file, root)), file);
      assert.equal(files.filter(file => file.endsWith('.wav')).length, 9);
      assert.ok(files.includes('./data/exercises.json'));
      assert.ok(files.includes('./memo.js'));
      assert.ok(files.includes('./exercise-display.js'));
      assert.ok(files.every(file => file.startsWith('./')));
      resolve();
    } catch (error) { reject(error); }
  }, reject) }));
});

test('이미지는 고정 캐시에 누락분만 저장하고 업데이트·오프라인에도 유지', async () => {
  const scope = 'https://example.test/tabata-app/';
  const prefix = `tabata-${scope}-`;
  const events = {}, stores = new Map(), downloads = [], deleted = [];
  const image = `${scope}images/crunch-1.jpg`;
  const missing = `${scope}images/crunch-2.jpg`;
  const response = { ok: true, clone() { return this; } };
  stores.set(prefix + 'images-v1', new Map([[image, response]]));
  // 배포 때마다 버전이 오르므로 sw.js에서 현재 버전을 읽는다.
  const version = Number(readFileSync(new URL('sw.js', root), 'utf8').match(/\}v(\d+)`/)[1]);
  stores.set(prefix + `v${version - 1}`, new Map());
  stores.set('another-app-v1', new Map());
  let offline = false;
  vm.runInNewContext(readFileSync(new URL('sw.js', root), 'utf8'), {
    URL, Response,
    self: { registration: { scope }, skipWaiting: async () => {}, clients: { claim: async () => {} }, addEventListener: (name, fn) => { events[name] = fn; } },
    caches: {
      keys: async () => [...stores.keys()],
      match: async request => {
        const key = new URL(request, scope).href;
        for (const store of stores.values()) if (store.has(key)) return store.get(key);
      },
      delete: async key => { deleted.push(key); return stores.delete(key); },
      open: async key => {
        if (!stores.has(key)) stores.set(key, new Map());
        const store = stores.get(key);
        const url = request => new URL(typeof request === 'string' ? request : request.url, scope).href.split('?')[0];
        return {
          addAll: async files => { for (const file of files) store.set(url(file), file.endsWith('exercises.json') ? { json: async () => [{ images: ['images/crunch-1.jpg', 'images/crunch-2.jpg', 'images/failed-1.jpg'] }] } : response); },
          match: async request => store.get(url(request)),
          put: async (request, value) => store.set(url(request), value),
        };
      },
    },
    fetch: async request => {
      const url = typeof request === 'string' ? request : request.url;
      downloads.push(url);
      if (offline) throw new Error('offline');
      return url.includes('failed') ? { ok: false } : response;
    },
  });
  const lifecycle = name => new Promise((resolve, reject) => events[name]({ waitUntil: p => p.then(resolve, reject) }));
  const fill = () => new Promise((resolve, reject) => events.message({ data: 'cache-images', waitUntil: p => p.then(resolve, reject) }));
  await lifecycle('install');
  assert.deepEqual(downloads, [], '설치는 이미지를 기다리지 않음');
  await fill();
  assert.ok(!downloads.includes(image));
  assert.ok(downloads.includes(missing));
  assert.equal(stores.get(prefix + 'images-v1').size, 2, '404는 저장하지 않음');
  assert.ok(!stores.get(prefix + `v${version}`).has(image));
  await lifecycle('activate');
  assert.deepEqual(deleted, [prefix + `v${version - 1}`]);
  offline = true;
  const cached = await new Promise(resolve => events.fetch({ request: { method: 'GET', url: missing, mode: 'cors' }, respondWith: resolve }));
  assert.equal(cached, response);
  offline = false;
  const before = downloads.length;
  await lifecycle('install');
  await fill();
  assert.deepEqual(downloads.slice(before), [`${scope}images/failed-1.jpg`]);
});
test('매니페스트 상대경로와 실제 PNG 크기', () => {
  const manifest = JSON.parse(readFileSync(new URL('manifest.webmanifest', root), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  for (const [file, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
    const png = readFileSync(new URL(`icons/${file}`, root));
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
  }
});
