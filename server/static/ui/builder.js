/*
 * Questions > Paper builder (doc/paper-builder-plan.md): the question
 * paper and the answer sheet composed from rows of blocks on a 12-column
 * grid. Loaded after app.js and uses its helpers (S, $, esc, ic, getJSON,
 * toast, banner, store, locked...). The design is paper.json on the
 * server (/ui/api/builder); every change sends the whole design, typing
 * 0.9 s after the last keystroke, other changes at once.
 */
/* global S, $, esc, ic, getJSON, headers, toast, banner, store, locked, renderDesign, renderDSections, dop, upload, loadFiles, openHistory, confirmDialog, qPreviewHtml, fmtIsoDate, loadDesign, questionsHead */

const BTABS = [['paper', 'Question paper'], ['sheet', 'Answer sheet'], ['instructions', 'Instructions'], ['details', 'Details'], ['sections', 'Sections'], ['page', 'Versions and page']];
const ROW_PRESETS = [['One column', [12]], ['Two equal columns', ['auto', 'auto']], ['Three equal columns', ['auto', 'auto', 'auto']],
  ['Logo, title, logo', ['fit', 'auto', 'fit']], ['8 + 4', [8, 'auto']], ['4 + 8', [4, 'auto']], ['3 + 6 + 3', [3, 6, 3]], ['Details, code, information', [8, 'fit', 'auto']]];
