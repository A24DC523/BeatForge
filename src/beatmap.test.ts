import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, generateAllBeatmaps, generateBeatmap } from './beatmap';
import type { AudioAnalysis } from './types';

function fakeAnalysis(): AudioAnalysis {
  const duration = 30;
  const bpm = 120;
  const beatInterval = 0.5;
  const beats = Array.from({ length: 58 }, (_, i) => 0.5 + i * beatInterval);
  return {
    duration,
    bpm,
    beatInterval,
    beatOffset: 0.5,
    beats,
    energy: Array.from({ length: 600 }, (_, i) => 0.35 + ((i * 17) % 50) / 100),
    peaks: beats.map((time, i) => time + (i % 3 === 0 ? 0.22 : 0.03)).filter((time) => time < duration - 0.5),
    sampleRate: 44100,
  };
}

describe('BeatForge beatmap generator', () => {
  it('generates deterministic, valid maps for every difficulty', () => {
    const analysis = fakeAnalysis();
    const maps = generateAllBeatmaps(analysis, 'Test Track', 'BeatForge');

    for (const difficulty of DIFFICULTIES) {
      const map = maps[difficulty.id];
      expect(map.difficulty).toBe(difficulty.id);
      expect(map.bpm).toBe(120);
      expect(map.objects.length).toBeGreaterThan(5);
      expect(map.objects.every((object) => object.x >= 0.12 && object.x <= 0.88)).toBe(true);
      expect(map.objects.every((object) => object.y >= 0.14 && object.y <= 0.86)).toBe(true);
      expect(map.objects.every((object, i, all) => i === 0 || object.time >= all[i - 1].time)).toBe(true);
      expect(map.objects.every((object) => object.time < durationMs(analysis.duration))).toBe(true);
    }
  });

  it('raises note density as difficulty increases', () => {
    const maps = generateAllBeatmaps(fakeAnalysis(), 'Density', 'Test');
    expect(maps.normal.objects.length).toBeGreaterThanOrEqual(maps.easy.objects.length);
    expect(maps.hard.objects.length).toBeGreaterThanOrEqual(maps.normal.objects.length);
    expect(maps.expert.objects.length).toBeGreaterThanOrEqual(maps.hard.objects.length);
  });

  it('is deterministic for the same input', () => {
    const analysis = fakeAnalysis();
    expect(generateBeatmap(analysis, 'hard')).toEqual(generateBeatmap(analysis, 'hard'));
  });

  it('uses local energy to make intense song sections denser', () => {
    const analysis = fakeAnalysis();
    analysis.energy = Array.from({ length: 600 }, (_, i) => i < 300 ? 0.12 : 0.96);
    const map = generateBeatmap(analysis, 'hard');

    const firstHalf = map.objects.filter((object) => object.time < 15000).length;
    const secondHalf = map.objects.filter((object) => object.time >= 15000).length;

    expect(secondHalf).toBeGreaterThan(firstHalf);
  });

  it('spaces sustain objects instead of stacking holds and slides back-to-back', () => {
    const map = generateBeatmap(fakeAnalysis(), 'expert');

    for (let i = 0; i < map.objects.length; i += 1) {
      if (map.objects[i].type === 'tap') continue;
      expect(map.objects[i - 1]?.type ?? 'tap').toBe('tap');
      expect(map.objects[i - 2]?.type ?? 'tap').toBe('tap');
    }
  });

  it('generates bounded multi-point slide paths', () => {
    const analysis = fakeAnalysis();
    analysis.bands = {
      low: Array.from({ length: 600 }, () => 0.12),
      mid: Array.from({ length: 600 }, () => 0.42),
      high: Array.from({ length: 600 }, () => 0.98),
    };
    const map = generateBeatmap(analysis, 'expert');
    const slides = map.objects.filter((object) => object.type === 'slide');

    expect(slides.length).toBeGreaterThan(0);

    for (const slide of slides) {
      const path = slide.slidePath ?? [];
      expect(path.length).toBeGreaterThanOrEqual(3);
      expect(path[0]).toMatchObject({ x: slide.x, y: slide.y, t: 0 });
      expect(path[path.length - 1]).toMatchObject({
        x: slide.endX,
        y: slide.endY,
        t: 1,
      });
      expect(path.every((point) => point.x >= 0.12 && point.x <= 0.88)).toBe(true);
      expect(path.every((point) => point.y >= 0.14 && point.y <= 0.86)).toBe(true);
      expect(path.every((point, i) => i === 0 || point.t > path[i - 1].t)).toBe(true);
    }
  });

  it('keeps generated sustain notes meaningfully long and free of following-note overlap', () => {
    const map = generateBeatmap(fakeAnalysis(), 'hard');
    const minimum = 360;

    for (let i = 0; i < map.objects.length; i += 1) {
      const object = map.objects[i];
      if (object.type === 'tap') continue;

      expect(object.duration ?? 0).toBeGreaterThanOrEqual(minimum);

      const next = map.objects[i + 1];
      if (next) {
        expect(next.time).toBeGreaterThanOrEqual(object.time + (object.duration ?? 0));
      }
    }
  });
});

function durationMs(seconds: number) {
  return seconds * 1000;
}
