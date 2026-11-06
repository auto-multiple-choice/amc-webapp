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
  await b.js(`S.creating = ${JSON.stringify(name)}; socket_emit('create-project-template', [${JSON.stringify(name)}, 'en/simple']); true`);
  b.check('The exam is created', await b.waitFor(`S.project === ${JSON.stringify(name)} && !!S.status`, 30000));
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
