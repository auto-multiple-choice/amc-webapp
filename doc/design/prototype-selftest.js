/*
 * Self-test for the prototype: open prototype.html?selftest=1.
 * Clicks the real buttons and presses keys through a whole exam, then
 * writes PASS/FAIL lines into <pre id="selftest"> and the page title.
 * Headless: chrome --headless=new --virtual-time-budget=20000 --dump-dom "file://…/prototype.html?selftest=1"
 */
/* global S, resetExam, renderAll, boxesLeft, issuesLeft */
'use strict';

(async () => {
  const log = [];
  let fails = 0;
  window.addEventListener('error', (e) => { fails += 1; log.push('ERROR ' + e.message); });
  const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });
  const q = (sel) => document.querySelector(sel);
  const click = (sel) => { const el = q(sel); if (!el) throw new Error('not found: ' + sel); el.click(); };
  const check = (name, ok) => { log.push((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) fails += 1; };
  const go = async (hash) => { location.hash = hash; await wait(60); };
  const text = (sel) => (q(sel) ? q(sel).textContent : '');

  try {
    resetExam('draft');
    renderAll();

    await go('#/exam/print');
    check('Print is closed before the layout check', /Check the layout first/.test(text('#main')));

    await go('#/exam/papers');
    click('[data-act="build"]');
    await wait(1100);
    check('Build papers leads to "Layout to check"', S.state === 'tocheck' && !!q('[data-act="layout-ok"]'));
    check('Layout preview opens automatically', /Layout check/.test(text('#preview')));
    click('[data-act="layout-ok"]');
    await wait(30);
    check('"Looks correct" makes it ready to print', S.state === 'ready');

    await go('#/exam/print');
    click('[data-act="lock-print"]');
    await wait(30);
    check('Saving for printing asks first', !!q('.dialog'));
    click('[data-act="do-lock"]');
    await wait(30);
    check('Exam is locked after printing', S.state === 'printed' && /locked/.test(text('#topbar')));

    await go('#/exam/questions');
    check('Questions are read-only once locked', !!q('.editor.readonly'));
    await go('#/exam/papers');
    check('Papers have no rebuild button once locked', !q('[data-act="build"]'));

    await go('#/exam/upload-scans');
    click('[data-act="upload"]');
    await wait(1200);
    check('Uploading scans moves on to checking', S.state === 'scanned');

    await go('#/exam/mark');
    check('Mark is disabled while scan problems remain', q('[data-act="compute"]').disabled);

    await go('#/exam/check-scans');
    click('[data-act="unread"]');
    await wait(30);
    click('[data-act="unread"]');
    await wait(30);
    check('Unreadable pages can be settled', S.unreadable.every((u) => u.resolved));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true }));
    await wait(30);
    check('Key T settles a box and moves on', boxesLeft() === 11 && S.reviewAt === 1);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));
    await wait(30);
    check('Key N settles a box', boxesLeft() === 10);
    click('[data-act="accept-rest"]');
    await wait(30);
    check('"Accept the rest" clears the list', issuesLeft() === 0 && /All clear/.test(text('#main')));

    await go('#/exam/mark');
    check('Mark is enabled once scans are clear', !q('[data-act="compute"]').disabled);
    click('[data-act="compute"]');
    await wait(900);
    check('Marks are computed', S.marked && /Last marking/.test(text('#main')));

    await go('#/exam/marking-scheme');
    click('[data-act="ans"][data-q="0"][data-a="2"]');
    await wait(30);
    check('Clicking an answer corrects the key (single answer stays single)', S.schemeDirty && S.questions[0].correct.join() === '2');
    click('[data-act="save-scheme"]');
    await wait(30);
    check('Saving after marking makes marks out of date', S.outOfDate && /!/.test(text('#sidebar')));

    await go('#/exam/mark');
    click('[data-act="compute"]');
    await wait(900);
    check('Recomputing clears "out of date"', !S.outOfDate);

    await go('#/exam/match-students');
    click('[data-act="match"]');
    await wait(30);
    check('Matching by hand takes one sheet off the queue', S.unmatched.length === 3);

    await go('#/exam/export-marks');
    click('[data-act="export"]');
    await wait(30);
    check('Export shows the CSV in the preview panel', S.exported && /marks-10B/.test(text('#preview')));

    await go('#/exam/annotate');
    click('[data-act="annotate"]');
    await wait(1100);
    check('Annotating produces the sheets list', S.annotated && /Annotated sheets/.test(text('#main')));

    await go('#/exam/questions');
    click('[data-act="unlock"]');
    await wait(30);
    check('Unlock button starts disabled', q('#unlock-go').disabled);
    const name = q('#unlock-name');
    name.value = 'Physics mid-term';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    check('Typing the exam name enables unlock', !q('#unlock-go').disabled);
    click('#unlock-go');
    await wait(30);
    check('Unlocking returns to draft and removes marks', S.state === 'draft' && !S.marked && !q('.dialog'));

    await go('#/new');
    click('[data-act="tpl"][data-k="nominative"]');
    await wait(30);
    check('Choosing a template shows it in the preview', /Nominative sheets/.test(text('#preview')));
    click('[data-act="wiz-next"]');
    await wait(30);
    click('[data-act="wiz-create"]');
    await wait(80);
    check('The wizard creates the exam and opens Questions', location.hash === '#/exam/questions');

    await go('#/admin/appearance');
    click('[data-act="sample-logo"]');
    await wait(400);
    const brand = getComputedStyle(document.documentElement).getPropertyValue('--brand').trim();
    check('A logo suggests its colours and applies the first', S.logoColors.length > 0 && brand === S.logoColors[0]);
    check('Contrast is computed for the brand colour', S.brandContrast >= 1);
    click('[data-act="brand-reset"]');
    await wait(30);
    check('Reset returns to the neutral colour', S.brand === '#3b5bdb' && !S.logo);

    const next = { auto: 'light', light: 'dark', dark: 'auto' }[S.theme];
    click('[data-act="theme"]');
    check('Theme button cycles the theme', S.theme === next);
    click('[data-act="theme"]');
    click('[data-act="theme"]');
  } catch (e) {
    fails += 1;
    log.push('EXCEPTION ' + e.message);
  }
  const passed = log.filter((l) => l.startsWith('PASS')).length;
  const out = document.createElement('pre');
  out.id = 'selftest';
  out.textContent = `${log.join('\n')}\n${fails ? 'FAILED' : 'ALL PASSED'}: ${passed} passed, ${fails} failed`;
  document.body.appendChild(out);
  document.title = fails ? 'SELFTEST FAILED' : 'SELFTEST PASSED';
})();
