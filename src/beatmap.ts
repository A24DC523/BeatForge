import type { AudioAnalysis, Beatmap, DifficultyId, DifficultyPreset, HitObject } from './types';
import { validateAndRepairObjects } from './validator';

export const DIFFICULTIES: DifficultyPreset[] = [
  {
    id: 'easy',
    label: 'EASY',
    description: '強拍與樂句骨架，保持清晰節奏',
    density: 0.48,
    minGapMs: 420,
    approachMs: 1350,
    hitWindowMs: 185,
    holdChance: 0.045,
    slideChance: 0.045,
    starBase: 1.6,
  },
  {
    id: 'normal',
    label: 'NORMAL',
    description: '完整主拍、重音與自然樂句變化',
    density: 0.78,
    minGapMs: 270,
    approachMs: 1100,
    hitWindowMs: 155,
    holdChance: 0.075,
    slideChance: 0.09,
    starBase: 3.1,
  },
  {
    id: 'hard',
    label: 'HARD',
    description: '加入半拍、切分與能量段落加速',
    density: 1.08,
    minGapMs: 165,
    approachMs: 880,
    hitWindowMs: 125,
    holdChance: 0.09,
    slideChance: 0.14,
    starBase: 5.0,
  },
  {
    id: 'expert',
    label: 'EXPERT',
    description: '高密度細分、峰值追蹤與高速 Pattern',
    density: 1.42,
    minGapMs: 105,
    approachMs: 720,
    hitWindowMs: 105,
    holdChance: 0.075,
    slideChance: 0.18,
    starBase: 7.1,
  },
];

interface Candidate {
  time: number;
  weight: number;
  gridStrength: number;
  phraseEnergy: number;
  source: 'beat' | 'subdivision' | 'peak';
  beatIndex: number;
}

function seeded(seed: number) {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function energyAt(analysis: AudioAnalysis, time: number) {
  const index = Math.min(
    analysis.energy.length - 1,
    Math.max(0, Math.round((time / Math.max(analysis.duration, 0.001)) * analysis.energy.length)),
  );
  return analysis.energy[index] ?? 0.5;
}

function phraseEnergyAt(analysis: AudioAnalysis, time: number) {
  const beat = Math.max(analysis.beatInterval, 0.1);
  const radius = beat * 4;
  const samples = 9;
  let sum = 0;
  let weighted = 0;

  for (let i = 0; i < samples; i += 1) {
    const t = time - radius + (radius * 2 * i) / (samples - 1);
    if (t < 0 || t > analysis.duration) continue;
    const centerWeight = 1 - Math.abs(i - (samples - 1) / 2) / ((samples - 1) / 2 + 1);
    sum += energyAt(analysis, t) * centerWeight;
    weighted += centerWeight;
  }

  return weighted > 0 ? sum / weighted : energyAt(analysis, time);
}

function nearestBeatIndex(beats: number[], time: number) {
  if (!beats.length) return 0;
  let low = 0;
  let high = beats.length - 1;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (beats[mid] < time) low = mid + 1;
    else high = mid;
  }

  const right = low;
  const left = Math.max(0, right - 1);
  return Math.abs(beats[left] - time) <= Math.abs(beats[right] - time) ? left : right;
}

function quantizePeak(analysis: AudioAnalysis, time: number, difficulty: DifficultyId) {
  const beat = analysis.beatInterval;
  const subdivisions =
    difficulty === 'expert' ? 4 :
    difficulty === 'hard' ? 2 :
    1;

  const step = beat / subdivisions;
  const relative = time - analysis.beatOffset;
  const snapped = analysis.beatOffset + Math.round(relative / step) * step;
  const tolerance =
    difficulty === 'expert' ? Math.min(step * 0.36, 0.07) :
    difficulty === 'hard' ? Math.min(step * 0.3, 0.075) :
    Math.min(step * 0.2, 0.06);

  return Math.abs(snapped - time) <= tolerance ? snapped : time;
}

