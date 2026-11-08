/*
 * Question statistics after marking (doc/features.md, Question banks; server: ui_stats.py):
 * in the Mark step, how each question did: the share of copies that got it right, how well
 * it separates strong from weak students, which answers were chosen, and what to look at.
 * Loaded after app.js and uses its helpers.
 */
/* global S, $, esc, ic, getJSON, plural */

async function loadQStats() {
  const project = S.project;
  if (!project) return;
  let r;
  try { r = await getJSON('/ui/api/question-stats'); } catch (e) { console.error(e); return; }
  if (S.project !== project || r.project !== project) return;
  S.qstats = r;
  const host = $('#qstats');
  if (host) host.outerHTML = qstatsCard();
}

const pct = (x) => `${Math.round((x || 0) * 100)}%`;
function sepWords(s, right) {
  if (s === null || s === undefined) return '<span class="subtle">—</span>';
  // when almost everyone got it right (or wrong), there is little to separate
  const cls = right >= 0.9 || right <= 0.1 ? 'subtle' : s < 0 ? 'qs-bad' : s < 0.15 ? 'qs-weak' : s < 0.3 ? '' : 'qs-good';
  return `<span class="${cls}" title="Share right among the strongest 27% of copies minus among the weakest 27%">${s.toFixed(2)}</span>`;
}

function qstatsCard() {
  const d = S.qstats;
  if (!d || d.project !== S.project) return '<div id="qstats"></div>';
  const list = d.stats || [];
  if (!list.length) return `<div id="qstats">${d.error ? `<p class="subtle">${esc(d.error)}</p>` : ''}</div>`;
  const n = Math.max(...list.map((s) => s.n));
  const rows = list.map((s) => {
    const flag = !!s.flag;
    const answers = s.answers.length ? `<div class="qs-answers">${s.answers.map((a) => `<div class="qs-ans ${a.correct ? 'is-correct' : ''}">
        <span class="qs-ans-label">${a.correct ? ic('check') : ''}${esc((s.labels || {})[String(a.answer)] || (a.answer === 0 ? 'none of these' : `answer ${a.answer}`))}</span>
        <span class="qs-bar"><span style="width:${pct(a.share)}"></span></span><span class="qs-num">${pct(a.share)}</span>
        <span class="subtle qs-split" title="Chosen by the strongest 27% of copies, and by the weakest 27%">strong ${pct(a.upper)} · weak ${pct(a.lower)}</span></div>`).join('')}</div>` : '';
    return `<details class="qs-row ${flag ? 'is-flagged' : ''}"><summary>
        <span class="mono qs-title">${esc(s.title)}</span>
        <span class="qs-bar" title="${pct(s.right)} of copies got full marks"><span style="width:${pct(s.right)}"></span></span><span class="qs-num">${pct(s.right)}</span>
        <span class="qs-num">${sepWords(s.separation, s.right)}</span>
        <span class="qs-note">${flag ? `${ic('warning-triangle')} ${esc(s.notes[0])}${s.notes.length > 1 ? ` <span class="subtle">(+${s.notes.length - 1})</span>` : ''}` : s.notes.length ? `<span class="subtle">${esc(s.notes[0])}</span>` : ''}</span></summary>
      <div class="qs-detail">${s.notes.length ? `<ul class="qs-notes">${s.notes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}${answers}
        <p class="subtle">${plural(s.n, 'copy', 'copies')} · mean score ${pct(s.mean)} · right among the strongest ${pct(s.upper)}, among the weakest ${pct(s.lower)}</p></div></details>`;
  }).join('');
  return `<section class="card qstats" id="qstats" style="margin-top:16px"><div class="card-header">${ic('stats-report')}<h2>How each question did</h2><span class="chip">${plural(n, 'copy', 'copies')}</span></div>
    <p class="muted qs-help"><b>Right</b>: the copies with full marks. <b>Separates</b>: how much more often the strongest copies got it right than the weakest; 0.3 and more is good, below 0 suggests a wrong answer key. Open a question to see which answers were chosen.${n < d.min_copies ? ` With fewer than ${d.min_copies} copies the figures say little.` : ''}</p>
    <div class="qs-head"><span>Question</span><span></span><span>Right</span><span>Separates</span><span>To look at</span></div>
    <div class="qs-list">${rows}</div></section>`;
}
