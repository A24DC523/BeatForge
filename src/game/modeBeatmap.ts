import type { Beatmap, DifficultyId, GameModeId, HitObject } from '../types';

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function cloneObject(object: HitObject): HitObject {
  return { ...object };
}

function laneCenter(lane: number, lanes: number) {
  return (lane + 0.5) / lanes;
}

function difficultySpeed(difficulty: DifficultyId) {
  if (difficulty === 'easy') return 0.48;
  if (difficulty === 'normal') return 0.62;
  if (difficulty === 'hard') return 0.76;
  return 0.9;
}

function adaptPulse(objects: HitObject[]) {
  return objects.map((source) => {
    const object = cloneObject(source);
    object.lane = 0;
    object.x = 0.5;
    object.y = 0.5;

    if (object.type === 'slide') {
      object.type = 'hold';
      delete object.endX;
      delete object.endY;
    }

    return object;
  });
}

function adaptSplit(objects: HitObject[]) {
  let previousLane = -1;
  let streak = 0;

  return objects.map((source, index) => {
    const object = cloneObject(source);
    const phrase = Math.floor(index / 8);
    const preferred = (index + phrase) % 2;
    let lane = preferred;

    if (lane === previousLane) {
      streak += 1;
      if (streak >= 2) {
        lane = 1 - lane;
        streak = 0;
      }
    } else {
      streak = 0;
    }

    if (object.type !== 'tap' && index > 0) {
      lane = 1 - previousLane;
    }

    previousLane = lane;
    object.lane = lane;
    object.x = laneCenter(lane, 2);
    object.y = 0.5;

    if (object.type === 'slide') {
      object.type = 'hold';
      delete object.endX;
      delete object.endY;
    }

    return object;
  });
}

function fourLanePattern(index: number, difficulty: DifficultyId) {
  const patterns = difficulty === 'easy'
    ? [
        [0, 1, 2, 3, 1, 2, 0, 3],
        [3, 2, 1, 0, 2, 1, 3, 0],
      ]
    : difficulty === 'normal'
      ? [
          [0, 2, 1, 3, 1, 2, 0, 3],
          [3, 1, 2, 0, 2, 1, 3, 0],
          [1, 0, 2, 3, 2, 0, 1, 3],
        ]
      : [
          [0, 2, 1, 3, 2, 0, 3, 1],
          [3, 1, 2, 0, 1, 3, 0, 2],
          [0, 1, 3, 2, 1, 0, 2, 3],
          [2, 0, 1, 3, 1, 2, 3, 0],
        ];

  const phrase = Math.floor(index / 8);
  const pattern = patterns[phrase % patterns.length];
  return pattern[index % pattern.length];
}

function adaptFourLane(objects: HitObject[], difficulty: DifficultyId) {
  const laneFreeAt = [0, 0, 0, 0];
  let previousLane = -1;
  let sameLaneStreak = 0;

  return objects.map((source, index) => {
    const object = cloneObject(source);
    const low = source.bandLow ?? 0.5;
    const high = source.bandHigh ?? 0.5;
    let lane = fourLanePattern(index, difficulty);
    const time = object.time;

    if (low > high * 1.18) {
      lane = index % 2 === 0 ? 1 : 2;
    } else if (high > low * 1.18) {
      lane = index % 2 === 0 ? 0 : 3;
    }

    if (laneFreeAt[lane] > time - 35) {
      const alternatives = [0, 1, 2, 3]
        .filter((candidate) => laneFreeAt[candidate] <= time - 35)
        .sort((a, b) => Math.abs(a - lane) - Math.abs(b - lane));
      if (alternatives.length) lane = alternatives[0];
    }

    if (lane === previousLane) {
      sameLaneStreak += 1;
      const maxJack = difficulty === 'expert' ? 2 : 1;
      if (sameLaneStreak > maxJack) {
        const alternatives = [0, 1, 2, 3]
          .filter((candidate) => candidate !== lane && laneFreeAt[candidate] <= time - 35)
          .sort((a, b) => Math.abs(a - lane) - Math.abs(b - lane));
        if (alternatives.length) {
          lane = alternatives[0];
          sameLaneStreak = 0;
        }
      }
    } else {
      sameLaneStreak = 0;
    }

    previousLane = lane;
    object.lane = lane;
    object.x = laneCenter(lane, 4);
    object.y = 0.5;

    if (object.type === 'slide') {
      object.type = 'hold';
      delete object.endX;
      delete object.endY;
    }

    if (object.type !== 'tap') {
      laneFreeAt[lane] = object.time + (object.duration ?? 0);
    } else {
      laneFreeAt[lane] = object.time + 35;
    }

    return object;
  });
}

