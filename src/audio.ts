import type { AudioAnalysis } from './types';

const FRAME_SIZE = 2048;
const RHYTHM_WINDOW_SIZE = 1024;
const RHYTHM_HOP_SIZE = 512;
const MIN_BPM = 70;
const MAX_BPM = 190;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalize(values: number[]) {
  let max = 1e-9;
  for (const value of values) {
    if (value > max) max = value;
  }
  return values.map((value) => value / max);
}

function smooth(values: number[]) {
  return values.map((value, i) => {
    const a = values[i - 1] ?? value;
    const b = values[i + 1] ?? value;
    return (a + value * 2 + b) / 4;
  });
}

function normalizeBands(low: number[], mid: number[], high: number[]) {
  let max = 1e-9;
  for (const list of [low, mid, high]) {
    for (const value of list) {
      if (value > max) max = value;
    }
  }
  return {
    low: low.map((value) => value / max),
    mid: mid.map((value) => value / max),
    high: high.map((value) => value / max),
  };
}

function buildAudioEnvelopes(buffer: AudioBuffer) {
  const { numberOfChannels, length, sampleRate } = buffer;
  const frames = Math.ceil(length / FRAME_SIZE);
  const energy = new Array<number>(frames).fill(0);
  const low = new Array<number>(frames).fill(0);
  const mid = new Array<number>(frames).fill(0);
  const high = new Array<number>(frames).fill(0);

  const stride = 4;
  const effectiveRate = sampleRate / stride;
  const lowCut = Math.min(220, effectiveRate * 0.18);
  const midCut = Math.min(2400, effectiveRate * 0.42);
  const lowDecay = Math.exp((-2 * Math.PI * lowCut) / effectiveRate);
  const midDecay = Math.exp((-2 * Math.PI * midCut) / effectiveRate);
  const lowState = new Array<number>(numberOfChannels).fill(0);
  const midState = new Array<number>(numberOfChannels).fill(0);

  for (let frame = 0; frame < frames; frame += 1) {
    const start = frame * FRAME_SIZE;
    const end = Math.min(start + FRAME_SIZE, length);
    let fullSum = 0;
    let lowSum = 0;
    let midSum = 0;
    let highSum = 0;
    let count = 0;

    for (let channel = 0; channel < numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel);
      let lpLow = lowState[channel];
      let lpMid = midState[channel];

      for (let i = start; i < end; i += stride) {
        const sample = data[i] ?? 0;
        lpLow = (1 - lowDecay) * sample + lowDecay * lpLow;
        lpMid = (1 - midDecay) * sample + midDecay * lpMid;

        const lowBand = lpLow;
        const midBand = lpMid - lpLow;
        const highBand = sample - lpMid;

        fullSum += sample * sample;
        lowSum += lowBand * lowBand;
        midSum += midBand * midBand;
        highSum += highBand * highBand;
        count += 1;
      }

      lowState[channel] = lpLow;
      midState[channel] = lpMid;
    }

    if (count > 0) {
      energy[frame] = Math.sqrt(fullSum / count);
      low[frame] = Math.sqrt(lowSum / count);
      mid[frame] = Math.sqrt(midSum / count);
      high[frame] = Math.sqrt(highSum / count);
    }
  }

  const smoothedEnergy = smooth(energy);
  const bands = normalizeBands(smooth(low), smooth(mid), smooth(high));

  return {
    energy: normalize(smoothedEnergy),
    bands,
    framesPerSecond: sampleRate / FRAME_SIZE,
  };
}

function buildRhythmEnvelope(buffer: AudioBuffer) {
  const { numberOfChannels, length, sampleRate } = buffer;
  const frames = Math.max(
    1,
    Math.floor(Math.max(0, length - RHYTHM_WINDOW_SIZE) / RHYTHM_HOP_SIZE) + 1,
  );
  const energy = new Array<number>(frames).fill(0);

  for (let frame = 0; frame < frames; frame += 1) {
    const start = frame * RHYTHM_HOP_SIZE;
    const end = Math.min(start + RHYTHM_WINDOW_SIZE, length);
    let sum = 0;
    let count = 0;

    for (let channel = 0; channel < numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let i = start; i < end; i += 4) {
        const sample = data[i] ?? 0;
        sum += sample * sample;
        count += 1;
      }
    }

    energy[frame] = count > 0 ? Math.sqrt(sum / count) : 0;
  }

  return {
    energy: normalize(smooth(energy)),
    framesPerSecond: sampleRate / RHYTHM_HOP_SIZE,
  };
}

