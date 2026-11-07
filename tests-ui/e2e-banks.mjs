#!/usr/bin/env node
/*
 * End-to-end test of question banks (server/ui_banks.py, ui_bankapi.py,
 * static/ui/banks.js): a bank made, groups and questions added and edited
 * with the question form, difficulty and tags, the bank's History; an
 * RJ-style LaTeX file imported with its figure; then in an exam: a whole
 * group added as a new section, ticked questions into a section (a name
 * the exam uses renamed), a random pick shown then added; questions, a
 * section and the whole exam saved into banks, and a copy updated in the
 * bank; the paper builds; a bank deleted to the Trash and restored.
 *
 *   node tests-ui/e2e-banks.mjs http://127.0.0.1:8095 [screenshots-dir]
 *
 * AMC_E2E_USER / AMC_E2E_PASS: sign in first (shared-machine mode).
 * Use a test copy of the app, never your real exams or banks.
 */
import { startBrowser } from './cdp.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:8095';
const BANK = 'E2E bank';
const XBANK = 'E2E exam bank';
const EXAM = 'Banks test';
const b = await startBrowser({ base: BASE, user: process.env.AMC_E2E_USER || '', pass: process.env.AMC_E2E_PASS || '', shots: process.argv[3] || null, qtab: 'form' });
const J = JSON.stringify;
const post = (url, body) => b.js(`fetch(${J(url)}, {method: 'POST', headers: {...headers(), 'Content-Type': 'application/json'}, body: ${J(J(body))}}).then(r => r.json())`);
const get = (url) => b.js(`getJSON(${J(url)})`);
const bankApi = (name, what = '') => `/ui/api/bank/${encodeURIComponent(name)}${what ? '/' + what : ''}`;
const file = (name) => b.js(`getJSON('/ui/api/source?file=' + encodeURIComponent(${J(name)})).then(r => r.text ?? null).catch(() => null)`);
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function cleanup() {
  for (const n of [BANK, XBANK]) {
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
  b.check('The Question banks page opens', await b.waitFor(`S.route.kind === 'banks' && Array.isArray(S.banks)`, 15000));
  await b.preflight({ exams: [EXAM] });
  if ((await get('/ui/api/banks')).banks.some((x) => [BANK, XBANK].includes(x.name))) {
    if (process.env.AMC_E2E_FORCE !== '1') { console.log('NOT RUN: a test bank already exists.'); await b.finish(new Error('pre-flight')); }
    await cleanup();
  }

  // ---- a bank, its groups and questions
  await b.click('[data-act="bank-new"]');
  await b.waitFor(`!!document.querySelector('#dlg-form input[name="name"]')`, 3000);
  await b.setValue('#dlg-form input[name="name"]', BANK);
  await b.click('#dlg-form [type="submit"]');
  b.check('A new bank opens on its page', await b.waitFor(`S.route.kind === 'bank' && S.route.name === ${J(BANK)} && S.qdata && S.qdata.bank`, 15000));
  await b.click('[data-act="bgroup-add"]');
  await b.waitFor(`!!document.querySelector('#dlg-form input[name="title"]')`, 3000);
  await b.setValue('#dlg-form input[name="title"]', 'Algebra');
  await b.click('#dlg-form [type="submit"]');
  b.check('A group is added', await b.waitFor(`S.qdata.bank.groups.length === 1 && S.qdata.bank.groups[0].name === 'Algebra'`, 10000));
  await b.click('[data-act="bitem-add"][data-group="Algebra"]');
  await b.waitFor(`!!document.querySelector('.dialog [data-v="single"]')`, 3000);
  await b.click('.dialog [data-v="single"]');
  b.check('A question is added to the group and opens in the form', await b.waitFor(`S.qform && S.qform.id === 'q1' && !!document.querySelector('#qf-text')`, 10000));
  await b.setValue('#qf-text', 'What is $3 \\times 4$?');
  b.check('The form edits the bank\'s item', await b.waitFor(`S.qform && !S.qform.saving && !S.qform.pending.length && qsel() && qsel().latex.includes('3 \\\\times 4')`, 15000));
  await b.setValue('[data-bmeta="difficulty"]', 'easy');
  await b.js(`(() => { const t = document.querySelector('[data-bmeta="tags"]'); t.value = 'arithmetic, products'; t.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);
  b.check('Difficulty and tags are kept with the item', await b.waitFor(`S.qdata.files[0].meta.difficulty === 'easy' && S.qdata.files[0].meta.tags.join(',') === 'arithmetic,products'`, 10000));
  let r = await post(bankApi(BANK, 'items'), { op: 'add', kind: 'multiple', group: 'Algebra' });
  b.check('A second question', r.ok && r.files.length === 2, J(r.error));
  r = await post(bankApi(BANK, 'editor'), { file: 'items/q2/item.tex', based_on: '', ops: [{ op: 'rename', id: 'q2', new_id: 'example-single' }] });
  b.check('...named like a question of the exam to come', r.ok, J(r.error));
  await b.shot('k1-bank');
  const bh = await get(bankApi(BANK, 'history'));
  b.check('The bank has its own History', bh.versions.length >= 5 && bh.versions[bh.versions.length - 1].kind === 'create', J(bh.versions.map((v) => v.what)));

  // ---- importing an RJ-style file with a figure
  const tex = '\\documentclass{article}\n\\newcommand{\\N}{\\mathbb{N}}\n\\begin{document}\n\\element{geo}{\n  \\begin{question}{g1}\n    The angle in the figure \\includegraphics{tri}\n    \\begin{choices}\\correctchoice{$90^\\circ$}\\wrongchoice{$60^\\circ$}\\end{choices}\n  \\end{question}\n}\n\\element{geo}{\n  \\begin{question}{g2}\n    Sides of a square in $\\N$\n    \\begin{choices}\\correctchoice{4}\\wrongchoice{3}\\end{choices}\n  \\end{question}\n}\n\\end{document}\n';
  r = await b.js(`(async () => { const f = new FormData(); f.append('file', new Blob([${J(tex)}], {type: 'text/plain'}), 'level1.tex');
    const bin = Uint8Array.from(atob(${J(PNG)}), (c) => c.charCodeAt(0)); f.append('file', new Blob([bin], {type: 'image/png'}), 'tri.png');
    const resp = await fetch(${J(bankApi(BANK, 'import'))}, {method: 'POST', headers: headers(), body: f}); return resp.json(); })()`);
  b.check('An RJ-style file is imported: its \\element group becomes a group of the bank', r.ok && r.bank.groups.some((g) => g.name === 'geo' && g.items.join(',') === 'g1,g2'), J(r.error || r.bank));
  const g1 = await get(`${bankApi(BANK, 'source')}?file=items/g1/item.tex`);
  b.check('...the figure moved into the item, renamed after it, and the macro went to the preamble', g1.text.includes('\\includegraphics{g1-1}')
    && r.files.some((f) => f.item === 'g1') && (await get(`${bankApi(BANK, 'source')}?file=preamble.tex`)).text.includes('\\newcommand{\\N}'), g1.text);
  await b.js('loadBank(); true');

  // ---- in an exam: from a bank
  b.created.add(EXAM);
  await b.goto('/exams');
  await b.waitFor(`typeof S !== 'undefined' && S.online === true && Array.isArray(S.projects)`, 15000);
  await b.js(`S.qtab = 'form'; store.set('qtab', 'form'); S.creating = ${J(EXAM)}; socket_emit('ui-create-exam', {name: ${J(EXAM)}, gid: 'school', id: 'blank', style: 'paper'}); true`);
  b.check('An exam with its questions in items', await b.waitFor(`S.project === ${J(EXAM)} && S.qdata && S.qdata.modular && !!document.querySelector('[data-act="bank-pick"]')`, 60000));
  await b.click('[data-act="bank-pick"]');
  b.check('"From a bank…" shows the bank, its groups and questions', await b.waitFor(`!!document.querySelector('#bp-bank') && S.bp && S.bp.data && document.querySelectorAll('.bp-row').length === 2`, 10000));
  await b.shot('k2-picker');
  await b.click('[data-act="bp-add"]');
  b.check('The whole group comes in as a new section', await b.waitFor(`!document.querySelector('#bp-bank')`, 15000) && (await file('pools.tex')).includes('%%AMCUI:POOL Algebra%%'));
  let st = await get('/ui/api/structure');
  b.check('...with the group\'s title as heading and both questions', st.sections.some((s) => s.name === 'Algebra' && s.pool === 2 && (s.heading || '').includes('Algebra')), J(st.sections));
  let ed = await get('/ui/api/editor');
  const pulled = ed.files.find((f) => f.item && f.meta && f.meta.origin && f.meta.origin.item === 'q2');
  b.check('A name the exam already uses is changed in the copy, and the copy records where it came from', pulled && pulled.questions[0].id === 'example-single-2'
    && pulled.meta.origin.bank === BANK && pulled.meta.origin.ids['example-single'] === 'example-single-2' && pulled.meta.origin.fingerprint, J(pulled));
  r = await post('/ui/api/bank-pull', { bank: BANK, group: 'geo', items: ['g2'], mode: 'into', section: 'general' });
  b.check('Ticked questions go into an existing section', r.ok && r.files.some((f) => f.item === 'g2' && f.questions[0].group === 'general'), J(r.error));
  b.check('...and a macro they use from the bank\'s preamble is added to the exam\'s', /macros and packages added/.test(r.what || '') && (await file(await b.js('S.status.source'))).includes('\\newcommand{\\N}{\\mathbb{N}}'), r.what);
  const pick = await post('/ui/api/bank-pull', { bank: BANK, group: 'geo', count: 1, seed: 'e2e', preview: true });
  b.check('A random pick is shown first', pick.ok && pick.chosen.length === 1, J(pick));
  r = await post('/ui/api/bank-pull', { bank: BANK, group: 'geo', items: pick.chosen.map((x) => x.item), mode: 'into', section: 'general' });
  b.check('...then added as shown, with its figure', r.ok && (pick.chosen[0].item !== 'g1' || r.files.some((f) => f.file.startsWith('items/g1'))), J(r.error));
  if (pick.chosen[0].item !== 'g1') r = await post('/ui/api/bank-pull', { bank: BANK, group: 'geo', items: ['g1'], mode: 'into', section: 'general' });
  const figs = await b.js(`fetch('/fs/' + encodeURIComponent(S.project) + '/items/g1/g1-1.png').then(r => r.ok && r.headers.get('content-type'))`);
  b.check('The figure came with the question', /png/.test(figs || ''), J(figs));

  // ---- the paper builds with them
  await b.js('loadEditor(); true');
  await b.js(`socket_emit('doc-update', 'sujet'); true`);
  await b.waitFor(`!!document.querySelector('#work')`, 10000);
  b.check('The paper builds with questions from the bank', await b.waitFor(`!document.querySelector('#work') && S.status && S.status.docs.sujet`, 240000));
  if (await b.js(`!!document.querySelector('.server-dialog')`)) await b.js('warn_ok(); true');

  // ---- to a bank
  await b.click('[data-act="q-pick"][data-id="example-multiple"]');
  await b.waitFor(`S.qform.id === 'example-multiple' && !!document.querySelector('[data-act="bank-save-item"]')`, 10000);
  await b.click('[data-act="bank-save-item"]');
  await b.waitFor(`!!document.querySelector('#bs-group')`, 10000);
  await b.setValue('#bs-group', '+new');
  await b.waitFor(`!!document.querySelector('#bs-newgroup')`, 3000);
  await b.setValue('#bs-newgroup', 'From exams');
  await b.shot('k3-save');
  await b.click('[data-act="bs-save"]');
  b.check('A question is saved into a new group of the bank', await b.waitFor(`!document.querySelector('#bs-group')`, 15000)
    && (await get(bankApi(BANK))).bank.groups.some((g) => g.name === 'From-exams' && g.items.length === 1));
  ed = await get('/ui/api/editor');
  b.check('...and the exam\'s question now knows where it is in the bank', ed.files.some((f) => f.item === 'example-multiple' && f.meta.origin && f.meta.origin.bank === BANK));
  r = await post('/ui/api/editor', { file: pulled.file, based_on: '', ops: [{ op: 'text', id: 'example-single-2', latex: 'Edited in the exam' }] });
  r = await post('/ui/api/bank-save', { bank: BANK, items: [pulled.item], linked: 'update' });
  const q2 = await get(`${bankApi(BANK, 'source')}?file=items/q2/item.tex`);
  const after = await get(bankApi(BANK));
  b.check('"Update the bank\'s copy" updates the item it came from, under its bank name, without a duplicate', r.ok && q2.text.includes('Edited in the exam')
    && q2.text.includes('{example-single}') && after.files.length === 5, J([r.error, q2.text, after.files.map((f) => f.item)]));
  r = await post('/ui/api/bank-save', { bank: BANK, section: 'general', group: 'general', linked: 'new' });
  b.check('A whole section is saved as a group', r.ok && (await get(bankApi(BANK))).bank.groups.some((g) => g.name === 'general' && g.items.length >= 4), J(r.error));
  await b.goto(`/exam/${encodeURIComponent(EXAM)}/settings`);
  await b.waitFor(`!!document.querySelector('[data-act="bank-save-exam"]')`, 15000);
  await b.click('[data-act="bank-save-exam"]');
  await b.waitFor(`!!document.querySelector('#bs-newbank')`, 5000);
  await b.setValue('#bs-newbank', XBANK);
  await b.click('[data-act="bs-save"]');
  b.check('The whole exam becomes a new bank, a group per section', await b.waitFor(`!document.querySelector('#bs-newbank')`, 15000)
    && J((await get(bankApi(XBANK))).bank.groups.map((g) => g.name)) === J(['general', 'Algebra']), J((await get(bankApi(XBANK))).bank));

  // ---- the trash
  r = await post('/ui/api/banks', { op: 'delete', name: XBANK });
  let t = await get('/ui/api/trash');
  const entry = t.items.find((x) => x.name === XBANK && x.target === 'bank');
  b.check('A deleted bank goes to the Trash', r.ok && !!entry && !(await get('/ui/api/banks')).banks.some((x) => x.name === XBANK), J(t.items));
  r = await post('/ui/api/trash/restore', { id: entry.id });
  b.check('...and comes back from it, with its history', r.ok && r.target === 'bank' && (await get(bankApi(XBANK, 'history'))).versions.length >= 2, J(r));
  await b.waitFor('!S.scaleUpdating', 60000);
  b.check('The exam is deleted', await b.deleteExam(EXAM));
  await cleanup();
  t = await get('/ui/api/trash');
  b.check('The test banks are removed', !(await get('/ui/api/banks')).banks.some((x) => [BANK, XBANK].includes(x.name)) && !t.items.some((x) => [BANK, XBANK].includes(x.name)));
}

main().then(() => b.finish(), async (e) => { await cleanup().catch(() => {}); b.finish(e); });
