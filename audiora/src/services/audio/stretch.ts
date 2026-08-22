export type StretchQuality = 'fast' | 'balanced' | 'high';
import { versioned } from '../assetVersion';

/**
 * WSOLA time stretching, off the main thread.
 *
 * The algorithm lives in public/workers/stretch-worker.js. It is run in a
 * worker because aligning grains is genuinely expensive — on a long track it
 * would otherwise freeze the page for seconds.
 */
export function timeStretch(
  channels: Float32Array[],
  speed: number,
  sampleRate: number,
  quality: StretchQuality,
  onProgress?: (percent: number) => void,
): Promise<Float32Array[]> {
  return new Promise((resolve, reject) => {
    if (typeof Worker === 'undefined') {
      reject(new Error('This browser does not support Web Workers.'));
      return;
    }

    const worker = new Worker(versioned('/workers/stretch-worker.js'));
    const payload = channels.map((channel) => {
      const copy = new Float32Array(channel.length);
      copy.set(channel);
      return copy;
    });

    worker.onmessage = (event: MessageEvent) => {
      const data = event.data;
      if (data.type === 'progress') {
        onProgress?.(data.value as number);
      } else if (data.type === 'done') {
        worker.terminate();
        resolve(data.channels as Float32Array[]);
      } else if (data.type === 'error') {
        worker.terminate();
        reject(new Error(data.message || 'Time stretching failed.'));
      }
    };

    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || 'Time stretching failed to start.'));
    };

    worker.postMessage(
      { cmd: 'stretch', channels: payload, speed, sampleRate, quality },
      payload.map((channel) => channel.buffer),
    );
  });
}
