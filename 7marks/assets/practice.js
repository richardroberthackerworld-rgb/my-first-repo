/* =====================================================================
   7MARKS — the practice loop.

   Everything a student does AFTER a result: retry the ones they got wrong,
   sit a similar test, drill the Mistake Bank, and see where they actually
   stand. Every one of these is a single click and every one of them goes
   through M7.gen.run — the same prompt, validation, set record and preview
   as the main generator, so none of them can drift into a second engine.

   Loaded last, so its result and performance routes replace the earlier
   placeholder versions.
   ===================================================================== */
(function (w, d) {
  'use strict';
  var M = w.M7, V = w.V, P = w.PAGES, db = M.db;
  var $ = M.qs, $$ = M.qsa, esc = M.esc;
  function set(html) { d.getElementById('page').innerHTML = html; }

  function pct(n) { return Math.round(n || 0) + '%'; }
  function mmss(s) { return Math.floor(s / 60) + 'm ' + (s % 60) + 's'; }

  /* ============================ THE RESULT ============================ */
  M.router.on('result', function (params) {
    var r = params && params.id ? db.results.get(params.id) : M.state.history[0];
    if (!r) { M.router.go('home'); return; }

    var reviewed = r.review || [];
    /* the ones worth retrying: wrong, or never answered */
    var toRetry = reviewed.filter(function (x) {
      return x.state === 'wrong' || x.state === 'skipped';
    });

    /* improvement is only shown when there genuinely is a previous score to
       compare against — never invented from a single sitting */
    var prior = db.results.all().filter(function (x) {
      return x.id !== r.id && x.subject === r.subject && x.topic === r.topic && x.at < r.at;
    })[0];
    var delta = prior ? r.pct - prior.pct : null;

    var perf = db.performance();
    var weak = db.weakest();
    var rd = db.readiness();
    var best = perf.best;

    set('<div class="wrap"><div class="col">' +

      /* --- the score --- */
      V.card('✨', 'violet', 'AI Correct & Score',
        '<div class="res-hero">' + V.scoreRing(r.pct) +
        '<div><b>' + r.got + ' / ' + r.max + '</b><span>' + pct(r.pct) + '</span>' +
        '<small>' + esc(r.title) + '</small></div>' +
        (delta !== null
          ? '<div class="res-delta ' + (delta >= 0 ? 'up' : 'down') + '">' +
            (delta >= 0 ? '▲ +' : '▼ ') + Math.abs(delta) + '<i>vs last ' + esc(r.topic) +
            ' (' + prior.pct + '%)</i></div>'
          : '') +
        '</div>' +
        '<div class="grid stats" style="margin-top:16px">' +
        stat('Correct', r.correct, 'green') + stat('Incorrect', r.wrong, 'orange') +
        stat('Unanswered', r.skipped, 'pink') + stat('Revealed', r.revealed || 0, 'gold') +
        stat('Accuracy', pct(r.accuracy), 'violet') + stat('Time used', mmss(r.seconds), 'blue') +
        '</div>') +

      /* --- what next: only actions that can actually run --- */
      V.card('🎯', 'blue', 'What next?',
        '<div class="nextgrid">' +
        (toRetry.length
          ? act('rtRetry', '🔁', 'Retry Incorrect', toRetry.length + ' question' +
              (toRetry.length > 1 ? 's' : '') + ' — new ones on the same skills')
          : '<div class="nx done"><span>✅</span><div><b>Nothing to retry</b>' +
            '<small>You answered every question correctly.</small></div></div>') +
        act('rtSimilar', '🔄', 'Similar Test', 'Same subject, topic and length — new questions') +
        act('rtHarder', '🔥', 'Harder Test', 'Same topic, a step up in difficulty') +
        (weak ? act('rtWeak', '📚', 'Practice ' + esc(weak.topic),
            'Your weakest topic at ' + weak.pct + '%') : '') +
        act('rtReview', '📝', 'Question Review', 'See every question and answer') +
        act('rtPerf', '📊', 'My Performance', 'Where you stand overall') +
        '</div>') +

      /* --- prepare more, from real numbers --- */
      V.card('📚', 'green', 'Prepare More', prepareMore(r, weak)) +

      /* --- improve --- */
      V.card('🚀', 'orange', 'Improve Your Performance',
        '<div class="impr">' +
        '<div><small>Current</small><b>' + pct(r.pct) + '</b></div>' +
        '<div><small>Personal best</small><b>' + pct(best) + '</b></div>' +
        '<div><small>Target</small><b>' + pct(target(r.pct, best)) + '</b></div></div>' +
        (r.pct >= 90
          ? '<p class="gen-hint">You\'re performing strongly here. A harder test is the ' +
            'useful next step.</p>'
          : '<button class="btn btn-v" id="rtTarget" style="margin-top:14px;height:44px">' +
            'Practice toward ' + pct(target(r.pct, best)) + '</button>')) +

      /* --- readiness --- */
      V.card('🎯', 'teal', '7Marks Readiness',
        '<div class="rdy"><b>' + pct(rd.score) + '</b>' +
        '<span>' + esc(rd.note) + '</span></div>' +
        '<div class="bd" style="margin-top:12px">' + rd.parts.map(function (p2) {
          return '<div class="bd-r"><span>' + esc(p2.label) + '</span><span class="t">' +
            '<i style="width:' + p2.value + '%"></i></span>' +
            '<span class="v">' + p2.value + '%</span></div>';
        }).join('') + '</div>') +

      /* --- the question review --- */
      V.card('📝', 'gold', 'Question Review',
        '<div class="revw" id="rtReviewList">' + reviewed.map(function (x) {
          var badge = { correct: ['✓', 'good', 'Correct'], wrong: ['✗', 'low', 'Incorrect'],
                        skipped: ['—', 'mid', 'Unanswered'],
                        revealed: ['🔓', 'mid', 'Revealed'],
                        pending: ['⏳', 'mid', 'Needs marking'] }[x.state] || ['·', 'mid', x.state];
          return '<div class="rv"><div class="rv-b ' + badge[1] + '">' + badge[0] + '</div>' +
            '<div class="rv-m"><b>Q' + x.n + '. ' + esc(x.text) + '</b>' +
            '<span class="rv-s">' + badge[2] + '</span>' +
            (x.state !== 'skipped' && x.given != null
              ? '<small>Your answer: <b>' + esc(String(x.given)) + '</b></small>' : '') +
            (x.answer != null
              ? '<small>Correct answer: <b>' + esc(String(x.answer)) + '</b></small>' : '') +
            '</div></div>';
        }).join('') + '</div>') +

      '</div>' + P.rightRail() + '</div>' + P.footer());

    /* ---- the actions ---- */
    if ($('#rtRetry')) $('#rtRetry').onclick = function () {
      M.gen.runAndPreview({
        subject: r.subject, topic: r.topic, difficulty: r.difficulty || 'Medium',
        count: toRetry.length, qtype: toRetry[0].type || 'mcq',
        marks: toRetry[0].marks || 2,
        basedOn: toRetry.map(function (x) { return x.text; }),
        label: 'AI retry set', note: 'Retry of ' + r.title, prevPct: r.pct,
        wait: 'Building new questions on the ones you missed'
      });
    };
    $('#rtSimilar').onclick = function () { similar(r, r.difficulty || 'Medium'); };
    $('#rtHarder').onclick = function () { similar(r, harder(r.difficulty)); };
    if ($('#rtWeak')) $('#rtWeak').onclick = function () {
      M.gen.runAndPreview({ subject: weak.subject, topic: weak.topic, count: 10,
        difficulty: 'Medium', label: 'AI weak-topic set',
        wait: 'Building questions on ' + weak.topic });
    };
    $('#rtReview').onclick = function () {
      $('#rtReviewList').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    $('#rtPerf').onclick = function () { M.router.go('performance'); };
    if ($('#rtTarget')) $('#rtTarget').onclick = function () {
      M.gen.runAndPreview({ subject: r.subject, topic: r.topic, count: 10,
        difficulty: r.pct < 50 ? 'Easy' : 'Medium', label: 'AI targeted set',
        wait: 'Building a targeted practice set' });
    };
  });

  function similar(r, diff) {
    M.gen.runAndPreview({
      subject: r.subject, topic: r.topic, difficulty: diff,
      count: r.total || 10, marks: Math.max(1, Math.round(r.max / (r.total || 10))),
      label: 'AI similar test', wait: 'Building a ' + diff.toLowerCase() + ' test on ' + r.topic
    });
  }
  function harder(d) {
    return d === 'Easy' ? 'Medium' : d === 'Medium' ? 'Hard' : 'Hard';
  }
  function target(cur, best) {
    var t = Math.max(cur, best) + 10;
    return Math.min(100, Math.ceil(t / 5) * 5);
  }
  function stat(l, v, hue) {
    return '<div class="stat"><small>' + esc(l) + '</small><b style="color:var(--' +
      hue + ')">' + esc(String(v)) + '</b></div>';
  }
  function act(id, em, title, sub) {
    return '<button class="nx" id="' + id + '"><span>' + em + '</span>' +
      '<div><b>' + title + '</b><small>' + sub + '</small></div></button>';
  }

  function prepareMore(r, weak) {
    var lines = [];
    if (r.wrong > 0) {
      lines.push('You missed <b>' + r.wrong + '</b> question' + (r.wrong > 1 ? 's' : '') +
        ' in <b>' + esc(r.topic) + '</b>.');
    }
    if (r.skipped > 0) {
      lines.push('<b>' + r.skipped + '</b> question' + (r.skipped > 1 ? 's were' : ' was') +
        ' left unanswered — worth a second look at pacing.');
    }
    if (weak && weak.topic !== r.topic) {
      lines.push('Across everything you have practised, <b>' + esc(weak.topic) +
        '</b> is still your weakest at ' + weak.pct + '%.');
    }
    if (!lines.length) {
      lines.push('A clean sheet on <b>' + esc(r.topic) + '</b>. The useful next step is a ' +
        'harder set rather than more of the same.');
    }
    return '<p class="gen-lede">' + lines.join(' ') + '</p>' +
      '<div class="pills">' +
      '<button class="pill" data-p="5">Practice 5 questions</button>' +
      '<button class="pill" data-p="10">Practice 10 questions</button>' +
      '<button class="pill" data-p="20">Practice 20 questions</button></div>';
  }

  /* the Prepare More buttons are wired after render, from one delegate */
  d.addEventListener('click', function (e) {
    var b = e.target.closest('[data-p]');
    if (!b || !M.state.history.length) return;
    var r = M.state.history[0];
    M.gen.runAndPreview({ subject: r.subject, topic: r.topic, count: +b.dataset.p,
      difficulty: r.difficulty || 'Medium', label: 'AI practice set',
      wait: 'Building ' + b.dataset.p + ' questions on ' + r.topic });
  });

  /* ============================ PERFORMANCE ============================ */
  M.router.on('performance', function () {
    var p = db.performance();
    if (!p.tests) {
      set('<div class="wrap"><div class="col">' +
        V.card('📊', 'teal', 'My Performance',
          '<div class="empty"><span class="em">📊</span><b>No performance yet</b>' +
          '<small>Complete a few tests to unlock performance insights — everything here is ' +
          'calculated from your actual attempts.</small>' +
          '<a class="btn btn-v" href="#/assistant">Generate your first test</a></div>') +
        '</div>' + P.rightRail() + '</div>' + P.footer());
      return;
    }
    var rd = db.readiness();
    var trend = p.recent.slice(0, 5).reverse();

    set('<div class="wrap"><div class="col">' +
      V.card('📊', 'teal', 'My Performance',
        '<div class="grid stats">' +
        stat('Tests completed', p.tests, 'violet') +
        stat('Questions attempted', p.questions, 'blue') +
        stat('Average accuracy', pct(p.accuracy), 'green') +
        stat('Best score', pct(p.best), 'gold') +
        stat('Average score', pct(p.avgScore), 'teal') +
        stat('Current streak', (M.state.user.streak || 0) + ' days', 'orange') +
        '</div>') +

      V.card('📈', 'violet', 'Recent trend',
        trend.length >= 2
          ? '<div class="trend">' + trend.map(function (t) {
              return '<div class="tr"><span class="tr-bar" style="height:' +
                Math.max(6, t.pct) + '%"></span><b>' + t.pct + '%</b>' +
                '<small>' + esc((t.topic || '').slice(0, 10)) + '</small></div>';
            }).join('') + '</div>'
          : '<div class="empty" style="padding:24px"><span class="em">📈</span>' +
            '<b>Complete more tests to see your progress</b>' +
            '<small>A trend needs at least two results.</small></div>') +

      V.card('📚', 'blue', 'Subject performance',
        '<div class="bd">' + p.bySubject.map(function (s) {
          return '<div class="bd-r"><span>' + esc(s.subject) + '</span><span class="t">' +
            '<i style="width:' + s.pct + '%;background:var(--' +
            (s.pct >= 80 ? 'green' : s.pct >= 55 ? 'violet' : 'orange') + ')"></i></span>' +
            '<span class="v">' + s.pct + '%</span></div>';
        }).join('') + '</div>') +

      V.card('🎯', 'orange', 'Weakest topics',
        '<div class="bd">' + p.byTopic.slice().reverse().slice(0, 6).map(function (t) {
          return '<div class="bd-r"><span>' + esc(t.topic) + '</span><span class="t">' +
            '<i style="width:' + t.pct + '%;background:var(--' +
            (t.pct >= 80 ? 'green' : t.pct >= 55 ? 'violet' : 'orange') + ')"></i></span>' +
            '<span class="v">' + t.pct + '%</span></div>';
        }).join('') + '</div>' +
        '<button class="btn btn-v" id="pfWeak" style="margin-top:14px;height:42px">' +
        'Practice my weakest topic</button>') +

      V.card('🎯', 'teal', '7Marks Readiness',
        '<div class="rdy"><b>' + pct(rd.score) + '</b><span>' + esc(rd.note) + '</span></div>' +
        '<div class="bd" style="margin-top:12px">' + rd.parts.map(function (x) {
          return '<div class="bd-r"><span>' + esc(x.label) + '</span><span class="t">' +
            '<i style="width:' + x.value + '%"></i></span>' +
            '<span class="v">' + x.value + '%</span></div>';
        }).join('') + '</div>') +
      '</div>' + P.rightRail() + '</div>' + P.footer());

    var weak = db.weakest();
    if ($('#pfWeak')) $('#pfWeak').onclick = function () {
      if (!weak) { M.toast('Not enough data yet', 'warn'); return; }
      M.gen.runAndPreview({ subject: weak.subject, topic: weak.topic, count: 10,
        difficulty: 'Medium', label: 'AI weak-topic set',
        wait: 'Building questions on ' + weak.topic });
    };
  });

  /* ============================ QUICK 5 ============================ */
  M.router.on('quick5', function () {
    var last = db.results.all()[0];
    var subj = (last && last.subject) || M.gen.settings.subject;
    var top = (last && last.topic) || M.gen.settings.topic;
    if (!subj || !top) {
      set('<div class="wrap"><div class="col">' +
        V.card('⚡', 'orange', 'Quick 5',
          '<p class="gen-lede">Five questions, straight away. Tell me what on.</p>' +
          '<div class="grid" style="grid-template-columns:1fr 1fr;gap:12px">' +
          '<div><label class="cfg-l">Subject</label><input class="sel" id="q5s" ' +
          'style="width:100%" list="q5sl" placeholder="e.g. Data Structures"><datalist id="q5sl">' +
          db.subjects().map(function (s) { return '<option value="' + esc(s) + '">'; }).join('') +
          '</datalist></div>' +
          '<div><label class="cfg-l">Topic</label><input class="sel" id="q5t" ' +
          'style="width:100%" placeholder="e.g. Binary Trees"></div></div>' +
          '<button class="btn btn-v" id="q5go" style="margin-top:16px;height:46px;width:100%;' +
          'justify-content:center">⚡ Generate 5 questions</button>') +
        '</div>' + P.rightRail() + '</div>' + P.footer());
      $('#q5go').onclick = function () {
        var s = $('#q5s').value.trim(), t = $('#q5t').value.trim();
        if (!s || !t) { M.toast('Enter a subject and topic', 'warn'); return; }
        db.rememberSubject(s); db.rememberTopic(s, t);
        M.gen.runAndPreview({ subject: s, topic: t, count: 5, difficulty: 'Medium',
          label: 'AI quick 5', wait: 'Building 5 questions on ' + t });
      };
      return;
    }
    set('<div class="wrap"><div class="col">' +
      V.card('⚡', 'orange', 'Quick 5', '<div class="empty"><span class="em">⚡</span>' +
        '<b>Five questions on ' + esc(top) + '</b><small>Using your most recent subject and ' +
        'topic.</small></div>') + '</div></div>');
    M.gen.runAndPreview({ subject: subj, topic: top, count: 5, difficulty: 'Medium',
      label: 'AI quick 5', wait: 'Building 5 questions on ' + top });
  });

  /* ============================ PRACTICE MY MISTAKES ============================ */
  w.M7.practiceMistakes = function (howMany) {
    var list = db.mistakeList();
    if (!list.length) { M.toast('No recorded mistakes yet', 'warn'); return; }
    var take = list.slice(0, howMany || list.length);
    var byTopic = {};
    take.forEach(function (m) {
      var k = (m.subject || 'General') + '|' + (m.topic || 'General');
      byTopic[k] = (byTopic[k] || 0) + 1;
    });
    var top = Object.keys(byTopic).sort(function (a, b) { return byTopic[b] - byTopic[a]; })[0];
    var parts = top.split('|');
    M.gen.runAndPreview({
      subject: parts[0], topic: parts[1], count: take.length,
      difficulty: take[0].difficulty || 'Medium',
      basedOn: take.map(function (m) { return m.question; }),
      label: 'AI mistake practice', wait: 'Building questions from your mistakes'
    });
  };
})(window, document);
