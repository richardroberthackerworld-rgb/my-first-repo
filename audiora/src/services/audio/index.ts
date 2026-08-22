import type {
  AudioResult,
  CutSegment,
  ExportSettings,
  ProcessProgress,
  StemName,
} from '@/types/audio';
import { encodeBuffer, extFor, mimeFor, nearestMp3Rate, mp3RateSupported } from './encode';
import {
  applyFades,
  cloneBuffer,
  concatBuffers,
  normalizeBuffer,
  pitchShift,
  resampleBuffer,
  setChannelCount,
  sliceBuffer,
  trimSilence,
  type PitchOptions,
} from './dsp';
import { brandFilename, makeResult } from './download';
import { separate, STEM_LABELS, type SeparationModel } from './separation';
import { denoise, type DenoiseOptions } from './denoise';
import { formatTimePrecise } from './context';

/**
 * ==========================================================================
 * 7 Audio processing service.
 *
 * This is the single seam between the UI and the actual processing. Pages call
 * these functions and never touch the audio engine, workers or encoders
 * directly, so an implementation can be swapped without any page being
 * rewritten.
 * ==========================================================================
 */

export * from './context';
export * from './encode';
export * from './download';
export * from './dsp';
export {
  separationCapability,
  isModelCached,
  anyModelCached,
  isEngineReady,
  releaseEngine,
  MODELS,
  STEM_LABELS,
} from './separation';
export type { SeparationModel, ModelInfo } from './separation';
export { preloadTranscoder, isTranscoderReady } from './transcode';
export { denoiseCapability, DEFAULT_DENOISE } from './denoise';
export type { DenoiseOptions, NoiseType, NoiseStrength } from './denoise';

export const DEFAULT_EXPORT: ExportSettings = {
  format: 'mp3',
  quality: 320,
  sampleRate: 'source',
  channels: 'source',
  normalize: false,
  fadeIn: 0,
  fadeOut: 0,
};

const noop = () => {};

/* ------------------------------------------------------------- pipeline --- */

/**
 * Apply the shared export settings (rate, channels, normalise, fades) and
 * encode. Every tool funnels its final buffer through here, which is why the
 * export controls behave identically everywhere.
 */
export async function exportBuffer(
  buffer: AudioBuffer,
  settings: ExportSettings,
  options: { label: string; filenameSuffix: string; onProgress?: (p: ProcessProgress) => void },
): Promise<AudioResult> {
  const report = options.onProgress ?? noop;
  let out = buffer;

  if (settings.channels !== 'source') {
    out = setChannelCount(out, settings.channels);
  }

  if (settings.sampleRate !== 'source' && settings.sampleRate !== out.sampleRate) {
    report({ stage: 'processing', percent: null, message: 'Please wait while processing…' });
    out = await resampleBuffer(out, settings.sampleRate);
  }

  // MP3 only accepts a fixed set of rates; move to the nearest rather than
  // failing at the very last step.
  if (settings.format === 'mp3' && !mp3RateSupported(out.sampleRate)) {
    out = await resampleBuffer(out, nearestMp3Rate(out.sampleRate));
  }

  if (settings.normalize || settings.fadeIn > 0 || settings.fadeOut > 0) {
    out = out === buffer ? cloneBuffer(out) : out;
    if (settings.fadeIn > 0 || settings.fadeOut > 0) applyFades(out, settings.fadeIn, settings.fadeOut);
    if (settings.normalize) normalizeBuffer(out);
  }

  report({ stage: 'encoding', percent: 0, message: 'Please wait while processing…' });
  const blob = await encodeBuffer(out, {
    format: settings.format,
    bitrate: settings.quality,
    bitDepth: 24,
    onProgress: (p) =>
      report({ stage: 'encoding', percent: Math.round(p * 100), message: 'Please wait while processing…' }),
  });

  return makeResult({
    label: options.label,
    blob,
    filename: brandFilename(options.filenameSuffix, extFor(settings.format)),
    mime: mimeFor(settings.format),
    duration: out.duration,
  });
}

/* ------------------------------------------------------------- converter -- */

export async function convertAudio(
  buffer: AudioBuffer,
  settings: ExportSettings,
  onProgress: (p: ProcessProgress) => void = noop,
): Promise<AudioResult> {
  return exportBuffer(buffer, settings, {
    label: 'Converted',
    filenameSuffix: 'converted',
    onProgress,
  });
}

/* ----------------------------------------------------------------- cutter -- */

export async function exportCuts(
  buffer: AudioBuffer,
  segments: CutSegment[],
  settings: ExportSettings,
  onProgress: (p: ProcessProgress) => void = noop,
): Promise<AudioResult[]> {
  if (segments.length === 0) throw new Error('Add at least one cut first.');
  const results: AudioResult[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    onProgress({
      stage: 'processing',
      percent: Math.round((i / segments.length) * 100),
      message: 'Please wait while processing…',
      detail: `${formatTimePrecise(seg.start)} – ${formatTimePrecise(seg.end)}`,
    });
    const piece = sliceBuffer(buffer, seg.start, seg.end);
    const result = await exportBuffer(piece, settings, {
      label: `Cut ${i + 1}`,
      filenameSuffix: segments.length > 1 ? `cut-${i + 1}` : 'cut',
    });
    results.push(result);
  }

  onProgress({ stage: 'done', percent: 100, message: 'Processing complete.' });
  return results;
}

/* ----------------------------------------------------------------- joiner -- */

export interface JoinOptions {
  crossfade: number;
  normalize: boolean;
  removeSilence: boolean;
  silenceThresholdDb: number;
}

