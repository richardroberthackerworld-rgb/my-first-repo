/* =====================================================================
   7MARKS — Study Mode, the Study Planner and Question Papers.

   None of these is a new engine. Each one builds a QuestionSet through
   M7.gen.run, hands it to the existing preview, and lets the existing
   attempt engine and result pipeline do the rest. The only thing that
   varies is why the set was made and what happens afterwards.

   Loaded last, so its planner and papers routes replace the placeholders.
   ===================================================================== */
(function (w, d) {
  'use strict';
  var M = w.M7, V = w.V, P = w.PAGES, db = M.db;
  var $ = M.qs, $$ = M.qsa, esc = M.esc;
  function set(html) { d.getElementById('page').innerHTML = html; }
  function today() { return new Date().toISOString().slice(0, 10); }

  /* Only the types the generator can validate into a scorable question.
     Long answer and Match are deliberately absent: they have no
     deterministic key, so a study run built from them could not be
     scored, and offering them would be offering a dead end. */
  var STUDY_TYPES = [
    ['mcq', 'MCQ'], ['multi', 'Multiple Select'], ['tf', 'True / False'],
    ['fill', 'Fill in the Blank'], ['oneword', 'One Word'],
    ['short', 'Short Question'], ['num', 'Numerical'], ['mixed', 'Mixed']
  ];

  function opts(list, sel) {
    return list.map(function (o) {
      var v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o;
      return '<option value="' + esc(String(v)) + '"' +
        (String(v) === String(sel) ? ' selected' : '') + '>' + esc(String(t)) + '</option>';
    }).join('');
  }
  function fld(label, ctrl) {
    return '<div><label class="cfg-l">' + esc(label) + '</label>' + ctrl + '</div>';
  }
  function subjectInput(id, val, listId) {
    return '<input class="sel" id="' + id + '" list="' + listId + '" style="width:100%" ' +
      'placeholder="Type any subject" value="' + esc(val || '') + '">' +
      '<datalist id="' + listId + '">' + db.subjects().map(function (s) {
        return '<option value="' + esc(s) + '">';
      }).join('') + '</datalist>';
  }

  /* ============================ STUDY MODE ============================ */
  var study = { subject: '', topic: '', count: 10, qtype: 'mcq',
                difficulty: 'Medium', mode: 'practice' };

  M.router.on('study', function () {
    var last = db.results.all()[0];
    if (!study.subject && last) { study.subject = last.subject; study.topic = last.topic; }
    set('<div class="wrap"><div class="col">' +
      V.card('📚', 'green', 'Study Mode',
        '<p class="gen-lede">Work through questions at your own pace, or against the clock. ' +
        'It scores exactly like a test when you finish.</p>' +
        '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr));' +
        'gap:12px">' +
        fld('Subject', subjectInput('smSub', study.subject, 'smSubList')) +
        fld('Topic', '<input class="sel" id="smTop" list="smTopList" style="width:100%" ' +
          'placeholder="Type any topic" value="' + esc(study.topic) + '">' +
          '<datalist id="smTopList"></datalist>') +
        fld('Questions', '<select class="sel" id="smCount" style="width:100%">' +
          opts([5, 10, 20, 30], study.count) + '<option value="custom">Custom…</option>' +
          '</select><input class="sel" id="smCountX" type="number" min="1" max="100" ' +
          'style="width:100%;margin-top:7px;display:none" placeholder="How many?">') +
        fld('Question type', '<select class="sel" id="smType" style="width:100%">' +
          opts(STUDY_TYPES, study.qtype) + '</select>') +
        fld('Difficulty', '<select class="sel" id="smDiff" style="width:100%">' +
          opts(['Easy', 'Medium', 'Hard', 'Mixed'], study.difficulty) + '</select>') +
        '</div>' +

        '<label class="cfg-l" style="margin-top:18px">Mode</label>' +
        '<div class="modes" id="smMode">' +
        '<button class="mode' + (study.mode === 'practice' ? ' on' : '') + '" data-m="practice">' +
        '<span>🧘</span><b>Practice</b><small>No countdown — take your time</small></button>' +
        '<button class="mode' + (study.mode === 'timed' ? ' on' : '') + '" data-m="timed">' +
        '<span>⏱</span><b>Timed</b><small>Against the clock, like a real test</small></button>' +
        '</div>' +

        '<button class="btn btn-v" id="smGo" style="margin-top:20px;height:48px;width:100%;' +
        'justify-content:center;font-size:14px">📚 Generate &amp; Study</button>') +
      '</div>' + P.rightRail() + '</div>' + P.footer());

    var sub = $('#smSub');
    var refreshTopics = function () {
      $('#smTopList').innerHTML = db.topics(sub.value).map(function (t) {
        return '<option value="' + esc(t) + '">';
      }).join('');
    };
    sub.oninput = refreshTopics; refreshTopics();
    $('#smCount').onchange = function () {
      $('#smCountX').style.display = this.value === 'custom' ? 'block' : 'none';
    };
    $('#smMode').onclick = function (e) {
      var b = e.target.closest('.mode'); if (!b) return;
      study.mode = b.dataset.m;
      $$('.mode', this).forEach(function (x) { x.classList.toggle('on', x === b); });
    };
    $('#smGo').onclick = function () {
      study.subject = sub.value.trim();
      study.topic = $('#smTop').value.trim();
      study.qtype = $('#smType').value;
      study.difficulty = $('#smDiff').value;
      study.count = $('#smCount').value === 'custom'
        ? M.clamp(+($('#smCountX').value || 10), 1, 100) : +$('#smCount').value;
      if (!study.subject) { M.toast('Enter a subject first', 'warn'); sub.focus(); return; }
      if (!study.topic) { M.toast('Enter a topic first', 'warn'); $('#smTop').focus(); return; }
      db.rememberSubject(study.subject); db.rememberTopic(study.subject, study.topic);
      M.gen.runAndPreview({
        subject: study.subject, topic: study.topic, count: study.count,
        qtype: study.qtype, difficulty: study.difficulty, label: 'AI study set',
        kind: 'study', untimed: study.mode === 'practice',
        wait: 'Building your study set on ' + study.topic
      });
    };
  });

  /* ============================ STUDY PLANNER ============================ */
  var planTab = 'today';

  M.router.on('planner', function () {
    set('<div class="wrap"><div class="col">' +
      V.card('📅', 'teal', 'Study Planner',
        '<div class="tabs" id="plTabs">' +
        [['today', '☀️ Today'], ['all', '🗓️ All sessions'], ['stats', '📊 Study time']]
          .map(function (t) {
            return '<button class="tab' + (planTab === t[0] ? ' on' : '') + '" data-t="' +
              t[0] + '">' + t[1] + '</button>';
          }).join('') + '</div>' +
        '<div id="plBody" style="margin-top:16px">' + planBody() + '</div>') +
      '</div>' + P.rightRail() + '</div>' + P.footer());
    $('#plTabs').onclick = function (e) {
      var b = e.target.closest('.tab'); if (!b) return;
      planTab = b.dataset.t;
      $$('.tab', this).forEach(function (t) { t.classList.toggle('on', t === b); });
      $('#plBody').innerHTML = planBody(); wirePlan();
    };
    wirePlan();
  });

  function planBody() {
    if (planTab === 'stats') return planStats();
    var all = db.sessions.all();
    var list = planTab === 'today'
      ? all.filter(function (s) { return s.date === today(); })
      : all;
    list = list.slice().sort(function (a, b) {
      return (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')) ||
             (b.priority || 0) - (a.priority || 0);
    });

    var rec = recommendation();
    return '<div class="plan-top"><div><b>' +
      (planTab === 'today'
        ? new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
        : all.length + ' session' + (all.length === 1 ? '' : 's')) + '</b>' +
      '<small>' + list.filter(function (s) { return s.status === 'done'; }).length +
      ' of ' + list.length + ' completed</small></div>' +
      '<button class="btn btn-v" id="plAdd">＋ Add session</button></div>' +

      (rec ? '<div class="rec"><div><b>Recommended study</b>' +
        '<small>' + esc(rec.topic) + ' — your recent accuracy is ' + rec.pct + '%</small></div>' +
        '<button class="btn btn-o" id="plRec">Practice now</button></div>' : '') +

      (list.length ? '<div class="hist" style="margin-top:14px">' + list.map(function (s) {
        var pri = ['Low', 'Normal', 'High'][s.priority] || 'Normal';
        return '<div class="hrow" data-id="' + s.id + '">' +
          '<div class="hpct ' + (s.status === 'done' ? 'good' : 'mid') + '">' +
          (s.status === 'done' ? '✓' : s.duration + 'm') + '</div>' +
          '<div class="hmain"><b>' + esc(s.subject) + '</b>' +
          '<small>' + esc(s.topic || 'General') + ' · ' +
          new Date(s.date + 'T00:00').toLocaleDateString() +
          (s.time ? ' · ' + esc(s.time) : '') + ' · ' + pri + ' priority</small>' +
          (s.status === 'done'
            ? '<span class="hmeta">Completed ' + (s.score != null ? '· scored ' + s.score + '%' : '') +
              '</span>'
            : '<span class="hmeta">Not started</span>') + '</div>' +
          '<div class="hact">' +
          (s.status === 'done' ? '' : '<button class="pill" data-a="start">Start</button>') +
          '<button class="pill" data-a="del">Delete</button></div></div>';
      }).join('') + '</div>'
        : '<div class="empty"><span class="em">📅</span><b>No study sessions planned</b>' +
          '<small>Plan your first study session — it will launch real questions on exactly ' +
          'the subject and topic you choose.</small></div>');
  }

  /* A recommendation only ever comes from recorded results. Nothing is
     scheduled automatically; the student presses the button or it does
     not happen. */
  function recommendation() {
    var w2 = db.weakest();
    if (!w2 || w2.pct >= 75) return null;
    return w2;
  }

  function planStats() {
    var done = db.sessions.all().filter(function (s) { return s.status === 'done'; });
    var mins = function (from) {
      return done.filter(function (s) { return s.date >= from; })
        .reduce(function (a, s) { return a + (s.duration || 0); }, 0);
    };
    var week = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
    var month = new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
    if (!done.length) {
      return '<div class="empty"><span class="em">📊</span><b>No completed sessions yet</b>' +
        '<small>Study time is counted only from sessions you actually finish — opening one ' +
        'does not count.</small></div>';
    }
    return '<div class="grid stats">' +
      st('Today', mins(today()) + ' min') + st('This week', mins(week) + ' min') +
      st('This month', mins(month) + ' min') +
      st('Sessions done', done.length) + '</div>' +
      '<p class="gen-hint" style="margin-top:12px">Counted from finished study activity only — ' +
      'a session you opened but did not complete is not included.</p>';
  }
  function st(l, v) {
    return '<div class="stat"><small>' + esc(l) + '</small><b>' + esc(String(v)) + '</b></div>';
  }

  function wirePlan() {
    if ($('#plAdd')) $('#plAdd').onclick = addSession;
    if ($('#plRec')) $('#plRec').onclick = function () {
      var r = recommendation(); if (!r) return;
      M.gen.runAndPreview({ subject: r.subject, topic: r.topic, count: 10,
        difficulty: 'Medium', label: 'AI planner practice', kind: 'study',
        wait: 'Building questions on ' + r.topic });
    };
    var body = $('#plBody');
    if (!body) return;
    body.onclick = function (e) {
      var row = e.target.closest('.hrow'); if (!row) return;
      var b = e.target.closest('[data-a]'); if (!b) return;
      var s = db.sessions.get(row.dataset.id); if (!s) return;
      if (b.dataset.a === 'del') {
        db.sessions.remove(s.id);
        $('#plBody').innerHTML = planBody(); wirePlan();
        M.toast('Session removed');
      } else if (b.dataset.a === 'start') {
        /* Starting launches the real activity. It does NOT mark the session
           done — only finishing the questions does that. */
        M.gen.runAndPreview({
          subject: s.subject, topic: s.topic,
          count: Math.max(5, Math.round((s.duration || 30) / 3)),
          difficulty: 'Medium', label: 'AI planner practice',
          kind: 'study', planId: s.id, untimed: true,
          wait: 'Building your ' + s.duration + ' minute session on ' + (s.topic || s.subject)
        });
      }
    };
  }

  function addSession() {
    var m = d.getElementById('modal');
    m.innerHTML = '<div class="modal-c"><h3>Add a study session</h3>' +
      '<p>Any subject and any topic — type whatever you are studying.</p>' +
      '<div style="margin:16px 0;display:flex;flex-direction:column;gap:12px">' +
      fld('Subject', subjectInput('asSub', '', 'asSubList')) +
      fld('Topic', '<input class="sel" id="asTop" style="width:100%" ' +
        'placeholder="e.g. Quadratic Equations">') +
      '<div style="display:flex;gap:10px">' +
      '<div style="flex:1">' + fld('Date', '<input class="sel" id="asDate" type="date" ' +
        'style="width:100%" value="' + today() + '">') + '</div>' +
      '<div style="flex:1">' + fld('Start time', '<input class="sel" id="asTime" type="time" ' +
        'style="width:100%">') + '</div></div>' +
      '<div style="display:flex;gap:10px">' +
      '<div style="flex:1">' + fld('Duration', '<select class="sel" id="asMins" style="width:100%">' +
        opts([15, 30, 45, 60, 90, 120], 45) + '</select>') + '</div>' +
      '<div style="flex:1">' + fld('Priority', '<select class="sel" id="asPri" style="width:100%">' +
        '<option value="2">High</option><option value="1" selected>Normal</option>' +
        '<option value="0">Low</option></select>') + '</div></div></div>' +
      '<div class="m-btns"><button class="btn btn-o" id="asCancel">Cancel</button>' +
      '<button class="btn btn-v" id="asSave">Add session</button></div></div>';
    m.classList.add('open');
    $('#asCancel').onclick = function () { m.classList.remove('open'); };
    $('#asSave').onclick = function () {
      var subject = $('#asSub').value.trim();
      if (!subject) { M.toast('Enter a subject', 'warn'); $('#asSub').focus(); return; }
      var topic = $('#asTop').value.trim();
      db.rememberSubject(subject); db.rememberTopic(subject, topic);
      db.sessions.add({
        subject: subject, topic: topic, date: $('#asDate').value || today(),
        time: $('#asTime').value || '', duration: +$('#asMins').value,
        priority: +$('#asPri').value, status: 'planned', createdAt: Date.now()
      });
      m.classList.remove('open');
      $('#plBody').innerHTML = planBody(); wirePlan();
      M.toast('Session added', 'ok');
    };
  }

  /* A planned session completes when its activity is finished — not when it
     is opened, and not when it is started. */
  w.addEventListener('7m:result', function (e) {
    var r = e.detail;
    if (!r || !r.planId) return;
    db.sessions.update(r.planId, { status: 'done', score: r.pct, doneAt: Date.now() });
    M.notify('✅', 'Study session complete', r.subject + ' · ' + r.topic + ' — ' + r.pct + '%');
  });

  /* ============================ QUESTION PAPERS ============================ */
  M.router.on('papers', function () {
    var papers = db.results.all().filter(function (r) { return r.kind === 'paper'; });
    set('<div class="wrap"><div class="col">' +
      V.card('📝', 'gold', 'Question Papers',
        '<p class="gen-lede">Set a full paper and sit it under exam conditions. ' +
        'Build one from a format, or photograph a real paper and get a new one on the ' +
        'same pattern.</p>' +

        /* Stated plainly: there is no previous-year database in this build. */
        '<div class="srcnote"><span>ℹ️</span><div><b>No previous-year database yet</b>' +
        '<p>7Marks does not ship a library of real past papers, so none are listed — ' +
        'inventing them would be worse than saying so. You can build a paper to an exam ' +
        'format below, or upload a photo of a real paper and get a new one on its pattern.</p>' +
        '</div></div>' +

        '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));' +
        'gap:12px;margin-top:16px">' +
        fld('Subject', subjectInput('qpSub', '', 'qpSubList')) +
        fld('Exam / course', '<input class="sel" id="qpExam" list="qpExamList" ' +
          'style="width:100%" placeholder="Type any exam or course">' +
          '<datalist id="qpExamList">' +
          ['Class 10', 'Class 12', 'Intermediate', 'JEE Main', 'NEET', 'UPSC', 'SSC',
           'B.Tech', 'CA Foundation', 'Banking'].map(function (x) {
            return '<option value="' + x + '">'; }).join('') + '</datalist>') +
        fld('Total marks', '<select class="sel" id="qpMarks" style="width:100%">' +
          opts([20, 35, 50, 70, 80, 100], 70) + '</select>') +
        fld('Duration', '<select class="sel" id="qpMin" style="width:100%">' +
          opts([30, 45, 60, 90, 120, 180], 60) + '</select>') +
        fld('Difficulty', '<select class="sel" id="qpDiff" style="width:100%">' +
          opts(['Easy', 'Medium', 'Hard', 'Mixed'], 'Medium') + '</select>') +
        fld('Language', '<select class="sel" id="qpLang" style="width:100%">' +
          opts(['English', 'Hindi', 'Telugu', 'Tamil', 'Kannada'], 'English') + '</select>') +
        '</div>' +
        '<button class="btn btn-v" id="qpGo" style="margin-top:18px;height:46px;width:100%;' +
        'justify-content:center">📝 Set the paper</button>' +

        '<p class="gen-hint" style="margin-top:14px">Have a real paper? ' +
        '<a href="#/assistant" style="color:var(--violet);font-weight:700">Photograph it in the ' +
        'Question Assistant</a> and questions are set from the page itself.</p>') +

      (papers.length
        ? V.card('🗂️', 'blue', 'Papers you have sat',
            '<div class="hist">' + papers.map(function (r) {
              return '<div class="hrow"><div class="hpct ' +
                (r.pct >= 70 ? 'good' : r.pct >= 40 ? 'mid' : 'low') + '">' + r.pct + '%</div>' +
                '<div class="hmain"><b>' + esc(r.title) + '</b>' +
                '<small>Question Paper · ' + esc(r.subject) + ' · ' +
                new Date(r.at).toLocaleDateString() + '</small>' +
                '<span class="hmeta">' + r.correct + '/' + r.total + ' correct · ' +
                r.got + '/' + r.max + ' marks</span></div></div>';
            }).join('') + '</div>')
        : '') +
      '</div>' + P.rightRail() + '</div>' + P.footer());

    $('#qpGo').onclick = function () {
      var subject = $('#qpSub').value.trim();
      var exam = $('#qpExam').value.trim();
      if (!subject) { M.toast('Enter a subject', 'warn'); $('#qpSub').focus(); return; }
      var marks = +$('#qpMarks').value, mins = +$('#qpMin').value;
      var perQ = 2;
      var count = M.clamp(Math.round(marks / perQ), 5, 60);
      db.rememberSubject(subject);
      M.gen.runAndPreview({
        subject: subject, topic: exam || 'Full syllabus',
        count: count, marks: perQ, difficulty: $('#qpDiff').value,
        language: $('#qpLang').value, minutes: mins,
        label: 'AI question paper', kind: 'paper', source: 'paper',
        wait: 'Setting a ' + marks + ' mark paper' + (exam ? ' in ' + exam + ' format' : '')
      });
    };
  });
})(window, document);
