/*
 * AMC new interface (doc/ui-redesign-plan.md), phase 1.
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
  { id: 'questions', n: 1, label: 'Questions', group: 'before', phase: 1 },
  { id: 'marking-scheme', n: 2, label: 'Marking scheme', group: 'before', phase: 2 },
  { id: 'papers', n: 3, label: 'Papers', group: 'before', phase: 2 },
  { id: 'print', n: 4, label: 'Print', group: 'before', phase: 2 },
  { id: 'upload-scans', n: 5, label: 'Upload scans', group: 'after', phase: 3 },
  { id: 'check-scans', n: 6, label: 'Check scans', group: 'after', phase: 3 },
  { id: 'mark', n: 7, label: 'Mark', group: 'after', phase: 4 },
  { id: 'match-students', n: 8, label: 'Match students', group: 'after', phase: 4 },
  { id: 'export-marks', n: 9, label: 'Export marks', group: 'after', phase: 4 },
  { id: 'annotate', n: 10, label: 'Annotate', group: 'after', phase: 4 },
];
const PHASE_NAMES = { 2: 'Before the exam', 3: 'Scans', 4: 'Results' };
const GUIDES = {
  questions: ['Write each question with its answers, and mark which answers are correct.', 'Save, then build the preview to see the question paper on the right.', 'If the build fails, the message explains why and links to the LaTeX log.'],
  'marking-scheme': ['Choose how single- and multiple-answer questions are scored.', 'Set what the final mark is out of, and how it is rounded.', 'This stays possible after printing.'],
  papers: ['Choose how many copies to print. Add a few spares.', 'Build the papers. The layout is detected automatically.', 'Check the layout, then confirm it looks correct.'],
  print: ['Save the PDFs and print them anywhere, or print on the shared machine (Linux).', 'Print on A4 at 100% (actual size), never "fit to page".', 'The exam locks after printing.'],
  'upload-scans': ['Scan the answer sheets at 300 dpi.', 'Upload the files. Each page is detected automatically.', 'Problems appear in the next step, Check scans.'],
  'check-scans': ['Fix pages the app couldn\'t read.', 'Look at each box it wasn\'t sure about.', 'Marks come next, once everything is clear.'],
  mark: ['Compute the marks once Check scans is clear.', 'Marking always uses the latest marking scheme and answer key.'],
  'match-students': ['Load the class list (a CSV file).', 'Match sheets to students automatically, then by hand for the rest.'],
  'export-marks': ['Check the marks and their distribution.', 'Export to CSV or ODS.'],
  annotate: ['Choose how marks appear on each sheet and how files are saved.', 'Preview one student, then annotate all sheets.'],
};
const DOC_LABELS = { sujet: 'Question paper', corrige: 'Answer key', catalog: 'Catalogue', 'indiv-solution': 'Corrected copies' };
const STATE_CHIPS = {
  draft: ['', 'edit-pencil', 'Draft'],
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
};
let editor = null;

const projectState = () => {
  const st = S.status;
  if (!st || !st.project) return null;
  if (st.exports.length) return 'exported';
  if (st.marked) return 'marked';
  if (st.scans) return 'scanned';
  if (st.printed) return 'printed';
  if (st.layout_pages) return 'built';
  return 'draft';
};

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
function upload(url, files, fields = {}) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    files.forEach(([blob, name]) => form.append('file', blob, name));
    Object.entries(fields).forEach(([k, v]) => form.append(k, v));
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    Object.entries(headers()).forEach(([k, v]) => xhr.setRequestHeader(k, v));
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
  refreshStatus();
});
socket.on('dialog', (html) => showServerDialog(html));
socket.on('dialog-disconnect', (html) => { showServerDialog(html); socket.disconnect(); });
socket.on('u-projects-list', () => { if (S.route.kind === 'exams') loadProjects(); });
socket.on('menu', () => refreshStatus());
socket.on('project-open', (data) => onProjectOpen(data[0]));
socket.on('source-name', (data) => onSourceName(...data));
socket.on('source-saved', () => { S.source.dirty = false; renderEditorBar(); });
socket.on('project-files-list', () => loadFiles());

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
  S.route = r; S.menu = null; S.previewDoc = null; S.previewFile = null; S.previewMax = false;
  if (leavingQuestions || r.kind !== 'exam' || r.name !== S.project) dropEditor();
  if (r.kind === 'exams') {
    S.project = null; S.status = null; S.files = null;
    document.title = 'Exams · AMC';
    render();
    loadProjects();
    return;
  }
  if (r.name !== S.project) {
    S.status = null; S.files = null; S.config = null;
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
    navigate(examPath(name, 'questions'));
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
  if (st.marked) return st.matched < st.marked ? 'match-students' : 'export-marks';
  if (st.scans) return 'check-scans';
  if (st.printed) return 'upload-scans';
  if (st.layout_pages) return 'print';
  return 'questions';
}

function enterStep() {
  if (S.route.step === 'questions') { loadFiles(); if (!S.source.loaded) loadSource(''); }
  if (S.route.step === 'settings') loadConfig();
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

/* ---------- Step status from the real exam ---------- */

