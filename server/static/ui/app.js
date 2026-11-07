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
  remove(k) { try { localStorage.removeItem('amc-ui:' + k); } catch { /* private mode */ } },
};
const APP = document.getElementById('app');
const USER = APP.dataset.user || '';
const VERSION = APP.dataset.version || '';
const SCHOOL = APP.dataset.school || '';      // Appearance: the school's name
const LOGO = APP.dataset.logo || '';          // ...and logo
const CAN_BRAND = APP.dataset.canBrand === '1';
const BRAND = SCHOOL || 'AMC';

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
  questions: ['Pick a question on the left and change it in the form: its text, answers, which answers are correct, scoring. Changes are saved as you type.', 'Add, move and delete questions with the buttons. Build the preview to see the question paper on the right.', 'Paper builder lays out the paper: on an exam made with the RJ Style Paper Builder, rows and columns of blocks for the question paper and the answer sheet; on any exam, the sections (which questions are printed, how many per copy, shuffled or not) and the versions.', 'Prefer LaTeX? The LaTeX tab edits the source itself; Edit in LaTeX jumps to the question.'],
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
  archived: ['', 'archive', 'Archived'],
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
  source: { name: null, mode: null, url: null, dirty: false, loaded: false, failed: false, digest: null, tracked: false, draft: null },
  history: null,          // earlier versions of a source file, shown in the preview panel (/ui/api/history)
  deletingFile: null,     // file being deleted, so the editor moves off it
  qtab: store.get('qtab', 'form'), // Questions: the 'form' or the 'latex' tab
  qmode: store.get('qmode', 'form'), // a question in the form or in LaTeX ("Open questions in LaTeX")
  ql: null,               // the question's LaTeX view: file, text, unsaved, last check
  completions: null,      // the exam's macros and question names, for the LaTeX editors
  buildErr: null,         // the last build's first error, traced to its file (/ui/api/build-error)
  qdata: null,            // the questions as the form reads them (/ui/api/editor)
  qform: null,            // the question being edited: file, id, edits waiting to be saved
  gotoLine: null,         // line to show when the LaTeX editor opens next
  design: null,           // the paper's structure for Paper design (/ui/api/structure)
  dform: null,            // Paper design: edits waiting to be saved, the open section or block
  theme: store.get('theme', 'auto'),
  histSplit: store.get('histSplit', false), // History: changes side by side
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
  dash: store.get('dash', { query: '', klass: '', state: '', sort: 'recent', archived: false }),
  wizard: null,           // the new-exam wizard's answers
  gallery: null,          // templates for the wizard (/ui/api/gallery)
  guidePages: null,       // the guide's Markdown pages (/ui/api/guide)
  guideId: 'index',       // the guide page shown in the preview panel
  look: null,             // the Appearance page's choices (/ui/api/branding)
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
const locked = () => S.route.kind !== 'bank' && !!(S.status && S.status.lock);
/* The question editor's server: the open exam's, or a question bank's (banks.js). */
const inBank = () => S.route.kind === 'bank';
const qApi = (what) => (inBank() ? `/ui/api/bank/${enc(S.route.name)}${what ? '/' + what : ''}` : `/ui/api/${what}`);

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
function postForm(url, files, fields = {}, onProgress = null) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    files.forEach(([blob, name]) => form.append('file', blob, name));
    Object.entries(fields).forEach(([k, v]) => [].concat(v).forEach((x) => form.append(k, x)));
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    Object.entries(headers()).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    if (onProgress) xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      let r = {};
      try { r = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status === 200 && r.ok) resolve(r);
      else reject(Object.assign(new Error(r.error || `Upload failed (${xhr.status})`), { status: xhr.status, body: r }));
    };
    xhr.onerror = () => reject(Object.assign(new Error('Upload failed: no connection'), { status: 0, body: {} }));
    xhr.send(form);
  });
}

/* A request through Cloudflare (on a public server) carries at most 100 MB,
   so bigger uploads go in parts: each file is sent in pieces to
   /ui/api/upload-part, then the request names the assembled files instead
   of carrying them (server/ui.py, staged_files). */
const UPLOAD_LIMITS = { direct: 64 * 1024 * 1024, part: 32 * 1024 * 1024 };

