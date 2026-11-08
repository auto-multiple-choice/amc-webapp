#!/usr/bin/env node
/*
 * End-to-end test of the editor extras (doc/features.md, Writing
 * questions): Duplicate a question (a new name,
 * right after it, one version); drag and drop of questions in the list, of
 * sections in Paper design and of a bank's question into another group; the
 * selected question's page in the preview; "copies differ" in Papers when a
 * section draws at random; the scoring dialog offering the preamble's scoring
 * macros; an exam saved as a template, a new exam made from it in the wizard,
 * and the template deleted.
 *
 *   node tests-ui/e2e-editor-extras.mjs http://127.0.0.1:8095 [screenshots-dir]
 *
 * AMC_E2E_USER / AMC_E2E_PASS: sign in first (shared-machine mode).
 * Use a test copy of the app, never your real exams.
 */
import { startBrowser } from './cdp.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:8095';
const EXAM = 'Editor extras test';
const FROM = 'Editor extras from template';
const TEMPLATE = 'E2E template';
const BANK = 'E2E drag bank';
const b = await startBrowser({ base: BASE, user: process.env.AMC_E2E_USER || '', pass: process.env.AMC_E2E_PASS || '', shots: process.argv[3] || null, qtab: 'form' });
const J = JSON.stringify;
const post = (url, body) => b.js(`fetch(${J(url)}, {method: 'POST', headers: {...headers(), 'Content-Type': 'application/json'}, body: ${J(J(body))}}).then(r => r.json())`);
const get = (url) => b.js(`getJSON(${J(url)})`);
const order = () => b.js(`S.qdata.files.filter((f) => f.item).flatMap((f) => f.questions.map((q) => q.id))`);
// a real drag: dragstart on the source, dragover and drop on the target, dragend
const drag = (src, dst) => b.js(`(() => { const s = document.querySelector(${J(src)}); const d = document.querySelector(${J(dst)}); if (!s || !d) return false;
  const dt = new DataTransfer(); s.dispatchEvent(new DragEvent('dragstart', {bubbles: true, dataTransfer: dt}));
  const over = new DragEvent('dragover', {bubbles: true, cancelable: true, dataTransfer: dt}); d.dispatchEvent(over);
  d.dispatchEvent(new DragEvent('drop', {bubbles: true, cancelable: true, dataTransfer: dt})); s.dispatchEvent(new DragEvent('dragend', {bubbles: true, dataTransfer: dt}));
  return over.defaultPrevented; })()`);

async function cleanup() {
  await post('/ui/api/my-templates', { op: 'delete', name: TEMPLATE }).catch(() => {});
  const r = await post('/ui/api/banks', { op: 'delete', name: BANK }).catch(() => ({}));
  if (r && r.ok) { const t = await get('/ui/api/trash'); for (const x of t.items.filter((y) => y.name === BANK)) await post('/ui/api/trash/delete', { id: x.id }); }
}

