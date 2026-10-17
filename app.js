import { buildSegments, totalDuration, positionAt } from './segments.js';
import { defaults, fields, loadData, saveData, validateData, validateRoutine, mergeData } from './store.js';
import { renderWorkout, silenceURL, sampleRateFor } from './audio-render.js';
import { audioKey, selectAudio, finishAudio } from './audio-cache.js';
import { exerciseFor } from './exercise-display.js';
import { createMemo } from './memo.js';

const $ = id => document.getElementById(id);
const labels = { prepare: '준비', work: '운동', rest: '휴식', cycle_rest: '사이클 휴식', cooldown: '쿨다운', done: '완료' };
const format = seconds => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
const loaded = loadData();
let data = loaded.data;
let segments = [];
let cache = { key: null, version: 0, url: null };
let started = false;
let pendingStart = false;
let renderInFlight = false;
let renderScheduled = false;
let wakeLock = null;
let editingId = null;
let frame = 0;
let lastDisplay = '';
const audio = $('workout-audio');
const unlockURL = silenceURL();
const selected = () => data.routines.find(r => r.id === data.selectedId);
const memo = createMemo({ getData: () => data, save: persist, choose, showSheet, changed: () => { lastDisplay = ''; draw(); } });

function syncSheets() {
  const open = [...document.querySelectorAll('.sheet')].some(dialog => dialog.open);
  document.querySelector('main').inert = open;
  $('sheet-backdrop').hidden = !open;
}
function showSheet(dialog) {
  if (!dialog.open) dialog.show();
  // show()가 첫 버튼(취소)에 자동 포커스해 노란 테두리가 생기므로, 창 자체에 포커스를 둔다.
  // (blur만 하면 iOS에서 포커스가 다시 첫 버튼으로 가는 경우가 있다.)
  dialog.tabIndex = -1;
  dialog.focus({ preventScroll: true });
  dialog.scrollTop = 0;
  syncSheets();
}
for (const dialog of document.querySelectorAll('.sheet')) {
  dialog.addEventListener('close', syncSheets);
}
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || $('choice-dialog').open) return;
  const dialog = [...document.querySelectorAll('.sheet')].find(dialog => dialog.open);
  if (dialog) { event.preventDefault(); dialog.close(); syncSheets(); }
});

function message(text, editor = false) {
  const target = $(editor ? 'editor-message' : 'message');
  target.textContent = text;
  target.hidden = !text;
}
function persist() {
  const error = saveData(data);
  message(error, $('editor').open);
}
function releaseWakeLock() {
  const lock = wakeLock;
  wakeLock = null;
  if (lock) lock.release().catch(() => {});
}
async function keepAwake() {
  if (!navigator.wakeLock || wakeLock || document.hidden || audio.paused) return;
  try {
    const lock = await navigator.wakeLock.request('screen');
    if (audio.paused || document.hidden) { await lock.release(); return; }
    wakeLock = lock;
    lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; });
  } catch { /* 화면 잠금 방지는 선택 기능이며 오디오 재생과 독립적이다. */ }
}
function mediaState() {
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
}
function reset() {
  pendingStart = false;
  started = false;
  audio.pause();
  audio.loop = false;
  audio.currentTime = 0;
  releaseWakeLock();
  lastDisplay = '';
  draw();
}
function selectRoutine() {
  reset();
  const routine = selected();
  segments = routine ? buildSegments(routine) : [];
  const nextCache = selectAudio(cache, audioKey(routine));
  if (nextCache !== cache) {
    audio.removeAttribute('src');
    audio.load();
    if (cache.url) URL.revokeObjectURL(cache.url);
    cache = nextCache;
  }
  scheduleRender();
  $('routine-title').textContent = routine?.name || '나의 첫 타이머';
  $('total-time').textContent = format(totalDuration(segments));
  if ('mediaSession' in navigator && 'MediaMetadata' in globalThis) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: routine?.name || '타바타', artist: '나의 운동 시간', artwork: [{ src: new URL('./icons/icon-512.png', location.href).href, sizes: '512x512', type: 'image/png' }] });
  }
  lastDisplay = '';
  draw();
}

