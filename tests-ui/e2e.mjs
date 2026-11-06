#!/usr/bin/env node
/*
 * End-to-end test of the new interface in a real (headless) Chrome.
 *
 *   node tests-ui/e2e.mjs http://127.0.0.1:8095 [screenshots-dir]
 *
 * Needs Node 22+ and Google Chrome (CHROME=/path/to/chrome to override).
 * Run it against a test copy of the app with an empty data folder: it
 * creates, renames, duplicates and deletes exams.
 *
 * Shared-machine mode: set AMC_E2E_USER and AMC_E2E_PASS to sign in first
 * (the base URL is then https://..., and the app's own certificate is
 * accepted for the test).
 *
 * Direct printing: with AMC_E2E_PRINTER=1 the test prints on the app's
 * printer instead of saving PDFs (the app must see a print system).
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:8095';
const SHOTS = process.argv[3] || null;
const CHROME = process.env.CHROME
  || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');
const PORT = 9333;
const EXAM = 'UI test exam';
const USER = process.env.AMC_E2E_USER || '';
const PASS = process.env.AMC_E2E_PASS || '';

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
let passed = 0;
const failures = [];
const pageErrors = [];
function check(name, ok, detail = '') {
  if (ok) { passed += 1; console.log(`PASS ${name}`); } else { failures.push(name); console.log(`FAIL ${name}${detail ? '  [' + detail + ']' : ''}`); }
}

/* ---- minimal Chrome DevTools Protocol client ---- */
const profile = mkdtempSync(join(tmpdir(), 'amc-e2e-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, '--window-size=1440,900', ...(USER ? ['--ignore-certificate-errors'] : []), 'about:blank'], { stdio: 'ignore' });
let ws; let msgId = 0; const pending = new Map(); const listeners = [];
async function connect() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = targets.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
          else listeners.forEach((fn) => fn(m));
        };
        return;
      }
    } catch { /* Chrome still starting */ }
    await sleep(200);
  }
  throw new Error('Chrome did not start');
}
function send(method, params = {}) {
  return new Promise((resolve) => { msgId += 1; pending.set(msgId, resolve); ws.send(JSON.stringify({ id: msgId, method, params })); });
}
async function js(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result && r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'evaluation failed');
  return r.result?.result?.value;
}
async function waitFor(expression, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { if (await js(expression)) return true; } catch { /* page navigating */ }
    await sleep(150);
  }
  return false;
}
async function shot(name) {
  if (!SHOTS) return;
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(r.result.data, 'base64'));
}
const click = (sel) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error('not found: ${sel.replace(/'/g, '')}'); e.click(); return true; })()`);
const text = (sel) => js(`(document.querySelector(${JSON.stringify(sel)}) || {}).textContent || ''`);
const setValue = (sel, v) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', {bubbles: true})); e.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);
const path = () => js('decodeURIComponent(location.pathname)');
const status = () => js(`fetch('/ui/api/status', {headers: {'AMC-project': S.project}}).then(r => r.json())`);

