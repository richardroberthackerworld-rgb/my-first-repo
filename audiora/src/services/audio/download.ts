import type { AudioResult } from '@/types/audio';
import { createZip } from '@/utils/zip';
import { nextId } from './context';

/**
 * Real downloads to the user's device.
 *
 * Every result the app produces is a Blob held in this tab. Downloading is an
 * object-URL anchor click — the file goes straight to the browser's download
 * folder. Nothing is uploaded and nothing is stored on a server.
 */

/** Strip characters that are illegal in filenames on Windows/macOS/Linux. */
export function safeFilename(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

export function baseName(filename: string): string {
  const i = filename.lastIndexOf('.');
  return safeFilename(i > 0 ? filename.slice(0, i) : filename);
}

/** `7audio-vocals-removed.mp3` style naming. */
export function brandFilename(suffix: string, ext: string, source?: string): string {
  const stem = source ? `${baseName(source)}-${suffix}` : `7audio-${suffix}`;
  return `${safeFilename(stem)}.${ext}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Give the browser a moment to start the transfer before releasing the URL.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function downloadResult(result: AudioResult): void {
  downloadBlob(result.blob, result.filename);
}

/** Several files at once, bundled into a single .zip. */
export async function downloadAll(results: AudioResult[], zipName: string): Promise<void> {
  if (results.length === 0) return;
  if (results.length === 1) return downloadResult(results[0]);
  const zip = await createZip(results.map((r) => ({ name: r.filename, blob: r.blob })));
  downloadBlob(zip, safeFilename(zipName.endsWith('.zip') ? zipName : `${zipName}.zip`));
}

/** Wrap a produced Blob as a previewable, downloadable result. */
export function makeResult(params: {
  label: string;
  blob: Blob;
  filename: string;
  mime: string;
  duration: number;
}): AudioResult {
  return {
    id: nextId('r'),
    label: params.label,
    blob: params.blob,
    filename: params.filename,
    mime: params.mime,
    duration: params.duration,
    size: params.blob.size,
    url: URL.createObjectURL(params.blob),
  };
}

export function revokeResult(result: AudioResult): void {
  URL.revokeObjectURL(result.url);
}

export function revokeResults(results: AudioResult[]): void {
  results.forEach(revokeResult);
}