const WIDTHS = [['auto', 'Auto (share what is left)'], ['fit', 'Fit the content']].concat([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => [String(n), `${n} of 12`]));
const BORDERS = [['default', 'As the page'], ['none', 'None'], ['dashed', 'Dashed'], ['solid', 'Solid']];
const ALIGNS = [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']];
const VALIGNS = [['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']];
const SIZES = [['giant', 'Giant'], ['Huge', 'Huge'], ['huge', 'Very large'], ['LARGE', 'Larger'], ['Large', 'Large'], ['large', 'Slightly large'], ['normalsize', 'Normal'], ['small', 'Small']];
const STYLES = [['plain', 'Plain'], ['bold', 'Bold'], ['smallcaps', 'Small caps'], ['boldsc', 'Bold small caps'], ['italic', 'Italic']];
const BULLETS = [['arrow', 'Arrow'], ['dot', 'Dot'], ['number', 'Numbered'], ['none', 'None']];
const MARGINS = [['normal', 'Normal'], ['narrow', 'Narrow'], ['wide', 'Wide']];
const CODE_STYLES = [['letters', 'Letters: A, B, C… then AA, AB…'], ['numbers', 'Numbers: 1, 2, 3…'], ['none', 'No code']];
const QSTYLES = [['rj', 'RJ style: Q-1〉'], ['default', "AMC's own: Question 1"]];
const BLOCK_ORDER = ['title', 'logo', 'student', 'code', 'info', 'box', 'instructions', 'text', 'questions', 'end', 'rough', 'rule', 'space', 'pagebreak', 'id_grid', 'class_grid', 'signatures', 'numeric_answers', 'choice_answers', 'all_answers'];
const PAGE_WHAT = { paper: 'question paper', sheet: 'answer sheet' };

const bdesign = () => (S.builder && S.builder.design) || null;
const brows = (sheet) => { const d = bdesign(); return d ? (sheet === 'sheet' ? d.answer_sheet : d.paper) : []; };
const bform = () => S.bform;
const bsel = () => (S.bform && S.bform.sel) || { sheet: 'paper', row: null, cell: null };
const brow = (sheet, id) => brows(sheet).find((r) => r.id === id) || null;
const bcell = (row, id) => (row && row.cells.find((c) => c.id === id)) || null;
const blockTitle = (t) => (S.builder && S.builder.blocks[t] ? S.builder.blocks[t].title : t);
const bopt = (list, value) => list.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`).join('');
const newId = (list, prefix) => { let n = list.length + 1; while (list.some((x) => x.id === `${prefix}${n}`)) n += 1; return `${prefix}${n}`; };
const fieldLabel = (k) => (S.builder && S.builder.fields[k]) || k;

function bstate() {
  if (!S.bform) S.bform = { tab: store.get('btab', 'paper'), sel: { sheet: 'paper', row: null, cell: null }, pending: false, saving: false, inflight: null, lastSaved: 0 };
  return S.bform;
}

/* ---------- Rendering ---------- */

function renderBuilder(host) {
  const b = S.builder;
  const f = bstate();
  const L = locked();
  f.locked = L;
  const d = bdesign();
  if (b.invalid) {
    host.className = 'builder';
    host.innerHTML = banner('warning', 'warning-triangle', 'The paper builder can\'t read this exam\'s design.', esc(b.invalid), `<button class="btn btn-sm" data-act="pb-history">${ic('clock-rotate-right')} History of paper.json</button>`);
    return;
  }
  if (d.kind !== 'separate' && f.tab === 'sheet') f.tab = 'paper';
  const tabs = BTABS.filter(([id]) => id !== 'sheet' || d.kind === 'separate');
  let notes = '';
  if (b.detached) notes += banner('info', 'info-circle', 'The layout file is edited by hand.', 'Changes made here are kept in paper.json but no longer written to paper-layout.tex; the paper is printed from the file as you edit it in the LaTeX tab.', L ? '' : `<button class="btn btn-sm" data-act="pb-layout" data-v="rewrite">Use the builder again (rewrite the file)</button>`);
  else if (b.layout.edited) notes += banner('warning', 'warning-triangle', 'paper-layout.tex was changed by hand since the builder wrote it.', 'Keep your changes (the builder stops writing the file) or rewrite it from the design here (your edits stay in History).', L ? '' : `<button class="btn btn-sm" data-act="pb-layout" data-v="keep">Keep my changes</button><button class="btn btn-sm btn-primary" data-act="pb-layout" data-v="rewrite">Rewrite it</button>`);
  const general = (b.problems || []).filter((p) => !p.sheet);
  general.forEach((p) => { notes += banner(p.level === 'error' ? 'danger' : p.level === 'warning' ? 'warning' : 'info', p.level === 'info' ? 'info-circle' : 'warning-triangle', esc(p.text), ''); });
  host.className = 'builder';
  host.innerHTML = `<div class="b-head"><div class="segmented b-tabs" role="tablist" aria-label="Paper builder">${tabs.map(([id, l]) => `<button role="tab" aria-pressed="${f.tab === id}" data-act="pb-tab" data-v="${id}">${esc(l)}${id === 'paper' || id === 'sheet' ? bProblemChip(id) : ''}</button>`).join('')}</div><span class="spacer"></span><span class="subtle" id="d-status"></span></div>
    ${notes}
    <div id="b-body">${renderBTab(f.tab, L)}</div>`;
  bAfterRender();
  renderBStatus();
}

function bProblemChip(sheet) {
  const n = (S.builder.problems || []).filter((p) => p.sheet === sheet && p.level !== 'info').length;
  return n ? `<span class="chip chip-warn" title="${n} thing${n > 1 ? 's' : ''} to look at">${n}</span>` : '';
}

function renderBTab(tab, L) {
  if (tab === 'paper' || tab === 'sheet') return `<div class="b-main"><div class="b-canvas" id="b-canvas">${renderCanvas(tab, L)}</div><div class="b-side" id="b-side">${renderBSide(tab, L)}</div></div>`;
  if (tab === 'instructions') return `<div class="d-card"><div class="d-body">${renderInstructions(L)}</div></div>`;
  if (tab === 'details') return `<div class="d-card"><div class="d-body">${renderDetails(L)}</div></div>`;
  if (tab === 'sections') return `<div class="d-card" id="d-sections">${S.design ? renderDSections(S.design, L) : '<div class="skeleton" style="height:200px"></div>'}</div>`;
  if (tab === 'page') return `<div class="d-card"><div class="d-body">${renderPage(L)}</div></div>`;
  return '';
}

/* The schematic page: every row with its columns, spans as on the printed page. */
function renderCanvas(sheet, L) {
  const rows = brows(sheet);
  const sel = bsel();
  const probs = (S.builder.problems || []).filter((p) => p.sheet === sheet);
  let html = probs.filter((p) => p.level !== 'info').map((p) => banner(p.level === 'error' ? 'danger' : 'warning', 'warning-triangle', esc(p.text), '')).join('');
  html += `<div class="b-page" data-sheet="${sheet}">`;
  if (!rows.length) html += `<p class="muted b-empty">Nothing on the ${PAGE_WHAT[sheet]} yet. Add a row below.</p>`;
  rows.forEach((r, i) => {
    const isSel = sel.sheet === sheet && sel.row === r.id && !sel.cell;
    const spans = cellSpans(r);
    const fixed = r.cells.reduce((n, c) => n + (typeof c.width === 'number' ? c.width : 0), 0);
    html += `<div class="b-row ${isSel ? 'is-selected' : ''}" data-row="${esc(r.id)}" data-sheet="${sheet}">
      <div class="b-row-bar">${L ? '' : `<span class="b-handle" draggable="true" data-row="${esc(r.id)}" data-sheet="${sheet}" title="Drag to move the row" aria-label="Drag to move the row">${ic('menu')}</span>`}<button class="btn btn-ghost btn-sm b-row-name" data-act="pb-row-select" data-row="${esc(r.id)}" data-sheet="${sheet}" title="The row's settings: alignment, same height, gap">${ic('settings')} Row ${i + 1}</button><span class="subtle">${r.cells.length > 1 ? `· gap ${esc(r.gap)}` : ''}${r.same_height ? ' · same height' : ''}${r.align !== 'top' ? ` · ${r.align}` : ''}</span><span class="spacer"></span>
        ${L ? '' : `<button class="btn btn-ghost btn-icon btn-sm" data-act="pb-row-move" data-row="${esc(r.id)}" data-sheet="${sheet}" data-d="-1" ${i ? '' : 'disabled'} title="Move up" aria-label="Move row up">${ic('nav-arrow-up')}</button><button class="btn btn-ghost btn-icon btn-sm" data-act="pb-row-move" data-row="${esc(r.id)}" data-sheet="${sheet}" data-d="1" ${i < rows.length - 1 ? '' : 'disabled'} title="Move down" aria-label="Move row down">${ic('nav-arrow-down')}</button><button class="btn btn-ghost btn-icon btn-sm" data-act="pb-row-delete" data-row="${esc(r.id)}" data-sheet="${sheet}" title="Remove the row" aria-label="Remove row">${ic('trash')}</button>${fixed < 12 ? `<button class="btn btn-ghost btn-sm" data-act="pb-cell-add" data-row="${esc(r.id)}" data-sheet="${sheet}" title="Add a column to this row">${ic('plus')} Column</button>` : ''}`}</div>
      <div class="b-cells">${r.cells.map((c, j) => {
        const cs = sel.sheet === sheet && sel.row === r.id && sel.cell === c.id;
        const border = c.border === 'default' ? bdesign().page.border : c.border;
        return `<div class="b-cell b-border-${border} ${cs ? 'is-selected' : ''}" style="grid-column: span ${spans[j]}" data-act="pb-select" data-row="${esc(r.id)}" data-cell="${esc(c.id)}" data-sheet="${sheet}" ${L ? '' : 'draggable="true"'} role="button" tabindex="0" aria-pressed="${cs}">
          <div class="b-cell-title">${esc(blockTitle(c.block.type))}</div><div class="b-cell-sub">${esc(blockSummary(c.block))}</div><span class="b-width">${c.width === 'auto' ? 'auto' : c.width === 'fit' ? 'fit' : `${c.width}/12`}</span></div>`;
      }).join('')}</div></div>`;
  });
  html += '</div>';
  const notes = probs.filter((p) => p.level === 'info');
  if (notes.length) html += `<ul class="b-notes">${notes.map((p) => `<li>${ic('info-circle')} ${esc(p.text)}</li>`).join('')}</ul>`;
  if (!L) html += `<div class="row" style="gap:8px;margin-top:10px"><label class="sr-only" for="pb-add-row-${sheet}">Add a row</label><select class="select" id="pb-add-row-${sheet}" data-pb-addrow="${sheet}"><option value="">${ic('plus')} Add a row…</option>${ROW_PRESETS.map(([l], i) => `<option value="${i}">${esc(l)}</option>`).join('')}</select></div>`;
  return html;
}

function cellSpans(r) {
  const fixed = r.cells.reduce((n, c) => n + (typeof c.width === 'number' ? c.width : 0), 0);
  const fits = r.cells.filter((c) => c.width === 'fit').length;
  const autos = r.cells.filter((c) => c.width === 'auto').length;
  const fitSpan = fixed + fits * 2 + autos <= 12 ? 2 : 1; // a "fit" column is drawn two columns wide when there is room
  const left = 12 - fixed - fits * fitSpan;
  const autoSpan = autos ? Math.max(1, Math.floor(left / autos)) : 0;
  return r.cells.map((c) => (typeof c.width === 'number' ? c.width : c.width === 'fit' ? fitSpan : autoSpan));
}

function blockSummary(b) {
  const d = bdesign();
  const f = d.fields;
  switch (b.type) {
    case 'logo': return b.file || 'no image yet';
    case 'title': return b.lines.map((l) => ('field' in l ? f[l.field] || `{${fieldLabel(l.field)}}` : l.text)).filter(Boolean).join(' / ') || 'no line';
    case 'student': return [b.name && b.name_label, b.id && `${b.id_label} ${d.student.id_prefix}${'□'.repeat(d.student.id_digits)}`, b.klass && d.student.klass && b.class_label, b.level && d.student.level && f.level && `${b.level_label} ${f.level}`].filter(Boolean).join(', ') || 'nothing to print';
    case 'code': return `${b.label ? b.label + ' ' : ''}${S.builder.codes ? S.builder.codes.first : 'A'}`;
    case 'info': return b.lines.map((l) => (typeof l === 'string' ? (f[l] ? `${fieldLabel(l)}: ${f[l]}` : '') : `${l.label}: ${l.value}`)).filter(Boolean).join(' · ') || 'no line';
    case 'box': return `${b.label}: ${b.value.replace(/\{(\w+)\}/g, (m, k) => f[k] || m)}`;
    case 'instructions': return `${d.instructions.items.length} item${d.instructions.items.length === 1 ? '' : 's'} (Instructions tab)`;
    case 'text': return b.latex.replace(/\s+/g, ' ').slice(0, 80) || 'empty';
    case 'questions': return `the sections, in order (Sections tab)`;
    case 'rule': return `${b.thickness} thick`;
    case 'space': return b.height;
    case 'pagebreak': return 'new page';
    case 'end': return b.text;
    case 'rough': return `${b.pages} page${b.pages === 1 ? '' : 's'}: ${b.text}`;
    case 'id_grid': return `${b.label}: ${d.student.id_digits} digits, ${b.orientation === 'v' ? 'vertical' : 'horizontal'}`;
    case 'class_grid': return d.student.klass ? `${b.label}: ${d.student.class_digits} digits` : `${b.label}: the class is off in Details, prints nothing`;
    case 'signatures': return b.lines.join(', ');
    case 'numeric_answers': return `${b.columns} grid${b.columns === 1 ? '' : 's'} per line, number on top${b.heading ? ': ' + b.heading : ''}`;
    case 'choice_answers': case 'all_answers': return `${b.columns} column${b.columns === 1 ? '' : 's'}${b.heading ? ': ' + b.heading : ''}`;
    default: return '';
  }
}

/* A version's design drawn as the builder draws its pages, read-only
   (History, app.js). INFO has the block titles and field labels. */
function designPicture(design, info) {
  const keep = { builder: S.builder, bform: S.bform };
  S.builder = { ...(S.builder || {}), design, problems: [], codes: null, blocks: info.blocks, fields: info.fields };
  S.bform = null;
  try {
    const sheets = design.kind === 'separate' || design.answer_sheet.length ? ['paper', 'sheet'] : ['paper'];
    return sheets.map((sh) => `<div class="b-pic"><div class="b-pic-title">${sh === 'paper' ? 'Question paper' : 'Answer sheet'}</div>${renderCanvas(sh, true)}</div>`).join('')
      .replace(/\sdata-act="[^"]*"/g, '').replace(/\s(draggable|tabindex|role|aria-pressed)="[^"]*"/g, '').replace(/ Add a row below\./g, '');
  } finally { S.builder = keep.builder; S.bform = keep.bform; }
}

/* The settings of what is selected: a column and its block, or a row. */
function renderBSide(sheet, L) {
  const sel = bsel();
  const dis = L ? 'disabled' : '';
  if (sel.sheet !== sheet || !sel.row) return `<div class="d-card"><div class="d-body"><p class="muted" style="margin:0">Click a block to change it; the settings of its row (how the columns line up, the same height for its boxes, the gap between them) are shown under it.${L ? '' : ' Drag blocks between columns and rows by their handle; columns are sized on a 12-column grid, like a web page.'}</p></div></div>`;
  const r = brow(sheet, sel.row);
  if (!r) return '';
  if (!sel.cell) return renderBRow(sheet, r, L, true);
  const c = bcell(r, sel.cell);
  if (!c) return '';
  const j = r.cells.indexOf(c);
  const where = sheet === 'sheet' ? 'sheet' : 'paper';
  const types = BLOCK_ORDER.filter((t) => S.builder.blocks[t] && (S.builder.blocks[t].where === 'both' || S.builder.blocks[t].where === where));
  const registering = S.builder.registering.includes(c.block.type);
  return `<div class="d-card"><div class="d-head"><b>${esc(blockTitle(c.block.type))}</b><span class="subtle">row ${brows(sheet).indexOf(r) + 1}, column ${j + 1}</span><span class="spacer"></span><button class="btn btn-ghost btn-sm" data-act="pb-unselect">Done</button></div><div class="d-body d-form">
    <div class="form-grid">
      <label class="field"><span class="field-label">Block</span><select class="select" data-pb-type="1" ${dis}>${types.map((t) => `<option value="${t}" ${t === c.block.type ? 'selected' : ''}>${esc(blockTitle(t))}</option>`).join('')}</select></label>
      <label class="field"><span class="field-label">Width</span><select class="select" data-pbc="width" ${dis}>${bopt(registering ? WIDTHS.filter(([v]) => v !== 'fit') : WIDTHS, c.width)}</select></label>
      <label class="field"><span class="field-label">Border</span><select class="select" data-pbc="border" ${dis}>${bopt(BORDERS, c.border)}</select></label>
      <label class="field"><span class="field-label">Alignment</span><select class="select" data-pbc="align" ${dis}>${bopt(ALIGNS, c.align)}</select></label>
      <label class="field"><span class="field-label">Padding inside the border</span><input class="input" data-pbc="pad" value="${esc(c.pad)}" ${dis}></label>
    </div>
    <div class="b-block-form">${renderBlockForm(c.block, where, L)}</div>
    ${L ? '' : `<div class="row" style="gap:6px;flex-wrap:wrap"><button class="btn btn-ghost btn-sm" data-act="pb-cell-move" data-d="-1" ${j ? '' : 'disabled'}>${ic('nav-arrow-left')} Move left</button><button class="btn btn-ghost btn-sm" data-act="pb-cell-move" data-d="1" ${j < r.cells.length - 1 ? '' : 'disabled'}>Move right ${ic('nav-arrow-right')}</button><span class="spacer"></span><button class="btn btn-ghost btn-sm" data-act="pb-cell-delete">${ic('trash')} Remove</button></div>`}
  </div></div>` + renderBRow(sheet, r, L, false);
}

function renderBRow(sheet, r, L, alone) {
  const dis = L ? 'disabled' : '';
  return `<div class="d-card"><div class="d-head"><b>Row ${brows(sheet).indexOf(r) + 1}</b>${alone ? '' : '<span class="subtle">the row of this block</span>'}<span class="spacer"></span>${alone ? '<button class="btn btn-ghost btn-sm" data-act="pb-unselect">Done</button>' : ''}</div><div class="d-body d-form">
      <label class="field"><span class="field-label">Columns aligned at the</span><select class="select" data-pbr="align" ${dis}>${bopt(VALIGNS, r.align)}</select></label>
      <label class="check"><input type="checkbox" data-pbr="same_height" data-type="bool" ${r.same_height ? 'checked' : ''} ${dis}><span>Same height for every box in the row<br><span class="subtle">Every box as tall as the tallest. Boxes AMC reads (grids, answer areas) keep their own height.</span></span></label>
      <div class="form-grid"><label class="field"><span class="field-label">Gap between the columns</span><input class="input" data-pbr="gap" value="${esc(r.gap)}" ${dis}></label>
      <label class="field"><span class="field-label">Space after the row</span><input class="input" data-pbr="after" value="${esc(r.after)}" ${dis}><span class="field-hint">Lengths such as 3mm, 1.5cm or 2ex.</span></label></div>
      ${L ? '' : `<div class="row" style="gap:8px"><button class="btn btn-ghost btn-sm" data-act="pb-row-delete" data-row="${esc(r.id)}" data-sheet="${sheet}">${ic('trash')} Remove the row</button></div>`}</div></div>`;
}

function renderBlockForm(b, where, L) {
  const dis = L ? 'disabled' : '';
  const d = bdesign();
  const fieldChoices = Object.keys(S.builder.fields).map((k) => [k, fieldLabel(k)]);
  switch (b.type) {
    case 'logo':
      return `<div class="field"><span class="field-label">Image</span><div class="row" style="gap:8px;flex-wrap:wrap"><select class="select" data-pbb="file" ${dis}><option value="">none</option>${(S.builder.images || []).map((f) => `<option ${f === b.file ? 'selected' : ''}>${esc(f)}</option>`).join('')}${b.file && !(S.builder.images || []).includes(b.file) ? `<option selected>${esc(b.file)}</option>` : ''}</select>${L ? '' : `<label class="btn btn-sm">${ic('upload')} Upload an image<input type="file" data-pb-upload="file" accept="image/png,image/jpeg,application/pdf" hidden></label>`}</div><span class="field-hint">PNG, JPEG or PDF, in the exam folder. The school logo from Appearance is school-logo.png.</span></div>
        <label class="field"><span class="field-label">Height</span><input class="input" data-pbb="height" value="${esc(b.height)}" ${dis}></label>`;
    case 'title':
      return `<div class="field-label">Lines</div>${b.lines.map((l, i) => `<div class="b-item"><div class="form-grid"><label class="field"><span class="field-label">Text</span>${'field' in l ? `<select class="select" data-pbb="lines.${i}.field" ${dis}>${bopt(fieldChoices, l.field)}</select><span class="field-hint">A detail from the Details tab${d.fields[l.field] ? `: ${esc(d.fields[l.field])}` : ' (empty: the line is left out)'}</span>` : `<input class="input" data-pbb="lines.${i}.text" value="${esc(l.text)}" ${dis}>`}</label>
        <label class="field"><span class="field-label">Size</span><select class="select" data-pbb="lines.${i}.size" ${dis}>${bopt(SIZES, l.size)}</select></label><label class="field"><span class="field-label">Style</span><select class="select" data-pbb="lines.${i}.style" ${dis}>${bopt(STYLES, l.style)}</select></label></div>
        ${L ? '' : `<div class="row" style="gap:4px"><button class="btn btn-ghost btn-sm" data-act="pb-list-move" data-list="lines" data-i="${i}" data-d="-1" ${i ? '' : 'disabled'}>${ic('nav-arrow-up')}</button><button class="btn btn-ghost btn-sm" data-act="pb-list-move" data-list="lines" data-i="${i}" data-d="1" ${i < b.lines.length - 1 ? '' : 'disabled'}>${ic('nav-arrow-down')}</button><button class="btn btn-ghost btn-sm" data-act="pb-list-remove" data-list="lines" data-i="${i}">${ic('trash')}</button></div>`}</div>`).join('')}
        ${L || b.lines.length >= 6 ? '' : `<div class="row" style="gap:6px;flex-wrap:wrap"><button class="btn btn-sm" data-act="pb-list-add" data-list="lines" data-kind="text">${ic('plus')} A line of text</button><button class="btn btn-sm" data-act="pb-list-add" data-list="lines" data-kind="field">${ic('plus')} A line from the details</button></div>`}`;
    case 'student':
      return `<div class="form-grid">
        <label class="check"><input type="checkbox" data-pbb="name" data-type="bool" ${b.name ? 'checked' : ''} ${dis}><span>Name line</span></label><label class="field"><span class="field-label">Label</span><input class="input" data-pbb="name_label" value="${esc(b.name_label)}" ${dis}></label>
        <label class="check"><input type="checkbox" data-pbb="id" data-type="bool" ${b.id ? 'checked' : ''} ${dis}><span>Registration number in boxes<br><span class="subtle">${esc(d.student.id_prefix)}${'□'.repeat(d.student.id_digits)}: the prefix and digits are in Details.</span></span></label><label class="field"><span class="field-label">Label</span><input class="input" data-pbb="id_label" value="${esc(b.id_label)}" ${dis}></label>
        ${d.student.klass ? `<label class="check"><input type="checkbox" data-pbb="klass" data-type="bool" ${b.klass ? 'checked' : ''} ${dis}><span>Class in boxes (${d.student.class_digits} digits)</span></label><label class="field"><span class="field-label">Label</span><input class="input" data-pbb="class_label" value="${esc(b.class_label)}" ${dis}></label>` : '<span class="field-hint">The class is off in Details, so no class boxes here.</span><span></span>'}
        ${d.student.level ? `<label class="check"><input type="checkbox" data-pbb="level" data-type="bool" ${b.level ? 'checked' : ''} ${dis}><span>Level box${d.fields.level ? ` (${esc(d.fields.level)})` : ' (set the level in Details)'}</span></label><label class="field"><span class="field-label">Label</span><input class="input" data-pbb="level_label" value="${esc(b.level_label)}" ${dis}></label>` : '<span class="field-hint">The level is off in Details, so no level box here.</span><span></span>'}</div>
        <p class="field-hint" style="margin:0">${d.kind === 'separate' ? (where === 'sheet' ? 'On the answer sheet this box is AMC\'s name field: the part of the scan kept as the student\'s name.' : 'With a separate answer sheet, this box is only written in; AMC reads the answer sheet.') : 'This box is AMC\'s name field: the part of the scan kept as the student\'s name.'}</p>`;
    case 'code':
      return `<div class="form-grid"><label class="field"><span class="field-label">Label above the code</span><input class="input" data-pbb="label" value="${esc(b.label)}" ${dis}><span class="field-hint">Empty for the code alone.</span></label><label class="field"><span class="field-label">Size</span><select class="select" data-pbb="size" ${dis}>${bopt(SIZES, b.size)}</select></label></div><p class="field-hint" style="margin:0">Versions and their codes are set in Versions and page${S.builder.codes ? `: ${esc(S.builder.codes.first)}${S.builder.codes.last !== S.builder.codes.first ? ` to ${esc(S.builder.codes.last)}` : ''}` : ''}.</p>`;
    case 'info':
      return `<div class="field-label">Lines</div>${b.lines.map((l, i) => `<div class="b-item">${typeof l === 'string' ? `<div class="form-grid"><label class="field"><span class="field-label">Detail</span><select class="select" data-pbb="lines.${i}" ${dis}>${bopt(fieldChoices, l)}</select><span class="field-hint">${d.fields[l] ? `${esc(fieldLabel(l))}: ${esc(d.fields[l])}` : 'Empty in Details: the line is left out.'}</span></label></div>`
        : `<div class="form-grid"><label class="field"><span class="field-label">Label</span><input class="input" data-pbb="lines.${i}.label" value="${esc(l.label)}" ${dis}></label><label class="field"><span class="field-label">Value</span><input class="input" data-pbb="lines.${i}.value" value="${esc(l.value)}" ${dis}><span class="field-hint">{level}, {date}… insert a detail.</span></label></div>`}
        ${L ? '' : `<div class="row" style="gap:4px"><button class="btn btn-ghost btn-sm" data-act="pb-list-move" data-list="lines" data-i="${i}" data-d="-1" ${i ? '' : 'disabled'}>${ic('nav-arrow-up')}</button><button class="btn btn-ghost btn-sm" data-act="pb-list-move" data-list="lines" data-i="${i}" data-d="1" ${i < b.lines.length - 1 ? '' : 'disabled'}>${ic('nav-arrow-down')}</button><button class="btn btn-ghost btn-sm" data-act="pb-list-remove" data-list="lines" data-i="${i}">${ic('trash')}</button></div>`}</div>`).join('')}
        ${L || b.lines.length >= 10 ? '' : `<div class="row" style="gap:6px;flex-wrap:wrap"><button class="btn btn-sm" data-act="pb-list-add" data-list="lines" data-kind="field">${ic('plus')} A detail</button><button class="btn btn-sm" data-act="pb-list-add" data-list="lines" data-kind="custom">${ic('plus')} A line of my own</button></div>`}`;
    case 'box':
      return `<div class="form-grid"><label class="field"><span class="field-label">Label</span><input class="input" data-pbb="label" value="${esc(b.label)}" ${dis}></label><label class="field"><span class="field-label">Value</span><input class="input" data-pbb="value" value="${esc(b.value)}" ${dis}><span class="field-hint">{level}, {date}, {exam_name}… insert a detail.</span></label><label class="field"><span class="field-label">Size</span><select class="select" data-pbb="size" ${dis}>${bopt(SIZES, b.size)}</select></label></div>`;
    case 'instructions':
      return `<label class="check"><input type="checkbox" data-pbb="heading" data-type="bool" ${b.heading ? 'checked' : ''} ${dis}><span>Print the heading</span></label><p class="field-hint" style="margin:0">The items, the bullet and the heading text are in the Instructions tab.</p>`;
    case 'text':
      return `<label class="field"><span class="field-label">LaTeX</span><textarea class="input mono" rows="8" data-pbb="latex" ${dis}>${esc(b.latex)}</textarea><span class="field-hint">Anything LaTeX: a notation list, a table of values, a note. Maths between $ signs.</span></label><div class="b-preview q-preview" data-pb-preview="latex"></div>`;
    case 'questions':
      return '<p class="field-hint" style="margin:0">The sections are printed here, in the order of the Sections tab. Rows above this one come before the questions; rows below come after them. Whether each section starts on a new page is set in the Sections tab, under Page breaks.</p>';
    case 'rule':
      return `<label class="field"><span class="field-label">Thickness</span><input class="input" data-pbb="thickness" value="${esc(b.thickness)}" ${dis}></label>`;
    case 'space':
      return `<label class="field"><span class="field-label">Height</span><input class="input" data-pbb="height" value="${esc(b.height)}" ${dis}></label>`;
    case 'pagebreak':
      return '<p class="field-hint" style="margin:0">What follows starts on a new page.</p>';
    case 'end':
      return `<label class="field"><span class="field-label">Text between the rules</span><input class="input" data-pbb="text" value="${esc(b.text)}" ${dis}></label>`;
    case 'rough':
      return `<div class="form-grid"><label class="field"><span class="field-label">Pages</span><input class="input input-num" type="number" min="0" max="10" data-pbb="pages" data-type="int" value="${b.pages}" ${dis}></label><label class="field"><span class="field-label">Heading on each page</span><input class="input" data-pbb="text" value="${esc(b.text)}" ${dis}></label></div>`;
    case 'id_grid': case 'class_grid':
      return `<div class="form-grid"><label class="field"><span class="field-label">Label</span><input class="input" data-pbb="label" value="${esc(b.label)}" ${dis}></label><label class="field"><span class="field-label">Digits</span><select class="select" data-pbb="orientation" ${dis}>${bopt([['v', 'In columns (vertical)'], ['h', 'In rows (horizontal)']], b.orientation)}</select></label></div><p class="field-hint" style="margin:0">${b.type === 'id_grid' ? `${d.student.id_digits} digits, as in Details. AMC reads the grid to match each sheet to the class list.` : (d.student.klass ? `${d.student.class_digits} digits, as in Details.` : 'The class is off in Details: this grid prints nothing until it is on again.')}</p>`;
    case 'signatures':
      return `<div class="field-label">Lines</div>${b.lines.map((l, i) => `<div class="b-item row" style="gap:6px"><input class="input" data-pbb="lines.${i}" value="${esc(l)}" ${dis}>${L ? '' : `<button class="btn btn-ghost btn-sm" data-act="pb-list-remove" data-list="lines" data-i="${i}">${ic('trash')}</button>`}</div>`).join('')}${L || b.lines.length >= 4 ? '' : `<button class="btn btn-sm" data-act="pb-list-add" data-list="lines" data-kind="text">${ic('plus')} A line</button>`}`;
    case 'numeric_answers': case 'choice_answers': case 'all_answers':
      return `<div class="form-grid"><label class="field"><span class="field-label">${b.type === 'numeric_answers' ? 'Grids per line' : 'Columns'}</span><input class="input input-num" type="number" min="1" max="8" data-pbb="columns" data-type="int" value="${b.columns}" ${dis}></label><label class="field"><span class="field-label">Heading</span><input class="input" data-pbb="heading" value="${esc(b.heading)}" ${dis}></label></div><p class="field-hint" style="margin:0">${{ numeric_answers: 'The digit grids of the numeric questions, side by side, each with its question number on top. A grid wider than its share of the line takes the room it needs, and the next ones go to the following line.', choice_answers: 'The boxes of every question that isn\'t numeric.', all_answers: 'The boxes of every question.' }[b.type]}</p>`;
    default: return '';
  }
}

function renderInstructions(L) {
  const d = bdesign();
  const ins = d.instructions;
  const dis = L ? 'disabled' : '';
  const used = d.paper.some((r) => r.cells.some((c) => c.block.type === 'instructions'));
  let html = `${used ? '' : banner('info', 'info-circle', 'No Instructions block on the question paper yet.', 'Add one to a row of the question paper to print these.')}
    <div class="form-grid"><label class="field" style="grid-column:1/-1"><span class="field-label">Heading</span><input class="input" data-pbd="instructions.heading" value="${esc(ins.heading)}" ${dis}></label>
    <label class="field"><span class="field-label">Bullet</span><select class="select" data-pbd="instructions.bullet" ${dis}>${bopt(BULLETS, ins.bullet)}</select></label>
    <label class="check"><input type="checkbox" data-pbd="instructions.rule" data-type="bool" ${ins.rule ? 'checked' : ''} ${dis}><span>A rule after the list</span></label></div>
    <div class="field-label" style="margin-top:12px">Items</div>`;
  ins.items.forEach((it, i) => {
    const moves = L ? '' : `<button class="btn btn-ghost btn-sm" data-act="pb-ins-move" data-i="${i}" data-d="-1" ${i ? '' : 'disabled'} aria-label="Move up">${ic('nav-arrow-up')}</button><button class="btn btn-ghost btn-sm" data-act="pb-ins-move" data-i="${i}" data-d="1" ${i < ins.items.length - 1 ? '' : 'disabled'} aria-label="Move down">${ic('nav-arrow-down')}</button><button class="btn btn-ghost btn-sm" data-act="pb-ins-remove" data-i="${i}" aria-label="Remove">${ic('trash')}</button>`;
    if (it.summary) {
      html += `<div class="b-item b-summary"><div class="row" style="gap:6px"><b>The line per section</b><span class="subtle">made from the sections' counts and marks</span><span class="spacer"></span>${moves}</div>
        ${(S.builder.summary || []).length ? `<ul class="b-summary-lines">${S.builder.summary.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : '<p class="subtle" style="margin:6px 0 0">No section with questions yet.</p>'}</div>`;
    } else {
      html += `<div class="b-item"><div class="row" style="gap:6px"><span class="subtle">Item ${i + 1}</span><span class="spacer"></span>${moves}</div>
        <textarea class="input mono" rows="2" data-pbd="instructions.items.${i}.latex" ${dis}>${esc(it.latex)}</textarea><div class="b-preview q-preview" data-pb-preview="instructions.items.${i}.latex"></div></div>`;
    }
  });
  if (!L) html += `<div class="row" style="gap:6px;flex-wrap:wrap;margin-top:8px"><button class="btn btn-sm" data-act="pb-ins-add">${ic('plus')} An item</button>${ins.items.some((it) => it.summary) ? '' : `<button class="btn btn-sm" data-act="pb-ins-add" data-summary="1">${ic('plus')} The line per section</button>`}</div>`;
  return html;
}

