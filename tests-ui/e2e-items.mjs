#!/usr/bin/env node
/*
 * End-to-end test of questions kept in items (server/ui_items.py): a new
 * exam from the app's starter keeps each question in items/<name>/item.tex
 * listed in pools.tex; the form edits, adds, moves and deletes items; the
 * sections count items; the paper builds; an exam made from one of AMC's
 * templates is split into items and the split can be undone from History;
 * a printed exam refuses item changes.
 *
 *   node tests-ui/e2e-items.mjs http://127.0.0.1:8095 [screenshots-dir]
 *
 * AMC_E2E_USER / AMC_E2E_PASS: sign in first (shared-machine mode).
 * Use a test copy of the app, never your real exams.
 */
import { startBrowser } from './cdp.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:8095';
const EXAM = 'Items test';
const SEXAM = 'Items split test';
const b = await startBrowser({ base: BASE, user: process.env.AMC_E2E_USER || '', pass: process.env.AMC_E2E_PASS || '', shots: process.argv[3] || null, qtab: 'form' });
const J = JSON.stringify;

const editorData = () => b.js(`getJSON('/ui/api/editor')`);
const file = (name) => b.js(`getJSON('/ui/api/source?file=' + encodeURIComponent(${J(name)})).then(r => r.text ?? null).catch(() => null)`); // gone: null
const history = () => b.js(`getJSON('/ui/api/history')`);
const structure = () => b.js(`getJSON('/ui/api/structure')`);
const order = (d) => d.files.filter((f) => f.item).flatMap((f) => f.questions.map((q) => `${q.group}:${q.id}`));
const settle = (cond) => b.waitFor(`S.qform && !S.qform.saving && !S.qform.pending.length && (${cond})`, 15000);