function onsetEnvelope(energy: number[]) {
  const onset = energy.map((value, i) => {
    const prev = energy[i - 1] ?? value;
    const prev2 = energy[i - 2] ?? prev;
    return Math.max(0, value - prev) + Math.max(0, value - prev2) * 0.35;
  });

  return normalize(onset);
}

function sampleEnvelope(values: number[], index: number) {
  if (index <= 0) return values[0] ?? 0;
  if (index >= values.length - 1) return values[values.length - 1] ?? 0;
  const left = Math.floor(index);
  const fraction = index - left;
  const a = values[left] ?? 0;
  const b = values[left + 1] ?? a;
  return a + (b - a) * fraction;
}

function estimateBpmRange(
  onset: number[],
  framesPerSecond: number,
  startFrame = 0,
  endFrame = onset.length,
  priorBpm = 128,
  priorStrength = 1,
) {
  let bestBpm = 120;
  let bestScore = -Infinity;
  const start = Math.max(0, Math.floor(startFrame));
  const end = Math.min(onset.length, Math.ceil(endFrame));

  for (let bpm = MIN_BPM; bpm <= MAX_BPM; bpm += 0.5) {
    const lag = Math.max(1, (framesPerSecond * 60) / bpm);
    let score = 0;
    const first = Math.max(start + Math.ceil(lag), Math.ceil(lag));

    for (let i = first; i < end; i += 1) {
      const previous = i - lag;
      if (previous < start) continue;
      score += (onset[i] ?? 0) * sampleEnvelope(onset, previous);
    }

    const harmonicLag = lag * 2;
    if (start + harmonicLag < end) {
      let harmonicScore = 0;
      for (let i = start + Math.ceil(harmonicLag); i < end; i += 1) {
        harmonicScore += (onset[i] ?? 0) * sampleEnvelope(onset, i - harmonicLag);
      }
      score += harmonicScore * 0.22;
    }

    const priorPenalty = Math.min(0.24, Math.abs(bpm - priorBpm) / 280) * priorStrength;
    score *= 1 - priorPenalty;

    if (score > bestScore) {
      bestScore = score;
      bestBpm = bpm;
    }
  }

  return Math.round(bestBpm * 10) / 10;
}

function estimateBpm(onset: number[], framesPerSecond: number) {
  return estimateBpmRange(onset, framesPerSecond);
}

function detectTempoMap(
  onset: number[],
  framesPerSecond: number,
  duration: number,
  globalBpm: number,
) {
  if (duration < 12) {
    return [{ start: 0, end: duration, bpm: globalBpm, beatInterval: 60 / globalBpm }];
  }

  const windowSeconds = 8;
  const raw: Array<{ start: number; end: number; bpm: number }> = [];

  for (let start = 0; start < duration; start += windowSeconds) {
    const end = Math.min(duration, start + windowSeconds);
    if (end - start < 4 && raw.length > 0) {
      raw[raw.length - 1].end = end;
      break;
    }

    const bpm = estimateBpmRange(
      onset,
      framesPerSecond,
      start * framesPerSecond,
      end * framesPerSecond,
      globalBpm,
      0.35,
    );
    raw.push({ start, end, bpm });
  }

  const merged: Array<{ start: number; end: number; bpm: number; beatInterval: number }> = [];
  for (const segment of raw) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      (
        Math.abs(segment.bpm - previous.bpm) <= 5 ||
        Math.abs(segment.bpm - previous.bpm) / Math.max(previous.bpm, 1) <= 0.04
      )
    ) {
      const previousDuration = previous.end - previous.start;
      const nextDuration = segment.end - segment.start;
      const weighted =
        (previous.bpm * previousDuration + segment.bpm * nextDuration) /
        Math.max(previousDuration + nextDuration, 0.001);
      previous.end = segment.end;
      previous.bpm = Math.round(weighted * 10) / 10;
      previous.beatInterval = 60 / previous.bpm;
    } else {
      merged.push({
        start: segment.start,
        end: segment.end,
        bpm: segment.bpm,
        beatInterval: 60 / segment.bpm,
      });
    }
  }

  return merged.length
    ? merged
    : [{ start: 0, end: duration, bpm: globalBpm, beatInterval: 60 / globalBpm }];
}

function estimateBeatOffset(onset: number[], framesPerSecond: number, bpm: number) {
  const period = Math.max(1, Math.round((framesPerSecond * 60) / bpm));
  let bestPhase = 0;
  let bestScore = -Infinity;

  for (let phase = 0; phase < period; phase += 1) {
    let score = 0;
    let weight = 1;
    for (let i = phase; i < onset.length; i += period) {
      score += onset[i] * weight;
      weight *= 0.998;
    }
    if (score > bestScore) {
      bestScore = score;
      bestPhase = phase;
    }
  }

  return bestPhase / framesPerSecond;
}

