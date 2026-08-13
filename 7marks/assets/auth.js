/* =====================================================================
   7MARKS — sign in and create account, inside 7Marks.

   Sending a student to another website to sign in loses them: they land on
   a page that does not look like the app they were using, and many never
   come back. The account hub still owns identity — this only talks to it —
   but the student never leaves 7marks.7by.in.

   The calls are the same ones classic.html has used in production for
   months: a direct cross-origin POST to the hub with credentials omitted,
   so the shared *.7by.in session cookie is never sent and a 7Marks sign-in
   cannot sign anyone in to 7Solve.
   ===================================================================== */
(function (w, d) {
  'use strict';
  var M = w.M7;
  var $ = M.qs, esc = M.esc;
  /* Our OWN server, not the hub.

     This used to post straight to https://account.7by.in/api.php. The hub
     sends no Access-Control-Allow-Origin header, so the browser blocked
     every one of those calls before they left the machine — the card
     rendered and nothing behind it worked. auth.php is same-origin, so CORS
     never applies, and it forwards to the hub server-to-server. */
  var API = 'auth.php';

  function hubApi(action, body) {
    return fetch(API + '?action=' + encodeURIComponent(action), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body || {})
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok || j.error) {
          throw new Error(j.message || j.error || ('Sign-in failed (' + r.status + ')'));
        }
        return j;
      });
    });
  }

  /* `flow` records which journey the code screen belongs to — signing up or
     resetting a password. Both land on mode 'otp' but hit different hub
     actions, so the mode alone is not enough to tell them apart. */
  var state = { mode: 'signin', flow: 'signup', email: '', name: '', busy: false };

  function open(mode) {
    state.mode = mode || 'signin';
    draw();
    d.getElementById('modal').classList.add('open');
  }

  function draw(msg, isErr) {
    var m = d.getElementById('modal');
    var mode = state.mode;
    var title = mode === 'signup' ? 'Create your 7Marks account'
              : mode === 'otp'    ? 'Check your email'
              : mode === 'reset'  ? 'Reset your password'
              : 'Sign in to 7Marks';
    var lede = mode === 'signup'
        ? 'One account works across 7by.in. Your practice stays on this device until you sign in.'
      : mode === 'otp'
        ? 'We sent a 6-digit code to ' + esc(state.email) + '.'
      : mode === 'reset'
        ? 'Enter your email and we will send a code to reset it.'
        : 'Sign in to keep your credits, plan and results with your account.';

    m.innerHTML = '<div class="modal-c auth">' +
      '<div class="auth-top">' + M.mark(44) +
      '<div><h3>' + title + '</h3><p>' + lede + '</p></div></div>' +

      (msg ? '<div class="auth-msg' + (isErr ? ' err' : '') + '">' + esc(msg) + '</div>' : '') +

      /* Google's own button, rendered by Google's script into this slot and
         handled here — the student never leaves 7marks.7by.in. The slot is
         always drawn so its height does not jump when the script lands;
         gsi() fills it, or hides it if no client ID is configured. */
      ((mode === 'signin' || mode === 'signup')
        ? '<div class="auth-gwrap" id="auGWrap" hidden>' +
          '<div id="auG"></div>' +
          '<div class="auth-or"><span>or use your email</span></div></div>'
        : '') +

      (mode === 'otp'
        ? '<label class="cfg-l">6-digit code</label>' +
          '<input class="sel auth-in" id="auOtp" inputmode="numeric" maxlength="6" ' +
          'placeholder="000000" autocomplete="one-time-code">' +
          /* Only a password RESET sets a new password here. On signup the
             hub already took the password at step one and hashed it into
             the pending code, so asking again would be a second, different
             password that it would ignore. */
          (state.flow === 'reset'
            ? '<label class="cfg-l" style="margin-top:12px">Choose a new password</label>' +
              '<input class="sel auth-in" id="auPass2" type="password" ' +
              'placeholder="At least 6 characters" autocomplete="new-password">'
            : '')
        : (mode === 'signup'
            /* asked before the email, because it is what the app greets
               them by afterwards instead of "Student" */
            ? '<label class="cfg-l">Your name</label>' +
              '<input class="sel auth-in" id="auName" type="text" maxlength="60" ' +
              'placeholder="Your name" autocomplete="name" value="' +
              esc(state.name) + '">' +
              '<label class="cfg-l" style="margin-top:12px">Email</label>'
            : '<label class="cfg-l">Email</label>') +
          '<input class="sel auth-in" id="auEmail" type="email" ' +
          'placeholder="you@example.com" autocomplete="email" value="' + esc(state.email) + '">' +
          (mode === 'reset' ? '' :
            '<label class="cfg-l" style="margin-top:12px">Password</label>' +
            '<input class="sel auth-in" id="auPass" type="password" ' +
            'placeholder="Your password" autocomplete="' +
            (mode === 'signup' ? 'new-password' : 'current-password') + '">')
      ) +

      '<button class="btn btn-v auth-go" id="auGo">' +
      (mode === 'signup' ? 'Send me a code'
        : mode === 'otp'
            ? (state.flow === 'reset' ? 'Set new password' : 'Create my account')
        : mode === 'reset' ? 'Send reset code' : 'Sign in') + '</button>' +

      '<div class="auth-alt">' +
      (mode === 'signin'
        ? '<button data-m="signup">Create an account</button>' +
          '<button data-m="reset">Forgot password?</button>'
        : '<button data-m="signin">← Back to sign in</button>') +
      '</div>' +
      '<button class="auth-close" id="auClose" aria-label="Close">✕</button>' +
      '</div>';

    m.classList.add('open');
    $('#auClose').onclick = function () { m.classList.remove('open'); };
    Array.prototype.forEach.call(m.querySelectorAll('.auth-alt button'), function (b) {
      b.onclick = function () { state.mode = this.dataset.m; draw(); };
    });
    $('#auGo').onclick = submit;
    m.querySelectorAll('.auth-in').forEach(function (i) {
      i.onkeydown = function (e) { if (e.key === 'Enter') submit(); };
    });
    var first = m.querySelector('.auth-in');
    if (first) setTimeout(function () { first.focus(); }, 60);
    gsi();
  }

  /* login, signup_verify and google all return the user and the token
     together, so the app can show the account immediately rather than
     waiting on a follow-up call */
  function finish(j) {
    state.busy = false;
    M.hub.setToken(j.token);
    /* fall back to the name they just typed, so the greeting is right even
       if the hub's reply does not echo it back */
    var nm = (j.user && j.user.name) ? j.user.name : state.name;
    if (nm) { M.state.user.name = nm; M.save('user'); }
    d.getElementById('modal').classList.remove('open');
    M.toast('Signed in', 'ok');
    /* re-read the plan and balance from the server, then repaint */
    M.credits.status(true).then(function () { location.reload(); });
  }

  function submit() {
    if (state.busy) return;
    var mode = state.mode, go = $('#auGo');
    var email = $('#auEmail') ? $('#auEmail').value.trim() : state.email;
    if ($('#auName')) state.name = $('#auName').value.trim();

    if (mode === 'signup' && state.name.length < 2) {
      return draw('Please enter your name.', true);
    }

    if (mode !== 'otp') {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return draw('That email does not look right.', true);
      }
      state.email = email;
    }

    state.busy = true; go.disabled = true; go.textContent = 'Please wait…';

    var call;
    if (mode === 'signin') {
      call = hubApi('login', { email: email, password: $('#auPass').value });
    } else if (mode === 'signup') {
      /* the hub wants the password at step ONE — it hashes it into the
         pending code, and signup_verify then needs only the code */
      var np = $('#auPass').value;
      if (np.length < 6) { state.busy = false; go.disabled = false;
        return draw('Choose a password of at least 6 characters.', true); }
      state.flow = 'signup';
      call = hubApi('signup_start',
        { email: email, name: state.name, password: np });
    } else if (mode === 'reset') {
      state.flow = 'reset';
      call = hubApi('reset_start', { email: email });
    } else {
      var otp = ($('#auOtp').value || '').trim();
      if (otp.length < 4) { state.busy = false; go.disabled = false;
        return draw('Enter the 6-digit code from your email.', true); }
      if (state.flow === 'reset') {
        var pw = $('#auPass2').value;
        if (pw.length < 6) { state.busy = false; go.disabled = false;
          return draw('Choose a password of at least 6 characters.', true); }
        call = hubApi('reset_verify',
          { email: state.email, code: otp, password: pw });
      } else {
        call = hubApi('signup_verify', { email: state.email, code: otp });
      }
    }

    call.then(function (j) {
      state.busy = false;
      /* login, signup_verify and google all return the user and the token
         together, so the app can show the account immediately rather than
         waiting on a follow-up call */
      if (j.token) return finish(j);
      /* A completed password reset returns ok with no token — the hub does
         not sign you in on a reset. Send them to sign in with the new
         password rather than leaving them on a dead code screen. */
      if (mode === 'otp' && state.flow === 'reset') {
        state.mode = 'signin';
        return draw('Password changed. Sign in with your new password.', false);
      }
      /* a code was sent — move to the code step */
      state.mode = 'otp';
      draw('Code sent. Check your inbox, and your spam folder.', false);
    }).catch(function (e) {
      state.busy = false;
      draw(e.message || 'That did not work. Please try again.', true);
    });
  }

  /* ------------------------------------------------------------------
     Google, in place.

     Google Identity Services draws its own button — that is where the real
     Google mark comes from, and drawing our own copy of it would breach
     their branding rules. It hands back an ID token, which goes to our
     auth.php, which verifies it at the hub. No redirect: the student stays
     on 7marks.7by.in the whole way through.
     ------------------------------------------------------------------ */
  var gid = null;          /* client ID once known; '' means not configured */
  var gsiLoad = null;      /* the <script> load promise, created once */

  function loadGsi() {
    if (gsiLoad) return gsiLoad;
    gsiLoad = new Promise(function (ok, no) {
      if (w.google && w.google.accounts) return ok();
      var s = d.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true; s.defer = true;
      s.onload = ok;
      s.onerror = function () { no(new Error('gsi blocked')); };
      d.head.appendChild(s);
    });
    return gsiLoad;
  }

  function onGoogle(resp) {
    if (!resp || !resp.credential) return;
    draw('Signing you in…', false);
    hubApi('google', { credential: resp.credential })
      .then(finish)
      .catch(function (e) { draw(e.message || 'Google sign-in failed.', true); });
  }

  /** Fill the Google slot on the card, if a client ID is configured. */
  function gsi() {
    var wrap = d.getElementById('auGWrap');
    if (!wrap) return;

    var start = function () {
      if (!gid) return;                       /* not configured — stay hidden */
      loadGsi().then(function () {
        var slot = d.getElementById('auG');
        if (!slot || !w.google || !w.google.accounts) return;
        w.google.accounts.id.initialize({
          client_id: gid,
          callback: onGoogle,
          ux_mode: 'popup'                    /* popup, so we never navigate away */
        });
        w.google.accounts.id.renderButton(slot, {
          type: 'standard', theme: 'outline', size: 'large',
          text: 'continue_with', shape: 'pill',
          logo_alignment: 'left', width: slot.offsetWidth || 320
        });
        wrap.hidden = false;
      }).catch(function () { /* offline or blocked: email sign-in still works */ });
    };

    if (gid !== null) return start();
    fetch(API + '?action=config', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (j) { gid = (j && j.google_client_id) || ''; start(); })
      .catch(function () { gid = ''; });
  }

  M.auth = { open: open, hubApi: hubApi };
})(window, document);
