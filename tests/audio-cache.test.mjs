import test from 'node:test';
import assert from 'node:assert/strict';
import { audioKey, selectAudio, finishAudio } from '../audio-cache.js';

test('오디오 캐시는 시간 필드만 비교하고 오래된 결과를 폐기한다', () => {
  const routine = { prepare: 10, work: 20, rest: 10, rounds: 8, cycles: 1, cycleRest: 60, cooldown: 10 };
  const key = audioKey(routine);
  assert.equal(audioKey({ ...routine, name: '변경', exercises: ['새 종목'], memo: '메모' }), key);
  for (const field of Object.keys(routine)) assert.notEqual(audioKey({ ...routine, [field]: routine[field] + 1 }), key);
  const initial = { key: null, version: 0, url: null };
  const a = selectAudio(initial, key);
  const ready = finishAudio(a, a.version, 'blob:a').cache;
  assert.equal(selectAudio(ready, key), ready);
  const b = selectAudio(ready, audioKey({ ...routine, work: 30 }));
  assert.equal(b.url, null);
  const again = selectAudio(b, key);
  assert.deepEqual(finishAudio(again, a.version, 'blob:stale'), { cache: again, revoke: 'blob:stale' });
  assert.deepEqual(finishAudio(again, again.version, 'blob:new'), { cache: { ...again, url: 'blob:new' }, revoke: null });
  assert.equal(selectAudio(ready, audioKey(null)).url, null);
});
