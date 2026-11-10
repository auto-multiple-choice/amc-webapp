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
 * AMC_E2E_SMTP=mailpit:1025 and AMC_E2E_MAILPIT=http://127.0.0.1:8025: test Email results
 *   with a Mailpit SMTP sink (the address as the app reaches it, and Mailpit's API from here).
 * Use a test copy of the app, never your real exams.
 */
import { execFileSync } from 'node:child_process';
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
// Inside the app's container: the exam's files and AMC's databases.
const projectDir = `/amc-web/files/MC-Projects${USER ? '/' + USER : ''}/${EXAM}`;
const inApp = (...args) => execFileSync('docker', ['exec', CONTAINER, ...args], { encoding: 'utf8' });
const assocSql = (q) => inApp('sqlite3', `${projectDir}/data/association.sqlite`, q).trim();
const matchKey = () => assocSql("SELECT value FROM association_variables WHERE name='key_in_list'");
// As in exams matched by hand before the fix: AMC can't find names for the header.
const dropMatchKey = () => assocSql("DELETE FROM association_variables WHERE name='key_in_list'");
const pdfText = (rel) => inApp('pdftotext', `${projectDir}/${rel}`, '-');
const pdfPages = (rel) => +(inApp('pdfinfo', `${projectDir}/${rel}`).match(/Pages:\s+(\d+)/) || [0, 0])[1];
// AMC keeps the symbols' shapes and colours in the teacher's settings, not the exam's options.
const settingsFile = USER ? `/amc-web/files/MC-Projects/${USER}/_config/cf.default.xml` : '/amc-web/files/.AMC.d/cf.default.xml';
const option = (name) => (inApp('cat', settingsFile).match(new RegExp(`<${name}>([^<]*)</${name}>`)) || [])[1];
const sheet = (s, c = 0) => `S.students.sheets.find(x => x.student === ${s} && x.copy === ${c})`;
const typeSearch = async (text) => {
  await b.js(`(() => { const f = document.querySelector('#match-search'); f.focus(); f.value = ${J(text)}; f.dispatchEvent(new Event('input', {bubbles: true})); return true; })()`);
};
const enterInSearch = () => b.js(`document.querySelector('#match-search').dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true})); true`);
const fetchInfo = (url) => b.js(`fetch(${J(url)}, {cache: 'no-store'}).then(async r => ({status: r.status, type: r.headers.get('content-type') || '', size: (await r.arrayBuffer()).byteLength}))`);
// A CSV file as rows of fields: quoted fields, SEP between them.
const parseCsv = (text, sep) => {
  const out = []; let row = []; let f = ''; let q = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { f += '"'; i += 1; } else if (ch === '"') q = false; else f += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { row.push(f); f = ''; }
    else if (ch === '\n') { row.push(f); out.push(row); row = []; f = ''; }
    else if (ch !== '\r') f += ch;
  }
  if (f || row.length) { row.push(f); out.push(row); }
  return out;
};
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
  // Out of 7: some marks have decimals, for the CSV checks below.
  await b.js(`socket_emit('set-config', ['note_max', '7']); refreshStatus(); true`);
  b.check('Changing the final mark makes the marks out of date', await b.waitFor(`S.status.marks_info.stale === true && document.querySelector('#main').textContent.includes('out of date')`, 10000));
  b.check('...and the sidebar flags Mark', await b.js(`document.querySelector('.step[href$="/mark"]').classList.contains('is-attention')`));
  await b.click('.banner [data-act="mark"]');
  b.check('Recomputing brings them up to date', await b.waitFor(`S.status.marks_info.stale === false && !document.querySelector('#work')`, 180000));
  b.check('...with the new final mark', await b.waitFor(`S.marks && S.marks.rows.length && S.marks.rows.every(r => r.mark <= 7)`, 10000), J(await b.js('S.marks.rows.map(r => r.mark)')));
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
  // "total" and "Série": columns AMC's CSV export can't add (a name it uses itself; a letter outside ASCII).
  // Not a column AMC takes for the student's name, such as "Prénom".
  writeFileSync(listFile, 'id;surname;name;roll_no;email;total;Série\n101;Curie;Marie;24MA00101;marie.curie@example.org;T101;Série A\n'
    + '102;Noether;Emmy;24MA00102;emmy.noether@example.org;T102;Série B\n103;Lovelace;Ada;24MA00103;ada.lovelace@example.org;T103;Série A\n150;Hopper;Grace;24MA00150;;T150;Série B\n');
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
  dropMatchKey();
  await enterInSearch();
  b.check('Enter matches the sheet: every sheet is matched', await b.waitFor(`S.status.unmatched === 0 && ${sheet(4)}.state === 'manual' && ${sheet(4)}.id === '150'`, 10000));
  b.check('Matching by hand records the class list column AMC finds names by', matchKey() === 'id', matchKey());
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
  // CSV settings (issue #17): a decimal point and commas by default, class list columns
  const csvFile = () => inApp('cat', `${projectDir}/exports/marks.csv`);
  const marksByCopy = await b.js(`Object.fromEntries(S.marks.rows.map(r => [r.student + ':' + r.copy, r.mark]))`);
  b.check('Some marks have decimals, so the decimal mark shows', Object.values(marksByCopy).some((m) => m % 1 !== 0), J(marksByCopy));
  let rows = parseCsv(csvFile(), ',');
  const col = (name) => rows[0].indexOf(name);
  b.check('By default the CSV has commas between quoted columns, and the class list columns after the name',
    rows.length === COPIES + 1 && rows.every((r) => r.length === rows[0].length) && ['surname', 'name', 'roll_no', 'email'].every((c) => col(c) > col('Name')) && !rows[0].includes('id'), J(rows[0]));
  const curie = rows.find((r) => r[col('surname')] === 'Curie');
  b.check('...with each matched student\'s roll number and email', !!curie && curie[col('roll_no')] === '24MA00101' && curie[col('email')] === 'marie.curie@example.org', J(curie));
  b.check('The class list columns AMC\'s CSV can\'t take ("total", "Série") are left out of the file', col('total') < 0 && !rows[0].some((h) => /^S.*rie$/.test(h)), J(rows[0]));
  b.check('...and named on the page instead of offered', J(await b.js('S.exportInfo.class_columns_refused')) === J(['total', 'Série'])
    && (await b.text('#csv-refused')).includes('Can\'t be added: total, Série') && !(await b.js(`!!document.querySelector('[data-csvcol="total"]')`)), J(await b.js('S.exportInfo.class_columns_refused')));
  const markText = () => rows.slice(1).map((r) => [r[col('Exam')], r[col('Mark')]]);
  const sameMarks = (dec) => markText().every(([exam, m]) => {
    const [s, c] = exam.split(':'); const want = marksByCopy[`${s}:${c || 0}`];
    return want !== undefined && m === String(want).replace('.', dec);
  });
  b.check('...and marks with a decimal point', sameMarks('.') && markText().every(([, m]) => !m.includes(',')), J(markText()));
  await b.js(`(() => { const s = document.querySelector('[data-option="app_csv_decimal"]'); s.value = ','; s.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);
  b.check('A decimal comma switches the columns to semicolons', await b.waitFor(`S.exportInfo.csv.decimal === ',' && S.exportInfo.csv.separator === ';' && document.querySelector('[data-option="app_csv_separator"] option[value=","]').disabled`, 5000), J(await b.js('S.exportInfo.csv')));
  await b.js(`(() => { const box = document.querySelector('[data-csvcol="email"]'); box.checked = false; box.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);
  b.check('A class list column can be left out', await b.waitFor(`!S.exportInfo.csv.columns.includes('email') && S.exportInfo.csv.columns.includes('roll_no')`, 5000), J(await b.js('S.exportInfo.csv')));
  await b.click('[data-act="export"]');
  await b.waitFor(`!document.querySelector('#work')`, 60000);
  await sleep(500);
  await dismissServerDialog();
  rows = parseCsv(csvFile(), ';');
  b.check('The CSV then has semicolons, decimal commas and no email column', rows.length === COPIES + 1 && rows.every((r) => r.length === rows[0].length) && col('email') < 0 && col('roll_no') > 0 && sameMarks(','), J(rows.slice(0, 3)));
  await b.js(`(() => { const s = document.querySelector('[data-option="app_csv_decimal"]'); s.value = '.'; s.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);
  b.check('Back to a decimal point, the columns are commas again', await b.waitFor(`S.exportInfo.csv.decimal === '.' && S.exportInfo.csv.separator === ','`, 5000));
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
  b.check('Symbols are "Clear in black and white" by default, with the key in the right margin', await b.js(`S.annotateInfo.style.preset === 'clear' && S.annotateInfo.style.legend === 'right' && !!document.querySelector('[data-act="astyle-preset"][data-v="clear"][aria-pressed="true"]')`));
  b.check('...each case shown with its greyscale look', await b.js(`document.querySelectorAll('td[style*="grayscale"] svg').length === 4`));
  b.check('Both margins with the key on the right: a warning says so', await b.js(`document.querySelector('#main').textContent.includes('also written in both margins')`));
  await b.js(`(() => { const s = document.querySelector('[data-option="annote_position"]'); s.value = 'marge'; s.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);
  await b.js(`(() => { const t = document.querySelector('#verdict'); t.value = '%(name) %(surname)\\nMark: %s/%m'; t.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);
  b.check('...which goes with "In one margin"', await b.waitFor(`!document.querySelector('#main').textContent.includes('also written in both margins')`, 5000));
  dropMatchKey();
  await b.click('[data-act="annotate-preview"]');
  b.check('"Preview" shows one student\'s annotated sheet', await b.waitFor(`S.previewFile && S.previewFile.name.endsWith('ui-preview.pdf') && !!document.querySelector('#preview iframe')`, 120000));
  await dismissServerDialog();
  const prev = await fetchInfo(await b.js(`fsUrl(S.previewFile.name)`));
  b.check('...as a PDF', prev.status === 200 && prev.type.includes('pdf') && prev.size > 1000, J(prev));
  const prevText = pdfText('cr/corrections/ui-preview.pdf');
  b.check('The header has the student\'s name, also for an exam matched before the fix', prevText.includes('Marie Curie') && matchKey() === 'id', prevText.slice(0, 160));
  const prevKeys = (prevText.match(/Key:/g) || []).length;
  b.check('The preview carries the key, once on each page', prevKeys > 0 && prevKeys === pdfPages('cr/corrections/ui-preview.pdf') && prevText.includes('Correct, not ticked'), prevKeys);
  b.check('AMC draws the clear symbols', option('symbole_0_1_type') === 'mark' && option('symbole_1_1_type') === 'box' && option('annote_color') === '#1a237e', J([option('symbole_0_1_type'), option('symbole_1_1_type'), option('annote_color')]));
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
  const first = await b.js('S.annotateInfo.files[0].file');
  const keys = () => (pdfText(`cr/corrections/pdf/${first}`).match(/Key:/g) || []).length;
  const pages = pdfPages(`cr/corrections/pdf/${first}`);
  b.check('Annotated sheets carry the key, once on each page', pages > 0 && keys() === pages, `${keys()} keys, ${pages} pages`);
  await b.click('[data-act="annotate"]');
  await b.waitFor(`!document.querySelector('#work')`, 120000);
  await dismissServerDialog();
  b.check('...still once on each page after annotating again', keys() === pages, `${keys()} keys, ${pages} pages`);
  await b.shot('r7-annotated');
  b.check('Annotated sheets are up to date', await b.js('S.status.annotated_stale === false'));
  await b.click('[data-act="astyle-preset"][data-v="amc"]');
  b.check('"AMC\'s colours" writes AMC\'s symbols', await b.waitFor(`S.annotateInfo.style.preset === 'amc'`, 5000) && await (async () => { await sleep(800); return option('symbole_1_1_color') === '#0000ff' && option('symbole_0_1_type') === 'circle'; })(), J([option('symbole_1_1_color'), option('symbole_0_1_type')]));
  b.check('...and makes the annotated sheets out of date', await b.waitFor(`S.status.annotated_stale === true`, 10000));
  await b.click('[data-act="astyle-preset"][data-v="custom"]');
  b.check('"Custom" shows a shape and a colour for each case', await b.waitFor(`document.querySelectorAll('select[data-astyle]').length === 4 && document.querySelectorAll('input[type="color"][data-astyle]').length === 5`, 5000));
  await b.js(`(() => { const s = document.querySelector('select[data-astyle="1_1:0"]'); s.value = 'circle'; s.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);
  b.check('...and saves a changed shape', await b.waitFor(`S.annotateInfo.style.preset === 'custom' && S.annotateInfo.style.scheme['1_1'][0] === 'circle'`, 5000) && await (async () => { await sleep(800); return option('symbole_1_1_type') === 'circle'; })(), option('symbole_1_1_type'));
  await b.click('[data-act="astyle-preset"][data-v="clear"]');
  await b.waitFor(`S.annotateInfo.style.preset === 'clear'`, 5000);
  await b.click('[data-act="annotate"]');
  await b.waitFor(`!document.querySelector('#work') && S.status.annotated_stale === false`, 120000);
  await dismissServerDialog();
  await b.js(`(() => { const s = document.querySelector('[data-option="annote_position"]'); s.value = 'case'; s.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);
  b.check('Changing a setting makes them out of date', await b.waitFor(`S.status.annotated_stale === true && document.querySelector('#main').textContent.includes('older than')`, 10000));

  // ---- Email results (issue #7): with a Mailpit SMTP sink, AMC_E2E_SMTP=host:port as the app sees it, AMC_E2E_MAILPIT=its API
  const SMTP = process.env.AMC_E2E_SMTP || '';
  const MAILPIT = process.env.AMC_E2E_MAILPIT || '';
  let emailed = false;
  if (SMTP && MAILPIT) {
    const mp = (path, opts = {}) => fetch(MAILPIT + path, opts).then((r) => (r.status === 200 ? r.json().catch(() => ({})) : {}));
    const inbox = async () => (await mp('/api/v1/messages?limit=50')).messages || [];
    const message = (id) => mp(`/api/v1/message/${id}`);
    await mp('/api/v1/messages', { method: 'DELETE' });
    b.check('Annotate offers emailing the sheets', await b.waitFor(`!!document.querySelector('a[href$="/email"]')`, 5000));
    await b.js(`navigate('/email'); true`);
    b.check('Email sending is off until an administrator sets it up', await b.waitFor(`!!S.mailSetup && !!S.mailSetup.s && document.querySelector('#main').textContent.includes('Email sending is off')`, 10000));
    const [host, port] = SMTP.split(':');
    await b.click('[data-act="mail-security"][data-v="none"]');
    for (const [k, v] of [['host', host], ['port', port], ['from_address', 'exams@school.example'], ['from_name', 'Test School'], ['delay', '0']]) await b.setValue(`[data-mail="${k}"]`, v);
    await b.setValue('#mail-test-to', 'admin@school.example');
    await b.click('[data-act="mail-test"]');
    b.check('A test email goes out with the settings on the page, before saving', await b.waitFor(`!S.mailSetup.busy`, 30000)
      && (await (async () => { for (let i = 0; i < 20; i += 1) { const m = await inbox(); if (m.some((x) => x.Subject === 'Test email from AMC' && x.To[0].Address === 'admin@school.example')) return true; await sleep(300); } return false; })()), J(await inbox()));
    await b.shot('r8-email-setup');
    await b.click('[data-act="mail-save"]');
    b.check('Saved: email sending is on', await b.waitFor(`S.mailSetup.s.configured === true && document.querySelector('#main').textContent.includes('Email sending is on')`, 10000));
    b.check('The password and settings never come back to the page', !(await b.js(`fetch('/ui/api/mail/settings', {headers: headers()}).then(r => r.text())`)).includes('"password":'));
    await b.js(`navigate(examPath(${J(EXAM)}, 'email')); true`);
    b.check('Email results lists the sheets, with the class list\'s email column found', await b.waitFor(`!!S.email && S.email.rows.length === ${COPIES} && S.email.column === 'email' && S.email.configured`, 15000), J(await b.js('S.email && {column: S.email.column, rows: S.email.rows.length}')));
    b.check('...three can get an email; the sheet not in the class list can\'t', await b.js(`S.email.rows.filter(r => !r.problem).length === 3 && S.email.rows.find(r => r.student === 4).problem === 'unmatched'`), J(await b.js('S.email.rows.map(r => [r.student, r.problem, r.to])')));
    b.check('...all three chosen, and the old annotated sheets flagged', await b.js(`S.email.sel.size === 3 && S.email.stale === true && document.querySelector('#main').textContent.includes('annotated sheets are out of date')`));
    b.check('The preview fills in the codes', await b.waitFor(`!!S.email.preview && S.email.preview.to && S.email.preview.body.includes('Dear Curie Marie') && !S.email.preview.body.includes('%') && S.email.preview.subject === 'Results test exam: your marked answer sheet'`, 10000), J(await b.js('S.email.preview')));
    await b.setValue('#em-subject', 'Mark for %(name) %(surname) (%(roll_no)): %s/%m');
    await b.setValue('#em-reply', 'teacher@school.example');
    b.check('...as the text is typed, class list columns included', await b.waitFor(`S.email.preview && S.email.preview.subject.startsWith('Mark for Marie Curie (24MA00101): ')`, 10000), J(await b.js('S.email.preview && S.email.preview.subject')));
    await b.shot('r9-email');
    await b.setValue('#em-test', 'teacher@school.example');
    await b.click('[data-act="email-test"]');
    const testMail = async () => { for (let i = 0; i < 40; i += 1) { const m = (await inbox()).find((x) => x.Subject.startsWith('[Test] Mark for Marie Curie')); if (m) return m; await sleep(300); } return null; };
    const t = await testMail();
    b.check('"Send me this as a test" sends that student\'s email to the teacher', !!t && t.To[0].Address === 'teacher@school.example' && t.Attachments === 1, J(t));
    await b.waitFor(`!S.email.progress`, 10000);
    b.check('...and records nothing for the student', await b.js(`S.email.rows.every(r => !r.log)`));
    await b.click('[data-act="email-send"]');
    b.check('Sending asks first, warning about the old sheets', await b.waitFor(`document.querySelector('#layer').textContent.includes('Send 3 emails?') && document.querySelector('#layer').textContent.includes('out of date')`, 5000));
    await b.click('[data-act="dialog-ok"]');
    b.check('Each student is sent their email', await b.waitFor(`!S.email.progress && S.email.rows.filter(r => r.log && r.log.ok).length === 3`, 60000), J(await b.js('S.email.rows.map(r => r.log)')));
    const sent = (await inbox()).filter((x) => !x.Subject.startsWith('[Test]') && x.Subject.startsWith('Mark for'));
    b.check('...three emails, one to each address', J(sent.map((x) => x.To.map((a) => a.Address).join()).sort()) === J(['ada.lovelace@example.org', 'emmy.noether@example.org', 'marie.curie@example.org']), J(sent.map((x) => [x.To, x.Subject])));
    const one = await message(sent.find((x) => x.To[0].Address === 'emmy.noether@example.org').ID);
    b.check('...from the sender, replies to the teacher, the sheet attached as a PDF', one.From && one.From.Address === 'exams@school.example' && one.From.Name === 'Test School'
      && (one.ReplyTo || [])[0] && one.ReplyTo[0].Address === 'teacher@school.example' && one.Subject.startsWith('Mark for Emmy Noether (24MA00102): ')
      && (one.Attachments || []).length === 1 && one.Attachments[0].ContentType === 'application/pdf' && one.Attachments[0].Size > 1000, J({ From: one.From, ReplyTo: one.ReplyTo, Subject: one.Subject, Attachments: one.Attachments }));
    b.check('The students show as sent, and nobody is chosen for a second round', await b.waitFor(`S.email.sel.size === 0 && document.querySelectorAll('#em-table .chip-success').length === 3`, 5000));
    await b.js(`document.querySelector('#em-table').scrollIntoView(); true`);
    await b.shot('r10-email-sent');
    emailed = true;
    // An address corrected in the class list afterwards: the email went elsewhere, this student still has to get it
    const toSend = `S.email.rows.filter(FILTERS.find((f) => f[0] === 'send')[2]).map((r) => r.student).join()`;
    inApp('sed', '-i', 's/ada.lovelace@example.org/ada@new.example/', `${projectDir}/class-10B.csv`);
    await b.js('loadEmail(); true');
    b.check('A student whose address changed since the email shows as sent to another address, and is to send again',
      await b.waitFor(`(() => { const r = S.email.rows.find((x) => x.student === 3); const cell = document.querySelector('#em-table tr[data-row="3:0"] .em-status');
        return !!r && r.to[0] === 'ada@new.example' && !!r.log && r.log.elsewhere === true && !!cell && cell.textContent.includes('Sent to another address') && cell.textContent.includes('ada.lovelace@example.org') && ${toSend} === '3'; })()`, 10000),
      J(await b.js(`[S.email.rows.find((x) => x.student === 3), ${toSend}]`)));
    inApp('sed', '-i', 's/ada@new.example/ada.lovelace@example.org/', `${projectDir}/class-10B.csv`);
    await b.js('loadEmail(); true');
    b.check('...and as sent again with the address the email went to', await b.waitFor(`(() => { const r = S.email.rows.find((x) => x.student === 3); return !!r && r.to[0] === 'ada.lovelace@example.org' && r.log.ok && !r.log.elsewhere && ${toSend} === ''; })()`, 10000));
    await b.js(`postJSON('/ui/api/mail/settings', {host: ${J(host)}, port: ${J(port)}, security: 'none', from_address: 'exams@school.example', from_name: 'Test School', daily_limit: 4, delay: 0}); true`);
    await sleep(500);
    await b.click('[data-act="email-filter"][data-v="sent"]');
    await b.js(`(() => { const a = document.querySelector('[data-email-all]'); a.checked = true; a.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);
    b.check('Students sent an email can be chosen again', await b.js(`S.email.sel.size === 3`));
    await b.click('[data-act="email-send"]');
    await b.click('[data-act="dialog-ok"]');
    b.check('The daily limit per teacher stops a round that goes past it', await b.waitFor(`!!document.querySelector('.server-dialog') && document.querySelector('.server-dialog').textContent.includes('emails a day')`, 10000)
      && (await inbox()).length === 5);
    await b.js('warn_ok(); true');
    await b.js(`postJSON('/ui/api/mail/settings', {host: '', from_address: ''}); true`);
    await sleep(500);
  } else console.log('  (email not tested: set AMC_E2E_SMTP and AMC_E2E_MAILPIT)');

  // ---- History
  const activity = (await b.js('S.status.activity.map(a => a.what)')).join(' | ');
  b.check('The history records each step', ['Marks computed', 'Class list loaded', 'Automatic matching', 'Marks exported (CSV)', 'Annotated sheets made'].concat(emailed ? ['Annotated sheets emailed: 3 sent'] : []).every((w) => activity.includes(w)), activity);

  if (process.env.AMC_E2E_KEEP) b.created.delete(EXAM);
  else b.check('The test exam is deleted', await b.deleteExam(EXAM));
}

main().then(() => b.finish(), (e) => b.finish(e));