function buildBeatGrid(
  onset: number[],
  framesPerSecond: number,
  duration: number,
  tempoMap: Array<{ start: number; end: number; bpm: number; beatInterval: number }>,
  globalBeatOffset: number,
  globalBeatInterval: number,
) {
  const beats: number[] = [];

  if (tempoMap.length <= 1) {
    for (let time = globalBeatOffset; time < duration - 0.05; time += globalBeatInterval) {
      if (time >= 0.15) beats.push(time);
    }
    return beats;
  }

  for (const segment of tempoMap) {
    const startFrame = Math.max(0, Math.floor(segment.start * framesPerSecond));
    const endFrame = Math.min(onset.length, Math.ceil(segment.end * framesPerSecond));
    const localOnset = onset.slice(startFrame, endFrame);
    const localOffset = estimateBeatOffset(localOnset, framesPerSecond, segment.bpm);
    const interval = segment.beatInterval;

    for (
      let time = segment.start + localOffset;
      time < Math.min(segment.end, duration - 0.05);
      time += interval
    ) {
      if (time >= 0.15) beats.push(time);
    }
  }

  beats.sort((a, b) => a - b);
  const deduped: number[] = [];
  for (const beat of beats) {
    const previous = deduped[deduped.length - 1];
    if (previous !== undefined && beat - previous < 0.09) continue;
    deduped.push(beat);
  }
  return deduped;
}

function detectPeaks(onset: number[], framesPerSecond: number) {
  const sorted = [...onset].sort((a, b) => a - b);
  const threshold = sorted[Math.floor(sorted.length * 0.72)] ?? 0.35;
  const peaks: number[] = [];
  let lastTime = -1;

  for (let i = 1; i < onset.length - 1; i += 1) {
    const value = onset[i];
    if (value < threshold || value < onset[i - 1] || value < onset[i + 1]) continue;

    const time = i / framesPerSecond;
    if (time - lastTime < 0.09) continue;
    peaks.push(time);
    lastTime = time;
  }

  return peaks;
}

export async function analyzeAudioBuffer(buffer: AudioBuffer): Promise<AudioAnalysis> {
  const { energy, bands } = buildAudioEnvelopes(buffer);
  const rhythm = buildRhythmEnvelope(buffer);
  const framesPerSecond = rhythm.framesPerSecond;
  const onset = onsetEnvelope(rhythm.energy);
  const bpm = estimateBpm(onset, framesPerSecond);
  const beatInterval = 60 / bpm;
  let beatOffset = estimateBeatOffset(onset, framesPerSecond, bpm);

  while (beatOffset > beatInterval) beatOffset -= beatInterval;
  beatOffset = clamp(beatOffset, 0, beatInterval);

  const tempoMap = detectTempoMap(onset, framesPerSecond, buffer.duration, bpm);
  const beats = buildBeatGrid(
    onset,
    framesPerSecond,
    buffer.duration,
    tempoMap,
    beatOffset,
    beatInterval,
  );

  return {
    duration: buffer.duration,
    bpm,
    beatInterval,
    beatOffset,
    tempoMap,
    beats,
    energy,
    bands,
    peaks: detectPeaks(onset, framesPerSecond),
    sampleRate: buffer.sampleRate,
  };
}

export async function decodeAudioFile(file: File): Promise<{ buffer: AudioBuffer; analysis: AudioAnalysis }> {
  const bytes = await file.arrayBuffer();
  const context = new AudioContext();

  try {
    const buffer = await context.decodeAudioData(bytes.slice(0));
    const analysis = await analyzeAudioBuffer(buffer);
    return { buffer, analysis };
  } finally {
    await context.close();
  }
}

export async function fetchAudioUrl(url: string): Promise<File> {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('只支援 http / https 音訊網址。');
  }

  const response = await fetch(parsed.toString(), { mode: 'cors' });
  if (!response.ok) {
    throw new Error(`無法讀取音訊（HTTP ${response.status}）。`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.startsWith('audio/') && !/\.(mp3|wav|m4a|aac|ogg|flac)(\?|$)/i.test(parsed.pathname + parsed.search)) {
    throw new Error('這個網址不是可直接讀取的音訊檔案。');
  }

  const blob = await response.blob();
  const filename = decodeURIComponent(parsed.pathname.split('/').pop() || 'remote-audio');
  return new File([blob], filename, { type: blob.type || contentType || 'audio/mpeg' });
}
