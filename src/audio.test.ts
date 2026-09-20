import { describe, expect, it } from 'vitest';
import { analyzeAudioBuffer } from './audio';
import { createDemoFile } from './demo';

describe('BeatForge audio analysis', () => {
  it('recovers the BPM and beat grid from the built-in Neon Pulse demo', async () => {
    const file = createDemoFile();
    const bytes = await file.arrayBuffer();
    const view = new DataView(bytes);
    const sampleRate = view.getUint32(24, true);
    const dataBytes = view.getUint32(40, true);
    const sampleCount = dataBytes / 2;
    const channel = new Float32Array(sampleCount);

    for (let i = 0; i < sampleCount; i += 1) {
      channel[i] = view.getInt16(44 + i * 2, true) / 32768;
    }

    const fakeBuffer = {
      numberOfChannels: 1,
      length: sampleCount,
      sampleRate,
      duration: sampleCount / sampleRate,
      getChannelData: (index: number) => {
        if (index !== 0) throw new Error('Unexpected channel');
        return channel;
      },
    } as unknown as AudioBuffer;

    const result = await analyzeAudioBuffer(fakeBuffer);

    expect(result.bpm).toBe(128);
    expect(result.beats.length).toBeGreaterThan(40);
    expect(result.peaks.length).toBeGreaterThan(40);
    expect(result.bands?.low.length).toBe(result.energy.length);
    expect(result.bands?.mid.length).toBe(result.energy.length);
    expect(result.bands?.high.length).toBe(result.energy.length);
  });

  it('separates low-frequency and high-frequency tones into different bands', async () => {
    const makeTone = (frequency: number) => {
      const sampleRate = 44100;
      const duration = 2;
      const sampleCount = sampleRate * duration;
      const channel = new Float32Array(sampleCount);

      for (let i = 0; i < sampleCount; i += 1) {
        channel[i] = Math.sin((Math.PI * 2 * frequency * i) / sampleRate) * 0.8;
      }

      return {
        numberOfChannels: 1,
        length: sampleCount,
        sampleRate,
        duration,
        getChannelData: (index: number) => {
          if (index !== 0) throw new Error('Unexpected channel');
          return channel;
        },
      } as unknown as AudioBuffer;
    };

    const lowTone = await analyzeAudioBuffer(makeTone(100));
    const highTone = await analyzeAudioBuffer(makeTone(4000));

    const average = (values: number[] | undefined) =>
      (values ?? []).reduce((sum, value) => sum + value, 0) / Math.max(values?.length ?? 0, 1);

    expect(average(lowTone.bands?.low)).toBeGreaterThan(average(lowTone.bands?.high));
    expect(average(highTone.bands?.high)).toBeGreaterThan(average(highTone.bands?.low));
  });
});
