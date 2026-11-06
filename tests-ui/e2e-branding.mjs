#!/usr/bin/env node
/*
 * End-to-end test of branding (Appearance): school name, logo and
 * colours in the app, on new exams, and on the sign-in page.
 *
 *   node tests-ui/e2e-branding.mjs http://127.0.0.1:8095 [screenshots-dir]
 *
 * Single-user mode: the local user may change the appearance.
 * Shared-machine mode (AMC_E2E_USER / AMC_E2E_PASS): with an admin
 * account the whole test runs, then the sign-in page is checked; with
 * AMC_E2E_NOT_ADMIN=1 it checks that the account is refused.
 * Use a test copy of the app: the test resets the appearance at the end.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { startBrowser, sleep } from './cdp.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:8095';
const USER = process.env.AMC_E2E_USER || '';
const NOT_ADMIN = process.env.AMC_E2E_NOT_ADMIN === '1';
const SCHOOL = 'Riverside High';
const EXAM = 'Branding test exam';
const b = await startBrowser({ base: BASE, user: USER, pass: process.env.AMC_E2E_PASS || '', shots: process.argv[3] || null });
const J = JSON.stringify;

/* A small PNG: a teal disc on a transparent background. */
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const x of buf) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
function discPng(size, [r, g, bl]) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = y * (size * 4 + 1) + 1 + x * 4;
      const inside = (x - size / 2) ** 2 + (y - size / 2) ** 2 < (size * 0.42) ** 2;
      raw.set(inside ? [r, g, bl, 255] : [0, 0, 0, 0], i);
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function openAppearance() {
  if (USER) {
    await b.click('#topbar [data-menu="account"]');
    if (!(await b.js(`!!document.querySelector('#topbar a[href="/appearance"]')`))) return false;
    await b.click('#topbar a[href="/appearance"]');
  } else await b.click('#main a[href="/appearance"]');
  return b.waitFor(`S.route.kind === 'appearance' && !!S.look`, 10000);
}
const post = (fields, withSid = true) => b.js(`(async (fields, withSid) => {
  const f = new FormData(); Object.entries(fields).forEach(([k, v]) => f.append(k, v));
  const r = await fetch('/ui/branding', {method: 'POST', headers: withSid ? headers() : {}, body: f});
  return r.status;
})(${J(fields)}, ${withSid})`);

