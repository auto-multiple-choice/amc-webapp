/*
 * Emailing results (issue #7, server/ui_mail.py): the administrator's
 * Email sending page (/email), and an exam's Email results screen
 * (/exam/<name>/email, reached from Annotate): the message with AMC's
 * codes, a preview per student, a test to oneself, the students with
 * their status, and sending with progress and Stop. Loaded after app.js.
 */
/* global S, $, esc, ic, getJSON, postJSON, headers, toast, notice, confirmDialog, banner, plural, header,
   renderMain, guideBox, examPath, socket, socket_emit, copyName, fmtNum, showFile, refreshStatus */

const EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

/* ---------- Administrator: Email sending ---------- */

async function loadMailSetup() {
  try {
    const r = await fetch('/ui/api/mail/settings', { headers: headers(), cache: 'no-store' });
    const j = await r.json();
    S.mailSetup = j.can_edit ? { s: { ...j.settings }, ports: j.ports, testTo: (S.mailSetup && S.mailSetup.testTo) || '' } : { denied: true };
  } catch { S.mailSetup = { error: true }; }
  if (S.route.kind === 'email') renderMain(true);
}

function viewMailSetup() {
  const M = S.mailSetup;
  if (!M) return `<div class="page">${header('', 'Email sending')}<div class="skeleton"></div></div>`;
  if (M.denied || M.error) {
    return `<div class="page">${header('', 'Email sending', 'The mail server teachers use to email results to their students.')}
      ${banner('info', 'lock', M.denied ? 'Only administrators can set up email sending.' : 'The settings couldn\'t be loaded.', M.denied ? 'Ask an administrator of this server.' : 'Reload the page.')}</div>`;
  }
  const s = M.s;
  const field = (key, label, attrs = '', hint = '') => `<label class="field"><span class="field-label">${label}</span>
    <input class="input" data-mail="${key}" value="${esc(s[key] ?? '')}" ${attrs}>${hint ? `<span class="field-hint">${hint}</span>` : ''}</label>`;
  const sec = (v, label) => `<button role="radio" aria-pressed="${s.security === v}" aria-checked="${s.security === v}" data-act="mail-security" data-v="${v}">${label}</button>`;
  return `<div class="page">
    ${header('', 'Email sending', 'The mail server teachers use to email annotated sheets and marks to their students, from an exam\'s Annotate step.')}
    ${s.configured ? banner('success', 'check-circle', 'Email sending is on.', `Emails go out from <b>${esc(s.from_address)}</b> through ${esc(s.host)}. Send a test after any change.`)
    : banner('info', 'info-circle', 'Email sending is off.', 'Fill in the mail server and the sender, save, then send yourself a test.')}
    <div class="grid grid-2" style="align-items:start">
      <section class="card"><div class="card-header">${ic('server')}<h2>Mail server</h2></div><div class="card-body">
        ${field('host', 'Server', 'placeholder="smtp.gmail.com" autocomplete="off" spellcheck="false"', 'Empty: email sending is off.')}
        <div class="field" style="margin-top:12px"><span class="field-label">Security</span>
          <div class="segmented full" role="radiogroup" aria-label="Security">${sec('starttls', 'STARTTLS')}${sec('ssl', 'SSL/TLS')}${sec('none', 'None')}</div>
          <span class="field-hint">${s.security === 'none' ? 'Unencrypted: only for a mail server on this machine or network.' : s.security === 'ssl' ? 'Encrypted from the start, usually port 465.' : 'Encrypted after connecting, usually port 587.'}</span></div>
        <div class="form-grid" style="margin-top:12px">
          ${field('port', 'Port', 'type="number" min="1" max="65535"')}
          ${field('user', 'User name', 'autocomplete="off" spellcheck="false"')}
        </div>
        <label class="field" style="margin-top:12px"><span class="field-label">Password</span>
          <input class="input" type="password" data-mail="password" value="${esc(s.password || '')}" autocomplete="new-password" placeholder="${s.password_set ? 'Saved: type a new one to replace it' : ''}">
          <span class="field-hint">Kept on the server for sending only, never shown again.${s.password_set ? ' <button class="link-btn" data-act="mail-clear-password">Remove the saved password</button>' : ''}</span></label>
        <p class="field-hint" style="margin-top:12px"><b>Gmail or Google Workspace:</b> server <code>smtp.gmail.com</code>, STARTTLS, port 587, your address as the user name and an <b>app password</b> (Google Account › Security › App passwords), not your normal password. Gmail sends about 500 emails a day at most.</p>
      </div></section>
      <div>
        <section class="card"><div class="card-header">${ic('mail')}<h2>Sender</h2></div><div class="card-body">
          ${field('from_address', 'Sender address', 'type="email" placeholder="exams@school.example" spellcheck="false"', 'Every email comes from this address; many servers only allow their own account here. Students\' replies go to the teacher who sends.')}
          <div style="margin-top:12px">${field('from_name', 'Sender name', 'placeholder="Riverside High School exams"')}</div>
        </div></section>
        <section class="card" style="margin-top:16px"><div class="card-header"><h2>Limits</h2></div><div class="card-body"><div class="form-grid">
          ${field('daily_limit', 'Emails a day per teacher', 'type="number" min="1" max="5000"', 'Keeps the server under its provider\'s limit.')}
          ${field('delay', 'Pause between emails (seconds)', 'type="number" min="0" max="30" step="0.5"', 'Some providers refuse quick bursts.')}
        </div></div></section>
      </div>
    </div>
    <section class="card" style="margin-top:16px"><div class="card-header">${ic('send-mail')}<h2>Test</h2></div><div class="card-body">
      <div class="row" style="gap:8px;flex-wrap:wrap"><label class="sr-only" for="mail-test-to">Send a test to</label>
        <input class="input" id="mail-test-to" type="email" style="max-width:320px" placeholder="you@school.example" value="${esc(M.testTo)}">
        <button class="btn" data-act="mail-test" ${M.busy ? 'disabled' : ''}>${ic('send-mail')} ${M.busy === 'test' ? 'Sending…' : 'Send a test email'}</button></div>
      <p class="field-hint" style="margin-top:8px">Uses the settings on this page, saved or not.</p>
    </div>
    <div class="card-foot"><span class="spacer"></span><button class="btn btn-primary" data-act="mail-save" ${M.busy ? 'disabled' : ''}>${ic('floppy-disk')} Save</button></div></section>
  </div>`;
}

