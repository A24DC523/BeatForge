import type { DifficultyId, HitObject } from './types';

export interface ValidationReport {
  valid: boolean;
  repaired: number;
  removed: number;
  warnings: string[];
}

const MIN_SUSTAIN_MS: Record<DifficultyId, number> = {
  easy: 480,
  normal: 420,
  hard: 360,
  expert: 320,
};

const SUSTAIN_GAP_MS: Record<DifficultyId, number> = {
  easy: 140,
  normal: 120,
  hard: 90,
  expert: 70,
};

const SPEED_LIMIT: Record<DifficultyId, number> = {
  easy: 0.8,
  normal: 1.2,
  hard: 1.9,
  expert: 2.8,
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function clampTravel(previous: HitObject, current: HitObject, difficulty: DifficultyId) {
  const deltaSeconds = Math.max((current.time - previous.time) / 1000, 0.001);
  const allowed = Math.max(0.12, SPEED_LIMIT[difficulty] * deltaSeconds);
  const dx = current.x - previous.x;
  const dy = current.y - previous.y;
  const distance = Math.hypot(dx, dy);

  if (distance <= allowed || distance === 0) return false;

  const scale = allowed / distance;
  current.x = clamp(previous.x + dx * scale, 0.12, 0.88);
  current.y = clamp(previous.y + dy * scale, 0.14, 0.86);
  return true;
}

export function validateAndRepairObjects(
  source: HitObject[],
  durationMs: number,
  difficulty: DifficultyId,
): { objects: HitObject[]; report: ValidationReport } {
  const warnings = new Set<string>();
  const objects: HitObject[] = [];
  let repaired = 0;
  let removed = 0;

  for (const original of [...source].sort((a, b) => a.time - b.time || a.id - b.id)) {
    if (!Number.isFinite(original.time) || original.time < 0 || original.time >= durationMs - 120) {
      removed += 1;
      warnings.add('invalid-time');
      continue;
    }

    const object: HitObject = { ...original };
    const oldX = object.x;
    const oldY = object.y;
    object.x = clamp(Number.isFinite(object.x) ? object.x : 0.5, 0.12, 0.88);
    object.y = clamp(Number.isFinite(object.y) ? object.y : 0.5, 0.14, 0.86);
    if (object.x !== oldX || object.y !== oldY) {
      repaired += 1;
      warnings.add('playfield-bounds');
    }

    if (object.type === 'slide') {
      const oldEndX = object.endX;
      const oldEndY = object.endY;
      object.endX = clamp(Number.isFinite(object.endX) ? object.endX! : object.x, 0.12, 0.88);
      object.endY = clamp(Number.isFinite(object.endY) ? object.endY! : object.y, 0.14, 0.86);
      if (object.endX !== oldEndX || object.endY !== oldEndY) {
        repaired += 1;
        warnings.add('slide-bounds');
      }
    }

    if (object.type !== 'tap') {
      const minimum = MIN_SUSTAIN_MS[difficulty];
      const remaining = durationMs - object.time - 100;
      if (remaining < minimum) {
        object.type = 'tap';
        delete object.duration;
        delete object.endX;
        delete object.endY;
        repaired += 1;
        warnings.add('short-sustain');
      } else {
        const oldDuration = object.duration;
        object.duration = clamp(
          Number.isFinite(object.duration) ? object.duration! : minimum,
          minimum,
          Math.max(minimum, remaining),
        );
        if (object.duration !== oldDuration) {
          repaired += 1;
          warnings.add('sustain-duration');
        }
      }
    }

    const previous = objects[objects.length - 1];
    if (previous && previous.time === object.time) {
      removed += 1;
      warnings.add('duplicate-time');
      continue;
    }

    if (previous && previous.type !== 'tap' && previous.duration) {
      const minimum = MIN_SUSTAIN_MS[difficulty];
      const maxDuration = object.time - previous.time - SUSTAIN_GAP_MS[difficulty];

      if (previous.duration > maxDuration) {
        if (maxDuration >= minimum) {
          previous.duration = maxDuration;
        } else {
          previous.type = 'tap';
          delete previous.duration;
          delete previous.endX;
          delete previous.endY;
        }
        repaired += 1;
        warnings.add('sustain-overlap');
      }
    }

    if (previous && clampTravel(previous, object, difficulty)) {
      repaired += 1;
      warnings.add('travel-speed');
    }

    object.id = objects.length;
    objects.push(object);
  }

  return {
    objects,
    report: {
      valid: removed === 0,
      repaired,
      removed,
      warnings: [...warnings],
    },
  };
}
