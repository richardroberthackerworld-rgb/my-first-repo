/**
 * 7By.in — Shared Layout Injector
 * Call injectLayout(root) where root = '' (homepage) or '../' (subpages)
 */
/* ---------------------------------------------------------------------------
 * Copy/inspect deterrents. NOTE: these only discourage casual copying — any
 * browser's dev tools can bypass them. They run once per page load and cover
 * every page automatically (including future ones) because they all load
 * this shared script.
 * ------------------------------------------------------------------------- */
(function antiCopyGuard(){
  if(window.__7byGuard) return; window.__7byGuard = true;
  document.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('dragstart', e => { if(e.target && (e.target.tagName==='IMG')) e.preventDefault(); });
  document.addEventListener('keydown', e => {
    const k = e.key ? e.key.toLowerCase() : '';
    const blockCombo = (e.ctrlKey || e.metaKey) && ['s','u','p'].includes(k);
    const blockDevtools = k === 'f12' || ((e.ctrlKey||e.metaKey) && e.shiftKey && ['i','j','c'].includes(k));
    if (blockCombo || blockDevtools) e.preventDefault();
  });
})();
function injectLayout(root = '') {
  // Inject small nav-home style once
  if (!document.getElementById('layout-extra-css')) {
    const st = document.createElement('style');
    st.id = 'layout-extra-css';
    st.textContent = '.nav-home{display:inline-flex;align-items:center;gap:5px;color:var(--mut);text-decoration:none;font-weight:600;font-size:14px;padding:6px 12px;border-radius:99px;transition:.2s;margin-right:4px}.nav-home:hover{color:var(--text);background:rgba(255,255,255,.06)}';
    document.head.appendChild(st);
  }
  // Google Fonts
  if (!document.querySelector('link[href*="Outfit"]')) {
    const lf = document.createElement('link');
    lf.rel = 'stylesheet';
    lf.href = 'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap';
    document.head.prepend(lf);
    const lp = document.createElement('link');
    lp.rel = 'preconnect'; lp.href = 'https://fonts.gstatic.com'; lp.crossOrigin = true;
    document.head.prepend(lp);
    const lp2 = document.createElement('link');
    lp2.rel = 'preconnect'; lp2.href = 'https://fonts.googleapis.com';
    document.head.prepend(lp2);
  }

  const toolsMenu = `
    <a href="${root}tools/vocal-remover" class="nav-dd-item"><span class="nav-dd-ico">🎤</span>Vocal Remover</a>
    <a href="${root}tools/stem-splitter" class="nav-dd-item"><span class="nav-dd-ico">🎛️</span>Stem Splitter</a>
    <a href="${root}tools/audio-cutter" class="nav-dd-item"><span class="nav-dd-ico">✂️</span>Audio Cutter</a>
    <a href="${root}tools/song-joiner" class="nav-dd-item"><span class="nav-dd-ico">🔗</span>Song Joiner</a>
    <a href="${root}tools/noise-remover" class="nav-dd-item"><span class="nav-dd-ico">🔇</span>Noise Remover</a>
    <a href="${root}tools/pitch-shifter" class="nav-dd-item"><span class="nav-dd-ico">🎵</span>Pitch Shifter</a>
    <a href="${root}tools/audio-converter" class="nav-dd-item"><span class="nav-dd-ico">🔄</span>Audio Converter</a>
    <a href="${root}tools/drum-pads" class="nav-dd-item"><span class="nav-dd-ico">🥁</span>Drum Pads</a>
    <a href="${root}tools/temp-mail" class="nav-dd-item"><span class="nav-dd-ico">📧</span>Temp Mail</a>
    <a href="${root}tools/resume-builder" class="nav-dd-item"><span class="nav-dd-ico">📄</span>Resume Builder</a>`;

  const nav = `
<nav>
  <a href="https://7by.in/" class="logo">
    <img src="${root}assets/logo-mark.png" class="logo-mark" alt="7By.in">
  </a>
  <div class="nav-center">
    <a href="/" class="nav-home">🏠 Home</a>
    <a href="https://7by.in/" class="nav-alltools"><span class="nav-alltools-dot"></span>All Tools by 7By</a>
    <div class="nav-dd">
      <button class="nav-dd-btn">Tools ▾</button>
      <div class="nav-dd-panel">${toolsMenu}</div>
    </div>
    <ul class="nav-links">
      <li><a href="${root}pricing">Pricing</a></li>
      <li><a href="${root}blog/">Blog</a></li>
      <li><a href="${root}about">About</a></li>
      <li><a href="${root}privacy-policy">Privacy</a></li>
      <li><a href="${root}disclaimer">Disclaimer</a></li>
    </ul>
  </div>
  <div class="nav-right">
    <button class="btn btn-ghost btn-sm nav-signin" id="nav-auth-btn" onclick="openAuth('signin')">Sign In</button>
    <a href="${root}pricing" class="btn btn-m btn-sm nav-getpro">Get Pro ⚡</a>
    <button class="nav-burger" id="nav-burger" aria-label="Menu" onclick="toggleMobileMenu()"><span></span><span></span><span></span></button>
  </div>`;

  // Mobile slide-in menu (all links reachable on phones)
  const mobileMenu = `
<div class="mnav-ov" id="mnav-ov" onclick="closeMobileMenu()"></div>
<aside class="mnav" id="mnav">
  <div class="mnav-head">
    <a href="https://7by.in/" class="logo"><img src="${root}assets/logo-mark.png" class="logo-mark" alt="7By.in"></a>
    <button class="mnav-x" onclick="closeMobileMenu()">✕</button>
  </div>
  <button class="btn btn-c btn-full" id="mnav-auth-btn" style="margin-bottom:6px" onclick="closeMobileMenu();openAuth('signin')">Sign In / Sign Up</button>
  <a href="${root}pricing" class="btn btn-m btn-full" style="margin-bottom:14px">Get Pro ⚡</a>
  <a href="https://7by.in/" class="nav-alltools nav-alltools-block" onclick="closeMobileMenu()"><span class="nav-alltools-dot"></span>All Tools by 7By</a>
  <div class="mnav-label">Tools</div>
  ${toolsMenu.replace(/nav-dd-item/g,'mnav-item')}
  <div class="mnav-label">Menu</div>
  <a href="/" class="mnav-item">🏠 Home</a>
  <a href="${root}pricing" class="mnav-item">💎 Pricing</a>
  <a href="${root}blog/" class="mnav-item">📝 Blog</a>
  <a href="${root}about" class="mnav-item">ℹ️ About</a>
  <a href="${root}privacy-policy" class="mnav-item">🔒 Privacy</a>
  <a href="${root}disclaimer" class="mnav-item">⚖️ Disclaimer</a>
</aside>`;

  const footer = `
<footer>
  <div class="container">
    <div class="foot-grid">
      <div class="foot-brand">
        <a href="https://7by.in/" class="logo"><img src="${root}assets/logo-mark.png" class="logo-mark" alt="7By.in"></a>
        <p>AI-powered audio tools that run entirely in your browser. Free to use, private by design. No uploads, no servers.</p>
        <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap">
          <span class="badge bc">Local Processing</span>
          <span class="badge bg">Privacy First</span>
        </div>
      </div>
      <div class="foot-col">
        <h5>Audio Tools</h5>
        <ul>
          <li><a href="${root}tools/vocal-remover">Vocal Remover</a></li>
          <li><a href="${root}tools/stem-splitter">Stem Splitter</a></li>
          <li><a href="${root}tools/audio-cutter">Audio Cutter</a></li>
          <li><a href="${root}tools/song-joiner">Song Joiner</a></li>
          <li><a href="${root}tools/noise-remover">Noise Remover</a></li>
          <li><a href="${root}tools/pitch-shifter">Pitch Shifter</a></li>
          <li><a href="${root}tools/audio-converter">Audio Converter</a></li>
          <li><a href="${root}tools/drum-pads">Drum Pads</a></li>
          <li><a href="${root}tools/temp-mail">Temp Mail</a></li>
          <li><a href="${root}tools/resume-builder">Resume Builder</a></li>
        </ul>
      </div>
      <div class="foot-col">
        <h5>Product</h5>
        <ul>
          <li><a href="${root}pricing">Pricing</a></li>
          <li><a href="${root}blog/">Blog</a></li>
          <li><a href="${root}about">About 7By</a></li>
          <li><a href="${root}contact">Contact Us</a></li>
        </ul>
      </div>
      <div class="foot-col">
        <h5>Legal</h5>
        <ul>
          <li><a href="${root}privacy-policy">Privacy Policy</a></li>
          <li><a href="${root}terms-of-service">Terms of Service</a></li>
          <li><a href="${root}disclaimer">Disclaimer</a></li>
          <li><a href="${root}dmca">DMCA Policy</a></li>
          <li><a href="${root}cookie-policy">Cookie Policy</a></li>
        </ul>
      </div>
      <div class="foot-col">
        <h5>Company</h5>
        <ul>
          <li><a href="https://7by.in" target="_blank">7by.in</a></li>
          <li><a href="${root}about">Our Mission</a></li>
          <li><a href="${root}contact">Support</a></li>
          <li><a href="${root}blog/">Articles</a></li>
        </ul>
      </div>
    </div>
    <div class="foot-btm">
      <span>© ${new Date().getFullYear()} 7By.in — All rights reserved. | <a href="https://7by.in" target="_blank" style="color:var(--cyan)">7by.in</a></span>
      <div class="foot-btm-links">
        <a href="${root}privacy-policy">Privacy</a>
        <a href="${root}terms-of-service">Terms</a>
        <a href="${root}dmca">DMCA</a>
        <a href="${root}cookie-policy">Cookies</a>
        <a href="${root}contact">Contact</a>
      </div>
    </div>
  </div>
</footer>
<div class="modal-ov" id="upgrade-modal">
  <div class="modal">
    <div class="modal-ico">⚡</div>
    <h3>You're out of credits</h3>
    <p>AI Vocal Remover &amp; Stem Splitter use <strong>credits</strong> (10 per song). Top up with a plan — every other 7By tool stays free &amp; unlimited.</p>
    <div style="display:flex;flex-direction:column;gap:10px">
      <a href="${root}pricing" class="btn btn-m btn-lg btn-full" onclick="closeModal()">Get 20,000 credits — ₹299/year</a>
      <a href="${root}pricing" class="btn btn-ghost btn-full" onclick="closeModal()">See all plans</a>
    </div>
    <button class="modal-close" onclick="closeModal()">Maybe later</button>
  </div>
</div>
<div class="toast" id="toast"><span>✓</span><span id="toast-msg"></span></div>
${authModalHTML(root)}`;

  // Inject nav before first child of body
  document.body.insertAdjacentHTML('afterbegin', nav);
  document.body.insertAdjacentHTML('afterbegin', mobileMenu);
  // Inject footer before end of body
  document.body.insertAdjacentHTML('beforeend', footer);
  injectAuthStyles();
  injectNavStyles();
  refreshAuthUI();
}
// Single switch: body.mnav-open drives the drawer, overlay and burger icon (styles live in style.css)
function toggleMobileMenu(){ document.body.classList.toggle('mnav-open'); }
function closeMobileMenu(){ document.body.classList.remove('mnav-open'); }
function injectNavStyles(){ /* nav + mobile-menu CSS now lives in assets/style.css (shared by the site and the WP theme) */ }

