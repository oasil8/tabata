export function displayExerciseName(exercises, index) {
  if (!exercises.length) return '';
  const position = index % exercises.length;
  const current = exercises[position];
  const previous = position > 0 ? exercises[position - 1] : null;
  const opposite = previous && (current.exerciseId !== null
    ? current.exerciseId === previous.exerciseId
    : previous.exerciseId === null && current.name === previous.name);
  return current.name + (opposite ? ' (반대쪽)' : '');
}

export function exerciseFor(segments, index, routine) {
  if (!routine.exercises.length) return null;
  const segment = segments[index];
  if (!segment || segment.type === 'cooldown') {
    return { label: '', name: segment ? '마지막이에요 · 수고했어요' : '수고했어요', note: '', exerciseId: null };
  }
  let round = 1;
  if (segment.type === 'work') round = segment.round;
  if (segment.type === 'rest') round = segment.round + 1;
  const position = (round - 1) % routine.exercises.length;
  const exercise = routine.exercises[position];
  return {
    label: segment.type === 'work' ? '' : '다음',
    name: displayExerciseName(routine.exercises, position),
    note: exercise.note,
    exerciseId: exercise.exerciseId,
  };
}
