import { Download, FileCheck2, Package } from 'lucide-react';
import type { AudioResult } from '@/types/audio';
import { downloadAll, downloadResult, formatBytes, formatTime } from '@/services/audio';
import { AudioPlayer } from './AudioPlayer';
import { useToast } from './ui/Toast';

/** One produced file: preview it, then save it to the device. */
export function ResultCard({ result, accent }: { result: AudioResult; accent?: string }) {
  const toast = useToast();

  return (
    <div
      className="card"
      style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--surface)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          style={{
            width: 34,
            height: 34,
            flex: 'none',
            display: 'grid',
            placeItems: 'center',
            borderRadius: 10,
            background: `color-mix(in srgb, ${accent ?? 'var(--brand)'} 13%, transparent)`,
            color: accent ?? 'var(--brand)',
          }}
        >
          <FileCheck2 size={16} aria-hidden="true" />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, letterSpacing: '-0.01em' }}>{result.label}</div>
          <div
            className="mono"
            style={{ fontSize: 10.5, color: 'var(--text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            title={result.filename}
          >
            {result.filename} · {formatBytes(result.size)} · {formatTime(result.duration)}
          </div>
        </div>
        <button
          type="button"
          className="icon-btn icon-btn-sm"
          onClick={() => {
            downloadResult(result);
            toast.success('Saving to your device', result.filename);
          }}
          aria-label={`Download ${result.label}`}
          style={{ color: 'var(--brand)' }}
        >
          <Download size={15} aria-hidden="true" />
        </button>
      </div>

      <AudioPlayer src={result.url} duration={result.duration} compact label={result.label} accent={accent} />
    </div>
  );
}

export function ResultList({
  results,
  accent,
  zipName = '7audio-export',
  title = 'Results',
}: {
  results: AudioResult[];
  accent?: string;
  zipName?: string;
  title?: string;
}) {
  const toast = useToast();
  if (results.length === 0) return null;

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">
          {title} <span style={{ color: 'var(--text-dim)', fontWeight: 500 }}>({results.length})</span>
        </span>
        {results.length > 1 && (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={async () => {
              try {
                await downloadAll(results, zipName);
                toast.success('Saving to your device', `${results.length} files in ${zipName}.zip`);
              } catch (error) {
                toast.error('Could not build the zip', error instanceof Error ? error.message : undefined);
              }
            }}
          >
            <Package size={14} aria-hidden="true" />
            Download All
          </button>
        )}
      </div>
      <div style={{ padding: 14, display: 'grid', gap: 10 }}>
        {results.map((result) => (
          <ResultCard key={result.id} result={result} accent={accent} />
        ))}
      </div>
    </div>
  );
}
