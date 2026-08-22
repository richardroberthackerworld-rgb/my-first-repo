/* =============================================================================
   Audiora — real-time pitch shifter (AudioWorklet).

   Used for live preview while the user drags the pitch control. The export
   still goes through the higher-quality offline WSOLA renderer; this one has to
   run inside a 128-sample render quantum, so it trades some quality for being
   instant.

   Method: crossfading variable delay line.

     * Audio is written into a circular buffer at 1 sample per sample.
     * A read pointer trails the write pointer by `delay`. Shrinking that delay
       by (ratio - 1) each sample makes the reader advance at `ratio`, which is
       exactly a pitch shift of `ratio` with the duration left alone.
     * When the delay wraps, a second reader half a grain out of phase takes
       over. Both are Hann-windowed, and Hann(x) + Hann(x + 0.5) === 1, so the
       crossfade is gain-flat with no dip at the seam.
   ========================================================================== */

const GRAIN = 4096;
const BUFFER = GRAIN * 2;
const TWO_PI = Math.PI * 2;

class PitchProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'ratio',
        defaultValue: 1,
        // Two octaves either way covers the -12..+12 semitone control.
        minValue: 0.25,
        maxValue: 4,
        automationRate: 'k-rate',
      },
    ];
  }

  constructor() {
    super();
    this.channels = [];
    this.writePos = 0;
    this.phase = 0;
    this.active = true;

    this.port.onmessage = (event) => {
      if (event.data && event.data.cmd === 'stop') this.active = false;
    };
  }

  ensureChannels(count) {
    while (this.channels.length < count) {
      this.channels.push(new Float32Array(BUFFER));
    }
  }

  /** Linear interpolation read from the circular buffer. */
  read(buffer, position) {
    let p = position;
    while (p < 0) p += BUFFER;
    while (p >= BUFFER) p -= BUFFER;
    const i = p | 0;
    const frac = p - i;
    const j = i + 1 >= BUFFER ? 0 : i + 1;
    return buffer[i] * (1 - frac) + buffer[j] * frac;
  }

  process(inputs, outputs, parameters) {
    if (!this.active) return false;

    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const channelCount = output.length;
    this.ensureChannels(channelCount);

    const ratio = parameters.ratio[0];
    const frames = output[0].length;

    // At unity there is nothing to do — pass through untouched so the preview
    // at 0 semitones is bit-identical to the source.
    if (Math.abs(ratio - 1) < 1e-4) {
      for (let c = 0; c < channelCount; c++) {
        const src = input && input[c] ? input[c] : null;
        const dst = output[c];
        const buf = this.channels[c];
        for (let i = 0; i < frames; i++) {
          const sample = src ? src[i] : 0;
          buf[(this.writePos + i) % BUFFER] = sample;
          dst[i] = sample;
        }
      }
      this.writePos = (this.writePos + frames) % BUFFER;
      this.phase = 0;
      return true;
    }

    const step = ratio - 1;
    let phase = this.phase;
    let writePos = this.writePos;

    for (let i = 0; i < frames; i++) {
      // Write this frame across every channel first, so both readers see it.
      for (let c = 0; c < channelCount; c++) {
        const src = input && input[c] ? input[c] : null;
        this.channels[c][writePos] = src ? src[i] : 0;
      }

      const delayA = phase;
      let delayB = phase + GRAIN * 0.5;
      if (delayB >= GRAIN) delayB -= GRAIN;

      // Square-root (equal-power) weights. The two readers sit half a grain
      // apart, so for anything periodic they are at unrelated phases and
      // partially cancel. Amplitude-preserving weights (wA + wB = 1) would
      // then lose well over 10 dB; equal-power weights keep wA² + wB² = 1,
      // which is the right sum for decorrelated signals.
      const wA = Math.sqrt(0.5 * (1 - Math.cos((TWO_PI * delayA) / GRAIN)));
      const wB = Math.sqrt(0.5 * (1 - Math.cos((TWO_PI * delayB) / GRAIN)));

      for (let c = 0; c < channelCount; c++) {
        const buf = this.channels[c];
        const a = this.read(buf, writePos - delayA);
        const b = this.read(buf, writePos - delayB);
        output[c][i] = a * wA + b * wB;
      }

      phase -= step;
      if (phase < 0) phase += GRAIN;
      else if (phase >= GRAIN) phase -= GRAIN;

      writePos = writePos + 1 >= BUFFER ? 0 : writePos + 1;
    }

    this.phase = phase;
    this.writePos = writePos;
    return true;
  }
}

registerProcessor('audiora-pitch', PitchProcessor);
