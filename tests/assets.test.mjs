import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
const root = new URL('../', import.meta.url);
test('서비스워커 필수 캐시 파일이 모두 존재하며 2단계 DB는 제외', () => {
  let files;
  const events = {};
  vm.runInNewContext(readFileSync(new URL('sw.js', root), 'utf8'), {
    self: { registration: { scope: 'https://example.test/tabata-app/' }, addEventListener: (name, handler) => { events[name] = handler; } },
    caches: { open: async () => ({ addAll: async list => { files = list; } }) },
  });
  return new Promise((resolve, reject) => events.install({ waitUntil: promise => promise.then(() => {
    try {
      for (const file of files) assert.ok(existsSync(new URL(file, root)), file);
      assert.equal(files.filter(file => file.endsWith('.wav')).length, 9);
      assert.equal(files.some(file => file.includes('data/')), false);
      resolve();
    } catch (error) { reject(error); }
  }, reject) }));
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
