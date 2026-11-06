/*
 * AMC new style: clickable prototype (phase 0).
 *
 * Static mock-up for reviewing layout, flow and look. Nothing here talks to
 * AMC; all data is made up. Open prototype.html in a browser. URL options:
 *   ?state=draft|tocheck|ready|printed|scanned  &linux=0  &theme=light|dark
 *   &marked=1  &brand=%23aa3355
 */
'use strict';

/* ---------- Helpers ---------- */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ic = (name, extra = '') => `<i class="iconoir-${name}${extra ? ' ' + extra : ''}" aria-hidden="true"></i>`;
const store = {
  get(k, d) {
    try { const v = localStorage.getItem('amc-proto:' + k); return v === null ? d : JSON.parse(v); }
    catch { return d; }
  },
  set(k, v) { try { localStorage.setItem('amc-proto:' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const $ = (sel, el = document) => el.querySelector(sel);

/* ---------- Mock data ---------- */

const EXAM = { name: 'Physics mid-term', cls: '10B', subject: 'Physics', date: '12 Nov 2026' };

const STEPS = [
  { id: 'questions', n: 1, label: 'Questions', group: 'before' },
  { id: 'marking-scheme', n: 2, label: 'Marking scheme', group: 'before' },
  { id: 'papers', n: 3, label: 'Papers', group: 'before' },
  { id: 'print', n: 4, label: 'Print', group: 'before' },
  { id: 'upload-scans', n: 5, label: 'Upload scans', group: 'after' },
  { id: 'check-scans', n: 6, label: 'Check scans', group: 'after' },
  { id: 'mark', n: 7, label: 'Mark', group: 'after' },
  { id: 'match-students', n: 8, label: 'Match students', group: 'after' },
  { id: 'export-marks', n: 9, label: 'Export marks', group: 'after' },
  { id: 'annotate', n: 10, label: 'Annotate', group: 'after' },
];

const freshQuestions = () => [
  { id: 'Q1', title: "Newton's second law", type: 'single', text: 'A net force of 10 N acts on a 2 kg mass. What is its acceleration?', answers: ['2 m/s²', '5 m/s²', '10 m/s²', '20 m/s²'], correct: [1], points: 1, rule: 'default' },
  { id: 'Q2', title: 'Units of force', type: 'multiple', text: 'Which of these are units of force?', answers: ['newton', 'kg·m/s²', 'joule', 'dyne'], correct: [0, 1, 3], points: 2, rule: 'custom' },
  { id: 'Q3', title: 'Acceleration due to gravity', type: 'single', text: 'On Earth, g is about…', answers: ['9.8 m/s²', '10 m/s²', '9.81 m/s²', '98 m/s²'], correct: [0], points: 1, rule: 'neutral' },
  { id: 'Q4', title: 'Momentum', type: 'single', text: 'Momentum is the product of…', answers: ['force and time', 'mass and velocity', 'mass and acceleration', 'force and distance'], correct: [1], points: 1, rule: 'default' },
  { id: 'Q5', title: 'Work done', type: 'single', text: 'A 5 N force moves a box 3 m. The work done is…', answers: ['8 J', '15 J', '1.7 J', '2 J'], correct: [1], points: 1, rule: 'default' },
  { id: 'Q6', title: 'Vectors', type: 'multiple', text: 'Which of these quantities are vectors?', answers: ['speed', 'velocity', 'displacement', 'mass'], correct: [1, 2], points: 2, rule: 'default' },
];

const NAMES = ['Aarav Sharma', 'Ananya Iyer', 'Arjun Mehta', 'Diya Patel', 'Ishaan Gupta', 'Kabir Singh',
  'Meera Nair', 'Rohan Das', 'Saanvi Reddy', 'Vihaan Joshi', 'Zara Khan', 'Aditi Rao', 'Dev Malhotra',
  'Fatima Sheikh', 'Harsh Verma', 'Ira Banerjee', 'Kiran Pillai', 'Laila Ahmed', 'Manav Kapoor',
  'Nisha Kulkarni', 'Om Prakash', 'Pooja Menon', 'Rahul Bose', 'Riya Chatterjee', 'Sahil Arora',
  'Tanvi Desai', 'Uday Kumar', 'Varun Saxena', 'Yash Thakur', 'Neha Mishra', 'Aman Jain', 'Sneha Ghosh'];
const STUDENTS = (() => {
  let seed = 7;
  const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  return NAMES.map((name, i) => {
    const points = Math.round((2.5 + rnd() * 5.5) * 2) / 2;
    return { roll: 1001 + i, name, points, mark: Math.round(points / 8 * 20 * 2) / 2 };
  });
})();

const freshUnreadable = () => [
  { id: 'u1', file: 'scan-0412.pdf', page: 31, reason: 'Corner marks not found. The page may be rotated, cropped or scanned too light.', resolved: false },
  { id: 'u2', file: 'scan-0412.pdf', page: 32, reason: 'Not a page of this exam: blank, or from another exam.', resolved: false },
];
const freshBoxes = () => [
  ['17', 1, 'Q4', 1, 'faint', 'Faint mark', false, 41],
  ['17', 1, 'Q2', 2, 'x', 'Crossed out', true, 63],
  ['21', 1, 'Q1', 0, 'half', 'Partly filled', false, 38],
  ['21', 2, 'Q6', 3, 'faint', 'Faint mark', false, 29],
  ['05', 1, 'Q3', 2, 'x', 'Crossed out', true, 58],
  ['09', 1, 'Q2', 0, 'half', 'Partly filled', false, 44],
  ['12', 2, 'Q5', 1, 'faint', 'Faint mark', false, 35],
  ['14', 1, 'Q1', 3, 'x', 'Crossed out', true, 61],
  ['26', 2, 'Q6', 0, 'half', 'Partly filled', true, 52],
  ['28', 1, 'Q4', 2, 'faint', 'Faint mark', false, 31],
  ['31', 1, 'Q3', 1, 'half', 'Partly filled', false, 40],
  ['33', 2, 'Q5', 3, 'faint', 'Faint mark', false, 27],
].map(([copy, page, q, ans, look, why, detected, dark], i) => ({ id: 'b' + i, copy, page, q, ans, look, why, detected, dark, resolved: false }));
const freshUnmatched = () => [
  { sheet: 'Copy 4', hand: 'Ananya I.' },
  { sheet: 'Copy 12', hand: 'R. Das' },
  { sheet: 'Copy 19', hand: 'Kabir S' },
  { sheet: 'Copy 30', hand: '' },
];

const TEMPLATES = {
  en: [
    { id: 'simple', title: 'Simple example', text: 'One simple question and one multiple question.', tags: ['LaTeX'] },
    { id: 'separate', title: 'Separate answers', text: 'All check-boxes put together on a separate sheet for each student.', tags: ['Separate sheet'], variant: 'separate' },
    { id: 'nominative', title: 'Nominative sheets', text: 'A sheet with the name already printed for each student.', tags: ['Names printed'], variant: 'nominative' },
    { id: 'nominative-sep', title: 'Nominative sheets and separate answers', text: 'Check-boxes on a separate nominative sheet for each student.', tags: ['Names printed', 'Separate sheet'], variant: 'separate' },
    { id: 'groups', title: 'Groups', text: 'Questions shuffled inside two distinct groups.', tags: ['LaTeX'] },
    { id: 'scoring', title: 'Scoring strategy', text: 'Examples of different scoring strategies.', tags: ['LaTeX'] },
    { id: 'txt', title: 'AMC-TXT format simple example', text: 'A very simple plain text format to write questions, no LaTeX needed.', tags: ['Plain text'] },
    { id: 'txt-nominative', title: 'AMC-TXT with nominative sheets', text: 'The plain text format with a named sheet per student.', tags: ['Plain text', 'Names printed'], variant: 'nominative' },
    { id: 'topics', title: 'Topics and LaTeX', text: 'Questions organised by topics, with a score per topic.', tags: ['LaTeX', 'Topics'] },
  ],
  fr: [
    { id: 'fr-simple', title: 'Exemple simple', text: 'Une question simple et une question à réponses multiples.', tags: ['LaTeX'] },
    { id: 'fr-sep', title: 'Réponses séparées', text: 'Toutes les cases sur une feuille séparée.', tags: ['Separate sheet'], variant: 'separate' },
    { id: 'fr-nom', title: 'Copies pré-remplies', text: 'Le nom de chaque élève imprimé sur sa copie.', tags: ['Names printed'], variant: 'nominative' },
    { id: 'fr-txt', title: 'Format AMC-TXT', text: 'Format texte simple, sans LaTeX.', tags: ['Plain text'] },
  ],
  school: [
    { id: 'school-test', title: 'Class test with school header', text: 'Your school name and logo on top; one page of questions.', tags: ['School'] },
    { id: 'school-term', title: 'Term exam, separate answer sheet', text: 'A question booklet plus one answer sheet per student.', tags: ['School', 'Separate sheet'], variant: 'separate' },
  ],
};

const allTemplates = () => [...TEMPLATES.en, ...TEMPLATES.fr, ...TEMPLATES.school];

const OTHER_EXAMS = [
  { name: 'Computer science quiz', cls: '11', subject: 'Computer science', date: '20 Nov 2026', chip: ['chip-warning', 'page-search', 'Layout to check'], done: 2, attention: 3, next: 'Check the layout' },
  { name: 'Chemistry unit test 3', cls: '9A', subject: 'Chemistry', date: '18 Nov 2026', chip: ['', 'edit-pencil', 'Draft'], done: 1, attention: 2, next: 'Finish the marking scheme' },
  { name: 'Maths weekly quiz', cls: '8C', subject: 'Mathematics', date: '8 Nov 2026', chip: ['chip-brand', 'printer', 'Ready to print'], done: 3, attention: 4, next: 'Print' },
  { name: 'Biology term exam', cls: '10A', subject: 'Biology', date: '30 Oct 2026', chip: ['chip-warning', 'lock', 'Marked'], done: 8, attention: 9, next: 'Export marks' },
  { name: 'English grammar test', cls: '7B', subject: 'English', date: '24 Oct 2026', chip: ['chip-success', 'check-circle', 'Done'], done: 10, attention: 0, next: null },
];

const GUIDES = {
  questions: ['Write each question with its answers, and mark which answers are correct.', 'Save to update the preview of the question paper on the right.', 'Problems are explained under the editor, with a link to the line.'],
  'marking-scheme': ['Choose how single- and multiple-answer questions are scored.', 'Set what the final mark is out of, and how it is rounded.', 'Click answers in the list to correct the answer key. This stays possible after printing.'],
  papers: ['Choose how many copies to print. Add a few spares.', 'Build the papers. The layout is detected automatically.', 'Check the layout in the preview, then confirm it looks correct.'],
  print: ['Save the PDFs and print them anywhere, or print on the shared machine.', 'Print on A4 at 100% (actual size), never "fit to page".', 'The exam locks after printing: questions and layout can no longer change.'],
  'upload-scans': ['Scan the answer sheets at 300 dpi, in black and white or greyscale.', 'Upload the PDF or image files. Each page is detected automatically.', 'Problems appear in the next step, Check scans.'],
  'check-scans': ['Fix pages the app couldn\'t read: process them again or delete them.', 'Look at each box it wasn\'t sure about and say whether it is ticked.', 'Marks come next, once all three lists are clear.'],
  mark: ['Compute the marks once Check scans is clear.', 'Marking always uses the latest marking scheme and answer key.', 'Answers that break the rules, such as two ticks on a single-answer question, are listed afterwards.'],
  'match-students': ['Load the class list (a CSV file) if you haven\'t already.', 'Choose which column matches the student code on the sheets.', 'Match the remaining sheets by hand, using the name written on each.'],
  'export-marks': ['Check the marks table and the distribution.', 'Export to CSV or ODS for your records or the school system.', 'Optionally share a private link where students see their own marks.'],
  annotate: ['Choose where the marks appear on each sheet and the header text.', 'Choose how the files are saved: one per student or one for the class.', 'Preview one student first, then annotate all sheets.'],
};

const GUIDE_FULL = {
  'check-scans': {
    why: 'Automatic detection reads almost every box correctly, but a few need a person: faint marks, crossed-out answers, bubbles filled badly. Fixing them before marking means marks are right the first time.',
    how: ['Unreadable pages: open each one. If it is from this exam, process it again (for example after rotating the scan). If it is blank or from another exam, delete it.', 'Missing pages: a copy is missing a page. Find and upload the page, or accept that it is missing.', 'Boxes to check: press T if the box is ticked, N if not. The scanned page on the right shows where the box is.'],
    problems: ['Many unreadable pages: the papers were probably printed with "fit to page". Reprinting is the only fix, so check the print settings before the next exam.', 'Lots of faint marks: students used a pencil that is too light. Lower the detection sensitivity under Advanced, then check again.', 'A whole scan is unreadable: check it is the right exam and that the scanner wasn\'t set to very low resolution.'],
  },
};

/* ---------- State ---------- */

const qs = new URLSearchParams(location.search);
const S = {
  state: qs.get('state') || 'scanned',
  linux: qs.get('linux') !== '0',
  theme: qs.get('theme') || store.get('theme', 'auto'),
  brand: qs.get('brand') || store.get('brand', '#3b5bdb'),
  brandContrast: 0,
  school: store.get('school', 'Demo Public School'),
  logo: store.get('logo', null),
  logoColors: [],
  previewOpen: qs.get('preview') ? qs.get('preview') !== '0' : window.innerWidth >= 1280,
  previewMax: false,
  previewDoc: null,
  previewW: store.get('previewW', 460),
  guide: store.get('guide', {}),
  questions: freshQuestions(),
  schemeDirty: false,
  marked: qs.get('marked') === '1',
  outOfDate: false,
  exported: false,
  annotated: false,
  unreadable: freshUnreadable(),
  boxes: freshBoxes(),
  unmatched: freshUnmatched(),
  reviewAt: 0,
  printRoute: 'save',
  exportFormat: 'csv',
  annotSave: 'student',
  menu: false,
  dialog: qs.get('dialog') ? { type: qs.get('dialog') } : null,
  copies: 36,
  wizard: 2,
  tplLang: 'en',
  tpl: 'separate',
  dashFilter: 'all',
  laidOutAt: '10:42',
};
const locked = () => S.state === 'printed' || S.state === 'scanned';
const scanned = () => S.state === 'scanned';
const issuesLeft = () => S.unreadable.filter((u) => !u.resolved).length + S.boxes.filter((b) => !b.resolved).length;
const boxesLeft = () => S.boxes.filter((b) => !b.resolved).length;
const currentBox = () => S.boxes[S.reviewAt] || S.boxes[0];

/* ---------- Routing ---------- */

let route = parseRoute();
function parseRoute() {
  const [a, b] = location.hash.replace(/^#\/?/, '').split('/');
  if (a === 'exam' && (STEPS.some((s) => s.id === b) || b === 'settings')) return { kind: 'exam', step: b };
  if (a === 'new') return { kind: 'new' };
  if (a === 'admin') return { kind: 'admin' };
  return { kind: 'exams' };
}
const routeKey = () => route.kind + ':' + (route.step || '');

/* ---------- Step status ---------- */

function stepStatus(id) {
  const st = S.state;
  const r = (cls, count = null) => ({ cls, count });
  switch (id) {
    case 'questions': return locked() ? r('is-locked') : r('is-done');
    case 'marking-scheme': return S.schemeDirty ? r('is-attention') : r('is-done');
    case 'papers': return locked() ? r('is-locked') : st === 'ready' ? r('is-done') : r('is-attention');
    case 'print': return locked() ? r('is-done') : st === 'ready' ? r('is-attention') : r('is-blocked');
    case 'upload-scans': return scanned() ? r('is-done') : st === 'printed' ? r('is-attention') : r('');
    case 'check-scans':
      if (!scanned()) return r('');
      return issuesLeft() ? r('is-attention', issuesLeft()) : r('is-done');
    case 'mark':
      if (!scanned()) return r('');
      if (S.marked && S.outOfDate) return r('is-attention', '!');
      if (S.marked) return r('is-done');
      return issuesLeft() ? r('') : r('is-attention');
    case 'match-students':
      if (!S.marked) return r('');
      return S.unmatched.length ? r('is-attention', S.unmatched.length) : r('is-done');
    case 'export-marks':
      if (!S.marked) return r('');
      if (S.outOfDate && S.exported) return r('is-attention', '!');
      return S.exported ? r('is-done') : r('');
    case 'annotate':
      if (!S.marked) return r('');
      if (S.outOfDate && S.annotated) return r('is-attention', '!');
      return S.annotated ? r('is-done') : r('');
    default: return r('');
  }
}

function examChip() {
  switch (S.state) {
    case 'draft': return `<span class="chip">${ic('edit-pencil')} Draft</span>`;
    case 'tocheck': return `<span class="chip chip-warning">${ic('page-search')} Layout to check</span>`;
    case 'ready': return `<span class="chip chip-brand">${ic('printer')} Ready to print</span>`;
    default: return `<span class="chip chip-warning">${ic('lock')} Printed 5 Nov · locked</span>`;
  }
}

/* ---------- Paper drawings ---------- */

const SCAN_TICKS = { Q1: [1], Q2: [0, 1], Q3: [0], Q4: [], Q5: [1], Q6: [1, 3] };

function paper({ mode = 'subject', page = 1, variant = '', copy = 17, flagBox = null, school = true } = {}) {
  const cls = { key: 'key', layout: 'layout', scan: 'scan', annot: 'scan annot' }[mode] || '';
  const bits = [1, 0, 1, 1, 0, 0, 1, 0, 1, 1].map((b, i) => (b ^ (copy >> (i % 5)) & 1) ? 'f' : '');
  const showSchool = school && variant !== 'txt';
  const logo = S.logo ? `<img src="${S.logo}" alt="">` : '';
  let body = '';
  if (variant === 'separate') {
    body = `<div class="namefield">Name and class:</div>
      <div class="studentcode">Roll no. <span class="digits">${'<span></span>'.repeat(4)}</span></div>
      <div style="font-weight:700;margin-bottom:2cqw">Answer sheet</div>
      ${QUESTIONS_FOR_PAPER().map((q, i) => `<div class="a" style="margin-bottom:1.6cqw"><b style="width:4cqw">${i + 1}</b>
        ${q.answers.map((_, j) => `<span class="bx">${'ABCD'[j]}</span>`).join('<span style="width:1.4cqw"></span>')}</div>`).join('')}`;
  } else {
    const list = page === 1 ? S.questions.slice(0, 4) : S.questions.slice(4);
    const name = mode === 'scan' || mode === 'annot'
      ? '<span class="hand">Ananya Iyer &nbsp; 10B</span>'
      : variant === 'nominative' ? '<b>Aarav Sharma</b> · 10B · roll no. 1001' : 'Name and class:';
    body = (page === 1 ? `<div class="namefield">${name}</div>
      <div class="studentcode">Roll no. <span class="digits">${'<span></span>'.repeat(4)}</span></div>` : '')
      + list.map((q) => {
        const n = S.questions.indexOf(q) + 1;
        const ticks = SCAN_TICKS[q.id] || [];
        const right = q.rule === 'neutral' || (ticks.length === q.correct.length && ticks.every((t) => q.correct.includes(t)));
        return `<div class="q" style="position:relative">
          ${mode === 'annot' ? `<span class="score">${right ? q.points : 0}/${q.points}</span>` : ''}
          <div class="q-text"><b>${n}.</b>${esc(q.text)}${q.type === 'multiple' ? '<span class="q-mult">(several answers possible)</span>' : ''}</div>
          <div class="ans">${q.answers.map((a, j) => {
            let b = '';
            if (mode === 'key' && q.correct.includes(j)) b = 'c';
            if (mode === 'scan' || mode === 'annot') {
              if (ticks.includes(j)) b = 't';
              if (flagBox && flagBox.q === q.id && flagBox.ans === j) b = flagBox.look + (mode === 'scan' ? ' flag' : '');
              if (mode === 'annot') {
                if (ticks.includes(j) && q.correct.includes(j)) b += ' ok';
                else if (ticks.includes(j)) b += ' wrong';
                else if (q.correct.includes(j)) b += ' miss';
              }
            }
            return `<div class="a"><span class="bx ${b}"></span>${esc(a)}</div>`;
          }).join('')}</div></div>`;
      }).join('');
  }
  return `<div class="paper ${cls}">
    <span class="mark tl"></span><span class="mark tr"></span><span class="mark bl"></span><span class="mark br"></span>
    <div class="idcode">${bits.map((b) => `<span class="${b}"></span>`).join('')}</div>
    ${mode === 'annot' ? '<div class="stamp">17.5 / 20</div>' : ''}
    ${showSchool ? `<div class="p-school">${logo}${esc(S.school)}</div>` : ''}
    <div class="p-head"><div class="p-title">${esc(EXAM.name)}</div><div class="p-meta">Class ${EXAM.cls} · ${EXAM.date}<br>Duration: 40 minutes</div></div>
    ${body}
    <div class="p-foot">${esc(EXAM.name)} · copy ${copy} · page ${page}/2</div>
  </div>`;
}
const QUESTIONS_FOR_PAPER = () => S.questions;

/* ---------- Preview documents ---------- */

const LEGEND = `<div class="layout-legend">
  <span><i class="sw" style="border-color:#e8590c"></i>Corner marks and page code</span>
  <span><i class="sw" style="border-color:#2f9e44"></i>Answer boxes</span>
  <span><i class="sw" style="border-color:#1c7ed6;border-style:dashed"></i>Name field</span>
  <span><i class="sw" style="border-color:#ae3ec9"></i>Student code</span></div>`;

const DOCS = {
  subject: { title: 'Question paper', tab: 'Question paper', foot: 'Copy 1 of 36 · 2 pages', render: () => paper() + paper({ page: 2 }) },
  key: { title: 'Answer key', tab: 'Answer key', foot: 'Correct answers filled in', render: () => paper({ mode: 'key' }) + paper({ mode: 'key', page: 2 }) },
  catalog: {
    title: 'Catalogue', tab: 'Catalogue', foot: 'All questions, unshuffled',
    render: () => `<div class="doc-text"><h2>Catalogue</h2><p>Every question with its identifier, for reference.</p>
      ${S.questions.map((q) => `<h3>${q.id} · ${esc(q.title)}</h3><p>${esc(q.text)}</p>`).join('')}</div>`,
  },
  layout: { title: 'Layout check', tab: 'Layout', foot: '72 pages · detection found every item', render: () => LEGEND + paper({ mode: 'layout' }) + paper({ mode: 'layout', page: 2 }) },
  scan: {
    title: 'Scanned page', tab: 'Scanned page',
    foot: () => { const b = currentBox(); return `Copy ${b.copy} · page ${b.page} · from scan-0411.pdf`; },
    render: () => paper({ mode: 'scan', flagBox: currentBox(), copy: +currentBox().copy, page: currentBox().page }),
  },
  annotated: { title: 'Annotated sheet · Ananya Iyer', tab: 'Annotated sheet', foot: 'Student 2 of 32 · ◀ ▶', render: () => paper({ mode: 'annot' }) + paper({ mode: 'annot', page: 2 }) },
  csv: {
    title: 'marks-10B.csv', tab: 'Exported marks', plain: true, foot: '32 rows · 10 columns',
    render: () => `<table class="table csv-table"><thead><tr><th>Roll</th><th>Name</th><th class="num">Points</th><th class="num">Mark</th>${S.questions.map((q) => `<th class="num">${q.id}</th>`).join('')}</tr></thead>
      <tbody>${STUDENTS.map((s, i) => `<tr><td class="num">${s.roll}</td><td>${esc(s.name)}</td><td class="num">${s.points}</td><td class="num">${s.mark}</td>${S.questions.map((q, j) => `<td class="num">${(i + j) % 3 ? q.points : 0}</td>`).join('')}</tr>`).join('')}</tbody></table>`,
  },
  classlist: {
    title: '10B.csv · class list', tab: 'Class list', plain: true, foot: '32 students · 3 columns',
    render: () => `<table class="table"><thead><tr><th>Roll no.</th><th>Name</th><th>Email</th></tr></thead>
      <tbody>${STUDENTS.map((s) => `<tr><td class="num">${s.roll}</td><td>${esc(s.name)}</td><td class="muted">${s.name.split(' ')[0].toLowerCase()}@school.example</td></tr>`).join('')}</tbody></table>`,
  },
  template: {
    title: () => allTemplates().find((t) => t.id === S.tpl)?.title || 'Template', tab: 'Template', foot: 'Compiled preview · 2 pages',
    render: () => { const t = allTemplates().find((x) => x.id === S.tpl) || {}; const school = (t.tags || []).includes('School'); return paper({ variant: t.variant, school }) + paper({ page: 2, variant: t.variant === 'separate' ? '' : t.variant, school }); },
  },
  guide: { title: 'Guide', tab: 'Guide', plain: false, foot: 'Written by your team · editable in the repository', render: () => guideDoc() },
};

const STEP_DOCS = {
  questions: ['subject'], 'marking-scheme': ['key', 'subject'], papers: ['layout', 'subject', 'key', 'catalog'],
  print: ['subject'], 'upload-scans': ['scan'], 'check-scans': ['scan'], mark: ['key'],
  'match-students': ['classlist', 'scan'], 'export-marks': ['csv'], annotate: ['annotated'], settings: [],
};
function docsFor() {
  if (route.kind === 'new') return S.wizard === 2 ? ['template'] : [];
  if (route.kind !== 'exam') return [];
  let docs = STEP_DOCS[route.step] || [];
  if (route.step === 'papers' && S.state === 'draft') docs = ['subject', 'key', 'catalog'];
  return docs.length ? [...docs, 'guide'] : docs;
}
const val = (v) => (typeof v === 'function' ? v() : v);

function guideDoc() {
  const step = route.step || 'check-scans';
  const s = STEPS.find((x) => x.id === step);
  const full = GUIDE_FULL[step];
  const bullets = GUIDES[step] || [];
  return `<div class="doc-text">
    <div class="eyebrow">Guide · step ${s ? s.n : ''}</div><h2>${esc(s ? s.label : 'Guide')}</h2>
    ${full ? `<p>${esc(full.why)}</p><h3>How to do it</h3><ul>${full.how.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <h3>Common problems</h3><ul>${full.problems.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
    : `<ul>${bullets.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><p class="subtle" style="margin-top:12px">The full guide for this step is written in phase 3.</p>`}
  </div>`;
}

/* ---------- Shared pieces ---------- */

function header(step, title, sub, actions = '') {
  const s = STEPS.find((x) => x.id === step);
  const eyebrow = s ? `Step ${s.n} of 10 · ${s.group === 'before' ? 'Before the exam' : 'After the exam'}` : '';
  return `<div class="page-header"><div>${eyebrow ? `<div class="eyebrow">${eyebrow}</div>` : ''}<h1>${title}</h1>
    ${sub ? `<p class="page-sub">${sub}</p>` : ''}</div><div class="page-actions">${actions}</div></div>`;
}
function guideBox(step) {
  const collapsed = !!S.guide[step];
  return `<section class="guide ${collapsed ? 'is-collapsed' : ''}">
    <button class="guide-head" data-act="guide-toggle" data-step="${step}" aria-expanded="${!collapsed}">${ic('light-bulb')} What to do here ${ic('nav-arrow-down', 'chev')}</button>
    <div class="guide-body"><ul>${(GUIDES[step] || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <div class="guide-more"><button class="link-btn" data-act="open-guide">Open the full guide ${ic('arrow-right')}</button></div></div></section>`;
}
function banner(kind, iconName, title, text, buttons = '') {
  return `<div class="banner banner-${kind}" role="${kind === 'danger' ? 'alert' : 'note'}">${ic(iconName)}<div class="banner-body">
    <div class="banner-title">${title}</div>${text ? `<div class="muted">${text}</div>` : ''}${buttons ? `<div class="btn-row">${buttons}</div>` : ''}</div></div>`;
}
const lockedBanner = (text, buttons = '') => banner('lock', 'lock', 'Printed on 5 Nov by Priya. Questions and layout are locked.', text, buttons);
function empty(iconName, title, text, buttons = '') {
  return `<div class="card"><div class="empty"><div class="empty-icon">${ic(iconName)}</div><h2>${title}</h2><p>${text}</p>
    ${buttons ? `<div class="btn-row">${buttons}</div>` : ''}</div></div>`;
}
const stat = (value, label, kind = '') => `<div class="stat ${kind}"><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>`;
const checkItem = (kind, iconName, text, right = '') => `<div class="checklist-item ${kind}">${ic(iconName)}<span>${text}</span><span class="spacer"></span>${right}</div>`;

/* ---------- Views ---------- */

const VIEWS = {};

VIEWS.exams = () => {
  const live = STEPS.map((s) => stepStatus(s.id));
  const liveDone = live.filter((x) => x.cls === 'is-done' || x.cls === 'is-locked').length;
  const nextIdx = live.findIndex((x) => x.cls === 'is-attention');
  const next = nextIdx >= 0 ? STEPS[nextIdx] : null;
  const card = (e) => `<article class="card exam-card">
    <div class="row-between"><h3>${esc(e.name)}</h3>${e.chipHtml || `<span class="chip ${e.chip[0]}">${ic(e.chip[1])} ${e.chip[2]}</span>`}</div>
    <div class="subtle">Class ${esc(e.cls)} · ${esc(e.subject)} · ${esc(e.date)}</div>
    <div class="mini-steps" aria-label="${e.done} of 10 steps done">${STEPS.map((_, i) => `<span class="${e.marks ? e.marks[i] : i < e.done ? 'd' : i === e.attention ? 'a' : ''}"></span>`).join('')}</div>
    <div class="row-between"><span class="subtle">${e.next ? 'Next: ' + esc(e.next) : 'All steps done'}</span>
      ${e.href ? `<a class="btn btn-sm" href="${e.href}">Open ${ic('arrow-right')}</a>` : `<button class="btn btn-sm" data-act="toast" data-msg="The other exams are static in this prototype.">Open ${ic('arrow-right')}</button>`}</div>
  </article>`;
  const mine = {
    ...EXAM, chipHtml: examChip(), done: liveDone, href: next ? `#/exam/${next.id}` : '#/exam/questions',
    marks: live.map((x) => (x.cls === 'is-done' || x.cls === 'is-locked' ? 'd' : x.cls === 'is-attention' ? 'a' : '')),
    next: next ? (next.id === 'check-scans' ? `check ${issuesLeft()} scan problems` : next.label.toLowerCase()) : null,
  };
  const filters = [['all', 'All'], ['prep', 'Preparing'], ['printed', 'Printed'], ['done', 'Done']];
  return `<div class="page">
    ${header('', 'Exams', 'Your exams and where each one stands.', `<button class="btn" data-act="toast" data-msg="Archive: phase 2.">${ic('archive')} Archived</button><a class="btn btn-primary" href="#/new">${ic('plus')} New exam</a>`)}
    <div class="row" style="margin-bottom:16px">
      <div style="position:relative;flex:1;max-width:340px"><input class="input" placeholder="Search exams, classes, subjects" aria-label="Search exams"></div>
      <div class="segmented" role="group" aria-label="Filter">${filters.map(([k, l]) => `<button aria-pressed="${S.dashFilter === k}" data-act="dash-filter" data-k="${k}">${l}</button>`).join('')}</div>
    </div>
    <div class="grid grid-3">${card(mine)}${OTHER_EXAMS.map(card).join('')}</div>
  </div>`;
};

VIEWS.new = () => {
  const steps = ['Details', 'Template', 'Answer sheet'];
  const wiz = `<div class="wizard">${steps.map((l, i) => `${i ? '<span class="wizard-sep"></span>' : ''}<span class="wizard-step ${i + 1 === S.wizard ? 'on' : i + 1 < S.wizard ? 'done' : ''}"><span class="step-dot">${i + 1 < S.wizard ? ic('check') : i + 1}</span>${l}</span>`).join('')}</div>`;
  let body = '';
  if (S.wizard === 1) {
    body = `<div class="card"><div class="card-body"><div class="form-grid">
      <label class="field"><span class="field-label">Exam name</span><input class="input" value="Physics mid-term"></label>
      <label class="field"><span class="field-label">Class</span><input class="input" value="10B"></label>
      <label class="field"><span class="field-label">Subject</span><input class="input" value="Physics"></label>
      <label class="field"><span class="field-label">Date</span><input class="input" type="date" value="2026-11-12"></label>
    </div></div></div>`;
  } else if (S.wizard === 2) {
    const langs = [['en', 'English'], ['fr', 'French'], ['school', 'Our school']];
    body = `<div class="row-between" style="margin-bottom:14px">
        <div class="segmented" role="group" aria-label="Template group">${langs.map(([k, l]) => `<button aria-pressed="${S.tplLang === k}" data-act="tpl-lang" data-k="${k}">${l}</button>`).join('')}</div>
        <input class="input" style="max-width:260px" placeholder="Search templates" aria-label="Search templates"></div>
      <div class="grid grid-auto" role="radiogroup" aria-label="Templates">${TEMPLATES[S.tplLang].map((t) => `
        <button class="card tpl-card" role="radio" aria-checked="${S.tpl === t.id}" data-act="tpl" data-k="${t.id}">
          <div class="thumb">${paper({ variant: t.variant, school: t.tags.includes('School') })}</div>
          <div class="tpl-info"><div class="tpl-title">${esc(t.title)}</div><div class="subtle">${esc(t.text)}</div>
            <div class="row" style="margin-top:8px;flex-wrap:wrap;gap:6px">${t.tags.map((g) => `<span class="chip">${esc(g)}</span>`).join('')}</div></div>
        </button>`).join('')}</div>`;
  } else {
    body = `<div class="grid grid-2">
      <button class="choice" role="radio" aria-checked="false">${'<span class="choice-icon">' + ic('page') + '</span>'}<span><span class="choice-title">On the question paper</span><br><span class="subtle">Boxes next to each question. Simplest for short tests.</span></span></button>
      <button class="choice" role="radio" aria-checked="true"><span class="choice-icon">${ic('multiple-pages')}</span><span><span class="choice-title">Separate answer sheet</span><br><span class="subtle">One sheet with all boxes. Fewer pages to scan.</span></span></button></div>
      <div class="card" style="margin-top:16px"><div class="card-body"><label class="field"><span class="field-label">Number of copies</span>
      <span class="input-group"><input class="input input-num" type="number" value="36"><span class="subtle">Class of 32, plus 4 spare copies</span></span></label></div></div>`;
  }
  return `<div class="page">
    ${header('', 'New exam', 'Three short steps. Everything can be changed later, until the exam is printed.')}
    ${wiz}${body}
    <div class="row" style="margin-top:20px"><a class="btn btn-ghost" href="#/exams">Cancel</a><span class="spacer"></span>
      ${S.wizard > 1 ? '<button class="btn" data-act="wiz-back">Back</button>' : ''}
      ${S.wizard < 3 ? `<button class="btn btn-primary" data-act="wiz-next">${S.wizard === 2 ? 'Use this template' : 'Next'} ${ic('arrow-right')}</button>`
    : `<button class="btn btn-primary" data-act="wiz-create">${ic('check')} Create exam</button>`}</div>
  </div>`;
};

const LATEX = [
  '\\documentclass[a4paper]{article}',
  '\\usepackage[box,completemulti]{automultiplechoice}',
  '\\begin{document}',
  '',
  '\\element{mechanics}{',
  '  \\begin{question}{newton2}',
  '    A net force of 10 N acts on a 2 kg mass.',
  '    What is its acceleration?',
  '    \\begin{choices}',
  '      \\wrongchoice{2 m/s$^2$}',
  '      \\correctchoice{5 m/s$^2$}',
  '      \\wrongchoice{10 m/s$^2$}',
  '      \\wrongchoice{20 m/s$^2$}',
  '    \\end{choices}',
  '  \\end{question}',
  '}',
  '',
  '\\element{mechanics}{',
  '  \\begin{questionmult}{units}',
  '    Which of these are units of force?',
  '    \\begin{choices}',
  '      \\correctchoice{newton}',
  '      \\correctchoice{kg$\\cdot$m/s$^2$}',
  '      \\wrongchoice{joule}',
  '      \\correctchoice{dyne}',
  '    \\end{choices}',
  '  \\end{questionmult}',
  '}',
  '% … four more questions',
];
function highlight(line) {
  const ci = line.indexOf('%');
  const code = ci >= 0 ? line.slice(0, ci) : line;
  const comment = ci >= 0 ? line.slice(ci) : '';
  const out = esc(code).replace(/\\(begin|end)\{(\w+)\}|\\[A-Za-z]+/g, (m, be, env) =>
    be ? `<span class="tk-c">\\${be}</span>{<span class="tk-e">${env}</span>}` : `<span class="tk-c">${m}</span>`);
  return out + (comment ? `<span class="tk-k">${esc(comment)}</span>` : '');
}

VIEWS.questions = () => {
  const L = locked();
  return `<div class="page">
    ${header('questions', 'Questions', 'Write the questions and answers. The preview on the right updates when you save.',
    L ? '' : `<span class="chip chip-success">${ic('check-circle')} Compiled · no errors</span><button class="btn btn-primary" data-act="toast" data-msg="Saved. Preview updated.">${ic('floppy-disk')} Save</button>`)}
    ${guideBox('questions')}
    ${L ? lockedBanner('To correct the answer key or change scoring, use Marking scheme. Those changes don\'t move anything on the paper.',
    `<a class="btn btn-primary btn-sm" href="#/exam/marking-scheme">Go to Marking scheme</a><button class="btn btn-sm" data-act="unlock">${ic('lock-slash')} Unlock to edit questions…</button>`) : ''}
    <div class="editor ${L ? 'readonly' : ''}">
      ${L ? `<span class="editor-lock chip chip-warning">${ic('lock')} Read-only</span>` : ''}
      <div class="editor-gutter">${LATEX.map((_, i) => i + 1).join('<br>')}</div>
      <div class="editor-code">${LATEX.map(highlight).join('\n')}</div>
    </div>
    <p class="subtle" style="margin-top:10px">${ic('info-circle')} A form editor for questions, without LaTeX, comes later (issue #4).</p>
  </div>`;
};

const PRESETS_S = ['1 point, no penalty', '1 point, −0.25 for a wrong answer', '1 point, −1 for a wrong answer'];
const PRESETS_M = ['Proportional, −0.5 per wrong tick', 'All or nothing', 'Proportional, no penalty'];
VIEWS['marking-scheme'] = () => {
  const total = S.questions.reduce((a, q) => a + (q.rule === 'neutral' ? q.points : q.points), 0);
  const rule = (q) => q.rule === 'neutral' ? `<span class="chip chip-warning">${ic('warning-triangle')} Neutralised</span>`
    : q.rule === 'custom' ? '<span class="chip chip-brand">Custom</span>' : '<span class="chip">Default</span>';
  return `<div class="page">
    ${header('marking-scheme', 'Marking scheme', 'How each question is scored, and how points become the final mark.',
    `<button class="btn btn-primary" data-act="save-scheme" ${S.schemeDirty ? '' : 'disabled'}>${ic('floppy-disk')} Save marking scheme</button>`)}
    ${guideBox('marking-scheme')}
    ${locked() ? banner('info', 'info-circle', 'You can still change everything on this page after printing.', 'Nothing here moves boxes on the printed paper. After saving, recompute the marks in step 7.') : ''}
    ${S.schemeDirty ? banner('lock', 'warning-triangle', 'Unsaved changes', 'Save to use them for marking.') : ''}
    <div class="grid grid-2">
      <section class="card"><div class="card-header"><h2>Default scoring</h2><button class="btn btn-ghost btn-sm" data-act="toast" data-msg="Advanced: type any AMC scoring strategy, e.g. b=1,m=-0.25">Advanced</button></div>
        <div class="card-body">
          <label class="field"><span class="field-label">Single-answer questions</span><select class="select" data-act="dirty">${PRESETS_S.map((p) => `<option>${p}</option>`).join('')}</select></label>
          <label class="field"><span class="field-label">Multiple-answer questions</span><select class="select" data-act="dirty">${PRESETS_M.map((p) => `<option>${p}</option>`).join('')}</select>
          <span class="field-hint">Written to the source as <code>\\scoringDefaultM{…}</code></span></label>
        </div></section>
      <section class="card"><div class="card-header"><h2>Final mark</h2></div>
        <div class="card-body"><div class="form-grid">
          <label class="field"><span class="field-label">Out of</span><input class="input" type="number" value="20" data-act="dirty"></label>
          <label class="field"><span class="field-label">Rounding</span><select class="select" data-act="dirty"><option>Nearest</option><option>Down</option><option>Up</option></select></label>
          <label class="field"><span class="field-label">In steps of</span><input class="input" type="number" value="0.5" step="0.5" data-act="dirty"></label>
          <label class="field"><span class="field-label">Mark for a blank sheet</span><input class="input" type="number" value="0" data-act="dirty"></label>
        </div></div></section>
    </div>
    <section class="card" style="margin-top:16px">
      <div class="card-header"><h2>Questions and answer key</h2><span class="subtle">Click an answer to mark it correct</span></div>
      <div class="table-wrap" style="border:0;border-radius:0"><table class="table"><thead><tr><th>#</th><th>Question</th><th>Type</th><th>Answer key</th><th class="num">Points</th><th>Scoring</th><th></th></tr></thead>
      <tbody>${S.questions.map((q, i) => `<tr>
        <td class="num">${q.id}</td><td>${esc(q.title)}</td><td class="muted">${q.type === 'single' ? 'Single' : 'Multiple'}</td>
        <td><span class="row" style="gap:5px">${q.answers.map((a, j) => `<button class="ansbtn ${q.correct.includes(j) ? 'c' : ''}" data-act="ans" data-q="${i}" data-a="${j}" title="${esc(a)}" aria-pressed="${q.correct.includes(j)}">${'ABCD'[j]}</button>`).join('')}</span></td>
        <td class="num">${q.points}</td><td>${rule(q)}</td>
        <td><button class="btn btn-ghost btn-sm" data-act="neutral" data-q="${i}">${q.rule === 'neutral' ? 'Count again' : 'Neutralise'}</button></td></tr>`).join('')}</tbody></table></div>
      <div class="card-foot" style="justify-content:space-between"><span class="subtle">${ic('info-circle')} Neutralised: everyone gets full marks for that question.</span><strong>Total ${total} points → mark out of 20</strong></div>
    </section>
  </div>`;
};

VIEWS.papers = () => {
  const st = S.state;
  const L = locked();
  const built = st !== 'draft';
  const docs = [['subject', 'Question paper', '2 pages per copy · 36 copies'], ['key', 'Answer key', '2 pages'], ['catalog', 'Catalogue', 'All questions'], ['layout', 'Layout', 'Detected positions on every page']];
  return `<div class="page">
    ${header('papers', 'Papers', 'Build the final papers, then check the layout before printing.',
    L ? '' : `<button class="btn ${st === 'draft' ? 'btn-primary' : ''}" data-act="build">${ic('refresh')} ${built ? 'Rebuild papers' : 'Build papers'}</button>`)}
    ${guideBox('papers')}
    ${L ? lockedBanner('The papers can\'t be rebuilt after printing. You can still open and download them.') : ''}
    ${st === 'tocheck' ? `<section class="card card-accent" style="margin-bottom:16px">
      <div class="card-header">${ic('page-search')}<h2>Check the layout</h2><span class="chip chip-warning">Needs your check</span></div>
      <div class="card-body"><p class="muted" style="margin-bottom:10px">Layout detection ran on all 72 pages. Look through the pages in the preview: every item below should be outlined in its colour.</p>
        <div class="checklist">
          ${checkItem('ok', 'check-circle', 'Corner marks and page code found on all 72 pages', '<span class="chip" style="border-color:#e8590c">orange</span>')}
          ${checkItem('ok', 'check-circle', '288 answer boxes outlined', '<span class="chip" style="border-color:#2f9e44">green</span>')}
          ${checkItem('ok', 'check-circle', 'Name field outlined on every first page', '<span class="chip" style="border-color:#1c7ed6">blue</span>')}
          ${checkItem('ok', 'check-circle', 'Student code boxes outlined', '<span class="chip" style="border-color:#ae3ec9">purple</span>')}
          ${checkItem('ok', 'check-circle', 'No layout warnings')}
        </div></div>
      <div class="card-foot"><button class="btn btn-ghost" data-act="open-guide">Something looks wrong</button><button class="btn btn-primary" data-act="layout-ok">${ic('check')} Looks correct</button></div>
    </section>` : ''}
    ${st === 'ready' ? banner('success', 'check-circle', `Layout confirmed by Priya at ${S.laidOutAt}. The papers are ready to print.`, 'Rebuilding the papers will ask you to check the layout again.', `<a class="btn btn-primary btn-sm" href="#/exam/print">${ic('printer')} Go to Print</a>`) : ''}
    <div class="grid grid-2">
      <section class="card"><div class="card-header"><h2>Number of copies</h2></div><div class="card-body">
        <label class="field"><span class="field-label">Copies</span><span class="input-group"><input class="input input-num" type="number" value="${S.copies}" ${L ? 'disabled' : ''}>
        <span class="subtle">Class of 32. Print a few spares: 36 is good.</span></span></label>
        ${L ? '<p class="subtle" style="margin-top:10px">Locked after printing.</p>' : ''}
      </div></section>
      <section class="card"><div class="card-header"><h2>Documents</h2></div><div class="list">
        ${docs.map(([k, t, d]) => `<div class="list-row"><span class="list-icon ${built ? 'brand' : ''}">${ic(k === 'layout' ? 'frame-select' : 'page')}</span>
          <div class="list-row-main"><div class="list-row-title">${t}</div><div class="subtle">${built ? d : 'Not built yet'}</div></div>
          <button class="btn btn-sm" data-act="show-doc" data-doc="${k}" ${built || k !== 'layout' ? '' : 'disabled'}>Preview</button></div>`).join('')}
      </div></section>
    </div>
  </div>`;
};

VIEWS.print = () => {
  const st = S.state;
  if (st === 'draft' || st === 'tocheck') {
    return `<div class="page">${header('print', 'Print')}${guideBox('print')}
      ${empty('page-search', 'Check the layout first', 'Printing opens once you\'ve confirmed the layout in Papers. It catches problems before 36 copies are printed.', '<a class="btn btn-primary" href="#/exam/papers">Go to Papers</a>')}</div>`;
  }
  const L = locked();
  const route2 = S.linux ? S.printRoute : 'save';
  return `<div class="page">
    ${header('print', 'Print', 'Save the papers as PDFs to print anywhere, or print on the shared machine.')}
    ${guideBox('print')}
    ${L ? lockedBanner('You can save or print the same papers again. They are identical to the ones already printed.') : ''}
    <div class="grid grid-2" role="radiogroup" aria-label="How to print">
      <button class="choice" role="radio" aria-checked="${route2 === 'save'}" data-act="print-route" data-k="save"><span class="choice-icon">${ic('download')}</span>
        <span><span class="choice-title">Save PDFs for printing</span><br><span class="subtle">Download the papers and print them anywhere, for example from a pendrive.</span></span></button>
      <button class="choice" role="radio" aria-checked="${route2 === 'printer'}" aria-disabled="${!S.linux}" data-act="print-route" data-k="printer"><span class="choice-icon">${ic('printer')}</span>
        <span><span class="choice-title">Print on this machine</span><br><span class="subtle">${S.linux ? 'Send the papers to a printer attached to the shared machine.' : 'Only available when the shared machine runs Linux.'}</span></span></button>
    </div>
    <div class="grid grid-2" style="margin-top:16px">
      <section class="card"><div class="card-header"><h2>What to print</h2></div><div class="card-body">
        <div class="form-grid"><label class="field"><span class="field-label">From copy</span><input class="input" type="number" value="1"></label>
        <label class="field"><span class="field-label">To copy</span><input class="input" type="number" value="36"></label></div>
        ${route2 === 'printer' ? '<label class="field" style="margin-top:14px"><span class="field-label">Printer</span><select class="select"><option>Staff room laser (HP LaserJet)</option><option>Library printer</option></select></label>' : ''}
      </div></section>
      <section class="card"><div class="card-header"><h2>Before you print</h2></div><div class="card-body"><div class="checklist">
        ${checkItem('ok', 'page', 'A4 paper')}
        ${checkItem('warn', 'warning-triangle', '<b>100% scale</b> ("Actual size"), never "Fit to page"')}
        ${checkItem('ok', 'multiple-pages', 'Single-sided, as this template expects')}
        ${checkItem('ok', 'frame-select', 'Corner marks fully visible on every page')}
      </div></div></section>
    </div>
    <div class="row" style="margin-top:18px">
      ${L ? '' : '<button class="link-btn" data-act="mark-printed">Already printed another way? Mark as printed</button>'}
      <span class="spacer"></span>
      ${route2 === 'save'
    ? `<button class="btn btn-primary btn-lg" data-act="${L ? 'toast' : 'lock-print'}" data-msg="Saved physics-midterm-print.zip (36 copies).">${ic('download')} ${L ? 'Save PDFs again' : 'Save PDFs for printing…'}</button>`
    : `<button class="btn btn-primary btn-lg" data-act="${L ? 'toast' : 'lock-print'}" data-msg="36 copies sent to the staff room laser.">${ic('printer')} ${L ? 'Print again' : 'Print 36 copies…'}</button>`}
    </div>
  </div>`;
};

VIEWS['upload-scans'] = () => {
  const st = S.state;
  if (!locked()) {
    return `<div class="page">${header('upload-scans', 'Upload scans')}${guideBox('upload-scans')}
      ${empty('upload', 'Scans come after printing', 'Print the papers and hold the exam first. Then scan the answer sheets and upload them here.', '<a class="btn btn-primary" href="#/exam/print">Go to Print</a>')}</div>`;
  }
  const drop = (big) => `<button class="dropzone" style="width:100%;cursor:pointer;${big ? '' : 'padding:16px'}" data-act="upload">
    ${ic('cloud-upload')}<div><strong>Drop scanned answer sheets here</strong> or click to choose files</div><div class="subtle">PDF, TIFF, JPEG or PNG · 300 dpi recommended</div></button>`;
  const opts = `<section class="card"><div class="card-header"><h2>Scan options</h2></div><div class="card-body">
    <label class="switch"><input type="checkbox"> Photocopied sheets <span class="subtle">(students wrote on photocopies, not printed copies)</span></label>
    <label class="field" style="margin-top:14px"><span class="field-label">Several scans of the same copy</span>
      <select class="select"><option>Not allowed (strict)</option><option>Skip unrecognised pages</option><option>Take the latest scan</option></select></label>
  </div></section>`;
  if (st === 'printed') {
    return `<div class="page">${header('upload-scans', 'Upload scans', 'Upload the scanned answer sheets. Each page is detected automatically.')}${guideBox('upload-scans')}
      ${drop(true)}<div style="margin-top:16px">${opts}</div></div>`;
  }
  const bad = S.unreadable.filter((u) => !u.resolved).length;
  return `<div class="page">
    ${header('upload-scans', 'Upload scans', 'Upload the scanned answer sheets. Each page is detected automatically.', '<a class="btn btn-primary" href="#/exam/check-scans">Next: Check scans</a>')}
    ${guideBox('upload-scans')}
    <div class="stats" style="margin-bottom:16px">${stat(72, 'Pages uploaded')}${stat(72 - bad, 'Recognised', 'ok')}${stat(bad, 'Unreadable', bad ? 'bad' : 'ok')}${stat('36 / 36', 'Copies complete')}</div>
    <section class="card"><div class="card-header"><h2>Uploaded files</h2></div><div class="list">
      <div class="list-row"><span class="list-icon ok">${ic('check')}</span><div class="list-row-main"><div class="list-row-title">scan-0411.pdf</div><div class="subtle">40 pages · all recognised · uploaded 6 Nov, 09:12</div></div><button class="btn btn-sm" data-act="show-doc" data-doc="scan">View</button></div>
      <div class="list-row"><span class="list-icon ${bad ? 'warn' : 'ok'}">${ic(bad ? 'warning-triangle' : 'check')}</span><div class="list-row-main"><div class="list-row-title">scan-0412.pdf</div><div class="subtle">32 pages · ${32 - bad} recognised${bad ? `, ${bad} unreadable` : ''} · uploaded 6 Nov, 09:15</div></div><a class="btn btn-sm" href="#/exam/check-scans">${bad ? 'Fix' : 'View'}</a></div>
    </div></section>
    <div style="margin-top:16px">${drop(false)}</div>
    <div style="margin-top:16px">${opts}</div>
  </div>`;
};

VIEWS['check-scans'] = () => {
  if (!scanned()) {
    return `<div class="page">${header('check-scans', 'Check scans')}${guideBox('check-scans')}
      ${empty('page-search', 'No scans yet', 'Upload the scanned answer sheets first. Problems that need your eye will appear here.', '<a class="btn btn-primary" href="#/exam/upload-scans">Go to Upload scans</a>')}</div>`;
  }
  const unread = S.unreadable.filter((u) => !u.resolved);
  const left = boxesLeft();
  const b = currentBox();
  const q = S.questions.find((x) => x.id === b.q);
  return `<div class="page">
    ${header('check-scans', 'Check scans', 'Fix what automatic detection couldn\'t settle. Marks come next.',
    issuesLeft() ? `<span class="chip chip-warning">${issuesLeft()} left</span>` : `<a class="btn btn-primary" href="#/exam/mark">Next: Mark ${ic('arrow-right')}</a>`)}
    ${guideBox('check-scans')}
    ${!issuesLeft() ? banner('success', 'check-circle', 'All clear.', 'Every page is read and every uncertain box is settled. You can compute the marks.', `<a class="btn btn-primary btn-sm" href="#/exam/mark">Go to Mark</a>`) : ''}
    <div class="stats" style="margin-bottom:16px">${stat(unread.length, 'Unreadable pages', unread.length ? 'bad' : 'ok')}${stat(0, 'Missing pages', 'ok')}${stat(left, 'Boxes to check', left ? 'warn' : 'ok')}</div>

    <section class="card"><div class="card-header">${ic('warning-triangle')}<h2>Unreadable pages</h2><span class="chip ${unread.length ? 'chip-danger' : 'chip-success'}">${unread.length || 'None'}</span></div>
      <div class="list">${unread.length ? unread.map((u) => `<div class="list-row"><span class="list-icon bad">${ic('page')}</span>
        <div class="list-row-main"><div class="list-row-title">${u.file} · page ${u.page}</div><div class="subtle">${esc(u.reason)}</div></div>
        <button class="btn btn-sm" data-act="toast" data-msg="Opens the page image in the preview panel.">View</button>
        <button class="btn btn-sm" data-act="unread" data-id="${u.id}" data-msg="Page processed again and recognised.">Process again</button>
        <button class="btn btn-sm btn-ghost" data-act="unread" data-id="${u.id}" data-msg="Page deleted.">${ic('trash')}</button></div>`).join('')
    : `<div class="list-row"><span class="list-icon ok">${ic('check')}</span><div class="list-row-main">Every uploaded page was recognised.</div></div>`}</div></section>

    <section class="card"><div class="card-header">${ic('multiple-pages')}<h2>Missing pages</h2><span class="chip chip-success">None</span></div>
      <div class="list"><div class="list-row"><span class="list-icon ok">${ic('check')}</span><div class="list-row-main">All 36 copies have both pages.</div></div></div></section>

    <section class="card"><div class="card-header">${ic('frame-select')}<h2>Boxes to check</h2><span class="chip ${left ? 'chip-warning' : 'chip-success'}">${left || 'None'}</span>
      ${left ? '<button class="btn btn-ghost btn-sm" data-act="accept-rest">Accept the rest as detected</button>' : ''}</div>
      <div class="review">
        <div class="review-list">${S.boxes.map((x, i) => `<button class="review-item ${x.resolved ? 'done' : ''}" aria-current="${i === S.reviewAt}" data-act="review-go" data-i="${i}">
          <span class="ri-dot"></span><span><span class="ri-title">Copy ${x.copy} · ${x.q} · ${'ABCD'[x.ans]}</span><br><span class="subtle">${x.why}${x.resolved ? ' · settled' : ''}</span></span></button>`).join('')}</div>
        <div style="padding:16px 16px 16px 0">
          <div class="zoom-stage"><div class="zoom-paper"><div class="zq"><b>${S.questions.indexOf(q) + 1}.</b> ${esc(q.text)}</div>
            <div class="zans">${q.answers.map((a, j) => {
    const ticks = SCAN_TICKS[q.id] || [];
    let c = ticks.includes(j) ? 't' : '';
    if (j === b.ans) c = b.look + ' flag';
    return `<div class="za"><span class="zb ${c}"></span>${esc(a)}</div>`;
  }).join('')}</div></div></div>
          <div class="row-between" style="margin-top:12px;flex-wrap:wrap">
            <div><strong>Answer ${'ABCD'[b.ans]}: ${b.why.toLowerCase()}</strong><div class="subtle">Detected as ${b.detected ? 'ticked' : 'not ticked'} · ${b.dark}% dark</div></div>
            <div class="btn-row">
              <button class="btn" data-act="decide" data-v="1">Ticked <span class="kbd">T</span></button>
              <button class="btn" data-act="decide" data-v="0">Not ticked <span class="kbd">N</span></button>
              <button class="btn btn-ghost" data-act="review-next">Skip <span class="kbd">→</span></button>
            </div></div>
        </div>
      </div></section>

    <details class="card" style="margin-top:16px"><summary class="card-header" style="cursor:pointer;border-bottom:0">${ic('settings')}<h2>Advanced: detection sensitivity</h2></summary>
      <div class="card-body" style="border-top:1px solid var(--border)"><p class="muted" style="margin-bottom:12px">A box darker than the upper limit counts as ticked, lighter than the lower limit as empty. Anything between is sent to you to check.</p>
        <div class="form-grid"><label class="field"><span class="field-label">Lower limit</span><input class="input" type="number" value="0.15" step="0.01"></label>
        <label class="field"><span class="field-label">Upper limit</span><input class="input" type="number" value="0.50" step="0.01"></label></div></div></details>
  </div>`;
};

VIEWS.mark = () => {
  if (!scanned()) {
    return `<div class="page">${header('mark', 'Mark')}${guideBox('mark')}
      ${empty('clipboard-check', 'Nothing to mark yet', 'Marks are computed from the checked scans.', '<a class="btn btn-primary" href="#/exam/upload-scans">Go to Upload scans</a>')}</div>`;
  }
  const unread = S.unreadable.filter((u) => !u.resolved).length;
  const left = boxesLeft();
  const clear = !unread && !left;
  return `<div class="page">
    ${header('mark', 'Mark', 'Compute every student\'s marks from the checked scans and the marking scheme.')}
    ${guideBox('mark')}
    ${S.outOfDate ? banner('lock', 'refresh', 'The marking scheme changed after the last marking.', 'Recompute to update the marks, the exported files and the annotated sheets.') : ''}
    <section class="card"><div class="card-header"><h2>Ready to mark?</h2></div><div class="card-body"><div class="checklist">
      ${checkItem(unread ? 'bad' : 'ok', unread ? 'xmark-circle' : 'check-circle', `Unreadable pages: ${unread || 'none'}`, unread ? '<a class="btn btn-sm" href="#/exam/check-scans">Fix</a>' : '')}
      ${checkItem('ok', 'check-circle', 'Missing pages: none')}
      ${checkItem(left ? 'warn' : 'ok', left ? 'warning-triangle' : 'check-circle', `Boxes to check: ${left || 'none'}`, left ? '<a class="btn btn-sm" href="#/exam/check-scans">Review</a>' : '')}
      ${checkItem(S.schemeDirty ? 'warn' : 'ok', S.schemeDirty ? 'warning-triangle' : 'check-circle', S.schemeDirty ? 'Marking scheme has unsaved changes' : 'Marking scheme saved at 10:31', S.schemeDirty ? '<a class="btn btn-sm" href="#/exam/marking-scheme">Open</a>' : '')}
    </div></div>
    <div class="card-foot">${clear ? '' : '<button class="btn" data-act="mark-anyway">Mark anyway…</button>'}
      <button class="btn btn-primary" data-act="compute" ${clear ? '' : 'disabled'}>${ic('clipboard-check')} ${S.marked ? 'Recompute marks' : 'Compute marks'}</button></div></section>
    ${S.marked ? `<section class="card"><div class="card-header"><h2>Last marking</h2><span class="subtle">Today, ${S.markedAt || '11:05'}</span></div><div class="card-body">
      <div class="stats" style="margin-bottom:14px">${stat(32, 'Students marked')}${stat('13.4', 'Average / 20')}${stat(2, 'Answers breaking the rules', 'warn')}</div>
      <div class="list" style="border:1px solid var(--border);border-radius:var(--radius)">
        <div class="list-row"><span class="list-icon warn">${ic('warning-triangle')}</span><div class="list-row-main"><div class="list-row-title">Copy 9 · Q1: two answers ticked</div><div class="subtle">Single-answer question, scored as wrong</div></div><button class="btn btn-sm" data-act="show-doc" data-doc="scan">View page</button></div>
        <div class="list-row"><span class="list-icon warn">${ic('warning-triangle')}</span><div class="list-row-main"><div class="list-row-title">Copy 23 · Q5: two answers ticked</div><div class="subtle">Single-answer question, scored as wrong</div></div><button class="btn btn-sm" data-act="show-doc" data-doc="scan">View page</button></div>
      </div></div></section>` : ''}
  </div>`;
};

VIEWS['match-students'] = () => {
  const classlist = `<section class="card"><div class="card-header">${ic('group')}<h2>Class list</h2><button class="btn btn-sm" data-act="show-doc" data-doc="classlist">Preview</button><button class="btn btn-sm" data-act="toast" data-msg="Choose a CSV file to replace the class list.">Replace</button></div>
    <div class="card-body"><div class="row" style="flex-wrap:wrap;gap:16px"><div><strong>10B.csv</strong><div class="subtle">32 students · columns: Roll no., Name, Email</div></div><span class="spacer"></span>
      <label class="field" style="min-width:260px"><span class="field-label">Match using</span><select class="select"><option>Roll no. ↔ student code on the sheet</option><option>Name ↔ name written on the sheet</option></select></label></div></div></section>`;
  if (!S.marked) {
    return `<div class="page">${header('match-students', 'Match students', 'Link each answer sheet to a student in the class list.')}${guideBox('match-students')}
      ${classlist}<div style="margin-top:16px">${empty('group', 'Matching comes after marking', 'You can load the class list now. Sheets are matched once the marks are computed.', '<a class="btn btn-primary" href="#/exam/mark">Go to Mark</a>')}</div></div>`;
  }
  const cur = S.unmatched[0];
  const matchedAuto = 28;
  const done = 32 - S.unmatched.length;
  const takenNames = ['Ananya Iyer', 'Rohan Das', 'Kabir Singh', 'Sneha Ghosh'].slice(4 - S.unmatched.length);
  return `<div class="page">
    ${header('match-students', 'Match students', 'Link each answer sheet to a student in the class list.')}
    ${guideBox('match-students')}
    ${classlist}
    <div class="stats" style="margin:16px 0">${stat(matchedAuto, 'Matched automatically', 'ok')}${stat(S.unmatched.length, 'To match by hand', S.unmatched.length ? 'warn' : 'ok')}${stat(0, 'Not in the class list')}</div>
    <div class="progress ok" style="margin-bottom:16px"><span style="width:${done / 32 * 100}%"></span></div>
    ${cur ? `<section class="card"><div class="card-header">${ic('user')}<h2>Match by hand</h2><span class="subtle">${cur.sheet} · ${S.unmatched.length} left</span></div>
      <div class="card-body grid grid-2">
        <div><div class="field-label" style="margin-bottom:6px">Name written on the sheet</div>
          <div class="namebox">${cur.hand ? `<span class="hand">${esc(cur.hand)}</span>` : '<span class="blank">Left blank</span>'}</div>
          <div class="btn-row" style="margin-top:12px"><button class="btn btn-sm" data-act="match" data-msg="Marked as not in the class list.">Not in the class list</button><button class="btn btn-sm btn-ghost" data-act="toast" data-msg="Skipped.">Skip</button></div></div>
        <div><input class="input" placeholder="Type a name or roll number" aria-label="Search students" value="${esc((cur.hand || '').split(/[ .]/)[0])}">
          <div class="list" style="border:1px solid var(--border);border-radius:var(--radius);margin-top:8px">
            ${takenNames.map((n) => { const s = STUDENTS.find((x) => x.name === n); return `<button class="list-row" style="width:100%;background:none;border-left:0;border-right:0;border-bottom:0;font:inherit;color:inherit;cursor:pointer;text-align:left" data-act="match" data-msg="${esc(cur.sheet)} matched to ${esc(n)}."><span class="avatar">${n[0]}</span><span class="list-row-main"><span class="list-row-title">${esc(n)}</span><br><span class="subtle">Roll no. ${s.roll}</span></span>${ic('arrow-right')}</button>`; }).join('')}
          </div></div>
      </div></section>`
    : banner('success', 'check-circle', 'Every sheet is matched to a student.', '', '<a class="btn btn-primary btn-sm" href="#/exam/export-marks">Go to Export marks</a>')}
  </div>`;
};

VIEWS['export-marks'] = () => {
  if (!S.marked) {
    return `<div class="page">${header('export-marks', 'Export marks')}${guideBox('export-marks')}
      ${empty('table', 'No marks yet', 'Compute the marks first.', '<a class="btn btn-primary" href="#/exam/mark">Go to Mark</a>')}</div>`;
  }
  const bins = new Array(10).fill(0);
  STUDENTS.forEach((s) => { bins[Math.min(9, Math.floor(s.mark / 2))] += 1; });
  const max = Math.max(...bins);
  const marks = STUDENTS.map((s) => s.mark).sort((a, b) => a - b);
  const avg = (marks.reduce((a, b) => a + b, 0) / marks.length).toFixed(1);
  return `<div class="page">
    ${header('export-marks', 'Export marks', 'Check the marks, then export them for your records or the school system.')}
    ${guideBox('export-marks')}
    ${S.outOfDate ? banner('lock', 'refresh', 'These marks are out of date.', 'The marking scheme changed. Recompute the marks before exporting.', '<a class="btn btn-sm" href="#/exam/mark">Go to Mark</a>') : ''}
    <div class="stats" style="margin-bottom:16px">${stat(32, 'Students')}${stat(avg, 'Average / 20')}${stat(marks[16], 'Median')}${stat(marks[31], 'Highest')}${stat(marks[0], 'Lowest')}</div>
    <div class="grid grid-2">
      <section class="card"><div class="card-header"><h2>Distribution</h2><span class="subtle">marks out of 20</span></div><div class="card-body">
        <div class="histo">${bins.map((n) => `<div style="height:${n / max * 100}%"><span>${n || ''}</span></div>`).join('')}</div>
        <div class="histo-axis">${bins.map((_, i) => `<span>${i * 2}</span>`).join('')}</div></div></section>
      <section class="card"><div class="card-header"><h2>Export</h2></div><div class="card-body">
        <div class="segmented" role="group" aria-label="Format">${[['csv', 'CSV'], ['ods', 'ODS (LibreOffice)']].map(([k, l]) => `<button aria-pressed="${S.exportFormat === k}" data-act="fmt" data-k="${k}">${l}</button>`).join('')}</div>
        <div style="margin-top:14px"><label class="check"><input type="checkbox" checked> Include absent students</label>
        <label class="check"><input type="checkbox"> Add statistics</label>
        <label class="check"><input type="checkbox"> Include ticked boxes (one column per answer)</label></div>
      </div><div class="card-foot"><button class="btn btn-primary" data-act="export">${ic('download')} Export ${S.exportFormat.toUpperCase()}</button></div></section>
    </div>
    <section class="card" style="margin-top:16px"><div class="card-header"><h2>Marks</h2><button class="btn btn-ghost btn-sm" data-act="show-doc" data-doc="csv">Open in panel</button></div>
      <div class="table-wrap" style="border:0;border-radius:0;max-height:330px"><table class="table"><thead><tr><th class="th-sort">Roll</th><th class="th-sort">Name</th><th class="num th-sort">Points / 8</th><th class="num th-sort">Mark / 20</th></tr></thead>
      <tbody>${STUDENTS.map((s) => `<tr><td class="num">${s.roll}</td><td>${esc(s.name)}</td><td class="num">${s.points}</td><td class="num"><strong>${s.mark}</strong></td></tr>`).join('')}</tbody></table></div></section>
    <section class="card" style="margin-top:16px"><div class="card-body row-between">
      <div><strong>Private marks link</strong><div class="subtle">Students see only their own marks with the link.</div></div>
      <label class="switch"><input type="checkbox"><span class="sr-only">Share marks with a private link</span></label></div></section>
  </div>`;
};

VIEWS.annotate = () => {
  if (!S.marked) {
    return `<div class="page">${header('annotate', 'Annotate')}${guideBox('annotate')}
      ${empty('edit-pencil', 'No marks yet', 'Sheets are annotated with the computed marks.', '<a class="btn btn-primary" href="#/exam/mark">Go to Mark</a>')}</div>`;
  }
  return `<div class="page">
    ${header('annotate', 'Annotate', 'Produce each student\'s marked answer sheet.')}
    ${guideBox('annotate')}
    ${S.outOfDate && S.annotated ? banner('lock', 'refresh', 'The annotated sheets are out of date.', 'The marking scheme changed. Recompute the marks, then annotate again.') : ''}
    <div class="grid grid-2">
      <section class="card"><div class="card-header"><h2>On each sheet</h2></div><div class="card-body">
        <label class="field"><span class="field-label">Where the marks appear</span><select class="select"><option>Next to each question (from the source)</option><option>In the margin</option><option>In both margins</option><option>On the boxes</option><option>Nowhere</option></select></label>
        <label class="field"><span class="field-label">Header text</span><textarea class="textarea mono" rows="3">%(Name)  Roll no. %(ID)
Mark: %s / %m</textarea><span class="field-hint">%s is the mark, %m the maximum; %(Column) inserts a class list column.</span></label>
      </div></section>
      <section class="card"><div class="card-header"><h2>How sheets are saved</h2></div><div class="card-body">
        <div class="segmented" role="group" aria-label="Save as">${[['student', 'One PDF per student'], ['class', 'One PDF for the class']].map(([k, l]) => `<button aria-pressed="${S.annotSave === k}" data-act="annot-save" data-k="${k}">${l}</button>`).join('')}</div>
        <label class="field" style="margin-top:14px"><span class="field-label">File name</span><input class="input mono" value="(ID)-(Name)"><span class="field-hint">Example: 1002-Ananya-Iyer.pdf</span></label>
        <div style="margin-top:14px"><label class="check"><input type="checkbox"> Include the question paper</label>
        <label class="check"><input type="checkbox" checked> Add the corrected answer key</label>
        <label class="check"><input type="checkbox"> Keep existing files (don't overwrite)</label></div>
      </div></section>
    </div>
    <div class="row" style="margin-top:16px"><span class="spacer"></span>
      <button class="btn" data-act="show-doc" data-doc="annotated">${ic('eye')} Preview one student</button>
      <button class="btn btn-primary" data-act="annotate">${ic('edit-pencil')} Annotate 32 sheets</button></div>
    ${S.annotated ? `<section class="card" style="margin-top:16px"><div class="card-header"><h2>Annotated sheets</h2><button class="btn btn-sm" data-act="toast" data-msg="Downloading annotated-10B.zip">${ic('download')} Download all</button></div>
      <div class="list">${STUDENTS.slice(0, 5).map((s) => `<div class="list-row"><span class="list-icon brand">${ic('page')}</span><div class="list-row-main"><div class="list-row-title">${s.roll}-${s.name.replace(' ', '-')}.pdf</div><div class="subtle">${esc(s.name)} · ${s.mark} / 20</div></div><button class="btn btn-sm" data-act="show-doc" data-doc="annotated">Preview</button></div>`).join('')}
      <div class="list-row subtle">… and 27 more</div></div></section>` : ''}
  </div>`;
};

VIEWS.settings = () => `<div class="page">
  ${header('', 'Exam settings', 'Settings that belong to this exam. Personal preferences are in your account menu.')}
  <section class="card"><div class="card-body"><div class="form-grid">
    <label class="field"><span class="field-label">Exam name</span><input class="input" value="${esc(EXAM.name)}"></label>
    <label class="field"><span class="field-label">Class</span><input class="input" value="${EXAM.cls}"></label>
    <label class="field"><span class="field-label">LaTeX engine</span><select class="select" ${locked() ? 'disabled' : ''}><option>pdflatex</option><option>xelatex</option><option>lualatex</option></select></label>
  </div>${locked() ? '<p class="subtle" style="margin-top:12px">Build settings are locked after printing.</p>' : ''}</div></section>
</div>`;

VIEWS.admin = () => {
  const presets = ['#3b5bdb', '#0b7285', '#2b8a3e', '#c2255c', '#e8590c', '#5f3dc4', '#495057'];
  const ok = S.brandContrast >= 4.5;
  return `<div class="page">
    <div class="page-header"><div><div class="eyebrow">Administration</div><h1>Appearance</h1><p class="page-sub">Your school's name, logo and colours, for every teacher and on the sign-in page.</p></div>
      <div class="page-actions"><button class="btn" data-act="brand-reset">Reset to neutral</button><button class="btn btn-primary" data-act="toast" data-msg="Appearance saved for all teachers.">${ic('floppy-disk')} Save</button></div></div>
    <div class="grid grid-2">
      <section class="card"><div class="card-body">
        <label class="field"><span class="field-label">School name</span><input class="input" id="school-name" value="${esc(S.school)}"></label>
        <div class="field"><span class="field-label">Logo</span><div class="logo-drop">
          <div class="logo-box">${S.logo ? `<img src="${S.logo}" alt="School logo">` : ic('media-image')}</div>
          <div class="btn-row"><label class="btn btn-sm">${ic('upload')} Upload<input type="file" accept="image/png,image/jpeg,image/svg+xml" id="logo-file" hidden></label>
            <button class="btn btn-sm" data-act="sample-logo">Try a sample logo</button>
            ${S.logo ? '<button class="btn btn-sm btn-ghost" data-act="logo-remove">Remove</button>' : ''}</div></div>
          <span class="field-hint">PNG, JPEG or SVG. Shown in the top bar, on the sign-in page and on school templates.</span></div>
        <div class="field"><span class="field-label">Colour</span>
          ${S.logoColors.length ? `<span class="field-hint">From your logo</span><div class="swatches">${S.logoColors.map((c) => `<button class="swatch" style="background:${c}" aria-pressed="${S.brand === c}" data-act="brand" data-c="${c}" aria-label="Use ${c}"></button>`).join('')}</div>` : ''}
          <span class="field-hint">Presets</span><div class="swatches">${presets.map((c) => `<button class="swatch" style="background:${c}" aria-pressed="${S.brand === c}" data-act="brand" data-c="${c}" aria-label="Use ${c}"></button>`).join('')}
            <label class="swatch" style="display:grid;place-items:center;background:var(--surface-2)" title="Custom colour">${ic('palette')}<input type="color" id="brand-custom" value="${S.brand}" hidden></label></div>
          <div class="row" style="margin-top:6px"><span class="chip ${ok ? 'chip-success' : 'chip-danger'}">${ic(ok ? 'check-circle' : 'warning-triangle')} Button text contrast ${S.brandContrast.toFixed(1)}:1</span>
            <span class="subtle">${ok ? 'Readable (WCAG AA)' : 'Too low. The app will darken the colour for text.'}</span></div></div>
      </div></section>
      <section class="card"><div class="card-header"><h2>Preview</h2></div><div class="card-body"><div class="preview-mini">
        <div class="pm-top"><span class="brandmark-logo">${S.logo ? `<img src="${S.logo}" alt="">` : 'AMC'}</span>${esc(S.school)}</div>
        <div class="pm-body"><div class="btn-row"><button class="btn btn-primary">Primary action</button><button class="btn">Secondary</button></div>
          <div class="row"><span class="chip chip-brand">Ready to print</span><a href="#/admin/appearance">A link</a></div>
          <a class="step is-done" style="background:var(--accent-soft)" aria-current="page"><span class="step-dot">${ic('check')}</span><span class="step-label">Current step</span></a>
          <div class="progress"><span style="width:62%"></span></div></div></div></div></section>
    </div>
  </div>`;
};

/* ---------- Shell ---------- */

function renderTop() {
  const inExam = route.kind === 'exam';
  const themeIcon = { auto: 'half-moon', light: 'sun-light', dark: 'half-moon' }[S.theme];
  const crumbs = [`<a href="#/exams">Exams</a>`];
  if (inExam) crumbs.push(`<span class="current">${esc(EXAM.name)} (${EXAM.cls})</span>`);
  if (route.kind === 'new') crumbs.push('<span class="current">New exam</span>');
  if (route.kind === 'admin') crumbs.push('<span class="current">Appearance</span>');
  $('#topbar').innerHTML = `
    <a class="brandmark" href="#/exams"><span class="brandmark-logo">${S.logo ? `<img src="${S.logo}" alt="">` : 'AMC'}</span><span class="brandmark-name">${esc(S.school || 'AMC')}</span></a>
    <nav class="crumbs" aria-label="Breadcrumb"><span class="sep">/</span>${crumbs.join('<span class="sep">/</span>')}</nav>
    ${inExam ? examChip() : ''}
    <span class="topbar-spacer"></span>
    <div class="topbar-actions">
      ${docsFor().length ? `<button class="btn btn-ghost btn-icon" data-act="toggle-preview" aria-pressed="${S.previewOpen}" title="Show or hide the preview panel" aria-label="Preview panel">${ic(S.previewOpen ? 'sidebar-collapse' : 'sidebar-expand')}</button>` : ''}
      <button class="btn btn-ghost btn-icon" data-act="theme" title="Theme: ${S.theme}" aria-label="Theme: ${S.theme}">${ic(themeIcon)}</button>
      <div style="position:relative">
        <button class="btn btn-ghost" data-act="menu" aria-haspopup="menu" aria-expanded="${S.menu}" style="padding:0 6px 0 4px"><span class="avatar">P</span><span>Priya</span>${ic('nav-arrow-down')}</button>
        ${S.menu ? `<div class="menu" role="menu">
          <div class="menu-label">Priya Sharma · admin</div>
          <button class="menu-item" role="menuitem" data-act="toast" data-msg="Opens the account page (password, sessions).">${ic('user-circle')} Account and password</button>
          <a class="menu-item" role="menuitem" href="#/admin/appearance">${ic('palette')} Appearance</a>
          <button class="menu-item" role="menuitem" data-act="toast" data-msg="Opens the accounts page (admins).">${ic('group')} Accounts</button>
          <div class="menu-sep"></div>
          <button class="menu-item" role="menuitem" data-act="toast" data-msg="In the real app this switches you to the Classic style; a bar there switches back.">${ic('undo')} Switch to Classic style</button>
          <div class="menu-sep"></div>
          <button class="menu-item" role="menuitem" data-act="toast" data-msg="Signed out (not really).">${ic('log-out')} Sign out</button></div>` : ''}
      </div>
    </div>`;
}

function renderSide() {
  const app = $('#app');
  const show = route.kind === 'exam';
  app.classList.toggle('no-sidebar', !show);
  if (!show) { $('#sidebar').innerHTML = ''; return; }
  const group = (g, title) => `<div class="steps-group"><div class="steps-title">${title}</div>
    ${STEPS.filter((s) => s.group === g).map((s) => {
    const st = stepStatus(s.id);
    const dot = st.cls === 'is-done' ? ic('check') : st.cls === 'is-locked' ? ic('lock') : s.n;
    const cur = route.step === s.id;
    const tip = { 'is-done': 'Done', 'is-locked': 'Locked after printing', 'is-attention': 'Needs attention', 'is-blocked': 'Not ready yet' }[st.cls] || 'Not started';
    return `<a class="step ${st.cls}" href="#/exam/${s.id}" ${cur ? 'aria-current="page"' : ''} title="${tip}">
      <span class="step-dot">${dot}</span><span class="step-label">${s.label}</span>${st.count !== null ? `<span class="step-count">${st.count}</span>` : ''}</a>`;
  }).join('')}</div>`;
  $('#sidebar').innerHTML = group('before', 'Before the exam') + group('after', 'After the exam')
    + `<div class="sidebar-foot"><a class="side-link" href="#/exam/settings" ${route.step === 'settings' ? 'aria-current="page"' : ''}>${ic('settings')} Exam settings</a>
      <button class="side-link" style="border:0;background:none;font:inherit;cursor:pointer;text-align:left" data-act="open-guide">${ic('help-circle')} Guide</button></div>`;
}

function renderMain(keepScroll) {
  const main = $('#main');
  const top = main.scrollTop;
  const view = route.kind === 'exam' ? VIEWS[route.step] : VIEWS[route.kind];
  main.innerHTML = view();
  if (keepScroll) main.scrollTop = top;
}

function renderPreview() {
  const app = $('#app');
  const docs = docsFor();
  const open = docs.length > 0 && S.previewOpen;
  app.classList.toggle('preview-closed', !open);
  app.classList.toggle('preview-max', open && S.previewMax);
  if (!open) { $('#preview').innerHTML = ''; return; }
  const cur = docs.includes(S.previewDoc) ? S.previewDoc : docs[0];
  const d = DOCS[cur];
  const p = $('#preview');
  const scroll = p.querySelector('.preview-body')?.scrollTop || 0;
  p.style.setProperty('--preview-w', S.previewW + 'px');
  app.style.setProperty('--preview-w', S.previewW + 'px');
  p.innerHTML = `<div class="preview-resizer" role="separator" aria-orientation="vertical" aria-label="Resize the preview panel" tabindex="0"></div>
    <div class="preview-header"><span class="preview-title">${esc(val(d.title))}</span>
      <button class="btn btn-ghost btn-icon btn-sm" data-act="toast" data-msg="Opens in a new browser tab." title="Open in a new tab" aria-label="Open in a new tab">${ic('open-new-window')}</button>
      <button class="btn btn-ghost btn-icon btn-sm" data-act="toast" data-msg="Downloading." title="Download" aria-label="Download">${ic('download')}</button>
      <button class="btn btn-ghost btn-icon btn-sm" data-act="preview-max" title="${S.previewMax ? 'Restore' : 'Maximise'}" aria-label="${S.previewMax ? 'Restore' : 'Maximise'}">${ic(S.previewMax ? 'collapse' : 'expand')}</button>
      <button class="btn btn-ghost btn-icon btn-sm" data-act="toggle-preview" title="Close" aria-label="Close the preview">${ic('xmark')}</button></div>
    ${docs.length > 1 ? `<div class="preview-tabs" role="tablist">${docs.map((k) => `<button role="tab" aria-selected="${k === cur}" data-act="show-doc" data-doc="${k}">${esc(DOCS[k].tab)}</button>`).join('')}</div>` : ''}
    <div class="preview-body ${d.plain ? 'plain' : ''}">${d.render()}</div>
    <div class="preview-foot">${esc(val(d.foot))}</div>`;
  if (cur === S.previewDoc || cur === docs[0]) p.querySelector('.preview-body').scrollTop = scroll;
}

function renderAll(keepScroll = false) {
  renderTop();
  renderSide();
  renderMain(keepScroll);
  renderPreview();
  renderLayer();
}

/* ---------- Dialogs and toasts ---------- */

function toast(msg, iconName = 'check-circle') {
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `${ic(iconName)}<span>${esc(msg)}</span>`;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

function renderLayer() {
  const layer = $('#layer');
  const d = S.dialog;
  if (!d) { layer.innerHTML = ''; return; }
  const wrap = (iconKind, iconName, title, body, foot) => `<div class="backdrop" data-act="dialog-close-bg">
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
      <div class="dialog-head"><span class="dialog-icon ${iconKind}">${ic(iconName)}</span><div><h2 id="dlg-title">${title}</h2></div></div>
      <div class="dialog-body">${body}</div><div class="dialog-foot">${foot}</div></div></div>`;
  let html = '';
  if (d.type === 'lock-print' || d.type === 'mark-printed') {
    const printer = d.type === 'lock-print' && S.printRoute === 'printer' && S.linux;
    const verb = d.type === 'mark-printed' ? 'Mark as printed' : printer ? 'Print and lock' : 'Save PDFs and lock';
    html = wrap('warn', 'lock', d.type === 'mark-printed' ? 'Mark this exam as printed?' : 'This locks the exam',
      `<p>After printing, the questions and layout must stay exactly as printed, or the scans can't be read.</p>
       <ul><li>Locked: questions, answers' text, layout, number of copies.</li><li>Still editable: marking scheme, answer key corrections, final mark settings, class list.</li></ul>
       <p>Unlocking later is possible, but removes scans and marks.</p>`,
      `<button class="btn" data-act="dialog-close">Cancel</button><button class="btn btn-primary" data-act="do-lock">${ic(printer ? 'printer' : 'download')} ${verb}</button>`);
  } else if (d.type === 'unlock') {
    html = wrap('danger', 'lock-slash', 'Unlock to edit questions?',
      `<p>The printed papers will no longer match the exam. This removes:</p>
       <ul><li><b>72 scanned pages</b> and your corrections to them</li><li><b>Matches</b> between sheets and students</li><li><b>Computed marks</b>, exports and annotated sheets</li></ul>
       <label class="field"><span class="field-label">Type the exam name to confirm: <b>${esc(EXAM.name)}</b></span><input class="input" id="unlock-name" autocomplete="off"></label>`,
      `<button class="btn" data-act="dialog-close">Cancel</button><button class="btn btn-danger" data-act="do-unlock" id="unlock-go" disabled>${ic('lock-slash')} Unlock and remove data</button>`);
  } else if (d.type === 'mark-anyway') {
    const unread = S.unreadable.filter((u) => !u.resolved).length;
    html = wrap('warn', 'warning-triangle', 'Compute marks with problems left?',
      `<p>These are still unresolved, so some marks may be wrong:</p><ul>${unread ? `<li>${unread} unreadable pages (those copies miss a page)</li>` : ''}${boxesLeft() ? `<li>${boxesLeft()} boxes to check (counted as detected)</li>` : ''}</ul>
       <p>Fine for a quick look. Fix them and recompute before exporting.</p>`,
      `<button class="btn" data-act="dialog-close">Cancel</button><a class="btn" href="#/exam/check-scans" data-act="dialog-close">Fix them first</a><button class="btn btn-primary" data-act="compute-anyway">Mark anyway</button>`);
  }
  layer.innerHTML = html;
  const first = layer.querySelector('input, .dialog-foot .btn-primary, .dialog-foot .btn');
  if (first) first.focus();
}

/* ---------- Branding ---------- */

function hexToRgb(h) { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgbToHex(r, g, b) { return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join(''); }
function luminance([r, g, b]) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a, b) { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); }
function applyBrand(hex) {
  const rgb = hexToRgb(hex);
  const cw = contrast(rgb, [255, 255, 255]);
  const cb = contrast(rgb, [17, 17, 17]);
  document.documentElement.style.setProperty('--brand', hex);
  document.documentElement.style.setProperty('--on-brand', cw >= cb ? '#ffffff' : '#111111');
  S.brand = hex;
  S.brandContrast = Math.max(cw, cb);
  store.set('brand', hex);
}
/* Main colours of a logo: skip transparent, near-white, near-black and grey pixels. */
function logoColors(img) {
  const n = 48;
  const c = document.createElement('canvas');
  c.width = n; c.height = n;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, n, n);
  const d = g.getImageData(0, 0, n, n).data;
  const buckets = new Map();
  for (let i = 0; i < d.length; i += 4) {
    const [r, gg, b, a] = [d[i], d[i + 1], d[i + 2], d[i + 3]];
    if (a < 128) continue;
    const max = Math.max(r, gg, b); const min = Math.min(r, gg, b);
    if (max < 40 || min > 225 || (max - min) / max < 0.25) continue;
    const key = (r >> 4) << 8 | (gg >> 4) << 4 | (b >> 4);
    const e = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    e.n += 1; e.r += r; e.g += gg; e.b += b;
    buckets.set(key, e);
  }
  const picks = [];
  [...buckets.values()].sort((x, y) => y.n - x.n).forEach((e) => {
    const rgb = [Math.round(e.r / e.n), Math.round(e.g / e.n), Math.round(e.b / e.n)];
    if (picks.length < 4 && picks.every((p) => Math.hypot(p[0] - rgb[0], p[1] - rgb[1], p[2] - rgb[2]) > 60)) picks.push(rgb);
  });
  return picks.map((p) => rgbToHex(...p));
}
function useLogo(dataUrl) {
  const img = new Image();
  img.onload = () => {
    S.logo = dataUrl;
    store.set('logo', dataUrl);
    S.logoColors = logoColors(img);
    if (S.logoColors[0]) applyBrand(S.logoColors[0]);
    renderAll(true);
    toast(S.logoColors.length ? 'Logo added. Colour suggested from it.' : 'Logo added. No strong colour found; pick one below.');
  };
  img.src = dataUrl;
}
const SAMPLE_LOGO = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M32 4 56 12v18c0 15-10 25-24 30C18 55 8 45 8 30V12z" fill="#0b6e4f"/>'
  + '<path d="M32 12 48 17v13c0 10-7 17-16 21-9-4-16-11-16-21V17z" fill="#f2c14e"/><path d="M24 26h16v4H24zm0 8h16v4H24z" fill="#0b6e4f"/></svg>');

/* ---------- Actions ---------- */

function applyTheme() {
  if (S.theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', S.theme);
}

const ACTIONS = {
  toast: (el) => toast(el.dataset.msg || 'Done.'),
  theme: () => { S.theme = { auto: 'light', light: 'dark', dark: 'auto' }[S.theme]; store.set('theme', S.theme); applyTheme(); renderTop(); toast(`Theme: ${S.theme === 'auto' ? 'same as the computer' : S.theme}`, 'half-moon'); },
  menu: () => { S.menu = !S.menu; renderTop(); },
  'toggle-preview': () => { S.previewOpen = !S.previewOpen; S.previewMax = false; renderTop(); renderPreview(); },
  'preview-max': () => { S.previewMax = !S.previewMax; renderPreview(); },
  'show-doc': (el) => { S.previewDoc = el.dataset.doc; S.previewOpen = true; renderTop(); renderPreview(); },
  'open-guide': () => { S.previewDoc = 'guide'; S.previewOpen = true; renderTop(); renderPreview(); },
  'guide-toggle': (el) => { const k = el.dataset.step; S.guide[k] = !S.guide[k]; store.set('guide', S.guide); renderMain(true); },
  'dash-filter': (el) => { S.dashFilter = el.dataset.k; renderMain(true); },
  'tpl-lang': (el) => { S.tplLang = el.dataset.k; S.tpl = TEMPLATES[S.tplLang][0].id; renderMain(true); renderPreview(); },
  tpl: (el) => { S.tpl = el.dataset.k; renderMain(true); renderPreview(); },
  'wiz-next': () => { S.wizard += 1; renderAll(); },
  'wiz-back': () => { S.wizard -= 1; renderAll(); },
  'wiz-create': () => { resetExam('draft'); location.hash = '#/exam/questions'; toast('Exam created from the template.'); },
  ans: (el) => {
    const q = S.questions[+el.dataset.q]; const a = +el.dataset.a;
    if (q.type === 'single') q.correct = [a];
    else q.correct = q.correct.includes(a) ? q.correct.filter((x) => x !== a) : [...q.correct, a].sort();
    S.schemeDirty = true; renderAll(true);
  },
  neutral: (el) => { const q = S.questions[+el.dataset.q]; q.rule = q.rule === 'neutral' ? 'default' : 'neutral'; S.schemeDirty = true; renderAll(true); },
  'save-scheme': () => {
    S.schemeDirty = false;
    if (S.marked) S.outOfDate = true;
    renderAll(true);
    toast(S.marked ? 'Marking scheme saved. Marks are now out of date: recompute in step 7.' : 'Marking scheme saved.');
  },
  build: () => {
    toast('Building papers and detecting the layout…', 'refresh');
    setTimeout(() => { S.state = 'tocheck'; S.previewDoc = 'layout'; S.previewOpen = true; renderAll(true); toast('Papers built. Please check the layout.', 'page-search'); }, 900);
  },
  'layout-ok': () => { S.state = 'ready'; S.laidOutAt = new Date().toTimeString().slice(0, 5); renderAll(true); toast('Layout confirmed. You can print now.'); },
  'print-route': (el) => { if (el.dataset.k === 'printer' && !S.linux) { toast('Direct printing needs a Linux shared machine. Save PDFs instead.', 'info-circle'); return; } S.printRoute = el.dataset.k; renderMain(true); },
  'lock-print': () => { S.dialog = { type: 'lock-print' }; renderLayer(); },
  'mark-printed': () => { S.dialog = { type: 'mark-printed' }; renderLayer(); },
  'do-lock': () => { const was = S.dialog.type; S.dialog = null; S.state = 'printed'; renderAll(true); toast(was === 'mark-printed' ? 'Marked as printed. The exam is locked.' : 'Papers saved. The exam is locked.', 'lock'); },
  unlock: () => { S.dialog = { type: 'unlock' }; renderLayer(); },
  'do-unlock': () => { S.dialog = null; resetExam('draft'); renderAll(); toast('Exam unlocked. Scans and marks removed.', 'lock-slash'); },
  'dialog-close': () => { S.dialog = null; renderLayer(); },
  upload: () => {
    toast('Uploading 2 files and detecting pages…', 'cloud-upload');
    setTimeout(() => { S.state = 'scanned'; renderAll(true); toast('72 pages processed: 70 recognised, 2 unreadable.', 'page-search'); }, 1000);
  },
  unread: (el) => { const u = S.unreadable.find((x) => x.id === el.dataset.id); u.resolved = true; renderAll(true); toast(el.dataset.msg); },
  'review-go': (el) => { S.reviewAt = +el.dataset.i; renderMain(true); renderPreview(); },
  'review-next': () => reviewMove(1),
  decide: (el) => decide(el.dataset.v === '1'),
  'accept-rest': () => { S.boxes.forEach((b) => { b.resolved = true; }); renderAll(true); toast('Remaining boxes accepted as detected.'); },
  compute: () => computeMarks(),
  'mark-anyway': () => { S.dialog = { type: 'mark-anyway' }; renderLayer(); },
  'compute-anyway': () => { S.dialog = null; computeMarks(); },
  match: (el) => { S.unmatched.shift(); renderAll(true); toast(el.dataset.msg); },
  fmt: (el) => { S.exportFormat = el.dataset.k; renderMain(true); },
  export: () => { S.exported = true; S.previewDoc = 'csv'; S.previewOpen = true; renderAll(true); toast(`Saved marks-10B.${S.exportFormat}.`); },
  'annot-save': (el) => { S.annotSave = el.dataset.k; renderMain(true); },
  annotate: () => { toast('Annotating 32 sheets…', 'edit-pencil'); setTimeout(() => { S.annotated = true; S.previewDoc = 'annotated'; renderAll(true); toast('32 annotated sheets ready.'); }, 900); },
  brand: (el) => { applyBrand(el.dataset.c); renderAll(true); },
  'brand-reset': () => { S.logo = null; S.logoColors = []; store.set('logo', null); applyBrand('#3b5bdb'); renderAll(true); toast('Back to the neutral look.'); },
  'sample-logo': () => useLogo(SAMPLE_LOGO),
  'logo-remove': () => { S.logo = null; S.logoColors = []; store.set('logo', null); renderAll(true); },
};

function computeMarks() {
  toast('Computing marks…', 'clipboard-check');
  setTimeout(() => { S.marked = true; S.outOfDate = false; S.markedAt = new Date().toTimeString().slice(0, 5); renderAll(true); toast('Marks computed for 32 students.'); }, 700);
}
function reviewMove(step) {
  const n = S.boxes.length;
  for (let k = 1; k <= n; k += 1) {
    const i = (S.reviewAt + step * k + n) % n;
    if (!S.boxes[i].resolved) { S.reviewAt = i; break; }
  }
  renderAll(true);
}
function decide(ticked) {
  const b = currentBox();
  if (!b) return;
  b.resolved = true;
  toast(`Copy ${b.copy}, ${b.q} ${'ABCD'[b.ans]}: ${ticked ? 'ticked' : 'not ticked'}.`);
  if (boxesLeft()) reviewMove(1); else renderAll(true);
}
function settleScans() {
  S.state = 'scanned';
  S.unreadable.forEach((u) => { u.resolved = true; });
  S.boxes.forEach((b) => { b.resolved = true; });
}
function resetExam(state) {
  S.state = state;
  S.marked = false; S.outOfDate = false; S.exported = false; S.annotated = false; S.schemeDirty = false;
  S.unreadable = freshUnreadable(); S.boxes = freshBoxes(); S.unmatched = freshUnmatched(); S.reviewAt = 0;
}

/* ---------- Events ---------- */

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (S.menu && !e.target.closest('.menu') && !(el && el.dataset.act === 'menu')) { S.menu = false; renderTop(); }
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'dialog-close-bg') { if (e.target === el) ACTIONS['dialog-close'](); return; }
  if (act === 'dirty') return;
  if (ACTIONS[act]) { if (el.tagName === 'BUTTON' || el.tagName === 'A' && !el.getAttribute('href')) e.preventDefault(); ACTIONS[act](el); }
});
document.addEventListener('change', (e) => {
  if (e.target.matches('[data-act="dirty"]')) { S.schemeDirty = true; renderAll(true); }
  if (e.target.id === 'logo-file' && e.target.files[0]) {
    const r = new FileReader();
    r.onload = () => useLogo(r.result);
    r.readAsDataURL(e.target.files[0]);
  }
  if (e.target.id === 'brand-custom') { applyBrand(e.target.value); renderAll(true); }
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'unlock-name') $('#unlock-go').disabled = e.target.value.trim() !== EXAM.name;
  if (e.target.id === 'school-name') { S.school = e.target.value; store.set('school', S.school); renderTop(); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if (S.dialog) { S.dialog = null; renderLayer(); } else if (S.menu) { S.menu = false; renderTop(); } return; }
  if (S.dialog || e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (route.kind === 'exam' && route.step === 'check-scans' && scanned() && boxesLeft()) {
    if (e.key === 't' || e.key === 'T') decide(true);
    else if (e.key === 'n' || e.key === 'N') decide(false);
    else if (e.key === 'ArrowRight') reviewMove(1);
    else if (e.key === 'ArrowLeft') reviewMove(-1);
  }
});

/* Preview panel resizing */
document.addEventListener('pointerdown', (e) => {
  const handle = e.target.closest('.preview-resizer');
  if (!handle) return;
  e.preventDefault();
  handle.classList.add('is-dragging');
  handle.setPointerCapture(e.pointerId);
  const move = (ev) => {
    S.previewW = Math.max(320, Math.min(window.innerWidth * 0.7, window.innerWidth - ev.clientX));
    $('#app').style.setProperty('--preview-w', S.previewW + 'px');
    $('#preview').style.setProperty('--preview-w', S.previewW + 'px');
  };
  const up = () => { handle.classList.remove('is-dragging'); store.set('previewW', S.previewW); handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', up);
});

window.addEventListener('hashchange', () => {
  route = parseRoute();
  S.previewDoc = null; S.previewMax = false; S.menu = false;
  if (route.kind === 'new' && !S.previewOpen) S.previewOpen = true;
  renderAll();
  $('#main').focus({ preventScroll: true });
});

/* ---------- Prototype controls ---------- */

function protoPanel() {
  const d = document.createElement('details');
  d.className = 'proto';
  d.innerHTML = `<summary>${ic('settings')} Prototype controls</summary><div class="proto-body">
    <label>Exam state<select class="select" id="p-state">
      ${[['draft', 'Draft'], ['tocheck', 'Layout to check'], ['ready', 'Ready to print'], ['printed', 'Printed (no scans yet)'], ['scanned', 'Printed, scans uploaded']].map(([k, l]) => `<option value="${k}" ${S.state === k ? 'selected' : ''}>${l}</option>`).join('')}
    </select></label>
    <label class="switch"><input type="checkbox" id="p-linux" ${S.linux ? 'checked' : ''}> Shared machine runs Linux</label>
    <label class="switch"><input type="checkbox" id="p-marked" ${S.marked ? 'checked' : ''}> Marks computed</label>
    <button class="btn btn-sm" id="p-reset">Reset the demo</button>
    <span class="subtle">Made-up data. Not connected to AMC.</span></div>`;
  document.body.appendChild(d);
  d.addEventListener('change', (e) => {
    if (e.target.id === 'p-state') { resetExam(e.target.value); }
    if (e.target.id === 'p-linux') S.linux = e.target.checked;
    if (e.target.id === 'p-marked') { if (e.target.checked) settleScans(); S.marked = e.target.checked; S.outOfDate = false; }
    $('#p-state').value = S.state; $('#p-marked').checked = S.marked;
    renderAll(true);
  });
  $('#p-reset').addEventListener('click', () => { try { Object.keys(localStorage).filter((k) => k.startsWith('amc-proto:')).forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ } location.href = location.pathname + '#/exams'; location.reload(); });
}

/* ---------- Start ---------- */

applyTheme();
applyBrand(S.brand);
if (S.marked) settleScans();
if (S.logo) { const img = new Image(); img.onload = () => { S.logoColors = logoColors(img); renderAll(true); }; img.src = S.logo; }
protoPanel();
renderAll();
