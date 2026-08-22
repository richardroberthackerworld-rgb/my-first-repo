import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrandMark } from './Brand';
import { BRAND } from '@/config/site';
import { usePrefersReducedMotion } from '@/hooks/useMediaQuery';

const SESSION_KEY = 'audiora:splash-shown';

export function shouldShowSplash(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) !== '1';
  } catch {
    return true;
  }
}

function markSplashShown(): void {
  try {
    sessionStorage.setItem(SESSION_KEY, '1');
  } catch {
    /* private mode — the splash simply shows again */
  }
}

/** Bar heights for the waveform band, mirrored below the baseline. */
function useWaveBars(count: number) {
  return useMemo(() => {
    const bars: number[] = [];
    for (let i = 0; i < count; i++) {
      const t = i / count;
      // Two travelling envelopes so the band has a musical, uneven shape.
      const envelope =
        0.34 * Math.sin(t * Math.PI * 2.1 + 0.6) +
        0.3 * Math.sin(t * Math.PI * 6.7 + 1.9) +
        0.22 * Math.sin(t * Math.PI * 13.3);
      bars.push(Math.max(0.06, Math.min(1, 0.34 + envelope)));
    }
    return bars;
  }, [count]);
}

export function Splash({ onDone }: { onDone: () => void }) {
  const reduceMotion = usePrefersReducedMotion();
  const [progress, setProgress] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const bars = useWaveBars(76);
  const doneRef = useRef(false);

  const total = reduceMotion ? 500 : 1900;

  /**
   * Finish exactly once, however we got here. `requestAnimationFrame` does not
   * run in a hidden tab, so completion is driven by a timer — otherwise opening
   * 7 Audio in a background tab would leave the splash stuck on screen.
   */
  const finish = useCallback(
    (delay: number) => {
      if (doneRef.current) return;
      doneRef.current = true;
      markSplashShown();
      setProgress(100);
      setLeaving(true);
      window.setTimeout(onDone, reduceMotion ? 0 : delay);
    },
    [onDone, reduceMotion],
  );

  useEffect(() => {
    // Nothing to animate in a hidden tab — go straight through.
    if (document.visibilityState === 'hidden') {
      finish(0);
      return;
    }

    const start = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const ratio = Math.min(1, (now - start) / total);
      // Ease-out so the bar decelerates into 100% rather than stopping dead.
      setProgress(Math.round((1 - Math.pow(1 - ratio, 2.2)) * 100));
      if (ratio < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    const timer = window.setTimeout(() => finish(320), total);

    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [finish, total]);

  // Let an impatient user skip straight through.
  useEffect(() => {
    const skip = () => finish(160);
    window.addEventListener('pointerdown', skip);
    window.addEventListener('keydown', skip);
    return () => {
      window.removeEventListener('pointerdown', skip);
      window.removeEventListener('keydown', skip);
    };
  }, [finish]);

  return (
    <div className="splash" data-leaving={leaving} role="status" aria-live="polite">
      <span className="sr-only">7 Audio is loading</span>

      <div className="splash-top">
        <div className="splash-rings" aria-hidden="true">
          <span style={{ width: 340, height: 340 }} />
          <span style={{ width: 268, height: 268 }} />
          <span style={{ width: 200, height: 200 }} />
          <div className="splash-disc">
            <BrandMark size={132} />
          </div>
        </div>

        <h1 className="splash-title">
          <span style={{ color: '#2f5cf0' }}>Create.</span> <span style={{ color: '#6d3ceb' }}>Mix.</span>{' '}
          <span style={{ color: '#9333ea' }}>Perfect.</span>
        </h1>
        <p className="splash-sub">
          Professional audio tools
          <br />
          for creators like you.
        </p>
      </div>

      <div className="splash-wave" aria-hidden="true">
        {bars.map((height, index) => (
          <span
            key={index}
            style={{
              height: `${height * 100}%`,
              background: `linear-gradient(180deg, ${index / bars.length < 0.5 ? '#2f5cf0' : '#9333ea'}, #6d3ceb)`,
              animationDelay: reduceMotion ? undefined : `${index * 12}ms`,
            }}
          />
        ))}
      </div>

      <div className="splash-bottom">
        <div className="splash-bar" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Loading">
          <i style={{ width: `${progress}%` }} />
        </div>
        <p className="splash-status">Loading your creative experience…</p>
        <p className="splash-credit">
          {BRAND.splashCredit.label}{' '}
          <a href={BRAND.splashCredit.href} target="_blank" rel="noreferrer noopener">
            {BRAND.splashCredit.name}
          </a>
        </p>
      </div>
    </div>
  );
}
