/* ═══════════════════════════════════════════
   7By.in — Shared App Logic
═══════════════════════════════════════════ */

// ── FREE DAILY LIMIT ──
const FREE_LIMIT = 2;

function getFreeUsed() {
  const today = new Date().toDateString();
  const stored = JSON.parse(localStorage.getItem('7by_free') || '{}');
  if (stored.date !== today) return 0;
  return stored.count || 0;
}

function incrementFreeUsed() {
  const today = new Date().toDateString();
  const stored = JSON.parse(localStorage.getItem('7by_free') || '{}');
  const count = stored.date === today ? (stored.count || 0) + 1 : 1;
  localStorage.setItem('7by_free', JSON.stringify({ date: today, count }));
  return count;
}

function canUseFree() {
  return getFreeUsed() < FREE_LIMIT;
}

function renderFreeCounter(containerEl) {
  if (!containerEl) return;
  const used = getFreeUsed();
  const remaining = Math.max(0, FREE_LIMIT - used);
  containerEl.innerHTML = `
    <div class="free-banner">
      <div class="free-banner-left">
        <div class="pulse-dot"></div>
        <span class="free-counter">
          <span class="free-count-num">${remaining}</span> / ${FREE_LIMIT} free songs remaining today
        </span>
      </div>
      <a href="/pricing.html" class="btn btn-sm btn-m">Upgrade for More Credits ⚡</a>
    </div>`;
}

// ── TOAST ──
function toast(msg, duration = 3500) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    t.innerHTML = '<span id="toast-ico">✓</span><span id="toast-msg"></span>';
    document.body.appendChild(t);
  }
  document.getElementById('toast-msg').textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), duration);
}

// ── FAQ TOGGLE ──
function initFaq() {
  document.querySelectorAll('.faq-q').forEach(btn => {
    btn.addEventListener('click', () => btn.closest('.faq-item').classList.toggle('open'));
  });
}

// ── MODAL ──
function openModal(id) { document.getElementById(id || 'upgrade-modal').classList.add('open'); }
function closeModal(id) { document.getElementById(id || 'upgrade-modal').classList.remove('open'); }
function initModals() {
  document.querySelectorAll('.modal-ov').forEach(ov => {
    ov.addEventListener('click', e => { if (e.target === ov) ov.classList.remove('open'); });
  });
}

// ── SCROLL ANIMATIONS ──
function initScrollAnim() {
  const obs = new IntersectionObserver(entries => {
    entries.forEach((e, i) => {
      if (e.isIntersecting) setTimeout(() => e.target.classList.add('vis'), i * 80);
    });
  }, { threshold: 0.08 });
  document.querySelectorAll('.fade-up, .price-card').forEach(el => obs.observe(el));
}

// ── SMOOTH SCROLL ──
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const id = a.getAttribute('href');
      if (id === '#') return;
      const target = document.querySelector(id);
      if (target) { e.preventDefault(); target.scrollIntoView({ behavior: 'smooth' }); }
    });
  });
}

// ── AUDIO CONTEXT SINGLETON ──
let _ctx = null;
function getAudioCtx() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}

// ── WAV ENCODER (16-bit PCM) ──
function encodeWav(buffer) {
  const numCh = buffer.numberOfChannels;
  const sr = buffer.sampleRate;
  const len = buffer.length;
  const dataLen = len * numCh * 2;
  const ab = new ArrayBuffer(44 + dataLen);
  const v = new DataView(ab);
  const ws = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  ws(0,'RIFF'); v.setUint32(4, 36+dataLen, true); ws(8,'WAVE');
  ws(12,'fmt '); v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,numCh,true);
  v.setUint32(24,sr,true); v.setUint32(28,sr*numCh*2,true);
  v.setUint16(32,numCh*2,true); v.setUint16(34,16,true);
  ws(36,'data'); v.setUint32(40,dataLen,true);
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, buffer.getChannelData(c)[i]));
      v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      off += 2;
    }
  }
  return new Blob([ab], { type: 'audio/wav' });
}