async function main() {
  await b.signIn();
  await b.goto('/exams');
  await b.waitFor(`typeof S !== 'undefined' && S.online === true && Array.isArray(S.projects)`, 15000);
  await b.preflight({ exams: [EXAM, FROM] });
  b.created.add(EXAM);
  await b.js(`S.qtab = 'form'; store.set('qtab', 'form'); S.creating = ${J(EXAM)}; socket_emit('ui-create-exam', {name: ${J(EXAM)}, gid: 'school', id: 'blank', style: 'paper'}); true`);
  await b.waitFor(`S.project === ${J(EXAM)} && S.qdata && S.qdata.modular && document.querySelectorAll('.q-item').length === 2`, 60000);

  // ---- duplicate
  await b.click('[data-act="q-pick"][data-id="example-single"]');
  await b.waitFor(`S.qform.id === 'example-single' && !!document.querySelector('[data-act="q-duplicate"]')`, 5000);
  await b.click('[data-act="q-duplicate"]');
  b.check('Duplicate: a copy with a new name, right after it, opened', await b.waitFor(`S.qform && S.qform.id === 'example-single-2'`, 10000)
    && J(await order()) === J(['example-single', 'example-single-2', 'example-multiple']), J(await order()));
  const copy = await get('/ui/api/source?file=' + encodeURIComponent('items/example-single-2/item.tex'));
  const orig = await get('/ui/api/source?file=' + encodeURIComponent('items/example-single/item.tex'));
  b.check('...the same question under its own name', copy.text.replace('example-single-2', 'example-single') === orig.text, copy.text.slice(0, 80));
  const h = await get('/ui/api/history');
  b.check('...as one version', /duplicated as example-single-2/.test(h.versions[0].what), h.versions[0].what);

  // ---- drag and drop in the list
  b.check('Dragging a question onto another', await drag('.q-item[data-id="example-multiple"]', '.q-item[data-id="example-single"]'));
  b.check('...puts it before that one', await b.waitFor(`JSON.stringify(S.qdata.files.filter((f) => f.item).flatMap((f) => f.questions.map((q) => q.id))) === ${J(J(['example-multiple', 'example-single', 'example-single-2']))}`, 10000), J(await order()));

  // ---- the scoring dialog offers the preamble's scoring macros
  const mainName = await b.js('S.status.source');
  const main = await get('/ui/api/source?file=' + encodeURIComponent(mainName));
  await post('/ui/api/source', { file: mainName, text: main.text.replace('\\begin{document}', '\\def\\exactS{b=3,m=-1}\n\\begin{document}'), based_on: main.digest });
  await b.js('loadEditor(); true');
  await b.waitFor(`S.qdata && (S.qdata.scoring_macros || []).some((m) => m.name === '\\\\exactS')`, 10000);
  await b.click('[data-act="q-pick"][data-id="example-single"]');
  await b.waitFor(`S.qform.id === 'example-single'`, 5000);
  await b.click('[data-act="qf-scoring"]');
  const macroRadio = `[...document.querySelectorAll('input[name="choice"]')].find((i) => i.value === 'preset:\\\\exactS')`;
  b.check('The scoring dialog offers the scoring macros of the exam\'s preamble', await b.waitFor(`!!${macroRadio} && document.querySelector('.dialog').textContent.includes('b=3,m=-1')`, 5000));
  await b.shot('e1-scoring');
  await b.js(`${macroRadio}.click(); true`);
  await b.click('#dlg-form [type="submit"]');
  b.check('...and uses one by name', await b.waitFor(`!S.qform.saving && qsel() && qsel().rule === '\\\\exactS'`, 10000), await b.js('qsel() && qsel().rule'));

  // ---- the selected question in the question paper
  for (let i = 0; i < 10; i++) await post('/ui/api/items', { op: 'duplicate', item: 'example-multiple' }); // enough to reach a second page
  await b.js('loadEditor(); true');
  await b.waitFor(`S.qdata && S.qdata.files.filter((f) => f.item).length === 13`, 10000);
  await b.js(`socket_emit('doc-update', 'sujet'); true`);
  await b.waitFor(`!!document.querySelector('#work')`, 10000);
  b.check('The paper builds', await b.waitFor(`!document.querySelector('#work') && S.status && S.status.docs.sujet && S.status.layout_pages > 0`, 240000));
  if (await b.js(`!!document.querySelector('.server-dialog')`)) await b.js('warn_ok(); true');
  const last = await b.js(`S.qdata.files.filter((f) => f.item).map((f) => f.questions[0].id).pop()`);
  const page = (await get(`/ui/api/question-page?id=${encodeURIComponent(last)}`)).page;
  b.check('The question paper\'s page of a question is known', page >= 2, J(page));
  await b.js(`selectQuestion('items/${last}/item.tex', ${J(last)}); true`);
  await b.waitFor(`S.qform.id === ${J(last)} && !!document.querySelector('[data-act="q-show-page"]')`, 5000);
  await b.click('[data-act="q-show-page"]');
  b.check('"In the paper" opens the question paper at that page', await b.waitFor(`S.previewPage === ${page} && !!document.querySelector('.pdf-frame') && document.querySelector('.pdf-frame').src.includes('#page=${page}&')`, 10000),
    await b.js(`(document.querySelector('.pdf-frame') || {}).src`));
  // the section shuffles its questions: one whose page (on the first copy) is another
  const ids = await b.js(`S.qdata.files.filter((f) => f.item).map((f) => f.questions[0].id)`);
  let other = null;
  for (const id of ids) { const p = (await get(`/ui/api/question-page?id=${encodeURIComponent(id)}`)).page; if (p && p !== page) { other = { id, page: p }; break; } }
  b.check('Another question is on another page', !!other, J(ids));
  await b.click(`[data-act="q-pick"][data-id="${other.id}"]`);
  b.check('...and the preview follows the question picked', await b.waitFor(`S.previewPage === ${other.page} && document.querySelector('.pdf-frame').src.includes('#page=${other.page}&')`, 10000),
    await b.js(`JSON.stringify({page: S.previewPage, src: (document.querySelector('.pdf-frame') || {}).src})`));
  await b.shot('e4-in-paper');

  // ---- copies differ, and sections dragged
  let st = await get('/ui/api/structure');
  let r = await post('/ui/api/structure', { based_on: st.digest, ops: [{ op: 'section_set', name: 'general', count: 5 }, { op: 'section_add', name: 'part2', heading: 'Part two' }] });
  b.check('A section drawing 5 of its questions, and a second section', r.ok === true, J(r.error));
  await b.click('.step[href$="/papers"]');
  b.check('Papers says the copies differ', await b.waitFor(`document.querySelector('#main').textContent.includes('The copies differ') && document.querySelector('#main').textContent.includes('5 of 13 questions')`, 15000));
  await b.shot('e2-copies-differ');
  await b.click('.step[href$="/questions"]');
  await b.click('[data-act="qtab"][data-v="design"]');
  await b.waitFor(`S.design && document.querySelectorAll('.d-sec[data-drag="sec"]').length === 2`, 15000);
  b.check('Dragging a section onto another', await drag('.d-sec[data-name="part2"]', '.d-sec[data-name="general"]'));
  b.check('...puts it before that one', await b.waitFor(`S.design && JSON.stringify(S.design.sections.map((s) => s.name)) === '["part2","general"]'`, 10000),
    J((await get('/ui/api/structure')).sections.map((s) => s.name)));

  // ---- a bank's question dragged into another group
  await post('/ui/api/banks', { op: 'create', name: BANK });
  await post(`/ui/api/bank/${encodeURIComponent(BANK)}/groups`, { op: 'add', title: 'First' });
  await post(`/ui/api/bank/${encodeURIComponent(BANK)}/groups`, { op: 'add', title: 'Second' });
  await post(`/ui/api/bank/${encodeURIComponent(BANK)}/items`, { op: 'add', kind: 'single', group: 'First' });
  await b.goto(`/bank/${encodeURIComponent(BANK)}`);
  await b.waitFor(`S.qdata && S.qdata.bank && document.querySelectorAll('#q-list .q-item').length === 1`, 15000);
  b.check('Dragging a bank\'s question onto another group', await drag('#q-list .q-item', '[data-dropgroup="Second"]'));
  b.check('...moves it there', await b.waitFor(`S.qdata.bank.groups.find((g) => g.name === 'Second').items.length === 1`, 10000));

  // ---- the exam as a template
  await b.goto(`/exam/${encodeURIComponent(EXAM)}/settings`);
  await b.waitFor(`!!document.querySelector('[data-act="template-save"]')`, 15000);
  await b.click('[data-act="template-save"]');
  await b.waitFor(`!!document.querySelector('#dlg-form input[name="name"]')`, 3000);
  await b.setValue('#dlg-form input[name="name"]', TEMPLATE);
  await b.click('#dlg-form [type="submit"]');
  await b.waitFor(`getJSON('/ui/api/gallery').then((g) => g.templates.some((t) => t.gid === 'mine' && t.id === ${J(TEMPLATE)}))`, 20000);
  const g = await get('/ui/api/gallery');
  const mine = g.templates.find((t) => t.gid === 'mine' && t.id === TEMPLATE);
  b.check('Saved as a template: "My templates" in the gallery, with a preview of its paper', g.groups.some((x) => x.id === 'mine') && !!mine && mine.preview, J(mine));
  await b.goto('/new');
  await b.waitFor(`!!document.querySelector('#wiz-name')`);
  await b.setValue('#wiz-name', FROM);
  await b.click('[data-act="wiz-next"]');
  await b.waitFor(`!!S.gallery && !!document.querySelector('[data-act="wiz-group"][data-v="mine"]')`, 10000);
  await b.click('[data-act="wiz-group"][data-v="mine"]');
  await b.click(`[data-act="wiz-pick"][data-gid="mine"][data-id="${TEMPLATE}"]`);
  b.check('...it is offered in the wizard, with a way to delete it', await b.waitFor(`!!document.querySelector('[data-act="template-delete"]')`, 5000));
  await b.shot('e3-my-template');
  await b.click('[data-act="wiz-next"]');
  b.created.add(FROM);
  await b.waitFor(`!!document.querySelector('[data-act="wiz-create"]')`, 5000);
  await b.click('[data-act="wiz-create"]');
  b.check('A new exam from the template', await b.waitFor(`S.project === ${J(FROM)}`, 60000));
  const fromSt = await get('/ui/api/structure');
  b.check('...with the same sections and questions, and no scans or history of the first', J(fromSt.sections.map((s) => [s.name, s.pool])) === J([['part2', 0], ['general', 13]])
    && (await get('/ui/api/history')).versions.length === 1, J(fromSt.sections.map((s) => [s.name, s.pool])));
  r = await post('/ui/api/my-templates', { op: 'delete', name: TEMPLATE });
  b.check('The template is deleted', r.ok && !(await get('/ui/api/gallery')).templates.some((t) => t.gid === 'mine'));

  await b.waitFor('!S.scaleUpdating', 60000);
  for (const n of [EXAM, FROM]) b.check(`"${n}" is deleted`, await b.deleteExam(n));
  await cleanup();
}

main().then(() => b.finish(), async (e) => { await cleanup().catch(() => {}); b.finish(e); });
