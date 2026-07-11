'use strict';
/* ============================================================
   VidLab Editor — client-side CapCut-style video editor.
   Everything runs on-device: canvas compositing for transitions,
   text effects and color grading; MediaRecorder for export.
   ============================================================ */

/* ---------- helpers ---------- */
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const uid = () => 'c' + Math.random().toString(36).slice(2, 9);
const easeOut = x => 1 - Math.pow(1 - x, 3);
const backOut = x => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const srand = seed => { const s = Math.sin(seed) * 43758.5453; return s - Math.floor(s); };
const fmtTime = t => {
  t = Math.max(0, t);
  const m = Math.floor(t / 60), s = Math.floor(t % 60), d = Math.floor((t % 1) * 10);
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + '.' + d;
};

/* ---------- canvas / state ---------- */
const canvas = $('preview');
const ctx = canvas.getContext('2d');
let PW = 1280, PH = 720;

const offA = document.createElement('canvas'), offACtx = offA.getContext('2d');
const offB = document.createElement('canvas'), offBCtx = offB.getContext('2d');
const tiny = document.createElement('canvas'), tinyCtx = tiny.getContext('2d');

const media = [];   // library: {id, kind, name, url, duration, el, thumb}
const vTrack = [];  // sequential video/image clips
const tTrack = [];  // text clips
const gTrack = [];  // motion graphics clips
const aTrack = [];  // audio clips

let curAspect = '16:9', curQuality = 720; // quality = short-side/landscape height, up to 2160 (4K)

/* human-FX (on-device AI segmentation) */
let segmenter = null, segLoading = false, segBusy = false, segReady = false, segStatus = 'idle';
const segMaskCv = document.createElement('canvas'), segMaskCtx = segMaskCv.getContext('2d');
const segProxyCv = document.createElement('canvas'), segProxyCtx = segProxyCv.getContext('2d');
const personCv = document.createElement('canvas'), personCtx = personCv.getContext('2d');
const haloCv = document.createElement('canvas'), haloCtx = haloCv.getContext('2d');

let playhead = 0, playing = false, needsRedraw = true;
let selected = null;          // {type:'v'|'t'|'a', clip}
let inspTab = null;
let pps = 70;                 // pixels per second
let clockStart = 0, clockT0 = 0;

let audioCtx = null, audioDest = null, masterGain = null;
let exporting = false, recorder = null, exportChunks = [], exportCancelled = false, exportUrl = null;

/* noise texture for grain / vhs */
const noiseCv = document.createElement('canvas');
noiseCv.width = noiseCv.height = 256;
(() => {
  const nctx = noiseCv.getContext('2d');
  const img = nctx.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  nctx.putImageData(img, 0, 0);
})();

/* ---------- catalogs ---------- */
const defaultGrade = () => ({ preset: 'None', brightness: 100, contrast: 100, saturate: 100, hue: 0, sepia: 0, blur: 0, temp: 0, tint: 0, vignette: 0 });

const GRADE_PRESETS = {
  'None':      {},
  'Cinematic': { contrast: 118, saturate: 112, brightness: 97, temp: -14, tint: 8, vignette: 30 },
  'Warm':      { temp: 38, saturate: 112, brightness: 104 },
  'Cool':      { temp: -38, saturate: 106, contrast: 104 },
  'Vintage':   { sepia: 42, contrast: 90, brightness: 106, saturate: 82, temp: 16, vignette: 40 },
  'Noir':      { saturate: 0, contrast: 132, brightness: 96, vignette: 45 },
  'Vivid':     { saturate: 165, contrast: 112 },
  'Faded':     { contrast: 78, brightness: 112, saturate: 85 },
  'Sunset':    { temp: 46, tint: -12, saturate: 124, contrast: 106 },
  'Cyberpunk': { saturate: 150, hue: -14, tint: 30, contrast: 122, brightness: 96 },
};

const EFFECTS = [
  { id: 'none', name: 'None' }, { id: 'glitch', name: 'Glitch' }, { id: 'vhs', name: 'VHS' },
  { id: 'chromatic', name: 'Chromatic' }, { id: 'grain', name: 'Film Grain' }, { id: 'dreamy', name: 'Dreamy' },
  { id: 'pixelate', name: 'Pixelate' }, { id: 'scanlines', name: 'Scanlines' }, { id: 'invert', name: 'Invert' },
  { id: 'mirror', name: 'Mirror' }, { id: 'kaleido', name: 'Kaleido' }, { id: 'zoomblur', name: 'Zoom Blur' },
  { id: 'oldfilm', name: 'Old Film' }, { id: 'duotone', name: 'Duotone' }, { id: 'rgbwave', name: 'RGB Wave' },
  { id: 'cinebars', name: 'Cinema Bars' }, { id: 'strobe', name: 'Strobe' }, { id: 'retrowave', name: 'Retrowave' },
];

const MOTIONS = [
  { id: 'none', name: 'None' }, { id: 'kbin', name: 'Ken Burns In' }, { id: 'kbout', name: 'Ken Burns Out' },
  { id: 'panleft', name: 'Pan Left' }, { id: 'panright', name: 'Pan Right' }, { id: 'zoomfast', name: 'Zoom Intro' },
  { id: 'spinin', name: 'Spin In' }, { id: 'driftup', name: 'Drift Up' }, { id: 'pulse', name: 'Pulse Beat' },
  { id: 'handheld', name: 'Handheld' },
];

const HUMAN_FX = [
  { id: 'none', name: 'None' }, { id: 'bgblur', name: 'BG Blur' }, { id: 'bggreen', name: 'Green Screen' },
  { id: 'bgcolor', name: 'BG Color' }, { id: 'bggray', name: 'BG Grayscale' }, { id: 'glow', name: 'Neon Outline' },
  { id: 'echo', name: 'Echo Trail' }, { id: 'silhouette', name: 'Silhouette' },
];

const GFX_PRESETS = [
  { id: 'confetti', name: 'Confetti', icon: '🎊', params: ['density', 'speed'] },
  { id: 'snow', name: 'Snow', icon: '❄️', params: ['density', 'speed'] },
  { id: 'bokeh', name: 'Bokeh', icon: '✨', params: ['density', 'speed', 'color'] },
  { id: 'sparkles', name: 'Sparkles', icon: '🌟', params: ['density', 'speed', 'color'] },
  { id: 'lowerthird', name: 'Lower Third', icon: '📛', params: ['text', 'text2', 'color', 'pos', 'scale'] },
  { id: 'subscribe', name: 'Subscribe', icon: '🔔', params: ['text', 'pos', 'scale'] },
  { id: 'progress', name: 'Progress Bar', icon: '📶', params: ['color'] },
  { id: 'frame', name: 'Corner Frame', icon: '🖼️', params: ['color', 'scale'] },
  { id: 'sweep', name: 'Light Sweep', icon: '💫', params: ['speed'] },
  { id: 'sticker', name: 'Emoji Sticker', icon: '😎', params: ['emoji', 'pos', 'scale', 'speed'] },
  { id: 'ring', name: 'Pulse Ring', icon: '⭕', params: ['color', 'pos', 'scale', 'speed'] },
  { id: 'lightleak', name: 'Light Leak', icon: '🌅', params: ['color', 'speed'] },
];

const TRANSITIONS = [
  { id: 'none', name: 'None' }, { id: 'fade', name: 'Cross Fade' }, { id: 'fadeblack', name: 'Fade Black' },
  { id: 'fadewhite', name: 'Fade White' }, { id: 'wipeleft', name: 'Wipe ←' }, { id: 'wiperight', name: 'Wipe →' },
  { id: 'wipeup', name: 'Wipe ↑' }, { id: 'wipedown', name: 'Wipe ↓' }, { id: 'slideleft', name: 'Slide ←' },
  { id: 'slideright', name: 'Slide →' }, { id: 'circleopen', name: 'Circle Open' }, { id: 'circleclose', name: 'Circle Close' },
  { id: 'zoomin', name: 'Zoom' }, { id: 'blurwarp', name: 'Blur Warp' },
];

const TEXT_EFFECTS = [
  { id: 'none', name: 'None' }, { id: 'fade', name: 'Fade' }, { id: 'typewriter', name: 'Typewriter' },
  { id: 'pop', name: 'Pop' }, { id: 'slide', name: 'Slide Up' }, { id: 'zoom', name: 'Zoom In' },
  { id: 'bounce', name: 'Bounce' }, { id: 'wave', name: 'Wave' }, { id: 'shake', name: 'Shake' },
  { id: 'glow', name: 'Glow Pulse' }, { id: 'neon', name: 'Neon' }, { id: 'gradient', name: 'Gradient' },
];

const TEXT_PRESETS = [
  { name: 'Basic', text: 'Basic text', font: 'Outfit', weight: 600, size: 64, color: '#F0F0F8', effect: 'none' },
  { name: 'Big Title', text: 'BIG TITLE', font: 'Outfit', weight: 800, size: 108, color: '#FFFFFF', effect: 'pop' },
  { name: 'Neon Glow', text: 'NEON', font: 'Outfit', weight: 800, size: 96, color: '#00D4FF', effect: 'neon' },
  { name: 'Typewriter', text: 'typing something…', font: 'JetBrains Mono', weight: 400, size: 48, color: '#F0F0F8', effect: 'typewriter' },
  { name: 'Caption', text: 'Caption bar text', font: 'Outfit', weight: 600, size: 44, color: '#FFFFFF', effect: 'fade', bg: true },
  { name: 'Wave', text: 'Wavy text!', font: 'Outfit', weight: 800, size: 78, color: '#FFB800', effect: 'wave' },
  { name: 'Glow Pulse', text: 'GLOW', font: 'Outfit', weight: 800, size: 88, color: '#FF006E', effect: 'glow' },
  { name: 'Slide Up', text: 'Slide up', font: 'Outfit', weight: 700, size: 72, color: '#FFFFFF', effect: 'slide' },
  { name: 'Bounce', text: 'Bounce!', font: 'Outfit', weight: 800, size: 80, color: '#00C896', effect: 'bounce' },
  { name: 'Shake', text: 'SHAKE!!', font: 'Outfit', weight: 800, size: 84, color: '#FF4444', effect: 'shake' },
  { name: 'Zoom In', text: 'Zoom in', font: 'Outfit', weight: 700, size: 84, color: '#FFFFFF', effect: 'zoom' },
  { name: 'Gradient', text: 'GRADIENT', font: 'Outfit', weight: 800, size: 92, color: '#00D4FF', effect: 'gradient' },
];

const FONTS = ['Outfit', 'JetBrains Mono', 'Georgia', 'Arial Black', 'Impact', 'Comic Sans MS', 'Courier New'];

/* ============================================================
   MEDIA LIBRARY
   ============================================================ */
function importFiles(files) {
  [...files].forEach(file => {
    const url = URL.createObjectURL(file);
    const kind = file.type.startsWith('video') ? 'video' : file.type.startsWith('audio') ? 'audio' : file.type.startsWith('image') ? 'image' : null;
    if (!kind) return;
    const m = { id: uid(), kind, name: file.name, url, duration: 0, el: null, thumb: null };
    media.push(m);
    if (kind === 'video') {
      const v = document.createElement('video');
      v.src = url; v.preload = 'metadata'; v.muted = true; v.playsInline = true;
      m.el = v;
      v.addEventListener('loadedmetadata', () => {
        if (!isFinite(v.duration)) {
          /* WebM from MediaRecorder reports Infinity until seeked past the end */
          const onDur = () => {
            if (!isFinite(v.duration)) return;
            v.removeEventListener('durationchange', onDur);
            m.duration = v.duration;
            v.currentTime = Math.min(0.4, v.duration / 2);
            renderMediaGrid();
          };
          v.addEventListener('durationchange', onDur);
          v.currentTime = 1e7;
          return;
        }
        m.duration = v.duration || 0;
        v.currentTime = Math.min(0.4, (v.duration || 1) / 2);
        renderMediaGrid();
      });
      v.addEventListener('seeked', () => {
        if (m.thumb) return;
        const tc = document.createElement('canvas'); tc.width = 160; tc.height = 100;
        const s = Math.max(160 / v.videoWidth, 100 / v.videoHeight);
        tc.getContext('2d').drawImage(v, (160 - v.videoWidth * s) / 2, (100 - v.videoHeight * s) / 2, v.videoWidth * s, v.videoHeight * s);
        m.thumb = tc.toDataURL();
        renderMediaGrid();
      });
    } else if (kind === 'image') {
      const img = new Image();
      img.src = url; m.el = img; m.duration = 4;
      img.onload = () => { m.thumb = url; renderMediaGrid(); };
    } else {
      const a = document.createElement('audio');
      a.src = url; a.preload = 'metadata'; m.el = a;
      a.addEventListener('loadedmetadata', () => {
        if (!isFinite(a.duration)) {
          const onDur = () => {
            if (!isFinite(a.duration)) return;
            a.removeEventListener('durationchange', onDur);
            m.duration = a.duration; a.currentTime = 0;
            renderMediaGrid();
          };
          a.addEventListener('durationchange', onDur);
          a.currentTime = 1e7;
          return;
        }
        m.duration = a.duration || 0; renderMediaGrid();
      });
    }
  });
  renderMediaGrid();
}

function renderMediaGrid() {
  const grid = $('mediaGrid'), agrid = $('audioGrid');
  grid.innerHTML = ''; agrid.innerHTML = '';
  media.forEach(m => {
    const item = document.createElement('div');
    item.className = 'media-item';
    const thumb = m.kind === 'audio'
      ? `<div class="media-thumb-audio">🎵</div>`
      : (m.thumb ? `<img class="media-thumb" src="${m.thumb}" alt="">` : `<div class="media-thumb-audio">${m.kind === 'video' ? '🎞️' : '🖼️'}</div>`);
    item.innerHTML = `${thumb}<div class="media-name">${escapeHtml(m.name)}</div>
      <div class="media-dur mono">${m.kind === 'image' ? 'IMAGE' : fmtTime(m.duration)}</div>
      <button class="media-add" title="Add to timeline">+</button>
      <button class="media-del" title="Remove from library">✕</button>`;
    item.addEventListener('click', () => addMediaToTimeline(m));
    item.querySelector('.media-del').addEventListener('click', e => {
      e.stopPropagation();
      media.splice(media.indexOf(m), 1);
      renderMediaGrid();
    });
    (m.kind === 'audio' ? agrid : grid).appendChild(item);
  });
}

