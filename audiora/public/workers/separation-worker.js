let session=null,ORT=null,phase="init",usedEP="";
const ORT_BASE="https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";
const EMBED_URL="https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx";
const SR=44100,FFT_SIZE=4096,HOP=1024,TRAIN=343980,SPEC_BINS=2048,SPEC_FRAMES=336,OVERLAP=0.5;
const _ftw=new Map(),_itw=new Map(),_hann=new Map();
function fftTw(n){if(_ftw.has(n))return _ftw.get(n);const re=new Float32Array(n/2),im=new Float32Array(n/2);for(let k=0;k<n/2;k++){const a=-2*Math.PI*k/n;re[k]=Math.cos(a);im[k]=Math.sin(a);}const t={re,im};_ftw.set(n,t);return t;}
function ifftTw(n){if(_itw.has(n))return _itw.get(n);const re=new Float32Array(n/2),im=new Float32Array(n/2);for(let k=0;k<n/2;k++){const a=2*Math.PI*k/n;re[k]=Math.cos(a);im[k]=Math.sin(a);}const t={re,im};_itw.set(n,t);return t;}
function hann(size){if(_hann.has(size))return _hann.get(size);const w=new Float32Array(size);for(let i=0;i<size;i++)w[i]=0.5*(1-Math.cos(2*Math.PI*i/size));_hann.set(size,w);return w;}
function brev(n,bits){let r=0;for(let i=0;i<bits;i++){r=(r<<1)|(n&1);n>>=1;}return r;}
function fft(rO,iO,rI,n){const bits=Math.log2(n)|0,tw=fftTw(n);for(let i=0;i<n;i++){const j=brev(i,bits);rO[i]=rI[j];iO[i]=0;}for(let size=2;size<=n;size*=2){const hs=size/2,step=n/size;for(let i=0;i<n;i+=size){for(let j=0;j<hs;j++){const k=j*step,tr=tw.re[k],ti=tw.im[k],a=i+j,b=i+j+hs;const er=rO[a],ei=iO[a],or=rO[b]*tr-iO[b]*ti,oi=rO[b]*ti+iO[b]*tr;rO[a]=er+or;iO[a]=ei+oi;rO[b]=er-or;iO[b]=ei-oi;}}}}
function ifft(rO,iO,rI,iI,n){const bits=Math.log2(n)|0,tw=ifftTw(n);for(let i=0;i<n;i++){const j=brev(i,bits);rO[i]=rI[j];iO[i]=iI[j];}for(let size=2;size<=n;size*=2){const hs=size/2,step=n/size;for(let i=0;i<n;i+=size){for(let j=0;j<hs;j++){const k=j*step,tr=tw.re[k],ti=tw.im[k],a=i+j,b=i+j+hs;const er=rO[a],ei=iO[a],or=rO[b]*tr-iO[b]*ti,oi=rO[b]*ti+iO[b]*tr;rO[a]=er+or;iO[a]=ei+oi;rO[b]=er-or;iO[b]=ei-oi;}}}for(let i=0;i<n;i++){rO[i]/=n;iO[i]/=n;}}
function stft(sig,fftSize,hop){const numFrames=Math.floor((sig.length-fftSize)/hop)+1,numBins=fftSize/2+1,w=hann(fftSize),scale=1/Math.sqrt(fftSize);const sr=new Float32Array(numFrames*numBins),si=new Float32Array(numFrames*numBins),fr=new Float32Array(fftSize),fi=new Float32Array(fftSize),wf=new Float32Array(fftSize);for(let f=0;f<numFrames;f++){const st=f*hop;for(let i=0;i<fftSize;i++)wf[i]=sig[st+i]*w[i];fft(fr,fi,wf,fftSize);const o=f*numBins;for(let k=0;k<numBins;k++){sr[o+k]=fr[k]*scale;si[o+k]=fi[k]*scale;}}return{real:sr,imag:si,numFrames,numBins};}
function istft(sr,si,numFrames,numBins,fftSize,hop,length){const outLen=length||(numFrames-1)*hop+fftSize,out=new Float32Array(outLen),wsum=new Float32Array(outLen),w=hann(fftSize),scale=Math.sqrt(fftSize);const fR=new Float32Array(fftSize),fI=new Float32Array(fftSize),oR=new Float32Array(fftSize),oI=new Float32Array(fftSize);for(let f=0;f<numFrames;f++){fR.fill(0);fI.fill(0);for(let k=0;k<numBins;k++){fR[k]=sr[f*numBins+k];fI[k]=si[f*numBins+k];}for(let k=1;k<numBins-1;k++){fR[fftSize-k]=fR[k];fI[fftSize-k]=-fI[k];}ifft(oR,oI,fR,fI,fftSize);const st=f*hop;for(let i=0;i<fftSize&&st+i<outLen;i++){out[st+i]+=oR[i]*w[i]*scale;wsum[st+i]+=w[i]*w[i];}}for(let i=0;i<outLen;i++){if(wsum[i]>1e-8)out[i]/=wsum[i];}return out;}
function reflectPad(sig,padL,padR){const len=sig.length,out=new Float32Array(padL+len+padR);for(let i=0;i<padL;i++)out[i]=sig[Math.min(padL-i,len-1)];out.set(sig,padL);for(let i=0;i<padR;i++)out[padL+len+i]=sig[Math.max(0,len-2-i)];return out;}
function standaloneMask(freq){const nT=4,nC=4,nB=SPEC_BINS,nF=SPEC_FRAMES,res=[];for(let t=0;t<nT;t++){const s={lr:new Float32Array(nB*nF),li:new Float32Array(nB*nF),rr:new Float32Array(nB*nF),ri:new Float32Array(nB*nF)};for(let f=0;f<nF;f++){for(let b=0;b<nB;b++){const base=t*nC*nB*nF,o=b*nF+f;s.lr[o]=freq[base+0*nB*nF+b*nF+f];s.li[o]=freq[base+1*nB*nF+b*nF+f];s.rr[o]=freq[base+2*nB*nF+b*nF+f];s.ri[o]=freq[base+3*nB*nF+b*nF+f];}}res.push(s);}return res;}
function standaloneIspec(spec,targetLen){const nB=SPEC_BINS,nF=SPEC_FRAMES,hop=HOP,pB=nB+1,pF=nF+4;const padCh=(re,im)=>{const pr=new Float32Array(pF*pB),pi=new Float32Array(pF*pB);for(let f=0;f<nF;f++){for(let b=0;b<nB;b++){const s=b*nF+f,d=(f+2)*pB+b;pr[d]=re[s];pi[d]=im[s];}}return{real:pr,imag:pi};};const L=padCh(spec.lr,spec.li),R=padCh(spec.rr,spec.ri);const centerPad=FFT_SIZE/2,pad=Math.floor(hop/2)*3,isLen=(pF-1)*hop+FFT_SIZE;const lo=istft(L.real,L.imag,pF,pB,FFT_SIZE,hop,isLen),ro=istft(R.real,R.imag,pF,pB,FFT_SIZE,hop,isLen);const off=centerPad+pad;return{left:new Float32Array(lo.subarray(off,off+targetLen)),right:new Float32Array(ro.subarray(off,off+targetLen))};}
function prepareModelInput(left,right){const inLen=TRAIN,pL=new Float32Array(inLen),pR=new Float32Array(inLen),cp=Math.min(left.length,inLen);pL.set(left.subarray(0,cp));pR.set(right.subarray(0,cp));const le=Math.ceil(inLen/HOP),pad=Math.floor(HOP/2)*3,padR=pad+le*HOP-inLen;const sL=reflectPad(pL,pad,padR),sR=reflectPad(pR,pad,padR),cPad=FFT_SIZE/2;const cL=reflectPad(sL,cPad,cPad),cR=reflectPad(sR,cPad,cPad);const stL=stft(cL,FFT_SIZE,HOP),stR=stft(cR,FFT_SIZE,HOP),nB=SPEC_BINS,nF=SPEC_FRAMES,fo=2;const mag=new Float32Array(4*nB*nF);for(let f=0;f<nF;f++){const sf=f+fo;for(let b=0;b<nB;b++){const si=sf*stL.numBins+b;mag[0*nB*nF+b*nF+f]=stL.real[si];mag[1*nB*nF+b*nF+f]=stL.imag[si];mag[2*nB*nF+b*nF+f]=stR.real[si];mag[3*nB*nF+b*nF+f]=stR.imag[si];}}const wave=new Float32Array(2*inLen);wave.set(pL,0);wave.set(pR,inLen);return{waveform:wave,magSpec:mag};}
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

