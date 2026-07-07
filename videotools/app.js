/* ============================================================
   VidLab shared helpers — ffmpeg.wasm loader + UI utilities
   All processing is client-side; nothing is uploaded anywhere.
   ============================================================ */

/* Two independent CDNs; if the first stalls or is blocked (unpkg is flaky on
   some networks), the loader falls back to the second automatically. */
const FF_CDNS = [
  {
    name: 'jsDelivr',
    ffmpeg: 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/umd',
    util:   'https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/umd',
    // ESM core (not UMD): the class worker is a module worker, so the core is
    // pulled in via dynamic import() and must have a default export.
    core:   'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm',
  },
  {
    name: 'unpkg',
    ffmpeg: 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/umd',
    util:   'https://unpkg.com/@ffmpeg/util@0.12.1/dist/umd',
    core:   'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm',
  },
];

let _ffmpegInstance = null;
let _ffmpegLoading = null;
let _ffPreflightOk = false;

/* FFmpeg boots inside a module worker created from a blob: URL that then
   dynamic-imports the (blob) core. When that's blocked — file:// pages,
   strict security modes, some privacy extensions — the worker dies silently
   and load() hangs. Detect those cases up front with a real answer. */
async function _ffPreflight() {
  if (_ffPreflightOk) return;
  if (typeof WebAssembly === 'undefined' || !WebAssembly.instantiate) {
    throw new Error('This browser does not support WebAssembly, which this tool needs. Use a current version of Chrome, Edge, Firefox or Safari (and turn off strict/enhanced security mode for this site).');
  }
  const coreURL = URL.createObjectURL(new Blob(['export default 1;'], { type: 'text/javascript' }));
  const workerURL = URL.createObjectURL(new Blob(
    [`import(${JSON.stringify(coreURL)}).then(m => self.postMessage(m.default), e => self.postMessage('ERR:' + e.message));`],
    { type: 'text/javascript' }
  ));
  try {
    await new Promise((res, rej) => {
      let w = null;
      const t = setTimeout(() => { if (w) w.terminate(); rej(new Error('worker start timed out')); }, 8000);
      try { w = new Worker(workerURL, { type: 'module' }); }
      catch (e) { clearTimeout(t); rej(e); return; }
      w.onmessage = ev => { clearTimeout(t); w.terminate(); ev.data === 1 ? res() : rej(new Error(String(ev.data))); };
      w.onerror = ev => { clearTimeout(t); w.terminate(); rej(new Error((ev && ev.message) || 'worker failed to start')); };
    });
    _ffPreflightOk = true;
  } catch (e) {
    if (location.protocol === 'file:') {
      throw new Error('This tool cannot run from a page opened as a local file (file://) — the browser blocks the background worker it needs. Serve the folder over http(s) (any web host, or locally e.g. "npx serve") and open it from there.');
    }
    throw new Error('Your browser blocked the background worker this tool runs in (' + (e && e.message) + '). This is usually a strict privacy/security extension or the browser’s enhanced security mode — allow this site, or try another browser.');
  } finally {
    URL.revokeObjectURL(coreURL);
    URL.revokeObjectURL(workerURL);
  }
}

/* Fetch with real progress + stall watchdog. Rejects if the connection sits
   idle (no new bytes) for `stallMs` — a hung CDN must fail, not hang the UI. */
async function _ffFetchBlob(url, onBytes, { firstByteMs = 20000, stallMs = 15000 } = {}) {
  const cacheName = 'vidlab-ffmpeg-v1';
  try {
    const cache = await caches.open(cacheName);
    const hit = await cache.match(url);
    if (hit) return await hit.blob();
  } catch (_) { /* Cache API unavailable (http://, private mode) — network only */ }

  const ctrl = new AbortController();
  let watchdog = setTimeout(() => ctrl.abort(), firstByteMs);
  const res = await fetch(url, { signal: ctrl.signal });
  if (!res.ok) { clearTimeout(watchdog); throw new Error('HTTP ' + res.status + ' for ' + url); }

  const total = +res.headers.get('Content-Length') || 0;
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => ctrl.abort(), stallMs);
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onBytes && onBytes(received, total);
  }
  clearTimeout(watchdog);

  // a truncated file must never be cached — it would brick every later run
  if (total && received !== total) {
    throw new Error('download incomplete (' + received + ' of ' + total + ' bytes) for ' + url);
  }

  const blob = new Blob(chunks);
  try {
    const cache = await caches.open(cacheName);
    await cache.put(url, new Response(blob, { headers: { 'Content-Length': String(blob.size) } }));
  } catch (_) { /* best-effort cache */ }
  return blob;
}

