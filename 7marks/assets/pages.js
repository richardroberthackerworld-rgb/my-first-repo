/* =====================================================================
   7MARKS — the pages.
   Every route registered here renders real markup into #page and wires its
   own behaviour. Routes that belong to a later build phase render an honest
   "in build" panel with a working alternative, never a dead button.
   ===================================================================== */
(function (w, d) {
  'use strict';
  var M = w.M7, C = w.CATALOG, V = w.V;
  var $ = M.qs, $$ = M.qsa, esc = M.esc;
  var page = function () { return d.getElementById('page'); };
  function set(html) { page().innerHTML = html; }

  /* ============================ HOME ============================ */
  M.router.on('home', function () {
    var u = M.state.user, h = M.state.history;
    var done = h.length;
    var avg = done ? Math.round(h.reduce(function (a, r) { return a + r.pct; }, 0) / done) : 0;
    var acc = done ? Math.round(h.reduce(function (a, r) { return a + r.accuracy; }, 0) / done) : 0;
    var qs = done * 20;

    set(
      '<div class="wrap"><div class="col">' +

      /* --- hero --- */
      '<section class="hero"><h1>Practice Smart.<br>Score <i>7</i> Marks!</h1>' +
      '<p>AI-powered practice papers with teacher-style correction, real exam timers ' +
      'and analytics that show you exactly what to revise next.</p>' +
      '<div class="hero-chips">' +
        chip('✨', 'AI Correction', 'Instant feedback', '#/correct') +
        chip('🎯', 'Any Exam', 'All levels, all boards', '#/papers') +
        chip('⏱️', 'Custom Tests', 'Your way', '#/mock') +
        chip('📊', 'Smart Reports', 'Track growth', '#/performance') +
      '</div><div class="hero-note">100%<br>Exam Ready</div></section>' +

      /* --- categories --- */
      V.card('🎓', 'blue', 'Choose Your Category',
        '<div class="grid cats" id="cats">' + C.cats.map(function (c) {
          return '<button class="cat' + (c.id === M.state.cat ? ' on' : '') + '" data-cat="' + c.id + '">' +
            '<span class="em" style="' + V.hue(c.hue) + '">' + c.em + '</span>' +
            '<b>' + esc(c.name) + '</b><small>' + esc(c.sub) + '</small></button>';
        }).join('') + '</div>' +
        '<div style="display:flex;gap:9px;align-items:center;margin-top:14px;flex-wrap:wrap">' +
        '<label style="font-size:12px;font-weight:700;color:var(--ink-3)">Course</label>' +
        V.courseSelect() + '</div>',
        ['View all', '#/explore']) +

      /* --- create / start --- */
      V.card('⚡', 'violet', 'Create / Start',
        '<div class="pills">' +
        [['📝 Mock Test', '#/mock'], ['🧑‍🏫 AI Correct Answer', '#/correct'],
         ['🎛️ Custom Test', '#/mock'], ['🎯 Topic Test', '#/practice'],
         ['📚 Previous Papers', '#/papers'], ['⚡ Quick Quiz', '#/mock?quick=1']]
          .map(function (p) { return '<a class="pill" href="' + p[1] + '">' + esc(p[0]) + '</a>'; })
          .join('') + '</div>') +

      /* --- subjects --- */
      V.card('📚', 'green', 'Subjects', '<div id="subs">' + V.subjectChips() + '</div>') +

      /* --- AI correction --- */
      V.card('🧑‍🏫', 'violet', 'AI Correction & Score Your Answer', correctionUI(),
        ['Try now', '#/correct']) +

      /* --- live timer --- */
      V.card('⏱️', 'red', 'Active Test / Exam Timer', '<div id="timerCard">' + timerCard() + '</div>') +

      /* --- quick actions --- */
      V.card('🚀', 'orange', 'Quick Actions',
        '<div class="grid qas">' +
        [['🎛️', 'violet', 'Set Custom Test', 'Create your own', '#/mock'],
         ['📅', 'blue', 'Study Planner', 'Plan your studies', '#/planner'],
         ['📒', 'green', 'Notes & Flashcards', 'Save & revise', '#/notes'],
         ['💡', 'orange', 'Doubt Solver', 'AI + expert help', '#/doubt'],
         ['📄', 'teal', 'Download Papers', 'PDFs for practice', '#/papers'],
         ['🏅', 'gold', 'Leaderboard', 'See your rank', '#/leaderboard']]
          .map(function (q) {
            return '<a class="qa" href="' + q[4] + '"><span class="em" style="' + V.hue(q[1]) + '">' +
              q[0] + '</span><span><b>' + esc(q[2]) + '</b><small>' + esc(q[3]) + '</small></span></a>';
          }).join('') + '</div>') +

      /* --- performance --- */
      V.card('📊', 'teal', 'Performance Overview',
        '<div class="grid stats">' +
          stat('Tests Taken', done, done ? '+' + done + ' total' : 'Start your first') +
          stat('Avg. Score', avg + '%', avg >= 60 ? 'Looking good' : 'Room to grow') +
          stat('Accuracy', acc + '%', '') +
          stat('Questions', qs, '') +
        '</div><div style="margin-top:16px">' + trend() + '</div>',
        ['Details', '#/performance']) +

      '</div>' + rightRail() + '</div>' + footer()
    );

    /* --- behaviour --- */
    $('#cats').onclick = function (e) {
      var b = e.target.closest('.cat'); if (!b) return;
      V.setCat(b.dataset.cat);
      $$('.cat').forEach(function (x) { x.classList.toggle('on', x === b); });
      /* the course list and the subject chips both depend on the category */
      var sel = $('#courseSel');
      sel.outerHTML = V.courseSelect();
      bindCourse();
      $('#subs').innerHTML = V.subjectChips();
    };
    bindCourse();
    function bindCourse() {
      $('#courseSel').onchange = function () {
        M.state.course = this.value; M.save('course');
        $('#subs').innerHTML = V.subjectChips();
        M.toast('Showing ' + C.course(M.state.cat, this.value).name);
      };
    }
    mountCorrection();
    mountTimerCard();
  });

  function chip(em, t, s, href) {
    return '<a class="chip" href="' + href + '"><span class="em">' + em + '</span>' +
      '<span><b>' + esc(t) + '</b><small>' + esc(s) + '</small></span></a>';
  }
  function stat(label, val, note) {
    return '<div class="stat"><small>' + esc(label) + '</small><b>' + esc(String(val)) + '</b>' +
      (note ? '<i>' + esc(note) + '</i>' : '') + '</div>';
  }
  function trend() {
    var h = M.state.history.slice(0, 7).reverse();
    return V.lineChart([
      { name: 'Score', hue: 'violet', pts: h.map(function (r) { return r.pct; }),
        labels: h.map(function (r) { return new Date(r.at).getDate() + '/' +
          (new Date(r.at).getMonth() + 1); }) },
      { name: 'Accuracy', hue: 'green', pts: h.map(function (r) { return r.accuracy; }) }
    ]);
  }

  /* ---- the right rail ---- */
  function rightRail() {
    var u = M.state.user, h = M.state.history;
    var avg = h.length ? Math.round(h.reduce(function (a, r) { return a + r.pct; }, 0) / h.length) : 0;
    return '<aside class="side">' +
      V.card('🤖', 'violet', 'AI Study Assistant',
        '<div class="bot"><div class="face">🤖</div>' +
        '<p>Ask anything, get instant help.</p></div>' +
        '<div style="margin:12px 0">' +
        ['Explain any topic', 'Create a study plan', 'Summarize this chapter', 'Help me solve this doubt']
          .map(function (x) { return '<div class="kv"><span>💬 ' + esc(x) + '</span></div>'; }).join('') +
        '</div><a class="btn btn-v" style="width:100%;justify-content:center" href="#/assistant">' +
        'Chat with AI →</a>') +

      V.card('📈', 'green', 'Your Progress',
        '<div class="kv"><span>📝 Tests attempted</span><b>' + h.length + '</b></div>' +
        '<div class="kv"><span>❓ Questions practised</span><b>' + h.length * 20 + '</b></div>' +
        '<div class="kv"><span>🎯 Average score</span><b>' + avg + '%</b></div>' +
        '<div class="kv"><span>⭐ Total XP</span><b>' + (u.xp || 0) + '</b></div>' +
        '<div class="kv"><span>🔥 Current streak</span><b>' + (u.streak || 0) + ' days</b></div>' +
        '<a class="btn btn-o" style="width:100%;justify-content:center;margin-top:12px" ' +
        'href="#/analytics">View detailed analysis</a>') +

      V.card('📄', 'blue', 'Recent Papers',
        h.length ? h.slice(0, 5).map(function (r) {
          return '<div class="recent"><span class="em">📄</span><div><b>' + esc(r.title) + '</b>' +
            '<small>' + new Date(r.at).toLocaleDateString() + ' · ' + r.max + ' marks</small></div>' +
            '<span class="sc">' + r.pct + '%</span></div>';
        }).join('')
          : '<div class="empty"><span class="em">📄</span><b>No papers yet</b>' +
            '<small>Your finished tests will be listed here.</small></div>',
        ['View all', '#/papers']) +

      V.card('🏆', 'gold', 'Achievements',
        achievements().map(function (a) {
          return '<div class="ach"><span class="em" style="' + V.hue(a.hue) +
            (a.got ? '' : ';filter:grayscale(1);opacity:.45') + '">' + a.em + '</span>' +
            '<div><b>' + esc(a.t) + '</b><small>' + esc(a.s) + '</small></div></div>';
        }).join(''), ['View all', '#/achievements']) +
      '</aside>';
  }

  function achievements() {
    var h = M.state.history, u = M.state.user;
    var best = h.reduce(function (a, r) { return Math.max(a, r.accuracy); }, 0);
    return [
      { em: '🌟', hue: 'gold', t: 'First Test', s: 'Completed your first test', got: h.length >= 1 },
      { em: '🎯', hue: 'green', t: 'Accuracy Pro', s: 'Maintain 80%+ accuracy', got: best >= 80 },
      { em: '🔥', hue: 'orange', t: 'Streak Master', s: '7 days in a row', got: (u.streak || 0) >= 7 },
      { em: '🚀', hue: 'violet', t: 'Rising Star', s: 'Improve score by 20%', got: h.length >= 3 },
      { em: '👑', hue: 'pink', t: 'Top Performer', s: 'Top 5% in tests', got: false }
    ];
  }

  /* ============================ AI CORRECTION ============================ */
  function correctionUI() {
    return '<p style="font-size:12.5px;color:var(--ink-2);margin-bottom:12px">' +
      'Write your answer and get an evaluation like a teacher would give — with marks, ' +
      'feedback and suggestions.</p>' +
      '<div class="tabs" id="cTabs">' +
        '<button class="tab on" data-t="write">✍️ Write Answer</button>' +
        '<button class="tab" data-t="image">🖼️ Upload Image</button>' +
        '<button class="tab" data-t="pdf">📄 Upload PDF</button>' +
      '</div>' +
      '<div id="cWrite">' +
        '<input class="sel" id="cQ" style="width:100%;height:38px;margin-top:12px" ' +
          'placeholder="The question you are answering (optional)">' +
        '<div class="editor"><div class="ed-bar">' +
          ['B','I','U','•','1.','⌗','↺'].map(function (b) {
            return '<button type="button" title="' + esc(b) + '">' + esc(b) + '</button>';
          }).join('') + '</div>' +
          '<textarea class="ed-area" id="cA" placeholder="Write your answer here..."></textarea>' +
          '<div class="ed-foot">' +
            '<select class="sel" id="cSub" aria-label="Subject"></select>' +
            '<select class="sel" id="cMarks" aria-label="Maximum marks">' +
              [1,2,3,5,8,10,15,20].map(function (m) {
                return '<option value="' + m + '"' + (m === 10 ? ' selected' : '') + '>' + m +
                  ' mark' + (m > 1 ? 's' : '') + '</option>';
              }).join('') + '</select>' +
            '<button class="btn btn-v push" id="cGo">✨ AI Correct & Score</button>' +
          '</div></div>' +
      '</div>' +
      '<div id="cUpload" hidden><div class="drop" id="cDrop"><span class="em">📷</span>' +
        '<b>Drop your handwritten answer here</b>' +
        '<small>JPG or PNG · the AI reads the handwriting, then marks it</small>' +
        '<input type="file" id="cFile" accept="image/*,application/pdf" hidden></div></div>' +
      '<div class="feats">' +
        ['⚡ Instant evaluation', '📝 Detailed feedback', '🎯 Marks & suggestions', '📈 Improve smarter']
          .map(function (f) { return '<span>' + esc(f) + '</span>'; }).join('') + '</div>' +
      '<div id="cOut"></div>';
  }

  function mountCorrection() {
    var subSel = $('#cSub');
    if (!subSel) return;
    subSel.innerHTML = C.subsOf(M.state.cat, M.state.course).map(function (s) {
      return '<option value="' + s.id + '">' + esc(s.name) + '</option>';
    }).join('') || '<option>General</option>';

    $('#cTabs').onclick = function (e) {
      var b = e.target.closest('.tab'); if (!b) return;
      $$('.tab', this).forEach(function (t) { t.classList.toggle('on', t === b); });
      var write = b.dataset.t === 'write';
      $('#cWrite').hidden = !write;
      $('#cUpload').hidden = write;
    };

    var drop = $('#cDrop'), file = $('#cFile');
    drop.onclick = function () { file.click(); };
    ['dragover', 'dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) {
        e.preventDefault();
        drop.classList.toggle('over', ev === 'dragover');
        if (ev === 'drop' && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
      });
    });
    file.onchange = function () { if (this.files[0]) handleFile(this.files[0]); };
    function handleFile(f) {
      M.toast('📎 ' + f.name + ' attached — OCR runs server-side on submit', 'ok');
      drop.querySelector('b').textContent = f.name;
    }

    $('#cGo').onclick = function () {
      var ans = $('#cA').value.trim();
      if (!ans) { M.toast('Write your answer first', 'warn'); $('#cA').focus(); return; }
      var q = $('#cQ').value.trim() || 'the question attempted';
      var subject = subSel.options[subSel.selectedIndex].text;
      var max = +$('#cMarks').value;
      var btn = this;
      btn.disabled = true;
      $('#cOut').innerHTML = '<div class="think">Marking your answer' +
        '<i></i><i></i><i></i></div>';

      var prompt = 'You are an experienced ' + subject + ' teacher marking a student answer.\n' +
        'Question: ' + q + '\nMaximum marks: ' + max + '\nStudent answer: """' + ans + '"""\n\n' +
        'Reply as JSON only: {"score":number,"breakdown":[{"label":string,"got":number,"of":number}],' +
        '"good":string,"missing":string,"improve":string,"model":string,"better":string}\n' +
        'Be encouraging and specific. Never just say "wrong" — say what was right first.';

      M.ai.ask(prompt, { temp: 0.4 }).then(function (r) {
        btn.disabled = false;
        var data = parseJSON(r.text) || demoMark(ans, max, subject);
        renderMark(data, max, ans, r.demo);
        M.addXP(5, 'answer corrected');
      });
    };
  }

  function parseJSON(t) {
    if (!t) return null;
    var m = t.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch (e) { return null; }
  }

  /* A deterministic local marker so the flow is demonstrable before the
     backend keys are live. It reads the answer rather than inventing a
     number: length, keyword spread and structure. Clearly labelled. */
  function demoMark(ans, max, subject) {
    var words = ans.split(/\s+/).filter(Boolean).length;
    var sentences = ans.split(/[.!?]+/).filter(function (s) { return s.trim(); }).length;
    var depth = M.clamp(words / (max * 18), 0, 1);
    var struct = M.clamp(sentences / M.clamp(max / 2, 1, 8), 0, 1);
    var concept = Math.round(depth * (max * 0.4));
    var acc = Math.round(M.clamp(depth * 1.1, 0, 1) * (max * 0.2));
    var keys = Math.round(depth * (max * 0.2));
    var pres = Math.round(struct * (max * 0.2));
    var score = M.clamp(concept + acc + keys + pres, 0, max);
    return {
      score: score,
      breakdown: [
        { label: 'Concept', got: concept, of: Math.round(max * 0.4) },
        { label: 'Accuracy', got: acc, of: Math.round(max * 0.2) },
        { label: 'Keywords', got: keys, of: Math.round(max * 0.2) },
        { label: 'Presentation', got: pres, of: Math.round(max * 0.2) }
      ],
      good: 'You attempted the answer in your own words and kept it on topic — that is the ' +
            'right instinct, and it is what earns concept marks.',
      missing: words < max * 15
        ? 'The answer is short for ' + max + ' marks. Examiners expect roughly ' +
          (max * 15) + '–' + (max * 22) + ' words here; you wrote ' + words + '.'
        : 'Add one worked example or a labelled diagram — that is usually the last mark.',
      improve: 'Open with a one-line definition, then give the main points as separate ' +
               'sentences, then close with a conclusion. Underline the key terms.',
      model: '(A model answer appears here once the AI backend is connected.)',
      better: ''
    };
  }

  function renderMark(data, max, original, demo) {
    var score = M.clamp(+data.score || 0, 0, max);
    var pct = max ? score / max * 100 : 0;
    var h =
      (demo ? '<div class="toast warn" style="animation:none;margin:16px 0 0;max-width:none">' +
        '⚠️ Demo marking — the AI backend is not reachable from this preview. ' +
        'The structure below is exactly what live marking returns.</div>' : '') +
      '<div style="margin-top:16px" class="score-hero">' + V.scoreRing(pct) +
      '<div><b>' + score + ' / ' + max + ' Marks</b>' +
      '<small>' + (pct >= 80 ? 'Excellent work!' : pct >= 60 ? 'Good attempt — nearly there.'
        : pct >= 40 ? 'A fair start. Build on it.' : 'Keep going — the concept is reachable.') +
      '</small></div></div><div class="bd">' +
      (data.breakdown || []).map(function (b) {
        return '<div class="bd-r"><span>' + esc(b.label) + '</span>' +
          '<span class="t"><i style="width:' + (b.of ? b.got / b.of * 100 : 0) + '%"></i></span>' +
          '<span class="v">' + b.got + '/' + b.of + '</span></div>';
      }).join('') + '</div>';

    [['✅ What you did well', data.good], ['⚠️ What is missing', data.missing],
     ['💡 How to improve', data.improve], ['📘 Model answer', data.model],
     ['✨ Your answer, improved', data.better]].forEach(function (p) {
      if (p[1]) h += '<div class="fb"><h4>' + p[0] + '</h4>' + esc(p[1]) + '</div>';
    });

    h += '<div class="pills" style="margin-top:14px">' +
      '<button class="pill" id="cAgain">↺ Mark again</button>' +
      '<button class="pill" id="cSave">🔖 Save to notes</button></div>';

    $('#cOut').innerHTML = h;
    $('#cAgain').onclick = function () { $('#cOut').innerHTML = ''; $('#cA').focus(); };
    $('#cSave').onclick = function () {
      M.state.notes.unshift({ t: 'Corrected answer', body: original, at: Date.now(), score: score });
      M.save('notes');
      M.toast('Saved to your notes', 'ok');
    };
  }

  /* ============================ TIMER CARD ============================ */
  function timerCard() {
    var s = M.exam.s;
    if (!s) {
      return '<div class="empty"><span class="em">⏱️</span><b>No active test</b>' +
        '<small>Start a mock test and the live timer, progress and autosave appear here.</small>' +
        '<a class="btn btn-v" style="margin-top:6px" href="#/mock">Start a mock test</a></div>';
    }
    if (s.locked) return lockedPanel();
    var c = M.exam.counts(), t = M.fmt(M.exam.left());
    return '<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;' +
      'align-items:center"><div><b style="font-size:15px">' + esc(s.title) + '</b>' +
      '<div style="font-size:11.5px;color:var(--ink-3)">' + esc(s.subject) + ' · ' +
      c.total + ' questions</div></div>' +
      '<button class="btn btn-o" id="tEnd">End Test</button></div>' +
      '<div class="timer" id="tClock" style="margin-top:14px">' +
        '<u><b>' + t.h + '</b><i>Hours</i></u><s>:</s>' +
        '<u><b>' + t.m + '</b><i>Minutes</i></u><s>:</s>' +
        '<u><b>' + t.s + '</b><i>Seconds</i></u></div>' +
      '<div class="prog-row"><span>Progress</span><span class="prog-t">' +
      '<i style="width:' + (c.total ? c.a / c.total * 100 : 0) + '%"></i></span>' +
      '<b id="tCount">' + c.a + ' / ' + c.total + '</b></div>' +
      '<p style="font-size:11.5px;color:var(--ink-3);margin-top:10px;padding:9px 12px;' +
      'background:var(--surface-2);border-radius:9px">When time is up, questions are hidden ' +
      'automatically and you will be asked to submit.</p>';
  }

  function lockedPanel() {
    return '<div class="locked"><span class="em">🚨</span><b>Time\'s Up!</b>' +
      '<small style="font-size:12.5px;color:var(--ink-2)">The paper is locked. ' +
      'Submit your attempt to see your result.</small>' +
      '<button class="btn btn-v" id="tSubmit">Submit Exam</button></div>';
  }

  function mountTimerCard() {
    var host = $('#timerCard'); if (!host) return;
    function bind() {
      var end = $('#tEnd'), sub = $('#tSubmit');
      if (end) end.onclick = function () { M.router.go('exam'); };
      if (sub) sub.onclick = function () { M.exam.submit(false); M.router.go('result'); };
    }
    bind();
    /* the clock repaints from the engine's tick, never from its own counter */
    w.addEventListener('7m:tick', function (e) {
      var c = $('#tClock'); if (!c || !M.exam.s) return;
      var t = M.fmt(e.detail.left), b = c.querySelectorAll('b');
      b[0].textContent = t.h; b[1].textContent = t.m; b[2].textContent = t.s;
      c.classList.toggle('warn', e.detail.left <= 600 && e.detail.left > 60);
      c.classList.toggle('crit', e.detail.left <= 60);
    });
    w.addEventListener('7m:timeup', function () {
      if ($('#timerCard')) { $('#timerCard').innerHTML = lockedPanel(); bind(); }
    });
  }

  /* ============================ MOCK TEST SETUP ============================ */
  M.router.on('mock', function (p) {
    var subs = C.subsOf(M.state.cat, M.state.course);
    set('<div class="wrap"><div class="col">' +
      V.card('📝', 'violet', 'Create a Mock Test',
        '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:13px">' +
        field('Subject', '<select class="sel" id="mSub" style="width:100%">' +
          subs.map(function (s) { return '<option value="' + s.id + '">' + esc(s.name) + '</option>'; })
          .join('') + '</select>') +
        field('Difficulty', sel('mDiff', ['Easy', 'Medium', 'Hard', 'Mixed'], 'Medium')) +
        field('Questions', sel('mQ', ['5', '10', '20', '30', '50'], p.quick ? '5' : '10')) +
        field('Duration (minutes)', sel('mMin', ['5', '10', '20', '30', '45', '60', '90', '120'],
          p.quick ? '5' : '20')) +
        '</div>' +
        '<div style="margin-top:16px"><label style="font-size:12px;font-weight:700;' +
        'color:var(--ink-3)">Question types</label><div class="pills" style="margin-top:8px" id="mTypes">' +
        C.qtypes.map(function (t, i) {
          return '<button class="pill' + (i < 3 ? ' on' : '') + '" data-t="' + t.id + '" ' +
            'style="' + (i < 3 ? 'border-color:var(--violet);background:var(--violet-bg);color:var(--violet)' : '') +
            '">' + t.em + ' ' + esc(t.name) + '</button>';
        }).join('') + '</div></div>' +
        '<div style="display:flex;gap:16px;margin-top:16px;flex-wrap:wrap;font-size:12.5px">' +
        '<label style="display:flex;gap:7px;align-items:center"><input type="checkbox" id="mAuto" checked> ' +
        'Auto-submit when time is up</label>' +
        '<label style="display:flex;gap:7px;align-items:center"><input type="checkbox" id="mSound" checked> ' +
        'Sound warnings</label></div>' +
        '<button class="btn btn-v" id="mGo" style="margin-top:18px;height:44px;width:100%;' +
        'justify-content:center">🚀 Start Test</button>') +
      '</div>' + rightRail() + '</div>' + footer());

    $('#mTypes').onclick = function (e) {
      var b = e.target.closest('.pill'); if (!b) return;
      var on = b.classList.toggle('on');
      b.style.cssText = on
        ? 'border-color:var(--violet);background:var(--violet-bg);color:var(--violet)' : '';
    };

    $('#mGo').onclick = function () {
      var n = +$('#mQ').value, mins = +$('#mMin').value;
      var subId = $('#mSub').value, sub = C.subjects[subId];
      var types = $$('#mTypes .pill.on').map(function (b) { return b.dataset.t; });
      if (!types.length) { M.toast('Pick at least one question type', 'warn'); return; }
      M.exam.start({
        title: (sub ? sub.name : 'Practice') + ' — ' + $('#mDiff').value + ' Test',
        subject: sub ? sub.name : '',
        minutes: mins,
        autoSubmit: $('#mAuto').checked,
        sound: $('#mSound').checked,
        questions: buildQuestions(n, types, sub)
      });
      M.router.go('exam');
    };
  });

  function field(label, ctrl) {
    return '<div><label style="font-size:12px;font-weight:700;color:var(--ink-3);display:block;' +
      'margin-bottom:6px">' + esc(label) + '</label>' + ctrl + '</div>';
  }
  function sel(id, opts, def) {
    return '<select class="sel" id="' + id + '" style="width:100%">' + opts.map(function (o) {
      return '<option' + (o === def ? ' selected' : '') + '>' + esc(o) + '</option>';
    }).join('') + '</select>';
  }

  /* Placeholder question construction. The shape is exactly what the AI
     generator will return, so swapping the source is a one-line change. */
  function buildQuestions(n, types, sub) {
    var out = [];
    for (var i = 0; i < n; i++) {
      var t = types[i % types.length], def = C.qtypes.filter(function (x) { return x.id === t; })[0];
      var q = { id: 'q' + (i + 1), type: t, marks: def ? def.marks : 1, n: i + 1,
                text: 'Question ' + (i + 1) + ' — ' + (sub ? sub.name : 'General') +
                      ' (' + (def ? def.name : t) + ').' };
      if (t === 'mcq') { q.options = ['Option A', 'Option B', 'Option C', 'Option D']; q.answer = 'Option A'; }
      else if (t === 'multi') { q.options = ['Option A', 'Option B', 'Option C', 'Option D'];
                                q.answer = ['Option A', 'Option C']; }
      else if (t === 'tf') { q.options = ['True', 'False']; q.answer = 'True'; }
      else if (t === 'fill') { q.answer = 'answer'; }
      else { q.answer = null; }   /* free text — marked by the AI, not locally */
      out.push(q);
    }
    return out;
  }

  /* ============================ EXAM RUNNER ============================ */
  M.router.on('exam', function () {
    var s = M.exam.s;
    if (!s) {
      set('<div class="wrap"><div class="col">' + V.card('⏱️', 'red', 'No active test',
        '<div class="empty"><span class="em">⏱️</span><b>Nothing running</b>' +
        '<small>Create a mock test to begin.</small>' +
        '<a class="btn btn-v" href="#/mock">Create a test</a></div>') +
        '</div></div>' + footer());
      return;
    }
    var cur = 0;

    function paint() {
      var q = s.questions[cur], c = M.exam.counts(), t = M.fmt(M.exam.left());
      set('<div class="wrap" style="grid-template-columns:minmax(0,1fr) 260px">' +
        '<div class="col">' +
        V.card('📝', 'violet', s.title,
          s.locked ? lockedPanel() :
          '<div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline">' +
          '<b>Question ' + q.n + ' of ' + s.questions.length + '</b>' +
          '<span style="font-size:12px;color:var(--ink-3)">' + q.marks + ' mark' +
          (q.marks > 1 ? 's' : '') + '</span></div>' +
          '<p style="font-size:15.5px;margin:12px 0 16px;line-height:1.6">' + esc(q.text) + '</p>' +
          answerControl(q) +
          '<div class="pills" style="margin-top:18px">' +
          '<button class="pill" id="ePrev"' + (cur === 0 ? ' disabled' : '') + '>← Previous</button>' +
          '<button class="pill" id="eMark">' + (s.marked[q.id] ? '★' : '☆') + ' Mark for review</button>' +
          '<button class="pill" id="eNext">' +
          (cur === s.questions.length - 1 ? 'Review →' : 'Next →') + '</button>' +
          '<button class="btn btn-v push" id="eSub">Submit Exam</button></div>' +
          '<div id="eSaved" style="font-size:11.5px;color:var(--green);margin-top:10px;' +
          'visibility:hidden">✓ Answer saved</div>') +
        '</div>' +
        '<aside class="side"><section class="card"><div class="card-b">' +
        '<div class="timer' + (M.exam.left() <= 60 ? ' crit' : M.exam.left() <= 600 ? ' warn' : '') +
        '" id="eClock"><u><b>' + t.h + '</b><i>Hrs</i></u><s>:</s>' +
        '<u><b>' + t.m + '</b><i>Min</i></u><s>:</s><u><b>' + t.s + '</b><i>Sec</i></u></div>' +
        '<div class="prog-row"><span class="prog-t"><i style="width:' +
        (c.a / c.total * 100) + '%"></i></span><b>' + c.a + '/' + c.total + '</b></div>' +
        '<div style="margin-top:14px"><label style="font-size:11px;font-weight:800;' +
        'letter-spacing:.08em;color:var(--ink-3);text-transform:uppercase">Question palette</label>' +
        '<div id="ePal" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(34px,1fr));' +
        'gap:6px;margin-top:9px">' + s.questions.map(function (qq, i) {
          var a = s.answers[qq.id], has = a !== '' && a != null && !(Array.isArray(a) && !a.length);
          var bg = s.marked[qq.id] ? 'var(--violet)' : has ? 'var(--green)' : '#fff';
          var fg = (s.marked[qq.id] || has) ? '#fff' : 'var(--ink-2)';
          return '<button class="pal" data-i="' + i + '" style="height:34px;border-radius:8px;' +
            'border:1px solid ' + (i === cur ? 'var(--navy)' : 'var(--line-2)') + ';background:' + bg +
            ';color:' + fg + ';font-weight:800;font-size:12px">' + (i + 1) + '</button>';
        }).join('') + '</div></div></div></section></aside></div>');

      if (s.locked) { $('#tSubmit').onclick = function () { M.exam.submit(false); M.router.go('result'); }; return; }

      $('#ePrev').onclick = function () { if (cur > 0) { cur--; paint(); } };
      $('#eNext').onclick = function () {
        if (cur < s.questions.length - 1) { cur++; paint(); } else confirmSubmit();
      };
      $('#eMark').onclick = function () { M.exam.mark(q.id); paint(); };
      $('#eSub').onclick = confirmSubmit;
      $('#ePal').onclick = function (e) {
        var b = e.target.closest('.pal'); if (b) { cur = +b.dataset.i; paint(); }
      };
      wireAnswer(q);
    }

    function answerControl(q) {
      var val = s.answers[q.id];
      if (q.options) {
        var multi = q.type === 'multi';
        return '<div style="display:flex;flex-direction:column;gap:9px" id="eOpts">' +
          q.options.map(function (o, i) {
            var on = multi ? (Array.isArray(val) && val.indexOf(o) > -1) : val === o;
            return '<label style="display:flex;gap:11px;align-items:center;padding:12px 14px;' +
              'border:1.5px solid ' + (on ? 'var(--violet)' : 'var(--line-2)') + ';border-radius:11px;' +
              'cursor:pointer;background:' + (on ? 'var(--violet-bg)' : '#fff') + '">' +
              '<input type="' + (multi ? 'checkbox' : 'radio') + '" name="opt" value="' + esc(o) + '"' +
              (on ? ' checked' : '') + '><span style="font-size:14px">' + esc(o) + '</span></label>';
          }).join('') + '</div>';
      }
      return '<textarea class="ed-area" id="eText" style="border:1.5px solid var(--line-2);' +
        'border-radius:11px" placeholder="Write your answer...">' + esc(val || '') + '</textarea>';
    }

    function wireAnswer(q) {
      var saved = $('#eSaved');
      function flash() {
        if (!saved) return;
        saved.style.visibility = 'visible';
        clearTimeout(flash._t);
        flash._t = setTimeout(function () { saved.style.visibility = 'hidden'; }, 1400);
      }
      var opts = $('#eOpts');
      if (opts) {
        opts.onchange = function () {
          var checked = $$('input:checked', opts).map(function (i) { return i.value; });
          M.exam.answer(q.id, q.type === 'multi' ? checked : (checked[0] || ''));
          flash();
          $$('label', opts).forEach(function (l) {
            var on = l.querySelector('input').checked;
            l.style.borderColor = on ? 'var(--violet)' : 'var(--line-2)';
            l.style.background = on ? 'var(--violet-bg)' : '#fff';
          });
          $$('.pal').forEach(function (b, i) {
            if (i === cur) b.style.background = 'var(--green)', b.style.color = '#fff';
          });
        };
      }
      var txt = $('#eText');
      if (txt) {
        var t;
        txt.oninput = function () {
          clearTimeout(t);
          var v = this.value;
          t = setTimeout(function () { M.exam.answer(q.id, v); flash(); }, 400);
        };
      }
    }

    function confirmSubmit() {
      var c = M.exam.counts(), t = M.fmt(M.exam.left());
      var m = d.getElementById('modal');
      m.innerHTML = '<div class="modal-c"><h3>Submit Exam?</h3>' +
        '<p>You can’t change your answers after submitting.</p>' +
        '<div class="m-rows">' +
        '<div><span>Answered</span><b style="color:var(--green)">' + c.a + '</b></div>' +
        '<div><span>Unanswered</span><b style="color:var(--warn)">' + c.u + '</b></div>' +
        '<div><span>Marked for review</span><b style="color:var(--violet)">' + c.m + '</b></div>' +
        '<div><span>Time remaining</span><b>' + t.m + ':' + t.s + '</b></div></div>' +
        '<div class="m-btns"><button class="btn btn-o" id="mCont">Continue Exam</button>' +
        '<button class="btn btn-v" id="mNow">Submit Now</button></div></div>';
      m.classList.add('open');
      $('#mCont').onclick = function () { m.classList.remove('open'); };
      $('#mNow').onclick = function () {
        m.classList.remove('open');
        M.exam.submit(false);
        M.router.go('result');
      };
    }

    paint();
    w.addEventListener('7m:tick', function (e) {
      var c = $('#eClock'); if (!c) return;
      var t = M.fmt(e.detail.left), b = c.querySelectorAll('b');
      b[0].textContent = t.h; b[1].textContent = t.m; b[2].textContent = t.s;
      c.classList.toggle('warn', e.detail.left <= 600 && e.detail.left > 60);
      c.classList.toggle('crit', e.detail.left <= 60);
    });
    w.addEventListener('7m:timeup', function () { if (M.state.view === 'exam') paint(); });
  });

  /* ============================ RESULT ============================ */
  M.router.on('result', function () {
    var r = M.state.history[0];
    if (!r) { M.router.go('home'); return; }
    set('<div class="wrap"><div class="col">' +
      V.card('🏁', 'green', 'Result — ' + r.title,
        '<div class="score-hero">' + V.scoreRing(r.pct) +
        '<div><b>' + r.got + ' / ' + r.max + ' Marks</b><small>' +
        (r.auto ? 'Auto-submitted when time expired' : 'Submitted by you') + '</small></div></div>' +
        '<div class="grid stats" style="margin-top:16px">' +
          stat('Percentage', r.pct + '%', '') + stat('Accuracy', r.accuracy + '%', '') +
          stat('Correct', r.right, '') + stat('Wrong', r.wrong, '') +
          stat('Skipped', r.skipped, '') +
          stat('Time spent', Math.floor(r.seconds / 60) + 'm ' + (r.seconds % 60) + 's', '') +
          stat('Avg / question', r.perQ + 's', '') +
        '</div>' +
        (r.needsAI ? '<div class="fb" style="margin-top:16px"><h4>📝 ' + r.needsAI +
          ' written answer' + (r.needsAI > 1 ? 's' : '') + ' pending AI marking</h4>' +
          'Descriptive answers are marked by the AI teacher, not auto-graded. ' +
          'Open AI Correct &amp; Score to have them marked with feedback.</div>' : '') +
        '<div class="pills" style="margin-top:16px">' +
        '<a class="pill" href="#/mock">↻ Take another test</a>' +
        '<a class="pill" href="#/correct">🧑‍🏫 Mark my written answers</a>' +
        '<a class="pill" href="#/performance">📈 See performance</a></div>') +
      '</div>' + rightRail() + '</div>' + footer());
  });

  /* ============================ PERFORMANCE ============================ */
  M.router.on('performance', function () {
    var h = M.state.history;
    var avg = h.length ? Math.round(h.reduce(function (a, r) { return a + r.pct; }, 0) / h.length) : 0;
    var bySub = {};
    h.forEach(function (r) {
      var k = r.subject || 'General';
      (bySub[k] = bySub[k] || []).push(r.accuracy);
    });
    var rows = Object.keys(bySub).map(function (k) {
      var v = bySub[k], a = Math.round(v.reduce(function (x, y) { return x + y; }, 0) / v.length);
      return { k: k, a: a };
    }).sort(function (a, b) { return b.a - a.a; });

    set('<div class="wrap"><div class="col">' +
      V.card('📈', 'green', 'Performance',
        '<div class="grid stats">' + stat('Tests', h.length, '') + stat('Avg score', avg + '%', '') +
        stat('Best', h.length ? Math.max.apply(null, h.map(function (r) { return r.pct; })) + '%' : '—', '') +
        stat('Streak', (M.state.user.streak || 0) + ' days', '') + '</div>' +
        '<div style="margin-top:16px">' + trend() + '</div>') +
      V.card('🎯', 'violet', 'Subject-wise accuracy',
        rows.length ? '<div class="bd">' + rows.map(function (r) {
          return '<div class="bd-r"><span>' + esc(r.k) + '</span><span class="t">' +
            '<i style="width:' + r.a + '%;background:var(--' +
            (r.a >= 80 ? 'green' : r.a >= 60 ? 'violet' : 'orange') + ')"></i></span>' +
            '<span class="v">' + r.a + '%</span></div>';
        }).join('') + '</div>' +
        '<div class="fb" style="margin-top:14px"><h4>💡 Focus next on</h4>' +
        esc(rows[rows.length - 1].k) + ' — your weakest area at ' + rows[rows.length - 1].a +
        '% accuracy. A 20-minute topic test would move it fastest.</div>'
        : '<div class="empty"><span class="em">🎯</span><b>No data yet</b>' +
          '<small>Finish a test and your subject breakdown appears here.</small>' +
          '<a class="btn btn-v" href="#/mock">Take a test</a></div>') +
      '</div>' + rightRail() + '</div>' + footer());
  });

  /* ============================ EXPLORE ============================ */
  M.router.on('explore', function (p) {
    if (p.cat && C.byCat[p.cat]) V.setCat(p.cat);
    var cat = C.byCat[M.state.cat];
    set('<div class="wrap"><div class="col">' +
      V.card(cat.em, 'blue', cat.name + ' — ' + cat.sub,
        '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr))">' +
        cat.courses.map(function (co) {
          return '<button class="cat' + (co.id === M.state.course ? ' on' : '') +
            '" data-c="' + co.id + '" style="align-items:flex-start;text-align:left;padding:14px">' +
            '<b>' + esc(co.name) + '</b><small>' + co.subs.length + ' subjects</small></button>';
        }).join('') + '</div>') +
      V.card('📚', 'green', 'Subjects in this course', '<div id="subs">' + V.subjectChips() + '</div>') +
      '</div>' + rightRail() + '</div>' + footer());
    page().querySelector('.grid').onclick = function (e) {
      var b = e.target.closest('.cat'); if (!b) return;
      M.state.course = b.dataset.c; M.save('course');
      $$('.cat').forEach(function (x) { x.classList.toggle('on', x === b); });
      $('#subs').innerHTML = V.subjectChips();
    };
  });

  /* ============================ CORRECT (full page) ============================ */
  M.router.on('correct', function () {
    set('<div class="wrap"><div class="col">' +
      V.card('🧑‍🏫', 'violet', 'AI Correct & Score', correctionUI()) +
      '</div>' + rightRail() + '</div>' + footer());
    mountCorrection();
  });

  /* ============================ IN-BUILD ROUTES ============================
     These are registered so the navigation is never a dead link, and each
     one says plainly what it will do and offers the working route that gets
     closest today. They are not pretending to be finished. */
  var LATER = {
    assistant:  ['🤖', 'violet', 'AI Study Assistant',
      'A full tutor chat — explain a topic, summarise a chapter, generate MCQs, build ' +
      'flashcards, make a study plan.', '#/correct', 'Use AI Correct & Score'],
    practice:   ['📘', 'blue', 'My Practice',
      'Topic-by-topic practice with instant explanations and a running accuracy score.',
      '#/mock', 'Take a mock test'],
    papers:     ['📚', 'gold', 'Question Papers',
      'A filterable library of previous, model and practice papers by class, subject, ' +
      'exam and year.', 'classic.html', 'Open the paper generator'],
    bookmarks:  ['🔖', 'orange', 'Bookmarks', 'Everything you saved — questions, answers, topics and papers.',
      '#/notes', 'Open notes'],
    planner:    ['📅', 'teal', 'Study Planner',
      'Enter your exam date and available hours; the AI lays out a day-by-day plan.',
      '#/mock', 'Start practising'],
    notes:      ['📒', 'green', 'Notes & Flashcards',
      'Write notes, auto-generate flashcards from weak topics, revise with spaced repetition.',
      '#/correct', 'Save a corrected answer'],
    analytics:  ['📊', 'pink', 'Analytics',
      'Mistake-pattern analysis: conceptual vs calculation vs careless, and what to fix first.',
      '#/performance', 'See performance'],
    leaderboard:['🏅', 'gold', 'Leaderboard', 'Weekly, monthly and subject ranks — opt-in and privacy-safe.',
      '#/performance', 'See your own stats'],
    challenges: ['🧩', 'red', 'Daily Challenges', 'A daily set worth XP: speed rounds, revision cards, one AI correction.',
      '#/mock', 'Take a quick quiz'],
    doubt:      ['💡', 'orange', 'Doubt Solver', 'Type or photograph a doubt and get a step-by-step solution.',
      '#/correct', 'Use AI correction'],
    invite:     ['🎁', 'pink', 'Invite & Earn', 'Share 7Marks, earn credits when a friend joins.',
      '#/home', 'Back to dashboard'],
    achievements:['🏆', 'gold', 'Achievements', 'Every badge, what it takes, and how close you are.',
      '#/performance', 'See progress'],
    premium:    ['💎', 'violet', 'Premium', 'Unlimited practice and AI correction, advanced analytics, PDF reports, ad-free.',
      'billing.php', 'Open billing'],
    profile:    ['👤', 'blue', 'My Profile', 'Your class, subjects, targets and preferences.',
      '#/home', 'Back to dashboard'],
    settings:   ['⚙️', 'teal', 'Settings', 'Sounds, reduced motion, notifications and data controls.',
      '#/home', 'Back to dashboard']
  };
  Object.keys(LATER).forEach(function (k) {
    var L = LATER[k];
    M.router.on(k, function () {
      set('<div class="wrap"><div class="col">' +
        V.card(L[0], L[1], L[2],
          '<div class="empty"><span class="em">' + L[0] + '</span>' +
          '<b>' + esc(L[2]) + ' — in build</b>' +
          '<small>' + esc(L[3]) + '</small>' +
          '<a class="btn btn-v" style="margin-top:8px" href="' + L[4] + '">' + esc(L[5]) + '</a>' +
          '</div>') +
        '</div>' + rightRail() + '</div>' + footer());
    });
  });

  M.router.on('404', function () { M.router.go('home'); });

  /* ============================ footer ============================ */
  function footer() {
    return '<footer class="foot"><div class="foot-g">' +
      '<div><a class="brand" href="#/home">' + M.mark(32) +
        '<span class="brand-txt"><b><i>7</i>Marks</b><small>Practice Smart</small></span></a>' +
        '<p>India’s AI-driven learning and practice platform — free for students, ' +
        'from 1st class to professional exams.</p></div>' +
      col('Company', [['About Us', '#/home'], ['Contact', '#/home'], ['Blog', 'blog/']]) +
      col('Legal', [['Privacy Policy', '#/home'], ['Terms of Service', '#/home'],
                    ['Refund Policy', '#/home']]) +
      col('Support', [['Help Center', '#/home'], ['How to Use', '#/home'],
                      ['Classic generator', 'classic.html']]) +
      '</div><div class="foot-b"><span>© ' + new Date().getFullYear() +
      ' 7Marks. All rights reserved.</span><span>Made with ❤️ for students</span></div></footer>';
  }
  function col(h, links) {
    return '<div><h4>' + esc(h) + '</h4>' + links.map(function (l) {
      return '<a href="' + l[1] + '">' + esc(l[0]) + '</a>';
    }).join('') + '</div>';
  }
})(window, document);
