/* =====================================================================
   7MARKS — core runtime.
   State, persistence, router, the AI service boundary, and the exam
   engine. No secrets live here: every model call goes to api.php, which
   holds the keys server-side.
   ===================================================================== */
(function (w, d) {
  'use strict';

  /* ============================ helpers ============================ */
  var $  = function (s, r) { return (r || d).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || d).querySelectorAll(s)); };
  function el(tag, cls, html) {
    var n = d.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  /** Escape anything that came from a student or a model before it meets innerHTML. */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

  /* ============================ storage ============================
     One namespaced key per concern, and every read is defensive: a student
     on a shared machine with a full or disabled localStorage must still get
     a working app, just without persistence. */
  var NS = '7marks.';
  var store = {
    get: function (k, dflt) {
      try {
        var v = localStorage.getItem(NS + k);
        return v == null ? dflt : JSON.parse(v);
      } catch (e) { return dflt; }
    },
    set: function (k, v) {
      try { localStorage.setItem(NS + k, JSON.stringify(v)); return true; }
      catch (e) { return false; }
    },
    del: function (k) { try { localStorage.removeItem(NS + k); } catch (e) {} }
  };

  /* ============================ state ============================ */
  var state = {
    view: 'home',
    cat: store.get('cat', 'school'),
    course: store.get('course', 'c10'),
    year: store.get('year', 0),     /* 0 = whole course; 1-based otherwise */
    subject: store.get('subject', null),
    user: store.get('user', { name: 'Student', xp: 0, level: 1, streak: 0, lastDay: null }),
    bookmarks: store.get('bookmarks', []),
    notes: store.get('notes', []),
    notifs: store.get('notifs', [
      { em: '👋', t: 'Welcome to 7Marks', s: 'Pick your class and start practising.', unread: true },
      { em: '🎯', t: 'Set your daily goal', s: '30 minutes a day builds a streak.', unread: true }
    ]),
    history: store.get('history', [])
  };
  function save(k) { store.set(k, state[k]); }

  /* daily streak: counted once per calendar day, on first load */
  (function streak() {
    var today = new Date().toISOString().slice(0, 10), u = state.user;
    if (u.lastDay === today) return;
    var y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    u.streak = (u.lastDay === y) ? (u.streak || 0) + 1 : 1;
    u.lastDay = today;
    save('user');
  })();

  function addXP(n, why) {
    var u = state.user;
    u.xp = (u.xp || 0) + n;
    var lvl = Math.floor(u.xp / 250) + 1;
    var up = lvl > (u.level || 1);
    u.level = lvl;
    save('user');
    toast((up ? '🎉 Level ' + lvl + '! ' : '⭐ ') + '+' + n + ' XP' + (why ? ' — ' + why : ''), up ? 'ok' : '');
    w.dispatchEvent(new CustomEvent('7m:xp'));
  }

  /* ============================ toasts ============================ */
  var toastBox;
  function toast(msg, kind, ms) {
    if (!toastBox) { toastBox = el('div', 'toasts'); d.body.appendChild(toastBox); }
    var t = el('div', 'toast ' + (kind || ''), esc(msg));
    toastBox.appendChild(t);
    setTimeout(function () {
      t.classList.add('out');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 260);
    }, ms || 3200);
  }
  function notify(em, t, s) {
    state.notifs.unshift({ em: em, t: t, s: s, unread: true });
    state.notifs = state.notifs.slice(0, 30);
    save('notifs');
    w.dispatchEvent(new CustomEvent('7m:notif'));
  }

  /* =====================================================================
     HANDWRITING
     Reveals each line of the preloader quote by growing its clip rect, so
     the words appear to be written rather than simply being there.

     Deliberately JavaScript. CSS keyframes on a clipPath child are the
     shaky case, SMIL did not animate in the real browser, and neither could
     be checked from a headless pane that never composites. `seek` is a pure
     function of elapsed seconds, so the whole animation can be stepped and
     asserted without a single frame being painted.

     The rects carry their finished width in the width attribute, so a
     browser that never runs this shows the quote immediately. Failing
     towards "visible" matters: an earlier version of this preloader clipped
     its text to nothing and hid it permanently.
     ===================================================================== */
  function writeQuote(root, opts) {
    opts = opts || {};
    var rects = Array.prototype.slice.call((root || d).querySelectorAll('.wr'));

    var lines = rects.map(function (r) {
      return {
        el: r,
        x: parseFloat(r.getAttribute('x')) || 0,
        y: parseFloat(r.getAttribute('data-y')) || 0,   /* the writing baseline */
        full: parseFloat(r.getAttribute('data-w')) || parseFloat(r.getAttribute('width')) || 0,
        begin: parseFloat(r.getAttribute('data-b')) || 0,
        dur: parseFloat(r.getAttribute('data-d')) || 0.5
      };
    });
    var total = lines.reduce(function (m, l) { return Math.max(m, l.begin + l.dur); }, 0);
    var pen = (root || d).querySelector('.pre-pen');

    /* A hand does not move at a constant rate: it accelerates into a word and
       eases off at the end of it. This is what keeps the stroke from reading
       as a machine sweeping a bar across the page. */
    function ease(p) { return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; }

    /** Put the quote at `t` seconds. Pure: the same t always gives the same result. */
    function seek(t) {
      var done = 0, active = null;
      lines.forEach(function (l) {
        var raw = (t - l.begin) / l.dur;
        raw = raw < 0 ? 0 : raw > 1 ? 1 : raw;
        var e = ease(raw);
        l.el.setAttribute('width', (l.full * e).toFixed(2));
        if (raw >= 1) done++;
        /* the line being written right now owns the pen */
        if (t >= l.begin && raw < 1 && active === null) active = { l: l, e: e };
      });

      if (pen) {
        /* The nib is drawn with its tip at the origin, so placing the pen is
           just "put the tip where the ink currently ends". Derived from the
           writing state rather than a separate keyframe table, which is why
           it stays glued to the text and cannot drift off the paper — the
           previous version translated the pen to y=-38, above the viewBox. */
        var cur = active || (t < lines[0].begin
          ? { l: lines[0], e: 0 }
          : { l: lines[lines.length - 1], e: 1 });
        var tipX = cur.l.x + cur.l.full * cur.e;
        var tipY = cur.l.y;
        /* a touch of lift and wobble so the hand does not look mechanical */
        var wobble = Math.sin(t * 22) * 0.35;
        var tilt = 30 + Math.sin(t * 7) * 2.5;
        var vis = (t >= lines[0].begin - 0.15 && t <= total + 0.35) ? 1 : 0;
        pen.setAttribute('transform',
          'translate(' + tipX.toFixed(2) + ',' + (tipY + wobble).toFixed(2) + ') rotate(' +
          tilt.toFixed(2) + ')');
        pen.setAttribute('opacity', vis);
      }
      return done === lines.length;
    }

    /* The logo is drawn on the same clock: strokes inked in, then the star
       popped in. Same seek-able shape, so it is just as assertable. */
    var strokes = Array.prototype.slice.call((root || d).querySelectorAll('.dr'))
      .map(function (p) {
        p.style.strokeDasharray = '1';
        return { el: p, begin: parseFloat(p.getAttribute('data-b')) || 0,
                 dur: parseFloat(p.getAttribute('data-d')) || 0.6 };
      });
    var pops = Array.prototype.slice.call((root || d).querySelectorAll('.ink-pop'))
      .map(function (p) {
        return { el: p, begin: parseFloat(p.getAttribute('data-b')) || 0,
                 dur: parseFloat(p.getAttribute('data-d')) || 0.3,
                 cx: parseFloat(p.getAttribute('data-cx')) || 0,
                 cy: parseFloat(p.getAttribute('data-cy')) || 0 };
      });
    strokes.concat(pops).forEach(function (s) {
      total = Math.max(total, s.begin + s.dur);
    });

    function seekMark(t) {
      strokes.forEach(function (s) {
        var p = (t - s.begin) / s.dur;
        p = p < 0 ? 0 : p > 1 ? 1 : p;
        s.el.style.strokeDashoffset = String(1 - ease(p));
      });
      pops.forEach(function (s) {
        var p = (t - s.begin) / s.dur;
        p = p < 0 ? 0 : p > 1 ? 1 : p;
        /* a small overshoot so the star lands rather than fades */
        var e = p >= 1 ? 1 : 1 - Math.pow(1 - p, 3);
        var sc = e * (1 + 0.18 * Math.sin(Math.PI * e));
        s.el.setAttribute('opacity', e.toFixed(3));
        /* scale and spin about the star's own centre, in SVG's own
           coordinate system — no CSS transform-box involved */
        s.el.setAttribute('transform',
          'translate(' + s.cx + ',' + s.cy + ') rotate(' + ((1 - e) * -35).toFixed(1) +
          ') scale(' + sc.toFixed(3) + ') translate(' + (-s.cx) + ',' + (-s.cy) + ')');
      });
    }

    var api = { seek: seek, total: total, lines: lines.length,
                strokes: strokes.length, pops: pops.length,
                seekMark: seekMark,
                finish: function () { seek(total); seekMark(total); } };
    if (!lines.length && !strokes.length && !pops.length) return null;

    /** Advance everything on one clock. Returns true once all of it is done. */
    function step(t) { var doneInk = seek(t); seekMark(t); return doneInk && t >= total; }
    api.step = step;

    if (opts.manual) { step(0); return api; }        /* tests drive it themselves */

    var reduce = false;
    try { reduce = matchMedia('(prefers-reduced-motion:reduce)').matches; } catch (e) {}
    if (reduce || opts.instant) { api.finish(); return api; }

    /* A repeat visit runs the same animation FASTER rather than skipping it.
       Skipping meant a student who refreshed saw the preloader flash and
       vanish, which reads as broken rather than as considerate. */
    var speed = opts.speed > 0 ? opts.speed : 1;
    api.speed = speed;
    api.runtime = total / speed;

    step(0);
    var t0 = null;
    function frame(now) {
      if (t0 === null) t0 = now;
      if (step((now - t0) / 1000 * speed)) return;
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    /* rAF is suspended in a background tab, so guarantee nothing is left
       half-drawn. This has to fire BEFORE the preloader is dismissed —
       the old net was set at total+1.5s while the preloader was removed at
       runtime+0.7s, so on a repeat visit it fired a full two seconds after
       there was anything left to fix. */
    setTimeout(api.finish, (api.runtime + 0.25) * 1000);
    return api;
  }

  /* ============================ the mark ============================
     One inline SVG so the logo stays crisp at every size and needs no
     network request. Used by the preloader, the top bar and the footer. */
  function mark(px, draw) {
    /* pathLength="1" normalises every stroke, so the draw-on can use a
       dash offset of 1 -> 0 without measuring anything at runtime */
    var d1 = draw ? ' class="dr" pathLength="1" data-b="0"    data-d="0.75"' : '';
    var d2 = draw ? ' class="dr" pathLength="1" data-b="0.95" data-d="0.65"' : '';
    var d3 = draw ? ' class="dr" pathLength="1" data-b="1.55" data-d="0.55"' : '';
    /* The class is `ink-pop`, NOT `pop`: `.pop` is already the dropdown
       panel in ui.css and carries display:none until it is opened, so the
       star inherited it and was never painted — its bounding box measured
       0x0 while the identical path rendered 22.8x21.7 on its own. That is
       why the logo showed a ring, a seven and a tick but no star.
       data-cx/cy is the star's centre, which the pop scales about using an
       SVG transform attribute rather than CSS transform-origin. */
    var d4 = draw ? ' class="ink-pop" data-b="0.72" data-d="0.35" data-cx="78" data-cy="20"' : '';
    return '<svg viewBox="0 0 100 100" width="' + px + '" height="' + px + '" role="img" ' +
      'aria-label="7Marks"><title>7Marks</title>' +
      /* the ring, broken where the star sits */
      '<path' + d1 + ' d="M66.7 15.9 A38 38 0 1 0 83.6 32.2" fill="none" stroke="#16295c" ' +
        'stroke-width="6.4" stroke-linecap="round"/>' +
      /* the achievement star — pops in after the ring closes */
      '<path' + d4 + ' d="M78 9 L80.9 17 L89.4 17.3 L82.8 22.6 L85.1 30.7 L78 26 L71 30.7 ' +
        'L73.2 22.6 L66.6 17.3 L75.1 17 Z" fill="#16295c"/>' +
      /* the seven */
      '<path' + d2 + ' d="M32 31 H63 L47 76" fill="none" stroke="#16295c" stroke-width="9.2" ' +
        'stroke-linecap="round" stroke-linejoin="round"/>' +
      /* the red check, crossing the seven exactly as the logo does */
      '<path' + d3 + ' d="M33 55 L47 74 L79 41" fill="none" stroke="#e6202a" stroke-width="9" ' +
        'stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>';
  }

  /* =====================================================================
     AI SERVICE BOUNDARY
     Every model call in the product goes through ai.ask(). It posts to
     api.php, which holds the provider keys server-side — nothing secret is
     ever shipped to the browser. When the backend is unreachable (local
     preview, or before keys are configured) it falls back to a clearly
     labelled demo response so the UI can still be exercised end to end.
     Replacing the demo path with production output is a server change only.
     ===================================================================== */
  var ai = {
    endpoint: 'api.php',
    live: null,           /* null = not yet probed, true/false after the first call */

    /**
     * @param {string} prompt   what to ask
     * @param {object} opts     {system, json, signal}
     * @returns {Promise<{text:string, demo:boolean}>}
     */
    ask: function (prompt, opts) {
      opts = opts || {};
      var parts = [{ text: prompt }];
      /* photographs of a question paper or a handwritten answer ride along
         as inline data, so the model reads them rather than guessing */
      (opts.images || []).forEach(function (im) {
        parts.push({ inlineData: { mimeType: im.mime, data: im.b64 } });
      });
      var body = {
        contents: [{ role: 'user', parts: parts }],
        generationConfig: {
          temperature: opts.temp == null ? 0.6 : opts.temp,
          maxOutputTokens: opts.maxTokens || 8192
        }
      };
      if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] };

      return fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: opts.signal
      }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (j) {
        var txt = (j && j.candidates && j.candidates[0] && j.candidates[0].content &&
                   j.candidates[0].content.parts && j.candidates[0].content.parts[0] &&
                   j.candidates[0].content.parts[0].text) ||
                  (j && j.choices && j.choices[0] && j.choices[0].message &&
                   j.choices[0].message.content) || '';
        if (!txt) throw new Error('empty');
        ai.live = true;
        return { text: txt, demo: false };
      }).catch(function () {
        ai.live = false;
        return { text: '', demo: true };
      });
    },

    /** Read a File into the {mime, b64} shape `ask` expects. */
    toInline: function (file) {
      return new Promise(function (res, rej) {
        var fr = new FileReader();
        fr.onload = function () {
          var s = String(fr.result);
          res({ mime: file.type || 'image/jpeg', b64: s.slice(s.indexOf(',') + 1), name: file.name });
        };
        fr.onerror = rej;
        fr.readAsDataURL(file);
      });
    },

    /** Credits / signed-in state, straight from the shared account hub. */
    me: function () {
      return fetch(this.endpoint + '?action=me', { credentials: 'include' })
        .then(function (r) { return r.json(); })
        .catch(function () { return null; });
    }
  };

  /* =====================================================================
     EXAM ENGINE
     The countdown is derived from wall-clock timestamps held in storage,
     never from a tick counter. That is what makes a refresh recover the
     correct remaining time, and it means pausing the tab cannot buy the
     student extra minutes. Answers autosave on every change.
     ===================================================================== */
  var WARN_AT = [600, 300, 60, 10];   /* seconds remaining -> warn once each */

  var exam = {
    s: null,          /* the live attempt */
    _iv: null,

    /** Restore an attempt left behind by a refresh or a crash. */
    restore: function () {
      var s = store.get('exam', null);
      if (!s || s.submitted) return null;
      this.s = s;
      this._run();
      return s;
    },

    start: function (cfg) {
      var now = Date.now();
      this.s = {
        id: 'e' + now,
        title: cfg.title || 'Practice Test',
        subject: cfg.subject || '',
        questions: cfg.questions || [],
        answers: {},
        marked: {},
        startedAt: now,
        endsAt: now + (cfg.minutes || 30) * 60000,
        minutes: cfg.minutes || 30,
        autoSubmit: cfg.autoSubmit !== false,
        sound: cfg.sound !== false,
        warned: [],
        locked: false,
        submitted: false
      };
      this._save();
      this._run();
      notify('⏱️', 'Test started', this.s.title + ' — ' + this.s.minutes + ' minutes');
      return this.s;
    },

    /** Seconds left, floored at zero. Always computed from the clock. */
    left: function () {
      if (!this.s) return 0;
      return Math.max(0, Math.ceil((this.s.endsAt - Date.now()) / 1000));
    },

    answer: function (qid, val) {
      if (!this.s || this.s.locked) return false;   /* the lock is enforced here, not in the UI */
      this.s.answers[qid] = val;
      this._save();
      w.dispatchEvent(new CustomEvent('7m:saved', { detail: { qid: qid } }));
      return true;
    },

    mark: function (qid) {
      if (!this.s || this.s.locked) return;
      this.s.marked[qid] = !this.s.marked[qid];
      this._save();
    },

    /**
     * Move a question one place up (-1) or down (+1).
     * The whole question object is moved, so its text, options, answer,
     * marks, type, topic and difficulty travel with it. The student's
     * answers and review flags are keyed by question id, not position, so
     * reordering cannot detach an answer from its question.
     * @returns {number} the question's new index, or -1 if it could not move
     */
    move: function (index, dir) {
      var s = this.s;
      if (!s || s.locked || s.submitted) return -1;
      var to = index + dir;
      if (index < 0 || index >= s.questions.length || to < 0 || to >= s.questions.length) return -1;
      var q = s.questions.splice(index, 1)[0];
      s.questions.splice(to, 0, q);
      s.questions.forEach(function (x, i) { x.n = i + 1; });   /* renumber the paper */
      this._save();
      return to;
    },

    counts: function () {
      var s = this.s; if (!s) return { a: 0, u: 0, m: 0 };
      var total = s.questions.length;
      var a = Object.keys(s.answers).filter(function (k) {
        var v = s.answers[k];
        return v !== '' && v != null && !(Array.isArray(v) && !v.length);
      }).length;
      var m = Object.keys(s.marked).filter(function (k) { return s.marked[k]; }).length;
      return { a: a, u: total - a, m: m, total: total };
    },

    lock: function () {
      if (!this.s || this.s.locked) return;
      this.s.locked = true;
      this._save();
      if (this.s.sound) beep();
      notify('🚨', "Time's up", this.s.title + ' — the paper is locked.');
      w.dispatchEvent(new CustomEvent('7m:timeup'));
      if (this.s.autoSubmit) setTimeout(function () { exam.submit(true); }, 1200);
    },

    submit: function (auto) {
      var s = this.s; if (!s || s.submitted) return null;
      s.submitted = true;
      s.submittedAt = Date.now();
      this._stop();

      /* grade the objective types; anything free-text is queued for the AI marker */
      var got = 0, max = 0, right = 0, wrong = 0, skipped = 0, needsAI = 0;
      s.questions.forEach(function (q) {
        max += q.marks || 1;
        var a = s.answers[q.id];
        var empty = a === '' || a == null || (Array.isArray(a) && !a.length);
        if (empty) { skipped++; return; }
        if (q.answer == null) { needsAI++; return; }
        var ok = Array.isArray(q.answer)
          ? (Array.isArray(a) && a.length === q.answer.length &&
             q.answer.every(function (x) { return a.indexOf(x) > -1; }))
          : String(a).trim().toLowerCase() === String(q.answer).trim().toLowerCase();
        if (ok) { right++; got += q.marks || 1; } else { wrong++; }
      });

      var attempted = right + wrong;
      var res = {
        id: s.id, title: s.title, subject: s.subject,
        got: got, max: max,
        pct: max ? Math.round(got / max * 100) : 0,
        right: right, wrong: wrong, skipped: skipped, needsAI: needsAI,
        accuracy: attempted ? Math.round(right / attempted * 100) : 0,
        seconds: Math.round((s.submittedAt - s.startedAt) / 1000),
        auto: !!auto, at: s.submittedAt
      };
      res.perQ = res.right + res.wrong ? Math.round(res.seconds / (res.right + res.wrong)) : 0;

      state.history.unshift(res);
      state.history = state.history.slice(0, 60);
      save('history');
      store.del('exam');            /* the attempt is finished; only the result is kept */
      addXP(10 + right * 2, 'test completed');
      notify('✅', 'Test submitted', res.title + ' — ' + res.got + '/' + res.max);
      w.dispatchEvent(new CustomEvent('7m:result', { detail: res }));
      this.s = null;
      return res;
    },

    abandon: function () {
      this._stop();
      this.s = null;
      store.del('exam');
    },

    _save: function () { store.set('exam', this.s); },
    _stop: function () {
      clearInterval(this._iv); this._iv = null;
      d.removeEventListener('visibilitychange', this._vis);
    },

    /* The clock is driven by setInterval, deliberately NOT by
       requestAnimationFrame: rAF is suspended in a background tab, so a
       student who switched tabs would sail past the deadline and keep
       answering until they came back. setInterval keeps firing (throttled
       to about a second in the background, which is our granularity
       anyway), and visibilitychange forces an immediate re-evaluation the
       moment the tab is looked at again. */
    _run: function () {
      var self = this;
      this._stop();

      function tick() {
        if (!self.s || self.s.submitted) { self._stop(); return; }
        var left = self.left();
        w.dispatchEvent(new CustomEvent('7m:tick', { detail: { left: left } }));

        WARN_AT.forEach(function (at) {
          /* fire once each, and only for marks not already passed while hidden */
          if (left <= at && self.s.warned.indexOf(at) < 0) {
            self.s.warned.push(at);
            self._save();
            if (left <= 0) return;               /* expiry speaks for itself */
            var label = at >= 60 ? (at / 60) + ' minute' + (at > 60 ? 's' : '') : at + ' seconds';
            toast('⏰ ' + label + ' remaining', at <= 60 ? 'err' : 'warn', 4200);
            if (self.s.sound) beep(at <= 60 ? 2 : 1);
          }
        });

        if (left <= 0 && !self.s.locked) { self.lock(); }
      }

      this._vis = function () { if (!d.hidden) tick(); };
      d.addEventListener('visibilitychange', this._vis);
      this._iv = setInterval(tick, 250);
      tick();
    }
  };

  /* a short tone, generated rather than downloaded; silent if the student
     disabled sound or the browser blocks audio before a gesture */
  function beep(times) {
    try {
      var Ctx = w.AudioContext || w.webkitAudioContext; if (!Ctx) return;
      var c = new Ctx(), n = times || 1;
      for (var i = 0; i < n; i++) {
        var o = c.createOscillator(), g = c.createGain(), t = c.currentTime + i * 0.22;
        o.frequency.value = 880; o.type = 'sine';
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + 0.2);
      }
    } catch (e) {}
  }

  function fmt(sec) {
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    return { h: pad(h), m: pad(m), s: pad(s) };
  }

  /* ============================ router ============================
     Hash routing, so every view is a real URL a student can bookmark,
     share or reach with the back button. */
  var routes = {};
  var router = {
    on: function (name, fn) { routes[name] = fn; },
    go: function (name, params) {
      var q = params ? '?' + Object.keys(params).map(function (k) {
        return k + '=' + encodeURIComponent(params[k]);
      }).join('&') : '';
      location.hash = '#/' + name + q;
    },
    parse: function () {
      var h = (location.hash || '#/home').replace(/^#\/?/, '');
      var i = h.indexOf('?'), name = (i < 0 ? h : h.slice(0, i)) || 'home', params = {};
      if (i >= 0) h.slice(i + 1).split('&').forEach(function (p) {
        var kv = p.split('=');
        if (kv[0]) params[kv[0]] = decodeURIComponent(kv[1] || '');
      });
      return { name: name, params: params };
    },
    start: function () {
      var run = function () {
        var r = router.parse();
        state.view = r.name;
        (routes[r.name] || routes['404'] || routes.home)(r.params);
        w.dispatchEvent(new CustomEvent('7m:route', { detail: r }));
        w.scrollTo({ top: 0, behavior: 'instant' in w ? 'instant' : 'auto' });
      };
      w.addEventListener('hashchange', run);
      run();
    }
  };

  /* ============================ search ============================ */
  function search(q) {
    q = String(q || '').trim().toLowerCase();
    if (q.length < 1) return [];
    var terms = q.split(/\s+/);
    return w.CATALOG.index.map(function (it) {
      var hay = it.t.toLowerCase(), score = 0;
      for (var i = 0; i < terms.length; i++) {
        var p = hay.indexOf(terms[i]);
        if (p < 0) return null;                       /* every term must appear */
        score += (p === 0 ? 12 : 6) - Math.min(5, p / 6);
      }
      if (hay === q) score += 30;
      return { it: it, score: score };
    }).filter(Boolean)
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, 14)
      .map(function (x) { return x.it; });
  }

  /* mark the matched run so the student can see why a row came back */
  function hl(text, q) {
    var t = esc(text);
    String(q || '').trim().split(/\s+/).filter(Boolean).forEach(function (term) {
      t = t.replace(new RegExp('(' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig'),
                    '<em>$1</em>');
    });
    return t;
  }

  w.M7 = {
    $: $, $$: $$, qs: $, qsa: $$, el: el, esc: esc, pad: pad, clamp: clamp, fmt: fmt,
    store: store, state: state, save: save, addXP: addXP,
    toast: toast, notify: notify, mark: mark, writeQuote: writeQuote,
    ai: ai, exam: exam, router: router, search: search, hl: hl, beep: beep
  };
})(window, document);