function renderNextSegment(position, routine) {
  const exercise = routine ? exerciseFor(segments, position.index, routine) : null;
  const next = segments[position.index + 1];
  $('next-label').textContent = exercise ? exercise.label : '다음 구간';
  $('next-name').textContent = exercise ? exercise.name : next ? labels[next.type] : '완료';
  $('next-time').textContent = exercise ? '' : next ? format(next.duration) : '—';
  $('next-note').textContent = exercise?.note || '';
  $('next-note').hidden = !exercise?.note;
  $('exercise-info').hidden = !exercise?.exerciseId;
  $('exercise-info').onclick = () => memo.showDetail(exercise.exerciseId);
  $('next-segment').classList.toggle('current-exercise', !!exercise && segments[position.index]?.type === 'work');
}
function draw() {
  const routine = selected();
  const time = started ? audio.currentTime : 0;
  const position = positionAt(segments, time);
  const current = segments[position.index];
  const type = routine && position.done ? 'done' : current?.type || 'prepare';
  // 전체 남은 시간: 운동 전체 길이에서 지금까지 재생한 만큼을 뺀 값(초 단위 올림).
  $('total-left').textContent = format(Math.max(0, Math.ceil(totalDuration(segments) - time)));
  const key = `${position.index}:${position.remaining}:${audio.paused}:${started}:${!!routine}`;
  if (lastDisplay !== key) {
    lastDisplay = key;
    $('phase').textContent = routine ? labels[type] : '루틴을 추가하세요';
    $('remaining').textContent = format(position.remaining);
    $('clock-panel').dataset.phase = type;
    $('play-state').textContent = position.done && routine ? '수고하셨습니다' : started ? (audio.paused ? '일시정지' : '진행 중') : '시작할 준비';
    $('play-button').textContent = position.done && started && audio.paused ? '다시 시작' : started ? (audio.paused ? '재개' : '일시정지') : '시작';
    $('play-button').disabled = !routine;
    const rounds = !routine || position.done || type === 'cooldown' ? 0 : type === 'cycle_rest' ? routine.rounds : current?.round ? routine.rounds - current.round + (type === 'work' ? 1 : 0) : routine.rounds;
    const cycles = !routine || position.done || type === 'cooldown' ? 0 : current?.cycle ? routine.cycles - current.cycle + (type === 'cycle_rest' ? 0 : 1) : routine.cycles;
    $('rounds-left').textContent = rounds;
    $('cycles-left').textContent = cycles;
    renderNextSegment(position, routine);
    $('timer-hint').textContent = routine ? '' : '편집에서 새 타이머를 추가해 주세요.';
  }
}
function animate() {
  cancelAnimationFrame(frame);
  draw();
  if (!audio.paused && !document.hidden) frame = requestAnimationFrame(animate);
}
function pause() { pendingStart = false; audio.pause(); }
async function resume() {
  if (!cache.url || pendingStart) return;
  if (!started || audio.currentTime >= totalDuration(segments)) {
    if (audio.getAttribute('src') !== cache.url) audio.src = cache.url;
    audio.currentTime = 0;
  }
  audio.loop = false;
  started = true;
  try { await audio.play(); message(''); }
  catch { message('재생이 제한되었습니다. 재개 버튼을 다시 눌러 주세요.'); }
  draw();
}
function scheduleRender() {
  if (renderScheduled || renderInFlight || cache.url || !cache.key) return;
  renderScheduled = true;
  const run = () => { renderScheduled = false; prepareAudio(); };
  if ('requestIdleCallback' in globalThis) requestIdleCallback(run, { timeout: 1000 });
  else setTimeout(run, 0);
}
async function prepareAudio() {
  if (renderInFlight) return;
  renderInFlight = true;
  try {
    while (cache.key && !cache.url) {
      const version = cache.version;
      try {
        const url = await renderWorkout(segments);
        const result = finishAudio(cache, version, url);
        cache = result.cache;
        if (result.revoke) URL.revokeObjectURL(result.revoke);
      } catch (error) {
        if (version !== cache.version) continue;
        reset();
        message(error.message || '오디오를 만들지 못했습니다. 루틴 길이를 줄여 다시 시도하세요.');
        break;
      }
    }
  } finally {
    renderInFlight = false;
  }
  if (pendingStart && cache.url) {
    pendingStart = false;
    audio.pause();
    await resume();
  }
}
function togglePlay() {
  if (pendingStart || !selected()) return;
  if (started && !audio.paused) { pause(); return; }
  if (cache.url) { resume(); return; }
  try { sampleRateFor(totalDuration(segments)); }
  catch (error) { message(error.message); return; }
  pendingStart = true;
  message('');
  // iOS 사용자 제스처 안에서 같은 미디어 요소를 먼저 play한다. 소스 교체 후 차단되면 재개 탭으로 복구.
  audio.src = unlockURL;
  audio.loop = true;
  audio.play().catch(() => {});
  prepareAudio();
  draw();
}
$('play-button').addEventListener('click', togglePlay);
$('reset-button').addEventListener('click', () => { reset(); message('처음으로 돌아왔습니다.'); });
audio.addEventListener('play', () => { mediaState(); keepAwake(); animate(); });
audio.addEventListener('pause', () => { mediaState(); releaseWakeLock(); draw(); });
audio.addEventListener('ended', () => { releaseWakeLock(); mediaState(); draw(); });
audio.addEventListener('error', () => { if (started) message('오디오를 재생하지 못했습니다. 리셋 후 다시 시작하세요.'); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { keepAwake(); animate(); } });
if ('mediaSession' in navigator) {
  for (const [action, handler] of [['play', resume], ['pause', pause], ['stop', reset]]) {
    try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* 지원되는 잠금 화면 동작만 연결. */ }
  }
}