async function main() {
  await b.signIn();
  await b.goto('/');
  b.check('The app opens', await b.waitFor('S.online === true'));
  await b.preflight({ exams: [EXAM, SEXAM] });

  // ---- a new exam from the app's starter keeps its questions in items
  b.created.add(EXAM);
  await b.js(`S.qtab = 'form'; store.set('qtab', 'form'); S.creating = ${J(EXAM)}; socket_emit('ui-create-exam', {name: ${J(EXAM)}, gid: 'school', id: 'blank', style: 'paper'}); true`);
  b.check('A new exam from the blank starter opens on the form', await b.waitFor(`S.project === ${J(EXAM)} && S.qdata && S.qdata.files && S.qdata.files.some(f => f.item)`, 60000));
  let d = await editorData();
  b.check('Its questions are items, listed by pools.tex, in one section', d.modular && order(d).join(',') === 'general:example-single,general:example-multiple', J(order(d)));
  const main = d.main;
  b.check('The main file inputs pools.tex and holds no question', (await file(main)).includes('\\input{pools}') && !(await file(main)).includes('\\begin{question}'));
  b.check('pools.tex names each item, with the \\amcuiItem macro', (await file('pools.tex')).includes('\\element{general}{\\amcuiItem{example-single}}') && (await file('pools.tex')).includes('\\providecommand{\\amcuiItem}'));
  b.check('Each item has its own file', (await file('items/example-single/item.tex')).startsWith('\\begin{question}{example-single}'));
  let h = await history();
  b.check('The first version holds the items', h.versions.length === 1 && h.versions[0].kind === 'create' && h.versions[0].files.some((f) => f.file === 'items/example-single/item.tex'), J(h.versions[0]));
  b.check('The list shows one section header and no file headers for items', await b.waitFor(`document.querySelectorAll('#q-list .q-group').length === 1 && !document.querySelector('#q-list .q-file')`, 10000));
  b.check('The form says which item a question is', await b.waitFor(`!!document.querySelector('.q-form-head .chip') && document.querySelector('.q-form-head .chip').textContent.includes('example-single')`, 10000));
  await b.shot('i1-items');

  // ---- editing a question writes its item file
  await b.click('[data-act="q-pick"][data-id="example-multiple"]');
  await b.waitFor(`S.qform.id === 'example-multiple' && !!document.querySelector('#qf-text')`, 5000);
  await b.setValue('#qf-text', 'Which numbers are even?');
  b.check('Typing in the form saves the item file', await settle(`qsel() && qsel().latex === 'Which numbers are even?'`) && (await file('items/example-multiple/item.tex')).includes('Which numbers are even?'));
  h = await history();
  b.check('...as a version that changed only that file', h.versions[0].files.map((f) => f.file).join(',') === 'items/example-multiple/item.tex', J(h.versions[0]));

  // ---- adding, moving and deleting items
  await b.click('[data-act="q-pick"][data-id="example-single"]');
  await b.waitFor(`S.qform.id === 'example-single'`, 5000);
  await b.click('[data-act="q-add"]');
  await b.waitFor(`!!document.querySelector('.dialog [data-v="numeric"]')`, 3000);
  await b.click('.dialog [data-v="numeric"]');
  b.check('Adding makes a new item after the selected one', await b.waitFor(`S.qdata && S.qdata.files.filter(f => f.item).length === 3 && S.qform && /^nq/.test(S.qform.id)`, 15000));
  d = await editorData();
  const nq = d.files.find((f) => f.item && f.questions[0].kind === 'numeric');
  b.check('...in pools.tex right after it, and in History as one version', order(d).join(',') === `general:example-single,general:${nq.questions[0].id},general:example-multiple`
    && (await file('pools.tex')).includes(`\\amcuiItem{${nq.item}}`) && (h = await history()).versions[0].files.length === 3, J([order(d), h.versions[0]]));
  await b.click('[data-act="q-move"][data-d="1"]');
  b.check('Moving an item down changes the order in pools.tex', await b.waitFor(`S.qdata && JSON.stringify(S.qdata.files.filter(f => f.item).map(f => f.item)) === ${J(J(['example-single', 'example-multiple', nq.item]))}`, 10000));
  await b.click('[data-act="q-move"][data-d="-1"]');
  await b.waitFor(`S.qdata && S.qdata.files.filter(f => f.item).map(f => f.item)[1] === ${J(nq.item)}`, 10000);
  await b.click('[data-act="q-delete"]');
  await b.waitFor(`!!document.querySelector('.dialog [data-act="dialog-ok"]')`, 3000);
  await b.click('.dialog [data-act="dialog-ok"]');
  b.check('Deleting removes the item and its folder', await b.waitFor(`S.qdata && S.qdata.files.filter(f => f.item).length === 2`, 10000)
    && !(await file('pools.tex')).includes(nq.item) && (await file(`items/${nq.item}/item.tex`)) === null);
  b.check('...and History can bring it back', (h = await history()).versions[0].kind === 'delete' && h.files.some((f) => f.file === `items/${nq.item}/item.tex` && !f.exists));

  // ---- sections count items; a question added from Paper design is an item
  let st = await structure();
  b.check('Paper design sees the exam keeps its questions in items, and counts them', st.modular && st.sections.length === 1 && st.sections[0].pool === 2, J(st.sections));
  const add = await b.js(`fetch('/ui/api/items', {method: 'POST', headers: {...headers(), 'Content-Type': 'application/json'}, body: JSON.stringify({op: 'add', kind: 'single', group: 'general'})}).then(r => r.json())`);
  b.check('Adding to a section adds an item at its end', add.ok && order(add).length === 3 && order(add)[2] === `general:${add.added.id}`, J(add));
  st = await structure();
  b.check('...and the section counts it', st.sections[0].pool === 3);
  const ids = await b.js(`fetch('/ui/api/editor', {method: 'POST', headers: {...headers(), 'Content-Type': 'application/json'}, body: JSON.stringify({file: ${J(add.added.file)}, based_on: '', ops: [{op: 'rename', id: ${J(add.added.id)}, new_id: 'example-single'}]})}).then(r => r.json())`);
  b.check('A question can\'t take a name another item uses', !ids.ok && /already named/.test(ids.error || ''), J(ids));

  // ---- the paper builds from items
  await b.js(`socket_emit('doc-update', 'sujet'); true`);
  await b.waitFor(`!!document.querySelector('#work')`, 10000);
  b.check('The paper builds from the items', await b.waitFor(`!document.querySelector('#work') && S.status && S.status.docs.sujet`, 240000));
  if (await b.js(`!!document.querySelector('.server-dialog')`)) await b.js('warn_ok(); true');
  await b.js(`socket_emit('ui-scale-refresh'); true`); // as the Marking scheme step does: AMC reads the scoring
  await b.waitFor(`getJSON('/ui/api/questions').then(r => (r.questions || []).length >= 3)`, 120000);
  const scale = await b.js(`getJSON('/ui/api/questions')`);
  b.check('AMC found every item\'s question, and the marking scheme panel reads each one from its item file',
    ['example-single', 'example-multiple', add.added.id].every((id) => (scale.questions || []).some((q) => q.title === id && !q.problem)), J((scale.questions || []).map((q) => [q.title, q.problem])));

  // ---- a printed exam refuses item changes
  await b.js(`socket_emit('ui-layout-ok'); true`);
  await b.waitFor('S.status && !!S.status.layout_ok', 10000);
  await b.js(`socket_emit('ui-mark-printed'); true`);
  await b.waitFor('S.status && !!S.status.lock', 10000);
  const locked = await b.js(`fetch('/ui/api/items', {method: 'POST', headers: {...headers(), 'Content-Type': 'application/json'}, body: JSON.stringify({op: 'add', kind: 'single', group: 'general'})}).then(r => r.json())`);
  b.check('After printing, items can\'t be added', !locked.ok && locked.locked === true, J(locked));
  const key = await b.js(`fetch('/ui/api/editor', {method: 'POST', headers: {...headers(), 'Content-Type': 'application/json'}, body: JSON.stringify({file: 'items/example-single/item.tex', based_on: '', ops: [{op: 'answer_correct', id: 'example-single', i: 1, correct: true}, {op: 'answer_correct', id: 'example-single', i: 0, correct: false}]})}).then(r => r.json())`);
  b.check('...but an item\'s answer key can still be corrected', key.ok === true, J(key));
  await b.waitFor('!S.scaleUpdating', 60000);
  b.check('The exam is deleted', await b.deleteExam(EXAM));

  // ---- an exam from one of AMC's templates is split into items, and the split undone
  await b.goto('/exams');
  await b.waitFor(`typeof S !== 'undefined' && S.online === true && Array.isArray(S.projects)`, 15000);
  b.check('An exam is made from one of AMC\'s templates', await b.createFromTemplate(SEXAM, 'en/groups'));
  await b.goto(`/exam/${encodeURIComponent(SEXAM)}/questions`);
  b.check('Its questions are in its main file, and the form offers to move them into items', await b.waitFor(`S.qdata && S.qdata.can_split && !S.qdata.modular && !!document.querySelector('[data-act="q-split"]')`, 20000));
  const before = await editorData();
  const beforeQs = before.files.flatMap((f) => f.questions.map((q) => `${q.group}:${q.id}`)).sort();
  const sections0 = (await structure()).sections.map((s) => [s.name, s.pool]);
  await b.click('[data-act="q-split"]');
  await b.waitFor(`!!document.querySelector('.dialog [data-act="dialog-ok"]')`, 3000);
  await b.shot('i2-split');
  await b.click('.dialog [data-act="dialog-ok"]');
  b.check('Splitting moves the questions into items', await b.waitFor(`S.qdata && S.qdata.modular && !S.qdata.can_split && S.qdata.files.some(f => f.item)`, 20000));
  d = await editorData();
  b.check('...every question in the same section as before', J(d.files.flatMap((f) => f.questions.map((q) => `${q.group}:${q.id}`)).sort()) === J(beforeQs), J([beforeQs, d.files.map((f) => f.file)]));
  b.check('...and the sections draw from as many elements', J((await structure()).sections.map((s) => [s.name, s.pool])) === J(sections0));
  h = await history();
  b.check('The split is one version', h.versions[0].what.startsWith('Questions moved into') && h.versions[0].files.some((f) => f.file === 'pools.tex'), J(h.versions[0]));
  await b.js(`socket_emit('doc-update', 'sujet'); true`);
  await b.waitFor(`!!document.querySelector('#work')`, 10000);
  b.check('The split exam builds', await b.waitFor(`!document.querySelector('#work') && S.status && S.status.docs.sujet`, 240000));
  if (await b.js(`!!document.querySelector('.server-dialog')`)) await b.js('warn_ok(); true');
  const plan = await b.js(`getJSON('/ui/api/history/' + ${J(h.versions[0].id)} + '/plan?mode=undo')`);
  const undone = await b.js(`fetch('/ui/api/history/restore', {method: 'POST', headers: {...headers(), 'Content-Type': 'application/json'}, body: JSON.stringify({mode: 'undo', id: ${J(h.versions[0].id)}, head: ${J(plan.head)}})}).then(r => r.json())`);
  b.check('Undoing the split in History puts the questions back in the main file', undone.ok && !plan.problem, J([plan.problem, undone]));
  d = await editorData();
  b.check('...as they were', !d.modular && d.can_split && J(d.files.flatMap((f) => f.questions.map((q) => `${q.group}:${q.id}`)).sort()) === J(beforeQs), J(d.files.map((f) => f.file)));
  await b.waitFor('!S.scaleUpdating', 60000);
  b.check('The exam is deleted', await b.deleteExam(SEXAM));
}

main().then(() => b.finish(), (e) => b.finish(e));
