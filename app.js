import { buildSegments, totalDuration, positionAt } from './segments.js';
import { defaults, fields, loadData, saveData, validateData, validateRoutine } from './store.js';
import { renderWorkout, silenceURL, sampleRateFor } from './audio-render.js';

const $ = id => document.getElementById(id);
const labels = { prepare: '준비', work: '운동', rest: '휴식', cycle_rest: '사이클 휴식', cooldown: '쿨다운', done: '완료' };
const format = seconds => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
const loaded = loadData();
let data = loaded.data;
let segments = [];
let readyURL = null;
let generation = 0;
let rendering = false;
let renderInFlight = false;
let wakeLock = null;
let editingId = null;
let frame = 0;
let lastDisplay = '';
const audio = $('workout-audio');
const unlockURL = silenceURL();
const selected = () => data.routines.find(r => r.id === data.selectedId);

function message(text, editor = false) {
  const target = $(editor ? 'editor-message' : 'message');
  target.textContent = text;
  target.hidden = !text;
}
function persist() {
  const error = saveData(data);
  message(error || '저장했습니다.', $('editor').open);
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
  generation++;
  rendering = false;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  if (readyURL) URL.revokeObjectURL(readyURL);
  readyURL = null;
  releaseWakeLock();
  lastDisplay = '';
  draw();
}
function selectRoutine() {
  reset();
  const routine = selected();
  segments = routine ? buildSegments(routine) : [];
  $('routine-title').textContent = routine?.name || '나의 첫 타이머';
  $('total-time').textContent = format(totalDuration(segments));
  if ('mediaSession' in navigator && 'MediaMetadata' in globalThis) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: routine?.name || '타바타', artist: '나의 운동 시간', artwork: [{ src: new URL('./icons/icon-512.png', location.href).href, sizes: '512x512', type: 'image/png' }] });
  }
  lastDisplay = '';
  draw();
}

// 2단계 운동 종목 표시가 들어갈 독립된 다음 구간 렌더러.
function renderNextSegment(next) {
  $('next-name').textContent = next ? labels[next.type] : '완료';
  $('next-time').textContent = next ? format(next.duration) : '—';
}
function draw() {
  const routine = selected();
  const time = readyURL ? audio.currentTime : 0;
  const position = positionAt(segments, time);
  const current = segments[position.index];
  const type = routine && position.done ? 'done' : current?.type || 'prepare';
  const key = `${position.index}:${position.remaining}:${audio.paused}:${rendering}:${renderInFlight}:${!!routine}`;
  if (lastDisplay !== key) {
    lastDisplay = key;
    $('phase').textContent = routine ? labels[type] : '루틴을 추가하세요';
    $('remaining').textContent = format(position.remaining);
    $('clock-panel').dataset.phase = type;
    $('play-state').textContent = rendering ? '오디오 준비 중' : position.done && routine ? '수고하셨습니다' : !audio.paused && readyURL ? '진행 중' : readyURL ? '일시정지' : '시작할 준비';
    $('play-button').textContent = rendering ? '준비 중' : position.done && readyURL && audio.paused ? '다시 시작' : !audio.paused && readyURL ? '일시정지' : readyURL ? '재개' : '시작';
    $('play-button').disabled = !routine || renderInFlight;
    const rounds = !routine || position.done || type === 'cooldown' ? 0 : type === 'cycle_rest' ? routine.rounds : current?.round ? routine.rounds - current.round + (type === 'work' ? 1 : 0) : routine.rounds;
    const cycles = !routine || position.done || type === 'cooldown' ? 0 : current?.cycle ? routine.cycles - current.cycle + (type === 'cycle_rest' ? 0 : 1) : routine.cycles;
    $('rounds-left').textContent = rounds;
    $('cycles-left').textContent = cycles;
    renderNextSegment(segments[position.index + 1]);
    $('timer-hint').textContent = routine ? '시작하면 운동 전체의 안내 음성을 준비합니다.' : '편집에서 새 타이머를 추가해 주세요.';
  }
  $('progress').style.width = `${totalDuration(segments) ? Math.min(100, time / totalDuration(segments) * 100) : 0}%`;
}
function animate() {
  cancelAnimationFrame(frame);
  draw();
  if (!audio.paused && !document.hidden) frame = requestAnimationFrame(animate);
}
function pause() { audio.pause(); }
async function resume() {
  if (!readyURL || rendering) return;
  try { await audio.play(); message(''); }
  catch { message('재생이 제한되었습니다. 재개 버튼을 다시 눌러 주세요.'); }
}
async function togglePlay() {
  if (renderInFlight || !selected()) return;
  if (readyURL) {
    if (!audio.paused) { pause(); return; }
    if (audio.currentTime < totalDuration(segments)) { await resume(); return; }
    reset();
  }
  try { sampleRateFor(totalDuration(segments)); }
  catch (error) { message(error.message); return; }
  const token = ++generation;
  rendering = renderInFlight = true;
  message('운동 오디오를 준비하고 있습니다. 준비가 끝날 때까지 이 화면을 열어 두세요.');
  // iOS 사용자 제스처 안에서 같은 미디어 요소를 먼저 play한다. 소스 교체 후 차단되면 재개 탭으로 복구.
  audio.src = unlockURL;
  audio.loop = true;
  const unlocked = audio.play().catch(() => {});
  draw();
  try {
    await unlocked;
    const url = await renderWorkout(segments);
    if (token !== generation) { URL.revokeObjectURL(url); return; }
    audio.pause(); audio.loop = false;
    readyURL = url;
    audio.src = url;
    rendering = false;
    await resume();
  } catch (error) {
    if (token === generation) { reset(); message(error.message || '오디오를 만들지 못했습니다. 루틴 길이를 줄여 다시 시도하세요.'); }
  } finally {
    renderInFlight = false;
    if (token === generation) rendering = false;
    draw();
  }
}
$('play-button').addEventListener('click', togglePlay);
$('reset-button').addEventListener('click', () => { reset(); message('처음으로 돌아왔습니다.'); });
audio.addEventListener('play', () => { mediaState(); keepAwake(); animate(); });
audio.addEventListener('pause', () => { mediaState(); releaseWakeLock(); draw(); });
audio.addEventListener('ended', () => { releaseWakeLock(); mediaState(); draw(); });
audio.addEventListener('error', () => { if (readyURL) message('오디오를 재생하지 못했습니다. 리셋 후 다시 시작하세요.'); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { keepAwake(); animate(); } });
if ('mediaSession' in navigator) {
  for (const [action, handler] of [['play', resume], ['pause', pause], ['stop', reset]]) {
    try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* 지원되는 잠금 화면 동작만 연결. */ }
  }
}

