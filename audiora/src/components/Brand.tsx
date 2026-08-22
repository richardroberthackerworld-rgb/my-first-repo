import { useEffect, useState } from 'react';

/**
 * 7 Audio brand mark.
 *
 * A blue "7" with a waveform cluster running through its lower half. This file
 * ships a vector rebuild so the app is never missing its logo.
 *
 * TO USE THE ORIGINAL ARTWORK: drop the supplied file at
 *     public/brand/7audio-icon.png
 * and every mark in the app switches to it automatically — no code change.
 * The probe below runs once per session and is cached.
 */

const OFFICIAL_ICON = '/brand/7audio-icon.png';

let officialProbe: Promise<boolean> | null = null;

function probeOfficialIcon(): Promise<boolean> {
  if (officialProbe) return officialProbe;
  officialProbe = new Promise<boolean>((resolve) => {
    if (typeof window === 'undefined') return resolve(false);
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 0);
    img.onerror = () => resolve(false);
    img.src = OFFICIAL_ICON;
  });
  return officialProbe;
}

function useOfficialIcon(): boolean {
  const [has, setHas] = useState(false);
  useEffect(() => {
    let alive = true;
    probeOfficialIcon().then((ok) => alive && setHas(ok));
    return () => {
      alive = false;
    };
  }, []);
  return has;
}

/**
 * Waveform bars, left to right: [height 0..1, is the bar an accent colour].
 * The outermost bars are blue and the inner ones ink, exactly as the mark.
 */
const BARS: [number, boolean][] = [
  [0.22, true],
  [0.5, false],
  [0.74, false],
  [1.0, false],
  [0.66, false],
  [0.42, false],
  [0.26, true],
];

export function BrandMark({
  size = 36,
  className = '',
  animated = false,
}: {
  size?: number;
  className?: string;
  /** Gently animates the waveform bars — used on the splash and hero. */
  animated?: boolean;
}) {
  const official = useOfficialIcon();

  if (official) {
    return (
      <img
        src={OFFICIAL_ICON}
        width={size}
        height={size}
        alt=""
        aria-hidden="true"
        className={className}
        style={{ width: size, height: size, objectFit: 'contain', flex: 'none' }}
      />
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={`${className} ${animated ? 'mark-animated' : ''}`.trim()}
      style={{ flex: 'none' }}
    >
      {/* The 7 — thick top bar sweeping into a diagonal, rounded throughout. */}
      <path
        d="M20 12h70c7.2 0 11.6 6 9 12.6L58.6 106c-2.2 5.6-8.2 8.2-13.4 6.1-5.4-2.2-7.8-8.3-5.6-13.7L70.5 34H20c-6 0-11-4.9-11-11S14 12 20 12Z"
        fill="var(--brand)"
      />

      {/* Waveform cluster sitting in the lower right, as in the mark. */}
      <g>
        {BARS.map(([height, accent], i) => {
          const w = 7.4;
          const gap = 9.6;
          // Centre the cluster on x=82 so the widest bar still sits inside the
          // 120-unit viewBox — laying it out from the left overflowed the edge.
          const totalW = (BARS.length - 1) * gap + w;
          const x = 82 - totalW / 2 + i * gap;
          const maxH = 56;
          const barH = Math.max(w, height * maxH);
          const y = 78 - barH / 2;
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={w}
              height={barH}
              rx={w / 2}
              fill={accent ? 'var(--brand)' : 'var(--mark-ink)'}
              style={
                animated
                  ? { transformOrigin: `${x + w / 2}px 78px`, animation: `markBar 1.4s ${i * 90}ms ease-in-out infinite alternate` }
                  : undefined
              }
            />
          );
        })}
      </g>
    </svg>
  );
}

/** Full lockup: mark + "7 Audio" + optional descriptor. */
export function BrandLogo({
  size = 34,
  sub = 'Audio Tools',
  compact = false,
}: {
  size?: number;
  sub?: string | null;
  compact?: boolean;
}) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: compact ? 8 : 10 }}>
      <BrandMark size={size} />
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.05 }}>
        <span
          style={{
            fontSize: compact ? 16 : 18,
            fontWeight: 800,
            letterSpacing: '-0.03em',
            color: 'var(--text)',
          }}
        >
          7 Audio
        </span>
        {sub && (
          <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-dim)', letterSpacing: '-0.005em' }}>
            {sub}
          </span>
        )}
      </span>
    </span>
  );
}