/* Drop this CDN's cached engine files — used when the engine fails to start
   from them, so the retry re-downloads fresh copies instead of reusing a
   possibly corrupt cache entry forever. */
async function _ffPurgeCache(urls) {
  try {
    const cache = await caches.open('vidlab-ffmpeg-v1');
    for (const u of urls) await cache.delete(u);
  } catch (_) { /* Cache API unavailable */ }
}

/* Make sure the UMD libraries themselves exist. They are injected on demand
   (no static <script> tags — those would block page render on a stalled CDN),
   trying each CDN in turn with a timeout so a hung host fails over. */
function _ffEnsureLibs() {
  const inject = (src, timeoutMs = 20000) => new Promise((res, rej) => {
    const s = document.createElement('script');
    const t = setTimeout(() => { s.remove(); rej(new Error('script timed out: ' + src)); }, timeoutMs);
    s.src = src;
    s.onload = () => { clearTimeout(t); res(); };
    s.onerror = () => { clearTimeout(t); s.remove(); rej(new Error('script failed: ' + src)); };
    document.head.appendChild(s);
  });
  const ensure = (globalName, file) => async () => {
    if (window[globalName]) return;
    for (const cdn of FF_CDNS) {
      try { await inject(`${cdn[file.pkg]}/${file.name}`); if (window[globalName]) return; }
      catch (_) { /* try next CDN */ }
    }
    throw new Error(globalName + ' library could not be loaded from any CDN');
  };
  return Promise.all([
    ensure('FFmpegWASM', { pkg: 'ffmpeg', name: 'ffmpeg.js' })(),
    ensure('FFmpegUtil', { pkg: 'util', name: 'index.js' })(),
  ]);
}

/**
 * Lazily load and cache a single-threaded ffmpeg.wasm instance.
 * Single-thread core needs no SharedArrayBuffer / COOP-COEP headers,
 * so it works on plain static hosting (cPanel).
 *
 * Resilience: streams with progress + stall detection, falls back across
 * CDNs, persists the ~31 MB core in the Cache API so later visits load
 * instantly even if every CDN is down, and times out a hung worker init.
 */
async function getFFmpeg(onStatus) {
  if (_ffmpegInstance) return _ffmpegInstance;
  if (_ffmpegLoading) return _ffmpegLoading;

  _ffmpegLoading = (async () => {
    await _ffPreflight();
    await _ffEnsureLibs();
    const { FFmpeg } = FFmpegWASM;

    let lastErr = null;
    for (const cdn of FF_CDNS) {
      const urls = [`${cdn.core}/ffmpeg-core.js`, `${cdn.core}/ffmpeg-core.wasm`, `${cdn.ffmpeg}/814.ffmpeg.js`];
      let ffmpeg = null;
      let downloaded = false;
      try {
        const label = 'Setting things up — one-time only, saved for next time';
        onStatus && onStatus(label + '…');
        const prog = (received, total) => {
          const pct = total ? ' ' + Math.round(received / total * 100) + '%' : '';
          onStatus && onStatus(`${label}…${pct}`);
        };
        const [coreBlob, wasmBlob, workerBlob] = [
          await _ffFetchBlob(urls[0]),
          await _ffFetchBlob(urls[1], prog),
          // worker chunk must be loaded via blob to allow cross-origin CDN use
          await _ffFetchBlob(urls[2]),
        ];
        downloaded = true;
        onStatus && onStatus('Almost ready…');
        ffmpeg = new FFmpeg();
        const loadP = ffmpeg.load({
          coreURL: URL.createObjectURL(new Blob([await coreBlob.arrayBuffer()], { type: 'text/javascript' })),
          wasmURL: URL.createObjectURL(new Blob([await wasmBlob.arrayBuffer()], { type: 'application/wasm' })),
          classWorkerURL: URL.createObjectURL(new Blob([await workerBlob.arrayBuffer()], { type: 'text/javascript' })),
        });
        await Promise.race([
          loadP,
          new Promise((_, rej) => setTimeout(() => rej(new Error('engine start timed out')), 60000)),
        ]);
        _ffmpegInstance = ffmpeg;
        return ffmpeg;
      } catch (err) {
        console.warn('[VidLab] FFmpeg load via ' + cdn.name + ' failed:', err);
        lastErr = err;
        try { if (ffmpeg) ffmpeg.terminate(); } catch (_) { /* not started */ }
        // files downloaded fine but the engine wouldn't start from them —
        // don't trust the cached copies on the next attempt
        if (downloaded) await _ffPurgeCache(urls);
      }
    }
    throw new Error(
      'Could not start the processing engine (' + (lastErr && lastErr.message) + '). ' +
      'Check your internet connection or disable ad/script blockers for this page, then click the button again to retry.'
    );
  })();

  try {
    return await _ffmpegLoading;
  } finally {
    _ffmpegLoading = null;
  }
}