async function main() {
  await b.signIn();
  await b.goto('/');
  b.check('The app opens', await b.waitFor('S.online === true && S.projects !== null'));

  if (NOT_ADMIN) {
    b.check('A teacher who isn\'t an admin isn\'t offered Appearance', !(await openAppearance()));
    await b.goto('/appearance');
    b.check('...and the page says why', await b.waitFor(`!!S.look && !S.look.canEdit && document.querySelector('#main').textContent.includes('Only administrators')`, 10000));
    b.check('...and the server refuses changes', (await post({ name: 'Hacked' })) === 403);
    return;
  }

  // ---- Appearance
  b.check('Appearance opens', await openAppearance());
  b.check('It starts neutral', await b.js(`S.look.name === '' && !S.look.logoUrl && !S.look.color`));
  await b.setValue('#look-name', SCHOOL);
  const dir = mkdtempSync(join(tmpdir(), 'amc-logo-'));
  const logo = join(dir, 'logo.png');
  writeFileSync(logo, discPng(120, [12, 133, 153]));
  await b.setFiles('#look-logo', [logo]);
  b.check('A logo shows at once', await b.waitFor(`!!document.querySelector('.look-logo img') && document.querySelectorAll('.look-sample .brandmark-logo img').length === 2`, 5000));
  b.check('Colours are suggested from the logo', await b.waitFor(`S.look.swatches.length >= 1`, 5000), J(await b.js('S.look.swatches')));
  const suggested = await b.js('S.look.swatches[0]');
  const [sr, sg, sb] = [1, 3, 5].map((i) => parseInt(suggested.slice(i, i + 2), 16));
  b.check('...and they are the logo\'s teal', sb > sr && sg > sr && Math.abs(sb - 153) < 30 && Math.abs(sg - 133) < 30, suggested);
  await b.click(`.swatch[data-color="${suggested}"]`);
  b.check('Choosing a colour updates the preview', await b.waitFor(`S.look.color === ${J(suggested)} && document.querySelector('.look-sample').style.getPropertyValue('--brand') === S.look.palette.light.brand`, 5000));
  await b.setValue('#look-hex', '#ffe066');
  b.check('A pale colour is darkened to stay readable', await b.waitFor(`S.look.palette.light.adjusted && document.querySelector('.look-sample').textContent.includes('adjusted')`, 5000), J(await b.js('S.look.palette')));
  await b.click('.swatch[data-color="#0b7285"]');
  await b.waitFor(`S.look.color === '#0b7285' && S.look.palette.light.brand === '#0b7285'`, 5000);
  await b.shot('b1-appearance');
  b.check('Changes need the page\'s own header (no cross-site posts)', (await post({ name: 'X' }, false)) === 403);
  await b.click('[data-act="look-save"]');
  b.check('Saving applies it: the top bar shows the logo and school name', await b.waitFor(`(() => { const m = document.querySelector('.brandmark'); return !!m && !!m.querySelector('img') && m.textContent.includes(${J(SCHOOL)}); })()`, 15000));
  b.check('...the browser tab has the school name', await b.waitFor(`document.title.includes(${J(SCHOOL)})`, 5000), await b.js('document.title'));
  b.check('...and buttons use the school colour', await b.js(`getComputedStyle(document.documentElement).getPropertyValue('--brand').trim() === '#0b7285'`), await b.js(`getComputedStyle(document.documentElement).getPropertyValue('--brand')`));
  const pub = await b.js(`fetch('/public/branding.json', {cache: 'no-store'}).then(r => r.json())`);
  b.check('The public branding has the name, logo and palette', pub.name === SCHOOL && !!pub.logo && pub.palette.light.brand === '#0b7285');
  const logoResp = await b.js(`fetch(${J(pub.logo)}).then(r => ({status: r.status, type: r.headers.get('content-type'), csp: r.headers.get('content-security-policy') || ''}))`);
  b.check('The logo is served, locked down', logoResp.status === 200 && logoResp.type === 'image/png' && logoResp.csp.includes("default-src 'none'"), J(logoResp));
  b.check('The sign-in pages\' script is served', (await b.js(`fetch('/public/branding.js').then(r => r.text())`)).includes('/public/branding.json'));

  // ---- New exams from the starters carry it
  await b.goto('/new');
  await b.waitFor(`!!document.querySelector('#wiz-name')`);
  await b.setValue('#wiz-name', EXAM);
  await b.click('[data-act="wiz-next"]');
  await b.waitFor(`S.wizard.step === 2 && !!S.gallery`, 10000);
  await b.click('[data-act="wiz-pick"][data-gid="school"][data-id="blank"]');
  await b.click('[data-act="wiz-next"]');
  await b.click('[data-act="wiz-create"]');
  b.check('An exam from the blank starter', await b.waitFor(`S.project === ${J(EXAM)} && !!S.status`, 30000));
  const src = await b.js(`fetch('/fs/' + encodeURIComponent(S.project) + '/' + encodeURIComponent(S.status.source) + '?attach=0', {cache: 'no-store'}).then(r => r.text())`);
  b.check('...has the school name and logo on its papers', src.includes(`{\\large\\bf ${SCHOOL}}`) && src.includes('\\includegraphics[height=12mm]{school-logo.png}'));
  b.check('...and the logo file', (await b.js(`fetch('/fs/' + encodeURIComponent(S.project) + '/school-logo.png?attach=0').then(r => r.status)`)) === 200);
  await b.js(`socket_emit('doc-update', 'sujet'); true`);
  await b.waitFor(`!!document.querySelector('#work')`, 10000);
  b.check('...and builds', await b.waitFor(`!document.querySelector('#work') && S.status && S.status.layout_pages > 0`, 180000));
  if (await b.js(`!!document.querySelector('.server-dialog')`)) await b.js('warn_ok(); true');
  await b.shot('b2-exam');
  b.check('The test exam is deleted', await b.deleteExam(EXAM));
  b.check('The test exam is deleted', await b.waitFor(`fetch('/ui/api/projects', {cache: 'no-store'}).then(r => r.json()).then(r => !r.projects.some(p => p.name === ${J(EXAM)}))`, 20000));

  // ---- The sign-in page (shared-machine mode)
  if (USER) {
    await b.goto('/auth/account');
    await b.waitFor(`!!document.querySelector('form[action$="/auth/logout"]')`, 10000);
    await b.js(`document.querySelector('form[action$="/auth/logout"]').submit(); true`);
    await b.waitFor(`location.pathname === '/auth/login'`, 10000);
    b.check('The sign-in page shows the school name and logo', await b.waitFor(`(() => { const m = document.querySelector('.brand'); return !!m && m.textContent.includes(${J(SCHOOL)}) && !!m.querySelector('img'); })()`, 10000));
    b.check('...in the school colour', await b.js(`getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() === '#0b7285'`));
    await b.shot('b3-signin');
    await b.signIn();
  }

  // ---- Reset to neutral
  await b.goto('/appearance');
  await b.waitFor(`S.route.kind === 'appearance' && !!S.look && S.look.canEdit`, 10000);
  await b.click('[data-act="look-reset"]');
  await b.click('[data-act="dialog-ok"]');
  b.check('"Reset to neutral" brings the neutral look back', await b.waitFor(`(() => { const m = document.querySelector('.brandmark'); return !!m && !m.querySelector('img') && m.textContent.trim() === 'AMCAMC'; })()`, 15000), await b.text('.brandmark'));
  b.check('...everywhere', (await b.js(`fetch('/public/branding.json', {cache: 'no-store'}).then(r => r.json())`)).name === '');
  await sleep(200);
}

main().then(() => b.finish(), (e) => b.finish(e));
