import { Pause, Play, RotateCcw, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Beatmap, HitObject, Judge, ScoreState } from '../types';
import { HitSoundEngine, type HitSoundKind } from './hitSound';

interface Props {
  beatmap: Beatmap;
  audioUrl: string;
  offsetMs: number;
  volume: number;
  hitSoundVolume: number;
  onExit: () => void;
  onFinish?: (result: ScoreState) => void;
}

type GameStatus = 'ready' | 'playing' | 'paused' | 'finished';

interface ActiveSustain {
  object: HitObject;
  judge: Exclude<Judge, 'miss'>;
  broken: boolean;
}

interface HitBurst {
  x: number;
  y: number;
  judge: Exclude<Judge, 'miss'>;
  at: number;
  seed: number;
}

const EMPTY_SCORE: ScoreState = {
  score: 0,
  combo: 0,
  maxCombo: 0,
  perfect: 0,
  great: 0,
  good: 0,
  miss: 0,
  judged: 0,
  totalObjects: 0,
  accuracy: 100,
};

function judgeFor(delta: number, hitWindow: number): Exclude<Judge, 'miss'> | null {
  const abs = Math.abs(delta);
  if (abs <= Math.min(55, hitWindow * 0.38)) return 'perfect';
  if (abs <= Math.min(105, hitWindow * 0.68)) return 'great';
  if (abs <= hitWindow) return 'good';
  return null;
}

function judgeWeight(judge: Judge) {
  if (judge === 'perfect') return 1;
  if (judge === 'great') return 0.7;
  if (judge === 'good') return 0.3;
  return 0;
}

