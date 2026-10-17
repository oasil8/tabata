import test from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../store.js';
const empty = () => ({ version: 1, seeded: true, selectedId: null, routines: [], customExercises: [], hiddenExerciseIds: [] });
const custom = (id = 'custom:a', ko = '내 운동') => ({ id, ko, steps: ['동작'], tips: [], videoUrl: '' });

test('seeds connect exact visible exercise names and preserve version 1', () => {
  const data = store.validateData(store.defaults());
  assert.equal(data.version, 1);
  assert.deepEqual(data.routines[0].exercises.map(e => e.name), ['크런치', '바이시클 크런치', '레그 레이즈', '힐 터치']);
  assert.deepEqual(data.routines[1].exercises.map(e => e.name), ['스윙', '스쿼트', '싱글렉 스쿼트', '싱글렉 스쿼트', '싱글 암 숄더 프레스', '싱글 암 숄더 프레스', 'KB 스내치 & 캐치', '이두컬', '오버헤드 트라이셉스 익스텐션', 'KB 푸시업']);
  assert.ok(data.routines.every(r => r.memo === '' && r.exercises.every(e => e.exerciseId && e.note === '')));
  assert.deepEqual(store.validateData(empty()), empty());
});
test('routine validation retains notes and memo and rejects invalid types and limits', () => {
  const routine = { ...store.defaults().routines[0], memo: '메모', exercises: [{ id: 'entry', name: '내 이름', exerciseId: null, note: '주의' }] };
  assert.deepEqual(store.validateRoutine(routine), routine);
  for (const change of [{ work: 0 }, { rounds: 1.5 }, { memo: 'a'.repeat(2001) }, { memo: null }, { exercises: ['x'] }, { exercises: [routine.exercises[0], routine.exercises[0]] }, { exercises: [{ ...routine.exercises[0], note: 'a'.repeat(201) }] }, { exercises: [{ ...routine.exercises[0], exerciseId: 1 }] }]) assert.throws(() => store.validateRoutine({ ...routine, ...change }));
});
test('custom URL, type, duplicate and dangling custom reference validation', () => {
  const data = { ...empty(), customExercises: [custom()] };
  assert.deepEqual(store.validateData(data), data);
  for (const videoUrl of ['http://example.com', 'javascript:alert(1)', 'https://', 1]) assert.throws(() => store.validateData({ ...data, customExercises: [{ ...custom(), videoUrl }] }));
  assert.doesNotThrow(() => store.validateData({ ...data, customExercises: [{ ...custom(), videoUrl: 'https://example.com/video' }] }));
  for (const change of [{ customExercises: [custom('db-id')] }, { customExercises: [custom(), custom()] }, { customExercises: [{ ...custom(), steps: [1] }] }, { hiddenExerciseIds: [1] }, { hiddenExerciseIds: ['x', 'x'] }, { version: 2 }]) assert.throws(() => store.validateData({ ...data, ...change }));
  const seeded = store.defaults();
  seeded.routines[0].exercises[0].exerciseId = 'custom:missing';
  assert.throws(() => store.validateData(seeded));
});
test('merge remaps colliding custom and routine IDs without mutation', () => {
  assert.equal(typeof store.mergeData, 'function');
  const current = store.defaults();
  current.customExercises = [custom()];
  current.hiddenExerciseIds = ['crunch'];
  const imported = store.defaults();
  imported.customExercises = [custom('custom:a', '다른 운동')];
  imported.routines[0].exercises[0].exerciseId = 'custom:a';
  imported.hiddenExerciseIds = ['crunch', 'heel-touch'];
  const before = JSON.stringify([current, imported]);
  const merged = store.mergeData(current, imported);
  assert.equal(merged.routines.length, 4);
  assert.equal(new Set(merged.routines.map(r => r.id)).size, 4);
  assert.equal(merged.selectedId, current.selectedId);
  assert.equal(merged.customExercises.length, 2);
  assert.notEqual(merged.customExercises[1].id, 'custom:a');
  assert.equal(merged.routines[2].exercises[0].exerciseId, merged.customExercises[1].id);
  assert.deepEqual(merged.hiddenExerciseIds, ['crunch', 'heel-touch']);
  assert.equal(JSON.stringify([current, imported]), before);
  assert.deepEqual(store.validateData(merged), merged);
});
test('merge refuses exceeding routine limit', () => {
  assert.equal(typeof store.mergeData, 'function');
  const data = empty();
  data.routines = Array.from({ length: 100 }, (_, i) => ({ ...store.defaults().routines[0], id: `r${i}` }));
  assert.throws(() => store.mergeData(data, store.defaults()));
});

test('merge reserves incoming IDs and preserves each custom reference on a second collision', () => {
  const current = empty();
  current.customExercises = [custom('custom:a')];
  const imported = store.defaults();
  imported.customExercises = [custom('custom:a', '첫 종목'), custom('custom:a-import-1', '두 번째 종목')];
  imported.routines[0].exercises[0].exerciseId = 'custom:a';
  imported.routines[0].exercises[1].exerciseId = 'custom:a-import-1';
  const merged = store.mergeData(current, imported);
  const byId = new Map(merged.customExercises.map(item => [item.id, item.ko]));
  assert.equal(byId.get(merged.routines[0].exercises[0].exerciseId), '첫 종목');
  assert.equal(byId.get(merged.routines[0].exercises[1].exerciseId), '두 번째 종목');
  assert.equal(merged.selectedId, 'abs');
});

test('backup JSON round trip retains all fields including literal HTML text', () => {
  const data = store.defaults();
  data.routines[0].memo = '<img src=x onerror=alert(1)>\n메모';
  data.routines[0].exercises[0].note = '<script>문자열</script>';
  data.customExercises = [custom()];
  data.hiddenExerciseIds = ['heel-touch'];
  assert.deepEqual(store.validateData(JSON.parse(JSON.stringify(data))), data);
});
test('first run seeds once; empty lists persist; damaged storage is preserved', () => {
  let raw = null;
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => raw, setItem: (_key, value) => { raw = value; } } });
  try {
    assert.equal(store.loadData().data.routines.length, 2);
    assert.equal(JSON.parse(raw).seeded, true);
    assert.equal(store.saveData(empty()), '');
    assert.deepEqual(store.loadData().data, empty());
    raw = '{invalid';
    assert.ok(store.loadData().error);
    assert.equal(raw, '{invalid');
    assert.deepEqual(store.loadData().data, empty());
    globalThis.localStorage.setItem = () => { throw new Error('quota'); };
    assert.ok(store.saveData(store.defaults()));
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});