const mailForm = () => ({ ...S.mailSetup.s });

async function mailSave() {
  const M = S.mailSetup;
  M.busy = 'save'; renderMain(true);
  const r = await postJSON('/ui/api/mail/settings', mailForm());
  M.busy = false;
  if (r.ok) { M.s = { ...r.settings }; toast(r.settings.configured ? 'Email settings saved. Send a test to check them.' : 'Saved: email sending is off.'); }
  else toast(r.error || 'Not saved.', 'warning-triangle');
  renderMain(true);
}

async function mailTest() {
  const M = S.mailSetup;
  const to = ($('#mail-test-to') || {}).value || '';
  M.testTo = to.trim();
  if (!EMAIL_RE.test(M.testTo)) { toast('Type the address to send the test to.', 'warning-triangle'); return; }
  M.busy = 'test'; renderMain(true);
  const r = await postJSON('/ui/api/mail/test', { to: M.testTo, settings: mailForm() });
  M.busy = false; renderMain(true);
  if (r.ok) toast(`Test email sent to ${M.testTo}. Check that it arrived (and the spam folder).`);
  else notice('The test email wasn\'t sent', r.error || 'Unknown error.');
}

/* ---------- Exam: Email results ---------- */

const PROBLEMS = {
  unmatched: 'Not matched to a student',
  'no-sheet': 'No annotated sheet',
  'no-email': 'No email address',
  'bad-email': 'Not an email address',
};
const rowKey = (r) => `${r.student}:${r.copy}`;
const canSend = (r) => !r.problem;
const wasSent = (r) => !!(r.log && r.log.ok);
const FILTERS = [
  ['all', 'All', () => true],
  ['send', 'To send', (r) => canSend(r) && !wasSent(r)],
  ['sent', 'Sent', wasSent],
  ['failed', 'Failed', (r) => canSend(r) && r.log && !r.log.ok],
  ['cant', 'Can\'t send', (r) => !canSend(r)],
];

