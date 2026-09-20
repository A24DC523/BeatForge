import {
  ArrowLeft,
  AudioLines,
  CheckCircle2,
  ChevronRight,
  FileAudio,
  Gamepad2,
  Gauge,
  Github,
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
import { useEffect, useMemo, useRef, useState } from 'react';
import { decodeAudioFile, fetchAudioUrl } from './audio';
import { DIFFICULTIES, generateAllBeatmaps } from './beatmap';
import { createDemoFile } from './demo';
import { CatchGameCanvas } from './game/CatchGameCanvas';
import { DrumGameCanvas } from './game/DrumGameCanvas';
import { GameCanvas } from './game/GameCanvas';
import { LaneGameCanvas } from './game/LaneGameCanvas';
import { adaptBeatmapForMode } from './game/modeBeatmap';
import { GAME_MODES, gameModeById } from './game/modes';
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

export default function App() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previousUrlRef = useRef<string | null>(null);
  const [stage, setStage] = useState<Stage>('home');
  const [analysisStep, setAnalysisStep] = useState('準備音訊');
  const [analysis, setAnalysis] = useState<AudioAnalysis | null>(null);
  const [beatmaps, setBeatmaps] = useState<Record<DifficultyId, Beatmap> | null>(null);
  const [song, setSong] = useState<SongSource | null>(null);
  const [selectedDifficulty, setSelectedDifficulty] = useState<DifficultyId>('normal');
  const [selectedMode, setSelectedMode] = useState<GameModeId>('forge');
  const [error, setError] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [urlLoading, setUrlLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [offsetMs, setOffsetMs] = useState(() => loadNumber('beatforge.offset', 0));
  const [volume, setVolume] = useState(() => loadNumber('beatforge.volume', 0.82));
  const [hitSoundVolume, setHitSoundVolume] = useState(() => loadNumber('beatforge.hitSoundVolume', 0.55));
  const [bestScores, setBestScores] = useState<Record<string, BestRecord>>(() => loadBestScores());
  const [latencyInfo, setLatencyInfo] = useState('');

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
    setLatencyInfo('正在讀取音訊裝置延遲…');
    let context: AudioContext | null = null;
    try {
      context = new AudioContext({ latencyHint: 'interactive' });
      if (context.state === 'suspended') await context.resume();

      const baseMs = Math.max(0, context.baseLatency || 0) * 1000;
      const outputMs = Math.max(0, context.outputLatency || 0) * 1000;
      const estimatedMs = Math.round(baseMs + outputMs);

      if (estimatedMs <= 0) {
        setLatencyInfo('瀏覽器未提供可用的延遲數值，請保留手動 Offset。');
        return;
      }

      const recommended = Math.max(-200, Math.min(200, -estimatedMs));
      setOffsetMs(recommended);
      setLatencyInfo(
        `估算輸出延遲約 ${estimatedMs} ms，已套用 ${recommended} ms Offset。可再按手感微調。`,
      );
    } catch {
      setLatencyInfo('目前瀏覽器無法自動估算延遲，請使用手動 Offset。');
    } finally {
      await context?.close().catch(() => undefined);
    }
  };

  const processFile = async (file: File) => {
    setError('');

    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      setError(`檔案太大。BeatForge 目前支援最多 ${MAX_FILE_MB} MB。`);
      return;
    }

    const looksLikeAudio =
      file.type.startsWith('audio/') ||
      /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name);
    if (!looksLikeAudio) {
      setError('請選擇 MP3、WAV、M4A、AAC、OGG 或 FLAC 音訊檔案。');
      return;
    }

    setStage('analyzing');
    setAnalysisStep('正在解碼音訊');

    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const decoded = await decodeAudioFile(file);
      setAnalysisStep('正在分析 BPM、節拍與 Low / Mid / High 頻段');
      await new Promise<void>((resolve) => setTimeout(resolve, 80));

      const title = cleanTitle(file.name);
      const artist = file.name.startsWith('BeatForge Demo') ? 'BeatForge' : 'Local audio';
      setAnalysisStep('正在生成四個難度');
      const maps = generateAllBeatmaps(decoded.analysis, title, artist);

      if (previousUrlRef.current) URL.revokeObjectURL(previousUrlRef.current);
      const url = URL.createObjectURL(file);
      previousUrlRef.current = url;

      setAnalysis(decoded.analysis);
      setBeatmaps(maps);
      setSong({ file, url, title, artist });
      setSelectedDifficulty('normal');
      setSelectedMode('forge');
      setAnalysisStep('譜面完成');
      await new Promise<void>((resolve) => setTimeout(resolve, 180));
      setStage('select');
    } catch (cause) {
      console.error(cause);
      setStage('home');
      setError(
        cause instanceof Error
          ? `無法分析這首音樂：${cause.message}`
          : '無法分析這首音樂，請嘗試其他音訊格式。',
      );
    }
  };

  const handleFiles = (files: FileList | File[]) => {
    const file = files[0];
    if (file) void processFile(file);
  };

  const importUrl = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = urlInput.trim();
    if (!trimmed) return;

    if (isYouTubeUrl(trimmed)) {
      setError(
        'YouTube 不允許第三方服務下載或分離其影音內容，因此 BeatForge 不會直接抽取 YouTube 音訊。請上傳你有權使用的本地音訊檔；直接音訊網址則可自動分析。',
      );
      return;
    }

    setUrlLoading(true);
    setError('');
    try {
      const file = await fetchAudioUrl(trimmed);
      await processFile(file);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `網址匯入失敗：${cause.message} 來源網站亦需要允許瀏覽器 CORS 存取。`
          : '網址匯入失敗。',
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

  const noteCountText = useMemo(() => {
    if (!beatmaps) return '—';
    return selectedModeMap?.objects.length.toLocaleString() ?? beatmaps[selectedDifficulty].objects.length.toLocaleString();
  }, [beatmaps, selectedDifficulty, selectedModeMap]);

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

    return (
      <LaneGameCanvas
        {...shared}
        mode={selectedMode}
      />
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand-button" type="button" onClick={() => setStage('home')} aria-label="BeatForge 首頁">
          <span className="brand-mark"><AudioLines size={24} /></span>
          <span className="brand-copy"><strong>BeatForge</strong><small>TURN MUSIC INTO PLAY</small></span>
        </button>

        <nav className="top-actions" aria-label="主要功能">
          {stage === 'select' && (
            <button className="ghost-button" type="button" onClick={() => setStage('home')}>
              <ArrowLeft size={17} />換一首歌
            </button>
          )}
          <a className="ghost-button desktop-only" href="https://github.com/A24DC523/BeatForge" target="_blank" rel="noreferrer">
            <Github size={17} />GitHub
          </a>
          <button className="icon-button" type="button" onClick={() => setSettingsOpen(true)} aria-label="設定">
            <Settings2 size={20} />
          </button>
        </nav>
      </header>

      {stage === 'home' && (
        <main>
          <section className="hero-section">
            <div className="hero-copy">
              <div className="pill"><Sparkles size={15} />AUTO BEATMAP ENGINE</div>
              <h1>你的音樂，<br /><span>即刻變成遊戲。</span></h1>
              <p>上傳歌曲，BeatForge 會在瀏覽器分析 BPM、Onset、能量與 Low / Mid / High 頻段，自動生成 Easy 至 Expert 四個可玩的節奏譜面。</p>
              <div className="hero-points">
                <span><ShieldCheck size={16} />音訊留在你的裝置</span>
                <span><Smartphone size={16} />手機 / 電腦雙操作</span>
                <span><Zap size={16} />毋須帳戶即可開始</span>
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
                <h2>DROP A SONG</h2>
                <p>拖放音訊，或者從裝置選擇檔案</p>
                <button className="primary-button" type="button" onClick={() => fileInputRef.current?.click()}>
                  <FileAudio size={18} />選擇音樂
                </button>
                <small>MP3 · WAV · M4A · AAC · OGG · FLAC · 最大 {MAX_FILE_MB} MB</small>
              </div>

              <div className="or-divider"><span>OR</span></div>

              <form className="url-form" onSubmit={importUrl}>
                <label htmlFor="audio-url"><Link2 size={16} />直接音訊網址</label>
                <div className="url-row">
                  <input
                    id="audio-url"
                    value={urlInput}
                    onChange={(event) => setUrlInput(event.target.value)}
                    placeholder="https://example.com/song.mp3"
                    inputMode="url"
                  />
                  <button type="submit" className="mini-submit" disabled={urlLoading} aria-label="匯入網址">
                    {urlLoading ? <LoaderCircle className="spin" size={19} /> : <ChevronRight size={20} />}
                  </button>
                </div>
                <p className="url-hint">支援允許 CORS 的直接音訊連結。YouTube 等平台受其內容政策限制，請改用你有權使用的本地檔案。</p>
              </form>

              <button className="demo-button" type="button" onClick={() => void processFile(createDemoFile())}>
                <Play size={16} />沒有歌曲？立即玩 Neon Pulse Demo
              </button>
            </div>
          </section>

          {error && (
            <div className="error-banner" role="alert"><X size={18} /><span>{error}</span></div>
          )}

          <section className="feature-strip" aria-label="BeatForge 功能">
            <article>
              <span className="feature-icon"><Gauge size={22} /></span>
              <div><strong>Spectrum Aware</strong><p>本機估算 BPM、拍點、Low / Mid / High 與節奏峰值。</p></div>
            </article>
            <article>
              <span className="feature-icon"><Sparkles size={22} /></span>
              <div><strong>4 Difficulties</strong><p>同一 Master Timing 自動衍生四級譜面。</p></div>
            </article>
            <article>
              <span className="feature-icon"><Gamepad2 size={22} /></span>
              <div><strong>6 Game Modes</strong><p>Pointer、4K、2K、1K、Drum、Catch 共用自動譜面核心。</p></div>
            </article>
          </section>

          <section className="how-section">
            <div className="section-heading">
              <span className="eyebrow">HOW IT WORKS</span>
              <h2>由聲音，到譜面，再到遊戲。</h2>
            </div>
            <div className="pipeline">
              <div><span>01</span><Music2 size={26} /><strong>Decode</strong><p>讀取你的音訊波形</p></div>
              <i />
              <div><span>02</span><AudioLines size={26} /><strong>Analyze</strong><p>BPM / Onset / Energy / Spectrum / Phrases</p></div>
              <i />
              <div><span>03</span><Sparkles size={26} /><strong>Forge</strong><p>建立段落感知多難度 Pattern</p></div>
              <i />
              <div><span>04</span><Gamepad2 size={26} /><strong>Play</strong><p>即時開始挑戰</p></div>
            </div>
          </section>
        </main>
      )}

      {stage === 'analyzing' && (
        <main className="analysis-page">
          <div className="analysis-visual">
            <div className="analysis-ring ring-a" />
            <div className="analysis-ring ring-b" />
            <div className="analysis-ring ring-c" />
            <div className="analysis-core"><AudioLines size={42} /></div>
          </div>
          <span className="eyebrow">FORGING BEATMAP</span>
          <h1>{analysisStep}</h1>
          <p>所有音訊分析都在你的瀏覽器內完成。</p>
          <div className="analysis-bars" aria-hidden="true">
            {Array.from({ length: 26 }, (_, i) => <span key={i} style={{ animationDelay: `${i * 34}ms` }} />)}
          </div>
        </main>
      )}

      {stage === 'select' && song && analysis && beatmaps && selectedMap && (
        <main className="song-page">
          <section className="song-hero">
            <div className="cover-art" aria-hidden="true">
              <div className="cover-disc"><AudioLines size={54} /></div>
              <span className="cover-ring cover-ring-a" />
              <span className="cover-ring cover-ring-b" />
            </div>
            <div className="song-meta">
              <span className="pill"><CheckCircle2 size={14} />BEATMAP READY</span>
              <h1>{song.title}</h1>
              <p>{song.artist}</p>
              <div className="song-stats">
                <div><span>BPM</span><strong>{analysis.bpm.toFixed(1)}</strong></div>
                <div><span>LENGTH</span><strong>{formatDuration(analysis.duration)}</strong></div>
                <div><span>OBJECTS</span><strong>{noteCountText}</strong></div>
                <div><span>STAR</span><strong>{selectedMap.starRating.toFixed(1)}</strong></div>
              </div>
            </div>
          </section>

          <section className="mode-section">
            <div className="section-heading compact">
              <div><span className="eyebrow">SELECT MODE</span><h2>選擇遊玩方式</h2></div>
              <div className="control-legend">
                <span><Gamepad2 size={15} />6 種玩法共用同一首歌</span>
              </div>
            </div>

            <div className="mode-grid">
              {GAME_MODES.map((mode) => {
                const active = selectedMode === mode.id;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    className={`mode-card ${active ? 'active' : ''}`}
                    onClick={() => setSelectedMode(mode.id)}
                    aria-pressed={active}
                  >
                    <span className="mode-card-kicker">{mode.shortLabel}</span>
                    <strong>{mode.label}</strong>
                    <p>{mode.description}</p>
                    <div className="mode-controls">
                      <span>{mode.controlsDesktop}</span>
                      <span>{mode.controlsMobile}</span>
                    </div>
                    {active && <CheckCircle2 className="mode-check" size={20} />}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="difficulty-section">
            <div className="section-heading compact">
              <div><span className="eyebrow">SELECT DIFFICULTY</span><h2>選擇你的挑戰</h2></div>
              <div className="control-legend">
                <span><MousePointer2 size={15} />電腦：{selectedModeDefinition.controlsDesktop}</span>
                <span><Smartphone size={15} />手機：{selectedModeDefinition.controlsMobile}</span>
              </div>
            </div>

            <div className="difficulty-list">
              {DIFFICULTIES.map((preset) => {
                const map = beatmaps[preset.id];
                const active = selectedDifficulty === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={`difficulty-card diff-${preset.id} ${active ? 'active' : ''}`}
                    onClick={() => setSelectedDifficulty(preset.id)}
                    aria-pressed={active}
                  >
                    <span className="diff-accent" />
                    <span className="diff-copy">
                      <strong>{preset.label}</strong>
                      <small>{preset.description}</small>
                    </span>
                    <span className="diff-metrics">
                      <em>★ {adaptBeatmapForMode(map, selectedMode).starRating.toFixed(1)}</em>
                      <small>{adaptBeatmapForMode(map, selectedMode).objects.length} objects</small>
                    </span>
                    <span className="diff-radio">{active && <CheckCircle2 size={20} />}</span>
                  </button>
                );
              })}
            </div>

            <div className="play-panel">
              <div>
                <span className="eyebrow">CURRENT MAP</span>
                <strong>{selectedModeDefinition.label} · {selectedMap.difficultyLabel} · ★ {(selectedModeMap?.starRating ?? selectedMap.starRating).toFixed(1)}</strong>
                <p>
                  {selectedModeMap?.objects.length ?? selectedMap.objects.length} 個物件 · Approach {selectedMap.approachMs} ms · Hit Window ±{selectedMap.hitWindowMs} ms
                  {' · '}
                  {selectedMap.validation.repaired > 0
                    ? `Validator repaired ${selectedMap.validation.repaired}`
                    : 'Validator PASS'}
                  {selectedBest
                    ? ` · Best ${selectedBest.score.toLocaleString()} · ${selectedBest.accuracy.toFixed(2)}%`
                    : ''}
                </p>
              </div>
              <button className="primary-button play-button" type="button" onClick={() => setStage('game')}>
                <Play size={21} fill="currentColor" />PLAY
              </button>
            </div>
          </section>
        </main>
      )}

      <footer className="footer">
        <span>BeatForge v0.3.1 · Turn Music Into Play</span>
        <span>Local-first audio processing</span>
      </footer>

      {settingsOpen && (
        <div className="drawer-backdrop" onMouseDown={() => setSettingsOpen(false)}>
          <aside className="settings-drawer" onMouseDown={(event) => event.stopPropagation()} aria-label="遊戲設定">
            <div className="drawer-heading">
              <div><span className="eyebrow">SETTINGS</span><h2>遊戲設定</h2></div>
              <button className="icon-button" type="button" onClick={() => setSettingsOpen(false)} aria-label="關閉設定"><X size={20} /></button>
            </div>

            <label className="range-setting">
              <div><strong>音訊音量</strong><span>{Math.round(volume * 100)}%</span></div>
              <input type="range" min="0" max="1" step="0.01" value={volume} onChange={(event) => setVolume(Number(event.target.value))} />
            </label>

            <label className="range-setting">
              <div><strong>Hit Sound</strong><span>{Math.round(hitSoundVolume * 100)}%</span></div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={hitSoundVolume}
                onChange={(event) => setHitSoundVolume(Number(event.target.value))}
              />
              <small>調整按中音符時的打擊音效音量，不會改變歌曲本身音量。</small>
            </label>

            <label className="range-setting">
              <div><strong>Timing Offset</strong><span>{offsetMs > 0 ? '+' : ''}{offsetMs} ms</span></div>
              <input type="range" min="-200" max="200" step="1" value={offsetMs} onChange={(event) => setOffsetMs(Number(event.target.value))} />
              <small>如果你覺得音符總是偏早或偏遲，可調整全域判定偏移。藍牙耳機通常需要較大的補償。</small>
            </label>

            <button className="secondary-button full" type="button" onClick={() => void estimateDeviceLatency()}>
              <AudioLines size={17} />估算裝置音訊延遲
            </button>
            {latencyInfo && <p className="latency-info">{latencyInfo}</p>}

            <button className="secondary-button full" type="button" onClick={() => { setOffsetMs(0); setVolume(0.82); setHitSoundVolume(0.55); setLatencyInfo(''); }}>
              重設為預設值
            </button>

            <div className="settings-note">
              <ShieldCheck size={19} />
              <p><strong>Local-first</strong>歌曲檔案不會傳到 BeatForge 伺服器；重新整理頁面後音訊即離開記憶體。</p>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
