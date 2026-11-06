#!/usr/bin/env node
/*
 * End-to-end test of the question editor (the form in the Questions
 * step): reading the questions, editing text, answers, the answer key,
 * scoring, explanation, name and type; adding, moving and deleting
 * questions; the maths preview; "Edit in LaTeX"; a conflicting change
 * from another tab; what stays editable after printing; and an AMC-TXT
 * exam, which keeps the LaTeX tab only.
 *
 *   node tests-ui/e2e-editor.mjs http://127.0.0.1:8095 [screenshots-dir]
 *
 * AMC_E2E_USER / AMC_E2E_PASS: sign in first (shared-machine mode).
 * Use a test copy of the app, never your real exams.
 */
import { startBrowser } from './cdp.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:8095';
const USER = process.env.AMC_E2E_USER || '';
const EXAM = 'Form editor test';
const TXT_EXAM = 'Form editor test (text)';
const b = await startBrowser({ base: BASE, user: USER, pass: process.env.AMC_E2E_PASS || '', shots: process.argv[3] || null, qtab: 'form' });
const J = JSON.stringify;

const source = () => b.js(`getJSON('/ui/api/source?file=' + encodeURIComponent(S.status.source)).then(r => r.text)`);
const saved = () => b.waitFor('S.qform && !S.qform.saving && !S.qform.pending.length', 15000);
const sel = () => b.js('qsel()');
const ids = () => b.js('S.qdata.files[0].questions.map(q => q.id)');
const typeInto = (selector, text) => b.js(`(() => { const t = document.querySelector(${J(selector)}); t.value = ${J(text)}; t.dispatchEvent(new Event('input', {bubbles: true})); return true; })()`);
const pick = (id) => b.click(`[data-act="q-pick"][data-id="${id}"]`);
const uploadSource = (text) => b.js(`(async () => { const f = new FormData(); f.append('file', new Blob([${J(text)}], {type: 'text/plain'}), S.status.source);
  const r = await fetch('/upload/source', {method: 'POST', headers: {'AMC-project': S.project, 'AMC-sid': socket.id}, body: f}); return (await r.json()).ok === true; })()`);
async function createEmpty(name, kind) {
  b.created.add(name);
  await b.js(`S.creating = ${J(name)}; socket_emit('create-project-empty', [${J(name)}, ${J(kind)}]); true`);
  return b.waitFor(`S.project === ${J(name)} && !!S.status`, 30000);
}