async function loadEmail() {
  const p = S.project;
  let r;
  try { r = await getJSON('/ui/api/email'); } catch (e) { console.error(e); return; }
  if (S.project !== p || r.project !== p) return;
  const old = S.email;
  r.sel = old && old.project === p ? new Set([...old.sel].filter((k) => r.rows.some((x) => rowKey(x) === k && canSend(x))))
    : new Set(r.rows.filter((x) => canSend(x) && !wasSent(x)).map(rowKey));
  r.filter = old && old.project === p ? old.filter : 'all';
  r.previewKey = old && old.project === p && r.rows.some((x) => rowKey(x) === old.previewKey) ? old.previewKey
    : rowKey(r.rows.find(canSend) || r.rows[0] || { student: 0, copy: 0 });
  r.progress = old && old.project === p && r.sending ? old.progress : null;
  r.preview = old && old.project === p ? old.preview : null;
  S.email = r;
  if (S.route.step === 'email') { renderMain(true); emailPreview(); }
  if (r.sending && !r.progress) setTimeout(() => { if (S.route.step === 'email' && S.email && S.email.sending) loadEmail(); }, 3000);
}

function emailStatus(r) {
  if (r.problem) return `<span class="subtle">${PROBLEMS[r.problem]}${r.problem === 'bad-email' && r.bad ? `: ${esc(r.bad)}` : ''}</span>`;
  const when = (t) => new Date(t * 1000).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  if (r.log && r.log.ok) return `<span class="chip chip-success">${ic('check')} Sent ${when(r.log.at)}</span>`;
  if (r.log) return `<span class="chip chip-danger" title="${esc(r.log.error || '')}">${ic('warning-triangle')} Failed</span> <span class="subtle">${esc(r.log.error || '')}${r.log.sent ? ` · sent before, ${when(r.log.sent)}` : ''}</span>`;
  return '<span class="subtle">Ready</span>';
}

function emailTable() {
  const E = S.email;
  const test = FILTERS.find((f) => f[0] === E.filter)[2];
  const rows = E.rows.filter(test);
  const sendable = rows.filter(canSend);
  const allOn = sendable.length > 0 && sendable.every((r) => E.sel.has(rowKey(r)));
  if (!rows.length) return `<p class="subtle" style="padding:16px">${E.rows.length ? 'No students here.' : 'No scanned sheets yet.'}</p>`;
  return `<div class="table-wrap" style="border:0;border-radius:0;max-height:460px"><table class="table"><thead><tr>
      <th style="width:34px"><input type="checkbox" data-email-all ${allOn ? 'checked' : ''} ${sendable.length && !E.progress ? '' : 'disabled'} aria-label="Choose every student shown"></th>
      <th>Copy</th><th>Student</th><th>Email</th><th class="num">Mark</th><th>Status</th></tr></thead><tbody>
    ${rows.map((r) => `<tr data-row="${rowKey(r)}"><td><input type="checkbox" data-email-sel="${rowKey(r)}" ${E.sel.has(rowKey(r)) ? 'checked' : ''} ${canSend(r) && !E.progress ? '' : 'disabled'} aria-label="Send to ${esc(r.name || copyName(r.student, r.copy))}"></td>
      <td class="num">${r.copy ? `${r.student}·${r.copy}` : r.student}</td><td>${r.name ? esc(r.name) : '<span class="subtle">–</span>'}</td>
      <td class="mono" style="word-break:break-all">${esc(r.to.join(', '))}</td><td class="num">${r.mark === null || r.mark === undefined ? '' : fmtNum(r.mark)}</td><td class="em-status">${emailStatus(r)}</td></tr>`).join('')}
    </tbody></table></div>`;
}

