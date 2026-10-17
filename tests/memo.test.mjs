import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemo } from '../memo.js';
import { defaults } from '../store.js';

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.events = {}; this.attributes = {}; this.textContent = ''; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(name, action) { this.events[name] = action; }
  setAttribute(name, value) { this.attributes[name] = value; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  focus() {}
  get lastChild() { return this.children.at(-1); }
}
const descendants = root => [root, ...root.children.flatMap(descendants)];
const click = (root, text) => {
  const node = descendants(root).find(node => node.tag === 'button' && node.textContent === text);
  assert.ok(node, text); node.events.click();
};

test('메모 목록 → 항목 상세, 자동 저장, 이동·삭제와 이미지 실패 안내', async () => {
  const nodes = Object.fromEntries(['memo-view', 'exercise-detail', 'custom-editor'].map(id => [id, new Element('section')]));
  const original = { document: globalThis.document, window: globalThis.window, fetch: globalThis.fetch };
  globalThis.document = { createElement: tag => new Element(tag), getElementById: id => nodes[id], addEventListener() {} };
  globalThis.window = { addEventListener() {} };
  const data = defaults();
  const routine = data.routines[0];
  const entry = routine.exercises[0];
  const id = entry.id;
  globalThis.fetch = async () => ({ ok: true, json: async () => [{ id: entry.exerciseId, ko: '테스트', en: 'Test', category: '복근', equipment: '맨몸', muscles: [], steps: ['동작'], tips: ['주의'], images: ['https://wger.de/test.png'] }] });
  let saves = 0;
  let confirmation;
  try {
    const memo = createMemo({ getData: () => data, save: () => saves++, changed() {}, choose: (...args) => { confirmation = args; } });
    await new Promise(resolve => setImmediate(resolve));
    const view = nodes['memo-view'];
    click(view, routine.name);
    click(view, '편집');
    assert.ok(descendants(view).filter(node => node.className === 'exercise-entry').every(node => node.disabled));
    click(view, '완료');
    assert.equal(descendants(view).filter(node => node.tag === 'textarea').length, 1);
    assert.equal(descendants(view).filter(node => node.tag === 'input' && node.maxLength === 100).length, 1, '검색 입력만 표시');
    descendants(view).find(node => node.className === 'exercise-entry').events.click();
    const note = descendants(view).find(node => node.maxLength === 200);
    assert.ok(note); note.value = '무릎 주의'; note.events.input(); memo.flush();
    assert.equal(entry.note, '무릎 주의'); assert.ok(saves > 0);
    const img = descendants(view).find(node => node.tag === 'img');
    assert.ok(descendants(view).some(node => node.textContent === '이미지는 인터넷 연결 시에만 보여요'));
    img.events.error();
    assert.ok(descendants(view).some(node => node.textContent === '인터넷에 연결되면 이미지가 표시돼요'));
    click(view, '목록에서 숨기기'); assert.ok(data.hiddenExerciseIds.includes(entry.exerciseId));
    click(view, '숨김 해제'); assert.ok(!data.hiddenExerciseIds.includes(entry.exerciseId));
    memo.showDetail(entry.exerciseId);
    assert.ok(descendants(nodes['exercise-detail']).some(node => node.tag === 'img'));
    assert.equal(descendants(nodes['exercise-detail']).filter(node => node.tag === 'button').length, 1, '타이머 시트는 닫기만 허용');
    click(view, '▼'); assert.equal(routine.exercises[1].id, id);
    assert.ok(descendants(view).some(node => node.maxLength === 200), '이동 후 상세 유지');
    click(view, '삭제'); confirmation[2][0][1]();
    assert.ok(!routine.exercises.some(node => node.id === id));
    assert.ok(!descendants(view).some(node => node.maxLength === 200));
    entry.exerciseId = null; routine.exercises.unshift(entry); memo.render();
    descendants(view).find(node => node.className === 'exercise-entry').events.click();
    assert.ok(descendants(view).some(node => node.textContent === '연결된 설명이 없습니다'));
    assert.ok(descendants(view).some(node => node.textContent === '내 종목으로 설명 만들기'));
    assert.ok(!descendants(view).some(node => node.className === 'exercise-image'));
    click(view, '내 종목으로 설명 만들기');
    const form = descendants(nodes['custom-editor']).find(node => node.tag === 'form');
    form.events.submit({ preventDefault() {} });
    assert.ok(entry.exerciseId.startsWith('custom:'));
    assert.equal(data.customExercises.length, 1);
    assert.ok(descendants(view).some(node => node.textContent === entry.name));
    memo.showDetail('missing');
    assert.equal(descendants(nodes['exercise-detail']).filter(node => node.tag === 'button').length, 1);
  } finally { Object.assign(globalThis, original); }
});