async function main() {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  await connect();
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  listeners.push((m) => {
    if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') pageErrors.push(m.params.args.map((a) => a.value || a.description).join(' '));
  });

  if (USER) {
    await send('Page.navigate', { url: `${BASE}/` });
    check('Signed-out visitors are sent to the sign-in page', await waitFor(`location.pathname === '/auth/login'`));
    await setValue('input[name="username"]', USER);
    await setValue('input[name="password"]', PASS);
    await js(`document.querySelector('form').submit(); true`);
    check('Signing in opens the app', await waitFor(`location.pathname === '/' || location.pathname === '/exams'`, 15000), await path());
    check('The top bar shows who is signed in', await waitFor(`document.querySelector('#topbar') && document.querySelector('#topbar').textContent.includes(${JSON.stringify(USER)})`));
  }
  await send('Page.navigate', { url: `${BASE}/` });
  check('The exams page opens at /', await waitFor(`document.querySelector('h1') && document.querySelector('h1').textContent === 'Exams'`));
  check('An empty install says there are no exams yet', await waitFor(`document.body.textContent.includes('No exams yet')`));
  check('The connection to the server comes up', await waitFor('S.online === true'));
  await shot('01-exams-empty');

  // Create an exam from AMC's "simple" template, through the new-exam wizard
  await click('#main a[href="/new"]');
  check('New exam opens the wizard', await waitFor(`location.pathname === '/new' && !!document.querySelector('#wiz-name')`));
  await setValue('#wiz-name', EXAM);
  await click('[data-act="wiz-next"]');
  check('AMC templates are offered', await waitFor(`!!S.gallery && S.gallery.templates.some(t => t.gid === 'en' && t.id === 'simple')`, 10000));
  await click('[data-act="wiz-group"][data-v="en"]');
  await click('[data-act="wiz-pick"][data-gid="en"][data-id="simple"]');
  await shot('02-new-exam');
  await click('[data-act="wiz-next"]');
  await click('[data-act="wiz-create"]');
  check('Creating opens the new exam at Questions', await waitFor(`decodeURIComponent(location.pathname) === '/exam/${EXAM}/questions'`, 30000), await path());
  check('The source file loads into the editor', await waitFor(`typeof editor !== 'undefined' && editor && editor.getValue().includes('documentclass')`, 20000));
  check('The main source file is selected', (await js(`document.querySelector('#file-select').value`)) !== '');
  await shot('03-questions');

  // Edit, guard, save
  await js(`editor.session.insert({row: 0, column: 0}, '% edited by the e2e test\\n'); true`);
  check('Editing shows "Unsaved changes"', await waitFor(`document.querySelector('#editor-bar').textContent.includes('Unsaved changes')`));
  await click('.step[href$="/papers"]');
  check('Leaving with unsaved changes asks first', await waitFor(`document.querySelector('#layer').textContent.includes('Leave without saving')`));
  await click('[data-act="dialog-cancel"]');
  check('Cancelling stays on Questions', (await path()).endsWith('/questions'));
  await click('[data-act="save"]');
  check('Save clears "Unsaved changes"', await waitFor(`!S.source.dirty && document.querySelector('#editor-bar').textContent.includes('Saved')`));
  const saved = await js(`fetch(S.source.url, {cache: 'no-store'}).then(r => r.text())`);
  check('The saved file on the server has the edit', saved.startsWith('% edited by the e2e test'));

  // Build the preview
  await click('[data-act="build"]');
  check('Building shows progress', await waitFor(`!!document.querySelector('#work')`, 10000));
  check('Building finishes', await waitFor(`!document.querySelector('#work')`, 120000));
  if (await js(`!!document.querySelector('.server-dialog')`)) {
    console.log('  server message: ' + (await text('.server-dialog')).replace(/\s+/g, ' ').slice(0, 300));
    await js(`warn_ok(); true`);
  }
  const st = await status();
  check('The question paper was built', st.docs && st.docs.sujet, JSON.stringify(st.docs));
  check('Layout detection ran', st.layout_pages > 0, `layout_pages=${st.layout_pages}`);
  check('The preview panel shows the question paper', await waitFor(`!!document.querySelector('#preview iframe[src*="DOC-sujet.pdf"]')`, 10000));
  check('The sidebar marks Questions done and asks for the layout check in Papers', await waitFor(`document.querySelector('.step[href$="/questions"]').classList.contains('is-done') && document.querySelector('.step[href$="/papers"]').classList.contains('is-attention')`));
  check('The top bar asks for the layout check', (await text('#topbar')).includes('Layout to check'));
  await sleep(1500);
  await shot('04-built');

  // Phase 2: papers and the layout check
  check('Print is closed until the layout is checked', await (async () => { await click('.step[href$="/print"]'); return waitFor(`document.querySelector('#main').textContent.includes('Check the layout first')`); })());
  await click('.step[href$="/papers"]');
  check('Papers asks to check the layout', await waitFor(`document.querySelector('#main').textContent.includes('Check the layout') && !!document.querySelector('[data-act="layout-ok"]')`));
  check('The layout picture opens in the preview', await waitFor(`!!document.querySelector('#preview object.layout-svg')`, 20000));
  const firstPage = await text('#preview .preview-title');
  await click('#preview [data-act="layout-step"][data-delta="1"]');
  check('Next page shows another page of the layout', await waitFor(`document.querySelector('#preview .preview-title').textContent !== ${JSON.stringify(firstPage)}`, 15000), firstPage);
  await sleep(800);
  await shot('05-layout-check');
  await setValue('#copies', '6');
  check('Changing the number of copies is saved', await waitFor(`fetch('/ui/api/config', {headers: {'AMC-project': S.project}}).then(r => r.json()).then(c => c.options.nombre_copies === '6')`, 5000));
  await click('[data-act="layout-ok"]');
  check('"Looks correct" confirms the layout', await waitFor(`S.status && !!S.status.layout_ok`, 10000));
  check('...and opens Print', await waitFor(`document.querySelector('.step[href$="/print"]').classList.contains('is-attention')`));

  // Marking scheme
  await click('.step[href$="/marking-scheme"]');
  check('Marking scheme loads the default scoring', await waitFor(`!!document.querySelector('#score-S-preset')`, 10000));
  await setValue('#score-S-preset', 'b=1,m=-0.25');
  await setValue('#score-M-preset', 'mz=1');
  await click('[data-act="save-scoring"]');
  check('Default scoring is saved', await waitFor(`S.scoring && S.scoring.S === 'b=1,m=-0.25' && S.scoring.M === 'mz=1'`, 10000));
  const src = await js(`fetch('/fs/' + encodeURIComponent(S.project) + '/' + encodeURIComponent(S.status.source) + '?attach=0', {cache: 'no-store'}).then(r => r.text())`);
  check('...in the source, as \\scoringDefaultS/M', src.includes('\\scoringDefaultS{b=1,m=-0.25}') && src.includes('\\scoringDefaultM{mz=1}'));
  await setValue('[data-option="note_max"]', '20');
  check('Final mark settings are saved', await waitFor(`fetch('/ui/api/config', {headers: {'AMC-project': S.project}}).then(r => r.json()).then(c => c.options.note_max === '20')`, 5000));
  await shot('06-marking');

  // Print: save PDFs, which locks the exam
  await click('.step[href$="/print"]');
  check('Print offers saving PDFs', await waitFor(`!!document.querySelector('[data-act="print"]')`));
  if (process.env.AMC_E2E_PRINTER) {
    check('Direct printing is offered when a print system is connected', await waitFor(`document.querySelector('[data-route="printer"]').getAttribute('aria-disabled') === 'false'`, 15000));
    await click('[data-route="printer"]');
    check('The printers of the machine are listed', await waitFor(`!!document.querySelector('#print-printer option')`));
  } else {
    check('Direct printing is off without a Linux print system', await waitFor(`document.querySelector('[data-route="printer"]').getAttribute('aria-disabled') === 'true'`, 10000));
  }
  await shot('07-print');
  await click('[data-act="print"]');
  check('Printing warns that it locks the exam', await waitFor(`document.querySelector('#layer').textContent.includes('This locks the exam')`));
  await click('[data-act="dialog-ok"]');
  if (process.env.AMC_E2E_PRINTER && await waitFor(`!!document.querySelector('.server-dialog')`, 60000)) {
    console.log('  server message: ' + (await text('.server-dialog')).replace(/\s+/g, ' ').slice(0, 200));
    await js(`warn_ok(); true`);
  }
  check('Printing runs and locks the exam', await waitFor(`S.status && !!S.status.lock`, 120000));
  check('The top bar says printed and locked', await waitFor(`document.querySelector('#topbar').textContent.includes('locked')`));
  check('Questions and Papers show a lock', await js(`document.querySelector('.step[href$="/questions"]').classList.contains('is-locked') && document.querySelector('.step[href$="/papers"]').classList.contains('is-locked')`));

  // The server refuses changes that would move things on the printed papers
  await js(`socket_emit('ncopies', 99); true`);
  check('The server refuses a new number of copies', await waitFor(`!!document.querySelector('.server-dialog') && document.querySelector('.server-dialog').textContent.includes('locked')`, 10000));
  await js(`warn_ok(); true`);
  const before = (await status()).layout_pages;
  await js(`socket_emit('doc-update', 'sujet'); true`);
  check('The server refuses rebuilding the question paper', await waitFor(`!!document.querySelector('.server-dialog')`, 10000) && (await status()).layout_pages === before);
  await js(`warn_ok(); true`);
  check('...and the copies are unchanged', (await js(`fetch('/ui/api/config', {headers: {'AMC-project': S.project}}).then(r => r.json()).then(c => c.options.nombre_copies)`)) === '6');

  await click('.step[href$="/questions"]');
  check('Questions are read-only once printed, pointing to the marking scheme', await waitFor(`typeof editor !== 'undefined' && editor && editor.getValue().length > 0 && editor.getReadOnly() && !document.querySelector('[data-act="save"]') && !!document.querySelector('#main a.btn-primary[href$="/marking-scheme"]')`, 20000));
  check('Building the preview is not offered', await js(`!document.querySelector('[data-act="build"]')`));
  // The server itself still refuses changes that move things, whatever sends them
  const uploadSource = (t) => js(`(async (t) => { const f = new FormData(); f.append('file', new Blob([t], {type: 'text/plain'}), S.source.name); const r = await fetch('/upload/source', {method: 'POST', headers: {'AMC-project': S.project, 'AMC-sid': socket.id}, body: f}); return r.json(); })(${JSON.stringify(t)})`);
  const original = await js('S.source.text');
  check('The server refuses a text change', !!(await uploadSource('Changed text\n' + original)).error);
  const swapped = original.replace('\\correctchoice', '\\TMPCHOICE').replace('\\wrongchoice', '\\correctchoice').replace('\\TMPCHOICE', '\\wrongchoice');
  check('The server accepts an answer key correction', swapped !== original && (await uploadSource(swapped)).ok === true);

  // Unlock
  await click('[data-act="unlock"]');
  check('Unlocking asks for the exam name', await waitFor(`!!document.querySelector('#dlg-form [name="name"]')`));
  await setValue('#dlg-form [name="name"]', 'wrong name');
  await js(`document.querySelector('#dlg-form').requestSubmit(); true`);
  check('A wrong name doesn\'t unlock', (await text('#dlg-error')).includes("doesn't match"));
  await setValue('#dlg-form [name="name"]', await js('S.project'));
  await js(`document.querySelector('#dlg-form').requestSubmit(); true`);
  check('Unlocking removes the lock and the layout', await waitFor(`S.status && !S.status.lock && !S.status.layout_pages`, 20000));
  check('The editor offers building again', await waitFor(`!!document.querySelector('[data-act="build"]')`, 10000));

  // A step that needs earlier ones explains what comes first
  await click('.step[href$="/mark"]');
  check('Mark explains that scans come first', await waitFor(`document.querySelector('#main').textContent.includes('No scans yet') && !!document.querySelector('#main a[href$="/upload-scans"]')`));
  check('Leaving Questions closed the editor', await js('editor === null'));

  // Preview panel: close, reopen
  await click('#topbar [data-act="toggle-preview"]');
  check('The preview panel closes', await waitFor(`document.querySelector('#app').classList.contains('preview-closed')`));
  await click('#topbar [data-act="toggle-preview"]');
  check('...and opens again', await waitFor(`!document.querySelector('#app').classList.contains('preview-closed')`));

  // Settings: rename
  await click('.side-link[href$="/settings"]');
  check('Exam settings open', await waitFor(`!!document.querySelector('#cfg-name') && S.config && S.config.project === S.project`));
  await setValue('#cfg-name', `${EXAM} 2`);
  await click('[data-act="rename-current"]');
  check('Renaming follows the new name in the address', await waitFor(`decodeURIComponent(location.pathname) === '/exam/${EXAM} 2/settings'`, 10000), await path());
  check('Settings show the exam\'s history', await waitFor(`document.querySelector('#main').textContent.includes('Layout checked and confirmed') && document.querySelector('#main').textContent.includes('Unlocked')`, 10000));

  // Back to the list: state, duplicate, delete
  await click('.crumbs a[href="/exams"]');
  check('The exams list shows the renamed exam as a draft again', await waitFor(`[...document.querySelectorAll('.exam-card')].some(c => c.textContent.includes('${EXAM} 2') && c.textContent.includes('Draft'))`));
  await shot('05-exams');
  await click(`[data-act="menu"][data-menu="${EXAM} 2"]`);
  await click(`[data-act="clone-exam"][data-name="${EXAM} 2"]`);
  check('Duplicating adds a second exam', await waitFor(`document.querySelectorAll('.exam-card').length === 2`, 30000));
  if (await waitFor(`!!document.querySelector('.server-dialog')`, 5000)) await js(`warn_ok(); true`);
  const copyName = await js(`S.projects.map(p => p.name).find(n => n !== '${EXAM} 2')`);
  await click(`[data-act="menu"][data-menu="${copyName}"]`);
  await click(`[data-act="delete-exam"][data-name="${copyName}"]`);
  check('Deleting asks first', await waitFor(`document.querySelector('#layer').textContent.includes('Delete')`));
  await click('[data-act="dialog-ok"]');
  check('Deleting removes the copy', await waitFor(`document.querySelectorAll('.exam-card').length === 1`, 10000));

  // Theme
  await click('#topbar [data-act="theme"]');
  const t1 = await js(`document.documentElement.getAttribute('data-theme')`);
  await click('#topbar [data-act="theme"]');
  const t2 = await js(`document.documentElement.getAttribute('data-theme')`);
  check('The theme button switches light and dark', t1 === 'light' && t2 === 'dark', `${t1}, ${t2}`);
  await send('Page.navigate', { url: `${BASE}/exam/${encodeURIComponent(EXAM + ' 2')}/questions` });
  check('A link straight to a step works after reload, in dark mode', await waitFor(`document.documentElement.getAttribute('data-theme') === 'dark' && typeof editor !== 'undefined' && editor && editor.getValue().length > 0`, 20000));
  await sleep(1500);
  await shot('06-dark-questions');
  await click('#topbar [data-act="theme"]'); // back to automatic

  // Leave the data folder as it was found
  await js(`socket_emit('project-delete', ${JSON.stringify(EXAM + ' 2')}); true`);
  check('The test exam is deleted at the end', await waitFor(`fetch('/ui/api/projects').then(r => r.json()).then(r => r.projects.length === 0)`, 10000));

  check('No errors in the page', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
}

main().catch((e) => { failures.push('crash: ' + e.message); console.log('CRASH ' + e.stack); })
  .finally(() => {
    console.log(`\n${failures.length ? 'FAILED' : 'ALL PASSED'}: ${passed} passed, ${failures.length} failed`);
    try { ws && ws.close(); } catch { /* closed */ }
    chrome.kill();
    process.exit(failures.length ? 1 : 0);
  });