function escapeHtml(s) { return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function addMediaToTimeline(m) {
  if (m.kind === 'audio') {
    const c = { id: uid(), mediaId: m.id, kind: 'audio', name: m.name, start: playhead, in: 0, dur: m.duration || 5, volume: 1 };
    c.el = document.createElement('audio'); c.el.src = m.url; c.el.preload = 'auto';
    hookClipAudio(c);
    aTrack.push(c);
    select('a', c);
  } else {
    const c = makeVideoClip(m);
    vTrack.push(c);
    select('v', c);
  }
  renderTimeline(); renderInspector(); needsRedraw = true;
}

function makeVideoClip(m, inPoint = 0, dur = null) {
  const c = {
    id: uid(), mediaId: m.id, kind: m.kind, name: m.name,
    in: inPoint, dur: dur != null ? dur : (m.kind === 'image' ? 4 : (m.duration || 4)),
    speed: 1, volume: 1, grade: defaultGrade(), effect: 'none',
    motion: 'none', humanFx: 'none', humanColor: '#00D4FF', fit: 'fit',
    crop: { l: 0, t: 0, r: 0, b: 0 },   // fractions cut from each edge
    transition: { type: 'none', dur: 0.8 },
    start: 0, transDur: 0,
  };
  if (m.kind === 'video') {
    const v = document.createElement('video');
    v.src = m.url; v.preload = 'auto'; v.playsInline = true;
    v.addEventListener('seeked', () => { needsRedraw = true; });
    v.addEventListener('loadeddata', () => { needsRedraw = true; });
    c.el = v;
    hookClipAudio(c);
  } else {
    c.el = m.el;
    // image may still be decoding when added — repaint once it's ready
    if (m.kind === 'image' && !m.el.complete) m.el.addEventListener('load', () => { needsRedraw = true; }, { once: true });
  }
  return c;
}

/* ============================================================
   TIMELINE MODEL
   ============================================================ */
function layout() {
  let t = 0;
  vTrack.forEach((c, i) => {
    c.start = t;
    const hasNext = i < vTrack.length - 1;
    c.transDur = (hasNext && c.transition.type !== 'none')
      ? Math.min(c.transition.dur, c.dur * 0.5, vTrack[i + 1].dur * 0.5)
      : 0;
    t += c.dur - c.transDur;
  });
}

function totalDuration() {
  layout();
  let end = vTrack.length ? vTrack[vTrack.length - 1].start + vTrack[vTrack.length - 1].dur : 0;
  tTrack.forEach(c => end = Math.max(end, c.start + c.dur));
  gTrack.forEach(c => end = Math.max(end, c.start + c.dur));
  aTrack.forEach(c => end = Math.max(end, c.start + c.dur));
  return end;
}

function activeVideoAt(t) {
  return vTrack.filter(c => t >= c.start && t < c.start + c.dur);
}

/* ============================================================
   RENDERING
   ============================================================ */
function setCanvasSize(w, h) {
  PW = w; PH = h;
  canvas.width = offA.width = offB.width = personCv.width = haloCv.width = w;
  canvas.height = offA.height = offB.height = personCv.height = haloCv.height = h;
  needsRedraw = true;
}

function applyResolution() {
  const q = curQuality;
  if (curAspect === '16:9') setCanvasSize(Math.round(q * 16 / 9 / 2) * 2, q);
  else if (curAspect === '9:16') setCanvasSize(q, Math.round(q * 16 / 9 / 2) * 2);
  else setCanvasSize(q, q);
}

function buildFilter(g, effect) {
  let f = `brightness(${g.brightness / 100}) contrast(${g.contrast / 100}) saturate(${g.saturate / 100}) hue-rotate(${g.hue}deg) sepia(${g.sepia / 100})`;
  if (g.blur > 0) f += ` blur(${g.blur}px)`;
  if (effect === 'invert') f += ' invert(1)';
  if (effect === 'duotone') f += ' grayscale(1)';
  return f;
}

/* clip-level motion presets (mini keyframe animations, applied around canvas center) */
function applyMotion(o, clip, lt) {
  if (!clip.motion || clip.motion === 'none') return;
  const pr = clamp(lt / Math.max(clip.dur, 0.01), 0, 1);
  let s = 1, tx = 0, ty = 0, rot = 0;
  switch (clip.motion) {
    case 'kbin': s = 1 + 0.14 * pr; break;
    case 'kbout': s = 1.14 - 0.14 * pr; break;
    case 'panleft': s = 1.12; tx = (0.5 - pr) * 0.10 * PW; break;
    case 'panright': s = 1.12; tx = (pr - 0.5) * 0.10 * PW; break;
    case 'zoomfast': { const e = easeOut(clamp(lt / 0.6, 0, 1)); s = 1.35 - 0.35 * e; break; }
    case 'spinin': { const e = easeOut(clamp(lt / 0.7, 0, 1)); rot = (1 - e) * -0.15; s = 1 + (1 - e) * 0.35; break; }
    case 'driftup': s = 1.1; ty = (0.5 - pr) * 0.08 * PH; break;
    case 'pulse': s = 1 + 0.03 * Math.sin(lt * 4 * Math.PI); break;
    case 'handheld':
      tx = (Math.sin(lt * 1.3) + Math.sin(lt * 3.7) * 0.5) * PW * 0.006;
      ty = (Math.cos(lt * 1.7) + Math.cos(lt * 4.1) * 0.5) * PH * 0.006;
      s = 1.035; break;
  }
  o.translate(PW / 2 + tx, PH / 2 + ty);
  o.rotate(rot);
  o.scale(s, s);
  o.translate(-PW / 2, -PH / 2);
}

function drawClipInto(o, clip, t) {
  o.save();
  o.fillStyle = '#000'; o.fillRect(0, 0, PW, PH);
  const src = clip.el;
  const sw = clip.kind === 'image' ? src.naturalWidth : src.videoWidth;
  const sh = clip.kind === 'image' ? src.naturalHeight : src.videoHeight;
  if (!sw || !sh) { o.restore(); return; }

  const lt = t - clip.start;
  const crop = clip.crop || { l: 0, t: 0, r: 0, b: 0 };
  const cwf = Math.max(0.05, 1 - crop.l - crop.r), chf = Math.max(0.05, 1 - crop.t - crop.b);
  // 'fit' shows the whole (cropped) source at its original shape (bars if
  // needed); 'fill' crops it further to fill the frame
  const s = (clip.fit === 'fill' ? Math.max : Math.min)(PW / (sw * cwf), PH / (sh * chf));
  const dw = sw * cwf * s, dh = sh * chf * s, dx = (PW - dw) / 2, dy = (PH - dh) / 2;
  const filter = buildFilter(clip.grade, clip.effect);

  /* draws any image-like source into `target` with the clip's crop, fit and
     motion; the crop is applied as fractions so it also maps onto proxies
     like the segmentation mask, whatever their pixel size */
  const drawSrc = (target, img, flt) => {
    const iw = img.videoWidth || img.naturalWidth || img.width;
    const ih = img.videoHeight || img.naturalHeight || img.height;
    target.save();
    applyMotion(target, clip, lt);
    if (flt) target.filter = flt;
    target.drawImage(img, iw * crop.l, ih * crop.t, iw * cwf, ih * chf, dx, dy, dw, dh);
    target.restore();
  };

  const useHuman = clip.humanFx && clip.humanFx !== 'none' && segReady;

  if (useHuman) {
    const buildPerson = () => {
      personCtx.save();
      personCtx.clearRect(0, 0, PW, PH);
      personCtx.restore();
      drawSrc(personCtx, src, filter);
      personCtx.globalCompositeOperation = 'destination-in';
      drawSrc(personCtx, segMaskCv, null);
      personCtx.globalCompositeOperation = 'source-over';
    };
    switch (clip.humanFx) {
      case 'bgblur':
        drawSrc(o, src, filter + ' blur(16px)');
        buildPerson(); o.drawImage(personCv, 0, 0);
        break;
      case 'bggreen':
        o.fillStyle = '#00FF00'; o.fillRect(0, 0, PW, PH);
        buildPerson(); o.drawImage(personCv, 0, 0);
        break;
      case 'bgcolor':
        o.fillStyle = clip.humanColor; o.fillRect(0, 0, PW, PH);
        buildPerson(); o.drawImage(personCv, 0, 0);
        break;
      case 'bggray':
        drawSrc(o, src, filter + ' grayscale(1)');
        buildPerson(); o.drawImage(personCv, 0, 0);
        break;
      case 'glow': {
        drawSrc(o, src, filter);
        haloCtx.clearRect(0, 0, PW, PH);
        drawSrc(haloCtx, segMaskCv, null);
        haloCtx.globalCompositeOperation = 'source-in';
        haloCtx.fillStyle = clip.humanColor;
        haloCtx.fillRect(0, 0, PW, PH);
        haloCtx.globalCompositeOperation = 'source-over';
        o.filter = `blur(${Math.max(8, PW * 0.012)}px)`;
        o.globalAlpha = 0.95;
        o.drawImage(haloCv, 0, 0); o.drawImage(haloCv, 0, 0);
        o.filter = 'none'; o.globalAlpha = 1;
        buildPerson(); o.drawImage(personCv, 0, 0);
        break;
      }
      case 'silhouette': {
        drawSrc(o, src, filter);
        haloCtx.clearRect(0, 0, PW, PH);
        drawSrc(haloCtx, segMaskCv, null);
        haloCtx.globalCompositeOperation = 'source-in';
        haloCtx.fillStyle = clip.humanColor;
        haloCtx.fillRect(0, 0, PW, PH);
        haloCtx.globalCompositeOperation = 'source-over';
        o.globalAlpha = 0.92;
        o.drawImage(haloCv, 0, 0);
        o.globalAlpha = 1;
        break;
      }
      case 'echo': {
        drawSrc(o, src, filter);
        buildPerson();
        if (!clip._echo) { clip._echo = []; clip._echoT = 0; }
        clip._echo.forEach((ec, i) => {
          o.globalAlpha = 0.12 + 0.10 * i;
          o.drawImage(ec, 0, 0, PW, PH);
        });
        o.globalAlpha = 1;
        o.drawImage(personCv, 0, 0);
        const now = performance.now();
        if (now - clip._echoT > 90) {
          clip._echoT = now;
          const ec = document.createElement('canvas');
          ec.width = 480; ec.height = Math.round(480 * PH / PW);
          ec.getContext('2d').drawImage(personCv, 0, 0, ec.width, ec.height);
          clip._echo.push(ec);
          if (clip._echo.length > 4) clip._echo.shift();
        }
        break;
      }
    }
  } else if (clip.effect === 'pixelate') {
    const px = 90;
    tiny.width = px; tiny.height = Math.round(px * PH / PW);
    tinyCtx.drawImage(src, dx * px / PW, dy * tiny.height / PH, dw * px / PW, dh * tiny.height / PH);
    o.filter = filter;
    o.imageSmoothingEnabled = false;
    o.drawImage(tiny, 0, 0, PW, PH);
    o.imageSmoothingEnabled = true;
    o.filter = 'none';
  } else {
    drawSrc(o, src, filter);
  }

  applyTempTint(o, clip.grade);
  applyEffect(o, clip, t);
  if (clip.grade.vignette > 0) drawVignette(o, clip.grade.vignette / 100);
  o.restore();
}

function applyTempTint(o, g) {
  if (g.temp) {
    o.globalCompositeOperation = 'soft-light';
    o.globalAlpha = Math.abs(g.temp) / 100 * 0.55;
    o.fillStyle = g.temp > 0 ? '#ff8a00' : '#0066ff';
    o.fillRect(0, 0, PW, PH);
  }
  if (g.tint) {
    o.globalCompositeOperation = 'soft-light';
    o.globalAlpha = Math.abs(g.tint) / 100 * 0.5;
    o.fillStyle = g.tint > 0 ? '#ff00ff' : '#00ff55';
    o.fillRect(0, 0, PW, PH);
  }
  o.globalCompositeOperation = 'source-over';
  o.globalAlpha = 1;
}

function drawVignette(o, amt) {
  const g = o.createRadialGradient(PW / 2, PH / 2, Math.min(PW, PH) * 0.35, PW / 2, PH / 2, Math.max(PW, PH) * 0.72);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${0.85 * amt})`);
  o.fillStyle = g; o.fillRect(0, 0, PW, PH);
}

function drawNoise(o, alpha, t) {
  o.globalAlpha = alpha;
  const ox = Math.floor(srand(Math.floor(t * 24)) * 256), oy = Math.floor(srand(Math.floor(t * 24) + 7) * 256);
  for (let x = -ox; x < PW; x += 256)
    for (let y = -oy; y < PH; y += 256)
      o.drawImage(noiseCv, x, y);
  o.globalAlpha = 1;
}

function applyEffect(o, clip, t) {
  const cv = o.canvas;
  switch (clip.effect) {
    case 'glitch': {
      const seed = Math.floor(t * 9);
      if (srand(seed * 3.7) < 0.8) {
        const n = 3 + Math.floor(srand(seed) * 4);
        for (let i = 0; i < n; i++) {
          const y = srand(seed + i * 7.3) * PH;
          const h = (0.02 + srand(seed + i * 3.1) * 0.06) * PH;
          const off = (srand(seed + i * 5.9) - 0.5) * PW * 0.14;
          o.drawImage(cv, 0, y, PW, h, off, y, PW, h);
        }
        o.globalCompositeOperation = 'screen'; o.globalAlpha = 0.3;
        o.drawImage(cv, PW * 0.006, 0, PW, PH);
        o.globalCompositeOperation = 'source-over'; o.globalAlpha = 1;
      }
      break;
    }
    case 'vhs': {
      o.globalCompositeOperation = 'screen'; o.globalAlpha = 0.22;
      o.drawImage(cv, PW * 0.004, 0, PW, PH);
      o.globalCompositeOperation = 'source-over'; o.globalAlpha = 1;
      drawScanlines(o, 0.16);
      drawNoise(o, 0.07, t);
      break;
    }
    case 'chromatic': {
      o.globalCompositeOperation = 'screen'; o.globalAlpha = 0.35;
      o.drawImage(cv, PW * 0.005, 0, PW, PH);
      o.drawImage(cv, -PW * 0.005, 0, PW, PH);
      o.globalCompositeOperation = 'source-over'; o.globalAlpha = 1;
      break;
    }
    case 'grain': drawNoise(o, 0.12, t); break;
    case 'mirror': {
      o.save();
      o.translate(PW, 0); o.scale(-1, 1);
      o.drawImage(cv, 0, 0, PW / 2, PH, 0, 0, PW / 2, PH);
      o.restore();
      break;
    }
    case 'kaleido': {
      o.save();
      o.translate(PW, 0); o.scale(-1, 1);
      o.drawImage(cv, 0, 0, PW / 2, PH, 0, 0, PW / 2, PH);
      o.restore();
      o.save();
      o.translate(0, PH); o.scale(1, -1);
      o.drawImage(cv, 0, 0, PW, PH / 2, 0, 0, PW, PH / 2);
      o.restore();
      break;
    }
    case 'zoomblur': {
      for (let k = 1; k <= 4; k++) {
        const zs = 1 + k * 0.018;
        o.globalAlpha = 0.16;
        o.drawImage(cv, (PW - PW * zs) / 2, (PH - PH * zs) / 2, PW * zs, PH * zs);
      }
      o.globalAlpha = 1;
      break;
    }
    case 'oldfilm': {
      const seed = Math.floor(t * 12);
      const flick = srand(seed) * 0.08;
      o.fillStyle = `rgba(255,240,200,${flick.toFixed(3)})`;
      o.fillRect(0, 0, PW, PH);
      o.fillStyle = 'rgba(0,0,0,0.35)';
      for (let i = 0; i < 3; i++) {
        if (srand(seed + i * 11.3) < 0.4) {
          o.fillRect(srand(seed + i * 5.1) * PW, 0, Math.max(1, PW * 0.0012), PH);
        }
      }
      drawNoise(o, 0.12, t);
      drawVignette(o, 0.5);
      break;
    }
    case 'duotone': {
      const g2 = o.createLinearGradient(0, 0, PW, PH);
      g2.addColorStop(0, '#00D4FF'); g2.addColorStop(1, '#FF006E');
      o.globalCompositeOperation = 'overlay';
      o.globalAlpha = 0.65;
      o.fillStyle = g2; o.fillRect(0, 0, PW, PH);
      o.globalCompositeOperation = 'source-over'; o.globalAlpha = 1;
      break;
    }
    case 'rgbwave': {
      const sl = Math.max(6, Math.round(PH / 72));
      for (let y = 0; y < PH; y += sl) {
        const off = Math.sin(t * 2.4 + y * 0.015) * PW * 0.008;
        o.drawImage(cv, 0, y, PW, sl, off, y, PW, sl);
      }
      o.globalCompositeOperation = 'screen'; o.globalAlpha = 0.25;
      o.drawImage(cv, PW * 0.004, 0, PW, PH);
      o.globalCompositeOperation = 'source-over'; o.globalAlpha = 1;
      break;
    }
    case 'dreamy': {
      o.filter = 'blur(14px)';
      o.globalCompositeOperation = 'lighten'; o.globalAlpha = 0.55;
      o.drawImage(cv, 0, 0);
      o.filter = 'none'; o.globalCompositeOperation = 'source-over'; o.globalAlpha = 1;
      break;
    }
    case 'scanlines': drawScanlines(o, 0.22); break;
    case 'cinebars': {
      const bh = Math.round(PH * 0.12);
      o.fillStyle = '#000';
      o.fillRect(0, 0, PW, bh);
      o.fillRect(0, PH - bh, PW, bh);
      break;
    }
    case 'strobe': {
      if (Math.sin(t * 18) > 0.55) {
        o.fillStyle = 'rgba(255,255,255,0.32)';
        o.fillRect(0, 0, PW, PH);
      }
      break;
    }
    case 'retrowave': {
      const g2 = o.createLinearGradient(0, 0, 0, PH);
      g2.addColorStop(0, '#00D4FF'); g2.addColorStop(1, '#FF006E');
      o.globalCompositeOperation = 'overlay';
      o.globalAlpha = 0.5;
      o.fillStyle = g2; o.fillRect(0, 0, PW, PH);
      o.globalCompositeOperation = 'source-over'; o.globalAlpha = 1;
      drawScanlines(o, 0.14);
      break;
    }
  }
}

function drawScanlines(o, alpha) {
  o.fillStyle = `rgba(0,0,0,${alpha})`;
  for (let y = 0; y < PH; y += 4) o.fillRect(0, y, PW, 1.5);
}

/* ---------- transitions ---------- */
function drawScaled(img, s, alpha) {
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, (PW - PW * s) / 2, (PH - PH * s) / 2, PW * s, PH * s);
  ctx.globalAlpha = 1;
}

function compositeTransition(type, p) {
  const w = PW, h = PH;
  switch (type) {
    case 'fade':
      ctx.drawImage(offA, 0, 0);
      ctx.globalAlpha = p; ctx.drawImage(offB, 0, 0); ctx.globalAlpha = 1;
      break;
    case 'fadeblack':
    case 'fadewhite':
      ctx.fillStyle = type === 'fadeblack' ? '#000' : '#fff';
      ctx.fillRect(0, 0, w, h);
      if (p < 0.5) { ctx.globalAlpha = 1 - p * 2; ctx.drawImage(offA, 0, 0); }
      else { ctx.globalAlpha = (p - 0.5) * 2; ctx.drawImage(offB, 0, 0); }
      ctx.globalAlpha = 1;
      break;
    case 'wipeleft': case 'wiperight': case 'wipeup': case 'wipedown': {
      ctx.drawImage(offA, 0, 0);
      ctx.save(); ctx.beginPath();
      if (type === 'wipeleft') ctx.rect(0, 0, w * p, h);
      else if (type === 'wiperight') ctx.rect(w * (1 - p), 0, w * p, h);
      else if (type === 'wipeup') ctx.rect(0, h * (1 - p), w, h * p);
      else ctx.rect(0, 0, w, h * p);
      ctx.clip(); ctx.drawImage(offB, 0, 0); ctx.restore();
      break;
    }
    case 'slideleft': {
      const e = easeOut(p);
      ctx.drawImage(offA, -w * e, 0);
      ctx.drawImage(offB, w * (1 - e), 0);
      break;
    }
    case 'slideright': {
      const e = easeOut(p);
      ctx.drawImage(offA, w * e, 0);
      ctx.drawImage(offB, -w * (1 - e), 0);
      break;
    }
    case 'circleopen': {
      ctx.drawImage(offA, 0, 0);
      ctx.save(); ctx.beginPath();
      ctx.arc(w / 2, h / 2, easeOut(p) * Math.hypot(w, h) / 2, 0, Math.PI * 2);
      ctx.clip(); ctx.drawImage(offB, 0, 0); ctx.restore();
      break;
    }
    case 'circleclose': {
      ctx.drawImage(offB, 0, 0);
      ctx.save(); ctx.beginPath();
      ctx.arc(w / 2, h / 2, (1 - easeOut(p)) * Math.hypot(w, h) / 2, 0, Math.PI * 2);
      ctx.clip(); ctx.drawImage(offA, 0, 0); ctx.restore();
      break;
    }
    case 'zoomin': {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
      drawScaled(offA, 1 + 0.6 * p, 1 - p);
      drawScaled(offB, 1.4 - 0.4 * p, p);
      break;
    }
    case 'blurwarp': {
      const bl = Math.sin(p * Math.PI) * 16;
      ctx.filter = `blur(${bl.toFixed(1)}px)`;
      ctx.drawImage(offA, 0, 0);
      ctx.globalAlpha = p; ctx.drawImage(offB, 0, 0);
      ctx.globalAlpha = 1; ctx.filter = 'none';
      break;
    }
    default:
      ctx.drawImage(offB, 0, 0);
  }
}

/* ---------- text rendering ---------- */
function drawTextClip(c2, c, lt, t) {
  const scaleF = PH / 720;
  const size = c.size * scaleF;
  const lines = c.text.split('\n');
  const lineH = size * 1.18;
  const inD = 0.45, outD = 0.35;
  const tin = clamp(lt / inD, 0, 1);
  const tout = clamp((c.dur - lt) / outD, 0, 1);

  let alpha = 1, dx = 0, dy = 0, scl = 1;
  switch (c.effect) {
    case 'fade': alpha = Math.min(tin, tout); break;
    case 'slide': dy = (1 - easeOut(tin)) * 70 * scaleF; alpha = Math.min(tin, tout); break;
    case 'pop': scl = tin < 1 ? Math.max(0.01, backOut(tin)) : 1; alpha = Math.min(tin * 2.5, 1, tout); break;
    case 'zoom': scl = 1 + (1 - easeOut(tin)) * 1.2; alpha = Math.min(tin * 1.6, 1, tout); break;
    case 'bounce': dy = -Math.abs(Math.sin(lt * 7)) * Math.exp(-lt * 1.4) * 90 * scaleF; break;
    case 'shake': dx = Math.sin(t * 91) * 4 * scaleF; dy = Math.cos(t * 83) * 4 * scaleF; break;
    case 'neon': alpha = (Math.sin(t * 27) > -0.92 ? 1 : 0.55); break;
  }

  c2.save();
  c2.globalAlpha = alpha;
  c2.font = `${c.weight} ${size}px '${c.font}', sans-serif`;
  c2.textAlign = 'center'; c2.textBaseline = 'middle';

  const cx = c.x * PW + dx, cy = c.y * PH + dy;
  c2.translate(cx, cy); c2.scale(scl, scl);

  let maxW = 0;
  lines.forEach(ln => maxW = Math.max(maxW, c2.measureText(ln).width));
  const totH = lines.length * lineH;

  /* background pill */
  if (c.bg) {
    c2.fillStyle = c.bgColor || 'rgba(0,0,0,0.55)';
    const padX = size * 0.45, padY = size * 0.22;
    roundRect(c2, -maxW / 2 - padX, -totH / 2 - padY, maxW + padX * 2, totH + padY * 2, size * 0.22);
    c2.fill();
  }

  /* fill style */
  if (c.effect === 'gradient') {
    const g = c2.createLinearGradient(-maxW / 2, 0, maxW / 2, 0);
    g.addColorStop(0, '#00D4FF'); g.addColorStop(1, '#FF006E');
    c2.fillStyle = g;
  } else {
    c2.fillStyle = c.color;
  }

  if (c.effect === 'glow') {
    c2.shadowColor = c.color;
    c2.shadowBlur = (18 + Math.sin(t * 6) * 12) * scaleF;
  } else if (c.effect === 'neon') {
    c2.shadowColor = c.color;
    c2.shadowBlur = 26 * scaleF;
  }

  const y0 = -(lines.length - 1) / 2 * lineH;
  const perChar = c.effect === 'typewriter' || c.effect === 'wave';

  if (perChar) {
    let shown = Infinity;
    if (c.effect === 'typewriter') shown = Math.floor(lt * 16);
    let count = 0;
    c2.textAlign = 'left';
    lines.forEach((ln, li) => {
      const lw = c2.measureText(ln).width;
      let x = -lw / 2;
      for (const ch of ln) {
        if (count >= shown) break;
        const wch = c2.measureText(ch).width;
        let cdy = 0;
        if (c.effect === 'wave') cdy = Math.sin(t * 5 + count * 0.55) * size * 0.15;
        c2.fillText(ch, x, y0 + li * lineH + cdy);
        if (c.stroke) strokeChar(c2, ch, x, y0 + li * lineH + cdy, size);
        x += wch; count++;
      }
      count++; // count the implicit newline for typewriter pacing
    });
    /* typewriter caret */
    if (c.effect === 'typewriter' && shown < c.text.length && Math.sin(t * 10) > 0) {
      c2.fillRect(-maxW / 2 + Math.min(shown * size * 0.6, maxW), y0 - size / 2, size * 0.08, size);
    }
  } else {
    lines.forEach((ln, li) => {
      const ly = y0 + li * lineH;
      c2.fillText(ln, 0, ly);
      if (c.stroke || c.effect === 'neon') {
        c2.lineWidth = Math.max(1, size * 0.035);
        c2.strokeStyle = c.effect === 'neon' ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.85)';
        c2.strokeText(ln, 0, ly);
      }
    });
  }

  c2.restore();

  /* store bbox (canvas px) for drag hit-testing */
  c.bbox = { x: cx - maxW / 2 * scl, y: cy - totH / 2 * scl, w: maxW * scl, h: totH * scl };
}

function strokeChar(c2, ch, x, y, size) {
  c2.lineWidth = Math.max(1, size * 0.035);
  c2.strokeStyle = 'rgba(0,0,0,0.85)';
  c2.strokeText(ch, x, y);
}

function roundRect(c2, x, y, w, h, r) {
  c2.beginPath();
  c2.moveTo(x + r, y);
  c2.arcTo(x + w, y, x + w, y + h, r);
  c2.arcTo(x + w, y + h, x, y + h, r);
  c2.arcTo(x, y + h, x, y, r);
  c2.arcTo(x, y, x + w, y, r);
  c2.closePath();
}

/* ---------- motion graphics ---------- */
const GFX_PALETTE = ['#00D4FF', '#FF006E', '#FFB800', '#F0F0F8', '#00C896', '#8B5CF6'];

function drawGfxClip(o, c, lt, t) {
  const S = Math.min(PW, PH) / 720;   // ui scale factor
  const cx = c.x * PW, cy = c.y * PH;
  const spd = c.speed, den = c.density, sc = c.scale;
  const pr = clamp(lt / Math.max(c.dur, 0.01), 0, 1);
  const tin = clamp(lt / 0.5, 0, 1);
  o.save();
  switch (c.preset) {
    case 'confetti': {
      const n = Math.round(den * 1.2);
      for (let i = 0; i < n; i++) {
        const rx = srand(i * 13.7), rv = 0.4 + srand(i * 7.1) * 0.9;
        const x = rx * PW + Math.sin(t * 2 + i) * 30 * S;
        const y = ((srand(i * 3.3) + t * 0.09 * spd * rv) % 1.1 - 0.05) * PH;
        o.save();
        o.translate(x, y);
        o.rotate(t * (2 + srand(i * 9.1) * 3) + i);
        o.fillStyle = GFX_PALETTE[i % GFX_PALETTE.length];
        o.fillRect(-5 * S, -8 * S, 10 * S, 16 * S);
        o.restore();
      }
      break;
    }
    case 'snow': {
      const n = Math.round(den * 1.5);
      o.fillStyle = 'rgba(255,255,255,0.85)';
      for (let i = 0; i < n; i++) {
        const r = (1.5 + srand(i * 5.9) * 3.5) * S;
        const x = (srand(i * 13.7) + Math.sin(t * 0.7 + i) * 0.02) * PW;
        const y = ((srand(i * 3.3) + t * 0.045 * spd * (0.5 + srand(i * 7.7))) % 1.05) * PH;
        o.globalAlpha = 0.4 + srand(i * 2.2) * 0.5;
        o.beginPath(); o.arc(x, y, r, 0, Math.PI * 2); o.fill();
      }
      o.globalAlpha = 1;
      break;
    }
    case 'bokeh': {
      const n = Math.round(den * 0.4);
      o.globalCompositeOperation = 'screen';
      for (let i = 0; i < n; i++) {
        const r = (25 + srand(i * 5.9) * 70) * S;
        const x = (srand(i * 13.7) + Math.sin(t * 0.25 * spd + i * 2.1) * 0.08) * PW;
        const y = (srand(i * 3.3) + Math.cos(t * 0.2 * spd + i * 1.7) * 0.08) * PH;
        const g = o.createRadialGradient(x, y, 0, x, y, r);
        const col = i % 2 ? c.color : '#FF006E';
        g.addColorStop(0, col + '55'); g.addColorStop(1, col + '00');
        o.fillStyle = g;
        o.beginPath(); o.arc(x, y, r, 0, Math.PI * 2); o.fill();
      }
      o.globalCompositeOperation = 'source-over';
      break;
    }
    case 'sparkles': {
      const n = Math.round(den * 0.8);
      for (let i = 0; i < n; i++) {
        const tw = Math.sin(t * (3 + srand(i * 4.4) * 4) * spd + i * 1.3);
        if (tw < 0.1) continue;
        const x = srand(i * 13.7) * PW, y = srand(i * 3.3) * PH;
        const r = (3 + srand(i * 7.7) * 8) * S * tw;
        o.fillStyle = c.color;
        o.globalAlpha = tw;
        o.beginPath();
        for (let p = 0; p < 8; p++) {
          const ang = p * Math.PI / 4;
          const rr = p % 2 ? r * 0.35 : r;
          o.lineTo(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr);
        }
        o.closePath(); o.fill();
      }
      o.globalAlpha = 1;
      break;
    }
    case 'lowerthird': {
      const e = easeOut(tin);
      const eOut = clamp((c.dur - lt) / 0.35, 0, 1);
      const w = 430 * S * sc, h1 = 54 * S * sc, h2 = 34 * S * sc;
      const x = cx - w / 2 - (1 - e) * 120 * S;
      o.globalAlpha = Math.min(e, eOut);
      o.fillStyle = 'rgba(9,9,15,0.82)';
      roundRect(o, x, cy - h1, w * e, h1, 8 * S); o.fill();
      o.fillStyle = c.color;
      o.fillRect(x, cy - h1, 6 * S, h1 + h2 + 6 * S);
      o.fillStyle = 'rgba(9,9,15,0.62)';
      roundRect(o, x, cy + 6 * S, w * 0.8 * e, h2, 6 * S); o.fill();
      o.fillStyle = '#F0F0F8';
      o.font = `700 ${26 * S * sc}px Outfit, sans-serif`;
      o.textAlign = 'left'; o.textBaseline = 'middle';
      o.fillText(c.text, x + 22 * S, cy - h1 / 2);
      o.fillStyle = 'rgba(240,240,248,0.6)';
      o.font = `400 ${17 * S * sc}px Outfit, sans-serif`;
      o.fillText(c.text2, x + 22 * S, cy + 6 * S + h2 / 2);
      o.globalAlpha = 1;
      break;
    }
    case 'subscribe': {
      const e = lt < 0.6 ? backOut(clamp(lt / 0.6, 0, 1)) : 1 + Math.sin(t * 3) * 0.015;
      const w = 300 * S * sc * e, h = 72 * S * sc * e;
      o.fillStyle = '#E62117';
      roundRect(o, cx - w / 2, cy - h / 2, w, h, h / 2); o.fill();
      o.fillStyle = '#fff';
      o.font = `800 ${30 * S * sc * e}px Outfit, sans-serif`;
      o.textAlign = 'center'; o.textBaseline = 'middle';
      o.fillText(c.text || 'SUBSCRIBE 🔔', cx, cy + 2 * S);
      break;
    }
    case 'progress': {
      const h = 8 * S;
      o.fillStyle = 'rgba(255,255,255,0.15)';
      o.fillRect(0, PH - h, PW, h);
      const g = o.createLinearGradient(0, 0, PW, 0);
      g.addColorStop(0, c.color); g.addColorStop(1, '#FF006E');
      o.fillStyle = g;
      o.fillRect(0, PH - h, PW * pr, h);
      break;
    }
    case 'frame': {
      const e = easeOut(tin);
      const m = 36 * S, L = 110 * S * sc * e;
      o.strokeStyle = c.color;
      o.lineWidth = 5 * S;
      o.lineCap = 'round';
      [[m, m, 1, 1], [PW - m, m, -1, 1], [m, PH - m, 1, -1], [PW - m, PH - m, -1, -1]].forEach(([x, y, sx, sy]) => {
        o.beginPath();
        o.moveTo(x + L * sx, y); o.lineTo(x, y); o.lineTo(x, y + L * sy);
        o.stroke();
      });
      break;
    }
    case 'sweep': {
      const x = ((t * 0.35 * spd) % 1.6 - 0.3) * PW;
      const g = o.createLinearGradient(x - PW * 0.18, 0, x + PW * 0.18, PH * 0.2);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.22)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      o.globalCompositeOperation = 'screen';
      o.fillStyle = g; o.fillRect(0, 0, PW, PH);
      o.globalCompositeOperation = 'source-over';
      break;
    }
    case 'sticker': {
      const e = lt < 0.5 ? backOut(clamp(lt / 0.5, 0, 1)) : 1;
      const bounce = Math.abs(Math.sin(t * 2.4 * spd)) * 14 * S;
      o.font = `${140 * S * sc * e}px sans-serif`;
      o.textAlign = 'center'; o.textBaseline = 'middle';
      o.save();
      o.translate(cx, cy - bounce);
      o.rotate(Math.sin(t * 1.8 * spd) * 0.08);
      o.fillText(c.emoji || '😎', 0, 0);
      o.restore();
      break;
    }
    case 'ring': {
      for (let k = 0; k < 3; k++) {
        const ph = ((t * 0.5 * spd) + k / 3) % 1;
        const r = ph * 220 * S * sc;
        o.strokeStyle = c.color;
        o.globalAlpha = (1 - ph) * 0.9;
        o.lineWidth = 4 * S * (1 - ph) + 1;
        o.beginPath(); o.arc(cx, cy, r, 0, Math.PI * 2); o.stroke();
      }
      o.globalAlpha = 1;
      break;
    }
    case 'lightleak': {
      const x = (0.5 + Math.sin(t * 0.4 * spd) * 0.45) * PW;
      const y = (0.3 + Math.cos(t * 0.3 * spd) * 0.25) * PH;
      const g = o.createRadialGradient(x, y, 0, x, y, PW * 0.55);
      g.addColorStop(0, c.color + '66');
      g.addColorStop(0.5, c.color + '22');
      g.addColorStop(1, c.color + '00');
      o.globalCompositeOperation = 'screen';
      o.fillStyle = g; o.fillRect(0, 0, PW, PH);
      o.globalCompositeOperation = 'source-over';
      break;
    }
  }
  o.restore();
}

function addGfxClip(preset) {
  const c = {
    id: uid(), kind: 'gfx', preset: preset.id, name: preset.icon + ' ' + preset.name,
    start: playhead, dur: 4, x: 0.5, y: preset.id === 'lowerthird' ? 0.8 : 0.5,
    scale: 1, speed: 1, density: 40, color: '#00D4FF',
    text: preset.id === 'lowerthird' ? 'Your Name' : preset.id === 'subscribe' ? 'SUBSCRIBE 🔔' : '',
    text2: 'Job title · Channel', emoji: '😎',
  };
  gTrack.push(c);
  select('g', c);
  renderTimeline(); renderInspector();
  needsRedraw = true;
}

function renderGfxPresets() {
  const wrap = $('gfxPresets');
  wrap.innerHTML = '';
  GFX_PRESETS.forEach(p => {
    const el = document.createElement('div');
    el.className = 'gfx-preset';
    el.innerHTML = `<span class="gp-icon">${p.icon}</span><span class="gp-name">${p.name}</span>`;
    el.addEventListener('click', () => addGfxClip(p));
    wrap.appendChild(el);
  });
}

/* ============================================================
   TEMPLATES — one-tap styled timelines (CapCut-style)
   A template is a list of scenes; each scene styles one media
   slot (grade/effect/motion/transition) and overlays text.
   Uses the user's imported media in order, or generates
   placeholder slides they can replace.
   ============================================================ */
const TPL_PALETTES = [
  ['#FF006E', '#8338EC'], ['#3A86FF', '#00D4FF'], ['#FB5607', '#FFBE0B'],
  ['#00C896', '#02745C'], ['#5F0F40', '#FB8B24'], ['#1D3557', '#E63946'],
];

const TEMPLATES = [
  /* ---- intros & openers (16:9) ---- */
  { id: 'bold-intro', name: 'Bold YouTube Intro', icon: '🎬', tag: 'Intro · 7s', aspect: '16:9', grad: 0,
    scenes: [
      { dur: 2.4, grade: 'Cinematic', motion: 'zoomfast', trans: 'fade',
        texts: [{ text: 'YOUR CHANNEL', size: 104, effect: 'pop', y: 0.45 }, { text: 'new video every week', size: 38, color: '#00D4FF', effect: 'fade', y: 0.62, at: 0.5, weight: 500 }] },
      { dur: 2.4, grade: 'Vivid', motion: 'kbin', trans: 'slideleft', texts: [{ text: 'THIS WEEK…', size: 84, effect: 'slide', y: 0.5 }] },
      { dur: 2.4, grade: 'Cinematic', motion: 'kbout', texts: [{ text: "LET'S GO", size: 110, effect: 'zoom', y: 0.5, color: '#FFB800' }] },
    ],
    gfx: [{ preset: 'sweep', at: 0, dur: 2.4 }] },

  { id: 'neon-gamer', name: 'Neon Gamer Intro', icon: '🎮', tag: 'Gaming · 7s', aspect: '16:9', grad: 0,
    scenes: [
      { dur: 2.2, grade: 'Cyberpunk', effect: 'glitch', motion: 'handheld', trans: 'fadeblack',
        texts: [{ text: 'GAME ON', size: 120, effect: 'neon', color: '#00D4FF' }] },
      { dur: 2.4, grade: 'Cyberpunk', effect: 'chromatic', motion: 'pulse', trans: 'blurwarp',
        texts: [{ text: 'LEVEL UP YOUR FEED', size: 60, effect: 'glow', color: '#FF006E' }] },
      { dur: 2.4, grade: 'Noir', effect: 'scanlines', motion: 'zoomfast', texts: [{ text: 'SUBSCRIBE', size: 96, effect: 'shake', color: '#00C896' }] },
    ],
    gfx: [{ preset: 'ring', at: 0.2, dur: 2, color: '#00D4FF' }] },

  { id: 'minimal-tech', name: 'Minimal Tech Intro', icon: '💻', tag: 'Tech · 6s', aspect: '16:9', grad: 1,
    scenes: [
      { dur: 3, grade: 'Cool', motion: 'kbin', trans: 'fade', texts: [{ text: 'the future, reviewed', size: 56, effect: 'typewriter', font: 'JetBrains Mono', weight: 400 }] },
      { dur: 3, grade: 'Cool', motion: 'driftup', texts: [{ text: 'TECH DECODED', size: 88, effect: 'fade' }] },
    ],
    gfx: [{ preset: 'progress', at: 0, dur: 6, color: '#00D4FF' }] },

  { id: 'cine-vlog', name: 'Cinematic Vlog Opener', icon: '🌅', tag: 'Vlog · 8s', aspect: '16:9', grad: 4,
    scenes: [
      { dur: 2.6, grade: 'Cinematic', effect: 'cinebars', motion: 'panleft', trans: 'fade', texts: [{ text: 'A DAY IN MY LIFE', size: 72, effect: 'fade', y: 0.72 }] },
      { dur: 2.6, grade: 'Cinematic', effect: 'cinebars', motion: 'kbin', trans: 'fade', texts: [{ text: 'ep. 12', size: 40, effect: 'fade', y: 0.72, font: 'JetBrains Mono', weight: 400 }] },
      { dur: 2.8, grade: 'Sunset', effect: 'cinebars', motion: 'kbout', texts: [{ text: 'enjoy ✨', size: 60, effect: 'glow', y: 0.72 }] },
    ] },

  { id: 'travel', name: 'Travel Montage', icon: '✈️', tag: 'Travel · 10s', aspect: '16:9', grad: 2,
    scenes: [
      { dur: 2.5, grade: 'Sunset', motion: 'panright', trans: 'wipeleft', texts: [{ text: 'WANDER', size: 110, effect: 'wave', color: '#FFB800' }] },
      { dur: 2.5, grade: 'Warm', motion: 'kbin', trans: 'wiperight', texts: [{ text: 'EXPLORE', size: 110, effect: 'wave', color: '#FFFFFF' }] },
      { dur: 2.5, grade: 'Vivid', motion: 'panleft', trans: 'circleopen', texts: [{ text: 'DISCOVER', size: 110, effect: 'wave', color: '#00D4FF' }] },
      { dur: 2.5, grade: 'Sunset', motion: 'kbout', texts: [{ text: 'come with me', size: 54, effect: 'fade', weight: 500 }] },
    ],
    gfx: [{ preset: 'lightleak', at: 0, dur: 10, color: '#FFB800' }] },

  { id: 'tutorial', name: 'Tutorial Opener', icon: '📚', tag: 'Howto · 6s', aspect: '16:9', grad: 1,
    scenes: [
      { dur: 3, grade: 'Cool', motion: 'kbin', trans: 'wipedown', texts: [{ text: 'HOW TO…', size: 96, effect: 'slide' }] },
      { dur: 3, grade: 'None', motion: 'none', texts: [{ text: 'step by step, no skips', size: 48, effect: 'fade', bg: true, weight: 500 }] },
    ],
    gfx: [{ preset: 'lowerthird', at: 3, dur: 3, text: 'Your Name', text2: 'Tutorials · Weekly' }] },

  { id: 'news-flash', name: 'News Flash', icon: '🗞️', tag: 'News · 6s', aspect: '16:9', grad: 5,
    scenes: [
      { dur: 1.6, grade: 'Noir', effect: 'strobe', motion: 'zoomfast', trans: 'slideleft', texts: [{ text: 'BREAKING', size: 120, effect: 'shake', color: '#FF4444' }] },
      { dur: 2.2, grade: 'Noir', motion: 'none', trans: 'slideleft', texts: [{ text: 'THE STORY EVERYONE MISSED', size: 56, effect: 'slide', bg: true }] },
      { dur: 2.2, grade: 'Cool', motion: 'kbin', texts: [{ text: 'full report inside', size: 44, effect: 'fade', y: 0.7, weight: 500 }] },
    ],
    gfx: [{ preset: 'progress', at: 0, dur: 6, color: '#FF4444' }] },

  { id: 'podcast', name: 'Podcast Promo', icon: '🎙️', tag: 'Podcast · 8s', aspect: '16:9', grad: 4,
    scenes: [
      { dur: 4, grade: 'Faded', motion: 'pulse', trans: 'fade', texts: [{ text: '"the quote that stops the scroll"', size: 52, effect: 'typewriter', font: 'Georgia', weight: 400 }] },
      { dur: 4, grade: 'Faded', motion: 'kbin', texts: [{ text: 'NEW EPISODE', size: 84, effect: 'pop' }, { text: 'listen everywhere', size: 36, effect: 'fade', y: 0.64, at: 0.6, weight: 500 }] },
    ],
    gfx: [{ preset: 'ring', at: 4, dur: 3, color: '#FF006E' }] },

  { id: 'recipe', name: 'Recipe Card', icon: '🍳', tag: 'Food · 7s', aspect: '16:9', grad: 2,
    scenes: [
      { dur: 2.4, grade: 'Warm', motion: 'kbout', trans: 'circleopen', texts: [{ text: 'TODAY WE COOK', size: 76, effect: 'bounce' }] },
      { dur: 2.4, grade: 'Warm', motion: 'kbin', trans: 'fade', texts: [{ text: 'ready in 20 minutes', size: 46, effect: 'fade', bg: true, weight: 500 }] },
      { dur: 2.4, grade: 'Vivid', motion: 'pulse', texts: [{ text: 'BON APPÉTIT', size: 84, effect: 'zoom', color: '#FFB800' }] },
    ],
    gfx: [{ preset: 'sticker', at: 4.8, dur: 2.4, emoji: '😋', x: 0.82, y: 0.24, scale: 1.2 }] },

  { id: 'fitness', name: 'Fitness Hype', icon: '💪', tag: 'Fitness · 6s', aspect: '16:9', grad: 5,
    scenes: [
      { dur: 1.8, grade: 'Vivid', effect: 'strobe', motion: 'zoomfast', trans: 'fadeblack', texts: [{ text: 'NO EXCUSES', size: 104, effect: 'shake' }] },
      { dur: 2.1, grade: 'Noir', motion: 'handheld', trans: 'fadeblack', texts: [{ text: 'TRAIN. EAT. REPEAT.', size: 66, effect: 'pop' }] },
      { dur: 2.1, grade: 'Vivid', motion: 'zoomfast', texts: [{ text: "LET'S WORK", size: 96, effect: 'zoom', color: '#00C896' }] },
    ],
    gfx: [{ preset: 'sweep', at: 0, dur: 2 }] },

  { id: 'product', name: 'Product Showcase', icon: '🛍️', tag: 'Promo · 8s', aspect: '16:9', grad: 0,
    scenes: [
      { dur: 2.6, grade: 'Cinematic', motion: 'spinin', trans: 'fade', texts: [{ text: 'INTRODUCING', size: 60, effect: 'fade', y: 0.3, weight: 500 }] },
      { dur: 2.6, grade: 'Cinematic', motion: 'kbin', trans: 'blurwarp', texts: [{ text: 'THE ONE YOU WAITED FOR', size: 64, effect: 'gradient' }] },
      { dur: 2.8, grade: 'Vivid', motion: 'pulse', texts: [{ text: 'AVAILABLE NOW', size: 80, effect: 'glow', color: '#00D4FF' }] },
    ],
    gfx: [{ preset: 'sweep', at: 2.6, dur: 2.6 }] },

  { id: 'unboxing', name: 'Unboxing Time', icon: '📦', tag: 'Unbox · 6s', aspect: '16:9', grad: 2,
    scenes: [
      { dur: 3, grade: 'Vivid', motion: 'kbin', trans: 'circleclose', texts: [{ text: 'UNBOXING TIME', size: 84, effect: 'pop' }] },
      { dur: 3, grade: 'Vivid', motion: 'pulse', texts: [{ text: 'is it worth it?', size: 52, effect: 'fade', weight: 500 }] },
    ],
    gfx: [{ preset: 'sticker', at: 0.6, dur: 2, emoji: '😱', x: 0.8, y: 0.25, scale: 1.3 }] },

  { id: 'realty', name: 'Property Tour', icon: '🏡', tag: 'Realty · 9s', aspect: '16:9', grad: 3,
    scenes: [
      { dur: 3, grade: 'Cinematic', effect: 'cinebars', motion: 'panleft', trans: 'fade', texts: [{ text: 'JUST LISTED', size: 76, effect: 'fade', y: 0.7 }] },
      { dur: 3, grade: 'Cinematic', effect: 'cinebars', motion: 'panright', trans: 'fade', texts: [{ text: '3 BED · 2 BATH · CITY VIEWS', size: 44, effect: 'slide', y: 0.7, font: 'JetBrains Mono', weight: 400 }] },
      { dur: 3, grade: 'Warm', motion: 'kbout', texts: [{ text: 'book a viewing today', size: 50, effect: 'fade', y: 0.7, weight: 500 }] },
    ],
    gfx: [{ preset: 'lowerthird', at: 6, dur: 3, text: 'Your Name', text2: 'Licensed Realtor' }] },

  { id: 'wedding', name: 'Wedding Memories', icon: '💍', tag: 'Love · 9s', aspect: '16:9', grad: 4,
    scenes: [
      { dur: 3, grade: 'Faded', motion: 'kbout', trans: 'fadewhite', texts: [{ text: 'Forever starts here', size: 72, effect: 'glow', font: 'Georgia', weight: 400 }] },
      { dur: 3, grade: 'Faded', motion: 'kbin', trans: 'fadewhite', texts: [{ text: 'Alex & Sam', size: 88, effect: 'fade', font: 'Georgia', weight: 400 }] },
      { dur: 3, grade: 'Warm', motion: 'kbout', texts: [{ text: '14 · 02 · 2026', size: 44, effect: 'fade', font: 'JetBrains Mono', weight: 400 }] },
    ],
    gfx: [{ preset: 'bokeh', at: 0, dur: 9, color: '#FFB6C1' }] },

  { id: 'birthday', name: 'Birthday Party', icon: '🎂', tag: 'Party · 7s', aspect: '16:9', grad: 2,
    scenes: [
      { dur: 2.4, grade: 'Vivid', motion: 'zoomfast', trans: 'circleopen', texts: [{ text: 'HAPPY', size: 120, effect: 'bounce', color: '#FFB800' }] },
      { dur: 2.4, grade: 'Vivid', motion: 'pulse', trans: 'circleopen', texts: [{ text: 'BIRTHDAY!', size: 120, effect: 'bounce', color: '#FF006E' }] },
      { dur: 2.4, grade: 'Warm', motion: 'kbin', texts: [{ text: 'make a wish 🎉', size: 60, effect: 'wave' }] },
    ],
    gfx: [{ preset: 'confetti', at: 0, dur: 7.2, density: 70 }] },

  { id: 'motivation', name: 'Motivation Quote', icon: '🔥', tag: 'Quote · 8s', aspect: '16:9', grad: 5,
    scenes: [
      { dur: 4, grade: 'Noir', effect: 'cinebars', motion: 'kbin', trans: 'fadeblack', texts: [{ text: 'DISCIPLINE', size: 100, effect: 'pop' }] },
      { dur: 4, grade: 'Noir', effect: 'grain', motion: 'kbin', texts: [{ text: 'beats motivation. every time.', size: 54, effect: 'typewriter', font: 'Georgia', weight: 400 }] },
    ] },

  { id: 'music-drop', name: 'Music Drop', icon: '🎧', tag: 'Music · 6s', aspect: '16:9', grad: 0,
    scenes: [
      { dur: 3, grade: 'Cyberpunk', effect: 'rgbwave', motion: 'pulse', trans: 'blurwarp', texts: [{ text: 'NEW TRACK', size: 96, effect: 'neon', color: '#00D4FF' }] },
      { dur: 3, grade: 'Cyberpunk', effect: 'chromatic', motion: 'zoomfast', texts: [{ text: 'OUT NOW', size: 110, effect: 'glow', color: '#FF006E' }] },
    ],
    gfx: [{ preset: 'ring', at: 0, dur: 6, color: '#FF006E' }] },

  { id: 'sale', name: 'Mega Sale Promo', icon: '🏷️', tag: 'Sale · 6s', aspect: '16:9', grad: 2,
    scenes: [
      { dur: 2, grade: 'Vivid', motion: 'zoomfast', trans: 'wipeleft', texts: [{ text: 'MEGA SALE', size: 110, effect: 'shake', color: '#FFB800' }] },
      { dur: 2, grade: 'Vivid', motion: 'pulse', trans: 'wiperight', texts: [{ text: 'UP TO 50% OFF', size: 84, effect: 'pop', bg: true }] },
      { dur: 2, grade: 'Vivid', motion: 'zoomfast', texts: [{ text: 'ENDS SUNDAY', size: 76, effect: 'bounce', color: '#FF4444' }] },
    ],
    gfx: [{ preset: 'confetti', at: 0, dur: 6, density: 50 }, { preset: 'sweep', at: 2, dur: 2 }] },

  { id: 'before-after', name: 'Before / After', icon: '🔄', tag: 'Compare · 6s', aspect: '16:9', grad: 3,
    scenes: [
      { dur: 3, grade: 'Noir', motion: 'kbin', trans: 'wipeleft', transDur: 1, texts: [{ text: 'BEFORE', size: 72, effect: 'fade', bg: true, y: 0.14 }] },
      { dur: 3, grade: 'Vivid', motion: 'kbin', texts: [{ text: 'AFTER', size: 72, effect: 'pop', bg: true, y: 0.14, color: '#00C896' }] },
    ] },

  { id: 'outro-sub', name: 'Outro + Subscribe', icon: '🔔', tag: 'Outro · 8s', aspect: '16:9', grad: 0,
    scenes: [
      { dur: 4, grade: 'Cinematic', motion: 'kbout', trans: 'fade', texts: [{ text: 'THANKS FOR WATCHING', size: 72, effect: 'fade', y: 0.32 }] },
      { dur: 4, grade: 'Cinematic', motion: 'none', texts: [{ text: 'see you next week', size: 44, effect: 'fade', y: 0.3, weight: 500 }] },
    ],
    gfx: [{ preset: 'subscribe', at: 1, dur: 7, y: 0.62 }, { preset: 'frame', at: 0, dur: 8, color: '#FF006E' }] },

  { id: 'qa-intro', name: 'Q&A Intro', icon: '❓', tag: 'Q&A · 6s', aspect: '16:9', grad: 1,
    scenes: [
      { dur: 3, grade: 'Cool', motion: 'driftup', trans: 'wipeup', texts: [{ text: 'YOU ASKED…', size: 84, effect: 'slide' }] },
      { dur: 3, grade: 'Cool', motion: 'kbin', texts: [{ text: 'we answer. honestly.', size: 52, effect: 'typewriter', weight: 500 }] },
    ],
    gfx: [{ preset: 'lowerthird', at: 3, dur: 3, text: 'Q&A · Episode 5', text2: 'send questions in the comments' }] },

  { id: 'movie-title', name: 'Movie Title', icon: '🎥', tag: 'Film · 9s', aspect: '16:9', grad: 5,
    scenes: [
      { dur: 3, grade: 'Noir', effect: 'cinebars', motion: 'kbin', trans: 'fadeblack', transDur: 1.2, texts: [{ text: 'A FILM BY', size: 44, effect: 'fade', font: 'Georgia', weight: 400 }] },
      { dur: 3, grade: 'Noir', effect: 'cinebars', motion: 'kbin', trans: 'fadeblack', transDur: 1.2, texts: [{ text: 'YOU', size: 130, effect: 'fade', font: 'Georgia', weight: 400 }] },
      { dur: 3, grade: 'Cinematic', effect: 'cinebars', motion: 'kbout', texts: [{ text: 'coming soon', size: 40, effect: 'fade', font: 'JetBrains Mono', weight: 400 }] },
    ] },

  { id: 'retro-vhs', name: 'Retro VHS', icon: '📼', tag: 'Retro · 7s', aspect: '16:9', grad: 2,
    scenes: [
      { dur: 2.4, grade: 'Vintage', effect: 'vhs', motion: 'handheld', trans: 'fade', texts: [{ text: '◄◄ REWIND', size: 76, effect: 'shake', font: 'JetBrains Mono', weight: 400, color: '#FFB800' }] },
      { dur: 2.4, grade: 'Vintage', effect: 'vhs', motion: 'kbin', trans: 'fade', texts: [{ text: 'PLAY ►', size: 76, effect: 'fade', font: 'JetBrains Mono', weight: 400 }] },
      { dur: 2.4, grade: 'Vintage', effect: 'retrowave', motion: 'pulse', texts: [{ text: 'EST. 1994', size: 60, effect: 'gradient' }] },
    ] },

  { id: 'slideshow', name: 'Photo Slideshow', icon: '🖼️', tag: 'Photos · 12s', aspect: '16:9', grad: 3,
    scenes: [
      { dur: 3, grade: 'Faded', motion: 'kbin', trans: 'fade', transDur: 1, texts: [{ text: 'MEMORIES', size: 80, effect: 'glow', y: 0.75 }] },
      { dur: 3, grade: 'Faded', motion: 'kbout', trans: 'fade', transDur: 1 },
      { dur: 3, grade: 'Warm', motion: 'kbin', trans: 'fade', transDur: 1 },
      { dur: 3, grade: 'Faded', motion: 'kbout', texts: [{ text: 'the end ♡', size: 56, effect: 'fade', font: 'Georgia', weight: 400, y: 0.75 }] },
    ],
    gfx: [{ preset: 'bokeh', at: 0, dur: 12, color: '#FFFFFF' }] },

  { id: 'memories', name: 'Old Memories', icon: '🕰️', tag: 'Nostalgia · 8s', aspect: '16:9', grad: 4,
    scenes: [
      { dur: 4, grade: 'Faded', effect: 'oldfilm', motion: 'kbout', trans: 'fadewhite', texts: [{ text: 'remember when…', size: 60, effect: 'typewriter', font: 'Georgia', weight: 400 }] },
      { dur: 4, grade: 'Vintage', effect: 'oldfilm', motion: 'kbin', texts: [{ text: 'some days never fade', size: 48, effect: 'fade', font: 'Georgia', weight: 400, y: 0.7 }] },
    ],
    gfx: [{ preset: 'lightleak', at: 0, dur: 8, color: '#FFD9A0' }] },

  /* ---- Shorts / Reels (9:16) ---- */
  { id: 'shorts-hook', name: 'Shorts Hook', icon: '⚡', tag: 'Shorts 9:16 · 5s', aspect: '9:16', grad: 0,
    scenes: [
      { dur: 1.6, grade: 'Vivid', effect: 'strobe', motion: 'zoomfast', trans: 'fadeblack', texts: [{ text: 'WAIT FOR IT…', size: 84, effect: 'shake' }] },
      { dur: 1.8, grade: 'Vivid', motion: 'pulse', trans: 'blurwarp', texts: [{ text: 'YOU WON\'T BELIEVE THIS', size: 64, effect: 'pop' }] },
      { dur: 1.8, grade: 'Cyberpunk', motion: 'zoomfast', texts: [{ text: '🤯', size: 160, effect: 'zoom' }] },
    ],
    gfx: [{ preset: 'sweep', at: 0, dur: 1.6 }] },

  { id: 'reel-fashion', name: 'Fashion Reel', icon: '👗', tag: 'Reels 9:16 · 7s', aspect: '9:16', grad: 0,
    scenes: [
      { dur: 2.4, grade: 'Vivid', effect: 'chromatic', motion: 'spinin', trans: 'wipeup', texts: [{ text: 'OOTD', size: 110, effect: 'neon', color: '#FF006E' }] },
      { dur: 2.4, grade: 'Cinematic', motion: 'kbin', trans: 'wipeup', texts: [{ text: 'fit check ✔', size: 60, effect: 'bounce', y: 0.8 }] },
      { dur: 2.4, grade: 'Vivid', motion: 'pulse', texts: [{ text: 'RATE IT 1-10', size: 66, effect: 'pop', y: 0.8 }] },
    ],
    gfx: [{ preset: 'sparkles', at: 0, dur: 7.2, color: '#FFFFFF' }] },

  { id: 'countdown', name: 'Story Countdown', icon: '⏳', tag: 'Story 9:16 · 6s', aspect: '9:16', grad: 5,
    scenes: [
      { dur: 1.5, grade: 'Noir', motion: 'zoomfast', trans: 'fadeblack', texts: [{ text: '3', size: 220, effect: 'zoom', color: '#00D4FF' }] },
      { dur: 1.5, grade: 'Noir', motion: 'zoomfast', trans: 'fadeblack', texts: [{ text: '2', size: 220, effect: 'zoom', color: '#FFB800' }] },
      { dur: 1.5, grade: 'Noir', motion: 'zoomfast', trans: 'fadeblack', texts: [{ text: '1', size: 220, effect: 'zoom', color: '#FF006E' }] },
      { dur: 1.8, grade: 'Vivid', motion: 'pulse', texts: [{ text: 'GO!', size: 160, effect: 'pop', color: '#00C896' }] },
    ],
    gfx: [{ preset: 'ring', at: 0, dur: 4.5, color: '#00D4FF' }, { preset: 'confetti', at: 4.5, dur: 1.8, density: 70 }] },

  { id: 'viral-quote', name: 'Viral Quote', icon: '💬', tag: 'Quote 9:16 · 7s', aspect: '9:16', grad: 4,
    scenes: [
      { dur: 3.5, grade: 'Noir', effect: 'grain', motion: 'driftup', trans: 'fade', texts: [{ text: '“comparison is the thief of joy”', size: 58, effect: 'wave', font: 'Georgia', weight: 400 }] },
      { dur: 3.5, grade: 'Noir', motion: 'kbin', texts: [{ text: '— follow for daily wisdom', size: 40, effect: 'fade', bg: true, y: 0.8, weight: 500 }] },
    ] },

  { id: 'mobile-promo', name: 'App Promo', icon: '📱', tag: 'Promo 9:16 · 6s', aspect: '9:16', grad: 1,
    scenes: [
      { dur: 3, grade: 'Cool', motion: 'kbin', trans: 'wipeup', texts: [{ text: 'YOUR NEW FAVORITE APP', size: 62, effect: 'slide' }] },
      { dur: 3, grade: 'Cool', motion: 'pulse', texts: [{ text: 'DOWNLOAD NOW 🚀', size: 66, effect: 'bounce', color: '#00D4FF' }] },
    ],
    gfx: [{ preset: 'progress', at: 0, dur: 6, color: '#00D4FF' }] },

  { id: 'square-social', name: 'Square Social Post', icon: '⏹️', tag: 'Feed 1:1 · 6s', aspect: '1:1', grad: 3,
    scenes: [
      { dur: 3, grade: 'Vivid', motion: 'kbin', trans: 'circleopen', texts: [{ text: 'BIG NEWS', size: 88, effect: 'pop' }] },
      { dur: 3, grade: 'Vivid', motion: 'pulse', texts: [{ text: 'link in bio', size: 52, effect: 'fade', bg: true, y: 0.78, weight: 500 }] },
    ],
    gfx: [{ preset: 'frame', at: 0, dur: 6, color: '#00D4FF' }] },
];

function tplPlaceholderMedia(i, tpl) {
  const cvp = document.createElement('canvas'); cvp.width = 1280; cvp.height = 720;
  const g = cvp.getContext('2d');
  const pal = TPL_PALETTES[(i + (tpl.grad || 0)) % TPL_PALETTES.length];
  const gr = g.createLinearGradient(0, 0, 1280, 720);
  gr.addColorStop(0, pal[0]); gr.addColorStop(1, pal[1]);
  g.fillStyle = gr; g.fillRect(0, 0, 1280, 720);
  g.fillStyle = 'rgba(255,255,255,0.08)';
  for (let k = 0; k < 5; k++) { g.beginPath(); g.arc(200 + k * 260, 160 + (k % 2) * 400, 90 + k * 18, 0, 7); g.fill(); }
  g.textAlign = 'center';
  g.fillStyle = 'rgba(255,255,255,0.9)'; g.font = '600 46px Outfit, sans-serif';
  g.fillText('Your clip ' + (i + 1), 640, 368);
  g.fillStyle = 'rgba(255,255,255,0.55)'; g.font = '500 24px Outfit, sans-serif';
  g.fillText('import your media, delete this slide, drag yours into place', 640, 412);
  const url = cvp.toDataURL('image/jpeg', 0.85);
  const img = new Image(); img.src = url;
  const m = { id: uid(), kind: 'image', name: 'Placeholder ' + (i + 1), url, duration: 4, el: img, thumb: url };
  media.push(m);
  return m;
}

function applyTemplate(tpl) {
  if ((vTrack.length || tTrack.length || gTrack.length) &&
      !confirm('Applying a template replaces the clips on your timeline. Continue?')) return;
  stopPlayback();
  vTrack.length = 0; tTrack.length = 0; gTrack.length = 0;
  if (tpl.aspect && tpl.aspect !== curAspect) {
    curAspect = tpl.aspect;
    $('aspectSelect').value = tpl.aspect;
    applyResolution();
  }
  const userMedia = media.filter(m => (m.kind === 'video' || m.kind === 'image') && !/^Placeholder /.test(m.name));
  let usedPlaceholders = false;
  tpl.scenes.forEach((sc, i) => {
    const m = userMedia.length ? userMedia[i % userMedia.length] : (usedPlaceholders = true, tplPlaceholderMedia(i, tpl));
    const c = makeVideoClip(m, 0, sc.dur);
    c.grade = Object.assign(defaultGrade(), GRADE_PRESETS[sc.grade || 'None'] || {}, { preset: sc.grade || 'None' });
    c.effect = sc.effect || 'none';
    c.motion = sc.motion || 'none';
    c.fit = 'fill'; // templates look best edge-to-edge; switch per clip in CLIP tab
    c.transition = { type: sc.trans || 'none', dur: sc.transDur || 0.7 };
    vTrack.push(c);
  });
  layout();
  tpl.scenes.forEach((sc, i) => {
    (sc.texts || []).forEach(tx => {
      tTrack.push({
        id: uid(), text: tx.text, start: vTrack[i].start + (tx.at || 0),
        dur: tx.dur || Math.max(0.8, sc.dur - (tx.at || 0)),
        x: tx.x != null ? tx.x : 0.5, y: tx.y != null ? tx.y : 0.5,
        size: tx.size || 72, color: tx.color || '#FFFFFF',
        font: tx.font || 'Outfit', weight: tx.weight || 800,
        effect: tx.effect || 'pop', bg: !!tx.bg, bgColor: 'rgba(0,0,0,0.55)',
        stroke: !!tx.stroke, bbox: null,
      });
    });
  });
  (tpl.gfx || []).forEach(g => {
    const gp = GFX_PRESETS.find(p => p.id === g.preset) || { icon: '✨', name: g.preset };
    gTrack.push({
      id: uid(), kind: 'gfx', preset: g.preset, name: gp.icon + ' ' + gp.name,
      start: g.at || 0, dur: g.dur || 3,
      x: g.x != null ? g.x : 0.5, y: g.y != null ? g.y : (g.preset === 'lowerthird' ? 0.8 : 0.5),
      scale: g.scale || 1, speed: g.speed || 1, density: g.density || 40,
      color: g.color || '#00D4FF',
      text: g.text || (g.preset === 'lowerthird' ? 'Your Name' : g.preset === 'subscribe' ? 'SUBSCRIBE 🔔' : ''),
      text2: g.text2 || 'Job title · Channel', emoji: g.emoji || '😎',
    });
  });
  if (usedPlaceholders) renderMediaGrid();
  deselect();
  seek(0);
  renderTimeline(); renderInspector();
  needsRedraw = true;
  play();
}

function renderTemplates() {
  const wrap = $('tplGrid');
  wrap.innerHTML = '';
  TEMPLATES.forEach(tpl => {
    const pal = TPL_PALETTES[tpl.grad || 0];
    const el = document.createElement('div');
    el.className = 'tpl-card';
    el.innerHTML = `<div class="tpl-prev" style="background:linear-gradient(120deg,${pal[0]},${pal[1]})">${tpl.icon}</div>
      <div class="tpl-name">${tpl.name}</div>
      <div class="tpl-meta">${tpl.tag.toUpperCase()}</div>`;
    el.addEventListener('click', () => applyTemplate(tpl));
    wrap.appendChild(el);
  });
}

/* ---------- frame render ---------- */
function render(t) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, PW, PH);

  const acts = activeVideoAt(t);
  if (acts.length >= 2) {
    const A = acts[0], B = acts[1];
    drawClipInto(offACtx, A, t);
    drawClipInto(offBCtx, B, t);
    const p = clamp((t - B.start) / Math.max(A.transDur, 0.001), 0, 1);
    compositeTransition(A.transition.type, p);
  } else if (acts.length === 1) {
    drawClipInto(offACtx, acts[0], t);
    ctx.drawImage(offA, 0, 0);
  } else if (vTrack.length === 0 && tTrack.length === 0 && gTrack.length === 0) {
    drawEmptyState();
  }

  gTrack.forEach(c => {
    if (t >= c.start && t < c.start + c.dur) drawGfxClip(ctx, c, t - c.start, t);
  });

  tTrack.forEach(c => {
    if (t >= c.start && t < c.start + c.dur) drawTextClip(ctx, c, t - c.start, t);
    else c.bbox = null;
  });
}

function drawEmptyState() {
  ctx.fillStyle = 'rgba(240,240,248,0.28)';
  ctx.font = `700 ${PH * 0.045}px Outfit, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('Import media to get started', PW / 2, PH / 2 - PH * 0.03);
  ctx.fillStyle = 'rgba(240,240,248,0.16)';
  ctx.font = `400 ${PH * 0.026}px Outfit, sans-serif`;
  ctx.fillText('Drop a video on the left panel, then click it to add it to the timeline', PW / 2, PH / 2 + PH * 0.03);
}

