import test from 'node:test';
import assert from 'node:assert/strict';
import { cuePlan, sampleRateFor, encodeWav, voiceBounds } from '../audio-render.js';
test('TTS 앞뒤 무음을 제외하고 음성 양쪽에 여유를 남긴다', () => {
  const samples = new Float32Array(1000);
  samples.fill(0.2, 200, 500);
  assert.deepEqual(voiceBounds(samples, 1000), { offset: 0.16, duration: 0.38 });
});
test('음성은 중첩되지 않고 종료 음성도 포함한다', () => {
  const durations = Object.fromEntries(['prepare', 'work', 'cooldown', 'done', 'three', 'two', 'one'].map(k => [k, 0.8]));
  const cues = cuePlan([{ type: 'prepare', start: 0, duration: 1 }, { type: 'work', start: 1, duration: 3 }, { type: 'cooldown', start: 4, duration: 1 }], durations);
  cues.slice(1).forEach((c, i) => assert.ok(c.time >= cues[i].time + durations[cues[i].key]));
  assert.equal(cues.at(-1).key, 'done');
  assert.equal(cues.at(-1).time, 5);
});
test('40분 렌더링 메모리 제한과 과도한 길이 거부', () => {
  assert.equal(sampleRateFor(2400), 8000);
  assert.throws(() => sampleRateFor(7201));
});
test('WAV PCM 헤더와 샘플', () => {
  const wav = encodeWav(new Float32Array([0, 1, -1]), 8000);
  const view = new DataView(wav);
  assert.equal(view.getUint32(24, true), 8000);
  assert.equal(view.getUint32(40, true), 6);
  assert.equal(view.getInt16(46, true), 32767);
  assert.equal(view.getInt16(48, true), -32768);
});
