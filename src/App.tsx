import {
  ArrowLeft,
  AudioLines,
  CheckCircle2,
  ChevronRight,
  FileAudio,
  Gamepad2,
  Gauge,
  Github,
  Languages,
  Link2,
  LoaderCircle,
  MousePointer2,
  Music2,
  Play,
  Settings2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { decodeAudioFile, fetchAudioUrl } from './audio';
import { DIFFICULTIES, generateAllBeatmaps } from './beatmap';
import { createDemoFile } from './demo';
import { CatchGameCanvas } from './game/CatchGameCanvas';
import { DrumGameCanvas } from './game/DrumGameCanvas';
import { GameCanvas } from './game/GameCanvas';
import { LaneGameCanvas } from './game/LaneGameCanvas';
import { adaptBeatmapForMode } from './game/modeBeatmap';
import { GAME_MODES, gameModeById } from './game/modes';
import {
  localeLabelKey,
  SUPPORTED_LOCALES,
  useI18n,
  type Locale,
  type MessageKey,
} from './i18n';
import type { AudioAnalysis, Beatmap, DifficultyId, GameModeId, ScoreState, SongSource } from './types';

type Stage = 'home' | 'analyzing' | 'select' | 'game';

const ACCEPT = '.mp3,.wav,.m4a,.aac,.ogg,.flac,audio/*';
const MAX_FILE_MB = 150;

interface BestRecord {
  score: number;
  accuracy: number;
  maxCombo: number;
  miss: number;
  playedAt: number;
}

interface LocalizedNotice {
  key: MessageKey;
  variables?: Record<string, string | number>;
}

function loadBestScores(): Record<string, BestRecord> {
  try {
    const raw = localStorage.getItem('beatforge.bestScores');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function scoreKey(song: SongSource, map: Beatmap, mode: GameModeId) {
  const parts = [
    song.title.toLowerCase(),
    Math.round(map.bpm * 10),
    Math.round(map.duration * 10),
    map.difficulty,
  ];
  if (mode !== 'forge') parts.push(mode);
  return parts.join('|');
}

function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.round(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

function cleanTitle(filename: string) {
  return filename
    .replace(/\.(mp3|wav|m4a|aac|ogg|flac)$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Untitled Track';
}

function loadNumber(key: string, fallback: number) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function isYouTubeUrl(raw: string) {
  try {
    const host = new URL(raw).hostname.replace(/^www\./, '').toLowerCase();
    return host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be';
  } catch {
    return false;
  }
}

function difficultyLabelKey(id: DifficultyId): MessageKey {
  return `difficulty.${id}.label` as MessageKey;
}

function difficultyDescriptionKey(id: DifficultyId): MessageKey {
  return `difficulty.${id}.description` as MessageKey;
}

export default function App() {
  const { locale, setLocale, t, number } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previousUrlRef = useRef<string | null>(null);
  const [stage, setStage] = useState<Stage>('home');
  const [analysisStep, setAnalysisStep] = useState<MessageKey>('app.stepDecode');
  const [analysis, setAnalysis] = useState<AudioAnalysis | null>(null);
  const [beatmaps, setBeatmaps] = useState<Record<DifficultyId, Beatmap> | null>(null);
  const [song, setSong] = useState<SongSource | null>(null);
  const [selectedDifficulty, setSelectedDifficulty] = useState<DifficultyId>('normal');
  const [selectedMode, setSelectedMode] = useState<GameModeId>('forge');
  const [error, setError] = useState<LocalizedNotice | null>(null);
  const [urlInput, setUrlInput] = useState('');
  const [urlLoading, setUrlLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [offsetMs, setOffsetMs] = useState(() => loadNumber('beatforge.offset', 0));
  const [volume, setVolume] = useState(() => loadNumber('beatforge.volume', 0.82));
  const [hitSoundVolume, setHitSoundVolume] = useState(() => loadNumber('beatforge.hitSoundVolume', 0.55));
  const [bestScores, setBestScores] = useState<Record<string, BestRecord>>(() => loadBestScores());
  const [latencyInfo, setLatencyInfo] = useState<LocalizedNotice | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem('beatforge.offset', String(offsetMs));
      localStorage.setItem('beatforge.volume', String(volume));
      localStorage.setItem('beatforge.hitSoundVolume', String(hitSoundVolume));
    } catch {
      // Local persistence is optional.
    }
  }, [hitSoundVolume, offsetMs, volume]);

  useEffect(() => () => {
    if (previousUrlRef.current) URL.revokeObjectURL(previousUrlRef.current);
  }, []);

  const estimateDeviceLatency = async () => {
    setLatencyInfo({ key: 'app.latencyReading' });
    let context: AudioContext | null = null;
    try {
      context = new AudioContext({ latencyHint: 'interactive' });
      if (context.state === 'suspended') await context.resume();

      const baseMs = Math.max(0, context.baseLatency || 0) * 1000;
      const outputMs = Math.max(0, context.outputLatency || 0) * 1000;
      const estimatedMs = Math.round(baseMs + outputMs);

      if (estimatedMs <= 0) {
        setLatencyInfo({ key: 'app.latencyUnavailable' });
        return;
      }

      const recommended = Math.max(-200, Math.min(200, -estimatedMs));
      setOffsetMs(recommended);
      setLatencyInfo({
        key: 'app.latencyApplied',
        variables: { estimated: estimatedMs, offset: recommended },
      });
    } catch {
      setLatencyInfo({ key: 'app.latencyFailed' });
    } finally {
      await context?.close().catch(() => undefined);
    }
  };

  const processFile = async (file: File) => {
    setError(null);

    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      setError({ key: 'app.errorTooLarge', variables: { max: MAX_FILE_MB } });
      return;
    }

    const looksLikeAudio =
      file.type.startsWith('audio/') ||
      /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name);
    if (!looksLikeAudio) {
      setError({ key: 'app.errorInvalidAudio' });
      return;
    }

    setStage('analyzing');
    setAnalysisStep('app.stepDecode');

    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const decoded = await decodeAudioFile(file);
      setAnalysisStep('app.stepAnalyze');
      await new Promise<void>((resolve) => setTimeout(resolve, 80));

      const title = cleanTitle(file.name);
      const artist = file.name.startsWith('BeatForge Demo') ? 'BeatForge' : 'Local audio';
      setAnalysisStep('app.stepGenerate');
      const maps = generateAllBeatmaps(decoded.analysis, title, artist);

      if (previousUrlRef.current) URL.revokeObjectURL(previousUrlRef.current);
      const url = URL.createObjectURL(file);
      previousUrlRef.current = url;

      setAnalysis(decoded.analysis);
      setBeatmaps(maps);
      setSong({ file, url, title, artist });
      setSelectedDifficulty('normal');
      setSelectedMode('forge');
      setAnalysisStep('app.stepDone');
      await new Promise<void>((resolve) => setTimeout(resolve, 180));
      setStage('select');
    } catch (cause) {
      console.error(cause);
      setStage('home');
      setError(
        cause instanceof Error
          ? { key: 'app.errorAnalyze', variables: { message: cause.message } }
          : { key: 'app.errorAnalyzeGeneric' },
      );
    }
  };

  const handleFiles = (files: FileList | File[]) => {
    const file = files[0];
    if (file) void processFile(file);
  };

  const importUrl = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = urlInput.trim();
    if (!trimmed) return;

    if (isYouTubeUrl(trimmed)) {
      setError({ key: 'app.errorYouTube' });
      return;
    }

    setUrlLoading(true);
    setError(null);
    try {
      const file = await fetchAudioUrl(trimmed);
      await processFile(file);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? { key: 'app.errorUrl', variables: { message: cause.message } }
          : { key: 'app.errorUrlGeneric' },
      );
    } finally {
      setUrlLoading(false);
    }
  };

  const selectedMap = beatmaps?.[selectedDifficulty] ?? null;
  const selectedModeMap = useMemo(
    () => selectedMap ? adaptBeatmapForMode(selectedMap, selectedMode) : null,
    [selectedMap, selectedMode],
  );
  const selectedModeDefinition = useMemo(() => gameModeById(selectedMode), [selectedMode]);
  const selectedBest = useMemo(() => {
    if (!song || !selectedModeMap) return null;
    return bestScores[scoreKey(song, selectedModeMap, selectedMode)] ?? null;
  }, [bestScores, selectedModeMap, selectedMode, song]);

  const saveBestResult = (result: ScoreState) => {
    if (!song || !selectedModeMap) return;
    const key = scoreKey(song, selectedModeMap, selectedMode);
    const previous = bestScores[key];
    const improved =
      !previous ||
      result.score > previous.score ||
      (result.score === previous.score && result.accuracy > previous.accuracy);

    if (!improved) return;

    const next: Record<string, BestRecord> = {
      ...bestScores,
      [key]: {
        score: result.score,
        accuracy: result.accuracy,
        maxCombo: result.maxCombo,
        miss: result.miss,
        playedAt: Date.now(),
      },
    };

    setBestScores(next);
    try {
      localStorage.setItem('beatforge.bestScores', JSON.stringify(next));
    } catch {
      // Score persistence is optional.
    }
  };

  const tempoText = useMemo(() => {
    if (!analysis) return '—';
    const segments = analysis.tempoMap ?? [];
    if (segments.length <= 1) return analysis.bpm.toFixed(1);

    const bpms = segments.map((segment) => segment.bpm);
    const minimum = Math.min(...bpms);
    const maximum = Math.max(...bpms);
    if (maximum - minimum < 3) return analysis.bpm.toFixed(1);
    return `${Math.round(minimum)}–${Math.round(maximum)}`;
  }, [analysis]);

  const noteCountText = useMemo(() => {
    if (!beatmaps) return '—';
    return number(selectedModeMap?.objects.length ?? beatmaps[selectedDifficulty].objects.length);
  }, [beatmaps, number, selectedDifficulty, selectedModeMap]);

  if (stage === 'game' && song && selectedModeMap) {
    const shared = {
      beatmap: selectedModeMap,
      audioUrl: song.url,
      offsetMs,
      volume,
      hitSoundVolume,
      onExit: () => setStage('select' as const),
      onFinish: saveBestResult,
    };

    if (selectedMode === 'forge') return <GameCanvas {...shared} />;
    if (selectedMode === 'drum') return <DrumGameCanvas {...shared} />;
    if (selectedMode === 'catch') return <CatchGameCanvas {...shared} />;
    return <LaneGameCanvas {...shared} mode={selectedMode} />;
  }

  const selectedDesktopControl = t(selectedModeDefinition.controlsDesktopKey);
  const selectedMobileControl = t(selectedModeDefinition.controlsMobileKey);

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand-button" type="button" onClick={() => setStage('home')} aria-label="BeatForge">
          <span className="brand-mark"><AudioLines size={24} /></span>
          <span className="brand-copy"><strong>BeatForge</strong><small>TURN MUSIC INTO PLAY</small></span>
        </button>

        <nav className="top-actions" aria-label="BeatForge">
          {stage === 'select' && (
            <button className="ghost-button" type="button" onClick={() => setStage('home')}>
              <ArrowLeft size={17} />{t('app.changeSong')}
            </button>
          )}
          <label className="language-control compact" aria-label={t('language.label')}>
            <Languages size={16} />
            <select value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>
              {SUPPORTED_LOCALES.map((item) => <option key={item} value={item}>{t(localeLabelKey(item))}</option>)}
            </select>
          </label>
          <a className="ghost-button desktop-only" href="https://github.com/A24DC523/BeatForge" target="_blank" rel="noreferrer">
            <Github size={17} />GitHub
          </a>
          <button className="icon-button" type="button" onClick={() => setSettingsOpen(true)} aria-label={t('app.settings')}>
            <Settings2 size={20} />
          </button>
        </nav>
      </header>

      {stage === 'home' && (
        <main>
          <section className="hero-section">
            <div className="hero-copy">
              <div className="pill"><Sparkles size={15} />{t('app.heroKicker')}</div>
              <h1>{t('app.heroTitleA')}<br /><span>{t('app.heroTitleB')}</span></h1>
              <p>{t('app.heroDescription')}</p>
              <div className="hero-points">
                <span><ShieldCheck size={16} />{t('app.localAudio')}</span>
                <span><Smartphone size={16} />{t('app.mobileDesktop')}</span>
                <span><Zap size={16} />{t('app.noAccount')}</span>
              </div>
            </div>

            <div className="forge-card">
              <div
                className={`drop-zone ${dragging ? 'dragging' : ''}`}
                onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  handleFiles(event.dataTransfer.files);
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPT}
                  hidden
                  onChange={(event) => event.target.files && handleFiles(event.target.files)}
                />
                <div className="upload-orbit">
                  <span className="orbit orbit-one" />
                  <span className="orbit orbit-two" />
                  <span className="upload-core"><Upload size={30} /></span>
                </div>
                <h2>{t('app.dropSong')}</h2>
                <p>{t('app.dropHelp')}</p>
                <button className="primary-button" type="button" onClick={() => fileInputRef.current?.click()}>
                  <FileAudio size={18} />{t('app.chooseMusic')}
                </button>
                <small>{t('app.fileFormats', { max: MAX_FILE_MB })}</small>
              </div>

              <div className="or-divider"><span>{t('app.or')}</span></div>

              <form className="url-form" onSubmit={importUrl}>
                <label htmlFor="audio-url"><Link2 size={16} />{t('app.directAudioUrl')}</label>
                <div className="url-row">
                  <input
                    id="audio-url"
                    value={urlInput}
                    onChange={(event) => setUrlInput(event.target.value)}
                    placeholder="https://example.com/song.mp3"
                    inputMode="url"
                  />
                  <button type="submit" className="mini-submit" disabled={urlLoading} aria-label={t('app.directAudioUrl')}>
                    {urlLoading ? <LoaderCircle className="spin" size={19} /> : <ChevronRight size={20} />}
                  </button>
                </div>
                <p className="url-hint">{t('app.urlHint')}</p>
              </form>

              <button className="demo-button" type="button" onClick={() => void processFile(createDemoFile())}>
                <Play size={16} />{t('app.demo')}
              </button>
            </div>
          </section>

          {error && (
            <div className="error-banner" role="alert"><X size={18} /><span>{t(error.key, error.variables)}</span></div>
          )}

          <section className="feature-strip" aria-label="BeatForge">
            <article><span className="feature-icon"><Gauge size={22} /></span><div><strong>{t('app.featureTempoTitle')}</strong><p>{t('app.featureTempoDescription')}</p></div></article>
            <article><span className="feature-icon"><Sparkles size={22} /></span><div><strong>{t('app.featureDifficultyTitle')}</strong><p>{t('app.featureDifficultyDescription')}</p></div></article>
            <article><span className="feature-icon"><Gamepad2 size={22} /></span><div><strong>{t('app.featureModesTitle')}</strong><p>{t('app.featureModesDescription')}</p></div></article>
          </section>

          <section className="how-section">
            <div className="section-heading"><span className="eyebrow">{t('app.howKicker')}</span><h2>{t('app.howTitle')}</h2></div>
            <div className="pipeline">
              <div><span>01</span><Music2 size={26} /><strong>{t('app.decode')}</strong><p>{t('app.decodeDescription')}</p></div><i />
              <div><span>02</span><AudioLines size={26} /><strong>{t('app.analyze')}</strong><p>{t('app.analyzeDescription')}</p></div><i />
              <div><span>03</span><Sparkles size={26} /><strong>{t('app.forge')}</strong><p>{t('app.forgeDescription')}</p></div><i />
              <div><span>04</span><Gamepad2 size={26} /><strong>{t('app.play')}</strong><p>{t('app.playDescription')}</p></div>
            </div>
          </section>
        </main>
      )}

      {stage === 'analyzing' && (
        <main className="analysis-page">
          <div className="analysis-visual">
            <div className="analysis-ring ring-a" /><div className="analysis-ring ring-b" /><div className="analysis-ring ring-c" />
            <div className="analysis-core"><AudioLines size={42} /></div>
          </div>
          <span className="eyebrow">{t('app.forging')}</span>
          <h1>{t(analysisStep)}</h1>
          <p>{t('app.analysisLocal')}</p>
          <div className="analysis-bars" aria-hidden="true">{Array.from({ length: 26 }, (_, i) => <span key={i} style={{ animationDelay: `${i * 34}ms` }} />)}</div>
        </main>
      )}

      {stage === 'select' && song && analysis && beatmaps && selectedMap && (
        <main className="song-page">
          <section className="song-hero">
            <div className="cover-art" aria-hidden="true">
              <div className="cover-disc"><AudioLines size={54} /></div><span className="cover-ring cover-ring-a" /><span className="cover-ring cover-ring-b" />
            </div>
            <div className="song-meta">
              <span className="pill"><CheckCircle2 size={14} />{t('app.beatmapReady')}</span>
              <h1>{song.title}</h1><p>{song.artist}</p>
              <div className="song-stats">
                <div><span>{t('app.bpm')}</span><strong>{tempoText}</strong></div>
                <div><span>{t('app.length')}</span><strong>{formatDuration(analysis.duration)}</strong></div>
                <div><span>{t('app.objects')}</span><strong>{noteCountText}</strong></div>
                <div><span>{t('app.star')}</span><strong>{(selectedModeMap?.starRating ?? selectedMap.starRating).toFixed(1)}</strong></div>
              </div>
            </div>
          </section>

          <section className="mode-section">
            <div className="section-heading compact">
              <div><span className="eyebrow">{t('app.selectModeKicker')}</span><h2>{t('app.selectModeTitle')}</h2></div>
              <div className="control-legend"><span><Gamepad2 size={15} />{t('app.sharedSong')}</span></div>
            </div>
            <div className="mode-grid">
              {GAME_MODES.map((mode) => {
                const active = selectedMode === mode.id;
                return (
                  <button key={mode.id} type="button" className={`mode-card ${active ? 'active' : ''}`} onClick={() => setSelectedMode(mode.id)} aria-pressed={active}>
                    <span className="mode-card-kicker">{t(mode.shortKey)}</span>
                    <strong>{mode.label}</strong>
                    <p>{t(mode.descriptionKey)}</p>
                    <div className="mode-controls"><span>{t(mode.controlsDesktopKey)}</span><span>{t(mode.controlsMobileKey)}</span></div>
                    {active && <CheckCircle2 className="mode-check" size={20} />}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="difficulty-section">
            <div className="section-heading compact">
              <div><span className="eyebrow">{t('app.selectDifficultyKicker')}</span><h2>{t('app.selectDifficultyTitle')}</h2></div>
              <div className="control-legend">
                <span><MousePointer2 size={15} />{t('common.desktop')}：{selectedDesktopControl}</span>
                <span><Smartphone size={15} />{t('common.mobile')}：{selectedMobileControl}</span>
              </div>
            </div>

            <div className="difficulty-list">
              {DIFFICULTIES.map((preset) => {
                const map = beatmaps[preset.id];
                const modeMap = adaptBeatmapForMode(map, selectedMode);
                const active = selectedDifficulty === preset.id;
                return (
                  <button key={preset.id} type="button" className={`difficulty-card diff-${preset.id} ${active ? 'active' : ''}`} onClick={() => setSelectedDifficulty(preset.id)} aria-pressed={active}>
                    <span className="diff-accent" />
                    <span className="diff-copy"><strong>{t(difficultyLabelKey(preset.id))}</strong><small>{t(difficultyDescriptionKey(preset.id))}</small></span>
                    <span className="diff-metrics"><em>★ {modeMap.starRating.toFixed(1)}</em><small>{t('app.mapObjects', { count: number(modeMap.objects.length) })}</small></span>
                    <span className="diff-radio">{active && <CheckCircle2 size={20} />}</span>
                  </button>
                );
              })}
            </div>

            <div className="play-panel">
              <div>
                <span className="eyebrow">{t('app.currentMap')}</span>
                <strong>{selectedModeDefinition.label} · {t(difficultyLabelKey(selectedMap.difficulty))} · ★ {(selectedModeMap?.starRating ?? selectedMap.starRating).toFixed(1)}</strong>
                <p>
                  {t('app.mapObjects', { count: number(selectedModeMap?.objects.length ?? selectedMap.objects.length) })}
                  {' · '}{t('app.approach', { ms: selectedMap.approachMs })}
                  {' · '}{t('app.hitWindow', { ms: selectedMap.hitWindowMs })}
                  {' · '}{selectedMap.validation.repaired > 0 ? t('app.validatorRepaired', { count: selectedMap.validation.repaired }) : t('app.validatorPass')}
                  {selectedBest ? ` · ${t('app.best', { score: number(selectedBest.score), accuracy: selectedBest.accuracy.toFixed(2) })}` : ''}
                </p>
              </div>
              <button className="primary-button play-button" type="button" onClick={() => setStage('game')}><Play size={21} fill="currentColor" />{t('app.playButton')}</button>
            </div>
          </section>
        </main>
      )}

      <footer className="footer"><span>BeatForge v0.5.0 · Turn Music Into Play</span><span>{t('app.footerPrivacy')}</span></footer>

      {settingsOpen && (
        <div className="drawer-backdrop" onMouseDown={() => setSettingsOpen(false)}>
          <aside className="settings-drawer" onMouseDown={(event) => event.stopPropagation()} aria-label={t('app.settings')}>
            <div className="drawer-heading">
              <div><span className="eyebrow">SETTINGS</span><h2>{t('app.settings')}</h2></div>
              <button className="icon-button" type="button" onClick={() => setSettingsOpen(false)} aria-label={t('app.closeSettings')}><X size={20} /></button>
            </div>

            <label className="language-setting">
              <div><strong><Languages size={17} />{t('language.label')}</strong></div>
              <select value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>
                {SUPPORTED_LOCALES.map((item) => <option key={item} value={item}>{t(localeLabelKey(item))}</option>)}
              </select>
            </label>

            <label className="range-setting">
              <div><strong>{t('app.songVolume')}</strong><span>{Math.round(volume * 100)}%</span></div>
              <input type="range" min="0" max="1" step="0.01" value={volume} onChange={(event) => setVolume(Number(event.target.value))} />
            </label>

            <label className="range-setting">
              <div><strong>{t('app.hitSound')}</strong><span>{Math.round(hitSoundVolume * 100)}%</span></div>
              <input type="range" min="0" max="1" step="0.01" value={hitSoundVolume} onChange={(event) => setHitSoundVolume(Number(event.target.value))} />
              <small>{t('app.hitSoundHelp')}</small>
            </label>

            <label className="range-setting">
              <div><strong>{t('app.timingOffset')}</strong><span>{offsetMs > 0 ? '+' : ''}{offsetMs} ms</span></div>
              <input type="range" min="-200" max="200" step="1" value={offsetMs} onChange={(event) => setOffsetMs(Number(event.target.value))} />
              <small>{t('app.timingHelp')}</small>
            </label>

            <button className="secondary-button full" type="button" onClick={() => void estimateDeviceLatency()}><AudioLines size={17} />{t('app.estimateLatency')}</button>
            {latencyInfo && <p className="latency-info">{t(latencyInfo.key, latencyInfo.variables)}</p>}

            <button className="secondary-button full" type="button" onClick={() => { setOffsetMs(0); setVolume(0.82); setHitSoundVolume(0.55); setLatencyInfo(null); }}>{t('app.resetSettings')}</button>

            <div className="settings-note"><ShieldCheck size={19} /><p><strong>{t('app.localFirstTitle')}</strong>{t('app.localFirstDescription')}</p></div>
          </aside>
        </div>
      )}
    </div>
  );
}
