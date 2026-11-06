#!/usr/bin/env node
/*
 * End-to-end test of the exams dashboard and the new-exam wizard with its
 * template gallery.
 *
 *   node tests-ui/e2e-dashboard.mjs http://127.0.0.1:8095 [screenshots-dir]
 *
 * AMC_E2E_USER / AMC_E2E_PASS: sign in first (shared-machine mode).
 * Use a test copy of the app with no exams: the test checks the empty
 * dashboard and deletes what it creates.
 */
import { startBrowser, sleep } from './cdp.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:8095';
const USER = process.env.AMC_E2E_USER || '';
const A = 'Dashboard test A';
const B = 'Dashboard test B';
const b = await startBrowser({ base: BASE, user: USER, pass: process.env.AMC_E2E_PASS || '', shots: process.argv[3] || null });
const J = JSON.stringify;
const api = (path) => b.js(`fetch(${J(path)}, {headers: {'AMC-project': S.project || ''}, cache: 'no-store'}).then(r => r.json())`);
const card = (name) => `[...document.querySelectorAll('.exam-card')].find(c => c.querySelector('h3').textContent.trim() === ${J(name)})`;
const fill = (sel, v) => b.js(`(() => { const e = document.querySelector(${J(sel)}); e.value = ${J(v)}; e.dispatchEvent(new Event('input', {bubbles: true})); e.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);
async function wizard({ name, klass, subject, date, group, template, style, code, copies }) {
  await b.goto('/new');
  await b.waitFor(`S.route.kind === 'new' && !!document.querySelector('#wiz-name')`);
  await fill('#wiz-name', name);
  await fill('[data-wiz="class"]', klass);
  await fill('[data-wiz="subject"]', subject);
  await fill('[data-wiz="date"]', date);
  await b.click('[data-act="wiz-next"]');
  await b.waitFor(`S.wizard.step === 2 && !!S.gallery && !!document.querySelector('.tpl-card')`, 10000);
  await b.click(`[data-act="wiz-group"][data-v="${group}"]`);
  await b.click(`[data-act="wiz-pick"][data-gid="${group}"][data-id="${template}"]`);
  await b.click('[data-act="wiz-next"]');
  await b.waitFor(`S.wizard.step === 3`);
  if (style) await b.click(`[data-act="wiz-style"][data-v="${style}"]`);
  if (code) {
    await b.js(`(() => { const c = document.querySelector('#wiz-code'); c.checked = true; c.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);
    await b.waitFor(`!!document.querySelector('[data-wiz="digits"]')`);
    await fill('[data-wiz="digits"]', String(code));
  }
  if (copies) await fill('[data-wiz="copies"]', String(copies));
  await b.click('[data-act="wiz-create"]');
  return b.waitFor(`S.project === ${J(name)} && S.route.step === 'questions' && !!S.status`, 30000);
}
const deleteExam = (name) => b.deleteExam(name);

