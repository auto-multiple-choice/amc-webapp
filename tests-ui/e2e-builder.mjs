#!/usr/bin/env node
/*
 * End-to-end test of Questions > Paper builder: an exam from the RJ Style
 * Paper Builder through the wizard (kind of paper, layout, details,
 * versions); the canvas (select a block, its width, a typed setting,
 * rows added and removed, a block moved); the Instructions, Details and
 * Versions and page tabs; the layout file written from the design and a
 * hand edit to it; the build; History; read-only after printing.
 *
 *   node tests-ui/e2e-builder.mjs http://127.0.0.1:8095 [screenshots-dir]
 *
 * AMC_E2E_USER / AMC_E2E_PASS: sign in first (shared-machine mode).
 * Use a test copy of the app, never your real exams.
 */
import { startBrowser } from './cdp.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:8095';
const USER = process.env.AMC_E2E_USER || '';
const EXAM = 'Paper builder test';
const b = await startBrowser({ base: BASE, user: USER, pass: process.env.AMC_E2E_PASS || '', shots: process.argv[3] || null, qtab: 'design' });
const J = JSON.stringify;

const file = (name) => b.js(`getJSON('/ui/api/source?file=' + encodeURIComponent(${J(name)})).then(r => r.text)`);
const main = () => b.js(`getJSON('/ui/api/source?file=' + encodeURIComponent(S.status.source)).then(r => r.text)`);
const builder = () => b.js(`getJSON('/ui/api/builder')`);
const structure = () => b.js(`getJSON('/ui/api/structure')`);
const saved = () => b.waitFor('S.bform && !S.bform.saving && !S.bform.pending && S.dform && !S.dform.saving && !S.dform.pending.length', 15000);
const typeInto = (selector, text) => b.js(`(() => { const t = document.querySelector(${J(selector)}); t.focus(); t.value = ${J(text)}; t.dispatchEvent(new Event('input', {bubbles: true})); return true; })()`);
async function settle(check) { await saved(); return b.waitFor(check, 15000); }