async function sendPart(id, offset, piece, onProgress) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await postForm('/ui/api/upload-part', [[piece, 'part']], { id, offset }, onProgress);
    } catch (e) {
      // The part arrived but its answer was lost: the server has it already.
      if (e.status === 409 && e.body && e.body.size === offset + piece.size) return e.body;
      if (attempt >= 3 || !(e.status === 0 || e.status >= 500)) throw e;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

async function upload(url, files, fields = {}, onProgress = null) {
  const total = files.reduce((n, [blob]) => n + blob.size, 0);
  if (total <= UPLOAD_LIMITS.direct) return postForm(url, files, fields, onProgress);
  const staged = [];
  let done = 0;
  for (const [blob, name] of files) {
    const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    let offset = 0;
    do {
      const piece = blob.slice(offset, offset + UPLOAD_LIMITS.part);
      await sendPart(id, offset, piece, onProgress && ((p) => onProgress((done + p * piece.size) / total)));
      offset += piece.size;
      done += piece.size;
    } while (offset < blob.size);
    staged.push(`${id}:${name}`);
  }
  return postForm(url, [], { ...fields, staged });
}

socket.on('connect', () => {
  S.online = true;
  socket_emit('is-online', VERSION);
  // A job's "end" went to the old connection: don't stay behind "Working…".
  if (S.work) { S.work = null; S.workText = ''; renderWork(); }
  renderTop();
  if (S.route.kind === 'exam' && S.project) openProject(S.project);
});
socket.on('disconnect', () => { S.online = false; renderTop(); });
socket.on('reload', () => location.reload());
socket.on('begin-command', () => {
  S.work = { text: S.workText || 'Working…', p: null, since: Date.now() };
  renderWork();
  setTimeout(() => { if (S.work && Date.now() - S.work.since >= WORK_HIDE_AFTER) renderWork(); }, WORK_HIDE_AFTER + 50);
});
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
  if (/msg-err/.test(html)) { S.buildError = true; if (S.route.step === 'questions' && /latex|LaTeX/.test(html)) loadBuildError(); }
  S.creating = null; // a message while an exam is being created means it was refused
  showServerDialog(html);
  if (S.route.step === 'marking-scheme') loadQuestions(); // a refused change: show what is really saved
});
socket.on('dialog-disconnect', (html) => { showServerDialog(html, { sticky: true }); socket.disconnect(); });
socket.on('u-projects-list', () => { if (S.route.kind === 'exams') loadProjects(); });
socket.on('menu', () => refreshStatus());
socket.on('project-open', (data) => onProjectOpen(data[0]));
socket.on('source-name', (data) => onSourceName(...data));
socket.on('source-saved', () => { if (!editor || editor.getValue() === S.source.text) S.source.dirty = false; renderEditorBar(); });
socket.on('project-files-list', () => {
  loadFiles();
  const f = S.deletingFile;
  if (f) {
    S.deletingFile = null;
    toast(`${f} deleted. It stays in History.`, 'trash');
    if (S.source.name === f) { S.source.dirty = false; S.source.loaded = false; clearDraft(); loadSource(''); }
    if (S.history) loadHistory();
  }
});
socket.on('ui-history-restored', (r) => {
  if ((r.files || []).includes(S.source.name)) { if (S.source.dirty) saveDraft(); S.source.dirty = false; S.source.loaded = false; loadSource(S.source.name); }
  if (S.route.step === 'questions') { loadFiles(); if (useForm()) { const f = S.qform; if (!f || (!f.pending.length && !f.saving)) loadEditor(); } else if (useDesign()) loadDesign(); } // the form shows the restored file
});
socket.on('ui-changed', (what) => {
  if (what === 'unlock') { toast('Exam unlocked. Rebuild the papers, then check the layout again.', 'lock-slash'); S.previewMode = null; }
  if (what === 'layout_ok') toast('Layout confirmed. You can print now.');
  if (what === 'lock') S.printing = null;
  if (what === 'review') { loadScans().then(() => { if (S.route.step === 'check-scans') openNextReview(); }); }
  if (['marks', 'students', 'matches', 'exports', 'annotated'].includes(what)) loadStepData();
  if (what === 'questions' && S.route.step === 'marking-scheme') loadQuestions();
  if (what === 'meta' && S.route.kind === 'exams') loadProjects();
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
  if (parts[0] === 'new' && parts.length === 1) return { kind: 'new' };
  if (parts[0] === 'appearance' && parts.length === 1) return { kind: 'appearance' };
  if (parts[0] === 'banks' && parts.length === 1) return { kind: 'banks' };
  if (parts[0] === 'bank' && parts[1]) return { kind: 'bank', name: parts[1] };
  if (parts[0] === 'exam' && parts[1]) {
    const step = STEPS.some((s) => s.id === parts[2]) || parts[2] === 'settings' ? parts[2] : null;
    return { kind: 'exam', name: parts[1], step };
  }
  return { kind: 'exams' };
}
const examPath = (name, step) => `/exam/${enc(name)}/${step}`;

/* Whether a route leaves the open exam's editor (unsaved changes would be lost). */
const leavesEditor = (r) => S.source.dirty && !(r.kind === 'exam' && r.name === S.project && r.step === 'questions');

async function navigate(path, { replace = false } = {}) {
  if (leavesEditor(parsePath(path)) && !(await confirmLeave())) return;
  flushQ(); flushD();
  history[replace ? 'replaceState' : 'pushState']({}, '', path);
  onRoute();
}
window.addEventListener('popstate', async () => {
  const leavingEditor = leavesEditor(parsePath(location.pathname));
  if (leavingEditor) {
    const target = location.pathname;
    history.pushState({}, '', examPath(S.project, 'questions'));
    if (!(await confirmLeave())) return;
    S.source.dirty = false;
    history.pushState({}, '', target);
  }
  onRoute();
});
window.addEventListener('beforeunload', (e) => {
  if (S.qform && S.qform.pending.length) { flushQ(); e.preventDefault(); e.returnValue = ''; }
  if (S.dform && S.dform.pending.length) { flushD(); e.preventDefault(); e.returnValue = ''; }
  if (S.bform && S.bform.pending) { flushB(); e.preventDefault(); e.returnValue = ''; }
  if (S.source.dirty) { saveDraft(); e.preventDefault(); e.returnValue = ''; }
});

function onRoute() {
  const r = parsePath(location.pathname);
  const leavingQuestions = S.route.step === 'questions' && r.step !== 'questions';
  // The guide stays open while moving between the steps of an exam.
  const keepGuide = S.previewMode === 'guide' && r.kind === 'exam' && S.route.kind === 'exam' && r.name === S.route.name;
  S.route = r; S.menu = null; S.previewDoc = null; S.previewFile = null; S.previewMax = false;
  S.previewMode = keepGuide ? 'guide' : null;
  S.review = null; S.previewImage = null; S.previewList = null;
  if (leavingQuestions || r.kind !== 'exam' || r.name !== S.project) { dropEditor(); S.history = null; S.qdata = null; S.qform = null; S.design = null; S.dform = null; S.builder = null; S.bform = null; S.bcopies = null; }
  if (r.kind === 'banks' || r.kind === 'bank') {
    S.project = null; S.status = null; S.files = null; S.qdata = null; S.qform = null; S.ql = null;
    document.title = `${r.kind === 'bank' ? r.name : 'Question banks'} · ${BRAND}`;
    render();
    if (r.kind === 'banks') loadBanks(); else loadBank();
    return;
  }
  if (r.kind === 'exams' || r.kind === 'new' || r.kind === 'appearance') {
    S.project = null; S.status = null; S.files = null;
    document.title = `${{ new: 'New exam', appearance: 'Appearance' }[r.kind] || 'Exams'} · ${BRAND}`;
    if (r.kind === 'appearance') loadLook();
    if (r.kind === 'new' && !S.wizard) S.wizard = newWizard();
    render();
    loadProjects();
    if (r.kind === 'new') loadGallery();
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
    S.wizard = null;
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
  document.title = `${name} · ${BRAND}`;
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
  if (S.route.step === 'questions') enterQuestions();
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

/* Calls within 120 ms share one request; every caller's promise resolves. */
let statusTimer = null;
let statusWaiters = [];
function refreshStatus() {
  if (!S.project) return Promise.resolve();
  clearTimeout(statusTimer);
  return new Promise((resolve) => {
    statusWaiters.push(resolve);
    statusTimer = setTimeout(async () => {
      const waiters = statusWaiters; statusWaiters = [];
      if (S.project) { // not left meanwhile
        try {
          const st = await getJSON('/ui/api/status');
          if (st.project === S.project) S.status = st;
        } catch (e) { console.error(e); }
        renderTop(); renderSide(); renderPreview();
        if (S.route.step && S.route.step !== 'questions') renderMain(true);
      }
      waiters.forEach((r) => r());
    }, 120);
  });
}
async function loadProjects() {
  try {
    const r = await getJSON('/ui/api/projects');
    S.projects = r.projects;
  } catch (e) { console.error(e); S.projects = S.projects || []; toast('Couldn\'t load the exams list.', 'warning-triangle'); }
  if (S.route.kind === 'exams' || S.route.kind === 'new') renderMain(true);
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
  if (step === 'papers' && typeof loadPaperSections === 'function') loadPaperSections();
  if (step === 'mark') { loadMarks(); if (typeof loadQStats === 'function') loadQStats(); }
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
  if (S.route.kind === 'exam' && S.route.step && S.project && !tour && !store.get('tour-done', false)) {
    setTimeout(() => { if (!tour && !store.get('tour-done', false) && !$('#layer').innerHTML && S.route.kind === 'exam') startTour(); }, 800);
  }
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
  if (r.kind === 'new') crumbs.push('<span class="current">New exam</span>');
  if (r.kind === 'appearance') crumbs.push('<span class="current">Appearance</span>');
  if (r.kind === 'banks' || r.kind === 'bank') { crumbs[0] = '<a href="/banks" data-nav>Question banks</a>'; if (r.kind === 'bank') crumbs.push(`<span class="current">${esc(r.name)}</span>`); }
  const hasPreview = r.kind === 'exam';
  $('#topbar').innerHTML = `
    <a class="brandmark" href="/exams" data-nav><span class="brandmark-logo">${LOGO ? `<img src="${esc(LOGO)}" alt="">` : 'AMC'}</span><span class="brandmark-name">${esc(BRAND)}</span></a>
    <nav class="crumbs" aria-label="Breadcrumb"><span class="sep">/</span>${crumbs.join('<span class="sep">/</span>')}</nav>
    ${r.kind === 'exam' ? stateChip(projectState()) : ''}
    ${S.online ? '' : `<span class="chip chip-danger" title="The connection to the server was lost. It reconnects by itself.">${ic('cloud-xmark')} Offline</span>`}
    <span class="topbar-spacer"></span>
    <div class="topbar-actions">
      ${r.kind === 'banks' || r.kind === 'bank' ? `<a class="btn btn-ghost" href="/exams" data-nav>${ic('multiple-pages')}<span class="hide-narrow">Exams</span></a>` : `<a class="btn btn-ghost" href="/banks" data-nav title="Your question banks">${ic('book-stack')}<span class="hide-narrow">Question banks</span></a>`}
      ${hasPreview ? `<button class="btn btn-ghost btn-icon" data-act="toggle-preview" aria-pressed="${S.previewOpen}" title="Show or hide the preview panel" aria-label="Preview panel">${ic(S.previewOpen ? 'sidebar-collapse' : 'sidebar-expand')}</button>` : ''}
      <div style="position:relative"><button class="btn btn-ghost" data-act="menu" data-menu="guide" aria-haspopup="menu" aria-expanded="${S.menu === 'guide'}">${ic('help-circle')}<span class="hide-narrow">Guide</span></button>
        ${S.menu === 'guide' ? `<div class="menu" role="menu" style="right:0;left:auto">
          ${r.kind === 'exam' && r.step && guidePage(r.step) ? `<button class="menu-item" role="menuitem" data-act="guide-open" data-page="${r.step}">${ic('light-bulb')} About this step</button>` : ''}
          <button class="menu-item" role="menuitem" data-act="guide-open" data-page="index">${ic('open-book')} The full guide</button>
          <button class="menu-item" role="menuitem" data-act="tour-start">${ic('compass')} Take the tour</button></div>` : ''}</div>
      <button class="btn btn-ghost btn-icon" data-act="theme" title="Theme: ${S.theme === 'auto' ? 'same as the computer' : S.theme}" aria-label="Change theme">${ic(themeIcon)}</button>
      ${USER ? `<div style="position:relative">
        <button class="btn btn-ghost" data-act="menu" data-menu="account" aria-haspopup="menu" aria-expanded="${S.menu === 'account'}" style="padding:0 6px 0 4px">
          <span class="avatar">${esc(USER[0].toUpperCase())}</span><span>${esc(USER)}</span>${ic('nav-arrow-down')}</button>
        ${S.menu === 'account' ? `<div class="menu" role="menu">
          <div class="menu-label">Signed in as ${esc(USER)}</div>
          ${CAN_BRAND ? `<a class="menu-item" role="menuitem" href="/appearance" data-nav>${ic('color-filter')} Appearance</a>` : ''}
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
  else if (r.kind === 'new') html = viewNew();
  else if (r.kind === 'appearance') html = viewAppearance();
  else if (r.kind === 'banks') html = viewBanks();
  else if (r.kind === 'bank') {
    if ($('#q-editor') && $('#bank-head') && S.qdata) { $('#bank-head').innerHTML = bankHead(); renderQList(); return; }
    html = viewBank();
  } else if (!S.project || !r.step) html = `<div class="page"><div class="skeleton" style="height:40px;width:40%;margin-bottom:16px"></div><div class="skeleton"></div></div>`;
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
  main.classList.toggle('fill', r.kind === 'exam' && r.step === 'questions' && !useForm() && !useDesign());
  if (r.step === 'questions' && useForm() && $('#q-editor')) { // keep the form and what is being typed in it
    $('#q-head').innerHTML = questionsHead();
    renderQList();
    if (S.qform && S.qform.locked !== locked()) renderQForm(); // printed meanwhile: fields go read-only
    return;
  }
  if (r.step === 'questions' && useDesign() && $('#d-panel')) { // keep the design panel and its open form
    $('#q-head').innerHTML = questionsHead();
    if (S.dform && S.dform.locked !== locked()) renderDesign(); // printed meanwhile: controls go read-only
    return;
  }
  if (r.step === 'questions' && !useForm() && !useDesign() && editor && $('#ace-host')) { // keep the live editor
    editor.setReadOnly(locked());
    $('#q-head').innerHTML = questionsHead();
    renderEditorBar();
    resizeEditor();
    return;
  }
  // Keep what's being typed in the focused field across the redraw, and
  // text typed but not saved yet in other fields (a background refresh
  // mustn't undo it), when the page itself stays the same.
  const active = document.activeElement;
  const typing = active && main.contains(active) && /^(INPUT|TEXTAREA)$/.test(active.tagName) && fieldKey(active)
    ? { key: fieldKey(active), value: active.value, start: active.selectionStart, end: active.selectionEnd } : null;
  const routeKey = `${r.kind}/${r.name || ''}/${r.step || ''}`;
  const edited = main.dataset.route === routeKey
    ? [...main.querySelectorAll('input, textarea')].filter((el) => fieldKey(el) && !/^(checkbox|radio|file)$/.test(el.type) && el.value !== el.defaultValue).map((el) => [fieldKey(el), el.value])
    : [];
  main.innerHTML = html;
  main.dataset.route = routeKey;
  edited.forEach(([key, value]) => { const el = fieldByKey(main, key); if (el && el.value === el.defaultValue) el.value = value; });
  if (typing) {
    const el = fieldByKey(main, typing.key);
    if (el) { el.value = typing.value; el.focus(); try { el.setSelectionRange(typing.start, typing.end); } catch { /* not a text field */ } }
  }
  if (keepScroll) main.scrollTop = top;
  if (r.step === 'questions' && S.project && S.status) {
    if (useForm()) { if (editor) dropEditor(); renderQuestionsForm(); } else if (useDesign()) { if (editor) dropEditor(); renderDesign(); } else mountEditor();
  }
  if (r.step === 'match-students' && S.matchFocus) { S.matchFocus = false; const f = $('#match-search'); if (f) f.focus(); }
}

/* A field's identity across redraws: its id, or the setting or wizard answer it edits. */
function fieldKey(el) {
  if (el.id) return `#${el.id}`;
  if (el.dataset.option) return `opt:${el.dataset.option}`;
  if (el.dataset.wiz) return `wiz:${el.dataset.wiz}`;
  return null;
}
function fieldByKey(root, key) {
  if (key[0] === '#') return document.getElementById(key.slice(1));
  const attr = key.startsWith('opt:') ? 'data-option' : 'data-wiz';
  return root.querySelector(`[${attr}="${CSS.escape(key.slice(4))}"]`);
}

/* ---------- Rendering: preview panel ---------- */

function previewDocs() {
  if (S.route.kind !== 'exam' || !S.status || !S.status.project) return [];
  return Object.keys(DOC_LABELS).filter((d) => S.status.docs[d]);
}
const fsUrl = (path, attach = false) => `/fs/${enc(S.project)}/${path.split('/').map(enc).join('/')}?attach=${attach ? 1 : 0}`;

function renderPreview() {
  const exam = S.route.kind === 'exam';
  const open = exam ? S.previewOpen : (S.previewMode === 'guide' || (inBank() && S.previewMode === 'history' && !!S.history));
  APP.classList.toggle('preview-closed', !open);
  APP.classList.toggle('preview-max', open && S.previewMax);
  APP.style.setProperty('--preview-w', S.previewW + 'px');
  const p = $('#preview');
  if (!open) { p.innerHTML = ''; previewHtml = ''; return; }
  const docs = previewDocs();
  let title; let body; let bodyClass = 'preview-body'; let url = null; let tabs = '';
  if (S.previewMode === 'guide') {
    ({ title, body, tabs } = guidePreview());
  } else if (S.previewMode === 'history' && S.history) {
    ({ title, body, tabs } = historyPreview());
    bodyClass = 'preview-body plain hist';
  } else if (S.previewMode === 'image' && S.previewImage) {
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
    body = `<iframe class="pdf-frame" src="${url}&v=${S.previewStamp}#${cur === 'sujet' && S.previewPage ? `page=${S.previewPage}&` : ''}view=FitH" title="${esc(title)}"></iframe>`;
    bodyClass = 'preview-body frame';
    if (docs.length > 1) tabs = `<div class="preview-tabs" role="tablist">${docs.map((d) => `<button role="tab" aria-selected="${d === cur}" data-act="show-doc" data-doc="${d}">${DOC_LABELS[d]}</button>`).join('')}</div>`;
  } else {
    title = 'Preview';
    body = `<div class="preview-empty"><div class="empty-icon" style="margin:0 auto 12px">${ic('page')}</div><p><b>Nothing to show yet.</b></p><p class="subtle">Build the preview in Questions to see the question paper here.</p></div>`;
  }
  const html = `<div class="preview-resizer" role="separator" aria-orientation="vertical" aria-label="Resize the preview panel"></div>
    <div class="preview-header"><span class="preview-title" title="${esc(title)}">${esc(title)}</span>
      ${S.previewFile ? `<button class="btn btn-ghost btn-sm" data-act="preview-docs">${ic('nav-arrow-left')} Documents</button>` : ''}
      ${url ? `<a class="btn btn-ghost btn-icon btn-sm" href="${url}" target="_blank" rel="noopener" title="Open in a new tab" aria-label="Open in a new tab">${ic('open-new-window')}</a>
      <a class="btn btn-ghost btn-icon btn-sm" href="${url.replace('attach=0', 'attach=1')}" title="Download" aria-label="Download">${ic('download')}</a>` : ''}
      <button class="btn btn-ghost btn-icon btn-sm" data-act="preview-max" title="${S.previewMax ? 'Restore' : 'Maximise'}" aria-label="${S.previewMax ? 'Restore' : 'Maximise'}">${ic(S.previewMax ? 'collapse' : 'expand')}</button>
      <button class="btn btn-ghost btn-icon btn-sm" data-act="toggle-preview" title="Close" aria-label="Close the preview">${ic('xmark')}</button></div>
    ${tabs}<div class="${bodyClass}" id="preview-body">${body}</div>`;
  if (html !== previewHtml) { // same content: keep the panel (a redraw reloads the PDF and loses the scroll)
    previewHtml = html;
    p.innerHTML = html;
    if (S.previewFile && /\.(csv|txt|tex|log|yml|yaml)$/i.test(S.previewFile.name)) fillTextPreview(S.previewFile.name, url);
  }
  if (S.previewMode === 'page' && S.review && S.review.svg) paintPageBoxes();
}
let previewHtml = '';

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
    <div class="guide-body"><ul>${guideBullets(step).map((x) => `<li>${x}</li>`).join('')}</ul>
      <button class="link-btn guide-more" data-act="guide-open" data-page="${step}">More in the guide ${ic('arrow-right')}</button></div></section>`;
}
function banner(kind, iconName, title, text, buttons = '') {
  return `<div class="banner banner-${kind}" role="note">${ic(iconName)}<div class="banner-body">
    <div class="banner-title">${title}</div>${text ? `<div class="muted">${text}</div>` : ''}${buttons ? `<div class="btn-row">${buttons}</div>` : ''}</div></div>`;
}
const stat = (value, label, kind = '') => `<div class="stat ${kind}"><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>`;
const fmtDate = (t) => (t ? new Date(t * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

/* ---------- View: exams ---------- */

const DASH_STATES = [['draft', 'Draft'], ['tocheck', 'Layout to check'], ['ready', 'Ready to print'], ['printed', 'Printed'], ['checking', 'Checking scans'], ['scanned', 'Scans uploaded'], ['marked', 'Marked'], ['exported', 'Exported'], ['archived', 'Archived']];
const STEP_COUNT = 10;

function examChip(p) {
  if (p.state === 'checking') return `<span class="chip chip-warning">${ic('page-search')} Checking scans: ${p.problems} to review</span>`;
  return stateChip(p.state);
}

function dashFiltered(list) {
  const d = S.dash;
  const q = fold(d.query).trim();
  let out = list.filter((p) => (d.archived ? p.archived : !p.archived));
  if (q) out = out.filter((p) => [p.name, p.meta.class, p.meta.subject].some((x) => fold(x).includes(q)));
  if (d.klass) out = out.filter((p) => (p.meta.class || '') === d.klass);
  if (d.state) out = out.filter((p) => p.state === d.state);
  const by = {
    recent: (a, b) => (b.modified || 0) - (a.modified || 0),
    date: (a, b) => String(b.meta.date || '').localeCompare(String(a.meta.date || '')),
    name: (a, b) => a.name.localeCompare(b.name),
  }[d.sort] || (() => 0);
  return out.sort(by);
}

const fmtIsoDate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : String(iso || '');
};

function examCard(p) {
  const meta = [p.meta.class, p.meta.subject, p.meta.date ? fmtIsoDate(p.meta.date) : ''].filter(Boolean).map(esc).join(' · ');
  const nxt = p.next || {};
  const target = nxt.step ? examPath(p.name, nxt.step) : `/exam/${enc(p.name)}`;
  return `<article class="card exam-card">
    <div class="row-between" style="gap:8px"><h3><a href="/exam/${enc(p.name)}" data-nav>${esc(p.name)}</a></h3>
      <div class="card-menu"><button class="btn btn-ghost btn-icon btn-sm" data-act="menu" data-menu="${esc(p.name)}" aria-haspopup="menu" aria-expanded="${S.menu === p.name}" aria-label="More actions for ${esc(p.name)}">${ic('more-horiz')}</button>
      ${S.menu === p.name ? `<div class="menu" role="menu">
        <button class="menu-item" role="menuitem" data-act="exam-details" data-name="${esc(p.name)}">${ic('edit-pencil')} Class, subject and date…</button>
        <button class="menu-item" role="menuitem" data-act="rename-exam" data-name="${esc(p.name)}">${ic('edit-pencil')} Rename</button>
        <button class="menu-item" role="menuitem" data-act="clone-exam" data-name="${esc(p.name)}">${ic('copy')} Duplicate</button>
        <a class="menu-item" role="menuitem" href="/fs/${enc(p.name)}">${ic('download')} Download as zip</a>
        <button class="menu-item" role="menuitem" data-act="archive-exam" data-name="${esc(p.name)}" data-v="${p.archived ? 0 : 1}">${ic('archive')} ${p.archived ? 'Take out of the archive' : 'Archive'}</button>
        <div class="menu-sep"></div>
        <button class="menu-item" role="menuitem" data-act="delete-exam" data-name="${esc(p.name)}" style="color:var(--danger)">${ic('trash')} Delete</button></div>` : ''}</div></div>
    <div class="subtle exam-meta">${meta || (p.modified ? 'Changed ' + fmtDate(p.modified) : '&nbsp;')}</div>
    <div>${examChip(p)}</div>
    <div class="steps-bar" role="img" aria-label="${p.done} of ${STEP_COUNT} steps done" title="${p.done} of ${STEP_COUNT} steps done">${Array.from({ length: STEP_COUNT }, (_, i) => `<span class="${i < p.done ? 'on' : ''}"></span>`).join('')}</div>
    <div class="row-between" style="gap:8px"><span class="exam-next">${nxt.step ? `Next: <b>${esc(nxt.text)}</b>` : `${ic('check-circle')} ${esc(nxt.text || '')}`}</span>
      <a class="btn btn-sm" href="${target}" data-nav>${nxt.step ? 'Continue' : 'Open'} ${ic('arrow-right')}</a></div>
  </article>`;
}

function viewExams() {
  const list = S.projects;
  const d = S.dash;
  let body;
  if (list === null) body = `<div class="grid grid-3">${'<div class="skeleton"></div>'.repeat(3)}</div>`;
  else if (!list.length) {
    body = `<div class="card"><div class="empty"><div class="empty-icon">${ic('multiple-pages')}</div><h2>No exams yet</h2>
      <p>Create your first exam from a template or a blank start.</p>
      <div class="btn-row"><a class="btn btn-primary" href="/new" data-nav>${ic('plus')} New exam</a></div></div></div>`;
  } else {
    const classes = [...new Set(list.map((p) => p.meta.class).filter(Boolean))].sort();
    const shown = dashFiltered(list);
    const archived = list.filter((p) => p.archived).length;
    body = `<div class="dash-tools">
        <label class="sr-only" for="dash-search">Search exams</label><input class="input" id="dash-search" placeholder="Search name, class or subject…" value="${esc(d.query)}">
        <select class="select" id="dash-class" aria-label="Class"><option value="">All classes</option>${classes.map((c) => `<option ${c === d.klass ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <select class="select" id="dash-state" aria-label="State"><option value="">Any state</option>${DASH_STATES.map(([v, l]) => `<option value="${v}" ${v === d.state ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <select class="select" id="dash-sort" aria-label="Order">${[['recent', 'Recently changed'], ['date', 'Exam date'], ['name', 'Name']].map(([v, l]) => `<option value="${v}" ${v === d.sort ? 'selected' : ''}>${l}</option>`).join('')}</select>
        ${archived || d.archived ? `<label class="check" style="align-items:center"><input type="checkbox" id="dash-archived" ${d.archived ? 'checked' : ''}><span>Archived (${archived})</span></label>` : ''}
      </div>
      <div class="grid grid-3" id="dash-cards">${shown.map(examCard).join('')}</div>
      <div class="card ${shown.length ? 'hidden' : ''}" id="dash-none"><div class="empty"><p>${d.archived ? 'No archived exams match.' : 'No exams match.'}</p></div></div>`;
  }
  return `<div class="page">
    ${header('', 'Exams', 'Your exams, where each one stands and what comes next.', `<button class="btn btn-ghost" data-act="trash-open" title="Deleted exams, kept for 30 days">${ic('trash')} Trash</button><button class="btn btn-ghost" data-act="exam-import" title="An exam saved as a zip (with its history, from History › With history), or an AMC project archive">${ic('upload')} Import an exam…</button>${CAN_BRAND && !USER ? `<a class="btn btn-ghost" href="/appearance" data-nav>${ic('color-filter')} Appearance</a>` : ''}${list && list.length ? `<a class="btn btn-primary" href="/new" data-nav>${ic('plus')} New exam</a>` : ''}`)}
    ${body}</div>`;
}

/* While typing in the search box: only the cards change, so the box keeps focus. */
function renderDashCards() {
  const host = $('#dash-cards');
  if (!host || !S.projects) { renderMain(true); return; }
  const shown = dashFiltered(S.projects);
  host.innerHTML = shown.map(examCard).join('');
  const none = $('#dash-none'); if (none) none.classList.toggle('hidden', shown.length > 0);
}

async function editExamDetails(name) {
  const p = (S.projects || []).find((x) => x.name === name) || { meta: (S.status && S.status.meta) || {} };
  const m = p.meta || {};
  const data = await formDialog({
    title: `${esc(name)}: class, subject and date`, ok: 'Save', icon: 'edit-pencil',
    body: `<div class="form-grid"><label class="field"><span class="field-label">Class</span><input class="input" name="class" value="${esc(m.class)}" placeholder="10B"></label>
      <label class="field"><span class="field-label">Subject</span><input class="input" name="subject" value="${esc(m.subject)}" placeholder="Physics"></label>
      <label class="field"><span class="field-label">Date of the exam</span><input class="input" type="date" name="date" value="${esc(m.date)}"></label></div>`,
  });
  if (data) socket_emit('ui-exam-meta', { exam: name, class: data.class, subject: data.subject, date: data.date });
}

/* ---------- View: new exam ---------- */

const todayIso = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
const newWizard = () => ({ step: 1, name: '', class: '', subject: '', date: todayIso(), gid: 'school', id: 'blank', group: 'school', query: '', style: 'paper', code: false, digits: 8, copies: '', design: null });
const thumbUrl = (gid, id) => `/ui/gallery/${enc(gid)}/${enc(id)}/thumb`;

async function loadGallery() {
  if (S.gallery) return;
  try { S.gallery = await getJSON('/ui/api/gallery'); } catch { S.gallery = { groups: [], templates: [] }; }
  if (S.route.kind === 'new') renderMain(true);
}

function wizardTemplate() {
  const g = S.gallery;
  const w = S.wizard;
  return g && w && g.templates.find((t) => t.gid === w.gid && t.id === w.id);
}

function wizardNameError() {
  return validName((S.projects || []).map((p) => p.name))({ name: S.wizard.name.trim() });
}

function viewNew() {
  const w = S.wizard;
  const steps = [['Details', 1], ['Template', 2], ['Options', 3]];
  const bar = `<ol class="wizard-steps">${steps.map(([l, n]) => `<li class="${w.step === n ? 'is-current' : w.step > n ? 'is-done' : ''}">
    ${w.step > n ? `<button class="link-btn" data-act="wiz-go" data-step="${n}">` : '<span>'}<span class="ws-dot">${w.step > n ? ic('check') : n}</span>${l}${w.step > n ? '</button>' : '</span>'}</li>`).join('')}</ol>`;
  let body;
  if (w.step === 1) {
    body = `<section class="card wizard-details"><div class="card-body"><div class="form-grid">
      <label class="field" style="grid-column:1/-1"><span class="field-label">Name</span><input class="input" id="wiz-name" data-wiz="name" value="${esc(w.name)}" placeholder="Physics mid-term 10B" autocomplete="off"></label>
      <label class="field"><span class="field-label">Class</span><input class="input" data-wiz="class" value="${esc(w.class)}" placeholder="10B"></label>
      <label class="field"><span class="field-label">Subject</span><input class="input" data-wiz="subject" value="${esc(w.subject)}" placeholder="Physics"></label>
      <label class="field"><span class="field-label">Date of the exam</span><input class="input" type="date" data-wiz="date" value="${esc(w.date)}"></label>
      </div><p class="field-hint" id="wiz-error" style="color:var(--danger);margin-top:10px">${esc(w.error || '')}</p></div>
      <div class="card-foot"><a class="btn" href="/exams" data-nav>Cancel</a><button class="btn btn-primary" data-act="wiz-next">Next: choose a template ${ic('arrow-right')}</button></div></section>`;
  } else if (w.step === 2) body = wizardGallery();
  else body = wizardOptions();
  return `<div class="page wide">${header('', 'New exam', 'Name it, choose where to start from, then a few options.')}${bar}${body}</div>`;
}

function wizardGallery() {
  const g = S.gallery;
  const w = S.wizard;
  if (!g) return '<div class="skeleton" style="height:320px"></div>';
  const q = fold(w.query).trim();
  const list = g.templates.filter((t) => (q ? fold(`${t.title} ${t.text}`).includes(q) : t.gid === w.group));
  const cur = wizardTemplate();
  const isCur = (t) => !!(cur && t.gid === cur.gid && t.id === cur.id);
  return `<div class="wizard-gallery">
    <section class="card"><div class="card-header" style="flex-wrap:wrap;gap:8px">
      <div class="segmented" role="tablist" aria-label="Template groups">${g.groups.map((x) => `<button role="tab" aria-pressed="${!q && x.id === w.group}" data-act="wiz-group" data-v="${esc(x.id)}">${esc(x.title)}</button>`).join('')}</div>
      <span class="spacer"></span><label class="sr-only" for="wiz-search">Search templates</label><input class="input input-sm" id="wiz-search" style="max-width:220px" placeholder="Search templates…" value="${esc(w.query)}"></div>
      <div class="card-body"><div class="tpl-grid" id="tpl-grid">${list.map((t) => `<button class="tpl-card ${isCur(t) ? 'is-selected' : ''}" data-act="wiz-pick" data-gid="${esc(t.gid)}" data-id="${esc(t.id)}" aria-pressed="${isCur(t)}">
        <span class="tpl-thumb">${t.preview ? `<img src="${thumbUrl(t.gid, t.id)}" alt="" loading="lazy">` : ic('page')}</span>
        <span class="tpl-title">${esc(t.title || t.id)}</span>
        <span class="subtle">${t.format === 'plain' ? 'Plain text' : 'LaTeX'}${t.pages ? ` · ${t.pages} page${t.pages > 1 ? 's' : ''}` : ''}</span></button>`).join('') || '<p class="subtle">No template matches.</p>'}</div></div></section>
    <section class="card tpl-preview">${cur ? `<div class="card-header"><h2>${esc(cur.title || cur.id)}</h2></div>
      <div class="card-body"><p class="muted" style="margin:0 0 10px">${esc(cur.text || '')}${cur.mine ? ` <button class="link-btn" data-act="template-delete" data-id="${esc(cur.id)}" style="color:var(--danger)">Delete this template</button>` : ''}</p>
        ${cur.preview ? `<iframe class="tpl-pdf" src="/ui/gallery/${enc(cur.gid)}/${enc(cur.id)}/paper#view=FitH" title="${esc(cur.title || cur.id)}"></iframe><p class="field-hint">${cur.mine ? 'The question paper as it was last built in the exam it came from.' : 'One copy of the question paper, as this template builds it.'}</p>` : '<p class="subtle">No preview for this template.</p>'}</div>` : '<div class="card-body"><p class="subtle">Choose a template.</p></div>'}
      <div class="card-foot"><button class="btn" data-act="wiz-go" data-step="1">${ic('arrow-left')} Back</button><button class="btn btn-primary" data-act="wiz-next" ${cur ? '' : 'disabled'}>Next: options ${ic('arrow-right')}</button></div></section>
  </div>`;
}

function wizardOptions() {
  const w = S.wizard;
  const t = wizardTemplate();
  if (!t) return '';
  if (t.builder) return builderWizardOptions(w, t); // builder.js: kind of paper, layout, details, versions
  w.design = null;
  const styleCard = (v, title, hint, thumb) => `<button class="choice style-choice" role="radio" aria-checked="${w.style === v}" data-act="wiz-style" data-v="${v}">
    ${thumb ? `<img class="style-thumb" src="${thumb}" alt="">` : `<span class="choice-icon">${ic(v === 'paper' ? 'page' : 'multiple-pages')}</span>`}
    <span><span class="choice-title">${title}</span><br><span class="subtle">${hint}</span></span></button>`;
  const style = t.starter
    ? `<div class="style-choices" role="radiogroup" aria-label="Answer sheet">
        ${styleCard('paper', 'On the question paper', 'Students tick the boxes next to each question.', t.id === 'blank' ? thumbUrl('school', 'blank') : '')}
        ${styleCard('separate', 'On a separate answer sheet', 'All the boxes on one sheet at the end of each copy.', t.id === 'blank' && t.variants ? thumbUrl('school', 'blank-separate') : '')}</div>`
    : '<p class="muted">The answer sheet is laid out as in this template.</p>';
  const first = `<section class="card"><div class="card-header"><h2>Answer sheet</h2></div><div class="card-body">${style}
      ${t.starter ? `<label class="check" style="margin-top:14px"><input type="checkbox" id="wiz-code" ${w.code ? 'checked' : ''}><span>Students write their student number in boxes<br><span class="subtle">AMC reads it, so sheets are matched to the class list automatically.</span></span></label>
        ${w.code ? `<label class="field" style="margin:10px 0 0 24px;max-width:220px"><span class="field-label">Digits in a student number</span><input class="input" type="number" min="1" max="12" data-wiz="digits" value="${esc(w.digits)}"></label>` : ''}` : ''}
    </div></section>`;
  const copies = `<label class="field"><span class="field-label">Number of copies</span><input class="input input-num" type="number" min="1" max="9999" data-wiz="copies" value="${esc(w.copies)}" placeholder="As in the template">
        <span class="field-hint">Print a few spares beyond the class size. You can change it until the papers are printed.</span></label>`;
  return `<div class="grid grid-2" style="align-items:start">
    ${first}
    <section class="card"><div class="card-header"><h2>Copies and summary</h2></div><div class="card-body">
      ${copies}
      <dl class="summary"><dt>Name</dt><dd>${esc(w.name)}</dd>${w.class ? `<dt>Class</dt><dd>${esc(w.class)}</dd>` : ''}${w.subject ? `<dt>Subject</dt><dd>${esc(w.subject)}</dd>` : ''}<dt>Date</dt><dd>${esc(fmtIsoDate(w.date))}</dd><dt>Template</dt><dd>${esc(t.title || t.id)}</dd></dl>
    </div>
    <div class="card-foot"><button class="btn" data-act="wiz-go" data-step="2">${ic('arrow-left')} Back</button><button class="btn btn-primary" data-act="wiz-create" ${S.creating ? 'disabled' : ''}>${ic('plus')} ${S.creating ? 'Creating…' : 'Create exam'}</button></div></section>
  </div>`;
}

/* ---------- View: questions ---------- */

function viewQuestions() {
  if (!S.status) return '<div class="page"><div class="skeleton" style="height:40px;width:40%;margin-bottom:16px"></div><div class="skeleton"></div></div>';
  return `<div class="page wide">
    <div id="q-head">${questionsHead()}</div>
    ${useForm() ? '<div class="q-editor" id="q-editor"><div class="q-list" id="q-list"></div><div class="q-form" id="q-form"></div></div>'
    : useDesign() ? '<div class="design" id="d-panel"></div>'
    : `<div class="editor-bar" id="editor-bar"></div>
    <div id="draft-bar"></div>
    <div class="editor-frame grow" id="editor-frame"><div id="ace-host"></div></div>`}
  </div>`;
}

/* The header part of Questions, redrawn on its own so the editor stays. */
function questionsHead() {
  const L = locked();
  const form = useForm();
  const design = useDesign();
  const tabs = canForm() ? `<div class="segmented q-tabs" role="tablist" aria-label="How to edit"><button role="tab" aria-pressed="${form}" data-act="qtab" data-v="form">${ic('list')} Questions</button><button role="tab" aria-pressed="${design}" data-act="qtab" data-v="design">${ic('page')} Paper builder</button><button role="tab" aria-pressed="${!form && !design}" data-act="qtab" data-v="latex">${ic('code')} LaTeX</button></div>` : '';
  const sub = L ? 'The exam is printed, so the questions and the paper are read-only: only the correct answers and scoring can change.'
    : form ? 'Pick a question and change it in the form; changes are saved as you type. Build the preview to see the question paper.'
      : design ? (S.builder && S.builder.builder ? 'Compose the question paper and the answer sheet from rows of blocks; set the instructions, the sections and the versions.' : 'Sections: which questions are printed, how many per copy, shuffled or not, and their headings. Versions: how many different papers are printed.')
        : 'Write the questions and answers. Save, then build the preview to see the question paper.';
  const build = `<button class="btn ${form || design ? 'btn-primary' : ''}" data-act="build" ${(form ? S.qdata : design ? S.design && !S.design.error : S.source.loaded) ? '' : 'disabled'}>${ic('refresh')} Build preview</button>`;
  const marking = `<a class="btn btn-primary" href="${examPath(S.project, 'marking-scheme')}" data-nav>${ic('percentage-circle')} Marking scheme</a>`;
  const actions = form
    ? `<button class="btn btn-ghost" data-act="qf-history" ${S.qdata ? '' : 'disabled'}>${ic('clock-rotate-right')} History</button>${L ? marking : build}`
    : design ? `<button class="btn btn-ghost" data-act="${S.builder && S.builder.builder ? 'pb-history' : 'd-history'}" ${S.design && S.design.file ? '' : 'disabled'}>${ic('clock-rotate-right')} History</button>${L ? marking : build}`
    : L ? `<a class="btn btn-primary" href="${examPath(S.project, 'marking-scheme')}" data-nav>${ic('percentage-circle')} Correct the answer key</a>`
      : `${build}<button class="btn btn-primary" data-act="save" id="save-btn" disabled>${ic('floppy-disk')} Save</button>`;
  return `
    ${header('questions', 'Questions', sub, actions)}
    ${tabs}
    ${guideBox('questions')}
    ${S.buildErr && !L ? buildErrBanner() : ''}
    ${(form || design) && typeof bankStrip === 'function' ? bankStrip() : ''}
    ${L ? lockBanner(form ? 'Tick the correct answers and change scoring here or in <b>Marking scheme</b>: those changes are still allowed, because nothing moves on the printed papers.' : 'Correct the answer key and change scoring in <b>Marking scheme</b>: those changes are still allowed, because nothing moves on the printed papers.') : ''}`;
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
    <button class="btn btn-ghost btn-sm" data-act="history" ${cur && S.source.tracked ? '' : 'disabled'} title="Earlier versions of this file">${ic('clock-rotate-right')} History</button>
    ${cur && f && cur !== f.main && !/^items\/[^/]+\/item\.tex$/.test(cur) && !locked() ? `<button class="btn btn-ghost btn-sm" data-act="delete-file" title="Delete this file; it stays in History">${ic('trash')} Delete</button>` : ''}
    <label class="btn btn-sm">${ic('upload')} Add a file<input type="file" id="add-file" hidden></label>
    ${others.length ? `<select class="select input-sm" id="other-file" style="min-width:160px" aria-label="Other project files"><option value="">Other files…</option>${others.map((x) => `<option>${esc(x.name)}</option>`).join('')}</select>` : ''}`;
  const save = $('#save-btn');
  if (save) save.disabled = !S.source.dirty;
  const db = $('#draft-bar');
  if (db) {
    const d = S.source.draft;
    const stale = !!(d && d.base && S.source.digest && d.base !== S.source.digest);
    db.innerHTML = d ? banner(stale ? 'warning' : 'info', 'floppy-disk', `Unsaved text from ${esc(fmtWhen(d.at / 1000))} was found on this computer.`,
      stale ? 'It was typed in this file, which has been saved since (from another tab, or by another teacher). Use it to put it back in the editor; saving then asks which version to keep.'
        : 'It was typed in this file but not saved. Use it to put it back in the editor, then save.',
      `<button class="btn btn-sm btn-primary" data-act="draft-use">Use it</button><button class="btn btn-sm" data-act="draft-discard">Discard</button>`) : '';
    resizeEditor();
  }
}

/* ---------- LaTeX editors (the LaTeX tab, a question's LaTeX view, a section document) ----------
   AMC snippets and completion of the exam's macros and question names (/ui/api/completions). */
const AMC_SNIPPETS = [
  ['question', 'One correct answer', '\\begin{question}{${1:id}}\n\t${2:Question text}\n\t\\begin{choices}\n\t\t\\correctchoice{${3:Right}}\n\t\t\\wrongchoice{${4:Wrong}}\n\t\\end{choices}\n\\end{question}'],
  ['questionmult', 'Several correct answers', '\\begin{questionmult}{${1:id}}\n\t${2:Question text}\n\t\\begin{choices}\n\t\t\\correctchoice{${3:Right}}\n\t\t\\correctchoice{${4:Also right}}\n\t\t\\wrongchoice{${5:Wrong}}\n\t\\end{choices}\n\\end{questionmult}'],
  ['questionmultx', 'A numeric answer', '\\begin{questionmultx}{${1:id}}\n\t${2:Question text}\n\t\\AMCnumericChoices{${3:42}}{digits=${4:2},decimals=0,sign=false}\n\\end{questionmultx}'],
  ['choices', 'Answers', '\\begin{choices}\n\t\\correctchoice{${1:Right}}\n\t\\wrongchoice{${2:Wrong}}\n\\end{choices}'],
  ['choiceshoriz', 'Answers on one line', '\\begin{choiceshoriz}\n\t\\correctchoice{${1:Right}}\n\t\\wrongchoice{${2:Wrong}}\n\\end{choiceshoriz}'],
  ['correctchoice', 'A correct answer', '\\correctchoice{${1}}'],
  ['wrongchoice', 'A wrong answer', '\\wrongchoice{${1}}'],
  ['scoring', 'This question\'s scoring', '\\scoring{${1:b=1,m=0}}'],
  ['explain', 'Explanation (answer key only)', '\\explain{${1}}'],
  ['includegraphics', 'A figure', '\\includegraphics[width=${1:0.5}\\linewidth]{${2:file}}'],
  ['AMCnumericChoices', 'Numeric answer boxes', '\\AMCnumericChoices{${1:42}}{digits=${2:2},decimals=0,sign=false}'],
];
let completerAdded = false;
function latexEditor(hostId, { readOnly = false, onSave = null } = {}) {
  const ed = ace.edit(hostId);
  ed.setTheme('ace/theme/textmate');
  ed.setShowPrintMargin(false);
  ed.session.setUseWrapMode(true);
  ed.session.setMode('ace/mode/latex');
  ed.setReadOnly(readOnly);
  try {
    const lt = ace.require('ace/ext/language_tools');
    if (lt && !completerAdded) {
      completerAdded = true;
      lt.addCompleter({
        identifierRegexps: [/[a-zA-Z_0-9\\:.\-]/],
        getCompletions(editor, session, pos, prefix, cb) {
          const c = S.completions || { macros: [], ids: [] };
          const bare = prefix.replace(/^\\/, '');
          const out = AMC_SNIPPETS.map(([n, meta, snippet]) => ({ caption: '\\' + n, snippet, meta: `AMC · ${meta}`, score: 1000 }))
            .concat(c.macros.map((m) => ({ caption: '\\' + m, value: '\\' + m, meta: 'this exam', score: 900 })))
            .concat(c.ids.map((id) => ({ caption: id, value: id, meta: 'question', score: 800 })));
          cb(null, bare ? out.filter((x) => x.caption.replace(/^\\/, '').toLowerCase().startsWith(bare.toLowerCase())) : out);
        },
      });
    }
    ed.setOptions({ enableBasicAutocompletion: true, enableLiveAutocompletion: true, enableSnippets: true });
  } catch (e) { console.warn('No completion', e); }
  if (onSave) ed.commands.addCommand({ name: 'save', bindKey: { win: 'Ctrl-S', mac: 'Command-S' }, exec: onSave });
  loadCompletions();
  return ed;
}
async function loadCompletions() {
  const key = inBank() ? `bank:${S.route.name}` : S.project;
  if (S.completions && S.completions.key === key && Date.now() - S.completions.at < 30000) return;
  try { const r = await getJSON(qApi('completions')); if (r.project) S.completions = { ...r, key, at: Date.now() }; } catch { /* none */ }
}

function mountEditor() {
  renderEditorBar();
  if (editor || typeof ace === 'undefined') return;
  editor = latexEditor('ace-host', { readOnly: locked(), onSave: () => saveSource() });
  editor.session.on('change', () => {
    if (S.source.loading) return;
    if (!S.source.dirty) { S.source.dirty = true; renderEditorBar(); }
    scheduleDraft();
  });
  if (S.source.text !== undefined) setEditorText(S.source.text);
}
function dropEditor() {
  saveDraft();
  if (editor) { editor.destroy(); editor = null; }
  S.source = { name: null, mode: null, url: null, dirty: false, loaded: false, failed: false, digest: null, tracked: false, draft: null };
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

/* The editor's draft: text typed but not saved, kept in this browser (per exam and file). */
const draftKey = () => (S.project && S.source.name ? `draft:${S.project}/${S.source.name}` : null);
let draftTimer = null;
function scheduleDraft() { clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 800); }
function saveDraft() {
  clearTimeout(draftTimer);
  const key = draftKey();
  if (!key || !editor || !S.source.loaded || S.source.loading) return;
  const text = editor.getValue();
  if (text === S.source.text || text.length > 2000000) { store.remove(key); return; }
  store.set(key, { text, at: Date.now(), base: S.source.digest });
}
function clearDraft() { clearTimeout(draftTimer); const key = draftKey(); if (key) store.remove(key); }

function loadSource(filename) { socket_emit('source-code', filename); }
async function onSourceName(name, mode, url) {
  const project = S.project;
  S.source.name = name; S.source.mode = mode; S.source.url = url;
  S.source.loaded = false; S.source.failed = false; S.source.problem = null; S.source.draft = null;
  let r = null;
  try {
    // Our own route: the text with the digest a save is checked against.
    const resp = await fetch(`/ui/api/source?file=${enc(name)}`, { headers: headers(), cache: 'no-store' });
    const j = await resp.json();
    if (!resp.ok || j.error || typeof j.text !== 'string') throw new Error(j.error || resp.status);
    r = j;
  } catch (e) { console.error(e); }
  if (S.project !== project || S.source.name !== name) return; // another exam or file was chosen meanwhile
  if (!r) toast(`Couldn't open ${name}. Reload the page to try again.`, 'warning-triangle');
  else if (r.problem) toast(r.problem, 'warning-triangle');
  S.source.failed = !r || !!r.problem;
  S.source.problem = r ? r.problem : null;
  S.source.text = r ? r.text : '';
  S.source.digest = r ? r.digest : null;
  S.source.tracked = !!(r && r.tracked);
  S.source.loaded = true;
  const d = r && store.get(draftKey(), null);
  if (d && typeof d.text === 'string' && d.text !== r.text) S.source.draft = d; else if (d) store.remove(draftKey());
  if (S.route.step === 'questions') {
    if (!editor) renderMain();
    setEditorText(S.source.text);
    if (editor) editor.setReadOnly(locked() || S.source.failed);
    if (editor && S.gotoLine) { editor.gotoLine(S.gotoLine, 0, true); editor.focus(); S.gotoLine = null; }
    const b = $('[data-act="build"]'); if (b) b.disabled = S.source.failed;
  }
  if (S.history && S.history.file === name && S.previewMode === 'history') loadHistory();
}

async function saveSource({ force = false } = {}) {
  if (!editor || !S.source.name || !S.source.loaded) return false;
  if (S.source.failed) { toast(S.source.problem || `${S.source.name} couldn't be opened, so it isn't saved over. Reload the page.`, 'warning-triangle'); return false; }
  if (locked()) { toast('The exam is printed: correct the answer key in Marking scheme.', 'lock'); return false; }
  const name = S.source.name;
  const text = editor.getValue();
  let r;
  try {
    const resp = await fetch('/ui/api/source', { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: name, text, based_on: force ? '' : (S.source.digest || '') }) });
    r = await resp.json();
  } catch { r = { error: 'The server couldn\'t be reached.' }; }
  if (S.source.name !== name) return false; // another file was opened meanwhile
  if (r.conflict) {
    const choice = await choiceDialog({
      title: 'Changed elsewhere', icon: 'warning-triangle',
      body: `<p><b>${esc(name)}</b> was saved from another tab or by another teacher after you opened it.</p><p class="subtle">Keep yours: their version stays in History. Load theirs: your text is kept as unsaved text, to put back with "Use it".</p>`,
      choices: [['theirs', 'Load their version', ''], ['mine', 'Keep my version', 'btn-primary']],
    });
    if (choice === 'mine') return saveSource({ force: true });
    if (choice === 'theirs') { store.set(draftKey(), { text, at: Date.now(), base: r.digest || null }); S.source.dirty = false; S.source.loaded = false; loadSource(name); } // the draft knows their version: "Use it" then saves over it without asking again
    return false;
  }
  if (!r.ok) {
    openDialog(`<div class="dialog-head"><span class="dialog-icon danger">${ic('warning-triangle')}</span><div><h2 id="dlg-title">Not saved</h2></div></div>
      <div class="dialog-body"><p>${esc(r.error || 'Unknown error')}</p></div><div class="dialog-foot"><button class="btn btn-primary" data-act="dialog-ok">OK</button></div>`);
    return false;
  }
  S.source.text = text; S.source.digest = r.digest;
  if (editor && editor.getValue() === text) S.source.dirty = false; // typed meanwhile: still unsaved
  if (!S.source.dirty) clearDraft();
  renderEditorBar();
  toast(`${name} saved.`);
  if (S.history && S.history.file === name) loadHistory();
  return true;
}

function choiceDialog({ title, body, choices, icon = 'info-circle' }) {
  return new Promise((resolve) => {
    openDialog(`<div class="dialog-head"><span class="dialog-icon brand">${ic(icon)}</span><div><h2 id="dlg-title">${title}</h2></div></div>
      <div class="dialog-body">${body}</div>
      <div class="dialog-foot"><button class="btn" data-act="dialog-cancel">Cancel</button>${choices.map(([v, label, cls]) => `<button class="btn ${cls || ''}" data-act="dialog-result" data-v="${esc(v)}">${esc(label)}</button>`).join('')}</div>`);
    dialogResolve = resolve;
  });
}

/* ---------- Version history (preview panel; server: ui_vcs.py) ----------
   One list for the whole exam (or one file): saves close together by the
   same person form an editing session; a version shows what it changed in
   words and line by line, what changed since, or the differences with any
   other version; the paper design is drawn as the builder draws it. A
   restore (the whole exam, one file, or one change undone) is a new
   version, so it can be undone too. */

const fmtWhen = (t) => (t ? new Date(t * 1000).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const fmtTime = (t) => new Date(t * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
function fmtDay(t) {
  const d = new Date(t * 1000); const today = new Date(); const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}
const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 102.4) / 10} KB` : n < 1073741824 ? `${Math.round(n / 104857.6) / 10} MB` : `${Math.round(n / 107374182.4) / 10} GB`);
const SESSION_GAP = 600; // seconds: saves closer together, by the same person, are one editing session
const ALONE = ['restore', 'undo', 'outside', 'converted', 'start', 'create', 'copy', 'delete']; // never folded into a session
const KIND_CHIP = { restore: ['chip-brand', 'restore'], undo: ['chip-brand', 'undo'], outside: ['chip-warning', 'outside the app'], converted: ['', 'old history'], copy: ['', 'copy'], create: ['', 'new exam'], delete: ['chip-warning', 'file deleted'] };
const FILE_STATUS = { added: 'added', removed: 'removed', changed: 'changed' };
const IMAGE_RE = /\.(png|jpe?g|gif)$/i;

const histApi = () => (inBank() ? `/ui/api/bank/${enc(S.route.name)}/history` : '/ui/api/history');
async function postJSON(url, body) {
  try {
    const resp = await fetch(url, { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return await resp.json();
  } catch { return { error: 'The server couldn\'t be reached.' }; }
}
function notice(title, text, icon = 'warning-triangle') {
  return new Promise((resolve) => {
    openDialog(`<div class="dialog-head"><span class="dialog-icon brand">${ic(icon)}</span><div><h2 id="dlg-title">${esc(title)}</h2></div></div>
      <div class="dialog-body"><p>${esc(text)}</p></div><div class="dialog-foot"><button class="btn btn-primary" data-act="dialog-ok">OK</button></div>`);
    dialogResolve = resolve;
  });
}

function openHistory(file = null, section = null) {
  S.history = { file: file || null, section: section || null, versions: null, total: 0, files: [], head: null, selected: null, detail: null, against: 'parent', view: 'changes', open: {}, loading: true, blame: null };
  S.previewMode = 'history'; S.previewFile = null; S.previewList = null;
  openPreview();
  return loadHistory();
}
async function loadHistory({ more = false, select = null } = {}) {
  const h = S.history;
  if (!h) return;
  const project = S.project;
  const skip = more && h.versions ? h.versions.length : 0;
  try {
    const r = await getJSON(`${histApi()}?skip=${skip}${h.file ? `&file=${enc(h.file)}` : ''}${h.section ? `&section=${enc(h.section)}` : ''}`);
    if (S.history !== h || S.project !== project) return;
    if (r.error) throw new Error(r.error);
    h.versions = more ? h.versions.concat(r.versions) : r.versions;
    h.total = r.total; h.files = r.files; h.head = r.head; h.error = null;
  } catch (e) {
    console.error(e);
    if (S.history !== h) return;
    h.versions = h.versions || []; h.error = 'The history couldn\'t be loaded. Try again in a moment.';
  }
  h.loading = false;
  if (select) { pickVersion(select); return; }
  if (h.selected && !h.versions.some((v) => v.id === h.selected)) { h.selected = null; h.detail = null; }
  renderPreview();
  if (h.selected && h.against === 'now' && !more) loadVersion(); // "what changed since" follows the saves
}
function pickVersion(id) {
  const h = S.history;
  if (!h) return;
  h.selected = id; h.against = 'parent'; h.view = h.view === 'blame' ? 'blame' : 'changes'; h.detail = null;
  const s = historySessions(h.versions).find((x) => x.items.some((v) => v.id === id));
  if (s && s.items.length > 1) h.open[s.key] = true;
  loadVersion();
}
async function loadVersion() {
  const h = S.history;
  if (!h || !h.selected) return;
  const { selected: id, against } = h;
  h.detail = null;
  renderPreview();
  try {
    const r = await getJSON(`${histApi()}/${enc(id)}?against=${enc(against)}${h.file ? `&file=${enc(h.file)}` : ''}`);
    if (S.history !== h || h.selected !== id || h.against !== against) return;
    if (r.error) throw new Error(r.error);
    h.detail = r;
    if (!r.design && h.view === 'picture') h.view = 'changes';
  } catch (e) {
    console.error(e);
    if (S.history !== h || h.selected !== id) return;
    h.detail = { error: 'This version couldn\'t be loaded.' };
  }
  renderPreview();
}

function historySessions(versions) {
  const out = [];
  (versions || []).forEach((v) => {
    const s = out[out.length - 1];
    const prev = s && s.items[s.items.length - 1];
    if (s && prev.by === v.by && prev.at - v.at < SESSION_GAP && !ALONE.includes(v.kind) && !ALONE.includes(prev.kind)) s.items.push(v);
    else out.push({ key: v.id, items: [v] });
  });
  return out;
}
function versionChips(v) {
  const k = KIND_CHIP[v.kind];
  return `${v.built ? '<span class="chip chip-success">built OK</span>' : ''}${(v.names || []).map((n) => `<span class="chip chip-brand" title="${esc(n.by ? `Named by ${n.by}` : 'Named')}">${ic('bookmark')} ${esc(n.name)}</span>`).join('')}${k ? `<span class="chip ${k[0]}">${k[1]}</span>` : ''}`;
}
function versionRow(v, h, nested) {
  const files = !h.file && v.files.length ? ` · <span class="hist-files">${esc(v.files.slice(0, 3).map((f) => f.file).join(', '))}${v.files.length > 3 ? ` +${v.files.length - 3}` : ''}</span>` : '';
  return `<button class="hist-row ${nested ? 'nested' : ''} ${v.id === h.selected ? 'is-selected' : ''}" data-act="hist-pick" data-id="${esc(v.id)}" aria-pressed="${v.id === h.selected}">
    <span class="hist-when">${esc(nested ? fmtTime(v.at) : `${fmtDay(v.at)} ${fmtTime(v.at)}`)}</span><span class="hist-what">${esc(v.what)}${v.by ? ` · ${esc(v.by)}` : ''}${files}</span><span class="hist-tags">${versionChips(v)}</span></button>`;
}

function historyPreview() {
  const h = S.history;
  const title = `History · ${h.file || (h.section ? `section ${h.section}` : (inBank() ? 'whole bank' : 'whole exam'))}`;
  const label = (f) => (f.exists ? f.file : `${f.file} (deleted)`);
  const files = h.files.some((f) => f.file === h.file) || !h.file ? h.files : [{ file: h.file, exists: true }, ...h.files];
  const tabs = `<div class="preview-tabs"><label class="sr-only" for="hist-file">Show the history of</label><select class="select input-sm" id="hist-file">
      <option value="" ${h.file || h.section ? '' : 'selected'}>${inBank() ? 'Whole bank' : 'Whole exam'}</option>${h.section ? `<option value="@section" selected>Section ${esc(h.section)}</option>` : ''}${files.map((f) => `<option value="${esc(f.file)}" ${f.file === h.file ? 'selected' : ''}>${esc(label(f))}</option>`).join('')}</select>
    <span class="spacer"></span>${inBank() ? '' : `<a class="btn btn-ghost btn-sm" href="/ui/api/history/download?project=${enc(S.project)}" download title="The exam as a zip with its whole history; importing that zip as an exam brings the history back">${ic('download')} With history</a>`}<button data-act="preview-docs">Documents</button></div>`;
  if (h.loading || !h.versions) return { title, body: '<div class="preview-empty">Loading…</div>', tabs };
  const sessions = historySessions(h.versions);
  const rows = sessions.map((s) => {
    if (s.items.length === 1) return versionRow(s.items[0], h, false);
    const first = s.items[0]; const last = s.items[s.items.length - 1];
    const open = !!h.open[s.key];
    const built = s.items.some((v) => v.built); const names = s.items.flatMap((v) => v.names || []);
    return `<button class="hist-row hist-session" data-act="hist-session" data-key="${esc(s.key)}" aria-expanded="${open}">
        <span class="hist-when">${ic(open ? 'nav-arrow-down' : 'nav-arrow-right')} ${esc(fmtDay(last.at))} ${esc(fmtTime(last.at))}–${esc(fmtTime(first.at))}</span>
        <span class="hist-what">${esc(first.what)}${first.by ? ` · ${esc(first.by)}` : ''} · ${s.items.length} saves</span>
        <span class="hist-tags">${built ? '<span class="chip chip-success">built OK</span>' : ''}${names.map((n) => `<span class="chip chip-brand">${ic('bookmark')} ${esc(n.name)}</span>`).join('')}</span></button>
      ${open ? s.items.map((v) => versionRow(v, h, true)).join('') : ''}`;
  }).join('');
  const more = h.versions.length < h.total ? `<button class="hist-row hist-more" data-act="hist-more"><span class="hist-what">Show older versions (${h.total - h.versions.length} more)</span></button>` : '';
  const head = `<div class="hist-row is-current"><span class="hist-when">${h.file ? `${esc(h.file)} now` : h.section ? `Section ${esc(h.section)} now` : 'The exam now'}</span><span class="hist-what">${h.versions.length ? `${h.total} version${h.total === 1 ? '' : 's'} kept${h.file ? ' of this file' : h.section ? ' that changed its questions' : ''}, for good` : h.section ? 'No version changed the questions of this section yet.' : 'No version yet. One is kept at every save.'}</span></div>`;
  const list = `<div class="hist-list">${h.error ? `<p class="subtle" style="padding:10px 14px;margin:0">${esc(h.error)}</p>` : ''}${head}${rows}${more}</div>`;
  return { title, body: list + historyDetail(h), tabs };
}

function historyDetail(h) {
  if (!h.selected) return '<div class="hist-detail"><div class="preview-empty"><p class="subtle">Click a version to see what changed, compare it, and restore it.</p></div></div>';
  const d = h.detail;
  if (!d) return '<div class="hist-detail"><div class="preview-empty">Loading…</div></div>';
  if (d.error) return `<div class="hist-detail"><div class="preview-empty"><p>${esc(d.error)}</p></div></div>`;
  const v = d.entry;
  const isHead = v.id === h.head;
  const others = h.versions.filter((x) => x.id !== v.id);
  const named = others.filter((x) => (x.names || []).length);
  const opt = (val, text) => `<option value="${esc(val)}" ${h.against === val ? 'selected' : ''}>${esc(text)}</option>`;
  const compare = `<label class="sr-only" for="hist-against">Show</label><select class="select input-sm" id="hist-against">
      ${opt('parent', 'What this version changed')}${isHead ? '' : opt('now', 'What changed since, up to now')}
      ${named.length ? `<optgroup label="Compare with a named version">${named.map((x) => opt(x.id, `${x.names.map((n) => n.name).join(', ')} · ${fmtWhen(x.at)}`)).join('')}</optgroup>` : ''}
      <optgroup label="Compare with the version of">${others.slice(0, 80).map((x) => opt(x.id, `${fmtWhen(x.at)} · ${x.what}`.slice(0, 90))).join('')}</optgroup></select>`;
  const viewBtn = (v, label) => `<button class="btn btn-sm ${h.view === v ? 'is-on' : ''}" data-act="hist-view" data-v="${v}" aria-pressed="${h.view === v}">${label}</button>`;
  const canBlame = h.file && TEXT_RE.test(h.file);
  const views = (d.design || canBlame ? `<div class="seg" role="group" aria-label="View">${viewBtn('changes', 'Changes')}${d.design ? viewBtn('picture', `${ic('eye')} Picture of the design`) : ''}${canBlame ? viewBtn('blame', `${ic('user')} Who changed each line`) : ''}</div>` : '')
    + (h.view === 'changes' ? `<label class="check hist-split"><input type="checkbox" id="hist-split" ${S.histSplit ? 'checked' : ''}><span>Side by side</span></label>` : '');
  const actions = `<div class="hist-actions">
      ${isHead ? '' : `<button class="btn btn-sm btn-primary" data-act="hist-restore" data-mode="exam" title="Every file of the exam comes back as it was in this version">${ic('undo')} Restore the exam to this version</button>`}
      ${h.file && !isHead && d.in_version.includes(h.file) ? `<button class="btn btn-sm" data-act="hist-restore" data-mode="file" data-file="${esc(h.file)}">${ic('undo')} Restore only ${esc(h.file)}</button>` : ''}
      ${v.parent ? `<button class="btn btn-sm" data-act="hist-restore" data-mode="undo" title="Take back only what this version changed; later changes stay">${ic('restart')} ${v.kind === 'restore' || v.kind === 'undo' ? 'Undo this restore' : 'Undo this change'}</button>` : ''}
      <button class="btn btn-sm btn-ghost" data-act="hist-name">${ic('bookmark')} Name this version</button>
      ${inBank() || (S.status && S.status.format && S.status.format !== 'latex') ? '' : `<button class="btn btn-sm btn-ghost" data-act="hist-build" title="Compile the exam as it was in this version, in a scratch folder; nothing in the exam changes">${ic('page')} Build this version</button>`}</div>`;
  const names = (v.names || []).map((n) => `<span class="chip chip-brand">${ic('bookmark')} ${esc(n.name)}${n.auto ? '' : ` <button class="chip-x" data-act="hist-unname" data-name="${esc(n.name)}" title="Remove this name" aria-label="Remove the name ${esc(n.name)}">×</button>`}</span>`).join('');
  const headLine = `<div class="hist-detail-head"><b>${esc(fmtDay(v.at))} ${esc(fmtTime(v.at))}</b><span>${esc(v.what)}${v.by ? ` · ${esc(v.by)}` : ''}</span>${versionChips({ ...v, names: [] })}${names}</div>`;
  const what = h.against === 'parent' ? (v.parent ? 'Changed in this version' : 'The files when the history started')
    : h.against === 'now' ? 'Changed since this version' : `Differences between ${fmtWhen((d.base_entry || v).at)} and ${fmtWhen((d.target_entry || v).at)}`;
  const summary = d.summary.length
    ? `<div class="hist-summary"><div class="hist-summary-title">${esc(what)}</div>${d.summary.map((f) => `<div class="hist-sum-file"><b>${esc(f.file)}</b> <span class="subtle">${FILE_STATUS[f.status]}</span>${f.lines.length ? `<ul>${f.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}</div>`).join('')}</div>`
    : `<div class="hist-summary"><div class="hist-summary-title">${esc(what)}</div><p class="subtle" style="margin:4px 0 0">No difference${h.file ? ` in ${esc(h.file)}` : ''}.</p></div>`;
  let body;
  if (h.view === 'blame' && canBlame) {
    return `<div class="hist-detail">${headLine}${actions}<div class="hist-compare">${views}</div><div class="hist-detail-body">${blameHtml(h)}</div></div>`;
  }
  if (h.view === 'picture' && d.design) {
    const [bl, tl] = h.against === 'parent' ? ['Before this version', 'This version'] : h.against === 'now' ? ['This version', 'Now'] : ['Older', 'Newer'];
    const pic = (design, lbl) => `<div class="hist-picture"><div class="hist-summary-title">${esc(lbl)}</div>${design ? designPicture(design, d.design) : '<p class="subtle">No design (paper.json isn\'t there or can\'t be read).</p>'}</div>`;
    body = pic(d.design.target, tl) + pic(d.design.base, bl);
  } else {
    body = d.files.map((f) => fileDiffHtml(f, d, h)).join('') + (d.more_files ? `<p class="subtle" style="padding:8px 14px">${d.more_files} more files changed.</p>` : '');
  }
  return `<div class="hist-detail">${headLine}${actions}<div class="hist-compare">${compare}${views}</div><div class="hist-detail-body">${summary}${body}</div></div>`;
}

function diffRows(rows, split = false) {
  const words = (segs, plain) => (segs ? segs.map(([c, s]) => (c ? `<mark>${esc(s)}</mark>` : esc(s))).join('') : esc(plain));
  if (split) {
    // removed lines on the left, added ones on the right, side by side
    const out = []; let i = 0;
    while (i < rows.length) {
      const r = rows[i];
      if (r[0] === 'g') { out.push(`<div class="diff-gap sx-full">${r[1]} unchanged line${r[1] === 1 ? '' : 's'}</div>`); i += 1; continue; }
      if (r[0] === 'c') { out.push(`<div class="ctx">${esc(r[1]) || ' '}</div><div class="ctx">${esc(r[1]) || ' '}</div>`); i += 1; continue; }
      const dels = []; const adds = [];
      while (i < rows.length && rows[i][0] === 'd') dels.push(rows[i++]);
      while (i < rows.length && rows[i][0] === 'a') adds.push(rows[i++]);
      for (let k = 0; k < Math.max(dels.length, adds.length); k++) {
        out.push(dels[k] ? `<div class="del">${words(dels[k][2], dels[k][1]) || ' '}</div>` : '<div class="sx-none"></div>');
        out.push(adds[k] ? `<div class="add">${words(adds[k][2], adds[k][1]) || ' '}</div>` : '<div class="sx-none"></div>');
      }
    }
    return out.join('');
  }
  return rows.map((r) => {
    if (r[0] === 'g') return `<div class="diff-gap">${r[1]} unchanged line${r[1] === 1 ? '' : 's'}</div>`;
    if (r[0] === 'c') return `<div class="ctx">${esc(r[1]) || ' '}</div>`;
    return `<div class="${r[0] === 'd' ? 'del' : 'add'}">${words(r[2], r[1]) || ' '}</div>`;
  }).join('');
}
function fileDiffHtml(f, d, h) {
  const inV = d.in_version.includes(f.file);
  const stat = f.binary ? (f.status === 'changed' ? 'replaced' : f.status) : `${f.status === 'changed' ? '' : `${f.status} · `}<span class="diff-plus">+${f.added ?? '?'}</span> <span class="diff-minus">−${f.removed ?? '?'}</span>`;
  const isHead = d.entry.id === h.head;
  const head = `<div class="hist-file-head"><b>${esc(f.file)}</b><span class="subtle">${stat}</span><span class="spacer"></span>
    ${inV ? `<a class="btn btn-ghost btn-sm" href="${histApi()}/${enc(d.entry.id)}?raw=1&file=${enc(f.file)}${histProject()}" title="Download ${esc(f.file)} as it is in this version" aria-label="Download">${ic('download')}</a>` : ''}
    ${inV && !isHead && !h.file ? `<button class="btn btn-ghost btn-sm" data-act="hist-restore" data-mode="file" data-file="${esc(f.file)}" title="Only this file comes back as it was in this version">${ic('undo')} Restore this file</button>` : ''}</div>`;
  let body;
  if (f.binary) {
    const img = (id, label) => (id ? `<figure><figcaption>${label}</figcaption><img src="${histApi()}/${enc(id)}?raw=1&inline=1&file=${enc(f.file)}${histProject()}" alt="${esc(f.file)}, ${label}"></figure>` : `<figure><figcaption>${label}</figcaption><p class="subtle">Not there</p></figure>`);
    body = IMAGE_RE.test(f.file)
      ? `<div class="hist-imgs">${img(f.status === 'added' ? null : d.base, 'Before')}${img(f.status === 'removed' ? null : d.target, 'After')}</div>`
      : `<p class="subtle" style="padding:6px 14px;margin:0">${f.old_size != null ? fmtSize(f.old_size) : '—'} → ${f.new_size != null ? fmtSize(f.new_size) : '—'}</p>`;
  } else if (f.too_big) {
    body = '<p class="subtle" style="padding:6px 14px;margin:0">Too many lines to compare here. Download the file to look at it.</p>';
  } else {
    body = S.histSplit ? `<div class="diff diff-split">${diffRows(f.rows, true)}</div>` : `<div class="diff">${diffRows(f.rows)}</div>`;
  }
  return `<section class="hist-file">${head}${body}</section>`;
}

/* Links and images can't send the AMC-project header: they name the exam in the address (GET only). */
const histProject = () => (inBank() ? '' : `&project=${enc(S.project)}`);
const TEXT_RE = /\.(tex|txt|sty|cls|yml|yaml|csv|json)$/i;

/* Who changed each line: the file as it is now, each run of lines with the version that last changed it. */
function blameHtml(h) {
  const b = h.blame;
  if (!b || b.file !== h.file) { loadBlame(); return '<div class="preview-empty">Loading…</div>'; }
  if (b.error) return `<p class="subtle" style="padding:10px 14px">${esc(b.error)}</p>`;
  if (!b.lines.length) return '<p class="subtle" style="padding:10px 14px">The file is empty, or not in the history yet.</p>';
  let html = ''; let prev = null;
  for (const l of b.lines) {
    const c = b.commits[l.id] || {};
    const start = l.id !== prev;
    prev = l.id;
    html += `<div class="bl-row ${start ? 'bl-start' : ''}">${start ? `<button class="bl-who" data-act="hist-pick" data-id="${esc(l.id || '')}" title="${esc(c.what || '')}">${esc(c.by || 'someone')} · ${esc(fmtWhen(c.at))}<span class="subtle"> · ${esc(trunc(c.what || '', 50))}</span></button>` : '<span class="bl-who"></span>'}<span class="bl-n">${l.line}</span><span class="bl-text">${esc(l.text) || ' '}</span></div>`;
  }
  return `<div class="blame">${html}</div>${b.truncated ? '<p class="subtle" style="padding:6px 14px">Only the first 5,000 lines are shown.</p>' : ''}`;
}
async function loadBlame() {
  const h = S.history;
  if (!h || !h.file || h.blameLoading === h.file) return;
  h.blameLoading = h.file;
  const file = h.file;
  let r;
  try { r = await getJSON(`${histApi()}/blame?file=${enc(file)}`); } catch { r = { error: 'This couldn\'t be loaded.' }; }
  if (S.history !== h || h.file !== file) return;
  h.blame = { file, lines: r.lines || [], commits: r.commits || {}, truncated: !!r.truncated, error: r.error || null };
  h.blameLoading = null;
  renderPreview();
}

/* Build this version: compiled on the server in a scratch folder, shown here. */
async function historyBuild() {
  const h = S.history;
  if (!h || !h.selected) return;
  toast('Building this version…', 'refresh');
  let resp;
  try { resp = await fetch(`${histApi()}/${enc(h.selected)}/build`, { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: '{}' }); } catch { toast('The server couldn\'t be reached.', 'warning-triangle'); return; }
  const type = resp.headers.get('content-type') || '';
  if (!type.includes('pdf')) {
    let r = {};
    try { r = await resp.json(); } catch { /* not JSON */ }
    notice('This version doesn\'t build', r.error || 'Unknown error');
    return;
  }
  const blob = await resp.blob();
  if (S.versionPdf) URL.revokeObjectURL(S.versionPdf);
  S.versionPdf = URL.createObjectURL(blob);
  const v = (h.versions || []).find((x) => x.id === h.selected) || {};
  openDialog(`<div class="dialog-head"><span class="dialog-icon brand">${ic('page')}</span><div><h2 id="dlg-title">The exam as it was ${esc(fmtWhen(v.at))}</h2><p class="subtle" style="margin:2px 0 0">${esc(v.what || '')}. Compiled from that version; nothing in the exam changed.</p></div></div>
    <div class="dialog-body"><iframe class="hist-pdf" src="${S.versionPdf}" title="The question paper of that version"></iframe></div>
    <div class="dialog-foot"><a class="btn" href="${S.versionPdf}" download="${esc(S.project)} ${esc(fmtWhen(v.at))}.pdf">${ic('download')} Download</a><button class="btn btn-primary" data-act="dialog-ok">Close</button></div>`);
  const dlg = $('#layer .dialog'); if (dlg) dlg.classList.add('dialog-wide');
}

async function historyRestore(mode, file) {
  const h = S.history;
  if (!h || !h.selected) return;
  if (S.source.dirty) { toast('Save or revert your changes in the editor first.', 'warning-triangle'); return; }
  await flushQ(); await flushD(); await flushB();
  const id = h.selected;
  let p;
  try { p = await getJSON(`${histApi()}/${enc(id)}/plan?mode=${mode}${file ? `&file=${enc(file)}` : ''}`); } catch { toast('The server couldn\'t be reached.', 'warning-triangle'); return; }
  if (p.error) { notice('Not possible', p.error); return; }
  if (p.problem) { notice(mode === 'undo' ? 'This change can\'t be undone on its own' : 'Not possible', p.problem); return; }
  if (p.refused) { notice('The exam is printed', p.refused, 'lock'); return; }
  if (!p.files.length) { toast('Nothing to restore: the files are already as in that version.', 'info-circle'); return; }
  const day = fmtDay(p.entry.at);
  const when = `${day === 'Today' || day === 'Yesterday' ? day.toLowerCase() : `on ${day}`} at ${fmtTime(p.entry.at)}`;
  const intro = mode === 'exam' ? `Every file of the exam comes back as it was <b>${esc(when)}</b>.`
    : mode === 'file' ? `<b>${esc(file)}</b> comes back as it was <b>${esc(when)}</b>. The other files stay as they are.`
      : `Only what changed <b>${esc(when)}</b> (${esc(p.entry.what)}) is taken back. Later changes stay.`;
  const list = p.summary.map((f) => `<li><b>${esc(f.file)}</b> ${{ added: 'comes back', removed: 'is removed', changed: 'changes' }[f.status]}${f.lines.length ? `: ${esc(f.lines.slice(0, 6).join('; '))}${f.lines.length > 6 ? '…' : ''}` : ''}</li>`).join('');
  const ok = await confirmDialog({
    title: mode === 'undo' ? 'Undo this change?' : mode === 'file' ? `Restore ${esc(file)}?` : 'Restore the exam to this version?', icon: 'undo',
    ok: mode === 'undo' ? 'Undo the change' : 'Restore',
    body: `<p>${intro}</p><ul class="hist-plan">${list}</ul><p class="subtle">This is kept as a new version, so it can be undone from History.</p>`,
  });
  if (!ok) return;
  const label = new Date(p.entry.at * 1000).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const r = await postJSON(`${histApi()}/restore`, { mode, id, file, head: p.head, label }); // the version's time as the teacher reads it, for the new version's title
  if (!r.ok) { await notice('Not restored', r.error || 'Unknown error'); if (r.conflict) loadHistory(); return; }
  if (r.nothing) { toast(r.what, 'info-circle'); return; }
  toast(`${r.what}. Undo it from History if needed.`, 'undo');
  if (S.history === h) loadHistory({ select: r.id });
}
async function historyName() {
  const h = S.history;
  if (!h || !h.selected) return;
  const id = h.selected;
  const data = await formDialog({ title: 'Name this version', ok: 'Save', icon: 'bookmark',
    body: '<label class="field"><span class="field-label">Name</span><input class="input" name="name" maxlength="80" placeholder="Checked by the head of department"></label><p class="field-hint">The name stays on this version in History, to find it and compare with it later.</p>',
    validate: (x) => ((x.name || '').trim() ? '' : 'Give the version a name.') });
  if (!data) return;
  const r = await postJSON(`${histApi()}/name`, { id, name: data.name.trim() });
  if (!r.ok) { toast(r.error || 'Not saved.', 'warning-triangle'); return; }
  if (S.history === h) loadHistory({ select: id });
}
async function historyUnname(name) {
  const h = S.history;
  const r = await postJSON(`${histApi()}/name`, { id: h.selected, name, remove: true });
  if (!r.ok) { toast(r.error || 'Not saved.', 'warning-triangle'); return; }
  loadHistory({ select: h.selected });
}
async function deleteCurrentFile() {
  const name = S.source.name;
  if (!name || !S.files || name === S.files.main) return;
  const ok = await confirmDialog({ title: `Delete ${esc(name)}?`, ok: 'Delete', danger: true, icon: 'trash',
    body: `<p>The file is removed from the exam. ${S.source.tracked ? 'Its versions stay in History, so it can be restored.' : 'This can\'t be undone.'}</p>` });
  if (!ok) return;
  S.deletingFile = name;
  socket_emit('project-delete-file', [name, false]);
}

/* ---------- Trash (Exams page; server: ui_vcs.py) ---------- */

async function openTrash(user = null) {
  let r;
  try { r = await getJSON(`/ui/api/trash${user ? `?user=${enc(user)}` : ''}`); } catch { toast('The trash couldn\'t be read.', 'warning-triangle'); return; }
  if (r.error) { toast(r.error, 'warning-triangle'); return; }
  S.trashUser = r.admin ? user : null;
  const items = r.items || [];
  // An admin of a shared machine can look at, and restore from, another teacher's trash.
  const who = r.admin && (r.users || []).length ? `<label class="field" style="margin:0 0 10px"><span class="field-label">Whose trash</span><select class="select" id="trash-teacher">
      <option value="">Mine${r.me ? ` (${esc(r.me)})` : ''}</option>${r.users.filter((u) => u !== r.me).map((u) => `<option value="${esc(u)}" ${u === user ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select></label>` : '';
  openDialog(`<div class="dialog-head"><span class="dialog-icon brand">${ic('trash')}</span><div><h2 id="dlg-title">Trash</h2><p class="subtle" style="margin:2px 0 0">Deleted exams stay here for ${r.days} days with their history, then go for good.</p></div></div>
    <div class="dialog-body">${who}${items.length ? `<div class="list trash-list">${items.map((x) => `<div class="list-row"><span class="list-icon">${ic(x.target === 'bank' ? 'book-stack' : 'page')}</span><div class="list-row-main"><div class="list-row-title">${esc(x.name)}</div>
      <div class="subtle">${x.target === 'bank' ? 'Question bank · ' : ''}Deleted ${esc(fmtWhen(x.deleted_at))}${x.by ? ` by ${esc(x.by)}` : ''} · ${fmtSize(x.size || 0)} · ${x.days_left} day${x.days_left === 1 ? '' : 's'} left</div></div>
      <button class="btn btn-sm" data-act="trash-restore" data-id="${esc(x.id)}">${ic('undo')} Restore</button>
      <button class="btn btn-sm btn-ghost" data-act="trash-delete" data-id="${esc(x.id)}" data-name="${esc(x.name)}" title="Delete for good" aria-label="Delete ${esc(x.name)} for good">${ic('trash')}</button></div>`).join('')}</div>`
    : '<p class="subtle">The trash is empty.</p>'}</div>
    <div class="dialog-foot"><button class="btn btn-primary" data-act="dialog-ok">Close</button></div>`);
}
/* An exam from a zip ("With history" in History, or any AMC project archive): upstream's archive
   import, which drops dot-folders and takes the history back from history.bundle (ui.py). */
function examImport() {
  openDialog(`<div class="dialog-head"><span class="dialog-icon brand">${ic('upload')}</span><div><h2 id="dlg-title">Import an exam</h2><p class="subtle" style="margin:2px 0 0">A zip made with History › With history (its history comes along), or an AMC project archive (.zip, .tar.gz).</p></div></div>
    <div class="dialog-body"><input type="file" id="exam-import-file" accept=".zip,.tgz,.tar,.gz">
      <label class="field" style="margin-top:10px"><span class="field-label">Name of the exam</span><input class="input" id="exam-import-name" maxlength="80"></label><div id="exam-import-msg"></div></div>
    <div class="dialog-foot"><button class="btn" data-act="dialog-cancel">Cancel</button><button class="btn btn-primary" data-act="exam-import-go">${ic('upload')} Import</button></div>`);
}
async function examImportGo() {
  const f = ($('#exam-import-file') || {}).files; const file = f && f[0];
  const name = (($('#exam-import-name') || {}).value || '').trim() || (file ? file.name.replace(/\.(zip|tgz|tar\.gz|tar)$/i, '') : '');
  const msg = (h) => { const m = $('#exam-import-msg'); if (m) m.innerHTML = h; };
  if (!file) { msg('<p class="field-hint" style="color:var(--danger)">Choose the file first.</p>'); return; }
  let r;
  try { r = await upload('/upload/create', [[file, file.name]], { name }); } catch (e) { r = e.body || { error: e.message }; }
  if (!r || !r.ok) { msg(banner('danger', 'warning-triangle', esc((r && r.error) || 'Not imported.'), '')); return; }
  closeDialog();
  toast(`"${name}" imported.`);
  loadProjects();
  navigate(examPath(name, 'questions'));
}

async function trashRestore(id) {
  const user = S.trashUser;
  const r = await postJSON('/ui/api/trash/restore', { id, user });
  if (!r.ok) { toast(r.error || 'Not restored.', 'warning-triangle'); return; }
  toast(user ? `"${r.name}" is back in ${user}'s exams, with its history.` : `"${r.name}" is back with its history.`, 'undo');
  if (!user) { if (r.target === 'bank') { if (S.route.kind === 'banks') loadBanks(); } else loadProjects(); }
  openTrash(user);
}
async function trashDelete(id, name) {
  const ok = await confirmDialog({ danger: true, icon: 'trash', title: `Delete "${esc(name)}" for good?`, ok: 'Delete for good',
    body: '<p>The exam, its scans, marks and history are removed. This can\'t be undone.</p>' });
  const user = S.trashUser;
  if (!ok) { openTrash(user); return; }
  const r = await postJSON('/ui/api/trash/delete', { id, user });
  if (!r.ok) toast(r.error || 'Not deleted.', 'warning-triangle');
  openTrash(user);
}

async function buildPreview() {
  if (!(await qlFlush())) return;
  await flushQ(); await flushD(); await flushB();
  S.buildErr = null;
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
  const meta = (S.status && S.status.meta) || {};
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
    <section class="card"><div class="card-header"><h2>Details</h2></div><div class="card-body">
      <div class="form-grid">
        <label class="field"><span class="field-label">Class</span><input class="input" id="meta-class" value="${esc(meta.class)}" placeholder="10B"></label>
        <label class="field"><span class="field-label">Subject</span><input class="input" id="meta-subject" value="${esc(meta.subject)}" placeholder="Physics"></label>
        <label class="field"><span class="field-label">Date of the exam</span><input class="input" type="date" id="meta-date" value="${esc(meta.date)}"></label>
      </div><p class="field-hint" style="margin-top:10px">Shown on the exams list, where you can search and filter by them.</p></div>
      <div class="card-foot"><button class="btn btn-primary" data-act="save-meta">${ic('floppy-disk')} Save details</button></div></section>
    <section class="card"><div class="card-header"><h2>Copy or remove</h2></div><div class="list">
      <div class="list-row"><span class="list-icon">${ic('copy')}</span><div class="list-row-main"><div class="list-row-title">Duplicate</div><div class="subtle">A full copy of this exam, including any scans and marks.</div></div><button class="btn btn-sm" data-act="clone-exam" data-name="${esc(S.project)}">Duplicate</button></div>
      <div class="list-row"><span class="list-icon">${ic('book-stack')}</span><div class="list-row-main"><div class="list-row-title">Save as a question bank</div><div class="subtle">A new bank with a group for each section, holding copies of the questions.</div></div><button class="btn btn-sm" data-act="bank-save-exam">Save as a bank…</button></div>
      <div class="list-row"><span class="list-icon">${ic('page')}</span><div class="list-row-main"><div class="list-row-title">Save as a template</div><div class="subtle">Start your next exams from this one: its questions, sections, paper and settings, without scans or marks (New exam › My templates).</div></div><button class="btn btn-sm" data-act="template-save">Save as a template…</button></div>
      <div class="list-row"><span class="list-icon">${ic('download')}</span><div class="list-row-main"><div class="list-row-title">Download</div><div class="subtle">Everything in this exam as a zip file.</div></div><a class="btn btn-sm" href="/fs/${enc(S.project)}">Download</a></div>
      <div class="list-row"><span class="list-icon bad">${ic('trash')}</span><div class="list-row-main"><div class="list-row-title">Delete</div><div class="subtle">Moves the exam, with its scans, marks and history, to the Trash for 30 days.</div></div><button class="btn btn-sm btn-danger" data-act="delete-exam" data-name="${esc(S.project)}">Delete</button></div>
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
  if ((st.exports || []).length || st.annotated || st.annotated_single) lost.push('<li>The <b>exported marks</b> and <b>annotated sheets</b> made from them</li>');
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

/* ---------- View: questions, the form editor ---------- */

const canForm = () => !!(S.status && S.status.format === 'latex');
const useForm = () => canForm() && S.qtab === 'form';
const useDesign = () => canForm() && S.qtab === 'design';
const qfile = (name) => S.qdata && S.qdata.files.find((f) => f.file === name);
const qsel = () => { const f = S.qform; const fl = f && qfile(f.file); return (fl && fl.questions.find((q) => q.id === f.id)) || null; };
/* Questions kept in items (server: ui_items.py): an item is a folder with its own item.tex; adding,
   deleting and moving one changes pools.tex. An item holding several questions (a set) is edited
   like a file. */
const itemEntries = () => (S.qdata ? S.qdata.files.filter((f) => f.item && f.questions.length) : []);
const loneItem = (file) => { const f = qfile(file); return f && f.item && f.questions.length === 1 ? f : null; };
async function itemOp(body) {
  await flushQ();
  const r = await postJSON(qApi('items'), body);
  if (!r.ok) { toast(r.error || 'Not saved.', 'warning-triangle'); if (r.conflict) loadEditor(); return null; }
  S.qdata = r;
  return r;
}
const KIND_NAMES = { single: 'Single answer', multiple: 'Multiple answers', numeric: 'Numeric answer' };

function enterQuestions() {
  if (!S.status) { refreshStatus().then(() => { if (S.route.step === 'questions' && S.status) { renderMain(); enterQuestions(); } }); return; }
  loadFiles();
  if (useForm()) loadEditor();
  else if (useDesign()) loadDesign();
  else if (!S.source.loaded) loadSource('');
}

async function loadEditor() {
  const project = S.project;
  let r;
  try { r = await getJSON(inBank() ? qApi('') : '/ui/api/editor'); } catch (e) {
    console.error(e);
    if (S.project === project) { S.qdata = { error: 'The questions couldn\'t be read.', files: [], main: null }; renderQuestionsForm(); }
    return;
  }
  if (!inBank() && (S.project !== project || r.project !== project)) return;
  if (inBank() && (!r.bank || r.bank.name !== S.route.name)) return;
  S.qdata = r;
  if (!qsel()) {
    const first = r.files.flatMap((f) => f.questions.map((q) => ({ file: f.file, id: q.id })))[0];
    S.qform = first ? { file: first.file, id: first.id, pending: [], saving: false } : null;
  }
  renderQuestionsForm();
  const h = $('#q-head'); if (h) h.innerHTML = questionsHead();
  if (!inBank() && typeof loadCopies === 'function') loadCopies();
}
function renderQuestionsForm() { renderQList(); renderQForm(); }

function renderQList() {
  const host = $('#q-list');
  if (!host) return;
  if (inBank()) { renderBankList(host); return; }
  const d = S.qdata;
  if (!d) { host.innerHTML = '<div class="skeleton" style="height:200px;margin:12px"></div>'; return; }
  const L = locked();
  const total = d.files.reduce((n, f) => n + f.questions.length, 0);
  let files = d.files.filter((f) => f.questions.length);
  if (!files.length) files = d.files.filter((f) => f.file === d.main);
  let html = `<div class="q-list-head"><b>Questions</b><span class="chip">${total}</span><span class="spacer"></span>${L || d.error ? '' : `${d.modular ? `<button class="btn btn-sm btn-ghost" data-act="bank-pick" title="Add questions from one of your question banks">${ic('book-stack')} From a bank…</button>` : ''}<button class="btn btn-sm" data-act="q-add" title="Add a question after the selected one">${ic('plus')} Add</button>`}</div>`;
  let group; let started = false;
  files.forEach((f) => {
    if (!f.item && files.length > 1) { html += `<div class="q-file">${esc(f.file)}</div>`; started = false; }
    if (f.problem) html += `<p class="subtle q-note">${esc(f.item ? `${f.file}: ${f.problem}` : f.problem)}</p>`;
    f.questions.forEach((q) => {
      if (!started || q.group !== group) { group = q.group; html += `<div class="q-group" ${group && f.item ? `data-dropgroup="${esc(group)}"` : ''}>${group ? `Section · ${esc(group)}` : (!started ? 'Questions' : 'Not in a section')}</div>`; started = true; }
      const sel = !!(S.qform && S.qform.file === f.file && S.qform.id === q.id);
      const set = f.item && f.questions.length > 1;
      html += `<button class="q-item ${sel ? 'is-selected' : ''} ${q.problem ? 'is-problem' : ''} ${set ? 'in-set' : ''}" data-act="q-pick" data-file="${esc(f.file)}" data-id="${esc(q.id)}" aria-pressed="${sel}" ${set ? `title="In the set ${esc(f.item)}: its questions stay together"` : ''}
        draggable="${L ? 'false' : 'true'}" data-drag="q" data-item="${esc(f.item || '')}" data-group="${esc(q.group || '')}">
        <span class="q-item-id">${esc(q.id)}</span><span class="q-item-kind">${q.kind}${typeof copyBadge === 'function' ? copyBadge(f.item) : ''}</span>
        <span class="q-item-text">${q.problem ? `${ic('warning-triangle')} ${esc(q.problem)}` : esc(trunc(q.text || '(no text yet)', 70))}</span></button>`;
    });
    if (!f.questions.length) html += '<p class="subtle q-note">No question yet.</p>';
  });
  if (d.can_split && !L) html += `<div class="q-split"><button class="btn btn-ghost btn-sm" data-act="q-split" title="Each question gets its own file, ready for question banks">${ic('folder')} Move questions into item files…</button></div>`;
  host.innerHTML = html;
}

function renderQForm() {
  const host = $('#q-form');
  if (!host) return;
  const d = S.qdata;
  if (!d) { host.innerHTML = '<div class="skeleton" style="height:260px"></div>'; return; }
  if (d.error) { host.innerHTML = banner('warning', 'warning-triangle', d.error, '', `<button class="btn btn-sm" data-act="q-reload">Try again</button>`); return; }
  const q = qsel();
  const L = locked();
  if (S.qform) S.qform.locked = L;
  if (!q) {
    const total = d.files.reduce((n, f) => n + f.questions.length, 0);
    host.innerHTML = `<div class="q-empty"><p class="muted">${total ? 'Choose a question on the left.' : 'No question yet.'}</p>${L || total ? '' : `<button class="btn btn-primary" data-act="q-add">${ic('plus')} Add the first question</button>`}</div>`;
    return;
  }
  const f = S.qform;
  const ro = L || !q.editable;
  const fileQs = qfile(f.file).questions;
  const idx = fileQs.findIndex((x) => x.id === q.id);
  const li = loneItem(f.file); const ents = li ? itemEntries() : null; const ii = li ? ents.indexOf(li) : -1;
  const canUp = li ? ii > 0 : idx > 0; const canDown = li ? ii < ents.length - 1 : idx < fileQs.length - 1;
  const itemName = (qfile(f.file) || {}).item;
  const dis = ro ? 'disabled' : '';
  const head = `<div class="q-form-head"><label class="sr-only" for="qf-kind">Type</label>
    <select class="select" id="qf-kind" ${dis}>${Object.entries(KIND_NAMES).map(([v, l]) => `<option value="${v}" ${q.kind === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    ${itemName ? `<span class="chip" title="${esc(f.file)}">${ic('folder')} ${esc(itemName)}${fileQs.length > 1 ? ' · set' : ''}</span>` : ''}
    <div class="seg q-mode" role="group" aria-label="Edit this question as"><button class="btn btn-sm ${S.qmode === 'latex' ? '' : 'is-on'}" data-act="q-mode" data-v="form" aria-pressed="${S.qmode !== 'latex'}">Form</button><button class="btn btn-sm ${S.qmode === 'latex' ? 'is-on' : ''}" data-act="q-mode" data-v="latex" aria-pressed="${S.qmode === 'latex'}" title="Edit the question's LaTeX (your choice is remembered)">${ic('code')} LaTeX</button></div>
    <span class="spacer"></span>
    ${ro ? '' : `<button class="btn btn-ghost btn-icon btn-sm" data-act="q-move" data-d="-1" ${canUp ? '' : 'disabled'} title="Move up" aria-label="Move up">${ic('nav-arrow-up')}</button><button class="btn btn-ghost btn-icon btn-sm" data-act="q-move" data-d="1" ${canDown ? '' : 'disabled'} title="Move down" aria-label="Move down">${ic('nav-arrow-down')}</button>`}
    ${S.qmode === 'latex' || inBank() ? '' : `<button class="btn btn-ghost btn-sm" data-act="q-latex" data-file="${esc(f.file)}" data-line="${q.line}" title="Open the whole file in the LaTeX tab">${ic('code')} Edit in LaTeX</button>`}
    ${!inBank() && itemName && !L ? `<button class="btn btn-ghost btn-sm" data-act="bank-save-item" data-item="${esc(itemName)}" title="Copy this question into one of your question banks">${ic('book-stack')} Save to a bank…</button>` : ''}
    ${!inBank() && itemName && !L ? `<button class="btn btn-ghost btn-sm" data-act="q-duplicate" title="A copy of this question (a new name), right after it">${ic('copy')} Duplicate</button>` : ''}
    ${!inBank() ? `<button class="btn btn-ghost btn-sm" data-act="q-show-page" title="Open the question paper in the preview at this question's page">${ic('eye')} In the paper</button>` : ''}
    ${L ? '' : `<button class="btn btn-ghost btn-sm" data-act="q-delete">${ic('trash')} Delete</button>`}</div>`;
  if (S.qmode === 'latex') { renderQLatex(host, q, f, head + (inBank() ? bankMetaRow(qfile(f.file)) : itemOrigin(qfile(f.file)))); return; }
  if (!q.editable) {
    host.innerHTML = head + banner('warning', 'warning-triangle', 'This question can\'t be changed in the form.', `${esc(q.problem)} Switch to LaTeX above to edit it.`);
    return;
  }
  const single = q.kind === 'single';
  let answers;
  if (q.kind === 'numeric') {
    answers = `<div class="form-grid">
      <label class="field"><span class="field-label">Correct answer (a number)</span><input class="input mono" id="qf-num-value" value="${esc(q.numeric.value)}" ${dis}></label>
      <label class="field"><span class="field-label">Boxes (AMC options)</span><input class="input mono" id="qf-num-options" value="${esc(q.numeric.options)}" ${dis}>
        <span class="field-hint"><code>digits=3</code> three digits; <code>decimals=1</code> one decimal place; <code>sign=true</code> a sign box; <code>scoreexact=2</code> points when exact.</span></label></div>`;
  } else {
    answers = `<div class="q-answers">${q.answers.map((a, i) => `<div class="q-ans">
        <input type="${single ? 'radio' : 'checkbox'}" name="qf-correct" class="qf-ans-correct" data-i="${i}" ${a.correct ? 'checked' : ''} title="Correct answer" aria-label="Answer ${i + 1} is correct">
        <input class="input mono qf-ans-text" data-i="${i}" value="${esc(a.latex)}" ${dis} aria-label="Answer ${i + 1}">
        ${ro ? '' : `<button class="btn btn-ghost btn-icon btn-sm" data-act="qf-ans-move" data-i="${i}" data-d="-1" ${i ? '' : 'disabled'} title="Move up" aria-label="Move answer up">${ic('nav-arrow-up')}</button><button class="btn btn-ghost btn-icon btn-sm" data-act="qf-ans-move" data-i="${i}" data-d="1" ${i < q.answers.length - 1 ? '' : 'disabled'} title="Move down" aria-label="Move answer down">${ic('nav-arrow-down')}</button><button class="btn btn-ghost btn-icon btn-sm" data-act="qf-ans-remove" data-i="${i}" ${q.answers.length > 1 ? '' : 'disabled'} title="Remove" aria-label="Remove answer">${ic('xmark')}</button>`}</div>`).join('')}
      ${ro ? '' : `<button class="btn btn-sm" data-act="qf-ans-add">${ic('plus')} Add an answer</button>`}
      <p class="field-hint" style="margin:0">${single ? 'Tick the one correct answer.' : 'Tick every correct answer.'}${q.answers.some((a) => a.opts) ? ' Some answers carry their own scoring in the LaTeX.' : ''}</p></div>`;
  }
  host.innerHTML = `${head}${inBank() ? bankMetaRow(qfile(f.file)) : itemOrigin(qfile(f.file))}
    <div class="form-grid">
      <label class="field"><span class="field-label">Name</span><input class="input mono" id="qf-id" value="${esc(q.id)}" ${dis} autocomplete="off"><span class="field-hint">How the question is called in the marks.</span></label>
      <div class="field"><span class="field-label">Scoring</span><div class="row" style="gap:8px;flex-wrap:wrap"><code>${esc(q.rule || 'default')}</code><button class="btn btn-sm" data-act="qf-scoring">Change…</button></div></div>
    </div>
    <label class="field"><span class="field-label">Question</span><textarea class="input mono" id="qf-text" rows="5" ${dis}>${esc(q.latex)}</textarea>
      <span class="field-hint">LaTeX: maths between <code>$</code> signs, <code>\\textbf{…}</code> for bold, a blank line for a new paragraph.</span></label>
    <div class="q-preview" id="qf-preview" aria-live="polite"></div>
    <div><div class="field-label" style="margin-bottom:6px">Answers</div>${answers}</div>
    <label class="field"><span class="field-label">Explanation (answer key only)</span><textarea class="input mono" id="qf-explain" rows="2" ${dis}>${esc(q.explain)}</textarea></label>
    <div class="row" style="gap:8px;flex-wrap:wrap"><span class="field-label" style="margin:0">Figure</span>${q.figure ? `<code>${esc(q.figure)}</code>${ro ? '' : `<button class="btn btn-ghost btn-sm" data-act="qf-figure-remove">Remove</button>`}` : '<span class="subtle">none</span>'}
      ${ro ? '' : `<label class="btn btn-sm">${ic('upload')} Insert an image<input type="file" id="qf-figure-file" accept="image/png,image/jpeg,application/pdf" hidden></label>`}</div>
    <div class="q-form-foot"><span class="subtle" id="qf-status"></span></div>`;
  renderQPreview();
  renderQStatus();
}

function renderQStatus(state) {
  const el = $('#qf-status');
  if (!el) return;
  const f = S.qform;
  const L = locked();
  if (state === 'error') el.textContent = 'Not saved.';
  else if (f && f.saving) el.textContent = 'Saving…';
  else if (f && f.pending.length) el.textContent = 'Unsaved changes…';
  else if (f && f.lastSaved) el.textContent = `Saved ${new Date(f.lastSaved).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}.`;
  else el.textContent = L ? 'The exam is printed: only the correct answers and scoring can change.' : 'Changes are saved as you type.';
}

/* The question as students will read it: maths with KaTeX, a few common commands, the rest as typed. */
function qPreviewHtml(latex) {
  let t = esc(latex);
  t = t.replace(/\\includegraphics\s*(\[[^\]]*\])?\s*\{([^{}]*)\}/g, (m, o, file) => `<img class="q-preview-img" src="${fsUrl(file.trim())}" alt="">`);
  t = t.replace(/\\(?:textbf|bf)\{([^{}]*)\}/g, '<b>$1</b>').replace(/\\(?:emph|textit|it)\{([^{}]*)\}/g, '<i>$1</i>').replace(/\\(?:underline)\{([^{}]*)\}/g, '<u>$1</u>');
  t = t.replace(/\n[ \t]*\n/g, '<br><br>').replace(/\\\\(\[[^\]]*\])?/g, '<br>').replace(/(?<!\\)%[^\n]*/g, '');
  return t.trim() || '<span class="subtle">The question as students will read it appears here.</span>';
}
let qPreviewTimer = null;
function scheduleQPreview() { clearTimeout(qPreviewTimer); qPreviewTimer = setTimeout(renderQPreview, 250); }
function renderQPreview() {
  const el = $('#qf-preview'); const ta = $('#qf-text');
  if (!el || !ta) return;
  el.innerHTML = qPreviewHtml(ta.value);
  if (typeof renderMathInElement === 'function') {
    try { renderMathInElement(el, { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '\\[', right: '\\]', display: true }, { left: '$', right: '$', display: false }, { left: '\\(', right: '\\)', display: false }], throwOnError: false }); } catch (e) { console.error(e); }
  }
}

/* Edits go to the server as operations (ui_questions.py), a few at a time. */
let qflushTimer = null;
function qop(op, { now = false } = {}) {
  const f = S.qform;
  if (!f) return Promise.resolve(null);
  op = { ...op, id: 'id' in op ? op.id : f.id };
  if (op.op === 'rename') { op.old_id = f.id; f.id = op.new_id; } // later edits name the question by its new name
  const last = f.pending[f.pending.length - 1];
  if (last && last.op === op.op && last.id === op.id && last.i === op.i && ['text', 'answer_text', 'explain', 'numeric'].includes(op.op)) f.pending[f.pending.length - 1] = op;
  else f.pending.push(op);
  renderQStatus();
  if (now) return flushQ();
  clearTimeout(qflushTimer); qflushTimer = setTimeout(flushQ, 900);
  return Promise.resolve(null);
}
async function flushQ() {
  clearTimeout(qflushTimer);
  const f = S.qform;
  if (!f) return null;
  if (f.saving) await f.inflight; // one save at a time, in order (even if another question was picked meanwhile)
  if (!f.pending.length) return null;
  f.inflight = sendQ(f);
  return f.inflight;
}
let qChain = Promise.resolve(); // the editor's saves go one after another, whichever question they belong to
async function sendQ(f) {
  const prev = qChain; let done; qChain = new Promise((r) => { done = r; });
  f.saving = true; renderQStatus();
  await prev;
  try { return await sendQNow(f); } finally { done(); }
}
async function sendQNow(f) {
  if (!f.pending.length) { f.saving = false; renderQStatus(); return { ok: true }; }
  const ops = f.pending; f.pending = []; f.saving = true;
  renderQStatus();
  const file = f.file; const project = S.project;
  const fl = qfile(file);
  let r;
  try {
    const resp = await fetch(qApi('editor'), { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ file, based_on: fl ? fl.digest : '', ops }) });
    r = await resp.json();
  } catch { r = { error: 'The server couldn\'t be reached, so the change isn\'t saved.' }; }
  f.saving = false;
  if ((!inBank() && S.project !== project) || !S.qdata) return r;
  if (r.ok) {
    const i = S.qdata.files.findIndex((x) => x.file === file);
    if (i >= 0) S.qdata.files[i] = r.file; else S.qdata.files.push(r.file);
  }
  if (!r.ok) {
    const rename = ops.find((o) => o.op === 'rename');
    if (rename) f.id = rename.old_id; // the name didn't change
    toast(r.error || 'Not saved.', 'warning-triangle');
    if (S.qform === f) renderQStatus('error');
    if (r.conflict || r.locked) { f.pending = []; loadEditor(); } // show the file as it is
    else if (f.pending.length) { clearTimeout(qflushTimer); qflushTimer = setTimeout(flushQ, 200); } // typed meanwhile: still to save
    return r;
  }
  if (S.qform !== f) { renderQList(); if (f.pending.length) { clearTimeout(qflushTimer); qflushTimer = setTimeout(() => sendQ(f), 200); } return r; } // another question was picked meanwhile
  f.lastSaved = Date.now();
  renderQList();
  if (ops.some((o) => ['add', 'delete', 'move', 'type', 'answer_add', 'answer_remove', 'answer_move', 'rename', 'scoring'].includes(o.op))) renderQForm(); else renderQStatus();
  if (f.pending.length) { clearTimeout(qflushTimer); qflushTimer = setTimeout(flushQ, 200); }
  return r;
}

async function selectQuestion(file, id) {
  if (!(await qlFlush())) return; // unsaved LaTeX that can't be saved: stay
  flushQ();
  S.qform = { file, id, pending: [], saving: false };
  renderQuestionsForm();
}

/* A question's LaTeX view: the item's whole file (a set: all its questions), or the question's own
   \begin…\end in an exam written inline. Saved with Ctrl+S, Save, or on leaving the question;
   "Check this question" compiles what is typed, saved or not. */
let qlEditor = null;
function renderQLatex(host, q, f, head) {
  const fl = qfile(f.file);
  const item = !!fl.item;
  const key = `${f.file}#${item ? '' : q.id}`;
  if (!S.ql || S.ql.key !== key) S.ql = { key, file: f.file, id: q.id, item, text0: item ? fl.text : q.src, digest: fl.digest, buf: null, dirty: false, saving: false, result: null };
  const ql = S.ql;
  if (qlEditor) { if (ql.dirty) ql.buf = qlEditor.getValue(); qlEditor.destroy(); qlEditor = null; }
  const L = locked();
  host.innerHTML = `${head}<div class="ql">
    <div class="ql-bar"><span class="subtle">${item ? `${esc(f.file)}${fl.questions.length > 1 ? ` · a set of ${fl.questions.length} questions` : ''}` : `This question, in ${esc(f.file)}`}</span>
      <span class="spacer"></span><span class="ql-state subtle" id="ql-state"></span>
      <button class="btn btn-sm" data-act="ql-check" title="Compile what is typed here alone, with the exam's preamble">${ic('check-circle')} Check this question</button>
      ${L ? '' : `<button class="btn btn-sm btn-primary" data-act="ql-save" id="ql-save">${ic('floppy-disk')} Save</button>`}</div>
    ${L ? `<p class="subtle ql-note">The exam is printed: correct the answer key in the form or in Marking scheme.</p>` : ''}
    <div class="ql-host" id="ql-host"></div>
    <div class="ql-result" id="ql-result"></div></div>`;
  qlEditor = latexEditor('ql-host', { readOnly: L, onSave: () => qlSave() });
  qlEditor.setValue(ql.buf ?? ql.text0 ?? '', -1);
  qlEditor.session.getUndoManager().reset();
  qlEditor.session.on('change', () => { ql.dirty = qlEditor.getValue() !== ql.text0; qlState(); });
  if (ql.gotoLine) { qlEditor.gotoLine(ql.gotoLine, 0, true); qlEditor.focus(); ql.gotoLine = null; }
  qlState(); renderQLResult();
}
function qlState(msg) {
  const ql = S.ql; const st = $('#ql-state'); const b = $('#ql-save');
  if (b) b.disabled = !ql || !ql.dirty || ql.saving;
  if (st) st.textContent = msg || (ql && ql.saving ? 'Saving…' : ql && ql.dirty ? 'Unsaved changes' : 'Saved');
}
function renderQLResult() {
  const host = $('#ql-result'); const ql = S.ql;
  if (!host || !ql) return;
  const r = ql.result;
  if (!r) { host.innerHTML = ''; return; }
  if (r.checking) { host.innerHTML = `<p class="subtle">${ic('refresh')} Checking… (a few seconds)</p>`; return; }
  if (r.error) { host.innerHTML = banner('warning', 'warning-triangle', esc(r.error), ''); return; }
  if (r.errors && r.errors.length) {
    host.innerHTML = banner('danger', 'warning-triangle', r.saveError ? 'Not saved' : 'This question doesn\'t compile', r.errors.map((e) => `<div class="ql-err">${e.line && !e.file ? `<button class="link-btn" data-act="ql-goto" data-line="${e.line}">Line ${e.line}</button>: ` : e.file ? `${esc(e.file)}${e.line ? `, line ${e.line}` : ''}: ` : ''}${esc(e.message)}${e.context ? ` <code>${esc(e.context)}</code>` : ''}</div>`).join(''));
    return;
  }
  host.innerHTML = `${banner('success', 'check-circle', 'It compiles.', 'This is how it prints, alone with the exam\'s preamble:')}${r.image ? `<div class="ql-pic"><img src="${r.image}" alt="The question as compiled"></div>` : ''}`;
}
async function qlSave() {
  const ql = S.ql;
  if (!ql || !ql.dirty || ql.saving || !qlEditor) return true;
  const text = qlEditor.getValue();
  ql.saving = true; qlState();
  const r = ql.item ? await postJSON(qApi('source'), { file: ql.file, text, based_on: ql.digest })
    : await postJSON('/ui/api/editor', { file: ql.file, based_on: (qfile(ql.file) || {}).digest || '', ops: [{ op: 'latex', id: ql.id, latex: text }] });
  ql.saving = false;
  if (!r.ok) {
    const m = /^Line (\d+): (.*)$/.exec(r.error || '');
    ql.result = { saveError: true, errors: [{ line: m ? +m[1] : (r.line || null), message: m ? m[2] : (r.error || 'Not saved.'), file: null }] };
    qlState('Not saved'); renderQLResult();
    if (r.conflict) toast('Changed elsewhere meanwhile: copy your text, then reload.', 'warning-triangle');
    return false;
  }
  const id = (/\\begin\s*\{question(?:mult|multx)?\}\s*\{([^}]*)\}/.exec(text) || [])[1];
  S.ql = null; ql.dirty = false;
  if (qlEditor) qlEditor.setReadOnly(true);
  toast(`${ql.item ? ql.file : ql.id} saved.`);
  await loadEditor();
  const fl = qfile(ql.file);
  if (fl) { const keep = fl.questions.find((x) => x.id === (ql.item ? S.qform.id : id)) || fl.questions[0]; if (keep) { S.qform = { file: ql.file, id: keep.id, pending: [], saving: false }; renderQuestionsForm(); } }
  return true;
}
async function qlFlush() {
  if (!S.ql || !S.ql.dirty || !qlEditor || S.qmode !== 'latex') return true;
  return qlSave();
}
async function qlCheck() {
  const ql = S.ql;
  if (!ql || !qlEditor) return;
  ql.result = { checking: true }; renderQLResult();
  const r = await postJSON(qApi('check'), { file: ql.file, id: ql.id, text: qlEditor.getValue() });
  if (S.ql !== ql) return;
  ql.result = r.error ? { error: r.error } : r; renderQLResult();
}
async function setQMode(v) {
  if (v === S.qmode) return;
  if (!(await qlFlush())) return;
  await flushQ();
  S.qmode = v; store.set('qmode', v); S.ql = null;
  if (qlEditor && v !== 'latex') { qlEditor.destroy(); qlEditor = null; }
  renderQForm();
}
async function addQuestion() {
  const kind = await choiceDialog({ title: 'Add a question', icon: 'plus', body: '<p>What kind of question?</p>',
    choices: [['numeric', 'Numeric answer', ''], ['multiple', 'Multiple answers', ''], ['single', 'Single answer', 'btn-primary']] });
  if (!kind) return;
  const f = S.qform; const file = f ? f.file : S.qdata.main;
  const sel = qsel(); const selItem = f && qfile(f.file) ? qfile(f.file).item : null;
  if (S.qdata.modular && (selItem || !sel)) { // a new item, after the selected one (or at the end of the first section)
    const r = await itemOp({ op: 'add', kind, after: selItem, group: sel ? sel.group : null });
    if (r && r.added) { S.qform = { file: r.added.file, id: r.added.id, pending: [], saving: false, lastSaved: Date.now() }; renderQuestionsForm(); const t = $('#qf-text'); if (t) { t.focus(); t.select(); } }
    return;
  }
  const before = (qfile(file) || { questions: [] }).questions.map((q) => q.id);
  if (!f) S.qform = { file, id: null, pending: [], saving: false };
  const r = await qop({ op: 'add', id: null, kind, after: f ? f.id : null }, { now: true });
  if (r && r.ok) {
    const added = r.file.questions.find((q) => !before.includes(q.id));
    if (added) { S.qform = { file, id: added.id, pending: [], saving: false, lastSaved: Date.now() }; renderQuestionsForm(); const t = $('#qf-text'); if (t) { t.focus(); t.select(); } }
  }
}
/* The last build's first error, traced to the file it is in: an item's file opens in its question's LaTeX view at the line. */
async function loadBuildError() {
  try { const r = await getJSON('/ui/api/build-error'); S.buildErr = r.error && r.error.message ? r.error : null; } catch { S.buildErr = null; }
  const h = $('#q-head'); if (h) h.innerHTML = questionsHead();
}
function buildErrBanner() {
  const e = S.buildErr;
  const where = e.file ? `${e.file}${e.line ? `, line ${e.line}` : ''}${e.question ? ` (question ${e.question})` : ''}` : 'The build';
  return banner('danger', 'warning-triangle', `${esc(where)}: ${esc(e.message)}`, e.context ? `<code>${esc(e.context)}</code>` : '',
    e.file ? `<button class="btn btn-sm" data-act="build-err-open">${ic('code')} Open it</button>` : '');
}
async function openBuildError() {
  const e = S.buildErr;
  if (!e || !e.file) return;
  if (e.item && e.question) {
    if (S.qtab !== 'form') await switchQTab('form');
    S.qmode = 'latex'; store.set('qmode', 'latex');
    if (!S.qdata) await loadEditor();
    S.ql = null; S.qform = { file: e.file, id: e.question, pending: [], saving: false };
    renderQuestionsForm();
    if (S.ql) { S.ql.gotoLine = e.line; renderQForm(); }
    return;
  }
  editInLatex(e.file, e.line || 1);
}

/* A section's items as one LaTeX document ("%%%% item name %%%%" between them): saving first says
   what will happen, then writes every item in one version. */
let slEditor = null;
async function openSectionLatex(group) {
  await flushD();
  let r;
  try { r = await getJSON(`/ui/api/section-latex?group=${enc(group)}`); } catch { toast('The section couldn\'t be read.', 'warning-triangle'); return; }
  S.sl = { group, digests: r.digests, text0: r.text, lock: r.lock };
  openDialog(`<div class="dialog-head"><span class="dialog-icon brand">${ic('code')}</span><div><h2 id="dlg-title">Section ${esc(group)} as LaTeX</h2>
      <p class="subtle" style="margin:2px 0 0">Each item starts at its line <code>%%%% item name %%%%</code>. Keep those lines; move them to reorder, or add one with a new name to add an item.</p></div></div>
    <div class="dialog-body"><div class="sl-host" id="sl-host"></div><div id="sl-msg"></div></div>
    <div class="dialog-foot"><button class="btn" data-act="dialog-cancel">Close</button>${r.lock ? '' : `<button class="btn btn-primary" data-act="sl-save">${ic('floppy-disk')} Save…</button>`}</div>`);
  const d = $('#layer .dialog'); if (d) d.classList.add('dialog-wide');
  if (slEditor) { slEditor.destroy(); slEditor = null; }
  slEditor = latexEditor('sl-host', { readOnly: !!r.lock, onSave: () => saveSectionLatex(false) });
  slEditor.setValue(r.text, -1);
  slEditor.session.getUndoManager().reset();
}
async function saveSectionLatex(apply) {
  const sl = S.sl;
  if (!sl || !slEditor) return;
  const text = slEditor.getValue();
  const r = await postJSON('/ui/api/section-latex', { group: sl.group, text, digests: sl.digests, apply });
  const msg = $('#sl-msg');
  if (!r.ok) { if (msg) msg.innerHTML = banner('danger', 'warning-triangle', esc(r.error || 'Not saved.'), ''); const m = /^Line (\d+)/.exec(r.error || ''); if (m) { slEditor.gotoLine(+m[1], 0, true); slEditor.focus(); } return; }
  const p = r.plan;
  if (!apply) {
    const parts = [p.changed.length ? `${plural(p.changed.length, 'item', 'items')} changed (${p.changed.join(', ')})` : '', p.added.length ? `${plural(p.added.length, 'item', 'items')} added (${p.added.join(', ')})` : '', p.moved ? 'the order changed' : ''].filter(Boolean);
    if (!parts.length) { if (msg) msg.innerHTML = `<p class="subtle">Nothing changed.</p>`; return; }
    if (msg) msg.innerHTML = banner('info', 'info-circle', `Saving will do this: ${esc(parts.join('; '))}.`, 'One version in History, so it can be undone.', `<button class="btn btn-sm btn-primary" data-act="sl-apply">Save it</button>`);
    return;
  }
  const keep = text;
  closeDialog(); if (slEditor) { slEditor.destroy(); slEditor = null; }
  toast(r.what || 'Saved.');
  S.sl = null; void keep;
  loadDesign();
}
async function splitQuestions() {
  const ok = await confirmDialog({ title: 'Move the questions into item files?', icon: 'folder', ok: 'Move them',
    body: '<p>Each question, or set of questions kept together, gets its own file (<code>items/&lt;name&gt;/item.tex</code>) with its figures, and <code>pools.tex</code> lists which ones each section draws from. The paper prints the same.</p><p class="subtle">Question banks will take questions from these files. This is one version in History, so it can be undone there.</p>' });
  if (!ok) return;
  const r = await itemOp({ op: 'split' });
  if (r) { toast(r.what); S.qform = null; loadEditor(); loadFiles(); }
}
async function deleteQuestion() {
  const q = qsel(); const f = S.qform;
  if (!q) return;
  const ok = await confirmDialog({ title: `Delete ${esc(q.id)}?`, body: '<p>The question is removed from the source. The file as it is now stays in History.</p>', ok: 'Delete', danger: true, icon: 'trash' });
  if (!ok) return;
  const li = loneItem(f.file);
  if (li) { // the item goes, with its folder
    const ents = itemEntries(); const i = ents.indexOf(li); const nx = ents[i + 1] || ents[i - 1] || null;
    const r = await itemOp({ op: 'delete', item: li.item });
    if (r) { S.qform = nx ? { file: nx.file, id: nx.questions[0].id, pending: [], saving: false } : null; renderQuestionsForm(); }
    return;
  }
  const qs = qfile(f.file).questions; const i = qs.findIndex((x) => x.id === q.id);
  const next = qs[i + 1] || qs[i - 1] || null;
  const r = await qop({ op: 'delete' }, { now: true });
  if (r && r.ok) { S.qform = next ? { file: f.file, id: next.id, pending: [], saving: false } : null; renderQuestionsForm(); }
}
function moveQuestion(d) {
  const q = qsel(); const f = S.qform;
  if (!q) return;
  const li = loneItem(f.file);
  if (li) { // items move in pools.tex, into the next section when they pass its edge
    const ents = itemEntries(); const i = ents.indexOf(li);
    const t = ents[i + d];
    if (!t) return;
    const tg = t.questions[0].group;
    let before;
    if (d < 0) before = t.item;
    else { const after = ents[i + 2]; before = after && after.questions[0].group === tg ? after.item : null; }
    itemOp({ op: 'move', item: li.item, before, group: tg }).then((r) => { if (r) renderQuestionsForm(); });
    return;
  }
  const qs = qfile(f.file).questions; const i = qs.findIndex((x) => x.id === q.id);
  const before = d < 0 ? (qs[i - 1] ? qs[i - 1].id : null) : (qs[i + 2] ? qs[i + 2].id : null);
  if (d < 0 && !before) return;
  qop({ op: 'move', before }, { now: true });
}
async function editRuleForm() {
  const q = qsel();
  if (!q) return;
  const presets = (q.kind === 'multiple' ? PRESETS_M : PRESETS_S).filter(([v]) => v).map(([v, l]) => [q.kind === 'multiple' && /^mz=/.test(v) ? 'haut=0,' + v : v, l]);
  // the scoring macros the exam's preamble defines (\def\exact{b=3,m=-1}), offered by name
  const macros = ((S.qdata && S.qdata.scoring_macros) || []).filter((m) => !presets.some(([v]) => v === m.name));
  const current = !q.rule ? 'default' : presets.some(([v]) => v === q.rule) || macros.some((m) => m.name === q.rule) ? 'preset:' + q.rule : 'custom';
  const radio = (value, title2, hint = '') => `<label class="check"><input type="radio" name="choice" value="${esc(value)}" ${current === value ? 'checked' : ''}><span>${title2}${hint ? `<br><span class="subtle">${hint}</span>` : ''}</span></label>`;
  const data = await formDialog({
    title: `Scoring of ${esc(q.id)}`, ok: 'Save', icon: 'percentage-circle',
    body: `<div class="q-choices">${radio('default', 'The default scoring', 'As set in Marking scheme')}${presets.map(([v, l]) => radio('preset:' + v, esc(l), `<code>${esc(v)}</code>`)).join('')}
      ${macros.length ? `<p class="subtle" style="margin:6px 0 0">From the exam's preamble:</p>${macros.map((m) => radio('preset:' + m.name, `<code>${esc(m.name)}</code>`, `<code>${esc(m.value)}</code>`)).join('')}` : ''}${radio('custom', 'Own AMC rule')}
      <input class="input mono" name="custom" style="margin:-2px 0 6px 24px;width:calc(100% - 24px)" value="${esc(current === 'custom' ? q.rule : '')}" placeholder="b=2,m=-1" autocomplete="off"></div>`,
    validate: (v) => (!v.choice ? 'Choose how the question is scored.' : v.choice === 'custom' && !/^[A-Za-z0-9=.,+\-*/() \\]{1,200}$/.test((v.custom || '').trim()) ? 'Write an AMC rule, for example b=2,m=-1.' : ''),
  });
  if (!data) return;
  qop({ op: 'scoring', rule: data.choice === 'default' ? '' : data.choice === 'custom' ? data.custom.trim() : data.choice.slice(7) }, { now: true });
}
async function changeQKind(sel) {
  const q = qsel();
  if (!q || sel.value === q.kind) return;
  const toNumeric = sel.value === 'numeric', fromNumeric = q.kind === 'numeric';
  if (toNumeric || fromNumeric) {
    const ok = await confirmDialog({ title: `Make ${esc(q.id)} a ${KIND_NAMES[sel.value].toLowerCase()} question?`, icon: 'warning-triangle', ok: 'Change the type',
      body: toNumeric ? '<p>Its answers are replaced by one numeric answer. The file as it is now stays in History.</p>' : '<p>Its numeric answer is replaced by two answers to fill in. The file as it is now stays in History.</p>' });
    if (!ok) { sel.value = q.kind; return; }
  }
  qop({ op: 'type', kind: sel.value }, { now: true });
}
async function insertFigure(file) {
  const q = qsel();
  if (!q) return;
  try { await upload('/upload/project', [[file, file.name]]); } catch (err) { toast(err.message, 'warning-triangle'); return; }
  loadFiles();
  const typed = $('#qf-text');
  const latex = ((typed ? typed.value : q.latex).replace(/\s*\\includegraphics\s*(\[[^\]]*\])?\s*\{[^{}]*\}/, '') + '\n\n\\includegraphics[width=.5\\linewidth]{' + file.name + '}').trim();
  const ta = $('#qf-text'); if (ta) ta.value = latex;
  renderQPreview();
  qop({ op: 'text', latex }, { now: true });
}
/* ---------- View: questions, Paper design (sections and versions) ---------- */

async function loadDesign() {
  const project = S.project;
  let r; let b;
  try { [r, b] = await Promise.all([getJSON('/ui/api/structure'), getJSON('/ui/api/builder')]); } catch (e) {
    console.error(e);
    if (S.project === project) { S.design = { error: 'The paper couldn\'t be read.' }; renderDesign(); }
    return;
  }
  if (S.project !== project || r.project !== project) return;
  S.design = r;
  S.builder = b && b.builder ? b : null; // the paper builder's design (builder.js), when the exam has one
  if (!S.dform) S.dform = { pending: [], saving: false, open: null };
  renderDesign();
  const h = $('#q-head'); if (h) h.innerHTML = questionsHead();
  if (typeof loadCopies === 'function') loadCopies();
}
const dsec = (name) => S.design && (S.design.sections || []).find((s) => s.name === name);
const plainLatex = (t) => String(t || '').replace(/\\[a-zA-Z]+\*?(\[[^\]]*\])?/g, ' ').replace(/[{}$~]/g, '').replace(/\s+/g, ' ').trim();

function renderDesign() {
  const host = $('#d-panel');
  if (!host) return;
  const d = S.design;
  if (!d) { host.innerHTML = '<div class="skeleton" style="height:220px"></div><div class="skeleton" style="height:220px"></div>'; return; }
  if (d.error) { host.innerHTML = banner('warning', 'warning-triangle', d.error, '', `<button class="btn btn-sm" data-act="d-reload">Try again</button>`); return; }
  const L = locked();
  if (S.dform) S.dform.locked = L;
  if (S.builder && S.builder.builder) { renderBuilder(host); return; } // builder.js: rows and columns of blocks
  host.className = 'design';
  host.innerHTML = `<div class="d-card" id="d-sections">${renderDSections(d, L)}</div><div class="d-card" id="d-paper">${renderDPaper(d, L)}</div>`;
  renderDStatus();
}

function renderDSections(d, L) {
  const open = S.dform && S.dform.open && S.dform.open.kind === 'section' ? S.dform.open.name : null;
  let html = `<div class="d-head"><b>Sections</b><span class="chip">${d.sections.length}</span><span class="spacer"></span>${L || !d.onecopy ? '' : `<button class="btn btn-sm" data-act="d-sec-add">${ic('plus')} Add a section</button>`}</div><div class="d-body">`;
  if (!d.onecopy) html += banner('warning', 'warning-triangle', 'The main file has no \\onecopy{…}{…} block.', 'Sections are laid out inside it. Add one in the LaTeX tab, or start a new exam from a template.');
  if (d.inline) html += banner('info', 'info-circle', `${d.inline} question${d.inline > 1 ? 's are' : ' is'} written directly in the paper, outside any section.`, 'Organise them into a section to count, shuffle and lay them out from here. The questions themselves don\'t change.', L ? '' : `<button class="btn btn-sm btn-primary" data-act="d-convert">Organise into a section</button>`);
  if (!d.sections.length && !d.inline && d.onecopy) html += '<p class="muted" style="margin:0">No section yet. A section is a group of questions printed together: add one, then add questions to it.</p>';
  if (d.sections.length) html += renderDBreaks(d, L);
  d.sections.forEach((s, i) => {
    const isOpen = s.name === open;
    const per = s.count ? `${s.count} of ${s.pool} per copy` : `all ${s.pool}`;
    const chips = [s.shuffle ? 'shuffled' : 'in order', s.columns > 1 ? `${s.columns} columns` : '', s.newpage ? 'new page' : '', s.markers ? '' : 'plain \\insertgroup'].filter(Boolean);
    const marks = s.marks && s.marks.right ? ` · +${esc(s.marks.right)}${s.marks.wrong && s.marks.wrong !== '0' ? ` / ${esc(s.marks.wrong)}` : ''}` : '';
    html += `<div class="d-sec ${isOpen ? 'is-open' : ''}" data-name="${esc(s.name)}" draggable="${L || isOpen ? 'false' : 'true'}" data-drag="sec">
      <div class="d-row"><span class="d-name">${esc(s.name)}</span><span class="spacer"></span>
        ${L ? '' : `<button class="btn btn-ghost btn-icon btn-sm" data-act="d-sec-move" data-name="${esc(s.name)}" data-d="-1" ${i ? '' : 'disabled'} title="Move up" aria-label="Move section up">${ic('nav-arrow-up')}</button><button class="btn btn-ghost btn-icon btn-sm" data-act="d-sec-move" data-name="${esc(s.name)}" data-d="1" ${i < d.sections.length - 1 ? '' : 'disabled'} title="Move down" aria-label="Move section down">${ic('nav-arrow-down')}</button>`}
        <button class="btn btn-sm" data-act="${isOpen ? 'd-sec-done' : 'd-sec-edit'}" data-name="${esc(s.name)}">${isOpen ? 'Done' : (L ? 'Details' : 'Edit')}</button></div>
      <div class="d-title">${s.heading ? esc(plainLatex(s.heading)) : '<span class="subtle">No heading</span>'}</div>
      <div class="d-sub">${per}${chips.length ? ' · ' + chips.join(' · ') : ''}${marks}</div>
      ${s.problem ? `<div class="d-problem">${ic('warning-triangle')} ${esc(s.problem)}</div>` : ''}
      ${isOpen ? renderDSectionForm(s, L) : ''}
      ${!L && !isOpen ? `<div class="d-row"><button class="btn btn-ghost btn-sm" data-act="d-sec-addq" data-name="${esc(s.name)}">${ic('plus')} Add a question</button>${S.design.modular && s.pool ? `<button class="btn btn-ghost btn-sm" data-act="d-sec-latex" data-name="${esc(s.name)}" title="All the section's questions as one LaTeX document">${ic('code')} Edit as LaTeX</button><button class="btn btn-ghost btn-sm" data-act="d-sec-history" data-name="${esc(s.name)}" title="The versions that changed this section's questions">${ic('clock-rotate-right')} History</button>` : ''}${S.design.modular ? `<button class="btn btn-ghost btn-sm" data-act="bank-pick" data-section="${esc(s.name)}" title="Add questions from one of your question banks">${ic('book-stack')} From a bank…</button>${s.pool ? `<button class="btn btn-ghost btn-sm" data-act="bank-save-section" data-section="${esc(s.name)}" title="Copy this section's questions into a bank, as a group">${ic('book-stack')} Save to a bank…</button>` : ''}` : ''}</div>` : ''}
    </div>`;
  });
  (d.unused || []).forEach((u) => { html += banner('info', 'info-circle', `${u.pool} question${u.pool > 1 ? 's' : ''} in the group "${esc(u.name)}" ${u.pool > 1 ? 'aren\'t' : 'isn\'t'} printed.`, 'No section uses this group.', L ? '' : `<button class="btn btn-sm" data-act="d-sec-adopt" data-name="${esc(u.name)}">Add a section for it</button>`); });
  return html + '</div>';
}

/* Page breaks for the whole paper: every section after the first, and the first one. */
function renderDBreaks(d, L) {
  const dis = L ? 'disabled' : '';
  const br = d.breaks || {};
  const later = d.sections.slice(1);
  const before = S.builder && S.builder.builder ? 'the rows above the Questions block (the header, the instructions)' : 'what the paper prints before the sections';
  let html = `<div class="d-block d-breaks"><div class="d-row"><b>Page breaks</b></div>`;
  if (later.length) {
    html += `<div class="field"><span class="field-label">Each section after the first</span><div class="segmented full" role="group" aria-label="Each section after the first">
      <button aria-pressed="${br.between === true}" data-act="d-breaks" data-v="new" ${dis}>Starts on a new page</button>
      <button aria-pressed="${br.between === false}" data-act="d-breaks" data-v="continue" ${dis}>Continues after the previous section</button></div>
      ${br.between == null ? `<span class="field-hint">Set section by section at the moment: ${later.filter((s) => s.newpage).length} of ${later.length} start on a new page. A choice here applies to all of them.</span>` : ''}</div>`;
  }
  html += `<label class="check"><input type="checkbox" data-dbreak="first" ${br.first ? 'checked' : ''} ${dis}><span>The first section starts on a new page<br><span class="subtle">Otherwise it follows ${before} on the same page.</span></span></label></div>`;
  return html;
}

function renderDSectionForm(s, L) {
  const dis = L ? 'disabled' : '';
  const n = esc(s.name);
  return `<div class="d-form">
    ${s.markers ? '' : '<p class="field-hint" style="margin:0">This section was written by hand in the LaTeX: a heading printed above it there stays as it is. A heading set here is printed in addition.</p>'}
    <label class="field"><span class="field-label">Heading</span><input class="input" data-df="heading" data-name="${n}" value="${esc(s.heading || '')}" ${dis} placeholder="Section 1: Objective Questions"></label>
    <label class="field"><span class="field-label">Instructions under the heading</span><textarea class="input" rows="2" data-df="text" data-name="${n}" ${dis}>${esc(s.text || '')}</textarea><span class="field-hint">LaTeX, like a question's text.</span></label>
    <div class="form-grid">
      <div class="field"><span class="field-label">Questions per copy</span><div class="row" style="gap:10px;flex-wrap:wrap"><input class="input input-num" type="number" min="1" max="999" data-df="count" data-name="${n}" value="${s.count || ''}" ${s.count ? '' : 'disabled'} ${dis} aria-label="Questions per copy"><label class="check" style="margin:0"><input type="checkbox" data-df="all" data-name="${n}" ${s.count ? '' : 'checked'} ${dis}><span>All of them (${s.pool})</span></label></div><span class="field-hint">Fewer than the pool: each copy gets its own draw.</span></div>
      <label class="field"><span class="field-label">Columns</span><select class="select" data-df="columns" data-name="${n}" ${dis}>${[1, 2, 3, 4].map((c) => `<option value="${c}" ${(s.columns || 1) === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
    </div>
    <div class="row" style="gap:16px;flex-wrap:wrap">
      <label class="check"><input type="checkbox" data-df="shuffle" data-name="${n}" ${s.shuffle ? 'checked' : ''} ${dis}><span>Shuffle the questions in each copy</span></label>
      <label class="check"><input type="checkbox" data-df="newpage" data-name="${n}" ${s.newpage ? 'checked' : ''} ${dis}><span>Start on a new page</span></label>
    </div>
    ${L ? '' : `<div class="row" style="gap:8px;flex-wrap:wrap;align-items:flex-end"><label class="field" style="margin:0"><span class="field-label">Name (the group)</span><input class="input mono" id="df-rename" value="${n}" autocomplete="off"></label><button class="btn btn-sm" data-act="d-sec-rename" data-name="${n}">Rename</button><span class="spacer"></span><button class="btn btn-ghost btn-sm" data-act="d-latex" data-line="${s.line}">${ic('code')} In LaTeX</button><button class="btn btn-ghost btn-sm" data-act="d-sec-delete" data-name="${n}">${ic('trash')} Remove section</button></div>`}
  </div>`;
}

function renderDPaper(d, L) {
  const dis = L ? 'disabled' : '';
  return `<div class="d-head"><b>The paper</b><span class="spacer"></span><span class="subtle" id="d-status"></span></div><div class="d-body">
    <p class="muted" style="margin:0">The layout of the paper (its header, instructions and answer sheet) is edited in the <b>LaTeX</b> tab. The sections on the left are printed where the file inserts them. An exam made with the <b>RJ Style Paper Builder</b> composes them here instead.</p>
    <div class="d-block"><div class="d-row"><b>Versions</b></div>
    <label class="field"><span class="field-label">Versions of the paper (A, B, C…)</span><input class="input input-num" type="number" min="1" max="999" id="d-copies" value="${esc(d.copies || '')}" ${d.onecopy ? dis : 'disabled'}><span class="field-hint">Each version draws its own questions from the sections; the app's number of copies follows. Copies are photocopied from the versions: when uploading scans, say that the sheets were photocopied.</span></label></div>
    ${d.summary ? `<div class="d-block"><div class="d-row"><b>Instructions summary</b></div><div class="d-sub">The instructions carry one line per section, between the <code>%%AMCUI:SUMMARY%%</code> markers.</div>
      ${L ? '' : `<div class="d-row"><button class="btn btn-ghost btn-sm" data-act="d-summary" title="Rewrite the line per section from the sections' counts and marks">${ic('refresh')} Update the line per section</button></div>`}</div>` : ''}
  </div>`;
}

function renderDStatus(state) {
  const el = $('#d-status'); if (!el) return;
  const f = S.dform;
  if (state === 'error') { el.innerHTML = `${ic('warning-triangle')} Not saved`; return; }
  if (f && (f.saving || f.pending.length)) { el.textContent = 'Saving…'; return; }
  el.textContent = f && f.lastSaved ? 'Saved' : '';
}

/* Edits are sent as operations; typing in a field is coalesced and sent 0.9 s after the last keystroke. */
let dflushTimer = null;
function dop(op, { now = false } = {}) {
  const f = S.dform;
  if (!f) return Promise.resolve(null);
  const key = (o) => `${o.op}|${o.name || o.id || ''}`;
  const last = f.pending[f.pending.length - 1];
  if (last && key(last) === key(op) && op.op === 'section_set') f.pending[f.pending.length - 1] = { ...last, ...op };
  else f.pending.push(op);
  renderDStatus();
  if (now) return flushD();
  clearTimeout(dflushTimer); dflushTimer = setTimeout(flushD, 900);
  return Promise.resolve(null);
}
async function flushD() {
  clearTimeout(dflushTimer);
  const f = S.dform;
  if (!f) return null;
  if (f.saving) { await f.inflight; if (S.dform !== f) return null; }
  if (!f.pending.length) return null;
  f.inflight = sendD(f);
  return f.inflight;
}
async function sendD(f) {
  const ops = f.pending; f.pending = []; f.saving = true;
  renderDStatus();
  const project = S.project;
  let r;
  try {
    const resp = await fetch('/ui/api/structure', { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ based_on: S.design ? S.design.digest : '', ops }) });
    r = await resp.json();
  } catch { r = { error: 'The server couldn\'t be reached, so the change isn\'t saved.' }; }
  f.saving = false;
  if (S.project !== project || !S.design || S.dform !== f) return r;
  // Text typed in a field: saved without redrawing, so the field stays under the teacher's fingers.
  const typing = ops.every((o) => o.op === 'section_set' && !['count', 'shuffle', 'columns', 'newpage'].some((k) => k in o));
  if (!r.ok) {
    f.pending = [];
    toast(r.error || 'Not saved.', 'warning-triangle');
    if (r.conflict || r.locked) loadDesign(); // show the paper as it is
    else if (!typing) renderDesign(); // a refused value goes back to the saved one
    renderDStatus('error');
    return r;
  }
  S.design = { ...S.design, ...r.structure, digest: r.digest };
  const rename = ops.filter((o) => o.op === 'section_rename').pop();
  if (rename && f.open && f.open.kind === 'section' && f.open.name === rename.name) f.open.name = rename.new;
  f.lastSaved = Date.now();
  const inPanel = document.activeElement && $('#d-panel') && $('#d-panel').contains(document.activeElement) && document.activeElement.matches('input, textarea');
  if (typing && inPanel) renderDStatus(); else renderDesign(); // don't pull the field from under the teacher
  if (f.pending.length) { clearTimeout(dflushTimer); dflushTimer = setTimeout(flushD, 200); }
  return r;
}

function moveSection(name, d) {
  const secs = S.design.sections; const i = secs.findIndex((s) => s.name === name);
  if (i < 0 || (d < 0 && i === 0) || (d > 0 && i >= secs.length - 1)) return;
  const before = d < 0 ? secs[i - 1].name : (secs[i + 2] ? secs[i + 2].name : null);
  dop({ op: 'section_move', name, before }, { now: true });
}
async function addSection(name, fields = {}) {
  const d = S.design;
  const names = new Set([...d.sections.map((s) => s.name), ...(d.unused || []).map((u) => u.name)]);
  let n = d.sections.length + 1;
  if (!name) { name = `section${n}`; while (names.has(name)) { n += 1; name = `section${n}`; } }
  const r = await dop({ op: 'section_add', name, heading: `Section ${n}`, ...fields }, { now: true });
  if (r && r.ok) { S.dform.open = { kind: 'section', name }; renderDesign(); const h = $('[data-df="heading"]'); if (h) { h.focus(); h.select(); } }
}
async function deleteSection(name) {
  const s = dsec(name); if (!s) return;
  const keep = s.pool ? ` Its ${s.pool} question${s.pool > 1 ? 's stay' : ' stays'} in the source but ${s.pool > 1 ? 'are' : 'is'} no longer printed until a section uses the group again.` : '';
  const ok = await confirmDialog({ title: `Remove the section ${esc(name)}?`, body: `<p>The section's heading and settings are removed from the paper.${keep} The file as it is now stays in History.</p>`, ok: 'Remove', danger: true, icon: 'trash' });
  if (!ok) return;
  if (S.dform.open && S.dform.open.name === name) S.dform.open = null;
  dop({ op: 'section_delete', name }, { now: true });
}
/* A question added from a section: into the section's file, then the form opens on it. */
async function addQuestionTo(group) {
  const kind = await choiceDialog({ title: `Add a question to ${esc(group)}`, icon: 'plus', body: '<p>What kind of question?</p>',
    choices: [['numeric', 'Numeric answer', ''], ['multiple', 'Multiple answers', ''], ['single', 'Single answer', 'btn-primary']] });
  if (!kind) return;
  await flushD();
  if (S.design.modular) {
    const r = await postJSON('/ui/api/items', { op: 'add', kind, group });
    if (!r.ok) { toast(r.error || 'Not added.', 'warning-triangle'); return; }
    S.qdata = null; S.qform = { file: r.added.file, id: r.added.id, pending: [], saving: false };
    S.qtab = 'form'; store.set('qtab', 'form');
    renderMain(); loadEditor();
    return;
  }
  const s = dsec(group);
  const file = (s && s.file) || S.design.file;
  let r;
  try {
    const resp = await fetch('/ui/api/editor', { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify({ file, based_on: '', ops: [{ op: 'add', kind, group }] }) });
    r = await resp.json();
  } catch { r = { error: 'The server couldn\'t be reached.' }; }
  if (!r.ok) { toast(r.error || 'Not added.', 'warning-triangle'); return; }
  const inGroup = r.file.questions.filter((q) => q.group === group);
  const added = inGroup[inGroup.length - 1];
  S.qdata = null; S.qform = added ? { file, id: added.id, pending: [], saving: false } : null;
  S.qtab = 'form'; store.set('qtab', 'form');
  renderMain(); loadEditor();
}
async function switchQTab(v) {
  if (v === S.qtab || !['form', 'design', 'latex'].includes(v)) return;
  if (S.qtab === 'latex' && S.source.dirty && !(await saveSource())) return;
  if (!(await qlFlush())) return;
  if (qlEditor) { qlEditor.destroy(); qlEditor = null; S.ql = null; }
  await flushQ(); await flushD(); await flushB();
  if (editor) dropEditor();
  S.qtab = v; store.set('qtab', v);
  renderMain();
  if (v === 'form') loadEditor();
  else if (v === 'design') loadDesign();
  else if (!S.source.loaded) loadSource('');
}
async function editInLatex(file, line) {
  await flushQ(); await flushD(); await flushB();
  S.qtab = 'latex'; store.set('qtab', 'latex');
  S.gotoLine = line || null;
  renderMain();
  S.source.loaded = false; S.source.dirty = false;
  loadSource(file);
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
    ${typeof copiesDiffer === 'function' ? copiesDiffer() : ''}
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
    if (svg) sanitizeNode(svg); // clicks are handled here; drop the old page's inline handlers and any script
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
    ${st.marked && typeof qstatsCard === 'function' ? qstatsCard() : ''}
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
          <span class="field-hint">Written at the top of the first page. Empty: AMC's default. <code>%s</code> mark, <code>%m</code> out of, <code>%S</code> points, <code>%M</code> maximum points, <code>%(ID)</code> the student's name, or any class list column, such as <code>%(name) %(surname)</code>.</span></label>
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
    ${annotateStyleCard(a)}
    <section class="card" style="margin-top:16px"><div class="card-header">${ic('eye')}<h2>Preview one student</h2></div><div class="card-body">
      <div class="row" style="flex-wrap:wrap;gap:8px"><label class="sr-only" for="annot-copy">Sheet</label>
        <select class="select" id="annot-copy" style="max-width:360px">${rows.map((r) => `<option value="${r.student}/${r.copy}">${copyName(r.student, r.copy)}${r.name ? ' · ' + esc(r.name) : ''}</option>`).join('')}</select>
        <button class="btn" data-act="annotate-preview" ${rows.length ? '' : 'disabled'}>${ic('eye')} Preview</button></div>
      <p class="field-hint" style="margin-top:8px">Makes this student's sheet with the settings above and shows it on the right. The real annotated sheets aren't touched.</p>
    </div></section>
    ${annotatedCard(a)}
  </div>`;
}

/* The symbols AMC draws on each answer box, and the key stamped on every
   page (server/ui_legend.py). Each case shows its colour and, beside it,
   how it prints in greyscale. */
const KEY_PLACES = [['right', 'In the right margin'], ['top', 'In the top right corner'], ['none', 'No key']];
const COLOR_RE = /^#[0-9a-f]{6}$/;

function symSvg(shape, color, ticked) {
  const c = COLOR_RE.test(color) ? color : '#000000';
  const mark = {
    // as AMC draws them: corner to corner, through the corners, on the outline
    mark: `<path d="M6 6L18 18M6 18L18 6" stroke="${c}" stroke-width="2" fill="none"/>`,
    circle: `<circle cx="12" cy="12" r="7.07" stroke="${c}" stroke-width="2" fill="none"/>`,
    box: `<rect x="7" y="7" width="10" height="10" stroke="${c}" stroke-width="2.4" fill="none"/>`,
  }[shape] || '';
  return `<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" fill="${ticked ? '#c7c7c7' : '#fff'}" stroke="#555" stroke-width="1"/>${mark}</svg>`;
}

function annotateStyleCard(a) {
  if (!a.style) return '';
  const st = a.style, sc = st.scheme, custom = st.preset === 'custom';
  const shapeName = (v) => (a.shapes.find((x) => x[0] === v) || [v, v])[1];
  const preset = (v, l) => `<button role="radio" aria-pressed="${st.preset === v}" aria-checked="${st.preset === v}" data-act="astyle-preset" data-v="${v}">${l}</button>`;
  const rows = a.cases.map(([c, label]) => {
    const [shape, color] = sc[c];
    return `<tr><td>${esc(label)}</td>
      <td>${custom ? `<select class="select input-sm" data-astyle="${c}:0" aria-label="Shape for ${esc(label)}">${a.shapes.map(([v, n]) => `<option value="${v}" ${v === shape ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>` : esc(shapeName(shape))}</td>
      <td>${custom ? `<input type="color" data-astyle="${c}:1" value="${esc(color)}" aria-label="Colour for ${esc(label)}">` : `<span class="mono subtle">${esc(color)}</span>`}</td>
      <td style="text-align:center">${symSvg(shape, color, c.endsWith('_1'))}</td><td style="text-align:center;filter:grayscale(1)">${symSvg(shape, color, c.endsWith('_1'))}</td></tr>`;
  }).join('');
  const textRow = `<tr><td>Marks and header text</td><td>Text</td>
    <td>${custom ? `<input type="color" data-astyle="text" value="${esc(sc.text)}" aria-label="Colour of the marks and header text">` : `<span class="mono subtle">${esc(sc.text)}</span>`}</td>
    <td style="text-align:center"><b style="color:${COLOR_RE.test(sc.text) ? sc.text : '#000'}">7/10</b></td><td style="text-align:center;filter:grayscale(1)"><b style="color:${COLOR_RE.test(sc.text) ? sc.text : '#000'}">7/10</b></td></tr>`;
  const clash = st.legend === 'right' && (a.options.annote_position || 'marges') === 'marges';
  return `<section class="card" style="margin-top:16px"><div class="card-header">${ic('palette')}<h2>Symbols and key</h2></div><div class="card-body">
    <div class="segmented" role="radiogroup" aria-label="Symbols">${preset('clear', 'Clear in black and white')}${preset('amc', 'AMC\'s colours')}${preset('custom', 'Custom')}</div>
    <p class="field-hint" style="margin-top:8px">${st.preset === 'clear' ? 'A different shape for each case, in dark colours that stay visible when the sheets are printed in greyscale.' : st.preset === 'amc' ? 'Red and blue, as in AMC. In greyscale, the cross on a correct tick looks like the cross on a missed answer.' : 'Your own shapes and colours. Keep the shapes different: colours alone are lost in greyscale.'}</p>
    <div class="table-wrap" style="margin-top:10px"><table class="table"><thead><tr><th>Box</th><th>Shape</th><th>Colour</th><th style="text-align:center">On the sheet</th><th style="text-align:center">In greyscale</th></tr></thead><tbody>${rows}${textRow}</tbody></table></div>
    <label class="field" style="margin-top:12px;max-width:320px"><span class="field-label">Key on each page</span><select class="select" id="astyle-legend">${KEY_PLACES.map(([v, l]) => `<option value="${v}" ${st.legend === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <span class="field-hint">Explains the symbols to students: added to every page of the annotated sheets.</span></label>
    ${clash ? banner('warning', 'warning-triangle', 'The marks for each question are also written in both margins.', 'Choose "In one margin" under Marks for each question, so they don\'t cover the key.') : ''}
    <p class="field-hint" style="margin-top:10px">Changes apply the next time the sheets are annotated; Preview shows them at once.</p>
  </div></section>`;
}

function sendAnnotateStyle(ch) {
  const a = S.annotateInfo;
  if (!a || !a.style) return;
  const next = { preset: ch.preset || a.style.preset, legend: ch.legend || a.style.legend,
    scheme: JSON.parse(JSON.stringify(ch.scheme || a.style.scheme)) };
  socket_emit('ui-annotate-style', next);
  a.style = { preset: next.preset, legend: next.legend, scheme: next.preset === 'custom' ? next.scheme : a.presets[next.preset] };
  renderMain(true);
  toast('Saved. Annotate again to apply it.');
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

/* ---------- View: appearance (branding) ---------- */

async function loadLook() {
  try {
    const b = await getJSON('/ui/api/branding');
    S.look = { name: b.name || '', color: b.color || null, neutral: b.neutral, logoUrl: b.logo, file: null, fileUrl: null,
      removeLogo: false, swatches: [], presets: b.presets, palette: b.palette, canEdit: b.can_edit };
    if (b.logo) logoSwatches(b.logo);
  } catch (e) { console.error(e); S.look = null; }
  if (S.route.kind === 'appearance') renderMain(true);
}

/* Main colours of a logo: saturated, not too light or dark, by hue. */
function logoSwatches(url) {
  const img = new Image();
  img.onload = () => {
    try {
      const n = 64; const c = document.createElement('canvas'); c.width = n; c.height = n;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0, n, n);
      const d = g.getImageData(0, 0, n, n).data;
      const buckets = new Map();
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 128) continue;
        const [r, gg, b] = [d[i] / 255, d[i + 1] / 255, d[i + 2] / 255];
        const max = Math.max(r, gg, b); const min = Math.min(r, gg, b); const l = (max + min) / 2;
        const s = max === min ? 0 : (l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min));
        if (s < 0.25 || l < 0.12 || l > 0.9) continue;
        let h = 0;
        if (max === r) h = ((gg - b) / (max - min)) % 6; else if (max === gg) h = (b - r) / (max - min) + 2; else h = (r - gg) / (max - min) + 4;
        const key = Math.round(((h * 60 + 360) % 360) / 20) % 18;
        const v = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
        v.n += 1; v.r += d[i]; v.g += d[i + 1]; v.b += d[i + 2];
        buckets.set(key, v);
      }
      const hex = (v) => '#' + [v.r, v.g, v.b].map((x) => Math.round(x / v.n).toString(16).padStart(2, '0')).join('');
      S.look.swatches = [...buckets.values()].filter((v) => v.n >= 12).sort((a, b) => b.n - a.n).slice(0, 5).map(hex);
    } catch (e) { S.look.swatches = []; }
    if (S.route.kind === 'appearance') renderMain(true);
  };
  img.src = url;
}

let lookTimer = null;
function setLookColor(color) {
  S.look.color = color;
  clearTimeout(lookTimer);
  lookTimer = setTimeout(async () => {
    try { S.look.palette = (await getJSON(`/ui/api/branding/palette?color=${enc(color || S.look.neutral)}`)).palette; } catch { /* keep the last one */ }
    if (S.route.kind === 'appearance') renderMain(true);
  }, 120);
  renderMain(true);
}

function lookPreview(theme) {
  const p = S.look.palette[theme];
  const L = S.look;
  const logo = L.removeLogo ? null : (L.fileUrl || L.logoUrl);
  const bg = theme === 'light' ? '#ffffff' : '#15181e';
  const text = theme === 'light' ? '#1d2330' : '#e6e9ef';
  return `<div class="look-sample" style="--brand:${p.brand};--on-brand:${p.on_brand};background:${bg};color:${text}">
    <div class="look-bar"><span class="brandmark-logo">${logo ? `<img src="${esc(logo)}" alt="">` : 'AMC'}</span><b>${esc(L.name || 'AMC')}</b></div>
    <div class="look-body"><button class="btn btn-primary btn-sm" tabindex="-1">Save PDFs for printing</button>
      <span class="look-accent">Step 3 of 10</span><span class="look-chip">Ready to print</span></div>
    <div class="subtle" style="color:inherit;opacity:.75">${theme === 'light' ? 'Light' : 'Dark'} theme · button text ${p.on_brand === '#ffffff' ? 'white' : 'dark'}, contrast ${p.text_contrast}:1${p.adjusted ? ' · shade adjusted to stay readable' : ''}</div>
  </div>`;
}

function viewAppearance() {
  const L = S.look;
  if (!L) return `<div class="page">${header('', 'Appearance')}<div class="skeleton"></div></div>`;
  if (!L.canEdit) {
    return `<div class="page">${header('', 'Appearance', 'The school\'s name, logo and colours.')}
      ${banner('info', 'lock', 'Only administrators can change the appearance.', 'Ask an administrator of this shared machine.')}</div>`;
  }
  const logo = L.removeLogo ? null : (L.fileUrl || L.logoUrl);
  const swatch = (c, label) => `<button class="swatch ${L.color === c ? 'is-on' : ''}" data-act="look-color" data-color="${c}" title="${esc(label || c)}" aria-label="${esc(label || c)}" style="background:${c}"></button>`;
  return `<div class="page">
    ${header('', 'Appearance', 'The school\'s name, logo and colours, for everyone using this app.')}
    <div class="grid grid-2" style="align-items:start">
      <section class="card"><div class="card-header"><h2>School</h2></div><div class="card-body">
        <label class="field"><span class="field-label">School name</span><input class="input" id="look-name" value="${esc(L.name)}" placeholder="Riverside High School" maxlength="80"></label>
        <div class="field" style="margin-top:14px"><span class="field-label">Logo</span>
          <div class="row" style="gap:12px;align-items:center">
            <span class="look-logo">${logo ? `<img src="${esc(logo)}" alt="Logo">` : ic('media-image')}</span>
            <label class="btn btn-sm">${ic('upload')} ${logo ? 'Replace' : 'Choose a logo'}<input type="file" id="look-logo" accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml" hidden></label>
            ${logo ? `<button class="btn btn-ghost btn-sm" data-act="look-remove-logo">${ic('trash')} Remove</button>` : ''}
          </div>
          <span class="field-hint">PNG, JPEG or SVG, up to 1 MB. Shown in the top bar and on the sign-in page; new exams from the starters print it (PNG or JPEG).</span></div>
      </div></section>
      <section class="card"><div class="card-header"><h2>Colour</h2></div><div class="card-body">
        ${L.swatches.length ? `<div class="field-label">From the logo</div><div class="swatches">${L.swatches.map((c) => swatch(c)).join('')}</div>` : ''}
        <div class="field-label" style="margin-top:${L.swatches.length ? 12 : 0}px">Presets</div>
        <div class="swatches">${L.presets.map(([label, c]) => swatch(c, label)).join('')}</div>
        <div class="field-label" style="margin-top:12px">Any colour</div>
        <div class="row" style="gap:8px"><input type="color" id="look-color" value="${esc(L.color || L.neutral)}" aria-label="Pick a colour">
          <input class="input mono" id="look-hex" style="max-width:120px" value="${esc(L.color || '')}" placeholder="${esc(L.neutral)}" aria-label="Colour as #rrggbb"></div>
        <p class="field-hint" style="margin-top:10px">The app keeps text readable: if a colour is too pale or too dark for a theme, it uses a lighter or darker shade of it there.</p>
      </div></section>
    </div>
    <section class="card" style="margin-top:16px"><div class="card-header"><h2>Preview</h2></div>
      <div class="card-body"><div class="grid grid-2">${lookPreview('light')}${lookPreview('dark')}</div></div>
      <div class="card-foot"><button class="btn btn-ghost" data-act="look-reset">${ic('undo')} Reset to neutral</button><span class="spacer"></span>
        <button class="btn btn-primary" data-act="look-save">${ic('floppy-disk')} Save</button></div></section>
  </div>`;
}

async function saveLook(reset = false) {
  const L = S.look;
  const form = new FormData();
  if (reset) form.append('reset', '1');
  else {
    form.append('name', ($('#look-name') || {}).value ?? L.name);
    form.append('color', L.color || '');
    if (L.removeLogo) form.append('remove_logo', '1');
    if (L.file) form.append('logo', L.file, L.file.name);
  }
  try {
    const r = await fetch('/ui/branding', { method: 'POST', headers: headers(), body: form });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || `Not saved (${r.status})`);
    toast(reset ? 'Back to the neutral look.' : 'Appearance saved.');
    setTimeout(() => location.reload(), 400);
  } catch (e) { toast(e.message, 'warning-triangle'); }
}

/* ---------- Guide and tour ---------- */

async function loadGuide() {
  if (S.guidePages) return;
  try { S.guidePages = (await getJSON('/ui/api/guide')).pages; } catch { S.guidePages = []; }
  if (S.route.kind === 'exam') renderMain(true);
  if (S.previewMode === 'guide') renderPreview();
}

const guidePage = (id) => (S.guidePages || []).find((p) => p.id === id);

/* Inline Markdown: `code`, **bold**, *italic*, [text](link). Input is escaped first. */
function mdInline(text) {
  const code = [];
  let t = esc(text).replace(/`([^`]+)`/g, (m, c) => { code.push(c); return `\u0000${code.length - 1}\u0000`; });
  t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  t = t.replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>');
  t = t.replace(/\u0000(\d+)\u0000/g, (m, i) => `<code>${code[+i]}</code>`);
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, href) => {
    const g = /^guide:([a-z-]+)$/.exec(href);
    if (g) return `<a href="#" data-act="guide-open" data-page="${g[1]}">${label}</a>`;
    if (/^https?:\/\//.test(href)) return `<a href="${href}" target="_blank" rel="noopener">${label}</a>`;
    return label;
  });
  return t;
}

/* A small Markdown renderer for the guide: headings, paragraphs, lists, code blocks. */
function md(text) {
  const out = [];
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  let para = []; let list = null;
  const flush = () => {
    if (para.length) { out.push(`<p>${mdInline(para.join(' '))}</p>`); para = []; }
    if (list) { out.push(`<${list.tag}>${list.items.map((x) => `<li>${mdInline(x)}</li>`).join('')}</${list.tag}>`); list = null; }
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^```/.test(line)) {
      flush();
      const code = [];
      for (i += 1; i < lines.length && !/^```/.test(lines[i]); i += 1) code.push(lines[i]);
      out.push(`<pre class="guide-code">${esc(code.join('\n'))}</pre>`);
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const li = /^\s*(?:[-*]|(\d+)\.)\s+(.*)$/.exec(line);
    if (h) { flush(); out.push(`<h${h[1].length + 1}>${mdInline(h[2])}</h${h[1].length + 1}>`); }
    else if (li) {
      if (para.length) { out.push(`<p>${mdInline(para.join(' '))}</p>`); para = []; }
      const tag = li[1] ? 'ol' : 'ul';
      if (!list || list.tag !== tag) { if (list) flush(); list = { tag, items: [] }; }
      list.items.push(li[2]);
    } else if (!line.trim()) flush();
    else if (list && /^\s{2,}\S/.test(line)) list.items[list.items.length - 1] += ' ' + line.trim();
    else { if (list) flush(); para.push(line.trim()); }
  }
  flush();
  return out.join('\n');
}

/* The "What to do here" list of a step, from its guide page. */
function guideBullets(step) {
  const p = guidePage(step);
  if (p) {
    const m = /##\s+What to do here\s*\n([\s\S]*?)(\n##\s|$)/.exec(p.markdown);
    const items = m ? m[1].split('\n').map((l) => /^\s*-\s+(.*)$/.exec(l)).filter(Boolean).map((x) => mdInline(x[1])) : [];
    if (items.length) return items;
  }
  return (GUIDES[step] || []).map(esc);
}

function openGuide(page) {
  S.guideId = guidePage(page) || !S.guidePages ? page : 'index';
  S.previewMode = 'guide'; S.previewFile = null; S.previewList = null;
  S.guideOpen = true;
  if (S.route.kind === 'exam' && !S.previewOpen) { S.previewOpen = true; store.set('previewOpen', true); }
  renderTop(); renderPreview();
  const body = $('#preview-body'); if (body) body.scrollTop = 0;
  loadGuide();
}

function guidePreview() {
  const pages = S.guidePages;
  if (!pages) return { title: 'Guide', body: '<div class="preview-empty">Loading the guide…</div>', tabs: '' };
  const i = Math.max(0, pages.findIndex((p) => p.id === S.guideId));
  const p = pages[i];
  const tabs = `<div class="preview-tabs"><button data-act="guide-open" data-page="${pages[i - 1] ? pages[i - 1].id : ''}" ${i ? '' : 'disabled'}>${ic('nav-arrow-left')} Previous</button>
    <label class="sr-only" for="guide-select">Guide page</label><select class="select input-sm" id="guide-select">${pages.map((x) => `<option value="${x.id}" ${x.id === p.id ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}</select>
    <button data-act="guide-open" data-page="${pages[i + 1] ? pages[i + 1].id : ''}" ${pages[i + 1] ? '' : 'disabled'}>Next ${ic('nav-arrow-right')}</button></div>`;
  const toStep = S.route.kind === 'exam' && p.id !== 'index' && STEPS.some((s) => s.id === p.id) && S.route.step !== p.id
    ? `<p><a class="btn btn-sm" href="${examPath(S.project, p.id)}" data-nav>Go to this step ${ic('arrow-right')}</a></p>` : '';
  return { title: `Guide · ${p.title}`, body: `<article class="guide-page">${md(p.markdown)}${toStep}</article>`, tabs };
}

/* First-run tour: a few spotlights, skippable, replayable from the Guide menu. */
const TOUR = [
  { sel: '#sidebar', title: 'The ten steps', text: 'Every exam goes through these steps, before and after the exam. A tick means done, a number means something needs you. Open any step at any time.' },
  { sel: '#main .guide', title: 'What to do here', text: 'Each step starts with a short list of what to do. Fold it away once you know it.' },
  { sel: '#main a.btn-primary[href="/new"]', title: 'New exam', text: 'Start an exam from a template or a blank start.' },
  { sel: '.exam-card', title: 'Your exams', text: 'Each card shows where an exam stands, and the next thing to do.' },
  { sel: '#topbar [data-act="toggle-preview"]', title: 'The preview panel', text: 'Question papers, scanned pages, exported marks and annotated sheets open on the right. This button shows or hides it.' },
  { sel: '#topbar [data-menu="guide"]', title: 'The guide', text: 'The full guide, with common problems and fixes for each step. Take this tour again from here.' },
];
let tour = null;

function startTour() {
  S.menu = null; renderTop();
  const steps = TOUR.filter((t) => { const el = $(t.sel); return el && el.getClientRects().length; });
  if (!steps.length) return;
  tour = { steps, i: 0 };
  renderTour();
}
function endTour() { tour = null; store.set('tour-done', true); renderTour(); }
function renderTour() {
  let el = $('#tour');
  if (!tour) { if (el) el.remove(); return; }
  const st = tour.steps[tour.i];
  const target = $(st.sel);
  if (!target) { endTour(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'tour'; el.className = 'tour'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'tour-title'); document.body.appendChild(el); }
  const r = target.getBoundingClientRect();
  const pad = 6;
  const last = tour.i === tour.steps.length - 1;
  el.innerHTML = `<div class="tour-spot" style="left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + 2 * pad}px;height:${r.height + 2 * pad}px"></div>
    <div class="tour-card" id="tour-card"><div class="subtle">${tour.i + 1} of ${tour.steps.length}</div><h2 id="tour-title">${st.title}</h2><p>${st.text}</p>
      <div class="row" style="gap:6px"><button class="btn btn-ghost btn-sm" data-act="tour-end">Skip the tour</button><span class="spacer"></span>
      ${tour.i ? '<button class="btn btn-sm" data-act="tour-step" data-delta="-1">Back</button>' : ''}
      <button class="btn btn-primary btn-sm" data-act="${last ? 'tour-end' : 'tour-step'}" data-delta="1">${last ? 'Done' : 'Next'}</button></div></div>`;
  const card = $('#tour-card');
  const cw = card.offsetWidth; const ch = card.offsetHeight;
  let left = r.right + 16; let top = r.top;
  if (left + cw > window.innerWidth - 12) { left = Math.max(12, r.left - cw - 16); }
  if (left < 12 || (r.left - cw - 16 < 12 && r.right + 16 + cw > window.innerWidth - 12)) { left = Math.min(Math.max(12, r.left), window.innerWidth - cw - 12); top = r.bottom + 16; }
  if (top + ch > window.innerHeight - 12) top = Math.max(12, Math.min(r.top - ch - 16, window.innerHeight - ch - 12));
  card.style.left = `${left}px`; card.style.top = `${Math.max(12, top)}px`;
  card.querySelector('.btn-primary').focus();
}
window.addEventListener('resize', () => { if (tour) renderTour(); });

/* ---------- Dialogs, toasts, progress ---------- */

let dialogResolve = null;
function openDialog(html, { server = false, sticky = false } = {}) {
  $('#layer').innerHTML = `<div class="backdrop" data-act="dialog-backdrop">
    <div class="dialog ${server ? 'server-dialog' : ''} ${sticky ? 'sticky' : ''}" role="dialog" aria-modal="true" aria-labelledby="dlg-title">${html}</div></div>`;
  const first = $('#layer').querySelector('input, select, .dialog-foot .btn-primary, .dialog-foot .btn-danger, .btn, [role="button"]');
  if (first) first.focus();
}
function closeDialog(result = false) {
  $('#layer').innerHTML = '';
  if (dialogResolve) { const r = dialogResolve; dialogResolve = null; r(result); }
}
/* AMC's messages echo the LaTeX source, so they can't go into the page as they are. */
function sanitizeNode(root) {
  root.querySelectorAll('script, style, iframe, object, embed, link, meta, base, foreignObject, use').forEach((el) => el.remove());
  [root, ...root.querySelectorAll('*')].forEach((el) => [...el.attributes].forEach((a) => {
    const n = a.name.toLowerCase();
    const v = a.value.trim().toLowerCase().replace(/[\s\0]/g, '');
    if (/^on/.test(n) || n === 'srcdoc' || (['href', 'src', 'xlink:href', 'action', 'formaction', 'data'].includes(n) && /^(javascript|data|vbscript):/.test(v))) el.removeAttribute(a.name);
  }));
}
function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  sanitizeNode(doc.body);
  return doc.body.innerHTML;
}
function showServerDialog(html, { sticky = false } = {}) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  sanitizeNode(doc.body);
  // Upstream's buttons ran inline code; wire them to our dialog instead.
  const ok = doc.getElementById('warn-dialog-ok'); const cancel = doc.getElementById('warn-dialog-cancel');
  if (ok) { ok.setAttribute('data-act', sticky ? 'reload' : 'dialog-ok'); ok.setAttribute('tabindex', '0'); ok.setAttribute('role', 'button'); }
  if (cancel) { cancel.setAttribute('data-act', 'dialog-cancel'); cancel.setAttribute('tabindex', '0'); cancel.setAttribute('role', 'button'); }
  openDialog(`<h2 id="dlg-title" class="sr-only">Message</h2><div class="dialog-body">${doc.body.innerHTML}</div>`, { server: true, sticky });
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
  const long = S.work.since && Date.now() - S.work.since >= WORK_HIDE_AFTER;
  w.innerHTML = `<div class="work-card"><div class="work-title"><span class="spinner"></span>${esc(S.work.text)}</div>
    <div class="progress ${p === null || p === undefined ? 'indeterminate' : ''}"><span style="width:${Math.round((p || 0) * 100)}%"></span></div>
    ${long ? `<p class="subtle" style="margin:12px 0 0">Taking long? The server may have lost this job.</p><button class="btn btn-sm" data-act="work-hide" style="margin-top:8px">Hide this and check</button>` : ''}</div>`;
}
const WORK_HIDE_AFTER = 60 * 1000;

/* ---------- Exam actions ---------- */

const validName = (names, current = null) => (d) => {
  const n = (d.name || '').trim();
  if (!n) return 'Give the exam a name.';
  if (/[\\/:*?"<>|\x00-\x1f\x7f]/.test(n)) return 'A name can\'t contain / \\ : * ? " < > |.';
  if (/^[_.\-]/.test(n)) return 'A name can\'t start with _ . or -';
  if (new TextEncoder().encode(n).length > 120) return 'This name is too long.';
  if (n !== current && names.includes(n)) return 'An exam with this name already exists.';
  return '';
};

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
  // An exam that was printed, scanned or marked is deleted only after its name is typed.
  const p = (S.projects || []).find((x) => x.name === name);
  const st = S.project === name ? S.status : null;
  const risky = st ? !!(st.lock || st.scans || st.marked) : !!(p && ['printed', 'scanned', 'marked', 'exported'].includes(p.state));
  const body = '<p>The exam moves to the Trash with its questions, scans, marks and history. It stays there for 30 days, then goes for good.</p><p class="subtle">To get it back, open Trash on the Exams page.</p>';
  let ok;
  if (risky) {
    ok = await formDialog({
      title: `Delete "${esc(name)}"?`, ok: 'Delete exam', icon: 'trash',
      body: `${body}<label class="field"><span class="field-label">This exam has been printed, scanned or marked. Type its name to confirm: <b>${esc(name)}</b></span><input class="input" name="name" autocomplete="off"></label>`,
      validate: (d) => ((d.name || '').trim() === name ? '' : 'The name doesn\'t match.'),
    });
  } else {
    ok = await confirmDialog({ danger: true, icon: 'trash', title: `Delete "${esc(name)}"?`, body, ok: 'Delete exam' });
  }
  if (!ok) return;
  socket_emit('project-delete', name);
  toast(`"${name}" moved to the Trash.`, 'trash');
  if (S.route.kind === 'exam' && S.route.name === name) { S.source.dirty = false; navigate('/exams'); }
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
  'toggle-preview': () => {
    if (S.route.kind !== 'exam') { S.previewMode = null; renderPreview(); return; }
    S.previewOpen = !S.previewOpen; S.previewMax = false; store.set('previewOpen', S.previewOpen); renderTop(); renderPreview(); resizeEditor(); },
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
    if (ok) {
      const project = S.project;
      socket_emit('revert-manual', [rv.student, rv.page, rv.copy]);
      setTimeout(() => { if (S.project === project && S.route.step === 'check-scans') loadScans().then(() => { if (S.route.step === 'check-scans') openReview(rv.key); }); }, 400);
    }
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
  'astyle-preset': (el) => sendAnnotateStyle({ preset: el.dataset.v }),
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
  'new-exam': () => navigate('/new'),
  'exam-details': (el) => { S.menu = null; editExamDetails(el.dataset.name); },
  'look-color': (el) => { setLookColor(el.dataset.color); },
  'look-remove-logo': () => { S.look.removeLogo = true; S.look.file = null; S.look.fileUrl = null; S.look.swatches = []; renderMain(true); },
  'look-save': () => saveLook(),
  'look-reset': async () => {
    const ok = await confirmDialog({ title: 'Reset to the neutral look?', body: '<p>The school name, logo and colour are removed, for everyone.</p>', ok: 'Reset', danger: true, icon: 'undo' });
    if (ok) saveLook(true);
  },
  'guide-open': (el) => { S.menu = null; if (el.dataset.page) openGuide(el.dataset.page); },
  'tour-start': () => startTour(),
  'tour-end': () => endTour(),
  'tour-step': (el) => { tour.i = Math.max(0, Math.min(tour.steps.length - 1, tour.i + parseInt(el.dataset.delta, 10))); renderTour(); },
  'save-meta': () => { socket_emit('ui-exam-meta', { exam: S.project, class: $('#meta-class').value, subject: $('#meta-subject').value, date: $('#meta-date').value }); toast('Details saved.'); },
  'archive-exam': (el) => { S.menu = null; socket_emit('ui-exam-archive', { exam: el.dataset.name, archived: el.dataset.v === '1' }); toast(el.dataset.v === '1' ? 'Archived. Find it with the "Archived" filter.' : 'Taken out of the archive.'); },
  'wiz-go': (el) => { S.wizard.step = +el.dataset.step; renderMain(); },
  'wiz-next': () => {
    const w = S.wizard;
    if (w.step === 1) {
      const err = wizardNameError();
      w.error = err;
      if (err) { const e = $('#wiz-error'); if (e) e.textContent = err; const f = $('#wiz-name'); if (f) f.focus(); return; }
    }
    if (w.step === 2 && !wizardTemplate()) return;
    w.step += 1; renderMain();
  },
  'wiz-group': (el) => { S.wizard.group = el.dataset.v; S.wizard.query = ''; renderMain(true); },
  'wiz-pick': (el) => { S.wizard.gid = el.dataset.gid; S.wizard.id = el.dataset.id; renderMain(true); },
  'wiz-style': (el) => { S.wizard.style = el.dataset.v; renderMain(true); },
  'wiz-create': () => {
    const w = S.wizard;
    const err = wizardNameError();
    if (err) { w.step = 1; renderMain(); toast(err, 'warning-triangle'); return; }
    if (S.creating) return;
    S.creating = w.name.trim();
    renderMain(true);
    socket_emit('ui-create-exam', { name: w.name.trim(), class: w.class, subject: w.subject, date: w.date, gid: w.gid, id: w.id, style: w.style, code: w.code ? w.digits : 0, copies: w.copies, design: w.design ? { preset: w.design.preset, codes: w.design.codes, versions: w.design.versions, fields: w.design.fields, student: w.design.student } : undefined });
  },
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
    if (await confirmDialog({ title: 'Revert your changes?', body: '<p>Go back to the last saved version of this file.</p>', ok: 'Revert', danger: true, icon: 'undo' })) { setEditorText(S.source.text); clearDraft(); }
  },
  history: () => { if (S.source.name) openHistory(S.source.name); },
  'hist-pick': (el) => pickVersion(el.dataset.id),
  'hist-restore': (el) => historyRestore(el.dataset.mode, el.dataset.file || null),
  'hist-session': (el) => { const h = S.history; if (h) { h.open[el.dataset.key] = !h.open[el.dataset.key]; renderPreview(); } },
  'hist-more': () => loadHistory({ more: true }),
  'hist-view': (el) => { if (S.history) { S.history.view = el.dataset.v; renderPreview(); } },
  'hist-name': () => historyName(),
  'hist-build': () => historyBuild(),
  'exam-import': () => examImport(),
  'exam-import-go': () => examImportGo(),
  'd-sec-history': (el) => openHistory(null, el.dataset.name),
  'hist-unname': (el) => historyUnname(el.dataset.name),
  'trash-open': () => openTrash(),
  'trash-restore': (el) => trashRestore(el.dataset.id),
  'trash-delete': (el) => trashDelete(el.dataset.id, el.dataset.name),
  'draft-use': () => {
    const d = S.source.draft; if (!d || !editor) return;
    // Typed against an earlier version of the file: save against that version, so the conflict dialog asks which to keep.
    if (d.base && S.source.digest && d.base !== S.source.digest) S.source.digest = d.base;
    S.source.draft = null; setEditorText(d.text); S.source.dirty = true; renderEditorBar(); toast('The unsaved text is back in the editor. Save it to keep it.', 'floppy-disk');
  },
  'draft-discard': () => { S.source.draft = null; clearDraft(); renderEditorBar(); },
  'delete-file': () => deleteCurrentFile(),
  'dialog-result': (el) => closeDialog(el.dataset.v),
  qtab: (el) => switchQTab(el.dataset.v),
  'q-pick': (el) => { selectQuestion(el.dataset.file, el.dataset.id); if (typeof previewFollow === 'function') previewFollow(el.dataset.id); },
  'q-add': () => addQuestion(),
  'q-mode': (el) => setQMode(el.dataset.v),
  'ql-save': () => qlSave(),
  'ql-check': () => qlCheck(),
  'ql-goto': (el) => { if (qlEditor) { qlEditor.gotoLine(+el.dataset.line, 0, true); qlEditor.focus(); } },
  'build-err-open': () => openBuildError(),
  'd-sec-latex': (el) => openSectionLatex(el.dataset.name),
  'sl-save': () => saveSectionLatex(false),
  'sl-apply': () => saveSectionLatex(true),
  'q-split': () => splitQuestions(),
  'q-delete': () => deleteQuestion(),
  'q-move': (el) => moveQuestion(+el.dataset.d),
  'q-latex': (el) => editInLatex(el.dataset.file, +el.dataset.line),
  'q-reload': () => loadEditor(),
  'd-reload': () => loadDesign(),
  'd-history': () => { if (S.design && S.design.file) openHistory(S.design.file); },
  'd-sec-edit': (el) => { S.dform.open = { kind: 'section', name: el.dataset.name }; renderDesign(); },
  'd-sec-done': () => { flushD(); S.dform.open = null; renderDesign(); },
  'd-sec-move': (el) => moveSection(el.dataset.name, +el.dataset.d),
  'd-sec-delete': (el) => deleteSection(el.dataset.name),
  'd-sec-add': () => addSection(),
  'd-sec-adopt': (el) => addSection(el.dataset.name, { heading: el.dataset.name }),
  'd-sec-addq': (el) => addQuestionTo(el.dataset.name),
  'd-sec-rename': (el) => { const v = (($('#df-rename') || {}).value || '').trim(); if (v && v !== el.dataset.name) dop({ op: 'section_rename', name: el.dataset.name, new: v }, { now: true }); },
  'd-breaks': (el) => { const v = el.dataset.v === 'new'; if (!S.dform || (S.design.breaks && S.design.breaks.between === v)) return; dop({ op: 'sections_break', between: v }, { now: true }); },
  'd-convert': () => dop({ op: 'convert' }, { now: true }),
  'd-summary': () => dop({ op: 'summary' }, { now: true }),
  'd-latex': (el) => editInLatex(S.design.file, +el.dataset.line),
  'qf-history': () => openHistory(S.qform ? S.qform.file : S.qdata.main),
  'qf-ans-add': () => qop({ op: 'answer_add', latex: 'New answer' }, { now: true }).then(() => { const inputs = [...document.querySelectorAll('.qf-ans-text')]; const last = inputs[inputs.length - 1]; if (last) { last.focus(); last.select(); } }),
  'qf-ans-remove': (el) => qop({ op: 'answer_remove', i: +el.dataset.i }, { now: true }),
  'qf-ans-move': (el) => { const i = +el.dataset.i; qop({ op: 'answer_move', i, j: i + (+el.dataset.d) }, { now: true }); },
  'qf-scoring': () => editRuleForm(),
  'qf-figure-remove': () => { const q = qsel(); if (q) qop({ op: 'text', latex: q.latex.replace(/\s*\\includegraphics\s*(\[[^\]]*\])?\s*\{[^{}]*\}/, '').trim() }, { now: true }); },
  build: () => buildPreview(),
  'dialog-ok': () => closeDialog(true),
  reload: () => location.reload(),
  'work-hide': () => { S.work = null; renderWork(); refreshStatus(); },
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
  if (act === 'dialog-backdrop') { if (e.target === el && !el.querySelector('.sticky')) closeDialog(false); return; }
  const fn = ACTIONS[act] || (typeof BUILDER_ACTIONS !== 'undefined' ? BUILDER_ACTIONS[act] : null) || (typeof BANK_ACTIONS !== 'undefined' ? BANK_ACTIONS[act] : null)
    || (typeof EXTRA_ACTIONS !== 'undefined' ? EXTRA_ACTIONS[act] : null);
  if (fn) { e.preventDefault(); fn(el); }
});

document.addEventListener('change', async (e) => {
  const t = e.target;
  if (typeof bankChange === 'function' && bankChange(t)) return;
  if (t.id === 'file-select' && t.value !== S.source.name) {
    if (S.source.dirty && !(await confirmLeave())) { t.value = S.source.name; return; }
    saveDraft(); S.source.loaded = false; S.source.dirty = false; loadSource(t.value);
  }
  if (t.id === 'hist-file' && S.history && t.value !== '@section' && ((t.value || null) !== S.history.file || S.history.section)) openHistory(t.value || null);
  if (t.id === 'hist-against' && S.history) { S.history.against = t.value; loadVersion(); }
  if (t.id === 'hist-split') { S.histSplit = t.checked; store.set('histSplit', t.checked); renderPreview(); }
  if (t.id === 'trash-teacher') openTrash(t.value || null);
  if (t.id === 'qf-kind' && S.qform) changeQKind(t);
  if (t.dataset.df && S.dform) {
    const name = t.dataset.name; const k = t.dataset.df;
    if (k === 'count') dop({ op: 'section_set', name, count: +t.value || null }, { now: true });
    else if (k === 'all') { const s = dsec(name); dop({ op: 'section_set', name, count: t.checked ? null : (s && s.pool ? s.pool : 1) }, { now: true }); }
    else if (k === 'shuffle' || k === 'newpage') dop({ op: 'section_set', name, [k]: t.checked }, { now: true });
    else if (k === 'columns') dop({ op: 'section_set', name, columns: +t.value }, { now: true });
  }
  if (t.dataset.dbreak === 'first' && S.dform) dop({ op: 'sections_break', first: t.checked }, { now: true });
  if (t.id === 'd-copies' && S.dform) dop({ op: 'copies', n: +t.value }, { now: true });
  if (t.id === 'qf-id' && S.qform) { const v = t.value.trim(); if (v && v !== S.qform.id) qop({ op: 'rename', new_id: v }, { now: true }); }
  if (t.classList.contains('qf-ans-correct') && S.qform) qop({ op: 'answer_correct', i: +t.dataset.i, correct: t.checked }, { now: true });
  if (t.id === 'qf-figure-file' && t.files[0]) { insertFigure(t.files[0]); t.value = ''; }
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
  if (t.id === 'astyle-legend') sendAnnotateStyle({ legend: t.value });
  if (t.dataset.astyle && S.annotateInfo && S.annotateInfo.style) {
    const scheme = JSON.parse(JSON.stringify(S.annotateInfo.style.scheme));
    const [c, i] = t.dataset.astyle.split(':');
    if (c === 'text') scheme.text = t.value.toLowerCase(); else scheme[c][+i] = i === '1' ? t.value.toLowerCase() : t.value;
    sendAnnotateStyle({ preset: 'custom', scheme });
  }
  if (t.id === 'list-file' && t.files[0]) { uploadClassList(t.files[0]); t.value = ''; }
  if (t.id === 'list-key' && t.value) changeListKey(t);
  if (t.id === 'assoc-code' && t.value) { socket_emit('change-acode', t.value); if (S.students) S.students.code = t.value; renderMain(true); toast('Saved.'); }
  if (t.id === 'plist-select') previewListGo(+t.value);
  if (t.id === 'guide-select') openGuide(t.value);
  if (t.id === 'look-logo' && t.files[0] && S.look) {
    const f = t.files[0];
    if (f.size > 1024 * 1024) { toast('The logo is larger than 1 MB.', 'warning-triangle'); t.value = ''; return; }
    S.look.file = f; S.look.removeLogo = false;
    S.look.fileUrl = URL.createObjectURL(f);
    logoSwatches(S.look.fileUrl);
    renderMain(true);
  }
  if (t.id === 'look-hex' && S.look) {
    const v = t.value.trim();
    if (!v) setLookColor(null);
    else if (/^#[0-9a-fA-F]{6}$/.test(v)) setLookColor(v.toLowerCase());
    else toast('A colour looks like #1c7ed6.', 'warning-triangle');
  }
  if (t.id === 'wiz-code' && S.wizard) { S.wizard.code = t.checked; renderMain(true); }
  if (['dash-class', 'dash-state', 'dash-sort', 'dash-archived'].includes(t.id)) {
    const key = { 'dash-class': 'klass', 'dash-state': 'state', 'dash-sort': 'sort', 'dash-archived': 'archived' }[t.id];
    S.dash[key] = t.type === 'checkbox' ? t.checked : t.value;
    store.set('dash', S.dash);
    renderMain(true);
  }
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
  if (typeof bankInput === 'function' && bankInput(t)) return;
  if (t.id === 'qf-text' && S.qform) { qop({ op: 'text', latex: t.value }); scheduleQPreview(); }
  if (t.dataset.df && S.dform && (t.dataset.df === 'heading' || t.dataset.df === 'text')) dop({ op: 'section_set', name: t.dataset.name, [t.dataset.df]: t.value });
  if (t.id === 'qf-explain' && S.qform) qop({ op: 'explain', latex: t.value });
  if (t.classList && t.classList.contains('qf-ans-text') && S.qform) qop({ op: 'answer_text', i: +t.dataset.i, latex: t.value });
  if ((t.id === 'qf-num-value' || t.id === 'qf-num-options') && S.qform) {
    const value = $('#qf-num-value').value.trim(); // half-typed numbers ("-", "1.") wait
    if (/^-?\d+([.,]\d+)?$/.test(value)) qop({ op: 'numeric', value, options: $('#qf-num-options').value });
  }
  if (t.dataset && t.dataset.wiz && S.wizard) { S.wizard[t.dataset.wiz] = t.value; if (t.dataset.wiz === 'name') { S.wizard.error = ''; const er = $('#wiz-error'); if (er) er.textContent = ''; } }
  if (t.id === 'wiz-search' && S.wizard) {
    S.wizard.query = t.value;
    renderMain(true);
    const f = $('#wiz-search'); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); }
  }
  if (t.id === 'look-color' && S.look) setLookColor(t.value);
  if (t.id === 'look-name' && S.look) S.look.name = t.value;
  if (t.id === 'dash-search') { S.dash.query = t.value; store.set('dash', S.dash); renderDashCards(); }
  if (t.id === 'match-search') { S.matchQuery = t.value; S.matchCursor = 0; renderMatchResults(); }
  if (t.id === 'marks-search') { S.marksQuery = t.value; const host = $('#marks-table'); if (host && S.marks) host.innerHTML = marksTable(S.marks.rows); }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && S.route.kind === 'new' && S.wizard && S.wizard.step === 1 && e.target instanceof Element && e.target.matches('[data-wiz]')) {
    e.preventDefault(); ACTIONS['wiz-next'](); return;
  }
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
  if (e.key === 'Escape' && tour) { endTour(); return; }
  if (e.key === 'Escape') {
    if ($('#layer').innerHTML && !$('#layer .sticky')) closeDialog(false);
    else if (S.menu) { S.menu = null; renderTop(); if (S.route.kind === 'exams') renderMain(true); }
  }
  // A message from AMC closes with Enter or Space too (its button isn't a real <button>).
  if ((e.key === 'Enter' || e.key === ' ') && $('#layer .server-dialog:not(.sticky)') && !(e.target instanceof Element && e.target.closest('input, textarea, select, a, button'))) {
    e.preventDefault(); closeDialog(false); return;
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

function resizeEditor() { requestAnimationFrame(() => { if (editor) editor.resize(); }); } // the editor may be gone by the next frame
window.addEventListener('resize', resizeEditor);

/* ---------- Start ---------- */

applyTheme();
// After builder.js and banks.js have loaded too (they come after this file).
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { onRoute(); loadGuide(); });
else { onRoute(); loadGuide(); }