/* ============================ AUTH (Sign in / Sign up) ============================
 * NOTE: This is the full front-end UI. Real authentication, OTP email delivery,
 * Google login and password reset require a backend (see the endpoints marked TODO).
 * Sessions here are stored in localStorage as a front-end demo.
 * OTP emails should be sent from noreply@7by.in; support: contact@7by.in
 * ================================================================================= */
function authModalHTML(root){
  return `
<div class="auth-ov" id="auth-ov" onclick="if(event.target===this)closeAuth()">
  <div class="auth-box">
    <button class="auth-x" onclick="closeAuth()">✕</button>

    <!-- SIGN IN -->
    <div class="auth-pane" data-pane="signin">
      <div class="auth-logo"><img src="${root}assets/logo-mark.png" class="logo-mark" alt="7By"></div>
      <h3>Welcome back</h3>
      <p class="auth-sub">Sign in to your 7By.in account</p>
      <div class="g-btn-wrap"><button class="auth-google" tabindex="-1"><span class="g-ico">G</span> Continue with Google</button><div class="g-overlay" id="g-overlay-signin"></div></div>
      <div class="auth-or">or</div>
      <div id="signin-email-form">
        <input class="auth-in" id="si-email" type="email" placeholder="you@gmail.com" autocomplete="email">
        <div class="auth-pw"><input class="auth-in" id="si-pass" type="password" placeholder="Password" autocomplete="current-password"><button type="button" class="auth-eye" onclick="togglePw(this)" aria-label="Show password">👁</button></div>
        <div style="text-align:right"><a href="#" class="auth-link" onclick="showAuthPane('forgot');return false">Forgot password?</a></div>
        <button class="auth-primary" onclick="authSignIn()">Sign In</button>
      </div>
      <p class="auth-switch">New here? <a href="#" onclick="showAuthPane('signup');return false">Create an account</a></p>
    </div>

    <!-- SIGN UP -->
    <div class="auth-pane" data-pane="signup" style="display:none">
      <div class="auth-logo"><img src="${root}assets/logo-mark.png" class="logo-mark" alt="7By"></div>
      <h3>Create your account</h3>
      <p class="auth-sub">Start with 20 free credits every day</p>
      <div class="g-btn-wrap"><button class="auth-google" tabindex="-1"><span class="g-ico">G</span> Continue with Google</button><div class="g-overlay" id="g-overlay-signup"></div></div>
      <div class="auth-or">or</div>
      <div id="signup-email-form">
        <input class="auth-in" id="su-name" type="text" placeholder="Full name" autocomplete="name">
        <input class="auth-in" id="su-email" type="email" placeholder="you@gmail.com" autocomplete="email">
        <div class="auth-pw"><input class="auth-in" id="su-pass" type="password" placeholder="Create a password" autocomplete="new-password"><button type="button" class="auth-eye" onclick="togglePw(this)" aria-label="Show password">👁</button></div>
        <div id="su-otp-row" style="display:none">
          <input class="auth-in" id="su-otp" type="text" inputmode="numeric" placeholder="Enter 6-digit OTP sent to your email">
          <div class="auth-resend"><span id="su-resend-txt">Didn't get it?</span> <a href="#" id="su-resend-btn" onclick="authResend('signup');return false">Resend OTP</a></div>
        </div>
        <button class="auth-primary" id="su-btn" onclick="authSignUp()">Send OTP</button>
      </div>
      <p class="auth-switch">Already have an account? <a href="#" onclick="showAuthPane('signin');return false">Sign in</a></p>
    </div>

    <!-- FORGOT PASSWORD -->
    <div class="auth-pane" data-pane="forgot" style="display:none">
      <div class="auth-logo"><img src="${root}assets/logo-mark.png" class="logo-mark" alt="7By"></div>
      <h3>Reset password</h3>
      <p class="auth-sub">Enter your email and we'll send an OTP</p>
      <input class="auth-in" id="fp-email" type="email" placeholder="you@gmail.com" autocomplete="email">
      <div id="fp-otp-row" style="display:none">
        <input class="auth-in" id="fp-otp" type="text" inputmode="numeric" placeholder="Enter OTP">
        <div class="auth-pw"><input class="auth-in" id="fp-new" type="password" placeholder="New password"><button type="button" class="auth-eye" onclick="togglePw(this)" aria-label="Show password">👁</button></div>
        <div class="auth-resend"><span id="fp-resend-txt">Didn't get it?</span> <a href="#" id="fp-resend-btn" onclick="authResend('forgot');return false">Resend OTP</a></div>
      </div>
      <button class="auth-primary" id="fp-btn" onclick="authForgot()">Send OTP</button>
      <p class="auth-switch"><a href="#" onclick="showAuthPane('signin');return false">← Back to sign in</a></p>
    </div>
  </div>
</div>`;
}
function injectAuthStyles(){
  if(document.getElementById('auth-css'))return;
  const s=document.createElement('style');s.id='auth-css';
  s.textContent=`
.auth-ov{position:fixed;inset:0;background:rgba(3,6,14,.8);backdrop-filter:blur(6px);z-index:1000;display:none;align-items:center;justify-content:center;padding:20px}
.auth-ov.show{display:flex}
.auth-box{background:var(--surf);border:1px solid var(--bord);border-radius:24px;padding:32px 28px;width:100%;max-width:400px;position:relative;box-shadow:0 30px 80px -30px #000}
.auth-x{position:absolute;top:16px;right:16px;background:none;border:0;color:var(--mut);font-size:16px;cursor:pointer}
.auth-logo{display:flex;justify-content:center;margin-bottom:14px}
.auth-logo .logo-mark{width:48px;height:48px;padding:6px;border-radius:12px}
.auth-box h3{text-align:center;font-size:22px;margin-bottom:6px}
.auth-sub{text-align:center;color:var(--mut);font-size:13px;margin-bottom:22px}
.auth-google{width:100%;display:flex;align-items:center;justify-content:center;gap:10px;background:#fff;color:#1a1a1a;border:0;border-radius:12px;padding:13px;font-family:'Outfit',sans-serif;font-weight:600;font-size:14px;cursor:pointer;transition:opacity .2s;pointer-events:none}
.g-btn-wrap{position:relative;width:100%}
.g-btn-wrap:hover .auth-google{opacity:.9}
.g-overlay{position:absolute;inset:0;overflow:hidden;opacity:0.01;cursor:pointer}
.g-overlay iframe{width:100% !important}
.g-ico{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:conic-gradient(from -45deg,#ea4335,#fbbc05,#34a853,#4285f4,#ea4335);color:#fff;font-weight:800;font-size:12px}
.auth-or{display:flex;align-items:center;gap:12px;color:var(--dim);font-size:12px;margin:18px 0}
.auth-or::before,.auth-or::after{content:'';flex:1;height:1px;background:var(--bord)}
.auth-resend{text-align:center;font-size:12.5px;color:var(--mut);margin:-4px 0 12px}
.auth-resend a{color:var(--dim);pointer-events:none;text-decoration:none}
.auth-resend a.ready{color:#00D4FF;pointer-events:auto;cursor:pointer;text-decoration:underline}
.auth-in{width:100%;background:var(--s2,#0f1420);border:1px solid var(--bord);border-radius:11px;padding:13px 14px;color:var(--text);font-size:14px;margin-bottom:12px;outline:none;font-family:'Outfit',sans-serif}
.auth-in:focus{border-color:var(--cyan)}
.auth-pw{position:relative}
.auth-pw .auth-in{padding-right:48px}
.auth-eye{position:absolute;right:6px;top:22px;transform:translateY(-50%);width:34px;height:34px;background:none;border:0;cursor:pointer;
  font-size:17px;line-height:1;padding:0;display:flex;align-items:center;justify-content:center;
  filter:brightness(0) invert(.65);opacity:.85;transition:.15s}
.auth-eye:hover{filter:brightness(0) invert(.85);opacity:1}
.auth-eye.showing{filter:none;opacity:1}   /* full-colour eye when the password is visible */
.auth-primary{width:100%;background:linear-gradient(135deg,var(--cyan),var(--mag));color:#fff;border:0;border-radius:12px;padding:13px;font-family:'Outfit',sans-serif;font-weight:700;font-size:14px;cursor:pointer;margin-top:4px}
.auth-mail-toggle{width:100%;background:transparent;color:var(--text);border:1px solid var(--bord);border-radius:12px;padding:12px;font-family:'Outfit',sans-serif;font-weight:500;font-size:14px;cursor:pointer}
.auth-link{color:var(--cyan);font-size:12px;text-decoration:none}
.auth-switch{text-align:center;font-size:13px;color:var(--mut);margin-top:18px}
.auth-switch a{color:var(--cyan);text-decoration:none;font-weight:600}
.nav-user{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--text);background:rgba(0,212,255,.08);border:1px solid rgba(0,212,255,.25);padding:6px 8px 6px 12px;border-radius:99px;max-width:200px}
.nav-user-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:90px}
.nav-user-cr{color:var(--cyan);font-weight:700;white-space:nowrap;flex-shrink:0}
.nav-user-logout{background:rgba(255,255,255,.08);border:0;color:var(--mag);font-size:12px;font-weight:700;padding:4px 9px;border-radius:99px;cursor:pointer;flex-shrink:0}
.nav-user-logout:hover{background:rgba(255,255,255,.16)}
@media(max-width:560px){.nav-user{max-width:150px;font-size:12px}.nav-user-name{max-width:60px}}
.mnav-user{display:flex;align-items:center;justify-content:space-between;gap:10px;background:rgba(0,212,255,.08);border:1px solid rgba(0,212,255,.25);border-radius:14px;padding:12px 14px;margin-bottom:14px}
.mnav-user-main{min-width:0;flex:1}
.mnav-user-name{overflow-x:auto;overflow-y:hidden;white-space:nowrap;font-size:15px;font-weight:700;scrollbar-width:none;-ms-overflow-style:none}
.mnav-user-name::-webkit-scrollbar{display:none}
.mnav-user-cr{display:inline-flex;align-items:center;gap:5px;margin-top:6px;font-size:13px;font-weight:800;letter-spacing:.2px;color:#04121a;
  background:linear-gradient(135deg,var(--cyan),var(--mag));padding:4px 11px;border-radius:99px;white-space:nowrap}
@keyframes allToolsPulse{0%,100%{box-shadow:0 0 0 0 rgba(0,212,255,.45)}50%{box-shadow:0 0 0 6px rgba(0,212,255,0)}}
@keyframes allToolsDot{0%,100%{transform:scale(1)}50%{transform:scale(1.4)}}
.nav-alltools{display:inline-flex;align-items:center;gap:7px;font-size:13px;font-weight:700;color:#04121a;text-decoration:none;padding:7px 14px;border-radius:99px;
  background:linear-gradient(135deg,var(--cyan),var(--mag));animation:allToolsPulse 2.4s ease-in-out infinite;white-space:nowrap;transition:transform .15s}
.nav-alltools:hover{transform:translateY(-1px) scale(1.03)}
.nav-alltools-dot{width:6px;height:6px;border-radius:50%;background:#04121a;animation:allToolsDot 1.2s ease-in-out infinite}
.nav-alltools-block{display:flex;width:100%;justify-content:center;margin-bottom:14px;padding:12px 14px;font-size:14px}
@media(max-width:960px){.nav-center .nav-alltools{display:none}}
`;
  document.head.appendChild(s);
}
/* ---- config: set these to go live (see server/README.md) ---- */
window.API_BASE = window.API_BASE || 'https://api.7by.in';   // your live backend (set '' to force offline demo)
window.GOOGLE_CLIENT_ID = window.GOOGLE_CLIENT_ID || '795705423816-2ffl53j83vir4mvau9mo4883afqc8khp.apps.googleusercontent.com';     // Google OAuth Web client id
function _apiOn(){ return !!window.API_BASE; }
function _token(){ try{ return localStorage.getItem('7by_token'); }catch(e){ return null; } }
async function apiPost(path, body, useAuth){
  const headers={'Content-Type':'application/json'};
  if(useAuth){ const t=_token(); if(t) headers['Authorization']='Bearer '+t; }
  const r=await fetch(window.API_BASE+path,{method:'POST',headers,body:JSON.stringify(body||{})});
  let data={}; try{ data=await r.json(); }catch(e){}
  if(!r.ok) throw new Error(data.error||('Request failed ('+r.status+')'));
  return data;
}
function togglePw(btn){const i=btn.parentElement.querySelector('input');if(!i)return;const show=i.type==='password';i.type=show?'text':'password';btn.classList.toggle('showing',show);btn.setAttribute('aria-label',show?'Hide password':'Show password');}
function openAuth(pane){document.getElementById('auth-ov').classList.add('show');showAuthPane(pane||'signin');_renderGoogleButtons();}
function closeAuth(){const o=document.getElementById('auth-ov');if(o)o.classList.remove('show');}
function showAuthPane(name){document.querySelectorAll('.auth-pane').forEach(p=>p.style.display=p.dataset.pane===name?'block':'none');}
function _validEmail(e){return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e||'').trim());}
function _validGmail(e){return /^[a-zA-Z0-9._%+-]+@gmail\.com$/i.test(String(e||'').trim());}
const _resendState={signup:{until:0,timer:null},forgot:{until:0,timer:null}};
function _startResendCooldown(kind){
  const btn=document.getElementById(kind==='signup'?'su-resend-btn':'fp-resend-btn');
  const st=_resendState[kind]; st.until=Date.now()+60000;
  if(st.timer)clearInterval(st.timer);
  function tick(){
    const left=Math.ceil((st.until-Date.now())/1000);
    if(left<=0){ btn.textContent='Resend OTP'; btn.classList.add('ready'); clearInterval(st.timer); return; }
    btn.textContent='Resend in '+left+'s'; btn.classList.remove('ready');
  }
  tick(); st.timer=setInterval(tick,1000);
}
async function authResend(kind){
  const btn=document.getElementById(kind==='signup'?'su-resend-btn':'fp-resend-btn');
  if(!btn.classList.contains('ready'))return;
  try{
    if(kind==='signup'){
      const name=document.getElementById('su-name').value.trim(), email=document.getElementById('su-email').value.trim(), pass=document.getElementById('su-pass').value;
      await apiPost('/api/auth/signup',{name,email,password:pass});
    }else{
      const email=document.getElementById('fp-email').value.trim();
      await apiPost('/api/auth/forgot',{email});
    }
    toast('OTP resent'); _startResendCooldown(kind);
  }catch(e){ toast(e.message||'Could not resend'); }
}

