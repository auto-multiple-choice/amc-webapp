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
   openHistory, inBank, qApi, trunc, plural, fmtWhen, postForm, loadDesign, renderDesign, flushD, dialogResolve:writable,
   questionsHead, diffRows, latexEditor, fmtDate */

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
      <div class="page-actions"><button class="btn btn-ghost" data-act="trash-open">${ic('trash')} Trash</button><button class="btn btn-ghost" data-act="bank-zip-import" title="A bank downloaded as a zip, from this app here or elsewhere">${ic('upload')} Import a bank…</button>${list && list.length ? `<button class="btn btn-primary" data-act="bank-new">${ic('plus')} New bank</button>` : ''}</div></div>
    ${list && list.length ? `<div class="b-search"><input class="input" type="search" id="bk-search" placeholder="Search all your banks: words of a question, a title, a tag…" value="${esc((S.bks && S.bks.q) || '')}" aria-label="Search all your banks"></div><div id="bk-results">${bankResults()}</div>` : ''}
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
  if (!S.bf || S.bf.bank !== name) S.bf = { bank: name, q: '', difficulty: '', kind: '', tag: '', unused: '', active: false, info: {} };
  S.busage = {};
  const want = S.bankPick && S.bankPick.bank === name ? r.files.find((f) => f.item === S.bankPick.item) : null;
  S.bankPick = null;
  if (want && want.questions.length) S.qform = { file: want.file, id: want.questions[0].id, pending: [], saving: false };
  if (!qsel()) {
    const first = r.files.flatMap((f) => f.questions.map((q) => ({ file: f.file, id: q.id })))[0];
    S.qform = first ? { file: first.file, id: first.id, pending: [], saving: false } : null;
  }
  if (!$('#q-editor')) renderMain(); else { $('#bank-head').innerHTML = bankHead(); renderBankFilters(); renderQuestionsForm(); }
  bankFilter();
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
        <a class="menu-item" role="menuitem" href="/ui/api/bank/${enc(S.route.name)}/export" download>${ic('download')} Download as a zip (with its history)</a>
        <button class="menu-item" role="menuitem" data-act="bank-rename">${ic('edit-pencil')} Rename…</button>
        <div class="menu-sep"></div>
        <button class="menu-item" role="menuitem" data-act="bank-delete" style="color:var(--danger)">${ic('trash')} Delete</button></div>` : ''}</div>
    </div></div>`;
}

function viewBank() {
  if (S.qdata && S.qdata.error) return `<div class="page"><div id="bank-head">${bankHead()}</div>${banner('warning', 'warning-triangle', esc(S.qdata.error), '', '<a class="btn btn-sm" href="/banks" data-nav>All banks</a>')}</div>`;
  setTimeout(() => { if (S.qdata && $('#q-editor')) { renderBankFilters(); renderQuestionsForm(); } }, 0);
  return `<div class="page wide"><div id="bank-head">${bankHead()}</div><div id="bank-filters"></div>
    <div class="q-editor" id="q-editor"><div class="q-list" id="q-list"><div class="skeleton" style="height:200px;margin:12px"></div></div><div class="q-form" id="q-form"></div></div></div>`;
}

