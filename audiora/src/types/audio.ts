/** Shared audio types. Kept free of any UI or React concern. */

export type AudioFormat = 'mp3' | 'wav' | 'flac' | 'm4a' | 'ogg' | 'aac';

export type SampleRateOption = 'source' | 44100 | 48000 | 32000 | 22050;
export type ChannelsOption = 'source' | 1 | 2;

/** Metadata we can show before/without decoding the whole file. */
export interface AudioFileMeta {
  id: string;
  name: string;
  size: number;
  type: string;
  format: string;
  /** Seconds. Available once decoded. */
  duration: number | null;
  sampleRate: number | null;
  channels: number | null;
}

/** A file the user picked, plus its decoded buffer once ready. */
export interface LoadedAudio {
  meta: AudioFileMeta;
  file: File;
  buffer: AudioBuffer | null;
  /** Downsampled peak envelope for waveform drawing (‑1..1 pairs). */
  peaks: Float32Array | null;
  error: string | null;
  status: 'pending' | 'decoding' | 'ready' | 'error';
}

export interface ExportSettings {
  format: AudioFormat;
  /** kbps — only meaningful for lossy formats. */
  quality: number;
  sampleRate: SampleRateOption;
  channels: ChannelsOption;
  normalize: boolean;
  fadeIn: number;
  fadeOut: number;
}

/** Result of any processing operation — always a real, downloadable blob. */
export interface AudioResult {
  id: string;
  label: string;
  blob: Blob;
  filename: string;
  mime: string;
  duration: number;
  size: number;
  /** Object URL for preview playback. Revoke when discarding. */
  url: string;
}

export type ProcessStage =
  | 'idle'
  | 'reading'
  | 'decoding'
  | 'preparing-engine'
  | 'downloading-model'
  | 'analyzing'
  | 'processing'
  | 'encoding'
  | 'finalizing'
  | 'done'
  | 'error';

export interface ProcessProgress {
  stage: ProcessStage;
  /** 0..100, or null when the stage is indeterminate. */
  percent: number | null;
  message: string;
  /** Extra detail, e.g. "42.1 MB of 82.5 MB". */
  detail?: string;
}

/**
 * Where a piece of work actually runs. Surfaced in the UI so a user is never
 * misled about whether their file leaves the device.
 */
export type ExecutionSite =
  | 'local' /* Web Audio / DSP in this tab. Nothing is sent anywhere. */
  | 'local-ai' /* AI model runs in this tab; the model file is downloaded once. */
  | 'remote'; /* Would require a server. Not enabled unless configured. */

export interface Capability {
  available: boolean;
  site: ExecutionSite;
  /** Shown verbatim in the UI when `available` is false. */
  reason?: string;
}

/**
 * Stems a separation model can produce. `guitar` and `piano` only exist on the
 * 6-source model — the UI must never offer them for the 4-source one.
 */
export type StemName = 'vocals' | 'drums' | 'bass' | 'other' | 'guitar' | 'piano';

export interface CutSegment {
  id: string;
  start: number;
  end: number;
}
