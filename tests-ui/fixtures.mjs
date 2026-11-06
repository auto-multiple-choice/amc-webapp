/*
 * Shared setup for the browser tests: an exam with built, confirmed and
 * printed papers, and test scans made for it (make_scans.py).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SECOND_PAGE = '\\clearpage\n\\begin{question}{extra}\n  Is this the second page?\n  \\begin{choices}\n'
  + '    \\correctchoice{Yes}\n    \\wrongchoice{No}\n  \\end{choices}\n\\end{question}\n';

/*
 * Creates `name` from AMC's simple template with two pages per copy and,
 * with codeGrid, a 3-digit student code grid; builds, confirms the layout
 * and marks it as printed. Checks are recorded on `b`.
 */
export async function printedExam(b, { name, copies = null, codeGrid = false }) {
  b.check('The exam is created', await b.createFromTemplate(name));
  // Markers are lines of AMC's simple template.
  const edits = [['% \\AMCaddpagesto{3}', SECOND_PAGE]];
  if (codeGrid) edits.push(['%%% end of the header', '%%% end of the header\n\\AMCcodeGridInt{student}{3}\n']);
  const edited = await b.js(`(async (edits) => {
    const src = S.status.source;
    const url = '/fs/' + encodeURIComponent(S.project) + '/' + encodeURIComponent(src) + '?attach=0';
    let t = await (await fetch(url, {cache: 'no-store'})).text();
    for (const [marker, text] of edits) { if (!t.includes(marker)) return false; t = t.replace(marker, text); }
    const form = new FormData();
    form.append('file', new Blob([t], {type: 'text/plain'}), src);
    const r = await fetch('/upload/source', {method: 'POST', headers: {'AMC-project': S.project, 'AMC-sid': socket.id}, body: form});
    return (await r.json()).ok === true;
  })(${JSON.stringify(edits)})`);
  b.check(`The test exam gets a second page per copy${codeGrid ? ' and student code boxes' : ''}`, edited === true);
  if (copies) await b.js(`socket_emit('ncopies', ${copies}); true`);
  await b.js(`socket_emit('doc-update', 'sujet'); true`);
  await b.waitFor(`!!document.querySelector('#work')`, 10000);
  b.check('The papers are built', await b.waitFor(`!document.querySelector('#work') && S.status && S.status.layout_pages > 0`, 180000));
  if (await b.js(`!!document.querySelector('.server-dialog')`)) await b.js('warn_ok(); true');
  await b.js(`socket_emit('ui-layout-ok'); true`);
  await b.waitFor(`S.status && !!S.status.layout_ok`, 10000);
  await b.js(`socket_emit('ui-mark-printed'); true`);
  b.check('The exam is locked as printed', await b.waitFor(`S.status && !!S.status.lock`, 10000));
}

/*
 * The app's container, from the address the test runs against: the
 * container publishing that port (caddy in shared-machine mode) belongs
 * to a compose project, whose amc-web service is the one.
 * AMC_E2E_CONTAINER names it directly instead.
 */
export function appContainer(base) {
  if (process.env.AMC_E2E_CONTAINER) return process.env.AMC_E2E_CONTAINER;
  const run = (args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
  const port = new URL(base).port || (base.startsWith('https') ? '443' : '80');
  const front = run(['ps', '--filter', `publish=${port}`, '--format', '{{.Names}}']).split('\n')[0];
  if (!front) throw new Error(`No container publishes port ${port}; set AMC_E2E_CONTAINER`);
  const project = run(['inspect', front, '--format', '{{index .Config.Labels "com.docker.compose.project"}}']);
  if (!project) return front;
  return run(['ps', '--filter', `label=com.docker.compose.project=${project}`, '--filter', 'label=com.docker.compose.service=amc-web', '--format', '{{.Names}}']).split('\n')[0] || front;
}

/*
 * Makes test scans in the app's container and copies them here.
 * Returns make_scans.py's summary and the local file paths.
 */
export function makeScans({ container, user, exam, options = {} }) {
  const projectDir = `/amc-web/files/MC-Projects${user ? '/' + user : ''}/${exam}`;
  execFileSync('docker', ['exec', container, 'rm', '-rf', '/tmp/amc-test-scans']);
  // Piped to Python rather than copied in: copies of files can come out
  // unreadable for the app's user (for example from an exFAT drive).
  const made = JSON.parse(execFileSync('docker', ['exec', '-i', container, '/venv/bin/python', '-', projectDir, '/tmp/amc-test-scans', JSON.stringify(options)],
    { input: readFileSync(new URL('./make_scans.py', import.meta.url)), encoding: 'utf8' }));
  const local = mkdtempSync(join(tmpdir(), 'amc-scans-'));
  execFileSync('docker', ['cp', `${container}:/tmp/amc-test-scans/.`, local]);
  const files = readdirSync(local).filter((f) => f.endsWith('.png')).sort().map((f) => join(local, f));
  return { made, files };
}
