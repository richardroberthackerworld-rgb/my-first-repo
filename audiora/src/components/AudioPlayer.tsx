import { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';
import { formatTime } from '@/services/audio';

/**
 * Playback for a local object URL (the user's own file, or a result blob).
 * Uses a plain <audio> element, so seeking and buffering are the browser's.
 */
export function useAudioElement(src: string | null) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'metadata';
    ref.current = audio;

    const onTime = () => setTime(audio.currentTime);
    const onMeta = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    const onEnd = () => {
      setPlaying(false);
      setTime(0);
      audio.currentTime = 0;
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);

    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('durationchange', onMeta);
    audio.addEventListener('ended', onEnd);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);

    return () => {
      audio.pause();
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('durationchange', onMeta);
      audio.removeEventListener('ended', onEnd);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.src = '';
      ref.current = null;
    };
  }, []);

  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;
    audio.pause();
    setPlaying(false);
    setTime(0);
    audio.src = src ?? '';
    if (src) audio.load();
  }, [src]);

  const toggle = useCallback(async () => {
    const audio = ref.current;
    if (!audio || !audio.src) return;
    if (audio.paused) {
      try {
        await audio.play();
      } catch {
        setPlaying(false);
      }
    } else {
      audio.pause();
    }
  }, []);

  const seek = useCallback((seconds: number) => {
    const audio = ref.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, seconds);
    setTime(audio.currentTime);
  }, []);

  const stop = useCallback(() => {
    ref.current?.pause();
    seek(0);
  }, [seek]);

  const setVolume = useCallback((value: number) => {
    if (ref.current) ref.current.volume = Math.max(0, Math.min(1, value));
  }, []);

  return { playing, time, duration, toggle, seek, stop, setVolume, element: ref };
}

interface AudioPlayerProps {
  src: string | null;
  /** Falls back to the element's own metadata duration when omitted. */
  duration?: number;
  compact?: boolean;
  label?: string;
  accent?: string;
}

/** Play / seek bar used under file rows and result cards. */
export function AudioPlayer({ src, duration: knownDuration, compact = false, label, accent }: AudioPlayerProps) {
  const { playing, time, duration, toggle, seek, setVolume } = useAudioElement(src);
  const [muted, setMuted] = useState(false);
  const total = knownDuration && knownDuration > 0 ? knownDuration : duration;
  const color = accent ?? 'var(--brand)';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 9 : 12, minWidth: 0 }}>
      <button
        type="button"
        className="icon-btn"
        style={{
          width: compact ? 38 : 44,
          height: compact ? 38 : 44,
          borderRadius: '50%',
          color,
          borderColor: 'var(--border)',
          flex: 'none',
        }}
        onClick={toggle}
        disabled={!src}
        aria-label={playing ? `Pause${label ? ` ${label}` : ''}` : `Play${label ? ` ${label}` : ''}`}
      >
        {playing ? <Pause size={compact ? 15 : 17} aria-hidden="true" /> : <Play size={compact ? 15 : 17} aria-hidden="true" />}
      </button>

      <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-dim)', flex: 'none' }}>
        {formatTime(time)}
      </span>

      <input
        type="range"
        className="slider"
        min={0}
        max={Math.max(0.1, total)}
        step={0.01}
        value={Math.min(time, total)}
        disabled={!src}
        onChange={(event) => seek(Number(event.target.value))}
        aria-label={`Seek${label ? ` ${label}` : ''}`}
        aria-valuetext={`${formatTime(time)} of ${formatTime(total)}`}
        style={{ flex: 1, minWidth: 40 }}
      />

      <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-dim)', flex: 'none' }}>
        {formatTime(total)}
      </span>

      {!compact && (
        <button
          type="button"
          className="icon-btn icon-btn-sm"
          onClick={() => {
            setMuted((m) => {
              setVolume(m ? 1 : 0);
              return !m;
            });
          }}
          aria-label={muted ? 'Unmute' : 'Mute'}
        >
          {muted ? <VolumeX size={15} aria-hidden="true" /> : <Volume2 size={15} aria-hidden="true" />}
        </button>
      )}
    </div>
  );
}

/** Transport bar for the cutter / pitch shifter waveform views. */
export function Transport({
  playing,
  onToggle,
  onSkipStart,
  onSkipEnd,
  time,
  duration,
  children,
}: {
  playing: boolean;
  onToggle: () => void;
  onSkipStart: () => void;
  onSkipEnd: () => void;
  time: number;
  duration: number;
  children?: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
      {children}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button type="button" className="icon-btn icon-btn-sm" onClick={onSkipStart} aria-label="Jump to start">
          <SkipBack size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="btn btn-primary"
          style={{ width: 48, height: 48, minHeight: 48, padding: 0, borderRadius: '50%' }}
          onClick={onToggle}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? <Pause size={19} aria-hidden="true" /> : <Play size={19} aria-hidden="true" style={{ marginLeft: 2 }} />}
        </button>
        <button type="button" className="icon-btn icon-btn-sm" onClick={onSkipEnd} aria-label="Jump to end">
          <SkipForward size={15} aria-hidden="true" />
        </button>
      </div>
      <span className="mono" style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
        {formatTime(time)} / {formatTime(duration)}
      </span>
    </div>
  );
}
