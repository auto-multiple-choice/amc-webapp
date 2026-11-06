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

  // Create an exam from AMC's "simple" template
  await click('[data-act="new-exam"]');
  check('New exam opens a dialog', await waitFor(`!!document.querySelector('#dlg-form')`));
  await setValue('#dlg-form [name="name"]', EXAM);
  const hasSimple = await js(`[...document.querySelectorAll('#dlg-form option')].some(o => o.value === 'en/simple')`);
  check('AMC templates are offered', hasSimple);
  await setValue('#dlg-form [name="from"]', 'en/simple');
  await shot('02-new-exam');
  await js(`document.querySelector('#dlg-form').requestSubmit()`);
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
  check('The sidebar marks Questions and Papers done', await waitFor(`document.querySelector('.step[href$="/questions"]').classList.contains('is-done') && document.querySelector('.step[href$="/papers"]').classList.contains('is-done')`));
  check('The top bar shows "Papers built"', (await text('#topbar')).includes('Papers built'));
  await sleep(1500);
  await shot('04-built');

  // A step from a later phase
  await click('.step[href$="/papers"]');
  check('Later steps explain when they arrive', await waitFor(`document.querySelector('#main').textContent.includes('Coming in phase 2')`));
  check('...and show the exam\'s real data', (await text('#main')).includes('Pages laid out'));
  check('Leaving Questions closed the editor', await js('editor === null'));

  // Preview panel: switch document, close, reopen
  check('With one document built, the panel shows it without tabs', await js(`document.querySelectorAll('#preview [data-act="show-doc"]').length === 0 && !!document.querySelector('#preview iframe')`));
  await click('#topbar [data-act="toggle-preview"]');
  check('The preview panel closes', await waitFor(`document.querySelector('#app').classList.contains('preview-closed')`));
  await click('#topbar [data-act="toggle-preview"]');
  check('...and opens again', await waitFor(`!document.querySelector('#app').classList.contains('preview-closed')`));

  // Settings: rename
  await click('.side-link[href$="/settings"]');
  check('Exam settings open', await waitFor(`!!document.querySelector('#cfg-name')`));
  await setValue('#cfg-name', `${EXAM} 2`);
  await click('[data-act="rename-current"]');
  check('Renaming follows the new name in the address', await waitFor(`decodeURIComponent(location.pathname) === '/exam/${EXAM} 2/settings'`, 10000), await path());

  // Back to the list: state, duplicate, delete
  await click('.crumbs a[href="/exams"]');
  check('The exams list shows the renamed exam as "Papers built"', await waitFor(`[...document.querySelectorAll('.exam-card')].some(c => c.textContent.includes('${EXAM} 2') && c.textContent.includes('Papers built'))`));
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

  check('No errors in the page', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
}

main().catch((e) => { failures.push('crash: ' + e.message); console.log('CRASH ' + e.stack); })
  .finally(() => {
    console.log(`\n${failures.length ? 'FAILED' : 'ALL PASSED'}: ${passed} passed, ${failures.length} failed`);
    try { ws && ws.close(); } catch { /* closed */ }
    chrome.kill();
    process.exit(failures.length ? 1 : 0);
  });