function emailFoot() {
  const E = S.email;
  const chosen = E.rows.filter((r) => canSend(r) && E.sel.has(rowKey(r)));
  const p = E.progress;
  if (p && !p.test) {
    return `<div style="flex:1;min-width:0"><div class="row" style="gap:8px"><b>Sending ${Math.min(p.done + 1, p.total)} of ${p.total}…</b><span class="subtle">${p.sent} sent${p.failed ? `, ${p.failed} failed` : ''}</span></div>
      <div class="progress" style="margin-top:6px"><span style="width:${Math.round((p.done / Math.max(1, p.total)) * 100)}%"></span></div></div>
      <button class="btn" data-act="email-stop">${ic('pause')} Stop</button>`;
  }
  if (E.sending) return '<span class="subtle" style="flex:1">Emails for this exam are being sent…</span>';
  const ready = E.configured && !E.single;
  return `<span class="subtle" style="flex:1">${plural(chosen.length, 'student', 'students')} chosen · ${E.remaining} of ${E.limit} emails left today</span>
    <button class="btn btn-primary" data-act="email-send" ${chosen.length && ready ? '' : 'disabled'}>${ic('send-mail')} ${chosen.length ? `Send ${plural(chosen.length, 'email', 'emails')}…` : 'Send emails…'}</button>`;
}

/* The footer, the filter counts and the "every student" box, after a tick or an email sent. */
function emailCounts() {
  const f = $('#em-foot'); if (f) f.innerHTML = emailFoot();
  const c = $('#em-filters'); if (c) c.innerHTML = emailFilters();
  const all = $('#em-table [data-email-all]');
  if (all) { const boxes = [...document.querySelectorAll('#em-table [data-email-sel]')].filter((b) => !b.disabled); all.checked = boxes.length > 0 && boxes.every((b) => b.checked); }
}

function renderEmailStudents() {
  const t = $('#em-table'); if (t) t.innerHTML = emailTable();
  const f = $('#em-foot'); if (f) f.innerHTML = emailFoot();
  const c = $('#em-filters'); if (c) c.innerHTML = emailFilters();
}

function emailFilters() {
  const E = S.email;
  return FILTERS.map(([id, label, test]) => `<button role="radio" aria-pressed="${E.filter === id}" aria-checked="${E.filter === id}" data-act="email-filter" data-v="${id}">${label} <span class="subtle">${E.rows.filter(test).length}</span></button>`).join('');
}

function emailPreviewHtml() {
  const E = S.email;
  const P = E.preview;
  if (!E.rows.length) return '<p class="subtle">No scanned sheets yet.</p>';
  if (!P) return '<div class="skeleton" style="height:160px"></div>';
  if (P.error) return `<p class="subtle">${esc(P.error)}</p>`;
  const kb = (n) => `${Math.max(1, Math.round(n / 1024))} KB`;
  return `<dl class="mail-head">
      <dt>From</dt><dd>${esc(E.sender || 'not set up yet')}</dd>
      <dt>To</dt><dd class="mono">${P.to.length ? esc(P.to.join(', ')) : '<span class="subtle">no address</span>'}</dd>
      ${E.reply_to ? `<dt>Reply to</dt><dd class="mono">${esc(E.reply_to)}</dd>` : ''}
      <dt>Subject</dt><dd><b>${esc(P.subject)}</b></dd></dl>
    <pre class="mail-body">${esc(P.body)}</pre>
    ${P.attachment ? `<div class="row" style="gap:8px;margin-top:8px">${ic('page')}<span class="mono" style="word-break:break-all">${esc(P.attachment.name)}</span>${P.attachment.size ? `<span class="subtle">${kb(P.attachment.size)}</span>` : ''}
      <span class="spacer"></span><button class="btn btn-sm" data-act="email-open-sheet">${ic('eye')} Open</button></div>` : ''}
    ${P.problem ? `<p class="field-hint" style="margin-top:8px">${ic('warning-triangle')} This student can't get an email: ${PROBLEMS[P.problem].toLowerCase()}.</p>` : ''}`;
}

