import type { AudioFormat, Capability } from '@/types/audio';

/**
 * Encoders.
 *
 * WAV and MP3 are encoded here, in this tab, from raw samples — no server and
 * no upload. FLAC / M4A / AAC / OGG have no encoder that ships in a browser,
 * so they are reported as unavailable rather than silently substituted.
 * `encoderCapability()` is what the UI reads to disable those options; nothing
 * anywhere claims an export happened that did not.
 *
 * Decoding those formats still works — the browser can read them as input.
 */

export interface FormatInfo {
  id: AudioFormat;
  label: string;
  mime: string;
  ext: string;
  lossy: boolean;
  /** Bitrates offered in the UI, kbps. Empty for lossless. */
  bitrates: number[];
}

export const FORMATS: Record<AudioFormat, FormatInfo> = {
  mp3: { id: 'mp3', label: 'MP3', mime: 'audio/mpeg', ext: 'mp3', lossy: true, bitrates: [128, 192, 256, 320] },
  wav: { id: 'wav', label: 'WAV', mime: 'audio/wav', ext: 'wav', lossy: false, bitrates: [] },
  flac: { id: 'flac', label: 'FLAC', mime: 'audio/flac', ext: 'flac', lossy: false, bitrates: [] },
  m4a: { id: 'm4a', label: 'M4A', mime: 'audio/mp4', ext: 'm4a', lossy: true, bitrates: [128, 192, 256] },
  ogg: { id: 'ogg', label: 'OGG', mime: 'audio/ogg', ext: 'ogg', lossy: true, bitrates: [128, 192, 256] },
  aac: { id: 'aac', label: 'AAC', mime: 'audio/aac', ext: 'aac', lossy: true, bitrates: [128, 192, 256] },
};

/**
 * Every format below is genuinely encoded.
 *
 * WAV and MP3 have fast dedicated encoders in this file. FLAC, M4A, OGG and
 * AAC are encoded by the FFmpeg WebAssembly build in `transcode.ts`, which
 * loads on first use. No output is ever produced by renaming a file.
 */
export const ENCODABLE: AudioFormat[] = ['wav', 'mp3', 'flac', 'm4a', 'ogg', 'aac'];

/** Formats handled without loading the larger encoder. */
export const NATIVE_FORMATS: AudioFormat[] = ['wav', 'mp3'];

export function encoderCapability(format: AudioFormat): Capability {
  if (ENCODABLE.includes(format)) return { available: true, site: 'local' };
  return { available: false, site: 'local', reason: 'This format is not supported.' };
}

export function canEncode(format: AudioFormat): boolean {
  return ENCODABLE.includes(format);
}

export function needsTranscoder(format: AudioFormat): boolean {
  return ENCODABLE.includes(format) && !NATIVE_FORMATS.includes(format);
}

/* ------------------------------------------------------------------ WAV --- */

/** Interleaved PCM WAV. 16‑ or 24‑bit, any sample rate the buffer carries. */
export function encodeWav(buffer: AudioBuffer, bitDepth: 16 | 24 | 32 = 16): Blob {
  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const frames = buffer.length;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = channels * bytesPerSample;
  const dataSize = frames * blockAlign;

  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  const isFloat = bitDepth === 32;
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, isFloat ? 3 : 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  const data = new ArrayBuffer(dataSize);
  const dv = new DataView(data);
  const chans: Float32Array[] = [];
  for (let c = 0; c < channels; c++) chans.push(buffer.getChannelData(c));

  let offset = 0;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      if (bitDepth === 16) {
        dv.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      } else if (bitDepth === 24) {
        const v = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff);
        dv.setUint8(offset, v & 0xff);
        dv.setUint8(offset + 1, (v >> 8) & 0xff);
        dv.setUint8(offset + 2, (v >> 16) & 0xff);
      } else {
        dv.setFloat32(offset, s, true);
      }
      offset += bytesPerSample;
    }
  }

  return new Blob([header, data], { type: 'audio/wav' });
}

/* ------------------------------------------------------------------ MP3 --- */

/** lamejs accepts these sample rates only. */
const MP3_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];

