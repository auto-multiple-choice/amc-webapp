#!/usr/bin/env node
/*
 * End-to-end test of the marking scheme panel: the answer key, scoring
 * per question, neutralising, totals, the lock, and AMC-TXT exams.
 *
 *   node tests-ui/e2e-marking.mjs http://127.0.0.1:8095 [screenshots-dir]
 *
 * AMC_E2E_USER / AMC_E2E_PASS: sign in first (shared-machine mode).
 * Use a test copy of the app, never your real exams.
 */
import { startBrowser } from './cdp.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:8095';
const USER = process.env.AMC_E2E_USER || '';
const EXAM = 'Marking panel test';
const TXT_EXAM = 'Marking panel test (text)';
const b = await startBrowser({ base: BASE, user: USER, pass: process.env.AMC_E2E_PASS || '', shots: process.argv[3] || null });
const J = JSON.stringify;
const q = (title) => `S.questions.questions.find(x => x.title === ${J(title)})`;
const settled = (cond) => `!!S.questions && S.questions.fresh && !S.scaleUpdating && !S.questions.updating && (${cond})`;
const source = () => b.js(`fetch('/fs/' + encodeURIComponent(S.project) + '/' + encodeURIComponent(S.status.source) + '?attach=0', {cache: 'no-store'}).then(r => r.text())`);
const total = () => b.js('S.questions.totals && S.questions.totals.max');
async function chooseRule(title, choice, custom = '') {
  await b.click(`[data-act="q-edit"][data-title="${title}"]`);
  await b.waitFor(`!!document.querySelector('#dlg-form')`);
  await b.js(`(() => { document.querySelector('#dlg-form [name="choice"][value=${J(choice)}]').checked = true; document.querySelector('#dlg-form [name="custom"]').value = ${J(custom)}; return true; })()`);
  await b.click('#dlg-form button[type="submit"]');
}
const deleteExam = (name) => b.deleteExam(name);
async function createEmpty(name, kind) {
  b.created.add(name);
  await b.js(`S.creating = ${J(name)}; socket_emit('create-project-empty', [${J(name)}, ${J(kind)}]); true`);
  return b.waitFor(`S.project === ${J(name)} && !!S.status`, 30000);
}

