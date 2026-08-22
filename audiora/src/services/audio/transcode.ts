import type { AudioFormat } from '@/types/audio';
import { versioned } from '../assetVersion';

/**
 * FLAC / M4A / OGG / AAC encoding via FFmpeg (WebAssembly build).
 *
 * WAV and MP3 have fast dedicated encoders elsewhere in this folder. The
 * remaining formats have no native browser encoder, so they go through FFmpeg,
 * which is loaded on demand the first time one of them is requested — there is
 * no reason to make everyone pay for it up front.
 *
 * Nothing here renames a file: each output is genuinely encoded by the codec
 * the user picked.
 */

/**
 * The encoder core is served from this origin rather than a CDN. Same-origin
 * keeps it working under the cross-origin isolation headers the app sets, and
 * means exports do not depend on a third-party host staying up.
 */
const CORE_BASE = '/ffmpeg';

type FFmpegInstance = {
  load: (opts: { coreURL: string; wasmURL: string; classWorkerURL?: string }) => Promise<boolean>;
  writeFile: (name: string, data: Uint8Array) => Promise<boolean>;
  readFile: (name: string) => Promise<Uint8Array | string>;
  deleteFile: (name: string) => Promise<boolean>;
  exec: (args: string[]) => Promise<number>;
  on: (event: string, cb: (payload: { progress?: number; message?: string }) => void) => void;
  loaded: boolean;
};

let instance: FFmpegInstance | null = null;
let loading: Promise<FFmpegInstance> | null = null;
let lastLog: string[] = [];

export type TranscodeProgress = (fraction: number) => void;

/** Load FFmpeg once and reuse it for the rest of the session. */
async function getFFmpeg(onProgress?: TranscodeProgress): Promise<FFmpegInstance> {
  if (instance?.loaded) return instance;
  if (loading) return loading;

  loading = (async () => {
    const [{ FFmpeg }, { toBlobURL }] = await Promise.all([import('@ffmpeg/ffmpeg'), import('@ffmpeg/util')]);

    const ffmpeg = new FFmpeg() as unknown as FFmpegInstance;
    ffmpeg.on('log', ({ message }) => {
      if (!message) return;
      lastLog.push(message);
      if (lastLog.length > 60) lastLog.shift();
    });
    ffmpeg.on('progress', ({ progress }) => {
      if (typeof progress === 'number') onProgress?.(Math.max(0, Math.min(1, progress)));
    });

    // The library resolves its own worker against `import.meta.url`, which a
    // bundler rewrites — the worker then never loads and `load()` hangs forever
    // with no error. Pointing `classWorkerURL` at our own copy sidesteps that
    // entirely and behaves identically in dev and in a production build.
    void toBlobURL;
    const origin = window.location.origin;
    await ffmpeg.load({
      coreURL: new URL(versioned(`${CORE_BASE}/ffmpeg-core.js`), origin).href,
      wasmURL: new URL(versioned(`${CORE_BASE}/ffmpeg-core.wasm`), origin).href,
      classWorkerURL: new URL(versioned(`${CORE_BASE}/esm/worker.js`), origin).href,
    });
    instance = ffmpeg;
    return ffmpeg;
  })();

  try {
    return await loading;
  } catch (error) {
    loading = null;
    throw error;
  }
}

/** Warm the encoder up ahead of time so the first export is not the slow one. */
export function preloadTranscoder(): void {
  void getFFmpeg().catch(() => {
    /* the export path will surface any failure */
  });
}

export function isTranscoderReady(): boolean {
  return !!instance?.loaded;
}

interface CodecPlan {
  /** Output file extension inside the FFmpeg virtual filesystem. */
  ext: string;
  mime: string;
  /** Candidate argument sets, tried in order until one succeeds. */
  attempts: (bitrateKbps: number) => string[][];
}