async function main() {
  await b.signIn();
  await b.goto('/');
  b.check('The app opens', await b.waitFor('S.online === true && S.projects !== null'));
  await b.preflight({ exams: [A, B], emptyOnly: true });
  b.created.add(A); b.created.add(B);
  b.check('An empty dashboard offers a new exam', await b.waitFor(`document.querySelector('#main').textContent.includes('No exams yet') && !!document.querySelector('#main a[href="/new"]')`));

  // ---- The wizard, step by step
  await b.click('#main a[href="/new"]');
  b.check('"New exam" opens the wizard at its own address', await b.waitFor(`location.pathname === '/new' && !!document.querySelector('#wiz-name')`));
  await b.click('[data-act="wiz-next"]');
  b.check('A name is needed', (await b.text('#wiz-error')).includes('name'));
  await fill('#wiz-name', A);
  await fill('[data-wiz="class"]', '10B');
  await fill('[data-wiz="subject"]', 'Physics');
  await fill('[data-wiz="date"]', '2026-12-01');
  await b.js(`document.querySelector('[data-wiz="date"]').dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true})); true`);
  b.check('Enter goes to the template gallery', await b.waitFor(`S.wizard.step === 2 && !!S.gallery`, 10000));
  b.check('Starters come first, with thumbnails', await b.waitFor(`(() => { const c = [...document.querySelectorAll('.tpl-card')]; const i = c[0] && c[0].querySelector('img'); return c.length === 3 && c[0].textContent.includes('Blank exam') && c.some(x => x.textContent.includes('Olympiad paper')) && !!i && i.complete && i.naturalWidth > 0; })()`, 10000));
  b.check('The chosen template\'s question paper is shown', await b.js(`!!document.querySelector('.tpl-preview iframe.tpl-pdf') && document.querySelector('.tpl-card.is-selected').textContent.includes('Blank exam')`));
  await b.shot('d1-gallery');
  await b.click('[data-act="wiz-group"][data-v="en"]');
  b.check('AMC\'s English templates are listed', await b.waitFor(`[...document.querySelectorAll('.tpl-card')].some(c => c.dataset.id === 'simple') && [...document.querySelectorAll('.tpl-card')].length >= 8`));
  await fill('#wiz-search', 'separate');
  b.check('Search finds templates in every group', await b.waitFor(`[...document.querySelectorAll('.tpl-card')].length >= 2 && [...document.querySelectorAll('.tpl-card')].every(c => /separate|séparée|feuille/i.test(c.textContent) || S.gallery.templates.find(t => t.id === c.dataset.id && /separate|sépar/i.test(t.text)))`), J(await b.js(`[...document.querySelectorAll('.tpl-card')].map(c => c.dataset.id)`)));
  await fill('#wiz-search', '');
  await b.click('[data-act="wiz-group"][data-v="school"]');
  await b.click('[data-act="wiz-pick"][data-gid="school"][data-id="blank"]');
  await b.click('[data-act="wiz-next"]');
  b.check('Options show both answer sheet styles', await b.waitFor(`S.wizard.step === 3 && document.querySelectorAll('.style-choice img.style-thumb').length === 2`, 5000));
  await b.click('[data-act="wiz-style"][data-v="separate"]');
  await b.js(`(() => { const c = document.querySelector('#wiz-code'); c.checked = true; c.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);
  await b.waitFor(`!!document.querySelector('[data-wiz="digits"]')`);
  await fill('[data-wiz="digits"]', '6');
  await fill('[data-wiz="copies"]', '12');
  await b.shot('d2-options');
  await b.click('[data-act="wiz-create"]');
  b.check('Creating opens the new exam at Questions', await b.waitFor(`S.project === ${J(A)} && S.route.step === 'questions' && !!S.status`, 30000));
  const src = await b.js(`fetch('/fs/' + encodeURIComponent(S.project) + '/' + encodeURIComponent(S.status.source) + '?attach=0', {cache: 'no-store'}).then(r => r.text())`);
  b.check('The exam has a separate answer sheet', src.includes('separateanswersheet') && src.includes('\\AMCformBegin'));
  b.check('...and 6-digit student code boxes', src.includes('\\AMCcodeGridInt{student}{6}'));
  b.check('...and no leftover markers', !src.includes('%%AMCUI'));
  const cfg = await api('/ui/api/config');
  b.check('The number of copies is set', cfg.options.nombre_copies === '12', cfg.options.nombre_copies);
  b.check('Class, subject and date are kept', await b.waitFor(`S.status.meta && S.status.meta.class === '10B' && S.status.meta.subject === 'Physics' && S.status.meta.date === '2026-12-01'`, 5000));
  b.check('The history says where it came from', (await b.js('S.status.activity.map(a => a.what).join(" | ")')).includes('Exam created from the template "Blank exam"'));
  await b.js(`socket_emit('doc-update', 'sujet'); true`);
  await b.waitFor(`!!document.querySelector('#work')`, 10000);
  b.check('The starter builds, code boxes and all', await b.waitFor(`!document.querySelector('#work') && S.status && S.status.layout_pages > 0`, 180000));
  if (await b.js(`!!document.querySelector('.server-dialog')`)) await b.js('warn_ok(); true');

  // ---- A second exam from one of AMC's templates
  b.check('A second exam from AMC\'s AMC-TXT template', await wizard({ name: B, klass: '11A', subject: 'Chemistry', date: '2026-11-20', group: 'en', template: 'simple-txt' }));
  b.check('...has its plain-text source', (await b.js('S.status.source')).endsWith('.txt') && (await b.js('S.status.format')) === 'plain');

  // ---- The dashboard
  await b.goto('/exams');
  b.check('Both exams are on the dashboard', await b.waitFor(`document.querySelectorAll('.exam-card').length === 2`, 10000));
  b.check('A card shows class, subject and date', await b.js(`${card(A)}.querySelector('.exam-meta').textContent.includes('10B') && ${card(A)}.querySelector('.exam-meta').textContent.includes('Physics')`));
  b.check('...the state and the next step', await b.js(`${card(A)}.textContent.includes('Layout to check') && ${card(A)}.textContent.includes('Check the layout')`));
  b.check('...and progress through the steps', await b.js(`${card(A)}.querySelectorAll('.steps-bar span.on').length === 2 && ${card(B)}.querySelectorAll('.steps-bar span.on').length === 0`));
  b.check('"Continue" leads to the next step', await b.js(`${card(A)}.querySelector('a.btn[href$="/papers"]') !== null`));
  await b.shot('d3-dashboard');
  await b.js(`document.querySelector('#dash-search').focus(); true`);
  await fill('#dash-search', 'chem');
  b.check('Search filters by subject', await b.waitFor(`document.querySelectorAll('.exam-card').length === 1 && !!${card(B)}`, 3000));
  b.check('...and the search box keeps focus while typing', await b.js(`document.activeElement && document.activeElement.id === 'dash-search'`));
  await fill('#dash-search', '');
  await fill('#dash-class', '10B');
  b.check('Filter by class', await b.waitFor(`document.querySelectorAll('.exam-card').length === 1 && !!${card(A)}`, 3000));
  await fill('#dash-class', '');
  await fill('#dash-state', 'draft');
  b.check('Filter by state', await b.waitFor(`document.querySelectorAll('.exam-card').length === 1 && !!${card(B)}`, 3000));
  await fill('#dash-state', '');
  await fill('#dash-sort', 'date');
  b.check('Sort by exam date', await b.waitFor(`document.querySelector('.exam-card h3').textContent.trim() === ${J(A)}`, 3000));
  await fill('#dash-sort', 'recent');

  await b.click(`[data-act="menu"][data-menu="${B}"]`);
  await b.click(`[data-act="archive-exam"][data-name="${B}"]`);
  b.check('Archiving hides the exam', await b.waitFor(`document.querySelectorAll('.exam-card').length === 1 && !${card(B)}`, 10000));
  await b.waitFor(`!!document.querySelector('#dash-archived')`, 5000);
  await b.js(`(() => { const c = document.querySelector('#dash-archived'); c.checked = true; c.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);
  b.check('"Archived" shows it', await b.waitFor(`document.querySelectorAll('.exam-card').length === 1 && !!${card(B)}`, 5000));
  await b.click(`[data-act="menu"][data-menu="${B}"]`);
  await b.click(`[data-act="archive-exam"][data-name="${B}"]`);
  await b.js(`(() => { const c = document.querySelector('#dash-archived'); if (c) { c.checked = false; c.dispatchEvent(new Event('change', {bubbles: true})); } return true; })()`);
  b.check('Taking it out of the archive brings it back', await b.waitFor(`document.querySelectorAll('.exam-card').length === 2`, 10000));

  await b.click(`[data-act="menu"][data-menu="${A}"]`);
  await b.click(`[data-act="exam-details"][data-name="${A}"]`);
  await b.waitFor(`!!document.querySelector('#dlg-form [name="class"]')`);
  await fill('#dlg-form [name="class"]', '10C');
  await b.click('#dlg-form button[type="submit"]');
  b.check('Editing the details updates the card', await b.waitFor(`${card(A)} && ${card(A)}.querySelector('.exam-meta').textContent.includes('10C')`, 10000));

  // Exam settings
  await b.goto(`/exam/${encodeURIComponent(A)}/settings`);
  b.check('Exam settings show the details', await b.waitFor(`document.querySelector('#meta-class') && document.querySelector('#meta-class').value === '10C'`, 10000));
  await fill('#meta-subject', 'Physics and maths');
  await b.click('[data-act="save-meta"]');
  b.check('...and save them', await b.waitFor(`S.status.meta.subject === 'Physics and maths'`, 10000));

  b.check('Both test exams are deleted', (await deleteExam(A)) && (await deleteExam(B)));
  await sleep(200);
}

main().then(() => b.finish(), (e) => b.finish(e));
