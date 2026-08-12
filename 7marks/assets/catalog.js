/* =====================================================================
   7MARKS — the education catalogue.
   Everything the product knows about who its students are lives here as
   plain data. Adding a board, a stream or a whole new course family is a
   data edit, never a code change: the category tiles, the sidebar EXPLORE
   list, the course dropdowns, the YEAR dropdown, the subject chips and the
   search index are all derived from this one object at runtime.

   A course declares how long it runs (`years`) and, where the syllabus
   really differs year to year, what it teaches in each (`ysubs`). A course
   with years > 1 gets a Year picker in the UI automatically; one without
   does not. `subs` is the union across years and is what a student sees
   when they ask for "the whole course".
   ===================================================================== */
(function (w) {
  'use strict';

  /* Subject definitions. `hue` picks one of the feature colours in
     theme.css, so a subject looks the same everywhere it appears. */
  var S = {
    /* --- school and general --- */
    maths:   { name: 'Mathematics',        em: '📐', hue: 'blue'   },
    science: { name: 'Science',            em: '🔬', hue: 'green'  },
    phy:     { name: 'Physics',            em: '⚛️', hue: 'violet' },
    chem:    { name: 'Chemistry',          em: '🧪', hue: 'orange' },
    bio:     { name: 'Biology',            em: '🌿', hue: 'green'  },
    botany:  { name: 'Botany',             em: '🍃', hue: 'green'  },
    zoology: { name: 'Zoology',            em: '🦋', hue: 'teal'   },
    eng:     { name: 'English',            em: '📖', hue: 'pink'   },
    hindi:   { name: 'Hindi',              em: '🕉️', hue: 'orange' },
    telugu:  { name: 'Telugu',             em: '🪔', hue: 'teal'   },
    sanskrit:{ name: 'Sanskrit',           em: '📜', hue: 'gold'   },
    urdu:    { name: 'Urdu',               em: '🌙', hue: 'teal'   },
    evs:     { name: 'EVS',                em: '🌍', hue: 'green'  },
    social:  { name: 'Social Studies',     em: '🏛️', hue: 'gold'   },
    cs:      { name: 'Computer Science',   em: '💻', hue: 'blue'   },
    gk:      { name: 'General Knowledge',  em: '🧠', hue: 'pink'   },
    apt:     { name: 'Aptitude',           em: '🔢', hue: 'violet' },
    reason:  { name: 'Reasoning',          em: '🧩', hue: 'orange' },
    ca:      { name: 'Current Affairs',    em: '📰', hue: 'blue'   },
    hist:    { name: 'History',            em: '🏺', hue: 'gold'   },
    geo:     { name: 'Geography',          em: '🗺️', hue: 'green'  },
    pol:     { name: 'Polity / Civics',    em: '🏛️', hue: 'navy'   },
    stat:    { name: 'Statistics',         em: '📉', hue: 'pink'   },
    psych:   { name: 'Psychology',         em: '🧠', hue: 'violet' },
    socio:   { name: 'Sociology',          em: '👥', hue: 'teal'   },
    phil:    { name: 'Philosophy',         em: '💭', hue: 'gold'   },

    /* --- commerce, finance, management --- */
    acc:     { name: 'Accountancy',        em: '📊', hue: 'green'  },
    eco:     { name: 'Economics',          em: '📈', hue: 'teal'   },
    bstud:   { name: 'Business Studies',   em: '💼', hue: 'gold'   },
    law:     { name: 'Law',                em: '⚖️', hue: 'navy'   },
    tax:     { name: 'Taxation',           em: '🧾', hue: 'orange' },
    audit:   { name: 'Auditing',           em: '🔍', hue: 'violet' },
    cost:    { name: 'Cost Accounting',    em: '💹', hue: 'green'  },
    fm:      { name: 'Financial Mgmt',     em: '🏦', hue: 'teal'   },
    mgmt:    { name: 'Management',         em: '🧭', hue: 'teal'   },
    mkt:     { name: 'Marketing',          em: '📣', hue: 'pink'   },
    hr:      { name: 'Human Resources',    em: '🤝', hue: 'orange' },
    ob:      { name: 'Organisational Beh.',em: '🏢', hue: 'violet' },
    bcom:    { name: 'Business Comm.',     em: '✉️', hue: 'pink'   },
    ent:     { name: 'Entrepreneurship',   em: '🚀', hue: 'orange' },
    banking: { name: 'Banking & Insurance',em: '🏛️', hue: 'blue'   },

    /* --- computing --- */
    prog:    { name: 'Programming (C)',    em: '⌨️', hue: 'blue'   },
    ds:      { name: 'Data Structures',    em: '🌳', hue: 'green'  },
    algo:    { name: 'Algorithms',         em: '🧮', hue: 'violet' },
    oop:     { name: 'OOP / Java',         em: '☕', hue: 'orange' },
    python:  { name: 'Python',             em: '🐍', hue: 'green'  },
    dbms:    { name: 'DBMS',               em: '🗄️', hue: 'blue'   },
    os:      { name: 'Operating Systems',  em: '⚙️', hue: 'violet' },
    net:     { name: 'Computer Networks',  em: '🌐', hue: 'teal'   },
    se:      { name: 'Software Engg.',     em: '🏗️', hue: 'gold'   },
    aiml:    { name: 'AI / ML',            em: '🤖', hue: 'violet' },
    web:     { name: 'Web Technologies',   em: '🕸️', hue: 'pink'   },
    toc:     { name: 'Theory of Comp.',    em: '🔣', hue: 'navy'   },
    cloud:   { name: 'Cloud Computing',    em: '☁️', hue: 'blue'   },
    cyber:   { name: 'Cyber Security',     em: '🔐', hue: 'navy'   },

    /* --- engineering core --- */
    em1:     { name: 'Engg. Mathematics',  em: '➗', hue: 'blue'   },
    engphy:  { name: 'Engg. Physics',      em: '🔭', hue: 'violet' },
    engchem: { name: 'Engg. Chemistry',    em: '⚗️', hue: 'orange' },
    egd:     { name: 'Engg. Graphics',     em: '📏', hue: 'gold'   },
    mech:    { name: 'Mechanical Engg.',   em: '🔧', hue: 'gold'   },
    thermo:  { name: 'Thermodynamics',     em: '🔥', hue: 'orange' },
    som:     { name: 'Strength of Mat.',   em: '🧱', hue: 'gold'   },
    fluid:   { name: 'Fluid Mechanics',    em: '💧', hue: 'teal'   },
    civil:   { name: 'Civil Engg.',        em: '🏗️', hue: 'orange' },
    survey:  { name: 'Surveying',          em: '🧭', hue: 'green'  },
    struct:  { name: 'Structural Analysis',em: '🌉', hue: 'navy'   },
    ee:      { name: 'Electrical Engg.',   em: '🔌', hue: 'orange' },
    ec:      { name: 'Electronics',        em: '📡', hue: 'blue'   },
    ckt:     { name: 'Circuit Theory',     em: '⚡', hue: 'gold'   },
    signals: { name: 'Signals & Systems',  em: '📶', hue: 'violet' },
    control: { name: 'Control Systems',    em: '🎛️', hue: 'teal'   },
    vlsi:    { name: 'VLSI Design',        em: '🔲', hue: 'navy'   },
    comm:    { name: 'Communication Sys.', em: '📻', hue: 'pink'   },

    /* --- medical and health --- */
    anat:    { name: 'Anatomy',            em: '🦴', hue: 'pink'   },
    physio:  { name: 'Physiology',         em: '🫀', hue: 'red'    },
    biochem: { name: 'Biochemistry',       em: '🧬', hue: 'green'  },
    pharma:  { name: 'Pharmacology',       em: '💊', hue: 'violet' },
    patho:   { name: 'Pathology',          em: '🔬', hue: 'teal'   },
    micro:   { name: 'Microbiology',       em: '🦠', hue: 'green'  },
    medicine:{ name: 'General Medicine',   em: '🩺', hue: 'blue'   },
    surgery: { name: 'Surgery',            em: '🔪', hue: 'navy'   },
    nursing: { name: 'Nursing Foundation', em: '👩‍⚕️', hue: 'pink' },
    pharmy:  { name: 'Pharmaceutics',      em: '⚗️', hue: 'orange' },

    /* --- other professional --- */
    agri:    { name: 'Agronomy',           em: '🌾', hue: 'green'  },
    soil:    { name: 'Soil Science',       em: '🪴', hue: 'gold'   },
    arch:    { name: 'Architectural Des.', em: '🏛️', hue: 'navy'   },
    hotel:   { name: 'Hotel Operations',   em: '🏨', hue: 'teal'   },
    culinary:{ name: 'Food Production',    em: '🍳', hue: 'orange' },
    edu:     { name: 'Education Theory',   em: '🎓', hue: 'violet' },
    pedagogy:{ name: 'Pedagogy',           em: '📚', hue: 'blue'   },
    fitter:  { name: 'Trade Theory',       em: '🔩', hue: 'gold'   },
    workshop:{ name: 'Workshop Practice',  em: '🛠️', hue: 'orange' },
    draw:    { name: 'Engineering Drawing',em: '📐', hue: 'blue'   },
    safety:  { name: 'Safety & Env.',      em: '🦺', hue: 'green'  }
  };

  /* Short helper so the course table below stays readable. */
  function c(id, name, years, ysubs, subs) {
    var o = { id: id, name: name, years: years || 1 };
    if (ysubs) {
      o.ysubs = ysubs;
      var u = [];
      ysubs.forEach(function (y) {
        y.forEach(function (k) { if (u.indexOf(k) < 0) u.push(k); });
      });
      o.subs = u;
    } else {
      o.subs = subs || [];
    }
    return o;
  }

  /* Common year blocks reused across similar programmes. */
  var BTECH_Y1 = ['em1', 'engphy', 'engchem', 'prog', 'egd', 'eng'];

  var CATS = [
    /* ---------------------------------------------------------------- */
    {
      id: 'school', name: 'School', sub: 'Pre-KG – 10th', em: '🏫', hue: 'blue',
      courses: [c('pre', 'Pre-KG / LKG / UKG', 1, null, ['eng', 'maths', 'gk', 'evs'])]
        .concat([1,2,3,4,5,6,7,8,9,10].map(function (n) {
          var sfx = n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th';
          var subs = n <= 5 ? ['maths','evs','eng','hindi','telugu','gk']
                   : n <= 8 ? ['maths','science','social','eng','hindi','telugu','sanskrit','cs','gk']
                            : ['maths','science','phy','chem','bio','social','hist','geo','pol',
                               'eng','hindi','telugu','sanskrit','cs'];
          return c('c' + n, 'Class ' + n + sfx, 1, null, subs);
        }))
    },
    /* ---------------------------------------------------------------- */
    {
      id: 'inter', name: 'Intermediate', sub: '11th – 12th · 2 years', em: '🎓', hue: 'violet',
      courses: [
        c('mpc',  'MPC — Maths, Physics, Chemistry', 2,
          [['maths','phy','chem','eng','sanskrit'], ['maths','phy','chem','eng','sanskrit']]),
        c('bipc', 'BiPC — Biology, Physics, Chemistry', 2,
          [['botany','zoology','phy','chem','eng'], ['botany','zoology','phy','chem','eng']]),
        c('mec',  'MEC — Maths, Economics, Commerce', 2,
          [['maths','eco','acc','bstud','eng'], ['maths','eco','acc','bstud','eng']]),
        c('cec',  'CEC — Civics, Economics, Commerce', 2,
          [['pol','eco','acc','bstud','eng'], ['pol','eco','acc','bstud','eng']]),
        c('hec',  'HEC — History, Economics, Civics', 2,
          [['hist','eco','pol','eng'], ['hist','eco','pol','eng']]),
        c('icom', 'Commerce (11th – 12th)', 2,
          [['acc','bstud','eco','maths','eng'], ['acc','bstud','eco','stat','eng']]),
        c('iarts','Arts / Humanities', 2,
          [['hist','geo','pol','eng','psych'], ['hist','geo','eco','socio','phil','eng']]),
        c('ivoc', 'Vocational (Intermediate)', 2,
          [['cs','acc','eng','gk'], ['cs','acc','eng','ent']])
      ]
    },
    /* ---------------------------------------------------------------- */
    {
      id: 'diploma', name: 'Diploma & ITI', sub: 'Polytechnic · trades', em: '🔧', hue: 'orange',
      courses: [
        c('dcivil','Diploma — Civil Engineering', 3,
          [['maths','engphy','engchem','draw','eng'], ['survey','som','civil','workshop'],
           ['struct','civil','safety','workshop']]),
        c('dmech', 'Diploma — Mechanical Engineering', 3,
          [['maths','engphy','engchem','draw','eng'], ['thermo','som','workshop','mech'],
           ['mech','fluid','safety','workshop']]),
        c('dece',  'Diploma — Electronics (ECE)', 3,
          [['maths','engphy','draw','eng'], ['ckt','ec','workshop'], ['comm','ec','net','safety']]),
        c('deee',  'Diploma — Electrical (EEE)', 3,
          [['maths','engphy','draw','eng'], ['ckt','ee','workshop'], ['ee','control','safety']]),
        c('dcse',  'Diploma — Computer Engineering', 3,
          [['maths','engphy','prog','eng'], ['ds','dbms','oop','web'], ['os','net','se','python']]),
        c('dpharm','D.Pharm — Diploma in Pharmacy', 2,
          [['pharmy','biochem','anat','pharma'], ['pharma','patho','micro','pharmy']]),
        c('iti_el','ITI — Electrician', 2,
          [['fitter','workshop','draw','safety'], ['ee','fitter','workshop','safety']]),
        c('iti_ft','ITI — Fitter', 2,
          [['fitter','workshop','draw','safety'], ['mech','fitter','workshop','safety']]),
        c('iti_cp','ITI — COPA (Computer Operator)', 2,
          [['cs','prog','eng','gk'], ['web','dbms','cs','apt']]),
        c('iti_wl','ITI — Welder', 1, null, ['fitter','workshop','draw','safety'])
      ]
    },
    /* ---------------------------------------------------------------- */
    {
      id: 'degree', name: 'Degree', sub: 'UG 3 yr · PG 2 yr', em: '🏛️', hue: 'gold',
      courses: [
        c('ba',   'BA — Bachelor of Arts', 3,
          [['hist','pol','eng','socio'], ['hist','pol','eco','psych'], ['hist','geo','phil','eng']]),
        c('bsc',  'BSc — Bachelor of Science', 3,
          [['maths','phy','chem','eng'], ['maths','phy','chem','stat'], ['maths','phy','chem','cs']]),
        c('bsccs','BSc — Computer Science', 3,
          [['prog','maths','eng','cs'], ['ds','dbms','oop','stat'], ['os','net','web','python']]),
        c('bscbio','BSc — Life Sciences (BZC)', 3,
          [['botany','zoology','chem','eng'], ['botany','zoology','chem','biochem'],
           ['botany','zoology','micro','biochem']]),
        c('bcom', 'BCom — Bachelor of Commerce', 3,
          [['acc','eco','bcom','eng'], ['acc','cost','bstud','stat'], ['tax','audit','fm','law']]),
        c('bcomcs','BCom — Computers', 3,
          [['acc','eco','prog','eng'], ['acc','cost','dbms','stat'], ['tax','audit','web','fm']]),
        c('bba',  'BBA — Business Administration', 3,
          [['mgmt','eco','acc','bcom'], ['mkt','hr','fm','ob'], ['mgmt','ent','stat','law']]),
        c('bca',  'BCA — Computer Applications', 3,
          [['prog','maths','eng','cs'], ['ds','dbms','oop','web'], ['os','net','se','python']]),
        c('bsw',  'BSW — Social Work', 3,
          [['socio','psych','eng'], ['socio','psych','pol'], ['socio','mgmt','eng']]),
        c('ma',   'MA — Master of Arts', 2,
          [['hist','pol','eng','phil'], ['hist','socio','eco','eng']]),
        c('msc',  'MSc — Master of Science', 2,
          [['maths','phy','chem','stat'], ['maths','phy','chem','cs']]),
        c('mcom', 'MCom — Master of Commerce', 2,
          [['acc','eco','stat','fm'], ['tax','audit','cost','law']]),
        c('mba',  'MBA — Business Administration', 2,
          [['mgmt','mkt','fm','hr','ob','stat'], ['mgmt','mkt','fm','ent','law','eco']]),
        c('mca',  'MCA — Computer Applications', 2,
          [['ds','dbms','oop','os','maths'], ['aiml','net','web','se','cloud']]),
        c('msw',  'MSW — Master of Social Work', 2,
          [['socio','psych','mgmt'], ['socio','psych','pol']])
      ]
    },
    /* ---------------------------------------------------------------- */
    {
      id: 'engg', name: 'Engineering', sub: 'B.Tech 4 yr · M.Tech 2 yr', em: '⚙️', hue: 'teal',
      courses: [
        c('cse',  'B.Tech — Computer Science (CSE)', 4,
          [BTECH_Y1, ['ds','oop','dbms','em1','toc'], ['os','net','algo','se','web'],
           ['aiml','cloud','cyber','se']]),
        c('it',   'B.Tech — Information Technology', 4,
          [BTECH_Y1, ['ds','oop','dbms','web','em1'], ['os','net','se','cyber'],
           ['cloud','aiml','web','se']]),
        c('aids', 'B.Tech — AI & Data Science', 4,
          [BTECH_Y1, ['python','ds','stat','em1'], ['aiml','dbms','algo','stat'],
           ['aiml','cloud','se','cyber']]),
        c('ece',  'B.Tech — Electronics (ECE)', 4,
          [BTECH_Y1, ['ckt','ec','signals','em1'], ['comm','control','vlsi','ec'],
           ['vlsi','comm','net','ec']]),
        c('eee',  'B.Tech — Electrical (EEE)', 4,
          [BTECH_Y1, ['ckt','ee','em1','signals'], ['ee','control','ec','thermo'],
           ['ee','control','ec']]),
        c('mecheng','B.Tech — Mechanical', 4,
          [BTECH_Y1, ['thermo','som','mech','em1'], ['fluid','mech','thermo','som'],
           ['mech','fluid','thermo']]),
        c('civeng','B.Tech — Civil', 4,
          [BTECH_Y1, ['som','survey','civil','em1'], ['struct','fluid','civil','survey'],
           ['struct','civil','safety']]),
        c('mtech','M.Tech', 2,
          [['aiml','em1','algo','stat'], ['aiml','cloud','se','cyber']])
      ]
    },
    /* ---------------------------------------------------------------- */
    {
      id: 'medical', name: 'Medical & Health', sub: 'MBBS · Pharmacy · Nursing', em: '🩺', hue: 'pink',
      courses: [
        c('mbbs', 'MBBS', 5,
          [['anat','physio','biochem'], ['patho','pharma','micro'],
           ['medicine','surgery','patho'], ['medicine','surgery','pharma'],
           ['medicine','surgery','micro']]),
        c('bds',  'BDS — Dental Surgery', 5,
          [['anat','physio','biochem'], ['patho','pharma','micro'],
           ['medicine','surgery'], ['surgery','patho'], ['surgery','medicine']]),
        c('bams', 'BAMS — Ayurveda', 5,
          [['anat','physio','sanskrit'], ['patho','pharma'], ['medicine','surgery'],
           ['medicine','pharma'], ['medicine','surgery']]),
        c('bhms', 'BHMS — Homoeopathy', 5,
          [['anat','physio','biochem'], ['patho','pharma'], ['medicine','patho'],
           ['medicine','surgery'], ['medicine','pharma']]),
        c('bpharm','B.Pharm — Pharmacy', 4,
          [['pharmy','anat','biochem','eng'], ['pharma','patho','micro','pharmy'],
           ['pharma','pharmy','micro'], ['pharma','pharmy','mgmt']]),
        c('bscnur','BSc Nursing', 4,
          [['anat','physio','nursing','biochem'], ['patho','pharma','nursing','micro'],
           ['medicine','nursing','psych'], ['nursing','medicine','mgmt']]),
        c('bpt',  'BPT — Physiotherapy', 4,
          [['anat','physio','biochem'], ['patho','physio','pharma'],
           ['medicine','physio'], ['physio','medicine']]),
        c('gnm',  'GNM — Nursing Diploma', 3,
          [['anat','physio','nursing'], ['nursing','micro','pharma'], ['nursing','medicine']])
      ]
    },
    /* ---------------------------------------------------------------- */
    {
      id: 'prof', name: 'Professional', sub: 'CA · CMA · CS · ACCA', em: '💼', hue: 'green',
      courses: [
        c('cafnd',  'CA Foundation', 1, null, ['acc','law','maths','eco','bcom']),
        c('cainter','CA Intermediate', 1, null, ['acc','law','cost','tax','audit','fm','mgmt']),
        c('cafinal','CA Final', 1, null, ['acc','audit','law','tax','fm','mgmt','stat']),
        c('cmafnd', 'CMA (India) — Foundation', 1, null, ['acc','law','eco','stat']),
        c('cmaint', 'CMA (India) — Intermediate', 1, null, ['cost','acc','law','tax','fm','stat']),
        c('cmafin', 'CMA (India) — Final', 1, null, ['cost','fm','tax','audit','mgmt','stat']),
        c('uscma',  'US CMA — Part 1 & 2', 2,
          [['acc','cost','stat','fm'], ['fm','eco','mgmt','stat']]),
        c('csexec', 'Company Secretary (CS)', 3,
          [['law','acc','eco','bcom'], ['law','tax','acc','mgmt'], ['law','mgmt','fm','audit']]),
        c('acca',   'ACCA', 3,
          [['acc','mgmt','law'], ['tax','audit','fm','acc'], ['fm','audit','mgmt','tax']]),
        c('cpa',    'US CPA', 1, null, ['acc','audit','tax','law','fm']),
        c('cfa',    'CFA — Levels I–III', 3,
          [['fm','eco','stat','acc'], ['fm','eco','acc','stat'], ['fm','mgmt','stat']]),
        c('frm',    'FRM — Levels I & II', 2, [['fm','stat','eco'], ['fm','stat','mgmt']]),
        c('llb',    'LLB — 3 Year', 3,
          [['law','pol','socio'], ['law','pol','eco'], ['law','tax','mgmt']]),
        c('ballb',  'BA LLB — 5 Year', 5,
          [['law','pol','socio','eng'], ['law','hist','eco'], ['law','pol','phil'],
           ['law','tax','bstud'], ['law','mgmt','audit']]),
        c('llm',    'LLM', 2, [['law','pol','phil'], ['law','tax','mgmt']])
      ]
    },
    /* ---------------------------------------------------------------- */
    {
      id: 'other_prof', name: 'Other Courses', sub: 'B.Ed · Agri · Arch · Hotel', em: '🌱', hue: 'gold',
      courses: [
        c('bed',   'B.Ed — Bachelor of Education', 2,
          [['edu','pedagogy','psych','eng'], ['pedagogy','edu','mgmt','eng']]),
        c('deled', 'D.El.Ed / DTEd', 2,
          [['pedagogy','edu','eng','maths'], ['pedagogy','edu','evs','eng']]),
        c('bscagri','BSc Agriculture', 4,
          [['agri','soil','botany','eng'], ['agri','soil','micro','stat'],
           ['agri','botany','eco'], ['agri','mgmt','eco']]),
        c('barch', 'B.Arch — Architecture', 5,
          [['arch','draw','maths','eng'], ['arch','draw','struct'], ['arch','struct','civil'],
           ['arch','mgmt','civil'], ['arch','mgmt','ent']]),
        c('bhm',   'BHM — Hotel Management', 4,
          [['hotel','culinary','eng','mgmt'], ['hotel','culinary','acc'],
           ['hotel','mgmt','mkt'], ['hotel','mgmt','ent']]),
        c('bfa',   'BFA — Fine Arts', 4,
          [['arch','draw','hist'], ['draw','hist','phil'], ['draw','arch'], ['draw','ent','mgmt']]),
        c('bjmc',  'BJMC — Journalism & Mass Comm.', 3,
          [['eng','pol','socio','ca'], ['eng','mkt','ca','psych'], ['eng','mkt','ca','mgmt']])
      ]
    },
    /* ---------------------------------------------------------------- */
    {
      id: 'jobs', name: 'Jobs & Comp.', sub: 'Government & entrance exams', em: '📋', hue: 'blue',
      courses: [
        c('upsc',  'UPSC — Civil Services', 1, null,
          ['hist','geo','pol','eco','ca','gk','reason','socio']),
        c('ssc',   'SSC — CGL · CHSL · MTS', 1, null, ['apt','reason','eng','gk','ca']),
        c('bank',  'Banking — IBPS · SBI · RBI', 1, null, ['apt','reason','eng','ca','banking','cs']),
        c('rail',  'Railway — RRB NTPC · Group D', 1, null, ['apt','reason','gk','science','ca']),
        c('psc',   'State PSC — Group 1 · 2 · 3', 1, null, ['hist','geo','pol','ca','gk','eco']),
        c('police','Police · Defence — NDA · CDS', 1, null, ['apt','reason','gk','eng','ca','maths']),
        c('teach', 'Teaching — TET · CTET · DSC', 1, null,
          ['pedagogy','eng','maths','science','social','gk','psych']),
        c('jee',   'JEE Main & Advanced', 1, null, ['maths','phy','chem']),
        c('neet',  'NEET', 1, null, ['botany','zoology','phy','chem']),
        c('eamcet','EAMCET · State CETs', 1, null, ['maths','phy','chem','botany','zoology']),
        c('cat',   'CAT · MAT · CMAT', 1, null, ['apt','reason','eng','stat']),
        c('gate',  'GATE', 1, null, ['em1','ds','dbms','os','net','mech','ee','civil'])
      ]
    },
    /* ---------------------------------------------------------------- */
    {
      id: 'ca', name: 'Current Affairs', sub: '& General Knowledge', em: '📰', hue: 'violet',
      courses: [
        c('daily',   'Daily Current Affairs', 1, null, ['ca','gk','pol','eco']),
        c('monthly', 'Monthly Digest', 1, null, ['ca','gk','eco','pol']),
        c('staticgk','Static GK', 1, null, ['gk','hist','geo','pol','science'])
      ]
    },
    /* ---------------------------------------------------------------- */
    {
      id: 'other', name: 'Skills & Early', sub: 'Languages · aptitude', em: '✨', hue: 'orange',
      courses: [
        c('lang',  'Languages', 1, null, ['eng','hindi','telugu','sanskrit','urdu']),
        c('skill', 'Skill Development', 1, null, ['cs','python','web','aiml','mkt','mgmt']),
        c('aptrea','Aptitude & Reasoning', 1, null, ['apt','reason','maths','stat']),
        c('spoken','Spoken English', 1, null, ['eng','bcom'])
      ]
    }
  ];

  /* Question types the exam engine can render and the AI can be asked for.
     `objective` marks the ones that can be graded without a human or the AI
     marker. Which of these are OFFERED depends on the subject — see
     TYPE_RULES in pages.js; a Biology paper should not offer coding, and a
     History paper should not offer numericals. */
  var QTYPES = [
    { id: 'mcq',     name: 'MCQ',                em: '🔘', marks: 1, objective: true },
    { id: 'multi',   name: 'Multiple Select',    em: '☑️', marks: 2, objective: true },
    { id: 'tf',      name: 'True / False',       em: '⚖️', marks: 1, objective: true },
    { id: 'fill',    name: 'Fill in the Blank',  em: '✏️', marks: 1, objective: true },
    { id: 'oneword', name: 'One Word Answer',    em: '💬', marks: 1, objective: true },
    { id: 'match',   name: 'Match the Following',em: '🔗', marks: 4, objective: true },
    { id: 'assert',  name: 'Assertion & Reason', em: '🧠', marks: 1, objective: true },
    { id: 'short',   name: 'Short Answer',       em: '📝', marks: 2 },
    { id: 'long',    name: 'Long Answer',        em: '📄', marks: 5 },
    { id: 'num',     name: 'Numerical',          em: '🔢', marks: 3 },
    { id: 'diagram', name: 'Diagram Based',      em: '📐', marks: 4 },
    { id: 'case',    name: 'Case Study',         em: '📋', marks: 6 },
    { id: 'passage', name: 'Passage Based',      em: '📖', marks: 5 },
    { id: 'image',   name: 'Image Based',        em: '🖼️', marks: 3 },
    { id: 'code',    name: 'Coding',             em: '💻', marks: 5 },
    { id: 'desc',    name: 'Descriptive',        em: '🗒️', marks: 8 }
  ];

  /* ---- derived lookups, built once ---- */
  var byCat = {}, allCourses = [], searchIndex = [];
  CATS.forEach(function (cat) {
    byCat[cat.id] = cat;
    searchIndex.push({ t: cat.name + ' ' + cat.sub, label: cat.name, meta: cat.sub, em: cat.em,
                       kind: 'Category', go: { view: 'explore', cat: cat.id } });
    cat.courses.forEach(function (co) {
      co.cat = cat.id;
      allCourses.push(co);
      searchIndex.push({ t: co.name + ' ' + cat.name, label: co.name,
                         meta: cat.name + (co.years > 1 ? ' · ' + co.years + ' yr' : ''),
                         em: cat.em, kind: 'Course',
                         go: { view: 'explore', cat: cat.id, course: co.id } });
    });
  });
  Object.keys(S).forEach(function (k) {
    S[k].id = k;
    searchIndex.push({ t: S[k].name, label: S[k].name, meta: 'Subject', em: S[k].em,
                       kind: 'Subject', go: { view: 'practice', subject: k } });
  });
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

  var ORDINAL = ['1st Year', '2nd Year', '3rd Year', '4th Year', '5th Year', '6th Year'];

  w.CATALOG = {
    subjects: S,
    cats: CATS,
    byCat: byCat,
    courses: allCourses,
    qtypes: QTYPES,
    index: searchIndex,

    course: function (catId, courseId) {
      var cat = byCat[catId]; if (!cat) return null;
      return cat.courses.filter(function (x) { return x.id === courseId; })[0] || cat.courses[0];
    },

    /** How many years this course runs. 1 means no year picker. */
    yearsOf: function (catId, courseId) {
      var co = this.course(catId, courseId);
      return co ? (co.years || 1) : 1;
    },

    /** Labels for the year dropdown, e.g. ["1st Year", … ]. */
    yearLabels: function (catId, courseId) {
      var n = this.yearsOf(catId, courseId), out = [];
      for (var i = 0; i < n; i++) out.push(ORDINAL[i] || (i + 1) + 'th Year');
      return out;
    },

    /**
     * Subjects for a course. Pass a 1-based `year` to get that year's
     * syllabus; omit it (or pass 0 / 'all') for the whole course.
     */
    subsOf: function (catId, courseId, year) {
      var co = this.course(catId, courseId);
      if (!co) return [];
      var keys = co.subs;
      if (year && co.ysubs) {
        var i = parseInt(year, 10) - 1;
        if (co.ysubs[i]) keys = co.ysubs[i];
      }
      return keys.map(function (k) { return S[k]; }).filter(Boolean);
    }
  };
})(window);
