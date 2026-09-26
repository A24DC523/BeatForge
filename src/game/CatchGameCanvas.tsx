import { Pause, Play, RotateCcw, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n, type MessageKey } from '../i18n';
import type { Beatmap, HitObject, Judge, ScoreState } from '../types';
import { HitSoundEngine } from './hitSound';

interface Props {
  beatmap: Beatmap;
  audioUrl: string;
  offsetMs: number;
  volume: number;
  hitSoundVolume: number;
  onExit: () => void;
  onFinish?: (result: ScoreState) => void;
}

type Status = 'ready' | 'playing' | 'paused' | 'finished';

interface Popup {
  x: number;
  label: string;
  points: number;
  at: number;
}

const EMPTY: ScoreState = {
  score: 0, combo: 0, maxCombo: 0, perfect: 0, great: 0, good: 0,
  miss: 0, judged: 0, totalObjects: 0, accuracy: 100,
};

function baseScore(judge: Judge) {
  if (judge === 'perfect') return 1000;
  if (judge === 'great') return 650;
  if (judge === 'good') return 300;
  return 0;
}

function spatialJudge(distance: number): Judge {
  if (distance <= 0.055) return 'perfect';
  if (distance <= 0.105) return 'great';
  if (distance <= 0.165) return 'good';
  return 'miss';
}

function rankFor(accuracy: number, misses: number) {
  if (accuracy >= 99.5 && misses === 0) return 'SS';
  if (accuracy >= 96) return 'S';
  if (accuracy >= 90) return 'A';
  if (accuracy >= 82) return 'B';
  if (accuracy >= 72) return 'C';
  return 'D';
}

function judgeKey(label: string): MessageKey {
  if (label === 'PERFECT') return 'common.perfect';
  if (label === 'GREAT') return 'common.great';
  if (label === 'GOOD') return 'common.good';
  return 'common.miss';
}