/* ============================================================
   PLAYBACK / SYNC
   ============================================================ */
function syncMedia(t, isPlaying) {
  const acts = activeVideoAt(t);
  vTrack.forEach(c => {
    if (c.kind !== 'video') return;
    const v = c.el;
    if (acts.includes(c)) {
      const target = clamp(c.in + (t - c.start) * c.speed, 0, Math.max(0, (v.duration || 1e9) - 0.05));
      v.volume = clamp(c.volume, 0, 1);
      v.playbackRate = c.speed;
      if (isPlaying) {
        if (v.paused) { v.currentTime = target; v.play().catch(() => {}); }
        else if (Math.abs(v.currentTime - target) > 0.3) v.currentTime = target;
      } else {
        if (!v.paused) v.pause();
        if (Math.abs(v.currentTime - target) > 0.05 && c._seekT !== target) {
          c._seekT = target; v.currentTime = target;
        }
      }
    } else if (!v.paused) v.pause();
  });
  aTrack.forEach(c => {
    const a = c.el;
    const active = t >= c.start && t < c.start + c.dur;
    if (active) {
      const target = c.in + (t - c.start);
      a.volume = clamp(c.volume, 0, 1);
      if (isPlaying) {
        if (a.paused) { a.currentTime = target; a.play().catch(() => {}); }
        else if (Math.abs(a.currentTime - target) > 0.3) a.currentTime = target;
      } else {
        if (!a.paused) a.pause();
        if (Math.abs(a.currentTime - target) > 0.1 && c._seekT !== target) { c._seekT = target; a.currentTime = target; }
      }
    } else if (!a.paused) a.pause();
  });
}

