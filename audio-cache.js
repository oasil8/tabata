const timeFields = ['prepare', 'work', 'rest', 'rounds', 'cycles', 'cycleRest', 'cooldown'];

export function audioKey(routine) {
  return routine ? JSON.stringify(timeFields.map(key => routine[key])) : null;
}

export function selectAudio(cache, key) {
  return cache.key === key ? cache : { key, version: cache.version + 1, url: null };
}

export function finishAudio(cache, version, url) {
  return cache.version === version
    ? { cache: { ...cache, url }, revoke: cache.url }
    : { cache, revoke: url };
}
