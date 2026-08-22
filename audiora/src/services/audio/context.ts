import type { AudioFileMeta, LoadedAudio } from '@/types/audio';

/**
 * Decoding + shared AudioContext.
 *
 * Everything here runs on the user's machine. Files are read with the File API
 * into an ArrayBuffer and decoded by the browser. Nothing is uploaded.
 */

let ctx: AudioContext | null = null;

/** Lazily created shared context. Must be resumed from a user gesture. */
export function audioCtx(): AudioContext {
  if (!ctx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctor();
  }
  return ctx;
}

export async function resumeAudio(): Promise<void> {
  const c = audioCtx();
  if (c.state === 'suspended') {
    try {
      await c.resume();
    } catch {
      /* user gesture will retry */
    }
  }
}

export const ACCEPTED_EXTENSIONS = ['.mp3', '.wav', '.flac', '.m4a', '.ogg', '.aac', '.oga', '.opus', '.webm'];
export const ACCEPT_ATTR = 'audio/*,' + ACCEPTED_EXTENSIONS.join(',');

/** 500 MB per file, matching what the product promises. */
export const MAX_FILE_BYTES = 500 * 1024 * 1024;

export function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}

export function isAcceptedAudio(file: File): boolean {
  if (file.type.startsWith('audio/')) return true;
  return ACCEPTED_EXTENSIONS.includes('.' + extensionOf(file.name));
}

let idSeq = 0;
export function nextId(prefix = 'f'): string {
  idSeq += 1;
  return `${prefix}_${Date.now().toString(36)}_${idSeq}`;
}

export function metaFromFile(file: File): AudioFileMeta {
  return {
    id: nextId(),
    name: file.name,
    size: file.size,
    type: file.type,
    format: (extensionOf(file.name) || file.type.split('/')[1] || 'audio').toUpperCase(),
    duration: null,
    sampleRate: null,
    channels: null,
  };
}

export class AudioValidationError extends Error {}

/** Validate before doing any work, so errors are immediate and specific. */
export function validateFile(file: File): void {
  if (!isAcceptedAudio(file)) {
    throw new AudioValidationError(
      `"${file.name}" is not a supported audio file. Use MP3, WAV, FLAC, M4A, OGG or AAC.`,
    );
  }
  if (file.size === 0) {
    throw new AudioValidationError(`"${file.name}" is empty.`);
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new AudioValidationError(
      `"${file.name}" is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_FILE_BYTES)} per file.`,
    );
  }
}

/**
 * Decode a File into an AudioBuffer using the browser's own decoders.
 * Throws a human-readable error if the codec is not supported by this browser.
 */
export async function decodeFile(file: File): Promise<AudioBuffer> {
  validateFile(file);
  const arrayBuffer = await file.arrayBuffer();
  try {
    return await audioCtx().decodeAudioData(arrayBuffer.slice(0));
  } catch {
    throw new AudioValidationError(
      `This browser could not decode "${file.name}". Its codec may not be supported here — try MP3 or WAV.`,
    );
  }
}

export async function loadAudioFile(file: File): Promise<LoadedAudio> {
  const meta = metaFromFile(file);
  try {
    const buffer = await decodeFile(file);
    meta.duration = buffer.duration;
    meta.sampleRate = buffer.sampleRate;
    meta.channels = buffer.numberOfChannels;
    return { meta, file, buffer, peaks: computePeaks(buffer), error: null, status: 'ready' };
  } catch (err) {
    return {
      meta,
      file,
      buffer: null,
      peaks: null,
      error: err instanceof Error ? err.message : 'Could not read this file.',
      status: 'error',
    };
  }
}

/**
 * Min/max envelope for waveform drawing. Returns interleaved [min,max] pairs,
 * `buckets` pairs long, mixed down to mono.
 */
export function computePeaks(buffer: AudioBuffer, buckets = 1600): Float32Array {
  const chans = buffer.numberOfChannels;
  const len = buffer.length;
  const out = new Float32Array(buckets * 2);
  const step = Math.max(1, Math.floor(len / buckets));
  const data: Float32Array[] = [];
  for (let c = 0; c < chans; c++) data.push(buffer.getChannelData(c));

  for (let b = 0; b < buckets; b++) {
    const start = b * step;
    const end = Math.min(len, start + step);
    let min = 0;
    let max = 0;
    for (let i = start; i < end; i++) {
      let v = 0;
      for (let c = 0; c < chans; c++) v += data[c][i];
      v /= chans;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    out[b * 2] = min;
    out[b * 2 + 1] = max;
  }
  return out;
}

/* ------------------------------------------------------------------ fmt --- */

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / Math.pow(1024, i);
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** mm:ss */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** mm:ss.cc — used on timeline markers where precision matters. */
export function formatTimePrecise(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00.00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export function parseTime(text: string): number | null {
  const m = text.trim().match(/^(\d+):(\d{1,2})(?:\.(\d{1,2}))?$/);
  if (!m) {
    const n = Number(text);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  const mins = Number(m[1]);
  const secs = Number(m[2]);
  const cs = m[3] ? Number(m[3].padEnd(2, '0')) : 0;
  if (secs > 59) return null;
  return mins * 60 + secs + cs / 100;
}
