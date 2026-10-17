import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import * as store from '../store.js';
import * as timeline from '../segments.js';
import * as caching from '../audio-cache.js';
import { sampleRateFor } from '../audio-render.js';

function app() {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      textContent: '', paused: true, currentTime: 0, dataset: {}, style: {}, events: {},
      classList: { toggle() {} }, append() {}, addEventListener(name, fn) { this.events[name] = fn; },
      removeAttribute(name) { delete this[name]; }, getAttribute(name) { return this[name]; },
      load() {}, pause() { this.paused = true; this.events.pause?.(); },
      play() { this.paused = false; this.plays = (this.plays || 0) + 1; this.events.play?.(); return Promise.resolve(); },
    });
    return nodes.get(id);
  };
  const jobs = [], idle = [], revoked = [];
  const context = vm.createContext({
    ...store, ...timeline, ...caching, sampleRateFor,
    loadData: () => ({ data: store.defaults(), error: '' }), saveData: () => '',
    document: { getElementById: node, createElement: () => node(Symbol()), addEventListener() {} },
    navigator: {}, silenceURL: () => 'blob:silent',
    URL: { revokeObjectURL: url => revoked.push(url) },
    requestIdleCallback: fn => idle.push(fn), requestAnimationFrame() {}, cancelAnimationFrame() {},
    createMemo: () => ({}), exerciseFor: () => null,
    renderWorkout: segments => new Promise((resolve, reject) => jobs.push({ segments, resolve, reject })),
  });
  vm.runInContext(readFileSync(new URL('../app.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, ''), context);
  return { node, jobs, idle, revoked, run: code => vm.runInContext(code, context) };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('첫 화면 이후 사전 렌더링, 동기 재생, 리셋·완료 후 같은 URL 재사용', async () => {
  const a = app(), audio = a.node('workout-audio');
  assert.equal(a.jobs.length, 0);
  assert.equal(a.node('play-button').textContent, '시작');
  a.idle.shift()();
  a.jobs[0].resolve('blob:ready'); await flush();
  a.run('togglePlay()');
  assert.equal(audio.src, 'blob:ready');
  assert.equal(audio.plays, 1, '탭 호출이 끝나기 전에 play 호출');
  audio.currentTime = 20;
  a.run('reset(); togglePlay()');
  assert.equal(audio.currentTime, 0);
  audio.currentTime = 999; audio.paused = true;
  a.run('togglePlay()');
  assert.equal(audio.currentTime, 0);
  assert.equal(a.jobs.length, 1);
  assert.deepEqual(a.revoked, []);
});

test('생성 중 연속 탭은 무시하고 준비 화면 유지, 리셋은 자동 시작 취소', async () => {
  const a = app(), audio = a.node('workout-audio');
  a.run('togglePlay(); togglePlay()');
  assert.equal(audio.src, 'blob:silent');
  assert.equal(audio.plays, 1);
  audio.currentTime = 0.5; a.run('draw()');
  assert.equal(a.node('remaining').textContent, '00:10');
  assert.equal(a.node('play-button').textContent, '시작');
  assert.equal(a.node('message').textContent, '');
  a.run('reset()');
  a.jobs[0].resolve('blob:ready'); await flush();
  assert.equal(audio.paused, true);
  a.run('togglePlay()');
  assert.equal(audio.src, 'blob:ready');
  assert.equal(a.jobs.length, 1);
});

test('렌더링은 직렬로 최신 설정만 생성하고 이전 URL은 폐기', async () => {
  const a = app();
  a.idle.shift()();
  a.run('selected().work = 30; selectRoutine(); selected().work = 40; selectRoutine()');
  assert.equal(a.jobs.length, 1);
  a.jobs[0].resolve('blob:old'); await flush();
  assert.deepEqual(a.revoked, ['blob:old']);
  assert.equal(a.jobs.length, 2);
  assert.equal(a.jobs[1].segments.find(s => s.type === 'work').duration, 40);
  a.run('togglePlay()');
  a.jobs[1].resolve('blob:latest'); await flush();
  assert.equal(a.node('workout-audio').src, 'blob:latest');
  assert.equal(a.node('workout-audio').paused, false);
  a.run('selected().memo = "새 메모"; selectRoutine()');
  assert.equal(a.idle.length, 0);
  a.run('selected().work = 50; selectRoutine()');
  assert.deepEqual(a.revoked, ['blob:old', 'blob:latest']);
});

test('생성 실패는 기존 오류를 표시하고 다시 탭하면 재시도', async () => {
  const a = app();
  a.run('togglePlay()');
  a.jobs[0].reject(new Error('음성을 불러오지 못했습니다.')); await flush();
  assert.equal(a.node('message').textContent, '음성을 불러오지 못했습니다.');
  assert.equal(a.node('workout-audio').paused, true);
  a.run('togglePlay()');
  assert.equal(a.jobs.length, 2);
  a.jobs[1].resolve('blob:retry'); await flush();
  assert.equal(a.node('workout-audio').src, 'blob:retry');
});
