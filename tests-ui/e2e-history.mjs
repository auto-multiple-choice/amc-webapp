#!/usr/bin/env node
/*
 * End-to-end test of the version history (server/ui_vcs.py): versions kept
 * on save, editing sessions, what a version changed and what changed
 * since, restoring one file and the whole exam, undoing a restore, "built
 * OK", named versions, a save that conflicts with another tab, drafts kept
 * in the browser, a deleted file brought back, the exam zip without the
 * history, the trash; and issue #15: restoring a Paper builder design
 * brings its layout back, and the restore can be undone.
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
const BEXAM = 'History builder test';
const b = await startBrowser({ base: BASE, user: USER, pass: process.env.AMC_E2E_PASS || '', shots: process.argv[3] || null });
const J = JSON.stringify;

const history = (file = null) => b.js(`getJSON('/ui/api/history' + (${J(file)} ? '?file=' + encodeURIComponent(${J(file)}) : ''))`);
const editorText = () => b.js('editor.getValue()');
const setText = (text) => b.js(`editor.setValue(${J(text)}, -1); true`);
const saveNow = () => b.js('saveSource()');
const uploadSource = (name, text) => b.js(`(async () => { const f = new FormData(); f.append('file', new Blob([${J(text)}], {type: 'text/plain'}), ${J(name)});
  const r = await fetch(${J(name)} === S.status.source ? '/upload/source' : '/upload/project', {method: 'POST', headers: {'AMC-project': S.project, 'AMC-sid': socket.id}, body: f}); return (await r.json()).ok === true; })()`);
const loaded = () => b.waitFor('S.source.loaded && !!S.source.digest && !S.source.dirty', 15000);
const file = (name) => b.js(`getJSON('/ui/api/source?file=' + encodeURIComponent(${J(name)})).then(r => r.text || null)`);
const dialogOk = async (title) => {
  const shown = await b.waitFor(`!!document.querySelector('.dialog [data-act="dialog-ok"]')${title ? ` && document.querySelector('#dlg-title').textContent.startsWith(${J(title)})` : ''}`, 10000);
  await b.click('.dialog [data-act="dialog-ok"]');
  return shown;
};
/* Clicks a version in the History list, opening its editing session first if it is folded. */
const pick = async (id) => {
  const sel = `[data-act="hist-pick"][data-id="${id}"]`;
  if (!(await b.js(`!!document.querySelector(${J(sel)})`))) {
    const key = await b.js(`(historySessions(S.history.versions).find((x) => x.items.some((v) => v.id === ${J(id)})) || {}).key || null`);
    if (key) await b.click(`[data-act="hist-session"][data-key="${key}"]`);
    await b.waitFor(`!!document.querySelector(${J(sel)})`, 5000);
  }
  await b.click(sel);
};
const detailLoaded = () => b.waitFor(`S.history && S.history.detail && !S.history.detail.error && !!document.querySelector('#preview .hist-detail-head')`, 15000);

