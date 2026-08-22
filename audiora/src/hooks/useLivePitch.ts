import { useCallback, useEffect, useRef, useState } from 'react';
import { versioned } from '@/services/assetVersion';

/**
 * Live pitch preview.
 *
 * Routes an <audio> element through an AudioWorklet pitch shifter, so dragging
 * the pitch control changes what is playing immediately rather than only
 * changing a number on screen.
 *
 * A MediaElementAudioSourceNode can only be created once per element, so the
 * element and the graph are created together and kept for the lifetime of the
 * hook.
 */
export function useLivePitch(src: string | null) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const readyRef = useRef(false);

  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [supported, setSupported] = useState(true);

  /* -------------------------------------------------------------- element */

  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.crossOrigin = 'anonymous';
    audioRef.current = audio;

    const onTime = () => setTime(audio.currentTime);
    const onMeta = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    const onEnd = () => {
      setPlaying(false);
      setTime(0);
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
      audioRef.current = null;

      nodeRef.current?.port.postMessage({ cmd: 'stop' });
      nodeRef.current?.disconnect();
      sourceRef.current?.disconnect();
      void ctxRef.current?.close();
      ctxRef.current = null;
      nodeRef.current = null;
      sourceRef.current = null;
      readyRef.current = false;
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    setPlaying(false);
    setTime(0);
    audio.src = src ?? '';
    if (src) audio.load();
  }, [src]);

  /* ---------------------------------------------------------------- graph */

  const ensureGraph = useCallback(async (): Promise<boolean> => {
    if (readyRef.current) return true;
    const audio = audioRef.current;
    if (!audio) return false;

    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctor();
      await ctx.audioWorklet.addModule(versioned('/worklets/pitch-processor.js'));

      const node = new AudioWorkletNode(ctx, '7audio-pitch', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      const source = ctx.createMediaElementSource(audio);
      source.connect(node);
      node.connect(ctx.destination);

      ctxRef.current = ctx;
      nodeRef.current = node;
      sourceRef.current = source;
      readyRef.current = true;
      return true;
    } catch (error) {
      // Older browsers without AudioWorklet still get plain playback.
      console.warn('[audiora] live pitch preview unavailable', error);
      setSupported(false);
      return false;
    }
  }, []);

  /** Apply a pitch ratio. Takes effect on the next render quantum. */
  const setRatio = useCallback((ratio: number) => {
    const node = nodeRef.current;
    if (!node) return;
    const param = node.parameters.get('ratio');
    if (param) param.value = Math.max(0.25, Math.min(4, ratio));
  }, []);

  const toggle = useCallback(
    async (ratio: number) => {
      const audio = audioRef.current;
      if (!audio || !audio.src) return;

      if (!audio.paused) {
        audio.pause();
        return;
      }

      await ensureGraph();
      if (ctxRef.current?.state === 'suspended') await ctxRef.current.resume();
      setRatio(ratio);
      try {
        await audio.play();
      } catch {
        setPlaying(false);
      }
    },
    [ensureGraph, setRatio],
  );

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, seconds);
    setTime(audio.currentTime);
  }, []);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    seek(0);
  }, [seek]);

  return { playing, time, duration, supported, toggle, seek, stop, setRatio };
}

export const semitonesToRatio = (semitones: number) => Math.pow(2, semitones / 12);
