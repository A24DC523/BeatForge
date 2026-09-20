function writeAscii(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
}

export function createDemoFile() {
  const sampleRate = 22050;
  const duration = 24;
  const bpm = 128;
  const samples = sampleRate * duration;
  const pcm = new Float32Array(samples);
  const beat = 60 / bpm;

  const addSine = (start: number, length: number, startFreq: number, endFreq: number, gain: number) => {
    const startIndex = Math.floor(start * sampleRate);
    const count = Math.floor(length * sampleRate);
    let phase = 0;
    for (let i = 0; i < count && startIndex + i < pcm.length; i += 1) {
      const t = i / Math.max(count, 1);
      const freq = startFreq + (endFreq - startFreq) * t;
      phase += (Math.PI * 2 * freq) / sampleRate;
      const env = Math.exp(-6 * t);
      pcm[startIndex + i] += Math.sin(phase) * gain * env;
    }
  };

  const addNoise = (start: number, length: number, gain: number, seed: number) => {
    const startIndex = Math.floor(start * sampleRate);
    const count = Math.floor(length * sampleRate);
    let state = seed >>> 0;
    for (let i = 0; i < count && startIndex + i < pcm.length; i += 1) {
      state = (state * 1664525 + 1013904223) >>> 0;
      const noise = (state / 0xffffffff) * 2 - 1;
      const env = Math.exp(-10 * (i / Math.max(count, 1)));
      pcm[startIndex + i] += noise * gain * env;
    }
  };

  let beatIndex = 0;
  for (let time = 0.4; time < duration - 0.5; time += beat) {
    addSine(time, 0.24, 150, 48, beatIndex % 4 === 0 ? 0.95 : 0.72);
    if (beatIndex % 2 === 1) addNoise(time, 0.12, 0.42, beatIndex * 991 + 17);
    addNoise(time + beat / 2, 0.04, 0.16, beatIndex * 157 + 31);

    if (beatIndex % 8 >= 4) {
      addSine(time + beat / 2, 0.08, 620, 420, 0.18);
    }
    beatIndex += 1;
  }

  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(44 + pcm.length * bytesPerSample);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + pcm.length * bytesPerSample, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, pcm.length * bytesPerSample, true);

  for (let i = 0; i < pcm.length; i += 1) {
    const value = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(44 + i * 2, Math.round(value * 0x7fff), true);
  }

  return new File([buffer], 'BeatForge Demo - Neon Pulse.wav', { type: 'audio/wav' });
}
