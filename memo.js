import { displayExerciseName } from './exercise-display.js';
import { validateData } from './store.js';

const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const button = (text, action) => {
  const node = el('button', text);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
};
const input = (label, value, maxLength, multiline = false) => {
  const wrapper = el('label', label, 'memo-field');
  const field = el(multiline ? 'textarea' : 'input');
  field.value = value;
  field.maxLength = maxLength;
  wrapper.append(field);
  return [wrapper, field];
};
const link = (text, url) => {
  const node = el('a', text, 'external-link');
  node.href = url;
  node.target = '_blank';
  node.rel = 'noopener noreferrer';
  return node;
};

export function createMemo({ getData, save, choose, changed }) {
  const view = document.getElementById('memo-view');
  const detail = document.getElementById('exercise-detail');
  const editor = document.getElementById('custom-editor');
  let database = [];
  let databaseError = '';
  let routineId = null;
  let screen = 'list';
  let saveTimer;
  let pending = false;
  const all = () => [...database, ...getData().customExercises];
  const find = id => all().find(item => item.id === id);
  function flush() {
    clearTimeout(saveTimer);
    if (pending) { pending = false; save(); changed(); }
  }
  function autosave() {
    pending = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 400);
  }
  function commit() { pending = true; flush(); }
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });

  async function load() {
    try {
      const response = await fetch('./data/exercises.json');
      if (!response.ok) throw new Error('DB');
      database = await response.json();
      databaseError = '';
    } catch {
      databaseError = '운동 목록을 불러오지 못했습니다. 인터넷 연결 후 다시 시도하세요.';
    }
    render();
    changed();
  }
  function showDetail(id) {
    const item = find(id);
    detail.replaceChildren(button('닫기', () => detail.close()));
    if (!item) {
      detail.append(el('p', '연결된 종목 정보가 없습니다. 운동 목록을 불러온 뒤 다시 확인하세요.'));
    } else {
      const custom = getData().customExercises.some(entry => entry.id === id);
      detail.append(el('h2', item.ko));
      if (item.en) detail.append(el('p', item.en));
      if (!custom) detail.append(el('p', [item.category, item.equipment, ...item.muscles].join(' · ')));
      for (const [title, lines, tag] of [['동작 순서', item.steps, 'ol'], ['주의점', item.tips, 'ul']]) {
        detail.append(el('h3', title));
        const list = el(tag);
        for (const line of lines) list.append(el('li', line));
        detail.append(list);
      }
      for (const url of item.images || []) {
        const image = el('img');
        image.alt = `${item.ko} 동작`;
        image.loading = 'lazy';
        image.addEventListener('error', () => { image.hidden = true; });
        image.src = url;
        detail.append(image);
      }
      detail.append(link('유튜브에서 자세 보기', `https://www.youtube.com/results?search_query=${encodeURIComponent((item.en || item.ko) + ' form')}`));
      if (custom && item.videoUrl) detail.append(link('저장한 영상 보기', item.videoUrl));
      if (!custom) {
        detail.append(button(getData().hiddenExerciseIds.includes(id) ? '숨김 해제' : '목록에서 숨기기', () => {
          const data = getData();
          data.hiddenExerciseIds = data.hiddenExerciseIds.includes(id)
            ? data.hiddenExerciseIds.filter(value => value !== id) : [...data.hiddenExerciseIds, id];
          commit(); render(); showDetail(id);
        }));
      }
    }
    if (!detail.open) detail.showModal();
  }
  function editCustom(existing, initialName = '', afterSave) {
    editor.replaceChildren();
    const form = el('form');
    form.append(el('h2', existing ? '내 종목 수정' : '내 종목 만들기'));
    const [nameLabel, name] = input('이름', existing?.ko || initialName, 100);
    const [stepsLabel, steps] = input('동작 설명 (한 줄에 하나)', existing?.steps.join('\n') || '', 4000, true);
    const [tipsLabel, tips] = input('주의점 (한 줄에 하나)', existing?.tips.join('\n') || '', 2000, true);
    const [urlLabel, url] = input('영상 링크 (https://)', existing?.videoUrl || '', 2000);
    const status = el('p', '', 'message');
    status.hidden = true;
    const submit = el('button', '저장');
    submit.type = 'submit';
    form.append(nameLabel, stepsLabel, tipsLabel, urlLabel, status, submit, button('취소', () => editor.close()));
    form.addEventListener('submit', event => {
      event.preventDefault();
      try {
        const lines = field => field.value.split('\n').map(value => value.trim()).filter(Boolean);
        const item = { id: existing?.id || `custom:${crypto.randomUUID()}`, ko: name.value.trim(), steps: lines(steps), tips: lines(tips), videoUrl: url.value.trim() };
        const data = getData();
        const customExercises = existing ? data.customExercises.map(entry => entry.id === item.id ? item : entry) : [...data.customExercises, item];
        validateData({ ...data, customExercises });
        data.customExercises = customExercises;
        commit(); editor.close();
        if (afterSave) afterSave(item);
        render();
      } catch (error) { status.textContent = error.message; status.hidden = false; }
    });
    editor.append(form);
    editor.showModal();
    name.focus();
  }
  function addExercise(routine, item) {
    if (routine.exercises.length >= 200) {
      choose('종목 수 제한', '루틴에는 최대 200개 종목을 추가할 수 있습니다.', []);
      return;
    }
    routine.exercises.push({ id: crypto.randomUUID(), name: item.ko, exerciseId: item.id, note: '' });
    commit(); render();
  }
  function renderSearch(routine) {
    const area = el('section', undefined, 'exercise-search');
    area.append(el('h2', '종목 추가'));
    const [searchLabel, search] = input('한국어 / 영어 검색', '', 100);
    search.type = 'search';
    const chips = el('div', undefined, 'filter-chips');
    const results = el('div', undefined, 'search-results');
    let category = '전체';
    function resultsFor() {
      const query = search.value.trim().toLocaleLowerCase();
      const matches = all().filter(item => !getData().hiddenExerciseIds.includes(item.id)
        && (category === '전체' || item.category === category || item.equipment === category)
        && `${item.ko} ${item.en || ''}`.toLocaleLowerCase().includes(query));
      results.replaceChildren();
      for (const item of matches) {
        const row = el('div', undefined, 'search-result');
        row.append(button(item.ko, () => addExercise(routine, item)), button('ⓘ', () => showDetail(item.id)));
        row.lastChild.setAttribute('aria-label', `${item.ko} 상세`);
        results.append(row);
      }
      if (!matches.length) {
        results.append(el('p', '검색 결과가 없습니다.'));
        if (query) results.append(button(`'${search.value.trim()}'을(를) 내 종목으로 만들기`, () => editCustom(null, search.value.trim(), item => addExercise(routine, item))));
      }
    }
    for (const value of ['전체', '복근', '가슴', '팔', '어깨', '등', '하체', '종아리', '유산소', '스트레칭', '케틀벨']) {
      const chip = button(value, () => {
        category = value;
        for (const child of chips.children) child.setAttribute('aria-pressed', String(child === chip));
        resultsFor();
      });
      chip.setAttribute('aria-pressed', String(value === category));
      chips.append(chip);
    }
    search.addEventListener('input', resultsFor);
    area.append(searchLabel, chips, results);
    resultsFor();
    view.append(area);
  }
  function renderRoutine(routine) {
    view.append(button('‹ 루틴 목록', () => { flush(); screen = 'list'; render(); }), el('h1', routine.name));
    const [memoLabel, memo] = input('루틴 자유 메모 (최대 2000자)', routine.memo, 2000, true);
    memo.addEventListener('input', () => { routine.memo = memo.value; autosave(); });
    memo.addEventListener('blur', flush);
    view.append(memoLabel, el('h2', '운동 순서'));
    if (routine.exercises.length && routine.rounds !== routine.exercises.length) {
      view.append(el('p', `${routine.rounds}라운드 동안 ${routine.exercises.length}개 종목을 순서대로 반복합니다.`, 'hint'));
    }
    if (!routine.exercises.length) view.append(el('p', '아래에서 종목을 추가하세요.'));
    routine.exercises.forEach((entry, index) => {
      const card = el('article', undefined, 'exercise-row');
      card.append(el('h3', `${index + 1}. ${displayExerciseName(routine.exercises, index)}`));
      const [nameLabel, name] = input('표시 이름', entry.name, 100);
      name.addEventListener('input', () => {
        if (!name.value.trim()) return;
        entry.name = name.value.trim();
        view.querySelectorAll('.exercise-row h3').forEach((heading, position) => {
          heading.textContent = `${position + 1}. ${displayExerciseName(routine.exercises, position)}`;
        });
        autosave();
      });
      name.addEventListener('blur', () => { name.value = entry.name; flush(); });
      const [noteLabel, note] = input('주의점 (최대 200자)', entry.note, 200);
      note.addEventListener('input', () => { entry.note = note.value; autosave(); });
      note.addEventListener('blur', flush);
      const actions = el('div', undefined, 'button-row');
      const info = button('ⓘ 상세', () => showDetail(entry.exerciseId));
      info.disabled = !entry.exerciseId;
      const move = offset => {
        flush();
        [routine.exercises[index], routine.exercises[index + offset]] = [routine.exercises[index + offset], entry];
        commit(); render();
      };
      const up = button('▲', () => move(-1)); up.disabled = index === 0; up.setAttribute('aria-label', `${entry.name} 위로`);
      const down = button('▼', () => move(1)); down.disabled = index === routine.exercises.length - 1; down.setAttribute('aria-label', `${entry.name} 아래로`);
      actions.append(info, up, down, button('삭제', () => choose('종목을 삭제할까요?', entry.name, [['삭제', () => {
        routine.exercises = routine.exercises.filter(item => item.id !== entry.id);
        commit(); render();
      }]])));
      card.append(nameLabel, noteLabel, actions);
      view.append(card);
    });
    renderSearch(routine);
  }
  function renderManage() {
    view.append(button('‹ 루틴 목록', () => { screen = 'list'; render(); }), el('h1', '내 종목 관리'), button('＋ 내 종목 만들기', () => editCustom(null)));
    for (const item of getData().customExercises) {
      const row = el('article', undefined, 'exercise-row');
      const actions = el('div', undefined, 'button-row');
      actions.append(button('상세', () => showDetail(item.id)), button('수정', () => editCustom(item)), button('삭제', () => choose('내 종목을 삭제할까요?', '루틴에 있는 표시 이름과 주의점은 유지됩니다.', [['삭제', () => {
        const data = getData();
        data.customExercises = data.customExercises.filter(entry => entry.id !== item.id);
        for (const routine of data.routines) for (const entry of routine.exercises) if (entry.exerciseId === item.id) entry.exerciseId = null;
        commit(); render();
      }]])));
      row.append(el('h2', item.ko), actions); view.append(row);
    }
    view.append(el('h2', '숨긴 DB 종목'));
    for (const id of getData().hiddenExerciseIds) {
      const row = el('div', undefined, 'search-result');
      row.append(el('span', find(id)?.ko || id), button('숨김 해제', () => {
        getData().hiddenExerciseIds = getData().hiddenExerciseIds.filter(value => value !== id);
        commit(); render();
      }));
      view.append(row);
    }
  }
  function render() {
    view.replaceChildren();
    if (databaseError) view.append(el('p', databaseError, 'message'), button('목록 다시 불러오기', load));
    const routine = getData().routines.find(item => item.id === routineId);
    if (screen === 'manage') renderManage();
    else if (screen === 'routine' && routine) renderRoutine(routine);
    else {
      screen = 'list';
      view.append(el('h1', '루틴 메모'));
      for (const item of getData().routines) view.append(button(item.name, () => { routineId = item.id; screen = 'routine'; render(); }));
      if (!getData().routines.length) view.append(el('p', '타이머 편집에서 루틴을 먼저 만들어 주세요.'));
      view.append(button('내 종목 관리', () => { screen = 'manage'; render(); }));
    }
    const info = el('footer', undefined, 'source-info');
    info.append(el('h2', '정보'), el('p', '운동 정보 일부 출처: wger.de (CC-BY-SA 4.0), 한국어 번역·편집'), link('wger.de', 'https://wger.de/'), link('CC-BY-SA 4.0', 'https://creativecommons.org/licenses/by-sa/4.0/'));
    view.append(info);
  }
  load();
  return { render, flush, showDetail };
}