async function main() {
  await b.signIn();
  await b.goto('/');
  b.check('The app opens', await b.waitFor('S.online === true'));
  await b.preflight({ exams: [EXAM, TXT_EXAM] });
  b.check('The exam is created', await b.createFromTemplate(EXAM));
  b.check('The form opens with the template\'s two questions, the first selected', await b.waitFor(`S.qtab === 'form' && S.qdata && document.querySelectorAll('.q-item').length === 2 && qsel() && qsel().id === 'prez' && !!document.querySelector('#qf-text')`, 20000));
  b.check('The form shows the text, four answers and the correct one', await b.js(`document.querySelector('#qf-text').value.includes('President') && document.querySelectorAll('.qf-ans-correct').length === 4 && document.querySelector('.qf-ans-correct[data-i="0"]').checked && document.querySelector('#qf-kind').value === 'single'`));
  await b.shot('q1-form');

  // ---- text, preview, answers
  await typeInto('#qf-text', 'Who was a President of France? $x^2$');
  b.check('Maths in the text is rendered in the preview', await b.waitFor(`!!document.querySelector('#qf-preview .katex')`, 5000));
  b.check('The text is saved into the source', await saved() && (await source()).includes('Who was a President of France? $x^2$'));
  await typeInto('.qf-ans-text[data-i="1"]', 'Alain Prost (driver)');
  b.check('An answer\'s text is saved', await saved() && (await source()).includes('\\wrongchoice{Alain Prost (driver)}'));
  await b.click('.qf-ans-correct[data-i="1"]');
  b.check('Ticking another answer makes it the correct one', await saved() && (await source()).includes('\\correctchoice{Alain Prost (driver)}') && (await source()).includes('\\wrongchoice{René Coty}'));
  await b.click('[data-act="qf-ans-add"]');
  b.check('An answer is added and focused', await b.waitFor(`document.querySelectorAll('.qf-ans-text').length === 5 && document.activeElement === document.querySelector('.qf-ans-text[data-i="4"]')`, 10000));
  await typeInto('.qf-ans-text[data-i="4"]', 'Zinedine Zidane');
  b.check('...and its text saved', await saved() && (await source()).includes('\\wrongchoice{Zinedine Zidane}'));
  await b.click('[data-act="qf-ans-move"][data-i="4"][data-d="-1"]');
  b.check('An answer moves up', await saved() && (await sel()).answers[3].latex === 'Zinedine Zidane');
  await b.click('[data-act="qf-ans-remove"][data-i="3"]');
  b.check('An answer is removed', await saved() && (await sel()).answers.length === 4 && !(await source()).includes('Zidane'));
  await b.shot('q2-answers');

  // ---- scoring, explanation, name
  await b.click('[data-act="qf-scoring"]');
  await b.waitFor(`!!document.querySelector('#dlg-form')`);
  await b.js(`document.querySelector('#dlg-form [name="choice"][value="preset:b=1,m=-0.5"]').checked = true; true`);
  await b.click('#dlg-form button[type="submit"]');
  b.check('A scoring rule is written on the question', await b.waitFor(`qsel() && qsel().rule === 'b=1,m=-0.5'`, 10000) && (await source()).includes('\\scoring{b=1,m=-0.5}'));
  await typeInto('#qf-explain', 'Coty was President 1954-59.');
  b.check('The explanation is saved', await saved() && (await source()).includes('\\explain{Coty was President 1954-59.}'));
  await b.setValue('#qf-id', 'president');
  b.check('Renaming the question', await b.waitFor(`S.qform && S.qform.id === 'president' && !!document.querySelector('[data-act="q-pick"][data-id="president"]')`, 10000) && (await source()).includes('\\begin{question}{president}'));

  // ---- type
  await pick('pref');
  await b.waitFor(`qsel() && qsel().id === 'pref' && document.querySelector('#qf-kind').value === 'multiple'`, 5000);
  await b.setValue('#qf-kind', 'single');
  b.check('Multiple to single renames the environment', await b.waitFor(`qsel() && qsel().kind === 'single'`, 10000) && (await source()).includes('\\begin{question}{pref}'));
  await b.setValue('#qf-kind', 'multiple');
  b.check('...and back', await b.waitFor(`qsel() && qsel().kind === 'multiple'`, 10000) && (await source()).includes('\\begin{questionmult}{pref}'));

  // ---- a question that the form can't read
  const withMacro = (await source()).replace('\\end{questionmult}', '\\end{questionmult}\n\n\\begin{question}{odd}\n  Odd one.\n  \\myanswers\n\\end{question}');
  b.check('A question without AMC\'s answer commands is written to the source', await uploadSource(withMacro));
  await b.js('loadEditor(); true');
  b.check('It is listed with a warning', await b.waitFor(`!!document.querySelector('.q-item.is-problem[data-id="odd"]')`, 10000));
  await pick('odd');
  b.check('The form says to use LaTeX for it', await b.waitFor(`!!document.querySelector('#q-form .banner') && !document.querySelector('#qf-text')`, 5000));
  await b.click('[data-act="q-delete"]');
  await b.waitFor(`!!document.querySelector('.dialog [data-act="dialog-ok"]')`, 3000);
  await b.click('.dialog [data-act="dialog-ok"]');
  b.check('It can still be deleted', await b.waitFor(`S.qdata && !S.qdata.files[0].questions.some(q => q.id === 'odd')`, 10000) && !(await source()).includes('{odd}'));

  // ---- adding, moving, deleting
  await pick('pref');
  await b.waitFor(`qsel() && qsel().id === 'pref'`, 5000);
  await b.click('[data-act="q-add"]');
  await b.waitFor(`!!document.querySelector('.dialog [data-act="dialog-result"][data-v="numeric"]')`, 3000);
  await b.click('.dialog [data-act="dialog-result"][data-v="numeric"]');
  b.check('A numeric question is added after the selected one and opened', await b.waitFor(`qsel() && qsel().kind === 'numeric' && qsel().id === 'nq1' && document.activeElement === document.querySelector('#qf-text')`, 10000) && J(await ids()) === J(['president', 'pref', 'nq1']) && (await source()).includes('\\begin{questionmultx}{nq1}'));
  await typeInto('#qf-text', 'What is $6 \\times 7$?');
  await typeInto('#qf-num-value', '42');
  b.check('Its value is saved', await saved() && (await source()).includes('\\AMCnumericChoices{42}{digits=3,decimals=0,sign=false}'));
  await b.click('[data-act="q-move"][data-d="-1"]');
  b.check('The question moves up', await b.waitFor(`S.qdata && JSON.stringify(S.qdata.files[0].questions.map(q => q.id)) === ${J(J(['president', 'nq1', 'pref']))}`, 10000));
  await b.shot('q3-numeric');

  // ---- the paper builds with the edited questions
  await b.click('[data-act="build"]');
  await b.waitFor(`!!document.querySelector('#work')`, 10000);
  b.check('The question paper builds', await b.waitFor(`!document.querySelector('#work') && S.status && S.status.docs.sujet`, 180000));
  if (await b.js(`!!document.querySelector('.server-dialog')`)) await b.js('warn_ok(); true');
  b.check('The form is still there after the build', await b.js(`!!document.querySelector('#q-editor') && qsel() && qsel().id === 'nq1'`));

  await b.click('[data-act="q-delete"]');
  await b.waitFor(`!!document.querySelector('.dialog [data-act="dialog-ok"]')`, 3000);
  await b.click('.dialog [data-act="dialog-ok"]');
  b.check('Deleting opens the next question', await b.waitFor(`qsel() && qsel().id === 'pref' && document.querySelectorAll('.q-item').length === 2`, 10000) && !(await source()).includes('nq1'));

  // ---- Edit in LaTeX, and back
  const line = (await sel()).line;
  await b.click('[data-act="q-latex"]');
  b.check('"Edit in LaTeX" opens the editor at the question', await b.waitFor(`S.qtab === 'latex' && editor && S.source.loaded && editor.getCursorPosition().row + 1 === ${line}`, 15000), J(await b.js('editor && editor.getCursorPosition()')));
  await b.click('[data-act="qtab"][data-v="form"]');
  b.check('The Questions tab comes back', await b.waitFor(`S.qtab === 'form' && !!document.querySelector('#qf-text') && qsel()`, 15000),
    J(await b.js(`[S.qtab, !!document.querySelector('#qf-text'), !!qsel(), !!editor, !!document.querySelector('#q-editor'), !!document.querySelector('#ace-host'), S.qform, S.qdata && S.qdata.files.map(f => f.questions.length)]`)));

  // ---- a change from another tab
  b.check('Another tab changes the source', await uploadSource((await source()) + '\n% from another tab\n'));
  await typeInto('#qf-text', 'Changed in the form');
  b.check('The stale edit is refused and the questions are read again', await b.waitFor(`[...document.querySelectorAll('.toast')].some(t => t.textContent.includes('changed since')) && !S.qform.pending.length`, 15000));
  await b.waitFor('S.qform && !S.qform.saving', 5000);
  await typeInto('#qf-text', 'Changed in the form, again');
  b.check('The next edit saves', await saved() && (await source()).includes('Changed in the form, again'));

  // ---- after printing
  await b.js(`socket_emit('ui-layout-ok'); true`);
  await b.waitFor('S.status && !!S.status.layout_ok', 10000);
  await b.js(`socket_emit('ui-mark-printed'); true`);
  b.check('The exam is locked', await b.waitFor('S.status && !!S.status.lock', 10000));
  await b.waitFor(`document.querySelector('#qf-text') && document.querySelector('#qf-text').disabled`, 10000);
  b.check('Text and answers are read-only, the answer key is not', await b.js(`document.querySelector('#qf-text').disabled && document.querySelector('.qf-ans-text').disabled && !document.querySelector('.qf-ans-correct').disabled && !document.querySelector('[data-act="q-delete"]')`));
  const r = await b.js(`qop({op: 'text', latex: 'nope'}, {now: true})`);
  b.check('The server refuses a text change', r && r.locked === true);
  await b.waitFor('S.qdata && qsel()', 10000);
  const was = (await sel()).answers.map((a) => a.correct);
  await b.click('.qf-ans-correct[data-i="2"]');
  b.check('Changing the answer key still works', await b.waitFor(`qsel() && qsel().answers[2].correct === ${!was[2]}`, 10000));
  await b.shot('q4-locked');

  await b.waitFor('!S.scaleUpdating', 60000);
  b.check('The exam is deleted', await b.deleteExam(EXAM));

  // ---- an AMC-TXT exam keeps the LaTeX tab only
  await b.goto('/');
  await b.waitFor('S.online === true');
  b.check('An AMC-TXT exam is created', await createEmpty(TXT_EXAM, 'plain'));
  b.check('It opens on the text editor, without tabs', await b.waitFor(`S.route.step === 'questions' && !!document.querySelector('#ace-host') && !document.querySelector('.q-tabs')`, 15000));
  b.check('The AMC-TXT exam is deleted', await b.deleteExam(TXT_EXAM));
}

main().then(() => b.finish(), (e) => b.finish(e));
