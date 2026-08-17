/* ============================================================
   7Hand — bitmap to vector.

   Three stages, each usable on its own:

     mask ──► traceContours ──► rdp ──► fitBeziers ──► SVG path
     1-bit    pixel-edge        thin     smooth
              staircase loops   out      curves

   No external library. A general-purpose tracer is built for
   colour photographs — palette quantization, layer separation,
   noise models — and we feed it one letter in pure black and
   white. It would also be a CDN dependency, and this repo has
   already been bitten once by a CDN library hanging on Indian
   ISPs (see videotools/app.js). The boundary walk below is also
   what the v2 plotter's skeletonizer will build on.

   BOUNDARIES ARE WALKED ALONG PIXEL EDGES, not pixel centres.
   Every filled pixel contributes an edge for each side that
   faces background, and those directed edges are stitched into
   closed loops. This falls out correctly for holes and for
   disjoint parts without any special casing, and every loop is
   closed by construction.

        pixel (x,y)          emitted edges (interior on the right)
        ┌───────┐            top     (x,y)     → (x+1,y)
        │       │            right   (x+1,y)   → (x+1,y+1)
        │  ███  │            bottom  (x+1,y+1) → (x,y+1)
        │       │            left    (x,y+1)   → (x,y)
        └───────┘
   ============================================================ */
'use strict';

/* ---------- small vector helpers -------------------------------------- */

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a, s) => ({ x: a.x * s, y: a.y * s });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const len = a => Math.hypot(a.x, a.y);

function normalize(a) {
  const l = Math.hypot(a.x, a.y);
  /* A zero-length tangent means two identical points slipped through.
     Returning a unit x instead of NaN keeps one duplicated point from
     poisoning an entire glyph's curve fit. */
  return l < 1e-12 ? { x: 1, y: 0 } : { x: a.x / l, y: a.y / l };
}

/* ---------- stage 1: contour extraction -------------------------------- */

/**
 * Walk the boundaries of a 1-bit mask.
 *
 * Returns an array of { pts, area, outer }, where `pts` is a closed loop of
 * lattice points (the closing point is not repeated), `area` is the signed
 * shoelace area, and `outer` is true for the outside of a shape and false
 * for a hole.
 *
 * `minArea` drops specks. A single stray pixel has area 1, so the default of
 * 2 removes scanner dust without touching the dot of an i (which is several
 * pixels across at any usable resolution).
 */
export function traceContours(mask, w, h, { minArea = 2 } = {}) {
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : (mask[y * w + x] ? 1 : 0);
  const vkey = (x, y) => y * (w + 1) + x;

  const edges = [];                       // { x0,y0,x1,y1 }
  const outgoing = new Map();             // vertex key -> edge indices

  const emit = (x0, y0, x1, y1) => {
    const i = edges.length;
    edges.push({ x0, y0, x1, y1 });
    const k = vkey(x0, y0);
    const list = outgoing.get(k);
    if (list) list.push(i); else outgoing.set(k, [i]);
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!at(x, y)) continue;
      if (!at(x, y - 1)) emit(x, y, x + 1, y);
      if (!at(x + 1, y)) emit(x + 1, y, x + 1, y + 1);
      if (!at(x, y + 1)) emit(x + 1, y + 1, x, y + 1);
      if (!at(x - 1, y)) emit(x, y + 1, x, y);
    }
  }

  const used = new Uint8Array(edges.length);
  const contours = [];

  for (let seed = 0; seed < edges.length; seed++) {
    if (used[seed]) continue;

    const pts = [];
    let ei = seed;
    let guard = edges.length + 4;         // a malformed map must not spin forever

    while (ei >= 0 && !used[ei] && guard-- > 0) {
      used[ei] = 1;
      const e = edges[ei];
      pts.push({ x: e.x0, y: e.y0 });

      const dir = { x: e.x1 - e.x0, y: e.y1 - e.y0 };
      const list = outgoing.get(vkey(e.x1, e.y1));
      ei = list ? pickNext(list, edges, used, dir) : -1;
    }

    if (pts.length < 3) continue;
    const area = shoelace(pts);
    if (Math.abs(area) < minArea) continue;
    contours.push({ pts, area, outer: area > 0 });
  }

  return contours;
}

