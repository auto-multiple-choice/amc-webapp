/*
 * Editor extras (doc/question-bank-plan.md, section 12.1: left from questions-banks-templates-plan.md):
 * drag and drop ordering of an exam's questions, a bank's questions and Paper design's sections (the
 * buttons stay, for the keyboard); the selected question's page in the preview; "copies differ" in
 * Papers; Duplicate a question; the teacher's own templates. Loaded after app.js and banks.js.
 */
/* global S, $, esc, ic, enc, store, getJSON, postJSON, toast, notice, confirmDialog, formDialog, banner, plural,
   qsel, qfile, itemOp, qop, dop, inBank, qApi, renderQuestionsForm, renderPreview, renderMain, loadGallery, openPreview */

/* ---------- Drag and drop ---------- */

let DRAG = null;
const clearDrop = (all = true) => document.querySelectorAll(all ? '.drop-before, .drop-into, .is-dragging' : '.drop-before, .drop-into')
  .forEach((x) => x.classList.remove('drop-before', 'drop-into', 'is-dragging'));

document.addEventListener('dragstart', (e) => {
  const el = e.target.closest ? e.target.closest('[data-drag]') : null;
  if (!el || el.getAttribute('draggable') !== 'true') return;
  DRAG = { ...el.dataset };
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', DRAG.id || DRAG.name || ''); } catch { /* some browsers refuse */ }
  el.classList.add('is-dragging');
});
document.addEventListener('dragend', () => { clearDrop(); DRAG = null; });

/* Where a drop would go: before a question (or section), or at the end of a section (its heading). */
function dropTarget(e) {
  if (!DRAG || !e.target.closest) return null;
  if (DRAG.drag === 'sec') {
    const t = e.target.closest('.d-sec[data-drag="sec"]');
    return t && t.dataset.name !== DRAG.name ? { el: t, name: t.dataset.name } : null;
  }
  const q = e.target.closest('.q-item[data-drag="q"]');
  if (q) {
    const same = q.dataset.file === DRAG.file && (q.dataset.id === DRAG.id || (DRAG.item && q.dataset.item === DRAG.item));
    if (same || (DRAG.item && !q.dataset.item) || (!DRAG.item && q.dataset.file !== DRAG.file)) return null;
    return { el: q, q: q.dataset };
  }
  const g = e.target.closest('[data-dropgroup]');
  return g && DRAG.item ? { el: g, group: g.dataset.dropgroup } : null;
}
document.addEventListener('dragover', (e) => {
  const t = dropTarget(e);
  if (!t) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  clearDrop(false);
  t.el.classList.add(t.group !== undefined ? 'drop-into' : 'drop-before');
});
document.addEventListener('drop', (e) => {
  const t = dropTarget(e);
  if (!t) return;
  e.preventDefault();
  const d = DRAG;
  clearDrop(); DRAG = null;
  dropDo(d, t);
});

async function dropDo(d, t) {
  if (d.drag === 'sec') { dop({ op: 'section_move', name: d.name, before: t.name }, { now: true }); return; }
  const group = (t.q ? t.q.group : t.group) || null;
  const before = t.q ? t.q.item : null;
  if (inBank()) {
    const r = await postJSON(qApi('items'), { op: 'move', item: d.item, group, before });
    if (!r.ok) { toast(r.error || 'Not moved.', 'warning-triangle'); return; }
    const keep = S.qform; S.qdata = r; S.qform = keep;
    renderQuestionsForm();
    return;
  }
  if (d.item) { // an item moves in pools.tex, into another section if dropped there
    const r = await itemOp({ op: 'move', item: d.item, before, group: group || undefined });
    if (r) renderQuestionsForm();
    return;
  }
  // questions written in one file move within it
  S.qform = { file: d.file, id: d.id, pending: [], saving: false };
  qop({ op: 'move', before: t.q.id }, { now: true });
}

/* ---------- The selected question in the question paper ---------- */

