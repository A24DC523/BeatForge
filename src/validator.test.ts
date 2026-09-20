import { describe, expect, it } from 'vitest';
import { validateAndRepairObjects } from './validator';
import type { HitObject } from './types';

describe('BeatForge beatmap validator', () => {
  it('repairs out-of-bounds coordinates, unsafe travel and sustain duration', () => {
    const objects: HitObject[] = [
      { id: 9, time: 1000, type: 'tap', x: -1, y: 2, weight: 1 },
      { id: 10, time: 1100, type: 'slide', x: 0.88, y: 0.86, endX: 3, endY: -2, duration: 99999, weight: 1 },
    ];

    const result = validateAndRepairObjects(objects, 5000, 'easy');

    expect(result.objects).toHaveLength(2);
    expect(result.report.repaired).toBeGreaterThan(0);
    expect(result.objects[0].id).toBe(0);
    expect(result.objects[1].id).toBe(1);
    expect(result.objects.every((object) => object.x >= 0.12 && object.x <= 0.88)).toBe(true);
    expect(result.objects.every((object) => object.y >= 0.14 && object.y <= 0.86)).toBe(true);
    expect(result.objects[1].duration).toBeLessThanOrEqual(3900);
    expect(result.objects[1].endX).toBeLessThanOrEqual(0.88);
    expect(result.objects[1].endY).toBeGreaterThanOrEqual(0.14);
  });

  it('removes duplicate timestamps and invalid objects', () => {
    const objects: HitObject[] = [
      { id: 0, time: -5, type: 'tap', x: 0.5, y: 0.5, weight: 1 },
      { id: 1, time: 500, type: 'tap', x: 0.4, y: 0.4, weight: 1 },
      { id: 2, time: 500, type: 'tap', x: 0.6, y: 0.6, weight: 1 },
      { id: 3, time: 9999, type: 'tap', x: 0.5, y: 0.5, weight: 1 },
    ];

    const result = validateAndRepairObjects(objects, 3000, 'normal');

    expect(result.objects).toHaveLength(1);
    expect(result.report.removed).toBe(3);
    expect(result.report.valid).toBe(false);
  });
});
