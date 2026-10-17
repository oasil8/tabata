import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { exercises as regenerated, excluded } from '../tools/build-exercises.mjs';
import { defaults } from '../store.js';

const bytes = await readFile(new URL('../data/exercises.json', import.meta.url), 'utf8');
const db = JSON.parse(bytes);
const original = JSON.parse(await readFile(new URL('../data/wger-exercises.en.json', import.meta.url), 'utf8'));
const sourceById = new Map(original.map(item => [item.id, item]));
const byId = new Map(db.map(item => [item.id, item]));
const categories = ['복근', '가슴', '팔', '어깨', '등', '하체', '종아리', '유산소', '스트레칭'];

test('exercise DB has complete typed fields, unique IDs and Korean instructions', () => {
  assert.ok(db.length > 0);
  assert.equal(byId.size, db.length);
  assert.equal(new Set(db.map(item => item.ko)).size, db.length);
  for (const item of db) {
    assert.deepEqual(Object.keys(item).sort(), ['id', 'ko', 'en', 'category', 'equipment', 'muscles', 'steps', 'tips', 'images', 'source', 'wgerIds', ...(item.images.length ? ['imageSource'] : [])].sort());
    for (const key of ['id', 'ko', 'en']) assert.ok(typeof item[key] === 'string' && item[key].trim(), `${item.id}.${key}`);
    assert.ok(categories.includes(item.category), item.id);
    assert.ok(['맨몸', '케틀벨', '불가리안백'].includes(item.equipment), item.id);
    assert.ok(['app', 'wger'].includes(item.source));
    assert.ok(Array.isArray(item.muscles));
    assert.ok(item.muscles.every(muscle => typeof muscle === 'string' && /[가-힣]/u.test(muscle)));
    assert.ok(Array.isArray(item.steps) && item.steps.length >= 3 && item.steps.length <= 6, item.id);
    assert.ok(Array.isArray(item.tips) && item.tips.length >= 1 && item.tips.length <= 3, item.id);
    for (const sentence of [...item.steps, ...item.tips]) assert.ok(typeof sentence === 'string' && /[가-힣]/u.test(sentence), item.id);
    assert.ok(Array.isArray(item.images));
    item.images.forEach((image, i) => assert.equal(image, `images/${item.id}-${i + 1}.jpg`));
    assert.ok(Array.isArray(item.wgerIds));
    assert.equal(new Set(item.wgerIds).size, item.wgerIds.length);
    assert.ok(item.wgerIds.every(id => Number.isInteger(id) && sourceById.has(id)));
    assert.equal(item.source === 'app', item.wgerIds.length === 0);
  }
});

test('every routine seed resolves to a DB item and required app entries exist', () => {
  for (const routine of defaults().routines) {
    for (const entry of routine.exercises) assert.ok(byId.has(entry.exerciseId), `${routine.name}: ${entry.exerciseId}`);
  }
  const required = ['crunch', 'leg-raise', 'goblet-squat', 'kettlebell-shoulder-press', 'kettlebell-snatch-catch', 'kettlebell-triceps-extension', 'kettlebell-pushup'];
  assert.deepEqual(db.filter(item => item.source === 'app' && item.equipment !== '불가리안백').map(item => item.id).sort(), required.sort());
  assert.deepEqual(byId.get('kettlebell-swing').wgerIds, [9, 331, 960]);
  assert.deepEqual(byId.get('pistol-squat').wgerIds, [1020]);
  assert.ok(byId.get('kettlebell-curl').wgerIds.includes(975));
});

test('left/right variants and forbidden equipment are removed, including mislabeled sources', () => {
  const forbiddenNames = /\b(?:elliptical|treadmill|rowing machine|stationary bike|stair master|cycling|trx|band|ab wheel|fingerboard|flexbar|bosu|foam roller|meditation|breathing)\b/i;
  for (const item of db) {
    assert.doesNotMatch(item.en, /\b(?:left|right)\b/i, item.id);
    // IT Band is an anatomical structure, not a resistance band exercise.
    assert.doesNotMatch(item.en.replace('IT Band', 'Iliotibial'), forbiddenNames, item.id);
    assert.doesNotMatch(item.ko, /(?:왼쪽|오른쪽|좌측|우측)$/, item.id);
    for (const id of item.wgerIds) assert.ok(!excluded[id], `Excluded ${id} leaked into DB`);
  }
  for (const id of [177, 674, 804, 821, 927, 958, 959, 962, 1093, 1246, 1433, 1527, 1548, 1573, 1591, 1592, 1615, 1618, 1672, 1924, 2636, 2637, 2638, 2674, 2675, 1099]) {
    assert.ok(excluded[id], `Missing exclusion for ${id}`);
    assert.ok(!db.some(item => item.wgerIds.includes(id)));
  }
  assert.deepEqual(byId.get('wger-991').wgerIds, [991, 992, 1907]);
  assert.deepEqual(byId.get('wger-988').wgerIds, [988, 989]);
});

