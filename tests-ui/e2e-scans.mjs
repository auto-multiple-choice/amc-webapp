#!/usr/bin/env node
/*
 * End-to-end test of the scan steps (Upload scans, Check scans).
 *
 *   node tests-ui/e2e-scans.mjs http://127.0.0.1:8095 [screenshots-dir]
 *
 * It makes an exam, builds and locks its papers, makes test scans inside
 * the app's container (tests-ui/make_scans.py, through docker exec),
 * uploads them through the page and works through Check scans.
 *
 * AMC_E2E_CONTAINER: the app's container (default amc-uitest).
 * AMC_E2E_USER / AMC_E2E_PASS: sign in first (shared-machine mode).
 * Use a test copy of the app, never your real exams.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startBrowser, sleep } from './cdp.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:8095';
const USER = process.env.AMC_E2E_USER || '';
const CONTAINER = process.env.AMC_E2E_CONTAINER || 'amc-uitest';
const EXAM = 'Scan test exam';
const b = await startBrowser({ base: BASE, user: USER, pass: process.env.AMC_E2E_PASS || '', shots: process.argv[3] || null });
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' });
const api = (path) => b.js(`fetch(${JSON.stringify(path)}, {headers: {'AMC-project': S.project}, cache: 'no-store'}).then(r => r.json())`);
const page = (s, p, c) => api(`/ui/api/scan-page?student=${s}&page=${p}&copy=${c}`);

async function main() {
  await b.signIn();
  await b.goto('/');
  b.check('The app opens', await b.waitFor('S.online === true'));

  // An exam with built, confirmed and printed papers, set up directly
  await b.js(`S.creating = ${JSON.stringify(EXAM)}; socket_emit('create-project-template', [${JSON.stringify(EXAM)}, 'en/simple']); true`);
  b.check('The exam is created', await b.waitFor(`S.project === ${JSON.stringify(EXAM)} && !!S.status`, 30000));
  // A second page per copy, so a copy can miss a page
  const marker = '% \\AMCaddpagesto{3}'; // a commented-out line in AMC's simple template
  const extra = '\\clearpage\n\\begin{question}{extra}\n  Is this the second page?\n  \\begin{choices}\n'
    + '    \\correctchoice{Yes}\n    \\wrongchoice{No}\n  \\end{choices}\n\\end{question}\n';
  const added = await b.js(`(async (marker, extra) => {
    const src = S.status.source;
    const url = '/fs/' + encodeURIComponent(S.project) + '/' + encodeURIComponent(src) + '?attach=0';
    let t = await (await fetch(url, {cache: 'no-store'})).text();
    if (!t.includes(marker)) return false;
    t = t.replace(marker, extra);
    const form = new FormData();
    form.append('file', new Blob([t], {type: 'text/plain'}), src);
    const r = await fetch('/upload/source', {method: 'POST', headers: {'AMC-project': S.project, 'AMC-sid': socket.id}, body: form});
    return (await r.json()).ok === true;
  })(${JSON.stringify(marker)}, ${JSON.stringify(extra)})`);
  b.check('The test exam gets a second page per copy', added === true);
  await b.js(`socket_emit('doc-update', 'sujet'); true`);
  await b.waitFor(`!!document.querySelector('#work')`, 10000);
  b.check('The papers are built', await b.waitFor(`!document.querySelector('#work') && S.status && S.status.layout_pages > 0`, 120000));
  if (await b.js(`!!document.querySelector('.server-dialog')`)) await b.js('warn_ok(); true');
  await b.js(`socket_emit('ui-layout-ok'); true`);
  await b.waitFor(`S.status && !!S.status.layout_ok`, 10000);
  await b.js(`socket_emit('ui-mark-printed'); true`);
  b.check('The exam is locked as printed', await b.waitFor(`S.status && !!S.status.lock`, 10000));

  // Test scans, made in the app's container
  const projectDir = `/amc-web/files/MC-Projects${USER ? '/' + USER : ''}/${EXAM}`;
  docker('exec', CONTAINER, 'rm', '-rf', '/tmp/amc-test-scans');
  // Piped to Python rather than copied in: copies of files can come out
  // unreadable for the app's user (for example from an exFAT drive).
  const made = JSON.parse(execFileSync('docker', ['exec', '-i', CONTAINER, '/venv/bin/python', '-', projectDir, '/tmp/amc-test-scans'],
    { input: readFileSync('tests-ui/make_scans.py'), encoding: 'utf8' }));
  const local = mkdtempSync(join(tmpdir(), 'amc-scans-'));
  docker('cp', `${CONTAINER}:/tmp/amc-test-scans/.`, local);
  const files = readdirSync(local).filter((f) => f.endsWith('.png')).sort().map((f) => join(local, f));
  b.check('Test scans were made', files.length === made.files.length && files.length > 2, `${files.length} files`);

  // Upload scans
  await b.click('.step[href$="/upload-scans"]');
  b.check('Upload scans opens with its options', await b.waitFor(`!!document.querySelector('#scan-files') && !!document.querySelector('#scan-photocopy')`));
  await b.shot('s1-upload');
  await b.setFiles('#scan-files', files);
  b.check('Uploading shows progress', await b.waitFor(`!!document.querySelector('#work')`, 10000));
  b.check('The scans are read', await b.waitFor(`!document.querySelector('#work') && S.status && S.status.scans > 0`, 240000));
  if (await b.waitFor(`!!document.querySelector('.server-dialog')`, 3000)) {
    console.log('  server message: ' + (await b.text('.server-dialog')).replace(/\s+/g, ' ').slice(0, 200));
    await b.js('warn_ok(); true');
  }
  let sc = await api('/ui/api/scans');
  b.check('Every page but the blank one is recognised', sc.pages.length === files.length - 1, `${sc.pages.length} of ${files.length}`);
  b.check('The blank page is listed as unreadable', sc.failed.length === 1, `${sc.failed.length}`);
  b.check('The copy with a page left out is incomplete', sc.incomplete === 1 && sc.missing.some((m) => m.student === made.missing.student && m.page === made.missing.page), JSON.stringify(sc.missing));
  const toCheck = sc.pages.filter((p) => p.to_check);
  b.check('Pages with faint marks are to check', toCheck.some((p) => p.student === 1) && toCheck.some((p) => p.student === 2), JSON.stringify(toCheck.map((p) => p.student)));
  b.check('The photocopy option is locked once scans exist', await b.waitFor(`document.querySelector('#scan-photocopy') && document.querySelector('#scan-photocopy').disabled`, 5000));
  const clear = made.marks.find((m) => !m.faint && m.student === 3);
  const clearPage = await page(3, clear.page, 0);
  const cb = clearPage.boxes.find((x) => x.question === clear.question && x.answer === clear.answer);
  b.check('A clear mark is read as ticked', cb && cb.ticked && !cb.uncertain, JSON.stringify(cb && { prop: cb.prop, ticked: cb.ticked }));
  const faint = made.marks.find((m) => m.faint && m.student === 1);
  const fp = await page(1, faint.page, 0);
  const fb0 = fp.boxes.find((x) => x.question === faint.question && x.answer === faint.answer);
  b.check('A faint mark is uncertain', fb0 && fb0.uncertain, JSON.stringify(fb0 && { prop: fb0.prop, ticked: fb0.ticked }));

  // Check scans
  await b.click('.step[href$="/check-scans"]');
  b.check('Check scans lists the unreadable page', await b.waitFor(`document.querySelector('#main').textContent.includes('scan-blank')`));
  b.check('...and the missing page', (await b.text('#main')).includes('missing'));
  b.check('The first page to check opens with its uncertain boxes', await b.waitFor(`S.review && !S.review.loading && document.querySelectorAll('.zoom-row.is-uncertain').length >= 1`, 15000));
  b.check('Zoomed images of the boxes are shown', await b.js(`!!document.querySelector('.zoom-row img.zoom-img')`));
  b.check('The scanned page opens in the preview with its boxes', await b.waitFor(`!!document.querySelector('#page-svg svg') && document.querySelectorAll('#page-svg [id^="box1_"]').length > 0`, 20000));
  await sleep(800);
  await b.shot('s2-check');

  const firstBox = await b.js(`document.querySelector('#page-svg [id^="box1_"]').id.replace('box1_', '')`);
  const was = await b.js(`S.review.decisions[${JSON.stringify(firstBox)}]`);
  await b.js(`document.querySelector('#page-svg [id^="box1_"]').dispatchEvent(new MouseEvent('click', {bubbles: true})); true`);
  b.check('Clicking a box on the scanned page changes it', (await b.js(`S.review.decisions[${JSON.stringify(firstBox)}]`)) === !was);
  await b.js(`document.querySelector('#page-svg [id^="box1_"]').dispatchEvent(new MouseEvent('click', {bubbles: true})); true`);

  // The faint mark was meant as a tick: say so with the keyboard
  const key1 = await b.js('S.review.key');
  await b.click('.zoom-row.is-uncertain');
  await b.key('t');
  await b.key('Enter');
  b.check('Enter records the page as checked', await b.waitFor(`S.scans.pages.find(p => p.student + '/' + p.page + '/' + p.copy === ${JSON.stringify(key1)}).checked && (!S.review || S.review.key !== ${JSON.stringify(key1)})`, 20000));
  const [s1, p1, c1] = key1.split('/').map(Number);
  const done1 = await page(s1, p1, c1);
  const mark1 = made.marks.find((m) => m.faint && m.student === s1);
  const fb = done1.boxes.find((x) => x.question === mark1.question && x.answer === mark1.answer);
  b.check('The decision is saved as ticked by a person', fb && fb.ticked === true && fb.manual === true, JSON.stringify(fb && { manual: fb.manual, ticked: fb.ticked }));
  sc = await api('/ui/api/scans');
  b.check('One page fewer to check', sc.pages.filter((p) => p.to_check).length === toCheck.length - 1);

  // Unreadable page: what AMC saw, then remove it
  await b.click('[data-act="failed-diagnose"]');
  b.check('"What AMC saw" shows a diagnostic image', await b.waitFor(`S.previewMode === 'image' && !!document.querySelector('#preview img.preview-img')`, 30000));
  await b.click('[data-act="failed-remove"]');
  await b.click('[data-act="dialog-ok"]');
  b.check('Removing clears the unreadable page', await b.waitFor(`S.scans && S.scans.failed.length === 0`, 15000));

  // The rest
  const rest = sc.pages.filter((p) => p.to_check).length;
  if (rest > 1) {
    await b.waitFor(`!!document.querySelector('[data-act="accept-rest"]')`, 10000);
    await b.click('[data-act="accept-rest"]');
    await b.click('[data-act="dialog-ok"]');
  } else if (rest === 1) {
    await b.waitFor(`S.review && !S.review.loading`, 10000);
    await b.click('[data-act="review-done"]');
  }
  b.check('No pages left to check', await b.waitFor(`S.scans && S.scans.pages.every(p => !p.to_check)`, 60000));
  b.check('The sidebar counts only the missing page', await b.waitFor(`(document.querySelector('.step[href$="/check-scans"] .step-count') || {}).textContent === '1'`, 10000),
    await b.text('.step[href$="/check-scans"]'));

  // Detection sensitivity
  await b.js(`[...document.querySelectorAll('details.card')].forEach(d => { d.open = true; }); true`);
  await b.setValue('#seuil', '0.2');
  b.check('A new detection threshold is saved', await b.waitFor(`fetch('/ui/api/scans', {headers: {'AMC-project': S.project}}).then(r => r.json()).then(s => s.low === 0.2)`, 10000));
  await b.setValue('#seuil', '0.15');
  await sleep(500);
  await b.shot('s3-clear');

  await b.js(`socket_emit('project-delete', ${JSON.stringify(EXAM)}); true`);
  await sleep(500);
}

main().then(() => b.finish(), (e) => b.finish(e));
