/**
 * 7By Resume AI v1.0
 * Browser-native resume intelligence engine — runs 100% locally, no server.
 * https://7by.in
 *
 * Usage:
 *   ResumeAI.generateSummary({category:'software', title:'Frontend Developer', years:4, skills:['React','TypeScript']})
 *   ResumeAI.enhanceBullets(text, 'software')
 *   ResumeAI.atsScore(resumeData, 'software')   → {score, checks:[...]}
 *   ResumeAI.sample('healthcare')               → full sample resume data
 *
 * License: 7By.in Personal Use License
 */
(function(global){
'use strict';

/* ─────────────────────────────────────────────
   ACTION VERB BANK (grouped, used by enhancer + resources UI)
───────────────────────────────────────────── */
const VERBS = {
  Leadership:   ['Led','Directed','Managed','Coordinated','Mentored','Supervised','Chaired','Oversaw','Delegated','Championed'],
  Achievement:  ['Achieved','Delivered','Exceeded','Surpassed','Attained','Completed','Won','Earned','Secured','Outperformed'],
  Growth:       ['Increased','Grew','Boosted','Accelerated','Expanded','Scaled','Improved','Maximized','Doubled','Generated'],
  Efficiency:   ['Reduced','Streamlined','Automated','Optimized','Simplified','Consolidated','Eliminated','Cut','Saved','Standardized'],
  Technical:    ['Built','Developed','Engineered','Designed','Implemented','Deployed','Architected','Integrated','Migrated','Programmed'],
  Analysis:     ['Analyzed','Evaluated','Researched','Assessed','Forecasted','Audited','Measured','Identified','Diagnosed','Investigated'],
  Communication:['Presented','Negotiated','Authored','Facilitated','Persuaded','Collaborated','Advised','Trained','Documented','Promoted'],
  Initiative:   ['Launched','Initiated','Founded','Pioneered','Established','Introduced','Created','Spearheaded','Devised','Redesigned']
};
const ALL_VERBS = Object.values(VERBS).flat();

/* weak openers → strong replacements */
const WEAK_MAP = [
  [/^(i\s+)?(was\s+)?responsible\s+for\s+/i, 'Owned '],
  [/^(i\s+)?(was\s+)?in\s+charge\s+of\s+/i, 'Owned '],
  [/^(i\s+)?worked\s+on\s+/i, 'Delivered '],
  [/^(i\s+)?worked\s+with\s+/i, 'Collaborated with '],
  [/^(i\s+)?helped\s+(to\s+|with\s+)?/i, 'Supported '],
  [/^(i\s+)?assisted\s+(in|with)\s+/i, 'Supported '],
  [/^(i\s+)?participated\s+in\s+/i, 'Contributed to '],
  [/^(i\s+)?was\s+involved\s+in\s+/i, 'Drove '],
  [/^(i\s+)?had\s+to\s+/i, 'Handled '],
  [/^duties\s+included\s+/i, 'Handled '],
  [/^tasked\s+with\s+/i, 'Owned '],
  [/^(i\s+)?used\s+/i, 'Leveraged '],
  [/^(i\s+)?did\s+/i, 'Executed '],
  [/^(i\s+)?made\s+/i, 'Created ']
];
/* verbs the WEAK_MAP introduces — count them as strong openers too */
const EXTRA_VERBS = ['Owned','Supported','Contributed','Drove','Handled','Leveraged','Collaborated','Executed'];
/* common strong past-tense openers not in the grouped bank — recognized by the ATS check */
const COMMON_STRONG = ['Provided','Prepared','Conducted','Performed','Maintained','Assessed','Planned',
  'Organized','Ran','Grew','Raised','Cut','Saved','Sourced','Screened','Advised','Reviewed','Represented',
  'Ensured','Resolved','Taught','Recruited','Drafted','Administered','Monitored','Educated','Treated',
  'Documented','Supervised','Commissioned','Inspected','Fixed','Wrote','Coached','Upsold','Welcomed',
  'Detected','Closed','Exceeded','Negotiated'];
/* gerund → past tense, for "responsible for managing X" → "Managed X" */
const IRREGULAR = {building:'Built', writing:'Wrote', leading:'Led', making:'Made', running:'Ran',
  overseeing:'Oversaw', setting:'Set', getting:'Got', driving:'Drove', taking:'Took', doing:'Did',
  giving:'Gave', holding:'Held', keeping:'Kept', selling:'Sold', teaching:'Taught', buying:'Bought',
  bringing:'Brought', winning:'Won', finding:'Found'};
function gerundToPast(w){
  const g = w.toLowerCase();
  if (IRREGULAR[g]) return IRREGULAR[g];
  const stem = g.slice(0, -3);
  const past = stem + 'ed';
  return past.charAt(0).toUpperCase() + past.slice(1);
}

/* ─────────────────────────────────────────────
   JOB CATEGORY KNOWLEDGE BASE — 16 categories
   Each: label, icon, keywords (for ATS match),
   skills (suggestions), verbs (preferred), sample resume
───────────────────────────────────────────── */
const CAT = {

software: {
  label:'Software & IT', icon:'💻',
  keywords:['software','development','api','cloud','agile','ci/cd','testing','architecture','deployment','debugging','git','scalable'],
  skills:['JavaScript','TypeScript','React','Node.js','Python','SQL','AWS','Docker','Git','REST APIs','CI/CD','Agile/Scrum'],
  verbs:['Built','Developed','Engineered','Architected','Automated','Deployed','Optimized','Migrated'],
  domain:'software development',
  sample:{
    name:'Arjun Mehta', title:'Full-Stack Developer', email:'arjun.mehta@email.com', phone:'+91 98765 43210',
    location:'Bengaluru, India', website:'github.com/arjunm', linkedin:'linkedin.com/in/arjunmehta',
    summary:'Full-stack developer with 5+ years building scalable web applications for fintech and SaaS products. Shipped features used by 2M+ users, cut API response times by 60%, and mentored a team of 4 junior engineers. Strong in React, Node.js, and cloud-native architecture on AWS.',
    experience:[
      {role:'Senior Software Engineer', company:'FinEdge Technologies', location:'Bengaluru', start:'Mar 2022', end:'Present',
       bullets:['Architected a microservices payment platform processing ₹40Cr+ monthly, improving uptime to 99.95%','Reduced API p95 latency by 60% through query optimization and Redis caching','Mentored 4 junior developers and introduced code-review standards adopted across 3 teams','Automated CI/CD pipelines with GitHub Actions, cutting release time from 2 days to 2 hours']},
      {role:'Software Engineer', company:'CloudNova Labs', location:'Hyderabad', start:'Jun 2019', end:'Feb 2022',
       bullets:['Built customer dashboard in React and TypeScript serving 500K monthly active users','Migrated legacy PHP monolith to Node.js microservices, reducing infra cost by 35%','Implemented automated test suites raising coverage from 40% to 85%']}],
    education:[{degree:'B.Tech, Computer Science', school:'NIT Warangal', year:'2019', detail:'CGPA 8.6/10'}],
    skills:['JavaScript','TypeScript','React','Node.js','Python','PostgreSQL','AWS','Docker','Kubernetes','Redis','Git','Agile'],
    projects:[{name:'OpenTrack', link:'github.com/arjunm/opentrack', desc:'Open-source expense tracker with 1.2K GitHub stars; React + Supabase.'}],
    certs:[{name:'AWS Certified Solutions Architect', org:'Amazon Web Services', year:'2023'}],
    languages:['English','Hindi','Telugu']}
},

data: {
  label:'Data & AI', icon:'📊',
  keywords:['data','machine learning','analytics','python','sql','model','pipeline','visualization','statistics','insights','etl','dashboard'],
  skills:['Python','SQL','Pandas','TensorFlow','PyTorch','Power BI','Tableau','Spark','ETL Pipelines','Statistics','A/B Testing','NLP'],
  verbs:['Analyzed','Modeled','Forecasted','Automated','Visualized','Trained','Deployed','Measured'],
  domain:'data science and analytics',
  sample:{
    name:'Sara Iyer', title:'Data Scientist', email:'sara.iyer@email.com', phone:'+91 91234 56789',
    location:'Pune, India', website:'', linkedin:'linkedin.com/in/saraiyer',
    summary:'Data scientist with 4 years turning raw data into revenue — built churn models that saved $1.2M annually, deployed ML pipelines serving 10M predictions/day, and shipped executive dashboards used by C-suite weekly. Deep in Python, SQL, and production ML.',
    experience:[
      {role:'Data Scientist', company:'RetailMind Analytics', location:'Pune', start:'Jan 2022', end:'Present',
       bullets:['Built customer churn prediction model (XGBoost) reducing churn by 18%, saving $1.2M annually','Deployed real-time recommendation pipeline on Spark serving 10M predictions daily','Designed A/B testing framework adopted by 6 product teams, standardizing experiment analysis']},
      {role:'Data Analyst', company:'Quantiva Consulting', location:'Mumbai', start:'Jul 2020', end:'Dec 2021',
       bullets:['Automated weekly reporting with Python and SQL, saving 15 analyst-hours per week','Created Power BI dashboards tracking KPIs for 12 enterprise clients','Analyzed pricing data across 40K SKUs, identifying 7% margin improvement opportunity']}],
    education:[{degree:'M.Sc, Statistics', school:'Pune University', year:'2020', detail:'First Class with Distinction'}],
    skills:['Python','SQL','Pandas','Scikit-learn','XGBoost','Spark','Power BI','Airflow','Statistics','A/B Testing','AWS SageMaker','Git'],
    projects:[{name:'NewsPulse NLP', link:'', desc:'Sentiment analysis engine for financial news; 89% F1 on custom dataset.'}],
    certs:[{name:'TensorFlow Developer Certificate', org:'Google', year:'2022'}],
    languages:['English','Hindi','Marathi']}
},

design: {
  label:'Design & Creative', icon:'🎨',
  keywords:['design','ui','ux','figma','prototype','user research','branding','typography','wireframe','usability','visual','creative'],
  skills:['Figma','Adobe XD','Photoshop','Illustrator','UI Design','UX Research','Prototyping','Design Systems','Typography','Wireframing','HTML/CSS','Motion Design'],
  verbs:['Designed','Crafted','Prototyped','Redesigned','Illustrated','Conceptualized','Researched','Streamlined'],
  domain:'product and visual design',
  sample:{
    name:'Neha Kapoor', title:'Senior Product Designer', email:'neha.kapoor@email.com', phone:'+91 99887 76655',
    location:'Gurugram, India', website:'nehakapoor.design', linkedin:'linkedin.com/in/nehakapoor',
    summary:'Product designer with 6 years crafting interfaces used by millions. Redesigned a fintech onboarding flow that lifted conversion 34%, built a design system serving 8 product squads, and led user research across 3 markets. Fluent in Figma, systems thinking, and shipping with engineers.',
    experience:[
      {role:'Senior Product Designer', company:'PaySwift', location:'Gurugram', start:'Apr 2021', end:'Present',
       bullets:['Redesigned onboarding flow, increasing signup conversion by 34% and cutting drop-off by half','Built and maintained a design system used by 8 squads, reducing design-to-dev handoff time 40%','Led usability testing with 120+ users across 3 markets to validate the new payments experience']},
      {role:'UI/UX Designer', company:'Studio Verve', location:'Delhi', start:'May 2018', end:'Mar 2021',
       bullets:['Designed 20+ client websites and apps across e-commerce, health, and edtech','Created brand identities and design guidelines for 9 startups','Prototyped interactions in Figma that cut client revision cycles from 5 rounds to 2']}],
    education:[{degree:'B.Des, Communication Design', school:'NID Ahmedabad', year:'2018', detail:''}],
    skills:['Figma','Adobe Creative Suite','Design Systems','UX Research','Prototyping','Interaction Design','Typography','HTML/CSS','Usability Testing','Accessibility'],
    projects:[{name:'Dribbble Portfolio', link:'dribbble.com/nehak', desc:'40+ shots, 12K followers; featured in Figma community twice.'}],
    certs:[{name:'Google UX Design Certificate', org:'Google', year:'2021'}],
    languages:['English','Hindi','Punjabi']}
},

marketing: {
  label:'Marketing', icon:'📣',
  keywords:['marketing','campaign','seo','content','brand','social media','analytics','conversion','roi','engagement','growth','email'],
  skills:['SEO','Google Ads','Meta Ads','Content Strategy','Email Marketing','Google Analytics','Social Media','Copywriting','CRM (HubSpot)','Marketing Automation','Brand Strategy','A/B Testing'],
  verbs:['Launched','Grew','Boosted','Optimized','Positioned','Promoted','Generated','Converted'],
  domain:'digital marketing',
  sample:{
    name:'Rohan Desai', title:'Digital Marketing Manager', email:'rohan.desai@email.com', phone:'+91 90000 11122',
    location:'Mumbai, India', website:'', linkedin:'linkedin.com/in/rohandesai',
    summary:'Digital marketing manager with 6 years scaling B2C brands. Grew organic traffic 3x in 12 months, managed ₹2Cr annual ad budget at 4.2x ROAS, and built an email program generating 22% of total revenue. Data-first, creative-second-but-close.',
    experience:[
      {role:'Digital Marketing Manager', company:'UrbanNest (D2C Home Brand)', location:'Mumbai', start:'Feb 2021', end:'Present',
       bullets:['Managed ₹2Cr annual paid media budget across Google and Meta at a blended 4.2x ROAS','Grew organic traffic from 80K to 260K monthly sessions in 12 months via SEO and content strategy','Built lifecycle email program (Klaviyo) contributing 22% of total revenue','Led a team of 3 specialists and 5 freelancers across content, design, and performance']},
      {role:'SEO & Content Specialist', company:'BrightReach Agency', location:'Mumbai', start:'Jun 2018', end:'Jan 2021',
       bullets:['Delivered SEO strategy for 15 clients, averaging 85% year-over-year organic growth','Authored 200+ articles and landing pages, ranking 60+ keywords in the top 3 positions','Increased client newsletter open rates from 14% to 31% through segmentation and testing']}],
    education:[{degree:'BMS, Marketing', school:'Mumbai University', year:'2018', detail:''}],
    skills:['SEO','SEM','Google Ads','Meta Ads','Google Analytics 4','Klaviyo','HubSpot','Content Strategy','Copywriting','CRO','Ahrefs','Excel'],
    projects:[],
    certs:[{name:'Google Ads Search Certification', org:'Google', year:'2023'},{name:'HubSpot Inbound Marketing', org:'HubSpot Academy', year:'2022'}],
    languages:['English','Hindi','Gujarati']}
},

sales: {
  label:'Sales & Business Dev', icon:'🤝',
  keywords:['sales','revenue','pipeline','quota','negotiation','crm','prospecting','closing','account','client','targets','b2b'],
  skills:['B2B Sales','Lead Generation','Salesforce','Negotiation','Cold Outreach','Account Management','Pipeline Management','CRM','Presentations','Forecasting','Upselling','Client Retention'],
  verbs:['Closed','Exceeded','Negotiated','Generated','Secured','Expanded','Converted','Won'],
  domain:'sales and business development',
  sample:{
    name:'Vikram Singh', title:'Business Development Manager', email:'vikram.singh@email.com', phone:'+91 98111 22334',
    location:'Delhi, India', website:'', linkedin:'linkedin.com/in/vikramsingh',
    summary:'B2B sales leader with 7 years closing enterprise SaaS deals. Consistently 115%+ of quota, built a ₹6Cr pipeline from scratch in a new territory, and closed the company’s largest-ever deal (₹1.8Cr ARR). Skilled in consultative selling, C-level negotiation, and team coaching.',
    experience:[
      {role:'Business Development Manager', company:'Zentrix Software', location:'Delhi', start:'Aug 2020', end:'Present',
       bullets:['Exceeded annual quota 3 years running (115%, 128%, 121%), managing a ₹4Cr book of business','Closed the company’s largest deal to date — ₹1.8Cr ARR with a Fortune 500 manufacturer','Built and managed a pipeline of 120+ qualified opportunities across BFSI and manufacturing','Coached 4 SDRs, improving demo-to-opportunity conversion from 22% to 38%']},
      {role:'Sales Executive', company:'OfficeEdge Solutions', location:'Noida', start:'May 2017', end:'Jul 2020',
       bullets:['Generated 300+ qualified leads annually through cold outreach and LinkedIn prospecting','Won 45 new SMB accounts in FY19, ranking #2 of 30 reps nationally','Negotiated multi-year renewals, improving retention from 78% to 91%']}],
    education:[{degree:'BBA', school:'Delhi University', year:'2017', detail:''}],
    skills:['Enterprise Sales','Salesforce','HubSpot','Negotiation','Prospecting','Solution Selling','Forecasting','Account Management','Presentations','MS Excel'],
    projects:[],
    certs:[{name:'SPIN Selling Certification', org:'Huthwaite International', year:'2021'}],
    languages:['English','Hindi']}
},

finance: {
  label:'Finance & Accounting', icon:'💰',
  keywords:['financial','accounting','audit','budget','forecast','compliance','reporting','reconciliation','tax','analysis','gaap','variance'],
  skills:['Financial Reporting','Budgeting & Forecasting','Excel (Advanced)','Tally','SAP','QuickBooks','GST & Taxation','Auditing','Variance Analysis','Financial Modeling','Accounts Payable/Receivable','IFRS/GAAP'],
  verbs:['Audited','Forecasted','Reconciled','Reduced','Analyzed','Reported','Managed','Streamlined'],
  domain:'finance and accounting',
  sample:{
    name:'Priya Sharma', title:'Senior Financial Analyst', email:'priya.sharma@email.com', phone:'+91 98220 33445',
    location:'Chennai, India', website:'', linkedin:'linkedin.com/in/priyasharma',
    summary:'Financial analyst with 5 years in FP&A and audit. Built forecasting models covering ₹120Cr revenue, cut month-end close from 9 days to 4, and identified ₹3.2Cr in cost savings. CA Inter qualified; advanced Excel, SAP, and a habit of finding the number nobody else checked.',
    experience:[
      {role:'Senior Financial Analyst', company:'Meridian Manufacturing', location:'Chennai', start:'Oct 2021', end:'Present',
       bullets:['Built rolling 12-month forecast models covering ₹120Cr annual revenue, improving accuracy to within 3%','Reduced month-end close cycle from 9 days to 4 by automating reconciliations in SAP','Identified ₹3.2Cr in annual cost savings through vendor spend and variance analysis','Presented monthly P&L reviews to CFO and business heads across 3 plants']},
      {role:'Audit Associate', company:'KR & Associates', location:'Chennai', start:'Jul 2019', end:'Sep 2021',
       bullets:['Executed statutory audits for 18 clients with turnover up to ₹200Cr','Detected and resolved GST input credit mismatches recovering ₹45L for clients','Prepared audit documentation and financial statements per IND-AS']}],
    education:[{degree:'B.Com + CA Intermediate', school:'Madras University / ICAI', year:'2019', detail:''}],
    skills:['FP&A','Financial Modeling','Advanced Excel','SAP FICO','Tally ERP','GST','Variance Analysis','Budgeting','IND-AS','Power BI'],
    projects:[],
    certs:[{name:'Financial Modeling & Valuation Analyst (FMVA)', org:'CFI', year:'2022'}],
    languages:['English','Hindi','Tamil']}
},

healthcare: {
  label:'Healthcare & Nursing', icon:'🩺',
  keywords:['patient','clinical','care','medical','treatment','nursing','safety','records','emergency','healthcare','hipaa','vitals'],
  skills:['Patient Care','Clinical Documentation','IV Therapy','Emergency Response','EHR/EMR Systems','Medication Administration','Patient Education','Infection Control','Vital Signs Monitoring','Team Coordination','ICU Care','Triage'],
  verbs:['Administered','Monitored','Coordinated','Educated','Assessed','Treated','Documented','Improved'],
  domain:'healthcare',
  sample:{
    name:'Anjali Nair', title:'Registered Nurse (ICU)', email:'anjali.nair@email.com', phone:'+91 97456 78901',
    location:'Kochi, India', website:'', linkedin:'linkedin.com/in/anjalinair',
    summary:'Registered nurse with 6 years in critical care across 300+ bed hospitals. Managed ICU caseloads of 6-8 critical patients, trained 15 new nurses, and helped cut medication errors by 40% through a double-check protocol. Calm under pressure, precise with charts.',
    experience:[
      {role:'Senior Staff Nurse — ICU', company:'Lakeshore Multispecialty Hospital', location:'Kochi', start:'Jan 2021', end:'Present',
       bullets:['Managed care for 6-8 critical patients per shift in a 24-bed ICU, maintaining zero adverse-event record','Implemented medication double-check protocol, reducing administration errors by 40% unit-wide','Trained and mentored 15 newly recruited nurses on ICU protocols and EMR documentation','Coordinated with multidisciplinary teams on ventilator weaning and post-operative care plans']},
      {role:'Staff Nurse', company:'City Care Hospital', location:'Thrissur', start:'Jun 2018', end:'Dec 2020',
       bullets:['Provided direct patient care in a 40-bed medical-surgical ward','Assisted in 200+ emergency admissions, performing triage and initial assessments','Educated patients and families on post-discharge care, reducing 30-day readmissions']}],
    education:[{degree:'B.Sc Nursing', school:'Kerala University of Health Sciences', year:'2018', detail:'Registered with Kerala Nurses Council'}],
    skills:['Critical Care','Ventilator Management','IV Therapy','EMR Charting','Medication Administration','Triage','Infection Control','BLS/ACLS','Patient Education','Team Leadership'],
    projects:[],
    certs:[{name:'ACLS (Advanced Cardiovascular Life Support)', org:'American Heart Association', year:'2023'},{name:'BLS Provider', org:'AHA', year:'2023'}],
    languages:['English','Malayalam','Hindi']}
},

education: {
  label:'Education & Teaching', icon:'📚',
  keywords:['teaching','curriculum','students','classroom','learning','assessment','lesson','instruction','education','mentoring','pedagogy','engagement'],
  skills:['Curriculum Design','Lesson Planning','Classroom Management','Student Assessment','EdTech Tools','Differentiated Instruction','Parent Communication','Google Classroom','Smart Board','Mentoring','Public Speaking','Special Education Basics'],
  verbs:['Taught','Designed','Mentored','Improved','Facilitated','Assessed','Motivated','Developed'],
  domain:'education',
  sample:{
    name:'Kavita Rao', title:'Secondary School Mathematics Teacher', email:'kavita.rao@email.com', phone:'+91 96543 21098',
    location:'Jaipur, India', website:'', linkedin:'',
    summary:'Mathematics teacher with 8 years across CBSE secondary classrooms. Raised board-exam averages by 14 points, designed a peer-tutoring program adopted school-wide, and integrated EdTech that doubled homework completion. Believes every student can learn math — and proves it.',
    experience:[
      {role:'Senior Mathematics Teacher', company:'Sunrise International School (CBSE)', location:'Jaipur', start:'Apr 2019', end:'Present',
       bullets:['Taught mathematics to 180+ students across grades 9-12, raising board-exam averages by 14 points','Designed a peer-tutoring program adopted school-wide, cutting failure rates by half','Integrated Google Classroom and GeoGebra, doubling homework completion to 92%','Mentored 6 junior teachers on lesson planning and assessment design']},
      {role:'Mathematics Teacher', company:'Green Valley Public School', location:'Jaipur', start:'Jun 2016', end:'Mar 2019',
       bullets:['Planned and delivered lessons for grades 6-10 aligned to CBSE curriculum','Ran remedial classes improving weakest-quartile scores by 22% on average','Coordinated the annual math olympiad with 400+ participants']}],
    education:[{degree:'M.Sc Mathematics + B.Ed', school:'University of Rajasthan', year:'2016', detail:'CTET Qualified'}],
    skills:['Curriculum Design','Classroom Management','CBSE Assessment','Google Classroom','GeoGebra','Lesson Planning','Remedial Teaching','Parent Communication','Mentoring'],
    projects:[],
    certs:[{name:'CTET (Central Teacher Eligibility Test)', org:'CBSE', year:'2016'}],
    languages:['English','Hindi']}
},

engineering: {
  label:'Core Engineering', icon:'⚙️',
  keywords:['engineering','design','project','autocad','manufacturing','quality','safety','maintenance','construction','specifications','testing','process'],
  skills:['AutoCAD','SolidWorks','Project Management','Quality Control','Lean Manufacturing','Six Sigma','Preventive Maintenance','MS Project','Site Supervision','Vendor Management','Safety Compliance','Root Cause Analysis'],
  verbs:['Engineered','Designed','Supervised','Commissioned','Inspected','Optimized','Fabricated','Executed'],
  domain:'engineering',
  sample:{
    name:'Rahul Verma', title:'Mechanical Engineer — Production', email:'rahul.verma@email.com', phone:'+91 95678 12340',
    location:'Ahmedabad, India', website:'', linkedin:'linkedin.com/in/rahulverma',
    summary:'Mechanical engineer with 5 years in production and process improvement. Led a line-balancing project that lifted output 25%, cut unplanned downtime 30% through predictive maintenance, and managed a 22-member shop floor team. Six Sigma Green Belt.',
    experience:[
      {role:'Production Engineer', company:'Apex Auto Components', location:'Ahmedabad', start:'Sep 2021', end:'Present',
       bullets:['Led line-balancing and kaizen initiatives increasing daily output by 25% without added headcount','Reduced unplanned downtime 30% by implementing a predictive maintenance schedule','Supervised a 22-member shop floor team across 2 shifts, maintaining zero lost-time accidents','Coordinated with vendors to qualify 8 new component suppliers, cutting material cost 12%']},
      {role:'Graduate Engineer Trainee', company:'Suryadev Heavy Industries', location:'Vadodara', start:'Jul 2019', end:'Aug 2021',
       bullets:['Prepared fabrication drawings and BOMs in AutoCAD and SolidWorks for pressure vessel projects','Conducted quality inspections and NDT coordination for 50+ weldments monthly','Assisted commissioning of a new CNC machining cell, documenting SOPs']}],
    education:[{degree:'B.E. Mechanical Engineering', school:'Gujarat Technological University', year:'2019', detail:'CGPA 8.2/10'}],
    skills:['AutoCAD','SolidWorks','Lean Manufacturing','Kaizen','Six Sigma','Preventive Maintenance','Quality Control','SAP PM','Team Supervision','Safety (5S)'],
    projects:[],
    certs:[{name:'Six Sigma Green Belt', org:'ASQ', year:'2022'}],
    languages:['English','Hindi','Gujarati']}
},

customer: {
  label:'Customer Service', icon:'🎧',
  keywords:['customer','support','resolution','satisfaction','csat','tickets','escalation','communication','service','crm','sla','retention'],
  skills:['Customer Support','Zendesk','Freshdesk','Conflict Resolution','Live Chat Support','Ticket Management','CRM','Upselling','Empathy & Active Listening','SLA Management','Voice & Email Support','Knowledge Base Writing'],
  verbs:['Resolved','Handled','Improved','Achieved','De-escalated','Assisted','Maintained','Exceeded'],
  domain:'customer support',
  sample:{
    name:'Amit Kulkarni', title:'Customer Support Team Lead', email:'amit.kulkarni@email.com', phone:'+91 90909 80807',
    location:'Pune, India', website:'', linkedin:'',
    summary:'Customer support professional with 5 years across SaaS and e-commerce. Led a 12-agent team to a 94% CSAT, cut average resolution time 45%, and wrote a knowledge base that deflected 30% of tickets. Fluent in three languages and in calming angry customers.',
    experience:[
      {role:'Customer Support Team Lead', company:'ShopKart', location:'Pune', start:'Mar 2022', end:'Present',
       bullets:['Led a 12-agent support team handling 8,000+ monthly tickets, sustaining 94% CSAT','Reduced average resolution time from 22 to 12 hours by redesigning escalation workflows','Authored 60-article knowledge base deflecting 30% of inbound tickets','Trained agents on de-escalation, cutting negative reviews by 38%']},
      {role:'Customer Support Executive', company:'TechAssist BPO', location:'Pune', start:'Jan 2019', end:'Feb 2022',
       bullets:['Handled 60+ voice and chat interactions daily for a US SaaS client at 97% QA score','Maintained first-contact resolution of 82%, highest on a 40-agent floor','Upsold premium plans generating $4K+ monthly recurring revenue','Documented recurring issues in the CRM and escalated product bugs, cutting repeat contacts by 15%']}],
    education:[{degree:'B.Com', school:'Pune University', year:'2018', detail:''}],
    skills:['Zendesk','Freshdesk','Live Chat','Voice Support','De-escalation','SLA Management','Team Leadership','QA Coaching','CRM','Excel'],
    projects:[],
    certs:[],
    languages:['English','Hindi','Marathi']}
},

hr: {
  label:'HR & Recruiting', icon:'🧑‍💼',
  keywords:['recruitment','hiring','onboarding','hr','talent','employee','engagement','payroll','policy','performance','sourcing','retention'],
  skills:['Talent Acquisition','ATS (Greenhouse/Zoho)','Onboarding','Employee Engagement','HRMS','Payroll Coordination','Performance Management','Policy Design','Interviewing','Employer Branding','Exit Management','Labor Compliance'],
  verbs:['Recruited','Onboarded','Designed','Improved','Coordinated','Implemented','Reduced','Facilitated'],
  domain:'human resources',
  sample:{
    name:'Divya Menon', title:'HR Generalist', email:'divya.menon@email.com', phone:'+91 98989 76765',
    location:'Bengaluru, India', website:'', linkedin:'linkedin.com/in/divyamenon',
    summary:'HR generalist with 5 years across recruiting, onboarding, and engagement for fast-growing startups. Hired 150+ people with a 92% offer-acceptance rate, cut early attrition 35% with a revamped onboarding program, and ran engagement initiatives that lifted eNPS from 18 to 46.',
    experience:[
      {role:'HR Generalist', company:'Lyra Fintech', location:'Bengaluru', start:'May 2021', end:'Present',
       bullets:['Recruited 150+ hires across engineering, product, and ops with 92% offer-acceptance rate','Redesigned onboarding into a structured 30-day program, cutting 90-day attrition by 35%','Ran quarterly engagement surveys and action plans, lifting eNPS from 18 to 46','Administered HRMS and payroll inputs for a 220-employee org with zero compliance misses']},
      {role:'Talent Acquisition Executive', company:'HirePath Consulting', location:'Bengaluru', start:'Jun 2019', end:'Apr 2021',
       bullets:['Sourced and screened 2,000+ candidates for IT clients, closing 90+ positions annually','Reduced average time-to-fill from 45 to 28 days through pipeline automation in Zoho Recruit','Coordinated 40+ campus drives and walk-in events']}],
    education:[{degree:'MBA, Human Resources', school:'Christ University, Bengaluru', year:'2019', detail:''}],
    skills:['Talent Acquisition','Zoho Recruit','Onboarding','Employee Engagement','HRMS (Keka)','Payroll Coordination','PoSH Compliance','Performance Reviews','Employer Branding'],
    projects:[],
    certs:[{name:'PoSH Compliance Certification', org:'SHRM India', year:'2022'}],
    languages:['English','Hindi','Malayalam','Kannada']}
},

operations: {
  label:'Operations & Logistics', icon:'🚚',
  keywords:['operations','logistics','supply chain','inventory','warehouse','process','vendor','delivery','efficiency','procurement','planning','kpi'],
  skills:['Supply Chain Management','Inventory Control','Vendor Management','Warehouse Operations','ERP (SAP/Oracle)','Process Improvement','Logistics Planning','Procurement','KPI Reporting','Team Management','Route Optimization','Demand Forecasting'],
  verbs:['Streamlined','Coordinated','Reduced','Managed','Optimized','Negotiated','Scaled','Executed'],
  domain:'operations and supply chain',
  sample:{
    name:'Suresh Reddy', title:'Operations Manager', email:'suresh.reddy@email.com', phone:'+91 96060 54321',
    location:'Hyderabad, India', website:'', linkedin:'',
    summary:'Operations manager with 7 years in e-commerce logistics and warehousing. Scaled a fulfillment center from 2K to 12K daily orders, cut logistics cost per order 18%, and led a 60-person team across shifts. Runs on dashboards, checklists, and calm.',
    experience:[
      {role:'Operations Manager', company:'SwiftShip Logistics', location:'Hyderabad', start:'Jan 2020', end:'Present',
       bullets:['Scaled fulfillment center throughput from 2K to 12K orders/day while improving accuracy to 99.7%','Reduced logistics cost per order by 18% via carrier renegotiation and route optimization','Led a 60-member team across 3 shifts; cut attrition 25% with structured training and incentives','Implemented WMS-driven cycle counts, shrinking inventory variance below 0.5%']},
      {role:'Assistant Operations Manager', company:'MegaMart Retail', location:'Hyderabad', start:'Jul 2016', end:'Dec 2019',
       bullets:['Managed inbound and outbound operations for a 100K sq ft distribution center','Negotiated vendor contracts saving ₹80L annually in packaging and transport','Built daily KPI dashboards adopted across 4 regional warehouses']}],
    education:[{degree:'B.Tech, Industrial Engineering', school:'JNTU Hyderabad', year:'2016', detail:''}],
    skills:['Warehouse Management','WMS/ERP','Vendor Negotiation','Route Planning','Inventory Control','Lean Operations','KPI Dashboards','Team Leadership','Procurement','Excel'],
    projects:[],
    certs:[{name:'Certified Supply Chain Professional (CSCP)', org:'APICS', year:'2021'}],
    languages:['English','Hindi','Telugu']}
},

legal: {
  label:'Legal & Compliance', icon:'⚖️',
  keywords:['legal','contract','compliance','litigation','regulatory','drafting','counsel','risk','agreement','due diligence','policy','negotiation'],
  skills:['Contract Drafting','Legal Research','Regulatory Compliance','Litigation Support','Due Diligence','Corporate Law','IP Basics','Negotiation','Risk Assessment','Policy Drafting','Arbitration','Documentation'],
  verbs:['Drafted','Negotiated','Advised','Reviewed','Represented','Ensured','Mitigated','Structured'],
  domain:'legal practice',
  sample:{
    name:'Aditi Joshi', title:'Corporate Legal Associate', email:'aditi.joshi@email.com', phone:'+91 91112 23344',
    location:'Mumbai, India', website:'', linkedin:'linkedin.com/in/aditijoshi',
    summary:'Corporate lawyer with 4 years in contracts, compliance, and transaction support. Drafted and negotiated 300+ commercial agreements, supported due diligence on deals worth ₹500Cr+, and built a contract playbook that cut review turnaround 50%. Detail-obsessed, deadline-proof.',
    experience:[
      {role:'Legal Associate', company:'Khanna & Mehra LLP', location:'Mumbai', start:'Aug 2021', end:'Present',
       bullets:['Drafted and negotiated 300+ commercial contracts including MSAs, NDAs, and licensing agreements','Supported legal due diligence on M&A transactions aggregating ₹500Cr+ in deal value','Created a standard-clause playbook reducing contract review turnaround by 50%','Advised startup clients on data protection and regulatory compliance (DPDP Act readiness)']},
      {role:'Junior Associate', company:'Chambers of R. Iyer', location:'Mumbai', start:'Jun 2020', end:'Jul 2021',
       bullets:['Prepared pleadings, briefs, and research memos for commercial litigation matters','Assisted in arbitration proceedings for construction disputes worth ₹40Cr','Managed case files and court filings across 25+ active matters']}],
    education:[{degree:'B.A. LL.B (Hons.)', school:'Government Law College, Mumbai', year:'2020', detail:'Enrolled with Bar Council of Maharashtra & Goa'}],
    skills:['Contract Drafting','Negotiation','Due Diligence','Corporate Law','Compliance','Legal Research (SCC/Manupatra)','Arbitration','Data Protection','Documentation'],
    projects:[],
    certs:[],
    languages:['English','Hindi','Marathi']}
},

hospitality: {
  label:'Hospitality & Retail', icon:'🏨',
  keywords:['guest','hospitality','service','retail','store','sales floor','inventory','customer experience','front desk','food','operations','pos'],
  skills:['Guest Relations','POS Systems','Front Desk Operations','Inventory Management','Visual Merchandising','Food Safety','Reservation Systems','Upselling','Team Scheduling','Cash Handling','Complaint Resolution','Housekeeping Standards'],
  verbs:['Welcomed','Managed','Resolved','Boosted','Coordinated','Trained','Maintained','Delivered'],
  domain:'hospitality',
  sample:{
    name:'Karan Bhatia', title:'Front Office Executive', email:'karan.bhatia@email.com', phone:'+91 93334 55667',
    location:'Goa, India', website:'', linkedin:'',
    summary:'Hospitality professional with 5 years in front desk operations, guest relations, and retail service at 4-star properties. Maintained 4.6+ guest ratings, handled 80+ check-ins daily in peak season, managed POS billing and gift-shop inventory, and upsold room upgrades adding ₹18L annual revenue. Customer experience with actual warmth, not scripts.',
    experience:[
      {role:'Front Office Executive', company:'Sea Pearl Resort & Spa (4★)', location:'Goa', start:'Nov 2021', end:'Present',
       bullets:['Managed check-in/out for 80+ rooms daily in peak season with average guest rating of 4.6/5','Upsold room upgrades and packages generating ₹18L in incremental annual revenue','Resolved 95% of guest complaints on first contact, reducing escalations to management by 60%','Trained 8 new front-desk associates on PMS and service standards']},
      {role:'Guest Service Associate', company:'Grand Meridian Hotel', location:'Mumbai', start:'Jun 2019', end:'Oct 2021',
       bullets:['Handled reservations, billing, and concierge requests for a 150-room business hotel','Achieved highest quarterly guest-feedback score among 12 associates','Coordinated with housekeeping and F&B to turn around VIP rooms within 45 minutes']}],
    education:[{degree:'B.Sc, Hospitality & Hotel Administration', school:'IHM Mumbai', year:'2019', detail:''}],
    skills:['Front Office Operations','Opera PMS','Guest Relations','Upselling','Complaint Handling','Reservations','Billing & Cash Handling','Team Training','MS Office'],
    projects:[],
    certs:[],
    languages:['English','Hindi','Konkani']}
},

fresher: {
  label:'Student / Fresher', icon:'🎓',
  keywords:['internship','project','academic','learning','coursework','teamwork','volunteer','training','skills','achievement','initiative','adaptable'],
  skills:['MS Office','Communication','Teamwork','Time Management','Problem Solving','Presentation Skills','Canva','Basic Python','Data Entry','Social Media','Research','Adaptability'],
  verbs:['Completed','Led','Organized','Created','Volunteered','Presented','Learned','Built'],
  domain:'their field of study',
  sample:{
    name:'Sneha Patil', title:'B.Tech Graduate — Computer Science', email:'sneha.patil@email.com', phone:'+91 87654 32109',
    location:'Nagpur, India', website:'github.com/snehap', linkedin:'linkedin.com/in/snehapatil',
    summary:'Computer science graduate (2026) with hands-on internship experience, strong academic coursework, and 4 shipped projects. Built a campus event app used by 2,000+ students, interned on a real production codebase, and led a 5-member final-year project team with genuine teamwork and fast learning. Quick learner, quicker debugger.',
    experience:[
      {role:'Software Development Intern', company:'Innovex Solutions', location:'Nagpur', start:'Jan 2026', end:'Jun 2026',
       bullets:['Developed REST API endpoints in Node.js for a live inventory product used by 30+ stores','Fixed 25+ frontend bugs in React, improving the app’s Lighthouse score from 68 to 91','Wrote unit tests raising module coverage from 45% to 80%']},
      {role:'Campus Ambassador', company:'TechFest India', location:'Remote', start:'Aug 2025', end:'Dec 2025',
       bullets:['Promoted national hackathon on campus, driving 180 registrations (highest in the region)','Organized 3 workshop sessions with 250+ total attendees']}],
    education:[{degree:'B.Tech, Computer Science', school:'VNIT Nagpur', year:'2026', detail:'CGPA 8.4/10'}],
    skills:['Python','Java','JavaScript','React','Node.js','SQL','Git','Data Structures','Problem Solving','Teamwork'],
    projects:[{name:'CampusConnect', link:'github.com/snehap/campusconnect', desc:'Event discovery app used by 2,000+ students; React Native + Firebase.'},{name:'CropAdvisor ML', link:'', desc:'Final-year project: crop recommendation model with 91% accuracy; led team of 5.'}],
    certs:[{name:'Python for Everybody', org:'Coursera (University of Michigan)', year:'2025'}],
    languages:['English','Hindi','Marathi']}
},

executive: {
  label:'Manager / Executive', icon:'👔',
  keywords:['strategy','leadership','p&l','growth','stakeholder','transformation','revenue','vision','board','team','execution','scale'],
  skills:['Strategic Planning','P&L Management','Team Leadership','Stakeholder Management','Change Management','Business Development','Budgeting','OKRs','Executive Communication','M&A Support','Cross-functional Leadership','Board Reporting'],
  verbs:['Directed','Transformed','Scaled','Championed','Drove','Restructured','Delivered','Spearheaded'],
  domain:'business leadership',
  sample:{
    name:'Rajesh Malhotra', title:'Vice President — Operations', email:'rajesh.malhotra@email.com', phone:'+91 98100 00123',
    location:'Gurugram, India', website:'', linkedin:'linkedin.com/in/rajeshmalhotra',
    summary:'Operations executive with 15+ years scaling businesses from ₹50Cr to ₹400Cr revenue. Owned P&L for a 900-person division, led a digital transformation that lifted EBITDA margin 6 points, and built leadership benches that outlasted him — twice. Strategy that survives contact with Monday morning.',
    experience:[
      {role:'Vice President — Operations', company:'Vertex Consumer Group', location:'Gurugram', start:'Apr 2019', end:'Present',
       bullets:['Own P&L for a ₹400Cr division with 900 employees across manufacturing and distribution','Led digital transformation program lifting EBITDA margin from 9% to 15% in 3 years','Scaled distribution network from 8 to 22 states, growing revenue 2.4x','Built a leadership pipeline: 11 of 14 senior roles filled through internal promotion']},
      {role:'General Manager — Operations', company:'Nimbus Foods', location:'Delhi', start:'Jan 2013', end:'Mar 2019',
       bullets:['Directed 3 plants and 400+ staff, growing output 80% with 15% lower unit cost','Negotiated strategic sourcing contracts saving ₹12Cr annually','Championed a safety-first culture achieving 1,000+ days without lost-time incident']}],
    education:[{degree:'MBA, Operations', school:'XLRI Jamshedpur', year:'2008', detail:''},{degree:'B.E. Mechanical', school:'Delhi College of Engineering', year:'2005', detail:''}],
    skills:['P&L Ownership','Strategic Planning','Digital Transformation','Supply Chain','Leadership Development','Board Reporting','Change Management','Lean/Six Sigma','M&A Integration'],
    projects:[],
    certs:[],
    languages:['English','Hindi']}
}
};

/* ─────────────────────────────────────────────
   SUMMARY GENERATOR — template-based local generation
───────────────────────────────────────────── */
const SUMMARY_PATTERNS = [
  '{Title} with {years} of experience in {domain}. {Flavor} Skilled in {skills}, with a track record of delivering measurable results and raising the bar for the teams around them.',
  'Results-driven {title} bringing {years} of hands-on experience in {domain}. Combines deep expertise in {skills} with a bias for action — known for turning ambiguous problems into shipped, measurable outcomes.',
  '{Title} with {years} of experience and a strong foundation in {skills}. {Flavor} Focused on impact: measurable improvements, satisfied stakeholders, and work that holds up under pressure.',
  'Accomplished {title} with {years} in {domain}, specializing in {skills}. Recognized for reliability, clear communication, and consistently exceeding targets and expectations.',
  'Motivated {title} offering {years} of experience across {domain}. Strengths include {skills} — paired with the discipline to document, measure, and improve everything worth improving.'
];
const FRESHER_PATTERNS = [
  'Recent graduate and aspiring {title} with hands-on project and internship experience in {domain}. Skilled in {skills}, a fast learner, and eager to contribute from day one while growing under experienced mentors.',
  'Enthusiastic {title} and recent graduate with academic and project experience in {domain}. Brings {skills}, strong fundamentals, and the work ethic to turn opportunity into results.',
  'Entry-level {title} with a solid foundation in {skills} built through coursework, internships, and self-driven projects in {domain}. Seeking a role where curiosity and consistency are assets.'
];
const FLAVORS = {
  software:'Ships clean, tested code and thinks in systems.',
  data:'Turns messy data into decisions people actually make.',
  design:'Designs with users first and pixels a close second.',
  marketing:'Blends creative instinct with performance data.',
  sales:'Builds pipeline relentlessly and closes with integrity.',
  finance:'Finds the number nobody else checked.',
  healthcare:'Calm under pressure, precise with care.',
  education:'Makes hard subjects feel learnable.',
  engineering:'Balances precision engineering with practical deadlines.',
  customer:'Turns frustrated customers into loyal ones.',
  hr:'Builds workplaces people don’t want to leave.',
  operations:'Runs on dashboards, checklists, and calm.',
  legal:'Detail-obsessed and deadline-proof.',
  hospitality:'Delivers service with genuine warmth.',
  fresher:'Learns fast and asks the right questions.',
  executive:'Sets strategy that survives contact with execution.'
};

function pick(arr, seed){ return arr[Math.abs(seed) % arr.length]; }
function yearsPhrase(y){
  y = parseFloat(y) || 0;
  if (y <= 0) return 'growing';
  if (y < 1)  return 'nearly a year';
  if (y === 1) return '1 year';
  return y + '+ years';
}

function generateSummary(opts){
  const cat = CAT[opts.category] || CAT.software;
  const title = (opts.title || cat.sample.title || 'professional').trim();
  const skills = (opts.skills || []).filter(Boolean).slice(0, 4);
  const skillStr = !skills.length ? cat.skills.slice(0,3).join(', ')
    : skills.length === 1 ? skills[0]
    : skills.length === 2 ? skills.join(' and ')
    : skills.join(', ').replace(/, ([^,]*)$/, ', and $1');
  const seed = (opts.seed !== undefined) ? opts.seed : Math.floor(Math.random() * 1000);
  const fresh = opts.category === 'fresher' || !opts.years || parseFloat(opts.years) < 1;
  const pattern = fresh ? pick(FRESHER_PATTERNS, seed) : pick(SUMMARY_PATTERNS, seed);
  const t = title.toLowerCase();
  return pattern
    .replace('{Title}', title.charAt(0).toUpperCase() + title.slice(1))
    .replace('{title}', t)
    .replace('{years}', yearsPhrase(opts.years) + (fresh ? '' : ' of experience').replace(' of experience of experience',' of experience'))
    .replace(' of experience of experience', ' of experience')
    .replace('{domain}', cat.domain)
    .replace('{skills}', skillStr)
    .replace('{Flavor}', FLAVORS[opts.category] || '');
}

/* ─────────────────────────────────────────────
   BULLET ENHANCER — rewrites weak lines locally
───────────────────────────────────────────── */
function enhanceBullet(line, category){
  let s = String(line || '').trim();
  if (!s) return s;
  s = s.replace(/^[-•*–•]\s*/, '');           // strip list markers
  let replaced = false;
  for (const [re, rep] of WEAK_MAP) {                     // kill weak openers
    if (re.test(s)) { s = s.replace(re, rep); replaced = true; break; }
  }
  // "Owned managing the team" → "Managed the team"
  const gm = s.match(/^(Owned|Delivered|Supported|Handled|Drove)\s+(\w+ing)\b\s*/);
  if (gm) s = gerundToPast(gm[2]) + ' ' + s.slice(gm[0].length);
  s = s.replace(/^i\s+/i, '');                            // drop leading "I "
  // If it still doesn't start with a strong verb, prepend a category-appropriate one
  const first = (s.split(/\s+/)[0] || '').replace(/[^a-zA-Z]/g, '');
  const strong = ALL_VERBS.concat(EXTRA_VERBS);
  const isVerb = strong.some(v => v.toLowerCase() === first.toLowerCase()
    || (first.toLowerCase() === v.toLowerCase() + 'd')
    || (first.toLowerCase() === v.toLowerCase() + 'ed'));
  if (!replaced && !isVerb && first) {
    const cat = CAT[category] || CAT.software;
    const verb = cat.verbs[s.length % cat.verbs.length];
    s = verb + ' ' + s.charAt(0).toLowerCase() + s.slice(1);
  }
  s = s.charAt(0).toUpperCase() + s.slice(1);
  s = s.replace(/\s+/g, ' ').replace(/\.+$/, '');         // tidy spacing, drop trailing period
  return s;
}
function enhanceBullets(text, category){
  return String(text || '').split('\n').map(l => l.trim() ? enhanceBullet(l, category) : '').join('\n');
}

/* ─────────────────────────────────────────────
   ATS SCORER — local resume audit, 0–100
───────────────────────────────────────────── */
function atsScore(data, category){
  const cat = CAT[category] || CAT.software;
  const checks = [];
  let score = 0;
  const add = (pass, weight, label, tip) => { checks.push({pass, label, tip}); if (pass) score += weight; };

  const allBullets = (data.experience || []).flatMap(e => String(e.bullets || '').split('\n').map(b => b.trim()).filter(Boolean));
  const fullText = [
    data.name, data.title, data.summary, allBullets.join(' '),
    (data.skills || []).join(' '),
    (data.experience || []).map(e => [e.role, e.company].join(' ')).join(' '),
    (data.education || []).map(e => [e.degree, e.school, e.detail].join(' ')).join(' '),
    (data.projects || []).map(p => [p.name, p.desc].join(' ')).join(' '),
    (data.certs || []).map(c => [c.name, c.org].join(' ')).join(' '),
    (data.custom || []).map(c => [c.title, c.content].join(' ')).join(' ')
  ].join(' ').toLowerCase();
  const summaryWords = String(data.summary || '').trim().split(/\s+/).filter(Boolean).length;
  const totalWords = fullText.replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean).length;

  add(!!(data.email && data.phone), 10, 'Contact info complete',
      'Add both an email address and phone number — ATS systems and recruiters need them.');
  add(!!(data.title || '').trim(), 5, 'Professional title present',
      'Add a clear job title under your name (e.g. "Senior Accountant") so parsers classify you correctly.');
  add(summaryWords >= 25 && summaryWords <= 80, 10, 'Summary is 25–80 words',
      summaryWords === 0 ? 'Add a professional summary — it’s the first thing recruiters read.' :
      summaryWords < 25 ? 'Your summary is too short — aim for 25–80 words with title, experience, and top skills.' :
      'Your summary is long — trim it to 25–80 punchy words.');
  add((data.experience || []).length >= 1 && allBullets.length >= 3, 15, 'Work experience with 3+ bullet points',
      'Add at least one job with 3–5 bullet points describing what you achieved (not just duties).');
  const strongSet = ALL_VERBS.concat(EXTRA_VERBS, COMMON_STRONG, cat.verbs || []);
  const verbStarts = allBullets.filter(b => {
    const w = (b.split(/\s+/)[0] || '').replace(/[^a-zA-Z]/g, '').toLowerCase();
    return strongSet.some(v => w === v.toLowerCase() || w === v.toLowerCase() + 'd' || w === v.toLowerCase() + 'ed');
  }).length;
  add(allBullets.length > 0 && verbStarts / allBullets.length >= 0.6, 15, 'Bullets start with action verbs',
      'Start each bullet with a strong action verb (Led, Built, Increased…). Use the ✨ Enhance button.');
  const quantified = allBullets.filter(b => /\d/.test(b)).length;
  add(allBullets.length > 0 && quantified / allBullets.length >= 0.4, 15, 'Achievements are quantified',
      'Add numbers to at least 40% of bullets — %, ₹/$, counts, time saved. Numbers are what recruiters scan for.');
  add((data.skills || []).length >= 6, 10, 'At least 6 skills listed',
      'List 6–12 concrete skills. Match the wording used in job descriptions.');
  add((data.education || []).length >= 1, 5, 'Education section present',
      'Add your highest qualification — many ATS filters require it.');
  const kwHits = cat.keywords.filter(k => fullText.includes(k.toLowerCase())).length;
  add(kwHits >= 5, 10, 'Industry keywords (' + kwHits + '/' + cat.keywords.length + ' matched)',
      'Weave more ' + cat.label + ' keywords into your bullets and skills: ' + cat.keywords.filter(k => !fullText.includes(k.toLowerCase())).slice(0,5).join(', ') + '.');
  add(totalWords >= 150 && totalWords <= 900, 5, 'Resume length is healthy',
      totalWords < 150 ? 'Your resume is thin — expand bullets with specifics and results.' :
      'Your resume is long — cut it to the strongest, most recent material.');

  return { score: Math.min(100, score), checks,
    grade: score >= 85 ? 'Excellent' : score >= 70 ? 'Strong' : score >= 50 ? 'Getting there' : 'Needs work' };
}

/* ─────────────────────────────────────────────
   PUBLIC API
───────────────────────────────────────────── */
const ResumeAI = {
  version: '1.0.0',
  brand: '7By Resume AI',
  categories: CAT,
  verbs: VERBS,
  generateSummary,
  enhanceBullet,
  enhanceBullets,
  atsScore,
  suggestSkills(category){ return (CAT[category] || CAT.software).skills.slice(); },
  sample(category){ return JSON.parse(JSON.stringify((CAT[category] || CAT.software).sample)); }
};

if (typeof module !== 'undefined' && module.exports) module.exports = { ResumeAI };
else global.ResumeAI = ResumeAI;

})(typeof window !== 'undefined' ? window : this);
