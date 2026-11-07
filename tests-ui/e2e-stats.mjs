#!/usr/bin/env node
/*
 * End-to-end test of blueprints and question statistics (server/ui_stats.py,
 * the blueprint part of ui_bankapi.py, static/ui/stats.js; doc/question-bank-plan.md,
 * P3): a bank of five questions; an exam whose section is filled by a blueprint
 * in "From a bank" (rows by difficulty, picked once and shown, then added, the
 * blueprint kept for the section); 12 copies printed and scanned with chosen
 * answers (copies 7-12 strong, 1-6 weak; q3's key looks wrong); marked; then
 * in the Mark step, how each question did (share right, separation, the
 * answers chosen by name, notes in words), and in the bank, each question's
 * figures across exams.
 *
 *   node tests-ui/e2e-stats.mjs http://127.0.0.1:8095 [screenshots-dir]
 *
 * AMC_E2E_USER / AMC_E2E_PASS: sign in first (shared-machine mode).
 * Use a test copy of the app, never your real exams or banks.
 */
import { startBrowser } from './cdp.mjs';
import { appContainer, makeScans } from './fixtures.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:8095';
const USER = process.env.AMC_E2E_USER || '';
const BANK = 'E2E stats bank';
const EXAM = 'Stats test';
const COPIES = 12;
const b = await startBrowser({ base: BASE, user: USER, pass: process.env.AMC_E2E_PASS || '', shots: process.argv[3] || null, qtab: 'form' });
const J = JSON.stringify;
const post = (url, body) => b.js(`fetch(${J(url)}, {method: 'POST', headers: {...headers(), 'Content-Type': 'application/json'}, body: ${J(J(body))}}).then(r => r.json())`);
const get = (url) => b.js(`getJSON(${J(url)})`);
const bankApi = (what = '') => `/ui/api/bank/${encodeURIComponent(BANK)}${what ? '/' + what : ''}`;
const ITEM = (id, text) => `\\begin{question}{${id}}\n  ${text}\n  \\begin{choices}\n    \\correctchoice{Right}\n    \\wrongchoice{Wrong A}\n    \\wrongchoice{Wrong B}\n    \\wrongchoice{Wrong C}\n  \\end{choices}\n\\end{question}\n`;
const choose = (sel, value) => b.js(`(() => { const t = document.querySelector(${J(sel)}); t.value = ${J(value)}; t.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);
const dismissServerDialog = async () => { if (await b.js(`!!document.querySelector('.server-dialog')`)) await b.js('warn_ok(); true'); };

async function cleanup() {
  const r = await post('/ui/api/banks', { op: 'delete', name: BANK }).catch(() => ({}));
  if (r && r.ok) {
    const t = await get('/ui/api/trash');
    for (const x of t.items.filter((y) => y.name === BANK)) await post('/ui/api/trash/delete', { id: x.id });
  }
}

async function main() {
  await b.signIn();
  await b.goto('/banks');
  await b.waitFor(`S.route.kind === 'banks' && Array.isArray(S.banks)`, 15000);
  await b.preflight({ exams: [EXAM] });
  if ((await get('/ui/api/banks')).banks.some((x) => x.name === BANK)) {
    if (process.env.AMC_E2E_FORCE !== '1') { console.log('NOT RUN: the test bank already exists.'); await b.finish(new Error('pre-flight')); }
    await cleanup();
  }

  // ---- a bank: two easy, two medium, one hard
  await post('/ui/api/banks', { op: 'create', name: BANK });
  await post(bankApi('groups'), { op: 'add', title: 'Algebra' });
  for (const [id, diff] of [['q1', 'easy'], ['q2', 'easy'], ['q3', 'medium'], ['q4', 'medium'], ['q5', 'hard']]) {
    await post(bankApi('items'), { op: 'add', kind: 'single', group: 'Algebra' });
    await post(bankApi('source'), { file: `items/${id}/item.tex`, text: ITEM(id, `Question ${id}`), based_on: '' });
    await post(bankApi('items'), { op: 'describe', item: id, difficulty: diff });
  }

  // ---- an exam filled by a blueprint
  b.created.add(EXAM);
  await b.goto('/exams');
  await b.waitFor(`typeof S !== 'undefined' && S.online === true && Array.isArray(S.projects)`, 15000);
  await b.js(`S.qtab = 'form'; store.set('qtab', 'form'); S.creating = ${J(EXAM)}; socket_emit('ui-create-exam', {name: ${J(EXAM)}, gid: 'school', id: 'blank', style: 'paper'}); true`);
  await b.waitFor(`S.project === ${J(EXAM)} && S.qdata && S.qdata.modular && !!document.querySelector('[data-act="bank-pick"]')`, 60000);
  for (const f of await b.js(`S.qdata.files.filter((f) => f.item).map((f) => f.item)`)) await post('/ui/api/items', { op: 'delete', item: f });
  await b.js('loadEditor(); true');
  await b.waitFor(`S.qdata && !S.qdata.files.some((f) => f.item)`, 10000);
  await b.click('[data-act="bank-pick"]');
  await b.waitFor(`S.bp && S.bp.data && S.bp.data.bank && !!document.querySelector('#bp-bank')`, 10000);
  await choose('#bp-bank', BANK);
  await b.waitFor(`S.bp.bank === ${J(BANK)} && S.bp.data && S.bp.data.bank && S.bp.data.bank.name === ${J(BANK)}`, 10000);
  await b.js(`(() => { const r = document.querySelector('input[name="bp-mode"][value="blueprint"]'); r.checked = true; r.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);
  b.check('"From a bank" offers a blueprint', await b.waitFor(`S.bp.mode === 'blueprint' && !!document.querySelector('.bp-blue-row')`, 5000));
  await b.js(`S.bp.blue = [{count: 2, difficulty: 'easy', group: 'Algebra', tag: ''}, {count: 2, difficulty: 'medium', group: '', tag: ''}, {count: 2, difficulty: 'hard', group: '', tag: ''}]; renderPicker(); true`);
  await b.click('[data-act="bp-pick"]');
  b.check('Its pick is shown first, with the rows short of questions', await b.waitFor(`S.bp.chosen && S.bp.chosen.length === 5 && document.querySelector('#bp-listhost').textContent.includes('2 hard questions: only 1 available')`, 10000),
    await b.js('JSON.stringify(S.bp.short)'));
  await b.shot('t1-blueprint');
  await b.click('[data-act="bp-add"]');
  await b.waitFor(`!document.querySelector('#bp-bank')`, 15000);
  const ed = await get('/ui/api/editor');
  b.check('...then added as shown into the section', ed.files.filter((f) => f.item).map((f) => f.item).sort().join() === 'q1,q2,q3,q4,q5' && ed.files.filter((f) => f.item).every((f) => f.questions[0].group === 'general'), J(ed.files.map((f) => f.item)));
  const copies = await get('/ui/api/bank-copies');
  b.check('...and the blueprint is kept for the section', (((copies.blueprints || {}).general || {}).rows || []).length === 3, J(copies.blueprints));

  // ---- 12 copies printed, scanned with chosen answers, marked
  await b.js(`socket_emit('ncopies', ${COPIES}); true`);
  await b.js(`socket_emit('doc-update', 'sujet'); true`);
  await b.waitFor(`!!document.querySelector('#work')`, 10000);
  b.check('The papers are built', await b.waitFor(`!document.querySelector('#work') && S.status && S.status.layout_pages > 0`, 240000));
  await dismissServerDialog();
  await b.js(`socket_emit('ui-layout-ok'); true`);
  await b.waitFor('S.status && !!S.status.layout_ok', 10000);
  await b.js(`socket_emit('ui-mark-printed'); true`);
  await b.waitFor('S.status && !!S.status.lock', 10000);
  const pick = { q1: {}, q2: {}, q3: {}, q4: {}, q5: {} };
  for (let s = 1; s <= COPIES; s++) {
    const strong = s > 6;
    Object.assign(pick.q1, { [s]: strong ? 1 : 2 }); Object.assign(pick.q2, { [s]: 1 }); Object.assign(pick.q3, { [s]: strong ? 2 : 1 });
    Object.assign(pick.q4, { [s]: strong ? 1 : 3 }); Object.assign(pick.q5, { [s]: strong ? 1 : 2 });
  }
  const { files } = makeScans({ container: appContainer(BASE), user: USER, exam: EXAM, options: { faint: false, blank: false, omit: false, pick } });
  await b.click('.step[href$="/upload-scans"]');
  await b.waitFor(`!!document.querySelector('#scan-files')`);
  await b.setFiles('#scan-files', files);
  b.check('The scans are read', await b.waitFor(`!document.querySelector('#work') && S.status && S.status.scans === ${files.length}`, 300000), await b.js('S.status && S.status.scans'));
  await dismissServerDialog();
  await b.click('.step[href$="/mark"]');
  await b.waitFor(`!!document.querySelector('.card-foot [data-act="mark"]')`, 15000);
  await b.click('.card-foot [data-act="mark"]');
  b.check('Every copy is marked', await b.waitFor(`S.status && S.status.marked === ${COPIES} && !document.querySelector('#work')`, 240000), await b.js('S.status && S.status.marked'));
  await dismissServerDialog();

  // ---- how each question did
  b.check('The Mark step shows how each question did', await b.waitFor(`!!document.querySelector('#qstats .qs-row') && document.querySelectorAll('#qstats .qs-row').length === 5`, 20000));
  const st = Object.fromEntries((await get('/ui/api/question-stats')).stats.map((s) => [s.title, s]));
  b.check('AMC numbers answers in the source\'s order: the first answer is the right one on every copy', ['q1', 'q2', 'q3', 'q4', 'q5'].every((q) => st[q].answers.find((a) => a.correct).answer === 1), J(st.q1 && st.q1.answers));
  b.check('Share right and separation: q1 50% and 1.00, q2 100%, q3 below 0', st.q1.right === 0.5 && st.q1.separation === 1 && st.q2.right === 1 && st.q3.separation === -1,
    J(Object.values(st).map((s) => [s.title, s.right, s.separation])));
  b.check('The answers are named from the question, with notes in words', st.q3.notes.some((x) => x.includes('check the answer key')) && st.q3.notes.some((x) => x.includes('“Wrong A” attracts strong students'))
    && st.q3.notes.some((x) => x.includes('Nobody chose “Wrong B”')) && st.q2.notes.some((x) => x.includes('Very easy')), J(st.q3.notes));
  const row = `[...document.querySelectorAll('#qstats .qs-row')].find((r) => r.querySelector('.qs-title').textContent === 'q3')`;
  const examOrder = (await get('/ui/api/editor')).files.flatMap((f) => f.questions.map((q) => q.id)).join();
  const shownOrder = await b.js(`[...document.querySelectorAll('#qstats .qs-title')].map((x) => x.textContent).join()`);
  b.check('...shown in the Mark step in the exam\'s order', shownOrder === examOrder, `${shownOrder} / ${examOrder}`);
  await b.js(`${row}.open = true; true`);
  b.check('...a question to look at flagged, opening on all its answers', await b.js(`${row}.classList.contains('is-flagged') && ${row}.querySelectorAll('.qs-ans').length === 4 && ${row}.textContent.includes('Wrong C')`)
    && !(await b.js(`[...document.querySelectorAll('#qstats .qs-row')].find((r) => r.querySelector('.qs-title').textContent === 'q4').classList.contains('is-flagged')`)));
  await b.js(`document.querySelector('#qstats').scrollIntoView(); true`);
  await b.shot('t2-stats');

  // ---- in the bank
  const u = await get(`${bankApi('usage')}?item=q1`);
  b.check('The bank keeps each question\'s figures by exam, with a summary', u.stats.length === 1 && u.stats[0].exam === EXAM && u.summary.q1 && u.summary.q1.n === COPIES && u.summary.q1.right === 0.5 && u.printed.length === 1, J(u));
  await b.goto(`/bank/${encodeURIComponent(BANK)}`);
  await b.waitFor(`S.qdata && S.qdata.bank && document.querySelectorAll('#q-list .q-item').length === 5`, 15000);
  await b.click('[data-act="q-pick"][data-id="q1"]');
  b.check('...shown on the bank\'s question', await b.waitFor(`!!document.querySelector('.b-usage') && document.querySelector('.b-usage').textContent.includes('50% right over 12 copies in 1 exam, separates 1.00')`, 10000),
    await b.js(`(document.querySelector('.b-usage') || {}).textContent`));
  await b.shot('t3-bank-stats');

  await b.goto(`/exam/${encodeURIComponent(EXAM)}/mark`);
  await b.waitFor('!S.scaleUpdating', 60000);
  b.check('The exam is deleted', await b.deleteExam(EXAM));
  await cleanup();
  b.check('The test bank is removed', !(await get('/ui/api/banks')).banks.some((x) => x.name === BANK));
}

main().then(() => b.finish(), async (e) => { await cleanup().catch(() => {}); b.finish(e); });
