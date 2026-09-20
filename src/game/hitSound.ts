export type HitSoundKind =
  | 'perfect'
  | 'great'
  | 'good'
  | 'hold-start'
  | 'hold-end'
  | 'slide-end';

interface ToneSpec {
  frequency: number;
  gain: number;
  duration: number;
  type: OscillatorType;
  delay?: number;
}

const PROFILES: Record<HitSoundKind, ToneSpec[]> = {
  perfect: [
    { frequency: 980, gain: 0.34, duration: 0.075, type: 'sine' },
    { frequency: 1960, gain: 0.18, duration: 0.052, type: 'triangle', delay: 0.004 },
  ],
  great: [
    { frequency: 820, gain: 0.28, duration: 0.07, type: 'sine' },
    { frequency: 1480, gain: 0.12, duration: 0.045, type: 'triangle', delay: 0.004 },
  ],
  good: [
    { frequency: 620, gain: 0.22, duration: 0.072, type: 'triangle' },
    { frequency: 940, gain: 0.08, duration: 0.04, type: 'sine', delay: 0.006 },
  ],
  'hold-start': [
    { frequency: 430, gain: 0.2, duration: 0.09, type: 'triangle' },
    { frequency: 860, gain: 0.08, duration: 0.055, type: 'sine', delay: 0.008 },
  ],
  'hold-end': [
    { frequency: 660, gain: 0.22, duration: 0.085, type: 'sine' },
    { frequency: 1320, gain: 0.12, duration: 0.06, type: 'triangle', delay: 0.008 },
  ],
  'slide-end': [
    { frequency: 760, gain: 0.2, duration: 0.09, type: 'triangle' },
    { frequency: 1520, gain: 0.14, duration: 0.065, type: 'sine', delay: 0.006 },
    { frequency: 2280, gain: 0.055, duration: 0.038, type: 'square', delay: 0.012 },
  ],
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export class HitSoundEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private volume: number;

  constructor(volume = 0.55) {
    this.volume = clamp(volume, 0, 1);
  }

  setVolume(volume: number) {
    this.volume = clamp(volume, 0, 1);
    if (this.context && this.master) {
      this.master.gain.setTargetAtTime(this.volume * 0.42, this.context.currentTime, 0.008);
    }
  }

  async prime() {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: 'interactive' });
      this.master = this.context.createGain();
      this.master.gain.value = this.volume * 0.42;
      this.master.connect(this.context.destination);
    }

    if (this.context.state === 'suspended') {
      await this.context.resume();
    }
  }

  play(kind: HitSoundKind, combo = 0) {
    const context = this.context;
    const master = this.master;
    if (!context || !master || context.state !== 'running' || this.volume <= 0) return;

    const now = context.currentTime + 0.002;
    for (const tone of PROFILES[kind]) {
      this.playTone(tone, now);
    }

    if (combo >= 25) {
      const tier =
        combo >= 100 ? 3180 :
        combo >= 50 ? 2680 :
        2260;
      const gain =
        combo >= 100 ? 0.075 :
        combo >= 50 ? 0.055 :
        0.04;

      this.playTone(
        {
          frequency: tier,
          gain,
          duration: 0.026,
          type: 'square',
          delay: 0.008,
        },
        now,
      );
    }
  }

  private playTone(spec: ToneSpec, baseTime: number) {
    const context = this.context;
    const master = this.master;
    if (!context || !master) return;

    const start = baseTime + (spec.delay ?? 0);
    const end = start + spec.duration;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();

    oscillator.type = spec.type;
    oscillator.frequency.setValueAtTime(spec.frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(80, spec.frequency * 0.92),
      end,
    );

    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(spec.gain, start + 0.004);
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);

    oscillator.connect(envelope);
    envelope.connect(master);
    oscillator.start(start);
    oscillator.stop(end + 0.01);
  }

  async dispose() {
    const context = this.context;
    this.context = null;
    this.master = null;
    if (context && context.state !== 'closed') {
      await context.close().catch(() => undefined);
    }
  }
}
