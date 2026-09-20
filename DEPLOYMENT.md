# BeatForge deployment

BeatForge is a static Vite application. No backend, database, secret, or paid API is required for the current playable release.

## Vercel

1. Import `A24DC523/BeatForge` into Vercel.
2. Keep the detected framework as **Vite**.
3. Build command: `npm run build`
4. Output directory: `dist`
5. Deploy.

The repository includes `vercel.json` and `.nvmrc`, so these values should be detected automatically.

## Local production check

```bash
npm install
npm test
npm run build
npm run preview
```

## GitHub Actions note

The repository contains a CI workflow for Node 22. If GitHub does not allocate a runner, check the account's Actions quota/billing/runner availability. A run that finishes with no steps and `runner_id: 0` did not execute the project's test or build commands.

## Runtime requirements

Modern browser with:

- Web Audio API / `AudioContext`
- Canvas 2D
- Pointer Events
- File API / Blob URLs

No server-side audio processing is used.