let emailPreviewTimer = null;
function emailPreview(soon = false) {
  clearTimeout(emailPreviewTimer);
  emailPreviewTimer = setTimeout(async () => {
    const E = S.email;
    if (!E || !E.rows.length) return;
    const [student, copy] = E.previewKey.split(':').map(Number);
    const r = await postJSON('/ui/api/email/preview', { student, copy, subject: E.subject, body: E.body });
    if (S.email !== E) return;
    E.preview = r;
    const host = $('#em-preview'); if (host) host.innerHTML = emailPreviewHtml();
  }, soon ? 300 : 0);
}

function viewEmail() {
  const E = S.email;
  const back = `<a class="btn btn-ghost" href="${examPath(S.project, 'annotate')}" data-nav>${ic('arrow-left')} Annotate</a>`;
  if (!E) return `<div class="page">${header('', 'Email results', '', back)}<div class="skeleton"></div></div>`;
  const go = (step, label) => `<a class="btn btn-sm" href="${examPath(S.project, step)}" data-nav>${label}</a>`;
  const notes = [];
  if (!E.configured) {
    notes.push(E.can_setup ? banner('info', 'mail', 'Email sending isn\'t set up yet.', 'Set up the mail server once; every teacher on this server can then send.', `<a class="btn btn-sm btn-primary" href="/email" data-nav>${ic('settings')} Set up email sending</a>`)
      : banner('info', 'lock', 'Email sending isn\'t set up on this server.', 'Ask an administrator to set it up.'));
  }
  if (E.single) notes.push(banner('warning', 'warning-triangle', 'Emails need one PDF per student.', 'In Annotate › Files, choose "One PDF per student", then annotate again.', go('annotate', 'Go to Annotate')));
  else if (E.rows.length && !E.rows.some((r) => r.file)) notes.push(banner('info', 'info-circle', 'Annotate the sheets first.', 'Each email carries the student\'s annotated sheet.', go('annotate', 'Go to Annotate')));
  if (E.stale) notes.push(banner('warning', 'warning-triangle', 'The annotated sheets are out of date.', 'The marks, matches or annotation settings changed after they were made. Annotate again before sending.', go('annotate', 'Go to Annotate')));
  if (!E.columns.length) notes.push(banner('info', 'info-circle', 'No class list yet.', 'Load a class list with an email column in Match students.', go('match-students', 'Go to Match students')));
  else if (!E.column) notes.push(banner('warning', 'warning-triangle', 'No email column found in the class list.', 'Choose the column that holds the addresses, below. Or add one to the class list and load it again in Match students.'));
  const codes = [['%(ID)', 'Name'], ['%s', 'Mark'], ['%m', 'Out of'], ['%n', 'Exam']].concat(E.columns.slice(0, 8).map((c) => [`%(${c})`, c]));
  return `<div class="page">
    ${header('', 'Email results', 'Send each student their annotated sheet and mark by email.', back)}
    ${guideBox('email')}
    ${notes.join('')}
    <div class="grid grid-2" style="align-items:start">
      <section class="card"><div class="card-header">${ic('edit-pencil')}<h2>Message</h2></div><div class="card-body">
        <div class="form-grid">
          <label class="field"><span class="field-label">Email column</span><select class="select" id="em-column">
            <option value="" ${E.column ? '' : 'selected'}>${E.columns.length ? 'Choose a column' : 'No class list'}</option>
            ${E.columns.map((c) => `<option value="${esc(c)}" ${c === E.column ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
          <label class="field"><span class="field-label">Replies go to</span><input class="input" id="em-reply" type="email" value="${esc(E.reply_to)}" placeholder="your address" spellcheck="false"></label>
        </div>
        <p class="field-hint">${E.sender ? `Sent from <b>${esc(E.sender)}</b>; students' replies come to the address above.` : 'Students\' replies come to the address above.'}</p>
        <label class="field" style="margin-top:12px"><span class="field-label">Subject</span><input class="input" id="em-subject" value="${esc(E.subject)}"></label>
        <label class="field" style="margin-top:12px"><span class="field-label">Message</span><textarea class="textarea" id="em-body" rows="9">${esc(E.body)}</textarea></label>
        <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:8px"><span class="subtle">Insert:</span>${codes.map(([c, l]) => `<button class="btn btn-sm btn-ghost" data-act="email-code" data-code="${esc(c)}" title="${esc(c)}">${esc(l)}</button>`).join('')}</div>
        <p class="field-hint" style="margin-top:8px">The same codes as the annotated sheets' header: <code>%s</code> mark, <code>%m</code> out of, <code>%S</code> points, <code>%M</code> maximum points, <code>%n</code> exam, <code>%(ID)</code> the student's name, <code>%(column)</code> a class list column. The annotated sheet is attached. <button class="link-btn" data-act="email-default">Back to the default text</button></p>
      </div></section>
      <section class="card"><div class="card-header">${ic('eye')}<h2>Preview</h2><span class="spacer"></span>
        <label class="sr-only" for="em-preview-copy">Student</label><select class="select input-sm" id="em-preview-copy" style="max-width:260px">
          ${E.rows.map((r) => `<option value="${rowKey(r)}" ${rowKey(r) === E.previewKey ? 'selected' : ''}>${copyName(r.student, r.copy)}${r.name ? ' · ' + esc(r.name) : ''}</option>`).join('')}</select></div>
        <div class="card-body"><div id="em-preview">${emailPreviewHtml()}</div></div>
        <div class="card-foot" style="flex-wrap:wrap;gap:8px"><label class="sr-only" for="em-test">Send a test to</label>
          <input class="input input-sm" id="em-test" type="email" style="max-width:240px" placeholder="you@school.example" value="${esc(E.test_to)}" spellcheck="false">
          <button class="btn btn-sm" data-act="email-test" ${E.configured && !E.progress && !E.sending ? '' : 'disabled'}>${ic('send-mail')} Send me this as a test</button>
          <span class="field-hint" style="flex-basis:100%">With [Test] in the subject. Nothing is recorded for the student.</span></div>
      </section>
    </div>
    <section class="card" style="margin-top:16px"><div class="card-header">${ic('group')}<h2>Students</h2><span class="spacer"></span>
      <div class="segmented" role="radiogroup" aria-label="Show" id="em-filters">${emailFilters()}</div></div>
      <div id="em-table">${emailTable()}</div>
      <div class="card-foot" id="em-foot" style="gap:12px">${emailFoot()}</div></section>
  </div>`;
}

/* The server sends the saved text: saved as it is typed, and at once before a send. */
async function emailSaveNow() {
  clearTimeout(emailSaveTimer);
  const E = S.email;
  if (!E) return false;
  const okAddr = (v) => !v || EMAIL_RE.test(v);
  if (!okAddr(E.reply_to) || !okAddr(E.test_to)) return false; // half-typed: saved once it is an address
  const r = await postJSON('/ui/api/email/settings', { column: E.column, subject: E.subject, body: E.body, reply_to: E.reply_to, test_to: E.test_to });
  if (r.error) toast(r.error, 'warning-triangle');
  return !r.error;
}
let emailSaveTimer = null;
function emailSave() {
  clearTimeout(emailSaveTimer);
  emailSaveTimer = setTimeout(emailSaveNow, 700);
}

async function emailSend() {
  const E = S.email;
  const chosen = E.rows.filter((r) => canSend(r) && E.sel.has(rowKey(r)));
  if (!chosen.length) return;
  const again = chosen.filter(wasSent).length;
  const ok = await confirmDialog({
    icon: 'send-mail', title: `Send ${plural(chosen.length, 'email', 'emails')}?`,
    body: `<p>Each student gets the message above with their annotated sheet attached.</p>
      <ul><li>From: <b>${esc(E.sender)}</b></li>${E.reply_to ? `<li>Replies go to: <b>${esc(E.reply_to)}</b></li>` : '<li>No reply address: replies go to the sender.</li>'}</ul>
      ${again ? `<p>${plural(again, 'student was', 'students were')} sent an email already and will get another.</p>` : ''}
      ${E.stale ? '<p><b>The annotated sheets are out of date.</b> Annotate again first, unless you are sure.</p>' : ''}
      <p class="subtle">Emails can't be called back once sent.</p>`,
    ok: `Send ${plural(chosen.length, 'email', 'emails')}`,
  });
  if (!ok) return;
  if (!(await emailSaveNow())) { toast('Check "Replies go to": it isn\'t an email address.', 'warning-triangle'); return; }
  E.progress = { done: 0, total: chosen.length, sent: 0, failed: 0 };
  renderEmailStudents();
  socket_emit('ui-email-send', { copies: chosen.map((r) => [r.student, r.copy]) });
}

