/*
 * Question banks (doc/question-bank-plan.md, section 7; server: ui_bankapi.py).
 * Each instructor's own banks, in groups of items. A bank's page reuses the
 * question editor of app.js (list, form, LaTeX view, History) with the
 * bank's endpoints (qApi, histApi). In an exam: "From a bank…" adds a whole
 * group or chosen questions; "Save to a bank…" copies questions, a section
 * or the whole exam into a bank. Loaded after app.js and uses its helpers.
 */
/* global S, $, esc, ic, enc, getJSON, postJSON, toast, banner, openDialog, closeDialog, confirmDialog, formDialog, notice,
   navigate, render, renderMain, renderTop, renderQuestionsForm, renderQForm, renderQList, loadEditor, qfile, qsel, flushQ, qlFlush,
   openHistory, inBank, qApi, trunc, plural, fmtWhen, postForm, loadDesign, renderDesign, flushD, dialogResolve:writable */

const DIFF_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

/* ---------- The banks list ---------- */

async function loadBanks() {
  try { const r = await getJSON('/ui/api/banks'); S.banks = r.banks || []; } catch (e) { console.error(e); S.banks = []; }
  if (S.route.kind === 'banks') renderMain(true);
}

function viewBanks() {
  const list = S.banks;
  let body;
  if (!list) body = `<div class="grid grid-3">${'<div class="skeleton"></div>'.repeat(3)}</div>`;
  else if (!list.length) {
    body = `<div class="card"><div class="empty"><div class="empty-icon">${ic('book-stack')}</div><h2>No question bank yet</h2>
      <p>A bank keeps your questions in groups, to use again in any exam. Start one here, or save the questions of an exam into a bank (Exam settings › Save as a question bank).</p>
      <div class="btn-row"><button class="btn btn-primary" data-act="bank-new">${ic('plus')} New bank</button></div></div></div>`;
  } else {
    body = `<div class="grid grid-3">${list.map((b) => `<article class="card exam-card">
      <h3><a href="/bank/${enc(b.name)}" data-nav>${esc(b.name)}</a></h3>
      <div class="subtle exam-meta">${esc(b.description || '') || '&nbsp;'}</div>
      <div class="row-between" style="gap:8px"><span class="subtle">${plural(b.groups, 'group', 'groups')} · ${plural(b.items, 'question', 'questions')}</span>
        <a class="btn btn-sm" href="/bank/${enc(b.name)}" data-nav>Open ${ic('arrow-right')}</a></div></article>`).join('')}</div>`;
  }
  return `<div class="page">
    <div class="page-head"><div><h1 class="page-title">Question banks</h1><p class="page-sub">Your own banks of questions, in groups. Only you see them; questions go into an exam as copies.</p></div>
      <div class="page-actions"><button class="btn btn-ghost" data-act="trash-open">${ic('trash')} Trash</button>${list && list.length ? `<button class="btn btn-primary" data-act="bank-new">${ic('plus')} New bank</button>` : ''}</div></div>
    ${body}</div>`;
}

async function newBank() {
  const data = await formDialog({ title: 'New question bank', ok: 'Create', icon: 'book-stack',
    body: `<label class="field"><span class="field-label">Name</span><input class="input" name="name" maxlength="80" placeholder="Olympiad algebra"></label>
      <label class="field"><span class="field-label">Description (optional)</span><input class="input" name="description" maxlength="500"></label>`,
    validate: (d) => ((d.name || '').trim() ? '' : 'Give the bank a name.') });
  if (!data) return;
  const r = await postJSON('/ui/api/banks', { op: 'create', name: data.name.trim(), description: data.description || '' });
  if (!r.ok) { notice('Not created', r.error || 'Unknown error'); return; }
  navigate(`/bank/${enc(r.name)}`);
}

/* ---------- One bank ---------- */

async function loadBank() {
  const name = S.route.name;
  let r;
  try { r = await getJSON(qApi('')); } catch (e) {
    console.error(e);
    if (S.route.kind === 'bank' && S.route.name === name) { S.qdata = { error: 'This bank doesn\'t exist (any more).', files: [], bank: null }; renderMain(); }
    return;
  }
  if (S.route.kind !== 'bank' || S.route.name !== name) return;
  S.qdata = r;
  if (!qsel()) {
    const first = r.files.flatMap((f) => f.questions.map((q) => ({ file: f.file, id: q.id })))[0];
    S.qform = first ? { file: first.file, id: first.id, pending: [], saving: false } : null;
  }
  if (!$('#q-editor')) renderMain(); else { $('#bank-head').innerHTML = bankHead(); renderQuestionsForm(); }
}

