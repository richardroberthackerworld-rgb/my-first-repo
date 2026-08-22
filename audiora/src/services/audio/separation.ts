import type { Capability, ProcessProgress, StemName } from '@/types/audio';
import { bufferFromChannels, mixBuffers, resampleBuffer } from './dsp';
import { versioned } from '../assetVersion';

/**
 * AI source separation.
 *
 * Two models are supported and the caller picks between them:
 *
 *   'standard' — 4 sources: vocals, drums, bass, other.
 *   'high'     — 6 sources: adds guitar and piano, at higher quality.
 *
 * The two exports have different graph contracts, so each has its own worker.
 * This module normalises both down to the same result shape, which is why
 * nothing above it has to care which model ran.
 */

const MODEL_SAMPLE_RATE = 44100;

export type SeparationModel = 'standard' | 'high';

export interface ModelInfo {
  id: SeparationModel;
  label: string;
  hint: string;
  worker: string;
  cacheName: string;
  /** Exactly what this model can produce. The UI must not offer more. */
  stems: StemName[];
  approxBytes: number;
}

export const MODELS: Record<SeparationModel, ModelInfo> = {
  standard: {
    id: 'standard',
    label: 'Standard',
    hint: '4 stems — vocals, drums, bass, other',
    worker: versioned('/workers/separation-worker.js'),
    cacheName: '7by-ai-model-v1',
    stems: ['vocals', 'drums', 'bass', 'other'],
    approxBytes: 181_000_000,
  },
  high: {
    id: 'high',
    label: 'High quality',
    hint: '6 stems — adds guitar and piano',
    worker: versioned('/workers/separation6-worker.js'),
    cacheName: '7audio-model-6s-v1',
    stems: ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'],
    approxBytes: 285_000_000,
  },
};

export const STEM_LABELS: Record<StemName, string> = {
  vocals: 'Vocals',
  drums: 'Drums',
  bass: 'Bass',
  guitar: 'Guitar',
  piano: 'Piano',
  other: 'Other Instruments',
};

export interface SeparationResult {
  sampleRate: number;
  /** Only the stems the chosen model actually produced. */
  stems: Partial<Record<StemName, AudioBuffer>>;
  vocals: AudioBuffer;
  instrumental: AudioBuffer;
}

export function separationCapability(): Capability {
  if (typeof Worker === 'undefined') {
    return { available: false, site: 'local-ai', reason: 'Audio processing is not supported in this browser.' };
  }
  if (typeof WebAssembly === 'undefined') {
    return { available: false, site: 'local-ai', reason: 'Audio processing is not supported in this browser.' };
  }
  return { available: true, site: 'local-ai' };
}

/* ------------------------------------------------------------- instances -- */

const workers = new Map<SeparationModel, Worker>();
const ready = new Set<SeparationModel>();

function spawn(model: SeparationModel): Worker {
  let worker = workers.get(model);
  if (!worker) {
    worker = new Worker(MODELS[model].worker);
    workers.set(model, worker);
  }
  return worker;
}

export function releaseEngine(): void {
  workers.forEach((worker) => worker.terminate());
  workers.clear();
  ready.clear();
}

export function isEngineReady(model: SeparationModel = 'standard'): boolean {
  return ready.has(model);
}

/** Whether this model is already stored, so the UI can skip the "first run" note. */
export async function isModelCached(model: SeparationModel = 'standard'): Promise<boolean> {
  try {
    const cache = await caches.open(MODELS[model].cacheName);
    const keys = await cache.keys();
    return keys.length > 0;
  } catch {
    return false;
  }
}

export async function anyModelCached(): Promise<boolean> {
  const results = await Promise.all((Object.keys(MODELS) as SeparationModel[]).map((m) => isModelCached(m)));
  return results.some(Boolean);
}

/* ----------------------------------------------------------------- load --- */

/**
 * How long the engine may go completely silent before we give up.
 *
 * Downloading emits constant progress, so this is really a guard on the
 * start-up step that follows it. Larger models need noticeably more memory to
 * start, and on some devices that step never finishes — without this the user
 * would sit in front of a spinner indefinitely.
 */
const ENGINE_STALL_MS = 5 * 60 * 1000;

function loadEngine(worker: Worker, model: SeparationModel, report: (p: ProcessProgress) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    let stallTimer = 0;

    const done = () => {
      window.clearTimeout(stallTimer);
      worker.removeEventListener('message', onMessage);
    };

    const armStallTimer = () => {
      window.clearTimeout(stallTimer);
      stallTimer = window.setTimeout(() => {
        done();
        // Drop the worker so a retry starts from scratch.
        worker.terminate();
        workers.delete(model);
        ready.delete(model);
        reject(new Error(`engine start timed out for the "${model}" model`));
      }, ENGINE_STALL_MS);
    };

    const onMessage = (event: MessageEvent) => {
      armStallTimer();
      const data = event.data;
      switch (data.type) {
        case 'status':
          report({ stage: 'preparing-engine', percent: null, message: 'Please wait while processing…' });
          break;
        case 'dl': {
          // Deliberately not described as a model download — the user just
          // needs to know the first run takes longer.
          const percent = data.total ? Math.round((data.got / data.total) * 100) : null;
          report({
            stage: 'downloading-model',
            percent,
            message: data.cached
              ? 'Please wait while processing…'
              : 'Please wait while processing. The first time may take a little longer depending on your internet connection.',
          });
          break;
        }
        case 'loaded':
          done();
          ready.add(model);
          report({ stage: 'preparing-engine', percent: 100, message: 'Please wait while processing…' });
          resolve();
          break;
        case 'error':
          done();
          reject(new Error(data.message || 'engine failed to start'));
          break;
      }
    };
    worker.addEventListener('message', onMessage);
    armStallTimer();
    worker.postMessage({ cmd: 'load' });
  });
}

