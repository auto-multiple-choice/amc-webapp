#!/usr/bin/env node
/*
 * End-to-end test of copies of bank questions in an exam (server/ui_bankcopies.py,
 * the copies part of static/ui/banks.js; doc/question-bank-plan.md, section 7.4):
 * a group with a default scoring added as a section; the status of each copy
 * (Up to date, Bank updated, Edited here, Both changed, Not in the bank any
 * more); taking the bank's version, updating the bank's copy (the scoring
 * given on the way in taken back), keeping this exam's, combining both (by
 * hand where they changed the same place); a section offering the questions
 * its group gained; no copy added twice; a macro defined differently flagged;
 * and, once printed, only answer key fixes taken from the bank.
 *
 *   node tests-ui/e2e-copies.mjs http://127.0.0.1:8095 [screenshots-dir]
 *
 * AMC_E2E_USER / AMC_E2E_PASS: sign in first (shared-machine mode).
 * Use a test copy of the app, never your real exams or banks.
 */
import { startBrowser } from './cdp.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:8095';
const BANK = 'E2E copies bank';
const EXAM = 'Copies test';
const b = await startBrowser({ base: BASE, user: process.env.AMC_E2E_USER || '', pass: process.env.AMC_E2E_PASS || '', shots: process.argv[3] || null, qtab: 'form' });
const J = JSON.stringify;
const post = (url, body) => b.js(`fetch(${J(url)}, {method: 'POST', headers: {...headers(), 'Content-Type': 'application/json'}, body: ${J(J(body))}}).then(r => r.json())`);
const get = (url) => b.js(`getJSON(${J(url)})`);
const bankApi = (what = '') => `/ui/api/bank/${encodeURIComponent(BANK)}${what ? '/' + what : ''}`;
const examFile = (name) => get('/ui/api/source?file=' + encodeURIComponent(name));
const bankFile = (name) => get(`${bankApi('source')}?file=${encodeURIComponent(name)}`);
const status = async (item) => ((await get('/ui/api/bank-copies')).copies.find((c) => c.item === item) || {}).status;
const ITEM = (id, text) => `\\begin{question}{${id}}\n  ${text}\n  \\begin{choices}\n    \\correctchoice{Right}\n    \\wrongchoice{Wrong}\n  \\end{choices}\n\\end{question}\n`;