export async function joinAudio(
  buffers: AudioBuffer[],
  options: JoinOptions,
  settings: ExportSettings,
  onProgress: (p: ProcessProgress) => void = noop,
): Promise<AudioResult> {
  if (buffers.length < 2) throw new Error('Add at least two files to join.');

  onProgress({ stage: 'processing', percent: 20, message: 'Please wait while processing…' });
  const prepared = options.removeSilence
    ? buffers.map((b) => trimSilence(b, options.silenceThresholdDb))
    : buffers;

  onProgress({ stage: 'processing', percent: 55, message: 'Please wait while processing…' });
  const joined = concatBuffers(prepared, options.crossfade);

  return exportBuffer(
    joined,
    { ...settings, normalize: settings.normalize || options.normalize },
    { label: 'Joined track', filenameSuffix: 'joined', onProgress },
  );
}

/* ------------------------------------------------------------ pitch shift -- */

export async function shiftPitch(
  buffer: AudioBuffer,
  pitch: PitchOptions,
  settings: ExportSettings,
  onProgress: (p: ProcessProgress) => void = noop,
): Promise<AudioResult> {
  onProgress({ stage: 'processing', percent: 0, message: 'Please wait while processing…' });
  const shifted = await pitchShift(buffer, {
    ...pitch,
    onProgress: (percent) => onProgress({ stage: 'processing', percent, message: 'Please wait while processing…' }),
  });
  return exportBuffer(shifted, settings, { label: 'Pitch shifted', filenameSuffix: 'pitched', onProgress });
}

/* ---------------------------------------------------------- vocal remover -- */

export interface VocalResult {
  instrumental: AudioResult;
  vocals: AudioResult;
}

/**
 * Separated audio kept as buffers for the session, so changing the export
 * format re-encodes what is already separated instead of separating again.
 */
export interface SeparatedSession {
  model: SeparationModel;
  sampleRate: number;
  stems: Partial<Record<StemName, AudioBuffer>>;
  vocals: AudioBuffer;
  instrumental: AudioBuffer;
}

export async function separateAudio(
  buffer: AudioBuffer,
  options: { model: SeparationModel; mode: 'vocals' | 'stems' },
  onProgress: (p: ProcessProgress) => void = noop,
): Promise<SeparatedSession> {
  const separated = await separate(buffer, options, onProgress);
  return {
    model: options.model,
    sampleRate: separated.sampleRate,
    stems: separated.stems,
    vocals: separated.vocals,
    instrumental: separated.instrumental,
  };
}

export async function removeVocals(
  buffer: AudioBuffer,
  settings: ExportSettings,
  onProgress: (p: ProcessProgress) => void = noop,
  model: SeparationModel = 'standard',
): Promise<VocalResult> {
  const separated = await separateAudio(buffer, { model, mode: 'vocals' }, onProgress);
  return encodeVocalResult(separated, settings, onProgress);
}

export async function encodeVocalResult(
  session: SeparatedSession,
  settings: ExportSettings,
  onProgress: (p: ProcessProgress) => void = noop,
): Promise<VocalResult> {
  onProgress({ stage: 'encoding', percent: 0, message: 'Please wait while processing…' });
  const instrumental = await exportBuffer(session.instrumental, settings, {
    label: 'Instrumental',
    filenameSuffix: 'vocals-removed',
  });

  onProgress({ stage: 'encoding', percent: 50, message: 'Please wait while processing…' });
  const vocals = await exportBuffer(session.vocals, settings, {
    label: 'Vocals (isolated)',
    filenameSuffix: 'vocals',
  });

  onProgress({ stage: 'done', percent: 100, message: 'Processing complete.' });
  return { instrumental, vocals };
}

/* ----------------------------------------------------------- stem splitter -- */

/** Display order. Only stems the model actually produced are rendered. */
export const STEM_ORDER: StemName[] = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'];

export function orderedStems(session: SeparatedSession): StemName[] {
  return STEM_ORDER.filter((name) => !!session.stems[name]);
}

export async function splitStems(
  buffer: AudioBuffer,
  settings: ExportSettings,
  onProgress: (p: ProcessProgress) => void = noop,
  model: SeparationModel = 'standard',
): Promise<AudioResult[]> {
  const session = await separateAudio(buffer, { model, mode: 'stems' }, onProgress);
  return encodeStems(session, settings, onProgress);
}

export async function encodeStems(
  session: SeparatedSession,
  settings: ExportSettings,
  onProgress: (p: ProcessProgress) => void = noop,
): Promise<AudioResult[]> {
  const names = orderedStems(session);
  if (names.length === 0) throw new Error('separation returned no stems');

  const results: AudioResult[] = [];
  for (let i = 0; i < names.length; i++) {
    const stem = names[i];
    onProgress({
      stage: 'encoding',
      percent: Math.round((i / names.length) * 100),
      message: 'Please wait while processing…',
    });
    results.push(
      await exportBuffer(session.stems[stem] as AudioBuffer, settings, {
        label: STEM_LABELS[stem],
        filenameSuffix: stem,
      }),
    );
  }

  onProgress({ stage: 'done', percent: 100, message: 'Processing complete.' });
  return results;
}

/* ---------------------------------------------------------- noise remover -- */

export async function reduceNoise(
  buffer: AudioBuffer,
  options: DenoiseOptions,
  settings: ExportSettings,
  onProgress: (p: ProcessProgress) => void = noop,
): Promise<AudioResult> {
  const cleaned = await denoise(buffer, options, onProgress);
  return exportBuffer(cleaned, settings, {
    label: 'Noise removed',
    filenameSuffix: 'noise-removed',
    onProgress,
  });
}
