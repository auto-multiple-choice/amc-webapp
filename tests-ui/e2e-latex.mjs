#!/usr/bin/env node
/*
 * End-to-end test of LaTeX for pro users (server/ui_latex.py): the Form |
 * LaTeX switch on a question (an item's file, and a question written
 * inline), saves refused with the line when the LaTeX doesn't balance,
 * "Check this question" with its picture and its errors, the choice
 * remembered, a section edited as one LaTeX document (reordered, an item
 * added), build errors traced to the item's file and opened there, and
 * completion of the exam's macros and question names.
 *
 *   node tests-ui/e2e-latex.mjs http://127.0.0.1:8095 [screenshots-dir]
 *
 * AMC_E2E_USER / AMC_E2E_PASS: sign in first (shared-machine mode).
 * Use a test copy of the app, never your real exams.
 */
import { startBrowser } from './cdp.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:8095';
const EXAM = 'LaTeX test';
const IEXAM = 'LaTeX inline test';
const b = await startBrowser({ base: BASE, user: process.env.AMC_E2E_USER || '', pass: process.env.AMC_E2E_PASS || '', shots: process.argv[3] || null, qtab: 'form' });
const J = JSON.stringify;
const file = (name) => b.js(`getJSON('/ui/api/source?file=' + encodeURIComponent(${J(name)})).then(r => r.text ?? null).catch(() => null)`);
const pools = async () => (await file('pools.tex')).split('\n').filter((l) => l.startsWith('\\element')).map((l) => l.replace(/.*amcuiItem\{([^}]*)\}.*/, '$1'));