function bankHead() {
  const b = S.qdata && S.qdata.bank;
  return `<div class="page-head"><div><h1 class="page-title">${esc(S.route.name)}</h1><p class="page-sub">${b && b.description ? esc(b.description) : 'Questions in groups. Edit them here like in an exam; add them to exams from Questions › From a bank.'}</p></div>
    <div class="page-actions">
      <button class="btn btn-ghost" data-act="bank-history" ${b ? '' : 'disabled'}>${ic('clock-rotate-right')} History</button>
      <button class="btn btn-ghost" data-act="bank-import" ${b ? '' : 'disabled'} title="RJ-style LaTeX files: \\element{group}{…} blocks, with their figures">${ic('upload')} Import LaTeX…</button>
      <div class="card-menu"><button class="btn btn-ghost btn-icon" data-act="menu" data-menu="bank" aria-haspopup="menu" aria-expanded="${S.menu === 'bank'}" aria-label="More actions">${ic('more-horiz')}</button>
      ${S.menu === 'bank' ? `<div class="menu" role="menu" style="right:0;left:auto">
        <button class="menu-item" role="menuitem" data-act="bank-preamble">${ic('code')} Macros and packages (preamble)…</button>
        <button class="menu-item" role="menuitem" data-act="bank-describe">${ic('edit-pencil')} Description…</button>
        <button class="menu-item" role="menuitem" data-act="bank-rename">${ic('edit-pencil')} Rename…</button>
        <div class="menu-sep"></div>
        <button class="menu-item" role="menuitem" data-act="bank-delete" style="color:var(--danger)">${ic('trash')} Delete</button></div>` : ''}</div>
    </div></div>`;
}

function viewBank() {
  if (S.qdata && S.qdata.error) return `<div class="page"><div id="bank-head">${bankHead()}</div>${banner('warning', 'warning-triangle', esc(S.qdata.error), '', '<a class="btn btn-sm" href="/banks" data-nav>All banks</a>')}</div>`;
  setTimeout(() => { if (S.qdata && $('#q-editor')) renderQuestionsForm(); }, 0);
  return `<div class="page wide"><div id="bank-head">${bankHead()}</div>
    <div class="q-editor" id="q-editor"><div class="q-list" id="q-list"><div class="skeleton" style="height:200px;margin:12px"></div></div><div class="q-form" id="q-form"></div></div></div>`;
}

/* The bank's list: its groups in order (empty ones too), then items in no group. */
function renderBankList(host) {
  const d = S.qdata;
  if (!d || !d.bank) { host.innerHTML = '<div class="skeleton" style="height:200px;margin:12px"></div>'; return; }
  const byItem = Object.fromEntries(d.files.map((f) => [f.item, f]));
  const row = (n) => {
    const f = byItem[n];
    if (!f) return '';
    return f.questions.map((q) => {
      const sel = !!(S.qform && S.qform.file === f.file && S.qform.id === q.id);
      const m = f.meta || {};
      return `<button class="q-item ${sel ? 'is-selected' : ''} ${q.problem ? 'is-problem' : ''} ${f.questions.length > 1 ? 'in-set' : ''}" data-act="q-pick" data-file="${esc(f.file)}" data-id="${esc(q.id)}" aria-pressed="${sel}">
        <span class="q-item-id">${esc(q.id)}</span><span class="q-item-kind">${m.difficulty ? `${DIFF_LABEL[m.difficulty]} · ` : ''}${q.kind}</span>
        <span class="q-item-text">${q.problem ? `${ic('warning-triangle')} ${esc(q.problem)}` : esc(trunc(m.title || q.text || '(no text yet)', 70))}${(m.tags || []).length ? ` <span class="b-tags">${m.tags.map(esc).join(' · ')}</span>` : ''}</span></button>`;
    }).join('');
  };
  const total = d.files.reduce((n, f) => n + f.questions.length, 0);
  let html = `<div class="q-list-head"><b>Questions</b><span class="chip">${total}</span><span class="spacer"></span><button class="btn btn-sm btn-ghost" data-act="bgroup-add">${ic('plus')} Group</button></div>`;
  d.bank.groups.forEach((g, i) => {
    html += `<div class="q-group b-group"><span>${esc(g.title || g.name)} <span class="subtle">· ${g.items.length}</span></span><span class="spacer"></span>
      <button class="btn btn-ghost btn-icon btn-xs" data-act="bitem-add" data-group="${esc(g.name)}" title="Add a question to this group" aria-label="Add a question to ${esc(g.name)}">${ic('plus')}</button>
      <button class="btn btn-ghost btn-icon btn-xs" data-act="bgroup-edit" data-group="${esc(g.name)}" title="Title, instructions and scoring of the group" aria-label="Edit the group ${esc(g.name)}">${ic('edit-pencil')}</button>
      <button class="btn btn-ghost btn-icon btn-xs" data-act="bgroup-move" data-group="${esc(g.name)}" data-d="-1" ${i ? '' : 'disabled'} title="Move up" aria-label="Move the group up">${ic('nav-arrow-up')}</button></div>`;
    html += g.items.map(row).join('') || '<p class="subtle q-note">No question yet.</p>';
  });
  if (d.bank.loose.length) html += `<div class="q-group">Not in a group</div>${d.bank.loose.map(row).join('')}`;
  if (!d.bank.groups.length && !d.bank.loose.length) html += `<div class="q-empty" style="padding:16px"><p class="muted">Start with a group (Algebra, Geometry…), then add questions to it, or import a LaTeX file.</p><button class="btn btn-primary btn-sm" data-act="bgroup-add">${ic('plus')} Add a group</button></div>`;
  host.innerHTML = html;
}