for (const [key, label, description, min, max] of fields) {
  const row = document.createElement('div');
  row.className = 'field-row';
  const fieldLabel = document.createElement('label');
  fieldLabel.htmlFor = `field-${key}`; fieldLabel.textContent = label;
  const small = document.createElement('small'); small.textContent = description; fieldLabel.append(small);
  const wrap = document.createElement('div'); wrap.className = 'number-wrap';
  const input = document.createElement('input');
  Object.assign(input, { id: `field-${key}`, name: key, type: 'number', inputMode: 'numeric', min, max, step: 1, required: true });
  const unit = document.createElement('span'); unit.textContent = key === 'rounds' || key === 'cycles' ? '개' : '초';
  wrap.append(input, unit); row.append(fieldLabel, wrap);
  $('fields').append(row);
}
function fillEditor(routine) {
  editingId = routine?.id || null;
  const values = routine || { ...defaults().routines[0], name: '' };
  $('routine-name').value = values.name;
  for (const [key] of fields) $(`field-${key}`).value = values[key];
  message('', true);
}
function button(text, action, className = '') {
  const element = document.createElement('button');
  element.type = 'button'; element.textContent = text; element.className = className;
  element.addEventListener('click', action);
  return element;
}
function choose(title, description, actions, stack = false) {
  $('choice-dialog').classList.toggle('stack', stack);
  $('choice-title').textContent = title;
  $('choice-description').textContent = description;
  const buttons = actions.map(([label, action, current]) => button(label, () => { $('choice-dialog').close(); action(); }, current ? 'current' : ''));
  $('choice-actions').replaceChildren(...buttons);
  $('choice-dialog').showModal();
  // 포커스 테두리가 선택된 항목과 따로 보이지 않게, 현재 항목에 포커스를 둔다.
  buttons.find(b => b.classList.contains('current'))?.focus();
}
function pickRoutine(id) {
  data.selectedId = id;
  const error = saveData(data);
  selectRoutine();
  message(error);
}
// 메인 화면의 노란 루틴 이름을 눌러 바로 다른 루틴으로 바꾼다. 운동 중에는 실수로 리셋되지 않게 막는다.
$('routine-title').addEventListener('click', () => {
  if (!audio.paused || !data.routines.length) return;
  choose('운동 목록 변경', '', data.routines.map(r => [r.name, () => pickRoutine(r.id), r.id === data.selectedId]), true);
});
$('routine-title').addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('routine-title').click(); } });
$('choice-cancel').addEventListener('click', () => $('choice-dialog').close());
function renderList() {
  $('routine-count').textContent = `${data.routines.length}개`;
  $('routine-list').replaceChildren();
  for (const routine of data.routines) {
    const card = document.createElement('article');
    card.className = `routine-card${routine.id === data.selectedId ? ' selected' : ''}`;
    const select = button(`${routine.id === data.selectedId ? '✓ ' : ''}${routine.name}`, () => {
      pickRoutine(routine.id); $('editor').close();
    }, 'select-routine');
    select.setAttribute('aria-pressed', String(routine.id === data.selectedId));
    const summary = document.createElement('span');
    summary.textContent = `전체 ${format(totalDuration(buildSegments(routine)))} · 준비 ${routine.prepare}초 · 운동 ${routine.work}초 · 휴식 ${routine.rest}초 · ${routine.rounds}라운드 × ${routine.cycles}사이클 · 사이클 휴식 ${routine.cycleRest}초 · 쿨다운 ${routine.cooldown}초`;
    select.append(summary);
    const actions = document.createElement('div'); actions.className = 'card-actions';
    actions.append(button('수정', () => { fillEditor(routine); $('editor').scrollTop = 0; $('routine-name').focus(); }), button('삭제', () => choose('루틴을 삭제할까요?', routine.name, [['삭제', () => {
      data.routines = data.routines.filter(r => r.id !== routine.id);
      if (data.selectedId === routine.id) { data.selectedId = data.routines[0]?.id || null; selectRoutine(); }
      persist(); if (editingId === routine.id) fillEditor(selected()); renderList();
    }]])));
    card.append(select, actions); $('routine-list').append(card);
  }
}
$('edit-button').addEventListener('click', () => { pause(); fillEditor(selected()); renderList(); showSheet($('editor')); });
$('cancel-edit').addEventListener('click', () => $('editor').close());
// 저장 = 지금 루틴 수정, 새 타이머 추가 = 입력한 값 그대로 새 루틴으로 저장.
function saveRoutine(asNew) {
  try {
    const id = asNew ? null : editingId;
    if (!id && data.routines.length >= 100) throw new Error('루틴은 최대 100개까지 저장할 수 있습니다.');
    const name = $('routine-name').value.trim();
    if (!name) { $('routine-name').focus(); throw new Error('루틴 이름을 입력해 주세요.'); }
    if (asNew && data.routines.some(r => r.name === name)) { $('routine-name').focus(); throw new Error('같은 이름의 루틴이 있어요. 이름을 바꿔 주세요.'); }
    memo.flush();
    const previous = data.routines.find(r => r.id === id);
    const value = { id: id || crypto.randomUUID(), name, exercises: previous?.exercises || [], memo: previous?.memo || '' };
    for (const [key] of fields) value[key] = $(`field-${key}`).value.trim() === '' ? NaN : Number($(`field-${key}`).value);
    const routine = validateRoutine(value);
    if (id) data.routines = data.routines.map(r => r.id === id ? routine : r);
    else data.routines.push(routine);
    data.selectedId = routine.id;
    const error = saveData(data);
    selectRoutine(); fillEditor(routine); renderList();
    if (error) message(error, true);
    else { $('editor').close(); message(asNew ? '새 루틴을 추가했습니다.' : '저장했습니다.'); }
  } catch (error) { message(error.message, true); }
}
$('new-routine').addEventListener('click', () => saveRoutine(true));
$('routine-form').addEventListener('submit', event => { event.preventDefault(); saveRoutine(false); });
$('export-button').addEventListener('click', () => {
  memo.flush();
  const name = `타바타-백업-${new Date().toISOString().slice(0, 10)}.json`;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const download = () => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = name;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    message('백업 파일을 다운로드했습니다.', true);
  };
  // 아이폰 홈 화면 앱은 파일 다운로드가 불안정해 공유 창(파일에 저장·카톡·에어드롭)을 우선 쓴다.
  // share()는 탭 직후 동기적으로 호출해야 하므로 앞에 await를 두지 않는다.
  const file = new File([blob], name, { type: 'application/json' });
  if (!navigator.canShare?.({ files: [file] })) { download(); return; }
  navigator.share({ files: [file], title: '타바타 백업' })
    .then(() => message('백업 파일을 공유했습니다.', true))
    .catch(error => { if (error.name !== 'AbortError') download(); });
});
$('import-button').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async event => {
  const file = event.target.files[0]; event.target.value = '';
  if (!file) return;
  try {
    if (file.size > 64 * 1024 * 1024) throw new Error('64MB 이하의 백업 파일을 선택하세요.');
    const imported = validateData(JSON.parse(await file.text()));
    choose('백업을 가져올까요?', `${imported.routines.length}개 루틴입니다. 병합하면 현재 루틴을 유지하며, 같은 ID의 루틴도 새 ID로 추가합니다. 덮어쓰면 현재 목록을 교체합니다.`, [
      ['병합', () => {
        try { memo.flush(); data = mergeData(data, imported); finishImport(); }
        catch (error) { message(error.message, true); }
      }],
      ['덮어쓰기', () => { memo.flush(); data = imported; finishImport(); }],
    ]);
  } catch (error) { message(`가져오지 못했습니다. ${error instanceof SyntaxError ? '올바른 JSON 파일이 아닙니다.' : error.message}`, true); }
});
function finishImport() { selectRoutine(); fillEditor(selected()); renderList(); memo.render(); persist(); }
function navigateHome(name) {
  memo.flush();
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  syncSheets();
  if (name === 'memo') memo.home();
  for (const tab of ['timer', 'memo']) {
    $(`${tab}-view`).hidden = tab !== name;
    if (tab === name) $(`${tab}-tab`).setAttribute('aria-current', 'page');
    else $(`${tab}-tab`).removeAttribute('aria-current');
  }
  window.scrollTo(0, 0);
  // 탭에 포커스를 주면 노란 테두리가 남으므로 포커스를 비운다.
  document.activeElement?.blur();
}
for (const name of ['timer', 'memo']) {
  $(`${name}-tab`).addEventListener('click', () => navigateHome(name));
}
selectRoutine();
message(loaded.error);
if ('serviceWorker' in navigator) {
  const offlineFailed = () => message('오프라인 준비에 실패했습니다. 인터넷 연결 후 다시 열어 주세요.');
  navigator.serviceWorker.register('./sw.js').then(registration => {
    const watchInstall = () => {
      const worker = registration.installing;
      if (worker) worker.addEventListener('statechange', () => {
        if (worker.state === 'redundant') offlineFailed();
      });
    };
    watchInstall();
    registration.addEventListener('updatefound', watchInstall);
    // 이미지는 설치와 분리해 앱이 열린 뒤 서비스워커에 채우도록 요청한다(없는 것만 받음).
    navigator.serviceWorker.ready.then(ready => ready.active?.postMessage('cache-images'));
    // 홈 화면 앱은 닫아도 다시 '이어서' 열리는 경우가 많아, 화면에 돌아올 때마다 새 버전을 확인한다.
    document.addEventListener('visibilitychange', () => { if (!document.hidden) registration.update().catch(() => {}); });
  }).catch(offlineFailed);
  // 새 버전이 활성화되면 운동 중이 아니고 열린 창이 없을 때 새로고침해 바로 적용한다.
  const isUpdate = !!navigator.serviceWorker.controller;
  let reloadPending = false;
  const reloadIfIdle = () => {
    if (reloadPending && audio.paused && !document.querySelector('dialog[open]')) location.reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!isUpdate) return;
    reloadPending = true;
    reloadIfIdle();
  });
  audio.addEventListener('ended', reloadIfIdle);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) reloadIfIdle(); });
}
// iOS는 user-scalable=no를 무시하므로 핀치 확대를 직접 막는다.
document.addEventListener('gesturestart', event => event.preventDefault());