function play() {
  const total = totalDuration();
  if (total <= 0) return;
  if (playhead >= total - 0.01) playhead = 0;
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  playing = true;
  clockStart = performance.now();
  clockT0 = playhead;
  $('playBtn').textContent = '⏸';
}

function stopPlayback() {
  playing = false;
  vTrack.forEach(c => { if (c.kind === 'video' && !c.el.paused) c.el.pause(); });
  aTrack.forEach(c => { if (!c.el.paused) c.el.pause(); });
  $('playBtn').textContent = '▶';
  needsRedraw = true;
}

function seek(t) {
  playhead = clamp(t, 0, totalDuration());
  if (playing) { clockStart = performance.now(); clockT0 = playhead; }
  needsRedraw = true;
}

/* ============================================================
   HUMAN FX — on-device AI segmentation (MediaPipe, lazy-loaded)
   ============================================================ */
/* Two independent CDNs; if the first stalls or is blocked, the loader falls
   back to the second automatically (same pattern as FF_CDNS in ../app.js).
   Version-pinned so the library script and its wasm/model assets match. */
const MP_VER = '0.1.1675465747';
const MP_CDNS = [
  { name: 'jsDelivr', base: 'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@' + MP_VER },
  { name: 'unpkg',    base: 'https://unpkg.com/@mediapipe/selfie_segmentation@' + MP_VER },
];
const MP_SCRIPT_TIMEOUT_MS = 20000;
const MP_INIT_TIMEOUT_MS = 30000;
let segLastFail = 0; // cooldown so the render loop doesn't retry every frame

