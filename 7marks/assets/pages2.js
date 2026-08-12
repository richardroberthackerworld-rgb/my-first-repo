/* =====================================================================
   7MARKS — the remaining study tabs.
   Planner, notes and flashcards, bookmarks, practice, analytics,
   leaderboard, challenges and the study assistant. Kept in its own file so
   the dashboard module stays readable; it registers routes on the same
   router and reuses the same cards, state and persistence.
   ===================================================================== */
(function (w, d) {
  'use strict';
  var M = w.M7, C = w.CATALOG, V = w.V, P = w.PAGES;
  var $ = M.qs, $$ = M.qsa, esc = M.esc;
  var page = function () { return d.getElementById('page'); };
  function set(html) { page().innerHTML = html; }
  var rail = function () { return P.rightRail(); };
  var foot = function () { return P.footer(); };

  /* ---------- shared state, persisted through M7.store ---------- */
  function S(key, dflt) {
    if (M.state[key] === undefined) M.state[key] = M.store.get(key, dflt);
    return M.state[key];
  }
  S('plan', []);        /* study sessions */
  S('cards', []);       /* flashcards */
  S('marks', []);       /* bookmarks */
  S('done', {});        /* completed challenges */
  S('chat', []);        /* assistant transcript */

  function uid() { return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function today() { return new Date().toISOString().slice(0, 10); }
  function dayName(iso) {
    return new Date(iso + 'T00:00').toLocaleDateString(undefined, { weekday: 'short' });
  }
  function subOpts(sel) {
    return Object.keys(C.subjects).map(function (k) {
      return '<option value="' + k + '"' + (k === sel ? ' selected' : '') + '>' +
        esc(C.subjects[k].name) + '</option>';
    }).join('');
  }
  function hue(k) { return V.hue(k); }

  /* =====================================================================
     STUDY PLANNER
     A plan is a list of sessions, each pinned to a date. The planner is
     built around finishing them rather than looking at them: every session
     can be started, ticked off, moved or dropped, and the reminder system
     reads the same list, so what you are told to revise is always what the
     plan actually says.
     ===================================================================== */
  var planTab = 'today';

  M.router.on('planner', function () {
    set('<div class="wrap"><div class="col">' +
      V.card('📅', 'teal', 'Study Planner',
        '<div class="tabs" id="plTabs">' +
        [['today', '☀️ Today'], ['week', '🗓️ This week'], ['smart', '✨ Smart plan'],
         ['stats', '🔥 Streak & goals']].map(function (t) {
          return '<button class="tab' + (planTab === t[0] ? ' on' : '') + '" data-t="' + t[0] +
            '">' + t[1] + '</button>';
        }).join('') + '</div>' +
        '<div id="plBody" style="margin-top:16px">' + planBody() + '</div>') +
      '</div>' + rail() + '</div>' + foot());
    $('#plTabs').onclick = function (e) {
      var b = e.target.closest('.tab'); if (!b) return;
      planTab = b.dataset.t;
      $$('.tab', this).forEach(function (t) { t.classList.toggle('on', t === b); });
      $('#plBody').innerHTML = planBody();
      wirePlan();
    };
    wirePlan();
  });

  function planBody() {
    if (planTab === 'today') return planToday();
    if (planTab === 'week') return planWeek();
    if (planTab === 'smart') return planSmart();
    return planStats();
  }

  function sessionsOn(iso) {
    return M.state.plan.filter(function (s) { return s.date === iso; })
      .sort(function (a, b) { return (b.priority || 0) - (a.priority || 0); });
  }

  function sessionCard(s) {
    var sub = C.subjects[s.sub] || { name: s.sub, em: '📘', hue: 'violet' };
    var pri = ['Low', 'Normal', 'High'][s.priority] || 'Normal';
    var priHue = ['ink-3', 'blue', 'red-ink'][s.priority] || 'blue';
    return '<div class="sess' + (s.done ? ' done' : '') + '" data-id="' + s.id + '">' +
      '<button class="tick" data-a="done" aria-label="Mark complete">' +
      (s.done ? '✓' : '') + '</button>' +
      '<span class="em" style="' + hue(sub.hue) + '">' + sub.em + '</span>' +
      '<div class="sess-n"><b>' + esc(sub.name) + '</b>' +
      '<small>' + esc(s.topic || 'General revision') + '</small>' +
      '<span class="sess-meta">⏱ ' + s.mins + ' min &nbsp;·&nbsp; ' +
      '<i style="color:var(--' + priHue + ')">' + pri + ' priority</i></span></div>' +
      '<div class="sess-do">' +
      (s.done ? '<span class="sess-ok">Done</span>'
              : '<button class="btn btn-v" data-a="start">Start</button>') +
      '<button class="mv" data-a="del" title="Remove" aria-label="Remove session">✕</button>' +
      '</div></div>';
  }

  function planToday() {
    var list = sessionsOn(today());
    var mins = list.reduce(function (a, s) { return a + (s.done ? s.mins : 0); }, 0);
    var total = list.reduce(function (a, s) { return a + s.mins; }, 0);
    return '<div class="plan-top">' +
      '<div><b>' + new Date().toLocaleDateString(undefined,
        { weekday: 'long', day: 'numeric', month: 'long' }) + '</b>' +
      '<small>' + (total ? mins + ' of ' + total + ' minutes done' : 'Nothing planned yet') +
      '</small></div>' +
      '<button class="btn btn-o" id="plAdd">＋ Add session</button></div>' +
      (total ? '<div class="prog-t" style="margin:12px 0 16px"><i style="width:' +
        (total ? mins / total * 100 : 0) + '%"></i></div>' : '') +
      (list.length ? list.map(sessionCard).join('')
        : '<div class="empty"><span class="em">📅</span><b>No sessions today</b>' +
          '<small>Add one, or let the Smart plan lay out your week from your exam date.</small>' +
          '</div>');
  }

  function planWeek() {
    var start = new Date();
    var days = [];
    for (var i = 0; i < 7; i++) {
      var dt = new Date(start.getTime() + i * 864e5);
      days.push(dt.toISOString().slice(0, 10));
    }
    return '<div class="week">' + days.map(function (iso) {
      var list = sessionsOn(iso);
      var mins = list.reduce(function (a, s) { return a + s.mins; }, 0);
      return '<div class="wday' + (iso === today() ? ' now' : '') + '">' +
        '<div class="wday-h"><b>' + dayName(iso) + '</b><small>' +
        new Date(iso + 'T00:00').getDate() + '</small></div>' +
        '<div class="wday-b">' + (list.length ? list.map(function (s) {
          var sub = C.subjects[s.sub] || { name: s.sub, em: '📘', hue: 'violet' };
          return '<div class="wchip' + (s.done ? ' done' : '') + '" style="' + hue(sub.hue) +
            '" title="' + esc(sub.name + ' — ' + (s.topic || '') + ' · ' + s.mins + ' min') + '">' +
            sub.em + ' ' + esc(sub.name.slice(0, 9)) + '</div>';
        }).join('') : '<span class="wnone">—</span>') + '</div>' +
        '<div class="wday-f">' + (mins ? mins + 'm' : '') + '</div>' +
        '<button class="wadd" data-date="' + iso + '" aria-label="Add on ' + dayName(iso) +
        '">＋</button></div>';
    }).join('') + '</div>';
  }

  function planSmart() {
    var subs = C.subsOf(M.state.cat, M.state.course, M.state.year);
    return '<p style="font-size:12.5px;color:var(--ink-2);margin-bottom:14px">' +
      'Tell it when the exam is and how long you can study. It splits the days between your ' +
      'subjects, gives the weak ones more time and the strong ones less, and puts the ' +
      'heaviest work earliest — leaving the last few days for revision.</p>' +
      '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px">' +
      '<div><label class="cfg-l">Exam date</label><input class="sel" id="spDate" type="date" ' +
      'style="width:100%" value="' + new Date(Date.now() + 21 * 864e5).toISOString().slice(0, 10) +
      '"></div>' +
      '<div><label class="cfg-l">Hours a day</label><select class="sel" id="spHrs" ' +
      'style="width:100%">' + [1, 1.5, 2, 3, 4, 5, 6].map(function (h) {
        return '<option' + (h === 2 ? ' selected' : '') + '>' + h + '</option>';
      }).join('') + '</select></div>' +
      '<div><label class="cfg-l">Session length</label><select class="sel" id="spLen" ' +
      'style="width:100%">' + [30, 45, 60, 90].map(function (m) {
        return '<option' + (m === 45 ? ' selected' : '') + '>' + m + '</option>';
      }).join('') + '</select></div></div>' +
      '<label class="cfg-l" style="margin-top:16px">Subjects — tap the weak ones twice</label>' +
      '<p style="font-size:11.5px;color:var(--ink-3);margin:0 0 9px">Once = include · ' +
      'twice = weak, gets extra time · again = leave out</p>' +
      '<div class="pills" id="spSubs">' + subs.map(function (s) {
        return '<button class="pill on" data-s="' + s.id + '" data-w="1" ' +
          'style="border-color:var(--violet);background:var(--violet-bg);color:var(--violet)">' +
          s.em + ' ' + esc(s.name) + '</button>';
      }).join('') + '</div>' +
      '<button class="btn btn-v" id="spGo" style="margin-top:18px;height:44px;width:100%;' +
      'justify-content:center">✨ Build my plan</button><div id="spOut"></div>';
  }

  function planStats() {
    var u = M.state.user, plan = M.state.plan;
    var doneS = plan.filter(function (s) { return s.done; });
    var mins = doneS.reduce(function (a, s) { return a + s.mins; }, 0);
    var topics = {};
    doneS.forEach(function (s) { if (s.topic) topics[s.topic] = 1; });
    var weekGoal = M.store.get('weekGoal', 600);
    var weekMins = doneS.filter(function (s) {
      return s.date >= new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
    }).reduce(function (a, s) { return a + s.mins; }, 0);
    return '<div class="grid stats">' +
      st('🔥 Current streak', (u.streak || 0) + ' days') +
      st('🏅 Best streak', (M.store.get('bestStreak', u.streak || 0)) + ' days') +
      st('📚 Topics done', Object.keys(topics).length) +
      st('⏱ Study time', Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm') +
      '</div>' +
      '<div style="margin-top:16px"><label class="cfg-l">Weekly goal</label>' +
      '<div class="prog-row"><span class="prog-t"><i style="width:' +
      Math.min(100, weekMins / weekGoal * 100) + '%"></i></span>' +
      '<b>' + weekMins + ' / ' + weekGoal + ' min</b></div>' +
      '<div class="pills" style="margin-top:12px">' +
      [300, 600, 900, 1200].map(function (g) {
        return '<button class="pill' + (g === weekGoal ? ' on' : '') + '" data-goal="' + g + '"' +
          (g === weekGoal ? ' style="border-color:var(--violet);background:var(--violet-bg);' +
            'color:var(--violet)"' : '') + '>' + (g / 60) + ' h / week</button>';
      }).join('') + '</div></div>' +
      '<div class="fb" style="margin-top:16px"><h4>🔔 Reminders</h4>' +
      'Reminders are taken from this plan, so they always match what you actually scheduled.' +
      '<div style="margin-top:10px;display:flex;gap:16px;flex-wrap:wrap;font-size:12.5px">' +
      '<label style="display:flex;gap:7px;align-items:center"><input type="checkbox" id="rmOn"' +
      (M.store.get('remind', true) ? ' checked' : '') + '> Remind me about today\'s sessions' +
      '</label></div></div>';
  }

  function st(label, val) {
    return '<div class="stat"><small>' + esc(label) + '</small><b>' + esc(String(val)) +
      '</b></div>';
  }

  function wirePlan() {
    var body = $('#plBody'); if (!body) return;

    if ($('#plAdd')) $('#plAdd').onclick = function () { addSession(today()); };
    $$('.wadd').forEach(function (b) {
      b.onclick = function () { addSession(this.dataset.date); };
    });
    $$('.pill[data-goal]').forEach(function (b) {
      b.onclick = function () {
        M.store.set('weekGoal', +this.dataset.goal);
        $('#plBody').innerHTML = planBody(); wirePlan();
      };
    });
    if ($('#rmOn')) $('#rmOn').onchange = function () {
      M.store.set('remind', this.checked);
      M.toast(this.checked ? 'Reminders on' : 'Reminders off', 'ok');
      if (this.checked) scheduleReminders();
    };

    body.onclick = function (e) {
      var row = e.target.closest('.sess'); if (!row) return;
      var btn = e.target.closest('[data-a]'); if (!btn) return;
      var id = row.dataset.id;
      var s = M.state.plan.filter(function (x) { return x.id === id; })[0];
      if (!s) return;
      if (btn.dataset.a === 'done') {
        s.done = !s.done;
        M.save('plan');
        if (s.done) { M.addXP(6, 'study session done'); trackBest(); }
        $('#plBody').innerHTML = planBody(); wirePlan();
      } else if (btn.dataset.a === 'del') {
        M.state.plan = M.state.plan.filter(function (x) { return x.id !== id; });
        M.save('plan');
        $('#plBody').innerHTML = planBody(); wirePlan();
        M.toast('Session removed');
      } else if (btn.dataset.a === 'start') {
        /* studying a topic IS a practice test on that topic */
        M.state.cat = M.state.cat; M.save('cat');
        M.toast('Starting ' + (C.subjects[s.sub] ? C.subjects[s.sub].name : 'session'), 'ok');
        M.router.go('mock');
      }
    };

    var spSubs = $('#spSubs');
    if (spSubs) {
      /* one tap include, two taps weak, three taps out */
      spSubs.onclick = function (e) {
        var b = e.target.closest('.pill'); if (!b) return;
        var wgt = +b.dataset.w;
        wgt = wgt === 1 ? 2 : wgt === 2 ? 0 : 1;
        b.dataset.w = wgt;
        b.classList.toggle('on', wgt > 0);
        b.style.cssText = wgt === 2
          ? 'border-color:var(--red-ink);background:var(--red-bg);color:var(--red-ink)'
          : wgt === 1
            ? 'border-color:var(--violet);background:var(--violet-bg);color:var(--violet)' : '';
        b.title = wgt === 2 ? 'Weak — more time' : wgt === 1 ? 'Included' : 'Left out';
      };
      $('#spGo').onclick = buildSmartPlan;
    }
  }

  function trackBest() {
    var s = M.state.user.streak || 0;
    if (s > M.store.get('bestStreak', 0)) M.store.set('bestStreak', s);
  }

  function addSession(date) {
    var subs = C.subsOf(M.state.cat, M.state.course, M.state.year);
    var m = d.getElementById('modal');
    m.innerHTML = '<div class="modal-c"><h3>Add a study session</h3>' +
      '<p>' + new Date(date + 'T00:00').toLocaleDateString(undefined,
        { weekday: 'long', day: 'numeric', month: 'long' }) + '</p>' +
      '<div style="margin:16px 0;display:flex;flex-direction:column;gap:12px">' +
      '<div><label class="cfg-l">Subject</label><select class="sel" id="asSub" ' +
      'style="width:100%">' + (subs.length ? subs.map(function (s) {
        return '<option value="' + s.id + '">' + esc(s.name) + '</option>';
      }).join('') : subOpts()) + '</select></div>' +
      '<div><label class="cfg-l">Topic</label><input class="sel" id="asTopic" style="width:100%" ' +
      'placeholder="e.g. Integration by parts"></div>' +
      '<div style="display:flex;gap:12px">' +
      '<div style="flex:1"><label class="cfg-l">Minutes</label><select class="sel" id="asMins" ' +
      'style="width:100%">' + [15, 30, 45, 60, 90, 120].map(function (x) {
        return '<option' + (x === 45 ? ' selected' : '') + '>' + x + '</option>';
      }).join('') + '</select></div>' +
      '<div style="flex:1"><label class="cfg-l">Priority</label><select class="sel" id="asPri" ' +
      'style="width:100%"><option value="2">High</option><option value="1" selected>Normal' +
      '</option><option value="0">Low</option></select></div></div></div>' +
      '<div class="m-btns"><button class="btn btn-o" id="asCancel">Cancel</button>' +
      '<button class="btn btn-v" id="asSave">Add session</button></div></div>';
    m.classList.add('open');
    $('#asCancel').onclick = function () { m.classList.remove('open'); };
    $('#asSave').onclick = function () {
      M.state.plan.push({
        id: uid(), date: date, sub: $('#asSub').value,
        topic: $('#asTopic').value.trim(), mins: +$('#asMins').value,
        priority: +$('#asPri').value, done: false
      });
      M.save('plan');
      m.classList.remove('open');
      $('#plBody').innerHTML = planBody(); wirePlan();
      M.toast('Session added', 'ok');
      scheduleReminders();
    };
  }

  function buildSmartPlan() {
    var date = $('#spDate').value;
    if (!date) { M.toast('Pick your exam date', 'warn'); return; }
    var days = Math.ceil((new Date(date + 'T00:00') - new Date(today() + 'T00:00')) / 864e5);
    if (days < 1) { M.toast('Pick a date in the future', 'warn'); return; }
    var perDay = parseFloat($('#spHrs').value) * 60;
    var len = +$('#spLen').value;
    var picked = $$('#spSubs .pill').filter(function (b) { return +b.dataset.w > 0; })
      .map(function (b) { return { id: b.dataset.s, w: +b.dataset.w }; });
    if (!picked.length) { M.toast('Choose at least one subject', 'warn'); return; }

    /* weight the rota so weak subjects come up twice as often */
    var rota = [];
    picked.forEach(function (p) { for (var i = 0; i < p.w; i++) rota.push(p.id); });

    /* clear any previous generated plan, keep hand-made sessions */
    M.state.plan = M.state.plan.filter(function (s) { return !s.auto; });

    var slots = Math.max(1, Math.round(perDay / len));
    var k = 0, added = 0;
    var revisionFrom = Math.max(1, days - Math.max(2, Math.round(days * 0.18)));
    for (var dnum = 0; dnum < days; dnum++) {
      var iso = new Date(Date.now() + dnum * 864e5).toISOString().slice(0, 10);
      var revision = dnum >= revisionFrom;
      for (var s2 = 0; s2 < slots; s2++) {
        var subId = rota[k++ % rota.length];
        M.state.plan.push({
          id: uid(), date: iso, sub: subId,
          topic: revision ? 'Revision & practice paper' : 'Syllabus study',
          mins: len, priority: revision ? 2 : (picked.filter(function (p) {
            return p.id === subId; })[0].w === 2 ? 2 : 1),
          done: false, auto: true
        });
        added++;
      }
    }
    M.save('plan');
    $('#spOut').innerHTML = '<div class="fb" style="margin-top:16px"><h4>✅ Plan ready</h4>' +
      added + ' sessions across ' + days + ' day' + (days > 1 ? 's' : '') + ', ' + slots +
      ' a day of ' + len + ' minutes. The last ' + (days - revisionFrom) +
      ' day' + (days - revisionFrom === 1 ? '' : 's') + ' are revision and practice papers.' +
      '<div class="pills" style="margin-top:12px">' +
      '<button class="pill" id="spToday">Open today</button>' +
      '<button class="pill" id="spWeek">See the week</button></div></div>';
    $('#spToday').onclick = function () {
      planTab = 'today'; M.router.go('planner');
    };
    $('#spWeek').onclick = function () { planTab = 'week'; M.router.go('planner'); };
    M.addXP(15, 'study plan built');
    scheduleReminders();
  }

  /* =====================================================================
     REMINDERS FROM THE PLAN
     The plan is the single source of truth: a reminder is only ever raised
     for a session that is actually scheduled today and not yet ticked off.
     Each one fires at most once per day per session, tracked by a dedupe
     key, so reopening the app does not re-notify.
     ===================================================================== */
  function scheduleReminders() {
    if (!M.store.get('remind', true)) return;
    var fired = M.store.get('remindFired', {});
    var stamp = today();
    var due = M.state.plan.filter(function (s) { return s.date === stamp && !s.done; });
    if (!due.length) return;

    var mins = due.reduce(function (a, s) { return a + s.mins; }, 0);
    var key = 'plan:' + stamp;
    if (!fired[key]) {
      fired[key] = 1;
      M.store.set('remindFired', fired);
      M.notify('📅', 'Today\'s study plan',
        due.length + ' session' + (due.length > 1 ? 's' : '') + ' · ' + mins + ' minutes');
    }
    /* nudge again for anything still outstanding, once, a while later */
    clearTimeout(scheduleReminders._t);
    scheduleReminders._t = setTimeout(function () {
      var still = M.state.plan.filter(function (s) { return s.date === today() && !s.done; });
      if (!still.length) return;
      var k2 = 'nudge:' + today();
      var f2 = M.store.get('remindFired', {});
      if (f2[k2]) return;
      f2[k2] = 1; M.store.set('remindFired', f2);
      var s0 = still[0], sub = C.subjects[s0.sub];
      M.notify('⏰', 'Still pending: ' + (sub ? sub.name : 'study'),
        (s0.topic || 'Revision') + ' · ' + s0.mins + ' min');
      M.toast('⏰ ' + (sub ? sub.name : 'Study') + ' — ' + (s0.topic || 'revision') +
        ' still pending', 'warn', 5000);
    }, 15 * 60 * 1000);
  }
  w.addEventListener('load', function () { setTimeout(scheduleReminders, 4000); });

  /* =====================================================================
     NOTES & FLASHCARDS
     ===================================================================== */
  var noteTab = 'notes', cardIdx = 0, flipped = false;

  M.router.on('notes', function () {
    set('<div class="wrap"><div class="col">' +
      V.card('📒', 'green', 'Notes & Flashcards',
        '<div class="tabs" id="nTabs">' +
        [['notes', '📝 Notes'], ['cards', '🎴 Flashcards']].map(function (t) {
          return '<button class="tab' + (noteTab === t[0] ? ' on' : '') + '" data-t="' + t[0] +
            '">' + t[1] + '</button>';
        }).join('') + '</div>' +
        '<div id="nBody" style="margin-top:16px">' + noteBody() + '</div>') +
      '</div>' + rail() + '</div>' + foot());
    $('#nTabs').onclick = function (e) {
      var b = e.target.closest('.tab'); if (!b) return;
      noteTab = b.dataset.t;
      $$('.tab', this).forEach(function (t) { t.classList.toggle('on', t === b); });
      $('#nBody').innerHTML = noteBody(); wireNotes();
    };
    wireNotes();
  });

  function noteBody() { return noteTab === 'notes' ? notesList() : cardsView(); }

  function notesList() {
    var q = (M.state.noteQ || '').toLowerCase();
    var list = M.state.notes.filter(function (n) {
      return !q || (n.t + ' ' + (n.body || '')).toLowerCase().indexOf(q) > -1;
    });
    return '<div class="plan-top"><input class="sel" id="nQ" style="flex:1;max-width:280px" ' +
      'placeholder="Search your notes" value="' + esc(M.state.noteQ || '') + '">' +
      '<button class="btn btn-v" id="nNew">＋ New note</button></div>' +
      (list.length ? '<div class="notes">' + list.map(function (n, i) {
        return '<article class="note" data-i="' + i + '">' +
          '<h4>' + esc(n.t || 'Untitled') + '</h4>' +
          '<p>' + esc((n.body || '').slice(0, 180)) +
          ((n.body || '').length > 180 ? '…' : '') + '</p>' +
          '<div class="note-f"><small>' + new Date(n.at || Date.now()).toLocaleDateString() +
          '</small><span>' +
          '<button class="mv" data-a="card" title="Make a flashcard">🎴</button>' +
          '<button class="mv" data-a="mark" title="Bookmark">🔖</button>' +
          '<button class="mv" data-a="del" title="Delete">✕</button></span></div></article>';
      }).join('') + '</div>'
        : '<div class="empty"><span class="em">📒</span><b>No notes yet</b>' +
          '<small>Write one, or save a corrected answer from AI Correct &amp; Score.</small>' +
          '</div>');
  }

  function cardsView() {
    var cards = M.state.cards;
    if (!cards.length) {
      return '<div class="empty"><span class="em">🎴</span><b>No flashcards yet</b>' +
        '<small>Make one below, or turn any note into a card with the 🎴 button.</small>' +
        '<button class="btn btn-v" id="cNew" style="margin-top:8px">＋ New flashcard</button>' +
        '</div>';
    }
    cardIdx = Math.max(0, Math.min(cardIdx, cards.length - 1));
    var c = cards[cardIdx];
    return '<div class="plan-top"><b>Card ' + (cardIdx + 1) + ' of ' + cards.length + '</b>' +
      '<button class="btn btn-o" id="cNew">＋ New card</button></div>' +
      '<div class="flash' + (flipped ? ' flip' : '') + '" id="cFlip" tabindex="0" ' +
      'role="button" aria-label="Flip the card">' +
      '<div class="flash-in">' +
      '<div class="flash-f"><small>Question</small><p>' + esc(c.q) + '</p>' +
      '<i>Tap to flip</i></div>' +
      '<div class="flash-b"><small>Answer</small><p>' + esc(c.a) + '</p></div>' +
      '</div></div>' +
      '<div class="pills" style="margin-top:14px;justify-content:center">' +
      '<button class="pill" id="cPrev">← Previous</button>' +
      '<button class="pill" id="cKnown">✅ I know this</button>' +
      '<button class="pill" id="cRevise">🔁 Needs revision</button>' +
      '<button class="pill" id="cNext">Next →</button></div>' +
      '<p style="text-align:center;font-size:11.5px;color:var(--ink-3);margin-top:10px">' +
      'Known: ' + cards.filter(function (x) { return x.known; }).length + ' · ' +
      'To revise: ' + cards.filter(function (x) { return !x.known; }).length + '</p>';
  }

  function wireNotes() {
    if ($('#nQ')) $('#nQ').oninput = function () {
      M.state.noteQ = this.value;
      $('#nBody').innerHTML = noteBody(); wireNotes();
      var i = $('#nQ'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
    };
    if ($('#nNew')) $('#nNew').onclick = function () { editNote(-1); };
    if ($('#cNew')) $('#cNew').onclick = newCard;

    $$('.note').forEach(function (el) {
      el.onclick = function (e) {
        var b = e.target.closest('[data-a]');
        var i = +this.dataset.i;
        var n = M.state.notes[i];
        if (!b) { editNote(i); return; }
        if (b.dataset.a === 'del') {
          M.state.notes.splice(i, 1); M.save('notes');
          $('#nBody').innerHTML = noteBody(); wireNotes(); M.toast('Note deleted');
        } else if (b.dataset.a === 'card') {
          M.state.cards.push({ id: uid(), q: n.t || 'Question', a: n.body || '', known: false });
          M.save('cards'); M.toast('Flashcard made', 'ok'); M.addXP(3, 'flashcard');
        } else if (b.dataset.a === 'mark') {
          addMark('note', n.t || 'Note', (n.body || '').slice(0, 90));
        }
      };
    });

    var f = $('#cFlip');
    if (f) {
      f.onclick = function () { flipped = !flipped; this.classList.toggle('flip', flipped); };
      f.onkeydown = function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.click(); }
      };
      var move = function (dir) {
        flipped = false; cardIdx += dir;
        $('#nBody').innerHTML = noteBody(); wireNotes();
      };
      $('#cPrev').onclick = function () { if (cardIdx > 0) move(-1); };
      $('#cNext').onclick = function () { if (cardIdx < M.state.cards.length - 1) move(1); };
      $('#cKnown').onclick = function () {
        M.state.cards[cardIdx].known = true; M.save('cards'); M.addXP(2, 'card learnt');
        if (cardIdx < M.state.cards.length - 1) move(1);
        else { $('#nBody').innerHTML = noteBody(); wireNotes(); }
      };
      $('#cRevise').onclick = function () {
        M.state.cards[cardIdx].known = false; M.save('cards');
        if (cardIdx < M.state.cards.length - 1) move(1);
        else { $('#nBody').innerHTML = noteBody(); wireNotes(); }
      };
    }
  }

  function editNote(i) {
    var n = i < 0 ? { t: '', body: '' } : M.state.notes[i];
    var m = d.getElementById('modal');
    m.innerHTML = '<div class="modal-c"><h3>' + (i < 0 ? 'New note' : 'Edit note') + '</h3>' +
      '<div style="margin:14px 0;display:flex;flex-direction:column;gap:12px">' +
      '<input class="sel" id="enT" style="width:100%" placeholder="Title" value="' +
      esc(n.t || '') + '">' +
      '<textarea class="ed-area" id="enB" style="border:1px solid var(--line-2);' +
      'border-radius:11px;min-height:150px" placeholder="Write your note...">' +
      esc(n.body || '') + '</textarea></div>' +
      '<div class="m-btns"><button class="btn btn-o" id="enC">Cancel</button>' +
      '<button class="btn btn-v" id="enS">Save</button></div></div>';
    m.classList.add('open');
    $('#enC').onclick = function () { m.classList.remove('open'); };
    $('#enS').onclick = function () {
      var rec = { t: $('#enT').value.trim() || 'Untitled', body: $('#enB').value, at: Date.now() };
      if (i < 0) M.state.notes.unshift(rec); else M.state.notes[i] = rec;
      M.save('notes'); m.classList.remove('open');
      $('#nBody').innerHTML = noteBody(); wireNotes();
      M.toast('Note saved', 'ok'); M.addXP(3, 'note saved');
    };
  }

  function newCard() {
    var m = d.getElementById('modal');
    m.innerHTML = '<div class="modal-c"><h3>New flashcard</h3>' +
      '<div style="margin:14px 0;display:flex;flex-direction:column;gap:12px">' +
      '<div><label class="cfg-l">Front — the question</label>' +
      '<input class="sel" id="fcQ" style="width:100%" placeholder="What is photosynthesis?"></div>' +
      '<div><label class="cfg-l">Back — the answer</label>' +
      '<textarea class="ed-area" id="fcA" style="border:1px solid var(--line-2);' +
      'border-radius:11px;min-height:110px" placeholder="The process by which green plants..."' +
      '></textarea></div></div>' +
      '<div class="m-btns"><button class="btn btn-o" id="fcC">Cancel</button>' +
      '<button class="btn btn-v" id="fcS">Add card</button></div></div>';
    m.classList.add('open');
    $('#fcC').onclick = function () { m.classList.remove('open'); };
    $('#fcS').onclick = function () {
      var q = $('#fcQ').value.trim();
      if (!q) { M.toast('The front needs a question', 'warn'); return; }
      M.state.cards.push({ id: uid(), q: q, a: $('#fcA').value.trim(), known: false });
      M.save('cards'); m.classList.remove('open');
      cardIdx = M.state.cards.length - 1; flipped = false;
      $('#nBody').innerHTML = noteBody(); wireNotes();
      M.toast('Flashcard added', 'ok'); M.addXP(3, 'flashcard');
    };
  }

  /* =====================================================================
     BOOKMARKS
     ===================================================================== */
  var markFilter = 'all';
  function addMark(kind, title, sub) {
    M.state.marks.unshift({ id: uid(), kind: kind, t: title, s: sub || '', at: Date.now() });
    M.save('marks');
    M.toast('Bookmarked', 'ok');
  }
  w.M7.addMark = addMark;

  M.router.on('bookmarks', function () {
    var kinds = [['all', 'All'], ['question', 'Questions'], ['note', 'Notes'],
                 ['paper', 'Papers'], ['topic', 'Topics']];
    function list() {
      return M.state.marks.filter(function (b) {
        return markFilter === 'all' || b.kind === markFilter;
      });
    }
    function body() {
      var l = list();
      return l.length ? l.map(function (b, i) {
        var em = { question: '❓', note: '📝', paper: '📄', topic: '🎯' }[b.kind] || '🔖';
        return '<div class="sess" data-i="' + i + '">' +
          '<span class="em" style="' + hue('gold') + '">' + em + '</span>' +
          '<div class="sess-n"><b>' + esc(b.t) + '</b><small>' + esc(b.s) + '</small>' +
          '<span class="sess-meta">' + esc(b.kind) + ' · ' +
          new Date(b.at).toLocaleDateString() + '</span></div>' +
          '<div class="sess-do"><button class="mv" data-a="del" aria-label="Remove">✕</button>' +
          '</div></div>';
      }).join('')
        : '<div class="empty"><span class="em">🔖</span><b>Nothing saved yet</b>' +
          '<small>Bookmark a note, a question or a paper and it appears here.</small></div>';
    }
    set('<div class="wrap"><div class="col">' +
      V.card('🔖', 'orange', 'Bookmarks',
        '<div class="tabs" id="bTabs">' + kinds.map(function (k) {
          var n = M.state.marks.filter(function (b) {
            return k[0] === 'all' || b.kind === k[0]; }).length;
          return '<button class="tab' + (markFilter === k[0] ? ' on' : '') + '" data-k="' + k[0] +
            '">' + esc(k[1]) + (n ? ' <b style="opacity:.6">' + n + '</b>' : '') + '</button>';
        }).join('') + '</div>' +
        '<div id="bBody" style="margin-top:16px">' + body() + '</div>') +
      '</div>' + rail() + '</div>' + foot());

    function wire() {
      $('#bBody').onclick = function (e) {
        var row = e.target.closest('.sess'); if (!row) return;
        if (!e.target.closest('[data-a="del"]')) return;
        var b = list()[+row.dataset.i];
        M.state.marks = M.state.marks.filter(function (x) { return x.id !== b.id; });
        M.save('marks'); M.router.go('bookmarks');
      };
    }
    $('#bTabs').onclick = function (e) {
      var b = e.target.closest('.tab'); if (!b) return;
      markFilter = b.dataset.k;
      $$('.tab', this).forEach(function (t) { t.classList.toggle('on', t === b); });
      $('#bBody').innerHTML = body(); wire();
    };
    wire();
  });

  /* =====================================================================
     MY PRACTICE
     ===================================================================== */
  M.router.on('practice', function (p) {
    var h = M.state.history;
    var weak = {};
    h.forEach(function (r) {
      var k = (r.subject || 'General').split(' · ')[0];
      weak[k] = weak[k] || { n: 0, acc: 0 };
      weak[k].n++; weak[k].acc += r.accuracy;
    });
    var weakList = Object.keys(weak).map(function (k) {
      return { k: k, a: Math.round(weak[k].acc / weak[k].n) };
    }).sort(function (a, b) { return a.a - b.a; });
    var live = M.exam.s;

    set('<div class="wrap"><div class="col">' +
      (live ? V.card('▶️', 'red', 'Continue where you stopped',
        '<div class="sess"><span class="em" style="' + hue('red') + '">⏱</span>' +
        '<div class="sess-n"><b>' + esc(live.title) + '</b><small>' +
        M.exam.counts().a + ' of ' + live.questions.length + ' answered</small></div>' +
        '<div class="sess-do"><a class="btn btn-v" href="#/exam">Resume</a></div></div>') : '') +

      V.card('🎯', 'orange', 'Weak topics — practise these first',
        weakList.length ? '<div class="bd">' + weakList.slice(0, 6).map(function (r) {
          return '<div class="bd-r"><span>' + esc(r.k) + '</span><span class="t">' +
            '<i style="width:' + r.a + '%;background:var(--' +
            (r.a >= 80 ? 'green' : r.a >= 60 ? 'violet' : 'orange') + ')"></i></span>' +
            '<span class="v">' + r.a + '%</span></div>';
        }).join('') + '</div>' +
        '<a class="btn btn-v" style="margin-top:14px" href="#/mock">Practise the weakest</a>'
          : '<div class="empty"><span class="em">🎯</span><b>No data yet</b>' +
            '<small>Finish a test and your weak topics appear here.</small>' +
            '<a class="btn btn-v" href="#/mock">Take a test</a></div>') +

      V.card('🕘', 'blue', 'Recently attempted',
        h.length ? h.slice(0, 8).map(function (r) {
          return '<div class="recent"><span class="em">📄</span><div><b>' + esc(r.title) +
            '</b><small>' + new Date(r.at).toLocaleDateString() + ' · ' + r.got + '/' + r.max +
            '</small></div><span class="sc">' + r.pct + '%</span></div>';
        }).join('')
          : '<div class="empty"><span class="em">🕘</span><b>Nothing attempted yet</b></div>') +

      V.card('⭐', 'violet', 'Recommended for you',
        '<div class="pills">' +
        (weakList.length
          ? '<a class="pill" href="#/mock">🎯 20 questions on ' + esc(weakList[0].k) + '</a>'
          : '<a class="pill" href="#/mock">🎯 Start your first test</a>') +
        '<a class="pill" href="#/correct">🧑‍🏫 Get an answer marked</a>' +
        '<a class="pill" href="#/notes">🎴 Revise your flashcards</a>' +
        '<a class="pill" href="#/papers">📄 Set a paper from last year</a></div>') +
      '</div>' + rail() + '</div>' + foot());
  });

  /* =====================================================================
     ANALYTICS
     ===================================================================== */
  M.router.on('analytics', function () {
    var h = M.state.history;
    if (!h.length) {
      set('<div class="wrap"><div class="col">' +
        V.card('📊', 'pink', 'Analytics',
          '<div class="empty"><span class="em">📊</span><b>Nothing to analyse yet</b>' +
          '<small>Finish a couple of tests and this fills with subject, topic, question-type ' +
          'and timing breakdowns.</small><a class="btn btn-v" href="#/mock">Take a test</a>' +
          '</div>') + '</div>' + rail() + '</div>' + foot());
      return;
    }
    var bySub = {};
    h.forEach(function (r) {
      var k = (r.subject || 'General').split(' · ')[0];
      bySub[k] = bySub[k] || { n: 0, acc: 0, sec: 0, q: 0 };
      bySub[k].n++; bySub[k].acc += r.accuracy;
      bySub[k].sec += r.seconds; bySub[k].q += r.right + r.wrong;
    });
    var rows = Object.keys(bySub).map(function (k) {
      return { k: k, a: Math.round(bySub[k].acc / bySub[k].n),
               t: bySub[k].q ? Math.round(bySub[k].sec / bySub[k].q) : 0 };
    }).sort(function (a, b) { return b.a - a.a; });

    var half = Math.ceil(h.length / 2);
    var recent = h.slice(0, half), older = h.slice(half);
    var avg = function (a) {
      return a.length ? Math.round(a.reduce(function (x, r) { return x + r.pct; }, 0) / a.length) : 0;
    };
    var delta = avg(recent) - avg(older);

    var totalQ = h.reduce(function (a, r) { return a + r.right + r.wrong + r.skipped; }, 0);
    var totalR = h.reduce(function (a, r) { return a + r.right; }, 0);
    var totalW = h.reduce(function (a, r) { return a + r.wrong; }, 0);
    var totalS = h.reduce(function (a, r) { return a + r.skipped; }, 0);

    set('<div class="wrap"><div class="col">' +
      V.card('📊', 'pink', 'Subject analysis',
        '<div class="bd">' + rows.map(function (r) {
          return '<div class="bd-r"><span>' + esc(r.k) + '</span><span class="t">' +
            '<i style="width:' + r.a + '%;background:var(--' +
            (r.a >= 80 ? 'green' : r.a >= 60 ? 'violet' : 'orange') + ')"></i></span>' +
            '<span class="v">' + r.a + '%</span></div>';
        }).join('') + '</div>' +
        '<div class="fb" style="margin-top:14px"><h4>' +
        (rows.length > 1 ? '💪 Strongest &amp; weakest' : '💡 So far') + '</h4>' +
        'Strongest: <b>' + esc(rows[0].k) + '</b> at ' + rows[0].a + '%.' +
        (rows.length > 1 ? ' Weakest: <b>' + esc(rows[rows.length - 1].k) + '</b> at ' +
          rows[rows.length - 1].a + '% — that is where the next 20 minutes pays best.' : '') +
        '</div>') +

      V.card('❓', 'violet', 'Question analysis',
        '<div class="grid stats">' +
        st('Attempted', totalQ) + st('Correct', totalR) +
        st('Wrong', totalW) + st('Skipped', totalS) + '</div>' +
        '<div class="bd" style="margin-top:14px">' +
        [['Correct', totalR, 'green'], ['Wrong', totalW, 'orange'], ['Skipped', totalS, 'pink']]
          .map(function (x) {
            return '<div class="bd-r"><span>' + x[0] + '</span><span class="t">' +
              '<i style="width:' + (totalQ ? x[1] / totalQ * 100 : 0) +
              '%;background:var(--' + x[2] + ')"></i></span>' +
              '<span class="v">' + (totalQ ? Math.round(x[1] / totalQ * 100) : 0) + '%</span></div>';
          }).join('') + '</div>') +

      V.card('⏱', 'teal', 'Time analysis',
        '<div class="bd">' + rows.map(function (r) {
          var worst = Math.max.apply(null, rows.map(function (x) { return x.t; })) || 1;
          return '<div class="bd-r"><span>' + esc(r.k) + '</span><span class="t">' +
            '<i style="width:' + (r.t / worst * 100) + '%;background:var(--teal)"></i></span>' +
            '<span class="v">' + r.t + 's</span></div>';
        }).join('') + '</div>' +
        '<p style="font-size:11.5px;color:var(--ink-3);margin-top:10px">Average seconds per ' +
        'attempted question. Longer is not always worse — but a subject far above the rest is ' +
        'usually one you are working out rather than recalling.</p>') +

      V.card(delta >= 0 ? '📈' : '📉', delta >= 0 ? 'green' : 'orange', 'Improvement',
        '<div class="score-hero" style="background:linear-gradient(120deg,var(--' +
        (delta >= 0 ? 'green' : 'orange') + '-bg),#fff);border-color:var(--line)">' +
        '<div><b style="font-size:26px;color:var(--' + (delta >= 0 ? 'green' : 'orange') + ')">' +
        (delta >= 0 ? '+' : '') + delta + '%</b>' +
        '<small>' + (delta > 0 ? 'Your recent half is scoring higher than your earlier half — ' +
          'keep going.' : delta === 0 ? 'Holding steady.' :
          'Your recent scores dipped. Slow down and check the weak subject above.') +
        '</small></div></div>' +
        '<div style="margin-top:14px">' + V.lineChart([
          { name: 'Score', hue: 'violet',
            pts: h.slice(0, 8).reverse().map(function (r) { return r.pct; }),
            labels: h.slice(0, 8).reverse().map(function (r) {
              return new Date(r.at).getDate() + '/' + (new Date(r.at).getMonth() + 1); }) },
          { name: 'Accuracy', hue: 'green',
            pts: h.slice(0, 8).reverse().map(function (r) { return r.accuracy; }) }
        ]) + '</div>') +
      '</div>' + rail() + '</div>' + foot());
  });

  /* =====================================================================
     LEADERBOARD
     Real position is computed from this student's own record. The rest of
     the board is clearly labelled as sample placement, because there is no
     multi-user backend yet and inventing rivals would be a lie.
     ===================================================================== */
  var lbScope = 'week';
  M.router.on('leaderboard', function () {
    var h = M.state.history, u = M.state.user;
    var score = (u.xp || 0) + h.reduce(function (a, r) { return a + r.got; }, 0);
    var band = score > 900 ? 4 : score > 500 ? 9 : score > 200 ? 24 : 60;
    var peers = [
      { n: 'Ananya R.', s: Math.round(score * 1.34) + 120, k: 21 },
      { n: 'Rahul K.', s: Math.round(score * 1.18) + 80, k: 17 },
      { n: 'Meera S.', s: Math.round(score * 1.07) + 40, k: 14 },
      { n: 'You', s: score, k: u.streak || 0, me: true },
      { n: 'Vikram T.', s: Math.max(0, Math.round(score * 0.86) - 20), k: 6 },
      { n: 'Priya N.', s: Math.max(0, Math.round(score * 0.7) - 40), k: 4 }
    ].sort(function (a, b) { return b.s - a.s; });

    set('<div class="wrap"><div class="col">' +
      V.card('🏅', 'gold', 'Leaderboard',
        '<div class="tabs" id="lbTabs">' +
        [['week', 'Weekly'], ['month', 'Monthly'], ['sub', 'By subject'],
         ['all', 'All time']].map(function (t) {
          return '<button class="tab' + (lbScope === t[0] ? ' on' : '') + '" data-s="' + t[0] +
            '">' + t[1] + '</button>';
        }).join('') + '</div>' +
        '<div class="lb" style="margin-top:16px">' + peers.map(function (p, i) {
          return '<div class="lb-r' + (p.me ? ' me' : '') + '">' +
            '<span class="lb-p' + (i < 3 ? ' top' : '') + '">' +
            (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1) + '</span>' +
            '<span class="lb-a">' + esc(p.n[0]) + '</span>' +
            '<span class="lb-n">' + esc(p.n) + (p.me ? ' <i>you</i>' : '') + '</span>' +
            '<span class="lb-k">🔥 ' + p.k + '</span>' +
            '<span class="lb-s">' + p.s + '</span></div>';
        }).join('') + '</div>' +
        '<div class="fb" style="margin-top:14px"><h4>ℹ️ About this board</h4>' +
        'Your score and streak are real, taken from your own record. The other names are ' +
        'sample placement showing roughly where you sit — there is no shared backend yet, and ' +
        'inventing real rivals would be dishonest. Your position: about the top ' + band +
        '% for your score.</div>') +
      '</div>' + rail() + '</div>' + foot());
    $('#lbTabs').onclick = function (e) {
      var b = e.target.closest('.tab'); if (!b) return;
      lbScope = b.dataset.s;
      $$('.tab', this).forEach(function (t) { t.classList.toggle('on', t === b); });
      M.toast('Showing ' + b.textContent.trim().toLowerCase());
    };
  });

  /* =====================================================================
     CHALLENGES
     ===================================================================== */
  M.router.on('challenges', function () {
    var h = M.state.history, u = M.state.user;
    var best = h.reduce(function (a, r) { return Math.max(a, r.accuracy); }, 0);
    var doneToday = M.state.done[today()] || {};
    var list = [
      { id: 'daily', em: '🎯', hue: 'violet', t: 'Daily Challenge',
        s: '5 questions in 5 minutes', xp: 20,
        prog: doneToday.daily ? 1 : 0, go: '#/mock?quick=1' },
      { id: 'speed', em: '⚡', hue: 'orange', t: 'Speed Challenge',
        s: 'As many as you can in 60 seconds', xp: 25,
        prog: doneToday.speed ? 1 : 0, go: '#/mock?quick=1' },
      { id: 'topic', em: '📘', hue: 'blue', t: 'Topic Challenge',
        s: '10 questions from a single topic', xp: 30,
        prog: doneToday.topic ? 1 : 0, go: '#/mock' },
      { id: 'streak', em: '🔥', hue: 'red', t: 'Streak Challenge',
        s: 'Study 7 days in a row', xp: 60,
        prog: Math.min(1, (u.streak || 0) / 7), note: (u.streak || 0) + ' / 7 days',
        go: '#/planner' },
      { id: 'acc', em: '🎖️', hue: 'green', t: 'Accuracy Challenge',
        s: 'Score 90%+ accuracy in a test', xp: 50,
        prog: Math.min(1, best / 90), note: best + '% best so far', go: '#/mock' },
      { id: 'exam', em: '📝', hue: 'gold', t: 'Exam Challenge',
        s: 'Finish a full mock test', xp: 40,
        prog: h.length ? 1 : 0, go: '#/mock' }
    ];
    set('<div class="wrap"><div class="col">' +
      V.card('🧩', 'red', 'Challenges',
        '<p style="font-size:12.5px;color:var(--ink-2);margin-bottom:14px">Finish these to ' +
        'earn XP. You are on <b>Level ' + (u.level || 1) + '</b> with <b>' + (u.xp || 0) +
        ' XP</b>.</p>' +
        '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr));' +
        'gap:11px">' + list.map(function (c) {
          var pct = Math.round(c.prog * 100);
          return '<div class="chal' + (pct >= 100 ? ' won' : '') + '">' +
            '<span class="em" style="' + hue(c.hue) + '">' + c.em + '</span>' +
            '<div class="chal-n"><b>' + esc(c.t) + '</b><small>' + esc(c.s) + '</small>' +
            '<span class="prog-t" style="margin-top:8px"><i style="width:' + pct +
            '%"></i></span>' +
            '<span class="chal-f">' + (c.note ? esc(c.note) : pct + '%') +
            '<em>+' + c.xp + ' XP</em></span></div>' +
            (pct >= 100 ? '<span class="chal-tick">✓</span>'
                        : '<a class="btn btn-v" href="' + c.go + '">Go</a>') +
            '</div>';
        }).join('') + '</div>') +
      '</div>' + rail() + '</div>' + foot());
  });

  /* =====================================================================
     AI STUDY ASSISTANT
     Keeps the chosen subject in context between turns, so a Biology
     question stays a Biology conversation unless the student changes it.
     ===================================================================== */
  M.router.on('assistant', function () {
    var subs = C.subsOf(M.state.cat, M.state.course, M.state.year);
    var cur = M.state.aiSub || (subs[0] && subs[0].id) || 'gk';
    set('<div class="wrap"><div class="col">' +
      V.card('🤖', 'violet', 'AI Study Assistant',
        '<div style="display:flex;gap:9px;flex-wrap:wrap;align-items:center;margin-bottom:12px">' +
        '<label class="cfg-l" style="margin:0">Subject</label>' +
        '<select class="sel" id="aiSub">' + (subs.length ? subs.map(function (s) {
          return '<option value="' + s.id + '"' + (s.id === cur ? ' selected' : '') + '>' +
            esc(s.name) + '</option>';
        }).join('') : subOpts(cur)) + '</select>' +
        '<span style="font-size:11.5px;color:var(--ink-3)">' +
        esc(C.course(M.state.cat, M.state.course).name) + '</span>' +
        '<button class="mv push" id="aiClear" title="Clear the conversation" ' +
        'style="margin-left:auto">🗑</button></div>' +

        '<div class="chat scroll" id="aiLog">' + chatHTML() + '</div>' +

        '<div class="pills" style="margin-top:12px" id="aiQuick">' +
        ['Explain this topic', 'Explain like I am a beginner', 'Give me examples',
         'Summarise this chapter', 'Make revision notes', 'Generate 5 MCQs',
         'Make flashcards', 'Create a study plan'].map(function (q) {
          return '<button class="pill" data-q="' + esc(q) + '" style="font-weight:600">' +
            esc(q) + '</button>';
        }).join('') + '</div>' +

        '<div class="ask" style="margin-top:12px">' +
        '<textarea class="ed-area" id="aiIn" style="border:1px solid var(--line-2);' +
        'border-radius:11px;min-height:74px" placeholder="Ask anything about ' +
        esc(C.subjects[cur] ? C.subjects[cur].name : 'your subject') + '..."></textarea>' +
        '<button class="btn btn-v" id="aiSend" style="margin-top:10px;height:42px;width:100%;' +
        'justify-content:center">Ask ✨</button></div>') +
      '</div>' + rail() + '</div>' + foot());

    $('#aiSub').onchange = function () {
      M.state.aiSub = this.value; M.save('aiSub');
      M.toast('Now focused on ' + C.subjects[this.value].name);
      $('#aiIn').placeholder = 'Ask anything about ' + C.subjects[this.value].name + '...';
    };
    $('#aiClear').onclick = function () {
      M.state.chat = []; M.save('chat');
      $('#aiLog').innerHTML = chatHTML();
    };
    $('#aiQuick').onclick = function (e) {
      var b = e.target.closest('[data-q]'); if (!b) return;
      $('#aiIn').value = b.dataset.q; ask();
    };
    $('#aiSend').onclick = ask;
    $('#aiIn').onkeydown = function (e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) ask();
    };
    scrollChat();

    function ask() {
      var q = $('#aiIn').value.trim();
      if (!q) { M.toast('Type a question first', 'warn'); return; }
      var subId = $('#aiSub').value, sub = C.subjects[subId];
      M.state.chat.push({ r: 'u', t: q });
      M.save('chat');
      $('#aiIn').value = '';
      $('#aiLog').innerHTML = chatHTML() +
        '<div class="msg a"><div class="think" style="padding:4px">thinking<i></i><i></i><i></i>' +
        '</div></div>';
      scrollChat();
      $('#aiSend').disabled = true;

      /* the last few turns go along, so follow-up questions make sense */
      var hist = M.state.chat.slice(-6).map(function (m) {
        return (m.r === 'u' ? 'Student: ' : 'Teacher: ') + m.t;
      }).join('\n');
      var prompt = 'You are a patient ' + (sub ? sub.name : 'school') + ' teacher for a ' +
        C.course(M.state.cat, M.state.course).name + ' student in India.\n' +
        'Stay on ' + (sub ? sub.name : 'the subject') + ' unless the student clearly changes ' +
        'subject.\nConversation so far:\n' + hist +
        '\n\nAnswer the last question clearly, at that level, with a short example. ' +
        'Use plain formatting and keep it under 250 words.';

      M.ai.ask(prompt, { temp: 0.6 }).then(function (r) {
        $('#aiSend').disabled = false;
        var text = r.demo || !r.text ? demoReply(q, sub) : r.text;
        M.state.chat.push({ r: 'a', t: text, demo: r.demo });
        M.save('chat');
        $('#aiLog').innerHTML = chatHTML();
        scrollChat();
        M.addXP(2, 'asked the assistant');
      });
    }
  });

  function chatHTML() {
    if (!M.state.chat.length) {
      return '<div class="empty" style="padding:26px 14px"><span class="em">🤖</span>' +
        '<b>Ask me anything</b><small>Pick a shortcut below, or type your own question. ' +
        'I stay on the subject you chose.</small></div>';
    }
    return M.state.chat.map(function (m) {
      return '<div class="msg ' + (m.r === 'u' ? 'u' : 'a') + '">' +
        (m.demo ? '<span class="demo-tag">demo</span>' : '') +
        esc(m.t).replace(/\n/g, '<br>') + '</div>';
    }).join('');
  }
  function scrollChat() {
    var l = $('#aiLog'); if (l) l.scrollTop = l.scrollHeight;
  }
  function demoReply(q, sub) {
    return 'The AI backend is not reachable from here, so this is a placeholder reply — the ' +
      'layout is exactly what a live answer uses.\n\nYou asked about ' +
      (sub ? sub.name : 'your subject') + ': "' + q + '".\n\nOnce api.php can reach a provider, ' +
      'this becomes a full teacher-style explanation at your class level, with an example and ' +
      'a follow-up question to check you understood.';
  }
})(window, document);
