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
type DrumKind = 'don' | 'ka';

interface Popup {
  label: string;
  points: number;
  kind: DrumKind;
  at: number;
}

const EMPTY: ScoreState = {
  score: 0, combo: 0, maxCombo: 0, perfect: 0, great: 0, good: 0,
  miss: 0, judged: 0, totalObjects: 0, accuracy: 100,
};

function judgeFor(delta: number, windowMs: number): Exclude<Judge, 'miss'> | null {
  const abs = Math.abs(delta);
  if (abs <= Math.min(55, windowMs * 0.38)) return 'perfect';
  if (abs <= Math.min(105, windowMs * 0.68)) return 'great';
  if (abs <= windowMs) return 'good';
  return null;
}

function baseScore(judge: Judge) {
  if (judge === 'perfect') return 1000;
  if (judge === 'great') return 650;
  if (judge === 'good') return 300;
  return 0;
}

function drumKind(object: HitObject): DrumKind {
  if (object.drumKind) return object.drumKind;
  if (object.type === 'slide') return 'ka';
  if (object.type === 'hold') return object.id % 2 === 0 ? 'don' : 'ka';
  return object.id % 5 === 1 || object.id % 5 === 4 ? 'ka' : 'don';
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

export function DrumGameCanvas({
  beatmap, audioUrl, offsetMs, volume, hitSoundVolume, onExit, onFinish,
}: Props) {
  const { t, number } = useI18n();
  const difficultyLabel = t(`difficulty.${beatmap.difficulty}.label` as MessageKey);
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const rafRef = useRef<number | null>(null);
  const judgedRef = useRef(new Set<number>());
  const missCursorRef = useRef(0);
  const scoreRef = useRef<ScoreState>({ ...EMPTY, totalObjects: beatmap.objects.length });
  const popupRef = useRef<Popup[]>([]);
  const engineRef = useRef<HitSoundEngine | null>(null);
  const reportedRef = useRef(false);

  const [status, setStatus] = useState<Status>('ready');
  const [score, setScore] = useState<ScoreState>(() => ({ ...EMPTY, totalObjects: beatmap.objects.length }));
  const [progress, setProgress] = useState(0);
  const [comboKey, setComboKey] = useState(0);

  const applyJudge = useCallback((judge: Judge, kind: DrumKind) => {
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
    popupRef.current.push({ label: judge.toUpperCase(), points, kind, at: performance.now() });
    if (popupRef.current.length > 16) popupRef.current.splice(0, popupRef.current.length - 16);

    if (judge !== 'miss') engineRef.current?.play(judge, next.combo);
  }, []);

  const attempt = useCallback((kind: DrumKind) => {
    if (status !== 'playing') return;
    const audio = audioRef.current;
    if (!audio) return;
    const nowMs = audio.currentTime * 1000 + offsetMs;

    let best: HitObject | null = null;
    let bestDelta = Infinity;
    for (const object of beatmap.objects) {
      if (judgedRef.current.has(object.id)) continue;
      const delta = nowMs - object.time;
      if (delta < -beatmap.hitWindowMs) break;
      if (Math.abs(delta) > beatmap.hitWindowMs) continue;
      if (drumKind(object) !== kind) continue;
      if (Math.abs(delta) < Math.abs(bestDelta)) {
        best = object;
        bestDelta = delta;
      }
    }

    if (!best) return;
    const judge = judgeFor(bestDelta, beatmap.hitWindowMs);
    if (!judge) return;
    judgedRef.current.add(best.id);
    applyJudge(judge, kind);
  }, [applyJudge, beatmap.hitWindowMs, beatmap.objects, offsetMs, status]);

  const markMisses = useCallback((nowMs: number) => {
    while (missCursorRef.current < beatmap.objects.length) {
      const object = beatmap.objects[missCursorRef.current];
      if (object.time >= nowMs - beatmap.hitWindowMs) break;
      if (!judgedRef.current.has(object.id)) {
        judgedRef.current.add(object.id);
        applyJudge('miss', drumKind(object));
      }
      missCursorRef.current += 1;
    }
  }, [applyJudge, beatmap.hitWindowMs, beatmap.objects]);

  const draw = useCallback((nowMs: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const w = rect.width;
    const h = rect.height;
    const hitX = w * 0.24;
    const trackY = h * 0.56;
    const now = performance.now();

    ctx.clearRect(0, 0, w, h);
    const bg = ctx.createRadialGradient(w * 0.45, h * 0.48, 20, w * 0.45, h * 0.48, Math.max(w, h));
    bg.addColorStop(0, '#241323');
    bg.addColorStop(0.55, '#0d101b');
    bg.addColorStop(1, '#05070c');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(255,255,255,.08)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(hitX, trackY);
    ctx.lineTo(w * 0.92, trackY);
    ctx.stroke();

    ctx.fillStyle = '#1b1f2d';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(hitX, trackY, 48, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ff5e74';
    ctx.beginPath();
    ctx.arc(hitX, trackY, 28, 0, Math.PI * 2);
    ctx.fill();

    const visibleEnd = nowMs + beatmap.approachMs;
    for (const object of beatmap.objects) {
      if (judgedRef.current.has(object.id)) continue;
      if (object.time < nowMs - beatmap.hitWindowMs || object.time > visibleEnd) continue;

      const p = 1 - Math.max(0, Math.min(1, (object.time - nowMs) / beatmap.approachMs));
      const x = w * 0.91 - (w * 0.91 - hitX) * p;
      const kind = drumKind(object);
      const radius = object.weight > 1.08 ? 30 : 23;

      ctx.fillStyle = kind === 'don' ? '#ff5e74' : '#4fbfff';
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 20;
      ctx.beginPath();
      ctx.arc(x, trackY, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.strokeStyle = 'rgba(255,255,255,.8)';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    popupRef.current = popupRef.current.filter((popup) => now - popup.at < 620);
    for (const popup of popupRef.current) {
      const age = now - popup.at;
      const p = age / 620;
      const alpha = Math.max(0, 1 - p);
      ctx.globalAlpha = alpha;
      ctx.textAlign = 'center';
      ctx.fillStyle = popup.kind === 'don' ? '#ff8797' : '#83d2ff';
      ctx.font = '900 22px ui-sans-serif, system-ui';
      ctx.fillText(t(judgeKey(popup.label)), hitX, trackY - 72 - p * 24);
      ctx.fillStyle = '#fff';
      ctx.font = '800 14px ui-sans-serif, system-ui';
      ctx.fillText(`+${number(popup.points)}`, hitX, trackY - 49 - p * 24);
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = 'rgba(255,255,255,.78)';
    ctx.font = '800 13px ui-sans-serif, system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('DON  F / J', w * 0.39, h * 0.79);
    ctx.fillText('KA  D / K', w * 0.64, h * 0.79);
  }, [beatmap.approachMs, beatmap.hitWindowMs, beatmap.objects, number, t]);

  const frame = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const nowMs = audio.currentTime * 1000 + offsetMs;
    if (status === 'playing') {
      markMisses(nowMs);
      setProgress(Math.max(0, Math.min(1, nowMs / Math.max(beatmap.duration * 1000, 1))));
    }
    draw(nowMs);
    rafRef.current = requestAnimationFrame(frame);
  }, [beatmap.duration, draw, markMisses, offsetMs, status]);

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
      if (event.repeat) return;
      const key = event.key.toLowerCase();
      if (key === 'f' || key === 'j') { event.preventDefault(); attempt('don'); }
      if (key === 'd' || key === 'k') { event.preventDefault(); attempt('ka'); }
    };
    root.addEventListener('keydown', down);
    return () => root.removeEventListener('keydown', down);
  }, [attempt]);

  const start = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    judgedRef.current = new Set();
    missCursorRef.current = 0;
    popupRef.current = [];
    reportedRef.current = false;
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
    if (status === 'playing') { audio.pause(); setStatus('paused'); }
    else if (status === 'paused') { setStatus('playing'); rootRef.current?.focus(); await audio.play(); }
  };

  const finish = useCallback(() => {
    for (const object of beatmap.objects) {
      if (!judgedRef.current.has(object.id)) {
        judgedRef.current.add(object.id);
        applyJudge('miss', drumKind(object));
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
        <div><strong>{beatmap.title}</strong><span>DRUM · {difficultyLabel}</span></div>
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
          const x = (event.clientX - rect.left) / rect.width;
          attempt(x < 0.5 ? 'don' : 'ka');
        }}
      />

      <div className="game-progress"><span style={{ width: `${progress * 100}%` }} /></div>

      {status === 'ready' && (
        <div className="game-overlay"><div className="game-modal">
          <span className="eyebrow">DRUM</span><h2>{difficultyLabel}</h2>
          <p>{t('game.drumHelp')}</p>
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
          <div className="result-copy"><span className="eyebrow">{t('game.drumResult')}</span><h2>{number(score.score)}</h2><p>{beatmap.title}</p></div>
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
