/*
 * A small headless-Chrome driver for the interface tests (Node 22+, no
 * packages): the Chrome DevTools Protocol over Node's built-in WebSocket.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

export async function startBrowser({ base, user = '', pass = '', shots = null, port = 9334, tour = false, qtab = 'latex' }) {
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
  if (!ws) { chrome.kill(); rmSync(profile, { recursive: true, force: true }); throw new Error('Chrome did not start'); }
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') pageErrors.push(m.params.args.map((a) => a.value || a.description).join(' '));
  };
  // A call that never answers (Chrome gone) fails after a while instead of hanging the run.
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    id += 1; const myId = id;
    const timer = setTimeout(() => { if (pending.delete(myId)) reject(new Error(`Chrome did not answer ${method}`)); }, 60000);
    pending.set(myId, (m) => { clearTimeout(timer); resolve(m); });
    ws.send(JSON.stringify({ id: myId, method, params }));
  });
  await send('Runtime.enable'); await send('Page.enable');
  // The first-run tour would cover the page in every test: mark it as seen, unless a test is about it.
  // Questions opens on the LaTeX tab unless a test asks for the form (qtab: 'form').
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { ${tour ? '' : "localStorage.setItem('amc-ui:tour-done', 'true');"} localStorage.setItem('amc-ui:qtab', ${JSON.stringify(JSON.stringify(qtab))}); } catch (e) {}` });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  const b = {
    send, pageErrors,
    created: new Set(), // exams this test made and must delete
    /* Makes an exam from one of AMC's templates and waits for it to open. */
    async createFromTemplate(name, template = 'en/simple') {
      b.created.add(name);
      await b.js(`S.creating = ${JSON.stringify(name)}; socket_emit('create-project-template', [${JSON.stringify(name)}, ${JSON.stringify(template)}]); true`);
      return b.waitFor(`S.project === ${JSON.stringify(name)} && !!S.status`, 30000);
    },
    /* Deletes an exam and waits until the server no longer lists it. */
    async deleteExam(name) {
      b.created.delete(name);
      const listed = await b.js(`fetch('/ui/api/projects', {cache: 'no-store'}).then(r => r.json()).then(r => r.projects.some(p => p.name === ${JSON.stringify(name)}))`);
      if (!listed) return true; // never made, or gone already
      await b.js(`socket_emit('project-delete', ${JSON.stringify(name)}); true`);
      const gone = await b.waitFor(`fetch('/ui/api/projects', {cache: 'no-store'}).then(r => r.json()).then(r => !r.projects.some(p => p.name === ${JSON.stringify(name)}))`, 20000);
      // A deleted exam goes to the trash: empty it from there too, so test copies don't fill up.
      await b.js(`fetch('/ui/api/trash', {cache: 'no-store'}).then(r => r.json()).then(async (r) => { for (const x of (r.items || []).filter((x) => x.name === ${JSON.stringify(name)})) await fetch('/ui/api/trash/delete', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id: x.id})}); return true; }).catch(() => false)`);
      return gone;
    },
    /* Refuses to run against a copy of the app that holds real work, unless AMC_E2E_FORCE=1. */
    async preflight({ exams = [], emptyOnly = false, neutralBranding = false } = {}) {
      if (process.env.AMC_E2E_FORCE === '1') return;
      const problems = [];
      const list = await b.js(`fetch('/ui/api/projects', {cache: 'no-store'}).then(r => r.json()).then(r => r.projects.map(p => p.name))`);
      if (emptyOnly && list.length) problems.push(`the app already has ${list.length} exam(s)`);
      exams.filter((n) => list.includes(n)).forEach((n) => problems.push(`an exam named "${n}" already exists`));
      if (neutralBranding) {
        const br = await b.js(`fetch('/ui/api/branding', {cache: 'no-store'}).then(r => r.json())`);
        if (br.name || br.logo || br.color) problems.push('a school name, logo or colour is set (the test resets them)');
      }
      if (problems.length) {
        console.log(`NOT RUN: ${problems.join('; ')}. Use a test copy of the app, or set AMC_E2E_FORCE=1 to run anyway.`);
        await b.finish(new Error('pre-flight check failed'));
      }
    },
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
    async finish(error) {
      if (error) { failures.push('crash: ' + error.message); console.log('CRASH ' + error.stack); }
      for (const name of [...b.created]) { // left behind by a crash or a failed check
        try { b.check(`Leftover test exam "${name}" is deleted`, await b.deleteExam(name)); } catch (e) { b.check(`Leftover test exam "${name}" is deleted`, false, e.message); }
      }
      b.check('No errors in the page', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
      console.log(`\n${failures.length ? 'FAILED' : 'ALL PASSED'}: ${passed} passed, ${failures.length} failed`);
      try { ws.close(); } catch { /* closed */ }
      // Chrome keeps writing its profile until it has exited: wait for it before removing the folder.
      await new Promise((done) => { chrome.once('exit', done); setTimeout(done, 5000); chrome.kill(); });
      try { rmSync(profile, { recursive: true, force: true }); } catch { /* still in use: left in the temp folder */ }
      process.exit(failures.length ? 1 : 0);
    },
  };
  return b;
}