// ── DOWNLOAD BLOB ──
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ── DRAW WAVEFORM ──
function drawWaveform(canvas, buffer, color = '#00D4FF', height = 56) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = height;
  canvas.height = H;
  const data = buffer.getChannelData(0);
  const step = Math.ceil(data.length / W);
  ctx.clearRect(0,0,W,H);
  const g = ctx.createLinearGradient(0,0,W,0);
  g.addColorStop(0, color + 'cc');
  g.addColorStop(0.5, (color === '#00D4FF' ? '#FF006E' : '#00D4FF') + 'cc');
  g.addColorStop(1, color + 'cc');
  ctx.fillStyle = g;
  for (let x = 0; x < W; x++) {
    let max = 0;
    for (let j = 0; j < step; j++) { const val = Math.abs(data[x*step+j]||0); if(val>max) max=val; }
    const h = Math.max(2, max * H * 0.88);
    ctx.fillRect(x, (H-h)/2, 1, h);
  }
}

// ── FORMAT TIME ──
function fmtTime(s) { s = Math.max(0,s|0); return `${s/60|0}:${String(s%60).padStart(2,'0')}`; }

// ── SIMPLE PLAYER ──
function createPlayer(opts) {
  // opts: { wrapId, canvasId, playBtnId, seekId, timeId, volId, playheadId }
  let srcNode = null, isPlaying = false, offset = 0, startT = 0, buffer = null;
  let analyser = null, gainNode = null, rafId = null;

  const ctx = getAudioCtx();
  analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  gainNode = ctx.createGain();
  gainNode.gain.value = 0.8;
  analyser.connect(gainNode);
  gainNode.connect(ctx.destination);

  function getEl(id) { return document.getElementById(id); }

  function stopSrc() {
    if (srcNode) { try { srcNode.stop(); } catch(e){} srcNode = null; }
    isPlaying = false;
  }

  function startFrom(off) {
    stopSrc();
    if (!buffer) return;
    srcNode = ctx.createBufferSource();
    srcNode.buffer = buffer;
    srcNode.connect(analyser);
    srcNode.start(0, Math.min(off, buffer.duration - 0.01));
    srcNode.onended = () => { if(isPlaying){ isPlaying=false; offset=0; updateUI(); } };
    startT = ctx.currentTime - off;
    isPlaying = true;
    updateUI();
    animate();
  }

  function animate() {
    if (!isPlaying) return;
    const elapsed = ctx.currentTime - startT;
    const pct = buffer ? Math.min(elapsed / buffer.duration, 1) : 0;
    const sb = getEl(opts.seekId);
    if (sb) sb.value = pct * 1000;
    const ph = getEl(opts.playheadId);
    if (ph) ph.style.left = (pct * 100) + '%';
    const td = getEl(opts.timeId);
    if (td && buffer) td.textContent = fmtTime(elapsed) + ' / ' + fmtTime(buffer.duration);
    rafId = requestAnimationFrame(animate);
  }

  function updateUI() {
    const pb = getEl(opts.playBtnId);
    if (pb) pb.textContent = isPlaying ? '⏸' : '▶';
  }

  return {
    load(buf) {
      buffer = buf;
      offset = 0;
      const wrap = getEl(opts.wrapId);
      if (wrap) wrap.classList.add('show');
      const can = getEl(opts.canvasId);
      if (can) { can.width = can.parentElement.offsetWidth; drawWaveform(can, buf); }
      const td = getEl(opts.timeId);
      if (td && buf) td.textContent = '0:00 / ' + fmtTime(buf.duration);
    },
    toggle() {
      if (!buffer) return;
      if (isPlaying) { offset = ctx.currentTime - startT; stopSrc(); updateUI(); }
      else startFrom(offset);
    },
    seek(val) {
      offset = (val / 1000) * (buffer ? buffer.duration : 0);
      if (isPlaying) startFrom(offset);
    },
    setVol(v) { if(gainNode) gainNode.gain.value = v / 100; },
    stop() { stopSrc(); offset = 0; updateUI(); },
    getAnalyser() { return analyser; },
    isPlaying() { return isPlaying; }
  };
}

// ── INIT ON LOAD ──
document.addEventListener('DOMContentLoaded', () => {
  initFaq();
  initModals();
  initScrollAnim();
  initSmoothScroll();
});
