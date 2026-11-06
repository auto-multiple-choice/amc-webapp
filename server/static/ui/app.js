/*
 * AMC new interface (doc/ui-redesign-plan.md).
 *
 * One page; every screen is drawn here. Actions use the server's existing
 * Socket.IO events (create-project-template, doc-update, ...), so AMC's
 * processing is unchanged. Data comes from /ui/api/* (server/ui.py).
 *
 * Icons used here must also appear in templates/ui_icons.html: upstream's
 * icon build only keeps icons it finds in templates.
 */
'use strict';

/* ---------- Helpers ---------- */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ic = (name, extra = '') => `<i class="iconoir-${name}${extra ? ' ' + extra : ''}" aria-hidden="true"></i>`;
const $ = (sel, el = document) => el.querySelector(sel);
const enc = encodeURIComponent;
const store = {
  get(k, d) {
    try { const v = localStorage.getItem('amc-ui:' + k); return v === null ? d : JSON.parse(v); }
    catch { return d; }
  },
  set(k, v) { try { localStorage.setItem('amc-ui:' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const APP = document.getElementById('app');
const USER = APP.dataset.user || '';
const VERSION = APP.dataset.version || '';

/* ---------- Steps ---------- */

const STEPS = [
  { id: 'questions', n: 1, label: 'Questions', group: 'before', phase: 1, built: true },
  { id: 'marking-scheme', n: 2, label: 'Marking scheme', group: 'before', phase: 2, built: true },
  { id: 'papers', n: 3, label: 'Papers', group: 'before', phase: 2, built: true },
  { id: 'print', n: 4, label: 'Print', group: 'before', phase: 2, built: true },
  { id: 'upload-scans', n: 5, label: 'Upload scans', group: 'after', phase: 3, built: true },
  { id: 'check-scans', n: 6, label: 'Check scans', group: 'after', phase: 3, built: true },
  { id: 'mark', n: 7, label: 'Mark', group: 'after', phase: 4, built: true },
  { id: 'match-students', n: 8, label: 'Match students', group: 'after', phase: 4, built: true },
  { id: 'export-marks', n: 9, label: 'Export marks', group: 'after', phase: 4, built: true },
  { id: 'annotate', n: 10, label: 'Annotate', group: 'after', phase: 4, built: true },
];
const GUIDES = {
  questions: ['Write each question with its answers, and mark which answers are correct.', 'Save, then build the preview to see the question paper on the right.', 'If the build fails, the message explains why and links to the LaTeX log.'],
  'marking-scheme': ['Choose how single- and multiple-answer questions are scored by default.', 'Set what the final mark is out of, and how it is rounded.', 'All of this can still change after printing.'],
  papers: ['Choose how many copies to print. Add a few spares.', 'Build the papers. The layout is detected automatically.', 'Check the layout in the preview, then confirm it looks correct. Printing opens after that.'],
  print: ['Save the PDFs and print them anywhere, or print directly when the shared machine runs Linux.', 'Print on A4 at 100% (actual size), never "fit to page".', 'The exam locks after printing: questions and layout can no longer change.'],
  'upload-scans': ['Scan the answer sheets at 300 dpi, in black and white or greyscale.', 'Upload the files (PDF or images). Each page is detected automatically.', 'Problems appear in the next step, Check scans.'],
  'check-scans': ['Unreadable pages: see what AMC saw, then remove them or scan them again.', 'Missing pages: find and upload them.', 'Pages to check: decide each box AMC wasn\'t sure about (T = ticked, N = not ticked, Enter = page done).', 'Marks come next, once everything is clear.'],
  mark: ['Compute the marks once Check scans is clear: no unreadable pages, missing pages or pages to check.', 'Marking always uses the latest marking scheme and answer key.', 'Answers that break a question\'s rules, such as two boxes ticked on a single-answer question, are listed afterwards with a link to the page.', 'Changed the marking scheme or a scan afterwards? The step shows "out of date": compute the marks again.'],
  'match-students': ['Load the class list: a CSV file with column names on the first line and one student per line.', 'Choose the column with the student code, then match automatically if the papers have code boxes.', 'Match the other sheets by hand: type part of the name written on the sheet, then press Enter.'],
  'export-marks': ['Check the marks and how they are spread.', 'Export to CSV (spreadsheets, school systems) or ODS (LibreOffice, with statistics).', 'Export again after changing marks or matches.'],
  annotate: ['Choose where marks appear on the sheets and the header text.', 'Choose how the files are saved, then preview one student to check.', 'Annotate all sheets and download them.'],
};
const DOC_LABELS = { sujet: 'Question paper', corrige: 'Answer key', catalog: 'Catalogue', 'indiv-solution': 'Corrected copies' };
const STATE_CHIPS = {
  draft: ['', 'edit-pencil', 'Draft'],
  tocheck: ['chip-warning', 'page-search', 'Layout to check'],
  ready: ['chip-brand', 'printer', 'Ready to print'],
  locked: ['chip-warning', 'lock', 'Printed · locked'],
  built: ['chip-brand', 'multiple-pages', 'Papers built'],
  printed: ['chip-warning', 'printer', 'Printed'],
  scanned: ['chip-warning', 'upload', 'Scans uploaded'],
  marked: ['chip-success', 'clipboard-check', 'Marked'],
  exported: ['chip-success', 'check-circle', 'Exported'],
};

/* ---------- State ---------- */

const S = {
  route: { kind: 'exams' },
  project: null,          // the exam the server has opened for this page
  opening: null,          // exam requested, waiting for "project-open"
  creating: null,         // exam being created, to open when it exists
  status: null,
  projects: null,
  templates: null,
  files: null,
  config: null,
  source: { name: null, mode: null, url: null, dirty: false, loaded: false },
  theme: store.get('theme', 'auto'),
  previewOpen: store.get('previewOpen', window.innerWidth >= 1280),
  previewMax: false,
  previewDoc: null,
  previewFile: null,
  previewW: store.get('previewW', 460),
  previewStamp: Date.now(),
  guide: store.get('guide', {}),
  menu: null,             // which menu is open: 'account' or an exam name
  online: false,
  work: null,             // {text, p} while the server runs a command
  workText: '',
  scoring: null,          // default scoring read from the source
  printers: null,
  printRoute: 'files',
  previewMode: null,      // 'layout' shows the layout check
  layoutPage: null,       // {page: 'copy/page', url}
  buildQueue: [],         // documents still to build after the current one
  buildError: false,
  printing: null,         // {how, copies} while a print job runs
  scans: null,            // pages, unreadable and missing pages (/ui/api/scans)
  review: null,           // the page being checked: boxes and decisions
  previewImage: null,     // {url, title}: a scan or diagnostic image
  previewList: null,      // {items: [{path, title}], i}: annotated sheets, with previous/next
  pendingReview: null,    // page to open when Check scans opens ('student/page/copy')
  marks: null,            // marks table and rule-breaking answers (/ui/api/marks)
  students: null,         // class list, sheets and matches (/ui/api/students)
  exportInfo: null,       // export settings and files (/ui/api/export)
  annotateInfo: null,     // annotation settings and files (/ui/api/annotate)
  matchSheet: null,       // the sheet being matched by hand ('student/copy')
  matchFilter: 'todo',    // sheets listed: 'todo' or 'all'
  matchQuery: '',
  matchCursor: 0,
  marksSort: { col: 'copy', dir: 1 },
  marksQuery: '',
  questions: null,        // questions with answer key and scoring (/ui/api/questions)
  scaleUpdating: false,   // AMC is reading the scale from the source
};
let editor = null;

const projectState = () => {
  const st = S.status;
  if (!st || !st.project) return null;
  if (st.exports.length) return 'exported';
  if (st.marked) return 'marked';
  if (st.scans) return 'scanned';
  if (st.lock) return 'locked';
  if (st.layout_ok) return 'ready';
  if (st.layout_pages) return 'tocheck';
  return 'draft';
};
const locked = () => !!(S.status && S.status.lock);

/* ---------- Server connection ---------- */

const socket = io();

/* Same shape as upstream's helper. Messages the server renders (dialogs)
   call it from inline handlers, so it must stay a global function. */
function socket_emit(msg, ...args) {
  const x = { fake_user: null, proj: S.project, sid: socket.id };
  if (args.length) x.args = args[0];
  socket.emit(msg, x);
}
/* Called by the OK buttons of dialogs rendered by the server. */
function warn_ok() { closeDialog(); }

function headers() {
  const h = { 'AMC-sid': socket.id || '' };
  if (S.project) h['AMC-project'] = S.project;
  return h;
}
async function getJSON(url) {
  const r = await fetch(url, { headers: headers(), cache: 'no-store' });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}
function upload(url, files, fields = {}, onProgress = null) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    files.forEach(([blob, name]) => form.append('file', blob, name));
    Object.entries(fields).forEach(([k, v]) => form.append(k, v));
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    Object.entries(headers()).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    if (onProgress) xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      let r = {};
      try { r = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status === 200 && r.ok) resolve(r); else reject(new Error(r.error || `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Upload failed: no connection'));
    xhr.send(form);
  });
}

socket.on('connect', () => {
  S.online = true;
  socket_emit('is-online', VERSION);
  renderTop();
  if (S.route.kind === 'exam' && S.project) openProject(S.project);
});
socket.on('disconnect', () => { S.online = false; renderTop(); });
socket.on('reload', () => location.reload());
socket.on('begin-command', () => { S.work = { text: S.workText || 'Working…', p: null }; renderWork(); });
socket.on('t', (text) => { S.workText = text; if (S.work) { S.work.text = text; renderWork(); } });
socket.on('p', (p) => { if (S.work) { S.work.p = p; renderWork(); } });
socket.on('end-command', () => {
  S.work = null; S.workText = ''; renderWork();
  S.previewStamp = Date.now();
  refreshStatus().then(() => {
    if (S.previewMode === 'layout' && !S.buildQueue.length && S.status && S.status.layout_pages) socket_emit('layout-init');
  });
  if (S.buildQueue.length) {
    // The server sends error messages just after "end-command".
    setTimeout(() => {
      if (S.buildError) { S.buildQueue = []; return; }
      socket_emit('doc-update', S.buildQueue.shift());
    }, 500);
  }
});
socket.on('dialog', (html) => {
  if (/msg-err/.test(html)) S.buildError = true;
  showServerDialog(html);
  if (S.route.step === 'marking-scheme') loadQuestions(); // a refused change: show what is really saved
});
socket.on('dialog-disconnect', (html) => { showServerDialog(html); socket.disconnect(); });
socket.on('u-projects-list', () => { if (S.route.kind === 'exams') loadProjects(); });
socket.on('menu', () => refreshStatus());
socket.on('project-open', (data) => onProjectOpen(data[0]));
socket.on('source-name', (data) => onSourceName(...data));
socket.on('source-saved', () => { S.source.dirty = false; renderEditorBar(); });
socket.on('project-files-list', () => loadFiles());
socket.on('ui-changed', (what) => {
  if (what === 'unlock') { toast('Exam unlocked. Rebuild the papers, then check the layout again.', 'lock-slash'); S.previewMode = null; }
  if (what === 'layout_ok') toast('Layout confirmed. You can print now.');
  if (what === 'lock') S.printing = null;
  if (what === 'review') { loadScans().then(() => { if (S.route.step === 'check-scans') openNextReview(); }); }
  if (['marks', 'students', 'matches', 'exports', 'annotated'].includes(what)) loadStepData();
  if (what === 'questions' && S.route.step === 'marking-scheme') loadQuestions();
  refreshStatus().then(() => { if (S.route.step === 'questions') renderMain(); });
});
socket.on('ui-toast', (text) => toast(text));
socket.on('ui-scale', (state) => {
  S.scaleUpdating = state === 'updating';
  if (S.route.step !== 'marking-scheme') return;
  if (state === 'done') loadQuestions(); else renderMain(true);
});
socket.on('ui-matched', (m) => {
  if (m.freed && m.freed.length) {
    const names = m.freed.map(([s, c]) => copyName(s, c)).join(', ');
    const many = m.freed.length > 1;
    toast(`${names} ${many ? 'were' : 'was'} matched to the same student, and ${many ? 'are' : 'is'} back in the sheets to match.`, 'info-circle');
  }
  loadStudents(); refreshStatus();
});
socket.on('ui-exported', (r) => {
  loadExport();
  if (!r.ok) return;
  if (/\.csv$/.test(r.file)) { showFile(`exports/${r.file}`, 'Exported marks (CSV)'); toast('Marks exported. The file is shown on the right.'); }
  else toast(`Marks exported to ${r.file}. Download it below.`);
});
socket.on('ui-annotate-preview', (r) => {
  if (!r.file) return;
  const sheet = S.marks && S.marks.rows.find((x) => x.student === r.student && x.copy === r.copy);
  showFile(r.file, `Preview · ${copyName(r.student, r.copy)}${sheet && sheet.name ? ' · ' + sheet.name : ''}`);
  if (S.route.step === 'annotate') loadAnnotate();
});
socket.on('ui-scoring-saved', (v) => {
  if (S.scoring) { S.scoring.S = v.S || null; S.scoring.M = v.M || null; }
  toast('Default scoring saved in the source.');
  if (S.route.step === 'marking-scheme') { renderMain(true); socket_emit('ui-scale-refresh'); }
});
socket.on('scans-report', () => { loadScans(); refreshStatus(); });
socket.on('failed-report', () => loadScans());
socket.on('tab-scans', () => loadScans());
socket.on('failed-pp-url', (url) => { S.previewImage = { url, title: 'What AMC saw on this page' }; S.previewMode = 'image'; openPreview(); });
socket.on('layout-set-page', (data) => {
  S.layoutPage = { page: data[0], url: `${data[1]}?v=${Date.now()}` };
  if (S.previewMode === 'layout') renderPreview();
});
socket.on('print-to-files', (url) => {
  const copies = S.printing ? S.printing.copies : '';
  S.printing = null;
  socket_emit('ui-printed', { how: 'files', copies });
  window.location.href = url;
});
socket.on('print-done', () => {
  if (S.printing && S.printing.how === 'printer') {
    socket_emit('ui-printed', { how: 'printer', copies: S.printing.copies });
    S.printing = null;
  }
});

/* Disconnect after 30 minutes without activity, like upstream. */
let idleTimer = null;
function resetIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (!$('#layer').innerHTML) socket_emit('inactivity'); }, 30 * 60 * 1000);
}
['mousemove', 'keydown', 'click'].forEach((e) => document.addEventListener(e, resetIdle, { passive: true }));
resetIdle();

/* ---------- Routing ---------- */

function parsePath(path) {
  const parts = path.split('/').filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
  if (parts[0] === 'exam' && parts[1]) {
    const step = STEPS.some((s) => s.id === parts[2]) || parts[2] === 'settings' ? parts[2] : null;
    return { kind: 'exam', name: parts[1], step };
  }
  return { kind: 'exams' };
}
const examPath = (name, step) => `/exam/${enc(name)}/${step}`;

async function navigate(path, { replace = false } = {}) {
  if (S.source.dirty && !(await confirmLeave())) return;
  history[replace ? 'replaceState' : 'pushState']({}, '', path);
  onRoute();
}
window.addEventListener('popstate', async () => {
  const leavingEditor = S.source.dirty && parsePath(location.pathname).step !== 'questions';
  if (leavingEditor) {
    const target = location.pathname;
    history.pushState({}, '', examPath(S.project, 'questions'));
    if (!(await confirmLeave())) return;
    S.source.dirty = false;
    history.pushState({}, '', target);
  }
  onRoute();
});
window.addEventListener('beforeunload', (e) => { if (S.source.dirty) { e.preventDefault(); e.returnValue = ''; } });

function onRoute() {
  const r = parsePath(location.pathname);
  const leavingQuestions = S.route.step === 'questions' && r.step !== 'questions';
  S.route = r; S.menu = null; S.previewDoc = null; S.previewFile = null; S.previewMax = false; S.previewMode = null;
  S.review = null; S.previewImage = null; S.previewList = null;
  if (leavingQuestions || r.kind !== 'exam' || r.name !== S.project) dropEditor();
  if (r.kind === 'exams') {
    S.project = null; S.status = null; S.files = null;
    document.title = 'Exams · AMC';
    render();
    loadProjects();
    return;
  }
  if (r.name !== S.project) {
    S.status = null; S.files = null; S.config = null; S.scans = null;
    S.marks = null; S.students = null; S.exportInfo = null; S.annotateInfo = null; S.matchSheet = null; S.questions = null;
    render();
    openProject(r.name);
    return;
  }
  if (!r.step) { navigate(examPath(r.name, suggestStep()), { replace: true }); return; }
  render();
  enterStep();
}

function openProject(name) {
  S.opening = name;
  // proj is left empty on purpose: the server upgrades the exam's
  // databases when it sees a different exam being opened.
  socket.emit('request-project', { fake_user: null, proj: '', sid: socket.id, args: [name, false] });
}

async function onProjectOpen(name) {
  if (S.creating && name === S.creating) {
    S.creating = null;
    S.project = name; S.opening = null;
    toast(`Exam "${name}" created.`);
    await navigate(examPath(name, 'questions'));
    refreshStatus();
    return;
  }
  if (!name) {
    if (S.route.kind === 'exam') { toast('That exam doesn\'t exist any more.', 'warning-triangle'); navigate('/exams', { replace: true }); }
    S.project = null;
    return;
  }
  if (S.route.kind === 'exam' && S.route.name !== name && S.opening !== name) {
    // Renamed while open: follow the new name.
    history.replaceState({}, '', examPath(name, S.route.step || 'questions'));
    S.route = parsePath(location.pathname);
  }
  S.project = name; S.opening = null;
  document.title = `${name} · AMC`;
  await refreshStatus();
  if (S.route.kind === 'exam' && !S.route.step) { navigate(examPath(name, suggestStep()), { replace: true }); return; }
  render();
  enterStep();
}

function suggestStep() {
  const st = S.status;
  if (!st || !st.project) return 'questions';
  if (st.exports.length) return 'export-marks';
  if (st.marked) return st.unmatched ? 'match-students' : 'export-marks';
  if (st.scans) return 'check-scans';
  if (st.printed) return 'upload-scans';
  if (st.layout_pages) return 'print';
  return 'questions';
}

function enterStep() {
  if (S.route.step === 'questions') { loadFiles(); if (!S.source.loaded) loadSource(''); }
  if (S.route.step === 'settings' || S.route.step === 'marking-scheme') loadConfig();
  if (S.route.step === 'marking-scheme') { loadScoring(); loadQuestions({ refresh: true }); }
  if (S.route.step === 'print') loadPrinters();
  if (S.route.step === 'upload-scans') loadScans();
  if (S.route.step === 'check-scans') {
    loadScans().then(() => {
      if (S.pendingReview) { const k = S.pendingReview; S.pendingReview = null; openReview(k); } else if (!S.review) openNextReview();
    });
  }
  loadStepData();
  if (S.route.step === 'papers' && S.status && S.status.layout_pages && !S.status.layout_ok && !locked()) showLayout();
}

/* ---------- Data ---------- */

let statusTimer = null;
function refreshStatus() {
  if (!S.project) return Promise.resolve();
  clearTimeout(statusTimer);
  return new Promise((resolve) => {
    statusTimer = setTimeout(async () => {
      if (!S.project) { resolve(); return; } // left the exam meanwhile
      try {
        const st = await getJSON('/ui/api/status');
        if (st.project === S.project) S.status = st;
      } catch (e) { console.error(e); }
      renderTop(); renderSide(); renderPreview();
      if (S.route.step && S.route.step !== 'questions') renderMain(true);
      resolve();
    }, 120);
  });
}
async function loadProjects() {
  try {
    const r = await getJSON('/ui/api/projects');
    S.projects = r.projects;
  } catch (e) { console.error(e); S.projects = S.projects || []; toast('Couldn\'t load the exams list.', 'warning-triangle'); }
  if (S.route.kind === 'exams') renderMain(true);
}
async function loadTemplates() {
  if (S.templates) return S.templates;
  try { S.templates = await getJSON('/ui/api/templates'); } catch { S.templates = { groups: [], templates: [] }; }
  return S.templates;
}
/* Answers for an exam the page has since left (renamed, closed) are dropped. */
async function loadFiles() {
  const p = S.project;
  if (!p) return;
  try { const f = await getJSON('/ui/api/files'); if (S.project === p && f.project === p) S.files = f; } catch (e) { if (S.project === p) console.error(e); }
  renderEditorBar();
}
async function loadConfig() {
  const p = S.project;
  try { const c = await getJSON('/ui/api/config'); if (S.project === p && c.project === p) S.config = c; } catch (e) { if (S.project === p) console.error(e); }
  if (S.route.step === 'settings' && S.project === p) renderMain(true);
}

async function loadScoring() {
  const p = S.project;
  try { const r = await getJSON('/ui/api/scoring'); if (S.project === p && r.project === p) S.scoring = r; } catch (e) { if (S.project === p) console.error(e); }
  if (S.route.step === 'marking-scheme' && S.project === p) renderMain(true);
}
async function loadScans() {
  const p = S.project;
  try { const r = await getJSON('/ui/api/scans'); if (S.project === p && r.project === p) S.scans = r; } catch (e) { if (S.project === p) console.error(e); }
  if (S.project === p && (S.route.step === 'upload-scans' || S.route.step === 'check-scans')) renderMain(true);
}
/* Data for the results steps; answers for an exam the page has left are dropped. */
async function loadInto(key, url, steps) {
  const p = S.project;
  if (!p) return;
  try { const r = await getJSON(url); if (S.project === p && r.project === p) S[key] = r; } catch (e) { if (S.project === p) console.error(e); }
  if (S.project === p && steps.includes(S.route.step)) renderMain(true);
}
const loadMarks = () => loadInto('marks', '/ui/api/marks', ['mark', 'export-marks', 'annotate']);
const loadStudents = () => loadInto('students', '/ui/api/students', ['match-students']);
const loadExport = () => loadInto('exportInfo', '/ui/api/export', ['export-marks']);
const loadAnnotate = () => loadInto('annotateInfo', '/ui/api/annotate', ['annotate']);
async function loadQuestions({ refresh = false } = {}) {
  await loadInto('questions', '/ui/api/questions', ['marking-scheme']);
  // The source changed since AMC last read it: read it again.
  const d = S.questions;
  if (refresh && d && !d.fresh && !d.updating && !S.scaleUpdating) socket_emit('ui-scale-refresh');
}
function loadStepData() {
  const step = S.route.step;
  if (step === 'mark') loadMarks();
  if (step === 'match-students') loadStudents();
  if (step === 'export-marks') { loadMarks(); loadExport(); }
  if (step === 'annotate') { loadMarks(); loadAnnotate(); }
}

async function loadPrinters() {
  try { S.printers = await getJSON('/ui/api/printers'); } catch { S.printers = { available: false, printers: [] }; }
  if (!S.printers.available) S.printRoute = 'files';
  if (S.route.step === 'print') renderMain(true);
}

/* ---------- Step status from the real exam ---------- */

function stepStatus(id) {
  const st = S.status;
  const r = (cls, count = null, title = '') => ({ cls, count, title });
  if (!st || !st.project) return r('');
  const problems = (st.failed || 0) + (st.incomplete || 0) + (st.to_check || 0);
  switch (id) {
    case 'questions': return st.lock ? r('is-locked') : st.docs.sujet ? r('is-done') : r('');
    case 'papers': return st.lock ? r('is-locked') : st.layout_ok ? r('is-done') : st.layout_pages ? r('is-attention') : r('');
    case 'print': return st.lock ? r('is-done') : st.layout_ok ? r('is-attention') : r('is-blocked');
    case 'upload-scans': return st.scans ? r('is-done') : st.lock ? r('is-attention') : r('');
    case 'check-scans': return !st.scans ? r('') : problems ? r('is-attention', problems) : r('is-done');
    case 'mark': return !st.marked ? r('') : st.marks_info && st.marks_info.stale ? r('is-attention', null, 'Out of date') : r('is-done');
    case 'match-students': return !st.marked ? r('') : st.unmatched ? r('is-attention', st.unmatched, `${st.unmatched} to match`) : r('is-done');
    case 'export-marks': return !st.exports.length ? r('') : st.exports_stale ? r('is-attention', null, 'Out of date') : r('is-done');
    case 'annotate': return !(st.annotated || st.annotated_single) ? r('') : st.annotated_stale ? r('is-attention', null, 'Out of date') : r('is-done');
    default: return r('');
  }
}

/* ---------- Rendering: shell ---------- */

function render() {
  renderTop();
  renderSide();
  renderMain();
  renderPreview();
}

function stateChip(state) {
  if (state === 'locked' && S.status && S.status.lock && S.status.lock.since) {
    return `<span class="chip chip-warning" title="Questions and layout are locked">${ic('lock')} Printed ${fmtDate(S.status.lock.since)} · locked</span>`;
  }
  const c = STATE_CHIPS[state];
  return c ? `<span class="chip ${c[0]}">${ic(c[1])} ${c[2]}</span>` : '';
}

function renderTop() {
  const r = S.route;
  const themeIcon = { auto: 'half-moon', light: 'sun-light', dark: 'half-moon' }[S.theme];
  const crumbs = ['<a href="/exams" data-nav>Exams</a>'];
  if (r.kind === 'exam') crumbs.push(`<span class="current">${esc(r.name)}</span>`);
  const hasPreview = r.kind === 'exam';
  $('#topbar').innerHTML = `
    <a class="brandmark" href="/exams" data-nav><span class="brandmark-logo">AMC</span><span class="brandmark-name">AMC</span></a>
    <nav class="crumbs" aria-label="Breadcrumb"><span class="sep">/</span>${crumbs.join('<span class="sep">/</span>')}</nav>
    ${r.kind === 'exam' ? stateChip(projectState()) : ''}
    ${S.online ? '' : `<span class="chip chip-danger" title="The connection to the server was lost. It reconnects by itself.">${ic('cloud-xmark')} Offline</span>`}
    <span class="topbar-spacer"></span>
    <div class="topbar-actions">
      ${hasPreview ? `<button class="btn btn-ghost btn-icon" data-act="toggle-preview" aria-pressed="${S.previewOpen}" title="Show or hide the preview panel" aria-label="Preview panel">${ic(S.previewOpen ? 'sidebar-collapse' : 'sidebar-expand')}</button>` : ''}
      <button class="btn btn-ghost btn-icon" data-act="theme" title="Theme: ${S.theme === 'auto' ? 'same as the computer' : S.theme}" aria-label="Change theme">${ic(themeIcon)}</button>
      ${USER ? `<div style="position:relative">
        <button class="btn btn-ghost" data-act="menu" data-menu="account" aria-haspopup="menu" aria-expanded="${S.menu === 'account'}" style="padding:0 6px 0 4px">
          <span class="avatar">${esc(USER[0].toUpperCase())}</span><span>${esc(USER)}</span>${ic('nav-arrow-down')}</button>
        ${S.menu === 'account' ? `<div class="menu" role="menu">
          <div class="menu-label">Signed in as ${esc(USER)}</div>
          <a class="menu-item" role="menuitem" href="/auth/account">${ic('user-circle')} Account, password and sign out</a></div>` : ''}
      </div>` : ''}
    </div>`;
}

function renderSide() {
  const show = S.route.kind === 'exam';
  APP.classList.toggle('no-sidebar', !show);
  if (!show) { $('#sidebar').innerHTML = ''; return; }
  const name = S.route.name;
  const group = (g, title) => `<div class="steps-group"><div class="steps-title">${title}</div>
    ${STEPS.filter((s) => s.group === g).map((s) => {
    const st = stepStatus(s.id);
    const dot = st.cls === 'is-done' ? ic('check') : st.cls === 'is-locked' ? ic('lock') : s.n;
    const cur = S.route.step === s.id;
    return `<a class="step ${st.cls}" href="${examPath(name, s.id)}" data-nav ${cur ? 'aria-current="page"' : ''} ${st.title ? `title="${esc(st.title)}"` : ''}>
      <span class="step-dot">${dot}</span><span class="step-label">${s.label}</span>${st.count !== null ? `<span class="step-count">${st.count}</span>` : ''}</a>`;
  }).join('')}</div>`;
  $('#sidebar').innerHTML = group('before', 'Before the exam') + group('after', 'After the exam')
    + `<div class="sidebar-foot"><a class="side-link" href="${examPath(name, 'settings')}" data-nav ${S.route.step === 'settings' ? 'aria-current="page"' : ''}>${ic('settings')} Exam settings</a></div>`;
}

function renderMain(keepScroll = false) {
  const main = $('#main');
  const top = main.scrollTop;
  const r = S.route;
  let html;
  if (r.kind === 'exams') html = viewExams();
  else if (!S.project || !r.step) html = `<div class="page"><div class="skeleton" style="height:40px;width:40%;margin-bottom:16px"></div><div class="skeleton"></div></div>`;
  else if (r.step === 'questions') html = viewQuestions();
  else if (r.step === 'marking-scheme') html = viewMarking();
  else if (r.step === 'papers') html = viewPapers();
  else if (r.step === 'print') html = viewPrint();
  else if (r.step === 'upload-scans') html = viewUpload();
  else if (r.step === 'check-scans') html = viewCheck();
  else if (r.step === 'mark') html = viewMark();
  else if (r.step === 'match-students') html = viewMatch();
  else if (r.step === 'export-marks') html = viewExport();
  else if (r.step === 'annotate') html = viewAnnotate();
  else html = viewSettings();
  main.classList.toggle('fill', r.kind === 'exam' && r.step === 'questions');
  if (r.step === 'questions' && editor && $('#ace-host')) { // keep the live editor
    editor.setReadOnly(locked());
    $('#q-head').innerHTML = questionsHead();
    renderEditorBar();
    resizeEditor();
    return;
  }
  // Keep what's being typed in the focused field across the redraw.
  const active = document.activeElement;
  const typing = active && active.id && main.contains(active) && /^(INPUT|TEXTAREA)$/.test(active.tagName)
    ? { id: active.id, value: active.value, start: active.selectionStart, end: active.selectionEnd } : null;
  main.innerHTML = html;
  if (typing) {
    const el = document.getElementById(typing.id);
    if (el) { el.value = typing.value; el.focus(); try { el.setSelectionRange(typing.start, typing.end); } catch { /* not a text field */ } }
  }
  if (keepScroll) main.scrollTop = top;
  if (r.step === 'questions' && S.project) mountEditor();
  if (r.step === 'match-students' && S.matchFocus) { S.matchFocus = false; const f = $('#match-search'); if (f) f.focus(); }
}

/* ---------- Rendering: preview panel ---------- */

function previewDocs() {
  if (S.route.kind !== 'exam' || !S.status || !S.status.project) return [];
  return Object.keys(DOC_LABELS).filter((d) => S.status.docs[d]);
}
const fsUrl = (path, attach = false) => `/fs/${enc(S.project)}/${path.split('/').map(enc).join('/')}?attach=${attach ? 1 : 0}`;

function renderPreview() {
  const exam = S.route.kind === 'exam';
  const open = exam && S.previewOpen;
  APP.classList.toggle('preview-closed', !open);
  APP.classList.toggle('preview-max', open && S.previewMax);
  APP.style.setProperty('--preview-w', S.previewW + 'px');
  const p = $('#preview');
  if (!open) { p.innerHTML = ''; return; }
  const docs = previewDocs();
  let title; let body; let bodyClass = 'preview-body'; let url = null; let tabs = '';
  if (S.previewMode === 'image' && S.previewImage) {
    title = S.previewImage.title;
    url = S.previewImage.url;
    body = `<img class="preview-img" src="${esc(url)}" alt="${esc(title)}">`;
  } else if (S.previewMode === 'page' && S.review) {
    const rv = S.review;
    title = `Copy ${rv.copy ? rv.student + '·' + rv.copy : rv.student}, page ${rv.page}`;
    body = rv.svg ? `<p class="subtle" style="margin:0 0 8px">Click a box to change it. Green: counted as ticked.</p><div class="page-svg" id="page-svg">${rv.svg}</div>` : '<div class="preview-empty">Loading the scanned page…</div>';
  } else if (S.previewMode === 'layout' && S.status && S.status.layout_pages) {
    const lp = S.layoutPage;
    const [copy, page] = lp ? lp.page.split('/') : ['', ''];
    title = lp ? `Layout · copy ${copy}, page ${page}` : 'Layout';
    body = lp ? `<div class="layout-legend"><span><i class="sw" style="border-color:#21fff2"></i>Corner marks</span><span><i class="sw" style="border-color:#00e462"></i>Answer boxes</span><span><i class="sw" style="border-color:#ff7c00"></i>Other boxes</span><span><i class="sw" style="border-color:#eb0cf9"></i>Name field</span></div>
      <object class="layout-svg" type="image/svg+xml" data="${lp.url}" aria-label="${esc(title)}"></object>` : '<div class="preview-empty">Loading the layout…</div>';
    bodyClass = 'preview-body';
    tabs = `<div class="preview-tabs"><button data-act="layout-step" data-delta="-1">${ic('nav-arrow-left')} Previous page</button><button data-act="layout-step" data-delta="1">Next page ${ic('nav-arrow-right')}</button><span class="spacer"></span><button data-act="preview-docs">Documents</button></div>`;
  } else if (S.previewFile) {
    const f = S.previewFile;
    title = f.title || f.name;
    url = fsUrl(f.name);
    ({ body, bodyClass } = fileBody(f.name, f.stamp ? `${url}&v=${f.stamp}` : url));
    const pl = S.previewList;
    if (pl && pl.items[pl.i] && pl.items[pl.i].path === f.name && pl.items.length > 1) {
      tabs = `<div class="preview-tabs"><button data-act="plist-step" data-delta="-1" ${pl.i ? '' : 'disabled'}>${ic('nav-arrow-left')} Previous</button>
        <label class="sr-only" for="plist-select">Sheet</label><select class="select input-sm" id="plist-select">${pl.items.map((x, i) => `<option value="${i}" ${i === pl.i ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}</select>
        <button data-act="plist-step" data-delta="1" ${pl.i < pl.items.length - 1 ? '' : 'disabled'}>Next ${ic('nav-arrow-right')}</button></div>`;
    }
  } else if (docs.length) {
    const cur = docs.includes(S.previewDoc) ? S.previewDoc : docs[0];
    title = DOC_LABELS[cur];
    url = fsUrl(`DOC-${cur}.pdf`);
    body = `<iframe class="pdf-frame" src="${url}&v=${S.previewStamp}#view=FitH" title="${esc(title)}"></iframe>`;
    bodyClass = 'preview-body frame';
    if (docs.length > 1) tabs = `<div class="preview-tabs" role="tablist">${docs.map((d) => `<button role="tab" aria-selected="${d === cur}" data-act="show-doc" data-doc="${d}">${DOC_LABELS[d]}</button>`).join('')}</div>`;
  } else {
    title = 'Preview';
    body = `<div class="preview-empty"><div class="empty-icon" style="margin:0 auto 12px">${ic('page')}</div><p><b>Nothing to show yet.</b></p><p class="subtle">Build the preview in Questions to see the question paper here.</p></div>`;
  }
  p.innerHTML = `<div class="preview-resizer" role="separator" aria-orientation="vertical" aria-label="Resize the preview panel"></div>
    <div class="preview-header"><span class="preview-title" title="${esc(title)}">${esc(title)}</span>
      ${S.previewFile ? `<button class="btn btn-ghost btn-sm" data-act="preview-docs">${ic('nav-arrow-left')} Documents</button>` : ''}
      ${url ? `<a class="btn btn-ghost btn-icon btn-sm" href="${url}" target="_blank" rel="noopener" title="Open in a new tab" aria-label="Open in a new tab">${ic('open-new-window')}</a>
      <a class="btn btn-ghost btn-icon btn-sm" href="${url.replace('attach=0', 'attach=1')}" title="Download" aria-label="Download">${ic('download')}</a>` : ''}
      <button class="btn btn-ghost btn-icon btn-sm" data-act="preview-max" title="${S.previewMax ? 'Restore' : 'Maximise'}" aria-label="${S.previewMax ? 'Restore' : 'Maximise'}">${ic(S.previewMax ? 'collapse' : 'expand')}</button>
      <button class="btn btn-ghost btn-icon btn-sm" data-act="toggle-preview" title="Close" aria-label="Close the preview">${ic('xmark')}</button></div>
    ${tabs}<div class="${bodyClass}" id="preview-body">${body}</div>`;
  if (S.previewFile && /\.(csv|txt|tex|log|yml|yaml)$/i.test(S.previewFile.name)) fillTextPreview(S.previewFile.name, url);
  if (S.previewMode === 'page' && S.review && S.review.svg) paintPageBoxes();
}

function fileBody(name, url) {
  if (/\.pdf$/i.test(name)) return { body: `<iframe class="pdf-frame" src="${url}#view=FitH" title="${esc(name)}"></iframe>`, bodyClass: 'preview-body frame' };
  if (/\.(png|jpe?g|gif|svg|webp)$/i.test(name)) return { body: `<img class="preview-img" src="${url}" alt="${esc(name)}">`, bodyClass: 'preview-body' };
  if (/\.(csv|txt|tex|log|yml|yaml)$/i.test(name)) return { body: '<div class="preview-empty">Loading…</div>', bodyClass: 'preview-body plain' };
  return { body: `<div class="preview-empty"><p>This kind of file can't be shown here.</p><p><a class="btn" href="${url.replace('attach=0', 'attach=1')}">${ic('download')} Download it</a></p></div>`, bodyClass: 'preview-body plain' };
}

async function fillTextPreview(name, url) {
  try {
    const r = await fetch(url, { headers: headers() });
    const text = await r.text();
    const host = $('#preview-body');
    if (!host || !S.previewFile || S.previewFile.name !== name) return;
    host.innerHTML = /\.csv$/i.test(name) ? csvTable(text) : `<pre class="preview-text">${esc(text)}</pre>`;
  } catch { const host = $('#preview-body'); if (host) host.innerHTML = '<div class="preview-empty">Couldn\'t load the file.</div>'; }
}

/* Small CSV reader: quoted fields, commas, semicolons or tabs. */
function parseCSV(text) {
  const first = text.split('\n', 1)[0];
  const sep = [';', '\t', ','].reduce((a, s) => (first.split(s).length > first.split(a).length ? s : a), ',');
  const rows = []; let row = []; let field = ''; let q = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 1; } else if (c === '"') q = false; else field += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i += 1; row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((rr) => rr.some((f) => f !== ''));
}
function csvTable(text) {
  const rows = parseCSV(text);
  if (!rows.length) return '<div class="preview-empty">The file is empty.</div>';
  const [head, ...body] = rows;
  const shown = body.slice(0, 1000);
  return `<table class="table"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${shown.map((r) => `<tr>${head.map((_, i) => `<td>${esc(r[i] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table>
    ${body.length > shown.length ? `<p class="subtle" style="padding:10px 12px">First ${shown.length} of ${body.length} rows.</p>` : ''}`;
}

/* ---------- Shared page pieces ---------- */

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
    <div class="guide-body"><ul>${(GUIDES[step] || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div></section>`;
}
function banner(kind, iconName, title, text, buttons = '') {
  return `<div class="banner banner-${kind}" role="note">${ic(iconName)}<div class="banner-body">
    <div class="banner-title">${title}</div>${text ? `<div class="muted">${text}</div>` : ''}${buttons ? `<div class="btn-row">${buttons}</div>` : ''}</div></div>`;
}
const stat = (value, label, kind = '') => `<div class="stat ${kind}"><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>`;
const fmtDate = (t) => (t ? new Date(t * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

/* ---------- View: exams ---------- */

function viewExams() {
  const list = S.projects;
  let body;
  if (list === null) body = `<div class="grid grid-3">${'<div class="skeleton"></div>'.repeat(3)}</div>`;
  else if (!list.length) {
    body = `<div class="card"><div class="empty"><div class="empty-icon">${ic('multiple-pages')}</div><h2>No exams yet</h2>
      <p>Create your first exam from a template, or start from an empty file.</p>
      <div class="btn-row"><button class="btn btn-primary" data-act="new-exam">${ic('plus')} New exam</button></div></div></div>`;
  } else {
    body = `<div class="grid grid-3">${list.map((p) => `<article class="card exam-card">
      <div class="row-between"><h3><a href="/exam/${enc(p.name)}" data-nav>${esc(p.name)}</a></h3>${stateChip(p.state)}</div>
      <div class="subtle">${p.modified ? 'Changed ' + fmtDate(p.modified) : ''}</div>
      <div class="row-between"><a class="btn btn-sm" href="/exam/${enc(p.name)}" data-nav>Open ${ic('arrow-right')}</a>
        <div class="card-menu"><button class="btn btn-ghost btn-icon btn-sm" data-act="menu" data-menu="${esc(p.name)}" aria-haspopup="menu" aria-expanded="${S.menu === p.name}" aria-label="More actions for ${esc(p.name)}">${ic('more-horiz')}</button>
        ${S.menu === p.name ? `<div class="menu" role="menu">
          <button class="menu-item" role="menuitem" data-act="rename-exam" data-name="${esc(p.name)}">${ic('edit-pencil')} Rename</button>
          <button class="menu-item" role="menuitem" data-act="clone-exam" data-name="${esc(p.name)}">${ic('copy')} Duplicate</button>
          <a class="menu-item" role="menuitem" href="/fs/${enc(p.name)}">${ic('download')} Download as zip</a>
          <div class="menu-sep"></div>
          <button class="menu-item" role="menuitem" data-act="delete-exam" data-name="${esc(p.name)}" style="color:var(--danger)">${ic('trash')} Delete</button></div>` : ''}</div>
      </div></article>`).join('')}</div>`;
  }
  return `<div class="page">
    ${header('', 'Exams', 'Your exams and where each one stands.', list && list.length ? `<button class="btn btn-primary" data-act="new-exam">${ic('plus')} New exam</button>` : '')}
    ${body}</div>`;
}

/* ---------- View: questions ---------- */

function viewQuestions() {
  return `<div class="page wide">
    <div id="q-head">${questionsHead()}</div>
    <div class="editor-bar" id="editor-bar"></div>
    <div class="editor-frame grow" id="editor-frame"><div id="ace-host"></div></div>
  </div>`;
}

/* The header part of Questions, redrawn on its own so the editor stays. */
function questionsHead() {
  const L = locked();
  return `
    ${header('questions', 'Questions', L ? 'The exam is printed, so the questions are read-only.' : 'Write the questions and answers. Save, then build the preview to see the question paper.',
    L ? `<a class="btn btn-primary" href="${examPath(S.project, 'marking-scheme')}" data-nav>${ic('percentage-circle')} Correct the answer key</a>`
      : `<button class="btn" data-act="build" ${S.source.loaded ? '' : 'disabled'}>${ic('refresh')} Build preview</button>
     <button class="btn btn-primary" data-act="save" id="save-btn" disabled>${ic('floppy-disk')} Save</button>`)}
    ${guideBox('questions')}
    ${L ? lockBanner('Correct the answer key and change scoring in <b>Marking scheme</b>: those changes are still allowed, because nothing moves on the printed papers.') : ''}`;
}

function renderEditorBar() {
  const bar = $('#editor-bar');
  if (!bar) return;
  const f = S.files;
  const cur = S.source.name;
  const editable = f ? f.files.filter((x) => x.level <= 0) : [];
  const others = f ? f.files.filter((x) => x.level === 1) : [];
  bar.innerHTML = `
    <label class="sr-only" for="file-select">File</label>
    <select class="select" id="file-select" ${f ? '' : 'disabled'}>
      ${editable.map((x) => `<option value="${esc(x.name)}" ${x.name === cur ? 'selected' : ''}>${esc(x.name)}${x.level === -1 ? ' (main)' : ''}</option>`).join('')}
      ${cur && !editable.some((x) => x.name === cur) ? `<option selected>${esc(cur)}</option>` : ''}
    </select>
    ${S.source.dirty ? '<span class="row" style="gap:6px"><span class="dirty-dot"></span><span class="subtle">Unsaved changes</span></span>' : (S.source.loaded ? '<span class="subtle">Saved</span>' : '<span class="subtle">Loading…</span>')}
    <span class="spacer"></span>
    ${S.source.dirty ? `<button class="btn btn-ghost btn-sm" data-act="revert">${ic('undo')} Revert</button>` : ''}
    <label class="btn btn-sm">${ic('upload')} Add a file<input type="file" id="add-file" hidden></label>
    ${others.length ? `<select class="select input-sm" id="other-file" style="min-width:160px" aria-label="Other project files"><option value="">Other files…</option>${others.map((x) => `<option>${esc(x.name)}</option>`).join('')}</select>` : ''}`;
  const save = $('#save-btn');
  if (save) save.disabled = !S.source.dirty;
}

function mountEditor() {
  renderEditorBar();
  if (editor || typeof ace === 'undefined') return;
  editor = ace.edit('ace-host');
  editor.setTheme('ace/theme/textmate');
  editor.setShowPrintMargin(false);
  editor.session.setUseWrapMode(true);
  editor.setReadOnly(locked());
  editor.commands.addCommand({ name: 'save', bindKey: { win: 'Ctrl-S', mac: 'Command-S' }, exec: () => saveSource() });
  editor.session.on('change', () => {
    if (S.source.loading) return;
    if (!S.source.dirty) { S.source.dirty = true; renderEditorBar(); }
  });
  if (S.source.text !== undefined) setEditorText(S.source.text);
}
function dropEditor() {
  if (editor) { editor.destroy(); editor = null; }
  S.source = { name: null, mode: null, url: null, dirty: false, loaded: false };
}
function setEditorText(text) {
  if (!editor) return;
  S.source.loading = true;
  editor.session.setMode('ace/mode/' + (S.source.mode || 'plain_text'));
  editor.setValue(text, -1);
  editor.session.getUndoManager().reset();
  S.source.loading = false;
  S.source.dirty = false;
  renderEditorBar();
}

function loadSource(filename) { socket_emit('source-code', filename); }
async function onSourceName(name, mode, url) {
  S.source.name = name; S.source.mode = mode; S.source.url = url;
  try {
    const r = await fetch(url, { headers: headers(), cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    S.source.text = await r.text();
  } catch { S.source.text = ''; toast(`Couldn't open ${name}.`, 'warning-triangle'); }
  S.source.loaded = true;
  if (S.route.step === 'questions') {
    if (!editor) renderMain();
    setEditorText(S.source.text);
    const b = $('[data-act="build"]'); if (b) b.disabled = false;
  }
}

async function saveSource() {
  if (!editor || !S.source.name) return false;
  if (locked()) { toast('The exam is printed: correct the answer key in Marking scheme.', 'lock'); return false; }
  try {
    await upload('/upload/source', [[new Blob([editor.getValue()], { type: 'text/plain' }), S.source.name]]);
    S.source.text = editor.getValue();
    S.source.dirty = false;
    renderEditorBar();
    toast(`${S.source.name} saved.`);
    return true;
  } catch (e) {
    openDialog(`<div class="dialog-head"><span class="dialog-icon danger">${ic('warning-triangle')}</span><div><h2 id="dlg-title">Not saved</h2></div></div>
      <div class="dialog-body"><p>${esc(e.message)}</p></div><div class="dialog-foot"><button class="btn btn-primary" data-act="dialog-ok">OK</button></div>`);
    return false;
  }
}

async function buildPreview() {
  if (S.source.dirty && !(await saveSource())) return;
  const st = S.status || {};
  if (st.printed || st.scans) {
    const ok = await confirmDialog({
      danger: true, icon: 'warning-triangle', title: 'Rebuild the question paper?',
      body: `<p>${st.scans ? 'Scans have been uploaded for this exam.' : 'This exam has been printed.'} Rebuilding removes the layout data, so the printed papers will no longer match${st.scans ? ', and the scans and marks are removed' : ''}.</p>`,
      ok: 'Rebuild anyway',
    });
    if (!ok) return;
  }
  S.previewDoc = 'sujet'; S.previewFile = null;
  if (!S.previewOpen) { S.previewOpen = true; store.set('previewOpen', true); }
  socket_emit('doc-update', 'sujet');
}

/* ---------- View: settings ---------- */

function viewSettings() {
  const c = S.config;
  const o = c ? c.options : {};
  const engine = o.moteur_latex_b || '';
  const engineField = c && c.engines
    ? `<select class="select" id="cfg-engine" ${locked() ? 'disabled' : ''}>${(c.engines.includes(engine) || !engine ? c.engines : [engine, ...c.engines]).map((e) => `<option ${e === engine ? 'selected' : ''}>${esc(e)}</option>`).join('')}</select>`
    : `<input class="input" id="cfg-engine" value="${esc(engine)}" placeholder="pdflatex" ${locked() ? 'disabled' : ''}>`;
  return `<div class="page">
    ${header('', 'Exam settings', 'Settings that belong to this exam.')}
    <section class="card"><div class="card-header"><h2>Exam</h2></div><div class="card-body">
      <div class="form-grid">
        <label class="field"><span class="field-label">Name</span><span class="input-group"><input class="input" id="cfg-name" value="${esc(S.project)}"><button class="btn" data-act="rename-current">Rename</button></span></label>
        <label class="field"><span class="field-label">LaTeX engine</span>${c ? engineField : '<input class="input" disabled>'}
          <span class="field-hint">Used to build the papers. pdflatex suits most exams.</span></label>
      </div></div></section>
    <section class="card"><div class="card-header"><h2>Copy or remove</h2></div><div class="list">
      <div class="list-row"><span class="list-icon">${ic('copy')}</span><div class="list-row-main"><div class="list-row-title">Duplicate</div><div class="subtle">A full copy of this exam, including any scans and marks.</div></div><button class="btn btn-sm" data-act="clone-exam" data-name="${esc(S.project)}">Duplicate</button></div>
      <div class="list-row"><span class="list-icon">${ic('download')}</span><div class="list-row-main"><div class="list-row-title">Download</div><div class="subtle">Everything in this exam as a zip file.</div></div><a class="btn btn-sm" href="/fs/${enc(S.project)}">Download</a></div>
      <div class="list-row"><span class="list-icon bad">${ic('trash')}</span><div class="list-row-main"><div class="list-row-title">Delete</div><div class="subtle">Removes the exam with its scans and marks. This can't be undone.</div></div><button class="btn btn-sm btn-danger" data-act="delete-exam" data-name="${esc(S.project)}">Delete</button></div>
    </div></section>
    ${activityCard()}
  </div>`;
}

/* ---------- Lock pieces (shared by the "before the exam" steps) ---------- */

function lockBanner(text) {
  const l = (S.status && S.status.lock) || {};
  const when = l.since ? ` on ${fmtDate(l.since)}` : '';
  const who = l.by ? ` by ${esc(l.by)}` : '';
  const how = { manual: 'Marked as printed', scanned: 'Scans were uploaded', printer: 'Printed', files: 'Saved for printing' }[l.how] || 'Printed';
  return banner('lock', 'lock', `${how}${when}${who}. Questions and layout are locked.`, text,
    `<button class="btn btn-sm" data-act="unlock">${ic('lock-slash')} Unlock…</button>`);
}

function activityCard() {
  const items = (S.status && S.status.activity) || [];
  if (!items.length) return '';
  return `<section class="card"><div class="card-header"><h2>History</h2></div><div class="list">
    ${items.slice(0, 12).map((a) => `<div class="list-row"><span class="list-icon">${ic('clock')}</span><div class="list-row-main"><div>${esc(a.what)}</div>
      <div class="subtle">${new Date(a.at * 1000).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${a.by ? ' · ' + esc(a.by) : ''}</div></div></div>`).join('')}
  </div></section>`;
}

async function unlockExam() {
  const st = S.status || {};
  const lost = [];
  if (st.scans) lost.push(`<li><b>${st.scans} scanned pages</b> and any corrections to them</li>`);
  if (st.matched) lost.push(`<li><b>${st.matched} matches</b> between sheets and students</li>`);
  if (st.marked) lost.push(`<li><b>Marks</b> for ${st.marked} copies</li>`);
  lost.push('<li>The <b>layout</b>: you rebuild the papers and check the layout again</li>');
  const data = await formDialog({
    title: 'Unlock to edit questions?', ok: 'Unlock and remove', icon: 'lock-slash',
    body: `<p>Papers already printed will no longer match the exam. Unlocking removes:</p><ul>${lost.join('')}</ul>
      <label class="field"><span class="field-label">Type the exam's name to confirm: <b>${esc(S.project)}</b></span><input class="input" name="name" autocomplete="off"></label>`,
    validate: (d) => ((d.name || '').trim() === S.project ? '' : 'The name doesn\'t match.'),
  });
  if (data) socket_emit('ui-unlock', { name: data.name.trim() });
}

/* ---------- View: marking scheme ---------- */

const PRESETS_S = [['', 'AMC default: 1 point, nothing for a wrong answer'], ['b=1,m=-0.25', '1 point, −0.25 for a wrong answer'], ['b=1,m=-0.5', '1 point, −0.5 for a wrong answer'], ['b=1,m=-1', '1 point, −1 for a wrong answer']];
const PRESETS_M = [['', 'AMC default: 1 point per box ticked or left correctly'], ['mz=1', 'All or nothing: 1 point'], ['haut=2', '2 points, −1 per mistake, never below 0'], ['haut=3', '3 points, −1 per mistake, never below 0']];

function scoringField(kind, presets, label) {
  const v = S.scoring ? (S.scoring[kind] || '') : '';
  const known = presets.some(([x]) => x === v);
  return `<label class="field"><span class="field-label">${label}</span>
    <select class="select" id="score-${kind}-preset">${presets.map(([x, l]) => `<option value="${esc(x)}" ${x === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}
      <option value="custom" ${known ? '' : 'selected'}>Custom AMC rule…</option></select></label>
    <label class="field ${known ? 'hidden' : ''}" id="score-${kind}-custom-field"><span class="field-label">AMC scoring rule</span>
      <input class="input mono" id="score-${kind}-custom" value="${esc(known ? '' : v)}" placeholder="b=1,m=-0.5">
      <span class="field-hint">AMC's syntax, for example <code>b=2,m=-1</code> or <code>haut=4</code>.</span></label>`;
}

function viewMarking() {
  const c = S.config;
  const o = c ? c.options : {};
  const sc = S.scoring;
  const where = sc && sc.file ? `Saved in <code>${esc(sc.file)}</code> as <code>${sc.format === 'plain' ? 'DefaultScoringS/M' : '\\scoringDefaultS/M'}</code>.` : '';
  return `<div class="page">
    ${header('marking-scheme', 'Marking scheme', 'How questions are scored by default, and how points become the final mark.')}
    ${guideBox('marking-scheme')}
    ${locked() ? banner('info', 'info-circle', 'You can still change everything on this page after printing.', 'None of it moves anything on the printed papers. If marks were already computed, compute them again to apply the change.') : ''}
    <div class="grid grid-2">
      <section class="card"><div class="card-header"><h2>Default scoring</h2></div>
        <div class="card-body">
          ${!sc ? '<p class="subtle">Loading…</p>' : sc.error ? `<p class="muted">${esc(sc.error)}</p>` : `
          ${scoringField('S', PRESETS_S, 'Single-answer questions')}
          ${scoringField('M', PRESETS_M, 'Multiple-answer questions')}
          <p class="field-hint" style="margin-top:12px">${where} Rules written on individual questions (<code>\\scoring{…}</code>) still win.</p>`}
        </div>
        ${sc && !sc.error ? `<div class="card-foot"><button class="btn btn-primary" data-act="save-scoring">${ic('floppy-disk')} Save default scoring</button></div>` : ''}
      </section>
      <section class="card"><div class="card-header"><h2>Final mark</h2></div>
        <div class="card-body">${!c ? '<p class="subtle">Loading…</p>' : `<div class="form-grid">
          <label class="field"><span class="field-label">Out of</span><input class="input" type="number" min="0" step="any" data-option="note_max" value="${esc(o.note_max)}" placeholder="20">
            <span class="field-hint">Empty: the raw points.</span></label>
          <label class="field"><span class="field-label">Rounding</span><select class="select" data-option="note_arrondi">
            ${[['normal', 'To the nearest'], ['inf', 'Down'], ['sup', 'Up']].map(([x, l]) => `<option value="${x}" ${o.note_arrondi === x ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="field"><span class="field-label">In steps of</span><input class="input" type="number" min="0" step="any" data-option="note_grain" value="${esc(o.note_grain)}" placeholder="0.5"></label>
          <label class="field"><span class="field-label">Mark for a blank sheet</span><input class="input" type="number" step="any" data-option="note_null" value="${esc(o.note_null)}" placeholder="0"></label>
        </div><p class="field-hint" style="margin-top:12px">Each change is saved as you make it.</p>`}</div>
      </section>
    </div>
    ${questionsCard()}
  </div>`;
}

/* ---------- Marking scheme: questions, answer key and per-question scoring ---------- */

const KIND_LABELS = { default: 'Default', custom: 'Own rule', full: 'Full marks for everyone', none: 'Not counted' };
const fmtPts = (x) => (x === null || x === undefined ? '?' : `${fmtNum(x)} ${x === 1 ? 'point' : 'points'}`);
const trunc = (t, n) => (t.length > n ? t.slice(0, n - 1) + '…' : t);

function questionsCard() {
  const d = S.questions;
  const updating = S.scaleUpdating || (d && d.updating);
  const head = (extra = '') => `<div class="card-header">${ic('list')}<h2>Questions</h2>${extra}<span class="spacer"></span>
    ${updating ? `<span class="row subtle" style="gap:6px"><span class="spinner" style="width:14px;height:14px"></span>Reading the questions…</span>` : ''}</div>`;
  if (!d) return `<section class="card" style="margin-top:16px">${head()}<div class="card-body"><div class="skeleton" style="height:120px"></div></div></section>`;
  if (d.error) {
    return `<section class="card" style="margin-top:16px">${head()}<div class="card-body">${banner('warning', 'warning-triangle', d.error, '', `<a class="btn btn-sm" href="${examPath(S.project, 'questions')}" data-nav>Go to Questions</a><button class="btn btn-sm btn-ghost" data-act="scale-refresh">Try again</button>`)}</div></section>`;
  }
  if (!d.questions.length) {
    return `<section class="card" style="margin-top:16px">${head()}<div class="card-body"><p class="muted">${updating ? 'AMC is reading the questions from the source…' : 'No questions found yet. Write them in Questions.'}</p></div></section>`;
  }
  const t = d.totals;
  const full = S.config && parseFloat(S.config.options.note_max);
  const total = !t ? '' : `<span class="q-total">Total: <b>${t.unknown ? 'at least ' : ''}${t.min === t.max ? fmtPts(t.max) : `${fmtNum(t.min)}–${fmtPts(t.max)}`}</b>${full > 0 ? ` → final mark out of <b>${fmtNum(full)}</b>` : ''}</span>`;
  const L = locked();
  return `<section class="card" style="margin-top:16px">${head(`<span class="chip">${d.questions.length}</span>`)}
    <div class="card-body" style="padding-bottom:6px"><div class="row" style="flex-wrap:wrap;gap:8px 16px">
      <span class="muted">Click an answer to mark it correct or not. ${L ? 'The exam is printed: these changes are still allowed, because nothing moves on the paper.' : 'Changes are saved in the source.'}</span><span class="spacer"></span>${total}</div></div>
    <div class="table-wrap" style="border:0;border-top:1px solid var(--border);border-radius:0"><table class="table q-table"><thead><tr><th>Question</th><th>Correct answers</th><th>Points</th></tr></thead>
    <tbody>${d.questions.map(questionRow).join('')}</tbody></table></div>
    ${t && t.min !== t.max ? '<p class="field-hint" style="padding:8px 16px">Copies get different questions, so their totals differ.</p>' : ''}
  </section>`;
}

function questionRow(q) {
  const chips = q.answers.map((a) => {
    const can = q.editable && a.answer !== 0 && !q.indicative;
    return `<button class="ans ${a.correct ? 'is-correct' : ''}" data-act="q-answer" data-title="${esc(q.title)}" data-answer="${a.answer}" aria-pressed="${a.correct}" ${can ? '' : 'disabled'} title="${esc(a.text)}${a.answer === 0 ? ' (AMC adds this box; it is correct when no other answer is)' : ''}">${a.correct ? ic('check') : ''}<span>${esc(trunc(a.text, 30))}</span></button>`;
  }).join('');
  const kind = q.indicative ? 'Indicative: not counted' : KIND_LABELS[q.kind];
  const actions = q.editable && !q.indicative
    ? `<button class="btn btn-ghost btn-sm" data-act="q-edit" data-title="${esc(q.title)}">${ic('edit-pencil')} Scoring…</button>${q.kind === 'full' || q.kind === 'none' ? `<button class="btn btn-ghost btn-sm" data-act="q-restore" data-title="${esc(q.title)}">Count normally</button>` : ''}`
    : `<a class="btn btn-ghost btn-sm" href="${examPath(S.project, 'questions')}" data-nav>Edit in Questions</a>`;
  return `<tr class="${q.kind === 'none' ? 'is-muted' : ''}">
    <td class="q-cell"><div class="row" style="gap:8px;flex-wrap:wrap"><b>${esc(q.title)}</b><span class="chip">${q.multiple ? 'Multiple' : 'Single'}</span></div>
      ${q.text ? `<div class="subtle q-text">${esc(q.text)}</div>` : ''}
      ${q.problem ? `<div class="subtle q-text q-problem">${ic('info-circle')} ${esc(q.problem)}</div>` : ''}
      <div class="q-actions">${actions}</div></td>
    <td class="q-cell"><div class="ans-row">${chips}</div></td>
    <td class="q-cell q-points"><b title="${q.max_from === 'amc' ? 'As computed by AMC when marking' : 'From the scoring rules'}">${q.max === null ? '?' : fmtPts(q.max)}</b>
      <div class="subtle">${kind}</div>${q.kind === 'custom' ? `<div class="mono q-rule">${esc(q.rule)}</div>` : ''}
      ${q.answer_rules ? '<div class="subtle">Some answers have their own points</div>' : ''}
      ${q.max === null ? '<div class="subtle">AMC works it out when marking</div>' : ''}</td></tr>`;
}

function questionByTitle(title) { return S.questions && S.questions.questions.find((x) => x.title === title); }

function toggleAnswer(title, answer) {
  const q = questionByTitle(title);
  if (!q || !q.editable) return;
  const a = q.answers.find((x) => x.answer === answer);
  if (!q.multiple && a.correct) { toast('A single-answer question needs one correct answer: click the answer that should be correct instead.', 'info-circle'); return; }
  const correct = !a.correct;
  q.answers.forEach((x) => { if (x.answer === answer) x.correct = correct; else if (!q.multiple && correct) x.correct = false; });
  S.questions.fresh = false; // until the server has written it and AMC has read it again
  renderMain(true);
  socket_emit('ui-question-edit', { title, action: 'correct', answer, correct });
  if (S.status && S.status.marked) toast('Answer key changed. Compute the marks again to apply it.', 'info-circle');
}

async function editQuestion(title) {
  const q = questionByTitle(title);
  if (!q) return;
  // In AMC a default haut= wins over a question's mz=, so "all or nothing" on a question also says haut=0.
  const presets = (q.multiple ? PRESETS_M : PRESETS_S).filter(([v]) => v).map(([v, l]) => [q.multiple && /^mz=/.test(v) ? 'haut=0,' + v : v, l]);
  const current = q.kind === 'full' || q.kind === 'none' ? q.kind : q.kind === 'default' ? 'default'
    : presets.some(([v]) => v === q.rule) ? 'preset:' + q.rule : 'custom';
  const radio = (value, title2, hint = '') => `<label class="check"><input type="radio" name="choice" value="${esc(value)}" ${current === value ? 'checked' : ''}><span>${title2}${hint ? `<br><span class="subtle">${hint}</span>` : ''}</span></label>`;
  const def = S.scoring && (q.multiple ? S.scoring.M : S.scoring.S);
  const data = await formDialog({
    title: `Scoring of ${esc(q.title)}`, ok: 'Save', icon: 'percentage-circle',
    body: `<div class="q-choices">
      ${radio('default', 'The default scoring', def ? `<code>${esc(def)}</code>, as set above` : `AMC's default for ${q.multiple ? 'multiple' : 'single'}-answer questions`)}
      ${presets.map(([v, l]) => radio('preset:' + v, esc(l), `<code>${esc(v)}</code>`)).join('')}
      ${radio('custom', 'Own AMC rule')}
      <input class="input mono" name="custom" style="margin:-2px 0 6px 24px;width:calc(100% - 24px)" value="${esc(current === 'custom' ? q.rule : '')}" placeholder="b=2,m=-1" autocomplete="off">
      <div class="menu-sep" style="margin:10px 0"></div><div class="field-label" style="margin-bottom:6px">Neutralise the question</div>
      ${radio('full', 'Full marks for everyone', `Every copy gets the question's ${q.max ? fmtPts(q.max) : 'points'}, whatever was ticked.`)}
      ${radio('none', 'Not counted', 'The question gives no points and isn\'t part of the total.')}
    </div>`,
    validate: (v) => {
      if (!v.choice) return 'Choose how the question is scored.';
      if (v.choice === 'custom' && !/^[A-Za-z0-9=.,+\-*/() ]{1,200}$/.test((v.custom || '').trim())) return 'Write an AMC rule, for example b=2,m=-1.';
      return '';
    },
  });
  if (!data) return;
  if (data.choice === 'full' || data.choice === 'none') socket_emit('ui-question-edit', { title, action: 'neutral', how: data.choice });
  else socket_emit('ui-question-edit', { title, action: 'rule', rule: data.choice === 'default' ? '' : data.choice === 'custom' ? data.custom.trim() : data.choice.slice(7) });
}

/* ---------- View: papers ---------- */

const DEFECTS = {
  NO_NAME: 'The paper has no name field (<code>\\namefield</code>). Papers without one are hard to match to students.',
  SEVERAL_NAMES: 'The name field (<code>\\namefield</code>) appears more than once on the same paper.',
  NO_BOX: 'There are no boxes to tick.',
  DIFFERENT_POSITIONS: 'The corner marks or page codes are not in the same place on every page.',
  OUT_OF_PAGE: 'Something is placed outside the page, often a question group starting too close to the bottom.',
  INCOMPLETE_MULTI: 'The multi-page code is missing on some pages.',
};

function viewPapers() {
  const st = S.status || {};
  const L = locked();
  const built = !!st.layout_pages;
  const defects = st.defects || [];
  const docs = [['sujet', 'Question paper', 'Built with the layout'], ['corrige', 'Answer key', 'The paper with correct answers ticked'], ['catalog', 'Catalogue', 'Every question once, for reference'], ['indiv-solution', 'Corrected copies', 'One corrected paper per copy']];
  const range = st.copies_range ? `${st.copies_range[1] - st.copies_range[0] + 1} copies` : '';
  return `<div class="page">
    ${header('papers', 'Papers', 'Build the final papers, then check the layout before printing.',
    L ? '' : `<button class="btn ${built ? '' : 'btn-primary'}" data-act="build-papers">${ic('refresh')} ${built ? 'Rebuild papers' : 'Build papers'}</button>`)}
    ${guideBox('papers')}
    ${L ? lockBanner('The papers can\'t be rebuilt now. You can still open and download them.') : ''}
    ${!L && built && !st.layout_ok ? `<section class="card card-accent" style="margin-bottom:16px">
      <div class="card-header">${ic('page-search')}<h2>Check the layout</h2><span class="chip chip-warning">Needs your check</span></div>
      <div class="card-body"><p class="muted" style="margin-bottom:10px">Layout detection ran on ${st.layout_pages} pages. Go through a few pages in the preview: each item should be outlined in its colour.</p>
        <div class="checklist">
          <div class="checklist-item">${ic('frame-select')}<span>Corner marks outlined in <b style="color:#0aa8a0">cyan</b> on every page</span></div>
          <div class="checklist-item">${ic('check-circle')}<span>Every answer box outlined in <b style="color:#14a44d">green</b></span></div>
          <div class="checklist-item">${ic('user')}<span>The name field outlined in <b style="color:#c40fcf">pink</b></span></div>
          <div class="checklist-item ${defects.length ? 'warn' : 'ok'}">${ic(defects.length ? 'warning-triangle' : 'check-circle')}<span>${defects.length ? `${defects.length} layout warning${defects.length > 1 ? 's' : ''} below` : 'No layout warnings'}</span></div>
        </div></div>
      <div class="card-foot"><button class="btn btn-ghost" data-act="show-layout">${ic('eye')} Show the layout</button><button class="btn btn-ghost" data-act="layout-help">Something looks wrong</button><button class="btn btn-primary" data-act="layout-ok">${ic('check')} Looks correct</button></div>
    </section>` : ''}
    ${!L && st.layout_ok ? banner('success', 'check-circle', `Layout confirmed${st.layout_ok.by ? ' by ' + esc(st.layout_ok.by) : ''} on ${fmtDate(st.layout_ok.at)}.`, 'Rebuilding the papers will ask for the check again.', `<a class="btn btn-primary btn-sm" href="${examPath(S.project, 'print')}" data-nav>${ic('printer')} Go to Print</a>`) : ''}
    ${defects.length ? `<section class="card" style="margin-bottom:16px"><div class="card-header">${ic('warning-triangle')}<h2>Layout warnings</h2><span class="chip chip-warning">${defects.length}</span></div><div class="list">
      ${defects.map((d) => `<div class="list-row"><span class="list-icon warn">${ic('warning-triangle')}</span><div class="list-row-main"><div>${DEFECTS[d.kind] || esc(d.kind)}</div>
        <div class="subtle">${d.kind === 'DIFFERENT_POSITIONS' ? `For example pages ${esc(d.a)} and ${esc(d.b)}.` : ['OUT_OF_PAGE', 'INCOMPLETE_MULTI'].includes(d.kind) ? `${esc(d.a)} pages, for example page ${esc(d.b)}.` : `${esc(d.a)} copies, for example copy ${esc(d.b)}.`}</div></div></div>`).join('')}
    </div></section>` : ''}
    <div class="grid grid-2">
      <section class="card"><div class="card-header"><h2>Number of copies</h2></div><div class="card-body">
        <label class="field"><span class="field-label">Copies</span><span class="input-group">
          <input class="input input-num" type="number" min="0" id="copies" value="${Number(st.copies) > 0 ? esc(st.copies) : ''}" placeholder="Source" ${L ? 'disabled' : ''}>
          <span class="subtle">${L ? 'Locked after printing.' : 'Print a few spares beyond the class size.'}</span></span></label>
        <p class="field-hint" style="margin-top:10px">${Number(st.copies) > 0 ? '' : 'Empty: the number written in the source (<code>\\onecopy{…}</code>). '}${range ? `Built: ${range}.` : ''}${!L && built ? ' Changing the number means building the papers again.' : ''}</p>
      </div></section>
      <section class="card"><div class="card-header"><h2>Documents</h2>${built ? `<button class="btn btn-ghost btn-sm" data-act="show-layout">${ic('frame-select')} Layout</button>` : ''}</div><div class="list">
        ${docs.map(([d, t, sub]) => `<div class="list-row"><span class="list-icon ${st.docs && st.docs[d] ? 'brand' : ''}">${ic('page')}</span>
          <div class="list-row-main"><div class="list-row-title">${t}</div><div class="subtle">${st.docs && st.docs[d] ? sub : 'Not built yet'}</div></div>
          ${st.docs && st.docs[d] ? `<button class="btn btn-sm" data-act="show-doc" data-doc="${d}">Preview</button>` : ''}
          ${d !== 'sujet' && built ? `<button class="btn btn-ghost btn-sm" data-act="build-doc" data-doc="${d}" title="Build ${t.toLowerCase()}">${ic('refresh')}</button>` : ''}</div>`).join('')}
      </div></section>
    </div>
  </div>`;
}

function showLayout() {
  S.previewMode = 'layout'; S.previewFile = null;
  if (!S.previewOpen) { S.previewOpen = true; store.set('previewOpen', true); renderTop(); }
  renderPreview();
  socket_emit('layout-init');
}

async function buildPapers() {
  const st = S.status || {};
  if (st.layout_ok) {
    const ok = await confirmDialog({ title: 'Build the papers again?', body: '<p>You confirmed the layout of the current papers. After rebuilding, check the layout again before printing.</p>', ok: 'Rebuild' });
    if (!ok) return;
  }
  S.buildError = false;
  S.buildQueue = ['corrige'];
  S.previewMode = 'layout';
  socket_emit('doc-update', 'sujet');
}

/* ---------- View: print ---------- */

function viewPrint() {
  const st = S.status || {};
  const L = locked();
  if (!L && !st.layout_ok) {
    return `<div class="page">${header('print', 'Print')}${guideBox('print')}
      <section class="card"><div class="empty"><div class="empty-icon">${ic('page-search')}</div><h2>${st.layout_pages ? 'Check the layout first' : 'Build the papers first'}</h2>
        <p>${st.layout_pages ? 'Printing opens once you\'ve confirmed the layout in Papers. It catches problems before every copy is printed.' : 'Build the papers in step 3, check the layout, and printing opens here.'}</p>
        <div class="btn-row"><a class="btn btn-primary" href="${examPath(S.project, 'papers')}" data-nav>Go to Papers</a></div></div></section></div>`;
  }
  const pr = S.printers || { available: false, printers: [] };
  const route = pr.available ? S.printRoute : 'files';
  const r = st.copies_range || [1, st.copies || 1];
  return `<div class="page">
    ${header('print', 'Print', 'Save the papers as PDFs to print anywhere, or print directly on the shared machine.')}
    ${guideBox('print')}
    ${L ? lockBanner('You can save or print the same papers again: they are identical to the ones already printed.') : ''}
    <div class="grid grid-2" role="radiogroup" aria-label="How to print">
      <button class="choice" role="radio" aria-checked="${route === 'files'}" data-act="print-route" data-route="files"><span class="choice-icon">${ic('download')}</span>
        <span><span class="choice-title">Save PDFs for printing</span><br><span class="subtle">Download the papers and print them anywhere, for example from a pendrive.</span></span></button>
      <button class="choice" role="radio" aria-checked="${route === 'printer'}" aria-disabled="${!pr.available}" data-act="print-route" data-route="printer"><span class="choice-icon">${ic('printer')}</span>
        <span><span class="choice-title">Print on this machine</span><br><span class="subtle">${S.printers === null ? 'Looking for printers…' : pr.available ? 'Send the papers to a printer attached to the shared machine.' : 'Only when the shared machine runs Linux and its printer is connected (<code>./amc printer on</code>).'}</span></span></button>
    </div>
    <div class="grid grid-2" style="margin-top:16px">
      <section class="card"><div class="card-header"><h2>What to print</h2></div><div class="card-body">
        <div class="form-grid"><label class="field"><span class="field-label">From copy</span><input class="input" type="number" id="print-from" min="${r[0]}" max="${r[1]}" value="${r[0]}"></label>
        <label class="field"><span class="field-label">To copy</span><input class="input" type="number" id="print-to" min="${r[0]}" max="${r[1]}" value="${r[1]}"></label></div>
        ${route === 'printer' ? `<label class="field" style="margin-top:14px"><span class="field-label">Printer</span><select class="select" id="print-printer">${pr.printers.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label>` : ''}
      </div></section>
      <section class="card"><div class="card-header"><h2>Before you print</h2></div><div class="card-body"><div class="checklist">
        <div class="checklist-item ok">${ic('page')}<span>A4 paper</span></div>
        <div class="checklist-item warn">${ic('warning-triangle')}<span><b>100% scale</b> ("Actual size"), never "Fit to page"</span></div>
        <div class="checklist-item ok">${ic('multiple-pages')}<span>Single- or double-sided, as the papers are laid out</span></div>
        <div class="checklist-item ok">${ic('frame-select')}<span>Corner marks fully visible on every page</span></div>
      </div></div></section>
    </div>
    <div class="row" style="margin-top:18px">
      ${L ? '' : '<button class="link-btn" data-act="mark-printed">Already printed another way? Mark as printed</button>'}
      <span class="spacer"></span>
      <button class="btn btn-primary btn-lg" data-act="print">${ic(route === 'printer' ? 'printer' : 'download')} ${route === 'printer' ? (L ? 'Print again' : 'Print…') : (L ? 'Save PDFs again' : 'Save PDFs for printing…')}</button>
    </div>
    <div style="margin-top:16px">${activityCard()}</div>
  </div>`;
}

async function printPapers() {
  const from = parseInt($('#print-from').value, 10);
  const to = parseInt($('#print-to').value, 10);
  if (!(from >= 1) || !(to >= from)) { toast('Check the range of copies.', 'warning-triangle'); return; }
  const printer = S.printRoute === 'printer' && S.printers && S.printers.available;
  if (!locked()) {
    const ok = await confirmDialog({
      icon: 'lock', title: 'This locks the exam',
      body: `<p>After printing, the questions and layout must stay exactly as printed, or the scans can't be read.</p>
        <ul><li>Locked: question and answer text, layout, number of copies.</li><li>Still editable: marking scheme, answer key corrections, final mark settings.</li></ul>
        <p class="subtle">Unlocking later is possible, but removes scans and marks.</p>`,
      ok: printer ? 'Print and lock' : 'Save PDFs and lock',
    });
    if (!ok) return;
  }
  S.printing = { how: printer ? 'printer' : 'files', copies: `${from}–${to}` };
  // As text, like upstream's page: the server's command logger expects strings.
  if (printer) socket_emit('print-to-printer', [String(from), String(to), $('#print-printer').value]);
  else socket_emit('print-to-files', [String(from), String(to)]);
}

async function markPrinted() {
  const ok = await confirmDialog({ icon: 'lock', title: 'Mark this exam as printed?', body: '<p>Use this when the papers were printed another way. The exam locks: questions, layout and number of copies can no longer change.</p>', ok: 'Mark as printed and lock' });
  if (ok) socket_emit('ui-mark-printed');
}

/* ---------- View: upload scans ---------- */

function openPreview() {
  if (!S.previewOpen) { S.previewOpen = true; store.set('previewOpen', true); renderTop(); }
  renderPreview();
}

function scanStats(st, sc) {
  const toCheck = sc ? sc.pages.filter((p) => p.to_check).length : st.to_check;
  const failed = sc ? sc.failed.length : st.failed;
  return `<div class="stats" style="margin-bottom:16px">
    ${stat(sc ? sc.pages.length : st.scans, 'Pages read', 'ok')}
    ${stat(sc ? sc.complete : '–', 'Complete copies', 'ok')}
    ${stat(sc ? sc.incomplete : st.incomplete, 'Incomplete copies', (sc ? sc.incomplete : st.incomplete) ? 'warn' : 'ok')}
    ${stat(failed, 'Unreadable pages', failed ? 'bad' : 'ok')}
    ${stat(toCheck, 'Pages to check', toCheck ? 'warn' : 'ok')}</div>`;
}

function viewUpload() {
  const st = S.status || {};
  const sc = S.scans;
  const has = st.scans > 0;
  return `<div class="page">
    ${header('upload-scans', 'Upload scans', 'Upload the scanned answer sheets. Each page is detected automatically.',
    has ? `<a class="btn btn-primary" href="${examPath(S.project, 'check-scans')}" data-nav>Next: Check scans ${ic('arrow-right')}</a>` : '')}
    ${guideBox('upload-scans')}
    ${!st.lock ? banner('info', 'info-circle', 'This exam isn\'t marked as printed.', 'That\'s fine if the papers were printed another way. Uploading scans locks the exam, like printing.') : ''}
    ${has ? scanStats(st, sc) : ''}
    <label class="dropzone" id="scan-drop" style="cursor:pointer">
      ${ic('cloud-upload')}<div><strong>Drop scanned answer sheets here</strong> or click to choose files</div>
      <div class="subtle">PDF, TIFF, JPEG or PNG · 300 dpi recommended · several files at once</div>
      <input type="file" id="scan-files" multiple accept=".pdf,.tif,.tiff,.jpg,.jpeg,.png,application/pdf,image/*" hidden>
    </label>
    <section class="card" style="margin-top:16px"><div class="card-header"><h2>Scan options</h2></div><div class="card-body">
      ${!sc ? '<p class="subtle">Loading…</p>' : `
      <label class="check"><input type="checkbox" id="scan-photocopy" ${sc.photocopy ? 'checked' : ''} ${sc.mode_locked ? 'disabled' : ''}>
        <span>Students wrote on photocopies<br><span class="subtle">${sc.mode_locked ? 'Can\'t change once scans are uploaded.' : 'Tick this if one printed paper was photocopied for the class, instead of printing each copy.'}</span></span></label>
      ${sc.photocopy && (sc.max_pages || 0) > 1 ? `<label class="field" style="margin-top:14px"><span class="field-label">Pages of one copy</span>
        <select class="select" data-option="multi_scan_mode">
          ${[['strict', 'Must follow each other, in order'], ['skip-unrecognized', 'In order, skipping pages it can\'t read'], ['increasing', 'In increasing page order'], ['file', 'One file per copy']].map(([v, l]) => `<option value="${v}" ${sc.multi_scan_mode === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select><span class="field-hint">How AMC tells where one student's copy ends in photocopied scans.</span></label>` : ''}`}
    </div></section>
  </div>`;
}

async function uploadScans(files) {
  if (!files.length) return;
  S.work = { text: `Uploading ${files.length} file${files.length > 1 ? 's' : ''}…`, p: 0 }; renderWork();
  try {
    const r = await upload('/upload/scans', [...files].map((f) => [f, f.name]), { project_name: S.project },
      (p) => { if (S.work) { S.work.p = p; renderWork(); } });
    S.work = { text: 'Reading the scans…', p: null }; renderWork();
    socket_emit('data-capture', r.list);
  } catch (e) {
    S.work = null; renderWork();
    toast(e.message, 'warning-triangle');
  }
}

/* ---------- View: check scans ---------- */

const pageKey = (p) => `${p.student}/${p.page}/${p.copy}`;
const pageName = (p) => `Copy ${p.copy ? `${p.student}·${p.copy}` : p.student}, page ${p.page}`;
const boxKey = (b) => `${b.question}_${b.answer}`;

function viewCheck() {
  const st = S.status || {};
  const sc = S.scans;
  if (!st.scans && !(sc && sc.failed.length)) {
    return `<div class="page">${header('check-scans', 'Check scans')}${guideBox('check-scans')}
      <section class="card"><div class="empty"><div class="empty-icon">${ic('page-search')}</div><h2>No scans yet</h2>
        <p>Upload the scanned answer sheets first. Anything that needs your eye appears here.</p>
        <div class="btn-row"><a class="btn btn-primary" href="${examPath(S.project, 'upload-scans')}" data-nav>Go to Upload scans</a></div></div></section></div>`;
  }
  if (!sc) return `<div class="page">${header('check-scans', 'Check scans')}<div class="skeleton"></div></div>`;
  const queue = sc.pages.filter((p) => p.to_check);
  const left = queue.length + sc.failed.length + sc.missing.length;
  return `<div class="page">
    ${header('check-scans', 'Check scans', 'Fix what automatic detection couldn\'t settle. Marks come next.',
    left ? `<span class="chip chip-warning">${left} to look at</span>` : `<a class="btn btn-primary" href="${examPath(S.project, 'mark')}" data-nav>Next: Mark ${ic('arrow-right')}</a>`)}
    ${guideBox('check-scans')}
    ${!left ? banner('success', 'check-circle', 'All clear.', 'Every page is read and every uncertain box is settled.') : ''}
    ${scanStats(st, sc)}
    ${unreadableCard(sc)}
    ${missingCard(sc)}
    ${reviewCard(queue)}
    ${allPagesCard(sc)}
    <details class="card" style="margin-top:16px"><summary class="card-header" style="cursor:pointer;border-bottom:0">${ic('settings')}<h2>Advanced: detection sensitivity</h2></summary>
      <div class="card-body" style="border-top:1px solid var(--border)">
        <p class="muted" style="margin-bottom:12px">A box counts as ticked when its darkness is between these two values. Darker than the upper value counts as filled in to cancel. Boxes close to either value are sent to you to check.</p>
        <div class="form-grid">
          <label class="field"><span class="field-label">Lower (ticked from)</span><input class="input" type="number" min="0" max="1" step="0.01" id="seuil" value="${sc.low}"></label>
          <label class="field"><span class="field-label">Upper (cancelled above)</span><input class="input" type="number" min="0" max="1" step="0.01" id="seuil_up" value="${sc.high}"></label>
        </div><p class="field-hint" style="margin-top:10px">Changing these changes which boxes count as ticked on every page. Pages you already checked keep your decisions.</p>
      </div></details>
  </div>`;
}

function unreadableCard(sc) {
  if (!sc.failed.length) return '';
  return `<section class="card"><div class="card-header">${ic('warning-triangle')}<h2>Unreadable pages</h2><span class="chip chip-danger">${sc.failed.length}</span></div>
    <div class="list">${sc.failed.map((f, i) => `<div class="list-row"><span class="list-icon bad">${ic('page')}</span>
      <div class="list-row-main"><div class="list-row-title">${esc(f.file)}</div><div class="subtle">AMC couldn't find this exam's corner marks or page code. The page may be rotated, cropped, too light, blank, or from another exam.</div></div>
      ${f.local ? `<button class="btn btn-sm" data-act="failed-view" data-i="${i}">View</button>` : ''}
      <button class="btn btn-sm" data-act="failed-diagnose" data-i="${i}">What AMC saw</button>
      <button class="btn btn-sm btn-ghost" data-act="failed-remove" data-i="${i}" title="Remove from the list">${ic('trash')}</button></div>`).join('')}</div>
    <div class="card-foot" style="justify-content:flex-start"><span class="subtle">If the page belongs to this exam, scan it again (straight, at 300 dpi) and upload it.</span></div></section>`;
}

function missingCard(sc) {
  if (!sc.missing.length) return '';
  const byCopy = {};
  sc.missing.forEach((m) => { const k = m.copy ? `${m.student}·${m.copy}` : `${m.student}`; (byCopy[k] = byCopy[k] || []).push(m.page); });
  return `<section class="card"><div class="card-header">${ic('multiple-pages')}<h2>Missing pages</h2><span class="chip chip-warning">${sc.missing.length}</span></div>
    <div class="list">${Object.entries(byCopy).map(([k, pages]) => `<div class="list-row"><span class="list-icon warn">${ic('page')}</span>
      <div class="list-row-main"><div class="list-row-title">Copy ${esc(k)}: page${pages.length > 1 ? 's' : ''} ${pages.join(', ')} missing</div>
      <div class="subtle">Other pages of this copy were scanned. Find the missing page and upload it; otherwise the copy is marked with what was read.</div></div></div>`).join('')}</div></section>`;
}

function reviewCard(queue) {
  const rv = S.review;
  const inQueue = rv && queue.some((p) => pageKey(p) === rv.key);
  if (!queue.length && !rv) return '';
  let pane = '<p class="subtle" style="padding:16px">Choose a page.</p>';
  if (rv) {
    if (rv.loading) pane = '<div style="padding:16px"><div class="skeleton" style="height:160px"></div></div>';
    else {
      const show = rv.showAll ? rv.boxes : rv.boxes.filter((b) => b.uncertain);
      pane = `<div style="padding:14px 16px">
        <div class="row-between" style="margin-bottom:10px;flex-wrap:wrap"><strong>${pageName(rv)}</strong>
          <span class="row" style="gap:6px"><button class="btn btn-ghost btn-sm" data-act="review-all">${rv.showAll ? 'Only uncertain boxes' : `All ${rv.boxes.length} boxes`}</button>
          <button class="btn btn-ghost btn-sm" data-act="review-page-view">${ic('eye')} Page</button></span></div>
        ${show.length ? `<div class="zoom-list">${show.map((b) => {
    const i = rv.boxes.indexOf(b);
    const on = rv.decisions[boxKey(b)];
    return `<div class="zoom-row ${i === rv.cursor ? 'is-current' : ''} ${b.uncertain ? 'is-uncertain' : ''}" data-act="review-cursor" data-i="${i}">
            ${b.image ? `<img class="zoom-img" src="${b.image}" alt="">` : '<span class="zoom-img"></span>'}
            <div class="zoom-info"><div><b>${esc(b.name || 'Question ' + b.question)}</b> · ${b.label ? 'box ' + esc(b.label) : 'answer ' + b.answer}</div>
              <div class="subtle">${b.prop === null ? 'not measured' : Math.round(b.prop * 100) + '% dark'} · detected ${b.auto ? 'ticked' : 'not ticked'}${b.uncertain ? ' · uncertain' : ''}</div></div>
            <div class="segmented" role="group" aria-label="Decision"><button aria-pressed="${on}" data-act="review-set" data-i="${i}" data-v="1">Ticked</button><button aria-pressed="${!on}" data-act="review-set" data-i="${i}" data-v="0">Not ticked</button></div>
          </div>`;
  }).join('')}</div>` : '<p class="subtle">No uncertain boxes on this page.</p>'}
        <div class="row" style="margin-top:12px;flex-wrap:wrap"><span class="subtle"><span class="kbd">T</span> ticked · <span class="kbd">N</span> not ticked · <span class="kbd">↑</span><span class="kbd">↓</span> move · <span class="kbd">Enter</span> page done</span>
          <span class="spacer"></span>
          ${rv.checked ? `<button class="btn btn-sm" data-act="review-revert">${ic('undo')} Back to detected</button>` : ''}
          <button class="btn btn-primary" data-act="review-done">${ic('check')} ${inQueue ? 'Page done' : 'Save this page'}</button></div>
      </div>`;
    }
  }
  return `<section class="card"><div class="card-header">${ic('frame-select')}<h2>Pages to check</h2><span class="chip ${queue.length ? 'chip-warning' : 'chip-success'}">${queue.length || 'None'}</span>
      ${queue.length > 1 ? '<button class="btn btn-ghost btn-sm" data-act="accept-rest">Accept the rest as detected</button>' : ''}</div>
    <div class="review">
      <div class="review-list">${queue.map((p) => `<button class="review-item" aria-current="${rv && rv.key === pageKey(p)}" data-act="review-open" data-key="${pageKey(p)}"><span class="ri-dot"></span><span><span class="ri-title">${pageName(p)}</span><br><span class="subtle">${p.sensitivity === null ? '' : 'uncertainty ' + p.sensitivity + '/10'}</span></span></button>`).join('')}
        ${rv && !inQueue ? `<button class="review-item" aria-current="true"><span class="ri-dot" style="background:var(--success)"></span><span class="ri-title">${pageName(rv)}</span></button>` : ''}</div>
      <div>${pane}</div>
    </div></section>`;
}

function allPagesCard(sc) {
  if (!sc.pages.length) return '';
  return `<details class="card" style="margin-top:16px"><summary class="card-header" style="cursor:pointer;border-bottom:0">${ic('multiple-pages')}<h2>All pages read</h2><span class="chip">${sc.pages.length}</span></summary>
    <div class="table-wrap" style="border:0;border-top:1px solid var(--border);border-radius:0;max-height:360px"><table class="table"><thead><tr><th>Copy</th><th>Page</th><th>Checked by a person</th><th class="num">Uncertainty</th><th></th></tr></thead>
    <tbody>${sc.pages.map((p) => `<tr><td class="num">${p.copy ? `${p.student}·${p.copy}` : p.student}</td><td class="num">${p.page}</td><td>${p.checked ? 'Yes' : p.to_check ? '<span class="chip chip-warning">To check</span>' : 'No'}</td><td class="num">${p.sensitivity === null ? '–' : p.sensitivity}</td>
      <td style="text-align:right"><button class="btn btn-sm" data-act="review-open" data-key="${pageKey(p)}">Open</button> <button class="btn btn-sm btn-ghost" data-act="delete-page" data-key="${pageKey(p)}" title="Delete this page's scan">${ic('trash')}</button></td></tr>`).join('')}</tbody></table></div></details>`;
}

function openNextReview() {
  const sc = S.scans;
  const next = sc && sc.pages.find((p) => p.to_check);
  if (next) openReview(pageKey(next)); else { S.review = null; if (S.previewMode === 'page') S.previewMode = null; renderMain(true); renderPreview(); }
}

async function openReview(key) {
  const [student, page, copy] = key.split('/').map(Number);
  const found = S.scans && S.scans.pages.find((p) => pageKey(p) === key);
  S.review = { key, student, page, copy, loading: true, boxes: [], decisions: {}, cursor: 0, showAll: false, checked: found ? found.checked : false, svg: null };
  S.previewMode = 'page';
  renderMain(true); renderPreview();
  try {
    const r = await getJSON(`/ui/api/scan-page?student=${student}&page=${page}&copy=${copy}`);
    if (!S.review || S.review.key !== key) return;
    S.review.boxes = r.boxes || [];
    S.review.boxes.forEach((b) => { S.review.decisions[boxKey(b)] = b.ticked; });
    const firstUncertain = S.review.boxes.findIndex((b) => b.uncertain);
    S.review.cursor = firstUncertain >= 0 ? firstUncertain : 0;
    S.review.loading = false;
    renderMain(true);
    const res = await fetch('/scans_page_select.html', { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify({ student, page, copy }) });
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    const svg = doc.querySelector('svg');
    if (svg) {
      // Clicks are handled here; drop the old page's inline handlers and any script.
      svg.querySelectorAll('script').forEach((el) => el.remove());
      [svg, ...svg.querySelectorAll('*')].forEach((el) => [...el.attributes].forEach((a) => { if (/^on/i.test(a.name)) el.removeAttribute(a.name); }));
    }
    if (S.review && S.review.key === key) { S.review.svg = svg ? svg.outerHTML : ''; renderPreview(); }
  } catch (e) { console.error(e); if (S.review) { S.review.loading = false; renderMain(true); } }
}

/* Show the current decisions on the scanned page. */
function paintPageBoxes() {
  const host = $('#page-svg');
  if (!host || !S.review) return;
  S.review.boxes.forEach((b, i) => {
    const el = host.querySelector(`#box1_${b.question}_${b.answer}`);
    if (!el) return;
    el.classList.toggle('ticked', !!S.review.decisions[boxKey(b)]);
    el.classList.toggle('uncertain', b.uncertain);
    el.classList.toggle('current', i === S.review.cursor);
  });
}

function reviewSet(i, value) {
  const rv = S.review;
  if (!rv || rv.loading || !rv.boxes[i]) return;
  rv.decisions[boxKey(rv.boxes[i])] = value;
  rv.cursor = i;
  renderMain(true); paintPageBoxes();
}
function reviewMove(step) {
  const rv = S.review;
  if (!rv || rv.loading) return;
  const idx = rv.boxes.map((b, i) => i).filter((i) => rv.showAll || rv.boxes[i].uncertain);
  if (!idx.length) return;
  const at = idx.indexOf(rv.cursor);
  rv.cursor = idx[Math.max(0, Math.min(idx.length - 1, (at < 0 ? 0 : at + step)))];
  renderMain(true); paintPageBoxes();
}
function reviewDone() {
  const rv = S.review;
  if (!rv || rv.loading) return;
  const decisions = rv.boxes.filter((b) => b.uncertain || rv.decisions[boxKey(b)] !== b.ticked)
    .map((b) => [b.question, b.answer, !!rv.decisions[boxKey(b)]]);
  socket_emit('ui-review-page', { student: rv.student, page: rv.page, copy: rv.copy, decisions });
  toast(`${pageName(rv)} checked.`);
}

/* ---------- Results: shared pieces ---------- */

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const fmtNum = (x) => (typeof x === 'number' && Number.isFinite(x) ? String(Math.round(x * 100) / 100) : '–');
const copyName = (s, c) => `Copy ${c ? `${s}·${c}` : s}`;
const sheetKey = (x) => `${x.student}/${x.copy}`;
const fold = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function showFile(path, title) {
  S.previewFile = { name: path, title, stamp: Date.now() };
  S.previewMode = null;
  if (!S.previewList || !S.previewList.items.some((x) => x.path === path)) S.previewList = null;
  openPreview();
}

function emptyStep(step, title, iconName, heading, text, target, button) {
  return `<div class="page">${header(step, title)}${guideBox(step)}
    <section class="card"><div class="empty"><div class="empty-icon">${ic(iconName)}</div><h2>${heading}</h2><p>${text}</p>
      <div class="btn-row"><a class="btn btn-primary" href="${examPath(S.project, target)}" data-nav>${button}</a></div></div></section></div>`;
}

/* What the final mark is out of: the "Out of" setting, or the raw points. */
function outOf() {
  const m = S.marks;
  if (!m) return null;
  const full = parseFloat(m.options.note_max);
  if (full > 0) return full;
  const maxes = [...new Set(m.rows.map((r) => r.max))];
  return maxes.length === 1 ? maxes[0] : null;
}

function markStats(rows) {
  const v = rows.map((r) => r.mark).filter((x) => typeof x === 'number').sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return { n: v.length, mean: v.reduce((a, b) => a + b, 0) / v.length, median: v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2, min: v[0], max: v[v.length - 1] };
}

function statsRow() {
  const s = S.marks && markStats(S.marks.rows);
  if (!s) return '';
  const full = outOf();
  const of = full ? ` <span class="subtle">/ ${fmtNum(full)}</span>` : '';
  return `<div class="stats" style="margin-bottom:16px">${stat(s.n, 'Copies marked', 'ok')}${stat(fmtNum(s.mean) + of, 'Mean')}${stat(fmtNum(s.median) + of, 'Median')}${stat(fmtNum(s.min), 'Lowest')}${stat(fmtNum(s.max), 'Highest')}</div>`;
}

function marksWhen() {
  const mi = S.status && S.status.marks_info;
  if (!mi || !mi.at) return '';
  return ` on ${fmtDate(mi.at)}${mi.by ? ' by ' + esc(mi.by) : ''}`;
}

/* "Out of date" banners: marks for Mark; marks, then the files, for Export and Annotate. */
function staleBanner(step) {
  const st = S.status || {};
  const mi = st.marks_info;
  if (mi && mi.stale) {
    const text = 'The marking scheme, answer key, final mark settings or scan checks changed after the marks were computed.';
    if (step === 'mark') return banner('warning', 'warning-triangle', 'The marks are out of date.', text, `<button class="btn btn-primary btn-sm" data-act="mark">${ic('refresh')} Recompute marks</button>`);
    return banner('warning', 'warning-triangle', 'The marks are out of date.', `${text} Compute them again before ${step === 'annotate' ? 'annotating' : 'exporting'}.`, `<a class="btn btn-sm" href="${examPath(S.project, 'mark')}" data-nav>Go to Mark</a>`);
  }
  if (step === 'export-marks' && st.exports_stale) return banner('warning', 'warning-triangle', 'The exported files are older than the latest marks or matches.', 'Export again to update them.');
  if (step === 'annotate' && st.annotated_stale) return banner('warning', 'warning-triangle', 'The annotated sheets are older than the latest marks, matches or settings.', 'Annotate again to update them.');
  return '';
}

/* ---------- View: mark ---------- */

function viewMark() {
  const st = S.status || {};
  if (!st.scans) return emptyStep('mark', 'Mark', 'clipboard-check', 'No scans yet', 'Marks are computed from the scanned answer sheets. Upload them first.', 'upload-scans', 'Go to Upload scans');
  const clear = !(st.failed || st.incomplete || st.to_check);
  const item = (n, ok, bad) => `<div class="checklist-item ${n ? 'warn' : 'ok'}">${ic(n ? 'warning-triangle' : 'check-circle')}<span>${n ? bad : ok}</span></div>`;
  const actions = clear
    ? `<button class="btn btn-primary" data-act="mark">${ic('calculator')} ${st.marked ? 'Recompute marks' : 'Compute marks'}</button>`
    : `<button class="btn" data-act="mark-anyway">Mark anyway…</button><a class="btn btn-primary" href="${examPath(S.project, 'check-scans')}" data-nav>Go to Check scans</a>`;
  const breaks = (S.marks && S.marks.rule_breaks) || [];
  return `<div class="page">
    ${header('mark', 'Mark', 'Compute each copy\'s mark from the scans and the marking scheme.',
    st.marked && !(st.marks_info && st.marks_info.stale) ? `<a class="btn btn-primary" href="${examPath(S.project, 'match-students')}" data-nav>Next: Match students ${ic('arrow-right')}</a>` : '')}
    ${guideBox('mark')}
    ${staleBanner('mark')}
    ${st.marked && !(st.marks_info && st.marks_info.stale) ? banner('success', 'check-circle', `Marks computed for ${plural(st.marked, 'copy', 'copies')}${marksWhen()}.`, 'Compute them again after changing the marking scheme, the answer key or a scan.') : ''}
    ${st.marked ? statsRow() : ''}
    <section class="card"><div class="card-header">${ic('clipboard-check')}<h2>Before marking</h2></div>
      <div class="card-body"><div class="checklist">
        ${item(st.failed, 'No unreadable pages', `${plural(st.failed, 'unreadable page', 'unreadable pages')}`)}
        ${item(st.incomplete, 'No missing pages', `${plural(st.incomplete, 'copy has', 'copies have')} missing pages`)}
        ${item(st.to_check, 'No pages left to check', `${plural(st.to_check, 'page', 'pages')} still to check`)}
        <div class="checklist-item ok">${ic('percentage-circle')}<span>Uses the latest <a href="${examPath(S.project, 'marking-scheme')}" data-nav>marking scheme</a> and answer key</span></div>
      </div>
      ${clear ? '' : '<p class="muted" style="margin-top:12px">Settle these in Check scans first, so every mark is based on what students really ticked.</p>'}</div>
      <div class="card-foot">${actions}</div></section>
    ${breaks.length ? ruleBreaksCard(breaks) : ''}
  </div>`;
}

function ruleBreaksCard(breaks) {
  const shown = breaks.slice(0, 200);
  return `<section class="card" style="margin-top:16px"><div class="card-header">${ic('warning-triangle')}<h2>Answers that break the rules</h2><span class="chip chip-warning">${breaks.length}</span></div>
    <p class="muted" style="padding:12px 16px 0">These answers don't follow the question's rules, for example two boxes ticked on a single-answer question. They are scored as an error (<code>e</code> in the marking scheme, 0 by default).</p>
    <div class="list">${shown.map((b) => `<div class="list-row"><span class="list-icon warn">${ic('warning-triangle')}</span>
      <div class="list-row-main"><div class="list-row-title">${copyName(b.student, b.copy)} · ${esc(b.title || 'Question ' + b.question)}</div>${b.page ? `<div class="subtle">Page ${b.page}</div>` : ''}</div>
      ${b.page ? `<button class="btn btn-sm" data-act="open-page" data-key="${b.student}/${b.page}/${b.copy}">Open the page</button>` : ''}</div>`).join('')}</div>
    <div class="card-foot" style="justify-content:flex-start"><span class="subtle">If a box was read wrongly, correct it in Check scans, then compute the marks again.</span></div></section>`;
}

async function markAnyway() {
  const st = S.status || {};
  const items = [];
  if (st.failed) items.push(`<li><b>${plural(st.failed, 'unreadable page', 'unreadable pages')}</b>: answers on ${st.failed === 1 ? 'it' : 'them'} are not counted.</li>`);
  if (st.incomplete) items.push(`<li><b>${plural(st.incomplete, 'copy', 'copies')} with missing pages</b>: marked from the pages that were read.</li>`);
  if (st.to_check) items.push(`<li><b>${plural(st.to_check, 'page', 'pages')} to check</b>: uncertain boxes count as AMC detected them.</li>`);
  const ok = await confirmDialog({
    icon: 'warning-triangle', title: 'Mark with problems left?',
    body: `<p>Check scans still has:</p><ul>${items.join('')}</ul><p class="subtle">You can settle them later and compute the marks again.</p>`,
    ok: 'Mark anyway',
  });
  if (ok) socket_emit('ui-mark', { anyway: true });
}

/* ---------- View: match students ---------- */

const MATCH_STATES = {
  auto: ['chip-success', 'Matched automatically'],
  manual: ['chip-brand', 'Matched by hand'],
  none: ['', 'Not in the class list'],
  unmatched: ['chip-warning', 'To match'],
};

function viewMatch() {
  const st = S.status || {};
  const d = S.students;
  if (!d) return `<div class="page">${header('match-students', 'Match students')}<div class="skeleton"></div></div>`;
  const L = d.list;
  const listOk = L && !L.error && L.key;
  const counts = { auto: 0, manual: 0, none: 0, unmatched: 0 };
  d.sheets.forEach((x) => { counts[x.state] += 1; });
  const done = d.sheets.length && !counts.unmatched;
  return `<div class="page">
    ${header('match-students', 'Match students', 'Link each answer sheet to a student in the class list.',
    done ? `<a class="btn btn-primary" href="${examPath(S.project, 'export-marks')}" data-nav>Next: Export marks ${ic('arrow-right')}</a>` : '')}
    ${guideBox('match-students')}
    ${done ? banner('success', 'check-circle', 'Every sheet is matched.', counts.none ? `${plural(counts.none, 'sheet is', 'sheets are')} marked as not in the class list.` : '') : ''}
    <div class="grid grid-2">${classListCard(d)}${autoMatchCard(d, st)}</div>
    ${d.sheets.length ? `<div class="stats" style="margin:16px 0">${stat(d.sheets.length, 'Sheets', 'ok')}${stat(counts.auto, 'Matched automatically', 'ok')}${stat(counts.manual, 'Matched by hand', 'ok')}${stat(counts.none, 'Not in the list')}${stat(counts.unmatched, 'To match', counts.unmatched ? 'warn' : 'ok')}</div>` : ''}
    ${d.sheets.length && listOk ? manualMatchCard(d) : ''}
    ${!d.sheets.length ? `<p class="subtle" style="margin-top:16px">${ic('info-circle')} Sheets appear here once scans are uploaded. You can load the class list now.</p>` : ''}
    ${counts.auto + counts.manual + counts.none ? `<details class="card" style="margin-top:16px"><summary class="card-header" style="cursor:pointer;border-bottom:0">${ic('settings')}<h2>Advanced</h2></summary>
      <div class="card-body" style="border-top:1px solid var(--border)"><div class="row"><span class="muted">Start again: remove every match, automatic and by hand.</span><span class="spacer"></span><button class="btn btn-danger btn-sm" data-act="match-clear">Remove all matches</button></div></div></details>` : ''}
  </div>`;
}

function classListCard(d) {
  const L = d.list;
  const fileInput = '<input type="file" id="list-file" accept=".csv,.txt,text/csv,text/plain" hidden>';
  if (!L) {
    return `<section class="card"><div class="card-header">${ic('group')}<h2>Class list</h2></div><div class="card-body">
      <label class="dropzone" id="list-drop" style="cursor:pointer;padding:22px">${ic('upload')}<div><strong>Choose the class list</strong> or drop it here</div>
        <div class="subtle">A CSV file: column names on the first line, then one student per line, for example <code>id,surname,name</code>.</div>${fileInput}</label>
    </div></section>`;
  }
  const unique = L.unique || [];
  return `<section class="card"><div class="card-header">${ic('group')}<h2>Class list</h2></div>
    <div class="card-body">
      <div class="row" style="gap:12px;align-items:flex-start"><span class="list-icon ${L.error ? 'bad' : 'brand'}">${ic('page')}</span>
        <div style="flex:1;min-width:0"><div class="list-row-title" style="overflow-wrap:anywhere">${esc(L.file)}</div>
          <div class="subtle">${L.error ? esc(L.error) : `${plural(L.count, 'student', 'students')} · columns: ${L.columns.map(esc).join(', ')}`}</div></div></div>
      <div class="btn-row" style="margin-top:12px">${L.error ? '' : '<button class="btn btn-sm" data-act="list-preview">' + ic('eye') + ' Preview</button>'}
        <label class="btn btn-sm">${ic('upload')} Replace${fileInput}</label>
        <button class="btn btn-ghost btn-sm" data-act="list-remove">${ic('trash')} Remove</button></div>
    </div>
    ${L.error ? '' : `<div class="card-body" style="border-top:1px solid var(--border)">${unique.length ? `<label class="field"><span class="field-label">Column with the student code</span>
      <select class="select" id="list-key">${L.key ? '' : '<option value="">Choose…</option>'}${unique.map((c) => `<option ${c === L.key ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <span class="field-hint">A different value for every student, such as a student number. Matches are kept by this column.</span></label>`
    : '<p class="muted">No column has a different, non-empty value for every student, so sheets can\'t be matched. Add a column with a unique code (a student number) and upload the list again.</p>'}</div>`}
  </section>`;
}

function autoMatchCard(d, st) {
  const L = d.list;
  let body;
  if (!L || L.error || !L.key) body = '<p class="muted">Load a class list with a student code column first.</p>';
  else if (!st.marked) body = `<p class="muted">Compute the marks first: AMC reads the codes students filled in on the sheets while marking.</p><div class="btn-row"><a class="btn btn-sm" href="${examPath(S.project, 'mark')}" data-nav>Go to Mark</a></div>`;
  else if (!d.codes.length) body = '<p class="muted">These papers have no student code boxes (<code>\\AMCcodeGrid</code>), so match the sheets by hand below, from the name written on each one.</p>';
  else {
    const label = (c) => (c === '<preassoc>' ? 'Names printed on the papers' : c);
    body = `<label class="field"><span class="field-label">Code on the answer sheet</span>
      <select class="select" id="assoc-code">${d.code ? '' : '<option value="">Choose…</option>'}${d.codes.map((c) => `<option value="${esc(c)}" ${c === d.code ? 'selected' : ''}>${esc(label(c))}</option>`).join('')}</select>
      <span class="field-hint">Compared with the class list's <b>${esc(L.key)}</b> column. Sheets matched by hand keep their match.</span></label>`;
  }
  const can = L && !L.error && L.key && st.marked && d.codes.length && d.code;
  return `<section class="card"><div class="card-header">${ic('sparks')}<h2>Automatic matching</h2></div><div class="card-body">${body}</div>
    ${can ? `<div class="card-foot"><button class="btn btn-primary" data-act="match-auto">${ic('sparks')} Match automatically</button></div>` : ''}</section>`;
}

function matchShown(d) {
  return S.matchFilter === 'all' ? d.sheets : d.sheets.filter((x) => x.state === 'unmatched');
}
function currentSheet(d) {
  const shown = matchShown(d);
  let cur = shown.find((x) => sheetKey(x) === S.matchSheet);
  if (!cur && S.matchFilter === 'all') cur = d.sheets.find((x) => sheetKey(x) === S.matchSheet);
  if (!cur) { cur = shown[0] || null; S.matchSheet = cur ? sheetKey(cur) : null; }
  return cur;
}

function manualMatchCard(d) {
  const shown = matchShown(d);
  const cur = currentSheet(d);
  const todo = d.sheets.filter((x) => x.state === 'unmatched').length;
  let pane;
  if (!cur) {
    pane = `<div class="empty" style="padding:28px"><div class="empty-icon">${ic('check-circle')}</div><h2>Nothing left to match</h2>
      <p>Every sheet is matched to a student or marked as not in the list.</p><div class="btn-row"><button class="btn btn-sm" data-act="match-filter" data-v="all">Show all sheets</button></div></div>`;
  } else {
    const [cls, label] = MATCH_STATES[cur.state];
    pane = `<div style="padding:14px 16px">
      <div class="row-between" style="margin-bottom:10px;flex-wrap:wrap;gap:8px"><strong>${copyName(cur.student, cur.copy)}</strong>
        <span class="chip ${cls}">${label}${cur.name ? ': ' + esc(cur.name) : ''}</span></div>
      <div class="namefield"><img class="namefield-img" src="/ui/namefield/${enc(S.project)}/${cur.student}/${cur.copy}?v=${S.status && S.status.scans}" alt="Name written on ${copyName(cur.student, cur.copy)}"></div>
      ${cur.code_read ? `<p class="subtle" style="margin:8px 0 0">Code read on the sheet: <b class="mono">${esc(cur.code_read)}</b>${cur.state === 'unmatched' ? ' (no student with this code)' : ''}</p>` : ''}
      <label class="sr-only" for="match-search">Find a student</label>
      <input class="input" id="match-search" style="margin-top:12px" placeholder="Type part of the name or code…" autocomplete="off" value="${esc(S.matchQuery)}">
      <div class="match-results" id="match-results" role="listbox" aria-label="Students">${matchResultsHtml(d)}</div>
      <div class="row" style="margin-top:10px;flex-wrap:wrap;gap:6px">
        <span class="subtle"><span class="kbd">↑</span><span class="kbd">↓</span> choose · <span class="kbd">Enter</span> match · <span class="kbd">Esc</span> clear</span><span class="spacer"></span>
        ${cur.manual !== null && cur.manual !== undefined ? `<button class="btn btn-ghost btn-sm" data-act="match-auto-back">${ic('undo')} Back to automatic</button>` : ''}
        <button class="btn btn-sm" data-act="match-none">${ic('user-xmark')} Not in the class list</button>
        ${shown.length > 1 ? `<button class="btn btn-ghost btn-sm" data-act="match-skip">Skip ${ic('nav-arrow-right')}</button>` : ''}
      </div></div>`;
  }
  return `<section class="card"><div class="card-header">${ic('user-square')}<h2>Match by hand</h2><span class="chip ${todo ? 'chip-warning' : 'chip-success'}">${todo ? `${todo} to match` : 'All matched'}</span>
      <span class="spacer"></span><div class="segmented" role="group" aria-label="Sheets shown"><button aria-pressed="${S.matchFilter === 'todo'}" data-act="match-filter" data-v="todo">To match</button><button aria-pressed="${S.matchFilter === 'all'}" data-act="match-filter" data-v="all">All sheets</button></div></div>
    <div class="review">
      <div class="review-list">${shown.map((x) => `<button class="review-item" aria-current="${cur && sheetKey(x) === sheetKey(cur)}" data-act="match-open" data-key="${sheetKey(x)}">
        <span class="ri-dot" style="background:${x.state === 'unmatched' ? 'var(--warning)' : x.state === 'none' ? 'var(--text-3)' : 'var(--success)'}"></span>
        <span><span class="ri-title">${copyName(x.student, x.copy)}</span><br><span class="subtle">${x.name ? esc(x.name) : MATCH_STATES[x.state][1]}</span></span></button>`).join('')}
        ${!shown.length ? '<p class="subtle" style="padding:12px">None.</p>' : ''}</div>
      <div>${pane}</div>
    </div></section>`;
}

function matchCandidates(d) {
  const q = fold(S.matchQuery).trim();
  let list = d.students;
  if (q) list = list.filter((x) => fold(x.name).includes(q) || fold(x.id).includes(q));
  // Students without a sheet yet come first: they are the likely ones.
  return [...list.filter((x) => !x.sheets.length), ...list.filter((x) => x.sheets.length)].slice(0, 60);
}

function matchResultsHtml(d) {
  const cands = matchCandidates(d);
  if (!d.students.length) return '<p class="subtle" style="padding:10px 12px">The class list has no students.</p>';
  if (!cands.length) return `<p class="subtle" style="padding:10px 12px">No student matches “${esc(S.matchQuery)}”.</p>`;
  S.matchCursor = Math.max(0, Math.min(S.matchCursor, cands.length - 1));
  const cur = currentSheet(d);
  return cands.map((x, i) => {
    const others = x.sheets.filter(([s, c]) => !cur || s !== cur.student || c !== cur.copy);
    const here = cur && x.sheets.some(([s, c]) => s === cur.student && c === cur.copy);
    return `<button class="match-item ${i === S.matchCursor ? 'is-current' : ''}" role="option" aria-selected="${i === S.matchCursor}" data-act="match-pick" data-id="${esc(x.id)}">
      <span class="match-name">${esc(x.name)}</span><span class="subtle mono">${esc(x.id)}</span>
      ${here ? '<span class="chip chip-success">This sheet</span>' : others.length ? `<span class="chip" title="Matching moves the student to this sheet">${others.map(([s, c]) => copyName(s, c)).join(', ')}</span>` : ''}</button>`;
  }).join('');
}

function renderMatchResults() {
  const host = $('#match-results');
  if (host && S.students) {
    host.innerHTML = matchResultsHtml(S.students);
    const curEl = host.querySelector('.is-current');
    if (curEl) curEl.scrollIntoView({ block: 'nearest' });
  }
}

/* Match the current sheet (id: a student, 'NONE', or null for the automatic match), then go to the next one. */
function matchTo(id) {
  const d = S.students;
  const cur = d && currentSheet(d);
  if (!cur) return;
  const todo = d.sheets.filter((x) => x.state === 'unmatched' && sheetKey(x) !== sheetKey(cur));
  const after = todo.find((x) => x.student > cur.student || (x.student === cur.student && x.copy > cur.copy)) || todo[0];
  if (S.matchFilter === 'todo' || id !== null) S.matchSheet = after ? sheetKey(after) : (S.matchFilter === 'all' ? sheetKey(cur) : null);
  S.matchQuery = ''; S.matchCursor = 0; S.matchFocus = true;
  const f = $('#match-search'); if (f) f.value = '';
  socket_emit('ui-match', { student: cur.student, copy: cur.copy, id });
}

async function uploadClassList(file) {
  try {
    await upload('/upload/students', [[file, file.name]]);
    socket_emit('ui-class-list-loaded');
    toast(`${file.name} loaded.`);
  } catch (err) { toast(err.message, 'warning-triangle'); }
}

async function changeListKey(sel) {
  const st = S.status || {};
  const n = (st.matched || 0) + (st.not_in_list || 0);
  let force = false;
  if (n) {
    force = await confirmDialog({ title: 'Use another code column?', body: `<p>The <b>${plural(n, 'match', 'matches')}</b> already made use the old column, so ${n === 1 ? 'it is' : 'they are'} removed.</p>`, ok: 'Change and remove matches', danger: true, icon: 'warning-triangle' });
    if (!force) { sel.value = S.students.list.key || ''; return; }
  }
  socket_emit('change-lkey', [sel.value, force]);
  toast('Saved.');
  setTimeout(() => { loadStudents(); refreshStatus(); }, 300);
}

/* ---------- View: export marks ---------- */

function viewExport() {
  const st = S.status || {};
  if (!st.marked) return emptyStep('export-marks', 'Export marks', 'table-rows', 'No marks yet', 'Compute the marks first, then match the sheets to students.', 'mark', 'Go to Mark');
  const m = S.marks;
  const x = S.exportInfo;
  return `<div class="page">
    ${header('export-marks', 'Export marks', 'Check the marks, then export them to a spreadsheet.')}
    ${guideBox('export-marks')}
    ${staleBanner('export-marks')}
    ${st.unmatched ? banner('info', 'info-circle', `${plural(st.unmatched, 'sheet isn\'t', 'sheets aren\'t')} matched to a student yet.`, 'They are exported by copy number, without a name.', `<a class="btn btn-sm" href="${examPath(S.project, 'match-students')}" data-nav>Go to Match students</a>`) : ''}
    ${m ? statsRow() : ''}
    <div class="grid grid-2" style="align-items:start">
      <section class="card"><div class="card-header">${ic('stats-report')}<h2>How the marks are spread</h2></div><div class="card-body">${m ? histogram(m.rows) : '<div class="skeleton" style="height:180px"></div>'}</div></section>
      ${x ? exportCard(x, st) : '<div class="skeleton"></div>'}
    </div>
    <section class="card" style="margin-top:16px"><div class="card-header">${ic('table-rows')}<h2>Marks</h2>
      <span class="spacer"></span><label class="sr-only" for="marks-search">Search the marks</label><input class="input input-sm" id="marks-search" style="max-width:240px" placeholder="Search name, code or copy…" value="${esc(S.marksQuery)}"></div>
      <div id="marks-table">${m ? marksTable(m.rows) : '<div class="skeleton" style="margin:16px"></div>'}</div></section>
    ${x ? publicLinkCard(x) : ''}
  </div>`;
}

/* A histogram of the final marks: one series, brand colour, rounded bar ends on the baseline. */
function histogram(rows) {
  const marks = rows.map((r) => r.mark).filter((v) => typeof v === 'number');
  const full = outOf();
  const low = parseFloat(S.marks.options.note_null) || 0;
  if (!marks.length) return '<p class="subtle">No marks yet.</p>';
  const hi = full > low ? full : Math.max(...marks);
  if (!(hi > low)) return '<p class="subtle">All marks are the same.</p>';
  const grain = parseFloat(S.marks.options.note_grain);
  let n = marks.length >= 40 ? 20 : 10;
  if (grain > 0) n = Math.max(1, Math.min(n, Math.round((hi - low) / grain)));
  const step = (hi - low) / n;
  const bins = Array.from({ length: n }, (_, i) => ({ lo: low + i * step, hi: low + (i + 1) * step, n: 0 }));
  marks.forEach((v) => { bins[Math.max(0, Math.min(n - 1, Math.floor((v - low) / step + 1e-9)))].n += 1; });
  const top = Math.max(1, ...bins.map((b) => b.n));
  const W = 340; const H = 170; const L = 26; const B = 22; const T = 10; const R = 6;
  const pw = W - L - R; const ph = H - T - B; const bw = pw / n;
  const y = (v) => T + ph - (v / top) * ph;
  const ticks = [...new Set([0, Math.ceil(top / 2), top])];
  const bar = (b, i) => {
    const x0 = L + i * bw + 1; const w = Math.max(1, bw - 2); const y0 = y(b.n); const h = T + ph - y0;
    const r = Math.min(4, w / 2, h);
    const path = h > 0 ? `M${x0},${T + ph}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x0 + w - r}Q${x0 + w},${y0} ${x0 + w},${y0 + r}V${T + ph}Z` : '';
    const label = `${fmtNum(b.lo)} to ${i === n - 1 ? fmtNum(b.hi) : '<' + fmtNum(b.hi)}: ${plural(b.n, 'copy', 'copies')}`;
    return `<g class="hist-col" data-tip="${esc(label)}"><rect class="hist-hit" x="${L + i * bw}" y="${T}" width="${bw}" height="${ph}"></rect>${path ? `<path class="hist-bar" d="${path}"></path>` : ''}</g>`;
  };
  const every = n > 10 ? 2 : 1;
  return `<div class="hist" id="hist"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Histogram of the marks: ${bins.map((b) => `${fmtNum(b.lo)}–${fmtNum(b.hi)}: ${b.n}`).join(', ')}">
    ${ticks.map((t) => `<line class="hist-grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"></line><text class="hist-label" x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${t}</text>`).join('')}
    ${bins.map(bar).join('')}
    ${bins.map((b, i) => (i % every === 0 ? `<text class="hist-label" x="${L + i * bw}" y="${H - 6}" text-anchor="middle">${fmtNum(b.lo)}</text>` : '')).join('')}
    <text class="hist-label" x="${W - R}" y="${H - 6}" text-anchor="end">${fmtNum(hi)}</text>
  </svg><div class="hist-tip" id="hist-tip" hidden></div></div>
  <p class="field-hint">Number of copies per mark range${full ? `, out of ${fmtNum(full)}` : ''}. Hover a bar for its count; the table below has every mark.</p>`;
}

const SORTERS = {
  copy: (r) => r.student * 10000 + r.copy,
  name: (r) => fold(r.name || '~'),
  id: (r) => fold(r.id || '~'),
  total: (r) => r.total,
  mark: (r) => r.mark,
};

function marksTable(rows) {
  const q = fold(S.marksQuery).trim();
  const { col, dir } = S.marksSort;
  let list = q ? rows.filter((r) => fold(r.name).includes(q) || fold(r.id).includes(q) || fold(copyName(r.student, r.copy)).includes(q)) : rows.slice();
  const key = SORTERS[col];
  list.sort((a, b) => { const ka = key(a); const kb = key(b); return (ka < kb ? -1 : ka > kb ? 1 : 0) * dir; });
  const th = (c, label, num = false) => `<th class="${num ? 'num' : ''}" aria-sort="${col === c ? (dir > 0 ? 'ascending' : 'descending') : 'none'}"><button class="th-sort" data-act="marks-sort" data-col="${c}">${label}${col === c ? ' ' + ic(dir > 0 ? 'nav-arrow-up' : 'nav-arrow-down') : ''}</button></th>`;
  const who = (r) => (r.name ? esc(r.name) : `<span class="subtle">${r.state === 'none' ? 'Not in the class list' : 'Not matched'}</span>`);
  if (!list.length) return `<p class="subtle" style="padding:16px">${q ? `Nothing matches “${esc(S.marksQuery)}”.` : 'No marks yet.'}</p>`;
  return `<div class="table-wrap" style="border:0;border-radius:0;max-height:480px"><table class="table"><thead><tr>${th('copy', 'Copy')}${th('name', 'Student')}${th('id', 'Code')}${th('total', 'Points', true)}${th('mark', 'Mark', true)}</tr></thead>
    <tbody>${list.map((r) => `<tr><td class="num">${r.copy ? `${r.student}·${r.copy}` : r.student}</td><td>${who(r)}</td><td class="mono">${esc(r.id || '')}</td>
      <td class="num">${fmtNum(r.total)} <span class="subtle">/ ${fmtNum(r.max)}</span></td><td class="num"><b>${fmtNum(r.mark)}</b></td></tr>`).join('')}</tbody></table></div>
    ${q ? `<p class="subtle" style="padding:8px 16px">${list.length} of ${rows.length} copies.</p>` : ''}`;
}

function exportCard(x, st) {
  const o = x.options;
  const csv = o.format_export === 'CSV';
  const sel = (opt, choices) => `<select class="select" data-option="${opt}">${choices.map(([v, l]) => `<option value="${v}" ${(o[opt] || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  return `<section class="card"><div class="card-header">${ic('download')}<h2>Export</h2></div><div class="card-body">
    <div class="segmented full" role="radiogroup" aria-label="File format" style="margin-bottom:6px"><button role="radio" aria-pressed="${csv}" aria-checked="${csv}" data-act="export-format" data-v="CSV">CSV</button><button role="radio" aria-pressed="${!csv}" aria-checked="${!csv}" data-act="export-format" data-v="ods">ODS</button></div>
    <p class="field-hint" style="margin-bottom:12px">${csv ? 'A plain table, for any spreadsheet or school system.' : 'A LibreOffice spreadsheet with the marks per question, and statistics if you want them.'}</p>
    <div class="form-grid">
      <label class="field"><span class="field-label">Order</span>${sel('export_sort', [['l', 'Class list order'], ['n', 'Name'], ['i', 'Copy number'], ['m', 'Mark, lowest first'], ['r', 'Mark, highest first']])}</label>
      ${csv ? `<label class="field"><span class="field-label">Ticked boxes</span>${sel('export_csv_ticked', [['', 'Not included'], ['01', 'Included as 0 and 1'], ['AB', 'Included as letters']])}</label>`
    : `<label class="field"><span class="field-label">Statistics</span>${sel('export_ods_stats', [['', 'None'], ['h', 'Table, across'], ['v', 'Table, down']])}</label>`}
    </div>
    <label class="check" style="margin-top:12px"><input type="checkbox" data-option="export_include_abs" ${isOn(o.export_include_abs) ? 'checked' : ''} ${st.students_list ? '' : 'disabled'}>
      <span>Include absent students<br><span class="subtle">${st.students_list ? 'Students in the class list without a sheet, with no mark.' : 'Needs a class list.'}</span></span></label>
    ${x.files.length ? `<div class="list" style="margin:14px -16px -16px;border-top:1px solid var(--border)">${x.files.map((f) => `<div class="list-row"><span class="list-icon brand">${ic('page')}</span>
      <div class="list-row-main"><div class="list-row-title">${esc(f.name)}</div><div class="subtle">${new Date(f.time * 1000).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${Math.max(1, Math.round(f.size / 1024))} KB</div></div>
      ${/\.csv$/i.test(f.name) ? `<button class="btn btn-sm" data-act="export-preview" data-file="${esc(f.name)}">Preview</button>` : ''}
      <a class="btn btn-sm btn-icon" href="${fsUrl('exports/' + f.name, true)}" download="${esc(S.project + '-' + f.name)}" title="Download ${esc(f.name)}" aria-label="Download ${esc(f.name)}">${ic('download')}</a></div>`).join('')}</div>` : ''}
  </div>
  <div class="card-foot"><button class="btn btn-primary" data-act="export">${ic('download')} Export as ${csv ? 'CSV' : 'ODS'}</button></div></section>`;
}

function publicLinkCard(x) {
  const on = isOn(x.options.app_public_marks);
  return `<details class="card" style="margin-top:16px" ${on ? 'open' : ''}><summary class="card-header" style="cursor:pointer;border-bottom:0">${ic('link')}<h2>Shareable marks link</h2>${on ? '<span class="chip chip-warning">On</span>' : ''}</summary>
    <div class="card-body" style="border-top:1px solid var(--border)">
      <label class="check"><input type="checkbox" data-option="app_public_marks" ${on ? 'checked' : ''}>
        <span>Turn on a link to this exam's marks<br><span class="subtle">For tools that import marks from an address. <b>Anyone with the link can see each student code and mark, without signing in.</b> It always shows the latest marks, for matched students only.</span></span></label>
      ${on && x.public_link ? `<div class="input-group" style="margin-top:12px"><input class="input mono" id="public-link" readonly value="${esc(x.public_link)}" aria-label="Shareable marks link"><button class="btn" data-act="copy-link">${ic('copy')} Copy</button></div>` : ''}
    </div></details>`;
}

/* AMC's yes/no options are "1" or empty. */
function isOn(v) { return !!v && v !== '0'; }

/* ---------- View: annotate ---------- */

const POSITIONS = [['marges', 'In both margins'], ['marge', 'In one margin'], ['case', 'Next to the boxes'], ['zones', 'Where the source places them'], ['none', 'Nowhere (header only)']];

function viewAnnotate() {
  const st = S.status || {};
  if (!st.marked) return emptyStep('annotate', 'Annotate', 'edit-pencil', 'No marks yet', 'Annotated sheets show each student\'s answers and marks. Compute the marks first.', 'mark', 'Go to Mark');
  const a = S.annotateInfo;
  if (!a) return `<div class="page">${header('annotate', 'Annotate')}<div class="skeleton"></div></div>`;
  const o = a.options;
  const single = o.regroupement_type === 'ALL';
  const rows = (S.marks && S.marks.rows) || [];
  const check = (opt, title, hint) => `<label class="check" style="margin-top:10px"><input type="checkbox" data-option="${opt}" ${isOn(o[opt]) ? 'checked' : ''}><span>${title}${hint ? `<br><span class="subtle">${hint}</span>` : ''}</span></label>`;
  return `<div class="page">
    ${header('annotate', 'Annotate', 'Make marked answer sheets to give back to students.',
    `<button class="btn btn-primary" data-act="annotate">${ic('edit-pencil')} Annotate all sheets</button>`)}
    ${guideBox('annotate')}
    ${staleBanner('annotate')}
    ${st.unmatched ? banner('info', 'info-circle', `${plural(st.unmatched, 'sheet isn\'t', 'sheets aren\'t')} matched to a student yet.`, 'Their files are named by copy number, without a name.', `<a class="btn btn-sm" href="${examPath(S.project, 'match-students')}" data-nav>Go to Match students</a>`) : ''}
    <div class="grid grid-2">
      <section class="card"><div class="card-header"><h2>On each sheet</h2></div><div class="card-body">
        <label class="field"><span class="field-label">Marks for each question</span><select class="select" data-option="annote_position">${POSITIONS.map(([v, l]) => `<option value="${v}" ${(o.annote_position || 'marges') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field" style="margin-top:12px"><span class="field-label">Header text</span><textarea class="textarea mono" rows="3" id="verdict" data-option="verdict" placeholder="${esc(a.default_verdict)}">${esc(o.verdict)}</textarea>
          <span class="field-hint">Written at the top of the first page. Empty: AMC's default. <code>%s</code> mark, <code>%m</code> out of, <code>%S</code> points, <code>%M</code> maximum points, <code>(ID)</code> the student's name.</span></label>
      </div></section>
      <section class="card"><div class="card-header"><h2>Files</h2></div><div class="card-body">
        <div class="segmented full" role="radiogroup" aria-label="Files"><button role="radio" aria-pressed="${!single}" aria-checked="${!single}" data-act="annotate-type" data-v="STUDENTS">One PDF per student</button><button role="radio" aria-pressed="${single}" aria-checked="${single}" data-act="annotate-type" data-v="ALL">One PDF for the class</button></div>
        ${single ? '' : `<label class="field" style="margin-top:12px"><span class="field-label">File names</span><input class="input mono" id="file-model" data-option="modele_regroupement" value="${esc(o.modele_regroupement)}" placeholder="(N)-(ID)">
          <span class="field-hint"><code>(N)</code> copy number, <code>(ID)</code> student name, or a class list column in brackets, such as <code>(surname)</code>.</span></label>`}
        ${check('add_corrected', 'Add the corrected question paper', 'Appended after each student\'s sheet.')}
        ${check('regroupement_compose', 'Add question paper pages where needed', 'For exams with a separate answer sheet: pages without boxes come from the question paper.')}
        ${single ? '' : check('annotate_dont_overwrite', 'Keep sheets already made', 'Only make the missing ones.')}
      </div></section>
    </div>
    <section class="card" style="margin-top:16px"><div class="card-header">${ic('eye')}<h2>Preview one student</h2></div><div class="card-body">
      <div class="row" style="flex-wrap:wrap;gap:8px"><label class="sr-only" for="annot-copy">Sheet</label>
        <select class="select" id="annot-copy" style="max-width:360px">${rows.map((r) => `<option value="${r.student}/${r.copy}">${copyName(r.student, r.copy)}${r.name ? ' · ' + esc(r.name) : ''}</option>`).join('')}</select>
        <button class="btn" data-act="annotate-preview" ${rows.length ? '' : 'disabled'}>${ic('eye')} Preview</button></div>
      <p class="field-hint" style="margin-top:8px">Makes this student's sheet with the settings above and shows it on the right. The real annotated sheets aren't touched.</p>
    </div></section>
    ${annotatedCard(a)}
  </div>`;
}

function annotatedCard(a) {
  if (!a.files.length) return '';
  const all = a.files.find((f) => f.all);
  const per = a.files.filter((f) => !f.all);
  const zip = `/fs/${enc(S.project)}/cr/corrections/pdf?filename=${enc(S.project + '-annotated.zip')}&exclude=all-students.pdf`;
  return `<section class="card" style="margin-top:16px"><div class="card-header">${ic('multiple-pages')}<h2>Annotated sheets</h2><span class="chip">${per.length + (all ? 1 : 0)}</span>
    <span class="spacer"></span>${per.length ? `<a class="btn btn-sm" href="${zip}">${ic('download')} Download all (zip)</a>` : ''}</div>
    <div class="table-wrap" style="border:0;border-radius:0;max-height:420px"><table class="table"><thead><tr><th>Sheet</th><th>Student</th><th>File</th><th></th></tr></thead><tbody>
    ${a.files.map((f, i) => `<tr><td>${f.all ? 'Whole class' : f.student ? copyName(f.student, f.copy) : ''}</td><td>${f.name ? esc(f.name) : ''}</td><td class="mono" style="word-break:break-all">${esc(f.file)}</td>
      <td style="text-align:right;white-space:nowrap"><button class="btn btn-sm" data-act="annotated-open" data-i="${i}">Preview</button> <a class="btn btn-sm btn-ghost" href="${fsUrl('cr/corrections/pdf/' + f.file, true)}" title="Download" aria-label="Download ${esc(f.file)}">${ic('download')}</a></td></tr>`).join('')}
    </tbody></table></div></section>`;
}

function openAnnotated(i) {
  const files = (S.annotateInfo && S.annotateInfo.files) || [];
  S.previewList = {
    items: files.map((f) => ({ path: `cr/corrections/pdf/${f.file}`, title: f.all ? 'Whole class' : `${f.student ? copyName(f.student, f.copy) : f.file}${f.name ? ' · ' + f.name : ''}` })),
    i,
  };
  const it = S.previewList.items[i];
  S.previewFile = { name: it.path, title: it.title, stamp: Date.now() };
  S.previewMode = null;
  openPreview();
}
function previewListGo(i) {
  const pl = S.previewList;
  if (!pl || !pl.items[i]) return;
  pl.i = i;
  S.previewFile = { name: pl.items[i].path, title: pl.items[i].title, stamp: Date.now() };
  renderPreview();
}

/* ---------- Dialogs, toasts, progress ---------- */

let dialogResolve = null;
function openDialog(html, { server = false } = {}) {
  $('#layer').innerHTML = `<div class="backdrop" data-act="dialog-backdrop">
    <div class="dialog ${server ? 'server-dialog' : ''}" role="dialog" aria-modal="true" aria-labelledby="dlg-title">${html}</div></div>`;
  const first = $('#layer').querySelector('input, select, .dialog-foot .btn-primary, .dialog-foot .btn-danger, .btn');
  if (first) first.focus();
}
function closeDialog(result = false) {
  $('#layer').innerHTML = '';
  if (dialogResolve) { const r = dialogResolve; dialogResolve = null; r(result); }
}
function showServerDialog(html) {
  openDialog(`<h2 id="dlg-title" class="sr-only">Message</h2><div class="dialog-body">${html}</div>`, { server: true });
}
function confirmDialog({ title, body, ok = 'OK', cancel = 'Cancel', danger = false, icon = 'info-circle' }) {
  return new Promise((resolve) => {
    openDialog(`<div class="dialog-head"><span class="dialog-icon ${danger ? 'danger' : 'brand'}">${ic(icon)}</span><div><h2 id="dlg-title">${title}</h2></div></div>
      <div class="dialog-body">${body}</div>
      <div class="dialog-foot"><button class="btn" data-act="dialog-cancel">${cancel}</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="dialog-ok">${ok}</button></div>`);
    dialogResolve = resolve;
  });
}
function formDialog({ title, body, ok, icon = 'edit-pencil', validate }) {
  return new Promise((resolve) => {
    openDialog(`<form id="dlg-form" novalidate><div class="dialog-head"><span class="dialog-icon brand">${ic(icon)}</span><div><h2 id="dlg-title">${title}</h2></div></div>
      <div class="dialog-body">${body}<p class="field-hint" id="dlg-error" style="color:var(--danger);margin-top:8px"></p></div>
      <div class="dialog-foot"><button type="button" class="btn" data-act="dialog-cancel">Cancel</button><button type="submit" class="btn btn-primary">${ok}</button></div></form>`);
    dialogResolve = resolve;
    $('#dlg-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target).entries());
      const err = validate ? validate(data) : '';
      if (err) { $('#dlg-error').textContent = err; return; }
      closeDialog(data);
    });
  });
}
const confirmLeave = () => confirmDialog({ title: 'Leave without saving?', body: '<p>Your changes to the questions haven\'t been saved.</p>', ok: 'Leave without saving', danger: true, icon: 'warning-triangle' });

function toast(msg, iconName = 'check-circle') {
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `${ic(iconName)}<span>${esc(msg)}</span>`;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

function renderWork() {
  let w = $('#work');
  if (!S.work) { if (w) w.remove(); return; }
  if (!w) { w = document.createElement('div'); w.id = 'work'; w.className = 'work'; w.setAttribute('role', 'alertdialog'); w.setAttribute('aria-live', 'polite'); document.body.appendChild(w); }
  const p = S.work.p;
  w.innerHTML = `<div class="work-card"><div class="work-title"><span class="spinner"></span>${esc(S.work.text)}</div>
    <div class="progress ${p === null || p === undefined ? 'indeterminate' : ''}"><span style="width:${Math.round((p || 0) * 100)}%"></span></div></div>`;
}

/* ---------- Exam actions ---------- */

const validName = (names, current = null) => (d) => {
  const n = (d.name || '').trim();
  if (!n) return 'Give the exam a name.';
  if (/[\\/]/.test(n) || n === '.' || n === '..') return 'A name can\'t contain / or \\.';
  if (n !== current && names.includes(n)) return 'An exam with this name already exists.';
  return '';
};

async function newExam() {
  const t = await loadTemplates();
  const names = (S.projects || []).map((p) => p.name);
  const groupTitle = (gid) => (t.groups.find((g) => g.id === gid) || {}).title || gid;
  const gids = [...new Set(t.templates.map((x) => x.gid))];
  const options = gids.map((g) => `<optgroup label="${esc(groupTitle(g))}">${t.templates.filter((x) => x.gid === g).map((x) => `<option value="${esc(x.gid + '/' + x.id)}">${esc(x.title || x.id)}</option>`).join('')}</optgroup>`).join('');
  const data = await formDialog({
    title: 'New exam', ok: 'Create exam', icon: 'plus',
    body: `<label class="field"><span class="field-label">Name</span><input class="input" name="name" autocomplete="off" placeholder="Physics mid-term 10B"></label>
      <label class="field"><span class="field-label">Start from</span><select class="select" name="from">
        <option value="empty:latex">An empty LaTeX file</option><option value="empty:plain">An empty plain-text file (AMC-TXT)</option>
        ${options}</select><span class="field-hint">Templates are AMC's examples. A gallery with previews comes later.</span></label>`,
    validate: validName(names),
  });
  if (!data) return;
  const name = data.name.trim();
  S.creating = name;
  if (data.from.startsWith('empty:')) socket_emit('create-project-empty', [name, data.from.slice(6)]);
  else socket_emit('create-project-template', [name, data.from]);
}

async function renameExam(old) {
  const names = (S.projects || []).map((p) => p.name);
  const data = await formDialog({
    title: `Rename "${esc(old)}"`, ok: 'Rename',
    body: `<label class="field"><span class="field-label">New name</span><input class="input" name="name" value="${esc(old)}" autocomplete="off"></label>`,
    validate: validName(names, old),
  });
  if (!data || data.name.trim() === old) return;
  socket_emit('project-rename', [old, data.name.trim()]);
}

async function deleteExam(name) {
  const ok = await confirmDialog({
    danger: true, icon: 'trash', title: `Delete "${esc(name)}"?`,
    body: '<p>The exam is removed with its questions, scans, marks and exported files. This can\'t be undone.</p><p class="subtle">Download it first if you might need it again.</p>',
    ok: 'Delete exam',
  });
  if (!ok) return;
  socket_emit('project-delete', name);
  if (S.route.kind === 'exam' && S.route.name === name) navigate('/exams');
  else setTimeout(loadProjects, 300);
}

/* ---------- Events ---------- */

function applyTheme() {
  if (S.theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', S.theme);
}

const ACTIONS = {
  theme: () => { S.theme = { auto: 'light', light: 'dark', dark: 'auto' }[S.theme]; store.set('theme', S.theme); applyTheme(); renderTop(); },
  menu: (el) => { const m = el.dataset.menu; S.menu = S.menu === m ? null : m; renderTop(); if (S.route.kind === 'exams') renderMain(true); },
  'toggle-preview': () => { S.previewOpen = !S.previewOpen; S.previewMax = false; store.set('previewOpen', S.previewOpen); renderTop(); renderPreview(); resizeEditor(); },
  'preview-max': () => { S.previewMax = !S.previewMax; renderPreview(); resizeEditor(); },
  'preview-docs': () => { S.previewFile = null; S.previewMode = null; S.previewList = null; renderPreview(); },
  'show-doc': (el) => { S.previewDoc = el.dataset.doc; S.previewFile = null; S.previewMode = null; if (!S.previewOpen) { S.previewOpen = true; store.set('previewOpen', true); renderTop(); } renderPreview(); },
  unlock: () => unlockExam(),
  'save-scoring': () => {
    const value = (kind) => { const sel = $(`#score-${kind}-preset`).value; return sel === 'custom' ? $(`#score-${kind}-custom`).value.trim() : sel; };
    socket_emit('ui-scoring-defaults', { S: value('S'), M: value('M') });
  },
  'build-papers': () => buildPapers(),
  'build-doc': (el) => { S.buildQueue = []; S.buildError = false; socket_emit('doc-update', el.dataset.doc); },
  'show-layout': () => showLayout(),
  'layout-step': (el) => { if (S.layoutPage) socket_emit('layout-add', [S.layoutPage.page, parseInt(el.dataset.delta, 10)]); },
  'layout-ok': () => socket_emit('ui-layout-ok'),
  'layout-help': () => openDialog(`<div class="dialog-head"><span class="dialog-icon brand">${ic('help-circle')}</span><div><h2 id="dlg-title">When the layout looks wrong</h2></div></div>
    <div class="dialog-body"><ul>
      <li><b>A box isn't outlined:</b> it was drawn without AMC's commands (for example an image of a box). Use <code>\\correctchoice</code> and <code>\\wrongchoice</code>.</li>
      <li><b>Outlines are shifted:</b> the LaTeX engine or a package changes the page after AMC places the marks. Try pdflatex in Exam settings, then rebuild.</li>
      <li><b>Corner marks missing:</b> something covers the page corners, such as a header image. Keep the corners clear.</li>
      <li><b>Material outside the page:</b> a question group starts too close to the bottom; add <code>\\needspace</code> or a page break.</li>
    </ul><p class="subtle">Fix the source in Questions, then build the papers again.</p></div>
    <div class="dialog-foot"><a class="btn" href="${examPath(S.project, 'questions')}" data-nav data-act="dialog-ok">Go to Questions</a><button class="btn btn-primary" data-act="dialog-ok">OK</button></div>`),
  'print-route': (el) => {
    if (el.dataset.route === 'printer' && !(S.printers && S.printers.available)) { toast('Direct printing needs a Linux shared machine with its printer connected. Save the PDFs instead.', 'info-circle'); return; }
    S.printRoute = el.dataset.route; renderMain(true);
  },
  print: () => printPapers(),
  'failed-view': (el) => { const f = S.scans.failed[+el.dataset.i]; S.previewImage = { url: fsUrl(f.local), title: f.file }; S.previewMode = 'image'; openPreview(); },
  'failed-diagnose': (el) => { const f = S.scans.failed[+el.dataset.i]; socket_emit('failed-pre-process', f.path); toast('Looking at the page as AMC sees it…', 'page-search'); },
  'failed-remove': async (el) => {
    const f = S.scans.failed[+el.dataset.i];
    const ok = await confirmDialog({ title: 'Remove this page?', body: `<p><b>${esc(f.file)}</b> is taken off the list of unreadable pages. Upload a better scan if the page belongs to this exam.</p>`, ok: 'Remove', danger: true, icon: 'trash' });
    if (ok) socket_emit('failed-delete', f.path);
  },
  'review-open': (el) => openReview(el.dataset.key),
  'review-cursor': (el) => { if (S.review) { S.review.cursor = +el.dataset.i; renderMain(true); paintPageBoxes(); } },
  'review-set': (el) => reviewSet(+el.dataset.i, el.dataset.v === '1'),
  'review-all': () => { if (S.review) { S.review.showAll = !S.review.showAll; renderMain(true); } },
  'review-page-view': () => { S.previewMode = 'page'; openPreview(); },
  'review-done': () => reviewDone(),
  'review-revert': async () => {
    const rv = S.review;
    const ok = await confirmDialog({ title: 'Go back to what was detected?', body: '<p>Your decisions on this page are removed, and the page goes back to the list of pages to check if it has uncertain boxes.</p>', ok: 'Back to detected', icon: 'undo' });
    if (ok) { socket_emit('revert-manual', [rv.student, rv.page, rv.copy]); setTimeout(() => loadScans().then(() => openReview(rv.key)), 400); }
  },
  'accept-rest': async () => {
    const n = S.scans.pages.filter((p) => p.to_check).length;
    const ok = await confirmDialog({ title: `Accept ${n} pages as detected?`, body: '<p>The uncertain boxes on these pages count as AMC detected them. You can still open any page later and change it.</p>', ok: 'Accept as detected', icon: 'check-circle' });
    if (ok) socket_emit('ui-accept-detected', {});
  },
  'delete-page': async (el) => {
    const [student, page, copy] = el.dataset.key.split('/').map(Number);
    const ok = await confirmDialog({ title: `Delete the scan of ${pageName({ student, page, copy })}?`, body: '<p>What was read on this page is removed. Upload the page again if you need it.</p>', ok: 'Delete', danger: true, icon: 'trash' });
    if (ok) { socket_emit('delete-scans', [{ student, page, copy }]); if (S.review && S.review.key === el.dataset.key) S.review = null; }
  },
  'mark-printed': () => markPrinted(),
  mark: () => socket_emit('ui-mark', {}),
  'q-answer': (el) => toggleAnswer(el.dataset.title, +el.dataset.answer),
  'q-edit': (el) => editQuestion(el.dataset.title),
  'q-restore': (el) => socket_emit('ui-question-edit', { title: el.dataset.title, action: 'neutral', how: 'off' }),
  'scale-refresh': () => socket_emit('ui-scale-refresh'),
  'mark-anyway': () => markAnyway(),
  'open-page': (el) => { S.pendingReview = el.dataset.key; navigate(examPath(S.project, 'check-scans')); },
  'list-preview': () => { const f = S.students.list.file; showFile(f, `Class list · ${f}`); },
  'list-remove': async () => {
    const st = S.status || {};
    const n = (st.matched || 0) + (st.not_in_list || 0);
    const ok = await confirmDialog({ title: 'Remove the class list?', body: `<p>The file is deleted from the exam${n ? `, and the <b>${plural(n, 'match', 'matches')}</b> between sheets and students ${n === 1 ? 'is' : 'are'} removed` : ''}.</p>`, ok: 'Remove', danger: true, icon: 'trash' });
    if (ok) socket_emit('ui-class-list-remove');
  },
  'match-auto': () => socket_emit('ui-match-auto'),
  'match-filter': (el) => { S.matchFilter = el.dataset.v; S.matchQuery = ''; S.matchCursor = 0; renderMain(true); },
  'match-open': (el) => { S.matchSheet = el.dataset.key; S.matchQuery = ''; S.matchCursor = 0; S.matchFocus = true; const f = $('#match-search'); if (f) f.value = ''; renderMain(true); },
  'match-pick': (el) => matchTo(el.dataset.id),
  'match-none': () => matchTo('NONE'),
  'match-auto-back': () => matchTo(null),
  'match-skip': () => {
    const shown = matchShown(S.students);
    const i = shown.findIndex((x) => sheetKey(x) === S.matchSheet);
    S.matchSheet = sheetKey(shown[(i + 1) % shown.length]); S.matchQuery = ''; S.matchCursor = 0; S.matchFocus = true;
    const f = $('#match-search'); if (f) f.value = '';
    renderMain(true);
  },
  'match-clear': async () => {
    const ok = await confirmDialog({ title: 'Remove all matches?', body: '<p>Every sheet goes back to unmatched, including the ones matched by hand. Automatic matching can be run again.</p>', ok: 'Remove all matches', danger: true, icon: 'trash' });
    if (ok) socket_emit('ui-match-clear');
  },
  'marks-sort': (el) => {
    const c = el.dataset.col;
    S.marksSort = { col: c, dir: S.marksSort.col === c ? -S.marksSort.dir : (c === 'mark' || c === 'total' ? -1 : 1) };
    const host = $('#marks-table'); if (host && S.marks) host.innerHTML = marksTable(S.marks.rows);
  },
  'export-format': (el) => { socket_emit('set-config', ['format_export', el.dataset.v]); if (S.exportInfo) S.exportInfo.options.format_export = el.dataset.v; renderMain(true); },
  export: () => socket_emit('ui-export'),
  'export-preview': (el) => showFile(`exports/${el.dataset.file}`, `Exported marks · ${el.dataset.file}`),
  'copy-link': async () => {
    const v = $('#public-link').value;
    try { await navigator.clipboard.writeText(v); toast('Link copied.'); } catch { $('#public-link').select(); toast('Select the link and copy it.', 'info-circle'); }
  },
  'annotate-type': (el) => { socket_emit('set-config', ['regroupement_type', el.dataset.v]); if (S.annotateInfo) S.annotateInfo.options.regroupement_type = el.dataset.v; renderMain(true); },
  annotate: () => socket_emit('ui-annotate'),
  'annotate-preview': () => {
    const v = $('#annot-copy') && $('#annot-copy').value;
    if (!v) return;
    const [student, copy] = v.split('/').map(Number);
    socket_emit('ui-annotate-preview', { student, copy });
  },
  'annotated-open': (el) => openAnnotated(+el.dataset.i),
  'plist-step': (el) => { if (S.previewList) previewListGo(S.previewList.i + parseInt(el.dataset.delta, 10)); },
  'guide-toggle': (el) => { const k = el.dataset.step; S.guide[k] = !S.guide[k]; store.set('guide', S.guide); const g = el.closest('.guide'); g.classList.toggle('is-collapsed', S.guide[k]); el.setAttribute('aria-expanded', !S.guide[k]); resizeEditor(); },
  'new-exam': () => newExam(),
  'rename-exam': (el) => { S.menu = null; renameExam(el.dataset.name); },
  'clone-exam': (el) => { S.menu = null; socket_emit('project-clone', el.dataset.name); },
  'delete-exam': (el) => { S.menu = null; deleteExam(el.dataset.name); },
  'rename-current': () => {
    const n = $('#cfg-name').value.trim();
    const err = validName((S.projects || []).map((p) => p.name), S.project)({ name: n });
    if (err) { toast(err, 'warning-triangle'); return; }
    if (n !== S.project) socket_emit('project-rename', [S.project, n]);
  },
  save: () => saveSource(),
  revert: async () => {
    if (await confirmDialog({ title: 'Revert your changes?', body: '<p>Go back to the last saved version of this file.</p>', ok: 'Revert', danger: true, icon: 'undo' })) setEditorText(S.source.text);
  },
  build: () => buildPreview(),
  'dialog-ok': () => closeDialog(true),
  'dialog-cancel': () => closeDialog(false),
};

document.addEventListener('click', (e) => {
  const nav = e.target.closest('a[data-nav]');
  if (nav && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
    e.preventDefault();
    if (nav.closest('#layer')) closeDialog(false);
    navigate(nav.getAttribute('href'));
    return;
  }
  const svgBox = e.target.closest && e.target.closest('#page-svg [id^="box1_"]');
  if (svgBox && S.review && !S.review.loading) {
    const i = S.review.boxes.findIndex((b) => `box1_${b.question}_${b.answer}` === svgBox.id);
    if (i >= 0) reviewSet(i, !S.review.decisions[boxKey(S.review.boxes[i])]);
    return;
  }
  const el = e.target.closest('[data-act]');
  if (S.menu && !e.target.closest('.menu') && !(el && el.dataset.act === 'menu')) {
    S.menu = null; renderTop(); if (S.route.kind === 'exams') renderMain(true);
  }
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'dialog-backdrop') { if (e.target === el && !el.querySelector('.server-dialog')) closeDialog(false); return; }
  if (ACTIONS[act]) { e.preventDefault(); ACTIONS[act](el); }
});

document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.id === 'file-select' && t.value !== S.source.name) {
    if (S.source.dirty && !(await confirmLeave())) { t.value = S.source.name; return; }
    S.source.loaded = false; S.source.dirty = false; loadSource(t.value);
  }
  if (t.id === 'other-file' && t.value) { S.previewFile = { name: t.value }; S.previewOpen = true; t.value = ''; renderTop(); renderPreview(); }
  if (t.id === 'add-file' && t.files[0]) {
    const f = t.files[0];
    try { await upload('/upload/project', [[f, f.name]]); toast(`${f.name} added to the exam.`); loadFiles(); }
    catch (err) { toast(err.message, 'warning-triangle'); }
    t.value = '';
  }
  if (t.id === 'cfg-engine') { socket_emit('set-config', ['moteur_latex_b', t.value]); toast('LaTeX engine saved.'); }
  if (t.matches('[data-option]')) {
    const name = t.dataset.option;
    const v = t.type === 'checkbox' ? (t.checked ? '1' : '') : t.value;
    socket_emit('set-config', [name, v]);
    [S.config, S.exportInfo, S.annotateInfo].forEach((x) => { if (x && x.options && name in x.options) x.options[name] = v; });
    toast('Saved.');
    if (name === 'app_public_marks') setTimeout(loadExport, 300);
    if (S.route.step === 'annotate' || S.route.step === 'export-marks') setTimeout(refreshStatus, 300);
  }
  if (t.id === 'list-file' && t.files[0]) { uploadClassList(t.files[0]); t.value = ''; }
  if (t.id === 'list-key' && t.value) changeListKey(t);
  if (t.id === 'assoc-code' && t.value) { socket_emit('change-acode', t.value); if (S.students) S.students.code = t.value; renderMain(true); toast('Saved.'); }
  if (t.id === 'plist-select') previewListGo(+t.value);
  if (/^score-[SM]-preset$/.test(t.id)) $(`#score-${t.id[6]}-custom-field`).classList.toggle('hidden', t.value !== 'custom');
  if (t.id === 'scan-files' && t.files.length) { uploadScans(t.files); t.value = ''; }
  if (t.id === 'scan-photocopy') { socket_emit('scans-mode-change', t.checked ? 1 : 0); if (S.scans) S.scans.photocopy = t.checked; renderMain(true); }
  if (t.id === 'seuil' || t.id === 'seuil_up') {
    const v = parseFloat(t.value);
    if (!(v >= 0 && v <= 1)) { toast('Use a value between 0 and 1.', 'warning-triangle'); return; }
    socket_emit('set-config', [t.id, String(v)]);
    toast('Saved. Pages to check are updated.');
    setTimeout(() => { loadScans(); refreshStatus(); }, 300);
  }
  if (t.id === 'copies') {
    const n = t.value.trim() === '' ? 0 : parseInt(t.value, 10); // 0: as in the source
    if (!(n >= 0)) { toast('Enter a number of copies, or leave it empty.', 'warning-triangle'); return; }
    socket_emit('ncopies', n);
    if (S.status) S.status.copies = String(n);
    toast(S.status && S.status.layout_pages ? 'Saved. Build the papers again to apply it.' : 'Saved.');
  }
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'match-search') { S.matchQuery = t.value; S.matchCursor = 0; renderMatchResults(); }
  if (t.id === 'marks-search') { S.marksQuery = t.value; const host = $('#marks-table'); if (host && S.marks) host.innerHTML = marksTable(S.marks.rows); }
});

document.addEventListener('keydown', (e) => {
  if (e.target instanceof Element && e.target.id === 'match-search' && !$('#layer').innerHTML) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); S.matchCursor += e.key === 'ArrowDown' ? 1 : -1; renderMatchResults(); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const c = S.students && matchCandidates(S.students)[S.matchCursor];
      if (c) matchTo(c.id);
      return;
    }
    if (e.key === 'Escape' && e.target.value) { e.preventDefault(); e.target.value = ''; S.matchQuery = ''; S.matchCursor = 0; renderMatchResults(); return; }
  }
  if (e.key === 'Escape') {
    if ($('#layer').innerHTML && !$('#layer .server-dialog')) closeDialog(false);
    else if (S.menu) { S.menu = null; renderTop(); if (S.route.kind === 'exams') renderMain(true); }
  }
  const typingNow = e.target instanceof Element && e.target.closest('input, textarea, select, .ace_editor');
  if (S.route.step === 'check-scans' && S.review && !S.review.loading && !typingNow && !$('#layer').innerHTML && !e.metaKey && !e.ctrlKey && !e.altKey) {
    const k = e.key.toLowerCase();
    if (k === 't' || k === 'n') { e.preventDefault(); reviewSet(S.review.cursor, k === 't'); reviewMove(1); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); reviewMove(1); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); reviewMove(-1); return; }
    if (e.key === 'Enter' && !(e.target instanceof Element && e.target.closest('button, a'))) { e.preventDefault(); reviewDone(); return; }
  }
  // The editor handles its own Ctrl/Cmd+S.
  if ((e.metaKey || e.ctrlKey) && e.key === 's' && S.route.step === 'questions' && !(e.target.closest && e.target.closest('.ace_editor'))) { e.preventDefault(); saveSource(); }
});

/* Drag and drop scans, or the class list, onto their upload areas */
const dropZone = (e) => e.target.closest && e.target.closest('#scan-drop, #list-drop');
document.addEventListener('dragover', (e) => { const z = dropZone(e); if (z) { e.preventDefault(); z.classList.add('is-over'); } });
document.addEventListener('dragleave', (e) => { const z = dropZone(e); if (z) z.classList.remove('is-over'); });
document.addEventListener('drop', (e) => {
  const z = dropZone(e);
  if (!z) return;
  e.preventDefault(); z.classList.remove('is-over');
  const files = e.dataTransfer ? e.dataTransfer.files : [];
  if (!files.length) return;
  if (z.id === 'scan-drop') uploadScans(files); else uploadClassList(files[0]);
});

/* Histogram tooltips */
document.addEventListener('mousemove', (e) => {
  const tip = $('#hist-tip');
  if (!tip) return;
  const col = e.target.closest && e.target.closest('.hist-col');
  if (!col) { tip.hidden = true; return; }
  const box = $('#hist').getBoundingClientRect();
  tip.textContent = col.dataset.tip;
  tip.hidden = false;
  tip.style.left = `${Math.min(box.width - tip.offsetWidth, Math.max(0, e.clientX - box.left - tip.offsetWidth / 2))}px`;
  tip.style.top = `${e.clientY - box.top - tip.offsetHeight - 10}px`;
});

/* A sheet without a readable name field */
document.addEventListener('error', (e) => {
  if (e.target instanceof HTMLImageElement && e.target.classList.contains('namefield-img')) {
    e.target.outerHTML = '<p class="subtle namefield-none">No name field was read on this sheet.</p>';
  }
}, true);

/* Preview panel resizing */
document.addEventListener('pointerdown', (e) => {
  const handle = e.target.closest('.preview-resizer');
  if (!handle) return;
  e.preventDefault();
  handle.classList.add('is-dragging');
  handle.setPointerCapture(e.pointerId);
  const frames = document.querySelectorAll('iframe');
  frames.forEach((f) => { f.style.pointerEvents = 'none'; });
  const move = (ev) => {
    S.previewW = Math.round(Math.max(320, Math.min(window.innerWidth * 0.7, window.innerWidth - ev.clientX)));
    APP.style.setProperty('--preview-w', S.previewW + 'px');
    resizeEditor();
  };
  const up = () => {
    handle.classList.remove('is-dragging');
    frames.forEach((f) => { f.style.pointerEvents = ''; });
    store.set('previewW', S.previewW);
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', up);
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', up);
});

function resizeEditor() { if (editor) requestAnimationFrame(() => editor.resize()); }
window.addEventListener('resize', resizeEditor);

/* ---------- Start ---------- */

applyTheme();
onRoute();