async function main() {
  await b.signIn();
  await b.goto('/');
  b.check('The app opens', await b.waitFor('S.online === true'));
  await b.preflight({ exams: [EXAM, BEXAM, `${EXAM} (restored)`] });
  b.check('The exam is created', await b.createFromTemplate(EXAM));
  b.check('The editor loads the source with its digest', await loaded() && (await b.js('S.source.tracked')) === true);
  const main = await b.js('S.status.source');
  const original = await editorText();
  let h = await history();
  b.check('A new exam\'s history starts with its files', h.versions.length === 1 && h.versions[0].kind === 'start' && h.versions[0].files.some((f) => f.file === main), J(h.versions));
  b.check('History is offered in the editor bar; the main source has no Delete', await b.js(`!document.querySelector('[data-act="history"]').disabled && !document.querySelector('[data-act="delete-file"]')`));

  // ---- saving keeps versions
  await setText(original + '% first change\n'); // the template ends with a newline: one line added
  b.check('Typing marks the source as unsaved', await b.waitFor('S.source.dirty', 3000));
  const t0 = Date.now();
  b.check('Save works', (await saveNow()) === true && await loaded());
  const saveMs = Date.now() - t0;
  await setText(original + '% first change\n% second change\n');
  b.check('A second save keeps the second version', (await saveNow()) === true && await loaded() && (h = await history(main)).versions.length === 3);
  b.check('Versions are newest first and say how they were made', h.versions[0].what === 'Saved in the editor' && (USER ? h.versions[0].by === USER : true) && h.versions[2].kind === 'start', J(h.versions.map((v) => [v.what, v.by])));
  console.log(`     (a save from the editor took ${saveMs} ms, round trip)`);

  // ---- the History panel: sessions, what changed, compare
  await b.click('[data-act="history"]');
  b.check('The History panel opens on the file, with the two saves as one editing session', await b.waitFor(`S.previewMode === 'history' && S.history && S.history.file === ${J(main)} && S.history.versions && !!document.querySelector('#preview .hist-session') && document.querySelector('#preview .hist-session').textContent.includes('2 saves')`, 10000));
  await b.click('#preview .hist-session');
  b.check('A session opens to show its saves', await b.waitFor(`document.querySelectorAll('#preview .hist-row.nested').length === 2`, 3000));
  await b.shot('h1-panel');
  await pick(h.versions[0].id);
  b.check('A version shows what it changed, in words and line by line', await detailLoaded() && await b.js(`document.querySelectorAll('#preview .diff .add').length === 1 && document.querySelector('#preview .diff .add').textContent.includes('second change') && !document.querySelector('#preview .diff .del') && document.querySelector('#preview .hist-summary').textContent.includes('1 line added')`),
    await b.js(`(document.querySelector('#preview .hist-detail-body') || {}).textContent`));
  await b.shot('h2-diff');
  await pick(h.versions[2].id);
  await detailLoaded();
  await b.setValue('#hist-against', 'now');
  b.check('"What changed since" shows both saves', await b.waitFor(`S.history.against === 'now' && S.history.detail && document.querySelectorAll('#preview .diff .add').length === 2`, 10000));
  await b.setValue('#hist-against', h.versions[1].id);
  b.check('Any two versions can be compared', await b.waitFor(`S.history.detail && S.history.detail.base === ${J(h.versions[2].id)} && S.history.detail.target === ${J(h.versions[1].id)} && document.querySelectorAll('#preview .diff .add').length === 1`, 10000));

  // ---- restore one file, then undo the restore
  await b.click(`[data-act="hist-restore"][data-mode="file"]`);
  b.check('Restoring asks first and says what will change', await b.waitFor(`!!document.querySelector('.dialog') && document.querySelector('#dlg-title').textContent.startsWith('Restore ') && document.querySelector('.dialog .hist-plan').textContent.includes(${J(main)})`, 5000));
  await b.shot('h3-confirm');
  await b.click('.dialog [data-act="dialog-ok"]');
  b.check('The restored text is back in the editor', await b.waitFor(`S.source.loaded && !S.source.dirty && editor.getValue() === ${J(original)}`, 15000), J(await editorText()));
  h = await history(main);
  b.check('The restore is a new version, and the panel selects it', h.versions[0].kind === 'restore' && h.versions[0].restores === h.versions[3].id
    && await b.waitFor(`S.history.selected === ${J(h.versions[0].id)} && !!document.querySelector('[data-act="hist-restore"][data-mode="undo"]')`, 10000), J(h.versions.map((v) => v.kind)));
  await b.click('[data-act="hist-restore"][data-mode="undo"]');
  await dialogOk('Undo this change');
  b.check('Undoing the restore brings the saved text back', await b.waitFor(`S.source.loaded && !S.source.dirty && editor.getValue().includes('second change')`, 15000));
  h = await history(main);
  b.check('...as a version of its own', h.versions[0].kind === 'undo' && h.versions[0].undoes === h.versions[1].id, J(h.versions.slice(0, 2)));
  await b.waitFor(`S.status && S.status.activity.some(a => a.what.includes('restored'))`, 5000);
  b.check('The activity list records the restore', await b.js(`S.status.activity.some(a => a.what.includes('restored'))`));

  // ---- named versions
  await b.waitFor(`S.history && S.history.versions && S.history.selected === S.history.versions[0].id && S.history.detail && S.history.detail.entry && S.history.detail.entry.id === S.history.selected && !!document.querySelector('[data-act="hist-name"]')`, 10000);
  await b.click('[data-act="hist-name"]');
  await b.waitFor(`!!document.querySelector('#dlg-form input[name="name"]')`, 3000);
  await b.setValue('#dlg-form input[name="name"]', 'Checked by HoD');
  await b.click('#dlg-form [type="submit"]');
  b.check('A version can be named, and the name shows in the list', await b.waitFor(`S.history.versions && S.history.versions[0].names.some(n => n.name === 'Checked by HoD') && [...document.querySelectorAll('#preview .hist-list .chip')].some(c => c.textContent.includes('Checked by HoD'))`, 10000));

  // ---- built OK
  await b.js(`socket_emit('doc-update', 'sujet'); true`);
  await b.waitFor(`!!document.querySelector('#work')`, 10000);
  b.check('The question paper builds', await b.waitFor(`!document.querySelector('#work') && S.status && S.status.docs.sujet`, 180000));
  if (await b.js(`!!document.querySelector('.server-dialog')`)) await b.js('warn_ok(); true');
  h = await history();
  b.check('The version that built is marked', h.versions[0].built === true, J(h.versions[0]));
  await setText(original + '\n% third change\n');
  b.check('Saving after a build keeps the built version marked', (await saveNow()) === true && await loaded() && (h = await history()).versions[1].built === true && !h.versions[0].built, J(h.versions.map((v) => [v.what, v.built])));
  b.check('The panel shows "built OK"', await b.waitFor(`[...document.querySelectorAll('#preview .hist-row .chip')].some(c => c.textContent.includes('built OK'))`, 5000));

  // ---- a save that conflicts with another tab
  const before = (await history()).total;
  b.check('Another tab saves the file', await uploadSource(main, original + '\n% from another tab\n'));
  await setText(original + '\n% mine\n');
  await b.waitFor('S.source.dirty', 3000);
  const saving = saveNow();
  b.check('The conflict is explained', await b.waitFor(`!!document.querySelector('.dialog') && document.querySelector('#dlg-title').textContent === 'Changed elsewhere'`, 5000));
  await b.click('.dialog [data-act="dialog-result"][data-v="theirs"]');
  b.check('Loading theirs is refused as a save', (await saving) === false);
  b.check('Their version is loaded and my text offered as unsaved text', await b.waitFor(`S.source.loaded && S.source.text.includes('from another tab') && !!S.source.draft && !!document.querySelector('[data-act="draft-use"]')`, 15000));
  await b.click('[data-act="draft-use"]');
  b.check('"Use it" puts my text back, unsaved', await b.waitFor(`editor.getValue().includes('% mine') && S.source.dirty && !document.querySelector('[data-act="draft-use"]')`, 3000));
  b.check('Saving now works (based on their version)', (await saveNow()) === true && await loaded());
  h = await history();
  b.check('Their version is kept in History', h.total === before + 2 && h.versions[1].what.startsWith('Saved'), J(h.versions.slice(0, 3).map((v) => v.what)));

  // ---- the draft survives a reload
  await setText(original + '\n% typed but not saved\n');
  await sleep(1200); // the draft is written 0.8 s after typing
  b.check('The draft is in the browser', await b.js(`!!store.get('draft:' + S.project + '/' + S.source.name, null)`));
  await b.js('S.source.dirty = false; true'); // leave without the "unsaved changes" prompt
  await b.goto(`/exam/${encodeURIComponent(EXAM)}/questions`);
  b.check('After a reload the unsaved text is offered', await b.waitFor(`S.source.loaded && !!S.source.draft && !!document.querySelector('[data-act="draft-discard"]')`, 15000));
  await b.click('[data-act="draft-discard"]');
  b.check('Discarding removes the offer and the draft', await b.waitFor(`!S.source.draft && !document.querySelector('[data-act="draft-use"]') && !store.get('draft:' + S.project + '/' + S.source.name, null)`, 3000));

  // ---- deleting a file keeps it; restoring brings it back
  b.check('An extra file is added', await uploadSource('extra.tex', '% extra file\n'));
  await b.js('loadFiles(); true');
  b.check('It appears in the file list', await b.waitFor(`S.files && S.files.files.some(f => f.name === 'extra.tex')`, 10000));
  await b.setValue('#file-select', 'extra.tex');
  b.check('It opens in the editor, with Delete offered', await b.waitFor(`S.source.name === 'extra.tex' && S.source.loaded && !!document.querySelector('[data-act="delete-file"]')`, 10000));
  await b.click('[data-act="delete-file"]');
  await dialogOk();
  b.check('The editor goes back to the main source and the file is gone', await b.waitFor(`S.source.name === ${J(main)} && S.source.loaded && S.files && !S.files.files.some(f => f.name === 'extra.tex')`, 15000));
  h = await history();
  const extra = h.files.find((f) => f.file === 'extra.tex');
  b.check('The deleted file is listed in History as deleted', !!extra && extra.exists === false && extra.deleted_at > 0 && h.versions[0].kind === 'delete', J(h.files));
  await b.click('[data-act="history"]');
  await b.waitFor(`S.previewMode === 'history' && S.history && S.history.versions`, 10000);
  await b.setValue('#hist-file', 'extra.tex');
  b.check('The deleted file\'s history can be opened', await b.waitFor(`S.history && S.history.file === 'extra.tex' && S.history.versions && S.history.versions.length === 2`, 10000));
  const ev = (await history('extra.tex')).versions;
  await pick(ev[1].id);
  await detailLoaded();
  await b.click('[data-act="hist-restore"][data-mode="file"]');
  await dialogOk('Restore extra.tex');
  b.check('Restoring brings the file back, with its text', await b.waitFor(`S.files && S.files.files.some(f => f.name === 'extra.tex')`, 15000) && (await file('extra.tex')) === '% extra file\n');

  // ---- the whole exam back to its first version
  await b.setValue('#hist-file', '');
  await b.waitFor(`S.history && S.history.file === null && S.history.versions && S.history.versions.length > 5`, 10000);
  h = await history();
  const first = h.versions[h.versions.length - 1];
  await pick(first.id);
  await detailLoaded();
  await b.click('[data-act="hist-restore"][data-mode="exam"]');
  b.check('Restoring the whole exam lists every file it changes', await b.waitFor(`!!document.querySelector('.dialog .hist-plan') && document.querySelector('.dialog .hist-plan').textContent.includes('extra.tex') && document.querySelector('.dialog .hist-plan').textContent.includes(${J(main)})`, 10000));
  await b.shot('h4-restore-exam');
  await b.click('.dialog [data-act="dialog-ok"]');
  b.check('Every file is back as it was: the source restored, the later file removed', await b.waitFor(`S.files && !S.files.files.some(f => f.name === 'extra.tex')`, 15000) && (await file(main)) === original);

  // ---- the main source can't be deleted; the zip leaves the history out
  await b.js(`socket_emit('project-delete-file', [${J(main)}, false]); true`);
  b.check('Deleting the main source is refused', await b.waitFor(`!!document.querySelector('.server-dialog') && document.querySelector('.server-dialog').textContent.includes("main source")`, 5000));
  await b.js('warn_ok(); true');
  const zip = await b.js(`fetch('/fs/' + encodeURIComponent(S.project)).then(r => r.arrayBuffer()).then(buf => { const s = new TextDecoder('latin1').decode(new Uint8Array(buf)); return {options: s.includes('options.xml'), history: s.includes('.history/') || s.includes('.git/') || s.includes('_amcweb')}; })`);
  b.check('The exam zip holds the exam but no history', zip.options && !zip.history, J(zip));
  const fsRefused = await b.js(`fetch('/fs/_amcweb/', {cache: 'no-store'}).then(r => r.json()).catch(() => ({}))`);
  b.check('/fs can\'t reach the server\'s own folder', !!fsRefused.error, J(fsRefused));

  // ---- the trash
  const versions = (await history()).total;
  await b.waitFor(`!S.scaleUpdating`, 60000);
  await b.js(`socket_emit('project-delete', ${J(EXAM)}); true`);
  await b.goto('/exams');
  b.check('A deleted exam leaves the list', await b.waitFor(`S.projects && !S.projects.some(p => p.name === ${J(EXAM)})`, 20000));
  await b.click('[data-act="trash-open"]');
  b.check('...and is in the Trash, with the days it has left', await b.waitFor(`!!document.querySelector('.trash-list') && document.querySelector('.trash-list').textContent.includes(${J(EXAM)}) && document.querySelector('.trash-list').textContent.includes('30 days left')`, 10000));
  await b.shot('h5-trash');
  await b.click('.trash-list [data-act="trash-restore"]');
  b.check('Restoring puts it back on the list', await b.waitFor(`S.projects && S.projects.some(p => p.name === ${J(EXAM)})`, 20000));
  await b.js('closeDialog(); true');
  await b.goto(`/exam/${encodeURIComponent(EXAM)}/questions`);
  await b.waitFor(`S.project === ${J(EXAM)} && !!S.status`, 15000);
  h = await history();
  b.check('...with its whole history', h.total === versions && h.versions.some((v) => v.names.some((n) => n.name === 'Checked by HoD')), J([h.total, versions]));
  await b.waitFor(`!S.scaleUpdating`, 60000);
  b.check('The exam is deleted (and removed from the trash)', await b.deleteExam(EXAM));
  const trash = await b.js(`getJSON('/ui/api/trash')`);
  b.check('...for good', !trash.items.some((x) => x.name === EXAM), J(trash.items));

  // ---- issue #15: a Paper builder design restored, its layout with it, and the restore undone
  await b.goto('/exams');
  await b.waitFor(`typeof S !== 'undefined' && S.online === true && Array.isArray(S.projects)`, 15000);
  b.created.add(BEXAM);
  await b.js(`S.qtab = 'design'; store.set('qtab', 'design'); S.creating = ${J(BEXAM)}; socket_emit('ui-create-exam', {name: ${J(BEXAM)}, gid: 'school', id: 'builder', style: 'separate'}); true`);
  b.check('A Paper builder exam is created', await b.waitFor(`S.project === ${J(BEXAM)} && S.builder && S.builder.builder && S.builder.design`, 60000));
  const design = await b.js('S.builder.design');
  const rows0 = design.paper.length;
  const layout0 = await file('paper-layout.tex');
  h = await history();
  b.check('Its history starts with the template it was made from', h.versions.length === 1 && h.versions[0].kind === 'create' && h.versions[0].what.includes('Created from the template'), J(h.versions));
  const save = (d, what) => b.js(`fetch('/ui/api/builder', {method: 'POST', headers: {...headers(), 'Content-Type': 'application/json'}, body: JSON.stringify({based_on: S.builder.digest, design: ${J(d)}, what: ${J(what)}})}).then(r => r.json()).then(r => { if (r.ok) S.builder = r; return r; })`);
  let r = await save({ ...design, fields: { ...design.fields, organiser: 'Club of Testing' } }, 'organiser changed');
  b.check('A design change is saved', r.ok === true, J(r));
  h = await history();
  b.check('A builder save is one version holding the design and its layout', h.versions[0].what === 'Paper builder: organiser changed' && h.versions[0].files.map((f) => f.file).sort().join(',') === 'paper-layout.tex,paper.json', J(h.versions[0]));
  const cur = await b.js('S.builder.design');
  r = await save({ ...cur, paper: [] }, 'everything removed');
  b.check('The design is emptied (what happened in #15)', r.ok === true && (await b.js('S.builder.design.paper.length')) === 0);
  const layout2 = await file('paper-layout.tex');
  await b.click('[data-act="pb-history"]');
  b.check('History opens on paper.json from the builder', await b.waitFor(`S.history && S.history.file === 'paper.json' && S.history.versions && S.history.versions.length === 3`, 10000));
  h = await history('paper.json');
  await pick(h.versions[0].id);
  await detailLoaded();
  b.check('The emptying is described in words', await b.js(`document.querySelector('#preview .hist-summary').textContent.includes('row 1 removed')`), await b.js(`document.querySelector('#preview .hist-summary').textContent`));
  await pick(h.versions[1].id);
  await detailLoaded();
  await b.click('[data-act="hist-view"][data-v="picture"]');
  b.check('A version\'s design can be seen as a picture before restoring', await b.waitFor(`document.querySelectorAll('#preview .hist-picture')[0] && document.querySelectorAll('#preview .hist-picture')[0].querySelectorAll('.b-page[data-sheet="paper"] .b-row').length === ${rows0}`, 10000));
  await b.shot('h6-picture');
  await b.click('[data-act="hist-restore"][data-mode="file"]');
  await dialogOk('Restore paper.json');
  b.check('Restoring paper.json brings the design back', await b.waitFor(`S.builder && S.builder.design && S.builder.design.paper.length === ${rows0} && S.builder.design.fields.organiser === 'Club of Testing'`, 15000));
  const layout1 = await file('paper-layout.tex');
  b.check('...and its layout file follows', layout1.includes('Club of Testing') && layout1 !== layout0 && (await b.js('S.builder.layout.edited')) === false);
  h = await history();
  b.check('...in one version (design and layout together)', h.versions[0].kind === 'restore' && h.versions[0].files.map((f) => f.file).sort().join(',') === 'paper-layout.tex,paper.json', J(h.versions[0]));
  await b.waitFor(`S.history.selected === ${J(h.versions[0].id)} && !!document.querySelector('[data-act="hist-restore"][data-mode="undo"]')`, 10000);
  await b.click('[data-act="hist-restore"][data-mode="undo"]');
  await dialogOk('Undo this change');
  b.check('Undoing the restore empties the design again, layout included', await b.waitFor(`S.builder && S.builder.design && S.builder.design.paper.length === 0`, 15000) && (await file('paper-layout.tex')) === layout2);
  await b.waitFor('!S.scaleUpdating', 60000);
  b.check('The builder exam is deleted', await b.deleteExam(BEXAM));
}

main().then(() => b.finish(), (e) => b.finish(e));