async function main_() {
  await b.signIn();
  await b.goto('/');
  b.check('The app opens', await b.waitFor('S.online === true'));
  await b.preflight({ exams: [EXAM] });

  // ---- the wizard
  b.created.add(EXAM);
  await b.goto('/new');
  await b.waitFor(`!!document.querySelector('#wiz-name')`);
  await b.setValue('#wiz-name', EXAM);
  await b.click('[data-act="wiz-next"]');
  b.check('The RJ Style Paper Builder is among the starters, with its presets', await b.waitFor(`!!S.gallery && S.gallery.templates.some(t => t.gid === 'school' && t.id === 'builder' && t.builder && t.builder.presets.length === 3 && t.pages === 11)`, 10000));
  await b.click('[data-act="wiz-pick"][data-gid="school"][data-id="builder"]');
  await b.click('[data-act="wiz-next"]');
  b.check('Its options ask for the kind of paper, the layout and the details', await b.waitFor(`document.querySelectorAll('.b-presets .choice').length === 3 && !!document.querySelector('[data-bw="fields.exam_name"]') && !!document.querySelector('[data-bw="versions"]')`, 5000));
  b.check('The exam name is filled in', await b.js(`document.querySelector('[data-bw="fields.exam_name"]').value === ${J(EXAM)} && document.querySelector('[data-bw="fields.level"]').value === 'I'`));
  await b.click('[data-act="wiz-style"][data-v="separate"]');
  await b.setValue('[data-bw="fields.organiser"]', 'Test Maths Club');
  await b.setValue('[data-bw="versions"]', '3');
  await b.shot('b1-wizard');
  await b.click('[data-act="wiz-create"]');
  b.check('Creating opens the exam on the Paper builder, with the RJ rows', await b.waitFor(`decodeURIComponent(location.pathname) === '/exam/${EXAM}/questions' && S.qtab === 'design' && S.builder && S.builder.builder && document.querySelectorAll('.b-page[data-sheet="paper"] .b-row').length === 8`, 30000));
  let r = await builder();
  b.check('The wizard\'s choices are in the design and the source', r.design.kind === 'separate' && r.design.fields.organiser === 'Test Maths Club' && r.design.fields.exam_name === EXAM && r.versions === 3 && r.codes.last === 'C' && (await main()).includes('\\onecopy{3}{'));
  b.check('...the app\'s copies follow the versions', String((await structure()).copies_setting) === '3');
  b.check('The layout file is written from the design', (await file('paper-layout.tex')).includes('Test Maths Club') && r.layout.exists && !r.layout.edited && !r.detached);
  b.check('The tabs: question paper, answer sheet, instructions, details, sections, versions', await b.js(`[...document.querySelectorAll('.b-tabs [data-act="pb-tab"]')].map(t => t.dataset.v).join(',') === 'paper,sheet,instructions,details,sections,page'`));
  await b.shot('b2-canvas');

  // ---- a block and its column
  await b.click('.b-cell[data-row="r1"][data-cell="c2"]');
  b.check('Clicking a block shows its settings', await b.waitFor(`S.bform.sel.cell === 'c2' && !!document.querySelector('[data-pbc="width"]') && document.querySelector('.b-side .d-head b').textContent === 'Title lines'`, 5000));
  await b.setValue('[data-pbc="width"]', '6');
  b.check('A width is saved and written to the layout', await settle(`S.builder.design.paper[0].cells[1].width === 6`) && (await file('paper-layout.tex')).includes('*6/12\\relax'));
  await b.click('.b-cell[data-row="r2"][data-cell="c1"]');
  await b.waitFor(`!!document.querySelector('[data-pbb="id_label"]')`, 5000);
  await typeInto('[data-pbb="id_label"]', 'Roll No.');
  b.check('A typed setting is saved as you type', await saved() && (await file('paper-layout.tex')).includes('Roll No.: '));
  b.check('...without pulling the field away', await b.js(`document.activeElement === document.querySelector('[data-pbb="id_label"]') && document.querySelector('.b-cell[data-row="r2"][data-cell="c1"] .b-cell-sub').textContent.includes('Roll No.')`));
  await b.setValue('[data-pbc="width"]', '12');
  b.check('A width the row has no room for is refused', await b.waitFor(`[...document.querySelectorAll('.toast')].some(t => t.textContent.includes('of 12'))`, 5000) && await b.js(`S.builder.design.paper[1].cells[0].width === 8`));
  await b.click('[data-act="pb-cell-move"][data-d="1"]');
  b.check('A block moves within its row', await settle(`S.builder.design.paper[1].cells.map(c => c.block.type).join(',') === 'code,student,info'`));
  await b.click('[data-act="pb-cell-move"][data-d="-1"]');
  await settle(`S.builder.design.paper[1].cells.map(c => c.block.type).join(',') === 'student,code,info'`);
  await b.shot('b3-block');

  // ---- rows
  await b.setValue('[data-pb-addrow="paper"]', '1');
  b.check('A row is added with two equal columns, the first selected', await settle(`S.builder.design.paper.length === 9 && S.builder.design.paper[8].cells.length === 2 && S.builder.design.paper[8].cells[0].width === 'auto' && S.bform.sel.row === S.builder.design.paper[8].id`));
  await b.setValue('[data-pb-type]', 'end');
  b.check('The block of a column can change', await settle(`S.builder.design.paper[8].cells[0].block.type === 'end'`));
  await b.click('[data-act="pb-row-move"][data-row="r9"][data-d="-1"]');
  b.check('A row moves up', await settle(`S.builder.design.paper[7].id === 'r9'`));
  await b.click('[data-act="pb-row-delete"][data-row="r9"]');
  await b.waitFor(`!!document.querySelector('.dialog [data-act="dialog-ok"]')`, 3000);
  await b.click('.dialog [data-act="dialog-ok"]');
  b.check('A row is removed', await settle(`S.builder.design.paper.length === 8 && !S.builder.design.paper.some(r => r.id === 'r9')`));

  // ---- the answer sheet and its checks
  await b.click('[data-act="pb-tab"][data-v="sheet"]');
  b.check('The answer sheet has its rows', await b.waitFor(`S.bform.tab === 'sheet' && document.querySelectorAll('.b-page[data-sheet="sheet"] .b-row').length === 5`, 5000));
  await b.click('.b-cell[data-row="s5"][data-cell="c1"]');
  await b.waitFor(`!!document.querySelector('[data-act="pb-cell-delete"]')`, 5000);
  await b.click('[data-act="pb-cell-delete"]');
  b.check('Removing the choice answers is flagged on the sheet', await settle(`S.builder.design.answer_sheet.length === 4 && S.builder.problems.some(p => p.level === 'error' && p.sheet === 'sheet' && p.text.includes('answer boxes'))`) && await b.js(`!!document.querySelector('.b-tabs [data-v="sheet"] .chip')`));
  await b.click('[data-act="build"]');
  b.check('...and the build is refused with the reason', await b.waitFor(`!!document.querySelector('.server-dialog') && document.querySelector('.server-dialog').textContent.includes('answer boxes')`, 15000));
  await b.js('warn_ok(); true');
  await b.setValue('[data-pb-addrow="sheet"]', '0');
  await settle(`S.builder.design.answer_sheet.length === 5`);
  await b.setValue('[data-pb-type]', 'all_answers');
  b.check('An All answers block next to Numeric answers is flagged too (AMC refuses boxes printed twice)', await settle(`S.builder.design.answer_sheet[4].cells[0].block.type === 'all_answers' && S.builder.problems.some(p => p.level === 'error' && p.text.includes('twice'))`));
  await b.setValue('[data-pb-type]', 'choice_answers');
  b.check('A Choice answers block clears the check', await settle(`S.builder.design.answer_sheet[4].cells[0].block.type === 'choice_answers' && !S.builder.problems.some(p => p.level === 'error')`));
  await b.shot('b4-sheet');

  // ---- instructions, details, versions and page
  await b.click('[data-act="pb-tab"][data-v="instructions"]');
  b.check('The instructions list its items and the line per section', await b.waitFor(`!!document.querySelector('[data-pbd="instructions.heading"]') && document.querySelectorAll('.b-summary-lines li').length === 3 && document.querySelectorAll('[data-pbd^="instructions.items."]').length === 4`, 5000));
  await b.click('[data-act="pb-ins-add"]');
  await settle(`S.builder.design.instructions.items.length === 6`);
  await typeInto('[data-pbd="instructions.items.5.latex"]', 'Use a \\textbf{black} pen: $x^2$.');
  b.check('An item is added, typed and previewed', await saved() && (await file('paper-layout.tex')).includes('\\amcuiPoint{Use a \\textbf{black} pen: $x^2$.}') && await b.js(`document.querySelector('[data-pb-preview="instructions.items.5.latex"]').innerHTML.includes('<b>black</b>')`));
  await b.click('[data-act="pb-tab"][data-v="details"]');
  await b.waitFor(`!!document.querySelector('[data-pbd="fields.exam_name"]')`, 5000);
  await typeInto('[data-pbd="fields.exam_name"]', 'Olympiad & Co');
  b.check('A detail is saved, escaped for LaTeX', await saved() && (await file('paper-layout.tex')).includes('Olympiad \\& Co'));
  await b.click('[data-act="pb-tab"][data-v="page"]');
  await b.waitFor(`!!document.querySelector('#pb-versions')`, 5000);
  await b.setValue('#pb-versions', '30');
  b.check('30 versions: the codes go past Z', await b.waitFor(`S.builder.versions === 30 && S.builder.codes.last === 'AD'`, 15000) && (await main()).includes('\\onecopy{30}{') && String((await structure()).copies_setting) === '30' && (await file('paper-layout.tex')).includes('\\or AA\\or AB\\or AC\\or AD\\fi'));
  await b.click('[data-act="pb-kind"][data-v="paper"]');
  b.check('Answers on the question paper: the sheet tab goes, the name field moves to the paper', await settle(`S.builder.design.kind === 'paper' && !document.querySelector('.b-tabs [data-v="sheet"]')`) && (await file('paper-layout.tex')).indexOf('\\namefield{') < (await file('paper-layout.tex')).indexOf('\\amcuiPaperBack') && !(await file('paper-layout.tex')).includes('separateanswersheet'));
  await b.click('[data-act="pb-kind"][data-v="separate"]');
  await settle(`S.builder.design.kind === 'separate'`);
  await b.shot('b5-page');

  // ---- the layout file edited by hand
  await b.click('[data-act="qtab"][data-v="latex"]');
  await b.waitFor(`S.qtab === 'latex' && S.source.loaded`, 15000);
  const layout = await file('paper-layout.tex');
  const dg = await b.js(`getJSON('/ui/api/source?file=paper-layout.tex').then(r => r.digest)`);
  const saveR = await b.js(`fetch('/ui/api/source', {method: 'POST', headers: {...headers(), 'Content-Type': 'application/json'}, body: JSON.stringify({file: 'paper-layout.tex', text: ${J(layout + '% my own edit\n')}, based_on: ${J(dg)}})}).then(r => r.json())`);
  b.check('The layout file can be saved by hand', saveR && saveR.ok === true);
  await b.click('[data-act="qtab"][data-v="design"]');
  b.check('The builder notices the hand edit', await b.waitFor(`S.qtab === 'design' && S.builder && S.builder.layout.edited && !!document.querySelector('[data-act="pb-layout"][data-v="keep"]')`, 15000));
  await b.click('[data-act="pb-layout"][data-v="keep"]');
  b.check('"Keep my changes": the builder stops writing the file', await b.waitFor(`S.builder.detached && !!document.querySelector('[data-act="pb-layout"][data-v="rewrite"]')`, 10000));
  await b.click('[data-act="pb-tab"][data-v="details"]');
  await b.waitFor(`!!document.querySelector('[data-pbd="fields.level"]')`, 5000);
  await typeInto('[data-pbd="fields.level"]', 'II');
  b.check('...a change is kept in the design but not written to the file', await saved() && (await builder()).design.fields.level === 'II' && (await file('paper-layout.tex')).includes('% my own edit') && !(await file('paper-layout.tex')).includes('Level II'));
  await b.click('[data-act="pb-layout"][data-v="rewrite"]');
  b.check('"Rewrite it": the file follows the design again', await b.waitFor(`!S.builder.detached && !S.builder.layout.edited`, 10000) && (await file('paper-layout.tex')).includes('Level II') && !(await file('paper-layout.tex')).includes('% my own edit'));

  // ---- build, history
  await b.click('[data-act="pb-tab"][data-v="paper"]');
  await b.waitFor(`S.bform.tab === 'paper'`, 5000);
  await b.click('[data-act="build"]');
  await b.waitFor(`!!document.querySelector('#work')`, 10000);
  b.check('The paper builds', await b.waitFor(`!document.querySelector('#work') && S.status && S.status.docs.sujet`, 300000));
  if (await b.js(`!!document.querySelector('.server-dialog')`)) await b.js('warn_ok(); true');
  b.check('The builder is still there after the build', await b.js(`!!document.querySelector('#d-panel .b-page')`));
  await b.click('[data-act="pb-history"]');
  b.check('History lists the design\'s changes', await b.waitFor(`S.history && S.history.file === 'paper.json' && S.history.versions && S.history.versions.some(v => (v.what || '').startsWith('Paper builder'))`, 10000));
  await b.shot('b6-built');

  // ---- after printing
  await b.js(`socket_emit('ui-layout-ok'); true`);
  await b.waitFor('S.status && !!S.status.layout_ok', 10000);
  await b.js(`socket_emit('ui-mark-printed'); true`);
  b.check('The exam is locked', await b.waitFor('S.status && !!S.status.lock', 10000));
  await b.click('.b-cell[data-row="r1"][data-cell="c2"]');
  b.check('The builder is read-only', await b.waitFor(`!document.querySelector('[data-pb-addrow]') && !document.querySelector('.b-handle') && document.querySelector('[data-pbc="width"]') && document.querySelector('[data-pbc="width"]').disabled`, 10000));
  const refused = await b.js(`fetch('/ui/api/builder', {method: 'POST', headers: {...headers(), 'Content-Type': 'application/json'}, body: JSON.stringify({based_on: S.builder.digest, design: S.builder.design, what: 'test'})}).then(r => r.json())`);
  b.check('The server refuses a change', refused && refused.locked === true);
  await b.shot('b7-locked');
  await b.waitFor('!S.scaleUpdating', 60000);
  b.check('The exam is deleted', await b.deleteExam(EXAM));
}

main_().then(() => b.finish(), (e) => b.finish(e));