function renderDetails(L) {
  const d = bdesign();
  const dis = L ? 'disabled' : '';
  return `<p class="muted" style="margin:0 0 10px">Typed once, printed wherever a block uses them: the title lines, the exam information, the footer ({level}, {date}…).</p>
    <div class="form-grid">${Object.keys(S.builder.fields).filter((k) => k !== 'level').map((k) => `<label class="field"><span class="field-label">${esc(fieldLabel(k))}</span><input class="input" data-pbd="fields.${k}" value="${esc(d.fields[k])}" ${dis}></label>`).join('')}</div>
    <div class="field-label" style="margin-top:14px">Level and class</div>
    <div class="form-grid">
    <label class="check"><input type="checkbox" data-pbd="student.level" data-type="bool" ${d.student.level ? 'checked' : ''} ${dis}><span>Level<br><span class="subtle">A level box on the student details, {level} in the footer and the title lines. Off: none of them is printed.</span></span></label>
    <label class="field"><span class="field-label">Level</span><input class="input" data-pbd="fields.level" value="${esc(d.fields.level)}" ${d.student.level ? dis : 'disabled'}></label>
    <label class="check"><input type="checkbox" data-pbd="student.klass" data-type="bool" ${d.student.klass ? 'checked' : ''} ${dis}><span>Class<br><span class="subtle">Boxes to write the class in on the student details; on the answer sheet, the class grid AMC reads. Off: neither is printed.</span></span></label>
    <label class="field"><span class="field-label">Class: digits</span><input class="input input-num" type="number" min="1" max="4" data-pbd="student.class_digits" data-type="int" value="${d.student.class_digits}" ${d.student.klass ? dis : 'disabled'}></label></div>
    <div class="field-label" style="margin-top:14px">Registration number</div>
    <div class="form-grid"><label class="field"><span class="field-label">Fixed prefix</span><input class="input" data-pbd="student.id_prefix" value="${esc(d.student.id_prefix)}" ${dis}><span class="field-hint">Printed in grey boxes before the digits, for example MO26. Empty for none.</span></label>
    <label class="field"><span class="field-label">Digits</span><input class="input input-num" type="number" min="1" max="10" data-pbd="student.id_digits" data-type="int" value="${d.student.id_digits}" ${dis}><span class="field-hint">Written in boxes and darkened in the ID grid, so AMC matches sheets to the class list.</span></label></div>
    <div class="field-label" style="margin-top:14px">Boxes for writing</div>
    <div class="form-grid"><label class="field"><span class="field-label">Box width</span><input class="input" data-pbd="student.box_width" value="${esc(d.student.box_width)}" ${dis}><span class="field-hint">One letter or digit per box, in the registration number, the class and the level. 7mm square suits handwriting.</span></label>
    <label class="field"><span class="field-label">Box height</span><input class="input" data-pbd="student.box_height" value="${esc(d.student.box_height)}" ${dis}></label></div>`;
}

