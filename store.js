export const STORAGE_KEY = 'tabata.local.v1';
export const fields = [
  ['prepare', '준비', '운동 전 호흡을 가다듬는 시간', 0, 3600],
  ['work', '운동', '힘을 내어 움직이는 시간', 1, 3600],
  ['rest', '휴식', '라운드 사이 쉬는 시간', 0, 3600],
  ['rounds', '라운드', '1라운드 = 운동 + 휴식 (마지막 휴식 제외)', 1, 99],
  ['cycles', '사이클', '설정한 라운드를 반복하는 횟수', 1, 99],
  ['cycleRest', '사이클 사이 휴식', '다음 사이클 전에 쉬는 시간', 0, 3600],
  ['cooldown', '쿨다운', '모든 운동 후 마무리하는 시간', 0, 3600],
];

const emptyData = () => ({ version: 1, seeded: true, selectedId: null, routines: [], customExercises: [], hiddenExerciseIds: [] });
const entries = (prefix, values) => values.map(([name, exerciseId], i) => ({ id: `${prefix}-${i + 1}`, name, exerciseId, note: '' }));

export function defaults() {
  return { ...emptyData(), selectedId: 'abs', routines: [
    { id: 'abs', name: '매일 복근', prepare: 10, work: 20, rest: 10, rounds: 8, cycles: 1, cycleRest: 1, cooldown: 1, memo: '', exercises: entries('abs', [
      ['크런치', 'crunch'], ['바이시클 크런치', 'bicycle-crunch'], ['레그 레이즈', 'leg-raise'], ['힐 터치', 'heel-touch'],
    ]) },
    { id: 'kb', name: 'KB전신운동', prepare: 15, work: 40, rest: 20, rounds: 10, cycles: 2, cycleRest: 1, cooldown: 1, memo: '', exercises: entries('kb', [
      ['스윙', 'kettlebell-swing'], ['스쿼트', 'goblet-squat'], ['싱글렉 스쿼트', 'pistol-squat'], ['싱글렉 스쿼트', 'pistol-squat'],
      ['싱글 암 숄더 프레스', 'kettlebell-shoulder-press'], ['싱글 암 숄더 프레스', 'kettlebell-shoulder-press'],
      ['KB 스내치 & 캐치', 'kettlebell-snatch-catch'], ['이두컬', 'kettlebell-curl'],
      ['오버헤드 트라이셉스 익스텐션', 'kettlebell-triceps-extension'], ['KB 푸시업', 'kettlebell-pushup'],
    ]) },
  ] };
}

function text(value, max, label, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error(`${label} 형식 또는 길이가 올바르지 않습니다.`);
  return required ? value.trim() : value;
}