function stepStatus(id) {
  const st = S.status;
  const r = (cls, count = null) => ({ cls, count });
  if (!st || !st.project) return r('');
  const problems = (st.failed || 0) + (st.incomplete || 0) + (st.to_check || 0);
  switch (id) {
    case 'questions': return st.docs.sujet ? r('is-done') : r('');
    case 'papers': return st.layout_pages ? r('is-done') : r('');
    case 'print': return st.printed ? r('is-done') : r('');
    case 'upload-scans': return st.scans ? r('is-done') : r('');
    case 'check-scans': return !st.scans ? r('') : problems ? r('is-attention', problems) : r('is-done');
    case 'mark': return st.marked ? r('is-done') : r('');
    case 'match-students': return !st.marked ? r('') : st.matched < st.marked ? r('is-attention', st.marked - st.matched) : r('is-done');
    case 'export-marks': return st.exports.length ? r('is-done') : r('');
    case 'annotate': return st.annotated ? r('is-done') : r('');
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
    const dot = st.cls === 'is-done' ? ic('check') : s.n;
    const cur = S.route.step === s.id;
    return `<a class="step ${st.cls}" href="${examPath(name, s.id)}" data-nav ${cur ? 'aria-current="page"' : ''}>
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
  else if (r.step === 'settings') html = viewSettings();
  else html = viewSoon(r.step);
  main.classList.toggle('fill', r.kind === 'exam' && r.step === 'questions');
  if (r.step === 'questions' && editor && $('#ace-host')) return; // keep the live editor
  main.innerHTML = html;
  if (keepScroll) main.scrollTop = top;
  if (r.step === 'questions' && S.project) mountEditor();
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
  if (S.previewFile) {
    title = S.previewFile.name;
    url = fsUrl(S.previewFile.name);
    ({ body, bodyClass } = fileBody(S.previewFile.name, url));
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
  const st = S.status || {};
  const risky = st.printed || st.scans;
  return `<div class="page wide">
    ${header('questions', 'Questions', 'Write the questions and answers. Save, then build the preview to see the question paper.',
    `<button class="btn" data-act="build" ${S.source.loaded ? '' : 'disabled'}>${ic('refresh')} Build preview</button>
     <button class="btn btn-primary" data-act="save" id="save-btn" disabled>${ic('floppy-disk')} Save</button>`)}
    ${guideBox('questions')}
    ${risky ? banner('lock', 'warning-triangle', st.scans ? 'Scans have been uploaded for this exam.' : 'This exam has been printed.',
    'Rebuilding the question paper now removes the layout data, and with it the scans and marks. Locking printed exams comes in phase 2.') : ''}
    <div class="editor-bar" id="editor-bar"></div>
    <div class="editor-frame grow" id="editor-frame"><div id="ace-host"></div></div>
  </div>`;
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
  try {
    await upload('/upload/source', [[new Blob([editor.getValue()], { type: 'text/plain' }), S.source.name]]);
    S.source.text = editor.getValue();
    S.source.dirty = false;
    renderEditorBar();
    toast(`${S.source.name} saved.`);
    return true;
  } catch (e) { toast(e.message, 'warning-triangle'); return false; }
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
    ? `<select class="select" id="cfg-engine">${(c.engines.includes(engine) || !engine ? c.engines : [engine, ...c.engines]).map((e) => `<option ${e === engine ? 'selected' : ''}>${esc(e)}</option>`).join('')}</select>`
    : `<input class="input" id="cfg-engine" value="${esc(engine)}" placeholder="pdflatex">`;
  return `<div class="page">
    ${header('', 'Exam settings', 'Settings that belong to this exam.')}
    <section class="card"><div class="card-header"><h2>Exam</h2></div><div class="card-body">
      <div class="form-grid">
        <label class="field"><span class="field-label">Name</span><span class="input-group"><input class="input" id="cfg-name" value="${esc(S.project)}"><button class="btn" data-act="rename-current">Rename</button></span></label>
        <label class="field"><span class="field-label">LaTeX engine</span>${c ? engineField : '<input class="input" disabled>'}
          <span class="field-hint">Used to build the papers. pdflatex suits most exams.</span></label>
      </div></div></section>
    <section class="card"><div class="card-header"><h2>Copy or remove</h2></div><div class="list">
      <div class="list-row"><span class="list-icon">${ic('copy')}</span><div class="list-row-main"><div class="list-row-title">Duplicate</div><div class="subtle">A copy of the questions and settings, without scans or marks.</div></div><button class="btn btn-sm" data-act="clone-exam" data-name="${esc(S.project)}">Duplicate</button></div>
      <div class="list-row"><span class="list-icon">${ic('download')}</span><div class="list-row-main"><div class="list-row-title">Download</div><div class="subtle">Everything in this exam as a zip file.</div></div><a class="btn btn-sm" href="/fs/${enc(S.project)}">Download</a></div>
      <div class="list-row"><span class="list-icon bad">${ic('trash')}</span><div class="list-row-main"><div class="list-row-title">Delete</div><div class="subtle">Removes the exam with its scans and marks. This can't be undone.</div></div><button class="btn btn-sm btn-danger" data-act="delete-exam" data-name="${esc(S.project)}">Delete</button></div>
    </div></section>
  </div>`;
}

/* ---------- View: steps arriving in later phases ---------- */

function viewSoon(stepId) {
  const s = STEPS.find((x) => x.id === stepId);
  const st = S.status || {};
  const facts = {
    papers: st.layout_pages ? [stat(st.layout_pages, 'Pages laid out', 'ok')] : [],
    print: st.printed ? [stat('Yes', 'Printed', 'ok')] : [],
    'upload-scans': st.scans ? [stat(st.scans, 'Pages scanned', 'ok')] : [],
    'check-scans': st.scans ? [stat(st.failed, 'Unreadable pages', st.failed ? 'bad' : 'ok'), stat(st.incomplete, 'Incomplete copies', st.incomplete ? 'warn' : 'ok'), stat(st.to_check, 'Pages to check', st.to_check ? 'warn' : 'ok')] : [],
    mark: st.marked ? [stat(st.marked, 'Copies marked', 'ok')] : [],
    'match-students': st.marked ? [stat(st.matched, 'Matched to students', st.matched < st.marked ? 'warn' : 'ok')] : [],
    'export-marks': st.exports && st.exports.length ? [stat(st.exports.length, 'Exported files', 'ok')] : [],
    annotate: st.annotated ? [stat(st.annotated, 'Annotated sheets', 'ok')] : [],
  }[stepId] || [];
  return `<div class="page">
    ${header(stepId, s.label, '')}
    ${guideBox(stepId)}
    <section class="card"><div class="empty soon">
      <div class="empty-icon">${ic('hammer')}</div>
      <h2>Coming in phase ${s.phase}: ${PHASE_NAMES[s.phase]}</h2>
      <p>This step is being rebuilt in the new style. Until then, do it in the AMC desktop app.</p>
      ${facts.length ? `<div class="stats" style="max-width:560px;margin:8px auto 0">${facts.join('')}</div><p class="subtle">From this exam's data.</p>` : ''}
    </div></section>
  </div>`;
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
  'preview-docs': () => { S.previewFile = null; renderPreview(); },
  'show-doc': (el) => { S.previewDoc = el.dataset.doc; S.previewFile = null; renderPreview(); },
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
    navigate(nav.getAttribute('href'));
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
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if ($('#layer').innerHTML && !$('#layer .server-dialog')) closeDialog(false);
    else if (S.menu) { S.menu = null; renderTop(); if (S.route.kind === 'exams') renderMain(true); }
  }
  // The editor handles its own Ctrl/Cmd+S.
  if ((e.metaKey || e.ctrlKey) && e.key === 's' && S.route.step === 'questions' && !(e.target.closest && e.target.closest('.ace_editor'))) { e.preventDefault(); saveSource(); }
});

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
