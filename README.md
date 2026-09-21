# BeatForge

**Turn Music Into Play.**

🎮 **Live Demo:** https://a24dc523.github.io/BeatForge/

BeatForge is a browser-first rhythm game that analyzes a user's own audio and automatically turns it into playable rhythm charts.

The project is currently in the **v0.5.0 series** and is playable on desktop and mobile through GitHub Pages. v0.5 upgrades FORGE Slide notes from a straight A→B drag into deterministic multi-point curved tracking paths with path-aware validation and input grace.

## Highlights

- Upload your own MP3, WAV, M4A, AAC, OGG, or FLAC
- Direct-audio URL import when the source permits browser CORS
- Browser-side global BPM, local tempo-map, beat, onset, energy, and Low / Mid / High spectral-band analysis
- Phrase-aware Easy / Normal / Hard / Expert beatmap generation
- Six gameplay modes: Forge, 4K Lanes, 2K Split, 1K Pulse, Drum, and Catch
- Tap, Hold, and multi-point curved Slide objects
- Desktop controls: mouse cursor + Z/X, with mouse click support
- Mobile controls: tap, hold, and drag
- Perfect / Great / Good / Miss judgments
- Score, combo, accuracy, rank, and result screen
- Position-based judgment popups at the actual hit / miss location
- Per-hit awarded score display such as `PERFECT +2,340`
- Low-latency Web Audio hit sounds
- Separate hit-sound volume control
- Different sounds for Perfect / Great / Good, Hold, and Slide completion
- Combo-dependent sound layering at higher streaks
- Hit burst particles, expanding rings, streaks, glow, and screen punch
- Combo HUD punch animation and combo tiers
- Combo milestones at 10 / 25 / 50 / 100+ streaks
- Mobile vibration feedback on supported browsers
- Timing offset and song-volume settings
- Web Audio device-latency estimation using `baseLatency` / `outputLatency`
- Beatmap Validator with automatic repair
- Local best-score persistence per song and difficulty
- Installable PWA shell
- Responsive desktop / phone UI
- Built-in **Neon Pulse** demo generated entirely in the browser
- No account required
- No song upload to a BeatForge server

## Play online

Open:

https://a24dc523.github.io/BeatForge/

GitHub Actions automatically builds and deploys the latest `main` branch to GitHub Pages.

## Gameplay feedback

BeatForge currently uses layered visual, audio, and haptic feedback to make hits easier to read and more satisfying.

### Judgment feedback

Judgments are displayed beside the actual note position instead of in the center of the screen.

Examples:

```text
PERFECT
+2,340

GREAT
+1,420

MISS
+0
```

The displayed score is the **actual score awarded for that hit**, including the current combo multiplier.

Hold and Slide objects provide start feedback and final judgment feedback at their corresponding playfield positions. FORGE Slide notes now expose their full curved route, intermediate guide nodes, completed-path highlight, and live tracking target.

### Hit effects

Successful hits can produce:

- radial hit flashes
- expanding rings
- directional streaks
- particles
- short screen-punch movement
- optional device vibration on supported mobile browsers

Perfect receives the strongest effect, followed by Great and Good.

### Combo feedback

Combo feedback scales with the current streak:

- **10+**: first visual tier
- **25+**: stronger glow and additional hit-sound layer
- **50+**: stronger HUD / edge feedback
- **100+**: highest current feedback tier

Milestone banners appear at important combo thresholds without permanently covering the chart.

## Hit Sound system

Hit sounds are generated in real time with the Web Audio API and do not require external audio assets.

Current sound profiles include:

- Perfect
- Great
- Good
- Hold start
- Hold completion
- Slide completion

Higher combos add a subtle high-frequency layer to increase intensity without replacing the original song.

Hit Sound volume is independent from song volume and is stored locally.

If Web Audio cannot start on a browser or device, gameplay continues normally without hit sounds.

## Beatmap generation

BeatForge analyzes the decoded song in-browser and builds timing data from:

- energy envelope
- onset envelope
- global BPM estimation
- local tempo-segment estimation for major BPM changes
- beat-phase estimation per tempo segment
- peak detection
- local phrase energy across multi-beat windows
- Low / Mid / High frequency-band envelopes
- beat-strength / downbeat weighting

The v0.3 generator does more than randomly thin a master timing list. It now applies:

