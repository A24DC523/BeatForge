import type { AudioAnalysis } from './types';

const FRAME_SIZE = 2048;
const MIN_BPM = 70;
const MAX_BPM = 190;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalize(values: number[]) {
  const max = Math.max(...values, 1e-9);
  return values.map((value) => value / max);
}

function buildMonoEnvelope(buffer: AudioBuffer) {
  const { numberOfChannels, length, sampleRate } = buffer;
  const frames = Math.ceil(length / FRAME_SIZE);
  const energy = new Array<number>(frames).fill(0);

  for (let frame = 0; frame < frames; frame += 1) {
    const start = frame * FRAME_SIZE;
    const end = Math.min(start + FRAME_SIZE, length);
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

  const smoothed = energy.map((value, i) => {
    const a = energy[i - 1] ?? value;
    const b = energy[i + 1] ?? value;
    return (a + value * 2 + b) / 4;
  });

  return {
    energy: normalize(smoothed),
    framesPerSecond: sampleRate / FRAME_SIZE,
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

function estimateBpm(onset: number[], framesPerSecond: number) {
  let bestBpm = 120;
  let bestScore = -Infinity;

  for (let bpm = MIN_BPM; bpm <= MAX_BPM; bpm += 0.5) {
    const lag = Math.max(1, Math.round((framesPerSecond * 60) / bpm));
    let score = 0;

    for (let i = lag; i < onset.length; i += 1) {
      score += onset[i] * onset[i - lag];
    }

    const harmonicLag = lag * 2;
    if (harmonicLag < onset.length) {
      let harmonicScore = 0;
      for (let i = harmonicLag; i < onset.length; i += 1) {
        harmonicScore += onset[i] * onset[i - harmonicLag];
      }
      score += harmonicScore * 0.22;
    }

    const tempoPrior = 1 - Math.abs(bpm - 128) / 280;
    score *= tempoPrior;

    if (score > bestScore) {
      bestScore = score;
      bestBpm = bpm;
    }
  }

  return Math.round(bestBpm * 10) / 10;
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
  const { energy, framesPerSecond } = buildMonoEnvelope(buffer);
  const onset = onsetEnvelope(energy);
  const bpm = estimateBpm(onset, framesPerSecond);
  const beatInterval = 60 / bpm;
  let beatOffset = estimateBeatOffset(onset, framesPerSecond, bpm);

  while (beatOffset > beatInterval) beatOffset -= beatInterval;
  beatOffset = clamp(beatOffset, 0, beatInterval);

  const beats: number[] = [];
  for (let time = beatOffset; time < buffer.duration - 0.05; time += beatInterval) {
    if (time >= 0.15) beats.push(time);
  }

  return {
    duration: buffer.duration,
    bpm,
    beatInterval,
    beatOffset,
    beats,
    energy,
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
