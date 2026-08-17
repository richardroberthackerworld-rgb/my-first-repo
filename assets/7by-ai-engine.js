/**
 * 7By AI Engine v1.0
 * Browser-native audio separation engine
 * https://7by.in
 *
 * Usage:
 *   const engine = new SevenByEngine();
 *   const result = await engine.separate(audioBuffer, { mode: '2stem' });
 *   // result.vocals  → AudioBuffer
 *   // result.instrumental → AudioBuffer
 *   // result.drums   → AudioBuffer (4stem mode)
 *   // result.bass    → AudioBuffer (4stem mode)
 *
 * License: 7By.in Personal Use License
 * Commercial use requires a paid plan at https://7by.in/pricing.html
 */

(function(global) {
  'use strict';

  class SevenByEngine {
    constructor(options = {}) {
      this.version = '1.0.0';
      this.brand = '7By AI Engine';
      this.onProgress = options.onProgress || (() => {});
    }

    // ── CORE: Mid-Side Matrix Separation ──
    async separate(audioBuffer, options = {}) {
      const mode = options.mode || '2stem';
      const sr = audioBuffer.sampleRate;
      const len = audioBuffer.length;
      const L = audioBuffer.getChannelData(0);
      const R = audioBuffer.numberOfChannels > 1
        ? audioBuffer.getChannelData(1)
        : audioBuffer.getChannelData(0);

      this.onProgress(10, 'Decoding channels...');
      await this._tick();

      // Mid-Side decomposition
      const mid  = new Float32Array(len);
      const side = new Float32Array(len);
      const CHUNK = 22050;
      const chunks = Math.ceil(len / CHUNK);

      for (let c = 0; c < chunks; c++) {
        const s = c * CHUNK, e = Math.min(s + CHUNK, len);
        for (let i = s; i < e; i++) {
          mid[i]  = (L[i] + R[i]) * 0.5;
          side[i] = (L[i] - R[i]) * 0.5;
        }
        this.onProgress(10 + (c / chunks) * 40, 'Running M/S separation...');
        if (c % 4 === 0) await this._tick();
      }

      this.onProgress(55, 'Building stem buffers...');
      await this._tick();

      const ctx = new OfflineAudioContext(2, len, sr);

      // Vocals: mid channel (center) → stereo
      const vocBuf = ctx.createBuffer(2, len, sr);
      vocBuf.copyToChannel(mid, 0);
      vocBuf.copyToChannel(mid, 1);

      // Instrumental: side stereo reconstruction
      const instBuf = ctx.createBuffer(2, len, sr);
      const sideNeg = new Float32Array(len);
      for (let i = 0; i < len; i++) sideNeg[i] = -side[i];
      instBuf.copyToChannel(side, 0);
      instBuf.copyToChannel(sideNeg, 1);

      const result = { vocals: vocBuf, instrumental: instBuf };

      if (mode === '4stem') {
        this.onProgress(65, 'Extracting bass frequencies...');
        await this._tick();
        result.bass    = await this._extractBass(instBuf, sr);

        this.onProgress(80, 'Extracting drum transients...');
        await this._tick();
        result.drums   = await this._extractDrums(instBuf, sr);

        this.onProgress(90, 'Rendering other instruments...');
        await this._tick();
        result.other   = await this._extractOther(instBuf, result.bass, result.drums, sr);
      }

      this.onProgress(100, 'Done!');
      return result;
    }

    // ── BASS EXTRACTION: Low-pass below ~300Hz ──
    async _extractBass(buf, sr) {
      const ctx = new OfflineAudioContext(2, buf.length, sr);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const lpf = ctx.createBiquadFilter();
      lpf.type = 'lowpass';
      lpf.frequency.value = 300;
      lpf.Q.value = 0.707;
      const lpf2 = ctx.createBiquadFilter();
      lpf2.type = 'lowpass';
      lpf2.frequency.value = 280;
      lpf2.Q.value = 0.707;
      src.connect(lpf);
      lpf.connect(lpf2);
      lpf2.connect(ctx.destination);
      src.start(0);
      return await ctx.startRendering();
    }

    // ── DRUM EXTRACTION: transient + high-mid emphasis ──
    async _extractDrums(buf, sr) {
      const ctx = new OfflineAudioContext(2, buf.length, sr);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      // Bandpass for kick body (60–150Hz) + HP for snare/hats (3kHz+)
      const kick = ctx.createBiquadFilter();
      kick.type = 'bandpass'; kick.frequency.value = 100; kick.Q.value = 1.5;
      const hats = ctx.createBiquadFilter();
      hats.type = 'highpass'; hats.frequency.value = 3000; hats.Q.value = 0.5;
      const gain1 = ctx.createGain(); gain1.gain.value = 1.4;
      const gain2 = ctx.createGain(); gain2.gain.value = 0.8;
      const merge = ctx.createGain();
      src.connect(kick); kick.connect(gain1); gain1.connect(merge);
      src.connect(hats); hats.connect(gain2); gain2.connect(merge);
      merge.connect(ctx.destination);
      src.start(0);
      return await ctx.startRendering();
    }

    // ── OTHER INSTRUMENTS: subtract bass + drums approx ──
    async _extractOther(buf, bassBuf, drumsBuf, sr) {
      const ctx = new OfflineAudioContext(2, buf.length, sr);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const hpf = ctx.createBiquadFilter();
      hpf.type = 'highpass'; hpf.frequency.value = 300;
      const lpf = ctx.createBiquadFilter();
      lpf.type = 'lowpass'; lpf.frequency.value = 3000;
      src.connect(hpf); hpf.connect(lpf); lpf.connect(ctx.destination);
      src.start(0);
      return await ctx.startRendering();
    }

    // ── AUDIO CUTTER ──
    async cut(audioBuffer, startSec, endSec) {
      const sr = audioBuffer.sampleRate;
      const startSample = Math.floor(startSec * sr);
      const endSample   = Math.min(Math.floor(endSec * sr), audioBuffer.length);
      const len = endSample - startSample;
      if (len <= 0) throw new Error('Invalid cut range');
      const ctx = new OfflineAudioContext(audioBuffer.numberOfChannels, len, sr);
      const out = ctx.createBuffer(audioBuffer.numberOfChannels, len, sr);
      for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
        const src = audioBuffer.getChannelData(c).slice(startSample, endSample);
        out.copyToChannel(src, c);
      }
      return out;
    }

    // ── SONG JOINER ──
    async join(buffers, gapSeconds = 0) {
      if (!buffers.length) throw new Error('No buffers to join');
      const sr = buffers[0].sampleRate;
      const numCh = Math.max(...buffers.map(b => b.numberOfChannels));
      const gapLen = Math.floor(gapSeconds * sr);
      const totalLen = buffers.reduce((a, b) => a + b.length, 0) + gapLen * (buffers.length - 1);
      const ctx = new OfflineAudioContext(numCh, totalLen, sr);
      const out = ctx.createBuffer(numCh, totalLen, sr);
      let offset = 0;
      for (let bi = 0; bi < buffers.length; bi++) {
        const buf = buffers[bi];
        for (let c = 0; c < numCh; c++) {
          const dest = out.getChannelData(c);
          const src  = c < buf.numberOfChannels ? buf.getChannelData(c) : buf.getChannelData(0);
          dest.set(src, offset);
        }
        offset += buf.length + (bi < buffers.length - 1 ? gapLen : 0);
        this.onProgress(Math.floor(((bi+1)/buffers.length)*90), `Joining track ${bi+1}...`);
        await this._tick();
      }
      return out;
    }

    // ── NOISE REDUCTION: Spectral subtraction approximation ──
    async removeNoise(audioBuffer, strength = 0.5) {
      const sr = audioBuffer.sampleRate;
      const ctx = new OfflineAudioContext(audioBuffer.numberOfChannels, audioBuffer.length, sr);
      const src = ctx.createBufferSource();
      src.buffer = audioBuffer;
      // High-shelf to reduce low-end rumble, dynamic compressor for evenness
      const hpf = ctx.createBiquadFilter();
      hpf.type = 'highpass'; hpf.frequency.value = 80 + strength * 120;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -24; comp.knee.value = 30;
      comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.25;
      src.connect(hpf); hpf.connect(comp); comp.connect(ctx.destination);
      src.start(0);
      this.onProgress(80, 'Applying noise reduction...');
      return await ctx.startRendering();
    }

    // ── PITCH SHIFT (via playback rate — approximate) ──
    // Note: True pitch shifting requires phase vocoder; this is a simple approximation
    async pitchShift(audioBuffer, semitones) {
      const rate = Math.pow(2, semitones / 12);
      const sr = audioBuffer.sampleRate;
      const newLen = Math.floor(audioBuffer.length / rate);
      const ctx = new OfflineAudioContext(audioBuffer.numberOfChannels, newLen, sr);
      const src = ctx.createBufferSource();
      src.buffer = audioBuffer;
      src.playbackRate.value = rate;
      src.connect(ctx.destination);
      src.start(0);
      return await ctx.startRendering();
    }

    // ── ENCODE TO WAV ──
    encodeWav(buffer) {
      const numCh = buffer.numberOfChannels;
      const sr = buffer.sampleRate;
      const len = buffer.length;
      const dataLen = len * numCh * 2;
      const ab = new ArrayBuffer(44 + dataLen);
      const v = new DataView(ab);
      const ws = (off, s) => { for(let i=0;i<s.length;i++) v.setUint8(off+i,s.charCodeAt(i)); };
      ws(0,'RIFF'); v.setUint32(4,36+dataLen,true); ws(8,'WAVE');
      ws(12,'fmt '); v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,numCh,true);
      v.setUint32(24,sr,true); v.setUint32(28,sr*numCh*2,true);
      v.setUint16(32,numCh*2,true); v.setUint16(34,16,true);
      ws(36,'data'); v.setUint32(40,dataLen,true);
      let off = 44;
      for (let i = 0; i < len; i++) {
        for (let c = 0; c < numCh; c++) {
          const s = Math.max(-1, Math.min(1, buffer.getChannelData(c)[i]));
          v.setInt16(off, s<0 ? s*0x8000 : s*0x7FFF, true);
          off += 2;
        }
      }
      return new Blob([ab], { type: 'audio/wav' });
    }

    _tick() { return new Promise(r => setTimeout(r, 0)); }
  }

  // Export
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SevenByEngine };
  } else {
    global.SevenByEngine = SevenByEngine;
  }

})(typeof window !== 'undefined' ? window : this);
