/*
 * A small headless-Chrome driver for the interface tests (Node 22+, no
 * packages): the Chrome DevTools Protocol over Node's built-in WebSocket.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

export async function startBrowser({ base, user = '', pass = '', shots = null, port = 9334 }) {
  const chromePath = process.env.CHROME
    || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');
  const profile = mkdtempSync(join(tmpdir(), 'amc-e2e-'));
  const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, '--window-size=1440,900', ...(user ? ['--ignore-certificate-errors'] : []), 'about:blank'], { stdio: 'ignore' });
  if (shots) mkdirSync(shots, { recursive: true });

  let ws; let id = 0; const pending = new Map(); const pageErrors = [];
  let passed = 0; const failures = [];
  for (let i = 0; i < 50 && !ws; i += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = targets.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      }
    } catch { ws = null; }
    if (!ws) await sleep(200);
  }
  if (!ws) throw new Error('Chrome did not start');
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') pageErrors.push(m.params.args.map((a) => a.value || a.description).join(' '));
  };
  const send = (method, params = {}) => new Promise((resolve) => { id += 1; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  const b = {
    send, pageErrors,
    async js(expression) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.result && r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'evaluation failed');
      return r.result?.result?.value;
    },
    async waitFor(expression, timeout = 15000) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        try { if (await b.js(expression)) return true; } catch { /* navigating */ }
        await sleep(150);
      }
      return false;
    },
    click: (sel) => b.js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error('not found: ' + ${JSON.stringify(sel)}); e.click(); return true; })()`),
    text: (sel) => b.js(`(document.querySelector(${JSON.stringify(sel)}) || {}).textContent || ''`),
    setValue: (sel, v) => b.js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', {bubbles: true})); e.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`),
    key: (key) => b.js(`document.dispatchEvent(new KeyboardEvent('keydown', {key: ${JSON.stringify(key)}, bubbles: true})); true`),
    async setFiles(sel, files) {
      const r = await send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(sel)})` });
      await send('DOM.setFileInputFiles', { files, objectId: r.result.result.objectId });
    },
    goto: (path) => send('Page.navigate', { url: base + path }),
    async shot(name) {
      if (!shots) return;
      const r = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(shots, `${name}.png`), Buffer.from(r.result.data, 'base64'));
    },
    check(name, ok, detail = '') {
      if (ok) { passed += 1; console.log(`PASS ${name}`); } else { failures.push(name); console.log(`FAIL ${name}${detail ? '  [' + detail + ']' : ''}`); }
    },
    async signIn() {
      if (!user) return;
      await b.goto('/');
      b.check('Signed-out visitors are sent to the sign-in page', await b.waitFor(`location.pathname === '/auth/login'`));
      await b.setValue('input[name="username"]', user);
      await b.setValue('input[name="password"]', pass);
      await b.js(`document.querySelector('form').submit(); true`);
      b.check('Signing in opens the app', await b.waitFor(`location.pathname === '/' || location.pathname === '/exams'`, 15000));
    },
    finish(error) {
      if (error) { failures.push('crash: ' + error.message); console.log('CRASH ' + error.stack); }
      b.check('No errors in the page', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
      console.log(`\n${failures.length ? 'FAILED' : 'ALL PASSED'}: ${passed} passed, ${failures.length} failed`);
      try { ws.close(); } catch { /* closed */ }
      chrome.kill();
      process.exit(failures.length ? 1 : 0);
    },
  };
  return b;
}
