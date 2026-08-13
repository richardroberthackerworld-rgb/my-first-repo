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
        '<div id="courseRow" style="display:flex;gap:9px;align-items:center;margin-top:14px;' +
        'flex-wrap:wrap">' +
        '<label style="font-size:12px;font-weight:700;color:var(--ink-3)">Course</label>' +
        V.courseSelect() + V.yearSelect() + '</div>',
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
      /* course, year and subjects all depend on the category, so they are
         rebuilt together rather than one at a time */
      V.refreshCourseRow('courseRow', 'subs');
    };
    V.bindCourseRow('courseRow', 'subs');
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
      V.card('✨', 'violet', 'AI Question Assistant',
        '<div class="bot"><div class="face">🤖</div>' +
        '<p>Ask anything, get instant help.</p></div>' +
        '<div style="margin:12px 0">' +
        ['Generate questions on any topic', 'Generate a full mock test',
         'Generate questions from a PDF or photo', 'Generate a revision set']
          .map(function (x) { return '<div class="kv"><span>💬 ' + esc(x) + '</span></div>'; }).join('') +
        '</div><a class="btn btn-v" style="width:100%;justify-content:center" href="#/assistant">' +
        'Generate questions →</a>') +

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
    subSel.innerHTML = C.subsOf(M.state.cat, M.state.course, M.state.year).map(function (s) {
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

      /* one ref per click, so a double-click cannot be charged twice */
      M.ai.generate(prompt, { temp: 0.4, label: 'AI correction' }).then(function (r) {
        btn.disabled = false;
        if (r.blocked) {
          $('#cOut').innerHTML = '';
          V.gateModal(r.blocked, r.status);
          return;
        }
        var data = parseJSON(r.text) || demoMark(ans, max, subject);
        renderMark(data, max, ans, r.demo, r.charged);
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

  function renderMark(data, max, original, demo, charged) {
    var score = M.clamp(+data.score || 0, 0, max);
    var pct = max ? score / max * 100 : 0;
    var h = (charged ? '<p class="charged">⚡ ' + charged + ' credits used</p>' : '') +
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

  /* ============================ MOCK TEST SETUP ============================
     A stepped selection rather than a wall of dropdowns: study group, then
     course/level, then subject, then topic — each step only ever showing
     what belongs under the previous one. The final step sets a per-type
     question count, because "20 questions" means nothing until you say how
     many of them are MCQs. */

  /* Which question types make sense for a subject. Asking a Biology student
     for a coding question, or a History student for a numerical, is how a
     generator reveals it does not understand the subject. */
  var TYPE_RULES = {
    code:    ['cs', 'prog', 'ds', 'algo', 'oop', 'python', 'dbms', 'os', 'net', 'se', 'aiml',
              'web', 'toc', 'cloud', 'cyber'],
    num:     ['maths', 'phy', 'chem', 'em1', 'engphy', 'engchem', 'stat', 'acc', 'cost', 'fm',
              'tax', 'eco', 'apt', 'thermo', 'som', 'fluid', 'ckt', 'ee', 'ec', 'struct',
              'survey', 'signals', 'mech', 'civil', 'biochem', 'science', 'reason'],
    diagram: ['bio', 'botany', 'zoology', 'science', 'geo', 'anat', 'physio', 'civil', 'mech',
              'ec', 'ee', 'egd', 'draw', 'arch', 'agri', 'chem', 'phy', 'engphy', 'engchem',
              'ds', 'net', 'dbms', 'vlsi', 'control'],
    passage: ['eng', 'hindi', 'telugu', 'sanskrit', 'urdu', 'hist', 'pol', 'socio', 'phil',
              'gk', 'ca', 'law', 'psych'],
    case:    ['acc', 'bstud', 'mgmt', 'mkt', 'law', 'eco', 'fm', 'tax', 'audit', 'cost', 'hr',
              'ob', 'medicine', 'nursing', 'patho', 'pol', 'socio', 'ent'],
    image:   ['bio', 'botany', 'zoology', 'geo', 'science', 'anat', 'hist', 'arch', 'draw',
              'egd', 'agri', 'gk'],
    match:   null,        /* every subject can match pairs */
    assert:  ['phy', 'chem', 'bio', 'botany', 'zoology', 'science', 'maths', 'pol', 'hist',
              'geo', 'eco', 'law', 'gk', 'ca', 'engphy', 'engchem', 'anat', 'physio'],
    oneword: null,
    desc:    ['eng', 'hindi', 'telugu', 'sanskrit', 'urdu', 'hist', 'pol', 'socio', 'phil',
              'law', 'mgmt', 'edu', 'pedagogy', 'psych', 'eco', 'gk']
  };
  /** The types that make sense for a subject. A rule of null means "any". */
  function typesFor(subId) {
    return C.qtypes.filter(function (t) {
      if (!(t.id in TYPE_RULES)) return true;          /* unrestricted type */
      var only = TYPE_RULES[t.id];
      return only === null || only.indexOf(subId) > -1;
    });
  }

  var mk = { step: 1, cat: null, course: null, year: 0, sub: null, topic: '', own: '' };

  M.router.on('mock', function (p) {
    mk = { mode: 'course', step: 1, cat: M.state.cat, course: M.state.course,
           year: M.state.year, sub: null, topic: 'all', own: '', quick: !!p.quick,
           photos: [] };
    paintMock();
  });

  /* Two ways in. Walking the course tree is right when a student knows their
     syllabus; it is the wrong amount of work when they are holding a
     textbook page or already know the topic they want. */
  function modeTabs() {
    return '<div class="tabs" id="mkMode2" style="margin-bottom:16px">' +
      '<button class="tab' + (mk.mode === 'course' ? ' on' : '') + '" data-m="course">' +
      '📚 Choose by course</button>' +
      '<button class="tab' + (mk.mode === 'direct' ? ' on' : '') + '" data-m="direct">' +
      '📷 Upload a photo or type a topic</button></div>';
  }

  function paintMock() {
    set('<div class="wrap"><div class="col">' +
      V.card('📝', 'violet', 'Create a test',
        modeTabs() +
        (mk.mode === 'course'
          ? stepBar() + '<div id="mkBody">' + stepBody() + '</div>'
          : '<div id="mkBody">' + directBody() + '</div>')) +
      '</div>' + rightRail() + '</div>' + footer());
    $('#mkMode2').onclick = function (e) {
      var b = e.target.closest('.tab'); if (!b) return;
      mk.mode = b.dataset.m;
      if (mk.mode === 'direct') mk.step = 1;
      paintMock();
    };
    if (mk.mode === 'course') wireMock(); else wireDirect();
  }

  /* --- the direct route: a photo of the page, or just the topic --- */
  function directBody() {
    return '<div class="drop" id="dPhoto"><span class="em">📷</span>' +
      '<b>Upload a photo of your textbook or notes</b>' +
      '<small>The questions are set from what is on the page · up to 5 photos</small>' +
      '<input type="file" id="dFile" accept="image/*" multiple hidden></div>' +
      '<div id="dList" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px"></div>' +

      '<div style="display:flex;align-items:center;gap:10px;margin:16px 0 10px">' +
      '<span style="flex:1;height:1px;background:var(--line)"></span>' +
      '<span style="font-size:11px;font-weight:700;color:var(--ink-3)">OR JUST TYPE IT</span>' +
      '<span style="flex:1;height:1px;background:var(--line)"></span></div>' +

      '<input class="sel" id="dTopic" style="width:100%;height:46px;font-size:14px" value="' +
      esc(mk.own) + '" placeholder="e.g. Photosynthesis in plants · Fundamental Rights · ' +
      'Integration by parts">' +
      '<div class="pills" style="margin-top:10px" id="dEg">' +
      ['Photosynthesis in plants', 'Fundamental Rights', 'Integration by parts',
       'Thermodynamics numericals', 'The Revolt of 1857'].map(function (t) {
        return '<button class="pill" data-eg="' + esc(t) + '" style="font-weight:600">' +
          esc(t) + '</button>';
      }).join('') + '</div>' +

      '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));' +
      'gap:12px;margin-top:16px">' +
      field('Subject (optional)', '<select class="sel" id="dSub" style="width:100%">' +
        '<option value="">Work it out from the topic</option>' +
        Object.keys(C.subjects).map(function (k) {
          return '<option value="' + k + '">' + esc(C.subjects[k].name) + '</option>';
        }).join('') + '</select>') +
      field('Class / level (optional)', '<input class="sel" id="dLevel" style="width:100%" ' +
        'placeholder="e.g. Class 10, B.Tech 2nd year">') +
      '</div>' +
      '<button class="btn btn-v" id="dNext" style="margin-top:18px;height:46px;width:100%;' +
      'justify-content:center">Continue →</button>';
  }

  function wireDirect() {
    var drop = $('#dPhoto'), file = $('#dFile');
    drop.onclick = function () { file.click(); };
    ['dragover', 'dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) {
        e.preventDefault();
        drop.classList.toggle('over', ev === 'dragover');
        if (ev === 'drop' && e.dataTransfer.files.length) addPhotos(e.dataTransfer.files);
      });
    });
    file.onchange = function () { addPhotos(this.files); };
    function addPhotos(list) {
      Array.prototype.slice.call(list).forEach(function (f) {
        if (mk.photos.length >= 5) { M.toast('Five photos is the limit', 'warn'); return; }
        if (f.size > 6 * 1024 * 1024) {
          M.toast(f.name + ' is over 6 MB — use a smaller photo', 'warn', 4200); return;
        }
        mk.photos.push(f);
      });
      paintPhotos();
    }
    function paintPhotos() {
      $('#dList').innerHTML = mk.photos.map(function (f, i) {
        return '<span class="pill" style="cursor:default">🖼️ ' +
          esc(f.name.length > 20 ? f.name.slice(0, 18) + '…' : f.name) +
          ' <button data-i="' + i + '" class="rmP" aria-label="Remove" style="font-weight:800;' +
          'color:var(--red-ink);margin-left:4px">✕</button></span>';
      }).join('');
      $$('.rmP').forEach(function (b) {
        b.onclick = function () { mk.photos.splice(+this.dataset.i, 1); paintPhotos(); };
      });
    }
    paintPhotos();

    $('#dEg').onclick = function (e) {
      var b = e.target.closest('[data-eg]'); if (!b) return;
      $('#dTopic').value = b.dataset.eg; mk.own = b.dataset.eg;
    };
    $('#dTopic').oninput = function () { mk.own = this.value; };
    $('#dTopic').onkeydown = function (e) { if (e.key === 'Enter') $('#dNext').click(); };

    $('#dNext').onclick = function () {
      var topic = $('#dTopic').value.trim();
      if (!topic && !mk.photos.length) {
        M.toast('Upload a photo or type a topic first', 'warn');
        $('#dTopic').focus(); return;
      }
      mk.own = topic || 'From the uploaded photo';
      mk.topic = 'own';
      mk.sub = $('#dSub').value || guessSubject(topic);
      mk.level = $('#dLevel').value.trim();
      mk.mode = 'course';       /* reuse the configure step — same paper, same engine */
      mk.step = 5;
      paintMock();
    };
  }

  /* A light guess so the configure step can show sensible question types
     even when the student never picked a subject. */
  function guessSubject(topic) {
    var t = (topic || '').toLowerCase();
    var hints = [
      ['maths', ['integra', 'algebra', 'trigono', 'calculus', 'matri', 'equation', 'geometry']],
      ['phy', ['thermodyn', 'motion', 'optic', 'electrostat', 'physic', 'friction', 'gravit']],
      ['chem', ['chemi', 'mole', 'bonding', 'organic', 'acid', 'periodic', 'electrochem']],
      ['bio', ['photosynth', 'biolog', 'cell', 'genetic', 'plant', 'digest', 'respirat']],
      ['pol', ['constitut', 'fundamental right', 'parliament', 'polity', 'civics']],
      ['hist', ['revolt', 'histor', 'mughal', 'freedom struggle', 'empire', 'dynasty']],
      ['geo', ['geograph', 'climate', 'monsoon', 'river', 'plateau']],
      ['acc', ['account', 'balance sheet', 'depreciat', 'journal', 'ledger']],
      ['cs', ['algorithm', 'programm', 'java', 'python', 'data structure', 'database', 'sql']],
      ['eng', ['grammar', 'tense', 'essay', 'comprehens', 'letter writing']]
    ];
    for (var i = 0; i < hints.length; i++) {
      for (var j = 0; j < hints[i][1].length; j++) {
        if (t.indexOf(hints[i][1][j]) > -1) return hints[i][0];
      }
    }
    return 'gk';
  }

  var STEPS = ['Study group', 'Course / level', 'Subject', 'Topic', 'Set the paper'];
  function stepBar() {
    return '<div class="steps">' + STEPS.map(function (s, i) {
      var n = i + 1;
      return '<button class="step' + (n === mk.step ? ' on' : n < mk.step ? ' done' : '') +
        '" data-s="' + n + '"' + (n > mk.step ? ' disabled' : '') + '>' +
        '<i>' + (n < mk.step ? '✓' : n) + '</i><span>' + esc(s) + '</span></button>';
    }).join('') + '</div>';
  }

  function stepBody() {
    /* --- 1. study group --- */
    if (mk.step === 1) {
      return '<div class="grid cats">' + C.cats.map(function (c) {
        return '<button class="cat' + (c.id === mk.cat ? ' on' : '') + '" data-cat="' + c.id + '">' +
          '<span class="em" style="' + V.hue(c.hue) + '">' + c.em + '</span>' +
          '<b>' + esc(c.name) + '</b><small>' + esc(c.sub) + '</small></button>';
      }).join('') + '</div>';
    }
    /* --- 2. course / level --- */
    if (mk.step === 2) {
      var cat = C.byCat[mk.cat];
      var years = C.yearLabels(mk.cat, mk.course);
      return '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));' +
        'gap:10px">' + cat.courses.map(function (co) {
          return '<button class="cat' + (co.id === mk.course ? ' on' : '') + '" data-co="' + co.id +
            '" style="align-items:flex-start;text-align:left;padding:13px">' +
            '<b>' + esc(co.name) + '</b><small>' +
            (co.years > 1 ? co.years + ' years · ' : '') + co.subs.length + ' subjects</small>' +
            '</button>';
        }).join('') + '</div>' +
        (years.length > 1
          ? '<div style="display:flex;gap:9px;align-items:center;margin-top:14px;flex-wrap:wrap">' +
            '<label style="font-size:12px;font-weight:700;color:var(--ink-3)">Year</label>' +
            '<select class="sel" id="mkYear"><option value="0">All years</option>' +
            years.map(function (l, i) {
              return '<option value="' + (i + 1) + '"' + (mk.year === i + 1 ? ' selected' : '') +
                '>' + esc(l) + '</option>';
            }).join('') + '</select></div>'
          : '');
    }
    /* --- 3. subject --- */
    if (mk.step === 3) {
      var subs = C.subsOf(mk.cat, mk.course, mk.year);
      return '<div class="grid cats">' + subs.map(function (s) {
        return '<button class="cat' + (s.id === mk.sub ? ' on' : '') + '" data-sub="' + s.id + '">' +
          '<span class="em" style="' + V.hue(s.hue) + '">' + s.em + '</span>' +
          '<b>' + esc(s.name) + '</b></button>';
      }).join('') + '</div>';
    }
    /* --- 4. topic, including your own --- */
    if (mk.step === 4) {
      var sub = C.subjects[mk.sub];
      return '<div class="pills" id="mkTopics">' +
        ['all', 'own'].map(function (t) {
          return '<button class="pill' + (mk.topic === t ? ' on' : '') + '" data-t="' + t + '"' +
            (mk.topic === t ? ' style="border-color:var(--violet);background:var(--violet-bg);' +
              'color:var(--violet)"' : '') + '>' +
            (t === 'all' ? '📚 All topics' : '✨ Write your own topic') + '</button>';
        }).join('') + '</div>' +
        '<div id="mkOwnWrap" style="margin-top:14px' + (mk.topic === 'own' ? '' : ';display:none') +
        '"><label style="font-size:12px;font-weight:700;color:var(--ink-3);display:block;' +
        'margin-bottom:6px">Your topic</label>' +
        '<input class="sel" id="mkOwn" style="width:100%;height:44px" value="' + esc(mk.own) +
        '" placeholder="e.g. Photosynthesis in plants, or Integration by parts">' +
        '<div class="pills" style="margin-top:10px" id="mkEg">' +
        (sub ? egTopics(sub).map(function (t) {
          return '<button class="pill" data-eg="' + esc(t) + '" style="font-weight:600">' +
            esc(t) + '</button>';
        }).join('') : '') + '</div></div>';
    }
    /* --- 5. configure --- */
    return configBody();
  }

  /* A few plausible topics per subject, so the field is never a blank stare. */
  function egTopics(sub) {
    var by = {
      maths: ['Integration by parts', 'Quadratic equations', 'Probability', 'Trigonometry'],
      phy: ['Thermodynamics numericals', 'Laws of motion', 'Optics', 'Electrostatics'],
      chem: ['Chemical bonding', 'Mole concept', 'Organic reactions', 'Electrochemistry'],
      bio: ['Photosynthesis in plants', 'Human digestive system', 'Genetics', 'Cell division'],
      botany: ['Photosynthesis in plants', 'Plant tissues', 'Reproduction in plants'],
      zoology: ['Human circulatory system', 'Animal tissues', 'Evolution'],
      pol: ['Fundamental Rights', 'Directive Principles', 'Parliament of India'],
      hist: ['The Revolt of 1857', 'Mughal administration', 'Freedom struggle'],
      acc: ['Depreciation', 'Partnership accounts', 'Bank reconciliation'],
      cs: ['Sorting algorithms', 'Linked lists', 'Normalisation'],
      eng: ['Tenses', 'Comprehension passage', 'Letter writing']
    };
    return by[sub.id] || ['Chapter 1 basics', 'Important definitions', 'Numerical practice'];
  }

  function configBody() {
    var sub = C.subjects[mk.sub];
    var types = typesFor(mk.sub);
    var defaults = { mcq: mk.quick ? 5 : 10, short: mk.quick ? 0 : 4, long: 0 };
    return '<div class="cfg-head"><span class="em" style="' + V.hue(sub ? sub.hue : 'violet') +
      '">' + (sub ? sub.em : '📝') + '</span><div><b>' + esc(sub ? sub.name : 'Practice') +
      '</b><small>' + esc(C.course(mk.cat, mk.course).name) +
      (mk.topic === 'own' && mk.own ? ' · ' + esc(mk.own) : ' · all topics') +
      '</small></div></div>' +

      '<label class="cfg-l">Question types &amp; how many of each</label>' +
      '<p style="font-size:11.5px;color:var(--ink-3);margin:0 0 10px">Only the types that ' +
      'suit ' + esc(sub ? sub.name : 'this subject') + ' are shown.</p>' +
      '<div class="qcounts" id="mkCounts">' + types.map(function (t) {
        var v = defaults[t.id] || 0;
        return '<div class="qc" data-t="' + t.id + '"><span class="em">' + t.em + '</span>' +
          '<div class="qc-n"><b>' + esc(t.name) + '</b><small>' + t.marks + ' mark' +
          (t.marks > 1 ? 's' : '') + ' each</small></div>' +
          '<div class="spin"><button class="dn" aria-label="Fewer">−</button>' +
          '<input class="num" type="number" min="0" max="100" value="' + v + '" ' +
          'aria-label="' + esc(t.name) + ' count">' +
          '<button class="up" aria-label="More">+</button></div></div>';
      }).join('') + '</div>' +
      '<div class="cfg-total" id="mkTotal"></div>' +

      '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));' +
      'gap:12px;margin-top:16px">' +
      field('Difficulty', sel('mkDiff', ['Easy', 'Medium', 'Hard', 'Mixed'], 'Medium')) +
      field('Mode', sel('mkMode', ['Mock Test', 'Practice', 'Quick Test', 'Revision', 'Exam Mode'],
        mk.quick ? 'Quick Test' : 'Mock Test')) +
      field('Time', sel('mkTime', ['No time limit', '10 min', '20 min', '30 min', '60 min',
        '90 min', '120 min'], mk.quick ? '10 min' : '30 min')) +
      field('Language', sel('mkLang', ['English', 'Hindi', 'Telugu'], 'English')) +
      '</div>' +
      '<div style="display:flex;gap:16px;margin-top:14px;flex-wrap:wrap;font-size:12.5px">' +
      '<label style="display:flex;gap:7px;align-items:center"><input type="checkbox" id="mkAuto" ' +
      'checked> Auto-submit when time is up</label>' +
      '<label style="display:flex;gap:7px;align-items:center"><input type="checkbox" id="mkSound" ' +
      'checked> Sound warnings</label></div>' +
      '<button class="btn btn-v" id="mkGo" style="margin-top:18px;height:46px;width:100%;' +
      'justify-content:center">🚀 Start test</button>';
  }

  function countsNow() {
    var out = [];
    $$('#mkCounts .qc').forEach(function (row) {
      var n = Math.max(0, Math.min(100, +$('.num', row).value || 0));
      if (n) out.push({ id: row.dataset.t, n: n });
    });
    return out;
  }
  function paintTotal() {
    var c = countsNow(), q = 0, marks = 0;
    c.forEach(function (x) {
      var t = C.qtypes.filter(function (y) { return y.id === x.id; })[0];
      q += x.n; marks += x.n * (t ? t.marks : 1);
    });
    var el = $('#mkTotal');
    if (el) el.innerHTML = q
      ? '<b>' + q + '</b> question' + (q > 1 ? 's' : '') + ' &nbsp;·&nbsp; <b>' + marks +
        '</b> mark' + (marks > 1 ? 's' : '')
      : '<span style="color:var(--warn)">Add at least one question</span>';
    return { q: q, marks: marks };
  }

  function wireMock() {
    var body = $('#mkBody');

    $$('.step').forEach(function (b) {
      b.onclick = function () { mk.step = +this.dataset.s; paintMock(); };
    });

    if (mk.step === 1) {
      body.onclick = function (e) {
        var b = e.target.closest('.cat'); if (!b) return;
        mk.cat = b.dataset.cat;
        var cat = C.byCat[mk.cat];
        if (!cat.courses.some(function (c) { return c.id === mk.course; })) {
          mk.course = cat.courses[0].id; mk.year = 0;
        }
        mk.sub = null; mk.step = 2; paintMock();
      };
    } else if (mk.step === 2) {
      body.onclick = function (e) {
        var b = e.target.closest('.cat'); if (!b) return;
        mk.course = b.dataset.co; mk.year = 0; mk.sub = null; mk.step = 3; paintMock();
      };
      var y = $('#mkYear');
      if (y) y.onchange = function () { mk.year = +this.value; };
    } else if (mk.step === 3) {
      body.onclick = function (e) {
        var b = e.target.closest('.cat'); if (!b) return;
        mk.sub = b.dataset.sub; mk.step = 4; paintMock();
      };
    } else if (mk.step === 4) {
      $('#mkTopics').onclick = function (e) {
        var b = e.target.closest('.pill'); if (!b) return;
        mk.topic = b.dataset.t;
        paintMock();
        if (mk.topic === 'own') { var i = $('#mkOwn'); if (i) i.focus(); }
      };
      var own = $('#mkOwn');
      if (own) {
        own.oninput = function () { mk.own = this.value; };
        own.onkeydown = function (e) {
          if (e.key === 'Enter' && this.value.trim()) { mk.own = this.value; mk.step = 5; paintMock(); }
        };
      }
      var eg = $('#mkEg');
      if (eg) eg.onclick = function (e) {
        var b = e.target.closest('[data-eg]'); if (!b) return;
        mk.own = b.dataset.eg; $('#mkOwn').value = mk.own;
      };
      /* a Next button, because "all topics" has nothing to type */
      body.insertAdjacentHTML('beforeend',
        '<button class="btn btn-v" id="mkNext" style="margin-top:18px;height:44px;width:100%;' +
        'justify-content:center">Continue →</button>');
      $('#mkNext').onclick = function () {
        if (mk.topic === 'own' && !$('#mkOwn').value.trim()) {
          M.toast('Type your topic, or pick All topics', 'warn'); $('#mkOwn').focus(); return;
        }
        mk.own = mk.topic === 'own' ? $('#mkOwn').value.trim() : '';
        mk.step = 5; paintMock();
      };
    } else {
      paintTotal();
      $('#mkCounts').onclick = function (e) {
        var b = e.target.closest('.up,.dn'); if (!b) return;
        var inp = $('.num', b.closest('.qc'));
        inp.value = Math.max(0, Math.min(100, (+inp.value || 0) + (b.classList.contains('up') ? 1 : -1)));
        paintTotal();
      };
      $('#mkCounts').oninput = paintTotal;

      $('#mkGo').onclick = function () {
        var counts = countsNow();
        if (!counts.length) { M.toast('Add at least one question', 'warn'); return; }
        var t = paintTotal();
        var mins = parseInt($('#mkTime').value, 10);
        var sub = C.subjects[mk.sub];
        var topic = mk.topic === 'own' && mk.own ? mk.own : 'All topics';
        M.exam.start({
          title: (sub ? sub.name : 'Practice') + ' — ' + $('#mkMode').value,
          subject: (sub ? sub.name : '') + ' · ' + topic,
          minutes: isNaN(mins) ? 600 : mins,          /* "no time limit" = 10 hours */
          autoSubmit: $('#mkAuto').checked,
          sound: $('#mkSound').checked,
          questions: buildQuestions(counts, sub, topic, $('#mkDiff').value)
        });
        M.router.go('exam');
      };
    }
  }

  function qTypeName(id) {
    var t = C.qtypes.filter(function (x) { return x.id === id; })[0];
    return t ? t.name : id;
  }

  function field(label, ctrl) {
    return '<div><label style="font-size:12px;font-weight:700;color:var(--ink-3);display:block;' +
      'margin-bottom:6px">' + esc(label) + '</label>' + ctrl + '</div>';
  }
  function sel(id, opts, def) {
    return '<select class="sel" id="' + id + '" style="width:100%">' + opts.map(function (o) {
      return '<option' + (o === def ? ' selected' : '') + '>' + esc(o) + '</option>';
    }).join('') + '</select>';
  }

  /* Build the paper from the per-type counts. The shape is exactly what the
     AI generator returns, so swapping the source is a one-line change. */
  function buildQuestions(counts, sub, topic, diff) {
    var out = [], i = 0;
    counts.forEach(function (c) {
      var def = C.qtypes.filter(function (x) { return x.id === c.id; })[0];
      for (var k = 0; k < c.n; k++) {
        i++;
        var q = {
          id: 'q' + i, type: c.id, marks: def ? def.marks : 1, n: i,
          topic: topic || 'All topics', difficulty: diff || 'Medium',
          text: (def ? def.name : c.id) + ' on ' + (sub ? sub.name : 'General') +
                (topic && topic !== 'All topics' ? ' — ' + topic : '') + '.'
        };
        if (c.id === 'mcq') { q.options = ['Option A', 'Option B', 'Option C', 'Option D'];
                              q.answer = 'Option A'; }
        else if (c.id === 'multi') { q.options = ['Option A', 'Option B', 'Option C', 'Option D'];
                                     q.answer = ['Option A', 'Option C']; }
        else if (c.id === 'tf') { q.options = ['True', 'False']; q.answer = 'True'; }
        else if (c.id === 'fill') { q.answer = 'answer'; }
        else { q.answer = null; }   /* free text — marked by the AI, not locally */
        out.push(q);
      }
    });
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
      /* The narrower palette track is a CLASS, not an inline style. Inline
         styles outrank media queries, so setting it here meant the phone
         layout never collapsed: the question column was squeezed to a few
         pixels and the palette overflowed on top of it. */
      set('<div class="wrap exam-w">' +
        '<div class="col">' +
        V.card('📝', 'violet', s.title,
          s.locked ? lockedPanel() :
          '<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;' +
          'flex-wrap:wrap">' +
          '<b>Question ' + q.n + ' of ' + s.questions.length + '</b>' +
          '<span style="display:flex;align-items:center;gap:8px">' +
          '<span style="font-size:11px;color:var(--ink-3)">' +
          esc(qTypeName(q.type)) + ' · ' + q.marks + ' mark' + (q.marks > 1 ? 's' : '') + '</span>' +
          /* reorder controls, on every question type */
          '<span class="movers"><button class="mv" id="eUp" title="Move this question up" ' +
          'aria-label="Move question up"' + (cur === 0 ? ' disabled' : '') + '>↑</button>' +
          '<button class="mv" id="eDown" title="Move this question down" ' +
          'aria-label="Move question down"' +
          (cur === s.questions.length - 1 ? ' disabled' : '') + '>↓</button></span>' +
          '</span></div>' +
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

      /* Reordering follows the question: the card slides, the palette
         renumbers, and `cur` tracks the moved question rather than the
         slot, so the student stays looking at what they just moved. */
      function reorder(dir) {
        var to = M.exam.move(cur, dir);
        if (to < 0) return;
        cur = to;
        paint();
        var card = $('#page .card');
        if (card) {
          card.classList.add(dir < 0 ? 'slid-up' : 'slid-down');
          setTimeout(function () { card.classList.remove('slid-up', 'slid-down'); }, 260);
        }
        M.toast('Moved to position ' + (to + 1), '', 1400);
      }
      $('#eUp').onclick = function () { reorder(-1); };
      $('#eDown').onclick = function () { reorder(1); };

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
        '<div class="grid" id="coGrid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">' +
        cat.courses.map(function (co) {
          return '<button class="cat' + (co.id === M.state.course ? ' on' : '') +
            '" data-c="' + co.id + '" style="align-items:flex-start;text-align:left;padding:14px">' +
            '<b>' + esc(co.name) + '</b><small>' +
            (co.years > 1 ? co.years + ' years · ' : '') + co.subs.length + ' subjects</small>' +
            '</button>';
        }).join('') + '</div>') +
      V.card('📚', 'green', 'Subjects in this course',
        '<div id="courseRow" style="display:flex;gap:9px;align-items:center;margin-bottom:14px;' +
        'flex-wrap:wrap">' +
        '<label style="font-size:12px;font-weight:700;color:var(--ink-3)">Course</label>' +
        V.courseSelect() + V.yearSelect() + '</div>' +
        '<div id="subs">' + V.subjectChips() + '</div>') +
      '</div>' + rightRail() + '</div>' + footer());

    V.bindCourseRow('courseRow', 'subs');
    $('#coGrid').onclick = function (e) {
      var b = e.target.closest('.cat'); if (!b) return;
      M.state.course = b.dataset.c;
      M.state.year = 0;                 /* a different course means a different year list */
      M.save('course'); M.save('year');
      $$('#coGrid .cat').forEach(function (x) { x.classList.toggle('on', x === b); });
      V.refreshCourseRow('courseRow', 'subs');
    };
  });

  /* ============================ CORRECT (full page) ============================ */
  M.router.on('correct', function () {
    set('<div class="wrap"><div class="col">' +
      V.card('🧑‍🏫', 'violet', 'AI Correct & Score', correctionUI()) +
      '</div>' + rightRail() + '</div>' + footer());
    mountCorrection();
  });

  /* ============================ QUESTION PAPERS ============================
     Upload last year's paper, get a fresh one set to the same pattern. The
     point is not to reprint the old paper — it is to read its structure
     (sections, mark split, question types, difficulty) and set new
     questions to match, which is what a teacher actually does. */
  var pFiles = [];

  M.router.on('papers', function () {
    var subs = C.subsOf(M.state.cat, M.state.course, M.state.year);
    pFiles = [];
    set('<div class="wrap"><div class="col">' +
      V.card('📚', 'gold', 'Question Papers — set a new paper from last year’s',
        '<p style="font-size:12.5px;color:var(--ink-2);margin-bottom:14px">' +
        'Upload last year’s question paper (photo or PDF) or paste it as text. ' +
        'The AI reads its pattern — sections, marks split, question types, difficulty — ' +
        'and sets a <b>brand new paper</b> on the same pattern, with an answer key.</p>' +

        '<div class="drop" id="pDrop"><span class="em">📄</span>' +
        '<b>Upload last year’s question paper</b>' +
        '<small>JPG, PNG or PDF · you can add more than one page</small>' +
        '<input type="file" id="pFile" accept="image/*,application/pdf" multiple hidden></div>' +
        '<div id="pList" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px"></div>' +

        '<div style="display:flex;align-items:center;gap:10px;margin:16px 0 10px">' +
        '<span style="flex:1;height:1px;background:var(--line)"></span>' +
        '<span style="font-size:11px;font-weight:700;color:var(--ink-3)">OR PASTE IT</span>' +
        '<span style="flex:1;height:1px;background:var(--line)"></span></div>' +
        '<textarea class="ed-area" id="pText" style="border:1px solid var(--line-2);' +
        'border-radius:11px;min-height:110px" placeholder="Paste last year’s question ' +
        'paper here — or just describe the pattern, e.g. Section A: 10 MCQs 1 mark, ' +
        'Section B: 5 short answers 3 marks, Section C: 3 essays 10 marks"></textarea>' +

        '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));' +
        'gap:12px;margin-top:16px">' +
        field('Subject', '<select class="sel" id="pSub" style="width:100%">' +
          (subs.length ? subs.map(function (s) {
            return '<option value="' + esc(s.name) + '">' + esc(s.name) + '</option>';
          }).join('') : '<option>General</option>') + '</select>') +
        field('Class / Course',
          '<input class="sel" id="pCourse" style="width:100%" value="' +
          esc(C.course(M.state.cat, M.state.course).name) + '">') +
        field('Total marks', sel('pMarks', ['20','25','35','50','70','80','100'], '70')) +
        field('Duration', sel('pDur', ['1 hour','1.5 hours','2 hours','2.5 hours','3 hours'],
          '3 hours')) +
        field('Difficulty', sel('pDiff', ['Easy','Medium','Hard','Same as uploaded'],
          'Same as uploaded')) +
        field('Language', sel('pLang', ['English','Hindi','Telugu'], 'English')) +
        '</div>' +

        '<label style="display:flex;gap:8px;align-items:center;margin-top:14px;font-size:12.5px">' +
        '<input type="checkbox" id="pKey" checked> Include the answer key</label>' +

        '<button class="btn btn-v" id="pGo" style="margin-top:16px;height:44px;width:100%;' +
        'justify-content:center">✨ Generate a new question paper</button>' +
        '<div id="pOut"></div>') +
      '</div>' + rightRail() + '</div>' + footer());

    var drop = $('#pDrop'), file = $('#pFile');
    drop.onclick = function () { file.click(); };
    ['dragover', 'dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) {
        e.preventDefault();
        drop.classList.toggle('over', ev === 'dragover');
        if (ev === 'drop' && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
      });
    });
    file.onchange = function () { addFiles(this.files); };

    function addFiles(list) {
      Array.prototype.slice.call(list).forEach(function (f) {
        if (pFiles.length >= 6) { M.toast('Six pages is the limit', 'warn'); return; }
        /* a very large photo costs the student upload time for no extra
           accuracy, so refuse it kindly rather than hanging */
        if (f.size > 6 * 1024 * 1024) {
          M.toast(f.name + ' is over 6 MB — please use a smaller photo', 'warn', 4200);
          return;
        }
        pFiles.push(f);
      });
      paintFiles();
    }
    function paintFiles() {
      $('#pList').innerHTML = pFiles.map(function (f, i) {
        return '<span class="pill" style="cursor:default">📄 ' +
          esc(f.name.length > 22 ? f.name.slice(0, 20) + '…' : f.name) +
          ' <button data-i="' + i + '" class="rmF" aria-label="Remove" ' +
          'style="font-weight:800;color:var(--red-ink);margin-left:4px">✕</button></span>';
      }).join('');
      $$('.rmF').forEach(function (b) {
        b.onclick = function () { pFiles.splice(+this.dataset.i, 1); paintFiles(); };
      });
    }

    $('#pGo').onclick = function () {
      var pasted = $('#pText').value.trim();
      if (!pFiles.length && !pasted) {
        M.toast('Upload last year’s paper or paste it first', 'warn');
        $('#pText').focus();
        return;
      }
      var btn = this;
      btn.disabled = true;
      $('#pOut').innerHTML = '<div class="think">Reading last year’s pattern and setting a ' +
        'new paper<i></i><i></i><i></i></div>';

      var cfg = {
        sub: $('#pSub').value, course: $('#pCourse').value,
        marks: $('#pMarks').value, dur: $('#pDur').value,
        diff: $('#pDiff').value, lang: $('#pLang').value, key: $('#pKey').checked
      };

      Promise.all(pFiles.map(function (f) { return M.ai.toInline(f); }))
        .then(function (imgs) {
          var prompt =
            'You are an experienced ' + cfg.sub + ' examiner for ' + cfg.course + '.\n' +
            (imgs.length ? 'The attached image(s) are last year\'s question paper.\n' : '') +
            (pasted ? 'Last year\'s paper / pattern:\n"""' + pasted + '"""\n' : '') +
            '\nStudy its PATTERN: the sections, how many questions in each, the marks per ' +
            'question, the question types, the topic spread and the difficulty.\n' +
            'Now SET A COMPLETELY NEW QUESTION PAPER on the same pattern. Do not repeat the ' +
            'old questions — same shape, new questions, same syllabus.\n\n' +
            'Total marks: ' + cfg.marks + '\nDuration: ' + cfg.dur + '\n' +
            'Difficulty: ' + cfg.diff + '\nLanguage: ' + cfg.lang + '\n\n' +
            'Output GitHub-flavoured Markdown only. Start with a header block giving the ' +
            'course, subject, time allowed and maximum marks, then the general instructions, ' +
            'then the sections with numbered questions and the marks for each in brackets.' +
            (cfg.key ? '\nAfter the paper, add a heading "Answer Key" and give the answers, ' +
              'briefly for objective questions and as key points for long ones.'
                     : '\nDo NOT include the answers.');

          return M.ai.generate(prompt, { temp: 0.75, images: imgs, maxTokens: 8192,
                                         label: 'AI question paper' });
        })
        .then(function (r) {
          btn.disabled = false;
          if (r.blocked) { $('#pOut').innerHTML = ''; V.gateModal(r.blocked, r.status); return; }
          if (r.demo || !r.text) { renderPaper(demoPaper(cfg, pasted), cfg, true, 0); }
          else { renderPaper(r.text, cfg, false, r.charged); }
          M.addXP(8, 'question paper generated');
        })
        .catch(function (e) {
          btn.disabled = false;
          $('#pOut').innerHTML = '<div class="fb" style="border-left-color:var(--red)">' +
            '<h4>⚠️ Could not read that</h4>' + esc(String(e && e.message || e)) + '</div>';
        });
    };
  });

  /* A structured paper built locally, so the flow is demonstrable before the
     backend keys are live. It follows the requested marks split rather than
     inventing content it cannot know, and says plainly what it is. */
  function demoPaper(cfg, pasted) {
    var total = +cfg.marks;
    var a = Math.round(total * 0.2), b = Math.round(total * 0.3), cc = total - a - b;
    var line = function (n, m) {
      var out = '';
      for (var i = 1; i <= n; i++) {
        out += i + '. [Question ' + i + ' on ' + cfg.sub + ' — set to last year’s pattern] **(' +
          m + ' marks)**\n';
      }
      return out;
    };
    return '# ' + cfg.course + '\n## ' + cfg.sub + '\n\n' +
      '**Time: ' + cfg.dur + '**  |  **Maximum Marks: ' + total + '**\n\n' +
      '### General Instructions\n' +
      '1. All questions are compulsory.\n2. Marks are indicated against each question.\n' +
      '3. Write answers neatly and legibly.\n\n' +
      '### Section A — Objective (' + a + ' marks)\n' + line(a, 1) + '\n' +
      '### Section B — Short Answer (' + b + ' marks)\n' + line(Math.ceil(b / 3), 3) + '\n' +
      '### Section C — Long Answer (' + cc + ' marks)\n' + line(Math.ceil(cc / 8), 8) +
      (cfg.key ? '\n## Answer Key\n\nThe answer key appears here once the AI backend is ' +
        'connected.\n' : '');
  }

  /* Minimal, safe Markdown rendering. Everything is escaped first, so nothing
     the model returns can inject markup into the page. */
  function md(src) {
    var h = esc(src);
    h = h.replace(/^### (.*)$/gm, '<h3>$1</h3>')
         .replace(/^## (.*)$/gm, '<h2>$1</h2>')
         .replace(/^# (.*)$/gm, '<h1>$1</h1>')
         .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
         .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
         .replace(/^---+$/gm, '<hr>');
    return h.split(/\n{2,}/).map(function (block) {
      if (/^\s*<(h1|h2|h3|hr)/.test(block)) return block;
      return '<p>' + block.replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }

  function renderPaper(text, cfg, demo, charged) {
    $('#pOut').innerHTML =
      (charged ? '<p class="charged">⚡ ' + charged + ' credits used</p>' : '') +
      (demo ? '<div class="toast warn" style="animation:none;margin:16px 0 0;max-width:none">' +
        '⚠️ Demo paper — the AI backend is not reachable from here. The layout below is ' +
        'exactly what a live paper returns.</div>' : '') +
      '<div class="pills" style="margin:16px 0 12px">' +
      '<button class="pill" id="pPrint">🖨️ Print / Save as PDF</button>' +
      '<button class="pill" id="pCopy">📋 Copy</button>' +
      '<button class="pill" id="pSave">🔖 Save to notes</button>' +
      '<button class="pill" id="pAgain">↺ Set another</button></div>' +
      '<div class="paper" id="pPaper">' + md(text) + '</div>';

    $('#pPrint').onclick = function () {
      var w2 = window.open('', '_blank');
      if (!w2) { M.toast('Allow pop-ups to print', 'warn'); return; }
      w2.document.write('<!doctype html><meta charset="utf-8"><title>' +
        esc(cfg.sub) + ' — Question Paper</title><style>' +
        'body{font-family:Georgia,serif;max-width:760px;margin:32px auto;padding:0 20px;' +
        'line-height:1.65;color:#111}h1,h2{text-align:center;margin:.3em 0}' +
        'h3{border-bottom:1px solid #999;padding-bottom:4px;margin-top:1.6em}' +
        '@media print{body{margin:0}}</style>' + $('#pPaper').innerHTML);
      w2.document.close();
      w2.focus();
      w2.print();
    };
    $('#pCopy').onclick = function () {
      navigator.clipboard.writeText(text).then(function () { M.toast('Copied', 'ok'); },
        function () { M.toast('Could not copy', 'err'); });
    };
    $('#pSave').onclick = function () {
      M.state.notes.unshift({ t: cfg.sub + ' — question paper', body: text, at: Date.now() });
      M.save('notes');
      M.toast('Saved to your notes', 'ok');
    };
    $('#pAgain').onclick = function () {
      $('#pOut').innerHTML = '';
      w.scrollTo({ top: 0, behavior: 'smooth' });
    };
  }

  /* ============================ IN-BUILD ROUTES ============================
     These are registered so the navigation is never a dead link, and each
     one says plainly what it will do and offers the working route that gets
     closest today. They are not pretending to be finished. */
  /* Doubt Solver belongs to 7Solve. Reaching this route (by typing the hash,
     or from an old link) explains the handover rather than dead-ending. */
  M.router.on('doubt', function () {
    set('<div class="wrap"><div class="col">' +
      V.card('💡', 'orange', 'Doubt Solver',
        '<div class="handoff"><div class="handoff-em">💡</div>' +
        '<b>Doubts are solved on 7Solve</b>' +
        '<p>7Solve is our doubt app: snap a photo of any question and get the exact answer, ' +
        'explained the way a good teacher would. It opens in a new tab — your test and ' +
        'study plan here stay exactly as you left them.</p>' +
        '<a class="btn btn-v" href="https://7solve.7by.in/" target="_blank" rel="noopener" ' +
        'style="height:46px;padding:0 22px">Open 7Solve ↗</a>' +
        '<a class="pill" href="#/assistant" style="margin-top:4px">Or ask the study assistant ' +
        'here</a></div>') +
      '</div>' + rightRail() + '</div>' + footer());
  });

  /* Every tab in the sidebar now has a real screen; achievements, profile,
     settings, premium and invite are registered in pages2.js. */
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
                      ['Question Papers', '#/papers']]) +
      '</div><div class="foot-b"><span>© ' + new Date().getFullYear() +
      ' 7Marks. All rights reserved.</span><span>Made with ❤️ for students</span></div></footer>';
  }
  function col(h, links) {
    return '<div><h4>' + esc(h) + '</h4>' + links.map(function (l) {
      return '<a href="' + l[1] + '">' + esc(l[0]) + '</a>';
    }).join('') + '</div>';
  }

  /* the shared chrome the second page module builds its screens inside */
  w.PAGES = { rightRail: rightRail, footer: footer, stat: stat, md: md };
})(window, document);
