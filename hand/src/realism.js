/* ============================================================
   7Hand — the realism layer.

   Uniformity is what gets machine-written pages caught. But the
   obvious fix is also wrong: rolling an independent random
   number for every letter produces a "jitter texture" that reads
   as machine-made in a different way. Real handwriting DRIFTS.
   Slant, size and baseline wander together and slowly, because
   they all come from one hand getting tired, speeding up, or
   shifting grip. A letter is much more like the letter before it
   than like a letter ten words away.

   So there is one shared drift signal per hand, smoothed over
   time, and everything reads from it:

     independent noise          correlated drift (this file)
     a b c d e f g h            a b c d e f g h
     ↑ ↓ ↑ ↓ ↑ ↓ ↑ ↓            ↗ ↗ ↗ → ↘ ↘ → ↗
     random per letter          wanders, like a hand

   Everything is driven by a seed stored with the document. Without
   that, the preview and the export disagree and reopening a file
   changes the handwriting.
   ============================================================ */
'use strict';

/** mulberry32: small, fast, good enough, and identical across browsers. */
export function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Turn any string into a seed, so a document can be keyed by its own text. */
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * One hand's drift. An AR(1) walk: each step is mostly the previous value
 * plus a little noise, which is what makes it wander instead of flicker.
 *
 * `smoothness` near 1 drifts slowly over a whole line; near 0 collapses back
 * into per-letter noise, which is the thing we are avoiding.
 */
export function makeDrift(rand, { smoothness = 0.9 } = {}) {
  const k = Math.min(0.99, Math.max(0, smoothness));
  /* An AR(1) walk with unit noise settles at this standard deviation. Divide
     by it so the caller's amplitudes mean what they say. */
  const norm = Math.sqrt((1 - k) / (1 + k)) || 1;
  let slant = 0, size = 0, base = 0, pace = 0;

  const step1 = v => v * k + (rand() * 2 - 1) * (1 - k);

  return {
    step() {
      slant = step1(slant); size = step1(size); base = step1(base); pace = step1(pace);
      return { slant: slant / norm, size: size / norm, base: base / norm, pace: pace / norm };
    },
    /* A new line is a small reset — the hand returns to the margin and
       resettles — but not a full one, because fatigue carries over. */
    newLine() { slant *= 0.6; size *= 0.6; base = 0; pace *= 0.6; },
    peek() { return { slant: slant / norm, size: size / norm, base: base / norm, pace: pace / norm }; }
  };
}

/**
 * Pick which captured sample of a character to use.
 * Never the same one twice in a row for the same character: a doubled letter
 * ("ll", "oo", "ee") with two identical shapes is the single most obvious
 * tell on a page, and it is common enough in English to matter.
 */
export function makeVariantPicker(rand) {
  const last = new Map();
  return function pick(ch, count) {
    if (count <= 1) return 0;
    let i = Math.floor(rand() * count);
    if (i >= count) i = count - 1;
    if (last.get(ch) === i) i = (i + 1) % count;
    last.set(ch, i);
    return i;
  };
}

/** Default amplitudes. Deliberately small — overdone jitter reads as drunk. */
export const DEFAULT_JITTER = {
  slantDeg: 1.5,      // rotation, degrees
  sizePct: 0.02,      // scale, fraction
  baselineMm: 0.35,   // vertical wobble on the baseline
  spacePct: 0.18,     // word-space variation
  smoothness: 0.9
};

/**
 * Build the whole realism context for one document.
 * Returns the pieces layout needs, all fed by one seed.
 */
export function makeHand(seed, jitter = {}) {
  const j = { ...DEFAULT_JITTER, ...jitter };
  const rand = makeRng(seed);
  return {
    seed,
    jitter: j,
    rand,
    drift: makeDrift(rand, { smoothness: j.smoothness }),
    pickVariant: makeVariantPicker(rand)
  };
}