function list(value, max, label) {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${label}: 최대 ${max}개까지 저장할 수 있습니다.`);
  return value;
}

function unique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`${label}에 중복된 ID가 있습니다.`);
}

export function validateRoutine(value) {
  if (!value || typeof value !== 'object') throw new Error('루틴 형식이 올바르지 않습니다.');
  const result = {
    id: text(value.id, 100, '루틴 ID', true),
    name: text(value.name, 60, '루틴 이름', true),
    memo: text(value.memo, 2000, '루틴 메모'),
    exercises: list(value.exercises, 200, '루틴 종목').map(item => {
      if (!item || typeof item !== 'object') throw new Error('루틴 종목 형식이 올바르지 않습니다.');
      return {
        id: text(item.id, 100, '종목 ID', true),
        name: text(item.name, 100, '종목 이름', true),
        exerciseId: item.exerciseId === null ? null : text(item.exerciseId, 100, '연결 종목 ID', true),
        note: text(item.note, 200, '종목 주의점'),
      };
    }),
  };
  unique(result.exercises.map(e => e.id), '루틴 종목');
  for (const [key, label, , min, max] of fields) {
    if (!Number.isInteger(value[key]) || value[key] < min || value[key] > max) throw new Error(`${label}: ${min}~${max} 범위의 정수를 입력하세요.`);
    result[key] = value[key];
  }
  return result;
}

export function validateCustomExercise(value) {
  if (!value || typeof value !== 'object') throw new Error('내 종목 형식이 올바르지 않습니다.');
  const id = text(value.id, 100, '내 종목 ID', true);
  if (!id.startsWith('custom:') || id.length <= 7) throw new Error('내 종목 ID는 custom:으로 시작해야 합니다.');
  const videoUrl = text(value.videoUrl, 2000, '영상 주소');
  if (videoUrl) {
    let url;
    try { url = new URL(videoUrl); } catch { throw new Error('올바른 HTTPS 영상 주소를 입력하세요.'); }
    if (!videoUrl.startsWith('https://') || url.protocol !== 'https:' || !url.hostname) throw new Error('영상 주소는 https://로 시작해야 합니다.');
  }
  return {
    id, ko: text(value.ko, 100, '내 종목 이름', true),
    steps: list(value.steps, 20, '동작 설명').map(line => text(line, 500, '동작 설명', true)),
    tips: list(value.tips, 20, '주의점').map(line => text(line, 500, '주의점', true)),
    videoUrl,
  };
}

export function validateData(value) {
  if (!value || value.version !== 1 || value.seeded !== true) throw new Error('지원하지 않는 백업 형식입니다.');
  const routines = list(value.routines, 100, '루틴').map(validateRoutine);
  const customExercises = list(value.customExercises, 500, '내 종목').map(validateCustomExercise);
  const hiddenExerciseIds = list(value.hiddenExerciseIds, 2000, '숨긴 종목').map(id => text(id, 100, '숨긴 종목 ID', true));
  unique(routines.map(r => r.id), '루틴');
  unique(customExercises.map(e => e.id), '내 종목');
  unique(hiddenExerciseIds, '숨긴 종목');
  if (value.selectedId !== null && !routines.some(r => r.id === value.selectedId)) throw new Error('선택한 루틴 정보가 올바르지 않습니다.');
  const customIds = new Set(customExercises.map(e => e.id));
  for (const routine of routines) for (const entry of routine.exercises) {
    if (entry.exerciseId?.startsWith('custom:') && !customIds.has(entry.exerciseId)) throw new Error('연결한 내 종목을 찾을 수 없습니다.');
  }
  return { version: 1, seeded: true, selectedId: value.selectedId, routines, customExercises, hiddenExerciseIds };
}

export function mergeData(current, imported) {
  const result = validateData(current);
  const incoming = validateData(imported);
  // Reserve incoming IDs too so a remapped collision never steals another imported ID.
  const freshId = (id, used) => {
    let suffix = 1;
    let candidate;
    do { candidate = `${id.slice(0, 85)}-import-${suffix++}`; } while (used.has(candidate));
    used.add(candidate);
    return candidate;
  };
  const customIds = new Set(result.customExercises.map(e => e.id));
  const reservedCustomIds = new Set([...customIds, ...incoming.customExercises.map(e => e.id)]);
  const remap = new Map();
  for (const exercise of incoming.customExercises) {
    const id = customIds.has(exercise.id) ? freshId(exercise.id, reservedCustomIds) : exercise.id;
    remap.set(exercise.id, id);
    result.customExercises.push({ ...exercise, id });
  }
  const routineIds = new Set(result.routines.map(r => r.id));
  const reservedRoutineIds = new Set([...routineIds, ...incoming.routines.map(r => r.id)]);
  for (const routine of incoming.routines) {
    result.routines.push({ ...routine,
      id: routineIds.has(routine.id) ? freshId(routine.id, reservedRoutineIds) : routine.id,
      exercises: routine.exercises.map(e => ({ ...e, exerciseId: remap.get(e.exerciseId) ?? e.exerciseId })),
    });
  }
  result.hiddenExerciseIds = [...new Set([...result.hiddenExerciseIds, ...incoming.hiddenExerciseIds])];
  result.selectedId ??= result.routines[0]?.id ?? null;
  return validateData(result);
}

export function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) return { data: validateData(JSON.parse(raw)), error: '' };
    const data = defaults();
    return { data, error: saveData(data) };
  } catch {
    // 손상된 원본은 자동으로 덮거나 기본 루틴을 다시 주입하지 않는다.
    return { data: emptyData(), error: '저장 데이터를 읽지 못했습니다. 백업을 가져오거나 새 루틴을 저장하세요.' };
  }
}

export function saveData(data) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(validateData(data))); return ''; }
  catch { return '기기에 저장하지 못했습니다. 현재 내용은 내보내기로 백업하세요.'; }
}
