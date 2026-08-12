/* =====================================================================
   7MARKS — the question generator, the preview, and the sets it produces.

   The whole flow lives here:
     source (topic / pasted text / image)  ->  AI generation
       ->  validation into the engine's question shape
       ->  preview with answers hidden
       ->  Start Test, which is the ONLY thing that starts the clock
       ->  the existing unified attempt + result engine

   Nothing in this file touches localStorage. Everything durable goes
   through M7.db, so the Phase B migration to server storage is a driver
   swap rather than a rewrite.
   ===================================================================== */
(function (w, d) {
  'use strict';
  var M = w.M7, C = w.CATALOG, V = w.V, P = w.PAGES, db = M.db;
  var $ = M.qs, $$ = M.qsa, esc = M.esc;
  var page = function () { return d.getElementById('page'); };
  function set(html) { page().innerHTML = html; }

  /* the generator's working state; the source file is held in memory only */
  var gen = {
    source: 'topic', subject: '', topic: '', text: '', file: null,
    qtype: 'mcq', count: 10, difficulty: 'Medium', marks: 2, lang: 'English',
    minutes: null, busy: false
  };
  var pending = null;      /* the generated set awaiting Start Test */

  var QTYPES = [
    ['mcq', 'MCQ'], ['multi', 'Multiple Select'], ['tf', 'True / False'],
    ['fill', 'Fill in the Blank'], ['oneword', 'One Word'], ['short', 'Short Question'],
    ['long', 'Long Question'], ['num', 'Numerical'], ['assert', 'Assertion & Reason'],
    ['match', 'Match the Following'], ['mixed', 'Mixed']
  ];

  function opts(list, sel) {
    return list.map(function (o) {
      var v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o;
      return '<option value="' + esc(String(v)) + '"' +
        (String(v) === String(sel) ? ' selected' : '') + '>' + esc(String(t)) + '</option>';
    }).join('');
  }

  /* ============================ THE GENERATOR ============================ */
  M.router.on('assistant', function () {
    if (!gen.subject) gen.subject = db.subjects()[0] || '';
    set('<div class="wrap"><div class="col">' +
      V.card('✨', 'violet', 'AI Question Assistant',
        '<p class="gen-lede">Generate questions from a topic, your notes or a photo, ' +
        'and turn them into a timed test.</p>' +

        '<label class="cfg-l">Generate from</label>' +
        '<div class="srcs" id="gSrc">' +
        [['topic', '🎯', 'Topic'], ['text', '📋', 'Paste text'],
         ['image', '🖼️', 'Upload image'], ['pdf', '📄', 'Upload PDF']].map(function (s) {
          return '<button class="src' + (gen.source === s[0] ? ' on' : '') + '" data-s="' +
            s[0] + '"><span>' + s[1] + '</span><b>' + esc(s[2]) + '</b></button>';
        }).join('') + '</div>' +

        '<div id="gBody">' + sourceBody() + '</div>' +

        '<label class="cfg-l" style="margin-top:18px">Settings</label>' +
        '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));' +
        'gap:11px">' +
        fld('Question type', '<select class="sel" id="gType" style="width:100%">' +
          opts(QTYPES, gen.qtype) + '</select>') +
        fld('Questions', '<select class="sel" id="gCount" style="width:100%">' +
          opts([5, 10, 20, 30, 50], gen.count) + '<option value="custom">Custom…</option>' +
          '</select><input class="sel" id="gCountX" type="number" min="1" max="100" ' +
          'style="width:100%;margin-top:7px;display:none" placeholder="How many?">') +
        fld('Difficulty', '<select class="sel" id="gDiff" style="width:100%">' +
          opts(['Easy', 'Medium', 'Hard', 'Mixed'], gen.difficulty) + '</select>') +
        fld('Marks each', '<select class="sel" id="gMarks" style="width:100%">' +
          opts([1, 2, 3, 5, 10], gen.marks) + '</select>') +
        fld('Language', '<select class="sel" id="gLang" style="width:100%">' +
          opts(['English', 'Hindi', 'Telugu', 'Tamil', 'Kannada', 'Marathi', 'Bengali'],
            gen.lang) + '</select>') +
        fld('Time limit', '<select class="sel" id="gMin" style="width:100%">' +
          '<option value="">Auto (1.5 min / question)</option>' +
          opts([5, 10, 15, 20, 30, 45, 60, 90], gen.minutes) + '</select>') +
        '</div>' +

        '<button class="btn btn-v" id="gGo" style="margin-top:20px;height:48px;width:100%;' +
        'justify-content:center;font-size:14px">✨ Generate Questions</button>' +
        '<div id="gOut"></div>') +
      '</div>' + P.rightRail() + '</div>' + P.footer());
    wireGen();
  });

  function fld(label, ctrl) {
    return '<div><label class="cfg-l">' + esc(label) + '</label>' + ctrl + '</div>';
  }

  function sourceBody() {
    if (gen.source === 'topic') {
      return '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr));' +
        'gap:12px;margin-top:12px">' +
        fld('Subject', '<input class="sel" id="gSubject" list="subjList" style="width:100%" ' +
          'placeholder="Type any subject — e.g. Data Structures" value="' + esc(gen.subject) +
          '"><datalist id="subjList">' +
          db.subjects().map(function (s) { return '<option value="' + esc(s) + '">'; }).join('') +
          '</datalist>') +
        fld('Topic', '<input class="sel" id="gTopic" list="topicList" style="width:100%" ' +
          'placeholder="Type any topic — e.g. Binary Trees" value="' + esc(gen.topic) +
          '"><datalist id="topicList"></datalist>') +
        '</div><p class="gen-hint">Anything you type is remembered and offered back next time.</p>';
    }
    if (gen.source === 'text') {
      return '<textarea class="ed-area" id="gText" style="border:1px solid var(--line-2);' +
        'border-radius:11px;min-height:150px;margin-top:12px" placeholder="Paste notes, ' +
        'textbook content, syllabus material or study content here...">' + esc(gen.text) +
        '</textarea>' +
        '<div class="grid" style="grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">' +
        fld('Subject (optional)', '<input class="sel" id="gSubject" list="subjList" ' +
          'style="width:100%" placeholder="Worked out from the text if blank" value="' +
          esc(gen.subject) + '"><datalist id="subjList">' +
          db.subjects().map(function (s) { return '<option value="' + esc(s) + '">'; }).join('') +
          '</datalist>') +
        fld('Topic (optional)', '<input class="sel" id="gTopic" style="width:100%" value="' +
          esc(gen.topic) + '">') + '</div>';
    }
    if (gen.source === 'image') {
      return '<div class="drop" id="gDrop" style="margin-top:12px"><span class="em">🖼️</span>' +
        '<b>Upload a photo of your notes or textbook page</b>' +
        '<small>Printed or handwritten · the page is read by the AI and questions are set ' +
        'from what is on it</small>' +
        '<input type="file" id="gFile" accept="image/*" hidden></div>' +
        '<div id="gPrev"></div>' +
        '<div class="grid" style="grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">' +
        fld('Subject (optional)', '<input class="sel" id="gSubject" style="width:100%" ' +
          'value="' + esc(gen.subject) + '">') +
        fld('Topic (optional)', '<input class="sel" id="gTopic" style="width:100%" ' +
          'value="' + esc(gen.topic) + '">') + '</div>';
    }
    /* PDF — stated plainly rather than faked */
    return '<div class="notsup" style="margin-top:12px"><span class="em">📄</span>' +
      '<b>PDF is not supported yet</b>' +
      '<p>Reading a PDF in the browser needs a PDF text-extraction library that is not part ' +
      'of this build, and the AI pipeline currently accepts text and images only. Rather than ' +
      'pretend, here is what works today:</p>' +
      '<div class="pills" style="justify-content:center;margin-top:12px">' +
      '<button class="pill" data-sw="image">🖼️ Photograph the page instead</button>' +
      '<button class="pill" data-sw="text">📋 Paste the text instead</button></div></div>';
  }

  function wireGen() {
    $('#gSrc').onclick = function (e) {
      var b = e.target.closest('.src'); if (!b) return;
      readInputs();
      gen.source = b.dataset.s;
      $$('.src', this).forEach(function (x) { x.classList.toggle('on', x === b); });
      $('#gBody').innerHTML = sourceBody();
      wireSource();
    };
    wireSource();

    $('#gCount').onchange = function () {
      $('#gCountX').style.display = this.value === 'custom' ? 'block' : 'none';
    };
    $('#gGo').onclick = generate;
  }

  function wireSource() {
    var subj = $('#gSubject');
    if (subj) subj.oninput = function () {
      gen.subject = this.value;
      var dl = $('#topicList');
      if (dl) dl.innerHTML = db.topics(this.value).map(function (t) {
        return '<option value="' + esc(t) + '">';
      }).join('');
    };
    if (subj && $('#topicList')) {
      $('#topicList').innerHTML = db.topics(subj.value).map(function (t) {
        return '<option value="' + esc(t) + '">';
      }).join('');
    }
    var drop = $('#gDrop'), file = $('#gFile');
    if (drop) {
      drop.onclick = function () { file.click(); };
      ['dragover', 'dragleave', 'drop'].forEach(function (ev) {
        drop.addEventListener(ev, function (e) {
          e.preventDefault();
          drop.classList.toggle('over', ev === 'dragover');
          if (ev === 'drop' && e.dataTransfer.files[0]) takeFile(e.dataTransfer.files[0]);
        });
      });
      file.onchange = function () { if (this.files[0]) takeFile(this.files[0]); };
    }
    var swap = $('#gBody');
    if (swap) swap.addEventListener('click', function (e) {
      var b = e.target.closest('[data-sw]'); if (!b) return;
      gen.source = b.dataset.sw;
      M.router.go('assistant');
    });
  }

  function takeFile(f) {
    if (f.size > 6 * 1024 * 1024) {
      M.toast('That image is over 6 MB — please use a smaller photo', 'warn', 4200);
      return;
    }
    gen.file = f;
    var url = URL.createObjectURL(f);
    $('#gPrev').innerHTML = '<div class="imgprev"><img src="' + url + '" alt="Uploaded page">' +
      '<div><b>' + esc(f.name) + '</b><small>' + Math.round(f.size / 1024) + ' KB</small>' +
      '<button class="pill" id="gRm">Remove</button></div></div>';
    $('#gRm').onclick = function () {
      gen.file = null; URL.revokeObjectURL(url); $('#gPrev').innerHTML = '';
    };
  }

  function readInputs() {
    if ($('#gSubject')) gen.subject = $('#gSubject').value.trim();
    if ($('#gTopic')) gen.topic = $('#gTopic').value.trim();
    if ($('#gText')) gen.text = $('#gText').value;
    if ($('#gType')) gen.qtype = $('#gType').value;
    if ($('#gDiff')) gen.difficulty = $('#gDiff').value;
    if ($('#gMarks')) gen.marks = +$('#gMarks').value;
    if ($('#gLang')) gen.lang = $('#gLang').value;
    if ($('#gMin')) gen.minutes = $('#gMin').value ? +$('#gMin').value : null;
    if ($('#gCount')) {
      gen.count = $('#gCount').value === 'custom'
        ? M.clamp(+($('#gCountX').value || 10), 1, 100) : +$('#gCount').value;
    }
  }

  /* ---------------------------------------------------------------------
     VALIDATION
     An AI response is untrusted input. Every question is normalised into
     the engine's shape and anything that cannot be made safe is dropped
     rather than allowed to reach the test UI and break a live attempt.
     --------------------------------------------------------------------- */
  function validate(raw, cfg) {
    var out = [], n = 0;
    (Array.isArray(raw) ? raw : []).forEach(function (q) {
      if (!q || typeof q !== 'object') return;
      var text = String(q.question || q.text || '').trim();
      if (!text) return;
      var type = String(q.type || cfg.qtype || 'mcq').toLowerCase();
      if (!QTYPES.some(function (t) { return t[0] === type; })) type = 'mcq';

      var options = Array.isArray(q.options)
        ? q.options.map(function (o) { return String(o).trim(); }).filter(Boolean) : null;
      var answer = q.answer != null ? q.answer : (q.correct != null ? q.correct : null);

      if (type === 'mcq' || type === 'assert') {
        if (!options || options.length < 2) return;              /* unusable */
        if (Array.isArray(answer)) answer = answer[0];
        answer = answer == null ? null : String(answer).trim();
        /* an answer given as A/B/C/D or as an index is mapped onto the option */
        if (answer && options.indexOf(answer) < 0) {
          var i = /^[A-Za-z]$/.test(answer) ? answer.toUpperCase().charCodeAt(0) - 65
                : (/^\d+$/.test(answer) ? +answer : -1);
          answer = (i >= 0 && i < options.length) ? options[i] : null;
        }
        if (!answer) return;                                     /* no key, no question */
      } else if (type === 'multi') {
        if (!options || options.length < 2) return;
        answer = (Array.isArray(answer) ? answer : [answer]).map(function (a) {
          a = String(a).trim();
          if (options.indexOf(a) > -1) return a;
          var i = /^[A-Za-z]$/.test(a) ? a.toUpperCase().charCodeAt(0) - 65 : -1;
          return (i >= 0 && i < options.length) ? options[i] : null;
        }).filter(Boolean);
        if (!answer.length) return;
      } else if (type === 'tf') {
        options = ['True', 'False'];
        answer = /true|^t$|correct/i.test(String(answer)) ? 'True' : 'False';
      } else if (type === 'fill' || type === 'oneword' || type === 'num') {
        answer = answer == null ? null : String(answer).trim();
        if (!answer) return;
        options = null;
      } else {
        /* short / long / match — no deterministic key; marked by the AI marker */
        answer = null; options = null;
      }

      n++;
      out.push({
        id: 'q' + n, n: n, type: type, text: text,
        options: options, answer: answer,
        marks: +q.marks > 0 ? +q.marks : cfg.marks,
        difficulty: String(q.difficulty || cfg.difficulty || 'Medium'),
        subject: cfg.subject || '', topic: cfg.topic || '', source: cfg.source
      });
    });
    return out;
  }

  function parseJSON(t) {
    if (!t) return null;
    var m = t.match(/\[[\s\S]*\]/);          /* the array, wherever it sits */
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch (e) { return null; }
  }

  /* ============================ GENERATE ============================ */
  function generate() {
    readInputs();
    if (gen.busy) return;

    /* validation before anything is spent */
    if (gen.source === 'topic' && !gen.subject) {
      M.toast('Enter a subject first', 'warn'); $('#gSubject') && $('#gSubject').focus(); return;
    }
    if (gen.source === 'topic' && !gen.topic) {
      M.toast('Enter a topic first', 'warn'); $('#gTopic') && $('#gTopic').focus(); return;
    }
    if (gen.source === 'text' && gen.text.trim().length < 40) {
      M.toast('Paste a bit more material — at least a paragraph', 'warn'); return;
    }
    if (gen.source === 'image' && !gen.file) { M.toast('Upload an image first', 'warn'); return; }
    if (gen.source === 'pdf') { M.toast('PDF is not supported yet — see the note above', 'warn'); return; }
    if (!(gen.count >= 1 && gen.count <= 100)) { M.toast('Choose between 1 and 100 questions', 'warn'); return; }

    gen.busy = true;
    var btn = $('#gGo'); btn.disabled = true;
    /* only stages that correspond to work actually being done */
    $('#gOut').innerHTML = '<div class="genwait"><div class="think">' +
      '<span id="gStage">' + (gen.source === 'image' ? 'Reading your image' :
        gen.source === 'text' ? 'Reading your material' : 'Building questions') + '</span>' +
      '<i></i><i></i><i></i></div></div>';

    var typeName = (QTYPES.filter(function (t) { return t[0] === gen.qtype; })[0] || [])[1] || 'MCQ';
    var prompt =
      'Set ' + gen.count + ' exam questions.\n' +
      (gen.subject ? 'Subject: ' + gen.subject + '\n' : '') +
      (gen.topic ? 'Topic: ' + gen.topic + '\n' : '') +
      'Question type: ' + typeName + (gen.qtype === 'mixed' ? ' (vary the types)' : '') + '\n' +
      'Difficulty: ' + gen.difficulty + '\nMarks each: ' + gen.marks +
      '\nLanguage: ' + gen.lang + '\n' +
      (gen.source === 'text' ? '\nSet them from this material:\n"""' +
        gen.text.slice(0, 6000) + '"""\n' : '') +
      (gen.source === 'image' ? '\nSet them from the attached page.\n' : '') +
      '\nReply with a JSON ARRAY only, no prose. Each item:\n' +
      '{"question":string,"type":string,"options":[string],"answer":string,' +
      '"marks":number,"difficulty":string}\n' +
      'For MCQ give exactly 4 options and put the full correct option text in "answer". ' +
      'For short/long questions omit options and set "answer" to null.';

    var run = gen.source === 'image'
      ? M.ai.toInline(gen.file).then(function (im) {
          return M.ai.generate(prompt, { temp: 0.7, images: [im], maxTokens: 8192,
                                         label: 'AI question generation' });
        })
      : M.ai.generate(prompt, { temp: 0.7, maxTokens: 8192, label: 'AI question generation' });

    run.then(function (r) {
      gen.busy = false; btn.disabled = false;
      if (r.blocked) { $('#gOut').innerHTML = ''; V.gateModal(r.blocked, r.status); return; }

      if (r.demo || !r.text) {
        /* No fabricated questions. The brief is explicit about this. */
        $('#gOut').innerHTML = '<div class="genfail"><b>⚠️ Questions could not be generated</b>' +
          '<p>The AI service did not return anything. Nothing was charged. This build reaches ' +
          'the model through <code>api.php</code>, which needs its provider keys configured on ' +
          'the server — no questions are invented locally, so there is nothing to show.</p>' +
          '<button class="pill" id="gRetry">Try again</button></div>';
        $('#gRetry').onclick = generate;
        return;
      }

      var qs = validate(parseJSON(r.text), gen);
      if (!qs.length) {
        $('#gOut').innerHTML = '<div class="genfail"><b>⚠️ The questions came back unusable</b>' +
          '<p>The model replied, but none of the questions had a usable structure — a missing ' +
          'answer key or fewer than two options. They were dropped rather than shown, because a ' +
          'malformed question breaks a live test. Try again, or change the question type.</p>' +
          '<button class="pill" id="gRetry">Try again</button></div>';
        $('#gRetry').onclick = generate;
        return;
      }

      /* remember what the student typed, so it comes back next time */
      db.rememberSubject(gen.subject);
      db.rememberTopic(gen.subject, gen.topic);

      var marks = qs.reduce(function (a, q) { return a + q.marks; }, 0);
      pending = db.sets.add({
        subject: gen.subject || 'General', topic: gen.topic || 'General',
        difficulty: gen.difficulty, language: gen.lang, source: gen.source,
        questions: qs, marks: marks,
        minutes: gen.minutes || Math.max(1, Math.round(qs.length * 1.5)),
        asked: gen.count, charged: r.charged || 0
      });
      M.router.go('preview');
    });
  }

  /* ============================ PREVIEW ============================
     The clock does NOT start here. Answers are not shown here either —
     a preview that leaks the key is not a preview. */
  M.router.on('preview', function () {
    if (!pending) {
      var last = db.sets.all()[0];
      if (!last) { M.router.go('assistant'); return; }
      pending = last;
    }
    var s = pending;
    set('<div class="wrap"><div class="col">' +
      V.card('📋', 'blue', 'Test Ready',
        '<div class="prevhead">' +
        '<div><b>' + esc(s.subject) + '</b><small>' + esc(s.topic) + '</small></div>' +
        '<div class="prevmeta">' +
        chip(s.questions.length + ' Questions') + chip(s.marks + ' Marks') +
        chip(s.minutes + ' Minutes') + chip(esc(s.difficulty)) +
        chip(esc(s.language)) + '</div></div>' +
        (s.charged ? '<p class="charged">⚡ ' + s.charged + ' credits used</p>' : '') +

        '<div class="pills" style="margin-top:16px">' +
        '<button class="btn btn-v" id="pvStart" style="height:46px;padding:0 26px">' +
        '▶ Start Test</button>' +
        '<button class="pill" id="pvEdit">✎ Edit test</button>' +
        '<button class="pill" id="pvAgain">↻ Regenerate</button>' +
        '<button class="pill" id="pvDrop" style="color:var(--red-ink)">Discard</button></div>' +
        '<p class="gen-hint" style="margin-top:10px">The timer starts when you press ' +
        'Start Test — not before.</p>' +

        '<label class="cfg-l" style="margin-top:20px">Questions in this test</label>' +
        '<div class="prevq">' + s.questions.map(function (q) {
          return '<div class="pq"><div class="pq-h"><b>Q' + q.n + '</b>' +
            '<span>' + esc(qName(q.type)) + ' · ' + q.marks + ' mark' +
            (q.marks > 1 ? 's' : '') + ' · ' + esc(q.difficulty) + '</span></div>' +
            '<p>' + esc(q.text) + '</p>' +
            (q.options ? '<ol class="pq-o">' + q.options.map(function (o) {
              return '<li>' + esc(o) + '</li>'; }).join('') + '</ol>' : '') + '</div>';
        }).join('') + '</div>') +
      '</div>' + P.rightRail() + '</div>' + P.footer());

    $('#pvStart').onclick = function () { startFromSet(s); };
    $('#pvEdit').onclick = function () { M.router.go('assistant'); };
    $('#pvAgain').onclick = function () { M.router.go('assistant'); setTimeout(generate, 400); };
    $('#pvDrop').onclick = function () {
      db.sets.remove(s.id); pending = null; M.router.go('assistant');
    };
  });

  /* =====================================================================
     PROGRAMMATIC GENERATION
     Retry Incorrect, Similar Test, Practice My Mistakes and Quick 5 are all
     one click, and all of them come through here — the same prompt, the
     same validation, the same set record, the same preview. Giving each
     button its own generator is how they would drift apart.

     spec: { subject, topic, count, qtype, difficulty, marks, language,
             basedOn:[question text], title, note }
     Resolves to the saved set, or rejects with a message worth showing.
     ===================================================================== */
  function runSpec(spec) {
    var cfg = {
      subject: spec.subject || 'General', topic: spec.topic || 'General',
      qtype: spec.qtype || 'mcq', difficulty: spec.difficulty || 'Medium',
      marks: spec.marks || 2, source: spec.source || 'topic'
    };
    var count = M.clamp(spec.count || 5, 1, 100);
    var typeName = (QTYPES.filter(function (t) { return t[0] === cfg.qtype; })[0] || [])[1] || 'MCQ';

    var prompt =
      'Set ' + count + ' exam questions.\n' +
      'Subject: ' + cfg.subject + '\nTopic: ' + cfg.topic + '\n' +
      'Question type: ' + typeName + '\nDifficulty: ' + cfg.difficulty +
      '\nMarks each: ' + cfg.marks + '\nLanguage: ' + (spec.language || 'English') + '\n' +
      (spec.basedOn && spec.basedOn.length
        ? '\nThe student answered these questions incorrectly. Set NEW questions that test ' +
          'the same skills at a comparable level. Do NOT repeat them verbatim:\n' +
          spec.basedOn.slice(0, 10).map(function (t, i) {
            return (i + 1) + '. ' + String(t).slice(0, 220);
          }).join('\n') + '\n'
        : '') +
      '\nReply with a JSON ARRAY only, no prose. Each item:\n' +
      '{"question":string,"type":string,"options":[string],"answer":string,' +
      '"marks":number,"difficulty":string}\n' +
      'For MCQ give exactly 4 options and put the full correct option text in "answer".';

    return M.ai.generate(prompt, { temp: 0.75, maxTokens: 8192,
                                   label: spec.label || 'AI question generation' })
      .then(function (r) {
        if (r.blocked) { var e = new Error('blocked'); e.blocked = r.blocked; e.status = r.status; throw e; }
        if (r.demo || !r.text) {
          throw new Error('The AI service returned nothing, so no questions were created and ' +
            'nothing was charged. api.php needs its provider keys configured on the server.');
        }
        var qs = validate(parseJSON(r.text), cfg);
        if (!qs.length) {
          throw new Error('The questions came back without a usable structure and were dropped ' +
            'rather than shown. Try again, or pick a different question type.');
        }
        var marks = qs.reduce(function (a, q) { return a + q.marks; }, 0);
        return db.sets.add({
          subject: cfg.subject, topic: cfg.topic, difficulty: cfg.difficulty,
          language: spec.language || 'English', source: cfg.source,
          questions: qs, marks: marks,
          minutes: spec.minutes || Math.max(1, Math.round(qs.length * 1.5)),
          asked: count, charged: r.charged || 0,
          note: spec.note || '', prevPct: spec.prevPct
        });
      });
  }

  /** Generate from a spec with a full-screen wait, then open the preview. */
  function runAndPreview(spec) {
    var host = d.getElementById('page');
    host.insertAdjacentHTML('afterbegin',
      '<div class="genbar" id="genBar"><div class="think">' + esc(spec.wait || 'Generating your questions') +
      '<i></i><i></i><i></i></div></div>');
    return runSpec(spec).then(function (s) {
      pending = s;
      M.router.go('preview');
      return s;
    }).catch(function (err) {
      var bar = d.getElementById('genBar');
      if (bar) bar.remove();
      if (err.blocked) { V.gateModal(err.blocked, err.status); return null; }
      M.toast(err.message || 'Generation failed', 'err', 6000);
      return null;
    });
  }

  w.M7.gen = {
    run: runSpec, runAndPreview: runAndPreview,
    setPending: function (s) { pending = s; },
    settings: gen
  };

  function chip(t) { return '<span class="pchip">' + t + '</span>'; }
  function qName(id) {
    var t = QTYPES.filter(function (x) { return x[0] === id; })[0];
    return t ? t[1] : id;
  }

  /* The single place a generated set becomes a live attempt. Everything —
     Quick 5, Study Mode, papers — comes through here so there is one
     engine and one result pipeline. */
  function startFromSet(s) {
    M.exam.start({
      title: s.subject + ' — ' + s.topic,
      subject: s.subject, topic: s.topic,
      difficulty: s.difficulty, language: s.language, source: s.source,
      setId: s.id, minutes: s.minutes, autoSubmit: true, sound: true,
      questions: s.questions.map(function (q) { return JSON.parse(JSON.stringify(q)); })
    });
    M.router.go('exam');
  }
  w.M7.startFromSet = startFromSet;

  /* ============================ QUICK 5 ============================ */
  M.router.on('quick5', function () {
    gen.count = 5; gen.qtype = 'mcq';
    M.router.go('assistant');
    setTimeout(function () {
      if (gen.subject && gen.topic) generate();
      else M.toast('Pick a subject and topic, then press Generate', 'warn', 4000);
    }, 500);
  });

  /* ============================ MY TESTS ============================ */
  M.router.on('mytests', function () {
    var rs = db.results.all();
    set('<div class="wrap"><div class="col">' +
      V.card('📝', 'blue', 'My Tests',
        rs.length ? '<div class="hist">' + rs.map(function (r) {
          return '<div class="hrow" data-id="' + r.id + '">' +
            '<div class="hpct ' + (r.pct >= 70 ? 'good' : r.pct >= 40 ? 'mid' : 'low') + '">' +
            r.pct + '%</div>' +
            '<div class="hmain"><b>' + esc(r.title) + '</b>' +
            '<small>' + esc(r.subject) + ' · ' + esc(r.topic) + ' · ' +
            new Date(r.at).toLocaleDateString() + '</small>' +
            '<span class="hmeta">' + r.correct + '/' + r.total + ' correct · ' +
            r.got + '/' + r.max + ' marks · ' +
            Math.floor(r.seconds / 60) + 'm ' + (r.seconds % 60) + 's' +
            (r.revealed ? ' · ' + r.revealed + ' revealed' : '') + '</span></div>' +
            '<div class="hact"><button class="pill" data-a="view">View</button>' +
            '<button class="pill" data-a="similar">Similar test</button></div></div>';
        }).join('') + '</div>'
          : '<div class="empty"><span class="em">📝</span><b>No tests yet</b>' +
            '<small>Your completed tests will appear here.</small>' +
            '<a class="btn btn-v" href="#/assistant">Generate questions</a></div>') +
      '</div>' + P.rightRail() + '</div>' + P.footer());

    var host = $('#page .hist');
    if (host) host.onclick = function (e) {
      var row = e.target.closest('.hrow'); if (!row) return;
      var b = e.target.closest('[data-a]');
      var r = db.results.get(row.dataset.id);
      if (!r) return;
      if (!b || b.dataset.a === 'view') { M.state.history.unshift(r); M.router.go('result'); return; }
      if (b.dataset.a === 'similar') {
        gen.subject = r.subject; gen.topic = r.topic; gen.difficulty = r.difficulty || 'Medium';
        gen.count = r.total || 10; gen.source = 'topic';
        M.router.go('assistant');
        M.toast('Settings loaded — press Generate for a similar test', 'ok', 4000);
      }
    };
  });

  /* ============================ MISTAKE BANK ============================ */
  M.router.on('mistakes', function () {
    var list = db.mistakeList();
    set('<div class="wrap"><div class="col">' +
      V.card('❌', 'red', 'Mistake Bank',
        list.length
          ? '<p class="gen-lede">Every question you have got wrong, kept so you can practise ' +
            'exactly those again.</p>' +
            '<div class="mbbar"><b>' + list.length + ' question' +
            (list.length > 1 ? 's' : '') + ' available</b>' +
            '<div class="pills">' +
            [5, 10].filter(function (k) { return k <= list.length; }).map(function (k) {
              return '<button class="pill" data-mb="' + k + '">Practice ' + k + '</button>';
            }).join('') +
            '<button class="btn btn-v" data-mb="all">🎯 Practice all ' + list.length +
            '</button></div></div>' +
            '<div class="hist">' + list.map(function (m) {
              return '<div class="hrow" data-id="' + m.id + '">' +
                '<div class="hpct low">✗</div>' +
                '<div class="hmain"><b>' + esc(m.question) + '</b>' +
                '<small>' + esc(m.subject || '') + ' · ' + esc(m.topic || '') + ' · ' +
                new Date(m.at).toLocaleDateString() + '</small>' +
                '<span class="hmeta">You answered <b>' + esc(String(m.given)) +
                '</b> · correct was <b>' + esc(String(m.answer)) + '</b></span></div>' +
                '<div class="hact"><button class="pill" data-a="rm">Remove</button></div></div>';
            }).join('') + '</div>'
          : '<div class="empty"><span class="em">✅</span>' +
            '<b>You haven\'t made any recorded mistakes yet</b>' +
            '<small>Questions you get wrong are kept here so you can practise them again.</small>' +
            '<a class="btn btn-v" href="#/assistant">Generate questions</a></div>') +
      '</div>' + P.rightRail() + '</div>' + P.footer());

    /* one click: build the practice set straight away rather than sending
       the student to the generator to press a second button */
    $$('[data-mb]').forEach(function (b) {
      b.onclick = function () {
        var n = this.dataset.mb === 'all' ? list.length : +this.dataset.mb;
        w.M7.practiceMistakes(Math.min(n, list.length));
      };
    });
    var host = $('#page .hist');
    if (host) host.onclick = function (e) {
      var b = e.target.closest('[data-a="rm"]'); if (!b) return;
      db.mistakes.remove(e.target.closest('.hrow').dataset.id);
      M.router.go('mistakes');
    };
  });
})(window, document);