socket.on('ui-email-progress', (p) => {
  const E = S.email;
  if (!E || p.test) return;
  E.progress = p;
  const r = p.student !== undefined && E.rows.find((x) => x.student === p.student && x.copy === p.copy);
  if (r) {
    const now = Math.floor(Date.now() / 1000);
    r.log = { at: now, ok: p.ok, error: p.error, sent: p.ok ? now : r.log && r.log.sent };
    if (p.ok) E.sel.delete(rowKey(r));
  }
  if (S.route.step !== 'email') return;
  const tr = r && document.querySelector(`#em-table tr[data-row="${rowKey(r)}"]`);
  if (tr) { tr.querySelector('.em-status').innerHTML = emailStatus(r); const box = tr.querySelector('[data-email-sel]'); box.checked = E.sel.has(rowKey(r)); }
  emailCounts();
});

socket.on('ui-email-done', (d) => {
  const E = S.email;
  if (E) { E.progress = null; E.testing = false; }
  if (d.test) {
    if (d.sent) toast(`Test sent to ${d.test}. Check that it arrived (and the spam folder).`);
    else notice('The test email wasn\'t sent', d.error || 'The mail server refused it.');
  } else if (d.error && !d.sent && !d.failed) {
    notice('No email was sent', d.error);
  } else {
    const text = `${plural(d.sent, 'email', 'emails')} sent${d.failed ? `, ${d.failed} failed` : ''}${d.stopped ? ' (stopped)' : ''}.`;
    if (d.error) notice(text, d.error); else toast(text, d.failed ? 'warning-triangle' : 'check-circle');
  }
  if (S.route.step === 'email') loadEmail();
  refreshStatus();
});

