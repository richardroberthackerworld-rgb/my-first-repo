/* =============================================================================
   Audiora — noise reduction worker.

   Real spectral-subtraction / spectral-gating noise reduction, the same family
   of algorithm as desktop editors use:

     1. STFT the signal (2048-point FFT, 75% overlap, Hann window).
     2. Estimate a per-bin noise floor from the quietest frames (percentile),
        so no separate "noise sample" selection is needed.
     3. Compute a per-bin gain by oversubtracting that floor, with a floor of
        (1 - reduction) so the result never gates to digital silence.
     4. Smooth the gain across frequency and time to suppress musical noise.
     5. ISTFT back with overlap-add.

   Runs entirely in the user's browser. No audio is transmitted anywhere.
   ========================================================================== */

const FFT_SIZE = 2048;
const HOP = 512;
const BINS = FFT_SIZE / 2 + 1;

/* ------------------------------------------------------------------ FFT --- */

const twiddleCache = new Map();

function twiddles(n, inverse) {
  const key = n + (inverse ? 'i' : 'f');
  if (twiddleCache.has(key)) return twiddleCache.get(key);
  const re = new Float32Array(n / 2);
  const im = new Float32Array(n / 2);
  const sign = inverse ? 2 : -2;
  for (let k = 0; k < n / 2; k++) {
    const a = (sign * Math.PI * k) / n;
    re[k] = Math.cos(a);
    im[k] = Math.sin(a);
  }
  const t = { re, im };
  twiddleCache.set(key, t);
  return t;
}

function bitReverse(value, bits) {
  let r = 0;
  for (let i = 0; i < bits; i++) {
    r = (r << 1) | (value & 1);
    value >>= 1;
  }
  return r;
}