function renderPage(L) {
  const d = bdesign();
  const p = d.page;
  const dis = L ? 'disabled' : '';
  const b = S.builder;
  const footer = (prefix, f) => `<div class="form-grid"><label class="field" style="grid-column:1/-1"><span class="field-label">Pattern</span><input class="input" data-pbd="${prefix}.pattern" value="${esc(f.pattern)}" ${dis}><span class="field-hint">{code} the version's code, {page} the page number, {level} {date} {exam_name}… the details. Segments between // whose detail is empty are left out.</span></label>
    <label class="field"><span class="field-label">Alignment</span><select class="select" data-pbd="${prefix}.align" ${dis}>${bopt(ALIGNS, f.align)}</select></label><label class="field"><span class="field-label">Border</span><select class="select" data-pbd="${prefix}.border" ${dis}>${bopt(BORDERS.filter(([v]) => v !== 'default'), f.border)}</select></label>
    <label class="check"><input type="checkbox" data-pbd="${prefix}.mono" data-type="bool" ${f.mono ? 'checked' : ''} ${dis}><span>Typewriter font</span></label></div>`;
  return `<div class="field-label">Kind of paper</div>
    <div class="style-choices" role="radiogroup" aria-label="Kind of paper">
      <button class="choice style-choice" role="radio" aria-checked="${d.kind === 'paper'}" data-act="pb-kind" data-v="paper" ${dis}><span class="choice-icon">${ic('page')}</span><span><span class="choice-title">Answers on the question paper</span><br><span class="subtle">Students tick the boxes next to each question; the name field is on the paper.</span></span></button>
      <button class="choice style-choice" role="radio" aria-checked="${d.kind === 'separate'}" data-act="pb-kind" data-v="separate" ${dis}><span class="choice-icon">${ic('multiple-pages')}</span><span><span class="choice-title">Separate answer sheet (OMR)</span><br><span class="subtle">All the boxes on a sheet designed in the Answer sheet tab.</span></span></button></div>
    <div class="field-label" style="margin-top:14px">Versions</div>
    <div class="form-grid"><label class="field"><span class="field-label">Versions of the paper</span><input class="input input-num" type="number" min="1" max="${b.max_versions || 999}" id="pb-versions" value="${esc(b.versions || '')}" ${b.onecopy ? dis : 'disabled'}><span class="field-hint">Each version draws its own questions from the sections; the app's number of copies follows. Copies are photocopied from the versions: when uploading scans, say that the sheets were photocopied.</span></label>
    <label class="field"><span class="field-label">Paper codes</span><select class="select" data-pbd="codes.style" ${dis}>${bopt(CODE_STYLES, d.codes.style)}</select><span class="field-hint">${b.codes ? `This paper: ${esc(b.codes.first)}${b.codes.last !== b.codes.first ? ` to ${esc(b.codes.last)}` : ''}.` : ''} Printed by the Paper code blocks and {code} in the footer.</span></label>
    ${d.codes.style === 'letters' ? `<label class="check"><input type="checkbox" data-pbd="codes.same_length" data-type="bool" ${d.codes.same_length ? 'checked' : ''} ${dis}><span>Same length for every version<br><span class="subtle">With more than 26 versions, every code has two letters: AA, AB…</span></span></label>` : ''}
    ${d.codes.style === 'numbers' ? `<label class="check"><input type="checkbox" data-pbd="codes.zero_pad" data-type="bool" ${d.codes.zero_pad ? 'checked' : ''} ${dis}><span>Leading zeros: 01, 02…</span></label>` : ''}</div>
    <div class="field-label" style="margin-top:14px">Page</div>
    <div class="form-grid"><label class="field"><span class="field-label">Margins</span><select class="select" data-pbd="page.margins" ${dis}>${bopt(MARGINS, p.margins)}</select></label>
    <label class="field"><span class="field-label">Borders of the boxes</span><select class="select" data-pbd="page.border" ${dis}>${bopt(BORDERS.filter(([v]) => v !== 'default'), p.border)}</select><span class="field-hint">Each block can differ from this.</span></label>
    <label class="field"><span class="field-label">Question numbers</span><select class="select" data-pbd="page.question_style" ${dis}>${bopt(QSTYLES, p.question_style)}</select></label>
    <label class="field"><span class="field-label">Same number of pages in every copy</span><input class="input input-num" type="number" min="0" max="60" data-pbd="page.fill_pages" data-type="int" value="${p.fill_pages}" ${dis}><span class="field-hint">Blank pages are added up to this many; 0 for none. With a separate answer sheet it is then always the last sheet.</span></label>
    <label class="check"><input type="checkbox" data-pbd="page.shuffle_answers" data-type="bool" ${p.shuffle_answers ? 'checked' : ''} ${dis}><span>Shuffle the answers of each question</span></label></div>
    <div class="field-label" style="margin-top:14px">Footer</div>${footer('page.footer', p.footer)}
    ${d.kind === 'separate' ? `<label class="check" style="margin-top:8px"><input type="checkbox" id="pb-sheet-footer" ${p.sheet_footer ? 'checked' : ''} ${dis}><span>A different footer on the answer sheet</span></label>${p.sheet_footer ? footer('page.sheet_footer', p.sheet_footer) : ''}` : ''}`;
}