/* The bank's list: its groups in order (empty ones too), then items in no group. */
function renderBankList(host) {
  const d = S.qdata;
  if (!d || !d.bank) { host.innerHTML = '<div class="skeleton" style="height:200px;margin:12px"></div>'; return; }
  const byItem = Object.fromEntries(d.files.map((f) => [f.item, f]));
  const bf = S.bf && S.bf.bank === S.route.name ? S.bf : null;
  const shown = (n) => !bf || !bf.active || !!bf.info[n];
  const row = (n) => {
    const f = byItem[n];
    if (!f || !shown(n)) return '';
    const u = bf && bf.info[n];
    return f.questions.map((q) => {
      const sel = !!(S.qform && S.qform.file === f.file && S.qform.id === q.id);
      const m = f.meta || {};
      return `<button class="q-item ${sel ? 'is-selected' : ''} ${q.problem ? 'is-problem' : ''} ${f.questions.length > 1 ? 'in-set' : ''} ${m.archived ? 'is-archived' : ''}" data-act="q-pick" data-file="${esc(f.file)}" data-id="${esc(q.id)}" aria-pressed="${sel}"
        draggable="true" data-drag="q" data-item="${esc(f.item)}" data-group="${esc(d.bank.groups.find((g) => g.items.includes(n)) ? d.bank.groups.find((g) => g.items.includes(n)).name : '')}">
        <span class="q-item-id">${esc(q.id)}</span><span class="q-item-kind">${m.archived ? 'archived · ' : ''}${m.difficulty ? `${DIFF_LABEL[m.difficulty]} · ` : ''}${q.kind}${u && u.used ? ` · printed ${u.used}×` : ''}</span>
        <span class="q-item-text">${q.problem ? `${ic('warning-triangle')} ${esc(q.problem)}` : esc(trunc(m.title || q.text || '(no text yet)', 70))}${(m.tags || []).length ? ` <span class="b-tags">${m.tags.map(esc).join(' · ')}</span>` : ''}</span></button>`;
    }).join('');
  };
  const total = d.files.reduce((n, f) => n + f.questions.length, 0);
  let html = `<div class="q-list-head"><b>Questions</b><span class="chip">${total}</span><span class="spacer"></span><button class="btn btn-sm btn-ghost" data-act="bgroup-add">${ic('plus')} Group</button></div>`;
  if (bf && bf.active) html += `<p class="subtle q-note">${plural(Object.keys(bf.info).length, 'question matches', 'questions match')} the search.</p>`;
  d.bank.groups.forEach((g, i) => {
    if (bf && bf.active && !g.items.some(shown)) return;
    html += `<div class="q-group b-group" data-dropgroup="${esc(g.name)}"><span>${esc(g.title || g.name)} <span class="subtle">· ${g.items.length}</span></span><span class="spacer"></span>
      <button class="btn btn-ghost btn-icon btn-xs" data-act="bitem-add" data-group="${esc(g.name)}" title="Add a question to this group" aria-label="Add a question to ${esc(g.name)}">${ic('plus')}</button>
      <button class="btn btn-ghost btn-icon btn-xs" data-act="bgroup-edit" data-group="${esc(g.name)}" title="Title, instructions and scoring of the group" aria-label="Edit the group ${esc(g.name)}">${ic('edit-pencil')}</button>
      <button class="btn btn-ghost btn-icon btn-xs" data-act="bgroup-move" data-group="${esc(g.name)}" data-d="-1" ${i ? '' : 'disabled'} title="Move up" aria-label="Move the group up">${ic('nav-arrow-up')}</button></div>`;
    html += g.items.map(row).join('') || '<p class="subtle q-note">No question yet.</p>';
  });
  if (d.bank.loose.some(shown)) html += `<div class="q-group">Not in a group</div>${d.bank.loose.map(row).join('')}`;
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
    <label class="check b-arch" title="An archived question is hidden from &quot;From a bank&quot;; exams that have it and History keep it"><input type="checkbox" data-bmeta="archived" ${m.archived ? 'checked' : ''}><span>Archived</span></label>
    ${m.origin ? `<span class="subtle b-origin" title="Where it came from">${ic('info-circle')} ${m.origin.exam ? `From the exam ${esc(m.origin.exam)}` : m.origin.file ? `Imported from ${esc(m.origin.file)}` : ''}</span>` : ''}</div>
    <div class="b-usage subtle" data-item="${esc(f.item)}">${usageText(f.item)}</div>`;
}
/* The exams that printed an item (the usage log) and those holding a copy now. */
function usageText(item) {
  const u = S.busage && S.busage[item];
  if (!u) { if (S.busage) { S.busage[item] = 'loading'; loadUsage(item); } return ''; }
  if (u === 'loading') return '';
  const exam = (n) => `<a href="/exam/${enc(n)}/questions" data-nav>${esc(n)}</a>`;
  const parts = [];
  if (u.printed.length) parts.push(`Printed in ${u.printed.map((x) => `${exam(x.exam)} (${esc(fmtDate(x.at))})`).join(', ')}`);
  if (u.copies.length) parts.push(`Copies in ${[...new Set(u.copies.map((x) => x.exam))].map(exam).join(', ')}`);
  const sums = Object.entries(u.summary || {}).filter(([, s]) => s);
  const st = sums.map(([q, s]) => `${sums.length > 1 ? `${esc(q)}: ` : ''}${Math.round(s.right * 100)}% right over ${plural(s.n, 'copy', 'copies')} in ${plural(s.exams, 'exam', 'exams')}${s.separation !== null ? `, separates ${s.separation.toFixed(2)}` : ''}`);
  return `${ic('book-stack')} ${parts.length ? parts.join(' · ') : 'Not in any exam yet.'}${st.length ? `<br>${ic('stats-report')} ${st.join(' · ')}` : ''}`;
}
async function loadUsage(item) {
  let r;
  try { r = await getJSON(`${qApi('usage')}?item=${enc(item)}`); } catch { return; }
  if (r.error || !S.busage) return;
  S.busage[item] = r;
  document.querySelectorAll('.b-usage').forEach((el) => { if (el.dataset.item === item) el.innerHTML = usageText(item); });
}
/* In an exam: where an item came from (a bank), and that it is a copy. */
function itemOrigin(f) {
  const o = f && f.meta && f.meta.origin;
  if (!o || !o.bank) return '';
  const c = copyOf(f.item);
  const name = c ? c.bank : o.bank;
  return `<div class="b-meta b-copy"><span class="subtle b-origin">${ic('book-stack')} A copy from the bank ${c && !c.bank_found ? esc(name) : `<a href="/bank/${enc(name)}" data-nav>${esc(name)}</a>`} (${esc(c ? c.bank_item : o.item)})</span>
    ${c ? `<span class="b-status ${COPY_CLASS[c.status]}">${esc(c.words)}</span>${c.status !== 'same' ? `<button class="btn btn-sm btn-ghost" data-act="copy-compare" data-item="${esc(f.item)}">${ic('git-compare')} Compare…</button>` : ''}` : ''}</div>`;
}
let bmetaTimer = null;
function bankInput(t) {
  if (filterInput(t) || bankSearchInput(t)) return true;
  if (!t.dataset || !t.dataset.bmeta) return false;
  clearTimeout(bmetaTimer);
  bmetaTimer = setTimeout(() => saveBankMeta(t), t.dataset.bmeta === 'tags' ? 900 : 0);
  return true;
}
function bankChange(t) {
  if (filterInput(t)) return true;
  if (t.dataset && t.dataset.bmeta) { clearTimeout(bmetaTimer); saveBankMeta(t); return true; }
  if (t.id === 'bp-bank') { bpPickBank(t.value); return true; }
  if (t.id === 'bp-group') { S.bp.group = t.value; S.bp.ticked = []; S.bp.chosen = null; renderPicker(); bpFilter(); return true; }
  if (t.name === 'bp-mode') { S.bp.mode = t.value; S.bp.chosen = null; S.bp.chosenInfo = null; S.bp.short = []; renderPicker(); return true; }
  if (t.classList && t.classList.contains('bpb')) { const r = S.bp.blue[+t.dataset.i]; r[t.dataset.k] = t.dataset.k === 'count' ? Math.max(1, +t.value || 1) : t.value; S.bp.chosen = null; S.bp.chosenInfo = null; const h = $('#bp-listhost'); if (h) h.innerHTML = pickerList(); return true; }
  if (t.id === 'bp-section') { S.bp.section = t.value; return true; }
  if (t.id === 'bp-count') { S.bp.count = +t.value || 1; S.bp.chosen = null; return true; }
  if (t.id === 'bp-scoring-all') { S.bp.scoringAll = t.checked; return true; }
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
  body[t.dataset.bmeta] = t.type === 'checkbox' ? t.checked : t.value;
  const r = await postJSON(qApi('items'), body);
  if (!r.ok) { toast(r.error || 'Not saved.', 'warning-triangle'); return; }
  const keep = S.qform;
  S.qdata = r; S.qform = keep;
  renderQList();
  if (t.dataset.bmeta !== 'archived') renderBankFilters();
  bankFilter();
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

/* ---------- Search and filters (server: ui_bankindex.py) ----------
   The bank page and "From a bank" filter their list by words (as prefixes), difficulty, kind, tag
   and "not printed since"; only the list is redrawn, so typing isn't interrupted. */

const KIND_LABEL = { single: 'Single answer', multiple: 'Multiple answers', numeric: 'Numeric', set: 'Set (shared text)' };
function filterRow(p, f, tags, archived) {
  const sel = (k, first, opts) => `<select class="select input-sm" id="${p}-${k}" aria-label="${first}"><option value="">${first}</option>${opts.map(([v, l]) => `<option value="${esc(v)}" ${f[k] === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  return `<div class="b-filters"><input class="input input-sm" type="search" id="${p}-q" placeholder="Search…" value="${esc(f.q)}" aria-label="Search the questions">
    ${sel('difficulty', 'Any difficulty', Object.entries(DIFF_LABEL))}${sel('kind', 'Any kind', Object.entries(KIND_LABEL))}
    ${tags.length ? sel('tag', 'Any tag', tags.map((x) => [x, x])) : ''}
    ${sel('unused', 'Printed or not', [['never', 'Never printed'], ['90', 'Not printed for 3 months'], ['365', 'Not printed for a year']])}
    ${archived ? `<label class="check"><input type="checkbox" id="${p}-archived" ${f.archived ? 'checked' : ''}><span>Archived too</span></label>` : ''}</div>`;
}
const tagsOf = (files) => [...new Set(files.flatMap((f) => (f.meta && f.meta.tags) || []))].sort((a, b) => a.localeCompare(b));
async function searchInto(f, bank, group) {
  const p = new URLSearchParams({ archived: '1' });
  if (bank) p.set('bank', bank);
  if (group) p.set('group', group);
  ['q', 'difficulty', 'kind', 'unused'].forEach((k) => { if (f[k]) p.set(k, f[k]); });
  if (f.tag) p.append('tag', f.tag);
  const seq = (f.seq = (f.seq || 0) + 1);
  let r;
  try { r = await getJSON(`/ui/api/bank-search?${p}`); } catch { return false; }
  if (f.seq !== seq) return false;
  f.info = Object.fromEntries((r.items || []).map((x) => [x.item, x]));
  f.list = r.items || [];
  f.active = !!(f.q || f.difficulty || f.kind || f.tag || f.unused);
  return true;
}
function renderBankFilters() {
  const host = $('#bank-filters');
  if (!host || !S.qdata || !S.qdata.bank || !S.bf) return;
  if (host.contains(document.activeElement)) return; // the teacher is typing
  host.innerHTML = S.qdata.files.length ? filterRow('bf', S.bf, tagsOf(S.qdata.files), false) : '';
}
async function bankFilter() {
  const f = S.bf; if (!f) return;
  if (await searchInto(f, f.bank, null) && S.route.kind === 'bank' && S.route.name === f.bank) renderQList();
}
let filterTimer = null;
function filterInput(t) {
  const m = /^(bf|bpf)-(q|difficulty|kind|tag|unused|archived)$/.exec(t.id || '');
  if (!m) return false;
  const f = m[1] === 'bf' ? S.bf : S.bp && S.bp.f;
  if (!f) return true;
  f[m[2]] = m[2] === 'archived' ? t.checked : t.value;
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => (m[1] === 'bf' ? bankFilter() : bpFilter()), m[2] === 'q' ? 250 : 0);
  return true;
}

/* The Question banks page: search all of them. */
let bksTimer = null;
function bankResults() {
  const s = S.bks;
  if (!s || !s.q) return '';
  if (!s.items) return '<p class="subtle">Searching…</p>';
  if (!s.items.length) return '<p class="subtle">No question matches.</p>';
  return `<div class="bp-list b-results">${s.items.map((x) => `<button class="bp-row b-hit" data-act="bsearch-open" data-bank="${esc(x.bank)}" data-item="${esc(x.item)}">
    <span class="subtle">${esc(x.bank)}${x.group ? ` › ${esc(x.group)}` : ''}</span><span class="mono">${esc(x.item)}</span>${x.archived ? '<span class="chip">archived</span>' : '<span></span>'}
    <span class="bp-text">${esc(trunc(x.title || '', 90))}</span><span class="subtle">${x.difficulty ? DIFF_LABEL[x.difficulty] : ''}${x.used ? ` · printed ${x.used}×` : ''}</span></button>`).join('')}</div>`;
}
function bankSearchInput(t) {
  if (t.id !== 'bk-search') return false;
  S.bks = { q: t.value.trim(), items: null };
  clearTimeout(bksTimer);
  bksTimer = setTimeout(async () => {
    const s = S.bks; if (!s || !s.q) { const h = $('#bk-results'); if (h) h.innerHTML = ''; return; }
    const f = { q: s.q };
    if (await searchInto(f, null, null) && S.bks === s) { s.items = f.list; const h = $('#bk-results'); if (h) h.innerHTML = bankResults(); }
  }, 250);
  return true;
}

/* A bank downloaded as a zip, imported here as a new bank. */
function bankZipImport() {
  openDialog(`<div class="dialog-head"><span class="dialog-icon brand">${ic('upload')}</span><div><h2 id="dlg-title">Import a bank</h2><p class="subtle" style="margin:2px 0 0">A zip made with "Download as a zip", here or on another computer. It becomes a bank of your own, with its history.</p></div></div>
    <div class="dialog-body"><input type="file" id="bank-zip-file" accept=".zip,application/zip">
      <label class="field" style="margin-top:10px"><span class="field-label">Name (optional: the bank's own name is used)</span><input class="input" id="bank-zip-name" maxlength="80"></label>
      <div id="bank-zip-msg"></div></div>
    <div class="dialog-foot"><button class="btn" data-act="dialog-cancel">Cancel</button><button class="btn btn-primary" data-act="bank-zip-go">${ic('upload')} Import</button></div>`);
}
async function bankZipGo() {
  const input = $('#bank-zip-file'); const file = input && input.files[0];
  const msg = (h) => { const m = $('#bank-zip-msg'); if (m) m.innerHTML = h; };
  if (!file) { msg('<p class="field-hint" style="color:var(--danger)">Choose the zip first.</p>'); return; }
  let r;
  try { r = await postForm('/ui/api/banks/import', [[file, file.name]], { name: ($('#bank-zip-name') || {}).value || '' }); } catch (e) { r = e.body || { error: e.message }; }
  if (!r || !r.ok) { msg(banner('danger', 'warning-triangle', esc((r && r.error) || 'Not imported.'), '')); return; }
  closeDialog();
  toast(`"${r.name}" imported: ${plural(r.items, 'question', 'questions')}${r.history ? ', with its history' : ''}.`);
  navigate(`/bank/${enc(r.name)}`);
}

/* ---------- In an exam: from a bank ---------- */

async function openPicker(section = null) {
  if (typeof flushQ === 'function') await flushQ();
  let r;
  try { r = await getJSON('/ui/api/banks'); } catch { toast('Your banks couldn\'t be read.', 'warning-triangle'); return; }
  if (!r.banks || !r.banks.length) { notice('No question bank yet', 'Make a bank on the Question banks page (top right), or save this exam\'s questions into one.', 'book-stack'); return; }
  const sel = typeof qsel === 'function' ? qsel() : null;
  if (!S.bcopies) await loadCopies();
  S.bp = { banks: r.banks, bank: null, data: null, group: null, ticked: [], mode: 'new', section: section || (sel && sel.group) || null, count: 3, chosen: null, chosenInfo: null, short: [], blue: null, scoringAll: false, sections: await examSections(), f: { q: '', difficulty: '', kind: '', tag: '', unused: '', archived: false, active: false, info: {} } };
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
  const saved = S.bcopies && S.bcopies.blueprints && S.bcopies.blueprints[bp.section];
  bp.blue = saved && bp.data.bank && saved.bank_uid === bp.data.bank.uid ? saved.rows.map((r) => ({ ...r }))
    : [{ count: 3, difficulty: '', group: bp.group || '', tag: '' }];
  renderPicker();
  bpFilter();
}
/* A blueprint: rows of "how many, of what difficulty, from which group, with which tag". */
function blueprintRows() {
  const bp = S.bp; const d = bp.data;
  const groups = d && d.bank ? d.bank.groups : [];
  const tags = d && d.files ? tagsOf(d.files) : [];
  const opt = (v, l, cur) => `<option value="${esc(v)}" ${cur === v ? 'selected' : ''}>${esc(l)}</option>`;
  return `<div class="bp-blue">${bp.blue.map((r, i) => `<div class="bp-blue-row">
      <input class="input input-sm bpb" type="number" min="1" max="200" data-i="${i}" data-k="count" value="${r.count}" aria-label="How many">
      <select class="select input-sm bpb" data-i="${i}" data-k="difficulty" aria-label="Difficulty">${opt('', 'of any difficulty', r.difficulty)}${Object.entries(DIFF_LABEL).map(([v, l]) => opt(v, l.toLowerCase(), r.difficulty)).join('')}</select>
      <span class="subtle">from</span><select class="select input-sm bpb" data-i="${i}" data-k="group" aria-label="Group">${opt('', 'any group', r.group)}${groups.map((g) => opt(g.name, g.title || g.name, r.group)).join('')}</select>
      ${tags.length ? `<select class="select input-sm bpb" data-i="${i}" data-k="tag" aria-label="Tag">${opt('', 'any tag', r.tag)}${tags.map((x) => opt(x, x, r.tag)).join('')}</select>` : ''}
      <button class="btn btn-ghost btn-icon btn-sm" data-act="bpb-remove" data-i="${i}" ${bp.blue.length > 1 ? '' : 'disabled'} title="Remove this row" aria-label="Remove this row">${ic('xmark')}</button></div>`).join('')}
    <button class="btn btn-sm btn-ghost" data-act="bpb-add">${ic('plus')} Add a row</button></div>`;
}
async function bpFilter() {
  const bp = S.bp; if (!bp || !bp.group) return;
  if (await searchInto(bp.f, bp.bank, bp.group) && S.bp === bp) { bp.chosen = null; const h = $('#bp-listhost'); if (h) h.innerHTML = pickerList(); }
}
/* The group's questions as the filters show them: archived ones only when asked. */
function bpShown() {
  const bp = S.bp; const d = bp && bp.data;
  const g = d && d.bank ? d.bank.groups.find((x) => x.name === bp.group) : null;
  if (!g) return [];
  const files = Object.fromEntries(d.files.map((f) => [f.item, f]));
  return g.items.filter((n) => (!bp.f.active || bp.f.info[n]) && (bp.f.archived || !((files[n] || {}).meta || {}).archived));
}
function pickerList() {
  const bp = S.bp; const d = bp.data;
  if (bp.mode === 'blueprint') {
    if (!bp.chosenInfo) return '<p class="subtle">Pick: the questions are drawn at random once, for each row, from the bank\'s questions this exam doesn\'t have (archived ones left out); you see them before they are added.</p>';
    return `${bp.short.length ? banner('warning', 'warning-triangle', 'Not enough questions for every row', esc(bp.short.join('; '))) : ''}
      <div class="bp-list">${bp.chosenInfo.map((x) => `<div class="bp-row is-chosen"><span></span><span class="mono">${esc(x.item)}</span><span class="subtle">${esc(x.group || '')}</span><span class="bp-text">${esc(trunc(x.title || '', 90))}</span><span></span></div>`).join('') || '<p class="subtle">No question matches.</p>'}</div>`;
  }
  const g = d && d.bank ? d.bank.groups.find((x) => x.name === bp.group) : null;
  if (!d) return '<p class="subtle">Loading…</p>';
  if (d.error) return `<p>${esc(d.error)}</p>`;
  if (!g) return '<p class="subtle">This bank has no group yet.</p>';
  const files = Object.fromEntries(d.files.map((f) => [f.item, f]));
  const names = bpShown();
  return `<div class="bp-list">${names.map((n) => { const f = files[n]; const q = f && f.questions[0]; const m = (f && f.meta) || {};
      const chosen = bp.chosen && bp.chosen.includes(n);
      const here = !!(S.bcopies && m.uid && S.bcopies.copies.some((c) => c.bank_uid === d.bank.uid && c.item_uid === m.uid));
      const u = bp.f.info[n];
      return `<label class="bp-row ${chosen ? 'is-chosen' : ''} ${here ? 'is-in' : ''}"><input type="checkbox" class="bp-tick" data-item="${esc(n)}" ${bp.ticked.includes(n) && !here ? 'checked' : ''} ${bp.mode === 'ticked' && !here ? '' : 'disabled'}>
        <span class="mono">${esc(q ? q.id : n)}</span>${f && f.questions.length > 1 ? `<span class="chip">set of ${f.questions.length}</span>` : ''}${here ? '<span class="chip" title="Not added twice">in this exam</span>' : ''}${m.archived ? '<span class="chip">archived</span>' : ''}
        <span class="bp-text">${esc(trunc(m.title || (q && q.text) || '', 90))}</span><span class="subtle">${m.difficulty ? DIFF_LABEL[m.difficulty] : ''}${(m.tags || []).length ? ` · ${m.tags.map(esc).join(', ')}` : ''}${u ? ` · ${u.used ? `printed ${u.used}× (last: ${esc(u.last_exam || '')})` : 'never printed'}` : ''}</span></label>`; }).join('') || `<p class="subtle">${g.items.length ? 'No question of this group matches.' : 'No question in this group.'}</p>`}</div>`;
}
function renderPicker() {
  const bp = S.bp; if (!bp) return;
  const d = bp.data;
  const g = d && d.bank ? d.bank.groups.find((x) => x.name === bp.group) : null;
  const secSel = `<select class="select input-sm" id="bp-section">${bp.sections.map((s) => `<option ${s === bp.section ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>`;
  const list = bp.mode === 'blueprint' ? `${d && d.bank ? blueprintRows() : ''}<div id="bp-listhost">${pickerList()}</div>`
    : `${d && d.bank && g ? filterRow('bpf', bp.f, tagsOf(d.files.filter((f) => g.items.includes(f.item))), true) : ''}<div id="bp-listhost">${pickerList()}</div>`;
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
        ${sectionsLeft ? radio('blueprint', `By a blueprint ("3 easy + 5 medium from Algebra"), into the section ${bp.mode === 'blueprint' ? secSel : ''}`) : ''}
        ${sectionsLeft ? radio('random', `<input class="input input-sm" type="number" id="bp-count" min="1" max="999" value="${bp.count}" style="width:70px" ${bp.mode === 'random' ? '' : 'disabled'}> picked at random from the questions shown below that this exam doesn't have (shown first), into the section ${bp.mode === 'random' ? secSel : ''}`) : ''}
      </div>
      ${g && g.scoring ? `<div class="bp-modes"><p class="subtle" style="margin:4px 0 2px">The group's scoring <code>${esc(g.scoring)}</code> goes to the questions without their own.</p><label class="check"><input type="checkbox" id="bp-scoring-all" ${bp.scoringAll ? 'checked' : ''}><span>Give it to every question, also those with their own scoring</span></label></div>` : ''}
      ${bp.chosen && bp.mode === 'random' ? banner('info', 'info-circle', `Picked: ${esc(bp.chosen.join(', '))}`, 'These are added (the pick is made once). Pick again for another.') : ''}
      ${list}<div id="bp-msg"></div></div>
    <div class="dialog-foot"><button class="btn" data-act="dialog-cancel">Cancel</button>
      ${bp.mode === 'random' || bp.mode === 'blueprint' ? `<button class="btn" data-act="bp-pick" ${g || bp.mode === 'blueprint' ? '' : 'disabled'}>${bp.chosen ? 'Pick again' : 'Pick'}</button>` : ''}
      <button class="btn btn-primary" data-act="bp-add" ${(bp.mode === 'blueprint' ? bp.chosen && bp.chosen.length : g && (bp.mode !== 'random' || bp.chosen)) ? '' : 'disabled'}>${ic('plus')} Add to the exam</button></div>`);
  const dlg = $('#layer .dialog'); if (dlg) dlg.classList.add('dialog-wide');
}
async function bpPick() {
  const bp = S.bp; if (!bp) return;
  if (bp.mode === 'blueprint') {
    const r = await postJSON('/ui/api/bank-pull', { bank: bp.bank, blueprint: bp.blue, seed: `${Date.now()}`, preview: true });
    if (!r.ok) { toast(r.error || 'No pick.', 'warning-triangle'); return; }
    bp.chosen = r.chosen.map((x) => x.item); bp.chosenInfo = r.chosen; bp.short = r.short || [];
    renderPicker();
    return;
  }
  const r = await postJSON('/ui/api/bank-pull', { bank: bp.bank, group: bp.group, items: bpShown(), count: bp.count, seed: `${Date.now()}`, preview: true });
  if (!r.ok) { toast(r.error || 'No pick.', 'warning-triangle'); return; }
  bp.chosen = r.chosen.map((x) => x.item);
  renderPicker();
}
async function bpAdd() {
  const bp = S.bp; if (!bp) return;
  const body = { bank: bp.bank, group: bp.group, mode: bp.mode === 'new' ? 'new' : 'into', section: bp.section || bp.sections[0], scoring_all: bp.scoringAll };
  if (bp.mode === 'ticked') { if (!bp.ticked.length) { toast('Tick at least one question.', 'warning-triangle'); return; } body.items = bp.ticked; }
  if (bp.mode === 'random') body.items = bp.chosen;
  if (bp.mode === 'blueprint') { body.items = bp.chosen; body.blueprint = bp.blue; body.group = ''; }
  const r = await postJSON('/ui/api/bank-pull', body);
  if (!r.ok) { const m = $('#bp-msg'); if (m) m.innerHTML = banner('danger', 'warning-triangle', esc(r.error || 'Not added.'), ''); return; }
  closeDialog(); S.bp = null;
  toast(r.what + (r.skipped && r.skipped.length ? ` (${r.skipped.join(', ')} already in the exam, not added twice)` : ''));
  if (r.clashes && r.clashes.length) showClashes(r.clashes, 'exam');
  S.bcopies = null;
  if (S.qtab === 'design' && typeof loadDesign === 'function') loadDesign();
  else { S.qdata = r; const a = r.added && r.added[0]; const f = a && qfile(a); if (f) S.qform = { file: a, id: f.questions[0].id, pending: [], saving: false }; renderQuestionsForm(); }
}

/* ---------- In an exam: to a bank ---------- */

async function openSaveDialog(what) {
  if (typeof flushQ === 'function') await flushQ();
  let r;
  try { r = await getJSON('/ui/api/banks'); } catch { toast('Your banks couldn\'t be read.', 'warning-triangle'); return; }
  S.bs = { what, banks: r.banks || [], bank: (r.banks || [])[0] ? r.banks[0].name : '', data: null, group: '', linked: what.linked || 'update', newBank: '' };
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
  if (r.clashes && r.clashes.length) showClashes(r.clashes, 'bank');
  if (S.qtab === 'form' && typeof loadEditor === 'function' && S.route.kind === 'exam') loadEditor(); else loadCopies();
}

/* ---------- In an exam: copies of bank questions (section 7.4) ----------
   Each copy shows a status from fingerprints: Up to date, Bank updated, Edited here, Both changed.
   Nothing changes unless the teacher asks: take the bank's version, keep this exam's, update the
   bank's copy, or combine both (by hand where they changed the same place). Sections made from a
   whole group offer the questions the group gained since. Server: ui_bankcopies.py. */

const COPY_CLASS = { same: 'st-same', bank: 'st-bank', here: 'st-here', both: 'st-both', kept: 'st-here', gone: 'st-gone' };

async function loadCopies() {
  const project = S.project;
  if (!project || S.route.kind !== 'exam') return;
  let r;
  try { r = await getJSON('/ui/api/bank-copies'); } catch (e) { console.error(e); return; }
  if (S.project !== project || r.project !== project) return;
  const before = JSON.stringify(S.bcopies || null);
  S.bcopies = r;
  if (JSON.stringify(r) === before) return;
  const h = $('#q-head'); if (h && S.route.step === 'questions') h.innerHTML = questionsHead();
  if ($('#q-list') && !inBank()) renderQList();
  if ($('#q-form') && !inBank() && S.qform) { const f = qfile(S.qform.file); const box = $('#q-form .b-copy'); if (box && f) box.outerHTML = itemOrigin(f); }
}
const copyOf = (item) => (S.bcopies && item ? S.bcopies.copies.find((c) => c.item === item) : null);

/* A small mark in the question list for a copy that isn't up to date. */
function copyBadge(item) {
  const c = copyOf(item);
  if (!c || c.status === 'same') return '';
  return ` <span class="b-status ${COPY_CLASS[c.status]}" title="A copy from the bank ${esc(c.bank)}: ${esc(c.words)}">${esc(c.words)}</span>`;
}

/* Above the questions: copies that changed, and groups that gained questions. */
function bankStrip() {
  const d = S.bcopies;
  if (!d || d.project !== S.project) return '';
  const n = d.counts || {};
  const parts = [['bank', 'newer in the bank'], ['here', 'edited here'], ['both', 'changed in both'], ['kept', 'with a newer bank version set aside'], ['gone', 'no longer in their bank']]
    .filter(([k]) => n[k]).map(([k, w]) => `${n[k]} ${w}`);
  let html = '';
  if (parts.length) {
    html += banner('info', 'book-stack', `Questions from your banks: ${esc(parts.join(' · '))}`, d.lock ? 'The exam is printed: only answer key and scoring fixes can be taken from a bank.' : 'Nothing changes until you choose.',
      `<button class="btn btn-sm" data-act="copies-open">${ic('git-compare')} Review…</button>`);
  }
  for (const f of d.follow || []) {
    const msg = [f.new.length ? `${plural(f.new.length, 'new question', 'new questions')} (${esc(f.new.map((x) => x.item).join(', '))})` : '',
      f.gone.length ? `${plural(f.gone.length, 'question', 'questions')} of the section no longer in the group (${esc(f.gone.join(', '))}, kept here)` : ''].filter(Boolean).join('; ');
    html += banner('info', 'book-stack', `The group ${esc(f.title)} of the bank ${esc(f.bank)}, which the section ${esc(f.section)} was made from: ${msg}`, '',
      `${f.new.length ? `<button class="btn btn-sm" data-act="follow-add" data-section="${esc(f.section)}">${ic('plus')} Add ${f.new.length === 1 ? 'it' : 'them'} to the section</button>` : ''}<button class="btn btn-sm btn-ghost" data-act="follow-dismiss" data-section="${esc(f.section)}">${f.new.length ? 'Not these' : 'OK'}</button>`);
  }
  return html ? `<div class="b-strip">${html}</div>` : '';
}

async function followAdd(section) {
  const f = ((S.bcopies && S.bcopies.follow) || []).find((x) => x.section === section);
  if (!f) return;
  const r = await postJSON('/ui/api/bank-pull', { bank: f.bank, group: f.group, items: f.new.map((x) => x.item), mode: 'into', section });
  if (!r.ok) { notice('Not added', r.error || 'Unknown error'); return; }
  toast(r.what);
  if (r.clashes && r.clashes.length) showClashes(r.clashes, 'exam');
  afterCopyChange(r);
}
async function followDismiss(section) {
  const r = await postJSON('/ui/api/bank-follow', { section });
  if (!r.ok) { toast(r.error || 'Not saved.', 'warning-triangle'); return; }
  S.bcopies = r.copies;
  const h = $('#q-head'); if (h) h.innerHTML = questionsHead();
}
function afterCopyChange(r) {
  if (S.qtab === 'design' && typeof loadDesign === 'function') { loadDesign(); return; }
  if (r && r.files) { const keep = S.qform; S.qdata = r; S.qform = keep && qfile(keep.file) ? keep : S.qform; if (!qsel()) S.qform = null; renderQuestionsForm(); }
  if (r && r.copies) { S.bcopies = r.copies; const h = $('#q-head'); if (h) h.innerHTML = questionsHead(); renderQList(); } else loadCopies();
}

/* The list of copies that changed. */
function openCopies() {
  const d = S.bcopies; if (!d) return;
  const list = d.copies.filter((c) => c.status !== 'same');
  openDialog(`<div class="dialog-head"><span class="dialog-icon brand">${ic('book-stack')}</span><div><h2 id="dlg-title">Questions from your banks</h2><p class="subtle" style="margin:2px 0 0">Copies whose bank question or exam copy changed since they were copied.</p></div></div>
    <div class="dialog-body">${list.length ? `<div class="bp-list">${list.map((c) => `<div class="bp-row"><span class="mono">${esc(c.item)}</span><span class="b-status ${COPY_CLASS[c.status]}">${esc(c.words)}</span>
      <span class="bp-text subtle">bank ${esc(c.bank)} · ${esc(c.bank_item)}</span><button class="btn btn-sm" data-act="copy-compare" data-item="${esc(c.item)}">${ic('git-compare')} Compare…</button></div>`).join('')}</div>` : '<p class="subtle">Every copy is up to date.</p>'}</div>
    <div class="dialog-foot"><button class="btn" data-act="dialog-cancel">Close</button></div>`);
  const dlg = $('#layer .dialog'); if (dlg) dlg.classList.add('dialog-wide');
}

/* One copy against its bank question. */
async function openCompare(item) {
  if (typeof flushQ === 'function') await flushQ();
  let r;
  try { r = await getJSON(`/ui/api/bank-copy?item=${enc(item)}`); } catch { toast('The comparison couldn\'t be read.', 'warning-triangle'); return; }
  if (r.error) { notice('No comparison', r.error); return; }
  S.bcmp = r;
  renderCompare();
}
function renderCompare() {
  const r = S.bcmp; if (!r) return;
  const diff = (title, d, empty) => `<div class="b-diff"><div class="hist-summary-title">${title}</div>${!d ? '' : d.too_big ? '<p class="subtle">Too big to show.</p>' : d.rows.length ? `<div class="diff">${diffRows(d.rows)}</div>` : `<p class="subtle">${empty}</p>`}</div>`;
  const figs = r.figures && r.figures.length ? `<p class="subtle">Figures that differ: ${esc(r.figures.join(', '))}</p>` : '';
  let body = ''; let acts = '';
  const take = `<button class="btn ${r.status === 'bank' ? 'btn-primary' : ''}" data-act="copy-op" data-op="take" ${r.take_refused ? 'disabled' : ''}>${ic('data-transfer-down')} Take the bank's version</button>`;
  const keep = `<button class="btn" data-act="copy-op" data-op="keep" title="Keep this exam's question as it is; the bank's newer version won't be offered again">Keep this exam's</button>`;
  const push = `<button class="btn ${r.status === 'here' ? 'btn-primary' : ''}" data-act="copy-op" data-op="push" title="The bank's question becomes this exam's version (a new version in the bank's history)">${ic('data-transfer-up')} Update the bank's copy</button>`;
  const asNew = `<button class="btn" data-act="copy-save-new" data-item="${esc(r.item)}">${ic('book-stack')} Save as a new question in a bank…</button>`;
  if (r.status === 'gone') {
    body = '<p>The bank\'s question was deleted, or its bank isn\'t among your banks any more. This exam keeps its copy.</p>';
    acts = asNew;
  } else if (r.status === 'same') {
    body = '<p>This exam\'s copy is the bank\'s current version.</p>';
  } else if (r.status === 'bank') {
    body = r.since_bank ? diff('What changed in the bank since the copy', r.since_bank, 'Nothing in the text (a figure changed).') : diff('What taking the bank\'s version changes here', r.take, 'Nothing in the text (a figure changed).');
    acts = keep + take;
  } else if (r.status === 'here') {
    body = r.since_here ? diff('What changed in this exam since the copy', r.since_here, 'Nothing in the text (a figure changed).') : diff('What updating the bank\'s copy changes there', r.push, 'Nothing in the text (a figure changed).');
    acts = asNew + push;
  } else if (r.status === 'kept') {
    body = '<p class="subtle">You chose to keep this exam\'s version when the bank changed. It can still be taken.</p>'
      + (r.since_bank ? diff('What changed in the bank since the copy', r.since_bank, 'Nothing in the text (a figure changed).') : diff('What taking the bank\'s version changes here', r.take, 'Nothing in the text (a figure changed).'));
    acts = asNew + take;
  } else {
    body = (r.since_here ? diff('Changed in this exam since the copy', r.since_here, 'Nothing in the text.') + diff('Changed in the bank since the copy', r.since_bank, 'Nothing in the text.')
      : diff('What taking the bank\'s version changes here', r.take, 'Nothing in the text.'))
      + (r.can_merge ? '<p class="subtle">Combine both: the changes of each side are kept; where both changed the same place you choose by hand.</p>' : '');
    acts = keep + push + take + (r.can_merge ? `<button class="btn btn-primary" data-act="copy-op" data-op="merge">${ic('git-merge')} Combine both</button>` : '');
  }
  openDialog(`<div class="dialog-head"><span class="dialog-icon brand">${ic('git-compare')}</span><div><h2 id="dlg-title">${esc(r.item)} and the bank's ${esc(r.bank_item || '')}</h2>
      <p class="subtle" style="margin:2px 0 0"><span class="b-status ${COPY_CLASS[r.status]}">${esc(r.words)}</span> · bank ${esc(r.bank)}</p></div></div>
    <div class="dialog-body">${r.take_refused ? banner('warning', 'lock', esc(r.take_refused), '') : ''}${body}${figs}<div id="bcmp-msg"></div></div>
    <div class="dialog-foot"><button class="btn" data-act="dialog-cancel">Close</button>${acts}</div>`);
  const dlg = $('#layer .dialog'); if (dlg) dlg.classList.add('dialog-wide');
}
async function copyOp(op, text) {
  const r0 = S.bcmp; if (!r0) return;
  if (op === 'push' && !(await confirmDialog({ title: `Update the bank's ${esc(r0.bank_item)}?`, ok: 'Update', icon: 'data-transfer-up',
    body: `<p>The bank ${esc(r0.bank)} gets this exam's version of the question (a new version in its History). Other exams with a copy will see "Bank updated".</p>` }))) { renderCompare(); return; }
  const body = { item: r0.item, op, digest: r0.digest, bank_fp: r0.bank_fp };
  if (typeof text === 'string') body.text = text;
  const r = await postJSON('/ui/api/bank-copy', body);
  if (r.conflicts) { openMergeEditor(r.text, r.conflicts); return; }
  if (!r.ok) {
    if (S.bmerge) { const m = $('#bmerge-msg'); if (m) { m.innerHTML = banner('danger', 'warning-triangle', esc(r.error || 'Not saved.'), ''); return; } }
    if (r.conflict) { // one side changed meanwhile: the comparison is read again, then the message
      try { const n = await getJSON(`/ui/api/bank-copy?item=${enc(r0.item)}`); if (!n.error) { S.bcmp = n; renderCompare(); } } catch { /* the message below says to look again */ }
    }
    if (!$('#bcmp-msg')) renderCompare();
    const m = $('#bcmp-msg'); if (m) m.innerHTML = banner('danger', 'warning-triangle', esc(r.error || 'Not done.'), '');
    return;
  }
  if (S.bmerge) { S.bmerge.ed.destroy(); S.bmerge = null; }
  closeDialog(); S.bcmp = null;
  toast(r.what);
  afterCopyChange(r);
}
/* Both changed the same place: the combined text with the places marked, to finish by hand. */
function openMergeEditor(text, n) {
  openDialog(`<div class="dialog-head"><span class="dialog-icon brand">${ic('git-merge')}</span><div><h2 id="dlg-title">Combine both: ${plural(n, 'place', 'places')} to choose</h2>
      <p class="subtle" style="margin:2px 0 0">Between <code>&lt;&lt;&lt;&lt;&lt;&lt;&lt; this exam</code> and <code>=======</code> is this exam's text, then the bank's until <code>&gt;&gt;&gt;&gt;&gt;&gt;&gt; the bank</code>. Keep what you want and remove the marks.</p></div></div>
    <div class="dialog-body"><div class="sl-host" id="bmerge-host" style="height:min(55vh,460px)"></div><div id="bmerge-msg"></div></div>
    <div class="dialog-foot"><button class="btn" data-act="copy-merge-cancel">Cancel</button><button class="btn btn-primary" data-act="copy-merge-save">${ic('floppy-disk')} Save the combined question</button></div>`);
  const d = $('#layer .dialog'); if (d) d.classList.add('dialog-wide');
  S.bmerge = { ed: latexEditor('bmerge-host', { onSave: () => copyOp('merge', S.bmerge.ed.getValue()) }) };
  S.bmerge.ed.setValue(text, -1);
}
function mergeCancel() { if (S.bmerge) { S.bmerge.ed.destroy(); S.bmerge = null; } closeDialog(); S.bcmp = null; }

/* Macros defined differently in the exam and the bank: the receiving side kept its own. */
function showClashes(list, kept) {
  openDialog(`<div class="dialog-head"><span class="dialog-icon brand">${ic('warning-triangle')}</span><div><h2 id="dlg-title">${plural(list.length, 'macro is', 'macros are')} defined differently</h2></div></div>
    <div class="dialog-body"><p>${kept === 'exam' ? 'The exam keeps its own definition; the bank\'s was not added.' : 'The bank keeps its own definition; the exam\'s was not added.'} Check that the questions still read as meant.</p>
      ${list.map((c) => `<div class="b-clash"><b class="mono">${esc(c.macro)}</b><div>exam: <code>${esc(c.exam)}</code></div><div>bank: <code>${esc(c.bank)}</code></div></div>`).join('')}</div>
    <div class="dialog-foot"><button class="btn btn-primary" data-act="dialog-ok">OK</button></div>`);
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
  'copies-open': () => openCopies(),
  'bpb-add': () => { const bp = S.bp; if (!bp) return; bp.blue.push({ count: 1, difficulty: '', group: bp.group || '', tag: '' }); bp.chosen = null; bp.chosenInfo = null; renderPicker(); },
  'bpb-remove': (el) => { const bp = S.bp; if (!bp) return; bp.blue.splice(+el.dataset.i, 1); bp.chosen = null; bp.chosenInfo = null; renderPicker(); },
  'bank-zip-import': () => bankZipImport(),
  'bank-zip-go': () => bankZipGo(),
  'bsearch-open': (el) => { S.bankPick = { bank: el.dataset.bank, item: el.dataset.item }; navigate(`/bank/${enc(el.dataset.bank)}`); },
  'copy-compare': (el) => openCompare(el.dataset.item),
  'copy-op': (el) => copyOp(el.dataset.op),
  'copy-save-new': (el) => { closeDialog(); S.bcmp = null; openSaveDialog({ items: [el.dataset.item], linked: 'new' }); },
  'copy-merge-save': () => { if (S.bmerge) copyOp('merge', S.bmerge.ed.getValue()); },
  'copy-merge-cancel': () => mergeCancel(),
  'follow-add': (el) => followAdd(el.dataset.section),
  'follow-dismiss': (el) => followDismiss(el.dataset.section),
};
