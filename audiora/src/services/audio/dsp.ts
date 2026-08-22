import { audioCtx } from './context';
import { timeStretch, type StretchQuality } from './stretch';

/**
 * Buffer-level DSP. Every function here is real signal processing running on
 * the user's machine — no network, no server, no placeholder.
 */

export function createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer {
  return audioCtx().createBuffer(Math.max(1, channels), Math.max(1, length), sampleRate);
}

export function cloneBuffer(buffer: AudioBuffer): AudioBuffer {
  const out = createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const copy = new Float32Array(buffer.length);
    copy.set(buffer.getChannelData(c));
    out.copyToChannel(copy, c);
  }
  return out;
}

/**
 * Copy samples into a freshly allocated channel array.
 *
 * TypeScript 5.7+ types `Float32Array` (and anything from `.slice()` /
 * `.subarray()`) as backed by `ArrayBufferLike`, which `copyToChannel` will not
 * accept. Allocating by length gives a plain `ArrayBuffer` and also detaches
 * the result from any worker-transferred memory.
 */
function channelCopy(source: ArrayLike<number>, length = source.length): Float32Array<ArrayBuffer> {
  const out = new Float32Array(length);
  out.set(length === source.length ? source : Array.prototype.slice.call(source, 0, length));
  return out;
}

/** Build an AudioBuffer from raw per-channel sample arrays. */
export function bufferFromChannels(channels: ArrayLike<number>[], sampleRate: number): AudioBuffer {
  const out = createBuffer(channels.length, channels[0].length, sampleRate);
  channels.forEach((data, i) => out.copyToChannel(channelCopy(data), i));
  return out;
}

/* ------------------------------------------------------------------ cut --- */

/** Extract [start, end] in seconds. */
export function sliceBuffer(buffer: AudioBuffer, start: number, end: number): AudioBuffer {
  const sr = buffer.sampleRate;
  const s = Math.max(0, Math.floor(start * sr));
  const e = Math.min(buffer.length, Math.ceil(end * sr));
  const len = Math.max(1, e - s);
  const out = createBuffer(buffer.numberOfChannels, len, sr);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const copy = new Float32Array(len);
    copy.set(buffer.getChannelData(c).subarray(s, s + len));
    out.copyToChannel(copy, c);
  }
  return out;
}

/** Remove [start, end] and stitch what remains (used by "cut out" mode). */
export function removeRange(buffer: AudioBuffer, start: number, end: number): AudioBuffer {
  const head = start > 0 ? sliceBuffer(buffer, 0, start) : null;
  const tail = end < buffer.duration ? sliceBuffer(buffer, end, buffer.duration) : null;
  const parts = [head, tail].filter(Boolean) as AudioBuffer[];
  if (parts.length === 0) return createBuffer(buffer.numberOfChannels, 1, buffer.sampleRate);
  return concatBuffers(parts, 0);
}

/* ----------------------------------------------------------------- join --- */

/**
 * Concatenate buffers, optionally crossfading `crossfade` seconds between
 * neighbours with an equal-power curve (constant perceived loudness).
 */
export function concatBuffers(buffers: AudioBuffer[], crossfade = 0): AudioBuffer {
  if (buffers.length === 0) throw new Error('Nothing to join.');
  if (buffers.length === 1) return cloneBuffer(buffers[0]);

  const sr = buffers[0].sampleRate;
  const channels = Math.max(...buffers.map((b) => b.numberOfChannels));
  const xf = Math.max(0, Math.min(crossfade, ...buffers.map((b) => b.duration / 2)));
  const xfSamples = Math.floor(xf * sr);

  const total = buffers.reduce((sum, b) => sum + b.length, 0) - xfSamples * (buffers.length - 1);
  const out = createBuffer(channels, Math.max(1, total), sr);
  const outData: Float32Array[] = [];
  for (let c = 0; c < channels; c++) outData.push(out.getChannelData(c));

  let cursor = 0;
  buffers.forEach((buf, index) => {
    const len = buf.length;
    for (let c = 0; c < channels; c++) {
      const src = buf.getChannelData(Math.min(c, buf.numberOfChannels - 1));
      const dst = outData[c];
      for (let i = 0; i < len; i++) {
        const pos = cursor + i;
        if (pos >= dst.length) break;
        if (index > 0 && i < xfSamples) {
          // Equal-power crossfade: incoming rises as the tail already written falls.
          const t = i / xfSamples;
          const gIn = Math.sin((t * Math.PI) / 2);
          const gOut = Math.cos((t * Math.PI) / 2);
          dst[pos] = dst[pos] * gOut + src[i] * gIn;
        } else {
          dst[pos] = src[i];
        }
      }
    }
    cursor += len - (index < buffers.length - 1 ? xfSamples : 0);
  });

  return out;
}

/* ---------------------------------------------------------------- gain ---- */

/** Linear fade in/out, in seconds, applied in place. */
export function applyFades(buffer: AudioBuffer, fadeIn: number, fadeOut: number): AudioBuffer {
  const sr = buffer.sampleRate;
  const inN = Math.min(buffer.length, Math.floor(fadeIn * sr));
  const outN = Math.min(buffer.length, Math.floor(fadeOut * sr));
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < inN; i++) d[i] *= i / inN;
    for (let i = 0; i < outN; i++) d[buffer.length - 1 - i] *= i / outN;
  }
  return buffer;
}

export function peakOf(buffer: AudioBuffer): number {
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const v = Math.abs(d[i]);
      if (v > peak) peak = v;
    }
  }
  return peak;
}

