# 7 Audio — AI Audio Toolkit

**Audio tools, perfected.**

A complete website and responsive web application: seven audio tools, all processing done
in the browser. No uploads, no queue, no account required.

```bash
npm install
npm run dev        # http://localhost:3190
npm run build      # production build into dist/
npm run typecheck
```

Package for deployment (from the workspace root):

```bash
powershell -File "make-7audio-zip.ps1" https://audiora.7by.in
```

---

## The one rule this codebase follows

**Nothing pretends to work.** Every button either does the real thing, or says plainly why
it cannot. See [Known limits](#known-limits).

## What runs where

| Tool | Engine |
| --- | --- |
| Vocal Remover | Demucs via onnxruntime-web (WebGPU where available, else WASM) |
| Stem Splitter | Same, 4 stems — or 6 with the high-quality model (adds guitar + piano) |
| Noise Remover | Spectral gating in a Web Worker (2048-pt FFT, 75% overlap) |
| Audio Cutter | Web Audio buffer slicing |
| Song Joiner | Equal-power crossfade concatenation |
| Pitch Shifter | WSOLA offline render + a live AudioWorklet preview |
| Audio Converter | Rate/channel conversion, normalise, fades |

User audio is never transmitted. The only outbound requests are for the engine files
themselves, and they carry no audio. Note this is an implementation fact for developers —
the product UI deliberately does not talk about it.

## Export formats — all six are real

| Format | Encoder | Notes |
| --- | --- | --- |
| WAV | built in | 24-bit, fastest |
| MP3 | LAME (JS) | up to 320 kbps, fast |
| FLAC | FFmpeg (WASM) | lossless |
| M4A | FFmpeg (WASM) | AAC in MP4 |
| OGG | FFmpeg (WASM) | Vorbis, falls back to Opus |
| AAC | FFmpeg (WASM) | ADTS |

Nothing is ever produced by renaming a file. FFmpeg is self-hosted under `public/ffmpeg/`
and loads on demand the first time one of the last four is requested.

## Architecture

```
src/
  components/       Header, BottomNav, Waveform, UploadZone, ExportCard, ToolShell, …
    ui/             Toast, Modal, Controls, States (empty/error/loading/skeleton)
  pages/            One file per route
    tools/          The seven tool pages
  layouts/          SiteLayout (header + main + footer + bottom nav)
  hooks/            useTheme, useMediaQuery, useAudioFiles, useProcessing,
                    useRunLog, useLivePitch
  services/
    audio/          THE processing seam — see below
    auth.ts         Account calls, capability-gated
    workspace.ts    Local history in IndexedDB
  config/           tools.ts, pricing.ts, site.ts
public/
  workers/          separation-worker.js (4-stem), separation6-worker.js (6-stem),
                    denoise-worker.js, stretch-worker.js
  worklets/         pitch-processor.js — real-time pitch preview
  ffmpeg/           self-hosted encoder core + its ESM worker
  brand/            favicon.svg — drop 7audio-icon.png here (see below)
```

### The service seam

Pages never touch Web Audio, workers or encoders. They call `src/services/audio`:

```ts
loadAudioFile(file)                              // File → AudioBuffer + peaks + metadata
convertAudio(buffer, settings, onProgress)
exportCuts(buffer, segments, settings, onProgress)
joinAudio(buffers, options, settings, onProgress)
shiftPitch(buffer, pitch, settings, onProgress)
separateAudio(buffer, { model, mode }, onProgress)   // → SeparatedSession (buffers)
encodeVocalResult(session, settings, onProgress)     // → { instrumental, vocals }
encodeStems(session, settings, onProgress)           // → one result per stem
reduceNoise(buffer, options, settings, onProgress)
```

Separation returns **buffers**, and encoding is a separate step. That is what lets the UI
change export format without separating again.

## Using the official icon

The app ships a vector rebuild of the 7 Audio mark. To use the original artwork, drop it at:

```
public/brand/7audio-icon.png
```

Every mark in the app — splash, header, footer, auth pages, 404 — switches to it
automatically. No code change, no rebuild step.

## Pricing

`src/config/pricing.ts` is the single source of truth. No price is hard-coded anywhere else.

## Known limits

1. **The 6-stem model (guitar + piano) is unverified.** It is wired up and selectable under
   "High quality", and its 285 MB download works, but its engine did not finish starting in
   the dev environment. A 5-minute stall guard turns a failure into a clean error rather
   than a spinner. Test it on real hardware before relying on it. Standard (4 stems) is
   verified working and is the default.
2. **Accounts, credits and checkout need a server.** Set `VITE_AUDIORA_API` to a running
   backend and the sign-in, sign-up, reset and API pages start working against it.
3. **Live pitch preview colours pure tones.** Real-time granular shifting comb-filters
   sustained single notes. The pitch itself is exact, and the downloaded render uses the
   higher-quality WSOLA path, which is level-accurate.

## Do not enable cross-origin isolation

Adding COOP + COEP would give the separation engine multiple CPU threads, but it was tested
and it **breaks the audio encoder** — FLAC, M4A, OGG and AAC export all stop working.
`public/.htaccess` documents this. Retest every export format if you revisit it.

## Local data

Stored in this browser only, all clearable from **Settings**:

- Theme and export preferences (`localStorage`)
- Job history shown on the Dashboard (`IndexedDB`)
- Cached engine files (Cache Storage)

Storage keys kept their original names through the rebrand on purpose — changing them would
force every existing user to re-download a ~180 MB engine file.

## Responsive coverage

No horizontal overflow on any route at
320 / 360 / 375 / 390 / 414 / 430 / 480 / 600 / 768 / 834 / 900 / 1024 / 1280 / 1366 /
1440 / 1600 / 1728 / 1920.

Phones get a real app shell: fixed bottom navigation with a working quick-action button,
44px minimum touch targets, and **two tool cards per row** with room for a description and
a call to action.