function renderBStatus(state) {
  const el = $('#d-status'); if (!el) return;
  const f = S.bform;
  if (state === 'error') { el.innerHTML = `${ic('warning-triangle')} Not saved`; return; }
  if (f && (f.saving || f.pending)) { el.textContent = 'Saving…'; return; }
  el.textContent = f && f.lastSaved ? 'Saved' : '';
}

function bAfterRender() {
  document.querySelectorAll('#d-panel [data-pb-preview]').forEach((el) => {
    const src = document.querySelector(`#d-panel [data-pbb="${el.dataset.pbPreview}"], #d-panel [data-pbd="${el.dataset.pbPreview}"]`);
    bPreview(el, src ? src.value : '');
  });
}

function bPreview(el, latex) {
  el.innerHTML = qPreviewHtml(latex).replace('The question as students will read it appears here.', 'The text as students will read it appears here.');
  if (window.renderMathInElement) {
    try { window.renderMathInElement(el, { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '\\[', right: '\\]', display: true }, { left: '$', right: '$', display: false }, { left: '\\(', right: '\\)', display: false }], throwOnError: false }); } catch (e) { /* shown as typed */ }
  }
}

/* Redraw the canvas and the chips only (typing in a field must not pull it away). */
function renderBCanvasOnly() {
  const f = bstate();
  if (f.tab !== 'paper' && f.tab !== 'sheet') return;
  const c = $('#b-canvas'); if (c) c.innerHTML = renderCanvas(f.tab, locked());
  document.querySelectorAll('.b-tabs [data-act="pb-tab"]').forEach((t) => { const chip = t.querySelector('.chip'); if (chip) chip.remove(); if (t.dataset.v === 'paper' || t.dataset.v === 'sheet') t.insertAdjacentHTML('beforeend', bProblemChip(t.dataset.v)); });
}

