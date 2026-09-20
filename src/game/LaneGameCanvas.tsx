import { Pause, Play, RotateCcw, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Beatmap, GameModeId, HitObject, Judge, ScoreState } from '../types';
import { HitSoundEngine } from './hitSound';
import { gameModeById } from './modes';

interface Props {
  beatmap: Beatmap;
  audioUrl: string;
  mode: Exclude<GameModeId, 'forge'>;
  offsetMs: number;
  volume: number;
  hitSoundVolume: number;
  onExit: () => void;
  onFinish?: (result: ScoreState) => void;
}

type GameStatus = 'ready' | 'playing' | 'paused' | 'finished';

interface ActiveLaneHold {
  object: HitObject;
  lane: number;
  judge: Exclude<Judge, 'miss'>;
  broken: boolean;
}

interface LanePopup {
  lane: number;
  label: string;
  points: number;
  at: number;
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

function rankFor(accuracy: number, misses: number) {
  if (accuracy >= 99.5 && misses === 0) return 'SS';
  if (accuracy >= 96) return 'S';
  if (accuracy >= 90) return 'A';
  if (accuracy >= 82) return 'B';
  if (accuracy >= 72) return 'C';
  return 'D';
}

function laneFor(object: HitObject, lanes: number) {
  if (lanes <= 1) return 0;
  if (Number.isInteger(object.lane)) {
    return Math.max(0, Math.min(lanes - 1, object.lane!));
  }
  const mixed = (object.x * 0.72 + ((object.id * 0.61803398875) % 1) * 0.28) % 1;
  return Math.max(0, Math.min(lanes - 1, Math.floor(mixed * lanes)));
}

function keyMapFor(lanes: number) {
  if (lanes === 4) return ['d', 'f', 'j', 'k'];
  if (lanes === 2) return ['f', 'j'];
  return [' '];
}

export function LaneGameCanvas({
  beatmap,
  audioUrl,
  mode,
  offsetMs,
  volume,
  hitSoundVolume,
  onExit,
  onFinish,
}: Props) {
  const definition = gameModeById(mode);
  const lanes = definition.lanes ?? 1;
  const keys = useMemo(() => keyMapFor(lanes), [lanes]);

  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const rafRef = useRef<number | null>(null);
  const judgedRef = useRef(new Set<number>());
  const holdsRef = useRef(new Map<number, ActiveLaneHold>());
  const missCursorRef = useRef(0);
  const scoreRef = useRef<ScoreState>({ ...EMPTY_SCORE, totalObjects: beatmap.objects.length });
  const popupRef = useRef<LanePopup[]>([]);
  const keyLanesRef = useRef(new Set<number>());
  const pointersRef = useRef(new Map<number, number>());
  const hitSoundRef = useRef<HitSoundEngine | null>(null);
  const resultReportedRef = useRef(false);

  const [status, setStatus] = useState<GameStatus>('ready');
  const [score, setScore] = useState<ScoreState>(() => ({ ...EMPTY_SCORE, totalObjects: beatmap.objects.length }));
  const [progress, setProgress] = useState(0);
  const [comboPulseKey, setComboPulseKey] = useState(0);

  const durationMs = beatmap.duration * 1000;

  const lanePressed = useCallback((lane: number) => {
    if (keyLanesRef.current.has(lane)) return true;
    for (const pointerLane of pointersRef.current.values()) {
      if (pointerLane === lane) return true;
    }
    return false;
  }, []);

  const applyJudge = useCallback((judge: Judge, lane: number, soundKind?: 'hold-end' | 'slide-end') => {
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

    const points = Math.max(0, next.score - previous.score);
    scoreRef.current = next;
    setScore(next);
    popupRef.current.push({ lane, label: judge.toUpperCase(), points, at: performance.now() });
    if (popupRef.current.length > 20) popupRef.current.splice(0, popupRef.current.length - 20);

    if (judge !== 'miss') {
      hitSoundRef.current?.play(soundKind ?? judge, next.combo);
    }
  }, []);

  const resetGame = useCallback(() => {
    judgedRef.current = new Set();
    holdsRef.current = new Map();
    missCursorRef.current = 0;
    popupRef.current = [];
    keyLanesRef.current = new Set();
    pointersRef.current = new Map();
    resultReportedRef.current = false;
    const initial = { ...EMPTY_SCORE, totalObjects: beatmap.objects.length };
    scoreRef.current = initial;
    setScore(initial);
    setProgress(0);
  }, [beatmap.objects.length]);

  const attemptLane = useCallback((lane: number) => {
    if (status !== 'playing') return;
    const audio = audioRef.current;
    if (!audio) return;

    const nowMs = audio.currentTime * 1000 + offsetMs;
    let best: HitObject | null = null;
    let bestDelta = Infinity;

    for (const object of beatmap.objects) {
      if (judgedRef.current.has(object.id) || holdsRef.current.has(object.id)) continue;
      const delta = nowMs - object.time;
      if (delta < -beatmap.hitWindowMs) break;
      if (Math.abs(delta) > beatmap.hitWindowMs) continue;
      if (laneFor(object, lanes) !== lane) continue;

      if (Math.abs(delta) < Math.abs(bestDelta)) {
        best = object;
        bestDelta = delta;
      }
    }

    if (!best) return;
    const judge = judgeFor(bestDelta, beatmap.hitWindowMs);
    if (!judge) return;

    if (best.type === 'tap' || !best.duration) {
      judgedRef.current.add(best.id);
      applyJudge(judge, lane);
      return;
    }

    holdsRef.current.set(best.id, {
      object: best,
      lane,
      judge,
      broken: false,
    });
    hitSoundRef.current?.play('hold-start', scoreRef.current.combo);
  }, [applyJudge, beatmap.hitWindowMs, beatmap.objects, lanes, offsetMs, status]);

  const markMisses = useCallback((nowMs: number) => {
    while (missCursorRef.current < beatmap.objects.length) {
      const object = beatmap.objects[missCursorRef.current];
      if (object.time >= nowMs - beatmap.hitWindowMs) break;
      if (!judgedRef.current.has(object.id) && !holdsRef.current.has(object.id)) {
        judgedRef.current.add(object.id);
        applyJudge('miss', laneFor(object, lanes));
      }
      missCursorRef.current += 1;
    }
  }, [applyJudge, beatmap.hitWindowMs, beatmap.objects, lanes]);

  const updateHolds = useCallback((nowMs: number) => {
    for (const [id, active] of holdsRef.current.entries()) {
      const endTime = active.object.time + (active.object.duration ?? 0);
      if (!lanePressed(active.lane) && nowMs < endTime - 40) active.broken = true;
      if (nowMs < endTime) continue;

      holdsRef.current.delete(id);
      judgedRef.current.add(id);
      applyJudge(
        active.broken ? 'miss' : active.judge,
        active.lane,
        active.object.type === 'slide' ? 'slide-end' : 'hold-end',
      );
    }
  }, [applyJudge, lanePressed]);

  const draw = useCallback((nowMs: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(rect.width * dpr);
    const pixelHeight = Math.round(rect.height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const w = rect.width;
    const h = rect.height;
    const laneWidth = w / lanes;
    const hitY = h * 0.84;
    const topY = h * 0.11;
    const now = performance.now();

    ctx.clearRect(0, 0, w, h);

    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#11162a');
    bg.addColorStop(0.62, '#090d18');
    bg.addColorStop(1, '#05070d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    for (let lane = 0; lane < lanes; lane += 1) {
      const x = lane * laneWidth;
      const pressed = lanePressed(lane);
      ctx.fillStyle = pressed
        ? 'rgba(139,124,255,.16)'
        : lane % 2 === 0
          ? 'rgba(255,255,255,.018)'
          : 'rgba(255,255,255,.032)';
      ctx.fillRect(x, topY, laneWidth, hitY - topY + 34);

      if (lane > 0) {
        ctx.strokeStyle = 'rgba(255,255,255,.10)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, topY);
        ctx.lineTo(x, hitY + 34);
        ctx.stroke();
      }
    }

    ctx.strokeStyle = 'rgba(255,255,255,.26)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, hitY);
    ctx.lineTo(w, hitY);
    ctx.stroke();

    const visibleStart = nowMs - beatmap.hitWindowMs;
    const visibleEnd = nowMs + beatmap.approachMs;

    for (const object of beatmap.objects) {
      if (judgedRef.current.has(object.id)) continue;
      const active = holdsRef.current.get(object.id);
      if (!active && (object.time < visibleStart || object.time > visibleEnd)) continue;

      const lane = laneFor(object, lanes);
      const centerX = lane * laneWidth + laneWidth / 2;
      const noteWidth = Math.max(30, laneWidth * 0.64);
      const isHold = object.type !== 'tap' && Boolean(object.duration);

      let y = hitY;
      if (!active) {
        const travel = 1 - Math.max(0, Math.min(1, (object.time - nowMs) / beatmap.approachMs));
        y = topY + (hitY - topY) * travel;
      }

      if (isHold && !active) {
        const endTravel = 1 - Math.max(
          0,
          Math.min(1, (object.time + (object.duration ?? 0) - nowMs) / beatmap.approachMs),
        );
        const endY = topY + (hitY - topY) * endTravel;
        ctx.strokeStyle = object.type === 'slide' ? 'rgba(139,124,255,.62)' : 'rgba(69,214,180,.62)';
        ctx.lineWidth = Math.max(8, noteWidth * 0.3);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(centerX, Math.min(y, endY));
        ctx.lineTo(centerX, Math.max(y, endY));
        ctx.stroke();
      }

      const color =
        object.type === 'slide' ? '#9b8cff' :
        object.type === 'hold' ? '#52dfbd' :
        '#ff669f';

      ctx.fillStyle = active?.broken ? '#ff6f68' : color;
      ctx.shadowColor = color;
      ctx.shadowBlur = active ? 22 : 12;
      ctx.beginPath();
      ctx.roundRect(centerX - noteWidth / 2, y - 11, noteWidth, 22, 8);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    const labels = keys.map((key) => key === ' ' ? 'SPACE' : key.toUpperCase());
    for (let lane = 0; lane < lanes; lane += 1) {
      const centerX = lane * laneWidth + laneWidth / 2;
      ctx.fillStyle = lanePressed(lane) ? '#ffffff' : 'rgba(255,255,255,.72)';
      ctx.font = `900 ${lanes === 1 ? 18 : 14}px ui-sans-serif, system-ui`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(labels[lane] ?? '', centerX, hitY + 24);
    }

    popupRef.current = popupRef.current.filter((popup) => now - popup.at < 650);
    for (const popup of popupRef.current) {
      const age = now - popup.at;
      const p = Math.max(0, Math.min(1, age / 650));
      const fade = 1 - p;
      const centerX = popup.lane * laneWidth + laneWidth / 2;
      const y = hitY - 42 - p * 35;
      const color =
        popup.label === 'PERFECT' ? '#8ff3dc' :
        popup.label === 'GREAT' ? '#88dcff' :
        popup.label === 'GOOD' ? '#ffd784' :
        '#ff7974';

      ctx.globalAlpha = fade;
      ctx.fillStyle = color;
      ctx.font = `900 ${Math.max(14, Math.min(22, laneWidth * 0.12))}px ui-sans-serif, system-ui`;
      ctx.textAlign = 'center';
      ctx.fillText(popup.label, centerX, y);
      ctx.fillStyle = 'rgba(255,255,255,.92)';
      ctx.font = `800 ${Math.max(11, Math.min(16, laneWidth * 0.085))}px ui-sans-serif, system-ui`;
      ctx.fillText(`+${popup.points.toLocaleString()}`, centerX, y + 20);
      ctx.globalAlpha = 1;
    }
  }, [beatmap.approachMs, beatmap.hitWindowMs, beatmap.objects, keys, lanePressed, lanes]);

  const frame = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const nowMs = audio.currentTime * 1000 + offsetMs;
    if (status === 'playing') {
      markMisses(nowMs);
      updateHolds(nowMs);
      setProgress(Math.max(0, Math.min(1, nowMs / Math.max(durationMs, 1))));
    }

    draw(nowMs);
    rafRef.current = requestAnimationFrame(frame);
  }, [draw, durationMs, markMisses, offsetMs, status, updateHolds]);

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
    if (score.combo > 0) setComboPulseKey((value) => value + 1);
  }, [score.combo]);

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
    const root = rootRef.current;
    if (!root) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const lane = keys.indexOf(key);
      if (lane < 0) return;
      event.preventDefault();
      if (event.repeat) return;
      keyLanesRef.current.add(lane);
      attemptLane(lane);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const lane = keys.indexOf(key);
      if (lane < 0) return;
      event.preventDefault();
      keyLanesRef.current.delete(lane);
    };

    root.addEventListener('keydown', onKeyDown);
    root.addEventListener('keyup', onKeyUp);
    return () => {
      root.removeEventListener('keydown', onKeyDown);
      root.removeEventListener('keyup', onKeyUp);
    };
  }, [attemptLane, keys]);

  const laneFromPointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const normalized = Math.max(0, Math.min(0.9999, (event.clientX - rect.left) / rect.width));
    return lanes === 1 ? 0 : Math.floor(normalized * lanes);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    rootRef.current?.focus();
    const lane = laneFromPointer(event);
    pointersRef.current.set(event.pointerId, lane);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    attemptLane(lane);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, laneFromPointer(event));
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(event.pointerId);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const start = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    resetGame();
    audio.currentTime = 0;
    rootRef.current?.focus();

    await hitSoundRef.current?.prime().catch(() => undefined);
    setStatus('playing');

    try {
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
      if (!judgedRef.current.has(object.id) && !holdsRef.current.has(object.id)) {
        judgedRef.current.add(object.id);
        applyJudge('miss', laneFor(object, lanes));
      }
    }

    for (const [id, active] of holdsRef.current.entries()) {
      holdsRef.current.delete(id);
      judgedRef.current.add(id);
      applyJudge(
        active.broken ? 'miss' : active.judge,
        active.lane,
        active.object.type === 'slide' ? 'slide-end' : 'hold-end',
      );
    }

    setProgress(1);
    setStatus('finished');
  }, [applyJudge, beatmap.objects, lanes]);

  const accuracyText = score.accuracy.toFixed(2);
  const timeText = useMemo(() => {
    const seconds = Math.max(0, Math.round((1 - progress) * beatmap.duration));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }, [beatmap.duration, progress]);

  return (
    <div className="game-shell lane-game-shell" ref={rootRef} tabIndex={0} aria-label={definition.label}>
      <audio ref={audioRef} src={audioUrl} preload="auto" onEnded={finish} />

      <div className="game-hud game-hud-left">
        <button className="icon-button" type="button" onClick={onExit} aria-label="離開遊戲"><X size={20} /></button>
        <div>
          <strong>{beatmap.title}</strong>
          <span>{definition.label} · {beatmap.difficultyLabel}</span>
        </div>
      </div>

      <div className="game-hud game-hud-right">
        <div className="hud-score"><strong>{score.score.toLocaleString()}</strong><span>{accuracyText}%</span></div>
        <div key={comboPulseKey} className="hud-combo">{score.combo}<span>x</span></div>
        <button className="icon-button" type="button" onClick={togglePause} disabled={status === 'ready' || status === 'finished'} aria-label="暫停或繼續">
          {status === 'paused' ? <Play size={20} /> : <Pause size={20} />}
        </button>
      </div>

      <canvas
        ref={canvasRef}
        className="game-canvas lane-game-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />

      <div className="game-progress" aria-hidden="true"><span style={{ width: `${progress * 100}%` }} /></div>
      <div className="game-time">{timeText}</div>

      {status === 'ready' && (
        <div className="game-overlay">
          <div className="game-modal">
            <span className="eyebrow">{definition.label}</span>
            <h2>{beatmap.difficultyLabel}</h2>
            <p>
              電腦：{definition.controlsDesktop}<br />
              手機：{definition.controlsMobile}
            </p>
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
            <div className="result-rank">{rankFor(score.accuracy, score.miss)}</div>
            <div className="result-copy">
              <span className="eyebrow">{definition.label}</span>
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
