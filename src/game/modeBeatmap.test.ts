import { describe, expect, it } from 'vitest';
import { generateBeatmap } from '../beatmap';
import type { AudioAnalysis, GameModeId } from '../types';
import { adaptBeatmapForMode } from './modeBeatmap';

function fakeAnalysis(): AudioAnalysis {
  const duration = 32;
  const bpm = 128;
  const beatInterval = 60 / bpm;
  const beats = Array.from({ length: 64 }, (_, i) => 0.5 + i * beatInterval)
    .filter((time) => time < duration - 0.4);

  return {
    duration,
    bpm,
    beatInterval,
    beatOffset: 0.5,
    beats,
    energy: Array.from({ length: 700 }, (_, i) => 0.28 + ((i * 29) % 65) / 100),
    peaks: beats
      .flatMap((time, i) => i % 3 === 0 ? [time + beatInterval / 2] : [time + 0.025])
      .filter((time) => time < duration - 0.4),
    sampleRate: 44100,
  };
}

function mapFor(mode: GameModeId) {
  return adaptBeatmapForMode(generateBeatmap(fakeAnalysis(), 'hard', 'Mode Test'), mode);
}

describe('mode-specific beatmap generator', () => {
  it('is deterministic for every gameplay mode', () => {
    const base = generateBeatmap(fakeAnalysis(), 'hard', 'Determinism');

    for (const mode of ['forge', 'lanes4', 'split2', 'pulse1', 'drum', 'catch'] as GameModeId[]) {
      expect(adaptBeatmapForMode(base, mode)).toEqual(adaptBeatmapForMode(base, mode));
    }
  });

  it('creates explicit playable lane assignments for 4K', () => {
    const map = mapFor('lanes4');

    expect(map.objects.every((object) => Number.isInteger(object.lane))).toBe(true);
    expect(map.objects.every((object) => (object.lane ?? -1) >= 0 && (object.lane ?? 4) < 4)).toBe(true);
    expect(map.objects.every((object) => object.type !== 'slide')).toBe(true);

    for (const object of map.objects) {
      expect(object.x).toBeCloseTo(((object.lane ?? 0) + 0.5) / 4, 8);
    }
  });

  it('keeps 2K patterns alternating without long one-side streaks', () => {
    const map = mapFor('split2');
    let streak = 1;

    for (let i = 1; i < map.objects.length; i += 1) {
      if (map.objects[i].lane === map.objects[i - 1].lane) streak += 1;
      else streak = 1;
      expect(streak).toBeLessThanOrEqual(2);
    }
  });

  it('normalizes 1K charts to one center lane', () => {
    const map = mapFor('pulse1');

    expect(map.objects.every((object) => object.lane === 0)).toBe(true);
    expect(map.objects.every((object) => object.x === 0.5)).toBe(true);
    expect(map.objects.every((object) => object.type !== 'slide')).toBe(true);
  });

  it('creates explicit Don and Ka events for Drum mode', () => {
    const map = mapFor('drum');
    const kinds = new Set(map.objects.map((object) => object.drumKind));

    expect(kinds.has('don')).toBe(true);
    expect(kinds.has('ka')).toBe(true);
    expect(map.objects.every((object) => object.type === 'tap')).toBe(true);
    expect(map.objects.every((object) => object.drumKind === 'don' || object.drumKind === 'ka')).toBe(true);
  });

  it('limits Catch travel so consecutive targets remain reachable', () => {
    const map = mapFor('catch');

    expect(map.objects.every((object) => object.x >= 0.1 && object.x <= 0.9)).toBe(true);
    expect(map.objects.every((object) => object.type === 'tap')).toBe(true);

    for (let i = 1; i < map.objects.length; i += 1) {
      const previous = map.objects[i - 1];
      const current = map.objects[i];
      const dt = Math.max((current.time - previous.time) / 1000, 0.05);
      const maxTravel = Math.max(0.055, 0.76 * dt * 0.78);
      expect(Math.abs(current.x - previous.x)).toBeLessThanOrEqual(maxTravel + 1e-9);
    }
  });
});