export function nearestMp3Rate(rate: number): number {
  return MP3_RATES.reduce((best, r) => (Math.abs(r - rate) < Math.abs(best - rate) ? r : best), MP3_RATES[0]);
}

export function mp3RateSupported(rate: number): boolean {
  return MP3_RATES.includes(rate);
}

/**
 * Encode to MP3 with LAME (compiled to JS, running in this tab).
 * `onProgress` reports 0..1 so long encodes can drive a real progress bar.
 */
export async function encodeMp3(
  buffer: AudioBuffer,
  bitrate = 192,
  onProgress?: (p: number) => void,
): Promise<Blob> {
  const { Mp3Encoder } = await import('@breezystack/lamejs');

  const channels = Math.min(2, buffer.numberOfChannels);
  const sampleRate = buffer.sampleRate;
  if (!mp3RateSupported(sampleRate)) {
    throw new Error(
      `MP3 cannot be written at ${sampleRate} Hz. Choose a sample rate of ${nearestMp3Rate(sampleRate)} Hz, or export WAV.`,
    );
  }

  const encoder = new Mp3Encoder(channels, sampleRate, bitrate);
  const left = buffer.getChannelData(0);
  const right = channels > 1 ? buffer.getChannelData(1) : null;

  const BLOCK = 1152;
  const chunks: Uint8Array[] = [];
  const l16 = new Int16Array(BLOCK);
  const r16 = right ? new Int16Array(BLOCK) : null;

  for (let i = 0; i < buffer.length; i += BLOCK) {
    const n = Math.min(BLOCK, buffer.length - i);
    for (let j = 0; j < n; j++) {
      const ls = Math.max(-1, Math.min(1, left[i + j]));
      l16[j] = ls < 0 ? ls * 0x8000 : ls * 0x7fff;
      if (r16 && right) {
        const rs = Math.max(-1, Math.min(1, right[i + j]));
        r16[j] = rs < 0 ? rs * 0x8000 : rs * 0x7fff;
      }
    }
    const lView = n === BLOCK ? l16 : l16.subarray(0, n);
    const rView = r16 ? (n === BLOCK ? r16 : r16.subarray(0, n)) : undefined;
    const buf = r16 ? encoder.encodeBuffer(lView, rView as Int16Array) : encoder.encodeBuffer(lView);
    if (buf.length > 0) chunks.push(new Uint8Array(buf));

    if (onProgress && (i / BLOCK) % 64 === 0) {
      onProgress(i / buffer.length);
      // Yield so the progress bar can actually paint.
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  const tail = encoder.flush();
  if (tail.length > 0) chunks.push(new Uint8Array(tail));
  onProgress?.(1);

  return new Blob(chunks as BlobPart[], { type: 'audio/mpeg' });
}

/* ------------------------------------------------------------- dispatch --- */

export interface EncodeOptions {
  format: AudioFormat;
  bitrate?: number;
  bitDepth?: 16 | 24 | 32;
  onProgress?: (p: number) => void;
}

export async function encodeBuffer(buffer: AudioBuffer, opts: EncodeOptions): Promise<Blob> {
  const cap = encoderCapability(opts.format);
  if (!cap.available) throw new Error(cap.reason ?? 'This format cannot be exported.');

  if (opts.format === 'wav') {
    opts.onProgress?.(0.4);
    const blob = encodeWav(buffer, opts.bitDepth ?? 24);
    opts.onProgress?.(1);
    return blob;
  }

  if (opts.format === 'mp3') {
    return encodeMp3(buffer, opts.bitrate ?? 192, opts.onProgress);
  }

  // FLAC / M4A / OGG / AAC. A 16-bit WAV is handed to the encoder as an
  // intermediate — it is lossless, so this is a single encode of the original
  // samples rather than a re-encode of something already compressed.
  const { transcodeFromWav } = await import('./transcode');
  opts.onProgress?.(0.05);
  const wav = encodeWav(buffer, 16);
  return transcodeFromWav(wav, opts.format, opts.bitrate ?? 192, (fraction) =>
    opts.onProgress?.(0.05 + fraction * 0.95),
  );
}

export function extFor(format: AudioFormat): string {
  return FORMATS[format].ext;
}

export function mimeFor(format: AudioFormat): string {
  return FORMATS[format].mime;
}