/**
 * Choose the next edge at a vertex.
 *
 * Normally exactly one edge leaves a vertex and this is trivial. It only
 * matters at a saddle — two filled pixels touching corner to corner with
 * background on the other diagonal. Preferring the left turn keeps those
 * two pixels inside one contour, which is what we want: a thin diagonal pen
 * stroke that touches only at corners is one stroke, not a dotted line of
 * separate blobs.
 *
 * In screen coordinates (y increasing downwards) a left turn on (dx,dy) is
 * (dy,-dx) and a right turn is (-dy,dx). Reversing is never a candidate.
 */
function pickNext(list, edges, used, dir) {
  const prefs = [
    { x: dir.y, y: -dir.x },   // left
    { x: dir.x, y: dir.y },    // straight
    { x: -dir.y, y: dir.x }    // right
  ];
  for (const p of prefs) {
    for (const i of list) {
      if (used[i]) continue;
      const e = edges[i];
      if (e.x1 - e.x0 === p.x && e.y1 - e.y0 === p.y) return i;
    }
  }
  return -1;
}

/** Signed area. Positive for an outer boundary, negative for a hole. */
export function shoelace(pts) {
  let s = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/* ---------- stage 2: Ramer-Douglas-Peucker ----------------------------- */

function perpDistance(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function rdpOpen(pts, eps) {
  if (pts.length < 3) return pts.slice();
  let worst = 0, idx = 0;
  const a = pts[0], b = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDistance(pts[i], a, b);
    if (d > worst) { worst = d; idx = i; }
  }
  if (worst <= eps) return [a, b];
  const left = rdpOpen(pts.slice(0, idx + 1), eps);
  const right = rdpOpen(pts.slice(idx), eps);
  return left.slice(0, -1).concat(right);
}

/**
 * Simplify a polyline. Closed loops are handled by anchoring two points that
 * are far apart before splitting, because plain RDP on a loop whose first and
 * last point coincide has a zero-length baseline and collapses the whole
 * thing to nothing.
 */
export function rdp(pts, eps, closed = true) {
  if (pts.length < 3) return pts.slice();
  if (!closed) return rdpOpen(pts, eps);

  /* Anchor A: farthest from pts[0]. Anchor B: farthest from A. */
  let ai = 0, best = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[0].x, pts[i].y - pts[0].y);
    if (d > best) { best = d; ai = i; }
  }
  let bi = 0; best = -1;
  for (let i = 0; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[ai].x, pts[i].y - pts[ai].y);
    if (d > best) { best = d; bi = i; }
  }
  if (ai === bi) return pts.slice();

  const lo = Math.min(ai, bi), hi = Math.max(ai, bi);
  const chainA = pts.slice(lo, hi + 1);
  const chainB = pts.slice(hi).concat(pts.slice(0, lo + 1));
  const outA = rdpOpen(chainA, eps);
  const outB = rdpOpen(chainB, eps);
  const merged = outA.slice(0, -1).concat(outB.slice(0, -1));
  if (merged.length >= 3) return merged;

  /* Epsilon was large enough to flatten the loop into a line. Fewer than
     three points enclose no area, so the glyph would render as an invisible
     hairline rather than a letter. Keep a third anchor — the point farthest
     from the A-B chord — so detail is lost (which is what a large epsilon
     asks for) but the shape survives. */
  let ci = -1, far = -1;
  for (let i = 0; i < pts.length; i++) {
    const d = perpDistance(pts[i], pts[ai], pts[bi]);
    if (d > far) { far = d; ci = i; }
  }
  const idx = [...new Set([lo, hi, ci])].sort((a, b) => a - b);
  return idx.length >= 3 ? idx.map(i => pts[i]) : pts.slice();
}

/* ---------- stage 3: cubic bezier fitting ------------------------------ */

/**
 * Corner indices in a closed polyline: vertices where the direction changes
 * by more than `cornerAngle` radians. Corners must survive fitting — the
 * bottom of a v and the join of an x are corners, and smoothing them into
 * curves is instantly readable as "not handwriting".
 */
export function findCorners(pts, cornerAngle = Math.PI / 3) {
  const n = pts.length;
  const corners = [];
  if (n < 3) return corners;
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n], cur = pts[i], next = pts[(i + 1) % n];
    const a = normalize(sub(cur, prev));
    const b = normalize(sub(next, cur));
    const turn = Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
    if (turn > cornerAngle) corners.push(i);
  }
  return corners;
}

function bezierAt(bez, t) {
  const mt = 1 - t;
  const a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
  return {
    x: a * bez[0].x + b * bez[1].x + c * bez[2].x + d * bez[3].x,
    y: a * bez[0].y + b * bez[1].y + c * bez[2].y + d * bez[3].y
  };
}

