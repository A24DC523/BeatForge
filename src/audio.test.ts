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
  });
});
