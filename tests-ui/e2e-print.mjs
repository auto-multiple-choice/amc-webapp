#!/usr/bin/env node
/*
 * End-to-end test of Print › Save PDFs with a separate answer sheet: each
 * copy's question paper and answer sheet in separate files, in two folders
 * of the zip (server/ui_print.py), or one PDF per copy when asked.
 *
 *   node tests-ui/e2e-print.mjs http://127.0.0.1:8095 [screenshots-dir]
 *
 * AMC_E2E_CONTAINER: the app's container (found from the port otherwise).
 * AMC_E2E_USER / AMC_E2E_PASS: sign in first (shared-machine mode).
 * Use a test copy of the app, never your real exams.
 */
import { execFileSync } from 'node:child_process';
import { startBrowser } from './cdp.mjs';
import { appContainer } from './fixtures.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:8095';
const USER = process.env.AMC_E2E_USER || '';
const CONTAINER = appContainer(BASE);
const EXAM = 'Print test exam';
const PLAIN = 'Print test exam (answers on the paper)';
const COPIES = 3;
const b = await startBrowser({ base: BASE, user: USER, pass: process.env.AMC_E2E_PASS || '', shots: process.argv[3] || null });
const J = JSON.stringify;

/* The zip the page was given, listed in the app's container: {path: pages}. */
async function savedZip() {
  const url = await b.js('window.__printed');
  const b64 = await b.js(`fetch(${J(url)}, {cache: 'no-store'}).then(async (r) => { const a = new Uint8Array(await r.arrayBuffer()); let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000)); return btoa(s); })`);
  const out = execFileSync('docker', ['exec', '-i', CONTAINER, 'sh', '-c',
    'd=$(mktemp -d) && cat > "$d/p.zip" && cd "$d" && mkdir x && unzip -q p.zip -d x && cd x && find . -type f | sort | while read f; do echo "$f $(pdfinfo "$f" | sed -n "s/^Pages: *//p")"; done; rm -rf "$d"'],
  { input: Buffer.from(b64, 'base64'), encoding: 'utf8' });
  return Object.fromEntries(out.trim().split('\n').filter(Boolean).map((l) => { const i = l.lastIndexOf(' '); return [l.slice(2, i), +l.slice(i + 1)]; }));
}

async function savePdfs() {
  await b.js('window.__printed = null; true');
  await b.click('[data-act="print"]');
  if (await b.waitFor(`document.querySelector('#layer').textContent.includes('This locks the exam')`, 3000)) await b.click('[data-act="dialog-ok"]');
  return b.waitFor('!!window.__printed && !document.querySelector("#work")', 120000);
}

async function main() {
  await b.signIn();
  await b.goto('/');
  b.check('The app opens', await b.waitFor('S.online === true'));
  await b.preflight({ exams: [EXAM, PLAIN] });
  // The page goes to the zip's address once it is made: keep the address instead.
  await b.js(`socket.on('print-to-files', (u) => { window.__printed = u; }); true`);

  // An exam from the blank starter with a separate answer sheet
  b.created.add(EXAM);
  await b.js(`S.creating = ${J(EXAM)}; socket_emit('ui-create-exam', {name: ${J(EXAM)}, gid: 'school', id: 'blank', style: 'separate', copies: ${COPIES}}); true`);
  b.check('The exam is created', await b.waitFor(`S.project === ${J(EXAM)} && !!S.status`, 30000));
  await b.js(`socket_emit('doc-update', 'sujet'); true`);
  await b.waitFor(`!!document.querySelector('#work')`, 10000);
  b.check('The papers are built', await b.waitFor(`!document.querySelector('#work') && S.status && S.status.layout_pages > 0`, 180000));
  if (await b.js(`!!document.querySelector('.server-dialog')`)) await b.js('warn_ok(); true');
  await b.js(`socket_emit('ui-layout-ok'); true`);
  await b.waitFor('S.status && !!S.status.layout_ok', 10000);

  await b.click('.step[href$="/print"]');
  b.check('Print offers separate PDFs for the question paper and the answer sheet, chosen by default',
    await b.waitFor(`!!S.printInfo && S.printInfo.separate && S.printInfo.split && !!document.querySelector('[data-act="print-split"][data-v="1"][aria-pressed="true"]')`, 10000), J(await b.js('S.printInfo')));
  const pages = await b.js('S.printInfo.pages');
  b.check('...with the pages of each part', !!pages && pages.questions > 0 && pages.sheet > 0 && (await b.text('#main')).includes('answer-sheets/0001-answer-sheet.pdf'), J(pages));
  await b.shot('p1-print');
  b.check('Saving makes the PDFs and locks the exam', await savePdfs() && await b.waitFor('S.status && !!S.status.lock', 10000));
  let zip = await savedZip();
  const names = Object.keys(zip);
  const want = [];
  for (let i = 1; i <= COPIES; i += 1) {
    const n = String(i).padStart(4, '0');
    want.push(`answer-sheets/${n}-answer-sheet.pdf`, `question-papers/${n}-questions.pdf`);
  }
  b.check('The zip has two folders: a question paper and an answer sheet per copy', J(names.sort()) === J(want.sort()), J(zip));
  b.check('...each with its own pages', names.every((f) => zip[f] === (f.startsWith('answer-sheets/') ? pages.sheet : pages.questions)), J(zip));
  b.check('The zip is named after the exam', (await b.js('window.__printed')).endsWith('/papers.zip')
    && (await b.js(`fetch(window.__printed, {cache: 'no-store'}).then(r => r.headers.get('content-disposition') || '')`)).includes('Print test exam - papers.zip'));

  await b.click('[data-act="print-split"][data-v="0"]');
  b.check('"One PDF per copy" is saved for the exam', await b.waitFor(`!S.printInfo.split && document.querySelector('#main').textContent.includes('0001.pdf')`, 5000)
    && await b.waitFor(`getJSON('/ui/api/print').then(r => r.split === false)`, 5000));
  b.check('Saving again gives one PDF per copy', await savePdfs());
  zip = await savedZip();
  b.check('...with the question paper and the answer sheet together', J(Object.keys(zip).sort()) === J(['0001.pdf', '0002.pdf', '0003.pdf'])
    && Object.values(zip).every((n) => n === pages.questions + pages.sheet), J(zip));
  await b.click('[data-act="print-split"][data-v="1"]');
  await b.waitFor(`getJSON('/ui/api/print').then(r => r.split === true)`, 5000);
  const activity = (await b.js('S.status.activity.map(a => a.what)')).join(' | ');
  b.check('The history records the saved papers', activity.includes('Papers saved for printing (copies 1–3)'), activity);

  // Answers on the question paper: nothing to separate
  b.check('An exam with answers on the question paper is created', await b.createFromTemplate(PLAIN));
  b.check('...and Print has nothing to separate', await b.waitFor(`getJSON('/ui/api/print').then(r => r.separate === false && r.split === false)`, 10000));

  b.check('The test exams are deleted', await b.deleteExam(EXAM) && await b.deleteExam(PLAIN));
}

main().then(() => b.finish(), (e) => b.finish(e));
