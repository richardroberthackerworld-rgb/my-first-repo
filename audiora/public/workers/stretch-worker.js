/* =============================================================================
   Audiora — WSOLA time-stretch worker.

   Stretches audio in time without changing pitch. The pitch shifter stretches
   by one factor and then resamples by another; the two together move pitch and
   leave duration alone.

   Plain overlap-add drops each grain at a fixed position, so neighbouring
   grains overlap out of phase and partially cancel — on tonal material that
   costs well over 10 dB and sounds thin and phasey. WSOLA nudges each grain
   within a small window to the offset that best continues the waveform already
   written, which removes essentially all of that loss.

   The alignment search is coarse-to-fine: a wide sweep at a coarse step, then a
   short exact sweep around the winner. That keeps the cost near linear while
   staying sample-accurate.

   Runs on the user's machine. No audio is transmitted anywhere.
   ========================================================================== */

const GRAIN_MS = { fast: 40, balanced: 70, high: 110 };

function hannWindow(size) {
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  return w;
}

function stretchChannel(input, speed, sampleRate, quality, onProgress) {
  if (Math.abs(speed - 1) < 1e-4) {
    const copy = new Float32Array(input.length);
    copy.set(input);
    onProgress(1);
    return copy;
  }

  const grain = Math.max(256, Math.round(((GRAIN_MS[quality] ?? GRAIN_MS.balanced) / 1000) * sampleRate));
  const synthesisHop = Math.floor(grain / 4);
  const analysisHop = Math.max(1, Math.round(synthesisHop * speed));
  const outLength = Math.max(1, Math.ceil(input.length / speed) + grain);

  const out = new Float32Array(outLength);
  const norm = new Float32Array(outLength);
  const win = hannWindow(grain);

  // Radius covers a low male fundamental (~80 Hz) without growing with grain.
  const searchRadius = Math.min(512, Math.max(8, Math.floor(sampleRate / 80)));
  const corrLength = Math.min(192, grain - synthesisHop);
  const coarseStep = 8;

  /** Score one candidate read position by normalised correlation. */
  function score(candidate, referenceStart) {
    let dot = 0;
    let energy = 1e-9;
    for (let i = 0; i < corrLength; i++) {
      const c = input[candidate + i];
      dot += input[referenceStart + i] * c;
      energy += c * c;
    }
    // Normalised, so a merely louder candidate cannot win on volume alone.
    return dot / Math.sqrt(energy);
  }

  function align(target, previous) {
    if (previous < 0) return target;
    const referenceStart = previous + synthesisHop;
    if (referenceStart + corrLength >= input.length) return target;

    let bestScore = -Infinity;
    let bestPos = target;

    // Coarse sweep across the whole search window.
    for (let delta = -searchRadius; delta <= searchRadius; delta += coarseStep) {
      const candidate = target + delta;
      if (candidate < 0 || candidate + corrLength >= input.length) continue;
      const s = score(candidate, referenceStart);
      if (s > bestScore) {
        bestScore = s;
        bestPos = candidate;
      }
    }

    // Fine sweep around the winner, for sample-accurate alignment.
    const from = bestPos - coarseStep + 1;
    const to = bestPos + coarseStep - 1;
    for (let candidate = from; candidate <= to; candidate++) {
      if (candidate < 0 || candidate + corrLength >= input.length) continue;
      const s = score(candidate, referenceStart);
      if (s > bestScore) {
        bestScore = s;
        bestPos = candidate;
      }
    }

    return bestPos;
  }

  let readPos = 0;
  let previousRead = -1;
  let writePos = 0;
  let grainIndex = 0;
  const expectedGrains = Math.max(1, Math.ceil(input.length / analysisHop));

  while (readPos + grain < input.length && writePos + grain < outLength) {
    for (let i = 0; i < grain; i++) {
      const w = win[i];
      out[writePos + i] += input[readPos + i] * w;
      norm[writePos + i] += w;
    }
    previousRead = readPos;
    writePos += synthesisHop;
    readPos = align(previousRead + analysisHop, previousRead);

    grainIndex++;
    if (grainIndex % 48 === 0) onProgress(Math.min(0.99, grainIndex / expectedGrains));
  }

  const end = Math.min(outLength, writePos + grain);
  for (let i = 0; i < end; i++) if (norm[i] > 1e-6) out[i] /= norm[i];

  onProgress(1);
  const result = new Float32Array(end);
  result.set(out.subarray(0, end));
  return result;
}

self.onmessage = function (event) {
  const data = event.data;
  if (data.cmd !== 'stretch') return;

  try {
    const { channels, speed, sampleRate, quality } = data;
    const total = channels.length;
    const output = [];

    for (let c = 0; c < total; c++) {
      output.push(
        stretchChannel(channels[c], speed, sampleRate, quality, (p) => {
          self.postMessage({ type: 'progress', value: Math.round(((c + p) / total) * 100) });
        }),
      );
    }

    self.postMessage({ type: 'done', channels: output }, output.map((a) => a.buffer));
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err && err.message) || err) });
  }
};
