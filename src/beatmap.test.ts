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
});

function durationMs(seconds: number) {
  return seconds * 1000;
}