function injectScript(src, timeoutMs) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    const t = setTimeout(() => { s.remove(); reject(new Error('script timed out: ' + src)); }, timeoutMs);
    s.src = src;
    s.onload = () => { clearTimeout(t); resolve(); };
    s.onerror = () => { clearTimeout(t); s.remove(); reject(new Error('script failed: ' + src)); };
    document.head.appendChild(s);
  });
}

async function loadSegmenter() {
  if (segLoading || segmenter || Date.now() - segLastFail < 15000) return;
  segLoading = true;
  segStatus = 'loading';
  renderInspector();
  try {
    let scriptCdn = null;
    if (!window.SelfieSegmentation) {
      for (const cdn of MP_CDNS) {
        try {
          await injectScript(cdn.base + '/selfie_segmentation.js', MP_SCRIPT_TIMEOUT_MS);
          if (window.SelfieSegmentation) { scriptCdn = cdn; break; }
        } catch (e) {
          console.warn('[VidLab] SelfieSegmentation library via ' + cdn.name + ' failed:', e);
        }
      }
      if (!window.SelfieSegmentation) throw new Error('library could not be loaded from any CDN');
    }
    // try the wasm/model assets from the CDN that served the script first
    const cdns = scriptCdn ? [scriptCdn, ...MP_CDNS.filter(c => c !== scriptCdn)] : MP_CDNS;
    let lastErr = null;
    for (const cdn of cdns) {
      try {
        const ss = new SelfieSegmentation({ locateFile: f => `${cdn.base}/${f}` });
        ss.setOptions({ modelSelection: 1 });
        ss.onResults(res => {
          segMaskCv.width = segProxyCv.width;
          segMaskCv.height = segProxyCv.height;
          segMaskCtx.clearRect(0, 0, segMaskCv.width, segMaskCv.height);
          segMaskCtx.drawImage(res.segmentationMask, 0, 0, segMaskCv.width, segMaskCv.height);
          segReady = true;
          segStatus = 'ready';
          segBusy = false;
          needsRedraw = true;
        });
        // initialize() downloads the wasm + model; race it against a watchdog
        // so a stalled CDN fails over instead of sticking on "Loading…"
        await Promise.race([
          ss.initialize(),
          new Promise((_, rej) => setTimeout(() =>
            rej(new Error('model download timed out')), MP_INIT_TIMEOUT_MS)),
        ]);
        segmenter = ss;
        segStatus = 'warming';
        renderInspector();
        return;
      } catch (e) {
        console.warn('[VidLab] segmentation model via ' + cdn.name + ' failed:', e);
        lastErr = e;
      }
    }
    throw lastErr || new Error('model could not be loaded from any CDN');
  } catch (e) {
    console.warn('[VidLab] segmentation load failed:', e);
    segStatus = 'error';
    segLoading = false; // the render loop retries after the cooldown
    segLastFail = Date.now();
    renderInspector();
  }
}

