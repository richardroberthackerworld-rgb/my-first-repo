/* =============================================================================
   Audiora — 6-stem separation worker (htdemucs_6s).

   This model has a far simpler contract than the 4-stem export:

       input   mix    [1, 2, 343980]
       output  stems  [1, 6, 2, 343980]     drums, bass, other, vocals, guitar, piano

   Everything (STFT, masking, inverse) happens inside the graph, so this worker
   only has to window the audio, run the model, and overlap-add the results.

   Long files are processed in overlapping segments with a triangular fade so
   segment joins are inaudible.
   ========================================================================== */

const ORT_BASE = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';
const MODEL_URL = 'https://huggingface.co/kramp/htdemucs-6s-webgpu-onnx/resolve/main/htdemucs_6s.onnx';
const CACHE_NAME = 'audiora-model-6s-v1';

const SEGMENT = 343980; // samples the graph expects, at 44100 Hz
const OVERLAP = 0.25;
const SOURCES = 6;

/** Model output order. Do NOT reorder — it is the graph's own layout. */
const STEM_ORDER = ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano'];

let ORT = null;
let session = null;
let phase = 'init';

/*
 * How many WASM threads to ask ONNX Runtime for.
 *
 * THE GATE: multi-threaded WASM needs SharedArrayBuffer, which needs the page
 * to be cross-origin isolated (COOP + COEP). That is deliberately OFF for this
 * site — see public/.htaccess — because isolation stops the audio encoder from
 * starting and breaks FLAC/M4A/OGG/AAC export. So in production this returns 1
 * and the separation runs single-threaded on the CPU, or on the GPU where the
 * device has one, which is the bigger win anyway.
 *
 * Everything below therefore only takes effect if isolation is ever enabled.
 * It is written properly so that turning the gate on is the only change needed.
 *
 * Choosing the number:
 *   · hardwareConcurrency is logical cores, which on a phone counts efficiency
 *     cores that will not help. Leaving one core free keeps the tab responsive
 *     and avoids scheduling against the browser's own threads.
 *   · Every thread carries a WASM stack and its share of the model's working
 *     set, so memory is the real ceiling on a small device. deviceMemory is
 *     coarse and browser-capped at 8, but it is enough to avoid asking a 4 GB
 *     machine for 32 threads.
 *   · Beyond about 64 the coordination cost exceeds the gain for a model this
 *     size, so that is the cap.
 */
function pickThreadCount() {
  try {
    if (!self.crossOriginIsolated) return 1;

    var MAX_THREADS = 64;

    var cores = (self.navigator && self.navigator.hardwareConcurrency) || 4;
    // Leave a core for the UI once there is more than a handful.
    var wanted = cores > 4 ? cores - 1 : cores;

    // deviceMemory is in GB, undefined on Safari and Firefox, and CLAMPED AT 8
    // by Chrome however much the machine really has — it exists to limit
    // fingerprinting, not to report RAM. So it is only useful as a low-memory
    // signal: a reported 8 means "8 or more" and must not become a ceiling, or
    // a 32-core workstation would be held to 16 threads.
    var memory = self.navigator && self.navigator.deviceMemory;
    if (typeof memory === 'number' && memory > 0 && memory < 8) {
      // Small device: roughly two threads per GB, so 2 GB gives 4 and 4 GB gives 8.
      wanted = Math.min(wanted, Math.max(2, Math.floor(memory * 2)));
    }

    return Math.max(1, Math.min(wanted, MAX_THREADS));
  } catch (e) {
    return 1;
  }
}

async function loadModel() {
  phase = 'engine-load';

  let hasGPU = false;
  try {
    hasGPU = !!(self.navigator && self.navigator.gpu && (await self.navigator.gpu.requestAdapter()));
  } catch (e) {
    hasGPU = false;
  }

  importScripts(ORT_BASE + (hasGPU ? 'ort.webgpu.min.js' : 'ort.wasm.min.js'));
  ORT = self.ort;
  ORT.env.wasm.wasmPaths = ORT_BASE;

  const threads = pickThreadCount();
  try {
    ORT.env.wasm.numThreads = threads;
  } catch (e) {
    /* single thread */
  }

  postMessage({ type: 'status', msg: 'Getting things ready' });
  phase = 'download';

  let cache = null;
  try {
    cache = await caches.open(CACHE_NAME);
  } catch (e) {
    cache = null;
  }

  let response = null;
  let fromCache = false;
  if (cache) {
    try {
      const hit = await cache.match(MODEL_URL);
      if (hit) {
        response = hit;
        fromCache = true;
      }
    } catch (e) {
      /* fall through to the network */
    }
  }
  if (!response) response = await fetch(MODEL_URL);
  if (!response || !response.ok) throw new Error('could not load the engine');

  // Stream it ourselves so progress is reported as it actually arrives.
  // Writing to the cache first (via response.clone()) would drain the whole
  // download before a single progress message could be sent, leaving the bar
  // frozen for the entire wait and then jumping straight to 100%.
  const total = parseInt(response.headers.get('content-length') || '0', 10);
  const reader = response.body.getReader();
  const parts = [];
  let got = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    parts.push(chunk.value);
    got += chunk.value.length;
    postMessage({ type: 'dl', got, total, cached: fromCache });
  }
  const bytes = new Uint8Array(got);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }

  // Store for next time, but never wait for it. Writing a few hundred MB can
  // take a long while when storage is near its quota, and the engine has no
  // reason to sit idle behind an optimisation.
  if (cache && !fromCache) {
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    Promise.resolve()
      .then(() => cache.put(MODEL_URL, new Response(copy, { headers: { 'Content-Type': 'application/octet-stream' } })))
      .catch(() => {
        /* over quota — still usable for this session */
      });
  }

  phase = 'engine-build';
  const options = { graphOptimizationLevel: 'basic', enableCpuMemArena: false, enableMemPattern: false };

  let usedEP = 'cpu';
  try {
    if (hasGPU) {
      session = await ORT.InferenceSession.create(bytes, { executionProviders: ['webgpu', 'wasm'], ...options });
      usedEP = 'gpu';
    } else {
      session = await ORT.InferenceSession.create(bytes, { executionProviders: ['wasm'], ...options });
    }
  } catch (e1) {
    // WebGPU can fail to compile on some drivers; WASM always works.
    session = await ORT.InferenceSession.create(bytes, { executionProviders: ['wasm'], ...options });
    usedEP = 'cpu';
  }

  postMessage({ type: 'loaded', ep: usedEP, threads, stems: STEM_ORDER });
}

