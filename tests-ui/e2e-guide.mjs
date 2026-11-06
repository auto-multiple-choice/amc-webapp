#!/usr/bin/env node
/*
 * End-to-end test of the guide (server/guide/en, shown in the preview
 * panel) and the first-run tour.
 *
 *   node tests-ui/e2e-guide.mjs http://127.0.0.1:8095 [screenshots-dir]
 *
 * AMC_E2E_USER / AMC_E2E_PASS: sign in first (shared-machine mode).
 * Use a test copy of the app, never your real exams.
 */
import { startBrowser, sleep } from './cdp.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:8095';
const USER = process.env.AMC_E2E_USER || '';
const EXAM = 'Guide test exam';
const b = await startBrowser({ base: BASE, user: USER, pass: process.env.AMC_E2E_PASS || '', shots: process.argv[3] || null, tour: true });
const J = JSON.stringify;

async function main() {
  await b.signIn();
  await b.goto('/');
  b.check('The app opens', await b.waitFor('S.online === true && S.projects !== null'));
  await b.preflight({ exams: [EXAM] });
  b.check('The guide is loaded', await b.waitFor('Array.isArray(S.guidePages) && S.guidePages.length === 11', 10000), J(await b.js('S.guidePages && S.guidePages.map(p => p.id)')));
  b.check('No tour on the dashboard by itself', await b.js('!document.querySelector("#tour")'));

  // ---- The guide, from the dashboard
  await b.click('#topbar [data-menu="guide"]');
  await b.click('#topbar [data-act="guide-open"][data-page="index"]');
  b.check('The full guide opens in the preview panel', await b.waitFor(`!document.querySelector('#app').classList.contains('preview-closed') && document.querySelector('#preview .guide-page h2') && document.querySelector('#preview .guide-page h2').textContent === 'Guide'`, 5000));
  b.check('...with its contents', await b.js(`document.querySelectorAll('#guide-select option').length === 11`));
  await b.click('#preview .guide-page [data-act="guide-open"][data-page="questions"]');
  b.check('A link opens another page', await b.waitFor(`document.querySelector('#preview .guide-page h2').textContent === 'Questions' && !!document.querySelector('#preview .guide-code')`, 3000));
  await b.click('#preview [data-act="guide-open"][data-page="marking-scheme"]');
  b.check('"Next" goes to the next page', await b.waitFor(`document.querySelector('#preview .guide-page h2').textContent === 'Marking scheme'`, 3000));
  await b.shot('g1-guide');
  await b.click('#preview [data-act="toggle-preview"]');
  b.check('Closing hides it', await b.waitFor(`document.querySelector('#app').classList.contains('preview-closed')`, 3000));
  b.check('Guide text is escaped, not run', await b.js(`md('<img src=x onerror="window.bad=1"> **bold** [a](javascript:alert(1))').includes('&lt;img') && !md('[a](javascript:alert(1))').includes('href="javascript')`));

  // ---- The first-run tour, on the first exam page
  b.check('An exam opens', (await b.createFromTemplate(EXAM)) && (await b.waitFor(`S.route.step === 'questions'`, 10000)));
  b.check('The tour starts by itself', await b.waitFor(`!!document.querySelector('#tour .tour-card') && document.querySelector('#tour-title').textContent === 'The ten steps'`, 8000));
  const n = await b.js(`tour.steps.length`);
  b.check('It points out the steps, the guide box, the preview panel and the guide', n === 4 && (await b.js(`tour.steps.map(s => s.title).join('|')`)) === 'The ten steps|What to do here|The preview panel|The guide', await b.js(`tour.steps.map(s => s.title).join('|')`));
  await b.shot('g2-tour');
  for (let i = 1; i < n; i += 1) await b.click('#tour [data-act="tour-step"][data-delta="1"]');
  b.check('"Next" walks through it', (await b.js('document.querySelector("#tour-title").textContent')) === 'The guide');
  await b.click('#tour [data-act="tour-end"]:not(.btn-ghost)');
  b.check('"Done" ends it and remembers', await b.waitFor(`!document.querySelector('#tour') && localStorage.getItem('amc-ui:tour-done') === 'true'`, 3000));
  await b.goto(`/exam/${encodeURIComponent(EXAM)}/questions`);
  await b.waitFor(`S.project === ${J(EXAM)} && S.route.step === 'questions'`, 15000);
  await sleep(1500);
  b.check('It doesn\'t come back by itself', await b.js('!document.querySelector("#tour")'));
  await b.click('#topbar [data-menu="guide"]');
  await b.click('#topbar [data-act="tour-start"]');
  b.check('"Take the tour" replays it', await b.waitFor(`!!document.querySelector('#tour .tour-card')`, 3000));
  await b.key('Escape');
  b.check('Escape ends it', await b.waitFor(`!document.querySelector('#tour')`, 3000));

  // ---- Step boxes and the guide inside an exam
  b.check('"What to do here" comes from the guide', await b.waitFor(`document.querySelector('#main .guide').textContent.includes('Write each question with its answers')`, 5000));
  // The same sentence is in the built-in fallback, so prove the box reads the guide: change the guide's text and redraw.
  b.check('...really from the guide, not the built-in fallback', await b.js(`(() => { const p = S.guidePages.find(x => x.id === 'questions'); p.markdown = p.markdown.replace('Write each question', 'Write each GUIDE-TEST question'); renderMain(); return document.querySelector('#main .guide').textContent.includes('GUIDE-TEST question'); })()`));
  await b.click('#main .guide [data-act="guide-open"][data-page="questions"]');
  b.check('"More in the guide" opens the step\'s page', await b.waitFor(`document.querySelector('#preview .guide-page h2') && document.querySelector('#preview .guide-page h2').textContent === 'Questions'`, 3000));
  await b.click('.step[href$="/marking-scheme"]');
  b.check('The guide stays open while changing step', await b.waitFor(`S.route.step === 'marking-scheme' && S.previewMode === 'guide' && !!document.querySelector('#preview .guide-page')`, 5000));
  b.check('...offering to go to the step it describes', await b.js(`!!document.querySelector('#preview .guide-page a[href$="/questions"]')`));
  await b.click('#topbar [data-menu="guide"]');
  await b.click('#topbar [data-act="guide-open"][data-page="marking-scheme"]');
  b.check('"About this step" opens the current step\'s page', await b.waitFor(`document.querySelector('#preview .guide-page h2').textContent === 'Marking scheme'`, 3000));
  await b.shot('g3-guide-in-exam');

  b.check('The test exam is deleted', await b.deleteExam(EXAM));
}

main().then(() => b.finish(), (e) => b.finish(e));
