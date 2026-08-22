import { useMemo } from 'react';
import { BrandMark } from './Brand';

/**
 * Hero artwork: the brand mark on a floating disc, ringed by pulsing circles,
 * with a live equaliser and the formats the app handles orbiting around it.
 *
 * This replaced an earlier before/after waveform card. That card implied a
 * specific processing result on the marketing page, and it clipped awkwardly on
 * narrow screens — this is purely decorative, scales cleanly and animates.
 */

const CHIPS = [
  { label: 'MP3', style: { top: '4%', left: '2%' }, delay: '0s' },
  { label: 'WAV', style: { top: '16%', right: '0%' }, delay: '0.8s' },
  { label: 'FLAC', style: { bottom: '18%', left: '0%' }, delay: '1.6s' },
  { label: 'M4A', style: { bottom: '3%', right: '8%' }, delay: '2.4s' },
];

export function HeroVisual() {
  // Fixed heights so the equaliser looks musical rather than uniform.
  const bars = useMemo(() => [0.35, 0.62, 0.85, 1, 0.7, 0.95, 0.5, 0.78, 0.4, 0.66, 0.3], []);

  return (
    <div className="hero-stage" aria-hidden="true">
      <span className="hero-ring" style={{ width: '100%', height: '100%' }} />
      <span className="hero-ring" style={{ width: '78%', height: '78%', animationDelay: '0.4s' }} />
      <span className="hero-ring" style={{ width: '58%', height: '58%', animationDelay: '0.8s' }} />

      <div className="hero-disc">
        <div style={{ display: 'grid', placeItems: 'center', gap: 10, width: '100%' }}>
          <BrandMark size={64} animated />
          <div className="hero-eq">
            {bars.map((height, index) => (
              <span
                key={index}
                style={{
                  height: `${height * 100}%`,
                  animationDelay: `${index * 90}ms`,
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {CHIPS.map((chip) => (
        <span key={chip.label} className="hero-chip mono" style={{ ...chip.style, animationDelay: chip.delay }}>
          {chip.label}
        </span>
      ))}
    </div>
  );
}

/** Stacked initial avatars used by the social-proof row. */
export function AvatarRow({ count = 4 }: { count?: number }) {
  const people = ['A', 'M', 'K', 'R', 'S'].slice(0, count);
  const gradients = [
    'linear-gradient(135deg,#2f6bff,#3b2bf5)',
    'linear-gradient(135deg,#3b2bf5,#8b34ea)',
    'linear-gradient(135deg,#0d9bb0,#2f6bff)',
    'linear-gradient(135deg,#e0417a,#8b34ea)',
    'linear-gradient(135deg,#0f9d76,#0d9bb0)',
  ];

  return (
    <div style={{ display: 'flex', alignItems: 'center' }} aria-hidden="true">
      {people.map((initial, index) => (
        <span
          key={initial}
          style={{
            width: 30,
            height: 30,
            marginLeft: index === 0 ? 0 : -9,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            background: gradients[index % gradients.length],
            border: '2px solid var(--bg)',
            color: '#fff',
            fontSize: 11.5,
            fontWeight: 700,
          }}
        >
          {initial}
        </span>
      ))}
      <span
        style={{
          width: 30,
          height: 30,
          marginLeft: -9,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          background: 'var(--surface-3)',
          border: '2px solid var(--bg)',
          color: 'var(--text-muted)',
          fontSize: 13,
          fontWeight: 700,
        }}
      >
        +
      </span>
    </div>
  );
}