async function separate(left, right, wanted) {
  phase = 'inference';

  const total = left.length;
  const stride = Math.floor(SEGMENT * (1 - OVERLAP));
  const segments = Math.max(1, Math.ceil(Math.max(0, total - SEGMENT) / stride) + 1);

  // Only allocate the stems the caller actually asked for.
  const keep = wanted && wanted.length ? wanted : STEM_ORDER;
  const wantedIndexes = keep.map((name) => STEM_ORDER.indexOf(name)).filter((i) => i >= 0);

  const out = {};
  for (const index of wantedIndexes) {
    out[index] = { L: new Float32Array(total), R: new Float32Array(total) };
  }
  const weights = new Float32Array(total);

  const segL = new Float32Array(SEGMENT);
  const segR = new Float32Array(SEGMENT);
  const feed = new Float32Array(2 * SEGMENT);

  let done = 0;
  for (let start = 0; start < total; start += stride) {
    const end = Math.min(start + SEGMENT, total);
    const length = end - start;

    segL.fill(0);
    segR.fill(0);
    for (let i = 0; i < length; i++) {
      segL[i] = left[start + i];
      segR[i] = right[start + i];
    }
    feed.set(segL, 0);
    feed.set(segR, SEGMENT);

    const tensor = new ORT.Tensor('float32', feed, [1, 2, SEGMENT]);
    const feeds = {};
    feeds[session.inputNames[0]] = tensor;
    const result = await session.run(feeds);

    const stemsTensor = result[session.outputNames[0]];
    const data = stemsTensor.data;
    const dims = stemsTensor.dims; // [1, 6, 2, SEGMENT]
    const perSource = dims[2] * dims[3];
    const perChannel = dims[3];

    // Triangular window across the overlap so joins cross-fade cleanly.
    const ramp = Math.max(1, Math.floor(stride * 0.5));
    for (const index of wantedIndexes) {
      const dstL = out[index].L;
      const dstR = out[index].R;
      const baseL = index * perSource;
      const baseR = baseL + perChannel;
      for (let i = 0; i < length; i++) {
        const fadeIn = Math.min(i / ramp, 1);
        const fadeOut = Math.min((length - i) / ramp, 1);
        const w = Math.min(fadeIn, fadeOut);
        dstL[start + i] += data[baseL + i] * w;
        dstR[start + i] += data[baseR + i] * w;
      }
    }
    for (let i = 0; i < length; i++) {
      const fadeIn = Math.min(i / ramp, 1);
      const fadeOut = Math.min((length - i) / ramp, 1);
      weights[start + i] += Math.min(fadeIn, fadeOut);
    }

    done++;
    postMessage({ type: 'sep', value: Math.min(99, Math.round((done / segments) * 100)) });
    if (end >= total) break;
  }

  for (const index of wantedIndexes) {
    const dstL = out[index].L;
    const dstR = out[index].R;
    for (let i = 0; i < total; i++) {
      const w = weights[i];
      if (w > 1e-6) {
        dstL[i] /= w;
        dstR[i] /= w;
      }
    }
  }

  const payload = { type: 'done', stems: {} };
  const transfer = [];
  for (const index of wantedIndexes) {
    const name = STEM_ORDER[index];
    payload.stems[name] = { L: out[index].L, R: out[index].R };
    transfer.push(out[index].L.buffer, out[index].R.buffer);
  }
  postMessage(payload, transfer);
}

self.onmessage = async function (event) {
  const data = event.data;
  try {
    if (data.cmd === 'load') {
      await loadModel();
    } else if (data.cmd === 'sep') {
      await separate(data.L, data.R, data.wanted);
    }
  } catch (err) {
    // The UI shows a friendly message; the detail stays here for the console.
    postMessage({ type: 'error', message: '[' + phase + '] ' + String((err && err.message) || err) });
  }
};