socket.on('ui-changed', (what) => { if (what === 'email' && S.route.step === 'email' && !(S.email && S.email.progress)) loadEmail(); });

/* The Annotate page's way in. */
function emailCard() {
  return `<section class="card" style="margin-top:16px"><div class="card-header">${ic('mail')}<h2>Email the sheets to students</h2></div>
    <div class="card-body"><div class="row" style="gap:12px;flex-wrap:wrap"><p class="subtle" style="flex:1;min-width:260px;margin:0">Send each student their annotated sheet and mark, to the address in the class list. See each email first, and send yourself a test.</p>
      <a class="btn btn-primary" href="${examPath(S.project, 'email')}" data-nav>${ic('send-mail')} Email results…</a></div></div></section>`;
}

/* ---------- Events ---------- */

const EMAIL_ACTIONS = {
  'mail-security': (el) => {
    const M = S.mailSetup; const prev = M.s.security;
    M.s.security = el.dataset.v;
    if (!M.s.port || +M.s.port === M.ports[prev]) M.s.port = M.ports[el.dataset.v];
    renderMain(true);
  },
  'mail-clear-password': () => { S.mailSetup.s.clear_password = true; S.mailSetup.s.password = ''; S.mailSetup.s.password_set = false; renderMain(true); toast('The password is removed when you save.', 'info-circle'); },
  'mail-save': () => mailSave(),
  'mail-test': () => mailTest(),
  'email-filter': (el) => { S.email.filter = el.dataset.v; renderEmailStudents(); },
  'email-send': () => emailSend(),
  'email-stop': () => { socket_emit('ui-email-stop'); toast('Stopping after the current email…', 'info-circle'); },
  'email-test': async () => {
    const E = S.email;
    E.test_to = (($('#em-test') || {}).value || '').trim();
    if (!EMAIL_RE.test(E.test_to)) { toast('Type your address to send the test to.', 'warning-triangle'); return; }
    const shown = E.rows.find((r) => rowKey(r) === E.previewKey);
    if (!shown || shown.problem) { toast('This student can\'t get an email. Choose another student in the preview.', 'warning-triangle'); return; }
    if (!(await emailSaveNow())) { toast('Check "Replies go to": it isn\'t an email address.', 'warning-triangle'); return; }
    const [student, copy] = E.previewKey.split(':').map(Number);
    socket_emit('ui-email-send', { copies: [[student, copy]], test_to: E.test_to });
    toast(`Sending a test to ${E.test_to}…`, 'send-mail');
  },
  'email-open-sheet': () => { const P = S.email.preview; if (P && P.attachment) showFile(P.attachment.path, `Attached · ${P.attachment.name}`); },
  'email-code': (el) => {
    const t = $('#em-body'); if (!t) return;
    const at = t.selectionStart ?? t.value.length;
    t.value = t.value.slice(0, at) + el.dataset.code + t.value.slice(t.selectionEnd ?? at);
    t.focus(); t.setSelectionRange(at + el.dataset.code.length, at + el.dataset.code.length);
    t.dispatchEvent(new Event('input', { bubbles: true }));
  },
  'email-default': () => {
    const E = S.email;
    E.subject = E.defaults.subject; E.body = E.defaults.body;
    $('#em-subject').value = E.subject; $('#em-body').value = E.body;
    emailSave(); emailPreview(true);
  },
};

