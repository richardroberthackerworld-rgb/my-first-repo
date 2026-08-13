/* =====================================================================
   7MARKS — shell chrome and views.
   Each view is a function that returns markup for #page plus an optional
   mount() for its behaviour, so views stay independent of one another.
   ===================================================================== */
(function (w, d) {
  'use strict';
  var M = w.M7, C = w.CATALOG;
  var $ = M.qs, $$ = M.qsa, esc = M.esc, el = M.el;

  /* ============================ chrome ============================ */
  var NAV = [
    ['MAIN', null],
    ['home',        '🏠', 'Home'],
    ['assistant',   '✨', 'AI Question Assistant', 'new'],
    ['correct',     '🧑‍🏫', 'AI Correct & Score', 'ai'],
    ['study',       '📚', 'Study Mode'],
    ['quick5',      '⚡', 'Quick 5'],
    ['mytests',     '📝', 'My Tests'],
    ['mistakes',    '❌', 'Mistake Bank'],
    ['practice',    '📘', 'My Practice'],
    ['papers',      '📚', 'Question Papers'],
    ['bookmarks',   '🔖', 'Bookmarks'],
    ['planner',     '📅', 'Study Planner'],
    ['notes',       '📒', 'Notes & Flashcards'],
    ['performance', '📈', 'Performance'],
    ['analytics',   '📊', 'Analytics'],
    ['leaderboard', '🏅', 'Leaderboard'],
    ['challenges',  '🧩', 'Challenges', 'hot'],
    /* Doubt Solver is 7Solve's job, so it hands straight over to it rather
       than duplicating a snap-a-doubt tool here. The two products stay
       separate everywhere else — this is the one deliberate link out. */
    ['doubt',       '💡', 'Doubt Solver', null, 'https://7solve.7by.in/'],
    ['EXPLORE', null]
  ];

  function renderRail() {
    var h = '';
    NAV.forEach(function (n) {
      if (n[1] === null) { h += '<div class="rail-h">' + esc(n[0]) + '</div>'; return; }
      var ext = n[4];
      h += '<li><a class="nav-i" data-view="' + n[0] + '" href="' +
           (ext || ('#/' + n[0])) + '"' +
           (ext ? ' target="_blank" rel="noopener"' : '') + '>' +
           '<span class="em">' + n[1] + '</span>' + esc(n[2]) +
           (n[3] ? '<span class="tag ' + n[3] + '">' + n[3] + '</span>' : '') +
           (ext ? '<span class="ext" aria-label="opens 7Solve">↗</span>' : '') + '</a></li>';
    });
    C.cats.forEach(function (c) {
      h += '<li><a class="nav-i" data-cat="' + c.id + '" href="#/explore?cat=' + c.id + '">' +
           '<span class="em">' + c.em + '</span>' + esc(c.name) + '</a></li>';
    });
    h += '<div class="prem-card"><b>💎 Go Premium</b><ul>' +
      ['Unlimited practice', 'AI correction & scores', 'Advanced analytics', 'Ad-free',
       'Priority support'].map(function (x) {
        return '<li>✓ ' + esc(x) + '</li>';
      }).join('') +
      '</ul><a class="go" href="#/premium">Upgrade Now ⚡</a></div>';

    var mins = M.store.get('todayMins', 0);
    h += '<div class="goal"><b>🎯 Daily Goal</b><div class="bar"><i style="width:' +
         M.clamp(mins / 30 * 100, 4, 100) + '%"></i></div>' +
         '<small>' + mins + ' / 30 min · keep it up!</small></div>' +
         '<p class="rail-quip">Practice today,<br>ace tomorrow!</p>';
    $('#rail').innerHTML = h;
  }

  /**
   * The one button in the top bar, and what it says depends on where the
   * student actually is.
   *
   * A signed-out student was being shown "Premium", which asks them to buy
   * before they can even sign in. A Spark subscriber was shown the same
   * word as a free user, which reads as though their payment did nothing.
   * Each state now gets the action that is genuinely next for it, and
   * Infinity — the top plan — is not sold anything at all.
   */
  function planCta() {
    if (!M.hub.signedIn()) {
      return '<button class="btn-auth" id="signIn">🔑 <span>Sign in</span></button>';
    }
    var s = M.credits.chip();
    var key = s && s.plan ? s.plan.key : 'free';
    var map = {
      free:     ['btn-prem', '👑', 'Get Premium'],
      spark:    ['btn-prem', '⬆️', 'Upgrade to Pro'],
      pro:      ['btn-inf',  '✨', 'Go Infinity'],
      infinity: ['btn-inf',  '💎', 'Infinity']
    };
    var c = map[key] || map.free;
    return '<a class="' + c[0] + '" href="#/pricing">' + c[1] +
           ' <span>' + c[2] + '</span></a>';
  }

  function renderTop() {
    $('#top').innerHTML =
      '<button class="burger" id="burger" aria-label="Open menu" aria-expanded="false">☰</button>' +
      '<a class="brand" href="#/home">' + M.mark(36) +
        '<span class="brand-txt"><b><i>7</i>Marks</b><small>Practice Smart</small></span></a>' +
      '<div class="search" id="search">' +
        '<span class="search-ic">🔍</span>' +
        '<input class="search-in" id="q" type="search" autocomplete="off" role="combobox" ' +
          'aria-expanded="false" aria-controls="results" ' +
          'placeholder="Search for subjects, topics, exams...">' +
        '<button class="search-clr" id="qclr" aria-label="Clear search">✕</button>' +
        '<div class="results" id="results" role="listbox"></div>' +
      '</div>' +
      '<div class="nav-r">' +
        '<button class="cred-chip" id="credChip" hidden title="Credit history">' +
          '<span class="cc-bolt">⚡</span><span class="cc-n">0</span>' +
          '<span class="cc-plan">FREE</span></button>' +
        planCta() +
        '<div style="position:relative">' +
          '<button class="ico-btn" id="bell" aria-label="Notifications">🔔<i class="dot" id="dot"></i></button>' +
          '<div class="pop" id="notifPop"></div></div>' +
        '<div style="position:relative">' +
          '<button class="who" id="who"><span class="av" id="av">S</span>' +
            '<span><b id="uname">Hello, Student!</b><small>Keep learning!</small></span></button>' +
          '<div class="pop" id="whoPop"></div></div>' +
      '</div>';
  }

  /* =====================================================================
     THE TWO REFUSALS
     A student who cannot run AI is told which of the two reasons applies and
     what it would cost to fix, rather than being shown a generic error.
     ===================================================================== */
  function gateModal(kind, st) {
    var m = d.getElementById('modal');
    var cost = (st && st.ai_cost) || 10;
    if (kind === 'plan') {
      m.innerHTML = '<div class="modal-c gate"><span class="gate-em">✨</span>' +
        '<h3>Unlock AI with 7Marks Pro</h3>' +
        '<p>Your current plan' +
        (st && st.plan ? ' (<b>' + esc(st.plan.name) + '</b>)' : '') +
        ' does not include AI tools.</p>' +
        '<div class="gate-plan"><div><b>7Marks Pro</b><small>1,000 credits a month · ' +
        'AI assistant, correction, question generation</small></div>' +
        '<span class="gate-price">₹99<i>/mo</i></span></div>' +
        '<div class="m-btns"><button class="btn btn-o" id="gtClose">Not now</button>' +
        '<a class="btn btn-v" href="#/pricing" id="gtGo">Upgrade to Pro</a></div>' +
        '<a class="gate-all" href="#/pricing" id="gtAll">View all plans</a></div>';
    } else {
      var have = (st && st.credits) || 0;
      m.innerHTML = '<div class="modal-c gate"><span class="gate-em">⚡</span>' +
        '<h3>You\'re out of AI credits</h3>' +
        '<p>You need <b>' + cost + ' credits</b> to generate this.</p>' +
        '<div class="gate-bal"><small>Current balance</small><b>' + have + ' credits</b></div>' +
        '<div class="m-btns"><button class="btn btn-o" id="gtClose">Close</button>' +
        '<a class="btn btn-v" href="#/pricing">Upgrade plan</a></div></div>';
    }
    m.classList.add('open');
    var close = function () { m.classList.remove('open'); };
    $('#gtClose').onclick = close;
    $$('.gate a[href="#/pricing"]').forEach(function (a) { a.onclick = close; });
  }

  /* The credit chip in the top bar. Counts up or down to a new balance
     rather than snapping, so a deduction is visible rather than silent. */
  function paintCredits() {
    var chip = $('#credChip');
    if (!chip) return;
    var s = M.credits.chip();
    if (!s) { chip.hidden = true; return; }
    chip.hidden = false;
    chip.querySelector('.cc-plan').textContent = s.plan.badge;
    chip.className = 'cred-chip plan-' + s.plan.key;
    var el = chip.querySelector('.cc-n');
    var from = parseInt(el.textContent.replace(/[^\d]/g, ''), 10);
    var to = s.credits;
    if (isNaN(from) || from === to) { el.textContent = to.toLocaleString(); return; }
    var t0 = null, dur = 520;
    (function tick(now) {
      if (t0 === null) t0 = now;
      var p = Math.min(1, (now - t0) / dur);
      var e = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(from + (to - from) * e).toLocaleString();
      if (p < 1) requestAnimationFrame(tick);
    })();
  }

  function paintNotifs() {
    var unread = M.state.notifs.filter(function (n) { return n.unread; }).length;
    $('#dot').style.display = unread ? 'block' : 'none';
    $('#notifPop').innerHTML =
      '<div class="pop-h"><b>Notifications</b>' +
      (unread ? '<button id="readAll">Mark all read</button>' : '') + '</div>' +
      (M.state.notifs.length ? M.state.notifs.slice(0, 9).map(function (n) {
        return '<button class="nt' + (n.unread ? ' unread' : '') + '">' +
          '<span class="em">' + n.em + '</span><div><b>' + esc(n.t) + '</b>' +
          '<small>' + esc(n.s) + '</small></div></button>';
      }).join('') : '<div class="empty"><span class="em">🔔</span><b>All caught up</b></div>');
    var r = $('#readAll');
    if (r) r.onclick = function () {
      M.state.notifs.forEach(function (n) { n.unread = false; });
      M.save('notifs'); paintNotifs();
    };
  }

  function mountChrome() {
    renderTop(); renderRail(); paintNotifs();

    var rail = $('#rail'), scrim = $('#scrim');
    function closeRail() {
      rail.classList.remove('open'); scrim.classList.remove('on');
      $('#burger').setAttribute('aria-expanded', 'false');
    }
    $('#burger').onclick = function () {
      var open = rail.classList.toggle('open');
      scrim.classList.toggle('on', open);
      this.setAttribute('aria-expanded', String(open));
    };
    scrim.onclick = closeRail;
    rail.addEventListener('click', function (e) {
      if (e.target.closest('a') && innerWidth <= 900) closeRail();
    });

    /* the two dropdowns are mutually exclusive and close on outside click */
    function pop(btn, panel) {
      $(btn).onclick = function (e) {
        e.stopPropagation();
        var open = $(panel).classList.contains('open');
        $$('.pop').forEach(function (p) { p.classList.remove('open'); });
        if (!open) $(panel).classList.add('open');
      };
    }
    pop('#bell', '#notifPop'); pop('#who', '#whoPop');
    /* Sign in is the first thing in this menu when signed out. Without it a
       student has no way to reach their account at all — the rebuilt app
       shipped with no sign-in affordance anywhere, so credits and plans
       could never load however correct the backend was. */
    var signedIn = M.hub.signedIn();
    $('#whoPop').innerHTML =
      '<div class="pop-h"><b>' + esc(M.state.user.name) + '</b>' +
      '<span style="font-size:11px;color:var(--ink-3)">' +
      (signedIn ? 'Signed in' : 'Not signed in') + '</span></div>' +
      (signedIn
        ? ''
        : '<button class="pop-i" id="popSignIn" ' +
          'style="background:var(--violet-bg);color:var(--violet);font-weight:800">' +
          '<span>🔑</span>Sign in / Create account</button>') +
      [['#/profile', '👤', 'My Profile'], ['#/performance', '📈', 'My Performance'],
       ['#/bookmarks', '🔖', 'Bookmarks'], ['#/premium', '💎', 'Premium'],
       ['#/settings', '⚙️', 'Settings'], ['#/papers', '📄', 'Question Papers']]
        .map(function (i) {
          return '<a class="pop-i" href="' + i[0] + '"><span>' + i[1] + '</span>' + esc(i[2]) + '</a>';
        }).join('') +
      (signedIn
        ? '<button class="pop-i" id="signOut" style="color:var(--red-ink)">' +
          '<span>🚪</span>Sign out</button>'
        : '');
    if ($('#popSignIn')) {
      $('#popSignIn').onclick = function () { M.auth.open('signin'); };
    }
    if (signedIn && $('#signOut')) {
      $('#signOut').onclick = function () { M.hub.signOut(); };
    }
    d.addEventListener('click', function () {
      $$('.pop').forEach(function (p) { p.classList.remove('open'); });
      $('#results').classList.remove('open');
    });
    $('#notifPop').onclick = $('#whoPop').onclick = function (e) { e.stopPropagation(); };

    /* The top bar wraps on narrow screens — brand, then the chips, then the
       search on its own row — so its height is not a constant. It was being
       cleared with a hard-coded padding-top, which was right at 640px and
       far too small in an in-app browser where everything is a little
       larger: the hero heading ended up sliced in half under the header.
       Measure it instead and let --nav-h drive the layout, so it is correct
       at any width, any font size, and in any wrapper's WebView. */
    (function trackHeader() {
      var bar = $('#top');
      /* Writes --bar-h, NOT --nav-h. --nav-h is the bar's own height above
         640px, so measuring the bar and writing it back to --nav-h feeds
         into itself: the bar grew to 197px against a real 152px and left a
         gap under the sidebar. --bar-h is only ever read by the things that
         must clear the bar, so nothing can loop. */
      var apply = function () {
        /* the BOTTOM edge, not the height: with a border or any offset the
           two differ (measured 64 tall but ending at 72), and what every
           pane below has to clear is where the bar actually ends */
        var b = bar.getBoundingClientRect();
        var h = Math.ceil(b.bottom - Math.min(0, b.top));
        if (h > 0) d.documentElement.style.setProperty('--bar-h', h + 'px');
      };
      apply();
      if (w.ResizeObserver) new ResizeObserver(apply).observe(bar);
      else w.addEventListener('resize', apply);
      /* fonts landing late change the wrap point, so re-measure once they do */
      if (d.fonts && d.fonts.ready) d.fonts.ready.then(apply).catch(function () {});
      setTimeout(apply, 400);
      w.addEventListener('orientationchange', function () { setTimeout(apply, 250); });
    })();

    mountSearch();
    $('#credChip').onclick = function () { M.router.go('credits'); };
    if ($('#signIn')) $('#signIn').onclick = function () { M.auth.open('signin'); };
    /* the button's wording depends on the plan, so it is repainted when
       the plan arrives rather than being fixed at first render */
    var repaintCta = function () {
      var host = $('.btn-auth') || $('.btn-prem') || $('.btn-inf');
      if (!host) return;
      host.outerHTML = planCta();
      if ($('#signIn')) $('#signIn').onclick = function () { M.auth.open('signin'); };
    };
    w.addEventListener('7m:credits', repaintCta);
    w.addEventListener('7m:auth', repaintCta);
    M.credits.status().then(paintCredits);
    w.addEventListener('7m:credits', paintCredits);
    w.addEventListener('7m:notif', paintNotifs);
    w.addEventListener('7m:route', function (e) {
      var v = e.detail.name, cat = e.detail.params.cat;
      $$('.nav-i').forEach(function (a) {
        a.classList.toggle('on', a.dataset.view === v || (!!cat && a.dataset.cat === cat));
      });
    });
  }

  /* ---- search: real, over the whole catalogue, keyboard-drivable ---- */
  function mountSearch() {
    var box = $('#search'), inp = $('#q'), res = $('#results'), cur = -1, items = [];

    function paint(q) {
      items = M.search(q);
      box.classList.toggle('has', !!q);
      if (!q) { res.classList.remove('open'); inp.setAttribute('aria-expanded', 'false'); return; }
      if (!items.length) {
        res.innerHTML = '<div class="res-none">No match for “' + esc(q) + '”</div>';
      } else {
        var last = '', h = '';
        items.forEach(function (it, i) {
          if (it.kind !== last) { h += '<div class="res-h">' + esc(it.kind) + '</div>'; last = it.kind; }
          h += '<button class="res" data-i="' + i + '"><span>' + it.em + '</span>' +
               '<span>' + M.hl(it.label, q) + '</span>' +
               '<span class="k">' + esc(it.meta) + '</span></button>';
        });
        res.innerHTML = h;
      }
      cur = -1;
      res.classList.add('open');
      inp.setAttribute('aria-expanded', 'true');
    }

    function pick(i) {
      var it = items[i]; if (!it) return;
      res.classList.remove('open');
      inp.value = ''; box.classList.remove('has');
      var g = it.go;
      if (g.cat) { M.state.cat = g.cat; M.save('cat'); }
      if (g.course) { M.state.course = g.course; M.save('course'); }
      if (g.subject) { M.state.subject = g.subject; M.save('subject'); }
      M.router.go(g.view, g.cat ? { cat: g.cat } : null);
    }

    inp.oninput = function () { paint(this.value); };
    inp.onfocus = function () { if (this.value) paint(this.value); };
    inp.onkeydown = function (e) {
      if (e.key === 'Escape') { res.classList.remove('open'); this.blur(); return; }
      if (!items.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        cur = M.clamp(cur + (e.key === 'ArrowDown' ? 1 : -1), 0, items.length - 1);
        $$('.res', res).forEach(function (b) {
          b.classList.toggle('cur', +b.dataset.i === cur);
          if (+b.dataset.i === cur) b.scrollIntoView({ block: 'nearest' });
        });
      } else if (e.key === 'Enter') { e.preventDefault(); pick(cur < 0 ? 0 : cur); }
    };
    res.onclick = function (e) {
      var b = e.target.closest('.res'); if (b) pick(+b.dataset.i);
    };
    box.onclick = function (e) { e.stopPropagation(); };
    $('#qclr').onclick = function () { inp.value = ''; paint(''); inp.focus(); };

    /* "/" focuses search, the way every tool a student already uses does */
    d.addEventListener('keydown', function (e) {
      if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(d.activeElement.tagName)) {
        e.preventDefault(); inp.focus();
      }
    });
  }

  /* ============================ shared bits ============================ */
  function hue(k) { return 'background:var(--' + k + '-bg);color:var(--' + k + ')'; }

  function subjectChips(limit) {
    var subs = C.subsOf(M.state.cat, M.state.course, M.state.year);
    if (limit) subs = subs.slice(0, limit);
    if (!subs.length) return '<div class="empty"><span class="em">📚</span><b>Pick a course above</b></div>';
    var co = C.course(M.state.cat, M.state.course);
    var note = (co && co.years > 1)
      ? '<p style="font-size:11.5px;color:var(--ink-3);margin-bottom:10px">' +
        (M.state.year ? esc(C.yearLabels(M.state.cat, M.state.course)[M.state.year - 1]) +
          ' syllabus · ' + subs.length + ' subjects'
                      : 'All ' + co.years + ' years · ' + subs.length + ' subjects') + '</p>'
      : '';
    return note + '<div class="subs">' + subs.map(function (s) {
      return '<a class="sub" style="' + hue(s.hue) + '" href="#/practice?subject=' + s.id + '">' +
             s.em + ' ' + esc(s.name) + '</a>';
    }).join('') + '</div>';
  }

  function courseSelect() {
    var cat = C.byCat[M.state.cat];
    return '<select class="sel" id="courseSel" aria-label="Course">' + cat.courses.map(function (c) {
      return '<option value="' + c.id + '"' + (c.id === M.state.course ? ' selected' : '') + '>' +
             esc(c.name) + (c.years > 1 ? '  (' + c.years + ' yrs)' : '') + '</option>';
    }).join('') + '</select>';
  }

  /* The year picker only exists for courses that actually run more than one
     year, so a Class 8 student is never asked which year of Class 8 they
     are in, while a B.Tech student is asked, because their syllabus
     genuinely differs year to year. */
  function yearSelect() {
    var labels = C.yearLabels(M.state.cat, M.state.course);
    if (labels.length < 2) return '';
    return '<label style="font-size:12px;font-weight:700;color:var(--ink-3)">Year</label>' +
      '<select class="sel" id="yearSel" aria-label="Year of study">' +
      '<option value="0"' + (!M.state.year ? ' selected' : '') + '>All years</option>' +
      labels.map(function (l, i) {
        return '<option value="' + (i + 1) + '"' +
               (M.state.year === i + 1 ? ' selected' : '') + '>' + esc(l) + '</option>';
      }).join('') + '</select>';
  }

  /** Re-render the course row and the subject chips together — they always
      change as a set, and drifting apart is how stale lists appear. */
  function refreshCourseRow(rowId, subsId) {
    var row = $('#' + (rowId || 'courseRow'));
    if (row) {
      row.innerHTML = '<label style="font-size:12px;font-weight:700;color:var(--ink-3)">Course</label>' +
        courseSelect() + yearSelect();
      bindCourseRow(rowId, subsId);
    }
    var subs = $('#' + (subsId || 'subs'));
    if (subs) subs.innerHTML = subjectChips();
  }

  function bindCourseRow(rowId, subsId) {
    var cs = $('#courseSel');
    if (cs) cs.onchange = function () {
      M.state.course = this.value;
      M.state.year = 0;               /* a new course invalidates the old year */
      M.save('course'); M.save('year');
      refreshCourseRow(rowId, subsId);
      M.toast('Showing ' + C.course(M.state.cat, this.value).name);
    };
    var ys = $('#yearSel');
    if (ys) ys.onchange = function () {
      M.state.year = +this.value;
      M.save('year');
      var subs = $('#' + (subsId || 'subs'));
      if (subs) subs.innerHTML = subjectChips();
    };
  }

  /* Keep the chosen course and year valid whenever the category changes. */
  function setCat(id) {
    M.state.cat = id;
    var cat = C.byCat[id];
    if (!cat.courses.some(function (c) { return c.id === M.state.course; })) {
      M.state.course = cat.courses[0].id;
      M.state.year = 0;
    }
    if (M.state.year > C.yearsOf(id, M.state.course)) M.state.year = 0;
    M.save('cat'); M.save('course'); M.save('year');
  }

  function card(icon, hueName, title, body, more) {
    return '<section class="card"><div class="card-h">' +
      '<span class="em" style="' + hue(hueName) + '">' + icon + '</span><h3>' + esc(title) + '</h3>' +
      (more ? '<a class="more" href="' + more[1] + '">' + esc(more[0]) + ' →</a>' : '') +
      '</div><div class="card-b">' + body + '</div></section>';
  }

  /* a tiny line chart, drawn from real history when there is any */
  function lineChart(series) {
    var W = 560, H = 150, P = 26, n = series[0].pts.length;
    if (n < 2) return '<div class="empty"><span class="em">📈</span><b>Not enough data yet</b>' +
      '<small>Finish two tests and your trend appears here.</small></div>';
    var x = function (i) { return P + i * (W - P * 2) / (n - 1); };
    var y = function (v) { return H - P - (v / 100) * (H - P * 2); };
    var g = '';
    for (var v = 0; v <= 100; v += 50) {
      g += '<line class="gl" x1="' + P + '" y1="' + y(v) + '" x2="' + (W - P) + '" y2="' + y(v) + '"/>' +
           '<text class="lb" x="4" y="' + (y(v) + 3) + '">' + v + '%</text>';
    }
    series.forEach(function (s) {
      g += '<polyline class="ln" stroke="var(--' + s.hue + ')" points="' +
        s.pts.map(function (p, i) { return x(i) + ',' + y(p); }).join(' ') + '"/>';
      s.pts.forEach(function (p, i) {
        g += '<circle class="pt" cx="' + x(i) + '" cy="' + y(p) + '" r="3.2" fill="var(--' + s.hue + ')"/>';
      });
    });
    (series[0].labels || []).forEach(function (l, i) {
      g += '<text class="lb" x="' + x(i) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(l) + '</text>';
    });
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Score trend">' +
      g + '</svg><div class="legend">' + series.map(function (s) {
        return '<span><i style="background:var(--' + s.hue + ')"></i>' + esc(s.name) + '</span>';
      }).join('') + '</div>';
  }

  function scoreRing(pct) {
    var r = 32, c = 2 * Math.PI * r;
    return '<svg class="score-ring" viewBox="0 0 78 78"><circle cx="39" cy="39" r="' + r +
      '" fill="none" stroke="#d8ecdf" stroke-width="8"/>' +
      '<circle cx="39" cy="39" r="' + r + '" fill="none" stroke="var(--green)" stroke-width="8" ' +
      'stroke-linecap="round" stroke-dasharray="' + c + '" stroke-dashoffset="' +
      (c * (1 - pct / 100)) + '" transform="rotate(-90 39 39)"/>' +
      '<text x="39" y="44" text-anchor="middle" font-size="18" font-weight="800" ' +
      'fill="var(--navy)">' + Math.round(pct) + '%</text></svg>';
  }

  w.V = {
    mountChrome: mountChrome, renderRail: renderRail, paintNotifs: paintNotifs,
    gateModal: gateModal, paintCredits: paintCredits,
    hue: hue, card: card, subjectChips: subjectChips, courseSelect: courseSelect,
    yearSelect: yearSelect, refreshCourseRow: refreshCourseRow, bindCourseRow: bindCourseRow,
    setCat: setCat, lineChart: lineChart, scoreRing: scoreRing
  };
})(window, document);