/* An item's title, tags and difficulty, under the question's head (bank only). */
function bankMetaRow(f) {
  if (!f || !f.meta) return '';
  const m = f.meta;
  return `<div class="b-meta" data-item="${esc(f.item)}">
    <label class="field"><span class="field-label">Difficulty</span><select class="select input-sm" data-bmeta="difficulty"><option value="">—</option>${Object.entries(DIFF_LABEL).map(([v, l]) => `<option value="${v}" ${m.difficulty === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="field grow"><span class="field-label">Tags (comma between them)</span><input class="input input-sm" data-bmeta="tags" value="${esc((m.tags || []).join(', '))}" placeholder="polynomials, olympiad 2025"></label>
    ${m.origin ? `<span class="subtle b-origin" title="Where it came from">${ic('info-circle')} ${m.origin.exam ? `From the exam ${esc(m.origin.exam)}` : m.origin.file ? `Imported from ${esc(m.origin.file)}` : ''}</span>` : ''}</div>`;
}
/* In an exam: where an item came from (a bank), and that it is a copy. */
function itemOrigin(f) {
  const o = f && f.meta && f.meta.origin;
  if (!o || !o.bank) return '';
  return `<div class="b-meta"><span class="subtle b-origin">${ic('book-stack')} A copy from the bank <a href="/bank/${enc(o.bank)}" data-nav>${esc(o.bank)}</a> (${esc(o.item)})</span></div>`;
}
let bmetaTimer = null;
function bankInput(t) {
  if (!t.dataset || !t.dataset.bmeta) return false;
  clearTimeout(bmetaTimer);
  bmetaTimer = setTimeout(() => saveBankMeta(t), t.dataset.bmeta === 'tags' ? 900 : 0);
  return true;
}
function bankChange(t) {
  if (t.dataset && t.dataset.bmeta) { clearTimeout(bmetaTimer); saveBankMeta(t); return true; }
  if (t.id === 'bp-bank') { bpPickBank(t.value); return true; }
  if (t.id === 'bp-group') { S.bp.group = t.value; S.bp.ticked = []; S.bp.chosen = null; renderPicker(); return true; }
  if (t.name === 'bp-mode') { S.bp.mode = t.value; S.bp.chosen = null; renderPicker(); return true; }
  if (t.id === 'bp-section') { S.bp.section = t.value; return true; }
  if (t.id === 'bp-count') { S.bp.count = +t.value || 1; S.bp.chosen = null; return true; }
  if (t.classList && t.classList.contains('bp-tick')) { const n = t.dataset.item; S.bp.ticked = t.checked ? [...S.bp.ticked, n] : S.bp.ticked.filter((x) => x !== n); return true; }
  if (t.id === 'bs-bank' || t.id === 'bs-group') { S.bs[t.id === 'bs-bank' ? 'bank' : 'group'] = t.value; if (t.id === 'bs-bank') bsLoadBank(); else renderSaveDialog(); return true; }
  if (t.name === 'bs-linked') { S.bs.linked = t.value; return true; }
  return false;
}
async function saveBankMeta(t) {
  const box = t.closest('.b-meta');
  if (!box) return;
  const item = box.dataset.item;
  const body = { op: 'describe', item };
  body[t.dataset.bmeta] = t.value;
  const r = await postJSON(qApi('items'), body);
  if (!r.ok) { toast(r.error || 'Not saved.', 'warning-triangle'); return; }
  const keep = S.qform;
  S.qdata = r; S.qform = keep;
  renderQList();
}

async function bankAddQuestion(group) {
  const kind = await choiceDialogBank(`Add a question to ${esc(group)}`);
  if (!kind) return;
  const r = await postJSON(qApi('items'), { op: 'add', kind, group });
  if (!r.ok) { toast(r.error || 'Not added.', 'warning-triangle'); return; }
  S.qdata = r; S.qform = { file: r.added.file, id: r.added.id, pending: [], saving: false, lastSaved: Date.now() };
  renderQuestionsForm();
  const t = $('#qf-text'); if (t) { t.focus(); t.select(); }
}
function choiceDialogBank(title) {
  return new Promise((resolve) => {
    openDialog(`<div class="dialog-head"><span class="dialog-icon brand">${ic('plus')}</span><div><h2 id="dlg-title">${title}</h2></div></div>
      <div class="dialog-body"><p>What kind of question?</p></div>
      <div class="dialog-foot"><button class="btn" data-act="dialog-cancel">Cancel</button>${[['numeric', 'Numeric answer', ''], ['multiple', 'Multiple answers', ''], ['single', 'Single answer', 'btn-primary']].map(([v, l, c]) => `<button class="btn ${c}" data-act="dialog-result" data-v="${v}">${l}</button>`).join('')}</div>`);
    dialogResolve = resolve; // eslint-disable-line no-global-assign
  });
}

async function bankGroupAdd() {
  const data = await formDialog({ title: 'New group', ok: 'Add', icon: 'plus',
    body: '<label class="field"><span class="field-label">Title</span><input class="input" name="title" maxlength="120" placeholder="Algebra"></label><p class="field-hint">A group is like a section of an exam: a whole group can become a section.</p>',
    validate: (d) => ((d.title || '').trim() ? '' : 'Give the group a title.') });
  if (!data) return;
  const r = await postJSON(qApi('groups'), { op: 'add', title: data.title.trim() });
  if (!r.ok) { toast(r.error || 'Not added.', 'warning-triangle'); return; }
  S.qdata = r; renderQuestionsForm();
}
async function bankGroupEdit(name) {
  const g = S.qdata.bank.groups.find((x) => x.name === name);
  if (!g) return;
  const data = await formDialog({ title: `Group ${esc(g.title || g.name)}`, ok: 'Save', icon: 'edit-pencil',
    body: `<label class="field"><span class="field-label">Title (the section's heading when the group becomes one)</span><input class="input" name="title" maxlength="120" value="${esc(g.title)}"></label>
      <label class="field"><span class="field-label">Instructions (LaTeX)</span><textarea class="input" name="instructions" rows="3">${esc(g.instructions)}</textarea></label>
      <label class="field"><span class="field-label">Default scoring (given to its questions that have none, when added to an exam)</span><input class="input mono" name="scoring" maxlength="200" value="${esc(g.scoring)}" placeholder="b=3,m=-1"></label>
      <label class="field"><span class="field-label">Name (letters, digits, -)</span><input class="input mono" name="name" maxlength="40" value="${esc(g.name)}"></label>
      <div class="row" style="gap:8px;margin-top:6px"><button type="button" class="btn btn-sm btn-ghost" data-act="bgroup-delete" data-group="${esc(g.name)}" style="color:var(--danger)">${ic('trash')} Remove the group (its questions stay in the bank)</button></div>` });
  if (!data) return;
  let r = await postJSON(qApi('groups'), { op: 'describe', group: name, title: data.title, instructions: data.instructions, scoring: data.scoring });
  if (r.ok && data.name && data.name !== name) r = await postJSON(qApi('groups'), { op: 'rename', group: name, new: data.name.trim() });
  if (!r.ok) { notice('Not saved', r.error || 'Unknown error'); return; }
  S.qdata = r; renderQuestionsForm();
}
async function bankGroupDelete(name) {
  closeDialog();
  const ok = await confirmDialog({ title: `Remove the group ${esc(name)}?`, ok: 'Remove', danger: true, icon: 'trash', body: '<p>Its questions stay in the bank, in no group. History keeps the group.</p>' });
  if (!ok) return;
  const r = await postJSON(qApi('groups'), { op: 'delete', group: name });
  if (!r.ok) { toast(r.error || 'Not removed.', 'warning-triangle'); return; }
  S.qdata = r; renderQuestionsForm();
}
async function bankGroupMove(name, d) {
  const gs = S.qdata.bank.groups; const i = gs.findIndex((g) => g.name === name);
  const before = d < 0 ? (gs[i - 1] || {}).name : (gs[i + 2] || {}).name;
  const r = await postJSON(qApi('groups'), { op: 'move', group: name, before: before || null });
  if (r.ok) { S.qdata = r; renderQuestionsForm(); }
}

async function bankRename() {
  const data = await formDialog({ title: 'Rename the bank', ok: 'Rename', icon: 'edit-pencil',
    body: `<label class="field"><span class="field-label">Name</span><input class="input" name="name" maxlength="80" value="${esc(S.route.name)}"></label><p class="field-hint">Exams that took questions from it keep knowing them: a bank is known by an id that never changes.</p>` });
  if (!data) return;
  const r = await postJSON('/ui/api/banks', { op: 'rename', name: S.route.name, new: data.name.trim() });
  if (!r.ok) { notice('Not renamed', r.error || 'Unknown error'); return; }
  navigate(`/bank/${enc(r.name)}`, { replace: true });
}
async function bankDescribe() {
  const b = S.qdata.bank;
  const data = await formDialog({ title: 'Description', ok: 'Save', icon: 'edit-pencil',
    body: `<label class="field"><span class="field-label">What the bank holds</span><input class="input" name="description" maxlength="500" value="${esc(b.description)}"></label>` });
  if (!data) return;
  const r = await postJSON('/ui/api/banks', { op: 'describe', name: S.route.name, description: data.description });
  if (r.ok) loadBank(); else toast(r.error || 'Not saved.', 'warning-triangle');
}
async function bankDelete() {
  const ok = await confirmDialog({ title: `Delete the bank "${esc(S.route.name)}"?`, ok: 'Delete', danger: true, icon: 'trash',
    body: '<p>The bank moves to the Trash with its history, for 30 days. Exams keep their copies of its questions.</p>' });
  if (!ok) return;
  const r = await postJSON('/ui/api/banks', { op: 'delete', name: S.route.name });
  if (!r.ok) { notice('Not deleted', r.error || 'Unknown error'); return; }
  toast(`"${S.route.name}" moved to the Trash.`, 'trash');
  navigate('/banks');
}

/* The bank's preamble: macros and packages its questions rely on. */
async function bankPreamble() {
  let r;
  try { r = await getJSON(`${qApi('source')}?file=preamble.tex`); } catch { toast('The preamble couldn\'t be read.', 'warning-triangle'); return; }
  openDialog(`<div class="dialog-head"><span class="dialog-icon brand">${ic('code')}</span><div><h2 id="dlg-title">Macros and packages</h2><p class="subtle" style="margin:2px 0 0">What the bank's questions rely on (<code>\\newcommand</code>, <code>\\usepackage</code>). "Check this question" uses it.</p></div></div>
    <div class="dialog-body"><div class="sl-host" id="bpre-host" style="height:min(50vh,420px)"></div><div id="bpre-msg"></div></div>
    <div class="dialog-foot"><button class="btn" data-act="dialog-cancel">Close</button><button class="btn btn-primary" data-act="bank-preamble-save">${ic('floppy-disk')} Save</button></div>`);
  const d = $('#layer .dialog'); if (d) d.classList.add('dialog-wide');
  S.bpre = { digest: r.digest, ed: latexEditor('bpre-host', { onSave: () => bankPreambleSave() }) };
  S.bpre.ed.setValue(r.text, -1);
}
async function bankPreambleSave() {
  const p = S.bpre; if (!p) return;
  const r = await postJSON(qApi('source'), { file: 'preamble.tex', text: p.ed.getValue(), based_on: p.digest });
  if (!r.ok) { const m = $('#bpre-msg'); if (m) m.innerHTML = banner('danger', 'warning-triangle', esc(r.error || 'Not saved.'), ''); return; }
  p.ed.destroy(); S.bpre = null; closeDialog(); toast('Preamble saved.');
}

/* RJ-style LaTeX files: \element{group}{…} blocks, with their figures. */
function bankImport() {
  openDialog(`<div class="dialog-head"><span class="dialog-icon brand">${ic('upload')}</span><div><h2 id="dlg-title">Import LaTeX files</h2></div></div>
    <div class="dialog-body"><p>Choose LaTeX files whose questions are <code>\\element{group}{…}</code> blocks (like the RJ question files), and their figures, all together. Each block becomes a question of the group of that name; figures move with their question; macro definitions go to the bank's preamble.</p>
      <input type="file" id="bank-import-files" multiple accept=".tex,.png,.jpg,.jpeg,.pdf,.eps">
      <div id="bank-import-msg" style="margin-top:8px"></div></div>
    <div class="dialog-foot"><button class="btn" data-act="dialog-cancel">Cancel</button><button class="btn btn-primary" data-act="bank-import-go">${ic('upload')} Import</button></div>`);
}
async function bankImportGo() {
  const input = $('#bank-import-files');
  const files = input ? [...input.files] : [];
  if (!files.length) { const m = $('#bank-import-msg'); if (m) m.innerHTML = '<p class="field-hint" style="color:var(--danger)">Choose the files first.</p>'; return; }
  let r;
  try { r = await postForm(qApi('import'), files.map((f) => [f, f.name])); } catch (e) { r = e.body || { error: e.message }; }
  if (!r || !r.ok) { const m = $('#bank-import-msg'); if (m) m.innerHTML = banner('danger', 'warning-triangle', esc((r && r.error) || 'Not imported.'), ''); return; }
  closeDialog();
  toast(`Imported: ${r.what}${r.definitions ? `; ${plural(r.definitions, 'definition', 'definitions')} added to the preamble` : ''}`);
  S.qdata = r; renderQuestionsForm();
}

/* ---------- In an exam: from a bank ---------- */

async function openPicker(section = null) {
  if (typeof flushQ === 'function') await flushQ();
  let r;
  try { r = await getJSON('/ui/api/banks'); } catch { toast('Your banks couldn\'t be read.', 'warning-triangle'); return; }
  if (!r.banks || !r.banks.length) { notice('No question bank yet', 'Make a bank on the Question banks page (top right), or save this exam\'s questions into one.', 'book-stack'); return; }
  const sel = typeof qsel === 'function' ? qsel() : null;
  S.bp = { banks: r.banks, bank: null, data: null, group: null, ticked: [], mode: 'new', section: section || (sel && sel.group) || null, count: 3, chosen: null, sections: await examSections() };
  if (section) S.bp.mode = 'into';
  await bpPickBank(r.banks[0].name);
}
async function examSections() {
  try { const st = await getJSON('/ui/api/structure'); return [...new Set([...(st.sections || []).map((x) => x.name), ...(st.unused || []).map((x) => x.name)])]; } catch { return []; }
}
async function bpPickBank(name) {
  const bp = S.bp; if (!bp) return;
  bp.bank = name; bp.data = null; bp.ticked = []; bp.chosen = null;
  renderPicker();
  try { bp.data = await getJSON(`/ui/api/bank/${enc(name)}`); } catch { bp.data = { error: 'This bank couldn\'t be read.' }; }
  if (S.bp !== bp) return;
  bp.group = bp.data.bank && bp.data.bank.groups.length ? bp.data.bank.groups[0].name : null;
  renderPicker();
}
function renderPicker() {
  const bp = S.bp; if (!bp) return;
  const d = bp.data;
  const g = d && d.bank ? d.bank.groups.find((x) => x.name === bp.group) : null;
  const files = d && d.files ? Object.fromEntries(d.files.map((f) => [f.item, f])) : {};
  const secSel = `<select class="select input-sm" id="bp-section">${bp.sections.map((s) => `<option ${s === bp.section ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>`;
  const list = !d ? '<p class="subtle">Loading…</p>' : d.error ? `<p>${esc(d.error)}</p>` : !g ? '<p class="subtle">This bank has no group yet.</p>'
    : `<div class="bp-list">${g.items.map((n) => { const f = files[n]; const q = f && f.questions[0]; const m = (f && f.meta) || {};
      const chosen = bp.chosen && bp.chosen.includes(n);
      return `<label class="bp-row ${chosen ? 'is-chosen' : ''}"><input type="checkbox" class="bp-tick" data-item="${esc(n)}" ${bp.ticked.includes(n) ? 'checked' : ''} ${bp.mode === 'ticked' ? '' : 'disabled'}>
        <span class="mono">${esc(q ? q.id : n)}</span>${f && f.questions.length > 1 ? `<span class="chip">set of ${f.questions.length}</span>` : ''}
        <span class="bp-text">${esc(trunc(m.title || (q && q.text) || '', 90))}</span><span class="subtle">${m.difficulty ? DIFF_LABEL[m.difficulty] : ''}${(m.tags || []).length ? ` · ${m.tags.map(esc).join(', ')}` : ''}</span></label>`; }).join('') || '<p class="subtle">No question in this group.</p>'}</div>`;
  const radio = (v, label) => `<label class="check"><input type="radio" name="bp-mode" value="${v}" ${bp.mode === v ? 'checked' : ''}><span>${label}</span></label>`;
  const sectionsLeft = bp.sections.length;
  openDialog(`<div class="dialog-head"><span class="dialog-icon brand">${ic('book-stack')}</span><div><h2 id="dlg-title">Add questions from a bank</h2><p class="subtle" style="margin:2px 0 0">The exam gets copies; the bank is not changed.</p></div></div>
    <div class="dialog-body">
      <div class="row" style="gap:8px;flex-wrap:wrap"><label class="field" style="margin:0"><span class="field-label">Bank</span><select class="select" id="bp-bank">${bp.banks.map((b) => `<option ${b.name === bp.bank ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label>
        <label class="field" style="margin:0"><span class="field-label">Group</span><select class="select" id="bp-group" ${d && d.bank && d.bank.groups.length ? '' : 'disabled'}>${(d && d.bank ? d.bank.groups : []).map((x) => `<option value="${esc(x.name)}" ${x.name === bp.group ? 'selected' : ''}>${esc(x.title || x.name)} (${x.items.length})</option>`).join('')}</select></label></div>
      <div class="bp-modes">
        ${radio('new', 'The whole group, as a new section')}
        ${sectionsLeft ? radio('into', `The whole group, into the section ${bp.mode === 'into' ? secSel : ''}`) : ''}
        ${sectionsLeft ? radio('ticked', `The questions ticked below, into the section ${bp.mode === 'ticked' ? secSel : ''}`) : ''}
        ${sectionsLeft ? radio('random', `<input class="input input-sm" type="number" id="bp-count" min="1" max="999" value="${bp.count}" style="width:70px" ${bp.mode === 'random' ? '' : 'disabled'}> picked at random from the group (shown first), into the section ${bp.mode === 'random' ? secSel : ''}`) : ''}
      </div>
      ${bp.chosen ? banner('info', 'info-circle', `Picked: ${esc(bp.chosen.join(', '))}`, 'These are added (the pick is made once). Pick again for another.') : ''}
      ${list}<div id="bp-msg"></div></div>
    <div class="dialog-foot"><button class="btn" data-act="dialog-cancel">Cancel</button>
      ${bp.mode === 'random' ? `<button class="btn" data-act="bp-pick" ${g ? '' : 'disabled'}>${bp.chosen ? 'Pick again' : 'Pick'}</button>` : ''}
      <button class="btn btn-primary" data-act="bp-add" ${g && (bp.mode !== 'random' || bp.chosen) ? '' : 'disabled'}>${ic('plus')} Add to the exam</button></div>`);
  const dlg = $('#layer .dialog'); if (dlg) dlg.classList.add('dialog-wide');
}
async function bpPick() {
  const bp = S.bp; if (!bp) return;
  const r = await postJSON('/ui/api/bank-pull', { bank: bp.bank, group: bp.group, count: bp.count, seed: `${Date.now()}`, preview: true });
  if (!r.ok) { toast(r.error || 'No pick.', 'warning-triangle'); return; }
  bp.chosen = r.chosen.map((x) => x.item);
  renderPicker();
}
async function bpAdd() {
  const bp = S.bp; if (!bp) return;
  const body = { bank: bp.bank, group: bp.group, mode: bp.mode === 'new' ? 'new' : 'into', section: bp.section || bp.sections[0] };
  if (bp.mode === 'ticked') { if (!bp.ticked.length) { toast('Tick at least one question.', 'warning-triangle'); return; } body.items = bp.ticked; }
  if (bp.mode === 'random') body.items = bp.chosen;
  const r = await postJSON('/ui/api/bank-pull', body);
  if (!r.ok) { const m = $('#bp-msg'); if (m) m.innerHTML = banner('danger', 'warning-triangle', esc(r.error || 'Not added.'), ''); return; }
  closeDialog(); S.bp = null;
  toast(r.what);
  if (S.qtab === 'design' && typeof loadDesign === 'function') loadDesign();
  else { S.qdata = r; const a = r.added && r.added[0]; const f = a && qfile(a); if (f) S.qform = { file: a, id: f.questions[0].id, pending: [], saving: false }; renderQuestionsForm(); }
}

/* ---------- In an exam: to a bank ---------- */

async function openSaveDialog(what) {
  if (typeof flushQ === 'function') await flushQ();
  let r;
  try { r = await getJSON('/ui/api/banks'); } catch { toast('Your banks couldn\'t be read.', 'warning-triangle'); return; }
  S.bs = { what, banks: r.banks || [], bank: (r.banks || [])[0] ? r.banks[0].name : '', data: null, group: '', linked: 'update', newBank: '' };
  if (what.whole) { renderSaveDialog(); return; }
  await bsLoadBank();
}
async function bsLoadBank() {
  const bs = S.bs; if (!bs) return;
  bs.data = null;
  if (bs.bank && bs.bank !== '+new') { try { bs.data = await getJSON(`/ui/api/bank/${enc(bs.bank)}`); } catch { bs.data = null; } }
  if (bs.data && bs.data.bank && !bs.group) bs.group = bs.what.section ? '+new' : (bs.data.bank.groups[0] || {}).name || '+new';
  renderSaveDialog();
}
function renderSaveDialog() {
  const bs = S.bs; if (!bs) return;
  const w = bs.what;
  const title = w.whole ? 'Save the whole exam as a question bank' : w.section ? `Save the section ${esc(w.section)} to a bank` : 'Save to a bank';
  const linkedHere = !w.whole && (w.items || []).some((n) => { const f = qfile(`items/${n}/item.tex`); return f && f.meta && f.meta.origin && f.meta.origin.bank === bs.bank; });
  const groups = bs.data && bs.data.bank ? bs.data.bank.groups : [];
  const body = w.whole
    ? `<label class="field"><span class="field-label">Name of the new bank</span><input class="input" id="bs-newbank" maxlength="80" value="${esc(S.project || '')}"></label><p class="subtle">A group for each section, with its heading and instructions; copies of every question kept in item files.</p>`
    : `<div class="row" style="gap:8px;flex-wrap:wrap"><label class="field" style="margin:0"><span class="field-label">Bank</span><select class="select" id="bs-bank">${bs.banks.map((b) => `<option ${b.name === bs.bank ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}<option value="+new" ${bs.bank === '+new' ? 'selected' : ''}>A new bank…</option></select></label>
      ${bs.bank === '+new' ? `<label class="field" style="margin:0"><span class="field-label">Its name</span><input class="input" id="bs-newbank" maxlength="80"></label>` : ''}
      <label class="field" style="margin:0"><span class="field-label">Group</span><select class="select" id="bs-group">${groups.map((g) => `<option value="${esc(g.name)}" ${g.name === bs.group ? 'selected' : ''}>${esc(g.title || g.name)}</option>`).join('')}<option value="+new" ${bs.group === '+new' || bs.bank === '+new' ? 'selected' : ''}>A new group…</option></select></label>
      ${bs.group === '+new' || bs.bank === '+new' ? `<label class="field" style="margin:0"><span class="field-label">Its title</span><input class="input" id="bs-newgroup" maxlength="120" value="${esc(w.sectionTitle || w.section || '')}"></label>` : ''}</div>
      ${linkedHere ? `<div class="bp-modes"><p style="margin:6px 0 2px">Some of these came from this bank:</p><label class="check"><input type="radio" name="bs-linked" value="update" ${bs.linked === 'update' ? 'checked' : ''}><span>Update the bank's copy</span></label><label class="check"><input type="radio" name="bs-linked" value="new" ${bs.linked === 'new' ? 'checked' : ''}><span>Save as new questions</span></label></div>` : ''}`;
  openDialog(`<div class="dialog-head"><span class="dialog-icon brand">${ic('book-stack')}</span><div><h2 id="dlg-title">${title}</h2><p class="subtle" style="margin:2px 0 0">The bank gets copies; this exam's questions then know where they are in it.</p></div></div>
    <div class="dialog-body">${body}<div id="bs-msg"></div></div>
    <div class="dialog-foot"><button class="btn" data-act="dialog-cancel">Cancel</button><button class="btn btn-primary" data-act="bs-save">${ic('floppy-disk')} Save</button></div>`);
}
async function bsSave() {
  const bs = S.bs; if (!bs) return;
  const w = bs.what;
  const body = { linked: bs.linked };
  const nb = $('#bs-newbank'); const ng = $('#bs-newgroup');
  if (w.whole) { body.whole = true; body.new_bank = nb ? nb.value.trim() : ''; }
  else {
    if (bs.bank === '+new') { if (!nb || !nb.value.trim()) { toast('Give the new bank a name.', 'warning-triangle'); return; } body.new_bank = nb.value.trim(); } else body.bank = bs.bank;
    if (bs.group === '+new' || bs.bank === '+new') {
      const t = ng ? ng.value.trim() : '';
      body.group = (t || w.section || 'group').replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').replace(/^(\d)/, 'g-$1').slice(0, 40) || 'group';
      body.group_title = t;
    } else body.group = bs.group;
    if (w.section) body.section = w.section; else body.items = w.items;
  }
  const r = await postJSON('/ui/api/bank-save', body);
  if (!r.ok) { const m = $('#bs-msg'); if (m) m.innerHTML = banner('danger', 'warning-triangle', esc(r.error || 'Not saved.'), ''); return; }
  closeDialog(); S.bs = null;
  toast(`${r.what}.`);
  if (S.qtab === 'form' && typeof loadEditor === 'function' && S.route.kind === 'exam') loadEditor();
}

/* ---------- Actions ---------- */

const BANK_ACTIONS = {
  'bank-new': () => newBank(),
  'bank-history': () => openHistory(null),
  'bank-import': () => bankImport(),
  'bank-import-go': () => bankImportGo(),
  'bank-preamble': () => { S.menu = null; bankPreamble(); },
  'bank-preamble-save': () => bankPreambleSave(),
  'bank-rename': () => { S.menu = null; bankRename(); },
  'bank-describe': () => { S.menu = null; bankDescribe(); },
  'bank-delete': () => { S.menu = null; bankDelete(); },
  'bgroup-add': () => bankGroupAdd(),
  'bgroup-edit': (el) => bankGroupEdit(el.dataset.group),
  'bgroup-delete': (el) => bankGroupDelete(el.dataset.group),
  'bgroup-move': (el) => bankGroupMove(el.dataset.group, +el.dataset.d),
  'bitem-add': (el) => bankAddQuestion(el.dataset.group),
  'bank-pick': (el) => openPicker(el.dataset.section || null),
  'bp-pick': () => bpPick(),
  'bp-add': () => bpAdd(),
  'bank-save-item': (el) => openSaveDialog({ items: [el.dataset.item] }),
  'bank-save-section': (el) => openSaveDialog({ section: el.dataset.section }),
  'bank-save-exam': () => openSaveDialog({ whole: true }),
  'bs-save': () => bsSave(),
};
