import type { AudioAnalysis, Beatmap, DifficultyId, DifficultyPreset, HitObject } from './types';
import { validateAndRepairObjects } from './validator';

export const DIFFICULTIES: DifficultyPreset[] = [
  {
    id: 'easy',
    label: 'EASY',
    description: '強拍為主，適合初次遊玩',
    density: 0.48,
    minGapMs: 420,
    approachMs: 1350,
    hitWindowMs: 185,
    holdChance: 0.05,
    slideChance: 0.06,
    starBase: 1.6,
  },
  {
    id: 'normal',
    label: 'NORMAL',
    description: '完整節拍與簡單連續節奏',
    density: 0.78,
    minGapMs: 270,
    approachMs: 1100,
    hitWindowMs: 155,
    holdChance: 0.08,
    slideChance: 0.1,
    starBase: 3.1,
  },
  {
    id: 'hard',
    label: 'HARD',
    description: '加入切分、跳躍與快速滑動',
    density: 1.08,
    minGapMs: 165,
    approachMs: 880,
    hitWindowMs: 125,
    holdChance: 0.1,
    slideChance: 0.16,
    starBase: 5.0,
  },
  {
    id: 'expert',
    label: 'EXPERT',
    description: '高密度節奏與高速 Pattern',
    density: 1.42,
    minGapMs: 105,
    approachMs: 720,
    hitWindowMs: 105,
    holdChance: 0.08,
    slideChance: 0.2,
    starBase: 7.1,
  },
];

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

function candidateTimes(analysis: AudioAnalysis, difficulty: DifficultyId) {
  const times: Array<{ time: number; weight: number }> = [];
  const beat = analysis.beatInterval;

  analysis.beats.forEach((time, index) => {
    if (difficulty === 'easy' && index % 2 !== 0) return;

    times.push({ time, weight: 0.72 + energyAt(analysis, time) * 0.4 });

    if (difficulty === 'hard' || difficulty === 'expert') {
      const half = time + beat / 2;
      if (half < analysis.duration - 0.25) {
        times.push({ time: half, weight: 0.56 + energyAt(analysis, half) * 0.42 });
      }
    }

    if (difficulty === 'expert' && index % 2 === 1) {
      const quarter = time + beat / 4;
      const threeQuarter = time + (beat * 3) / 4;
      if (quarter < analysis.duration - 0.25) times.push({ time: quarter, weight: 0.52 });
      if (threeQuarter < analysis.duration - 0.25) times.push({ time: threeQuarter, weight: 0.5 });
    }
  });

  if (difficulty !== 'easy') {
    for (const peak of analysis.peaks) {
      let low = 0;
      let high = analysis.beats.length - 1;
      while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (analysis.beats[mid] < peak) low = mid + 1;
        else high = mid;
      }
      const right = analysis.beats[low];
      const left = analysis.beats[Math.max(0, low - 1)];
      const nearestBeatDistance = Math.min(
        Number.isFinite(left) ? Math.abs(left - peak) : 99,
        Number.isFinite(right) ? Math.abs(right - peak) : 99,
      );
      if (nearestBeatDistance > Math.min(analysis.beatInterval * 0.18, 0.09)) {
        times.push({ time: peak, weight: 0.68 + energyAt(analysis, peak) * 0.35 });
      }
    }
  }

  return times.sort((a, b) => a.time - b.time);
}

function positionFor(index: number, previous: HitObject | undefined, difficulty: DifficultyId) {
  const angle = seeded(index * 5 + difficulty.length * 17) * Math.PI * 2;
  const radiusBase = difficulty === 'easy' ? 0.2 : difficulty === 'normal' ? 0.26 : 0.33;
  const radius = radiusBase + seeded(index * 7.3) * 0.16;

  let x = 0.5 + Math.cos(angle) * radius;
  let y = 0.5 + Math.sin(angle) * radius * 0.72;

  x = clamp(x, 0.12, 0.88);
  y = clamp(y, 0.14, 0.86);

  if (previous) {
    const distance = Math.hypot(x - previous.x, y - previous.y);
    const minDistance = difficulty === 'easy' ? 0.14 : 0.2;
    if (distance < minDistance) {
      x = clamp(1 - previous.x + (seeded(index + 99) - 0.5) * 0.12, 0.12, 0.88);
      y = clamp(1 - previous.y + (seeded(index + 199) - 0.5) * 0.1, 0.14, 0.86);
    }
  }

  return { x, y };
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
  let lastTime = -Infinity;

  for (const candidate of candidates) {
    const timeMs = candidate.time * 1000;
    if (timeMs - lastTime < preset.minGapMs) continue;

    const probability = clamp(preset.density * (0.55 + candidate.weight * 0.5), 0.2, 1);
    const roll = seeded(Math.round(timeMs) + objects.length * 97);
    if (roll > probability) continue;

    const previous = objects[objects.length - 1];
    const { x, y } = positionFor(objects.length, previous, difficulty);
    const typeRoll = seeded(Math.round(timeMs) * 0.73 + 31);
    let type: HitObject['type'] = 'tap';

    if (typeRoll < preset.slideChance) type = 'slide';
    else if (typeRoll < preset.slideChance + preset.holdChance) type = 'hold';

    const object: HitObject = {
      id: objects.length,
      time: Math.round(timeMs),
      type,
      x,
      y,
      weight: candidate.weight,
    };

    if (type !== 'tap') {
      const durationBeats = type === 'slide' ? 1 + Math.floor(seeded(timeMs + 17) * 2) : 1;
      object.duration = Math.round(analysis.beatInterval * 1000 * durationBeats);

      if (type === 'slide') {
        const end = positionFor(objects.length + 17, object, difficulty);
        object.endX = end.x;
        object.endY = end.y;
      }
    }

    objects.push(object);
    lastTime = timeMs;
  }

  const safeObjects = objects.filter((object) => object.time < analysis.duration * 1000 - 250);
  const validated = validateAndRepairObjects(
    safeObjects,
    analysis.duration * 1000,
    difficulty,
  );
  const densityPerSecond = validated.objects.length / Math.max(analysis.duration, 1);
  const starRating = clamp(
    preset.starBase + (densityPerSecond - preset.density) * 0.6 + (analysis.bpm - 120) / 150,
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