for (const [key, label, description, min, max] of fields) {
  const row = document.createElement('div');
  row.className = 'field-row';
  row.innerHTML = `<label for="field-${key}">${label}<small>${description}</small></label><div class="number-wrap"><input id="field-${key}" name="${key}" type="number" inputmode="numeric" min="${min}" max="${max}" step="1" required><span>${key === 'rounds' || key === 'cycles' ? '개' : '초'}</span></div>`;
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
function choose(title, description, actions) {
  $('choice-title').textContent = title;
  $('choice-description').textContent = description;
  $('choice-actions').replaceChildren(...actions.map(([label, action]) => button(label, () => { $('choice-dialog').close(); action(); })));
  $('choice-dialog').showModal();
}
$('choice-cancel').addEventListener('click', () => $('choice-dialog').close());
function renderList() {
  $('routine-count').textContent = `${data.routines.length}개`;
  $('routine-list').replaceChildren();
  for (const routine of data.routines) {
    const card = document.createElement('article');
    card.className = `routine-card${routine.id === data.selectedId ? ' selected' : ''}`;
    const select = button(`${routine.id === data.selectedId ? '✓ ' : ''}${routine.name}`, () => {
      data.selectedId = routine.id; persist(); selectRoutine(); fillEditor(routine); renderList();
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
$('edit-button').addEventListener('click', () => { pause(); fillEditor(selected()); renderList(); $('editor').showModal(); });
$('cancel-edit').addEventListener('click', () => $('editor').close());
$('new-routine').addEventListener('click', () => { fillEditor(null); $('editor').scrollTop = 0; $('routine-name').focus(); });
$('routine-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    if (!editingId && data.routines.length >= 100) throw new Error('루틴은 최대 100개까지 저장할 수 있습니다.');
    const value = { id: editingId || crypto.randomUUID(), name: $('routine-name').value, exercises: [] };
    for (const [key] of fields) value[key] = $(`field-${key}`).value.trim() === '' ? NaN : Number($(`field-${key}`).value);
    const routine = validateRoutine(value);
    if (editingId) data.routines = data.routines.map(r => r.id === editingId ? routine : r);
    else data.routines.push(routine);
    data.selectedId = routine.id;
    const error = saveData(data);
    selectRoutine(); fillEditor(routine); renderList();
    if (error) message(error, true);
    else { $('editor').close(); message('저장했습니다.'); }
  } catch (error) { message(error.message, true); }
});
$('export-button').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `타바타-백업-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  message('백업 파일을 다운로드했습니다.', true);
});
$('import-button').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async event => {
  const file = event.target.files[0]; event.target.value = '';
  if (!file) return;
  try {
    if (file.size > 1024 * 1024) throw new Error('1MB 이하의 백업 파일을 선택하세요.');
    const imported = validateData(JSON.parse(await file.text()));
    choose('백업을 가져올까요?', `${imported.routines.length}개 루틴입니다. 병합하면 현재 루틴을 유지하며, 같은 ID의 루틴도 새 ID로 추가합니다. 덮어쓰면 현재 목록을 교체합니다.`, [
      ['병합', () => {
        if (data.routines.length + imported.routines.length > 100) { message('병합 후 루틴이 100개를 넘습니다.', true); return; }
        const ids = new Set(data.routines.map(r => r.id));
        const added = imported.routines.map(r => ({ ...r, id: ids.has(r.id) ? crypto.randomUUID() : r.id }));
        data.routines.push(...added); data.selectedId ||= added[0]?.id || null;
        finishImport();
      }],
      ['덮어쓰기', () => { data = imported; finishImport(); }],
    ]);
  } catch (error) { message(`가져오지 못했습니다. ${error instanceof SyntaxError ? '올바른 JSON 파일이 아닙니다.' : error.message}`, true); }
});
function finishImport() { selectRoutine(); fillEditor(selected()); renderList(); persist(); }
for (const name of ['timer', 'memo']) {
  $(`${name}-tab`).addEventListener('click', () => {
    for (const tab of ['timer', 'memo']) {
      $(`${tab}-view`).hidden = tab !== name;
      if (tab === name) $(`${tab}-tab`).setAttribute('aria-current', 'page');
      else $(`${tab}-tab`).removeAttribute('aria-current');
    }
  });
}
selectRoutine();
message(loaded.error);
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').then(() => navigator.serviceWorker.ready).then(() => {
    if (!loaded.error && !$('message').textContent) message('오프라인 준비가 완료되었습니다.');
  }).catch(() => message('오프라인 준비에 실패했습니다. 인터넷 연결 후 다시 열어 주세요.'));
}
