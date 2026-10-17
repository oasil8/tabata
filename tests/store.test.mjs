import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, validateData, validateRoutine, loadData, saveData } from '../store.js';
test('기본 데이터와 삭제 후 빈 목록이 모두 유효', () => {
  assert.equal(validateData(defaults()).routines.length, 2);
  assert.deepEqual(validateData({ version: 1, seeded: true, selectedId: null, routines: [] }).routines, []);
});
test('가져오기에서 범위, 중복 ID, 버전, 종목 데이터 거부', () => {
  const data = defaults();
  assert.throws(() => validateRoutine({ ...data.routines[0], work: 0 }));
  assert.throws(() => validateRoutine({ ...data.routines[0], rounds: 1.5 }));
  assert.throws(() => validateRoutine({ ...data.routines[0], exercises: ['x'] }));
  assert.throws(() => validateData({ ...data, version: 2 }));
  assert.throws(() => validateData({ ...data, routines: [data.routines[0], data.routines[0]] }));
});
test('최초 실행만 기본 루틴 저장, 삭제 목록 유지, 손상 데이터 보존', () => {
  let raw = null;
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => raw, setItem: (_key, value) => { raw = value; } } });
  try {
    assert.equal(loadData().data.routines.length, 2);
    assert.equal(JSON.parse(raw).seeded, true);
    saveData({ version: 1, seeded: true, selectedId: null, routines: [] });
    assert.equal(loadData().data.routines.length, 0);
    raw = '{invalid';
    assert.ok(loadData().error);
    assert.equal(raw, '{invalid');
    globalThis.localStorage.setItem = () => { throw new Error('quota'); };
    assert.ok(saveData(defaults()));
    globalThis.localStorage.getItem = () => { throw new Error('blocked'); };
    assert.ok(loadData().error);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});
