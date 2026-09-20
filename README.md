# BeatForge

**Turn Music Into Play.**

🎮 **Live Demo:** https://a24dc523.github.io/BeatForge/

BeatForge is a browser-first rhythm game that analyzes a user's own audio and automatically turns it into playable rhythm charts.

The project is currently in the **v0.2.0 series** and is already playable on desktop and mobile through GitHub Pages.

## Highlights

- Upload your own MP3, WAV, M4A, AAC, OGG, or FLAC
- Direct-audio URL import when the source permits browser CORS
- Browser-side BPM, beat, onset, and energy analysis
- Automatic Easy / Normal / Hard / Expert beatmap generation
- Tap, Hold, and Slide objects
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

Hold and Slide objects provide start feedback and final judgment feedback at their corresponding playfield positions.

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
- BPM estimation
- beat-phase estimation
- peak detection

The generator then creates four difficulty variants:

| Difficulty | Style |
| --- | --- |
| Easy | Lower density, wider spacing, longer approach time |
| Normal | Balanced default chart |
| Hard | Higher density and tighter spacing |
| Expert | Highest current density and shortest timing windows |

Generated charts are deterministic for the same analysis input.

## Beatmap Validator

Generated maps pass through a validator before gameplay.

It currently checks and repairs:

- playfield coordinate bounds
- Slide end-point bounds
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

## Controls

### Desktop

- Move the mouse to aim
- Press **Z** or **X** to hit
- Mouse click is also supported
- Hold Z / X or the pointer for Hold / Slide objects

### Mobile

- Tap notes directly
- Hold Hold objects
- Drag along Slide paths

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
          +--> BPM estimation
          +--> Beat phase tracking
          +--> Peak detection
          |
          v
 Master Timing Data
          |
          v
 Beatmap Generator
 Easy / Normal / Hard / Expert
          |
          v
 Beatmap Validator
          |
          v
 React + Canvas Game Engine
          |
          +--> Judgment / scoring
          +--> Hit particles / screen punch
          +--> Combo feedback
          +--> Web Audio hit sounds
          +--> Local best scores
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
- Beatmap Validator repair / removal behavior

## Current limitations

The current version still has several known limitations:

- audio analysis assumes mostly constant tempo
- variable-BPM / tempo-section tracking is not implemented yet
- direct URL import depends on browser CORS permissions
- gameplay currently uses a single active pointer / key state rather than full multi-touch chord tracking
- generated charts intentionally avoid simultaneous chord objects
- best-score identity currently uses title + BPM + duration + difficulty rather than a full audio fingerprint
- device-latency estimation is approximate and is not a full tap-calibration test

## Roadmap

Planned / likely next improvements include:

- Combo Break / Miss-specific feedback
- richer Hold and Slide feedback
- interactive timing calibration
- true multi-touch and chord support
- variable-BPM tracking
- richer spectral analysis
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