export function CatchGameCanvas({
  beatmap, audioUrl, offsetMs, volume, hitSoundVolume, onExit, onFinish,
}: Props) {
  const { t, number } = useI18n();
  const difficultyLabel = t(`difficulty.${beatmap.difficulty}.label` as MessageKey);
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const rafRef = useRef<number | null>(null);
  const judgedRef = useRef(new Set<number>());
  const cursorRef = useRef(0);
  const catcherXRef = useRef(0.5);
  const directionRef = useRef(0);
  const lastFrameRef = useRef(performance.now());
  const scoreRef = useRef<ScoreState>({ ...EMPTY, totalObjects: beatmap.objects.length });
  const popupRef = useRef<Popup[]>([]);
  const engineRef = useRef<HitSoundEngine | null>(null);
  const reportedRef = useRef(false);

  const [status, setStatus] = useState<Status>('ready');
  const [score, setScore] = useState<ScoreState>(() => ({ ...EMPTY, totalObjects: beatmap.objects.length }));
  const [progress, setProgress] = useState(0);
  const [comboKey, setComboKey] = useState(0);

  const applyJudge = useCallback((judge: Judge, x: number) => {
    const prev = scoreRef.current;
    const next = { ...prev };
    next.judged += 1;

    if (judge === 'miss') {
      next.miss += 1;
      next.combo = 0;
    } else {
      next[judge] += 1;
      next.combo += 1;
      next.maxCombo = Math.max(next.maxCombo, next.combo);
      const multiplier = 1 + Math.min(next.combo, 100) / 50;
      next.score += Math.round(baseScore(judge) * multiplier);
    }

    const weighted = next.perfect + next.great * 0.7 + next.good * 0.3;
    next.accuracy = next.judged ? (weighted / next.judged) * 100 : 100;
    const points = Math.max(0, next.score - prev.score);

    scoreRef.current = next;
    setScore(next);
    popupRef.current.push({ x, label: judge.toUpperCase(), points, at: performance.now() });
    if (popupRef.current.length > 18) popupRef.current.splice(0, popupRef.current.length - 18);

    if (judge !== 'miss') engineRef.current?.play(judge, next.combo);
  }, []);

  const processDueNotes = useCallback((nowMs: number) => {
    while (cursorRef.current < beatmap.objects.length) {
      const object = beatmap.objects[cursorRef.current];
      if (object.time > nowMs) break;

      if (!judgedRef.current.has(object.id)) {
        judgedRef.current.add(object.id);
        applyJudge(spatialJudge(Math.abs(catcherXRef.current - object.x)), object.x);
      }
      cursorRef.current += 1;
    }
  }, [applyJudge, beatmap.objects]);

  const draw = useCallback((nowMs: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelW = Math.round(rect.width * dpr);
    const pixelH = Math.round(rect.height * dpr);
    if (canvas.width !== pixelW || canvas.height !== pixelH) {
      canvas.width = pixelW;
      canvas.height = pixelH;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const w = rect.width;
    const h = rect.height;
    const topY = h * 0.08;
    const catchY = h * 0.82;
    const now = performance.now();

    ctx.clearRect(0, 0, w, h);
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#11172a');
    bg.addColorStop(0.62, '#09101a');
    bg.addColorStop(1, '#04070c');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(255,255,255,.11)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 5; i += 1) {
      const x = (w * i) / 5;
      ctx.beginPath();
      ctx.moveTo(x, topY);
      ctx.lineTo(x, catchY + 45);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(255,255,255,.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, catchY);
    ctx.lineTo(w, catchY);
    ctx.stroke();

    const visibleEnd = nowMs + beatmap.approachMs;
    for (const object of beatmap.objects) {
      if (judgedRef.current.has(object.id)) continue;
      if (object.time < nowMs - 80 || object.time > visibleEnd) continue;

      const travel = 1 - Math.max(0, Math.min(1, (object.time - nowMs) / beatmap.approachMs));
      const y = topY + (catchY - topY) * travel;
      const x = object.x * w;
      const radius = object.weight > 1.08 ? 18 : 13;
      const color =
        object.type === 'slide' ? '#9b8cff' :
        object.type === 'hold' ? '#54dfbd' :
        '#ff669f';

      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      if (object.type !== 'tap') {
        ctx.strokeStyle = 'rgba(255,255,255,.55)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, radius + 5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    const catcherX = catcherXRef.current * w;
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#8b7cff';
    ctx.shadowBlur = 24;
    ctx.beginPath();
    ctx.roundRect(catcherX - 46, catchY + 8, 92, 22, 11);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#8b7cff';
    ctx.beginPath();
    ctx.roundRect(catcherX - 27, catchY + 12, 54, 14, 7);
    ctx.fill();

    popupRef.current = popupRef.current.filter((popup) => now - popup.at < 620);
    for (const popup of popupRef.current) {
      const age = now - popup.at;
      const p = age / 620;
      const alpha = Math.max(0, 1 - p);
      const x = popup.x * w;
      const y = catchY - 35 - p * 30;
      const color =
        popup.label === 'PERFECT' ? '#8ff3dc' :
        popup.label === 'GREAT' ? '#88dcff' :
        popup.label === 'GOOD' ? '#ffd784' :
        '#ff7974';

      ctx.globalAlpha = alpha;
      ctx.textAlign = 'center';
      ctx.fillStyle = color;
      ctx.font = '900 18px ui-sans-serif, system-ui';
      ctx.fillText(t(judgeKey(popup.label)), x, y);
      ctx.fillStyle = '#fff';
      ctx.font = '800 13px ui-sans-serif, system-ui';
      ctx.fillText(`+${number(popup.points)}`, x, y + 18);
      ctx.globalAlpha = 1;
    }
  }, [beatmap.approachMs, beatmap.objects, number, t]);

  const frame = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const nowPerf = performance.now();
    const dt = Math.min(0.04, Math.max(0, (nowPerf - lastFrameRef.current) / 1000));
    lastFrameRef.current = nowPerf;

    if (status === 'playing') {
      catcherXRef.current = Math.max(
        0.06,
        Math.min(0.94, catcherXRef.current + directionRef.current * dt * 0.92),
      );

      const nowMs = audio.currentTime * 1000 + offsetMs;
      processDueNotes(nowMs);
      setProgress(Math.max(0, Math.min(1, nowMs / Math.max(beatmap.duration * 1000, 1))));
      draw(nowMs);
    } else {
      draw(audio.currentTime * 1000 + offsetMs);
    }

    rafRef.current = requestAnimationFrame(frame);
  }, [beatmap.duration, draw, offsetMs, processDueNotes, status]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(frame);
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [frame]);

  useEffect(() => {
    const engine = new HitSoundEngine(hitSoundVolume);
    engineRef.current = engine;
    return () => { if (engineRef.current === engine) engineRef.current = null; void engine.dispose(); };
  }, []);

  useEffect(() => { engineRef.current?.setVolume(hitSoundVolume); }, [hitSoundVolume]);
  useEffect(() => { if (audioRef.current) audioRef.current.volume = volume; }, [volume]);
  useEffect(() => { if (score.combo > 0) setComboKey((value) => value + 1); }, [score.combo]);

  useEffect(() => {
    if (status === 'finished' && score.judged >= score.totalObjects && !reportedRef.current) {
      reportedRef.current = true;
      onFinish?.(score);
    }
  }, [onFinish, score, status]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const down = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key === 'arrowleft' || key === 'a') { event.preventDefault(); directionRef.current = -1; }
      if (key === 'arrowright' || key === 'd') { event.preventDefault(); directionRef.current = 1; }
    };

    const up = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((key === 'arrowleft' || key === 'a') && directionRef.current < 0) directionRef.current = 0;
      if ((key === 'arrowright' || key === 'd') && directionRef.current > 0) directionRef.current = 0;
    };

    root.addEventListener('keydown', down);
    root.addEventListener('keyup', up);
    return () => {
      root.removeEventListener('keydown', down);
      root.removeEventListener('keyup', up);
    };
  }, []);

  const start = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    judgedRef.current = new Set();
    cursorRef.current = 0;
    catcherXRef.current = 0.5;
    directionRef.current = 0;
    popupRef.current = [];
    reportedRef.current = false;
    lastFrameRef.current = performance.now();

    const initial = { ...EMPTY, totalObjects: beatmap.objects.length };
    scoreRef.current = initial;
    setScore(initial);
    setProgress(0);
    audio.currentTime = 0;
    rootRef.current?.focus();

    await engineRef.current?.prime().catch(() => undefined);
    setStatus('playing');
    try { await audio.play(); } catch { setStatus('ready'); }
  };

  const togglePause = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (status === 'playing') {
      audio.pause();
      directionRef.current = 0;
      setStatus('paused');
    } else if (status === 'paused') {
      lastFrameRef.current = performance.now();
      setStatus('playing');
      rootRef.current?.focus();
      await audio.play();
    }
  };

  const finish = useCallback(() => {
    for (const object of beatmap.objects) {
      if (!judgedRef.current.has(object.id)) {
        judgedRef.current.add(object.id);
        applyJudge('miss', object.x);
      }
    }
    setProgress(1);
    setStatus('finished');
  }, [applyJudge, beatmap.objects]);

  return (
    <div className="game-shell" ref={rootRef} tabIndex={0} aria-label={t('common.gameArea')}>
      <audio ref={audioRef} src={audioUrl} preload="auto" onEnded={finish} />

      <div className="game-hud game-hud-left">
        <button className="icon-button" type="button" onClick={onExit} aria-label={t('common.exitGame')}><X size={20} /></button>
        <div><strong>{beatmap.title}</strong><span>CATCH · {difficultyLabel}</span></div>
      </div>

      <div className="game-hud game-hud-right">
        <div className="hud-score"><strong>{number(score.score)}</strong><span>{score.accuracy.toFixed(2)}%</span></div>
        <div key={comboKey} className="hud-combo">{score.combo}<span>x</span></div>
        <button className="icon-button" type="button" onClick={togglePause} disabled={status === 'ready' || status === 'finished'} aria-label={t('common.pauseResume')}>
          {status === 'paused' ? <Play size={20} /> : <Pause size={20} />}
        </button>
      </div>

      <canvas
        ref={canvasRef}
        className="game-canvas"
        onPointerDown={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          catcherXRef.current = Math.max(0.06, Math.min(0.94, (event.clientX - rect.left) / rect.width));
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture?.(event.pointerId)) return;
          const rect = event.currentTarget.getBoundingClientRect();
          catcherXRef.current = Math.max(0.06, Math.min(0.94, (event.clientX - rect.left) / rect.width));
        }}
        onPointerUp={(event) => event.currentTarget.releasePointerCapture?.(event.pointerId)}
      />

      <div className="game-progress"><span style={{ width: `${progress * 100}%` }} /></div>

      {status === 'ready' && (
        <div className="game-overlay"><div className="game-modal">
          <span className="eyebrow">CATCH</span><h2>{difficultyLabel}</h2>
          <p>{t('game.catchHelp')}</p>
          <button className="primary-button large" onClick={start}><Play size={20} />{t('common.start')}</button>
        </div></div>
      )}

      {status === 'paused' && (
        <div className="game-overlay"><div className="game-modal">
          <span className="eyebrow">PAUSED</span><h2>{t('common.paused')}</h2>
          <button className="primary-button large" onClick={togglePause}><Play size={20} />{t('common.continue')}</button>
        </div></div>
      )}

      {status === 'finished' && (
        <div className="game-overlay"><div className="result-modal">
          <div className="result-rank">{rankFor(score.accuracy, score.miss)}</div>
          <div className="result-copy"><span className="eyebrow">{t('game.catchResult')}</span><h2>{number(score.score)}</h2><p>{beatmap.title}</p></div>
          <div className="result-grid">
            <div><span>{t('common.accuracy')}</span><strong>{score.accuracy.toFixed(2)}%</strong></div>
            <div><span>{t('common.maxCombo')}</span><strong>{score.maxCombo}x</strong></div>
            <div><span>{t('common.perfect')}</span><strong>{score.perfect}</strong></div>
            <div><span>{t('common.great')}</span><strong>{score.great}</strong></div>
            <div><span>{t('common.good')}</span><strong>{score.good}</strong></div>
            <div><span>{t('common.miss')}</span><strong>{score.miss}</strong></div>
          </div>
          <div className="result-actions">
            <button className="secondary-button" onClick={onExit}><X size={18} />{t('common.returnSelection')}</button>
            <button className="primary-button" onClick={start}><RotateCcw size={18} />{t('common.retry')}</button>
          </div>
        </div></div>
      )}
    </div>
  );
}