/** Chord-length parameterisation, normalised to 0..1. */
function parameterize(pts) {
  const u = [0];
  for (let i = 1; i < pts.length; i++) u.push(u[i - 1] + len(sub(pts[i], pts[i - 1])));
  const total = u[u.length - 1];
  if (total === 0) return pts.map((_, i) => i / (pts.length - 1 || 1));
  return u.map(v => v / total);
}

/* Least-squares control points for fixed endpoints and end tangents. */
function generateBezier(pts, u, tHat1, tHat2) {
  const n = pts.length;
  const first = pts[0], last = pts[n - 1];
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;

  for (let i = 0; i < n; i++) {
    const t = u[i], mt = 1 - t;
    const b0 = mt * mt * mt, b1 = 3 * mt * mt * t, b2 = 3 * mt * t * t, b3 = t * t * t;
    const a1 = mul(tHat1, b1);
    const a2 = mul(tHat2, b2);
    c00 += dot(a1, a1);
    c01 += dot(a1, a2);
    c11 += dot(a2, a2);
    const tmp = sub(pts[i], {
      x: first.x * (b0 + b1) + last.x * (b2 + b3),
      y: first.y * (b0 + b1) + last.y * (b2 + b3)
    });
    x0 += dot(a1, tmp);
    x1 += dot(a2, tmp);
  }

  const det = c00 * c11 - c01 * c01;
  let alphaL, alphaR;
  if (Math.abs(det) < 1e-12) {
    alphaL = alphaR = 0;
  } else {
    alphaL = (x0 * c11 - x1 * c01) / det;
    alphaR = (c00 * x1 - c01 * x0) / det;
  }

  /* Negative or absurd alphas mean the least-squares solution folded the
     curve back on itself. Fall back to the standard third-of-the-chord
     heuristic, which is never beautiful but is never wrong either. */
  const segLen = len(sub(last, first));
  if (alphaL < 1e-6 || alphaR < 1e-6 || alphaL > segLen * 3 || alphaR > segLen * 3) {
    const third = segLen / 3;
    alphaL = alphaR = third;
  }

  return [first, add(first, mul(tHat1, alphaL)), add(last, mul(tHat2, alphaR)), last];
}

function maxError(pts, bez, u) {
  let worst = 0, idx = Math.floor(pts.length / 2);
  for (let i = 1; i < pts.length - 1; i++) {
    const d = len(sub(bezierAt(bez, u[i]), pts[i]));
    if (d > worst) { worst = d; idx = i; }
  }
  return { worst, idx };
}

/* One Newton-Raphson step pulling each sample toward its true nearest t. */
function reparameterize(pts, bez, u) {
  return u.map((t, i) => {
    const p = pts[i];
    const d = bezierAt(bez, t);
    const mt = 1 - t;
    const q1 = [
      mul(sub(bez[1], bez[0]), 3),
      mul(sub(bez[2], bez[1]), 3),
      mul(sub(bez[3], bez[2]), 3)
    ];
    const d1 = {
      x: mt * mt * q1[0].x + 2 * mt * t * q1[1].x + t * t * q1[2].x,
      y: mt * mt * q1[0].y + 2 * mt * t * q1[1].y + t * t * q1[2].y
    };
    const q2 = [mul(sub(q1[1], q1[0]), 2), mul(sub(q1[2], q1[1]), 2)];
    const d2 = { x: mt * q2[0].x + t * q2[1].x, y: mt * q2[0].y + t * q2[1].y };
    const diff = sub(d, p);
    const num = dot(diff, d1);
    const den = dot(d1, d1) + dot(diff, d2);
    if (Math.abs(den) < 1e-12) return t;
    const next = t - num / den;
    return next < 0 ? 0 : next > 1 ? 1 : next;
  });
}

function fitCubic(pts, tHat1, tHat2, tol, out, depth = 0) {
  if (pts.length === 2) {
    const third = len(sub(pts[1], pts[0])) / 3;
    out.push([pts[0], add(pts[0], mul(tHat1, third)), add(pts[1], mul(tHat2, third)), pts[1]]);
    return;
  }

  let u = parameterize(pts);
  let bez = generateBezier(pts, u, tHat1, tHat2);
  let { worst, idx } = maxError(pts, bez, u);

  if (worst < tol) { out.push(bez); return; }

  /* Close enough to be worth refining rather than splitting. */
  if (worst < tol * 4 && depth < 8) {
    for (let i = 0; i < 3; i++) {
      u = reparameterize(pts, bez, u);
      bez = generateBezier(pts, u, tHat1, tHat2);
      ({ worst, idx } = maxError(pts, bez, u));
      if (worst < tol) { out.push(bez); return; }
    }
  }

  /* Recursion guard: a pathological run must degrade to more segments, not
     blow the stack. */
  if (depth > 16 || idx <= 0 || idx >= pts.length - 1) { out.push(bez); return; }

  const centre = normalize(sub(pts[idx + 1], pts[idx - 1]));
  fitCubic(pts.slice(0, idx + 1), tHat1, mul(centre, -1), tol, out, depth + 1);
  fitCubic(pts.slice(idx), centre, tHat2, tol, out, depth + 1);
}

