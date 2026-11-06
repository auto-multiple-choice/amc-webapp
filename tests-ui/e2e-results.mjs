#!/usr/bin/env node
/*
 * End-to-end test of the results steps (Mark, Match students, Export
 * marks, Annotate).
 *
 *   node tests-ui/e2e-results.mjs http://127.0.0.1:8095 [screenshots-dir]
 *
 * It makes a 4-copy exam with student code boxes, builds and locks it,
 * makes test scans (tests-ui/make_scans.py) with the codes filled in, one
 * page left out and one rule-breaking answer, uploads them, then works
 * through the four steps.
 *
 * AMC_E2E_CONTAINER: the app's container (default amc-uitest).
 * AMC_E2E_USER / AMC_E2E_PASS: sign in first (shared-machine mode).
 * AMC_E2E_KEEP=1: keep the test exam afterwards, to look at it.
 * Use a test copy of the app, never your real exams.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startBrowser, sleep } from './cdp.mjs';
import { appContainer, makeScans, printedExam } from './fixtures.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:8095';
const USER = process.env.AMC_E2E_USER || '';
const CONTAINER = appContainer(BASE);
const EXAM = 'Results test exam';
const COPIES = 4;
const b = await startBrowser({ base: BASE, user: USER, pass: process.env.AMC_E2E_PASS || '', shots: process.argv[3] || null });
const J = JSON.stringify;
const sheet = (s, c = 0) => `S.students.sheets.find(x => x.student === ${s} && x.copy === ${c})`;
const typeSearch = async (text) => {
  await b.js(`(() => { const f = document.querySelector('#match-search'); f.focus(); f.value = ${J(text)}; f.dispatchEvent(new Event('input', {bubbles: true})); return true; })()`);
};
const enterInSearch = () => b.js(`document.querySelector('#match-search').dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true})); true`);
const fetchInfo = (url) => b.js(`fetch(${J(url)}, {cache: 'no-store'}).then(async r => ({status: r.status, type: r.headers.get('content-type') || '', size: (await r.arrayBuffer()).byteLength}))`);
const dismissServerDialog = async () => {
  if (await b.waitFor(`!!document.querySelector('.server-dialog')`, 1500)) {
    console.log('  server message: ' + (await b.text('.server-dialog')).replace(/\s+/g, ' ').slice(0, 240));
    await b.js('warn_ok(); true');
  }
};

async function main() {
  await b.signIn();
  await b.goto('/');
  b.check('The app opens', await b.waitFor('S.online === true'));
  await b.preflight({ exams: [EXAM] });

  // A printed exam with code boxes, and its scans
  await printedExam(b, { name: EXAM, copies: COPIES, codeGrid: true });
  const { made, files } = makeScans({
    container: CONTAINER, user: USER, exam: EXAM,
    options: { faint: false, blank: false, omit: true, code: { base: 100 }, double: [2] },
  });
  b.check('Test scans were made, with student codes', files.length === COPIES * 2 - 1 && Object.keys((made.codes || {}).student || {}).length === COPIES,
    `${files.length} files, codes ${J(made.codes)}`);
  await b.click('.step[href$="/upload-scans"]');
  await b.waitFor(`!!document.querySelector('#scan-files')`);
  await b.setFiles('#scan-files', files);
  b.check('The scans are read', await b.waitFor(`!document.querySelector('#work') && S.status && S.status.scans === ${files.length}`, 240000), await b.js('S.status && S.status.scans'));
  await dismissServerDialog();

  // ---- Mark
  await b.click('.step[href$="/mark"]');
  b.check('Mark lists the copy with a missing page', await b.waitFor(`document.querySelector('#main').textContent.includes('missing pages')`));
  b.check('...and offers "Mark anyway" instead of computing', await b.js(`!!document.querySelector('[data-act="mark-anyway"]') && !document.querySelector('.card-foot [data-act="mark"]')`));
  await b.shot('r1-mark-before');
  await b.click('[data-act="mark-anyway"]');
  b.check('"Mark anyway" warns about what is unresolved', (await b.text('#layer')).includes('missing pages'));
  await b.click('[data-act="dialog-ok"]');
  b.check('Marks are computed for every copy', await b.waitFor(`S.status && S.status.marked === ${COPIES} && !document.querySelector('#work')`, 180000), await b.js('S.status && S.status.marked'));
  await dismissServerDialog();
  b.check('The marks are up to date', await b.waitFor(`S.status.marks_info && S.status.marks_info.stale === false`, 5000), J(await b.js('S.status.marks_info')));
  b.check('The marks summary is shown', await b.waitFor(`!!S.marks && S.marks.rows.length === ${COPIES} && document.querySelector('#main .stats') && document.querySelector('#main .stats').textContent.includes('Copies marked')`));
  b.check('The rule-breaking answer is listed', await b.waitFor(`S.marks.rule_breaks.some(r => r.student === 2) && !!document.querySelector('[data-act="open-page"]')`), J(await b.js('S.marks && S.marks.rule_breaks')));
  await b.shot('r2-mark-done');
  const breakKey = await b.js(`document.querySelector('[data-act="open-page"]').dataset.key`);
  await b.click('[data-act="open-page"]');
  b.check('"Open the page" opens that page in Check scans', await b.waitFor(`S.route.step === 'check-scans' && S.review && S.review.key === ${J(breakKey)} && !S.review.loading`, 15000), await b.js('S.review && S.review.key'));
  b.check('...with the scanned page in the preview', await b.waitFor(`!!document.querySelector('#page-svg svg')`, 20000));

  // Out of date after a marking change, then recompute
  await b.click('.step[href$="/mark"]');
  await b.waitFor(`S.route.step === 'mark' && !!S.marks`);
  await b.js(`socket_emit('set-config', ['note_max', '10']); refreshStatus(); true`);
  b.check('Changing the final mark makes the marks out of date', await b.waitFor(`S.status.marks_info.stale === true && document.querySelector('#main').textContent.includes('out of date')`, 10000));
  b.check('...and the sidebar flags Mark', await b.js(`document.querySelector('.step[href$="/mark"]').classList.contains('is-attention')`));
  await b.click('.banner [data-act="mark"]');
  b.check('Recomputing brings them up to date', await b.waitFor(`S.status.marks_info.stale === false && !document.querySelector('#work')`, 180000));
  b.check('...with the new final mark', await b.waitFor(`S.marks && S.marks.rows.length && S.marks.rows.every(r => r.mark <= 10)`, 10000), J(await b.js('S.marks.rows.map(r => r.mark)')));
  await dismissServerDialog();

  // The marking scheme panel agrees with AMC
  await b.click('.step[href$="/marking-scheme"]');
  const panelReady = `!!S.questions && S.questions.fresh && !S.scaleUpdating && S.questions.questions.length === 3`;
  b.check('After marking, the panel shows AMC\'s own maximum for each question', await b.waitFor(`${panelReady} && S.questions.questions.every(q => q.max_from === 'amc')`, 90000), J(await b.js('S.questions && S.questions.questions.map(q => [q.title, q.max, q.max_from])')));
  b.check('...and the panel\'s reading of the rules gives the same', await b.js(`S.questions.questions.every(q => q.rules_max === q.max)`), J(await b.js('S.questions.questions.map(q => [q.title, q.max, q.rules_max])')));
  const maxBefore = await b.js('S.marks.rows[0].max');
  await b.click('[data-act="q-edit"][data-title="extra"]');
  await b.waitFor(`!!document.querySelector('#dlg-form')`);
  await b.js(`document.querySelector('#dlg-form [name="choice"][value="none"]').checked = true; true`);
  await b.click('#dlg-form button[type="submit"]');
  b.check('A question marked "not counted" makes the marks out of date', await b.waitFor(`S.status.marks_info.stale === true && ${panelReady} && S.questions.questions.find(q => q.title === 'extra').kind === 'none'`, 90000));
  await b.click('.step[href$="/mark"]');
  await b.click('.banner [data-act="mark"]');
  b.check('AMC marks with it, without complaint', await b.waitFor(`S.status.marks_info.stale === false && !document.querySelector('#work')`, 180000) && !(await b.js(`!!document.querySelector('.server-dialog .msg-err')`)));
  await dismissServerDialog();
  b.check('...and the question no longer counts in the total', await b.waitFor(`S.marks && S.marks.rows.every(r => r.max === ${maxBefore} - 1)`, 10000), J(await b.js('S.marks.rows.map(r => r.max)')));

  // ---- Match students
  const dir = mkdtempSync(join(tmpdir(), 'amc-list-'));
  const listFile = join(dir, 'class-10B.csv');
  // Copy n reads code 100 + n; copy 4's code (104) isn't in the list.
  writeFileSync(listFile, 'id;surname;name\n101;Curie;Marie\n102;Noether;Emmy\n103;Lovelace;Ada\n150;Hopper;Grace\n');
  await b.click('.step[href$="/match-students"]');
  b.check('Match students asks for the class list', await b.waitFor(`!!document.querySelector('#list-drop')`));
  await b.setFiles('#list-file', [listFile]);
  b.check('The class list is loaded, with its code column found', await b.waitFor(`S.students && S.students.list && S.students.list.count === 4 && S.students.list.key === 'id'`, 10000), J(await b.js('S.students && S.students.list')));
  b.check('The code on the sheets is chosen', await b.waitFor(`document.querySelector('#assoc-code') && document.querySelector('#assoc-code').value === 'student'`, 5000));
  await b.shot('r3-match-before');
  await b.click('[data-act="match-auto"]');
  b.check('Automatic matching matches the three listed codes', await b.waitFor(`S.students.sheets.filter(x => x.state === 'auto').length === 3`, 60000), J(await b.js('S.students.sheets.map(x => [x.student, x.state, x.id])')));
  await dismissServerDialog();
  b.check('The fourth sheet is left to match, showing the code read', await b.waitFor(`${sheet(4)}.state === 'unmatched' && ${sheet(4)}.code_read === '104' && document.querySelector('#main').textContent.includes('104')`, 5000));
  b.check('Its name field is shown', await b.waitFor(`(() => { const i = document.querySelector('.namefield-img'); return !!i && i.complete && i.naturalWidth > 0; })()`, 10000));
  await typeSearch('hop');
  b.check('Typing finds the student', await b.waitFor(`(document.querySelector('#match-results .match-item.is-current') || {}).textContent.includes('Hopper')`, 3000));
  await b.shot('r4-match-manual');
  await enterInSearch();
  b.check('Enter matches the sheet: every sheet is matched', await b.waitFor(`S.status.unmatched === 0 && ${sheet(4)}.state === 'manual' && ${sheet(4)}.id === '150'`, 10000));
  b.check('...and the page says so', await b.waitFor(`document.querySelector('#main').textContent.includes('Every sheet is matched')`, 5000));

  // A student matched to another sheet moves; the first sheet goes back to the list
  await b.click('[data-act="match-filter"][data-v="all"]');
  await b.click('[data-act="match-open"][data-key="1/0"]');
  await typeSearch('hopper');
  await enterInSearch();
  b.check('Matching a student again moves them to the new sheet', await b.waitFor(`${sheet(1)}.id === '150' && ${sheet(4)}.state === 'unmatched'`, 10000), J(await b.js('S.students.sheets.map(x => [x.student, x.state, x.id])')));
  await b.click('[data-act="match-open"][data-key="4/0"]');
  await b.click('[data-act="match-none"]');
  b.check('"Not in the class list" is recorded', await b.waitFor(`${sheet(4)}.state === 'none'`, 10000));
  await b.click('[data-act="match-open"][data-key="1/0"]');
  await b.click('[data-act="match-auto-back"]');
  b.check('"Back to automatic" restores the automatic match', await b.waitFor(`${sheet(1)}.state === 'auto' && ${sheet(1)}.id === '101'`, 10000));
  b.check('The sidebar shows nothing left to match', await b.waitFor(`S.status.unmatched === 0 && document.querySelector('.step[href$="/match-students"]').classList.contains('is-done')`, 5000));

  // ---- Export marks
  await b.click('.step[href$="/export-marks"]');
  b.check('The marks table lists every copy with names', await b.waitFor(`document.querySelectorAll('#marks-table tbody tr').length === ${COPIES} && document.querySelector('#marks-table').textContent.includes('Curie')`, 10000));
  b.check('The histogram counts every copy', await b.waitFor(`(() => { const s = document.querySelector('#hist svg'); if (!s) return false; const n = [...s.getAttribute('aria-label').matchAll(/: (\\d+)/g)].reduce((a, m) => a + +m[1], 0); return n === ${COPIES} && document.querySelectorAll('#hist .hist-bar').length > 0; })()`, 5000));
  await b.click('[data-act="marks-sort"][data-col="mark"]');
  b.check('Sorting by mark puts the highest first', await b.js(`(() => { const v = [...document.querySelectorAll('#marks-table tbody tr td:last-child')].map(td => parseFloat(td.textContent)); return v.every((x, i) => i === 0 || v[i - 1] >= x); })()`));
  await b.setValue('#marks-search', 'curie');
  b.check('Searching filters the table', await b.js(`document.querySelectorAll('#marks-table tbody tr').length === 1`));
  await b.setValue('#marks-search', '');
  await b.click('[data-act="export-format"][data-v="CSV"]');
  await b.click('[data-act="export"]');
  b.check('Exporting to CSV shows the file in the preview', await b.waitFor(`S.previewFile && S.previewFile.name === 'exports/marks.csv' && document.querySelector('#preview-body table') && document.querySelector('#preview-body').textContent.includes('Curie')`, 60000));
  await dismissServerDialog();
  await b.shot('r5-export');
  await b.click('[data-act="export-format"][data-v="ods"]');
  await b.click('[data-act="export"]');
  b.check('Exporting to ODS makes the file', await b.waitFor(`S.exportInfo && S.exportInfo.files.some(f => f.name === 'marks.ods')`, 60000), J(await b.js('S.exportInfo && S.exportInfo.files')));
  await dismissServerDialog();
  const ods = await fetchInfo(await b.js(`fsUrl('exports/marks.ods', true)`));
  b.check('...and it downloads', ods.status === 200 && ods.size > 1000, J(ods));
  b.check('Exports are up to date', await b.js('S.status.exports_stale === false'));
  await b.js(`[...document.querySelectorAll('details.card')].forEach(d => { d.open = true; }); true`);
  await b.js(`(() => { const c = document.querySelector('[data-option="app_public_marks"]'); c.checked = true; c.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);
  b.check('Turning on the shareable link shows it', await b.waitFor(`!!document.querySelector('#public-link') && document.querySelector('#public-link').value.includes('/public/')`, 10000));
  const link = await b.js(`document.querySelector('#public-link').value`);
  const linked = await b.js(`fetch(${J(new URL(link).pathname)}, {cache: 'no-store'}).then(r => r.text())`);
  b.check('The link serves the marks of matched students', linked.includes('"101"') && linked.includes('"103"'), linked.slice(0, 120));
  await b.js(`(() => { const c = document.querySelector('[data-option="app_public_marks"]'); c.checked = false; c.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);
  await sleep(500);

  // ---- Annotate
  await b.click('.step[href$="/annotate"]');
  b.check('Annotate shows its settings', await b.waitFor(`!!S.annotateInfo && !!document.querySelector('[data-option="annote_position"]') && document.querySelectorAll('#annot-copy option').length === ${COPIES}`, 10000));
  await b.click('[data-act="annotate-preview"]');
  b.check('"Preview" shows one student\'s annotated sheet', await b.waitFor(`S.previewFile && S.previewFile.name.endsWith('ui-preview.pdf') && !!document.querySelector('#preview iframe')`, 120000));
  await dismissServerDialog();
  const prev = await fetchInfo(await b.js(`fsUrl(S.previewFile.name)`));
  b.check('...as a PDF', prev.status === 200 && prev.type.includes('pdf') && prev.size > 1000, J(prev));
  b.check('The preview doesn\'t make annotated sheets', await b.js('S.status.annotated === 0 && S.annotateInfo.files.length === 0'));
  await b.shot('r6-annotate-preview');
  await b.click('[data-act="annotate"]');
  b.check('Annotating makes one sheet per copy', await b.waitFor(`S.annotateInfo && S.annotateInfo.files.length === ${COPIES} && !document.querySelector('#work')`, 240000), J(await b.js('S.annotateInfo && S.annotateInfo.files')));
  await dismissServerDialog();
  b.check('Sheets are listed with student names', await b.waitFor(`document.querySelector('#main').textContent.includes('Lovelace')`, 5000));
  await b.click('[data-act="annotated-open"][data-i="0"]');
  b.check('A sheet opens in the preview, with previous and next', await b.waitFor(`!!document.querySelector('#plist-select') && S.previewList.i === 0`, 5000));
  await b.click('[data-act="plist-step"][data-delta="1"]');
  b.check('"Next" shows the next student', await b.js(`S.previewList.i === 1 && S.previewFile.name === S.previewList.items[1].path`));
  const zip = await fetchInfo(await b.js(`document.querySelector('a[href*="annotated.zip"]').getAttribute('href')`));
  b.check('"Download all" gives a zip', zip.status === 200 && zip.type.includes('zip') && zip.size > 1000, J(zip));
  await b.shot('r7-annotated');
  b.check('Annotated sheets are up to date', await b.js('S.status.annotated_stale === false'));
  await b.js(`(() => { const s = document.querySelector('[data-option="annote_position"]'); s.value = 'case'; s.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);
  b.check('Changing a setting makes them out of date', await b.waitFor(`S.status.annotated_stale === true && document.querySelector('#main').textContent.includes('older than')`, 10000));

  // ---- History
  const activity = (await b.js('S.status.activity.map(a => a.what)')).join(' | ');
  b.check('The history records each step', ['Marks computed', 'Class list loaded', 'Automatic matching', 'Marks exported (CSV)', 'Annotated sheets made'].every((w) => activity.includes(w)), activity);

  if (process.env.AMC_E2E_KEEP) b.created.delete(EXAM);
  else b.check('The test exam is deleted', await b.deleteExam(EXAM));
}

main().then(() => b.finish(), (e) => b.finish(e));
