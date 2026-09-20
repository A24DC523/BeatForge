export type DifficultyId = 'easy' | 'normal' | 'hard' | 'expert';
export type GameModeId = 'forge' | 'lanes4' | 'split2' | 'pulse1';
export type HitObjectType = 'tap' | 'hold' | 'slide';
export type Judge = 'perfect' | 'great' | 'good' | 'miss';

export interface AudioAnalysis {
  duration: number;
  bpm: number;
  beatInterval: number;
  beatOffset: number;
  beats: number[];
  energy: number[];
  peaks: number[];
  sampleRate: number;
}

export interface HitObject {
  id: number;
  time: number;
  type: HitObjectType;
  x: number;
  y: number;
  duration?: number;
  endX?: number;
  endY?: number;
  weight: number;
}

export interface BeatmapValidation {
  valid: boolean;
  repaired: number;
  removed: number;
  warnings: string[];
}

export interface Beatmap {
  version: 1;
  title: string;
  artist: string;
  difficulty: DifficultyId;
  difficultyLabel: string;
  starRating: number;
  bpm: number;
  duration: number;
  approachMs: number;
  hitWindowMs: number;
  objects: HitObject[];
  validation: BeatmapValidation;
}

export interface DifficultyPreset {
  id: DifficultyId;
  label: string;
  description: string;
  density: number;
  minGapMs: number;
  approachMs: number;
  hitWindowMs: number;
  holdChance: number;
  slideChance: number;
  starBase: number;
}

export interface ScoreState {
  score: number;
  combo: number;
  maxCombo: number;
  perfect: number;
  great: number;
  good: number;
  miss: number;
  judged: number;
  totalObjects: number;
  accuracy: number;
}

export interface SongSource {
  file: File;
  url: string;
  title: string;
  artist: string;
}
