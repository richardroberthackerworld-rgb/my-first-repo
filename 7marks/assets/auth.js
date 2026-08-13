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
  var HUB = 'https://account.7by.in';

  /** Call the hub. Content-Type is set only when there IS a body: on a
      bodyless GET it forces a CORS preflight that some hosts reject. */
  function hubApi(action, body) {
    var h = {};
    if (body) h['Content-Type'] = 'application/json';
    var t = M.hub.token();
    if (t) { h['Authorization'] = 'Bearer ' + t; h['X-7By-Token'] = t; }
    return fetch(HUB + '/api.php?action=' + encodeURIComponent(action), {
      method: body ? 'POST' : 'GET',
      headers: h,
      credentials: 'omit',
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok || j.error) {
          throw new Error(j.message || j.error || ('Sign-in failed (' + r.status + ')'));
        }
        return j;
      });
    });
  }

  var state = { mode: 'signin', email: '', busy: false };

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

      (mode === 'otp'
        ? '<label class="cfg-l">6-digit code</label>' +
          '<input class="sel auth-in" id="auOtp" inputmode="numeric" maxlength="6" ' +
          'placeholder="000000" autocomplete="one-time-code">' +
          '<label class="cfg-l" style="margin-top:12px">Choose a password</label>' +
          '<input class="sel auth-in" id="auPass2" type="password" ' +
          'placeholder="At least 6 characters" autocomplete="new-password">'
        : '<label class="cfg-l">Email</label>' +
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
        : mode === 'otp' ? 'Create account'
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
  }

  function submit() {
    if (state.busy) return;
    var mode = state.mode, go = $('#auGo');
    var email = $('#auEmail') ? $('#auEmail').value.trim() : state.email;

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
      call = hubApi('signup_start', { email: email });
    } else if (mode === 'reset') {
      call = hubApi('reset_start', { email: email });
    } else {
      var otp = ($('#auOtp').value || '').trim();
      var pw  = $('#auPass2').value;
      if (otp.length < 4) { state.busy = false; go.disabled = false;
        return draw('Enter the 6-digit code from your email.', true); }
      if (pw.length < 6) { state.busy = false; go.disabled = false;
        return draw('Choose a password of at least 6 characters.', true); }
      call = hubApi('signup_verify', { email: state.email, otp: otp, password: pw });
    }

    call.then(function (j) {
      state.busy = false;
      /* login, signup_verify and google all return the user and the token
         together, so the app can show the account immediately rather than
         waiting on a follow-up call */
      if (j.token) {
        M.hub.setToken(j.token);
        if (j.user && j.user.name) {
          M.state.user.name = j.user.name;
          M.save('user');
        }
        d.getElementById('modal').classList.remove('open');
        M.toast('Signed in', 'ok');
        /* re-read the plan and balance from the server, then repaint */
        M.credits.status(true).then(function () { location.reload(); });
        return;
      }
      /* a code was sent — move to the OTP step */
      state.mode = (state.mode === 'reset') ? 'otp' : 'otp';
      draw('Code sent. Check your inbox, and your spam folder.', false);
    }).catch(function (e) {
      state.busy = false;
      draw(e.message || 'That did not work. Please try again.', true);
    });
  }

  M.auth = { open: open, hubApi: hubApi };
})(window, document);
