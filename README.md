# BeatForge

**Turn Music Into Play.**

BeatForge is a browser-first rhythm game that analyzes a user's own audio and automatically turns it into four playable beatmaps.

## Current playable release

The current `main` branch is the playable **v0.2.0** local-first web release:

- Upload MP3, WAV, M4A, AAC, OGG, or FLAC
- Direct-audio URL import when the source permits browser CORS
- Browser-side BPM, beat, onset and energy analysis
- Automatic Easy / Normal / Hard / Expert generation
- Tap, Hold and Slide objects
- Desktop controls: mouse cursor + Z/X (mouse click is also supported)
- Touch controls: tap, hold and drag
- Perfect / Great / Good / Miss judgments
- Score, combo, accuracy, rank and results
- Timing offset and volume settings
- Web Audio device-latency estimation using `baseLatency` / `outputLatency`
- Beatmap Validator with automatic repair for bounds, sustain length, duplicate timing and unsafe travel
- Local best-score persistence per song and difficulty
- Installable PWA shell with service-worker caching
- Responsive desktop / phone UI
- Built-in **Neon Pulse** demo generated entirely in the browser
- No account and no audio upload to a BeatForge server

## Run locally

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
 Difficulty Generator
 Easy / Normal / Hard / Expert
          |
          v
 React + Canvas Game Engine
```

Audio analysis and beatmap generation happen in the browser. The uploaded song is represented by a temporary object URL and is released when the app is closed or a new song is loaded.

## YouTube and other streaming platforms

BeatForge deliberately does **not** download, cache, or separate YouTube audiovisual content. YouTube's developer policies restrict API clients from downloading audiovisual content or separating audio tracks. Users should upload audio they are authorized to use.

The URL importer is intended for direct audio resources whose host permits CORS access.

## Gameplay timing

BeatForge uses the audio element clock as the authoritative playback timeline and applies a user-configurable global offset during judgment. The generated map uses normalized playfield coordinates so the same map can adapt across desktop and mobile screens.

Default judgment windows vary by difficulty, with tighter windows on harder maps.

## Privacy

The current version is local-first:

- no backend is required for gameplay;
- song files are not uploaded by the application;
- timing offset, volume and local best-score records are persisted in localStorage.

## Roadmap

Likely next steps include variable-BPM tracking, richer spectral analysis, beatmap editor tooling, replay files, user accounts, leaderboards, authorized cloud storage and optional server-side analysis for larger tracks.

## Development

GitHub Actions verifies unit tests and the production TypeScript/Vite build on every push to `main`, then uploads the generated `dist` directory as a build artifact.
