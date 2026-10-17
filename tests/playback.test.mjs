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
      setAttribute(name, value) { this[name] = value; },
      show() { this.open = true; }, close() { this.open = false; }, focus() {},
      load() {}, pause() { this.paused = true; this.events.pause?.(); },
      play() { this.paused = false; this.plays = (this.plays || 0) + 1; this.events.play?.(); return Promise.resolve(); },
    });
    return nodes.get(id);
  };
  const jobs = [], idle = [], revoked = [];
  const context = vm.createContext({
    ...store, ...timeline, ...caching, sampleRateFor,
    loadData: () => ({ data: store.defaults(), error: '' }), saveData: () => '',
    document: { getElementById: node, createElement: () => node(Symbol()), addEventListener() {},
      querySelector: () => node('main'),
      querySelectorAll: selector => ['editor', 'exercise-detail', 'custom-editor', ...(selector === 'dialog[open]' ? ['choice-dialog'] : [])].map(node).filter(n => selector !== 'dialog[open]' || n.open) },
    window: { scrollTo() {} },
    navigator: {}, silenceURL: () => 'blob:silent',
    URL: { revokeObjectURL: url => revoked.push(url) },
    requestIdleCallback: fn => idle.push(fn), requestAnimationFrame() {}, cancelAnimationFrame() {},
    createMemo: () => ({ render() {}, flush() { node('memo').flushed = true; }, home() { node('memo').home = true; } }), exerciseFor: () => null,
    renderWorkout: segments => new Promise((resolve, reject) => jobs.push({ segments, resolve, reject })),
  });
  vm.runInContext(readFileSync(new URL('../app.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, ''), context);
  return { node, jobs, idle, revoked, run: code => vm.runInContext(code, context) };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('탭 이동은 모든 창을 닫고 메모를 flush하며 재생을 유지한다', () => {
  const a = app(), audio = a.node('workout-audio');
  audio.paused = false; audio.currentTime = 42;
  for (const name of ['memo', 'memo', 'timer']) {
    for (const id of ['editor', 'exercise-detail', 'custom-editor', 'choice-dialog']) a.node(id).open = true;
    a.node(`${name}-tab`).events.click();
    assert.equal(a.node('memo').flushed, true);
    for (const id of ['editor', 'exercise-detail', 'custom-editor', 'choice-dialog']) assert.equal(a.node(id).open, false);
    assert.equal(a.node(`${name}-view`).hidden, false);
    assert.equal(a.node(`${name}-tab`)['aria-current'], 'page');
    assert.equal(audio.paused, false);
    assert.equal(audio.currentTime, 42);
  }
  assert.equal(a.node('memo').home, true);
});

test('큰 창은 비모달로 열리고 본문만 비활성화하며 닫으면 복구한다', () => {
  const a = app();
  a.run("showSheet($('editor'))");
  assert.equal(a.node('editor').open, true);
  assert.equal(a.node('main').inert, true);
  assert.equal(a.node('sheet-backdrop').hidden, false);
  a.node('editor').close();
  a.node('editor').events.close();
  assert.equal(a.node('main').inert, false);
  assert.equal(a.node('sheet-backdrop').hidden, true);
});

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