async function editBank(item, change) {
  const f = await bankFile(`items/${item}/item.tex`);
  return post(bankApi('source'), { file: `items/${item}/item.tex`, text: change(f.text), based_on: f.digest });
}
async function editExam(item, change) {
  const f = await examFile(`items/${item}/item.tex`);
  return post('/ui/api/source', { file: `items/${item}/item.tex`, text: change(f.text), based_on: f.digest });
}
async function refresh() { await b.js('S.bcopies = null; loadEditor(); true'); await b.waitFor('!!S.bcopies', 15000); }

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

  // ---- a bank: a group with a default scoring, three questions
  let r = await post('/ui/api/banks', { op: 'create', name: BANK });
  await post(bankApi('groups'), { op: 'add', title: 'Algebra' });
  r = await post(bankApi('groups'), { op: 'describe', group: 'Algebra', scoring: 'b=3,m=-1' });
  for (const id of ['q1', 'q2', 'q3']) {
    await post(bankApi('items'), { op: 'add', kind: 'single', group: 'Algebra' });
    await post(bankApi('source'), { file: `items/${id}/item.tex`, text: ITEM(id, `Question ${id} of the bank`), based_on: '' });
  }
  r = await get(bankApi());
  b.check('A bank with a group (default scoring) of three questions', r.bank.groups[0].scoring === 'b=3,m=-1' && r.bank.groups[0].items.join(',') === 'q1,q2,q3', J(r.bank));

  // ---- the group into an exam, from the picker
  b.created.add(EXAM);
  await b.goto('/exams');
  await b.waitFor(`typeof S !== 'undefined' && S.online === true && Array.isArray(S.projects)`, 15000);
  await b.js(`S.qtab = 'form'; store.set('qtab', 'form'); S.creating = ${J(EXAM)}; socket_emit('ui-create-exam', {name: ${J(EXAM)}, gid: 'school', id: 'blank', style: 'paper'}); true`);
  await b.waitFor(`S.project === ${J(EXAM)} && S.qdata && S.qdata.modular && !!document.querySelector('[data-act="bank-pick"]')`, 60000);
  await b.click('[data-act="bank-pick"]');
  b.check('The picker says the group\'s scoring goes to questions without their own', await b.waitFor(`S.bp && S.bp.data && !!document.querySelector('#bp-scoring-all') && document.querySelector('.dialog').textContent.includes('b=3,m=-1')`, 10000));
  await b.click('[data-act="bp-add"]');
  await b.waitFor(`!document.querySelector('#bp-bank')`, 15000);
  await refresh();
  let c = await get('/ui/api/bank-copies');
  b.check('Three copies, all up to date, and nothing to say above the questions', c.copies.length === 3 && c.copies.every((x) => x.status === 'same')
    && !(await b.js(`!!document.querySelector('.b-strip')`)), J(c.copies));
  const q2 = await examFile('items/q2/item.tex');
  b.check('The copy got the group\'s scoring', q2.text.includes('\\scoring{b=3,m=-1}'), q2.text);
  r = await post('/ui/api/bank-pull', { bank: BANK, group: 'Algebra', items: ['q1'], mode: 'into', section: 'Algebra' });
  b.check('A question the exam already has is not added twice', !r.ok && /already has/.test(r.error || ''), J(r));

  // ---- bank updated: take the bank's version
  await editBank('q1', (t) => t.replace('Question q1 of the bank', 'Question q1, corrected in the bank'));
  await refresh();
  b.check('An edit in the bank: "Bank updated", said above the questions and in the list', (await status('q1')) === 'bank'
    && await b.waitFor(`!!document.querySelector('.b-strip') && document.querySelector('.b-strip').textContent.includes('1 newer in the bank') && !!document.querySelector('.q-item .st-bank')`, 5000));
  await b.shot('c1-strip');
  await b.click('[data-act="copies-open"]');
  await b.waitFor(`!!document.querySelector('.dialog [data-act="copy-compare"][data-item="q1"]')`, 5000);
  await b.click('.dialog [data-act="copy-compare"][data-item="q1"]');
  b.check('The comparison shows what changed in the bank', await b.waitFor(`!!document.querySelector('.dialog .b-diff .diff') && document.querySelector('.dialog .b-diff').textContent.includes('corrected in the bank')`, 10000));
  await b.shot('c2-compare');
  await b.click('.dialog [data-act="copy-op"][data-op="take"]');
  await b.waitFor(`!document.querySelector('.dialog [data-op="take"]')`, 10000);
  b.check('"Take the bank\'s version": the copy is up to date, with the scoring given on the way in kept', (await status('q1')) === 'same'
    && (await examFile('items/q1/item.tex')).text.includes('corrected in the bank') && (await examFile('items/q1/item.tex')).text.includes('\\scoring{b=3,m=-1}'));
  let h = await get('/ui/api/history');
  b.check('...as one version of the exam', /q1: the bank's version taken/.test(h.versions[0].what), h.versions[0].what);

  // ---- edited here: update the bank's copy
  await b.click('[data-act="q-pick"][data-id="q2"]');
  await b.waitFor(`S.qform.id === 'q2' && !!document.querySelector('#qf-text')`, 10000);
  await b.setValue('#qf-text', 'Question q2, improved in the exam');
  await b.waitFor(`S.qform && !S.qform.saving && !S.qform.pending.length && qsel().latex.includes('improved')`, 15000);
  await refresh();
  b.check('An edit in the exam: "Edited here", with Compare in the form', (await status('q2')) === 'here'
    && await b.waitFor(`!!document.querySelector('#q-form .b-copy [data-act="copy-compare"]') && document.querySelector('#q-form .b-copy').textContent.includes('Edited here')`, 5000));
  await b.click('#q-form .b-copy [data-act="copy-compare"]');
  await b.waitFor(`!!document.querySelector('.dialog [data-op="push"]')`, 10000);
  await b.click('.dialog [data-op="push"]');
  await b.waitFor(`!!document.querySelector('.dialog [data-act="dialog-ok"]')`, 5000);
  await b.click('.dialog [data-act="dialog-ok"]');
  await b.waitFor('S.bcmp === null', 15000);
  let bq2 = (await bankFile('items/q2/item.tex')).text;
  b.check('"Update the bank\'s copy": the bank has the exam\'s text, without the scoring given on the way in', bq2.includes('improved in the exam') && !bq2.includes('\\scoring'), bq2);
  b.check('...and the copy is up to date', (await status('q2')) === 'same');
  h = await get(bankApi('history'));
  b.check('...a version in the bank\'s History', /q2 updated from the exam/.test(h.versions[0].what), h.versions[0].what);

  // ---- both changed, in different places: combined
  await editBank('q3', (t) => t.replace('\\wrongchoice{Wrong}', '\\wrongchoice{Wrong, but tempting}'));
  await editExam('q3', (t) => t.replace('Question q3 of the bank', 'Question q3, reworded here'));
  await refresh();
  b.check('Edits on both sides: "Both changed"', (await status('q3')) === 'both');
  await b.js(`openCompare('q3'); true`);
  await b.waitFor(`!!document.querySelector('.dialog [data-op="merge"]')`, 10000);
  b.check('The comparison shows both sides\' changes', await b.js(`document.querySelectorAll('.dialog .b-diff').length === 2`));
  await b.click('.dialog [data-op="merge"]');
  await b.waitFor(`!document.querySelector('.dialog [data-op="merge"]')`, 10000);
  const q3 = (await examFile('items/q3/item.tex')).text;
  b.check('"Combine both": both changes are in the copy, which then shows "Edited here"', q3.includes('reworded here') && q3.includes('but tempting') && (await status('q3')) === 'here', q3);

  // ---- both changed, in the same place: by hand
  await editBank('q1', (t) => t.replace('corrected in the bank', 'worded by the bank'));
  await editExam('q1', (t) => t.replace('corrected in the bank', 'worded by the exam'));
  await refresh();
  await b.js(`openCompare('q1'); true`);
  await b.waitFor(`!!document.querySelector('.dialog [data-op="merge"]')`, 10000);
  await b.click('.dialog [data-op="merge"]');
  b.check('The same place changed on both sides: the combined text opens with the places to choose', await b.waitFor(`!!S.bmerge && S.bmerge.ed.getValue().includes('<<<<<<< this exam')`, 10000));
  await b.shot('c3-merge');
  await b.click('[data-act="copy-merge-save"]');
  b.check('...saving with the marks left is refused', await b.waitFor(`!!document.querySelector('#bmerge-msg .banner')`, 5000));
  await b.js(`S.bmerge.ed.setValue(S.bmerge.ed.getValue().replace(/<<<<<<< this exam\\n([^]*?)=======\\n[^]*?>>>>>>> the bank\\n/, '$1')); true`);
  await b.click('[data-act="copy-merge-save"]');
  await b.waitFor('!S.bmerge', 10000);
  b.check('...once chosen, it is saved', (await examFile('items/q1/item.tex')).text.includes('worded by the exam') && (await status('q1')) === 'here');

  // ---- keep this exam's
  await editBank('q2', (t) => t.replace('improved in the exam', 'changed again in the bank'));
  await refresh();
  await b.js(`openCompare('q2'); true`);
  await b.waitFor(`!!document.querySelector('.dialog [data-op="keep"]')`, 10000);
  await b.click('.dialog [data-op="keep"]');
  await b.waitFor(`!document.querySelector('.dialog [data-op="keep"]')`, 10000);
  b.check('"Keep this exam\'s": the copy stays and shows "Edited here"', (await status('q2')) === 'here' && (await examFile('items/q2/item.tex')).text.includes('improved in the exam'));

  // ---- the section follows its group
  const itemOf = (res) => res.added.file.split('/')[1];
  r = await post(bankApi('items'), { op: 'add', kind: 'single', group: 'Algebra' });
  const q4 = itemOf(r);
  await refresh();
  b.check('The group gains a question: the section made from it offers it', await b.waitFor(`!!document.querySelector('[data-act="follow-add"][data-section="Algebra"]')`, 5000));
  await b.click('[data-act="follow-add"][data-section="Algebra"]');
  await b.waitFor(`!document.querySelector('[data-act="follow-add"]')`, 15000);
  b.check('..."Add it to the section" adds it there', (await examFile('pools.tex')).text.includes(`\\element{Algebra}{\\amcuiItem{${q4}}}`));
  r = await post(bankApi('items'), { op: 'add', kind: 'single', group: 'Algebra' });
  const q5 = itemOf(r);
  await refresh();
  await b.waitFor(`!!document.querySelector('[data-act="follow-dismiss"][data-section="Algebra"]')`, 5000);
  await b.click('[data-act="follow-dismiss"][data-section="Algebra"]');
  await b.waitFor(`!document.querySelector('[data-act="follow-dismiss"]')`, 10000);
  await refresh();
  b.check('..."Not these" isn\'t offered again', !(await b.js(`!!document.querySelector('[data-act="follow-add"]')`)) && !(await examFile('pools.tex')).text.includes(`{${q5}}`));
  await post(bankApi('items'), { op: 'delete', item: q4 });
  await refresh();
  c = await get('/ui/api/bank-copies');
  b.check('A question deleted from the bank: "Not in the bank any more", and the section says so', (await status(q4)) === 'gone'
    && c.follow.some((f) => f.section === 'Algebra' && f.gone.includes(q4)), J(c.follow));
  await post('/ui/api/bank-follow', { section: 'Algebra' });

  // ---- a macro defined differently in the exam and the bank
  const pre = await bankFile('preamble.tex');
  await post(bankApi('source'), { file: 'preamble.tex', text: pre.text + '\\newcommand{\\R}{\\mathbb{R}}\n', based_on: pre.digest });
  await post(bankApi('groups'), { op: 'add', title: 'More' });
  r = await post(bankApi('items'), { op: 'add', kind: 'single', group: 'More' });
  const q6 = itemOf(r);
  await post(bankApi('source'), { file: `items/${q6}/item.tex`, text: ITEM(q6, 'Is $\\pi \\in \\R$?'), based_on: '' });
  const mainName = await b.js('S.status.source');
  const main = await examFile(mainName);
  await post('/ui/api/source', { file: mainName, text: main.text.replace('\\begin{document}', '\\newcommand{\\R}{\\mathbf{R}}\n\\begin{document}'), based_on: main.digest });
  await b.js('S.bcopies = null; true');
  await b.click('[data-act="bank-pick"]');
  await b.waitFor(`S.bp && S.bp.data && S.bp.data.bank`, 10000);
  await b.js(`Object.assign(S.bp, {group: 'More', mode: 'ticked', ticked: [${J(q6)}], section: 'Algebra'}); renderPicker(); true`);
  await b.click('[data-act="bp-add"]');
  b.check('A macro the exam defines differently is flagged with both definitions, the exam\'s kept', await b.waitFor(`!!document.querySelector('.dialog .b-clash') && document.querySelector('.dialog').textContent.includes('mathbf{R}') && document.querySelector('.dialog').textContent.includes('mathbb{R}')`, 15000)
    && (await examFile(mainName)).text.includes('\\newcommand{\\R}{\\mathbf{R}}') && !(await examFile(mainName)).text.includes('\\newcommand{\\R}{\\mathbb{R}}'));
  await b.shot('c4-clash');
  await b.click('.dialog [data-act="dialog-ok"]');

  // ---- printed: only answer key fixes come from the bank
  await b.js(`socket_emit('doc-update', 'sujet'); true`);
  await b.waitFor(`!!document.querySelector('#work')`, 10000);
  b.check('The paper builds with the copies', await b.waitFor(`!document.querySelector('#work') && S.status && S.status.docs.sujet`, 240000));
  if (await b.js(`!!document.querySelector('.server-dialog')`)) await b.js('warn_ok(); true');
  await b.js(`socket_emit('ui-layout-ok'); true`);
  await b.waitFor('S.status && !!S.status.layout_ok', 10000);
  await b.js(`socket_emit('ui-mark-printed'); true`);
  await b.waitFor('S.status && !!S.status.lock', 10000);
  await editBank(q6, (t) => t.replace('\\correctchoice{Right}', '@@').replace('\\wrongchoice{Wrong}', '\\correctchoice{Wrong}').replace('@@', '\\wrongchoice{Right}'));
  await editBank('q2', (t) => t.replace('changed again in the bank', 'a longer wording that would move the boxes on the printed papers'));
  let cmp = await get('/ui/api/bank-copy?item=q2');
  b.check('Printed: a bank version that changes the text is refused, and the comparison says why', !!cmp.take_refused, J(cmp));
  r = await post('/ui/api/bank-copy', { item: 'q2', op: 'take' });
  b.check('...taking it is refused by the server too', !r.ok && r.locked === true, J(r));
  cmp = await get(`/ui/api/bank-copy?item=${q6}`);
  r = await post('/ui/api/bank-copy', { item: q6, op: 'take', digest: cmp.digest, bank_fp: cmp.bank_fp });
  b.check('...an answer key fix is taken', !cmp.take_refused && r.ok && /\\correctchoice\{Wrong\}/.test((await examFile(`items/${q6}/item.tex`)).text), J([cmp.take_refused, r.error]));
  await post(bankApi('items'), { op: 'add', kind: 'single', group: 'Algebra' });
  c = await get('/ui/api/bank-copies');
  b.check('...and a question the group gains isn\'t offered any more', c.lock && c.follow.length === 0, J(c.follow));

  await b.waitFor('!S.scaleUpdating', 60000);
  b.check('The exam is deleted', await b.deleteExam(EXAM));
  await cleanup();
  b.check('The test bank is removed', !(await get('/ui/api/banks')).banks.some((x) => x.name === BANK));
}

main().then(() => b.finish(), async (e) => { await cleanup().catch(() => {}); b.finish(e); });