function pushCandidate(
  target: Candidate[],
  analysis: AudioAnalysis,
  time: number,
  source: Candidate['source'],
  beatIndex: number,
  gridStrength: number,
  baseWeight: number,
) {
  if (time < 0.12 || time >= analysis.duration - 0.22) return;

  const localEnergy = energyAt(analysis, time);
  const phraseEnergy = phraseEnergyAt(analysis, time);
  target.push({
    time,
    source,
    beatIndex,
    gridStrength,
    phraseEnergy,
    weight: baseWeight + localEnergy * 0.36 + phraseEnergy * 0.22,
  });
}

function candidateTimes(analysis: AudioAnalysis, difficulty: DifficultyId) {
  const candidates: Candidate[] = [];
  const beat = analysis.beatInterval;

  analysis.beats.forEach((time, index) => {
    const measureBeat = index % 4;
    const downbeat = measureBeat === 0;
    const backbeat = measureBeat === 2;
    const gridStrength = downbeat ? 1 : backbeat ? 0.88 : 0.76;

    if (difficulty !== 'easy' || index % 2 === 0 || downbeat) {
      pushCandidate(
        candidates,
        analysis,
        time,
        'beat',
        index,
        gridStrength,
        downbeat ? 0.84 : backbeat ? 0.75 : 0.68,
      );
    }

    if (difficulty === 'hard' || difficulty === 'expert') {
      const half = time + beat / 2;
      pushCandidate(candidates, analysis, half, 'subdivision', index, 0.58, 0.5);
    }

    if (difficulty === 'expert') {
      pushCandidate(candidates, analysis, time + beat / 4, 'subdivision', index, 0.42, 0.44);
      pushCandidate(candidates, analysis, time + (beat * 3) / 4, 'subdivision', index, 0.4, 0.42);
    }
  });

  if (difficulty !== 'easy') {
    for (const rawPeak of analysis.peaks) {
      const time = quantizePeak(analysis, rawPeak, difficulty);
      const beatIndex = nearestBeatIndex(analysis.beats, time);
      const nearest = analysis.beats[beatIndex] ?? time;
      const distance = Math.abs(nearest - time);
      const duplicateRadius = Math.min(analysis.beatInterval * 0.13, 0.065);
      if (distance < duplicateRadius) continue;

      pushCandidate(
        candidates,
        analysis,
        time,
        'peak',
        beatIndex,
        difficulty === 'expert' ? 0.54 : 0.5,
        0.58,
      );
    }
  }

  candidates.sort((a, b) => a.time - b.time || b.weight - a.weight);

  const deduped: Candidate[] = [];
  const mergeRadius =
    difficulty === 'expert' ? 38 :
    difficulty === 'hard' ? 52 :
    72;

  for (const candidate of candidates) {
    const previous = deduped[deduped.length - 1];
    if (previous && (candidate.time - previous.time) * 1000 < mergeRadius) {
      if (candidate.weight + candidate.gridStrength > previous.weight + previous.gridStrength) {
        deduped[deduped.length - 1] = candidate;
      }
      continue;
    }
    deduped.push(candidate);
  }

  return deduped;
}

function sectionMultiplier(candidate: Candidate, difficulty: DifficultyId) {
  const centered = clamp((candidate.phraseEnergy - 0.42) / 0.45, -0.35, 0.55);

  if (difficulty === 'easy') return 1 + centered * 0.2;
  if (difficulty === 'normal') return 1 + centered * 0.34;
  if (difficulty === 'hard') return 1 + centered * 0.5;
  return 1 + centered * 0.66;
}

function candidateProbability(candidate: Candidate, preset: DifficultyPreset, difficulty: DifficultyId) {
  const sourceBoost =
    candidate.source === 'beat' ? 0.12 :
    candidate.source === 'peak' ? 0.05 :
    -0.04;

  const downbeatBoost = candidate.gridStrength >= 0.95 ? 0.16 : 0;
  const base = preset.density * (0.43 + candidate.weight * 0.48);
  return clamp(
    base * sectionMultiplier(candidate, difficulty) + sourceBoost + downbeatBoost,
    difficulty === 'easy' ? 0.34 : 0.2,
    1,
  );
}

