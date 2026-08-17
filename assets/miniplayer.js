/**
 * 7By.in — reusable mini audio player with a movable/seekable timeline.
 * Works while playing OR paused: dragging the bar seeks to the exact time.
 * Usage:
 *   const mp = new MiniPlayer({ ctx, buffer, barEl, fillEl, curEl, totEl, playBtn, detuneCents:()=>0 });
 *   mp.toggle(); mp.setBuffer(buf);
 */
class MiniPlayer {
  constructor(o){
    this.ctx = o.ctx;
    this.buffer = o.buffer || null;
    this.barEl = o.barEl; this.fillEl = o.fillEl;
    this.curEl = o.curEl; this.totEl = o.totEl;
    this.playBtn = o.playBtn;
    this.onChange = o.onChange || null;
    this.detuneCents = o.detuneCents || (()=>0);
    this.gainVal = 1;
    this.src=null; this.playing=false; this.startedAt=0; this.offset=0; this.raf=null;
    this._wireBar();
    if(this.buffer) this.setBuffer(this.buffer);
  }
  fmt(t){t=Math.max(0,t|0);const h=t/3600|0,m=(t%3600)/60|0,s=t%60;return (h>0?h+':'+String(m).padStart(2,'0'):String(m))+':'+String(s).padStart(2,'0');}
  dur(){return this.buffer?this.buffer.duration:0;}
  cur(){return this.playing?Math.min(this.offset+(this.ctx.currentTime-this.startedAt),this.dur()):this.offset;}
  setBuffer(b){this._stopRaw();this.buffer=b;this.offset=0;this.playing=false;this._icon();this._render();}
  _icon(){if(this.playBtn)this.playBtn.textContent=this.playing?'❚❚':'▶';if(this.onChange)this.onChange(this.playing);}
  _render(){const d=this.dur(),t=this.cur();if(this.fillEl)this.fillEl.style.width=(d?t/d*100:0)+'%';if(this.curEl)this.curEl.textContent=this.fmt(t);if(this.totEl)this.totEl.textContent=this.fmt(d);}
  _tick(){if(!this.playing)return;this._render();this.raf=requestAnimationFrame(()=>this._tick());}
  _stopRaw(){if(this.src){try{this.src.onended=null;this.src.stop();}catch(e){}this.src.disconnect();this.src=null;}if(this.raf)cancelAnimationFrame(this.raf);}
  _startAt(at){
    const c=this.ctx;this._stopRaw();
    at=Math.max(0,Math.min(at,this.dur()-0.02));
    this.src=c.createBufferSource();this.src.buffer=this.buffer;
    try{this.src.detune.value=this.detuneCents();}catch(e){}
    this.gain=c.createGain();this.gain.gain.value=this.gainVal;
    this.src.connect(this.gain);this.gain.connect(c.destination);
    this.offset=at;this.startedAt=c.currentTime;this.playing=true;
    this.src.onended=()=>{if(this.playing&&this.cur()>=this.dur()-0.06){this.playing=false;this.offset=0;this._icon();this._render();}};
    this.src.start(0,at);this._icon();this._tick();
  }
  play(){if(!this.buffer)return;if(this.ctx.state==='suspended')this.ctx.resume();this._startAt(this.offset);}
  pause(){if(!this.playing)return;this.offset=this.cur();this._stopRaw();this.playing=false;this._icon();this._render();}
  toggle(){this.playing?this.pause():this.play();}
  seek(sec){const wasPlaying=this.playing;this.offset=Math.max(0,Math.min(sec,this.dur()));if(wasPlaying)this._startAt(this.offset);else this._render();}
  setDetuneLive(){if(this.src){try{this.src.detune.value=this.detuneCents();}catch(e){}}}
  setVol(v){this.gainVal=v;if(this.gain)this.gain.gain.value=v;}
  _wireBar(){
    if(!this.barEl)return;
    const seekTo=(clientX)=>{const r=this.barEl.getBoundingClientRect();const f=Math.max(0,Math.min(1,(clientX-r.left)/r.width));this.seek(f*this.dur());};
    let dragging=false;
    this.barEl.style.cursor='pointer';
    this.barEl.addEventListener('mousedown',e=>{dragging=true;seekTo(e.clientX);});
    window.addEventListener('mousemove',e=>{if(dragging){e.preventDefault();seekTo(e.clientX);}});
    window.addEventListener('mouseup',()=>{dragging=false;});
    this.barEl.addEventListener('touchstart',e=>{dragging=true;seekTo(e.touches[0].clientX);},{passive:true});
    this.barEl.addEventListener('touchmove',e=>{if(dragging)seekTo(e.touches[0].clientX);},{passive:true});
    this.barEl.addEventListener('touchend',()=>{dragging=false;});
  }
}
window.MiniPlayer = MiniPlayer;
