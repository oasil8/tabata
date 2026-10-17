import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSegments, totalDuration, positionAt } from '../segments.js';
const base = { prepare: 10, work: 20, rest: 10, rounds: 8, cycles: 1, cycleRest: 1, cooldown: 1 };
test('기본 루틴은 마지막 휴식을 생략하여 4:01', () => {
  const segments = buildSegments(base);
  assert.equal(totalDuration(segments), 241);
  assert.equal(segments.filter(s => s.type === 'rest').length, 7);
  assert.deepEqual(segments[1], { type: 'work', start: 10, duration: 20, round: 1, cycle: 1 });
});
test('KB전신운동은 19:37, 사이클 사이 휴식은 한 번', () => {
  const segments = buildSegments({ ...base, prepare: 15, work: 40, rest: 20, rounds: 10, cycles: 2 });
  assert.equal(totalDuration(segments), 1177);
  assert.equal(segments.filter(s => s.type === 'cycle_rest').length, 1);
  assert.equal(segments.filter(s => s.type === 'rest').length, 18);
  segments.slice(1).forEach((s, i) => assert.equal(s.start, segments[i].start + segments[i].duration));
});
test('0초 제외, 1라운드·2사이클, 시간 경계와 종료', () => {
  const segments = buildSegments({ ...base, prepare: 0, rest: 0, cooldown: 0, rounds: 1, cycles: 2 });
  assert.deepEqual(segments.map(s => s.type), ['work', 'cycle_rest', 'work']);
  assert.equal(positionAt(segments, 20).index, 1);
  assert.equal(positionAt(segments, 20.2).remaining, 1);
  assert.equal(positionAt(segments, 41).done, true);
});
