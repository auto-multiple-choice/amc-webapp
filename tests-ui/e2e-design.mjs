#!/usr/bin/env node
/*
 * End-to-end test of Questions > Paper design: an exam from the blank
 * starter through the wizard; sections (heading, count per copy, columns,
 * shuffle, a pool too small, add, add a question to a section, move,
 * rename, remove and give back); versions; the build; History; read-only
 * after printing. Then an exam from AMC's "simple" template, whose
 * questions are written in the paper, organised into a section.
 *
 *   node tests-ui/e2e-design.mjs http://127.0.0.1:8095 [screenshots-dir]
 *
 * AMC_E2E_USER / AMC_E2E_PASS: sign in first (shared-machine mode).
 * Use a test copy of the app, never your real exams.
 */
import { startBrowser } from './cdp.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:8095';
const USER = process.env.AMC_E2E_USER || '';
const EXAM = 'Paper design test';
const EXAM2 = 'Paper design test (simple)';
const b = await startBrowser({ base: BASE, user: USER, pass: process.env.AMC_E2E_PASS || '', shots: process.argv[3] || null, qtab: 'design' });
const J = JSON.stringify;

const main = () => b.js(`getJSON('/ui/api/source?file=' + encodeURIComponent(S.status.source)).then(r => r.text)`);
const structure = () => b.js(`getJSON('/ui/api/structure')`);
const saved = () => b.waitFor('S.dform && !S.dform.saving && !S.dform.pending.length', 15000);
const typeInto = (selector, text) => b.js(`(() => { const t = document.querySelector(${J(selector)}); t.focus(); t.value = ${J(text)}; t.dispatchEvent(new Event('input', {bubbles: true})); return true; })()`);
async function settle(check) { await saved(); return b.waitFor(check, 15000); }

