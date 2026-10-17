export function buildSegments(routine) {
  const result = [];
  let start = 0;
  const add = (type, duration, round = 0, cycle = 0) => {
    if (duration > 0) {
      result.push({ type, start, duration, round, cycle });
      start += duration;
    }
  };
  add('prepare', routine.prepare);
  for (let cycle = 1; cycle <= routine.cycles; cycle++) {
    for (let round = 1; round <= routine.rounds; round++) {
      add('work', routine.work, round, cycle);
      // 마지막 라운드의 휴식을 빼면 10 + 8×20 + 7×10 + 1 = 241초.
      if (round < routine.rounds) add('rest', routine.rest, round, cycle);
    }
    if (cycle < routine.cycles) add('cycle_rest', routine.cycleRest, routine.rounds, cycle);
  }
  add('cooldown', routine.cooldown, routine.rounds, routine.cycles);
  return result;
}

export function totalDuration(segments) {
  const last = segments.at(-1);
  return last ? last.start + last.duration : 0;
}

export function positionAt(segments, time) {
  const index = segments.findIndex(s => time < s.start + s.duration);
  if (index < 0) return { index: segments.length, remaining: 0, done: true };
  return { index, remaining: Math.ceil(segments[index].start + segments[index].duration - time), done: false };
}
