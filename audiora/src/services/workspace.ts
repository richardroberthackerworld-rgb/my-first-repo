/**
 * Local workspace.
 *
 * Records what the user actually did in this browser — which tool, which file,
 * how long, how big — in IndexedDB. This is what the Dashboard and Profile
 * pages display, so those pages show real history rather than invented numbers.
 *
 * It never leaves the device and can be wiped from Settings.
 */

const DB_NAME = 'audiora';
const DB_VERSION = 1;
const STORE = 'activity';

export interface ActivityRecord {
  id?: number;
  toolId: string;
  toolName: string;
  fileName: string;
  /** Seconds of audio processed. */
  duration: number;
  /** Bytes produced. */
  outputSize: number;
  outputs: number;
  at: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser has no IndexedDB.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('at', 'at');
        store.createIndex('toolId', 'toolId');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open local storage.'));
  });
}

export async function recordActivity(record: Omit<ActivityRecord, 'id' | 'at'>): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).add({ ...record, at: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // History is a convenience, never a blocker for the actual work.
  }
}

export async function listActivity(limit = 50): Promise<ActivityRecord[]> {
  try {
    const db = await openDb();
    const records = await new Promise<ActivityRecord[]>((resolve, reject) => {
      const out: ActivityRecord[] = [];
      const tx = db.transaction(STORE, 'readonly');
      const index = tx.objectStore(STORE).index('at');
      const cursorRequest = index.openCursor(null, 'prev');
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor && out.length < limit) {
          out.push(cursor.value as ActivityRecord);
          cursor.continue();
        } else {
          resolve(out);
        }
      };
      cursorRequest.onerror = () => reject(cursorRequest.error);
    });
    db.close();
    return records;
  } catch {
    return [];
  }
}

export async function clearActivity(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* nothing to clear */
  }
}

export interface WorkspaceStats {
  runs: number;
  files: number;
  seconds: number;
  bytes: number;
  byTool: { toolId: string; toolName: string; count: number }[];
}

export function summarise(records: ActivityRecord[]): WorkspaceStats {
  const byTool = new Map<string, { toolId: string; toolName: string; count: number }>();
  let seconds = 0;
  let bytes = 0;
  let files = 0;

  for (const record of records) {
    seconds += record.duration;
    bytes += record.outputSize;
    files += record.outputs;
    const existing = byTool.get(record.toolId);
    if (existing) existing.count += 1;
    else byTool.set(record.toolId, { toolId: record.toolId, toolName: record.toolName, count: 1 });
  }

  return {
    runs: records.length,
    files,
    seconds,
    bytes,
    byTool: [...byTool.values()].sort((a, b) => b.count - a.count),
  };
}

/* -------------------------------------------------------------- storage --- */

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (!navigator.storage?.estimate) return null;
    const estimate = await navigator.storage.estimate();
    return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
  } catch {
    return null;
  }
}

/** Names of every cache 7 Audio writes setup data into. */
const MODEL_CACHES = ['7by-ai-model-v1', '7audio-model-6s-v1'];

/** Remove saved setup data, freeing the largest thing 7 Audio stores. */
export async function clearModelCache(): Promise<boolean> {
  try {
    const results = await Promise.all(MODEL_CACHES.map((name) => caches.delete(name)));
    return results.some(Boolean);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------ favourites -- */

const FAV_KEY = 'audiora:favourites';

export function readFavourites(): string[] {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function toggleFavourite(toolId: string): string[] {
  const current = readFavourites();
  const next = current.includes(toolId) ? current.filter((id) => id !== toolId) : [...current, toolId];
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(next));
  } catch {
    /* storage disabled */
  }
  return next;
}
