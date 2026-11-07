#!/usr/bin/env node
/*
 * End-to-end test of finding questions in banks and moving banks
 * (server/ui_bankindex.py, ui_bankzip.py, the search parts of static/ui/banks.js;
 * doc/question-bank-plan.md, sections 7.2, 7.6 to 7.8): the bank page's filters
 * (words as prefixes, difficulty, tag), an item archived (hidden from "From a
 * bank", left out of a whole group); in the picker, filters and "Archived too";
 * usage recorded when the exam is printed, shown on the item and used by "Never
 * printed"; the search of all banks opening the item; a bank downloaded as a zip
 * and imported again as a new bank with its history; a file that isn't a zip refused.
 *
 *   node tests-ui/e2e-search.mjs http://127.0.0.1:8095 [screenshots-dir]
 *
 * AMC_E2E_USER / AMC_E2E_PASS: sign in first (shared-machine mode).
 * Use a test copy of the app, never your real exams or banks.
 */
import { startBrowser } from './cdp.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:8095';
const BANK = 'E2E search bank';
const COPY = 'E2E search bank copy';
const EXAM = 'Search test';
const b = await startBrowser({ base: BASE, user: process.env.AMC_E2E_USER || '', pass: process.env.AMC_E2E_PASS || '', shots: process.argv[3] || null, qtab: 'form' });
const J = JSON.stringify;
const post = (url, body) => b.js(`fetch(${J(url)}, {method: 'POST', headers: {...headers(), 'Content-Type': 'application/json'}, body: ${J(J(body))}}).then(r => r.json())`);
const get = (url) => b.js(`getJSON(${J(url)})`);
const bankApi = (what = '', name = BANK) => `/ui/api/bank/${encodeURIComponent(name)}${what ? '/' + what : ''}`;
const ITEM = (id, text) => `\\begin{question}{${id}}\n  ${text}\n  \\begin{choices}\n    \\correctchoice{Right}\n    \\wrongchoice{Wrong}\n  \\end{choices}\n\\end{question}\n`;
const listed = () => b.js(`[...document.querySelectorAll('#q-list .q-item')].map((x) => x.dataset.id)`);
const typeInto = (sel, text) => b.js(`(() => { const t = document.querySelector(${J(sel)}); t.focus(); t.value = ${J(text)}; t.dispatchEvent(new Event('input', {bubbles: true})); return true; })()`);
const choose = (sel, value) => b.js(`(() => { const t = document.querySelector(${J(sel)}); t.value = ${J(value)}; t.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);

async function cleanup() {
  for (const n of [BANK, COPY]) {
    const r = await post('/ui/api/banks', { op: 'delete', name: n }).catch(() => ({}));
    if (r && r.ok) {
      const t = await get('/ui/api/trash');
      for (const x of t.items.filter((y) => y.name === n)) await post('/ui/api/trash/delete', { id: x.id });
    }
  }
}

async function main() {
  await b.signIn();
  await b.goto('/banks');
  await b.waitFor(`S.route.kind === 'banks' && Array.isArray(S.banks)`, 15000);
  await b.preflight({ exams: [EXAM] });
  if ((await get('/ui/api/banks')).banks.some((x) => [BANK, COPY].includes(x.name))) {
    if (process.env.AMC_E2E_FORCE !== '1') { console.log('NOT RUN: a test bank already exists.'); await b.finish(new Error('pre-flight')); }
    await cleanup();
  }

  // ---- a bank of five questions in two groups
  await post('/ui/api/banks', { op: 'create', name: BANK });
  await post(bankApi('groups'), { op: 'add', title: 'Algebra' });
  await post(bankApi('groups'), { op: 'add', title: 'Geometry' });
  const qs = [['q1', 'Algebra', 'Solve the quadratic equation', 'easy', 'equations'], ['q2', 'Algebra', 'Sum of an arithmetic progression', 'medium', 'sequences'],
    ['q3', 'Algebra', 'Roots of a quadratic polynomial', 'hard', 'equations, olympiad'], ['q4', 'Geometry', 'Angles of a triangle', 'easy', 'triangles'],
    ['q5', 'Geometry', 'Area of a circle', 'medium', '']];
  for (const [id, g, text, diff, tags] of qs) {
    await post(bankApi('items'), { op: 'add', kind: 'single', group: g });
    await post(bankApi('source'), { file: `items/${id}/item.tex`, text: ITEM(id, text), based_on: '' });
    await post(bankApi('items'), { op: 'describe', item: id, difficulty: diff, tags });
  }
  await b.goto(`/bank/${encodeURIComponent(BANK)}`);
  b.check('The bank page has the filters', await b.waitFor(`!!document.querySelector('#bf-q') && !!document.querySelector('#bf-tag') && document.querySelectorAll('#q-list .q-item').length === 5`, 15000));
  await typeInto('#bf-q', 'quadr');
  b.check('Words are found as prefixes; only the list is redrawn, the search box keeps the focus',
    await b.waitFor(`[...document.querySelectorAll('#q-list .q-item')].map((x) => x.dataset.id).join() === 'q1,q3'`, 5000) && await b.js(`document.activeElement && document.activeElement.id === 'bf-q'`), J(await listed()));
  await choose('#bf-difficulty', 'hard');
  b.check('...with a difficulty', await b.waitFor(`[...document.querySelectorAll('#q-list .q-item')].map((x) => x.dataset.id).join() === 'q3'`, 5000), J(await listed()));
  await typeInto('#bf-q', ''); await choose('#bf-difficulty', ''); await choose('#bf-tag', 'equations');
  b.check('...with a tag', await b.waitFor(`[...document.querySelectorAll('#q-list .q-item')].map((x) => x.dataset.id).join() === 'q1,q3'`, 5000), J(await listed()));
  await b.shot('s1-filters');
  await choose('#bf-tag', '');
  await b.waitFor(`document.querySelectorAll('#q-list .q-item').length === 5`, 5000);

  // ---- archiving
  await b.click('[data-act="q-pick"][data-id="q2"]');
  await b.waitFor(`S.qform.id === 'q2' && !!document.querySelector('[data-bmeta="archived"]')`, 5000);
  await b.js(`(() => { const t = document.querySelector('[data-bmeta="archived"]'); t.checked = true; t.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);
  b.check('An item archived: kept in the bank, shown dimmed', await b.waitFor(`!!document.querySelector('.q-item.is-archived[data-id="q2"]')`, 10000)
    && (await get(bankApi())).files.find((f) => f.item === 'q2').meta.archived === true);

  // ---- in an exam: the picker
  b.created.add(EXAM);
  await b.goto('/exams');
  await b.waitFor(`typeof S !== 'undefined' && S.online === true && Array.isArray(S.projects)`, 15000);
  await b.js(`S.qtab = 'form'; store.set('qtab', 'form'); S.creating = ${J(EXAM)}; socket_emit('ui-create-exam', {name: ${J(EXAM)}, gid: 'school', id: 'blank', style: 'paper'}); true`);
  await b.waitFor(`S.project === ${J(EXAM)} && S.qdata && S.qdata.modular && !!document.querySelector('[data-act="bank-pick"]')`, 60000);
  await b.click('[data-act="bank-pick"]');
  await b.waitFor(`S.bp && S.bp.data && S.bp.data.bank && !!document.querySelector('#bp-bank')`, 10000);
  await choose('#bp-bank', BANK);
  b.check('"From a bank" hides the archived question, and says which were never printed', await b.waitFor(`S.bp.bank === ${J(BANK)} && !!document.querySelector('#bpf-q') && document.querySelectorAll('#bp-listhost .bp-row').length === 2 && document.querySelector('#bp-listhost').textContent.includes('never printed')`, 10000));
  await b.click('#bpf-archived');
  b.check('..."Archived too" shows it', await b.waitFor(`document.querySelectorAll('#bp-listhost .bp-row').length === 3 && document.querySelector('#bp-listhost').textContent.includes('archived')`, 5000));
  await typeInto('#bpf-q', 'roots');
  b.check('...and its search filters the group\'s list', await b.waitFor(`document.querySelectorAll('#bp-listhost .bp-row').length === 1 && document.activeElement.id === 'bpf-q'`, 5000));
  await b.shot('s2-picker');
  await b.js(`document.querySelector('#layer [data-act="dialog-cancel"]').click(); true`);
  let r = await post('/ui/api/bank-pull', { bank: BANK, group: 'Algebra', mode: 'new' });
  b.check('A whole group comes in without its archived question', r.ok && r.added.length === 2 && !r.added.some((f) => f.includes('/q2/')), J(r.error || r.added));

  // ---- printed: usage
  await b.js('loadEditor(); true');
  await b.js(`socket_emit('doc-update', 'sujet'); true`);
  await b.waitFor(`!!document.querySelector('#work')`, 10000);
  b.check('The paper builds', await b.waitFor(`!document.querySelector('#work') && S.status && S.status.docs.sujet`, 240000));
  if (await b.js(`!!document.querySelector('.server-dialog')`)) await b.js('warn_ok(); true');
  await b.js(`socket_emit('ui-layout-ok'); true`);
  await b.waitFor('S.status && !!S.status.layout_ok', 10000);
  await b.js(`socket_emit('ui-mark-printed'); true`);
  await b.waitFor('S.status && !!S.status.lock', 10000);
  const found = (await get(`/ui/api/bank-search?bank=${encodeURIComponent(BANK)}&archived=1`)).items;
  b.check('Printing counts the copies as used, with the exam', found.filter((x) => x.used === 1 && x.last_exam === EXAM).map((x) => x.item).sort().join() === 'q1,q3', J(found));
  const never = (await get(`/ui/api/bank-search?bank=${encodeURIComponent(BANK)}&unused=never`)).items.map((x) => x.item).sort().join();
  b.check('..."Never printed" leaves them out (and the archived one)', never === 'q4,q5', never);
  await b.goto(`/bank/${encodeURIComponent(BANK)}`);
  await b.waitFor(`S.qdata && S.qdata.bank && document.querySelectorAll('#q-list .q-item').length === 5`, 15000);
  await b.click('[data-act="q-pick"][data-id="q1"]');
  b.check('The item says which exams printed it and hold a copy', await b.waitFor(`!!document.querySelector('.b-usage') && document.querySelector('.b-usage').textContent.includes('Printed in ${EXAM}') && document.querySelector('.b-usage').textContent.includes('Copies in ${EXAM}')`, 10000),
    await b.js(`(document.querySelector('.b-usage') || {}).textContent`));
  b.check('...and the list counts the printings', await b.js(`document.querySelector('.q-item[data-id="q1"]').textContent.includes('printed 1×')`));

  // ---- the search of all banks
  await b.goto('/banks');
  await b.waitFor(`!!document.querySelector('#bk-search')`, 15000);
  await typeInto('#bk-search', 'triangle');
  b.check('Search all banks: the question is found with its bank and group', await b.waitFor(`!!document.querySelector('.b-hit[data-item="q4"]') && document.querySelector('.b-hit[data-item="q4"]').textContent.includes(${J(BANK)})`, 10000));
  await b.shot('s3-search');
  await b.click('.b-hit[data-item="q4"]');
  b.check('...and opens it in its bank', await b.waitFor(`S.route.kind === 'bank' && S.route.name === ${J(BANK)} && S.qform && S.qform.id === 'q4'`, 15000));

  // ---- a bank as a zip
  const size = await b.js(`fetch(${J(bankApi('export'))}, {headers: headers()}).then(async (r) => { window.__zip = await r.blob(); return r.headers.get('content-type') + ' ' + window.__zip.size; })`);
  b.check('A bank downloads as a zip', /zip/.test(size) && +size.split(' ')[1] > 500, size);
  r = await b.js(`(async () => { const f = new FormData(); f.append('file', window.__zip, 'E2E search bank.zip'); f.append('name', ${J(COPY)});
    const resp = await fetch('/ui/api/banks/import', {method: 'POST', headers: headers(), body: f}); return resp.json(); })()`);
  b.check('...and comes back as a new bank, with its history', r.ok && r.name === COPY && r.items === 5 && r.history === true, J(r));
  const h = await get(bankApi('history', COPY));
  const copy = await get(bankApi('', COPY));
  const orig = await get(bankApi());
  b.check('...its versions from before, and its own uid (it is a separate bank)', h.versions.length > 5 && h.versions.some((v) => /imported from/.test(v.what))
    && copy.bank.uid !== orig.bank.uid && copy.files.find((f) => f.item === 'q2').meta.archived === true, J([h.versions.length, copy.bank.uid]));
  r = await b.js(`(async () => { const f = new FormData(); f.append('file', new Blob(['not a zip']), 'x.zip'); const resp = await fetch('/ui/api/banks/import', {method: 'POST', headers: headers(), body: f}); return resp.json(); })()`);
  b.check('A file that isn\'t a zip is refused', !r.ok && /isn't a zip/.test(r.error || ''), J(r));

  await b.goto(`/exam/${encodeURIComponent(EXAM)}/questions`);
  await b.waitFor('!S.scaleUpdating', 60000);
  b.check('The exam is deleted', await b.deleteExam(EXAM));
  await cleanup();
  b.check('The test banks are removed', !(await get('/ui/api/banks')).banks.some((x) => [BANK, COPY].includes(x.name)));
}

main().then(() => b.finish(), async (e) => { await cleanup().catch(() => {}); b.finish(e); });