async function main_() {
  await b.signIn();
  await b.goto('/');
  b.check('The app opens', await b.waitFor('S.online === true'));
  await b.preflight({ exams: [EXAM, EXAM2] });

  // ---- the wizard
  b.created.add(EXAM);
  await b.goto('/new');
  await b.waitFor(`!!document.querySelector('#wiz-name')`);
  await b.setValue('#wiz-name', EXAM);
  await b.click('[data-act="wiz-next"]');
  b.check('The blank starter is among the starters', await b.waitFor(`!!S.gallery && S.gallery.templates.some(t => t.gid === 'school' && t.id === 'blank' && t.starter)`, 10000));
  await b.click('[data-act="wiz-pick"][data-gid="school"][data-id="blank"]');
  await b.click('[data-act="wiz-next"]');
  b.check('Its options ask for the answer sheet and the copies', await b.waitFor(`!!document.querySelector('#wiz-code') && !!document.querySelector('[data-wiz="copies"]')`, 5000));
  await b.setValue('[data-wiz="copies"]', '2');
  await b.shot('d1-wizard');
  await b.click('[data-act="wiz-create"]');
  b.check('Creating opens the exam on Paper design', await b.waitFor(`decodeURIComponent(location.pathname) === '/exam/${EXAM}/questions' && S.qtab === 'design' && S.design && S.design.sections && document.querySelectorAll('.d-sec').length === 1`, 30000));
  b.check('The copies from the wizard are the app\'s setting', String((await structure()).copies_setting) === '2');
  b.check('One section with its pool and marks', J(await b.js('S.design.sections.map(s => [s.name, s.count, s.pool, s.marks.right])')) === J([['general', null, 2, '1']]));
  b.check('The paper\'s layout is left to the LaTeX tab', await b.js(`document.querySelector('#d-paper').textContent.includes('edited in the LaTeX tab') && !!document.querySelector('#d-copies') && !document.querySelector('[data-act="d-summary"]')`));
  await b.shot('d2-panel');

  // ---- a section
  await b.click('[data-act="d-sec-edit"][data-name="general"]');
  await b.waitFor(`!!document.querySelector('[data-df="heading"][data-name="general"]')`, 5000);
  await typeInto('[data-df="heading"][data-name="general"]', 'Objective questions');
  b.check('The heading is saved as you type', await saved() && (await main()).includes('\\amcuiSectionHeading{Objective questions}'));
  b.check('...without pulling the field away', await b.js(`document.activeElement === document.querySelector('[data-df="heading"][data-name="general"]')`));
  await b.setValue('[data-df="count"][data-name="general"]', '1');
  b.check('Questions per copy', await settle(`S.design.sections[0].count === 1`) && (await main()).includes('\\insertgroup[1]{general}'));
  await b.setValue('[data-df="columns"][data-name="general"]', '2');
  b.check('Two columns', await settle(`S.design.sections[0].columns === 2`) && (await main()).includes('\\begin{multicols}{2}\n\\insertgroup[1]{general}\n\\end{multicols}'));
  await b.click('[data-df="shuffle"][data-name="general"]');
  b.check('Shuffle off', await settle(`S.design.sections[0].shuffle === false`) && !(await main()).includes('\\shufflegroup{general}'));
  await b.setValue('[data-df="count"][data-name="general"]', '9');
  b.check('A pool too small for the count is flagged', await settle(`document.querySelector('.d-sec[data-name="general"] .d-problem') && document.querySelector('.d-sec[data-name="general"] .d-problem').textContent.includes('Only 2 questions for 9 per copy')`));
  await b.setValue('[data-df="count"][data-name="general"]', '1');
  await settle(`S.design.sections[0].count === 1`);
  await b.shot('d3-section');
  await b.click('[data-act="d-sec-done"][data-name="general"]');

  // ---- add a section and a question in it
  await b.click('[data-act="d-sec-add"]');
  b.check('A section is added, open, flagged as empty', await settle(`JSON.stringify(S.design.sections.map(s => s.name)) === ${J(J(['general', 'section2']))} && !!document.querySelector('.d-sec.is-open[data-name="section2"]') && S.design.sections[1].problem === 'No question in this section yet.'`));
  await b.click('[data-act="d-sec-done"][data-name="section2"]');
  await b.click('[data-act="d-sec-addq"][data-name="section2"]');
  await b.waitFor(`!!document.querySelector('.dialog [data-act="dialog-result"][data-v="single"]')`, 3000);
  await b.click('.dialog [data-act="dialog-result"][data-v="single"]');
  b.check('Adding a question opens it in the form', await b.waitFor(`S.qtab === 'form' && qsel() && qsel().group === 'section2' && S.qform.file === S.status.source && !!document.querySelector('#qf-text')`, 15000));
  b.check('...wrapped in the section\'s \\element', (await main()).includes('\\element{section2}{'));
  await b.click('[data-act="qtab"][data-v="design"]');
  b.check('Back in Paper design the section has its question', await b.waitFor(`S.qtab === 'design' && S.design && S.design.sections.length === 2 && S.design.sections[1].pool === 1 && !S.design.sections[1].problem`, 15000));

  await b.click('[data-act="d-sec-move"][data-name="section2"][data-d="-1"]');
  b.check('Moving a section up', await settle(`JSON.stringify(S.design.sections.map(s => s.name)) === ${J(J(['section2', 'general']))}`));
  await b.click('[data-act="d-sec-edit"][data-name="section2"]');
  await b.waitFor(`!!document.querySelector('#df-rename')`, 5000);
  await b.setValue('#df-rename', 'extra');
  await b.click('[data-act="d-sec-rename"][data-name="section2"]');
  b.check('Renaming a section renames its questions\' group', await settle(`S.design.sections[0].name === 'extra'`) && (await main()).includes('\\element{extra}{') && !(await main()).includes('section2'));
  await b.click('[data-act="d-sec-delete"][data-name="extra"]');
  await b.waitFor(`!!document.querySelector('.dialog [data-act="dialog-ok"]')`, 3000);
  await b.click('.dialog [data-act="dialog-ok"]');
  b.check('Removing it lists its question as not printed', await settle(`S.design.sections.length === 1 && S.design.unused.length === 1 && S.design.unused[0].name === 'extra' && !!document.querySelector('[data-act="d-sec-adopt"][data-name="extra"]')`));
  await b.click('[data-act="d-sec-adopt"][data-name="extra"]');
  b.check('...and gives it back a section', await settle(`S.design.sections.some(s => s.name === 'extra' && s.pool === 1) && !S.design.unused.length`));
  await b.click('[data-act="d-sec-done"][data-name="extra"]');

  // ---- versions
  await b.setValue('#d-copies', '3');
  b.check('Versions', await settle(`S.design.copies === 3`) && (await main()).includes('\\onecopy{3}{') && String((await structure()).copies_setting) === '3');
  await b.setValue('#d-copies', '30');
  b.check('...refused out of range', await b.waitFor(`[...document.querySelectorAll('.toast')].some(t => t.textContent.includes('1 to 26'))`, 10000) && (await main()).includes('\\onecopy{3}{'));
  await b.waitFor('S.dform && !S.dform.saving', 5000);
  await b.shot('d4-versions');

  // ---- build, history
  await b.click('[data-act="build"]');
  await b.waitFor(`!!document.querySelector('#work')`, 10000);
  b.check('The paper builds', await b.waitFor(`!document.querySelector('#work') && S.status && S.status.docs.sujet`, 240000));
  if (await b.js(`!!document.querySelector('.server-dialog')`)) await b.js('warn_ok(); true');
  b.check('Paper design is still there after the build', await b.js(`!!document.querySelector('#d-panel .d-sec')`));
  await b.click('[data-act="d-history"]');
  b.check('History lists the panel\'s changes', await b.waitFor(`S.history && S.history.file === S.design.file && S.history.versions && S.history.versions.some(v => (v.what || '').startsWith('Paper design'))`, 10000));
  await b.shot('d5-built');

  // ---- after printing
  await b.js(`socket_emit('ui-layout-ok'); true`);
  await b.waitFor('S.status && !!S.status.layout_ok', 10000);
  await b.js(`socket_emit('ui-mark-printed'); true`);
  b.check('The exam is locked', await b.waitFor('S.status && !!S.status.lock', 10000));
  b.check('Paper design is read-only', await b.waitFor(`document.querySelector('#d-copies').disabled && !document.querySelector('[data-act="d-sec-add"]') && !document.querySelector('[data-act="d-sec-move"]') && !document.querySelector('[data-df="heading"]')`, 10000));
  const r = await b.js(`dop({op: 'copies', n: 2}, {now: true})`);
  b.check('The server refuses a change', r && r.locked === true);
  await b.shot('d6-locked');
  await b.waitFor('!S.scaleUpdating', 60000);
  b.check('The exam is deleted', await b.deleteExam(EXAM));

  // ---- questions written in the paper, organised into a section
  await b.goto('/');
  await b.waitFor('S.online === true');
  b.check('An exam from AMC\'s simple template', await b.createFromTemplate(EXAM2));
  b.check('Its two questions are counted as outside any section', await b.waitFor(`S.qtab === 'design' && S.design && S.design.inline === 2 && !!document.querySelector('[data-act="d-convert"]')`, 20000));
  await b.click('[data-act="d-convert"]');
  b.check('Organising makes one section of them', await settle(`S.design.inline === 0 && JSON.stringify(S.design.sections.map(s => [s.name, s.pool])) === ${J(J([['main', 2]]))}`));
  const src = await main();
  b.check('...moved into \\element blocks before the paper', (src.match(/\\element\{main\}\{/g) || []).length === 2 && src.indexOf('\\element{main}{') < src.indexOf('\\onecopy') && src.includes('%%AMCUI:SECTION main%%'));
  await b.click('[data-act="qtab"][data-v="form"]');
  b.check('The form lists them in their section', await b.waitFor(`S.qtab === 'form' && S.qdata && document.querySelectorAll('.q-item').length === 2 && [...document.querySelectorAll('.q-group')].some(g => g.textContent.includes('main'))`, 15000));
  await b.click('[data-act="build"]');
  await b.waitFor(`!!document.querySelector('#work')`, 10000);
  b.check('It still builds', await b.waitFor(`!document.querySelector('#work') && S.status && S.status.docs.sujet`, 180000));
  if (await b.js(`!!document.querySelector('.server-dialog')`)) await b.js('warn_ok(); true');
  await b.waitFor('!S.scaleUpdating', 60000);
  b.check('The second exam is deleted', await b.deleteExam(EXAM2));
}

main_().then(() => b.finish(), (e) => b.finish(e));
