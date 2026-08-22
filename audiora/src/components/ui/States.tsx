import type { ReactNode } from 'react';
import { AlertTriangle, Loader2, RotateCcw, type LucideIcon } from 'lucide-react';
import type { ProcessProgress } from '@/types/audio';

/* --------------------------------------------------------------- empty --- */

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  compact = false,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        padding: compact ? '30px 20px' : '52px 24px',
        gap: 8,
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          display: 'grid',
          placeItems: 'center',
          borderRadius: 16,
          background: 'var(--brand-soft)',
          color: 'var(--brand)',
          marginBottom: 6,
        }}
      >
        <Icon size={24} aria-hidden="true" />
      </div>
      <h3 style={{ fontSize: 16.5 }}>{title}</h3>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', maxWidth: 340, lineHeight: 1.6 }}>{body}</p>
      {action && <div style={{ marginTop: 12 }}>{action}</div>}
    </div>
  );
}

/* --------------------------------------------------------------- error --- */

export function ErrorState({
  title = 'Something went wrong',
  body,
  onRetry,
  retryLabel = 'Try Again',
  compact = false,
}: {
  title?: string;
  body: string;
  onRetry?: () => void;
  retryLabel?: string;
  compact?: boolean;
}) {
  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        padding: compact ? '26px 20px' : '44px 24px',
        gap: 8,
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          display: 'grid',
          placeItems: 'center',
          borderRadius: 16,
          background: 'var(--err-soft)',
          color: 'var(--err)',
          marginBottom: 6,
        }}
      >
        <AlertTriangle size={24} aria-hidden="true" />
      </div>
      <h3 style={{ fontSize: 16.5 }}>{title}</h3>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', maxWidth: 420, lineHeight: 1.6 }}>{body}</p>
      {onRetry && (
        <button type="button" className="btn btn-secondary" style={{ marginTop: 12 }} onClick={onRetry}>
          <RotateCcw size={15} aria-hidden="true" />
          {retryLabel}
        </button>
      )}
    </div>
  );
}

/** Inline, non-blocking error — used beside a control rather than in a panel. */
export function InlineNotice({
  kind = 'warning',
  children,
}: {
  kind?: 'warning' | 'error' | 'info';
  children: ReactNode;
}) {
  const color = kind === 'error' ? 'var(--err)' : kind === 'info' ? 'var(--brand)' : 'var(--warn)';
  const bg = kind === 'error' ? 'var(--err-soft)' : kind === 'info' ? 'var(--brand-soft)' : 'var(--warn-soft)';
  return (
    <div
      style={{
        display: 'flex',
        gap: 9,
        alignItems: 'flex-start',
        padding: '10px 12px',
        borderRadius: 'var(--r-sm)',
        background: bg,
        border: `1px solid color-mix(in srgb, ${color} 24%, transparent)`,
        fontSize: 12.5,
        lineHeight: 1.55,
        color: 'var(--text-muted)',
      }}
    >
      <AlertTriangle size={14} style={{ color, flex: 'none', marginTop: 2 }} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

/* ------------------------------------------------------------- loading --- */

export function Spinner({ size = 18, label }: { size?: number; label?: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <Loader2
        size={size}
        aria-hidden="true"
        style={{ animation: 'spin 1s linear infinite', color: 'var(--brand)', flex: 'none' }}
      />
      {label && <span style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>{label}</span>}
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
    </span>
  );
}

/** The three-stage processing readout used by every AI/DSP tool. */
export function ProcessingState({ progress }: { progress: ProcessProgress }) {
  const stages = [
    { key: 'analyzing', label: 'Analysing audio' },
    { key: 'processing', label: 'Processing' },
    { key: 'encoding', label: 'Finalising' },
  ];
  const order = ['reading', 'decoding', 'preparing-engine', 'downloading-model', 'analyzing', 'processing', 'encoding', 'finalizing', 'done'];
  const currentIndex = order.indexOf(progress.stage);
  const stageIndex = (key: string) => order.indexOf(key);

  return (
    <div style={{ padding: '26px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Spinner size={18} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, letterSpacing: '-0.01em' }}>{progress.message}</div>
          {progress.detail && (
            <div className="mono" style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 2 }}>
              {progress.detail}
            </div>
          )}
        </div>
        {progress.percent !== null && (
          <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--brand)' }}>
            {progress.percent}%
          </span>
        )}
      </div>

      <div className="bar" aria-hidden={progress.percent === null}>
        <i
          style={{
            width: progress.percent === null ? '35%' : `${progress.percent}%`,
            animation: progress.percent === null ? 'indeterminate 1.4s ease-in-out infinite' : undefined,
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {stages.map((s) => {
          const done = currentIndex > stageIndex(s.key);
          const active = currentIndex === stageIndex(s.key);
          return (
            <span
              key={s.key}
              style={{
                fontSize: 12,
                fontWeight: active ? 700 : 500,
                color: active ? 'var(--brand)' : done ? 'var(--ok)' : 'var(--text-dim)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: active ? 'var(--brand)' : done ? 'var(--ok)' : 'var(--border-strong)',
                }}
              />
              {s.label}
            </span>
          );
        })}
      </div>

      <style>{'@keyframes indeterminate{0%{margin-left:0}50%{margin-left:65%}100%{margin-left:0}}'}</style>
    </div>
  );
}

/* ------------------------------------------------------------ skeleton --- */

export function SkeletonBlock({ height = 16, width = '100%', radius = 8 }: { height?: number; width?: number | string; radius?: number }) {
  return <div className="skeleton" style={{ height, width, borderRadius: radius }} />;
}

export function SkeletonCard() {
  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <SkeletonBlock height={48} width={48} radius={14} />
      <SkeletonBlock height={17} width="65%" />
      <SkeletonBlock height={13} width="92%" />
      <SkeletonBlock height={13} width="78%" />
      <SkeletonBlock height={38} radius={10} />
    </div>
  );
}

export function SkeletonWaveform() {
  return <SkeletonBlock height={160} radius={14} />;
}