/* ------------------------------------------------------------------ run --- */

interface RawStems {
  [name: string]: { L: Float32Array; R: Float32Array };
}

function runStandard(worker: Worker, left: Float32Array, right: Float32Array, full: boolean, report: (p: ProcessProgress) => void): Promise<RawStems> {
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (data.type === 'sep') {
        report({ stage: 'processing', percent: data.value, message: 'Please wait while processing…' });
      } else if (data.type === 'done') {
        worker.removeEventListener('message', onMessage);
        const stems: RawStems = { vocals: { L: data.v0, R: data.v1 } };
        if (data.full) {
          stems.drums = { L: data.d0, R: data.d1 };
          stems.bass = { L: data.b0, R: data.b1 };
          stems.other = { L: data.o0, R: data.o1 };
        }
        resolve(stems);
      } else if (data.type === 'error') {
        worker.removeEventListener('message', onMessage);
        reject(new Error(data.message || 'separation failed'));
      }
    };
    worker.addEventListener('message', onMessage);
    worker.postMessage({ cmd: 'sep', L: left, R: right, full }, [left.buffer, right.buffer]);
  });
}

function runHigh(worker: Worker, left: Float32Array, right: Float32Array, wanted: StemName[] | null, report: (p: ProcessProgress) => void): Promise<RawStems> {
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (data.type === 'sep') {
        report({ stage: 'processing', percent: data.value, message: 'Please wait while processing…' });
      } else if (data.type === 'done') {
        worker.removeEventListener('message', onMessage);
        resolve(data.stems as RawStems);
      } else if (data.type === 'error') {
        worker.removeEventListener('message', onMessage);
        reject(new Error(data.message || 'separation failed'));
      }
    };
    worker.addEventListener('message', onMessage);
    worker.postMessage({ cmd: 'sep', L: left, R: right, wanted }, [left.buffer, right.buffer]);
  });
}

export interface SeparateOptions {
  model: SeparationModel;
  /** 'vocals' asks only for what a vocal split needs; 'stems' asks for all. */
  mode: 'vocals' | 'stems';
}

export async function separate(
  buffer: AudioBuffer,
  options: SeparateOptions,
  onProgress: (p: ProcessProgress) => void,
): Promise<SeparationResult> {
  const capability = separationCapability();
  if (!capability.available) throw new Error(capability.reason ?? 'unavailable');

  const info = MODELS[options.model];
  onProgress({ stage: 'analyzing', percent: null, message: 'Please wait while processing…' });

  // Both graphs are trained at 44.1 kHz stereo — match it exactly.
  const prepared = await resampleBuffer(buffer, MODEL_SAMPLE_RATE);
  const left = new Float32Array(prepared.length);
  left.set(prepared.getChannelData(0));
  const right = new Float32Array(prepared.length);
  right.set(prepared.getChannelData(prepared.numberOfChannels > 1 ? 1 : 0));

  const worker = spawn(options.model);
  if (!ready.has(options.model)) await loadEngine(worker, options.model, onProgress);

  const wantAll = options.mode === 'stems';
  const raw =
    options.model === 'standard'
      ? await runStandard(worker, left, right, wantAll, onProgress)
      : await runHigh(worker, left, right, wantAll ? info.stems : ['vocals'], onProgress);

  onProgress({ stage: 'finalizing', percent: null, message: 'Please wait while processing…' });

  const stems: Partial<Record<StemName, AudioBuffer>> = {};
  for (const [name, channels] of Object.entries(raw)) {
    stems[name as StemName] = bufferFromChannels([channels.L, channels.R], MODEL_SAMPLE_RATE);
  }

  const vocals = stems.vocals;
  if (!vocals) throw new Error('separation returned no vocal stem');

  // Prefer summing the real non-vocal stems; fall back to subtracting vocals
  // from the mix when only the vocal stem was requested.
  const others = (Object.keys(stems) as StemName[]).filter((name) => name !== 'vocals');
  const instrumental =
    others.length > 0
      ? mixBuffers(others.map((name) => stems[name] as AudioBuffer))
      : bufferFromChannels(
          [
            subtract(prepared.getChannelData(0), vocals.getChannelData(0)),
            subtract(channelOrFirst(prepared, 1), vocals.getChannelData(1)),
          ],
          MODEL_SAMPLE_RATE,
        );

  return { sampleRate: MODEL_SAMPLE_RATE, stems, vocals, instrumental };
}

function channelOrFirst(buffer: AudioBuffer, index: number): Float32Array {
  return buffer.getChannelData(Math.min(index, buffer.numberOfChannels - 1));
}

function subtract(a: Float32Array, b: Float32Array): Float32Array {
  const n = Math.min(a.length, b.length);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = a[i] - b[i];
  return out;
}