/* Typing in the Email sending page or the message: kept, saved, previewed. */
function emailInput(t) {
  if (t.dataset && t.dataset.mail && S.mailSetup && S.mailSetup.s) { S.mailSetup.s[t.dataset.mail] = t.value; return true; }
  const E = S.email;
  if (!E) return false;
  const field = { 'em-subject': 'subject', 'em-body': 'body', 'em-reply': 'reply_to', 'em-test': 'test_to' }[t.id];
  if (!field) return false;
  E[field] = field === 'body' ? t.value : t.value.trim();
  if (field === 'reply_to' || field === 'test_to') t.setAttribute('aria-invalid', String(!!E[field] && !EMAIL_RE.test(E[field])));
  emailSave();
  if (field !== 'test_to') emailPreview(true);
  return true;
}

function emailChange(t) {
  const E = S.email;
  if (!E) return false;
  if (t.id === 'em-column') { E.column = t.value; emailSaveNow().then(loadEmail); return true; }
  if (t.id === 'em-preview-copy') { E.previewKey = t.value; emailPreview(); return true; }
  if (t.dataset.emailSel !== undefined) {
    if (t.checked) E.sel.add(t.dataset.emailSel); else E.sel.delete(t.dataset.emailSel);
    emailCounts();
    return true;
  }
  if (t.dataset.emailAll !== undefined) {
    const test = FILTERS.find((f) => f[0] === E.filter)[2];
    E.rows.filter((r) => test(r) && canSend(r)).forEach((r) => { if (t.checked) E.sel.add(rowKey(r)); else E.sel.delete(rowKey(r)); });
    document.querySelectorAll('#em-table [data-email-sel]').forEach((box) => { if (!box.disabled) box.checked = E.sel.has(box.dataset.emailSel); });
    emailCounts();
    return true;
  }
  return false;
}