const PLANS: Partial<Record<AudioFormat, CodecPlan>> = {
  flac: {
    ext: 'flac',
    mime: 'audio/flac',
    // FLAC is native to FFmpeg and always present.
    attempts: () => [['-c:a', 'flac', '-compression_level', '5']],
  },
  m4a: {
    ext: 'm4a',
    mime: 'audio/mp4',
    attempts: (k) => [
      ['-c:a', 'aac', '-b:a', `${k}k`],
      // Some core builds ship the encoder as experimental only.
      ['-c:a', 'aac', '-b:a', `${k}k`, '-strict', '-2'],
    ],
  },
  aac: {
    ext: 'aac',
    mime: 'audio/aac',
    attempts: (k) => [
      ['-c:a', 'aac', '-b:a', `${k}k`, '-f', 'adts'],
      ['-c:a', 'aac', '-b:a', `${k}k`, '-strict', '-2', '-f', 'adts'],
    ],
  },
  ogg: {
    ext: 'ogg',
    mime: 'audio/ogg',
    attempts: (k) => [
      ['-c:a', 'libvorbis', '-b:a', `${k}k`],
      // Opus in an Ogg container is a valid .ogg and is widely supported.
      ['-c:a', 'libopus', '-b:a', `${k}k`],
      ['-c:a', 'vorbis', '-b:a', `${k}k`, '-strict', '-2'],
    ],
  },
};

export function isTranscodeFormat(format: AudioFormat): boolean {
  return format in PLANS;
}

export function transcodeMime(format: AudioFormat): string {
  return PLANS[format]?.mime ?? 'application/octet-stream';
}

export class TranscodeError extends Error {}

/**
 * Encode a WAV blob into `format`. The WAV is produced losslessly upstream, so
 * this is a single encode, not a re-encode of something already lossy.
 */
export async function transcodeFromWav(
  wav: Blob,
  format: AudioFormat,
  bitrateKbps: number,
  onProgress?: TranscodeProgress,
): Promise<Blob> {
  const plan = PLANS[format];
  if (!plan) throw new TranscodeError(`${format} is not handled by the encoder.`);

  const ffmpeg = await getFFmpeg(onProgress);
  const inputName = `7audio-in-${Date.now()}.wav`;
  const outputName = `7audio-out-${Date.now()}.${plan.ext}`;

  await ffmpeg.writeFile(inputName, new Uint8Array(await wav.arrayBuffer()));

  let encoded: Uint8Array | null = null;
  let lastError: unknown = null;

  try {
    for (const args of plan.attempts(bitrateKbps)) {
      lastLog = [];
      try {
        const code = await ffmpeg.exec(['-hide_banner', '-i', inputName, ...args, outputName]);
        if (code !== 0) throw new Error(`exit ${code}`);
        const data = await ffmpeg.readFile(outputName);
        const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
        if (bytes.length > 0) {
          encoded = bytes;
          break;
        }
        throw new Error('empty output');
      } catch (error) {
        lastError = error;
        // Clear a partial file before the next attempt.
        try {
          await ffmpeg.deleteFile(outputName);
        } catch {
          /* nothing written */
        }
      }
    }
  } finally {
    try {
      await ffmpeg.deleteFile(inputName);
    } catch {
      /* already gone */
    }
    if (encoded) {
      try {
        await ffmpeg.deleteFile(outputName);
      } catch {
        /* already gone */
      }
    }
  }

  if (!encoded) {
    // Keep the detail in the console; the UI shows a plain message.
    console.error('[audiora] encode failed', format, lastError, lastLog.slice(-12));
    throw new TranscodeError(`This file could not be encoded as ${format.toUpperCase()}.`);
  }

  onProgress?.(1);
  const copy = new Uint8Array(encoded.length);
  copy.set(encoded);
  return new Blob([copy], { type: plan.mime });
}

/** Which codecs the loaded FFmpeg build actually reports. Used by diagnostics. */
export async function listEncoders(): Promise<string[]> {
  const ffmpeg = await getFFmpeg();
  lastLog = [];
  await ffmpeg.exec(['-hide_banner', '-encoders']);
  return lastLog.slice();
}