/* ---------- Changing the design ---------- */

function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i += 1) { const k = /^\d+$/.test(keys[i]) ? +keys[i] : keys[i]; if (o[k] === undefined || o[k] === null) o[k] = /^\d+$/.test(keys[i + 1]) ? [] : {}; o = o[k]; }
  const last = /^\d+$/.test(keys[keys.length - 1]) ? +keys[keys.length - 1] : keys[keys.length - 1];
  o[last] = value;
}

function typed(el) {
  if (el.type === 'checkbox' || el.dataset.type === 'bool') return !!el.checked;
  if (el.dataset.type === 'int') return parseInt(el.value, 10) || 0;
  if (el.tagName === 'SELECT' && /^\d+$/.test(el.value) && el.dataset.pbc === 'width') return +el.value;
  return el.value;
}

/* The selected cell's block, when the panel shows one. */
function selectedCell() {
  const sel = bsel();
  const r = sel.row ? brow(sel.sheet, sel.row) : null;
  const c = r && sel.cell ? bcell(r, sel.cell) : null;
  return { r, c };
}

let bflushTimer = null;
/* Save the whole design: now, or 0.9 s after the last keystroke. */
function bsave(what, { now = false, typing = false } = {}) {
  const f = bstate();
  f.pending = true;
  f.what = what || f.what || 'changed';
  f.typing = typing && (f.typing !== false);
  renderBStatus();
  if (now) { f.typing = false; return flushB(); }
  clearTimeout(bflushTimer); bflushTimer = setTimeout(flushB, 900);
  return Promise.resolve(null);
}
async function flushB() {
  clearTimeout(bflushTimer);
  const f = S.bform;
  if (!f || !S.builder || !bdesign()) return null;
  if (f.saving) { await f.inflight; if (S.bform !== f) return null; }
  if (!f.pending) return null;
  f.inflight = sendB(f);
  return f.inflight;
}
async function sendB(f) {
  f.pending = false; f.saving = true;
  const what = f.what; const typing = f.typing; f.what = ''; f.typing = undefined;
  renderBStatus();
  const project = S.project;
  let r;
  try {
    const resp = await fetch('/ui/api/builder', { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ based_on: S.builder.digest, design: bdesign(), what }) });
    r = await resp.json();
  } catch { r = { error: 'The server couldn\'t be reached, so the change isn\'t saved.' }; }
  f.saving = false;
  if (S.project !== project || !S.builder || S.bform !== f) return r;
  if (!r.ok) {
    toast(r.error || 'Not saved.', 'warning-triangle');
    if (r.conflict || r.locked) loadDesign(); else { f.pending = false; await reloadBuilder(); } // a refused value goes back to the saved one
    renderBStatus('error');
    return r;
  }
  S.builder = { ...S.builder, ...r };
  f.lastSaved = Date.now();
  const inPanel = document.activeElement && $('#d-panel') && $('#d-panel').contains(document.activeElement) && document.activeElement.matches('input, textarea, select');
  if (typing && inPanel) { renderBCanvasOnly(); renderBStatus(); } else renderDesign();
  if (f.pending) { clearTimeout(bflushTimer); bflushTimer = setTimeout(flushB, 200); }
  return r;
}
async function reloadBuilder() {
  const project = S.project;
  try { const r = await getJSON('/ui/api/builder'); if (S.project === project && r.project === project) { S.builder = r; renderDesign(); } } catch { /* shown on the next load */ }
}

function defaultBlock(type) {
  const spec = S.builder.blocks[type];
  return { type, ...JSON.parse(JSON.stringify(spec ? spec.defaults : {})) };
}

function addRow(sheet, presetIndex) {
  const rows = brows(sheet);
  const widths = ROW_PRESETS[presetIndex][1];
  const where = sheet === 'sheet' ? 'sheet' : 'paper';
  const firstType = (i) => {
    if (widths.length === 3 && widths[0] === 'fit' && widths[2] === 'fit') return i === 1 ? 'title' : 'logo';
    if (widths.length === 3 && widths[1] === 'fit') return ['student', 'code', 'info'][i];
    return where === 'sheet' ? 'text' : 'text';
  };
  const row = { id: newId(rows, sheet === 'sheet' ? 's' : 'r'), align: widths.includes('fit') ? 'middle' : 'top', same_height: widths.length > 1 && !widths.includes('fit'), gap: '2mm', after: '3mm',
    cells: widths.map((w, i) => ({ id: `c${i + 1}`, width: w, border: 'default', align: 'left', pad: '2mm', block: defaultBlock(firstType(i)) })) };
  rows.push(row);
  bstate().sel = { sheet, row: row.id, cell: row.cells[0].id };
  bsave('row added', { now: true });
}

function fixedSum(r) { return r.cells.reduce((n, c) => n + (typeof c.width === 'number' ? c.width : 0), 0); }

/* ---------- Drag and drop ---------- */

