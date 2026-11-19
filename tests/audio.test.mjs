import test from 'node:test';
import assert from 'node:assert/strict';
import { cuePlan, sampleRateFor, encodeWav, voiceBounds, volumeGain } from '../audio-render.js';
test('소리 크기 눈금은 0.1=-30dB, 1=0dB이고 0.1마다 같은 dB씩 커진다', () => {
  const db = level => 20 * Math.log10(volumeGain(level));
  assert.ok(Math.abs(db(1)) < 1e-9);
  assert.ok(Math.abs(db(0.1) + 30) < 1e-9);
  for (let level = 0.1; level < 0.95; level += 0.1) assert.ok(Math.abs(db(level + 0.1) - db(level) - 30 / 9) < 1e-9);
  // 기본값은 예전 고정 음량(전환음 0.5, 카운트다운 0.28)과 거의 같게 맞춘다.
  assert.ok(Math.abs(volumeGain(0.8) - 0.5) < 0.05);
  assert.ok(Math.abs(volumeGain(0.7) - 0.3) < 0.05);
});
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
test('준비·운동·휴식은 시작 음성을 넣지 않고 카운트다운·쿨다운·종료 음성은 남긴다', () => {
  const durations = Object.fromEntries(['prepare', 'work', 'rest', 'cycle_rest', 'cooldown', 'done', 'three', 'two', 'one'].map(k => [k, 0.5]));
  const segments = [{ type: 'prepare', start: 0, duration: 5 }, { type: 'work', start: 5, duration: 5 }, { type: 'rest', start: 10, duration: 5 }, { type: 'cycle_rest', start: 15, duration: 5 }, { type: 'cooldown', start: 20, duration: 5 }];
  const keys = cuePlan(segments, durations).map(c => c.key);
  for (const key of ['prepare', 'work', 'rest']) assert.ok(!keys.includes(key));
  for (const key of ['cycle_rest', 'cooldown', 'done', 'three', 'two', 'one']) assert.ok(keys.includes(key));
  assert.equal(keys.filter(k => k === 'three').length, 5);
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