function positionFor(
  index: number,
  previous: HitObject | undefined,
  previousPrevious: HitObject | undefined,
  difficulty: DifficultyId,
  phrase: number,
) {
  const patternIndex = index % 8;
  const direction = seeded(phrase * 19 + Math.floor(index / 4) * 7) > 0.5 ? 1 : -1;
  const phase = (patternIndex / 8) * Math.PI * 2 * direction;
  const jitter = (seeded(index * 9.71 + phrase * 3.1) - 0.5) * 0.46;
  const angle = phase + jitter;

  const radiusBase =
    difficulty === 'easy' ? 0.2 :
    difficulty === 'normal' ? 0.255 :
    difficulty === 'hard' ? 0.31 :
    0.35;
  const radius = radiusBase + seeded(index * 7.3 + phrase) * 0.105;

  let x = clamp(0.5 + Math.cos(angle) * radius, 0.12, 0.88);
  let y = clamp(0.5 + Math.sin(angle) * radius * 0.72, 0.14, 0.86);

  if (previous) {
    const minDistance =
      difficulty === 'easy' ? 0.13 :
      difficulty === 'normal' ? 0.17 :
      0.19;
    const distance = Math.hypot(x - previous.x, y - previous.y);

    if (distance < minDistance) {
      const mirrorX = clamp(1 - previous.x, 0.12, 0.88);
      const mirrorY = clamp(1 - previous.y, 0.14, 0.86);
      x = clamp(mirrorX + (seeded(index + 91) - 0.5) * 0.08, 0.12, 0.88);
      y = clamp(mirrorY + (seeded(index + 191) - 0.5) * 0.07, 0.14, 0.86);
    }
  }

  if (previous && previousPrevious) {
    const ax = previous.x - previousPrevious.x;
    const ay = previous.y - previousPrevious.y;
    const bx = x - previous.x;
    const by = y - previous.y;
    const aLen = Math.hypot(ax, ay);
    const bLen = Math.hypot(bx, by);
    const alignment = aLen > 0 && bLen > 0 ? (ax * bx + ay * by) / (aLen * bLen) : 0;

    if (alignment < -0.92 && difficulty !== 'expert') {
      x = clamp((x + 0.5) / 2, 0.12, 0.88);
      y = clamp((y + 0.5) / 2, 0.14, 0.86);
    }
  }

  return { x, y };
}

function sustainType(
  candidate: Candidate,
  preset: DifficultyPreset,
  timeMs: number,
  recentSustain: boolean,
) {
  if (recentSustain) return 'tap' as const;
  if (candidate.gridStrength < 0.72 || candidate.source === 'subdivision') return 'tap' as const;

  const roll = seeded(timeMs * 0.73 + candidate.beatIndex * 31);
  if (roll < preset.slideChance * (0.75 + candidate.phraseEnergy * 0.35)) return 'slide' as const;
  if (roll < preset.slideChance + preset.holdChance * (0.72 + candidate.phraseEnergy * 0.28)) return 'hold' as const;
  return 'tap' as const;
}

function shouldKeepCandidate(
  candidate: Candidate,
  index: number,
  lastTime: number,
  recentTimes: number[],
  preset: DifficultyPreset,
  difficulty: DifficultyId,
) {
  const timeMs = candidate.time * 1000;
  if (timeMs - lastTime < preset.minGapMs) return false;

  const windowStart = timeMs - 2000;
  const recentCount = recentTimes.filter((time) => time >= windowStart).length;
  const localCap =
    difficulty === 'easy' ? 4 :
    difficulty === 'normal' ? 7 :
    difficulty === 'hard' ? 11 :
    16;
  if (recentCount >= localCap && candidate.gridStrength < 0.9) return false;

  const probability = candidateProbability(candidate, preset, difficulty);
  const deterministicRoll = seeded(Math.round(timeMs) + index * 97 + candidate.beatIndex * 13);

  if (candidate.gridStrength >= 0.99 && difficulty !== 'expert') {
    return deterministicRoll <= Math.min(1, probability + 0.18);
  }
  return deterministicRoll <= probability;
}