async function kickSegmentation(clip) {
  if (!segmenter) { loadSegmenter(); return; }
  if (segBusy) return;
  const src = clip.el;
  const sw = clip.kind === 'image' ? src.naturalWidth : src.videoWidth;
  const sh = clip.kind === 'image' ? src.naturalHeight : src.videoHeight;
  if (!sw || !sh) return;
  segBusy = true;
  const pw = 480, ph = Math.max(2, Math.round(480 * sh / sw / 2) * 2);
  if (segProxyCv.width !== pw || segProxyCv.height !== ph) { segProxyCv.width = pw; segProxyCv.height = ph; }
  segProxyCtx.drawImage(src, 0, 0, pw, ph);
  try {
    await segmenter.send({ image: segProxyCv });
  } catch (e) {
    /* dropped frame — ignore */
  } finally {
    /* onResults usually clears this, but the very first send (which
       pulls the WASM) can drop its frame silently — never deadlock */
    segBusy = false;
  }
}

/* ---------- main loop ---------- */
function tick() {
  requestAnimationFrame(tick);
  if (playing) {
    playhead = clockT0 + (performance.now() - clockStart) / 1000;
    const total = totalDuration();
    if (playhead >= total) {
      playhead = total;
      stopPlayback();
      if (exporting) finishExport();
    }
  }
  syncMedia(playhead, playing);
  const segClip = activeVideoAt(playhead).find(c => c.humanFx && c.humanFx !== 'none');
  if (segClip && (playing || needsRedraw || !segReady)) kickSegmentation(segClip);
  if (playing || needsRedraw) {
    render(playhead);
    needsRedraw = false;
  }
  updatePlayheadUI();
  $('tcCur').textContent = fmtTime(playhead);
  $('tcTotal').textContent = fmtTime(totalDuration());
  if (exporting) {
    const total = totalDuration();
    $('exportProgress').style.width = (total > 0 ? clamp(playhead / total, 0, 1) * 100 : 0) + '%';
  }
}

/* ============================================================
   TIMELINE UI
   ============================================================ */
const tlScroll = $('tlScroll'), tlInner = $('tlInner');
const trackVideo = $('trackVideo'), trackText = $('trackText'), trackAudio = $('trackAudio'), trackGfx = $('trackGfx');
const ruler = $('ruler'), playheadEl = $('playhead');

function renderTimeline() {
  layout();
  const total = totalDuration();
  const width = Math.max(total * pps + 320, tlScroll.clientWidth - 34);
  tlInner.style.width = (34 + width) + 'px';
  drawRuler(width);

  buildTrack(trackVideo, vTrack, 'v');
  buildTrack(trackText, tTrack, 't');
  buildTrack(trackGfx, gTrack, 'g');
  buildTrack(trackAudio, aTrack, 'a');

  /* transition badges between video clips */
  for (let i = 0; i < vTrack.length - 1; i++) {
    const c = vTrack[i];
    const x = vTrack[i + 1].start * pps + (c.transDur * pps) / 2;
    const b = document.createElement('div');
    b.className = 'trans-badge' + (c.transition.type === 'none' ? ' none' : '');
    b.style.left = x + 'px';
    b.title = 'Transition: ' + (TRANSITIONS.find(x2 => x2.id === c.transition.type) || {}).name;
    b.addEventListener('pointerdown', e => {
      e.stopPropagation();
      select('v', c); inspTab = 'Trans';
      renderTimeline(); renderInspector();
    });
    trackVideo.appendChild(b);
  }
}

function buildTrack(trackEl, clips, type) {
  [...trackEl.querySelectorAll('.tl-clip, .trans-badge')].forEach(n => n.remove());
  clips.forEach(c => {
    const start = type === 'v' ? c.start : c.start;
    const el = document.createElement('div');
    el.className = 'tl-clip clip-' + (type === 't' ? 'text' : type === 'a' ? 'audio' : c.kind);
    if (selected && selected.clip === c) el.classList.add('selected');
    el.style.left = start * pps + 'px';
    el.style.width = Math.max(14, c.dur * pps) + 'px';
    const label = type === 't' ? ('T · ' + c.text.split('\n')[0]) : c.name;
    el.innerHTML = `<span class="clip-label">${escapeHtml(label)}</span>
      <span class="trim-handle trim-l"></span><span class="trim-handle trim-r"></span>`;
    el.addEventListener('pointerdown', e => clipPointerDown(e, c, type, el));
    trackEl.appendChild(el);
    c._el = el;
  });
}

