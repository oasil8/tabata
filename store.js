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

export function defaults() {
  return { version: 1, seeded: true, selectedId: 'abs', routines: [
    { id: 'abs', name: '매일 복근', prepare: 10, work: 20, rest: 10, rounds: 8, cycles: 1, cycleRest: 1, cooldown: 1, exercises: [] },
    { id: 'kb', name: 'KB전신운동', prepare: 15, work: 40, rest: 20, rounds: 10, cycles: 2, cycleRest: 1, cooldown: 1, exercises: [] },
  ] };
}

export function validateRoutine(value) {
  if (!value || typeof value.id !== 'string' || !value.id.trim() || value.id.length > 100 ||
      typeof value.name !== 'string' || !value.name.trim() || value.name.length > 60 ||
      !Array.isArray(value.exercises) || value.exercises.length !== 0) throw new Error('루틴 형식이 올바르지 않습니다.');
  const result = { id: value.id, name: value.name.trim(), exercises: [] };
  for (const [key, label, , min, max] of fields) {
    if (!Number.isInteger(value[key]) || value[key] < min || value[key] > max) throw new Error(`${label}: ${min}~${max} 범위의 정수를 입력하세요.`);
    result[key] = value[key];
  }
  return result;
}

export function validateData(value) {
  if (!value || value.version !== 1 || value.seeded !== true || !Array.isArray(value.routines) || value.routines.length > 100) throw new Error('지원하지 않는 백업 형식입니다. (최대 100개 루틴)');
  const routines = value.routines.map(validateRoutine);
  if (new Set(routines.map(r => r.id)).size !== routines.length) throw new Error('중복된 루틴 ID가 있습니다.');
  if (value.selectedId !== null && !routines.some(r => r.id === value.selectedId)) throw new Error('선택된 루틴 정보가 올바르지 않습니다.');
  return { version: 1, seeded: true, selectedId: value.selectedId, routines };
}

export function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) return { data: validateData(JSON.parse(raw)), error: '' };
    const data = defaults();
    return { data, error: saveData(data) };
  } catch {
    // 손상된 원본을 자동으로 덮어쓰거나 기본 루틴을 다시 주입하지 않는다.
    return { data: { version: 1, seeded: true, selectedId: null, routines: [] }, error: '저장 데이터를 읽지 못했습니다. 백업을 가져오거나 새 루틴을 저장하세요.' };
  }
}

export function saveData(data) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(validateData(data))); return ''; }
  catch { return '기기에 저장하지 못했습니다. 현재 내용은 내보내기로 백업하세요.'; }
}