function scoreValue(judge: Judge) {
  if (judge === 'perfect') return 1000;
  if (judge === 'great') return 650;
  if (judge === 'good') return 300;
  return 0;
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function resultRank(accuracy: number, misses: number) {
  if (accuracy >= 99.5 && misses === 0) return 'SS';
  if (accuracy >= 96) return 'S';
  if (accuracy >= 90) return 'A';
  if (accuracy >= 82) return 'B';
  if (accuracy >= 72) return 'C';
  return 'D';
}

export function GameCanvas({
  beatmap,
  audioUrl,
  offsetMs,
  volume,
  hitSoundVolume,
  onExit,
  onFinish,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const rafRef = useRef<number | null>(null);
  const judgedRef = useRef(new Set<number>());
  const engagedRef = useRef(new Map<number, ActiveSustain>());
  const missCursorRef = useRef(0);
  const cursorRef = useRef({ x: 0.5, y: 0.5 });
  const pointerDownRef = useRef(false);
  const keyDownRef = useRef(false);
  const lastJudgeRef = useRef<{ text: string; at: number } | null>(null);
  const hitBurstsRef = useRef<HitBurst[]>([]);
  const comboTimerRef = useRef<number | null>(null);
  const resultReportedRef = useRef(false);
  const scoreRef = useRef<ScoreState>({ ...EMPTY_SCORE, totalObjects: beatmap.objects.length });
  const hitSoundRef = useRef<HitSoundEngine | null>(null);
  const [status, setStatus] = useState<GameStatus>('ready');
  const [score, setScore] = useState<ScoreState>(() => ({ ...EMPTY_SCORE, totalObjects: beatmap.objects.length }));
  const [progress, setProgress] = useState(0);
  const [currentJudge, setCurrentJudge] = useState('');
  const [judgePulseKey, setJudgePulseKey] = useState(0);
  const [comboPulseKey, setComboPulseKey] = useState(0);
  const [comboMilestone, setComboMilestone] = useState<number | null>(null);
  const [isTouch, setIsTouch] = useState(false);

  const durationMs = beatmap.duration * 1000;

  const resetRefs = useCallback(() => {
    judgedRef.current = new Set();
    engagedRef.current = new Map();
    missCursorRef.current = 0;
    pointerDownRef.current = false;
    keyDownRef.current = false;
    lastJudgeRef.current = null;
    hitBurstsRef.current = [];
    if (comboTimerRef.current !== null) {
      window.clearTimeout(comboTimerRef.current);
      comboTimerRef.current = null;
    }
    resultReportedRef.current = false;
    setComboMilestone(null);
    cursorRef.current = { x: 0.5, y: 0.5 };
  }, []);

  const triggerHitFeedback = useCallback((
    judge: Exclude<Judge, 'miss'>,
    point: { x: number; y: number },
  ) => {
    hitBurstsRef.current.push({
      x: point.x,
      y: point.y,
      judge,
      at: performance.now(),
      seed: performance.now() + point.x * 997 + point.y * 313,
    });
    if (hitBurstsRef.current.length > 18) hitBurstsRef.current.splice(0, hitBurstsRef.current.length - 18);

    if (isTouch && 'vibrate' in navigator) {
      navigator.vibrate(judge === 'perfect' ? 12 : judge === 'great' ? 8 : 5);
    }
  }, [isTouch]);

  const applyJudge = useCallback((
    judge: Judge,
    feedbackPoint?: { x: number; y: number },
    soundKind?: HitSoundKind,
  ) => {
    const previous = scoreRef.current;
    const next = { ...previous };
    next.judged += 1;

    if (judge === 'miss') {
      next.miss += 1;
      next.combo = 0;
    } else {
      next[judge] += 1;
      next.combo += 1;
      next.maxCombo = Math.max(next.maxCombo, next.combo);
      const multiplier = 1 + Math.min(next.combo, 100) / 50;
      next.score += Math.round(scoreValue(judge) * multiplier);
    }

    const weighted =
      next.perfect * judgeWeight('perfect') +
      next.great * judgeWeight('great') +
      next.good * judgeWeight('good');
    next.accuracy = next.judged > 0 ? (weighted / next.judged) * 100 : 100;

    scoreRef.current = next;
    setScore(next);

    if (judge !== 'miss') {
      if (feedbackPoint) triggerHitFeedback(judge, feedbackPoint);
      hitSoundRef.current?.play(soundKind ?? judge, next.combo);
    }

    lastJudgeRef.current = { text: judge.toUpperCase(), at: performance.now() };
    setJudgePulseKey((value) => value + 1);
    setCurrentJudge(judge.toUpperCase());
  }, [triggerHitFeedback]);

  const markMisses = useCallback((nowMs: number) => {
    const windowMs = beatmap.hitWindowMs;
    while (missCursorRef.current < beatmap.objects.length) {
      const object = beatmap.objects[missCursorRef.current];
      if (object.time >= nowMs - windowMs) break;

      if (!judgedRef.current.has(object.id) && !engagedRef.current.has(object.id)) {
        judgedRef.current.add(object.id);
        applyJudge('miss', { x: object.x, y: object.y });
      }
      missCursorRef.current += 1;
    }
  }, [applyJudge, beatmap.hitWindowMs, beatmap.objects]);

  const finalizeSustains = useCallback((nowMs: number) => {
    for (const [id, active] of engagedRef.current.entries()) {
      const endTime = active.object.time + (active.object.duration ?? 0);
      if (nowMs < endTime) continue;

      engagedRef.current.delete(id);
      judgedRef.current.add(id);
      const feedbackPoint = active.object.type === 'slide'
        ? { x: active.object.endX ?? active.object.x, y: active.object.endY ?? active.object.y }
        : { x: active.object.x, y: active.object.y };
      applyJudge(
        active.broken ? 'miss' : active.judge,
        feedbackPoint,
        active.object.type === 'slide' ? 'slide-end' : 'hold-end',
      );
    }
  }, [applyJudge]);

  const currentTargetFor = useCallback((object: HitObject, nowMs: number) => {
    if (object.type !== 'slide') return { x: object.x, y: object.y };
    const duration = Math.max(object.duration ?? 1, 1);
    const p = Math.max(0, Math.min(1, (nowMs - object.time) / duration));
    return {
      x: object.x + ((object.endX ?? object.x) - object.x) * p,
      y: object.y + ((object.endY ?? object.y) - object.y) * p,
    };
  }, []);

  const validateSustains = useCallback((nowMs: number) => {
    const pressed = pointerDownRef.current || keyDownRef.current;
    for (const active of engagedRef.current.values()) {
      if (!pressed) {
        active.broken = true;
        continue;
      }
      if (active.object.type === 'slide') {
        const target = currentTargetFor(active.object, nowMs);
        if (distance(target, cursorRef.current) > 0.19) active.broken = true;
      }
    }
  }, [currentTargetFor]);

  const attemptHit = useCallback((point: { x: number; y: number }) => {
    if (status !== 'playing') return;
    const audio = audioRef.current;
    if (!audio) return;

    const nowMs = audio.currentTime * 1000 + offsetMs;
    let best: HitObject | null = null;
    let bestDelta = Infinity;

    for (const object of beatmap.objects) {
      if (judgedRef.current.has(object.id) || engagedRef.current.has(object.id)) continue;
      const delta = nowMs - object.time;
      if (delta < -beatmap.hitWindowMs) break;
      if (Math.abs(delta) > beatmap.hitWindowMs) continue;

      const radius = object.type === 'tap' ? 0.13 : 0.15;
      if (distance(point, object) > radius) continue;

      if (Math.abs(delta) < Math.abs(bestDelta)) {
        best = object;
        bestDelta = delta;
      }
    }

    if (!best) return;
    const judge = judgeFor(bestDelta, beatmap.hitWindowMs);
    if (!judge) return;

    if (best.type === 'tap') {
      judgedRef.current.add(best.id);
      applyJudge(judge, { x: best.x, y: best.y });
    } else {
      engagedRef.current.set(best.id, { object: best, judge, broken: false });
      triggerHitFeedback(judge, { x: best.x, y: best.y });
      hitSoundRef.current?.play('hold-start', scoreRef.current.combo);
      lastJudgeRef.current = { text: 'HOLD', at: performance.now() };
      setJudgePulseKey((value) => value + 1);
      setCurrentJudge('HOLD');
    }
  }, [applyJudge, beatmap.hitWindowMs, beatmap.objects, offsetMs, status, triggerHitFeedback]);

  const draw = useCallback((nowMs: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(rect.width * dpr);
    const height = Math.round(rect.height * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const w = rect.width;
    const h = rect.height;
    const unit = Math.min(w, h);
    ctx.clearRect(0, 0, w, h);

    const effectNow = performance.now();
    hitBurstsRef.current = hitBurstsRef.current.filter((burst) => effectNow - burst.at < 460);

    let shakeX = 0;
    let shakeY = 0;
    for (const burst of hitBurstsRef.current) {
      const age = effectNow - burst.at;
      if (age > 95) continue;
      const strength = (burst.judge === 'perfect' ? 4.2 : burst.judge === 'great' ? 2.8 : 1.6) * (1 - age / 95);
      shakeX += Math.sin(burst.seed * 0.013 + effectNow * 0.095) * strength;
      shakeY += Math.cos(burst.seed * 0.017 + effectNow * 0.11) * strength * 0.65;
    }

    ctx.save();
    ctx.translate(shakeX, shakeY);

    const gradient = ctx.createRadialGradient(w * 0.5, h * 0.45, 10, w * 0.5, h * 0.5, Math.max(w, h) * 0.75);
    gradient.addColorStop(0, '#181e31');
    gradient.addColorStop(0.55, '#0d1120');
    gradient.addColorStop(1, '#070910');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(255,255,255,.035)';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 52) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 0; y < h; y += 52) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    const visibleStart = nowMs - beatmap.hitWindowMs;
    const visibleEnd = nowMs + beatmap.approachMs;

    for (const object of beatmap.objects) {
      if (judgedRef.current.has(object.id)) continue;
      const engaged = engagedRef.current.get(object.id);
      if (!engaged && (object.time < visibleStart || object.time > visibleEnd)) continue;

      const x = object.x * w;
      const y = object.y * h;
      const baseRadius = Math.max(23, Math.min(42, unit * 0.055));
      const typeColor = object.type === 'slide' ? '#8b7cff' : object.type === 'hold' ? '#45d6b4' : '#ff5e9c';

      if (object.type === 'slide') {
        const endX = (object.endX ?? object.x) * w;
        const endY = (object.endY ?? object.y) * h;
        ctx.strokeStyle = 'rgba(139,124,255,.32)';
        ctx.lineWidth = baseRadius * 1.05;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(endX, endY);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,.18)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(endX, endY);
        ctx.stroke();
      }

      if (!engaged) {
        const approach = Math.max(0, Math.min(1, (object.time - nowMs) / beatmap.approachMs));
        const approachRadius = baseRadius * (1 + approach * 2.1);
        ctx.strokeStyle = typeColor;
        ctx.globalAlpha = 0.35 + (1 - approach) * 0.45;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, approachRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;

        ctx.fillStyle = '#111626';
        ctx.strokeStyle = typeColor;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(x, y, baseRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = `700 ${Math.round(baseRadius * 0.7)}px ui-sans-serif, system-ui`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String((object.id % 9) + 1), x, y + 1);

        if (object.type !== 'tap') {
          ctx.font = `700 ${Math.round(baseRadius * 0.3)}px ui-sans-serif, system-ui`;
          ctx.fillStyle = typeColor;
          ctx.fillText(object.type === 'hold' ? 'HOLD' : 'SLIDE', x, y + baseRadius * 1.42);
        }
      } else {
        const target = currentTargetFor(object, nowMs);
        const tx = target.x * w;
        const ty = target.y * h;
        ctx.fillStyle = engaged.broken ? '#ff665f' : typeColor;
        ctx.globalAlpha = 0.95;
        ctx.beginPath();
        ctx.arc(tx, ty, baseRadius * 0.82, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        const remain = Math.max(0, (object.time + (object.duration ?? 0) - nowMs) / Math.max(object.duration ?? 1, 1));
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(tx, ty, baseRadius * 1.05, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * remain);
        ctx.stroke();
      }
    }


    for (const burst of hitBurstsRef.current) {
      const age = effectNow - burst.at;
      const progress = Math.max(0, Math.min(1, age / 460));
      const fade = 1 - progress;
      const x = burst.x * w;
      const y = burst.y * h;
      const color =
        burst.judge === 'perfect' ? '#8ff3dc' :
        burst.judge === 'great' ? '#88dcff' :
        '#ffd784';
      const strength =
        burst.judge === 'perfect' ? 1 :
        burst.judge === 'great' ? 0.76 :
        0.52;

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';

      const glow = ctx.createRadialGradient(x, y, 0, x, y, 70 + progress * 55);
      glow.addColorStop(0, color);
      glow.addColorStop(0.18, color);
      glow.addColorStop(1, 'transparent');
      ctx.globalAlpha = fade * 0.16 * strength;
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, 76 + progress * 58, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = fade * 0.9 * strength;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.5, 5 * (1 - progress));
      ctx.beginPath();
      ctx.arc(x, y, 26 + progress * 66, 0, Math.PI * 2);
      ctx.stroke();

      ctx.globalAlpha = fade * 0.72 * strength;
      ctx.lineWidth = Math.max(1, 3.6 * (1 - progress));
      const streaks = burst.judge === 'perfect' ? 12 : burst.judge === 'great' ? 9 : 6;
      for (let i = 0; i < streaks; i += 1) {
        const angle = (Math.PI * 2 * i) / streaks + Math.sin(burst.seed + i * 2.17) * 0.22;
        const inner = 20 + progress * 15;
        const outer = inner + (30 + Math.abs(Math.sin(burst.seed * 0.1 + i)) * 34) * fade;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(angle) * inner, y + Math.sin(angle) * inner);
        ctx.lineTo(x + Math.cos(angle) * outer, y + Math.sin(angle) * outer);
        ctx.stroke();
      }

      const sparks = burst.judge === 'perfect' ? 10 : burst.judge === 'great' ? 7 : 4;
      ctx.fillStyle = color;
      for (let i = 0; i < sparks; i += 1) {
        const angle = Math.sin(burst.seed * 0.071 + i * 4.37) * Math.PI * 2;
        const travel = (18 + Math.abs(Math.cos(burst.seed + i)) * 58) * progress;
        const px = x + Math.cos(angle) * travel;
        const py = y + Math.sin(angle) * travel;
        const radius = Math.max(1, 4.5 * fade * strength);
        ctx.globalAlpha = fade * 0.92;
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }

    if (!isTouch) {
      const cursor = cursorRef.current;
      const cx = cursor.x * w;
      const cy = cursor.y * h;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(cx, cy, 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }, [beatmap, currentTargetFor, isTouch]);

  const frame = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const nowMs = audio.currentTime * 1000 + offsetMs;
    if (status === 'playing') {
      markMisses(nowMs);
      validateSustains(nowMs);
      finalizeSustains(nowMs);
      setProgress(Math.max(0, Math.min(1, nowMs / Math.max(durationMs, 1))));
    }

    draw(nowMs);

    if (lastJudgeRef.current && performance.now() - lastJudgeRef.current.at > 550 && currentJudge) {
      setCurrentJudge('');
      lastJudgeRef.current = null;
    }

    rafRef.current = requestAnimationFrame(frame);
  }, [currentJudge, draw, durationMs, finalizeSustains, markMisses, offsetMs, status, validateSustains]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(frame);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [frame]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.volume = volume;
  }, [volume]);

  useEffect(() => {
    const engine = new HitSoundEngine(hitSoundVolume);
    hitSoundRef.current = engine;

    return () => {
      if (hitSoundRef.current === engine) hitSoundRef.current = null;
      void engine.dispose();
    };
  }, []);

  useEffect(() => {
    hitSoundRef.current?.setVolume(hitSoundVolume);
  }, [hitSoundVolume]);

  useEffect(() => {
    if (score.combo <= 0) return;

    setComboPulseKey((value) => value + 1);
    const isMilestone =
      score.combo === 10 ||
      score.combo === 25 ||
      score.combo === 50 ||
      (score.combo >= 100 && score.combo % 50 === 0);

    if (!isMilestone) return;

    setComboMilestone(score.combo);
    if (comboTimerRef.current !== null) window.clearTimeout(comboTimerRef.current);
    comboTimerRef.current = window.setTimeout(() => {
      setComboMilestone(null);
      comboTimerRef.current = null;
    }, 900);
  }, [score.combo]);

  useEffect(() => () => {
    if (comboTimerRef.current !== null) window.clearTimeout(comboTimerRef.current);
  }, []);

  useEffect(() => {
    if (
      status === 'finished' &&
      score.judged >= score.totalObjects &&
      !resultReportedRef.current
    ) {
      resultReportedRef.current = true;
      onFinish?.(score);
    }
  }, [onFinish, score, status]);

  useEffect(() => {
    const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    setIsTouch(navigator.maxTouchPoints > 0 || coarsePointer);
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (!['z', 'x', 'Z', 'X'].includes(event.key)) return;
      event.preventDefault();
      if (event.repeat) return;
      keyDownRef.current = true;
      attemptHit(cursorRef.current);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (!['z', 'x', 'Z', 'X'].includes(event.key)) return;
      event.preventDefault();
      keyDownRef.current = false;
      for (const active of engagedRef.current.values()) {
        const audio = audioRef.current;
        if (audio && audio.currentTime * 1000 + offsetMs < active.object.time + (active.object.duration ?? 0) - 40) {
          active.broken = true;
        }
      }
    };

    root.addEventListener('keydown', onKeyDown);
    root.addEventListener('keyup', onKeyUp);
    return () => {
      root.removeEventListener('keydown', onKeyDown);
      root.removeEventListener('keyup', onKeyUp);
    };
  }, [attemptHit, offsetMs]);

  const pointerPosition = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = pointerPosition(event);
    cursorRef.current = point;
    if (event.pointerType === 'touch') setIsTouch(true);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    rootRef.current?.focus();
    const point = pointerPosition(event);
    cursorRef.current = point;
    pointerDownRef.current = true;
    if (event.pointerType === 'touch' || event.pointerType === 'pen') setIsTouch(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    attemptHit(point);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    pointerDownRef.current = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const audio = audioRef.current;
    if (!audio) return;
    const nowMs = audio.currentTime * 1000 + offsetMs;
    for (const active of engagedRef.current.values()) {
      if (nowMs < active.object.time + (active.object.duration ?? 0) - 40) active.broken = true;
    }
  };

  const start = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    resetRefs();
    const initialScore = { ...EMPTY_SCORE, totalObjects: beatmap.objects.length };
    scoreRef.current = initialScore;
    setScore(initialScore);
    setProgress(0);
    setCurrentJudge('');
    audio.currentTime = 0;
    rootRef.current?.focus();
    try {
      await hitSoundRef.current?.prime().catch(() => undefined);
      setStatus('playing');
      await audio.play();
    } catch {
      setStatus('ready');
    }
  };

  const togglePause = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (status === 'playing') {
      audio.pause();
      setStatus('paused');
    } else if (status === 'paused') {
      setStatus('playing');
      rootRef.current?.focus();
      await audio.play();
    }
  };

  const finish = useCallback(() => {
    for (const object of beatmap.objects) {
      if (!judgedRef.current.has(object.id) && !engagedRef.current.has(object.id)) {
        judgedRef.current.add(object.id);
        applyJudge('miss');
      }
    }
    for (const [id, active] of engagedRef.current.entries()) {
      engagedRef.current.delete(id);
      judgedRef.current.add(id);
      const feedbackPoint = active.object.type === 'slide'
        ? { x: active.object.endX ?? active.object.x, y: active.object.endY ?? active.object.y }
        : { x: active.object.x, y: active.object.y };
      applyJudge(
        active.broken ? 'miss' : active.judge,
        feedbackPoint,
        active.object.type === 'slide' ? 'slide-end' : 'hold-end',
      );
    }
    setProgress(1);
    setStatus('finished');
  }, [applyJudge, beatmap.objects]);

  const accuracyText = useMemo(() => score.accuracy.toFixed(2), [score.accuracy]);
  const comboTier =
    score.combo >= 100 ? 'max' :
    score.combo >= 50 ? 'hot' :
    score.combo >= 25 ? 'flow' :
    score.combo >= 10 ? 'warm' :
    'base';
  const timeText = useMemo(() => {
    const seconds = Math.max(0, Math.round((1 - progress) * beatmap.duration));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }, [beatmap.duration, progress]);

  return (
    <div className="game-shell" ref={rootRef} tabIndex={0} aria-label="BeatForge 遊戲區">
      <audio ref={audioRef} src={audioUrl} preload="auto" onEnded={finish} />

      <div className="game-hud game-hud-left">
        <button className="icon-button" type="button" onClick={onExit} aria-label="離開遊戲"><X size={20} /></button>
        <div>
          <strong>{beatmap.title}</strong>
          <span>{beatmap.difficultyLabel} · ★ {beatmap.starRating.toFixed(1)}</span>
        </div>
      </div>

      <div className="game-hud game-hud-right">
        <div className="hud-score"><strong>{score.score.toLocaleString()}</strong><span>{accuracyText}%</span></div>
        <div key={comboPulseKey} className={`hud-combo combo-tier-${comboTier}`}>{score.combo}<span>x</span></div>
        <button className="icon-button" type="button" onClick={togglePause} disabled={status === 'ready' || status === 'finished'} aria-label="暫停或繼續">
          {status === 'paused' ? <Play size={20} /> : <Pause size={20} />}
        </button>
      </div>

      <canvas
        ref={canvasRef}
        className="game-canvas"
        onPointerMove={handlePointerMove}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />

      <div className="game-progress" aria-hidden="true"><span style={{ width: `${progress * 100}%` }} /></div>
      <div className="game-time">{timeText}</div>
      {score.combo >= 10 && (
        <div key={`edge-${comboPulseKey}`} className={`combo-edge-pulse combo-edge-${comboTier}`} aria-hidden="true" />
      )}
      {comboMilestone !== null && (
        <div key={`milestone-${comboMilestone}`} className={`combo-milestone combo-tier-${comboTier}`}>
          <span>{comboMilestone >= 100 ? 'FEVER' : comboMilestone >= 50 ? 'ON FIRE' : 'COMBO'}</span>
          <strong>{comboMilestone}</strong>
          <em>COMBO</em>
        </div>
      )}
      {currentJudge && <div key={judgePulseKey} className={`judge-flash judge-${currentJudge.toLowerCase()}`}>{currentJudge}</div>}

      {status === 'ready' && (
        <div className="game-overlay">
          <div className="game-modal">
            <span className="eyebrow">READY</span>
            <h2>{beatmap.difficultyLabel}</h2>
            <p>{isTouch ? '直接點擊音符；長按 Hold，沿路徑拖曳 Slide。' : '移動滑鼠定位音符，按 Z / X 擊打；Slide 時按住並跟隨路徑。'}</p>
            <button className="primary-button large" type="button" onClick={start}><Play size={20} />開始遊戲</button>
          </div>
        </div>
      )}

      {status === 'paused' && (
        <div className="game-overlay">
          <div className="game-modal">
            <span className="eyebrow">PAUSED</span>
            <h2>已暫停</h2>
            <button className="primary-button large" type="button" onClick={togglePause}><Play size={20} />繼續</button>
          </div>
        </div>
      )}

      {status === 'finished' && (
        <div className="game-overlay">
          <div className="result-modal">
            <div className="result-rank">{resultRank(score.accuracy, score.miss)}</div>
            <div className="result-copy">
              <span className="eyebrow">RESULT</span>
              <h2>{score.score.toLocaleString()}</h2>
              <p>{beatmap.title} · {beatmap.difficultyLabel}</p>
            </div>
            <div className="result-grid">
              <div><span>Accuracy</span><strong>{accuracyText}%</strong></div>
              <div><span>Max Combo</span><strong>{score.maxCombo}x</strong></div>
              <div><span>Perfect</span><strong>{score.perfect}</strong></div>
              <div><span>Great</span><strong>{score.great}</strong></div>
              <div><span>Good</span><strong>{score.good}</strong></div>
              <div><span>Miss</span><strong>{score.miss}</strong></div>
            </div>
            <div className="result-actions">
              <button className="secondary-button" type="button" onClick={onExit}><X size={18} />返回選曲</button>
              <button className="primary-button" type="button" onClick={start}><RotateCcw size={18} />再玩一次</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
