# New features

What this version adds to the AMC team's web app. How to use each step
is in the in-app Guide (`server/guide/en/`), the launcher's commands in
`./amc help`, and the tests in `tests-ui/README.md`.

## Interface

- **Ten steps.** Before the exam: Questions, Marking scheme, Papers,
  Print. After: Upload scans, Check scans, Mark, Match students, Export
  marks, Annotate. The sidebar shows each step's status; any step opens
  at any time, and every exam and step has its own link.
- **Preview panel** beside the work area: papers, answer keys, scans with
  their boxes, annotated sheets, exported marks, LaTeX logs.
- **Layout check.** Building the papers detects the layout; Print opens
  once the teacher confirms "Looks correct".
- **Printing.** Save print-ready PDFs on any system, or print directly on
  a Linux shared machine (`./amc printer on`).
- **Lock after printing.** Questions, layout and the number of copies
  can't change once printed, and the server refuses such saves. The
  marking scheme, answer key corrections, neutralising a question and the
  final mark stay editable. Unlocking lists what will be lost and asks
  for the exam's name.
- **Marking scheme panel.** Default and per-question scoring, the answer
  key by clicking, neutralising, the final mark; totals come from AMC's
  own scale.
- **Results.** Mark ("Mark anyway" behind a warning), match students
  (automatically, then by hand), export CSV or ODS, annotate (preview one
  student first). A change after marking flags the results out of date.
- **Dashboard and new-exam wizard.** Exam cards with their state and next
  step, search, filters, archive. The wizard's gallery holds AMC's
  templates and our starters, with previews compiled when the image is
  built.
- **Guide and tour.** One page per step, and a first-run tour.
- **Branding.** Admins set the school's name, logo and colours
  (contrast-checked) on the Appearance page; the sign-in page follows.
- Light and dark themes. English only.

## Writing questions

- **Form editor.** Single, multiple and numeric questions as forms, with
  an instant maths preview; add, delete, reorder, change the type. A
  question the form can't read opens in LaTeX.
- **LaTeX view.** A Form | LaTeX switch on every question. Saves are
  checked (balanced braces and environments, unique names) and refused
  with the line. "Check this question" compiles it alone with the exam's
  preamble. Build errors point to the file and line. A whole section can
  be edited as one LaTeX document.
- **Sections** (Questions › Paper design): heading, instructions, how
  many per copy, shuffle, columns, page breaks. "Organise into a section"
  converts a hand-written exam.
- **Items.** New exams keep each question, or set of questions, in
  `items/<name>/item.tex` with its figures; `pools.tex` lists each
  section's items. "Move questions into item files" converts an older
  exam in one version. Exams stay plain LaTeX, so the desktop app builds
  them unchanged.
- **Paper builder** ("RJ Style Paper Builder" in the gallery). The paper
  and the OMR answer sheet are built from rows of blocks on a 12-column
  grid: logo, titles, student details, ID grid, instructions, questions,
  answer areas. Version codes A…Z, AA… or numbers. Presets: RJ Olympiad,
  Simple, Blank. The design is kept in `paper.json`, and
  `paper-layout.tex` is generated from it.
- **Editor extras.** Drag and drop for questions, sections and bank
  items; Duplicate a question; "In the paper" jumps the preview to the
  question's page; "Copies differ" in Papers when a section draws at
  random; the scoring dialog offers the preamble's scoring macros; Save
  as template (New exam › My templates).

## Version history and trash

- **Every save is a version**: one git repository per exam and per bank,
  run by the server; teachers never see git. A save is one version with
  every file it touched.
- **History panel.** Versions grouped into editing sessions; changes in
  words and word by word, side by side; compare any two; who changed each
  line; named versions (printing names one); "Build this version" in a
  scratch folder. Restore the whole exam, one file, or undo one change;
  every restore can be undone.
- **Trash.** Deleted exams and banks stay 30 days with their history.
  Admins can see and restore any teacher's trash.
- **Audit log** of exams and banks created, deleted, restored and
  renamed, exams unlocked and versions restored.
