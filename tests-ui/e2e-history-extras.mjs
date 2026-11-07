#!/usr/bin/env node
/*
 * End-to-end test of the history extras (doc/question-bank-plan.md, section 12.1,
 * left from P0): who changed each line of a file; changes side by side; a file
 * of a version downloaded from a plain link; "Build this version" (compiled in a
 * scratch folder, the version's text in the PDF); the history of one section;
 * "With history": the exam as a zip with its history, imported again from the
 * Exams page with its versions; an archive with a planted .git and dot-folder
 * imported without them; and ./amc doctor's check.
 *
 *   node tests-ui/e2e-history-extras.mjs http://127.0.0.1:8095 [screenshots-dir]
 *
 * AMC_E2E_USER / AMC_E2E_PASS: sign in first (shared-machine mode).
 * Use a test copy of the app, never your real exams.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startBrowser } from './cdp.mjs';
import { appContainer } from './fixtures.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:8095';
const USER = process.env.AMC_E2E_USER || '';
const EXAM = 'History extras test';
const COPY = 'History extras copy';
const PLANTED = 'History extras planted';
const CONTAINER = appContainer(BASE);
const b = await startBrowser({ base: BASE, user: USER, pass: process.env.AMC_E2E_PASS || '', shots: process.argv[3] || null, qtab: 'form' });
const J = JSON.stringify;
const projects = `/amc-web/files/MC-Projects${USER ? '/' + USER : ''}`;
const inApp = (...args) => execFileSync('docker', ['exec', CONTAINER, ...args], { encoding: 'utf8' });
const post = (url, body, project = EXAM) => b.js(`fetch(${J(url)}, {method: 'POST', headers: {...headers(), 'AMC-project': ${J(project)}, 'Content-Type': 'application/json'}, body: ${J(J(body))}}).then(r => r.json())`);
const get = (url, project = EXAM) => b.js(`fetch(${J(url)}, {headers: {...headers(), 'AMC-project': ${J(project)}}}).then(r => r.json())`);
const ITEM = 'items/example-single/item.tex';

async function main() {
  await b.signIn();
  await b.goto('/exams');
  await b.waitFor(`typeof S !== 'undefined' && S.online === true && Array.isArray(S.projects)`, 15000);
  await b.preflight({ exams: [EXAM, COPY, PLANTED] });

  // ---- an exam with a few versions of one question
  b.created.add(EXAM);
  await b.js(`S.qtab = 'form'; store.set('qtab', 'form'); S.creating = ${J(EXAM)}; socket_emit('ui-create-exam', {name: ${J(EXAM)}, gid: 'school', id: 'blank', style: 'paper'}); true`);
  await b.waitFor(`S.project === ${J(EXAM)} && S.qdata && S.qdata.modular`, 60000);
  for (const text of ['Version A of the question', 'Version B of the question']) {
    const r = await post('/ui/api/editor', { file: ITEM, based_on: '', ops: [{ op: 'text', id: 'example-single', latex: text }] });
    b.check(`A save: ${text}`, r.ok === true, J(r.error));
  }

  // ---- who changed each line
  await b.js(`openHistory(${J(ITEM)}); true`);
  await b.waitFor(`S.history && S.history.versions && S.history.versions.length >= 3`, 15000);
  await b.js(`pickVersion(S.history.versions[0].id); true`);
  await b.waitFor(`S.history.detail && S.history.detail.entry`, 10000);
  await b.click('[data-act="hist-view"][data-v="blame"]');
  b.check('Who changed each line: the file, each run of lines with its version', await b.waitFor(`document.querySelectorAll('.blame .bl-row').length > 3 && [...document.querySelectorAll('.bl-text')].some((x) => x.textContent.includes('Version B'))`, 10000));
  const oldest = await b.js(`[...document.querySelectorAll('.bl-who[data-id]')].map((x) => x.dataset.id).find((id) => id !== S.history.versions[0].id)`);
  await b.js(`document.querySelector('.bl-who[data-id="${oldest}"]').click(); true`);
  b.check('...a click opens that version', await b.waitFor(`S.history.selected === ${J(oldest)}`, 5000));
  await b.shot('h1-blame');

  // ---- side by side
  await b.js(`pickVersion(S.history.versions[0].id); S.history.view = 'changes'; true`);
  await b.waitFor(`S.history.detail && !!document.querySelector('#hist-split')`, 10000);
  await b.click('#hist-split');
  b.check('Changes side by side', await b.waitFor(`!!document.querySelector('.diff-split .del') && !!document.querySelector('.diff-split .add')`, 5000));
  await b.shot('h2-split');
  await b.click('#hist-split');

  // ---- a file of a version, from a plain link (no header)
  const href = await b.js(`(document.querySelector('.hist-file-head a[href*="raw=1"]') || {}).href || ''`);
  const raw = await b.js(`fetch(${J(href)}).then((r) => r.text())`);
  b.check('A version\'s file downloads from a plain link', raw.includes('\\begin{question}{example-single}') && raw.includes('Version B'), raw.slice(0, 120));

  // ---- build this version
  const versionA = await b.js('S.history.versions[1].id'); // the file's history: [0] saved Version B, [1] Version A
  await b.js(`pickVersion(${J(versionA)}); true`);
  await b.waitFor(`S.history.detail && !!document.querySelector('[data-act="hist-build"]')`, 10000);
  await b.click('[data-act="hist-build"]');
  b.check('"Build this version" shows the PDF it compiled', await b.waitFor(`!!document.querySelector('.dialog iframe.hist-pdf') && !!S.versionPdf`, 120000));
  const pdf = await b.js(`fetch(S.versionPdf).then(async (r) => { const t = new Uint8Array(await r.arrayBuffer()); return String.fromCharCode(...t.slice(0, 5)) + ' ' + t.length; })`);
  b.check('...a real PDF', pdf.startsWith('%PDF-') && +pdf.split(' ')[1] > 5000, pdf);
  await b.shot('h3-build');
  await b.click('.dialog [data-act="dialog-ok"]');
  // the PDF's text, read in the container: the version's text, not today's
  const b64 = await b.js(`fetch('/ui/api/history/${versionA}/build', {method: 'POST', headers: {...headers(), 'Content-Type': 'application/json'}, body: '{}'})
    .then(async (r) => { const u = new Uint8Array(await r.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.slice(i, i + 8192)); return btoa(s); })`);
  execFileSync('docker', ['exec', '-i', CONTAINER, 'sh', '-c', 'base64 -d > /tmp/version.pdf'], { input: b64 });
  const text = inApp('pdftotext', '/tmp/version.pdf', '-');
  b.check('...compiled from that version, not from the files now', text.includes('Version A') && !text.includes('Version B'), text.slice(0, 200));

  // ---- the history of a section
  const mainName = await b.js('S.status.source');
  const main = await get('/ui/api/source?file=' + encodeURIComponent(mainName));
  const saved = await post('/ui/api/source', { file: mainName, text: main.text + '% a note in the main file only\n', based_on: main.digest });
  b.check('A save of the main file only', saved.ok === true, J(saved.error));
  const sec = await get(`/ui/api/history?section=general`);
  const whole = await get('/ui/api/history');
  b.check('The history of one section: only the versions that changed its questions', sec.section === 'general' && sec.versions.length >= 2 && sec.versions.length < whole.versions.length
    && sec.versions.every((v) => v.files.some((f) => f.file.startsWith('items/'))), J([sec.versions.length, whole.versions.length]));
  await b.js(`openHistory(null, 'general'); true`);
  b.check('...in the History panel, named so', await b.waitFor(`S.history && S.history.versions && S.history.versions.length === ${sec.versions.length} && document.body.textContent.includes('History · section general')`, 10000));

  // ---- with history: out as a zip, back in from the Exams page
  await b.goto('/exams');
  await b.waitFor(`!!document.querySelector('[data-act="exam-import"]')`, 15000);
  const zip = await b.js(`fetch('/ui/api/history/download?project=' + encodeURIComponent(${J(EXAM)})).then(async (r) => { window.__zip = await r.blob(); return r.headers.get('content-type') + ' ' + window.__zip.size; })`);
  b.check('"With history": the exam downloads as a zip, from a plain link', /zip/.test(zip) && +zip.split(' ')[1] > 2000, zip);
  b.created.add(COPY);
  const imp = await b.js(`(async () => { const f = new FormData(); f.append('file', window.__zip, 'exam.zip'); f.append('name', ${J(COPY)});
    const r = await fetch('/upload/create', {method: 'POST', headers: headers(), body: f}); return r.json(); })()`);
  b.check('...imported again as an exam', imp.ok === true, J(imp));
  const ch = await get('/ui/api/history', COPY);
  b.check('...with its history: every earlier version, the last one named "Imported …"', ch.versions.length >= whole.versions.length
    && ch.versions.some((v) => v.what === 'Saved in the editor') && ch.versions[0].names.some((n) => /^Imported /.test(n.name)), J(ch.versions.slice(0, 3).map((v) => [v.what, v.names])));
  b.check('...and no history.bundle left in the exam', !inApp('ls', '-a', `${projects}/${COPY}`).split('\n').includes('history.bundle'));

  // ---- an archive with a planted .git and a dot-folder, from the dialog
  inApp('/venv/bin/python', '-c', `
import os, zipfile
src = ${J(`${projects}/${EXAM}`)}
with zipfile.ZipFile('/tmp/planted.zip', 'w') as z:
    for root, dirs, files in os.walk(src):
        for f in files:
            p = os.path.join(root, f)
            z.write(p, os.path.relpath(p, src))
    z.writestr('.git/config', '[core]\\n\\thooksPath = /tmp/evil\\n')
    z.writestr('.planted/notes.txt', 'x')
    z.writestr('items/example-single/.git/HEAD', 'ref: refs/heads/main\\n')
`);
  const local = mkdtempSync(join(tmpdir(), 'amc-planted-'));
  execFileSync('docker', ['cp', `${CONTAINER}:/tmp/planted.zip`, join(local, 'planted.zip')]);
  await b.click('[data-act="exam-import"]');
  await b.waitFor(`!!document.querySelector('#exam-import-file')`, 5000);
  await b.setFiles('#exam-import-file', [join(local, 'planted.zip')]);
  await b.js(`document.querySelector('#exam-import-name').value = ${J(PLANTED)}; true`);
  b.created.add(PLANTED);
  await b.click('[data-act="exam-import-go"]');
  b.check('"Import an exam" brings in an archive', await b.waitFor(`S.route.kind === 'exam' && S.route.name === ${J(PLANTED)}`, 60000));
  const listing = inApp('find', `${projects}/${PLANTED}`, '-maxdepth', '3', '-name', '.*');
  b.check('...without the planted .git folders or the dot-folder', !listing.includes('.git') && !listing.includes('.planted') && inApp('ls', `${projects}/${PLANTED}/items`).includes('example-single'), listing);

  // ---- ./amc doctor
  let doctor = '';
  try { doctor = inApp('python3', '/amc-web/server/ui_doctor.py'); } catch (e) { doctor = `${e.stdout || ''}${e.message}`; }
  b.check('./amc doctor checks every history', doctor.includes('All histories are sound') && /exams: \d+ histor/.test(doctor), doctor.slice(-400));

  await b.goto('/exams');
  await b.waitFor('Array.isArray(S.projects)', 15000);
  for (const n of [EXAM, COPY, PLANTED]) b.check(`"${n}" is deleted`, await b.deleteExam(n));
}

main().then(() => b.finish(), (e) => b.finish(e));