function adaptDrum(objects: HitObject[]) {
  let previousKind: 'don' | 'ka' = 'ka';
  let sameKindStreak = 0;

  return objects.map((source, index) => {
    const object = cloneObject(source);
    const low = object.bandLow ?? 0.5;
    const mid = object.bandMid ?? 0.5;
    const high = object.bandHigh ?? 0.5;
    const lowDominant = low > high * 1.12 && low >= mid * 0.82;
    const highDominant = high > low * 1.1 && high >= mid * 0.82;
    const accented = object.weight >= 1.03 || low > 0.68;
    let kind: 'don' | 'ka';

    if (lowDominant || (accented && !highDominant)) {
      kind = 'don';
    } else if (highDominant || source.type === 'slide') {
      kind = 'ka';
    } else {
      const phrase = Math.floor(index / 8);
      kind = (index + phrase) % 3 === 1 ? 'ka' : 'don';
    }

    if (kind === previousKind) {
      sameKindStreak += 1;
      if (sameKindStreak >= 3 && !accented && !lowDominant && !highDominant) {
        kind = kind === 'don' ? 'ka' : 'don';
        sameKindStreak = 0;
      }
    } else {
      sameKindStreak = 0;
    }

    previousKind = kind;
    object.drumKind = kind;
    object.x = kind === 'don' ? 0.34 : 0.66;
    object.y = 0.5;
    object.type = 'tap';
    delete object.duration;
    delete object.endX;
    delete object.endY;
    delete object.lane;
    return object;
  });
}

function adaptCatch(objects: HitObject[], difficulty: DifficultyId) {
  const speed = difficultySpeed(difficulty);
  let previousX = 0.5;
  let previousTime = 0;
  let direction = 1;

  return objects.map((source, index) => {
    const object = cloneObject(source);
    const deltaSeconds = index === 0
      ? 0.5
      : Math.max((object.time - previousTime) / 1000, 0.05);

    if (index % 6 === 0) direction *= -1;

    const spectralMotion = clamp((source.bandHigh ?? 0.5) - (source.bandLow ?? 0.5), -0.45, 0.45);
    const phraseTarget =
      0.5 +
      direction * (0.18 + ((index * 37) % 11) / 100 + spectralMotion * 0.08) +
      (source.x - 0.5) * 0.3;
    const desired = clamp(phraseTarget, 0.1, 0.9);
    const maxTravel = Math.max(0.055, speed * deltaSeconds * 0.78);
    const x = clamp(desired, previousX - maxTravel, previousX + maxTravel);

    object.x = clamp(x, 0.1, 0.9);
    object.y = 0.5;
    object.type = 'tap';
    delete object.duration;
    delete object.endX;
    delete object.endY;
    delete object.lane;
    delete object.drumKind;

    previousX = object.x;
    previousTime = object.time;
    return object;
  });
}

function modeStarOffset(mode: GameModeId) {
  if (mode === 'lanes4') return 0.35;
  if (mode === 'split2') return -0.1;
  if (mode === 'pulse1') return -0.35;
  if (mode === 'drum') return 0.05;
  if (mode === 'catch') return 0.2;
  return 0;
}

export function adaptBeatmapForMode(base: Beatmap, mode: GameModeId): Beatmap {
  if (mode === 'forge') return base;

  let objects: HitObject[];
  if (mode === 'lanes4') objects = adaptFourLane(base.objects, base.difficulty);
  else if (mode === 'split2') objects = adaptSplit(base.objects);
  else if (mode === 'pulse1') objects = adaptPulse(base.objects);
  else if (mode === 'drum') objects = adaptDrum(base.objects);
  else objects = adaptCatch(base.objects, base.difficulty);

  return {
    ...base,
    starRating: Math.round(clamp(base.starRating + modeStarOffset(mode), 1, 9.9) * 10) / 10,
    objects,
  };
}