function bDragStart(e) {
  const handle = e.target.closest && e.target.closest('.b-handle');
  const cell = e.target.closest && e.target.closest('.b-cell');
  if (!S.bform || locked() || !(handle || cell)) return;
  const el = handle || cell;
  S.bform.drag = handle ? { kind: 'row', sheet: el.dataset.sheet, row: el.dataset.row } : { kind: 'cell', sheet: el.dataset.sheet, row: el.dataset.row, cell: el.dataset.cell };
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', 'amc-builder'); } catch (err) { /* older browsers */ }
  (handle ? el.closest('.b-row') : el).classList.add('is-dragging');
}
function bDragOver(e) {
  const d = S.bform && S.bform.drag;
  if (!d) return;
  const target = e.target.closest && (d.kind === 'row' ? e.target.closest('.b-row') : e.target.closest('.b-cell, .b-row'));
  if (!target || target.dataset.sheet !== d.sheet) return;
  e.preventDefault(); e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.b-page .is-over').forEach((x) => { if (x !== target) x.classList.remove('is-over'); });
  target.classList.add('is-over');
}
function bDrop(e) {
  const d = S.bform && S.bform.drag;
  if (!d) return;
  const target = e.target.closest && (d.kind === 'row' ? e.target.closest('.b-row') : e.target.closest('.b-cell, .b-row'));
  document.querySelectorAll('.b-page .is-over, .b-page .is-dragging').forEach((x) => x.classList.remove('is-over', 'is-dragging'));
  S.bform.drag = null;
  if (!target || target.dataset.sheet !== d.sheet) return;
  e.preventDefault();
  const rows = brows(d.sheet);
  if (d.kind === 'row') {
    const from = rows.findIndex((r) => r.id === d.row); const to = rows.findIndex((r) => r.id === target.dataset.row);
    if (from < 0 || to < 0 || from === to) return;
    const [row] = rows.splice(from, 1); rows.splice(to, 0, row);
    bsave('row moved', { now: true });
    return;
  }
  const fromRow = brow(d.sheet, d.row); const toRow = brow(d.sheet, target.dataset.row);
  const cell = bcell(fromRow, d.cell);
  if (!fromRow || !toRow || !cell) return;
  const targetCell = target.classList.contains('b-cell') ? bcell(toRow, target.dataset.cell) : null;
  if (targetCell === cell) return;
  if (toRow !== fromRow && typeof cell.width === 'number' && fixedSum(toRow) + cell.width > 12) { toast(`No room in that row: its columns would add up to ${fixedSum(toRow) + cell.width} of 12.`, 'warning-triangle'); return; }
  fromRow.cells.splice(fromRow.cells.indexOf(cell), 1);
  const at = targetCell ? toRow.cells.indexOf(targetCell) : toRow.cells.length;
  toRow.cells.splice(at, 0, cell);
  if (toRow !== fromRow && toRow.cells.some((c) => c !== cell && c.id === cell.id)) cell.id = newId(toRow.cells.filter((c) => c !== cell), 'c');
  if (!fromRow.cells.length) rows.splice(rows.indexOf(fromRow), 1);
  bstate().sel = { sheet: d.sheet, row: toRow.id, cell: cell.id };
  bsave('block moved', { now: true });
}
function bDragEnd() {
  document.querySelectorAll('.b-page .is-over, .b-page .is-dragging').forEach((x) => x.classList.remove('is-over', 'is-dragging'));
  if (S.bform) S.bform.drag = null;
}
document.addEventListener('dragstart', bDragStart);
document.addEventListener('dragover', bDragOver);
document.addEventListener('drop', bDrop, true);
document.addEventListener('dragend', bDragEnd);

/* ---------- Fields ---------- */

document.addEventListener('input', (e) => {
  const t = e.target;
  if (!S.bform || !bdesign() || !(t.dataset.pbb || t.dataset.pbc || t.dataset.pbr || t.dataset.pbd)) return;
  if (t.tagName === 'SELECT' || t.type === 'checkbox' || t.type === 'number') return; // on change
  bField(t, true);
  const prev = document.querySelector(`#d-panel [data-pb-preview="${t.dataset.pbb || t.dataset.pbd}"]`);
  if (prev) bPreview(prev, t.value);
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (!S.bform || !bdesign()) return;
  if (t.dataset.pbb || t.dataset.pbc || t.dataset.pbr || t.dataset.pbd) {
    if (t.tagName === 'SELECT' || t.type === 'checkbox' || t.type === 'number') bField(t, false);
    return;
  }
  if (t.dataset.pbAddrow !== undefined && t.value !== '') { const i = +t.value; t.value = ''; addRow(t.dataset.pbAddrow, i); }
  if (t.dataset.pbType) {
    const { c } = selectedCell();
    if (c && c.block.type !== t.value) { c.block = defaultBlock(t.value); if (t.value in { title: 1, code: 1, box: 1, end: 1, logo: 1 }) c.align = 'center'; bsave(`block changed to ${blockTitle(t.value)}`, { now: true }); }
  }
  if (t.dataset.pbUpload !== undefined && t.files[0]) { bUpload(t.files[0]); t.value = ''; }
  if (t.id === 'pb-versions') {
    const n = parseInt(t.value, 10);
    if (n >= 1) dop({ op: 'copies', n }, { now: true }).then((r) => { if (r && r.ok) reloadBuilder(); });
  }
  if (t.id === 'pb-sheet-footer') { bdesign().page.sheet_footer = t.checked ? { ...bdesign().page.footer } : null; bsave('answer sheet footer', { now: true }); }
});

function bField(t, typing) {
  const d = bdesign();
  const value = typed(t);
  const label = (t.closest('.field') && t.closest('.field').querySelector('.field-label')) ? t.closest('.field').querySelector('.field-label').textContent : 'setting';
  if (t.dataset.pbd) { setPath(d, t.dataset.pbd, value); bsave(`${label} changed`, { typing }); return; }
  const { r, c } = selectedCell();
  if (t.dataset.pbr && r) { setPath(r, t.dataset.pbr, value); bsave('row settings', { typing }); return; }
  if (!c) return;
  if (t.dataset.pbc) {
    if (t.dataset.pbc === 'width') {
      const w = value === 'auto' || value === 'fit' ? value : +value;
      const others = fixedSum(r) - (typeof c.width === 'number' ? c.width : 0);
      const autos = r.cells.some((x) => x !== c && x.width === 'auto');
      if (typeof w === 'number' && (others + w > 12 || (others + w === 12 && autos))) { toast(others + w > 12 ? `The row's columns would add up to ${others + w} of 12.` : 'The fixed columns would fill 12 of 12, leaving no room for the auto column.', 'warning-triangle'); t.value = String(c.width); return; }
      c.width = w;
    } else setPath(c, t.dataset.pbc, value);
    bsave(`${blockTitle(c.block.type)} column`, { typing });
    return;
  }
  setPath(c.block, t.dataset.pbb, value);
  bsave(`${blockTitle(c.block.type)} changed`, { typing });
}

async function bUpload(file) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(file.name)) { toast('Rename the file first: letters, digits, . _ and - only.', 'warning-triangle'); return; }
  try { await upload('/upload/project', [[file, file.name]]); } catch (err) { toast(err.message, 'warning-triangle'); return; }
  loadFiles();
  const { c } = selectedCell();
  if (c && c.block.type === 'logo') { c.block.file = file.name; if (S.builder.images && !S.builder.images.includes(file.name)) S.builder.images.push(file.name); bsave('logo uploaded', { now: true }); }
}

/* ---------- The new-exam wizard: the builder's options ---------- */