/* ---------- drag / trim / reorder ---------- */
function clipPointerDown(e, c, type, el) {
  e.preventDefault();
  select(type, c); renderTimeline(); renderInspector();
  el = c._el; // re-rendered node
  const mode = e.target.classList.contains('trim-l') ? 'trim-l'
    : e.target.classList.contains('trim-r') ? 'trim-r' : 'move';
  const startX = e.clientX;
  const snap = { in: c.in, dur: c.dur, start: c.start };
  const m = media.find(x => x.id === c.mediaId);
  let moved = false;

  const onMove = ev => {
    const dt = (ev.clientX - startX) / pps;
    if (Math.abs(ev.clientX - startX) > 3) moved = true;
    if (!moved) return;

    if (mode === 'trim-l') {
      if (type === 'v') {
        if (c.kind === 'video') {
          const d = clamp(dt, -snap.in / c.speed, snap.dur - 0.2);
          c.in = snap.in + d * c.speed;
          c.dur = snap.dur - d;
        } else {
          c.dur = clamp(snap.dur - dt, 0.2, 120);
        }
      } else if (type === 'a') {
        const d = clamp(dt, -snap.in, snap.dur - 0.2);
        c.in = snap.in + d; c.dur = snap.dur - d; c.start = snap.start + d;
      } else {
        const d = clamp(dt, -snap.start, snap.dur - 0.2);
        c.start = snap.start + d; c.dur = snap.dur - d;
      }
    } else if (mode === 'trim-r') {
      if (type === 'v' && c.kind === 'video' && m && m.duration) {
        c.dur = clamp(snap.dur + dt, 0.2, (m.duration - c.in) / c.speed);
      } else if (type === 'a' && m && m.duration) {
        c.dur = clamp(snap.dur + dt, 0.2, m.duration - c.in);
      } else {
        c.dur = clamp(snap.dur + dt, 0.2, 300);
      }
    } else { /* move */
      if (type === 'v') {
        c._el.classList.add('dragging');
        c._el.style.transform = `translateX(${dt * pps}px)`;
        c._dragDt = dt;
        return; // reorder resolved on pointerup
      }
      c.start = Math.max(0, snap.start + dt);
    }
    renderTimeline(); renderInspector();
    needsRedraw = true;
  };

  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    if (type === 'v' && mode === 'move' && moved && c._dragDt) {
      const center = snap.start + c._dragDt + c.dur / 2;
      const others = vTrack.filter(x => x !== c);
      let idx = others.length;
      for (let i = 0; i < others.length; i++) {
        if (center < others[i].start + others[i].dur / 2) { idx = i; break; }
      }
      others.splice(idx, 0, c);
      vTrack.length = 0; vTrack.push(...others);
      c._dragDt = 0;
    }
    renderTimeline(); renderInspector();
    needsRedraw = true;
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

/* ---------- ruler ---------- */
function drawRuler(width) {
  ruler.width = width;
  ruler.height = 26;
  const rc = ruler.getContext('2d');
  rc.clearRect(0, 0, width, 26);
  rc.fillStyle = 'rgba(240,240,248,0.3)';
  rc.font = '9px "JetBrains Mono", monospace';
  const labelEvery = [1, 2, 5, 10, 30].find(v => v * pps >= 64) || 60;
  const secs = Math.ceil(width / pps);
  for (let s = 0; s <= secs; s++) {
    const x = s * pps;
    const isLabel = s % labelEvery === 0;
    rc.fillStyle = isLabel ? 'rgba(240,240,248,0.35)' : 'rgba(240,240,248,0.12)';
    rc.fillRect(x, isLabel ? 12 : 18, 1, isLabel ? 14 : 8);
    if (isLabel) {
      rc.fillStyle = 'rgba(240,240,248,0.4)';
      rc.fillText(fmtTime(s).slice(0, 5), x + 4, 9);
    }
  }
}

ruler.addEventListener('pointerdown', e => {
  const rect = ruler.getBoundingClientRect();
  const toT = ev => clamp((ev.clientX - rect.left) / pps, 0, totalDuration());
  seek(toT(e));
  const onMove = ev => seek(toT(ev));
  const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
});

function updatePlayheadUI() {
  const x = 34 + playhead * pps;
  playheadEl.style.left = x + 'px';
  if (playing) {
    const view = tlScroll.scrollLeft;
    if (x > view + tlScroll.clientWidth - 80 || x < view) tlScroll.scrollLeft = x - 120;
  }
}

/* ============================================================
   SELECTION / EDIT OPS
   ============================================================ */
function select(type, clip) {
  selected = clip ? { type, clip } : null;
  if (clip) {
    const defTab = type === 'v' ? 'Grade' : type === 't' ? 'Text' : type === 'g' ? 'Graphic' : 'Audio';
    if (!inspTab || !tabsFor(type).includes(inspTab)) inspTab = defTab;
  }
}

function deselect() {
  selected = null;
  renderTimeline(); renderInspector();
}

function deleteSelected() {
  if (!selected) return;
  const { type, clip } = selected;
  const arr = type === 'v' ? vTrack : type === 't' ? tTrack : type === 'g' ? gTrack : aTrack;
  const i = arr.indexOf(clip);
  if (i >= 0) arr.splice(i, 1);
  if (clip.kind === 'video' || type === 'a') { try { clip.el.pause(); } catch (_) {} }
  selected = null;
  renderTimeline(); renderInspector();
  needsRedraw = true;
}

function splitAtPlayhead() {
  layout();
  let target = null, type = null;
  if (selected && selected.type !== 'v') {
    const c = selected.clip;
    if (playhead > c.start + 0.15 && playhead < c.start + c.dur - 0.15) { target = c; type = selected.type; }
  }
  if (!target) {
    target = vTrack.find(c => playhead > c.start + 0.15 && playhead < c.start + c.dur - 0.15);
    type = 'v';
  }
  if (!target) return;

  const lt = playhead - target.start;
  if (type === 'v') {
    const m = media.find(x => x.id === target.mediaId);
    const c2 = makeVideoClip(m, target.in + lt * target.speed, target.dur - lt);
    c2.speed = target.speed; c2.volume = target.volume;
    c2.grade = { ...target.grade }; c2.effect = target.effect;
    c2.transition = { ...target.transition };
    target.dur = lt;
    target.transition = { type: 'none', dur: 0.8 };
    vTrack.splice(vTrack.indexOf(target) + 1, 0, c2);
    select('v', c2);
  } else if (type === 't') {
    const c2 = { ...target, id: uid(), start: playhead, dur: target.dur - lt };
    target.dur = lt;
    tTrack.push(c2);
    select('t', c2);
  } else if (type === 'g') {
    const c2 = { ...target, id: uid(), start: playhead, dur: target.dur - lt };
    target.dur = lt;
    gTrack.push(c2);
    select('g', c2);
  } else {
    const m = media.find(x => x.id === target.mediaId);
    const c2 = { ...target, id: uid(), start: playhead, in: target.in + lt, dur: target.dur - lt };
    c2.el = document.createElement('audio'); c2.el.src = m.url; c2.el.preload = 'auto';
    hookClipAudio(c2);
    target.dur = lt;
    aTrack.push(c2);
    select('a', c2);
  }
  renderTimeline(); renderInspector();
  needsRedraw = true;
}

function duplicateSelected() {
  if (!selected) return;
  const { type, clip } = selected;
  if (type === 'v') {
    const m = media.find(x => x.id === clip.mediaId);
    const c2 = makeVideoClip(m, clip.in, clip.dur);
    c2.speed = clip.speed; c2.volume = clip.volume;
    c2.grade = { ...clip.grade }; c2.effect = clip.effect;
    c2.transition = { ...clip.transition };
    vTrack.splice(vTrack.indexOf(clip) + 1, 0, c2);
    select('v', c2);
  } else if (type === 't') {
    const c2 = { ...clip, id: uid(), start: clip.start + clip.dur };
    tTrack.push(c2);
    select('t', c2);
  } else if (type === 'g') {
    const c2 = { ...clip, id: uid(), start: clip.start + clip.dur };
    gTrack.push(c2);
    select('g', c2);
  } else {
    const m = media.find(x => x.id === clip.mediaId);
    const c2 = { ...clip, id: uid(), start: clip.start + clip.dur };
    c2.el = document.createElement('audio'); c2.el.src = m.url; c2.el.preload = 'auto';
    hookClipAudio(c2);
    aTrack.push(c2);
    select('a', c2);
  }
  renderTimeline(); renderInspector();
  needsRedraw = true;
}

/* ============================================================
   TEXT
   ============================================================ */
function addTextClip(preset) {
  const c = {
    id: uid(), text: preset.text || 'Your text', start: playhead, dur: 3,
    x: 0.5, y: 0.5, size: preset.size || 64, color: preset.color || '#FFFFFF',
    font: preset.font || 'Outfit', weight: preset.weight || 600,
    effect: preset.effect || 'none', bg: !!preset.bg, bgColor: 'rgba(0,0,0,0.55)',
    stroke: false, bbox: null,
  };
  tTrack.push(c);
  select('t', c);
  renderTimeline(); renderInspector();
  needsRedraw = true;
}

function renderTextPresets() {
  const wrap = $('textPresets');
  wrap.innerHTML = '';
  TEXT_PRESETS.forEach(p => {
    const el = document.createElement('div');
    el.className = 'text-preset';
    const grad = p.effect === 'gradient';
    el.innerHTML = `<span class="tp-sample" style="font-family:'${p.font}';font-weight:${p.weight};color:${grad ? 'transparent' : p.color};${grad ? 'background:linear-gradient(90deg,#00D4FF,#FF006E);-webkit-background-clip:text;background-clip:text;' : ''}${p.effect === 'neon' || p.effect === 'glow' ? `text-shadow:0 0 14px ${p.color};` : ''}${p.bg ? 'background:rgba(0,0,0,0.55);border-radius:6px;padding:2px 10px;' : ''}">${escapeHtml(p.text)}</span>
      <span class="tp-name">${p.name}</span>`;
    el.addEventListener('click', () => addTextClip(p));
    wrap.appendChild(el);
  });
}

/* ---------- drag text on preview ---------- */
let dragText = null, dragOff = { x: 0, y: 0 };

function canvasPoint(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) * PW / r.width, y: (e.clientY - r.top) * PH / r.height };
}

function textAtPoint(p) {
  for (let i = tTrack.length - 1; i >= 0; i--) {
    const c = tTrack[i];
    if (!c.bbox) continue;
    const pad = 10;
    if (p.x >= c.bbox.x - pad && p.x <= c.bbox.x + c.bbox.w + pad && p.y >= c.bbox.y - pad && p.y <= c.bbox.y + c.bbox.h + pad) return c;
  }
  return null;
}

canvas.addEventListener('pointerdown', e => {
  const p = canvasPoint(e);
  const c = textAtPoint(p);
  if (c) {
    dragText = c;
    dragOff.x = p.x - c.x * PW; dragOff.y = p.y - c.y * PH;
    select('t', c); renderTimeline(); renderInspector();
    canvas.setPointerCapture(e.pointerId);
  }
});
canvas.addEventListener('pointermove', e => {
  const p = canvasPoint(e);
  if (dragText) {
    dragText.x = clamp((p.x - dragOff.x) / PW, 0, 1);
    dragText.y = clamp((p.y - dragOff.y) / PH, 0, 1);
    needsRedraw = true;
  } else {
    canvas.classList.toggle('text-hover', !!textAtPoint(p));
  }
});
canvas.addEventListener('pointerup', () => { dragText = null; });

/* ============================================================
   INSPECTOR
   ============================================================ */
const inspector = $('inspector');
function tabsFor(type) {
  return type === 'v' ? ['Grade', 'FX', 'Motion', 'Human', 'Trans', 'Clip']
    : type === 't' ? ['Text', 'Style', 'Effect']
    : type === 'g' ? ['Graphic']
    : ['Audio'];
}

function renderInspector() {
  if (!selected) {
    inspector.innerHTML = `<div class="inspector-empty"><div class="ie-icon">✦</div>
      <p>Select a clip on the timeline to edit its <b>color grade</b>, <b>effects</b>, <b>transition</b>, speed and volume.</p></div>`;
    return;
  }
  const { type, clip } = selected;
  inspector.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'insp-header';
  const kindLabel = type === 'v' ? (clip.kind === 'image' ? 'Image clip' : 'Video clip') : type === 't' ? 'Text clip' : type === 'g' ? 'Motion graphic' : 'Audio clip';
  const kindClass = type === 't' || type === 'g' ? 'text-kind' : type === 'a' ? 'audio-kind' : '';
  head.innerHTML = `<div class="insp-kind ${kindClass}">${kindLabel} · ${clip.dur.toFixed(1)}s</div>
    <div class="insp-title">${escapeHtml(type === 't' ? clip.text.split('\n')[0] : clip.name)}</div>`;
  inspector.appendChild(head);

  const tabs = tabsFor(type);
  const tabBar = document.createElement('div');
  tabBar.className = 'insp-tabs';
  tabs.forEach(tb => {
    const b = document.createElement('button');
    b.className = 'insp-tab' + (tb === inspTab ? ' active' : '');
    b.textContent = tb;
    b.addEventListener('click', () => { inspTab = tb; renderInspector(); });
    tabBar.appendChild(b);
  });
  inspector.appendChild(tabBar);

  const body = document.createElement('div');
  body.className = 'insp-body';
  inspector.appendChild(body);

  if (type === 'v') {
    if (inspTab === 'Grade') buildGradeTab(body, clip);
    else if (inspTab === 'FX') buildEffectsTab(body, clip);
    else if (inspTab === 'Motion') buildMotionTab(body, clip);
    else if (inspTab === 'Human') buildHumanTab(body, clip);
    else if (inspTab === 'Trans') buildTransitionTab(body, clip);
    else buildClipTab(body, clip);
  } else if (type === 't') {
    if (inspTab === 'Text') buildTextTab(body, clip);
    else if (inspTab === 'Style') buildTextStyleTab(body, clip);
    else buildTextEffectTab(body, clip);
  } else if (type === 'g') {
    buildGfxTab(body, clip);
  } else {
    buildAudioTab(body, clip);
  }
}

/* ---- UI builders ---- */
function sliderRow(parent, label, value, min, max, step, fmt, oninput) {
  const row = document.createElement('div');
  row.className = 'ctl-row';
  row.innerHTML = `<div class="ctl-label"><span>${label}</span><span class="ctl-value"></span></div>`;
  const val = row.querySelector('.ctl-value');
  const input = document.createElement('input');
  input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = value;
  val.textContent = fmt(value);
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    val.textContent = fmt(v);
    oninput(v);
    needsRedraw = true;
  });
  row.appendChild(input);
  parent.appendChild(row);
  return input;
}

function chipGrid(parent, options, isActive, onpick, cyan) {
  const grid = document.createElement('div');
  grid.className = 'chip-grid';
  options.forEach(op => {
    const b = document.createElement('button');
    b.className = 'chip' + (isActive(op) ? (cyan ? ' active active-cyan' : ' active') : '');
    b.textContent = op.name || op;
    b.addEventListener('click', () => { onpick(op); needsRedraw = true; renderInspector(); });
    grid.appendChild(b);
  });
  parent.appendChild(grid);
  return grid;
}

function sectionLabel(parent, text) {
  const s = document.createElement('div');
  s.className = 'insp-section-label';
  s.textContent = text;
  parent.appendChild(s);
}

function buildGradeTab(body, clip) {
  const g = clip.grade;
  sectionLabel(body, '// Presets');
  chipGrid(body, Object.keys(GRADE_PRESETS), name => g.preset === name, name => {
    const fresh = defaultGrade();
    Object.assign(fresh, GRADE_PRESETS[name], { preset: name });
    clip.grade = fresh;
  });
  sectionLabel(body, '// Adjust');
  const custom = () => { g.preset = 'Custom'; };
  sliderRow(body, 'Brightness', g.brightness, 40, 180, 1, v => v + '%', v => { g.brightness = v; custom(); });
  sliderRow(body, 'Contrast', g.contrast, 40, 200, 1, v => v + '%', v => { g.contrast = v; custom(); });
  sliderRow(body, 'Saturation', g.saturate, 0, 250, 1, v => v + '%', v => { g.saturate = v; custom(); });
  sliderRow(body, 'Temperature', g.temp, -100, 100, 1, v => (v > 0 ? '+' : '') + v, v => { g.temp = v; custom(); });
  sliderRow(body, 'Tint', g.tint, -100, 100, 1, v => (v > 0 ? '+' : '') + v, v => { g.tint = v; custom(); });
  sliderRow(body, 'Hue', g.hue, -180, 180, 1, v => v + '°', v => { g.hue = v; custom(); });
  sliderRow(body, 'Sepia', g.sepia, 0, 100, 1, v => v + '%', v => { g.sepia = v; custom(); });
  sliderRow(body, 'Blur', g.blur, 0, 12, 0.5, v => v + 'px', v => { g.blur = v; custom(); });
  sliderRow(body, 'Vignette', g.vignette, 0, 100, 1, v => v + '%', v => { g.vignette = v; custom(); });
  const reset = document.createElement('button');
  reset.className = 'reset-link'; reset.textContent = 'Reset grade';
  reset.addEventListener('click', () => { clip.grade = defaultGrade(); needsRedraw = true; renderInspector(); });
  body.appendChild(reset);
}

function buildEffectsTab(body, clip) {
  sectionLabel(body, '// Visual effect');
  chipGrid(body, EFFECTS, op => clip.effect === op.id, op => { clip.effect = op.id; });
}

function buildMotionTab(body, clip) {
  sectionLabel(body, '// Clip motion');
  const hint = document.createElement('div');
  hint.className = 'panel-hint';
  hint.textContent = 'Animated transforms applied over the clip — Ken Burns zooms, pans, spins and handheld shake.';
  body.appendChild(hint);
  chipGrid(body, MOTIONS, op => clip.motion === op.id, op => { clip.motion = op.id; });
}

