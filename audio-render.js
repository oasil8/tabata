import { totalDuration } from './segments.js';

const keys = ['prepare', 'work', 'rest', 'cycle_rest', 'cooldown', 'done', 'three', 'two', 'one'];

export function voiceBounds(samples, rate) {
  let first = 0;
  let last = samples.length - 1;
  while (first < last && Math.abs(samples[first]) < 0.003) first++;
  while (last > first && Math.abs(samples[last]) < 0.003) last--;
  const start = Math.max(0, first - Math.round(rate * 0.04));
  const end = Math.min(samples.length, last + 1 + Math.round(rate * 0.04));
  return { offset: start / rate, duration: (end - start) / rate };
}

export function sampleRateFor(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 7200) throw new Error('오디오 생성은 최대 120분까지 가능합니다. 루틴 길이를 줄여 주세요.');
  // 40분: 8kHz 모노 Float32 77MB + PCM16 38MB. Blob/디코더 복사도 있어 상한 120분.
  return seconds <= 1200 ? 16000 : 8000;
}

export function cuePlan(segments, durations) {
  const candidates = [];
  for (const s of segments) {
    candidates.push({ key: s.type, time: s.start, priority: 0, end: s.start + s.duration });
    for (let n = Math.min(3, s.duration); n >= 1; n--) {
      candidates.push({ key: ['one', 'two', 'three'][n - 1], time: s.start + s.duration - n, priority: 1, end: s.start + s.duration });
    }
  }
  candidates.push({ key: 'done', time: totalDuration(segments), priority: 0, end: Infinity });
  candidates.sort((a, b) => a.time - b.time || a.priority - b.priority);
  let freeAt = 0;
  return candidates.filter(c => {
    const end = c.time + durations[c.key];
    if (c.time < freeAt || end > c.end) return false;
    freeAt = end;
    return true;
  });
}

export function encodeWav(samples, rate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const word = (offset, value) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  word(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true);
  word(8, 'WAVE'); word(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  word(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, value * (value < 0 ? 32768 : 32767), true);
  }
  return buffer;
}

export function silenceURL() {
  return URL.createObjectURL(new Blob([encodeWav(new Float32Array(8000), 8000)], { type: 'audio/wav' }));
}

export async function renderWorkout(segments) {
  const duration = totalDuration(segments);
  const rate = sampleRateFor(duration);
  const Offline = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Offline) throw new Error('이 브라우저는 운동 오디오 생성을 지원하지 않습니다.');
  const decoder = new Offline(1, 1, rate);
  const clips = Object.fromEntries(await Promise.all(keys.map(async key => {
    const response = await fetch(`./audio/${key}.wav`);
    if (!response.ok) throw new Error('음성을 불러오지 못했습니다. 인터넷에 연결해 다시 열어 주세요.');
    return [key, await decoder.decodeAudioData(await response.arrayBuffer())];
  })));
  // TTS의 긴 끝 무음 때문에 1초 카운트 음성이 불필요하게 생략되지 않도록 한다.
  const bounds = Object.fromEntries(keys.map(key => [key, voiceBounds(clips[key].getChannelData(0), rate)]));
  const context = new Offline(1, Math.ceil((duration + bounds.done.duration + 0.1) * rate), rate);
  for (const cue of cuePlan(segments, Object.fromEntries(keys.map(key => [key, bounds[key].duration])))) {
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = clips[cue.key]; gain.gain.value = 0.8;
    source.connect(gain).connect(context.destination);
    source.start(cue.time, bounds[cue.key].offset, bounds[cue.key].duration);
  }
  const beep = (time, length) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.12, time + 0.008);
    gain.gain.setValueAtTime(0.12, time + length - 0.02);
    gain.gain.linearRampToValueAtTime(0, time + length);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(time); oscillator.stop(time + length);
  };
  for (const s of segments) {
    beep(s.start, 0.28);
    for (let n = Math.min(3, s.duration - 1); n >= 1; n--) beep(s.start + s.duration - n, 0.09);
  }
  beep(duration, 0.4);
  const rendered = await context.startRendering();
  return URL.createObjectURL(new Blob([encodeWav(rendered.getChannelData(0), rate)], { type: 'audio/wav' }));
}
