#!/usr/bin/env node
/*
 * End-to-end test of Questions > Paper design: an exam from the Olympiad
 * paper starter through the wizard (its settings, parts left out,
 * versions); sections (heading, count per copy, columns, shuffle, a pool
 * too small, add, add a question to a section, move, rename, remove and
 * give back); parts of the paper (off and on, move, settings, the
 * instructions summary); versions; the build; History; read-only after
 * printing. Then an exam from AMC's "simple" template, whose questions
 * are written in the paper, organised into a section.
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

const file = (name) => b.js(`getJSON('/ui/api/source?file=' + encodeURIComponent(${J(name)})).then(r => r.text)`);
const main = () => b.js(`getJSON('/ui/api/source?file=' + encodeURIComponent(S.status.source)).then(r => r.text)`);
const structure = () => b.js(`getJSON('/ui/api/structure')`);
const saved = () => b.waitFor('S.dform && !S.dform.saving && !S.dform.pending.length', 15000);
const typeInto = (selector, text) => b.js(`(() => { const t = document.querySelector(${J(selector)}); t.focus(); t.value = ${J(text)}; t.dispatchEvent(new Event('input', {bubbles: true})); return true; })()`);
const bodyBlocks = () => b.js('S.design.blocks.filter(x => x.in_body).map(x => x.id)');
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
  b.check('The Olympiad paper is among the starters', await b.waitFor(`!!S.gallery && S.gallery.templates.some(t => t.gid === 'school' && t.id === 'olympiad' && t.design)`, 10000));
  await b.click('[data-act="wiz-pick"][data-gid="school"][data-id="olympiad"]');
  await b.click('[data-act="wiz-next"]');
  b.check('Its options ask for the paper\'s settings and parts', await b.waitFor(`!!document.querySelector('[data-wizp="Organiser"]') && document.querySelectorAll('[data-wizb]').length === 10 && document.querySelector('[data-wizb="omr"]').disabled`, 5000));
  b.check('The exam name and the starter\'s values are filled in', await b.js(`document.querySelector('[data-wizp="ExamName"]').value === ${J(EXAM)} && document.querySelector('[data-wizp="Level"]').value === 'I'`));
  await b.setValue('[data-wizp="Organiser"]', 'Test Maths Club');
  await b.click('[data-wizb="values"]');
  await b.setValue('[data-wizv]', '2');
  await b.shot('d1-wizard');
  await b.click('[data-act="wiz-create"]');
  b.check('Creating opens the exam on Paper design', await b.waitFor(`decodeURIComponent(location.pathname) === '/exam/${EXAM}/questions' && S.qtab === 'design' && S.design && S.design.sections && document.querySelectorAll('.d-sec').length === 3`, 30000));
  let src = await main();
  b.check('The wizard\'s choices are in the source', src.includes('\\def\\amcuiOrganiser{Test Maths Club}') && src.includes('%%AMCUI:BLOCK values off%%') && src.includes('\\onecopy{2}{'));
  b.check('...and the app\'s copies follow the versions', String((await structure()).copies_setting) === '2');
  b.check('Three sections with their pools and marks', J(await b.js('S.design.sections.map(s => [s.name, s.count, s.pool, s.marks.right])')) === J([['sectionI', 3, 4, '3'], ['sectionII', null, 2, '5'], ['numerical', null, 2, '5']]));
  b.check('The parts of the paper, the left-out one unticked', await b.js(`document.querySelectorAll('.d-block-on').length === 10 && !document.querySelector('.d-block-on[data-id="values"]').checked && document.querySelector('.d-block-on[data-id="omr"]').disabled`));
  await b.shot('d2-panel');

  // ---- a section
  await b.click('[data-act="d-sec-edit"][data-name="sectionI"]');
  await b.waitFor(`!!document.querySelector('[data-df="heading"][data-name="sectionI"]')`, 5000);
  await typeInto('[data-df="heading"][data-name="sectionI"]', 'Objective questions');
  b.check('The heading is saved as you type', await saved() && (await main()).includes('\\amcuiSectionHeading{Objective questions}'));
  b.check('...without pulling the field away', await b.js(`document.activeElement === document.querySelector('[data-df="heading"][data-name="sectionI"]')`));
  await b.setValue('[data-df="count"][data-name="sectionI"]', '2');
  b.check('Questions per copy', await settle(`S.design.sections[0].count === 2`) && (await main()).includes('\\insertgroup[2]{sectionI}'));
  await b.setValue('[data-df="columns"][data-name="sectionI"]', '2');
  b.check('Two columns', await settle(`S.design.sections[0].columns === 2`) && (await main()).includes('\\begin{multicols}{2}\n\\insertgroup[2]{sectionI}\n\\end{multicols}'));
  await b.click('[data-df="shuffle"][data-name="sectionI"]');
  b.check('Shuffle off', await settle(`S.design.sections[0].shuffle === false`) && !(await main()).includes('\\shufflegroup{sectionI}'));
  await b.setValue('[data-df="count"][data-name="sectionI"]', '9');
  b.check('A pool too small for the count is flagged', await settle(`document.querySelector('.d-sec[data-name="sectionI"] .d-problem') && document.querySelector('.d-sec[data-name="sectionI"] .d-problem').textContent.includes('Only 4 questions for 9 per copy')`));
  await b.setValue('[data-df="count"][data-name="sectionI"]', '2');
  await settle(`S.design.sections[0].count === 2`);
  await b.shot('d3-section');
  await b.click('[data-act="d-sec-done"][data-name="sectionI"]');

  // ---- add a section and a question in it
  await b.click('[data-act="d-sec-add"]');
  b.check('A section is added, open, flagged as empty', await settle(`JSON.stringify(S.design.sections.map(s => s.name)) === ${J(J(['sectionI', 'sectionII', 'numerical', 'section4']))} && !!document.querySelector('.d-sec.is-open[data-name="section4"]') && S.design.sections[3].problem === 'No question in this section yet.'`));
  await b.click('[data-act="d-sec-done"][data-name="section4"]');
  await b.click('[data-act="d-sec-addq"][data-name="section4"]');
  await b.waitFor(`!!document.querySelector('.dialog [data-act="dialog-result"][data-v="single"]')`, 3000);
  await b.click('.dialog [data-act="dialog-result"][data-v="single"]');
  b.check('Adding a question opens it in the form, in the questions file', await b.waitFor(`S.qtab === 'form' && qsel() && qsel().group === 'section4' && S.qform.file === 'questions.tex' && !!document.querySelector('#qf-text')`, 15000));
  b.check('...wrapped in the section\'s \\element', (await file('questions.tex')).includes('\\element{section4}{'));
  await b.click('[data-act="qtab"][data-v="design"]');
  b.check('Back in Paper design the section has its question', await b.waitFor(`S.qtab === 'design' && S.design && S.design.sections.length === 4 && S.design.sections[3].pool === 1 && !S.design.sections[3].problem`, 15000));

  await b.click('[data-act="d-sec-move"][data-name="section4"][data-d="-1"]');
  b.check('Moving a section up', await settle(`JSON.stringify(S.design.sections.map(s => s.name)) === ${J(J(['sectionI', 'sectionII', 'section4', 'numerical']))}`));
  await b.click('[data-act="d-sec-edit"][data-name="section4"]');
  await b.waitFor(`!!document.querySelector('#df-rename')`, 5000);
  await b.setValue('#df-rename', 'extra');
  await b.click('[data-act="d-sec-rename"][data-name="section4"]');
  b.check('Renaming a section renames its questions\' group', await settle(`S.design.sections[2].name === 'extra'`) && (await file('questions.tex')).includes('\\element{extra}{') && !(await file('questions.tex')).includes('section4'));
  await b.click('[data-act="d-sec-delete"][data-name="extra"]');
  await b.waitFor(`!!document.querySelector('.dialog [data-act="dialog-ok"]')`, 3000);
  await b.click('.dialog [data-act="dialog-ok"]');
  b.check('Removing it lists its question as not printed', await settle(`S.design.sections.length === 3 && S.design.unused.length === 1 && S.design.unused[0].name === 'extra' && !!document.querySelector('[data-act="d-sec-adopt"][data-name="extra"]')`));
  await b.click('[data-act="d-sec-adopt"][data-name="extra"]');
  b.check('...and gives it back a section', await settle(`S.design.sections.some(s => s.name === 'extra' && s.pool === 1) && !S.design.unused.length`));
  await b.click('[data-act="d-sec-done"][data-name="extra"]');

  // ---- parts of the paper
  await b.click('.d-block-on[data-id="notation"]');
  b.check('Unticking a part leaves it out, its text kept', await settle(`!S.design.blocks.find(x => x.id === 'notation').on && document.querySelector('.d-block[data-id="notation"]').classList.contains('is-off')`) && (await main()).includes('%%AMCUI:BLOCK notation off%%\n%|\\clearpage'));
  await b.click('.d-block-on[data-id="notation"]');
  b.check('Ticking it brings it back as it was', await settle(`S.design.blocks.find(x => x.id === 'notation').on`) && (await main()).includes('%%AMCUI:BLOCK notation%%\n\\clearpage\n\\centerline{\\bfseries\\Large Notation}'));
  await b.click('[data-act="d-block-move"][data-id="rough"][data-d="-1"]');
  b.check('Moving a part up', await settle(`JSON.stringify(S.design.blocks.filter(x => x.in_body).map(x => x.id).slice(-4)) === ${J(J(['rough', 'sections', 'fill', 'omr']))}`), J(await bodyBlocks()));
  await b.click('[data-act="d-block-move"][data-id="rough"][data-d="1"]');
  b.check('...and down again, past the sections', await settle(`JSON.stringify(S.design.blocks.filter(x => x.in_body).map(x => x.id).slice(-4)) === ${J(J(['sections', 'rough', 'fill', 'omr']))}`), J(await bodyBlocks()));
  b.check('The OMR sheet can\'t move, nor anything go after it', await b.js(`!document.querySelector('[data-act="d-block-move"][data-id="omr"]') && document.querySelector('[data-act="d-block-move"][data-id="fill"][data-d="1"]').disabled`));
  await b.click('[data-act="d-block-settings"][data-id="title"]');
  await b.waitFor(`!!document.querySelector('[data-dp="ExamName"]')`, 5000);
  await typeInto('[data-dp="ExamName"]', 'Olympiad & Co');
  b.check('A setting is saved, escaped for LaTeX', await saved() && (await main()).includes('\\def\\amcuiExamName{Olympiad \\& Co}'));
  await b.click('[data-act="d-block-done"][data-id="title"]');
  await b.click('[data-act="d-block-settings"][data-id="header-boxes"]');
  await b.waitFor(`!!document.querySelector('[data-dp="RegDigits"]')`, 5000);
  await b.setValue('[data-dp="RegDigits"]', '4');
  b.check('A number setting', await settle(`S.design.params.find(p => p.id === 'RegDigits').value === 4`) && (await main()).includes('\\def\\amcuiRegDigits{4}'));
  await b.setValue('[data-dp="RegDigits"]', '40');
  b.check('...refused out of range', await b.waitFor(`[...document.querySelectorAll('.toast')].some(t => t.textContent.includes('between 1 and 8'))`, 10000) && (await main()).includes('\\def\\amcuiRegDigits{4}'));
  await b.waitFor('S.dform && !S.dform.saving', 5000);
  await b.click('[data-act="d-block-done"][data-id="header-boxes"]');
  await b.click('[data-act="d-summary"]');
  src = await settle('true') && await main();
  b.check('The instructions summary follows the sections', src.includes('\\textbf{Section 1 (Objective questions):} 2 questions, each with exactly one correct answer.') && src.includes('\\textbf{Section 4 (extra):} 1 question,'));
  await b.setValue('#d-copies', '3');
  b.check('Versions', await settle(`S.design.copies === 3`) && (await main()).includes('\\onecopy{3}{') && String((await structure()).copies_setting) === '3');
  await b.shot('d4-parts');

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
  b.check('Paper design is read-only', await b.waitFor(`[...document.querySelectorAll('.d-block-on')].every(x => x.disabled) && !document.querySelector('[data-act="d-sec-add"]') && !document.querySelector('[data-act="d-sec-move"]')`, 10000));
  const r = await b.js(`dop({op: 'block_set', id: 'notation', on: false}, {now: true})`);
  b.check('The server refuses a change', r && r.locked === true);
  await b.shot('d6-locked');
  await b.waitFor('!S.scaleUpdating', 60000);
  b.check('The exam is deleted', await b.deleteExam(EXAM));

  // ---- questions written in the paper, organised into a section
  await b.goto('/');
  await b.waitFor('S.online === true');
  b.check('An exam from AMC\'s simple template', await b.createFromTemplate(EXAM2));
  b.check('Its two questions are counted as outside any section', await b.waitFor(`S.qtab === 'design' && S.design && S.design.inline === 2 && !!document.querySelector('[data-act="d-convert"]')`, 20000));
  b.check('The paper has no parts to switch', await b.js(`!document.querySelector('.d-block-on') && document.querySelector('#d-paper').textContent.includes('no parts to switch')`));
  await b.click('[data-act="d-convert"]');
  b.check('Organising makes one section of them', await settle(`S.design.inline === 0 && JSON.stringify(S.design.sections.map(s => [s.name, s.pool])) === ${J(J([['main', 2]]))}`));
  src = await main();
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