/* ---- Google Sign-In: renders Google's REAL button invisibly on top of our styled
 * button (see .g-overlay CSS). A real click lands on Google's actual iframe button,
 * which works reliably on mobile and inside iframes (unlike the old One Tap prompt(),
 * which Google blocks inside third-party iframes — the WordPress site embeds the
 * subdomain tools in an iframe, so prompt() silently failed there). ---- */
let _gReady=false, _gInitDone=false;
async function _googleCallback(resp){
  if(!resp||!resp.credential){ toast('Google sign-in failed'); return; }
  try{
    const d=await apiPost('/api/auth/google',{credential:resp.credential});
    _setSession(d.token,d.user); toast('Signed in with Google'); closeAuth();
  }catch(e){ toast(e.message||'Google sign-in failed'); }
}
function _loadGoogleScript(){
  return new Promise((res,rej)=>{
    if(window.google&&google.accounts&&google.accounts.id){ res(); return; }
    const s=document.createElement('script'); s.src='https://accounts.google.com/gsi/client'; s.async=true;
    s.onload=res; s.onerror=()=>rej(new Error('Could not load Google')); document.head.appendChild(s);
  });
}
async function _renderGoogleButtons(){
  if(_gInitDone||!window.GOOGLE_CLIENT_ID||!_apiOn())return;
  try{
    await _loadGoogleScript();
    google.accounts.id.initialize({client_id:window.GOOGLE_CLIENT_ID, callback:_googleCallback, ux_mode:'popup'});
    ['g-overlay-signin','g-overlay-signup'].forEach(id=>{
      const el=document.getElementById(id);
      if(el) google.accounts.id.renderButton(el,{type:'standard',theme:'outline',size:'large',width:320});
    });
    _gInitDone=true;
  }catch(e){ /* Google script failed to load — the styled button just stays inert */ }
}