function builderWizardOptions(w, t) {
  if (!w.design || w.design.id !== t.id) {
    w.design = { id: t.id, preset: (t.builder.presets[0] || {}).id || 'rj-olympiad', codes: { style: 'letters', same_length: false }, versions: 4,
      fields: { exam_name: w.name.trim(), organiser: '', level: '', date: fmtIsoDate(w.date), time: '', max_marks: '' }, student: { level: true, klass: true } };
    if (w.design.preset === 'rj-olympiad') { w.design.fields.level = 'I'; w.design.fields.time = '09:30 to 11:30'; w.design.fields.max_marks = '100'; }
    w.style = 'separate'; // the RJ paper has an OMR sheet
  }
  const dz = w.design;
  const kind = (v, title, hint, icon) => `<button class="choice style-choice" role="radio" aria-checked="${w.style === v}" data-act="wiz-style" data-v="${v}"><span class="choice-icon">${ic(icon)}</span><span><span class="choice-title">${title}</span><br><span class="subtle">${hint}</span></span></button>`;
  return `<div class="grid grid-2" style="align-items:start">
    <section class="card"><div class="card-header"><h2>The paper</h2></div><div class="card-body wiz-paper">
      <div class="field-label">Kind of paper</div>
      <div class="style-choices" role="radiogroup" aria-label="Kind of paper">${kind('separate', 'Separate answer sheet (OMR)', 'All the boxes on a sheet of its own, designed in the builder.', 'multiple-pages')}${kind('paper', 'Answers on the question paper', 'Students tick the boxes next to each question.', 'page')}</div>
      <div class="field-label" style="margin-top:14px">Starting layout</div>
      <div class="b-presets" role="radiogroup" aria-label="Starting layout">${t.builder.presets.map((p) => `<button class="choice" role="radio" aria-checked="${dz.preset === p.id}" data-act="pb-wiz-preset" data-v="${esc(p.id)}"><span><span class="choice-title">${esc(p.title)}</span><br><span class="subtle">${esc(p.text)}</span></span></button>`).join('')}</div>
      <div class="form-grid" style="margin-top:14px">${['exam_name', 'organiser', 'level', 'date', 'time', 'max_marks'].map((k) => `<label class="field"><span class="field-label">${esc({ exam_name: 'Exam name', organiser: 'Organiser', level: 'Level', date: 'Date', time: 'Time', max_marks: 'Maximum marks' }[k])}</span><input class="input" data-bw="fields.${k}" value="${esc(dz.fields[k])}"></label>`).join('')}</div>
      <div class="field-label" style="margin-top:14px">More on the paper</div>
      <div class="row" style="gap:16px;flex-wrap:wrap">
        <label class="check"><input type="checkbox" data-bw="student.level" data-type="bool" ${dz.student.level ? 'checked' : ''}><span>Level<br><span class="subtle">A level box on the student details, the level in the footer.</span></span></label>
        <label class="check"><input type="checkbox" data-bw="student.klass" data-type="bool" ${dz.student.klass ? 'checked' : ''}><span>Class<br><span class="subtle">Boxes to write the class in; on the answer sheet, a class grid AMC reads.</span></span></label></div>
      <p class="field-hint" style="margin-top:10px">Everything here can be changed later in Questions › Paper builder.</p>
    </div></section>
    <section class="card"><div class="card-header"><h2>Versions and summary</h2></div><div class="card-body">
      <div class="form-grid"><label class="field"><span class="field-label">Versions of the paper</span><input class="input input-num" type="number" min="1" max="702" data-bw="versions" data-type="int" value="${esc(dz.versions)}"><span class="field-hint">Each version draws its own questions from the sections. Copies are photocopied from the versions; when uploading scans, say that the sheets were photocopied.</span></label>
      <label class="field"><span class="field-label">Paper codes</span><select class="select" data-bw="codes.style">${bopt(CODE_STYLES, dz.codes.style)}</select></label></div>
      <dl class="summary"><dt>Name</dt><dd>${esc(w.name)}</dd>${w.class ? `<dt>Class</dt><dd>${esc(w.class)}</dd>` : ''}${w.subject ? `<dt>Subject</dt><dd>${esc(w.subject)}</dd>` : ''}<dt>Date</dt><dd>${esc(fmtIsoDate(w.date))}</dd><dt>Template</dt><dd>${esc(t.title || t.id)}</dd></dl>
    </div>
    <div class="card-foot"><button class="btn" data-act="wiz-go" data-step="2">${ic('arrow-left')} Back</button><button class="btn btn-primary" data-act="wiz-create" ${S.creating ? 'disabled' : ''}>${ic('plus')} ${S.creating ? 'Creating…' : 'Create exam'}</button></div></section>
  </div>`;
}
document.addEventListener('input', (e) => { const t = e.target; if (t.dataset.bw && S.wizard && S.wizard.design && t.tagName !== 'SELECT') setPath(S.wizard.design, t.dataset.bw, typed(t)); });
document.addEventListener('change', (e) => { const t = e.target; if (t.dataset.bw && S.wizard && S.wizard.design) setPath(S.wizard.design, t.dataset.bw, typed(t)); });

/* ---------- Actions (dispatched by app.js when ACTIONS has no entry) ---------- */

const BUILDER_ACTIONS = {
  'pb-tab': (el) => { const f = bstate(); flushB(); f.tab = el.dataset.v; store.set('btab', f.tab); renderDesign(); },
  'pb-history': () => openHistory('paper.json'),
  'pb-select': (el) => { bstate().sel = { sheet: el.dataset.sheet, row: el.dataset.row, cell: el.dataset.cell }; flushB(); renderDesign(); },
  'pb-row-select': (el) => { bstate().sel = { sheet: el.dataset.sheet, row: el.dataset.row, cell: null }; flushB(); renderDesign(); },
  'pb-unselect': () => { bstate().sel = { sheet: bsel().sheet, row: null, cell: null }; flushB(); renderDesign(); },
  'pb-row-move': (el) => { const rows = brows(el.dataset.sheet); const i = rows.findIndex((r) => r.id === el.dataset.row); const j = i + (+el.dataset.d); if (i < 0 || j < 0 || j >= rows.length) return; const [r] = rows.splice(i, 1); rows.splice(j, 0, r); bsave('row moved', { now: true }); },
  'pb-row-delete': async (el) => {
    const rows = brows(el.dataset.sheet); const r = rows.find((x) => x.id === el.dataset.row); if (!r) return;
    const ok = await confirmDialog({ title: 'Remove this row?', body: `<p>Its ${r.cells.length === 1 ? 'block is' : `${r.cells.length} blocks are`} removed from the ${PAGE_WHAT[el.dataset.sheet]}. The design as it is now stays in History.</p>`, ok: 'Remove', danger: true, icon: 'trash' });
    if (!ok) return;
    rows.splice(rows.indexOf(r), 1); bstate().sel = { sheet: el.dataset.sheet, row: null, cell: null }; bsave('row removed', { now: true });
  },
  'pb-cell-add': (el) => {
    const r = brow(el.dataset.sheet, el.dataset.row); if (!r) return;
    const cell = { id: newId(r.cells, 'c'), width: 'auto', border: 'default', align: 'left', pad: '2mm', block: defaultBlock('text') };
    r.cells.push(cell); bstate().sel = { sheet: el.dataset.sheet, row: r.id, cell: cell.id }; bsave('column added', { now: true });
  },
  'pb-cell-move': (el) => { const { r, c } = selectedCell(); if (!r || !c) return; const i = r.cells.indexOf(c); const j = i + (+el.dataset.d); if (j < 0 || j >= r.cells.length) return; r.cells.splice(i, 1); r.cells.splice(j, 0, c); bsave('block moved', { now: true }); },
  'pb-cell-delete': () => {
    const { r, c } = selectedCell(); if (!r || !c) return;
    const sheet = bsel().sheet; const rows = brows(sheet);
    r.cells.splice(r.cells.indexOf(c), 1);
    if (!r.cells.length) rows.splice(rows.indexOf(r), 1);
    bstate().sel = { sheet, row: r.cells.length ? r.id : null, cell: null }; bsave(`${blockTitle(c.block.type)} removed`, { now: true });
  },
  'pb-list-add': (el) => {
    const { c } = selectedCell(); if (!c) return;
    const list = c.block[el.dataset.list]; if (!list) return;
    if (c.block.type === 'title') list.push(el.dataset.kind === 'field' ? { field: 'exam_name', size: 'large', style: 'plain' } : { text: 'A line', size: 'large', style: 'plain' });
    else if (c.block.type === 'info') list.push(el.dataset.kind === 'field' ? 'date' : { label: 'Label', value: '' });
    else list.push('A line');
    bsave(`${blockTitle(c.block.type)} line added`, { now: true });
  },
  'pb-list-remove': (el) => { const { c } = selectedCell(); if (!c) return; c.block[el.dataset.list].splice(+el.dataset.i, 1); bsave(`${blockTitle(c.block.type)} line removed`, { now: true }); },
  'pb-list-move': (el) => { const { c } = selectedCell(); if (!c) return; const l = c.block[el.dataset.list]; const i = +el.dataset.i; const j = i + (+el.dataset.d); if (j < 0 || j >= l.length) return; const [x] = l.splice(i, 1); l.splice(j, 0, x); bsave(`${blockTitle(c.block.type)} line moved`, { now: true }); },
  'pb-ins-add': (el) => { bdesign().instructions.items.push(el.dataset.summary ? { summary: true } : { latex: '' }); bsave('instruction added', { now: true }); },
  'pb-ins-remove': (el) => { bdesign().instructions.items.splice(+el.dataset.i, 1); bsave('instruction removed', { now: true }); },
  'pb-ins-move': (el) => { const l = bdesign().instructions.items; const i = +el.dataset.i; const j = i + (+el.dataset.d); if (j < 0 || j >= l.length) return; const [x] = l.splice(i, 1); l.splice(j, 0, x); bsave('instruction moved', { now: true }); },
  'pb-kind': (el) => { if (bdesign().kind === el.dataset.v) return; bdesign().kind = el.dataset.v; bsave(el.dataset.v === 'separate' ? 'separate answer sheet' : 'answers on the question paper', { now: true }); },
  'pb-layout': async (el) => {
    let r;
    try { const resp = await fetch('/ui/api/builder/layout', { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify({ action: el.dataset.v }) }); r = await resp.json(); } catch { r = { error: 'The server couldn\'t be reached.' }; }
    if (!r.ok) { toast(r.error || 'Not done.', 'warning-triangle'); return; }
    S.builder = { ...S.builder, ...r }; renderDesign();
    toast(el.dataset.v === 'keep' ? 'The layout file is yours to edit; the builder no longer writes it.' : 'The layout file was written from the design again.');
  },
  'pb-wiz-preset': (el) => { if (S.wizard && S.wizard.design) { S.wizard.design.preset = el.dataset.v; renderMain(true); } },
};
