import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatTime, formatTimePrecise } from '@/services/audio';

export interface Region {
  id: string;
  start: number;
  end: number;
  label?: string;
}

interface WaveformProps {
  peaks: Float32Array | null;
  duration: number;
  currentTime?: number;
  /** Editable selection. Omit `onSelectionChange` to render it read-only. */
  selection?: { start: number; end: number } | null;
  onSelectionChange?: (selection: { start: number; end: number }) => void;
  onSeek?: (time: number) => void;
  regions?: Region[];
  height?: number;
  /** 1 = whole file fits; >1 scrolls horizontally. */
  zoom?: number;
  color?: string;
  showRuler?: boolean;
  /** Snap dragged edges to this many seconds. 0 disables. */
  snap?: number;
}

type DragMode = 'none' | 'start' | 'end' | 'new';

export function Waveform({
  peaks,
  duration,
  currentTime = 0,
  selection = null,
  onSelectionChange,
  onSeek,
  regions = [],
  height = 150,
  zoom = 1,
  color,
  showRuler = true,
  snap = 0,
}: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const dragMode = useRef<DragMode>('none');
  const dragMoved = useRef(false);
  const dragAnchor = useRef(0);

  const editable = typeof onSelectionChange === 'function';
  const canvasWidth = Math.max(width, Math.round(width * zoom));

  /* -------------------------------------------------------- measurement */

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      setWidth(Math.floor(entries[0].contentRect.width));
    });
    observer.observe(element);
    setWidth(Math.floor(element.getBoundingClientRect().width));
    return () => observer.disconnect();
  }, []);

  /* ------------------------------------------------------------ drawing */

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvasWidth <= 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = canvasWidth * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${canvasWidth}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvasWidth, height);

    const styles = getComputedStyle(document.documentElement);
    const wave = color || styles.getPropertyValue('--wave').trim() || '#6d3ceb';
    const dim = styles.getPropertyValue('--wave-dim').trim() || 'rgba(109,60,235,0.3)';
    const sel = styles.getPropertyValue('--wave-sel').trim() || 'rgba(109,60,235,0.14)';

    const mid = height / 2;
    const hasSelection = selection && selection.end > selection.start;
    const toX = (time: number) => (duration > 0 ? (time / duration) * canvasWidth : 0);

    // Saved regions sit behind the wave.
    for (const region of regions) {
      const x = toX(region.start);
      const w = Math.max(2, toX(region.end) - x);
      ctx.fillStyle = sel;
      ctx.fillRect(x, 0, w, height);
      ctx.fillStyle = dim;
      ctx.fillRect(x, 0, 1.5, height);
      ctx.fillRect(x + w - 1.5, 0, 1.5, height);
    }

    if (hasSelection) {
      const x = toX(selection.start);
      const w = Math.max(2, toX(selection.end) - x);
      ctx.fillStyle = sel;
      ctx.fillRect(x, 0, w, height);
    }

    if (!peaks || peaks.length === 0) {
      ctx.strokeStyle = dim;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, mid);
      ctx.lineTo(canvasWidth, mid);
      ctx.stroke();
      return;
    }

    // Bars: one per ~2px so the wave reads cleanly at any width.
    const barWidth = 2;
    const gap = 1;
    const step = barWidth + gap;
    const bars = Math.floor(canvasWidth / step);
    const buckets = peaks.length / 2;
    const playX = toX(currentTime);

    for (let i = 0; i < bars; i++) {
      const from = Math.floor((i / bars) * buckets);
      const to = Math.max(from + 1, Math.floor(((i + 1) / bars) * buckets));
      let min = 0;
      let max = 0;
      for (let b = from; b < to && b < buckets; b++) {
        if (peaks[b * 2] < min) min = peaks[b * 2];
        if (peaks[b * 2 + 1] > max) max = peaks[b * 2 + 1];
      }

      const x = i * step;
      const top = mid - max * mid * 0.94;
      const bottom = mid - min * mid * 0.94;
      const barHeight = Math.max(1.5, bottom - top);

      const inSelection = hasSelection && x >= toX(selection.start) && x <= toX(selection.end);
      const played = x <= playX;
      ctx.fillStyle = inSelection || played ? wave : dim;
      ctx.globalAlpha = inSelection ? 1 : played ? 0.95 : 0.75;

      if (typeof ctx.roundRect === 'function') {
        const radius = Math.min(barWidth / 2, barHeight / 2);
        ctx.beginPath();
        ctx.roundRect(x, top, barWidth, barHeight, radius);
        ctx.fill();
      } else {
        ctx.fillRect(x, top, barWidth, barHeight);
      }
    }
    ctx.globalAlpha = 1;

    // Playhead
    if (currentTime > 0 && duration > 0) {
      ctx.fillStyle = wave;
      ctx.fillRect(playX - 1, 0, 2, height);
    }
  }, [canvasWidth, height, peaks, duration, currentTime, selection, regions, color]);

  useEffect(() => {
    const frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [draw]);

  /* -------------------------------------------------------- interaction */

  const timeAt = useCallback(
    (clientX: number): number => {
      const canvas = canvasRef.current;
      if (!canvas || duration <= 0) return 0;
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      let time = ratio * duration;
      if (snap > 0) time = Math.round(time / snap) * snap;
      return Math.max(0, Math.min(duration, time));
    },
    [duration, snap],
  );

  const HANDLE_PX = 10;

  const onPointerDown = (event: React.PointerEvent) => {
    if (duration <= 0) return;
    const time = timeAt(event.clientX);
    dragMoved.current = false;

    if (editable && selection) {
      const rect = canvasRef.current!.getBoundingClientRect();
      const pxPerSecond = rect.width / duration;
      if (Math.abs((time - selection.start) * pxPerSecond) < HANDLE_PX) {
        dragMode.current = 'start';
      } else if (Math.abs((time - selection.end) * pxPerSecond) < HANDLE_PX) {
        dragMode.current = 'end';
      } else {
        dragMode.current = 'new';
        dragAnchor.current = time;
      }
    } else if (editable) {
      dragMode.current = 'new';
      dragAnchor.current = time;
    }

    (event.target as Element).setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (dragMode.current === 'none' || !editable) return;
    const time = timeAt(event.clientX);
    dragMoved.current = true;

    if (dragMode.current === 'new') {
      const start = Math.min(dragAnchor.current, time);
      const end = Math.max(dragAnchor.current, time);
      if (end - start > 0.01) onSelectionChange?.({ start, end });
    } else if (dragMode.current === 'start' && selection) {
      onSelectionChange?.({ start: Math.min(time, selection.end - 0.05), end: selection.end });
    } else if (dragMode.current === 'end' && selection) {
      onSelectionChange?.({ start: selection.start, end: Math.max(time, selection.start + 0.05) });
    }
  };

  const onPointerUp = (event: React.PointerEvent) => {
    const wasDragging = dragMode.current !== 'none';
    dragMode.current = 'none';
    // A press without movement is a seek, not a selection.
    if ((!wasDragging || !dragMoved.current) && onSeek) onSeek(timeAt(event.clientX));
  };

  /* ------------------------------------------------------------- ruler */

  const ticks = useMemo(() => {
    if (duration <= 0) return [];
    const targetCount = Math.max(4, Math.min(12, Math.floor(canvasWidth / 90)));
    const rawStep = duration / targetCount;
    const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const step = steps.find((s) => s >= rawStep) ?? rawStep;
    const out: number[] = [];
    for (let t = 0; t <= duration + 0.001; t += step) out.push(t);
    return out;
  }, [duration, canvasWidth]);

  const toPercent = (time: number) => (duration > 0 ? (time / duration) * 100 : 0);

  return (
    <div>
      {showRuler && (
        <div
          className="mono"
          style={{
            position: 'relative',
            height: 16,
            fontSize: 10.5,
            color: 'var(--text-dim)',
            marginBottom: 4,
            overflow: 'hidden',
          }}
          aria-hidden="true"
        >
          {ticks.map((tick) => (
            <span
              key={tick}
              style={{
                position: 'absolute',
                left: `${toPercent(tick)}%`,
                transform: tick === 0 ? 'none' : 'translateX(-50%)',
                whiteSpace: 'nowrap',
              }}
            >
              {formatTime(tick)}
            </span>
          ))}
        </div>
      )}

      <div
        ref={wrapRef}
        className={zoom > 1 ? 'scroll-x' : undefined}
        style={{
          position: 'relative',
          background: 'var(--surface-inset)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r)',
          overflowX: zoom > 1 ? 'auto' : 'hidden',
          overflowY: 'hidden',
        }}
      >
        <div style={{ position: 'relative', width: canvasWidth || '100%' }}>
          <canvas
            ref={canvasRef}
            role={onSeek || editable ? 'slider' : 'img'}
            aria-label={editable ? 'Waveform — drag to select a range' : 'Audio waveform'}
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(currentTime)}
            aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
            tabIndex={onSeek ? 0 : -1}
            style={{ display: 'block', touchAction: 'pan-y', cursor: editable ? 'crosshair' : onSeek ? 'pointer' : 'default' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onKeyDown={(event) => {
              if (!onSeek) return;
              const stepSize = event.shiftKey ? 10 : 1;
              if (event.key === 'ArrowRight') {
                event.preventDefault();
                onSeek(Math.min(duration, currentTime + stepSize));
              } else if (event.key === 'ArrowLeft') {
                event.preventDefault();
                onSeek(Math.max(0, currentTime - stepSize));
              }
            }}
          />

          {editable && selection && selection.end > selection.start && (
            <>
              <Handle percent={toPercent(selection.start)} time={selection.start} align="start" />
              <Handle percent={toPercent(selection.end)} time={selection.end} align="end" />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Handle({ percent, time, align }: { percent: number; time: number; align: 'start' | 'end' }) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: `${percent}%`,
        width: 2,
        background: 'var(--brand)',
        pointerEvents: 'none',
      }}
    >
      <span
        className="mono"
        style={{
          position: 'absolute',
          top: -2,
          [align === 'start' ? 'left' : 'right']: 0,
          transform: align === 'start' ? 'translateX(-2px)' : 'translateX(2px)',
          background: 'var(--brand)',
          color: '#fff',
          fontSize: 10,
          fontWeight: 600,
          padding: '2px 6px',
          borderRadius: 5,
          whiteSpace: 'nowrap',
        }}
      >
        {formatTimePrecise(time)}
      </span>
      <span
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%,-50%)',
          width: 12,
          height: 12,
          borderRadius: '50%',
          background: 'var(--brand)',
          border: '2px solid var(--surface)',
        }}
      />
    </div>
  );
}