async function showQuestionInPaper(auto = false, qid = null) {
  const id = qid || (qsel() || {}).id;
  if (!id || !S.project) return;
  let r;
  try { r = await getJSON(`/ui/api/question-page?id=${enc(id)}`); } catch { return; }
  if (!r.page) {
    if (!auto) toast('Build the preview first: the question\'s page is known once the paper is built.', 'info-circle');
    return;
  }
  S.previewPage = r.page;
  const frame = document.querySelector('.pdf-frame');
  if (frame && S.previewOpen && S.previewDoc === 'sujet' && !S.previewFile && !S.previewMode) {
    frame.src = `${frame.src.replace(/#.*$/, '')}#page=${r.page}&view=FitH`; // the viewer jumps without reloading
    return;
  }
  if (auto) return;
  S.previewDoc = 'sujet'; S.previewFile = null; S.previewMode = null;
  if (!S.previewOpen) { S.previewOpen = true; store.set('previewOpen', true); }
  if (typeof openPreview === 'function') openPreview(); else renderPreview();
}
/* When the preview shows the question paper, it follows the question picked. */
function previewFollow(qid) {
  if (S.previewOpen && S.previewDoc === 'sujet' && !S.previewFile && !S.previewMode && !inBank()) showQuestionInPaper(true, qid);
}

/* ---------- Papers: copies differ ---------- */

async function loadPaperSections() {
  const project = S.project;
  let r;
  try { r = await getJSON('/ui/api/structure'); } catch { return; }
  if (S.project !== project) return;
  S.paperSecs = { project, sections: r.sections || [] };
  if (S.route.step === 'papers') renderMain(true);
}
function copiesDiffer() {
  const p = S.paperSecs;
  if (!p || p.project !== S.project) return '';
  const drawn = p.sections.filter((s) => s.count && s.pool && s.count < s.pool);
  if (!drawn.length) return '';
  const what = drawn.map((s) => `${esc(s.heading ? s.heading.replace(/\\[a-zA-Z]+\*?|[{}]/g, '').trim() || s.name : s.name)}: ${s.count} of ${s.pool} questions`).join('; ');
  return banner('info', 'shuffle', 'The copies differ', `${what}, drawn at random for each copy. Look at several copies in the preview, not only the first; the answer key and marking follow each copy.`);
}

/* ---------- Duplicate a question ---------- */

async function duplicateQuestion() {
  const f = S.qform && qfile(S.qform.file);
  if (!f || !f.item) { notice('Duplicate', 'Duplicating works with questions kept in item files (Questions › Move questions into item files).', 'info-circle'); return; }
  const r = await itemOp({ op: 'duplicate', item: f.item });
  if (!r) return;
  S.qform = { file: r.added.file, id: r.added.id, pending: [], saving: false, lastSaved: Date.now() };
  renderQuestionsForm();
  toast(r.what);
}

/* ---------- The teacher's own templates ---------- */

async function saveAsTemplate() {
  const data = await formDialog({ title: 'Save as a template', ok: 'Save', icon: 'page',
    body: `<label class="field"><span class="field-label">Name</span><input class="input" name="name" maxlength="80" value="${esc(S.project || '')}"></label>
      <label class="field"><span class="field-label">Description (optional)</span><input class="input" name="description" maxlength="300" placeholder="Term test: 3 sections, answer sheet with student codes"></label>
      <p class="field-hint">The exam's sources are kept: questions, sections, the paper and its settings. Not its scans, marks or history. New exam › My templates starts from it.</p>`,
    validate: (d) => ((d.name || '').trim() ? '' : 'Give the template a name.') });
  if (!data) return;
  const r = await postJSON('/ui/api/my-templates', { op: 'save', name: data.name.trim(), description: data.description || '' });
  if (!r.ok) { notice('Not saved', r.error || 'Unknown error'); return; }
  toast(`Saved as the template "${r.name}": it is in New exam › My templates.`);
}
async function deleteMyTemplate(id) {
  const ok = await confirmDialog({ title: `Delete the template "${esc(id)}"?`, ok: 'Delete', danger: true, icon: 'trash',
    body: '<p>Exams made from it stay as they are.</p>' });
  if (!ok) return;
  const r = await postJSON('/ui/api/my-templates', { op: 'delete', name: id });
  if (!r.ok) { toast(r.error || 'Not deleted.', 'warning-triangle'); return; }
  toast(`Template "${id}" deleted.`);
  if (S.wizard) { S.wizard.gid = null; S.wizard.id = null; if (S.wizard.group === 'mine') S.wizard.group = STARTERS; }
  S.gallery = null;
  loadGallery();
}

const STARTERS = 'school'; // ui_gallery.STARTER_GROUP

const EXTRA_ACTIONS = {
  'q-duplicate': () => duplicateQuestion(),
  'q-show-page': () => showQuestionInPaper(false),
  'template-save': () => saveAsTemplate(),
  'template-delete': (el) => deleteMyTemplate(el.dataset.id),
};