async function ffFetchFile(file) {
  return FFmpegUtil.fetchFile(file);
}

/* ---------- generic helpers ---------- */

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
  return bytes.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

function formatTime(sec) {
  if (!isFinite(sec)) return '0:00';
  sec = Math.max(0, sec);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function parseTimeInput(v, fallback) {
  if (v == null || v === '') return fallback;
  const parts = String(v).trim().split(':').map(Number);
  if (parts.some(isNaN)) return fallback;
  let s = 0;
  for (const p of parts) s = s * 60 + p;
  return s;
}

function downloadBlob(blob, filename) {
  // every download from the site carries the 7by.in name
  const ext = ((filename || '').match(/\.[^.]+$/) || ['.dat'])[0];
  filename = 'Downloaded from 7by.in' + ext;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function baseName(name) {
  return (name || 'video').replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '_').slice(0, 60) || 'video';
}

/* ---------- error toast (non-blocking alternative to alert) ---------- */

function toastError(msg) {
  let host = document.getElementById('vl-toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'vl-toast-host';
    host.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;gap:8px;max-width:min(480px,90vw)';
    document.body.appendChild(host);
  }
  const t = document.createElement('div');
  t.style.cssText = 'background:#fff;border:1px solid rgba(224,49,49,.4);border-left:4px solid #E03131;color:#14141F;border-radius:10px;padding:12px 16px;font:14px/1.5 Outfit,sans-serif;box-shadow:0 8px 30px rgba(20,20,31,.18);display:flex;gap:10px;align-items:flex-start';
  t.innerHTML = `<span style="flex:1"></span><button style="background:none;border:none;cursor:pointer;font-size:15px;color:#E03131;padding:0">✕</button>`;
  t.firstChild.textContent = msg;
  t.querySelector('button').onclick = () => t.remove();
  host.appendChild(t);
  setTimeout(() => t.remove(), 12000);
}

/* ---------- dropzone wiring ---------- */

function setupDropzone(zoneEl, inputEl, onFile) {
  zoneEl.addEventListener('click', () => inputEl.click());
  inputEl.addEventListener('change', () => {
    if (inputEl.files && inputEl.files[0]) onFile(inputEl.files[0]);
  });
  zoneEl.addEventListener('dragover', e => { e.preventDefault(); zoneEl.classList.add('drag'); });
  zoneEl.addEventListener('dragleave', () => zoneEl.classList.remove('drag'));
  zoneEl.addEventListener('drop', e => {
    e.preventDefault();
    zoneEl.classList.remove('drag');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]);
  });
}

/* ---------- progress overlay ---------- */

function makeOverlay(overlayEl, statusEl, barEl) {
  return {
    show(status, note) {
      overlayEl.classList.remove('hidden');
      statusEl.textContent = status || 'Working…';
      if (barEl) barEl.style.width = '0%';
    },
    status(s) { statusEl.textContent = s; },
    progress(p) {
      if (!barEl) return;
      const pct = Math.max(0, Math.min(1, p)) * 100;
      barEl.style.width = pct.toFixed(1) + '%';
    },
    hide() { overlayEl.classList.add('hidden'); },
  };
}

/* ---------- scroll entrance animation for cards ---------- */

function animateCards() {
  const cards = document.querySelectorAll('.tool-card, .step');
  const io = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
    });
  }, { threshold: 0.1 });
  cards.forEach(c => io.observe(c));
}
document.addEventListener('DOMContentLoaded', animateCards);