export function generateBeatmap(
  analysis: AudioAnalysis,
  difficulty: DifficultyId,
  title = 'Untitled Track',
  artist = 'Local audio',
): Beatmap {
  const preset = DIFFICULTIES.find((item) => item.id === difficulty) ?? DIFFICULTIES[1];
  const candidates = candidateTimes(analysis, difficulty);
  const objects: HitObject[] = [];
  const recentTimes: number[] = [];
  let lastTime = -Infinity;

  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    const candidate = candidates[candidateIndex];
    const timeMs = candidate.time * 1000;

    if (!shouldKeepCandidate(
      candidate,
      candidateIndex,
      lastTime,
      recentTimes,
      preset,
      difficulty,
    )) continue;

    const previous = objects[objects.length - 1];
    const previousPrevious = objects[objects.length - 2];
    const phrase = Math.floor(candidate.beatIndex / 8);
    const { x, y } = positionFor(
      objects.length,
      previous,
      previousPrevious,
      difficulty,
      phrase,
    );

    const recentSustain = objects
      .slice(-2)
      .some((object) => object.type !== 'tap');
    const type = sustainType(candidate, preset, timeMs, recentSustain);

    const object: HitObject = {
      id: objects.length,
      time: Math.round(timeMs),
      type,
      x,
      y,
      weight: candidate.weight,
    };

    if (type !== 'tap') {
      const highEnergy = candidate.phraseEnergy > 0.68;
      const durationBeats =
        type === 'slide'
          ? 1 + (highEnergy && seeded(timeMs + 17) > 0.58 ? 1 : 0)
          : 1;
      object.duration = Math.round(analysis.beatInterval * 1000 * durationBeats);

      if (type === 'slide') {
        const end = positionFor(
          objects.length + 5,
          object,
          previous,
          difficulty,
          phrase + 1,
        );
        object.endX = end.x;
        object.endY = end.y;
      }
    }

    objects.push(object);
    recentTimes.push(timeMs);
    while (recentTimes.length && recentTimes[0] < timeMs - 2200) recentTimes.shift();
    lastTime = timeMs;
  }

  const safeObjects = objects.filter((object) => object.time < analysis.duration * 1000 - 250);
  const validated = validateAndRepairObjects(
    safeObjects,
    analysis.duration * 1000,
    difficulty,
  );

  let burstPeak = 0;
  let burstStart = 0;
  for (let end = 0; end < validated.objects.length; end += 1) {
    while (
      validated.objects[burstStart] &&
      validated.objects[end].time - validated.objects[burstStart].time > 2000
    ) {
      burstStart += 1;
    }
    burstPeak = Math.max(burstPeak, end - burstStart + 1);
  }

  const densityPerSecond = validated.objects.length / Math.max(analysis.duration, 1);
  const sustainRatio = validated.objects.length
    ? validated.objects.filter((object) => object.type !== 'tap').length / validated.objects.length
    : 0;
  const starRating = clamp(
    preset.starBase +
      (densityPerSecond - preset.density) * 0.52 +
      (analysis.bpm - 120) / 165 +
      Math.max(0, burstPeak - 5) * 0.035 +
      sustainRatio * 0.55,
    1,
    9.9,
  );

  return {
    version: 1,
    title,
    artist,
    difficulty,
    difficultyLabel: preset.label,
    starRating: Math.round(starRating * 10) / 10,
    bpm: analysis.bpm,
    duration: analysis.duration,
    approachMs: preset.approachMs,
    hitWindowMs: preset.hitWindowMs,
    objects: validated.objects,
    validation: validated.report,
  };
}

export function generateAllBeatmaps(
  analysis: AudioAnalysis,
  title: string,
  artist: string,
): Record<DifficultyId, Beatmap> {
  return {
    easy: generateBeatmap(analysis, 'easy', title, artist),
    normal: generateBeatmap(analysis, 'normal', title, artist),
    hard: generateBeatmap(analysis, 'hard', title, artist),
    expert: generateBeatmap(analysis, 'expert', title, artist),
  };
}