- **Download with history** and **Import an exam** move an exam between
  machines with its versions.
- An old `.history/` folder is converted the first time its exam opens.

## Question banks

- **One instructor's own banks**, organised in groups as an exam is in
  sections (the Question banks page). No school-wide banks.
- **Both ways.** From a bank: a group as a new section or into one,
  selected questions, or a random pick. To a bank: a section as a group,
  selected questions, or the whole exam. The macros and packages a
  question needs come with it. RJ-style LaTeX files can be imported.
- **Copies, not links.** Each copy records where it came from and shows
  its status: Up to date, Bank updated, Edited here, Both changed, Bank's
  newer version set aside, Not in the bank any more. Compare, then take
  the bank's, update the bank's copy, keep this exam's, or combine both.
  A printed exam only takes answer key and scoring fixes.
- **Finding questions.** Full-text search with filters (difficulty, kind,
  tag, not printed lately), usage recorded at printing, archived items
  hidden, the exams that use an item.
- **Moving a bank.** Zip export and import, history included.
- **Statistics** after marking (Mark › How each question did): share
  right, separation, the answers strong and weak students chose; kept
  per bank item across exams.
- **Blueprints** ("3 easy + 5 medium from Algebra") fill a section for
  review before adding.

## Where things are kept

`<projects>` is `MC-Projects/` on a single-user machine and
`MC-Projects/<user>/` on a shared one.

| What | Where |
|---|---|
| Exams | `<projects>/<exam>/`, our record of each in `amcweb.json` |
| Banks | `<projects>/_banks/<bank>/` |
| My templates | `<projects>/_templates/<name>/` |
| History, trash, audit log, search index, usage, statistics | `MC-Projects/_amcweb/<user>/` (`_local` on a single-user machine) |
| Branding | `MC-Projects/_branding/` |

Folders starting with `_` aren't exams, and account names can't start
with `_`, so `_amcweb` is out of every teacher's reach. `./amc backup`
saves all of `MC-Projects`.

## Maintenance

- `./amc doctor` checks every history (`git fsck`), the trash and the
  search index, and changes nothing; `--rebuild-index` builds the index
  again. The search index can always be thrown away: the files are the
  truth.

## Code

| Feature | Server (`server/`) | Browser (`server/static/ui/`) |
|---|---|---|
| Steps, lock, results, branding, templates | `ui.py` | `app.js`, `ui.css`, `app.css` |
| Marking scheme panel, annotation symbols | `ui_scale.py`, `ui_legend.py` | `app.js` |
| Template gallery | `ui_gallery.py` | `app.js` |
| Form editor, sections | `ui_questions.py`, `ui_structure.py` | `app.js` |
| Items, LaTeX checks | `ui_items.py`, `ui_latex.py` | `app.js` |
| Paper builder | `ui_builder.py` | `builder.js` |
| History, trash, audit log | `ui_vcs.py`, `ui_changes.py` | `app.js` |
| Question banks | `ui_banks.py`, `ui_bankapi.py`, `ui_bankcopies.py`, `ui_bankindex.py`, `ui_bankzip.py` | `banks.js` |
| Statistics, blueprints | `ui_stats.py` | `stats.js` |
| Editor extras | `ui.py` | `extras.js` |
| `./amc doctor` | `ui_doctor.py` | |

The AMC team's files are touched only where needed (mostly hooks in
`server/amc.py`), so their updates keep merging. Their old page files
stay in place, unused.

## Not built

- Tablets, other languages, emailing results (#7), a print queue with
  cancel, templates published by admins.
- Paper builder: paper and font size (edit `\documentclass` in LaTeX),
  dragging a column's edge, starting the builder on an exam not made
  with it, saving rows or layouts for reuse.
- By decision: school-wide banks; the form editor and banks for AMC-TXT
  exams.
- Known limits: renaming a bank group doesn't carry over to sections made
  from it; item analysis counts a blank answer as wrong; in Firefox,
  list rows that are buttons can't be dragged (the arrow buttons work).