/**
 * Fit a closed polyline with cubic beziers, preserving corners.
 * Returns an array of [p0, c1, c2, p3] control-point quads.
 */
export function fitBeziers(pts, { tolerance = 0.8, cornerAngle = Math.PI / 3 } = {}) {
  const n = pts.length;
  if (n < 2) return [];
  if (n === 2) {
    const t = normalize(sub(pts[1], pts[0]));
    const out = [];
    fitCubic(pts, t, mul(t, -1), tolerance, out);
    return out;
  }

  const corners = findCorners(pts, cornerAngle);
  const out = [];

  if (corners.length === 0) {
    /* Smooth closed loop: cut it anywhere and match tangents across the seam
       so the join does not develop a crease. */
    const run = pts.concat([pts[0]]);
    const seam = normalize(sub(pts[1], pts[n - 1]));
    fitCubic(run, seam, mul(seam, -1), tolerance, out);
    return out;
  }

  for (let c = 0; c < corners.length; c++) {
    const start = corners[c];
    const end = corners[(c + 1) % corners.length];
    const run = [];
    let i = start;
    for (;;) {
      run.push(pts[i]);
      if (i === end && run.length > 1) break;
      i = (i + 1) % n;
      if (run.length > n) break;             // defensive: never loop forever
    }
    if (run.length < 2) continue;
    const t1 = normalize(sub(run[1], run[0]));
    const t2 = normalize(sub(run[run.length - 2], run[run.length - 1]));
    fitCubic(run, t1, t2, tolerance, out);
  }
  return out;
}

/* ---------- output ----------------------------------------------------- */

const r = v => Math.round(v * 100) / 100;

/** Bezier quads to an SVG path fragment. */
export function beziersToPath(curves) {
  if (!curves.length) return '';
  let d = `M${r(curves[0][0].x)},${r(curves[0][0].y)}`;
  for (const c of curves) {
    d += `C${r(c[1].x)},${r(c[1].y)} ${r(c[2].x)},${r(c[2].y)} ${r(c[3].x)},${r(c[3].y)}`;
  }
  return d + 'Z';
}

/**
 * Whole pipeline: mask to bezier contours.
 *
 * This is the shared representation. Emitters for SVG and for PDF both read
 * it, so a glyph is traced once no matter how many ways it gets drawn — and
 * the two outputs cannot drift apart, which is the failure that would make a
 * printed page differ from its preview.
 */
export function maskToCurves(mask, w, h, opts = {}) {
  const { epsilon = 0.6, tolerance = 0.8, cornerAngle = Math.PI / 3, minArea = 2 } = opts;
  const out = [];
  for (const c of traceContours(mask, w, h, { minArea })) {
    const simplified = rdp(c.pts, epsilon, true);
    if (simplified.length < 2) continue;
    const curves = fitBeziers(simplified, { tolerance, cornerAngle });
    if (curves.length) out.push({ outer: c.outer, curves });
  }
  return out;
}

/**
 * Mask to an SVG path string.
 * Holes come out with opposite winding to their enclosing shape, so the path
 * renders correctly with the default nonzero fill rule and the counter of an
 * "a" stays open.
 */
export function maskToPath(mask, w, h, opts = {}) {
  return maskToCurves(mask, w, h, opts).map(c => beziersToPath(c.curves)).join('');
}

/** The tracer in the shape store.ensureContours() expects. */
export function traceForStore(mask, w, h, opts = {}) {
  const { epsilon = 0.6, tolerance = 0.8, cornerAngle = Math.PI / 3, minArea = 2 } = opts;
  return traceContours(mask, w, h, { minArea }).map(c => ({
    outer: c.outer,
    curves: fitBeziers(rdp(c.pts, epsilon, true), { tolerance, cornerAngle })
      .map(q => q.map(p => [r(p.x), r(p.y)]))
  }));
}
