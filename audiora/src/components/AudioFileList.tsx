import { useRef, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronUp, GripVertical, Music4, Plus, Trash2 } from 'lucide-react';
import type { LoadedAudio } from '@/types/audio';
import { formatBytes, formatTime } from '@/services/audio';
import { AudioPlayer } from './AudioPlayer';
import { Spinner } from './ui/States';

interface AudioFileListProps {
  files: LoadedAudio[];
  onRemove: (id: string) => void;
  onClear: () => void;
  onAdd?: () => void;
  onReorder?: (from: number, to: number) => void;
  title?: string;
  /** Object URLs keyed by file id, for row playback. */
  urls: Record<string, string>;
}

export function AudioFileList({ files, onRemove, onClear, onAdd, onReorder, title = 'Audio Files', urls }: AudioFileListProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const liveRef = useRef<HTMLDivElement>(null);

  if (files.length === 0) return null;

  const totalDuration = files.reduce((sum, f) => sum + (f.meta.duration ?? 0), 0);
  const totalSize = files.reduce((sum, f) => sum + f.meta.size, 0);
  const reorderable = typeof onReorder === 'function' && files.length > 1;

  const move = (from: number, to: number) => {
    if (!onReorder || to < 0 || to >= files.length || from === to) return;
    onReorder(from, to);
    if (liveRef.current) {
      liveRef.current.textContent = `${files[from].meta.name} moved to position ${to + 1} of ${files.length}`;
    }
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">
          {title} <span style={{ color: 'var(--text-dim)', fontWeight: 500 }}>({files.length})</span>
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="btn btn-sm btn-danger" onClick={onClear}>
            <Trash2 size={14} aria-hidden="true" />
            Clear All
          </button>
          {onAdd && (
            <button type="button" className="btn btn-sm btn-secondary" onClick={onAdd}>
              <Plus size={14} aria-hidden="true" />
              <span className="hide-narrow">Add More Files</span>
            </button>
          )}
        </div>
      </div>

      <div ref={liveRef} className="sr-only" aria-live="polite" />

      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {files.map((file, index) => (
          <li
            key={file.meta.id}
            draggable={reorderable}
            onDragStart={() => setDragIndex(index)}
            onDragEnter={() => setOverIndex(index)}
            onDragOver={(event) => event.preventDefault()}
            onDragEnd={() => {
              if (dragIndex !== null && overIndex !== null) move(dragIndex, overIndex);
              setDragIndex(null);
              setOverIndex(null);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '12px 16px',
              borderTop: index === 0 ? 0 : '1px solid var(--border)',
              background: overIndex === index && dragIndex !== null ? 'var(--brand-soft)' : 'transparent',
              opacity: dragIndex === index ? 0.5 : 1,
            }}
          >
            {reorderable && (
              <span
                aria-hidden="true"
                style={{ color: 'var(--text-dim)', cursor: 'grab', flex: 'none', display: 'flex' }}
                title="Drag to reorder"
              >
                <GripVertical size={16} />
              </span>
            )}

            <span
              style={{
                width: 38,
                height: 38,
                flex: 'none',
                display: 'grid',
                placeItems: 'center',
                borderRadius: 11,
                background: file.status === 'error' ? 'var(--err-soft)' : 'var(--brand-soft)',
                color: file.status === 'error' ? 'var(--err)' : 'var(--brand)',
              }}
            >
              {file.status === 'error' ? <AlertCircle size={17} aria-hidden="true" /> : <Music4 size={17} aria-hidden="true" />}
            </span>

            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontSize: 13.5,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={file.meta.name}
              >
                {file.meta.name}
              </div>

              {file.status === 'error' ? (
                <div style={{ fontSize: 12, color: 'var(--err)', marginTop: 2, lineHeight: 1.4 }}>{file.error}</div>
              ) : file.status === 'ready' ? (
                <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                  {formatTime(file.meta.duration ?? 0)} · {formatBytes(file.meta.size)} · {file.meta.format} ·{' '}
                  {file.meta.sampleRate} Hz · {file.meta.channels === 1 ? 'Mono' : 'Stereo'}
                </div>
              ) : (
                <div style={{ marginTop: 3 }}>
                  <Spinner size={13} label="Reading…" />
                </div>
              )}
            </div>

            {file.status === 'ready' && urls[file.meta.id] && (
              <div className="file-row-player">
                <AudioPlayer src={urls[file.meta.id]} duration={file.meta.duration ?? 0} compact label={file.meta.name} />
              </div>
            )}

            <div style={{ display: 'flex', gap: 4, flex: 'none' }}>
              {reorderable && (
                <>
                  <button
                    type="button"
                    className="icon-btn icon-btn-sm reorder-btn"
                    onClick={() => move(index, index - 1)}
                    disabled={index === 0}
                    aria-label={`Move ${file.meta.name} up`}
                  >
                    <ChevronUp size={15} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="icon-btn icon-btn-sm reorder-btn"
                    onClick={() => move(index, index + 1)}
                    disabled={index === files.length - 1}
                    aria-label={`Move ${file.meta.name} down`}
                  >
                    <ChevronDown size={15} aria-hidden="true" />
                  </button>
                </>
              )}
              <button
                type="button"
                className="icon-btn icon-btn-sm"
                onClick={() => onRemove(file.meta.id)}
                aria-label={`Remove ${file.meta.name}`}
                style={{ color: 'var(--err)' }}
              >
                <Trash2 size={15} aria-hidden="true" />
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          padding: '12px 16px',
          borderTop: '1px solid var(--border)',
          background: 'var(--surface-2)',
          fontSize: 12.5,
          color: 'var(--text-muted)',
        }}
      >
        <span>
          Total files: <b style={{ color: 'var(--text)' }}>{files.length}</b>
        </span>
        {totalDuration > 0 && (
          <span>
            Total duration: <b className="mono" style={{ color: 'var(--text)' }}>{formatTime(totalDuration)}</b>
          </span>
        )}
        <span>
          Total size: <b className="mono" style={{ color: 'var(--text)' }}>{formatBytes(totalSize)}</b>
        </span>
      </div>
    </div>
  );
}
