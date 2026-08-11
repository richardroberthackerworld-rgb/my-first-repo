/* =====================================================================
   7MARKS — the education catalogue.
   Everything the product knows about who its students are lives here as
   plain data. Adding a board, a stream or a whole new exam family is a
   data edit, never a code change: the category tiles, the sidebar EXPLORE
   list, the course dropdowns, the subject chips and the search index are
   all derived from this one object at runtime.
   ===================================================================== */
(function (w) {
  'use strict';

  /* Subject definitions. `hue` picks one of the feature colours in theme.css,
     so a subject looks the same everywhere it appears in the product. */
  var S = {
    maths:   { name: 'Mathematics',      em: '📐', hue: 'blue'   },
    science: { name: 'Science',          em: '🔬', hue: 'green'  },
    phy:     { name: 'Physics',          em: '⚛️', hue: 'violet' },
    chem:    { name: 'Chemistry',        em: '🧪', hue: 'orange' },
    bio:     { name: 'Biology',          em: '🌿', hue: 'green'  },
    eng:     { name: 'English',          em: '📖', hue: 'pink'   },
    hindi:   { name: 'Hindi',            em: '🕉️', hue: 'orange' },
    telugu:  { name: 'Telugu',           em: '🪔', hue: 'teal'   },
    sanskrit:{ name: 'Sanskrit',         em: '📜', hue: 'gold'   },
    urdu:    { name: 'Urdu',             em: '🌙', hue: 'teal'   },
    evs:     { name: 'EVS',              em: '🌍', hue: 'green'  },
    social:  { name: 'Social Studies',   em: '🏛️', hue: 'gold'   },
    cs:      { name: 'Computer Science', em: '💻', hue: 'blue'   },
    gk:      { name: 'General Knowledge',em: '🧠', hue: 'pink'   },
    apt:     { name: 'Aptitude',         em: '🔢', hue: 'violet' },
    reason:  { name: 'Reasoning',        em: '🧩', hue: 'orange' },
    ca:      { name: 'Current Affairs',  em: '📰', hue: 'blue'   },
    acc:     { name: 'Accountancy',      em: '📊', hue: 'green'  },
    eco:     { name: 'Economics',        em: '📈', hue: 'teal'   },
    bstud:   { name: 'Business Studies', em: '💼', hue: 'gold'   },
    law:     { name: 'Law',              em: '⚖️', hue: 'navy'   },
    tax:     { name: 'Taxation',         em: '🧾', hue: 'orange' },
    audit:   { name: 'Auditing',         em: '🔍', hue: 'violet' },
    cost:    { name: 'Cost Accounting',  em: '💹', hue: 'green'  },
    fm:      { name: 'Financial Mgmt',   em: '🏦', hue: 'teal'   },
    ds:      { name: 'Data Structures',  em: '🌳', hue: 'green'  },
    dbms:    { name: 'DBMS',             em: '🗄️', hue: 'blue'   },
    os:      { name: 'Operating Systems',em: '⚙️', hue: 'violet' },
    net:     { name: 'Networks',         em: '🌐', hue: 'teal'   },
    aiml:    { name: 'AI / ML',          em: '🤖', hue: 'violet' },
    ee:      { name: 'Electrical',       em: '🔌', hue: 'orange' },
    mech:    { name: 'Mechanical',       em: '🔧', hue: 'gold'   },
    civil:   { name: 'Civil',            em: '🏗️', hue: 'orange' },
    ec:      { name: 'Electronics',      em: '📡', hue: 'blue'   },
    hist:    { name: 'History',          em: '🏺', hue: 'gold'   },
    geo:     { name: 'Geography',        em: '🗺️', hue: 'green'  },
    pol:     { name: 'Polity',           em: '🏛️', hue: 'navy'   },
    stat:    { name: 'Statistics',       em: '📉', hue: 'pink'   },
    mgmt:    { name: 'Management',       em: '🧭', hue: 'teal'   },
    mkt:     { name: 'Marketing',        em: '📣', hue: 'pink'   }
  };

  /* Every category. `courses` are the things a student actually picks;
     each course names the subjects it teaches. */
  var CATS = [
    {
      id: 'school', name: 'School', sub: '1st – 10th', em: '🏫', hue: 'blue',
      courses: [1,2,3,4,5,6,7,8,9,10].map(function (n) {
        var suffix = n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th';
        var subs = n <= 5 ? ['maths','evs','eng','hindi','telugu','gk']
                 : n <= 8 ? ['maths','science','social','eng','hindi','telugu','sanskrit','cs','gk']
                          : ['maths','science','phy','chem','bio','social','eng','hindi','telugu','sanskrit','cs'];
        return { id: 'c' + n, name: 'Class ' + n + suffix, subs: subs };
      })
    },
    {
      id: 'inter', name: 'Intermediate', sub: '11th – 12th', em: '🎓', hue: 'violet',
      courses: [
        { id: 'mpc',  name: 'MPC (Maths · Physics · Chemistry)', subs: ['maths','phy','chem','eng'] },
        { id: 'bipc', name: 'BiPC (Bio · Physics · Chemistry)',  subs: ['bio','phy','chem','eng'] },
        { id: 'mec',  name: 'MEC (Maths · Economics · Commerce)',subs: ['maths','eco','acc','bstud','eng'] },
        { id: 'cec',  name: 'CEC (Civics · Economics · Commerce)',subs:['pol','eco','acc','bstud','eng'] },
        { id: 'com',  name: 'Commerce (11th – 12th)',            subs: ['acc','bstud','eco','maths','eng','stat'] },
        { id: 'arts', name: 'Arts / Humanities',                 subs: ['hist','geo','pol','eco','eng','social'] },
        { id: 'c11',  name: 'Class 11th (General)',              subs: ['maths','phy','chem','bio','eng','cs'] },
        { id: 'c12',  name: 'Class 12th (General)',              subs: ['maths','phy','chem','bio','eng','cs'] }
      ]
    },
    {
      id: 'degree', name: 'UG / PG', sub: 'Degree', em: '🏛️', hue: 'gold',
      courses: [
        { id: 'ba',   name: 'BA',   subs: ['hist','pol','eco','eng','geo'] },
        { id: 'bsc',  name: 'BSc',  subs: ['maths','phy','chem','bio','stat','cs'] },
        { id: 'bcom', name: 'BCom', subs: ['acc','eco','bstud','tax','stat','law'] },
        { id: 'bba',  name: 'BBA',  subs: ['mgmt','mkt','eco','acc','fm','stat'] },
        { id: 'bca',  name: 'BCA',  subs: ['cs','ds','dbms','os','net','maths'] },
        { id: 'ma',   name: 'MA',   subs: ['hist','pol','eco','eng'] },
        { id: 'msc',  name: 'MSc',  subs: ['maths','phy','chem','bio','stat','cs'] },
        { id: 'mcom', name: 'MCom', subs: ['acc','eco','tax','fm','audit','stat'] },
        { id: 'mba',  name: 'MBA',  subs: ['mgmt','mkt','fm','eco','stat','law'] },
        { id: 'mca',  name: 'MCA',  subs: ['ds','dbms','os','net','aiml','cs'] }
      ]
    },
    {
      id: 'engg', name: 'Engineering', sub: 'B.Tech / M.Tech', em: '⚙️', hue: 'orange',
      courses: [
        { id: 'cse',  name: 'B.Tech — CSE',            subs: ['ds','dbms','os','net','aiml','maths'] },
        { id: 'it',   name: 'B.Tech — IT',             subs: ['ds','dbms','net','os','cs','maths'] },
        { id: 'ece',  name: 'B.Tech — ECE',            subs: ['ec','net','phy','maths','ee'] },
        { id: 'eee',  name: 'B.Tech — EEE',            subs: ['ee','phy','maths','ec'] },
        { id: 'mech', name: 'B.Tech — Mechanical',     subs: ['mech','phy','maths'] },
        { id: 'civ',  name: 'B.Tech — Civil',          subs: ['civil','phy','maths'] },
        { id: 'aids', name: 'B.Tech — AI & Data Science', subs: ['aiml','ds','stat','maths','dbms'] },
        { id: 'mtech',name: 'M.Tech',                  subs: ['aiml','ds','net','maths','stat'] }
      ]
    },
    {
      id: 'prof', name: 'Professional', sub: 'CA · CMA · CS', em: '💼', hue: 'teal',
      courses: [
        { id: 'cafnd', name: 'CA Foundation',    subs: ['acc','law','maths','eco'] },
        { id: 'cainter',name:'CA Intermediate',  subs: ['acc','law','cost','tax','audit','fm'] },
        { id: 'cafinal',name:'CA Final',         subs: ['acc','audit','law','tax','fm','mgmt'] },
        { id: 'cma',   name: 'CMA (India)',      subs: ['cost','acc','fm','law','tax','stat'] },
        { id: 'uscma', name: 'US CMA',           subs: ['fm','acc','cost','eco','stat'] },
        { id: 'cs',    name: 'Company Secretary',subs: ['law','acc','tax','eco','mgmt'] },
        { id: 'acca',  name: 'ACCA',             subs: ['acc','audit','tax','fm','law'] },
        { id: 'cpa',   name: 'US CPA',           subs: ['acc','audit','tax','law','fm'] }
      ]
    },
    {
      id: 'jobs', name: 'Jobs & Comp.', sub: 'Exams', em: '📋', hue: 'green',
      courses: [
        { id: 'upsc',  name: 'UPSC Civil Services', subs: ['hist','geo','pol','eco','ca','gk','reason'] },
        { id: 'ssc',   name: 'SSC (CGL · CHSL · MTS)', subs: ['apt','reason','eng','gk','ca'] },
        { id: 'bank',  name: 'Banking (IBPS · SBI · RBI)', subs: ['apt','reason','eng','ca','cs'] },
        { id: 'rail',  name: 'Railway (RRB)',       subs: ['apt','reason','gk','science'] },
        { id: 'psc',   name: 'State PSC',           subs: ['hist','geo','pol','ca','gk'] },
        { id: 'police',name: 'Police & Defence',    subs: ['apt','reason','gk','eng','ca'] },
        { id: 'teach', name: 'Teaching (TET · CTET)', subs: ['eng','maths','science','social','gk'] },
        { id: 'ent',   name: 'Entrance (JEE · NEET · CAT)', subs: ['maths','phy','chem','bio','apt','eng'] }
      ]
    },
    {
      id: 'ca', name: 'Current Affairs', sub: '& GK', em: '📰', hue: 'pink',
      courses: [
        { id: 'daily',   name: 'Daily Current Affairs', subs: ['ca','gk','pol','eco'] },
        { id: 'monthly', name: 'Monthly Digest',        subs: ['ca','gk','eco'] },
        { id: 'staticgk',name: 'Static GK',             subs: ['gk','hist','geo','pol'] }
      ]
    },
    {
      id: 'other', name: 'Other', sub: 'Early prep & skills', em: '🌱', hue: 'gold',
      courses: [
        { id: 'kids',  name: 'Early Learning (LKG · UKG)', subs: ['eng','maths','gk','evs'] },
        { id: 'lang',  name: 'Languages',                  subs: ['eng','hindi','telugu','sanskrit','urdu'] },
        { id: 'skill', name: 'Skill Development',          subs: ['cs','aiml','mkt','mgmt'] },
        { id: 'aptrea',name: 'Aptitude & Reasoning',       subs: ['apt','reason','maths'] }
      ]
    }
  ];

  /* Question types the exam engine can render and the AI can be asked for. */
  var QTYPES = [
    { id: 'mcq',    name: 'MCQ',              em: '🔘', marks: 1 },
    { id: 'multi',  name: 'Multiple Select',  em: '☑️', marks: 2 },
    { id: 'tf',     name: 'True / False',     em: '⚖️', marks: 1 },
    { id: 'fill',   name: 'Fill in the Blank',em: '✏️', marks: 1 },
    { id: 'short',  name: 'Short Answer',     em: '📝', marks: 2 },
    { id: 'long',   name: 'Long Answer',      em: '📄', marks: 5 },
    { id: 'num',    name: 'Numerical',        em: '🔢', marks: 3 },
    { id: 'code',   name: 'Coding',           em: '💻', marks: 5 },
    { id: 'desc',   name: 'Descriptive',      em: '🗒️', marks: 8 }
  ];

  /* ---- derived lookups, built once ---- */
  var byCat = {}, allCourses = [], searchIndex = [];
  CATS.forEach(function (c) {
    byCat[c.id] = c;
    searchIndex.push({ t: c.name + ' ' + c.sub, label: c.name, meta: c.sub, em: c.em,
                       kind: 'Category', go: { view: 'explore', cat: c.id } });
    c.courses.forEach(function (co) {
      co.cat = c.id;
      allCourses.push(co);
      searchIndex.push({ t: co.name + ' ' + c.name, label: co.name, meta: c.name, em: c.em,
                         kind: 'Course', go: { view: 'explore', cat: c.id, course: co.id } });
    });
  });
  Object.keys(S).forEach(function (k) {
    S[k].id = k;
    searchIndex.push({ t: S[k].name, label: S[k].name, meta: 'Subject', em: S[k].em,
                       kind: 'Subject', go: { view: 'practice', subject: k } });
  });
  /* the product's own destinations are searchable too */
  [['AI Study Assistant','assistant','🤖'],['AI Correct & Score','correct','🧑‍🏫'],
   ['Mock Test','mock','📝'],['Question Papers','papers','📚'],['Bookmarks','bookmarks','🔖'],
   ['Study Planner','planner','📅'],['Notes & Flashcards','notes','📒'],
   ['Performance','performance','📈'],['Analytics','analytics','📊'],
   ['Leaderboard','leaderboard','🏅'],['Challenges','challenges','🧩'],
   ['Doubt Solver','doubt','💡'],['Achievements','achievements','🏆']
  ].forEach(function (p) {
    searchIndex.push({ t: p[0], label: p[0], meta: 'Go to', em: p[2], kind: 'Page',
                       go: { view: p[1] } });
  });

  w.CATALOG = {
    subjects: S,
    cats: CATS,
    byCat: byCat,
    courses: allCourses,
    qtypes: QTYPES,
    index: searchIndex,
    /** Resolve the subject objects a course teaches. */
    subsOf: function (catId, courseId) {
      var c = byCat[catId]; if (!c) return [];
      var co = c.courses.filter(function (x) { return x.id === courseId; })[0] || c.courses[0];
      return (co ? co.subs : []).map(function (k) { return S[k]; }).filter(Boolean);
    },
    course: function (catId, courseId) {
      var c = byCat[catId]; if (!c) return null;
      return c.courses.filter(function (x) { return x.id === courseId; })[0] || c.courses[0];
    }
  };
})(window);