/** In-place iterative radix-2 FFT over (re, im). */
function fftInPlace(re, im, n, inverse) {
  const bits = Math.log2(n) | 0;
  for (let i = 0; i < n; i++) {
    const j = bitReverse(i, bits);
    if (j > i) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  const tw = twiddles(n, inverse);
  for (let size = 2; size <= n; size *= 2) {
    const half = size / 2;
    const step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = 0; j < half; j++) {
        const k = j * step;
        const tr = tw.re[k];
        const ti = tw.im[k];
        const a = i + j;
        const b = a + half;
        const br = re[b] * tr - im[b] * ti;
        const bi = re[b] * ti + im[b] * tr;
        re[b] = re[a] - br;
        im[b] = im[a] - bi;
        re[a] += br;
        im[a] += bi;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

function hannWindow(size) {
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  return w;
}

/* -------------------------------------------------------- noise shaping --- */

/**
 * Per-bin multiplier applied to the estimated noise floor, so the "noise type"
 * control genuinely changes which part of the spectrum is attacked.
 */
function noiseWeighting(type, sampleRate) {
  const w = new Float32Array(BINS).fill(1);
  const binHz = sampleRate / FFT_SIZE;

  if (type === 'hiss') {
    for (let b = 0; b < BINS; b++) {
      const hz = b * binHz;
      w[b] = hz > 4000 ? 1.8 : hz > 2000 ? 1.3 : 0.55;
    }
  } else if (type === 'hum') {
    // Attack mains hum and its harmonics (both 50 Hz and 60 Hz regions).
    for (let b = 0; b < BINS; b++) {
      const hz = b * binHz;
      let boost = hz < 300 ? 1.4 : 0.7;
      for (const base of [50, 60]) {
        for (let h = 1; h <= 6; h++) {
          if (Math.abs(hz - base * h) < binHz * 1.5) boost = 3.2;
        }
      }
      w[b] = boost;
    }
  } else if (type === 'wind') {
    for (let b = 0; b < BINS; b++) {
      const hz = b * binHz;
      w[b] = hz < 200 ? 2.6 : hz < 500 ? 1.4 : 0.7;
    }
  }
  return w;
}

const STRENGTH_ALPHA = { light: 1.3, balanced: 2.1, strong: 3.2 };

/* ------------------------------------------------------------ processing -- */

/** How many frames to sample when estimating the noise floor. */
const PROFILE_FRAMES = 600;

/**
 * Pass 1 — estimate the per-bin noise floor.
 *
 * Only a strided subset of frames is analysed. A few hundred frames spread
 * across the file describe the noise floor just as well as every frame does,
 * and it keeps this pass fast and allocation-free on long recordings.
 */
function estimateNoiseFloor(input, win, frames, onProgress) {
  const sampleCount = Math.min(frames, PROFILE_FRAMES);
  const stride = Math.max(1, Math.floor(frames / sampleCount));
  const taken = Math.max(1, Math.floor((frames - 1) / stride) + 1);

  const mags = new Float32Array(taken * BINS);
  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);

  let row = 0;
  for (let f = 0; f < frames && row < taken; f += stride, row++) {
    const start = f * HOP;
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = (input[start + i] || 0) * win[i];
      im[i] = 0;
    }
    fftInPlace(re, im, FFT_SIZE, false);
    const off = row * BINS;
    for (let b = 0; b < BINS; b++) mags[off + b] = Math.hypot(re[b], im[b]);
    if (row % 32 === 0) onProgress((row / taken) * 0.25);
  }

  // 20th-percentile magnitude per bin — the level the bin sits at when
  // nothing but noise is present.
  const noise = new Float32Array(BINS);
  const column = new Float32Array(row);
  const pIndex = Math.max(0, Math.min(row - 1, Math.floor(row * 0.2)));
  for (let b = 0; b < BINS; b++) {
    for (let f = 0; f < row; f++) column[f] = mags[f * BINS + b];
    column.sort();
    noise[b] = column[pIndex];
  }
  return noise;
}

/**
 * Pass 2 — stream every frame: FFT, gate, inverse FFT, overlap-add.
 *
 * Nothing bigger than the output signal is ever held in memory, so a 10-minute
 * file costs the same working set as a 10-second one.
 */
function processChannel(input, sampleRate, opts, onProgress) {
  const { reduction, strength, noiseType, preserveVoice } = opts;
  const win = hannWindow(FFT_SIZE);
  const frames = Math.max(1, Math.floor((input.length - FFT_SIZE) / HOP) + 1);

  const noise = estimateNoiseFloor(input, win, frames, onProgress);

  const weight = noiseWeighting(noiseType, sampleRate);
  const alpha = STRENGTH_ALPHA[strength] ?? STRENGTH_ALPHA.balanced;
  const floor = Math.max(0, 1 - reduction);
  const binHz = sampleRate / FFT_SIZE;
  const protectedFloor = floor + (1 - floor) * 0.55;

  const outLength = input.length;
  const out = new Float32Array(outLength);
  const norm = new Float32Array(outLength);

  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);
  const rowGain = new Float32Array(BINS);
  const smoothed = new Float32Array(BINS);
  const prevGain = new Float32Array(BINS).fill(1);

  for (let f = 0; f < frames; f++) {
    const start = f * HOP;
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = (input[start + i] || 0) * win[i];
      im[i] = 0;
    }
    fftInPlace(re, im, FFT_SIZE, false);

    for (let b = 0; b < BINS; b++) {
      const mag = Math.hypot(re[b], im[b]);
      const est = noise[b] * weight[b] * alpha;
      let g = mag > 1e-9 ? (mag - est) / mag : 0;
      if (g < floor) g = floor;
      if (g > 1) g = 1;
      if (preserveVoice) {
        const hz = b * binHz;
        if (hz >= 180 && hz <= 4200 && g < protectedFloor) g = protectedFloor;
      }
      rowGain[b] = g;
    }

    // 5-bin moving average across frequency — kills isolated "musical" bins.
    for (let b = 0; b < BINS; b++) {
      let sum = 0;
      let count = 0;
      for (let k = -2; k <= 2; k++) {
        const idx = b + k;
        if (idx >= 0 && idx < BINS) {
          sum += rowGain[idx];
          count++;
        }
      }
      let g = sum / count;
      // Asymmetric time smoothing: open quickly, close slowly.
      const prev = prevGain[b];
      g = g > prev ? prev + (g - prev) * 0.6 : prev + (g - prev) * 0.25;
      prevGain[b] = g;
      smoothed[b] = g;
    }

    // Apply the gain, then mirror for a real-valued inverse transform.
    for (let b = 0; b < BINS; b++) {
      re[b] *= smoothed[b];
      im[b] *= smoothed[b];
    }
    for (let b = 1; b < BINS - 1; b++) {
      re[FFT_SIZE - b] = re[b];
      im[FFT_SIZE - b] = -im[b];
    }
    fftInPlace(re, im, FFT_SIZE, true);

    for (let i = 0; i < FFT_SIZE; i++) {
      const pos = start + i;
      if (pos >= outLength) break;
      out[pos] += re[i] * win[i];
      norm[pos] += win[i] * win[i];
    }

    if (f % 64 === 0) onProgress(0.25 + (f / frames) * 0.75);
  }

  for (let i = 0; i < outLength; i++) if (norm[i] > 1e-8) out[i] /= norm[i];
  onProgress(1);
  return out;
}

self.onmessage = function (event) {
  const data = event.data;
  if (data.cmd !== 'denoise') return;

  try {
    const { channels, sampleRate, options } = data;
    const total = channels.length;
    const output = [];

    for (let c = 0; c < total; c++) {
      output.push(
        processChannel(channels[c], sampleRate, options, (p) => {
          self.postMessage({ type: 'progress', value: Math.round(((c + p) / total) * 100) });
        }),
      );
    }

    self.postMessage({ type: 'done', channels: output }, output.map((a) => a.buffer));
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err && err.message) || err) });
  }
};
