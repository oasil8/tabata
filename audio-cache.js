// 오디오 내용을 바꾸는 값(시간·소리 크기)만 비교한다. 이름·종목·메모가 바뀌어도 다시 만들지 않는다.
const audioFields = ['prepare', 'work', 'rest', 'rounds', 'cycles', 'cycleRest', 'cooldown', 'switchVolume', 'countdownVolume'];

export function audioKey(routine) {
  return routine ? JSON.stringify(audioFields.map(key => routine[key])) : null;
}

export function selectAudio(cache, key) {
  return cache.key === key ? cache : { key, version: cache.version + 1, url: null };
}

export function finishAudio(cache, version, url) {
  return cache.version === version
    ? { cache: { ...cache, url }, revoke: cache.url }
    : { cache, revoke: url };
}