async function loadModel(){
  phase="engine-load";let hasGPU=false;
  try{hasGPU=!!(self.navigator&&self.navigator.gpu&&(await self.navigator.gpu.requestAdapter()));}catch(e){hasGPU=false;}
  importScripts(ORT_BASE+(hasGPU?"ort.webgpu.min.js":"ort.wasm.min.js"));
  ORT=self.ort;ORT.env.wasm.wasmPaths=ORT_BASE;
  let nThreads=pickThreadCount();
  try{ ORT.env.wasm.numThreads=nThreads; }catch(e){ nThreads=1; }
  postMessage({type:"status",msg:"Preparing the engine…"});phase="download";
  let resp=null,fromCache=false;
  // Stream the engine ourselves so progress reflects what has actually
    // arrived. Caching via net.clone() first would drain the whole download
    // before any progress could be reported, freezing the bar until the end.
    let cacheRef=null;
    try{cacheRef=await caches.open("7by-ai-model-v1");}catch(e){cacheRef=null;}
    if(cacheRef){try{const hit=await cacheRef.match(EMBED_URL);if(hit){resp=hit;fromCache=true;postMessage({type:"status",msg:"Getting ready…"});}}catch(e){}}
    if(!resp){try{resp=await fetch(EMBED_URL);}catch(e){resp=null;}}
  if(!resp||!resp.ok)throw new Error("model download failed");
  const total=parseInt(resp.headers.get("content-length")||"0",10);
  const reader=resp.body.getReader();const parts=[];let got=0;
  for(;;){const r=await reader.read();if(r.done)break;parts.push(r.value);got+=r.value.length;postMessage({type:"dl",got,total,cached:fromCache});}
  const bytes=new Uint8Array(got);let off=0;for(const p of parts){bytes.set(p,off);off+=p.length;}
  // Cache for next time, but never wait for it: a large write can take a long
  // while when storage is near quota, and the engine must not idle behind it.
  if(cacheRef&&!fromCache){const copy=new Uint8Array(bytes.length);copy.set(bytes);Promise.resolve().then(()=>cacheRef.put(EMBED_URL,new Response(copy,{headers:{"Content-Type":"application/octet-stream"}}))).catch(()=>{});}
  phase="engine-build";
  const opts={graphOptimizationLevel:"basic",enableCpuMemArena:false,enableMemPattern:false};
  try{postMessage({type:"status",msg:"Starting the engine…"});session=await ORT.InferenceSession.create(bytes,{executionProviders:["wasm"],...opts});usedEP="cpu";}
  catch(e1){if(!hasGPU)throw e1;postMessage({type:"status",msg:"Optimising for your device…"});session=await ORT.InferenceSession.create(bytes,{executionProviders:["webgpu","wasm"],...opts});usedEP="gpu";}
  postMessage({type:"loaded",ep:usedEP,threads:nThreads});
}
async function separate(L,R,full){
  phase="inference";const total=L.length,stride=Math.floor(TRAIN*(1-OVERLAP)),numSeg=Math.max(1,Math.ceil((total-TRAIN)/stride)+1);
  const TR=full?[0,1,2,3]:[3];const outs={};for(const t of TR){outs[t]={L:new Float32Array(total),R:new Float32Array(total)};}
  const wts=new Float32Array(total);let segIdx=0;
  for(let start=0;start<total;start+=stride){
    const end=Math.min(start+TRAIN,total),segLen=end-start;
    const segL=new Float32Array(TRAIN),segR=new Float32Array(TRAIN);
    for(let i=0;i<segLen;i++){segL[i]=L[start+i];segR[i]=R[start+i];}
    const inp=prepareModelInput(segL,segR);
    const waveT=new ORT.Tensor("float32",inp.waveform,[1,2,TRAIN]);
    const magT=new ORT.Tensor("float32",inp.magSpec,[1,4,SPEC_BINS,SPEC_FRAMES]);
    const feeds={};feeds[session.inputNames[0]]=waveT;if(session.inputNames.length>1)feeds[session.inputNames[1]]=magT;
    const out=await session.run(feeds);
    let timeData=null,timeShape=null,freqData=null;
    for(const name of session.outputNames){const tn=out[name];if(tn.dims.length===4&&tn.dims[2]===2){timeData=tn.data;timeShape=tn.dims;}else if(tn.dims.length===5&&tn.dims[2]===4){freqData=tn.data;}}
    if(!timeData)throw new Error("no time-domain output");
    const nC=timeShape[2],smp=timeShape[3];const specs=freqData?standaloneMask(freqData):null;
    const ow=new Float32Array(segLen);
    for(let i=0;i<segLen;i++){const fi=Math.min(i/(stride*0.5),1),fo=Math.min((segLen-i)/(stride*0.5),1);ow[i]=Math.min(fi,fo);}
    for(const t of TR){let foL=null,foR=null;if(specs){const fo=standaloneIspec(specs[t],TRAIN);foL=fo.left;foR=fo.right;}const oL=outs[t].L,oR=outs[t].R;for(let i=0;i<segLen&&start+i<total;i++){oL[start+i]+=(timeData[t*nC*smp+0*smp+i]+(foL?foL[i]:0))*ow[i];oR[start+i]+=(timeData[t*nC*smp+1*smp+i]+(foR?foR[i]:0))*ow[i];}}
    for(let i=0;i<segLen&&start+i<total;i++)wts[start+i]+=ow[i];segIdx++;
    postMessage({type:"sep",value:Math.round(segIdx/numSeg*100)});
  }
  for(const t of TR){const oL=outs[t].L,oR=outs[t].R;for(let i=0;i<total;i++){const d=wts[i];if(d>0){oL[i]/=d;oR[i]/=d;}}}
  if(full){postMessage({type:"done",full:true,d0:outs[0].L,d1:outs[0].R,b0:outs[1].L,b1:outs[1].R,o0:outs[2].L,o1:outs[2].R,v0:outs[3].L,v1:outs[3].R},[outs[0].L.buffer,outs[0].R.buffer,outs[1].L.buffer,outs[1].R.buffer,outs[2].L.buffer,outs[2].R.buffer,outs[3].L.buffer,outs[3].R.buffer]);}
  else{postMessage({type:"done",v0:outs[3].L,v1:outs[3].R},[outs[3].L.buffer,outs[3].R.buffer]);}
}
onmessage=async function(e){const d=e.data;try{if(d.cmd==="load")await loadModel();else if(d.cmd==="sep")await separate(d.L,d.R,d.full);}catch(err){postMessage({type:"error",message:"["+phase+"] "+String((err&&err.message)||err)});}};

