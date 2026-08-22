import { useCallback, useEffect, useRef, useState } from 'react';
import type { LoadedAudio, ProcessProgress } from '@/types/audio';
import { loadAudioFile, metaFromFile, validateFile } from '@/services/audio';

/**
 * Owns the user's chosen files for a tool page: validation, decoding, object
 * URLs for preview, ordering and cleanup. Object URLs are revoked when a file
 * is removed or the page unmounts, so nothing leaks.
 */
export function useAudioFiles({ multiple = false }: { multiple?: boolean } = {}) {
  const [files, setFiles] = useState<LoadedAudio[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [rejected, setRejected] = useState<string[]>([]);
  const urlsRef = useRef<Record<string, string>>({});

  useEffect(() => {
    urlsRef.current = urls;
  }, [urls]);

  useEffect(() => {
    const map = urlsRef;
    return () => {
      Object.values(map.current).forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const addFiles = useCallback(
    async (incoming: File[]) => {
      const problems: string[] = [];
      const accepted: File[] = [];

      for (const file of incoming) {
        try {
          validateFile(file);
          accepted.push(file);
        } catch (error) {
          problems.push(error instanceof Error ? error.message : `${file.name} could not be read.`);
        }
      }
      setRejected(problems);
      if (accepted.length === 0) return [] as LoadedAudio[];

      // Show the rows immediately in a decoding state, then fill them in.
      const pending: LoadedAudio[] = accepted.map((file) => ({
        meta: metaFromFile(file),
        file,
        buffer: null,
        peaks: null,
        error: null,
        status: 'decoding',
      }));

      setFiles((current) => (multiple ? [...current, ...pending] : pending));

      const nextUrls: Record<string, string> = {};
      pending.forEach((item) => {
        nextUrls[item.meta.id] = URL.createObjectURL(item.file);
      });
      setUrls((current) => {
        if (!multiple) {
          Object.values(current).forEach((url) => URL.revokeObjectURL(url));
          return nextUrls;
        }
        return { ...current, ...nextUrls };
      });

      const loaded: LoadedAudio[] = [];
      for (let i = 0; i < accepted.length; i++) {
        const result = await loadAudioFile(accepted[i]);
        // Keep the id assigned above so the object URL still matches.
        result.meta.id = pending[i].meta.id;
        loaded.push(result);
        setFiles((current) => current.map((item) => (item.meta.id === result.meta.id ? result : item)));
      }
      return loaded;
    },
    [multiple],
  );

  const remove = useCallback((id: string) => {
    setFiles((current) => current.filter((item) => item.meta.id !== id));
    setUrls((current) => {
      const url = current[id];
      if (url) URL.revokeObjectURL(url);
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setFiles([]);
    setRejected([]);
    setUrls((current) => {
      Object.values(current).forEach((url) => URL.revokeObjectURL(url));
      return {};
    });
  }, []);

  const reorder = useCallback((from: number, to: number) => {
    setFiles((current) => {
      if (to < 0 || to >= current.length) return current;
      const next = current.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  const ready = files.filter((file) => file.status === 'ready');
  const first = files[0] ?? null;

  return { files, ready, first, urls, rejected, addFiles, remove, clear, reorder, setRejected };
}

/** Progress + error state shared by every processing action. */
export function useProcessing() {
  const [progress, setProgress] = useState<ProcessProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = progress !== null && progress.stage !== 'done' && progress.stage !== 'error';

  const run = useCallback(async <T,>(task: (report: (p: ProcessProgress) => void) => Promise<T>): Promise<T | null> => {
    setError(null);
    setProgress({ stage: 'reading', percent: null, message: 'Getting started' });
    try {
      const result = await task(setProgress);
      setProgress({ stage: 'done', percent: 100, message: 'Done' });
      return result;
    } catch (err) {
      // The UI shows a plain, friendly message. The real cause goes to the
      // console so it can be diagnosed without being shown to the user.
      console.error('[audiora] processing failed', err);
      const message = err instanceof Error ? err.message : 'Something went wrong.';
      setError(message);
      setProgress({ stage: 'error', percent: null, message });
      return null;
    }
  }, []);

  const reset = useCallback(() => {
    setProgress(null);
    setError(null);
  }, []);

  return { progress, error, busy, run, reset, setError };
}
