#!/usr/bin/env node
/*
 * End-to-end test of the source history: versions kept on save, the
 * History panel with its diff, restoring, "built OK", a save that
 * conflicts with another tab, drafts kept in the browser, deleting a file
 * into the history and bringing it back, and the exam zip without it.
 *
 *   node tests-ui/e2e-history.mjs http://127.0.0.1:8095 [screenshots-dir]
 *
 * AMC_E2E_USER / AMC_E2E_PASS: sign in first (shared-machine mode).
 * Use a test copy of the app, never your real exams.
 */
import { startBrowser, sleep } from './cdp.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:8095';
const USER = process.env.AMC_E2E_USER || '';
const EXAM = 'History test';
const b = await startBrowser({ base: BASE, user: USER, pass: process.env.AMC_E2E_PASS || '', shots: process.argv[3] || null });
const J = JSON.stringify;

const history = (file) => b.js(`getJSON('/ui/api/history?file=' + encodeURIComponent(${J(file)}))`);
const editorText = () => b.js('editor.getValue()');
const setText = (text) => b.js(`editor.setValue(${J(text)}, -1); true`);
const saveNow = () => b.js('saveSource()');
const uploadSource = (name, text) => b.js(`(async () => { const f = new FormData(); f.append('file', new Blob([${J(text)}], {type: 'text/plain'}), ${J(name)});
  const r = await fetch(${J(name)} === S.status.source ? '/upload/source' : '/upload/project', {method: 'POST', headers: {'AMC-project': S.project, 'AMC-sid': socket.id}, body: f}); return (await r.json()).ok === true; })()`);
const loaded = () => b.waitFor('S.source.loaded && !!S.source.digest && !S.source.dirty', 15000);

