/* 7By Account Hub — multi-step auth (Google, email sign in/up, OTP verify, reset). */
(function () {
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
  // Absolute so it resolves correctly from pretty URLs like /removebgpremiumaccount
  var API = '/api.php?action=';

  var pendingSignup = null;   // {name,email,password} awaiting OTP
  var pendingResetEmail = ''; // email awaiting reset OTP

  function post(action, data) {
    return fetch(API + action, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data || {}),
    }).then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); });
  }

  function msg(text, ok) {
    var el = $('#authMsg');
    el.textContent = text || '';
    el.className = 'msg ' + (text ? (ok ? 'ok' : 'err') : '');
  }

  /* ---- step navigation ---- */
  function goStep(name) {
    $$('.astep').forEach(function (s) { s.hidden = s.dataset.step !== name; });
    msg('');
    var focusable = $('.astep[data-step="' + name + '"] input');
    if (focusable) setTimeout(function () { focusable.focus(); }, 40);
  }
  $$('[data-go]').forEach(function (b) {
    b.addEventListener('click', function () { goStep(b.dataset.go); });
  });
  function setEcho(email) { $$('.email-echo').forEach(function (e) { e.textContent = email; }); }

  /* ---- sign in ---- */
  $('#signinForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    post('login', { email: f.email.value, password: f.password.value }).then(function (r) {
      if (r.body.ok) enterDashboard(r.body.user);
      else msg(r.body.error || 'Login failed.');
    });
  });

  /* ---- sign up (step 1: send OTP) ---- */
  $('#signupForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    pendingSignup = { name: f.name.value.trim(), email: f.email.value.trim().toLowerCase(), password: f.password.value };
    var btn = f.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Sending code…';
    post('signup_start', pendingSignup).then(function (r) {
      btn.disabled = false; btn.textContent = 'Continue';
      if (r.body.ok) { setEcho(pendingSignup.email); goStep('verify'); }
      else msg(r.body.error || 'Could not start sign up.');
    });
  });

  /* ---- sign up (step 2: verify OTP -> create account) ---- */
  $('#verifyForm').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!pendingSignup) { goStep('signup'); return; }
    var code = e.target.code.value.trim();
    post('signup_verify', { email: pendingSignup.email, code: code }).then(function (r) {
      if (r.body.ok) { pendingSignup = null; enterDashboard(r.body.user); }
      else msg(r.body.error || 'Verification failed.');
    });
  });
  $('#resendBtn').addEventListener('click', function () {
    if (!pendingSignup) return;
    msg('Sending a new code…', true);
    post('signup_start', pendingSignup).then(function (r) {
      msg(r.body.ok ? 'A new code is on its way.' : (r.body.error || 'Could not resend.'), r.body.ok);
    });
  });

  /* ---- forgot password (step 1: send OTP) ---- */
  $('#forgotForm').addEventListener('submit', function (e) {
    e.preventDefault();
    pendingResetEmail = e.target.email.value.trim().toLowerCase();
    var btn = e.target.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Sending…';
    post('reset_start', { email: pendingResetEmail }).then(function (r) {
      btn.disabled = false; btn.textContent = 'Send code';
      // Always advance (server never reveals whether the email exists).
      setEcho(pendingResetEmail); goStep('reset');
    });
  });

  /* ---- forgot password (step 2: verify OTP + new password) ---- */
  $('#resetForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    if (f.password.value !== f.confirm.value) { msg('Passwords do not match.'); return; }
    post('reset_verify', { email: pendingResetEmail, code: f.code.value.trim(), password: f.password.value }).then(function (r) {
      if (r.body.ok) { goStep('signin'); msg('Password reset. Please sign in.', true); }
      else msg(r.body.error || 'Reset failed.');
    });
  });

  /* ---- Google ---- */
  window.onGoogle = function (resp) {
    post('google', { credential: resp.credential }).then(function (r) {
      if (r.body.ok) enterDashboard(r.body.user);
      else msg(r.body.error || 'Google sign-in failed.');
    });
  };

  /* ---- dashboard ---- */
  function wireBack() {
    var back = $('#backLink');
    if (!back) return;
    if (window.HUB.redirect) {
      // Came from a tool with ?return=<url>
      back.href = window.HUB.redirect;
      back.textContent = '← Back to the tool';
    } else if (window.HUB.toolUrl && window.HUB.product) {
      // On a product page (e.g. /removebgpremiumaccount) — go to that tool.
      back.href = window.HUB.toolUrl;
      back.textContent = '← Back to ' + (window.HUB.brandName || 'the tool');
    } else {
      back.href = 'https://7by.in';
      back.textContent = '← Back to 7By.in';
    }
    back.hidden = false;
  }

  function enterDashboard(user) {
    $('#authCard').hidden = true;
    $('#dashCard').hidden = false;
    renderUser(user);
    wireBack();
  }
  function renderUser(user) {
    if (!user) return;
    $('#dName').textContent = user.name || 'there';
    $('#dEmail').textContent = user.email;
    $('#dCredits').textContent = user.credits;
    $('#dPlan').textContent = user.plan && user.plan !== 'none'
      ? 'Plan: ' + user.plan + (user.expires ? ' · expires ' + new Date(user.expires).toLocaleDateString() : '')
      : 'No active plan';
  }
  var logout = $('#logoutBtn');
  if (logout) logout.addEventListener('click', function () { post('logout', {}).then(function () { location.reload(); }); });

  /* ---- buy credits (7Pay — our own gateway — or Razorpay) ---- */
  // Load the 7Pay SDK from the gateway itself the first time it's needed.
  function withSevenPay(base, cb) {
    if (window.SevenPay) return cb();
    var s = document.createElement('script');
    s.src = base + '/checkout.js';
    s.onload = cb;
    s.onerror = function () { dmsg('Could not load checkout. Please try again.'); };
    document.head.appendChild(s);
  }
  function paySevenPay(o, plan, p) {
    withSevenPay(o.sevenpay_base, function () {
      var sp = new SevenPay({
        key: o.key_id, order_id: o.order_id,
        description: (p.label || plan) + ' — ' + (o.credits || p.credits || '') + ' credits',
        prefill: { email: o.email },
        handler: function (resp) {
          post('verify', {
            sevenpay_order_id: resp.sevenpay_order_id,
            sevenpay_payment_id: resp.sevenpay_payment_id,
            sevenpay_signature: resp.sevenpay_signature, plan: plan,
          }).then(function (v) {
            if (v.body.ok) { renderUser(v.body.user); dmsg('🎉 Credits added!', true); }
            else dmsg(v.body.error || 'Payment verification failed.');
          });
        },
        modal: { ondismiss: function () { dmsg('Payment cancelled.'); } },
      });
      sp.on('payment.failed', function () { dmsg('Payment failed. Please try again.'); });
      sp.open(); dmsg('');
    });
  }
  $$('[data-buy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var plan = btn.dataset.buy;
      dmsg('Starting secure checkout…', true);
      // product tells the server which page this is (VocalRemover plans grant
      // more credits); currency/amount are decided server-side by country.
      post('order', { plan: plan, product: window.HUB.product || '' }).then(function (r) {
        if (!r.body.ok) { dmsg(r.body.error || 'Could not start payment.'); return; }
        var o = r.body, p = window.HUB.plans[plan] || {};
        if (o.gateway === 'sevenpay') { paySevenPay(o, plan, p); return; }
        var rzp = new Razorpay({
          key: o.key_id, amount: o.amount, currency: o.currency || 'INR', name: '7By',
          description: (p.label || plan) + ' — ' + (o.credits || p.credits || '') + ' credits',
          order_id: o.order_id, prefill: { name: o.name, email: o.email }, theme: { color: '#4f46e5' },
          handler: function (resp) {
            post('verify', {
              razorpay_order_id: resp.razorpay_order_id,
              razorpay_payment_id: resp.razorpay_payment_id,
              razorpay_signature: resp.razorpay_signature, plan: plan,
            }).then(function (v) {
              if (v.body.ok) { renderUser(v.body.user); dmsg('🎉 Credits added!', true); }
              else dmsg(v.body.error || 'Payment verification failed.');
            });
          },
        });
        rzp.on('payment.failed', function () { dmsg('Payment failed or cancelled.'); });
        rzp.open(); dmsg('');
      });
    });
  });
  function dmsg(text, ok) { var el = $('#dashMsg'); el.textContent = text || ''; el.className = 'msg ' + (text ? (ok ? 'ok' : 'err') : ''); }

  /* ---- init: if the page loaded already logged in (session), wire up the
     dashboard (back link + fresh credits/plan) since enterDashboard didn't run. ---- */
  (function init() {
    var dash = $('#dashCard');
    if (dash && !dash.hidden) {
      wireBack();
      fetch(API + 'me', { credentials: 'include' })
        .then(function (r) { return r.json(); })
        .then(function (j) { if (j && j.user) renderUser(j.user); })
        .catch(function () {});
    }
  })();
})();