- **tempo-aware beat grid** so major section BPM changes rebuild local beat spacing instead of forcing one whole-song interval;
- **strong / weak beat weighting** so downbeats and backbeats are more likely to define the chart skeleton;
- **spectral-aware timing weight** so low-frequency impact strengthens main beats while mid/high transients can reinforce subdivisions and peak events;
- **phrase-aware density** so energetic sections naturally become busier while quieter sections leave more breathing room;
- **peak quantization** that snaps suitable transients toward the musical grid without forcing every transient onto a beat;
- **local density budgets** to prevent short sections from turning into unreadable note spam;
- **pattern continuity** so pointer-mode positions form short deterministic motion phrases instead of unrelated jumps;
- **anti-repetition rules** that reduce immediate 180-degree reversals on easier charts;
- **sustain pacing** that keeps Hold / Slide objects from stacking back-to-back;
- **tempo-aware sustain length** so Hold / Slide duration follows the local BPM instead of the song-wide BPM;
- **sustain reservation** so following notes are not generated inside an active Hold / Slide window;
- **spectral object shaping** where high-frequency transients can favour sharper Slide-like motion while low/mid body can favour sustained events;
- **difficulty-specific subdivisions**: higher difficulties may use half-beats and quarter-beats while Easy focuses on the rhythmic skeleton;
- **burst-aware star rating** using local density and sustain ratio in addition to BPM and average note density.

The generator creates four difficulty variants:

| Difficulty | Generator behaviour |
| --- | --- |
| Easy | Strong beats and phrase skeleton, low local density, wide spacing |
| Normal | Main beat grid, accents and moderate phrase variation |
| Hard | Half-beat subdivisions, peak tracking and energetic-section acceleration |
| Expert | Quarter-beat options, denser peak tracking and the highest local burst budget |

Generated charts remain deterministic for the same analysis input.

## Hold / sustain handling

v0.4 also tightens long-note generation and judgment:

- minimum meaningful Hold duration varies by difficulty;
- Hold / Slide duration is quantized from the **local tempo segment**;
- FORGE generation reserves the sustain span plus a short recovery gap, preventing impossible notes from appearing inside the same long press;
- the validator shortens an overlapping sustain when enough room remains;
- if the remaining sustain would be too short to be meaningful, it is downgraded to a Tap;
- Pointer and Lane engines use a short release-grace window so brief input jitter does not immediately break a long note;
- active Lane Hold notes keep their remaining body visible after the head is hit;
- active Holds show progress, remaining time, `RELEASE` near the tail, and `BROKEN` when the sustain has already failed;
- FORGE Hold notes show their duration before the hit and a circular sustain-progress indicator while held.

## Slide path engine

v0.5 replaces the previous straight-line FORGE Slide with a path-driven implementation:

- generated Slide notes contain **3–5 deterministic path points** depending on difficulty;
- intermediate points bend around the start/end vector to create short arc and S-shaped patterns;
- high-frequency spectral content can increase curve character slightly without changing determinism;
- one interpolation function drives both the rendered curve and the live judgment target, preventing visual/collision mismatch;
- completed portions of the path highlight while the player is tracking the Slide;
- moving slightly outside the tracking radius shows `TRACK!` first instead of failing instantly;
- each difficulty has its own path tolerance and off-path grace period;
- a very large deviation can still break immediately;
- legacy two-point Slides remain playable through automatic fallback.

The validator now checks Slide path bounds, time ordering, start/end synchronization, and per-segment travel speed. If another validator repair moves the Slide head, the complete path is resynchronized afterward.

Non-FORGE modes remove this Pointer-specific path metadata when converting Slides to Holds or Taps.

## Beatmap Validator

Generated maps pass through a validator before gameplay.

It currently checks and repairs:

- playfield coordinate bounds
- Slide end-point and multi-point path bounds
- Slide path ordering, endpoint synchronization, and per-segment speed
- invalid sustain duration
- sustain objects that exceed the end of the song
- unsafe movement speed between objects
- duplicate timestamps
- invalid or unusable object times

This also keeps the current chart format compatible with the single-target gameplay model.

## Gameplay timing

BeatForge uses the HTML audio playback clock as the authoritative song timeline.

A configurable global timing offset is applied during hit judgment.

Default timing windows vary by difficulty, with tighter windows on harder maps.

The settings panel also includes an optional Web Audio device-latency estimate based on `baseLatency` and `outputLatency`. This is only a starting estimate; players can still fine-tune the offset manually.

## Gameplay modes