async function main() {
  await b.signIn();
  await b.goto('/');
  b.check('The app opens', await b.waitFor('S.online === true'));
  await b.preflight({ exams: [EXAM, IEXAM] });
  b.created.add(EXAM);
  await b.js(`store.set('qmode', 'form'); S.qmode = 'form'; S.qtab = 'form'; store.set('qtab', 'form'); S.creating = ${J(EXAM)}; socket_emit('ui-create-exam', {name: ${J(EXAM)}, gid: 'school', id: 'blank', style: 'paper'}); true`);
  b.check('A new exam opens on the form', await b.waitFor(`S.project === ${J(EXAM)} && S.qdata && S.qdata.files.some(f => f.item) && !!document.querySelector('[data-act="q-mode"][data-v="latex"]')`, 60000));

  // ---- the LaTeX view of an item
  await b.click('[data-act="q-mode"][data-v="latex"]');
  b.check('LaTeX shows the item\'s file in an editor', await b.waitFor(`S.qmode === 'latex' && !!qlEditor && qlEditor.getValue().startsWith('\\\\begin{question}{example-single}') && document.querySelector('#ql-state').textContent === 'Saved'`, 10000));
  b.check('...with completion of AMC\'s environments and the exam\'s names', await b.waitFor(`S.completions && S.completions.ids.includes('example-multiple')`, 10000)
    && await b.js(`!!qlEditor.getOption('enableLiveAutocompletion')`));
  const original = await b.js('qlEditor.getValue()');
  await b.js(`qlEditor.setValue(${J(original.replace('Write a question that has exactly one correct answer.', 'What is $2+2$? {'))}, -1); true`);
  b.check('Typing marks it unsaved', await b.waitFor(`S.ql.dirty && document.querySelector('#ql-state').textContent === 'Unsaved changes' && !document.querySelector('#ql-save').disabled`, 3000));
  await b.click('[data-act="ql-save"]');
  b.check('A brace that is never closed is refused, with its line', await b.waitFor(`document.querySelector('#ql-result') && /Line 2/.test(document.querySelector('#ql-result').textContent) && S.ql.dirty`, 10000)
    && !(await file('items/example-single/item.tex')).includes('2+2'), await b.js(`(document.querySelector('#ql-result') || {}).textContent`));
  await b.js(`qlEditor.setValue(${J(original.replace('Write a question that has exactly one correct answer.', 'What is $2+2$?'))}, -1); true`);
  await b.click('[data-act="ql-check"]');
  b.check('"Check this question" compiles it and shows how it prints', await b.waitFor(`S.ql && S.ql.result && S.ql.result.ok === true && !!document.querySelector('.ql-pic img')`, 120000), J(await b.js('S.ql && S.ql.result')));
  await b.shot('l1-check');
  await b.js('qlSave(); true');
  b.check('Saving writes the item file', await b.waitFor(`S.ql && !S.ql.dirty`, 15000) && (await file('items/example-single/item.tex')).includes('What is $2+2$?'));
  const h = await b.js(`getJSON('/ui/api/history')`);
  b.check('...as a version of that file', h.versions[0].files.map((f) => f.file).join(',') === 'items/example-single/item.tex', J(h.versions[0]));
  await b.js(`qlEditor.setValue(qlEditor.getValue().replace('What is $2+2$?', 'What is \\\\notamacro{2}?'), -1); true`);
  await b.click('[data-act="ql-check"]');
  b.check('A check that fails says what and where', await b.waitFor(`S.ql && S.ql.result && S.ql.result.ok === false && /Undefined control sequence/.test(document.querySelector('#ql-result').textContent) && !!document.querySelector('[data-act="ql-goto"]')`, 120000), J(await b.js('S.ql && S.ql.result')));
  await b.js('qlEditor.setValue(qlEditor.getValue().replace("\\\\notamacro{2}", "2+2"), -1); true');
  await b.click('[data-act="q-pick"][data-id="example-multiple"]');
  b.check('Leaving the question saves what was typed', await b.waitFor(`S.qform.id === 'example-multiple' && S.ql && S.ql.file === 'items/example-multiple/item.tex'`, 15000)
    && (await file('items/example-single/item.tex')).includes('What is 2+2?'));
  await b.goto(`/exam/${encodeURIComponent(EXAM)}/questions`);
  b.check('The choice of LaTeX is remembered', await b.waitFor(`S.qmode === 'latex' && !!qlEditor`, 15000));

  // ---- a section as one LaTeX document
  await b.click('[data-act="qtab"][data-v="design"]');
  await b.waitFor(`!!document.querySelector('[data-act="d-sec-latex"]')`, 15000);
  await b.click('[data-act="d-sec-latex"]');
  b.check('A section opens as one document, with a separator line per item', await b.waitFor(`!!slEditor && slEditor.getValue().startsWith('%%%% item example-single %%%%') && slEditor.getValue().includes('%%%% item example-multiple %%%%')`, 10000));
  const doc = await b.js('slEditor.getValue()');
  const parts = doc.split(/(?=%%%% item )/);
  const added = '%%%% item extra-one %%%%\n\\begin{question}{extra-one}\n  A new one\n  \\begin{choices}\\correctchoice{Yes}\\wrongchoice{No}\\end{choices}\n\\end{question}\n\n';
  await b.js(`slEditor.setValue(${J(parts[1] + parts[0] + added)}, -1); true`);
  await b.click('[data-act="sl-save"]');
  b.check('Saving first says what will happen', await b.waitFor(`/1 item added \\(extra-one\\)/.test(document.querySelector('#sl-msg').textContent) && /order changed/.test(document.querySelector('#sl-msg').textContent)`, 10000),
    await b.js(`document.querySelector('#sl-msg').textContent`));
  await b.shot('l2-section');
  await b.click('[data-act="sl-apply"]');
  b.check('...then reorders the section and adds the item', await b.waitFor(`!document.querySelector('#sl-host')`, 10000) && J(await pools()) === J(['example-multiple', 'example-single', 'extra-one'])
    && (await file('items/extra-one/item.tex')).includes('A new one'), J(await pools()));
  await b.click('[data-act="d-sec-latex"]');
  await b.waitFor(`!!slEditor && slEditor.getValue().includes('extra-one')`, 10000);
  await b.js(`slEditor.setValue(slEditor.getValue().replace('%%%% item extra-one %%%%', '%%% item extra-one'), -1); true`);
  await b.click('[data-act="sl-save"]');
  b.check('A changed separator is refused, never guessed', await b.waitFor(`/separator line was changed/.test(document.querySelector('#sl-msg').textContent)`, 10000));
  await b.js('closeDialog(); true');

  // ---- build errors point to the item's file
  await b.js(`fetch('/ui/api/source', {method: 'POST', headers: {...headers(), 'Content-Type': 'application/json'}, body: JSON.stringify({file: 'items/extra-one/item.tex', text: '\\\\begin{question}{extra-one}\\n  A new one \\\\brokenmacro\\n  \\\\begin{choices}\\\\correctchoice{Yes}\\\\wrongchoice{No}\\\\end{choices}\\n\\\\end{question}\\n', based_on: ''})}).then(r => r.json())`);
  await b.click('[data-act="qtab"][data-v="form"]');
  await b.js(`S.buildError = false; socket_emit('doc-update', 'sujet'); true`);
  b.check('A failed build names the item\'s file, line and question', await b.waitFor(`S.buildErr && S.buildErr.file === 'items/extra-one/item.tex' && S.buildErr.line === 2 && S.buildErr.question === 'extra-one' && !!document.querySelector('[data-act="build-err-open"]')`, 240000),
    J(await b.js('S.buildErr')));
  if (await b.js(`!!document.querySelector('.server-dialog')`)) await b.js('warn_ok(); true');
  await b.shot('l3-build-error');
  await b.click('[data-act="build-err-open"]');
  b.check('"Open it" opens that question in LaTeX', await b.waitFor(`S.qmode === 'latex' && S.qform.id === 'extra-one' && !!qlEditor && qlEditor.getValue().includes('brokenmacro')`, 10000));
  await b.waitFor('!S.scaleUpdating', 60000);
  b.check('The exam is deleted', await b.deleteExam(EXAM));

  // ---- a question written inline: its own LaTeX
  await b.goto('/exams');
  await b.waitFor(`typeof S !== 'undefined' && S.online === true && Array.isArray(S.projects)`, 15000);
  b.check('An exam from AMC\'s simple template', await b.createFromTemplate(IEXAM, 'en/simple'));
  await b.goto(`/exam/${encodeURIComponent(IEXAM)}/questions`);
  b.check('Its question opens in LaTeX as its own \\begin…\\end', await b.waitFor(`S.qmode === 'latex' && !!qlEditor && /^\\\\begin\\{question/.test(qlEditor.getValue()) && /\\\\end\\{question(mult)?\\}$/.test(qlEditor.getValue().trim())`, 20000),
    await b.js('qlEditor && qlEditor.getValue().slice(0, 80)'));
  const qid = await b.js('S.qform.id');
  await b.js(`qlEditor.setValue(qlEditor.getValue().replace(/\\{${qid}\\}/, '{renamed-q}'), -1); true`);
  await b.js('qlSave(); true');
  b.check('Saving rewrites only that question in the main file', await b.waitFor(`S.qform && S.qform.id === 'renamed-q'`, 15000) && (await file(await b.js('S.status.source'))).includes('{renamed-q}'));
  await b.waitFor('!S.scaleUpdating', 60000);
  b.check('The exam is deleted', await b.deleteExam(IEXAM));
  await b.js(`store.set('qmode', 'form'); true`);
}

main().then(() => b.finish(), (e) => b.finish(e));
