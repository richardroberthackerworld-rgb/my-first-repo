/* =====================================================================
   7MARKS — the storage service layer.

   Every read and write of durable state goes through here. Nothing else in
   the app touches localStorage directly, which is the whole point: when
   server-side accounts arrive, each collection below becomes an API call
   and the UI does not change. The shapes are deliberately the ones a table
   would use — an id, a timestamp, flat fields — so migrating is a matter of
   swapping the driver, not rewriting screens.

   Collections
     subjects   custom subjects the student typed, so they come back later
     topics     custom topics, scoped to a subject
     sets       generated question sets (the reusable QuestionSet)
     attempts   one row per sitting (the TestAttempt)
     results    the graded outcome of an attempt (the Result)
     mistakes   every question got wrong, for the Mistake Bank
     achieve    unlocked achievements, with the moment they were earned
   ===================================================================== */
(function (w) {
  'use strict';
  var M = w.M7;

  /* ---- the driver. Swap this object for fetch() calls and the rest of
     the file, and every screen built on it, keeps working. ---- */
  var driver = {
    read: function (key, dflt) { return M.store.get(key, dflt); },
    write: function (key, val) { return M.store.set(key, val); }
  };

  function uid(p) {
    return (p || 'x') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function now() { return Date.now(); }

  /** A list collection with the handful of operations the app actually needs. */
  function collection(key, cap) {
    return {
      all: function () { return driver.read(key, []) || []; },
      get: function (id) {
        return this.all().filter(function (r) { return r.id === id; })[0] || null;
      },
      add: function (rec) {
        rec.id = rec.id || uid(key[0]);
        rec.at = rec.at || now();
        var list = this.all();
        list.unshift(rec);
        if (cap && list.length > cap) list = list.slice(0, cap);
        driver.write(key, list);
        return rec;
      },
      update: function (id, patch) {
        var list = this.all(), hit = null;
        list.forEach(function (r) {
          if (r.id === id) { Object.keys(patch).forEach(function (k) { r[k] = patch[k]; }); hit = r; }
        });
        driver.write(key, list);
        return hit;
      },
      remove: function (id) {
        driver.write(key, this.all().filter(function (r) { return r.id !== id; }));
      },
      clear: function () { driver.write(key, []); }
    };
  }

  var Store = {
    sets:     collection('sets', 60),
    attempts: collection('attempts', 200),
    results:  collection('results', 200),
    mistakes: collection('mistakes', 500),
    achieve:  collection('achieve', 100),
    /* planned study sessions. A session is only ever marked done by
       finishing the activity it launched — never by opening it. */
    sessions: collection('sessions', 200),

    /* ---------------------------------------------------------------
       SUBJECTS AND TOPICS
       A student may type anything — "Organic Chemistry", "Binary Trees",
       "Indian Polity". Whatever they type is remembered and offered back,
       so the catalogue grows with them instead of boxing them in. The
       built-in catalogue is merged in, never used as a restriction.
       --------------------------------------------------------------- */
    subjects: function () {
      var custom = driver.read('customSubjects', []) || [];
      var built = Object.keys(w.CATALOG.subjects).map(function (k) {
        return w.CATALOG.subjects[k].name;
      });
      var seen = {}, out = [];
      custom.concat(built).forEach(function (s) {
        var k = s.toLowerCase().trim();
        if (k && !seen[k]) { seen[k] = 1; out.push(s); }
      });
      return out;
    },
    rememberSubject: function (name) {
      name = String(name || '').trim();
      if (!name) return;
      var custom = driver.read('customSubjects', []) || [];
      if (custom.some(function (s) { return s.toLowerCase() === name.toLowerCase(); })) return;
      /* only remember what is genuinely new — the built-in list is not copied */
      var built = Object.keys(w.CATALOG.subjects).map(function (k) {
        return w.CATALOG.subjects[k].name.toLowerCase();
      });
      if (built.indexOf(name.toLowerCase()) > -1) return;
      custom.unshift(name);
      driver.write('customSubjects', custom.slice(0, 60));
    },
    topics: function (subject) {
      var all = driver.read('customTopics', {}) || {};
      return all[String(subject || '').toLowerCase()] || [];
    },
    rememberTopic: function (subject, topic) {
      subject = String(subject || '').toLowerCase().trim();
      topic = String(topic || '').trim();
      if (!subject || !topic) return;
      var all = driver.read('customTopics', {}) || {};
      var list = all[subject] || [];
      if (!list.some(function (t) { return t.toLowerCase() === topic.toLowerCase(); })) {
        list.unshift(topic);
        all[subject] = list.slice(0, 40);
        driver.write('customTopics', all);
      }
    },

    /* ---------------------------------------------------------------
       PERFORMANCE — derived, never stored.
       Every figure here is computed from recorded results, so nothing can
       drift out of step with what the student actually did, and there is
       no number in the app that was not earned.
       --------------------------------------------------------------- */
    performance: function () {
      var rs = this.results.all();
      if (!rs.length) {
        return { tests: 0, questions: 0, correct: 0, avgScore: 0, accuracy: 0,
                 best: 0, bySubject: [], byTopic: [], recent: [] };
      }
      var q = 0, c = 0, pctSum = 0, best = 0;
      var subs = {}, tops = {};
      rs.forEach(function (r) {
        q += r.total; c += r.correct; pctSum += r.pct;
        if (r.pct > best) best = r.pct;
        var s = r.subject || 'General';
        subs[s] = subs[s] || { n: 0, correct: 0, total: 0 };
        subs[s].n++; subs[s].correct += r.correct; subs[s].total += r.total;
        var t = r.topic || 'General';
        var key = s + ' · ' + t;
        tops[key] = tops[key] || { n: 0, correct: 0, total: 0, subject: s, topic: t };
        tops[key].n++; tops[key].correct += r.correct; tops[key].total += r.total;
      });
      var toRows = function (o) {
        return Object.keys(o).map(function (k) {
          var v = o[k];
          return { key: k, subject: v.subject || k, topic: v.topic,
                   attempts: v.n, correct: v.correct, total: v.total,
                   pct: v.total ? Math.round(v.correct / v.total * 100) : 0 };
        }).sort(function (a, b) { return b.pct - a.pct; });
      };
      return {
        tests: rs.length, questions: q, correct: c,
        avgScore: Math.round(pctSum / rs.length),
        accuracy: q ? Math.round(c / q * 100) : 0,
        best: best,
        bySubject: toRows(subs), byTopic: toRows(tops),
        recent: rs.slice(0, 10)
      };
    },

    /** The weakest topic the student has actually attempted, or null. */
    weakest: function (minAttempts) {
      var rows = this.performance().byTopic.filter(function (r) {
        return r.attempts >= (minAttempts || 1) && r.total >= 3;
      });
      return rows.length ? rows[rows.length - 1] : null;
    },

    /* ---------------------------------------------------------------
       READINESS — an internal indicator, and labelled as one.
       It is not a prediction of any real exam. It blends accuracy, how
       much practice there is to judge by, topic coverage and recent
       direction, all from recorded attempts.
       --------------------------------------------------------------- */
    readiness: function () {
      var p = this.performance();
      if (!p.tests) return { score: 0, ready: false, parts: [], note: 'No practice recorded yet.' };
      var accuracy = p.accuracy;                                  /* 0-100 */
      var volume = Math.min(100, p.tests / 12 * 100);             /* 12 tests = full marks */
      var coverage = Math.min(100, p.byTopic.length / 8 * 100);   /* 8 topics = full marks */
      var half = Math.ceil(p.recent.length / 2);
      var recent = p.recent.slice(0, half), older = p.recent.slice(half);
      var avg = function (a) {
        return a.length ? a.reduce(function (x, r) { return x + r.pct; }, 0) / a.length : 0;
      };
      var trend = older.length ? Math.max(0, Math.min(100, 50 + (avg(recent) - avg(older)) * 2.5)) : 50;
      var score = Math.round(accuracy * 0.45 + volume * 0.2 + coverage * 0.2 + trend * 0.15);
      return {
        score: score,
        parts: [
          { label: 'Accuracy', value: Math.round(accuracy) },
          { label: 'Practice volume', value: Math.round(volume) },
          { label: 'Topic coverage', value: Math.round(coverage) },
          { label: 'Recent direction', value: Math.round(trend) }
        ],
        note: 'Based on your recent 7Marks practice — not a prediction of any real exam.'
      };
    },

    /* ---------------------------------------------------------------
       ACHIEVEMENTS — unlocked only by events that actually happened.
       --------------------------------------------------------------- */
    checkAchievements: function () {
      var p = this.performance();
      var streak = (M.state.user && M.state.user.streak) || 0;
      var have = {}, self = this;
      this.achieve.all().forEach(function (a) { have[a.key] = 1; });
      var rules = [
        ['first_test', '🎯', 'First Test', p.tests >= 1],
        ['q50', '📝', '50 Questions', p.questions >= 50],
        ['q100', '💯', '100 Questions', p.questions >= 100],
        ['streak7', '🔥', '7 Day Streak', streak >= 7],
        ['best80', '🏆', 'Scored 80%+', p.best >= 80],
        ['tests5', '📚', '5 Tests Completed', p.tests >= 5],
        ['improve20', '🚀', 'Improved 20%', (function () {
          if (p.recent.length < 4) return false;
          var h = Math.ceil(p.recent.length / 2);
          var a = p.recent.slice(0, h), b = p.recent.slice(h);
          var m = function (x) { return x.reduce(function (s, r) { return s + r.pct; }, 0) / x.length; };
          return m(a) - m(b) >= 20;
        })()]
      ];
      var fresh = [];
      rules.forEach(function (r) {
        if (r[3] && !have[r[0]]) {
          self.achieve.add({ key: r[0], em: r[1], name: r[2] });
          fresh.push(r[1] + ' ' + r[2]);
        }
      });
      return fresh;
    },

    /** Record a wrong answer for the Mistake Bank. */
    noteMistake: function (rec) {
      this.mistakes.add(rec);
    },
    /** Mistakes newest first, de-duplicated by question text. */
    mistakeList: function (subject) {
      var seen = {}, out = [];
      this.mistakes.all().forEach(function (m) {
        var k = (m.question || '').slice(0, 80);
        if (seen[k]) return;
        if (subject && m.subject !== subject) return;
        seen[k] = 1; out.push(m);
      });
      return out;
    },

    uid: uid,
    _driver: driver
  };

  w.M7.db = Store;
})(window);