async function main() {
  await b.signIn();
  await b.goto('/');
  b.check('The app opens', await b.waitFor('S.online === true'));

  // ---- A LaTeX exam from AMC's simple template
  await b.preflight({ exams: [EXAM, TXT_EXAM] });
  await b.createFromTemplate(EXAM);
  b.check('The exam is created', await b.waitFor(`S.project === ${J(EXAM)} && !!S.status`, 30000));
  await b.click('.step[href$="/marking-scheme"]');
  b.check('The panel reads the questions with AMC', await b.waitFor(settled(`S.questions.questions.length === 2`), 90000), J(await b.js('S.questions')));
  b.check('Both questions can be edited', await b.js(`S.questions.questions.every(x => x.editable)`), J(await b.js('S.questions.questions.map(x => [x.title, x.problem])')));
  b.check('Points follow AMC\'s defaults: 1 for single, 1 per box for multiple', await b.js(`${q('prez')}.max === 1 && ${q('pref')}.max === 3`));
  b.check('The total is shown', (await total()) === 4 && (await b.text('#main')).includes('Total: 4 points'));
  b.check('The answers show their text, the correct ones marked', await b.js(`(() => { const c = [...document.querySelectorAll('[data-act="q-answer"][data-title="prez"]')]; return c.length === 4 && c[0].textContent.includes('René Coty') && c[0].classList.contains('is-correct'); })()`));
  await b.shot('m1-panel');

  // Answer key
  await b.click('[data-act="q-answer"][data-title="prez"][data-answer="2"]');
  b.check('Clicking an answer makes it the single correct one', await b.waitFor(settled(`${q('prez')}.answers[1].correct && !${q('prez')}.answers[0].correct`), 60000));
  let src = await source();
  b.check('...in the source', src.includes('\\correctchoice{Alain Prost}') && src.includes('\\wrongchoice{René Coty}'));
  await b.click('[data-act="q-answer"][data-title="prez"][data-answer="2"]');
  b.check('The only correct answer of a single question can\'t be removed', await b.waitFor(`[...document.querySelectorAll('.toast')].some(t => t.textContent.includes('needs one correct answer'))`, 3000));
  await b.click('[data-act="q-answer"][data-title="prez"][data-answer="1"]');
  await b.waitFor(settled(`${q('prez')}.answers[0].correct`), 60000);
  await b.click('[data-act="q-answer"][data-title="pref"][data-answer="2"]');
  b.check('A multiple question can have several correct answers', await b.waitFor(settled(`${q('pref')}.answers.filter(a => a.correct).length === 3`), 60000));
  await b.click('[data-act="q-answer"][data-title="pref"][data-answer="2"]');
  await b.waitFor(settled(`${q('pref')}.answers.filter(a => a.correct).length === 2`), 60000);

  // Scoring per question
  await chooseRule('pref', 'preset:haut=2');
  b.check('A preset rule sets the points (haut=2: 2 points)', await b.waitFor(settled(`${q('pref')}.max === 2 && ${q('pref')}.kind === 'custom'`), 60000), J(await b.js(q('pref'))));
  src = await source();
  b.check('...written as the question\'s \\scoring', src.includes('\\begin{questionmult}{pref}\\scoring{haut=2}'));
  b.check('The total follows', (await total()) === 3);
  await chooseRule('pref', 'preset:haut=0,mz=1');
  b.check('"All or nothing" on a question also says haut=0, so it applies', await b.waitFor(settled(`${q('pref')}.max === 1 && ${q('pref')}.rule === 'haut=0,mz=1'`), 60000), J(await b.js(`${q('pref')}.rule`)));
  await chooseRule('prez', 'custom', 'b=2,m=-1');
  b.check('An own rule sets the points', await b.waitFor(settled(`${q('prez')}.max === 2`), 60000));
  await chooseRule('prez', 'none');
  b.check('"Not counted" gives no points', await b.waitFor(settled(`${q('prez')}.kind === 'none' && ${q('prez')}.max === 0`), 60000));
  b.check('...and leaves the total', (await total()) === 1);
  await b.click('[data-act="q-restore"][data-title="prez"]');
  b.check('"Count normally" brings the question\'s rule back', await b.waitFor(settled(`${q('prez')}.kind === 'custom' && ${q('prez')}.rule === 'b=2,m=-1' && ${q('prez')}.max === 2`), 60000), J(await b.js(q('prez'))));
  await chooseRule('pref', 'full');
  b.check('"Full marks for everyone" keeps the question\'s points', await b.waitFor(settled(`${q('pref')}.kind === 'full' && ${q('pref')}.max === 1`), 60000), J(await b.js(q('pref'))));
  await chooseRule('pref', 'default');
  b.check('"The default scoring" removes the question\'s rule', await b.waitFor(settled(`${q('pref')}.kind === 'default' && ${q('pref')}.max === 3`), 60000));
  await b.shot('m2-edited');

  // ---- After printing
  await b.js(`socket_emit('doc-update', 'sujet'); true`);
  await b.waitFor(`!!document.querySelector('#work')`, 10000);
  await b.waitFor(`!document.querySelector('#work') && S.status && S.status.layout_pages > 0`, 180000);
  if (await b.js(`!!document.querySelector('.server-dialog')`)) await b.js('warn_ok(); true');
  await b.js(`socket_emit('ui-layout-ok'); true`);
  await b.waitFor(`S.status && !!S.status.layout_ok`, 10000);
  await b.js(`socket_emit('ui-mark-printed'); true`);
  b.check('The exam is locked as printed', await b.waitFor(`S.status && !!S.status.lock`, 10000));
  await b.click('.step[href$="/questions"]');
  b.check('The editor is read-only, pointing to the marking scheme', await b.waitFor(`typeof editor !== 'undefined' && editor && editor.getReadOnly() && !document.querySelector('[data-act="save"]')`, 20000));
  await b.click('#main a.btn-primary[href$="/marking-scheme"]');
  await b.waitFor(settled(`S.questions.questions.length === 2`), 60000);
  await b.click('[data-act="q-answer"][data-title="pref"][data-answer="2"]');
  b.check('The answer key can still be corrected after printing', await b.waitFor(settled(`${q('pref')}.answers[2].correct && ${q('pref')}.answers.filter(a => a.correct).length === 3`), 60000));
  b.check('...without a refusal from the server', await b.js(`!document.querySelector('.server-dialog')`));
  src = await source();
  b.check('...and the source has it', src.includes('\\correctchoice{Sainte-Menehould}'));
  const activity = (await b.js('S.status.activity.map(a => a.what)')).join(' | ');
  b.check('The history records the changes', ['Answer key changed: prez', 'Scoring of pref: haut=2', 'prez neutralised: not counted', 'prez counted normally again'].every((w) => activity.includes(w)), activity);
  await b.waitFor(settled('true'), 60000);
  b.check('The exam is deleted', await deleteExam(EXAM));

  // ---- An AMC-TXT exam
  await b.goto('/');
  await b.waitFor('S.online === true');
  b.check('An empty AMC-TXT exam is created', await createEmpty(TXT_EXAM, 'plain'));
  const txt = 'Title: Panel test\n\n* Who was a President of France?\n+ René Coty\n- Alain Prost\n\n** Which are prefectures?\n+ Poitiers\n- Sainte-Menehould\n+ Avignon\n';
  const up = await b.js(`(async (t) => { const f = new FormData(); f.append('file', new Blob([t], {type: 'text/plain'}), 'source.txt'); const r = await fetch('/upload/source', {method: 'POST', headers: {'AMC-project': S.project, 'AMC-sid': socket.id}, body: f}); return (await r.json()).ok === true; })(${J(txt)})`);
  b.check('The test questions are written', up === true);
  await b.goto(`/exam/${encodeURIComponent(TXT_EXAM)}/marking-scheme`);
  b.check('The panel reads AMC-TXT questions', await b.waitFor(settled(`S.questions.questions.length === 2 && S.questions.questions.every(x => x.editable)`), 120000), J(await b.js('S.questions')));
  b.check('AMC-TXT\'s own default for multiple questions (haut=2) is counted', await b.js(`${q('Q002')}.max === 2 && ${q('Q001')}.max === 1`), J(await b.js('S.questions.questions.map(x => [x.title, x.max])')));
  await b.click('[data-act="q-answer"][data-title="Q001"][data-answer="2"]');
  b.check('The answer key changes in the AMC-TXT source', await b.waitFor(settled(`${q('Q001')}.answers[1].correct`), 60000) && (await source()).includes('- René Coty\n+ Alain Prost'));
  await chooseRule('Q002', 'preset:haut=3');
  b.check('Scoring is written as AMC-TXT\'s {rule}', await b.waitFor(settled(`${q('Q002')}.max === 3`), 60000) && (await source()).includes('**{haut=3} Which'));
  await b.shot('m3-txt');
  await b.waitFor(settled('true'), 60000);
  b.check('The AMC-TXT exam is deleted', await deleteExam(TXT_EXAM));
}

main().then(() => b.finish(), (e) => b.finish(e));