async function main() {
  await b.signIn();
  await b.goto('/');
  b.check('The app opens', await b.waitFor('S.online === true'));
  await b.preflight({ exams: [EXAM] });
  b.check('The exam is created', await b.createFromTemplate(EXAM));
  b.check('The editor loads the source with its digest', await loaded() && (await b.js('S.source.tracked')) === true);
  const main = await b.js('S.status.source');
  const original = await editorText();
  let h = await history(main);
  b.check('A new exam has no earlier version yet', h.versions.length === 0 && h.current && !h.current.built, J(h));
  b.check('History is offered in the editor bar; the main source has no Delete', await b.js(`!document.querySelector('[data-act="history"]').disabled && !document.querySelector('[data-act="delete-file"]')`));

  // ---- saving keeps versions
  await setText(original + '% first change\n'); // the template ends with a newline: one line added
  b.check('Typing marks the source as unsaved', await b.waitFor('S.source.dirty', 3000));
  b.check('Save works', (await saveNow()) === true && await loaded());
  h = await history(main);
  const bytes = await b.js(`new TextEncoder().encode(${J(original)}).length`);
  b.check('The replaced version is kept, with its size', h.versions.length === 1 && h.versions[0].size === bytes, J(h.versions));
  await setText(original + '% first change\n% second change\n');
  b.check('A second save keeps the second version', (await saveNow()) === true && await loaded() && (h = await history(main)).versions.length === 2);
  b.check('Versions are newest first and say how they were made', h.versions[0].what === 'Saved in the editor' && (USER ? h.versions[0].by === USER : true), J(h.versions.map((v) => [v.what, v.by])));

  // ---- the History panel
  await b.click('[data-act="history"]');
  b.check('The History panel opens in the preview', await b.waitFor(`S.previewMode === 'history' && S.history && S.history.versions && document.querySelectorAll('#preview .hist-row').length === 3`, 10000));
  await b.shot('h1-panel');
  await b.click(`[data-act="hist-pick"][data-id="${h.versions[0].id}"]`);
  b.check('Picking a version shows its diff against the file now', await b.waitFor(`S.history.text !== null && document.querySelectorAll('#preview .diff .add').length === 1 && document.querySelector('#preview .diff .add').textContent.includes('second change') && !document.querySelector('#preview .diff .del')`, 10000),
    await b.js(`(document.querySelector('#preview .diff') || {}).textContent`));
  await b.shot('h2-diff');
  // restore the original
  await b.click(`[data-act="hist-pick"][data-id="${h.versions[1].id}"]`);
  await b.waitFor('S.history.text !== null', 10000);
  b.check('Two added lines show for the oldest version', await b.js(`document.querySelectorAll('#preview .diff .add').length === 2`));
  await b.click('[data-act="hist-restore"]');
  b.check('Restoring asks first', await b.waitFor(`!!document.querySelector('.dialog') && document.querySelector('#dlg-title').textContent.startsWith('Restore the version')`, 3000));
  await b.click('.dialog [data-act="dialog-ok"]');
  b.check('The restored text is back in the editor', await b.waitFor(`S.source.loaded && !S.source.dirty && editor.getValue() === ${J(original)}`, 15000), J(await editorText()));
  h = await history(main);
  b.check('The replaced text was kept, and the file now says it was restored', h.versions.length === 3 && h.versions[0].what === 'Saved in the editor' && h.current.what.startsWith('Restored the version of'), J([h.current.what, h.versions.map((v) => v.what)]));
  await b.waitFor(`S.status && S.status.activity.some(a => a.what.includes('restored'))`, 5000);
  b.check('The activity list records the restore', await b.js(`S.status.activity.some(a => a.what.includes('restored'))`));

  // ---- built OK
  await b.js(`socket_emit('doc-update', 'sujet'); true`);
  await b.waitFor(`!!document.querySelector('#work')`, 10000);
  b.check('The question paper builds', await b.waitFor(`!document.querySelector('#work') && S.status && S.status.docs.sujet`, 180000));
  if (await b.js(`!!document.querySelector('.server-dialog')`)) await b.js('warn_ok(); true');
  h = await history(main);
  b.check('The file now is marked as built', h.current && h.current.built === true, J(h.current));
  await setText(original + '\n% third change\n');
  b.check('Saving after a build keeps the built version marked', (await saveNow()) === true && await loaded() && (h = await history(main)).versions[0].built === true && !h.current.built, J(h.versions.map((v) => [v.what, v.built])));
  b.check('The panel shows "built OK"', await b.waitFor(`[...document.querySelectorAll('#preview .hist-row .chip')].some(c => c.textContent.includes('built OK'))`, 5000));

  // ---- a save that conflicts with another tab
  b.check('Another tab saves the file', await uploadSource(main, original + '\n% from another tab\n'));
  await setText(original + '\n% mine\n');
  await b.waitFor('S.source.dirty', 3000);
  const saving = saveNow();
  b.check('The conflict is explained', await b.waitFor(`!!document.querySelector('.dialog') && document.querySelector('#dlg-title').textContent === 'Changed elsewhere'`, 5000));
  await b.shot('h3-conflict');
  await b.click('.dialog [data-act="dialog-result"][data-v="theirs"]');
  b.check('Loading theirs is refused as a save', (await saving) === false);
  b.check('Their version is loaded and my text offered as unsaved text', await b.waitFor(`S.source.loaded && S.source.text.includes('from another tab') && !!S.source.draft && !!document.querySelector('[data-act="draft-use"]')`, 15000));
  await b.click('[data-act="draft-use"]');
  b.check('"Use it" puts my text back, unsaved', await b.waitFor(`editor.getValue().includes('% mine') && S.source.dirty && !document.querySelector('[data-act="draft-use"]')`, 3000));
  b.check('Saving now works (based on their version)', (await saveNow()) === true && await loaded());
  h = await history(main);
  b.check('Their version is kept in History', h.versions.some((v) => v.what === 'Saved in the editor') && h.versions.length === 6, J(h.versions.length));
  // ...and "keep mine"
  b.check('Another tab saves again', await uploadSource(main, original + '\n% theirs 2\n'));
  await setText(original + '\n% mine 2\n');
  await b.waitFor('S.source.dirty', 3000);
  const saving2 = saveNow();
  await b.waitFor(`!!document.querySelector('.dialog [data-act="dialog-result"][data-v="mine"]')`, 5000);
  await b.click('.dialog [data-act="dialog-result"][data-v="mine"]');
  b.check('"Keep my version" saves over theirs', (await saving2) === true && await loaded() && (await editorText()).includes('% mine 2'));
  h = await history(main);
  b.check('...and theirs is in History', h.versions[0].what === 'Saved in the editor' && h.versions.length === 8 && h.current.what === 'Saved in the editor', J(h.versions.map((v) => v.what)));

  // ---- the draft survives a reload
  await setText(original + '\n% typed but not saved\n');
  await sleep(1200); // the draft is written 0.8 s after typing
  b.check('The draft is in the browser', await b.js(`!!store.get('draft:' + S.project + '/' + S.source.name, null)`));
  await b.js('S.source.dirty = false; true'); // leave without the "unsaved changes" prompt
  await b.goto(`/exam/${encodeURIComponent(EXAM)}/questions`);
  b.check('After a reload the unsaved text is offered', await b.waitFor(`S.source.loaded && !!S.source.draft && !!document.querySelector('[data-act="draft-discard"]')`, 15000));
  await b.shot('h4-draft');
  await b.click('[data-act="draft-discard"]');
  b.check('Discarding removes the offer and the draft', await b.waitFor(`!S.source.draft && !document.querySelector('[data-act="draft-use"]') && !store.get('draft:' + S.project + '/' + S.source.name, null)`, 3000));

  // ---- deleting a file keeps it; restoring brings it back
  b.check('An extra file is added', await uploadSource('extra.tex', '% extra file\n'));
  await b.js('loadFiles(); true');
  b.check('It appears in the file list', await b.waitFor(`S.files && S.files.files.some(f => f.name === 'extra.tex')`, 10000));
  await b.setValue('#file-select', 'extra.tex');
  b.check('It opens in the editor, with Delete offered', await b.waitFor(`S.source.name === 'extra.tex' && S.source.loaded && !!document.querySelector('[data-act="delete-file"]')`, 10000));
  await b.click('[data-act="delete-file"]');
  await b.waitFor(`!!document.querySelector('.dialog [data-act="dialog-ok"]')`, 3000);
  await b.click('.dialog [data-act="dialog-ok"]');
  b.check('The editor goes back to the main source and the file is gone', await b.waitFor(`S.source.name === ${J(main)} && S.source.loaded && S.files && !S.files.files.some(f => f.name === 'extra.tex')`, 15000));
  h = await history(main);
  const extra = h.files.find((f) => f.file === 'extra.tex');
  b.check('The deleted file is listed in History as deleted', !!extra && extra.exists === false && extra.deleted_at > 0, J(h.files));
  await b.click('[data-act="history"]');
  await b.waitFor(`S.previewMode === 'history' && S.history && S.history.versions`, 10000);
  await b.setValue('#hist-file', 'extra.tex');
  b.check('The deleted file\'s history can be opened', await b.waitFor(`S.history && S.history.file === 'extra.tex' && S.history.versions && S.history.versions.length === 1 && !S.history.current`, 10000));
  await b.click('[data-act="hist-pick"]');
  await b.waitFor('S.history.text !== null', 10000);
  await b.click('[data-act="hist-restore"]');
  await b.waitFor(`!!document.querySelector('.dialog [data-act="dialog-ok"]')`, 3000);
  await b.click('.dialog [data-act="dialog-ok"]');
  b.check('Restoring brings the file back', await b.waitFor(`S.files && S.files.files.some(f => f.name === 'extra.tex') && S.history.current`, 15000));
  b.check('...with its text', (await b.js(`getJSON('/ui/api/source?file=extra.tex').then(r => r.text)`)) === '% extra file\n');

  // ---- the main source can't be deleted; the zip leaves the history out
  await b.js(`socket_emit('project-delete-file', [${J(main)}, false]); true`);
  b.check('Deleting the main source is refused', await b.waitFor(`!!document.querySelector('.server-dialog') && document.querySelector('.server-dialog').textContent.includes("main source")`, 5000));
  await b.js('warn_ok(); true');
  b.check('The main source is still there', (await b.js(`getJSON('/ui/api/files').then(r => r.files.some(f => f.name === ${J(main)}))`)) === true);
  const zip = await b.js(`fetch('/fs/' + encodeURIComponent(S.project)).then(r => r.arrayBuffer()).then(buf => { const s = new TextDecoder('latin1').decode(new Uint8Array(buf)); return {options: s.includes('options.xml'), history: s.includes('.history/')}; })`);
  b.check('The exam zip holds the exam but not the history folder', zip.options && !zip.history, J(zip));

  await b.waitFor(`!S.scaleUpdating`, 60000);
  b.check('The exam is deleted', await b.deleteExam(EXAM));
}

main().then(() => b.finish(), (e) => b.finish(e));