function buildHumanTab(body, clip) {
  sectionLabel(body, '// Human effects · AI');
  const hint = document.createElement('div');
  hint.className = 'panel-hint';
  hint.textContent = 'On-device AI separates the person from the background. It sets up once on first use and is saved for next time — nothing is uploaded. Works best on talking-head footage.';
  body.appendChild(hint);
  const status = document.createElement('div');
  status.className = 'seg-status' + (segStatus === 'ready' ? ' ready' : '');
  status.textContent = segStatus === 'ready' ? '● AI model ready'
    : segStatus === 'loading' || segStatus === 'warming' ? '● Loading AI model…'
    : segStatus === 'error' ? '● Model failed to load — check connection or ad blocker; retrying shortly'
    : '● Model loads when you pick an effect';
  body.appendChild(status);
  chipGrid(body, HUMAN_FX, op => clip.humanFx === op.id, op => {
    clip.humanFx = op.id;
    clip._echo = null;
    if (op.id !== 'none') loadSegmenter();
  });
  if (['bgcolor', 'glow', 'silhouette'].includes(clip.humanFx)) {
    sectionLabel(body, '// Effect color');
    const row = document.createElement('div');
    row.className = 'color-row';
    const cp = document.createElement('input');
    cp.type = 'color'; cp.value = clip.humanColor;
    cp.addEventListener('input', () => { clip.humanColor = cp.value; needsRedraw = true; });
    row.appendChild(cp);
    body.appendChild(row);
  }
}

function buildGfxTab(body, clip) {
  const meta = GFX_PRESETS.find(p => p.id === clip.preset) || { params: [] };
  const has = p => meta.params.includes(p);
  if (has('text')) {
    sectionLabel(body, '// Text');
    const in1 = document.createElement('input');
    in1.className = 'insp-input'; in1.value = clip.text;
    in1.addEventListener('input', () => { clip.text = in1.value; needsRedraw = true; });
    body.appendChild(in1);
  }
  if (has('text2')) {
    const in2 = document.createElement('input');
    in2.className = 'insp-input'; in2.value = clip.text2;
    in2.addEventListener('input', () => { clip.text2 = in2.value; needsRedraw = true; });
    body.appendChild(in2);
  }
  if (has('emoji')) {
    sectionLabel(body, '// Emoji');
    const em = document.createElement('input');
    em.className = 'insp-input'; em.value = clip.emoji;
    em.addEventListener('input', () => { clip.emoji = em.value || '😎'; needsRedraw = true; });
    body.appendChild(em);
  }
  if (has('pos')) {
    sectionLabel(body, '// Position');
    sliderRow(body, 'Position X', Math.round(clip.x * 100), 0, 100, 1, v => v + '%', v => { clip.x = v / 100; });
    sliderRow(body, 'Position Y', Math.round(clip.y * 100), 0, 100, 1, v => v + '%', v => { clip.y = v / 100; });
  }
  if (has('scale')) sliderRow(body, 'Scale', clip.scale, 0.3, 3, 0.05, v => v.toFixed(2) + '×', v => { clip.scale = v; });
  if (has('speed')) sliderRow(body, 'Speed', clip.speed, 0.2, 3, 0.05, v => v.toFixed(2) + '×', v => { clip.speed = v; });
  if (has('density')) sliderRow(body, 'Density', clip.density, 5, 100, 1, v => '' + v, v => { clip.density = v; });
  if (has('color')) {
    sectionLabel(body, '// Color');
    const row = document.createElement('div');
    row.className = 'color-row';
    const cp = document.createElement('input');
    cp.type = 'color'; cp.value = clip.color;
    cp.addEventListener('input', () => { clip.color = cp.value; needsRedraw = true; });
    row.appendChild(cp);
    body.appendChild(row);
  }
}

function buildTransitionTab(body, clip) {
  const idx = vTrack.indexOf(clip);
  if (idx === vTrack.length - 1) {
    const hint = document.createElement('div');
    hint.className = 'panel-hint';
    hint.textContent = 'This is the last clip — add another clip after it to see the transition play.';
    body.appendChild(hint);
  }
  sectionLabel(body, '// Transition to next clip');
  chipGrid(body, TRANSITIONS, op => clip.transition.type === op.id, op => {
    clip.transition.type = op.id;
    renderTimeline();
  }, true);
  sliderRow(body, 'Duration', clip.transition.dur, 0.2, 2, 0.1, v => v.toFixed(1) + 's', v => {
    clip.transition.dur = v;
    renderTimeline();
  });
}

function buildClipTab(body, clip) {
  sectionLabel(body, '// Framing');
  chipGrid(body, [{ name: 'Fit (whole image)', id: 'fit' }, { name: 'Fill (crop to frame)', id: 'fill' }],
    op => (clip.fit || 'fit') === op.id, op => { clip.fit = op.id; }, true);
  sectionLabel(body, '// Custom crop');
  if (!clip.crop) clip.crop = { l: 0, t: 0, r: 0, b: 0 };
  sliderRow(body, 'Crop left', Math.round(clip.crop.l * 100), 0, 45, 1, v => v + '%', v => { clip.crop.l = v / 100; });
  sliderRow(body, 'Crop right', Math.round(clip.crop.r * 100), 0, 45, 1, v => v + '%', v => { clip.crop.r = v / 100; });
  sliderRow(body, 'Crop top', Math.round(clip.crop.t * 100), 0, 45, 1, v => v + '%', v => { clip.crop.t = v / 100; });
  sliderRow(body, 'Crop bottom', Math.round(clip.crop.b * 100), 0, 45, 1, v => v + '%', v => { clip.crop.b = v / 100; });
  if (clip.kind === 'video') {
    sliderRow(body, 'Speed', clip.speed, 0.25, 3, 0.05, v => v.toFixed(2) + '×', v => {
      const srcSpan = clip.dur * clip.speed;
      clip.speed = v;
      clip.dur = Math.max(0.2, srcSpan / v);
      renderTimeline();
    });
    sliderRow(body, 'Volume', Math.round(clip.volume * 100), 0, 100, 1, v => v + '%', v => { clip.volume = v / 100; });
  } else {
    sliderRow(body, 'Duration', clip.dur, 0.5, 30, 0.1, v => v.toFixed(1) + 's', v => { clip.dur = v; renderTimeline(); });
  }
}

function buildTextTab(body, clip) {
  sectionLabel(body, '// Content');
  const ta = document.createElement('textarea');
  ta.className = 'insp-textarea';
  ta.value = clip.text;
  ta.addEventListener('input', () => { clip.text = ta.value || ' '; needsRedraw = true; renderTimeline(); });
  body.appendChild(ta);
  sliderRow(body, 'Position X', Math.round(clip.x * 100), 0, 100, 1, v => v + '%', v => { clip.x = v / 100; });
  sliderRow(body, 'Position Y', Math.round(clip.y * 100), 0, 100, 1, v => v + '%', v => { clip.y = v / 100; });
  const hint = document.createElement('div');
  hint.className = 'panel-hint';
  hint.textContent = 'Tip: you can also drag the text directly on the preview.';
  body.appendChild(hint);
}

function buildTextStyleTab(body, clip) {
  sectionLabel(body, '// Font');
  const sel = document.createElement('select');
  sel.className = 'select'; sel.style.width = '100%';
  FONTS.forEach(f => {
    const o = document.createElement('option');
    o.value = f; o.textContent = f; o.selected = clip.font === f;
    sel.appendChild(o);
  });
  sel.addEventListener('change', () => { clip.font = sel.value; needsRedraw = true; });
  body.appendChild(sel);
  chipGrid(body, [{ name: 'Regular', id: 400 }, { name: 'Semibold', id: 600 }, { name: 'Bold', id: 800 }],
    op => clip.weight === op.id, op => { clip.weight = op.id; }, true);
  sliderRow(body, 'Size', clip.size, 20, 220, 1, v => v + 'px', v => { clip.size = v; });
  sectionLabel(body, '// Color');
  const colorRow = document.createElement('div');
  colorRow.className = 'color-row';
  const cp = document.createElement('input');
  cp.type = 'color'; cp.value = clip.color;
  cp.addEventListener('input', () => { clip.color = cp.value; needsRedraw = true; });
  colorRow.appendChild(cp);
  body.appendChild(colorRow);
  sectionLabel(body, '// Extras');
  chipGrid(body, [{ name: 'Background', id: 'bg' }, { name: 'Outline', id: 'stroke' }],
    op => !!clip[op.id], op => { clip[op.id] = !clip[op.id]; }, true);
}

function buildTextEffectTab(body, clip) {
  sectionLabel(body, '// Animation');
  chipGrid(body, TEXT_EFFECTS, op => clip.effect === op.id, op => { clip.effect = op.id; }, true);
}

function buildAudioTab(body, clip) {
  sliderRow(body, 'Volume', Math.round(clip.volume * 100), 0, 100, 1, v => v + '%', v => { clip.volume = v / 100; });
}

/* ============================================================
   AUDIO GRAPH (export routing)
   ============================================================ */
function ensureAudioGraph() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.connect(audioCtx.destination);
    audioDest = audioCtx.createMediaStreamDestination();
    masterGain.connect(audioDest);
  }
  vTrack.forEach(c => { if (c.kind === 'video') hookClipAudio(c); });
  aTrack.forEach(hookClipAudio);
  audioCtx.resume();
}

function hookClipAudio(c) {
  if (!audioCtx || c._srcNode || !c.el || c.kind === 'image') return;
  try {
    c._srcNode = audioCtx.createMediaElementSource(c.el);
    c._srcNode.connect(masterGain);
  } catch (_) { /* element already connected elsewhere */ }
}

/* ============================================================
   EXPORT
   ============================================================ */
function pickMime() {
  // prefer recording straight to MP4 (newer Chrome/Safari); otherwise record
  // WebM and convert to MP4 with the processing engine after recording
  const opts = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm',
  ];
  return opts.find(m => MediaRecorder.isTypeSupported(m)) || '';
}

function startExport() {
  const total = totalDuration();
  if (total <= 0) { alert('Add some clips to the timeline first.'); return; }
  ensureAudioGraph();
  stopPlayback();
  seek(0);
  exportCancelled = false;
  exportChunks = [];
  if (exportUrl) { URL.revokeObjectURL(exportUrl); exportUrl = null; }

  const stream = canvas.captureStream(30);
  const at = audioDest && audioDest.stream.getAudioTracks()[0];
  if (at) stream.addTrack(at);
  const bitrates = { 720: 8_000_000, 1080: 14_000_000, 1440: 24_000_000, 2160: 42_000_000 };
  recorder = new MediaRecorder(stream, { mimeType: pickMime(), videoBitsPerSecond: bitrates[curQuality] || 8_000_000 });
  recorder.ondataavailable = e => { if (e.data.size) exportChunks.push(e.data); };
  recorder.onstop = async () => {
    if (exportCancelled) return;
    const recMime = (recorder.mimeType || 'video/webm').split(';')[0];
    let blob = new Blob(exportChunks, { type: recMime });
    let ext = recMime.includes('mp4') ? '.mp4' : '.webm';
    if (ext !== '.mp4' && typeof getFFmpeg === 'function') {
      try {
        $('exportTitle').textContent = 'Finalizing…';
        $('exportSub').textContent = 'Your video is processing, please wait…';
        $('exportProgress').style.width = '0%';
        const ffmpeg = await getFFmpeg(s => { $('exportSub').textContent = s; });
        if (exportCancelled) return;
        $('exportSub').textContent = 'Your video is processing, please wait…';
        const onProg = ({ progress }) => { $('exportProgress').style.width = (clamp(progress, 0, 1) * 100).toFixed(1) + '%'; };
        ffmpeg.on('progress', onProg);
        await ffmpeg.writeFile('in.webm', new Uint8Array(await blob.arrayBuffer()));
        const rc = await ffmpeg.exec(['-i', 'in.webm', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
          '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', 'out.mp4']);
        ffmpeg.off('progress', onProg);
        if (rc === 0) {
          const data = await ffmpeg.readFile('out.mp4');
          blob = new Blob([data.buffer], { type: 'video/mp4' });
          ext = '.mp4';
        }
        await ffmpeg.deleteFile('in.webm').catch(() => {});
        await ffmpeg.deleteFile('out.mp4').catch(() => {});
      } catch (e) {
        console.warn('[ClipCut] MP4 conversion unavailable, keeping recorded format:', e);
      }
      if (exportCancelled) return;
    }
    exportUrl = URL.createObjectURL(blob);
    const dl = $('exportDownload');
    dl.href = exportUrl;
    dl.download = 'Downloaded from 7by.in' + ext;
    dl.classList.remove('hidden');
    $('exportTitle').textContent = 'Export complete ✓';
    $('exportSub').textContent = `${ext === '.mp4' ? 'MP4' : 'Video'} · ${(blob.size / 1048576).toFixed(1)} MB · ${PW}×${PH} @ 30fps`;
    $('exportProgress').style.width = '100%';
    $('exportCancel').textContent = 'Close';
  };

  $('exportTitle').textContent = 'Exporting video…';
  $('exportSub').textContent = 'Your video is processing, please wait…';
  $('exportDownload').classList.add('hidden');
  $('exportCancel').textContent = 'Cancel';
  $('exportProgress').style.width = '0%';
  $('exportModal').classList.remove('hidden');

  exporting = true;
  recorder.start(250);
  play();
}

function finishExport() {
  exporting = false;
  if (recorder && recorder.state !== 'inactive') recorder.stop();
  $('exportProgress').style.width = '100%';
}

$('exportCancel').addEventListener('click', () => {
  if (exporting) {
    exportCancelled = true;
    exporting = false;
    stopPlayback();
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }
  $('exportModal').classList.add('hidden');
});

/* ============================================================
   WIRING
   ============================================================ */
$('fileInput').addEventListener('change', e => { importFiles(e.target.files); e.target.value = ''; });
$('dropzone').addEventListener('click', () => $('fileInput').click());
['dragover', 'dragenter'].forEach(ev => $('dropzone').addEventListener(ev, e => { e.preventDefault(); $('dropzone').classList.add('dragover'); }));
['dragleave', 'drop'].forEach(ev => $('dropzone').addEventListener(ev, e => { e.preventDefault(); $('dropzone').classList.remove('dragover'); }));
$('dropzone').addEventListener('drop', e => importFiles(e.dataTransfer.files));

document.querySelectorAll('.ptab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.ptab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.ptab-page').forEach(p => p.classList.add('hidden'));
    $('page-' + tab.dataset.tab).classList.remove('hidden');
  });
});

$('playBtn').addEventListener('click', () => playing ? stopPlayback() : play());
$('toStartBtn').addEventListener('click', () => seek(0));
$('toEndBtn').addEventListener('click', () => seek(totalDuration()));
$('splitBtn').addEventListener('click', splitAtPlayhead);
$('dupBtn').addEventListener('click', duplicateSelected);
$('delBtn').addEventListener('click', deleteSelected);
$('exportBtn').addEventListener('click', startExport);

$('zoomSlider').addEventListener('input', e => {
  pps = parseFloat(e.target.value);
  renderTimeline();
});

$('aspectSelect').addEventListener('change', e => {
  curAspect = e.target.value;
  applyResolution();
});

$('qualitySelect').addEventListener('change', e => {
  curQuality = parseInt(e.target.value, 10);
  applyResolution();
});

window.addEventListener('keydown', e => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
  if (e.code === 'Space') { e.preventDefault(); playing ? stopPlayback() : play(); }
  else if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
  else if (e.key === 's' || e.key === 'S') splitAtPlayhead();
  else if (e.key === 'd' || e.key === 'D') duplicateSelected();
  else if (e.key === 'Home') seek(0);
  else if (e.key === 'End') seek(totalDuration());
  else if (e.key === 'ArrowLeft') seek(playhead - (e.shiftKey ? 1 : 1 / 30));
  else if (e.key === 'ArrowRight') seek(playhead + (e.shiftKey ? 1 : 1 / 30));
  else if (e.key === 'Escape') deselect();
});

window.addEventListener('resize', () => renderTimeline());

/* boot */
applyResolution();
renderTextPresets();
renderGfxPresets();
renderTemplates();
renderMediaGrid();
renderTimeline();
renderInspector();
requestAnimationFrame(tick);