| Mode | Desktop | Mobile | Core idea |
| --- | --- | --- | --- |
| **FORGE** | Mouse + Z / X | Tap / hold / drag | Free-position Pointer gameplay with Tap, Hold and Slide |
| **4K LANES** | D / F / J / K | Tap four lanes | Four-key falling-note lane mode; low-frequency hits favour inner lanes while high-frequency transients favour outer lanes |
| **2K SPLIT** | F / J | Tap left / right | Fast two-lane alternating rhythm |
| **1K PULSE** | Space | Tap anywhere | Pure timing mode with no aiming |
| **DRUM** | F / J = Don, D / K = Ka | Tap left / right drum side | Spectral Don / Ka mapping: low-frequency impact tends toward Don, high-frequency transient content tends toward Ka |
| **CATCH** | Left / Right or A / D | Drag horizontally | Move the catcher and intercept notes at the judgment line |

Each mode shares the same song analysis, difficulty system, scoring model, Hit Sound engine and result screen, while keeping separate local best-score records.

## Local-first privacy

The current release does not require a backend for gameplay.

- Song files are not uploaded by BeatForge
- Local audio is represented by a temporary browser object URL
- The service worker does not cache user audio
- Timing offset is stored in `localStorage`
- Song volume is stored in `localStorage`
- Hit Sound volume is stored in `localStorage`
- Local best scores are stored in `localStorage`

Loading another local song or closing the page releases the temporary song URL from the app.

## YouTube and streaming platforms

BeatForge deliberately does **not** download, cache, or separate YouTube audiovisual content.

Users should upload audio they are authorized to use.

The URL importer is intended for direct audio resources whose host permits browser CORS access.

## Run locally

Requirements:

- Node.js 22

Install and start:

```bash
npm install
npm run dev
```

Production verification:

```bash
npm test
npm run build
```

## Architecture

```text
Audio File / Direct Audio URL
          |
          v
 Web Audio Decode
          |
          v
 Energy + Onset Envelope
          |
          +--> Low / Mid / High band envelopes
          +--> high-resolution rhythm envelope
          +--> global BPM estimation
          +--> local tempo segmentation
          +--> per-segment beat phase
          +--> Peak detection
          |
          v
 Master Timing Data
          |
          v
 Phrase-aware Beatmap Generator
 Easy / Normal / Hard / Expert
          |
          +--> beat strength / phrase energy
          +--> spectral weighting
          +--> peak quantization
          +--> local density budget
          +--> pattern continuity
          +--> multi-point Slide path generation
          |
          v
 Beatmap Validator
          |
          v
 Multi-mode React + Canvas Engines
          |
          +--> Forge Pointer
          +--> 4K / 2K / 1K Lane
          +--> Drum
          +--> Catch
          +--> shared scoring / Hit Sound
          +--> local best scores
```

## PWA

BeatForge includes:

- Web App Manifest
- Service Worker
- standalone display mode
- installable app shell on supported browsers

The service worker caches the application shell and static resources only. User-provided audio is intentionally excluded from caching.

## CI / Deployment

Every push to `main` runs GitHub Actions for:

1. dependency installation
2. unit tests
3. TypeScript / Vite production build
4. production artifact upload
5. GitHub Pages build
6. GitHub Pages deployment

Current test coverage includes:

- beatmap generation
- deterministic difficulty generation
- audio analysis with the built-in demo WAV
- 120 → 160 BPM section-change tempo-map detection
- Low / Mid / High frequency-band separation
- mode-specific beatmap playability rules
- generated sustain spacing and minimum Hold duration
- generated multi-point Slide path bounds and ordering
- Slide path Validator repair and mode-conversion cleanup
- Beatmap Validator sustain-overlap repair / removal behavior

## Current limitations

The current version still has several known limitations:

- tempo-map detection currently targets **major section-level BPM changes** using local analysis windows;
- continuous accelerando / ritardando and very rapid tempo automation are not yet modeled as a continuous tempo curve
- direct URL import depends on browser CORS permissions
- Forge Pointer mode still uses a single active pointer / key sustain state
- generated charts intentionally avoid simultaneous chord objects; true chord authoring is not implemented yet
- best-score identity currently uses title + BPM + duration + difficulty rather than a full audio fingerprint
- device-latency estimation is approximate and is not a full tap-calibration test

## Roadmap

Planned / likely next improvements include:

- Combo Break / Miss-specific feedback
- mode-specific beatmap transformations instead of sharing one timing-object list across every mode
- interactive timing calibration
- true chord authoring for 4K
- continuous tempo-curve tracking for accelerando / ritardando
- beatmap editor
- replay files
- song fingerprinting
- optional accounts and leaderboards
- authorized cloud storage
- optional server-side analysis for very large tracks

## Tech stack

- React 19
- TypeScript
- Vite
- Canvas 2D
- Web Audio API
- Vitest
- GitHub Actions
- GitHub Pages
- PWA / Service Worker