/** Peak-normalise to `targetDb` dBFS (default −1 dB). In place. */
export function normalizeBuffer(buffer: AudioBuffer, targetDb = -1): AudioBuffer {
  const peak = peakOf(buffer);
  if (peak < 1e-6) return buffer;
  const target = Math.pow(10, targetDb / 20);
  const gain = target / peak;
  if (Math.abs(gain - 1) < 1e-4) return buffer;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] *= gain;
  }
  return buffer;
}

/** Sum of two buffers, sample for sample (used to rebuild an instrumental). */
export function mixBuffers(buffers: AudioBuffer[]): AudioBuffer {
  const sr = buffers[0].sampleRate;
  const channels = Math.max(...buffers.map((b) => b.numberOfChannels));
  const length = Math.max(...buffers.map((b) => b.length));
  const out = createBuffer(channels, length, sr);
  for (let c = 0; c < channels; c++) {
    const dst = out.getChannelData(c);
    for (const b of buffers) {
      const src = b.getChannelData(Math.min(c, b.numberOfChannels - 1));
      for (let i = 0; i < src.length; i++) dst[i] += src[i];
    }
  }
  return out;
}

/* --------------------------------------------------------- rate/channels -- */

const MIN_RATE = 8000;
const MAX_RATE = 96000;

/** True resample through an OfflineAudioContext running at the target rate. */
export async function resampleBuffer(buffer: AudioBuffer, targetRate: number): Promise<AudioBuffer> {
  if (targetRate === buffer.sampleRate) return buffer;
  if (targetRate < MIN_RATE || targetRate > MAX_RATE) {
    throw new Error(`Sample rate must be between ${MIN_RATE} and ${MAX_RATE} Hz.`);
  }
  const frames = Math.max(1, Math.ceil(buffer.duration * targetRate));
  const off = new OfflineAudioContext(buffer.numberOfChannels, frames, targetRate);
  const src = off.createBufferSource();
  src.buffer = buffer;
  src.connect(off.destination);
  src.start();
  return off.startRendering();
}

/** Down-mix to mono or duplicate to stereo. */
export function setChannelCount(buffer: AudioBuffer, target: 1 | 2): AudioBuffer {
  if (buffer.numberOfChannels === target) return buffer;
  const out = createBuffer(target, buffer.length, buffer.sampleRate);
  if (target === 1) {
    const dst = out.getChannelData(0);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const src = buffer.getChannelData(c);
      for (let i = 0; i < src.length; i++) dst[i] += src[i] / buffer.numberOfChannels;
    }
  } else {
    const src = buffer.getChannelData(0);
    out.copyToChannel(channelCopy(src), 0);
    out.copyToChannel(channelCopy(src), 1);
  }
  return out;
}

/* ---------------------------------------------------------------- pitch --- */

export type { StretchQuality };

export interface PitchOptions {
  /** −12 … +12 */
  semitones: number;
  /** 1 = original speed. Independent of pitch. */
  tempo?: number;
  quality?: StretchQuality;
  /** 0..100, reported while the (slow) stretch runs in its worker. */
  onProgress?: (percent: number) => void;
}

/**
 * Pitch shift without changing duration (unless `tempo` is also set).
 *
 * Stretch by tempo/ratio, then replay at `ratio` — the replay raises pitch by
 * `ratio` and undoes the stretch, leaving duration at original/tempo.
 *
 * The stretch runs in a worker (it is the expensive half); the resample uses
 * OfflineAudioContext, which only exists on the main thread and is fast.
 */
export async function pitchShift(buffer: AudioBuffer, opts: PitchOptions): Promise<AudioBuffer> {
  const { semitones, tempo = 1, quality = 'balanced', onProgress } = opts;
  const ratio = Math.pow(2, semitones / 12);
  if (Math.abs(semitones) < 1e-3 && Math.abs(tempo - 1) < 1e-3) return cloneBuffer(buffer);

  const sr = buffer.sampleRate;
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));

  const stretched = await timeStretch(channels, tempo / ratio, sr, quality, onProgress);
  const stretchedBuffer = bufferFromChannels(stretched, sr);
  if (Math.abs(ratio - 1) < 1e-4) return stretchedBuffer;

  const frames = Math.max(1, Math.ceil(stretchedBuffer.length / ratio));
  const off = new OfflineAudioContext(stretchedBuffer.numberOfChannels, frames, sr);
  const src = off.createBufferSource();
  src.buffer = stretchedBuffer;
  src.playbackRate.value = ratio;
  src.connect(off.destination);
  src.start();
  return off.startRendering();
}

/** Tempo-only change (pitch untouched). */
export async function changeTempo(buffer: AudioBuffer, tempo: number, quality: StretchQuality = 'balanced'): Promise<AudioBuffer> {
  return pitchShift(buffer, { semitones: 0, tempo, quality });
}

/* -------------------------------------------------------------- silence --- */

/** Trim leading/trailing silence below `thresholdDb`. Used by Song Joiner. */
export function trimSilence(buffer: AudioBuffer, thresholdDb = -40): AudioBuffer {
  const thr = Math.pow(10, thresholdDb / 20);
  const len = buffer.length;
  const chans: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c));

  const loudAt = (i: number) => {
    for (let c = 0; c < chans.length; c++) if (Math.abs(chans[c][i]) > thr) return true;
    return false;
  };

  let start = 0;
  while (start < len && !loudAt(start)) start++;
  let end = len - 1;
  while (end > start && !loudAt(end)) end--;
  if (start >= end) return cloneBuffer(buffer);

  return sliceBuffer(buffer, start / buffer.sampleRate, (end + 1) / buffer.sampleRate);
}
