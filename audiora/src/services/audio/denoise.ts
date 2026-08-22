import type { Capability, ProcessProgress } from '@/types/audio';
import { bufferFromChannels } from './dsp';
import { versioned } from '../assetVersion';

/**
 * Noise reduction — spectral gating in a Web Worker on this machine.
 * See public/workers/denoise-worker.js for the algorithm.
 */

export type NoiseType = 'general' | 'hiss' | 'hum' | 'wind';
export type NoiseStrength = 'light' | 'balanced' | 'strong';

export interface DenoiseOptions {
  /** 0..1 — how far the noise floor is pulled down. */
  reduction: number;
  strength: NoiseStrength;
  noiseType: NoiseType;
  preserveVoice: boolean;
}

export const DEFAULT_DENOISE: DenoiseOptions = {
  reduction: 0.75,
  strength: 'balanced',
  noiseType: 'general',
  preserveVoice: true,
};

export function denoiseCapability(): Capability {
  if (typeof Worker === 'undefined') {
    return { available: false, site: 'local', reason: 'This browser does not support Web Workers.' };
  }
  return { available: true, site: 'local' };
}

export function denoise(
  buffer: AudioBuffer,
  options: DenoiseOptions,
  onProgress: (p: ProcessProgress) => void,
): Promise<AudioBuffer> {
  const cap = denoiseCapability();
  if (!cap.available) return Promise.reject(new Error(cap.reason));

  return new Promise((resolve, reject) => {
    const worker = new Worker(versioned('/workers/denoise-worker.js'));
    const channels: Float32Array[] = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c).slice());

    onProgress({ stage: 'analyzing', percent: 0, message: 'Please wait while processing…' });

    worker.onmessage = (event: MessageEvent) => {
      const data = event.data;
      if (data.type === 'progress') {
        onProgress({
          stage: data.value < 25 ? 'analyzing' : 'processing',
          percent: data.value,
          message: 'Please wait while processing…',
        });
      } else if (data.type === 'done') {
        worker.terminate();
        onProgress({ stage: 'finalizing', percent: 100, message: 'Please wait while processing…' });
        resolve(bufferFromChannels(data.channels as Float32Array[], buffer.sampleRate));
      } else if (data.type === 'error') {
        worker.terminate();
        reject(new Error(data.message || 'noise removal failed'));
      }
    };

    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || 'noise removal failed to start'));
    };

    worker.postMessage(
      { cmd: 'denoise', channels, sampleRate: buffer.sampleRate, options },
      channels.map((c) => c.buffer),
    );
  });
}