async function authSignIn(){
  const email=document.getElementById('si-email').value.trim(), pass=document.getElementById('si-pass').value;
  if(!_validGmail(email)){toast('Only real @gmail.com addresses are allowed');return;}
  if(pass.length<6){toast('Enter your password');return;}
  if(_apiOn()){
    try{ const d=await apiPost('/api/auth/login',{email,password:pass}); _setSession(d.token,d.user); toast('Signed in'); closeAuth(); }
    catch(e){ toast(e.message); }
  }else{ _setSession(null,{email}); toast('Signed in (demo)'); closeAuth(); }
}
let _suStage=0;
async function authSignUp(){
  const name=document.getElementById('su-name').value.trim(), email=document.getElementById('su-email').value.trim(), pass=document.getElementById('su-pass').value;
  if(_suStage===0){
    if(!name){toast('Enter your name');return;}
    if(!_validGmail(email)){toast('Only real @gmail.com addresses are allowed');return;}
    if(pass.length<6){toast('Password must be 6+ characters');return;}
    if(_apiOn()){ try{ await apiPost('/api/auth/signup',{name,email,password:pass}); }catch(e){ toast(e.message); return; } }
    document.getElementById('su-otp-row').style.display='block';
    document.getElementById('su-btn').textContent='Verify & Create Account';
    _suStage=1;toast('OTP sent to '+email); _startResendCooldown('signup');
  }else{
    const otp=document.getElementById('su-otp').value.trim();
    if(otp.length<4){toast('Enter the OTP from your email');return;}
    if(_apiOn()){
      try{ const d=await apiPost('/api/auth/verify',{email,otp}); _setSession(d.token,d.user); toast('Account created — 20 free credits added'); closeAuth(); _suStage=0; }
      catch(e){ toast(e.message); }
    }else{ _setSession(null,{email}); toast('Account created (demo)'); closeAuth(); _suStage=0; }
  }
}
let _fpStage=0;
async function authForgot(){
  const email=document.getElementById('fp-email').value.trim();
  if(_fpStage===0){
    if(!_validGmail(email)){toast('Only real @gmail.com addresses are allowed');return;}
    if(_apiOn()){ try{ await apiPost('/api/auth/forgot',{email}); }catch(e){ toast(e.message); return; } }
    document.getElementById('fp-otp-row').style.display='block';
    document.getElementById('fp-btn').textContent='Reset Password';
    _fpStage=1;toast('OTP sent to '+email); _startResendCooldown('forgot');
  }else{
    const otp=document.getElementById('fp-otp').value.trim(), np=document.getElementById('fp-new').value;
    if(otp.length<4){toast('Enter the OTP');return;}
    if(np.length<6){toast('New password must be 6+ characters');return;}
    if(_apiOn()){ try{ await apiPost('/api/auth/reset',{email,otp,newPassword:np}); }catch(e){ toast(e.message); return; } }
    toast('Password reset — please sign in');showAuthPane('signin');_fpStage=0;
  }
}
function _setSession(token,user){ try{ if(token)localStorage.setItem('7by_token',token); if(user)localStorage.setItem('7by_user',JSON.stringify(user)); }catch(e){} refreshAuthUI(); if(window.Credits&&Credits.sync)Credits.sync(); }
function authLogout(){ try{ localStorage.removeItem('7by_user'); localStorage.removeItem('7by_token'); localStorage.removeItem('7by_credits_srv'); }catch(e){} refreshAuthUI(); if(typeof window.renderCredits==='function')try{window.renderCredits();}catch(e){} toast('Signed out'); location.reload(); }
function currentUser(){ try{ return JSON.parse(localStorage.getItem('7by_user')); }catch(e){ return null; } }
async function _refreshMe(){ if(!_apiOn()||!_token())return; try{ const d=await apiPost('/api/me',{},true); if(d.user){ localStorage.setItem('7by_user',JSON.stringify(d.user)); refreshAuthUI(); if(window.Credits&&Credits.sync)Credits.sync(); } }catch(e){ if(String(e.message).indexOf('session')>-1) authLogout(); } }
function refreshAuthUI(){
  const u=currentUser();
  const btn=document.getElementById('nav-auth-btn');
  const mbtn=document.getElementById('mnav-auth-btn');
  if(!u)return;
  const nm=(u.name||u.email||'account').split('@')[0];
  const crShort=(typeof u.credits==='number')?(u.credits+' cr'):'';
  const crFull=(typeof u.credits==='number')?('⚡ '+u.credits+' credits'):'';
  if(btn){
    btn.outerHTML='<span class="nav-user" id="nav-auth-btn" title="'+(u.email||'')+'">'
      +'<span class="nav-user-name">👤 '+nm+'</span>'
      +(crShort?'<span class="nav-user-cr">'+crShort+'</span>':'')
      +'<button class="nav-user-logout" onclick="authLogout()">Logout</button></span>';
  }
  if(mbtn){
    mbtn.outerHTML='<div class="mnav-user" id="mnav-auth-btn">'
      +'<div class="mnav-user-main"><div class="mnav-user-name">👤 '+nm+'</div>'
      +(crFull?'<span class="mnav-user-cr">'+crFull+'</span>':'')+'</div>'
      +'<button class="nav-user-logout" onclick="authLogout()">Logout</button></div>';
  }
}
// Refresh session from server on load (if configured)
if(typeof window!=='undefined') setTimeout(()=>{ try{ _refreshMe(); }catch(e){} },0);