test('all source records are reviewed exactly once; existing illustrated exercises stay mapped', () => {
  const referenced = db.flatMap(item => item.wgerIds);
  assert.equal(new Set(referenced).size, referenced.length);
  for (const record of original) assert.equal(Number(referenced.includes(record.id)) + Number(Object.hasOwn(excluded, record.id)), 1, record.name);
  for (const [id, reason] of Object.entries(excluded)) {
    assert.ok(sourceById.has(Number(id)));
    assert.ok(typeof reason === 'string' && reason.length > 0);
  }
  for (const item of db.filter(item => item.source === 'wger')) {
    if (item.wgerIds.some(id => sourceById.get(id).images.length)) {
      assert.ok(item.images.length);
      assert.equal(item.imageSource.source, 'wger');
    }
  }
});

test('checked-in JSON is reproducible with native Node builder and uses LF', () => {
  assert.deepEqual(db, regenerated);
  assert.equal(bytes, `[\n${regenerated.map(item => JSON.stringify(item)).join(',\n')}\n]\n`);
  assert.ok(!bytes.includes('\r'));
});

test('Bulgarian bag entries are app-authored with safe spin and throw cues', () => {
  const bag = db.filter(item => item.equipment === '불가리안백');
  assert.ok(bag.length >= 10);
  for (const item of bag) {
    assert.equal(item.source, 'app');
    assert.deepEqual(item.images, []);
    if (/스핀|스로/.test(item.ko)) assert.ok(item.tips.some(tip => tip.includes('가벼운 무게로 시작, 주변 공간 확보')));
  }
});

 test('image map references, URL count, metadata and download list are consistent', async () => {
  const map = JSON.parse(await readFile(new URL('../data/image-map.json', import.meta.url), 'utf8'));
  const wger = JSON.parse(await readFile(new URL('../data/sources/wger-images.json', import.meta.url), 'utf8'));
  const fedb = JSON.parse(await readFile(new URL('../data/sources/free-exercise-db.json', import.meta.url), 'utf8'));
  const expected = [];
  for (const [id, entry] of Object.entries(map)) {
    assert.ok(byId.has(id), id);
    assert.ok(entry.urls.length >= 1 && entry.urls.length <= 2, id);
    assert.equal(typeof entry.approx, 'boolean');
    assert.ok(entry.note.trim());
    const source = (entry.source === 'wger' ? wger : fedb).find(x => x.id === entry.ref);
    assert.ok(source, id);
    const allowed = entry.source === 'wger' ? wger.flatMap(x => x.images.map(i => i.url)) : source.images.map(p => `https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/${p}`);
    entry.urls.forEach((url, i) => {
      assert.ok(allowed.includes(url), id);
      expected.push(`${url}\timages/${id}-${i + 1}.jpg`);
    });
    assert.equal(byId.get(id).imageSource.ref, entry.ref);
    assert.equal(byId.get(id).imageSource.approx, entry.approx);
    assert.equal(byId.get(id).imageSource.license, entry.source === 'wger' ? 'CC-BY-SA 4.0' : 'Unlicense');
  }
  const { execFileSync } = await import('node:child_process');
  assert.equal(execFileSync(process.execPath, ['tools/build-exercises.mjs', '--image-list'], { encoding: 'utf8' }), expected.join('\n') + '\n');
  const required = [...new Set(defaults().routines.flatMap(r => r.exercises.map(e => e.exerciseId)))];
  assert.equal(required.length, 12);
  console.log('필수 12개 매핑: ' + required.filter(id => map[id]).map(id => `${id} (approx: ${map[id].approx})`).join(', '));
  assert.ok(required.every(id => map[id]));
});
