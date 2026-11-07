# Questions, question banks and paper templates: plan

Proposal, 6 November 2026. Follows `ui-redesign-plan.md` (phases 0–5, merged).
Covers GitLab issues #4 (form question editor) and #5 (question bank), and
two new requests: keep every earlier version of the sources, and turn the
IITB Mathematics Olympiad paper ("RJ style") into a template whose parts
teachers can switch on and off.

## 1. Summary

Four pieces, built in this order because each one needs the one before:

1. **Source history.** Every change to a source file keeps the previous
   version. A deleted file goes to the history instead of disappearing.
   The version that last built correctly is marked, and any version can be
   restored from the Questions step.
2. **Question editor.** Questions are edited in a form (type, text,
   answers, correct answers, scoring, explanation, figure) instead of in
   LaTeX. The form reads and writes the exam's own LaTeX source with
   targeted edits, as the marking scheme panel already does, so the
   source stays the single truth and the desktop app keeps working.
3. **Paper structure and the RJ template.** An exam is described as
   *sections*: a heading, instructions, a pool of questions, and how many
   of them each copy gets. Sections map to AMC's groups (`\element`,
   `\insertgroup[n]`). The RJ paper becomes a starter made of *blocks*
   (header boxes, instructions page, notation page, sections, rough-work
   pages, OMR sheet...) that a "Paper design" panel toggles, orders and
   fills in. This block builder is the practical form of a
   drag-and-drop paper builder (section 8 says why not a free-form one).
4. **Question banks.** A bank is a folder of questions with tags (topic,
   difficulty, type) and a record of where each was used. Banks are
   filled from the editor, from old exams, or from a LaTeX file such as
   `questionbank/input/level1-2025.tex`. In an exam, a picker chooses
   questions by hand or at random ("5 of the *algebra* questions tagged
   *hard*"), fixed for all copies or different per copy.

## 2. Where we start from

What the code does today (phase 5, merged in !8):

- **Questions step:** the ACE editor on the LaTeX or AMC-TXT source, a
  file selector, "Add a file", save (Ctrl+S) and "Build preview". No
  form, no history: a save replaces the file, and deleting a file is
  final (`project-delete-file`).
- **Marking scheme panel:** `server/ui_scale.py` already parses the
  sources. For each `\begin{question}`/`questionmult` it knows the id,
  file, line, span, the answers (`\correctchoice`/`\wrongchoice` with
  their text and position) and the question's `\scoring{}`. Edits are
  position-based replacements (`set_correct`, `set_scoring`) that leave
  everything else untouched. Questions it can't read (macros, numeric
  questions, `\AMCOpen`) are shown read-only with "Edit in Questions".
  The form editor extends this parser; it doesn't need a new one.
- **Lock:** `write_refusal()` compares old and new sources
  (`same_layout`) and refuses anything but scoring and answer-key changes
  once the exam is printed. Everything below writes through the same
  check.
- **Starters:** `server/school_templates/` with marker lines
  (`%%AMCUI:SCHOOL%%`, `%%AMCUI:IDENTITY%%`, `%%AMCUI:OPTIONS%%`) that
  the server fills in at creation (`gallery.starter_source()`). The
  gallery compiles each template at image build time.
- **Exam record:** `amcweb.json` in the exam folder (lock, layout check,
  meta, activity, scale and marks fingerprints, neutralised questions).

What AMC gives us:

- **Groups (LaTeX):** `\element{G}{...}` adds a question to pool *G*;
  `\shufflegroup{G}` shuffles it per copy; `\insertgroup[n]{G}` inserts
  the first *n* (all when omitted); `\setgroupmode{G}{withoutreplacement}`
  makes successive `\insertgroup[n]` calls take different questions;
  `\copygroup`, `\cleargroup`. Different copies can hold different
  questions, and the marks panel already handles differing totals.
- **AMC-TXT** has groups (`*( ... *)`, `[group=...]`) and
  `IncludeFile:`, but no "n of this group". The form editor and the
  banks therefore target LaTeX exams. AMC-TXT exams keep the text editor
  (the marking panel keeps working for them as today).
- **Numeric questions:** `\begin{questionmultx}` with
  `\AMCnumericChoices{value}{digits=3,...}`. Not read by the parser yet;
  the RJ paper has a whole section of them.

The RJ paper (`mo-2025-level-1`, read from Dropbox; the question files
there are online-only placeholders, one was fetched):

| File | Holds |
|---|---|
| `amc-preamble.tex` | explanation environment shown only in the answer key, footer `Level I // Code A // Page n`, question numbering `Q-1〉`, box style, geometry, `\bbox`, paper code letter A–D from the copy number, true/false shortcuts |
| `paper-template.tex` | header box of the question paper (name, reg. no boxes, code, level, date/marks/time box), header of the OMR sheet (name field, signatures), instructions page (rules per section, with marks), notation page, table of values, OMR instructions with a 5-digit roll grid |
| main file | packages, `\scoringDefaultS/M` from `\scqmarks`, `\penaltyscore`..., date/time/level, `\onecopy{4}` = four paper codes A–D, three sections with `\shufflegroup` + `\insertgroup[15/5/6]`, rough-work pages, `\AMCaddpagesto{10}`, separate OMR with class grid, 3-digit roll grid, numeric answers in 6 columns (`\AMCformFilter{\AMCifcategory{numeric}}`), MCQ boxes in 3 columns |
| `questionbank/input/*.tex` | `\element{sectionI}{\begin{question}{q01}\scoring{\scoringDefaultS} ... \end{question}}` blocks, one file per paper or topic; figures as PNG next to them |

It needs `fontawesome5` (icons), which the image doesn't have; everything
else it uses is installed (dashbox, tcolorbox, xstring, totcount, fp,
lastpage, enumitem, mathtools, tikz).

## 3. Decisions proposed

| Topic | Proposal |
|---|---|
| Source of truth | The exam's LaTeX files. The form, the structure panel and the bank picker write targeted edits into them; nothing is kept only in a database. Hand-written LaTeX keeps working, and so does the desktop app. |
| Formats | Form editor, structure panel and banks: LaTeX exams. AMC-TXT exams keep the text editor. |
| Unreadable LaTeX | Shown read-only in the form with "Edit in LaTeX", as the marking panel does. Never rewritten. |
| History | Inside the exam folder (`.history/`), so it follows rename, copy, delete and backup. Kept 7 days; a file that hasn't changed for longer keeps its last 12 versions; never more than 100 per file. |
| Banks | Personal first (`MC-Projects/<user>/_banks/`). Shared school banks, published by admins, a later step. |
| Bank format | One LaTeX file per question plus `bank.json` (tags, usage), rebuilt from the files if lost. Readable with any editor, diffable, matches how the RJ files are kept. |
| Builder | Blocks that are toggled, ordered and filled in, with the PDF preview, not a free-form canvas (section 8). |
| Where it lives | Questions step gets tabs: **Questions**, **Paper design**, **LaTeX**, **History**. Banks get a page of their own, "Question banks", next to Exams. |
| Icons in the RJ starter | `pifont` symbols by default; FontAwesome icons when the image has `fontawesome5` (`texmf-dist-fontsextra`, large). |

## 4. Source history

One write path for every change to a source file: the editor's save, the
form, the marking panel, the default scoring, "Add a file" over an
existing file, the structure panel, the bank picker, restore.

```
write_source(pdir, filename, new_text, by, what, based_on=None)
  1. lock check (write_refusal) as today
  2. based_on: digest of the text the browser edited; refused with
     "changed meanwhile" when the file differs (two tabs, two teachers)
  3. copy the current file to .history/<file>/<utc time>--<user>.tex
     with a sidecar .json: what, by, size, built (unknown yet)
  4. write via .tmp + os.replace (as now)
  5. activity entry (as now)
```

- **Deleting** a source file moves it into the history with
  `what: deleted` instead of unlinking it. The main source
  (`texsrc`) can't be deleted while it is the main source.
- **Built OK:** after a successful build of the question paper, the
  server marks the history entry matching the built digest as
  `built: true`. "Restore the last version that built" is one click.
- **Retention:** the last 7 days; a file that hasn't changed for longer
  keeps its last 12 versions whatever their age; never more than 100
  versions of a file (a week of marking-panel clicks). Pruned after each
  write. Sizes are small (sources are text).
- **Restore** is itself a write through the same path, so the version
  being replaced is kept too. On a printed exam, restoring goes through
  the lock: only scoring and answer-key differences pass.
- **History tab** in Questions: a list per file (time, who, what,
  "built OK" badge, size), a line diff against the current file in the
  browser, Restore, Download. The exam's downloadable zip excludes
  `.history/`; `./amc backup` includes it.
- **Drafts:** the LaTeX editor keeps its unsaved text in the browser
  (localStorage, per exam and file) and offers it back after a crash or
  an accidental close. Cheap, and it completes the "never lose work"
  story; it is not a server-side feature.

How it was built (phase 6):
- `server/ui_source.py` keeps the versions: `write_source()` (with the
  `based_on` check), `delete_source()`, `versions()`, `restore()`,
  `mark_built()`, `prune()`. Each version is `<id>.<ext>` plus
  `<id>.json` (when, who, how, size, digest, built, deleted) under
  `.history/<file>/`; `current.json` records how the file as it is now
  was made, so its entry says "Saved in the editor", "Answer key changed:
  q3", "Created from the template…" rather than only a time. A file
  changed by something else (the desktop app, a copy) shows "Changed
  outside the app".
- Every writer in `ui.py` (editor save, marking panel, default scoring,
  restore) and upstream's `/upload`, `/fs` and `project-delete-file`
  handlers (one line each) go through `ui.save_source()`,
  `ui.store_upload()` and `ui.delete_file()`. After the question paper
  builds, `ui.note_built()` records the digests in the exam record
  (`built_sources`) and marks matching versions.
- The editor loads and saves through `/ui/api/source` (text + digest,
  JSON). A conflict offers "Keep my version" (theirs stays in History)
  or "Load their version" (mine becomes the browser draft).
- History lives in the preview panel: the versions of the open file (or
  of any file with a history, deleted ones included), a line diff against
  the file now (longest common subsequence, unchanged runs folded),
  Download and Restore. Restoring while the editor has unsaved changes
  is refused.
- Retention: the last 7 days, at least the last 12 versions, at most
  100 (`KEEP_DAYS`, `KEEP_AT_LEAST`, `MAX_VERSIONS` in `ui_source.py`),
  pruned after each write; the newest version that built and the version of a
  deleted file are always kept. The exam zip (`send_dir_as_zip`) leaves
  `.history/` out; `./amc backup` keeps it.
- Not done: history for files in subfolders (`\input{sub/file}`), and a
  History tab of its own (the tab bar comes with the editor, phase 7).

## 5. Question editor (#4)

```
┌ 1 · Questions   [Questions] [Paper design] [LaTeX] [History]   Build preview  Save ┐
│ ┌ Questions ────────────────┐ ┌ q04 · Single answer ───────────────────────────┐ │
│ │ Section 1 · 15 per copy   │ │ Type  (•) Single  ( ) Multiple  ( ) Numeric     │ │
│ │ ⋮ q01  Coefficient of…  ✓ │ │ Id    [q04]                                    │ │
│ │ ⋮ q02  Sum of primes…   ✓ │ │ Question                                       │ │
│ │ ⋮ q03  Functional equ…  ✓ │ │ ┌────────────────────────────────────────────┐ │ │
│ │ ⋮ q04  Two cubic poly…  ● │ │ │ Assume that $f(x)=x^3+ax^2+2bx+c$ ...     │ │ │
│ │ ⋮ q05  Integers a>b>c…  ✓ │ │ └────────────────────────────────────────────┘ │ │
│ │ + Add a question          │ │   Preview: Assume that f(x) = x³ + ax² + …    │ │
│ │ + From a question bank…   │ │ Answers                     correct            │ │
│ │ Section 2 · 5 per copy    │ │ ⋮ [I is correct, II is correct.      ]  ( )    │ │
│ │ ⋮ q1   …                  │ │ ⋮ [I is correct, II is incorrect.    ]  (•)    │ │
│ │ Section 3 · Numeric       │ │ ⋮ [I is incorrect, II is correct.    ]  ( )    │ │
│ │ ⋮ nq1  Right triangle…    │ │ + Add an answer     Layout: [horizontal ▾]     │ │
│ │ ⋮ nq2  Smallest integer…  │ │ Scoring  Section default (+3 / −0.75)  Change… │ │
│ └───────────────────────────┘ │ Explanation (answer key only)  [ … ]           │ │
│                               │ Figure  [Upload…]                               │ │
│                               │                     Delete question   Duplicate │ │
│                               └─────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────────────┘
```

- **What the form reads and writes** (extending `ui_scale.read_latex`):
  the question text span (between the opening and the first choices
  environment, minus `\scoring`), each answer's text span, the choices
  environment kind (`choices`, `choiceshoriz`, `choicescustom`), the
  `\explain{...}` block, an `\includegraphics{...}` in the text, numeric
  questions (`questionmultx` + `\AMCnumericChoices{value}{options}`:
  value, digits, decimals, sign), and the `\element{G}{...}` wrapper
  (section 6). Everything is a span in the file; a change replaces its
  span and nothing else. Teachers' own macros in the text (`\N`, `\Z`)
  are kept as typed.
- **Adding** a question writes a fresh block after the last question of
  the same section (or before `\onecopy` for an exam without sections).
  **Deleting** removes the block (the history keeps it). **Reordering**
  (drag in the list) moves whole blocks within a section. **Changing the
  type** rewrites the environment names and, for numeric, the choices.
  Ids are checked for uniqueness across the exam; new ones are proposed
  (`q16`, `nq7`).
- **Saving:** changes are collected in the browser and saved when the
  teacher clicks Save, presses Ctrl+S, or leaves the question (debounced
  1.5 s), always with `based_on`. A dirty dot and "Unsaved changes" as in
  the LaTeX tab. Switching tabs saves first.
- **Preview:** two levels. Instant, in the browser: the question and
  answers rendered with maths (KaTeX, vendored like our other
  libraries, no build step), good enough to catch typos. Real: "Build
  preview" compiles the question paper as today; the preview panel jumps
  to the page holding the selected question (AMC's layout gives the page
  of each question once built).
- **Unreadable question:** the row shows a short reason ("uses a macro",
  "two \scoring commands") and "Edit in LaTeX", which opens the LaTeX
  tab at that line.
- **After printing:** type, text, answers' text, layout, figure and
  explanation are read-only (they move boxes or change the paper);
  correct answers and scoring stay editable, exactly as the marking
  panel does now (`same_layout`). A banner says so.
- **Scoring rules written as macros** (`\scoring{\scoringDefaultS}` in
  the RJ files): accepted as "a macro of this exam" and shown as such;
  the rule editor offers the presets and the macro names found in the
  preamble.

How it was built (phase 7):
- `ui_scale.read_latex()` now records, for each question, every span the
  form edits: the block (with its `\element{}{}` wrapper and group), the
  text, the choices environment and each answer, a numeric answer
  (`questionmultx` + `\AMCnumericChoices`), the explanation, a figure
  and the question's `\scoring`. The marking panel reads the same data.
- `server/ui_questions.py` applies edits as operations (text,
  answer_text, answer_correct, answer_add/remove/move, numeric, explain,
  type, scoring, rename, add, delete, move), re-parsing after each so
  positions stay right. Added questions go after the selected one, in
  its `\element` group; a first question goes after AMC's
  `%%% end of the header` line.
- `/ui/api/editor` (GET) gives the questions of every LaTeX source file
  in file order; POST takes a file, the digest it was read at and a list
  of operations, writes through the history (`save_source()`) and
  returns the file's questions again. Operations that would move things
  on a printed paper are refused by the lock; the answer key and scoring
  pass.
- The browser keeps edits as operations, coalesces typing, sends them
  0.9 s after the last keystroke (at once for structural changes), one
  request at a time, and shows "Saving… / Saved". The list on the left
  groups questions by file and `\element` group; the form on the right
  edits the selected one. The maths preview uses KaTeX (vendored in
  `server/static/ui/katex/`, with the auto-render extension); common
  commands (`\textbf`, `\emph`, `\\`, blank lines, `\includegraphics`)
  are shown, the rest as typed.
- "Edit in LaTeX" opens the LaTeX tab at the question's line; the tab
  choice is remembered per browser. AMC-TXT exams keep the LaTeX tab only.
- Scoring rules written as macros are accepted (`\scoring{\scoringDefaultS}`)
  but the rule dialog offers presets and plain rules only.
- Not done: drag-and-drop ordering (Move up/down buttons instead),
  jumping to a question's page in the preview, the marking panel reading
  the form's model directly (it still parses the source itself).

## 6. Paper structure: sections

The one model that the editor, the Paper design panel, the RJ template
and the bank picker share. A **section** is:

| Field | In LaTeX |
|---|---|
| name (group id) | `\element{sectionI}{...}` around each question, written before `\onecopy` |
| heading and instructions | plain LaTeX between markers in the body: `%%AMCUI:SECTION sectionI%%` ... `%%AMCUI:END%%` |
| how many per copy | `\insertgroup[15]{sectionI}`, or `\insertgroup{sectionI}` for all |
| shuffle per copy | `\shufflegroup{sectionI}` present or not |
| columns | `\begin{multicols}{2}` around the insert, or none |
| default scoring | `\scoring{\scoringDefaultS}` on each question, or a section macro `\def\sectionImarks{...}` |

- The structure panel reads this from the source. An exam written by
  hand without markers shows one implicit section ("All questions, in
  order") and the panel can convert it: wrap each question in
  `\element{main}{...}`, add markers and `\insertgroup{main}`. The teacher
  sees the diff in History if they want to.
- Sections are listed in the Questions tab (left column) and edited in
  Paper design: add, rename, reorder (drag), set the count, shuffle,
  columns, heading and instructions. "15 of 18" shows the pool size
  against the count per copy, and warns when the pool is smaller.
- The instructions page of the RJ template is **generated** from the
  sections when the block "Instructions page" is on: the sentence per
  section ("15 objective questions, +3 marks, −0.75 for a wrong
  answer") is filled from the count and the scoring, and stays editable
  text afterwards.
- Variable papers: when any section has a count below its pool or
  shuffle on, copies differ. The Papers step already builds the
  catalogue (every question) and the marks panel shows totals per copy.

## 7. Question banks (#5)

```
┌ Question banks ─────────────────────────────────────────── [+ New bank] [Import…] ┐
│ Olympiad algebra (42)  ·  Olympiad geometry (31)  ·  Calculus MCQ (120)  ·  …     │
├───────────────────────────────────────────────────────────────────────────────────┤
│ Olympiad algebra   [search…]  Topic [any ▾] Difficulty [any ▾] Type [any ▾]       │
│ [ ] Not used since [2025 ▾]                                   24 shown · 3 chosen │
│ ☐ alg-017  Coefficient of x^2025 in …   single  hard   polynomials  used: L1 2025 │
│ ☑ alg-018  Sum of primes p dividing …   single  medium functions    never used    │
│ ☐ alg-019  f(x)+3f(1−x)=…               single  easy   functional   used: L2 2024 │
│ …                                                              [Edit] [Tags] [⋯]  │
└───────────────────────────────────────────────────────────────────────────────────┘
```

**Storage.** `MC-Projects/<user>/_banks/<bank>/` (single-user mode:
`MC-Projects/_banks/`). Upstream already skips `_` folders when listing
exams, and account names can't start with `_`.

```
_banks/olympiad-algebra/
  bank.json          name, description, created, questions: {id: {tags, type,
                     added, from, used: [{exam, date}]}}
  questions/alg-017.tex   one \begin{question}...\end{question} (no \element)
  figures/alg-017-1.png
  macros.tex         macros the questions rely on (\N, \Z, \answeristrue)
```

A question file is plain AMC LaTeX, so a teacher can also drop files in
by hand; `bank.json` is rebuilt from the files when it is missing or
stale (tags default to none).

**Filling a bank.**

- **From the editor:** tick questions in the Questions tab, "Save to a
  bank…", choose the bank and tags. Figures they use are copied along.
- **From an old exam:** in the bank page, "Import from an exam" lists
  the teacher's exams (archived too); the questions are parsed with the
  same parser, shown with a checkbox each, and the exam's `\element`
  group names become tags. Usage is recorded (`used: exam, date`).
- **From a LaTeX file:** upload `level1-2025.tex` style files; same
  parsing, same tags from groups. The RJ bank imports in one go.
- **Written in the bank:** the question form from section 5, reused as
  is (it edits a one-question file instead of a span in the exam).
- **Macros:** when an imported question uses commands that are not
  AMC's or LaTeX's and are defined in the exam's preamble, the
  definitions are copied into the bank's `macros.tex` and the question
  is tagged "needs macros". When such a question is inserted into an
  exam that lacks the definition, the picker offers to add it to the
  exam's preamble.

**Using a bank in an exam** ("From a question bank…" in the Questions
tab, inside a section):

1. Choose banks and filter (tags, type, search, "not used since").
2. Pick questions by hand, or "Add n at random from the shown ones".
3. Choose how:
   - **Fixed:** the chosen questions are copied into the section's pool
     and the section inserts all of them. Every copy gets them.
   - **Different per copy:** the chosen questions (or a whole tag) are
     copied into the pool, the section gets `\shufflegroup` and
     `\insertgroup[n]`. Each copy gets n of them.
4. The copied blocks carry a comment `% amcui:bank olympiad-algebra/alg-018`,
   so the editor can show where a question came from, offer "Update the
   bank's copy" after an edit, and so usage can be recomputed from the
   exams themselves if `bank.json` is lost. Ids are renamed on conflict
   (`alg-018` stays when free).
5. Usage is written to `bank.json` when the exam's papers are built,
   not at insertion, so a question dropped before printing doesn't count
   as used.

**Sharing (later).** A `MC-Projects/_banks/` folder readable by every
teacher and written by admins: "Publish to the school" on a personal
bank. Landlock is no obstacle: banks are read by the server and copied
into the exam folder; the sandboxed LaTeX run never touches them.

## 8. RJ template and the Paper design panel

**The starter** (`server/school_templates/olympiad/`): the RJ files
reorganised into one `exam.tex` plus `amc-preamble.tex` and
`paper-template.tex`, where every optional part is a **block** between
markers:

```
%%AMCUI:BLOCK header-boxes title="Header boxes" default=on%%
\questionpaperheader
\studentboxwithoutnamefield
%%AMCUI:END%%
```

Blocks of the RJ paper, each with its parameters:

| Block | Parameters |
|---|---|
| Title lines | exam name, organiser, second logo (the school logo comes from Appearance) |
| Header boxes | name line, registration prefix and digits, paper code box, level box, date / time / maximum marks |
| Instructions page | generated from the sections (section 6), editable afterwards; "do not open", "leave the hall" sentences on/off |
| Notation page | on/off, editable list |
| Table of values | on/off, editable rows |
| Sections | from the structure panel |
| Rough-work pages | how many |
| Fill to n pages | `\AMCaddpagesto{n}` |
| OMR sheet | header with signatures; class grid (digits), roll-number grid (digits); numeric answers (columns); MCQ boxes (columns); instructions text |
| Footer | `Level I // Code A // Page n` pattern |
| Paper codes | number of versions A–D (`\onecopy{4}`), and the wizard then says "copies = versions; use the *photocopied sheets* option when uploading scans" |

The wizard shows the starter in the gallery with the compiled preview
like any other. Its Options step shows the blocks with their defaults.
After creation, **Paper design** (a tab in Questions) keeps the same
list: toggle a block, drag to reorder where the paper allows it (the
OMR sheet stays last), edit parameters in a form, and "Build preview"
shows the result. The server regenerates only the marked regions; text a
teacher typed inside a block is kept until the block is removed, and the
history keeps everything anyway.

**Why blocks and not a free-form canvas.** A paper is LaTeX that AMC
must be able to lay out, number and read back from scans: boxes,
corner marks and the name field are positioned by LaTeX's flow, not by
coordinates. A canvas where parts are dragged to pixel positions would
have to be translated back into that flow, would break on the first
hand edit, and would still produce a paper that looks exactly like what
the blocks produce. Drag-and-drop is kept where it is natural: ordering
blocks, sections and questions, and dropping bank questions into a
section. A teacher who wants something the blocks don't offer edits the
block's LaTeX in the LaTeX tab, and the block keeps working.

**Compiling in the image.** `fontawesome5` isn't installed. The starter
uses `pifont` symbols (`\ding`) for the bullets and header icons, and
`\IfFileExists{fontawesome5.sty}` switches to the icons when the image
is built with `TEXLIVE_PKGS=texmf-dist-fontsextra` (the Dockerfile
already has that build argument). The gallery build fails if a starter
doesn't compile, so the starter is tested on every image build.

## 9. Technical approach

Same rules as before: new code in new files, upstream files touched in
one line each, no build step, libraries vendored, every write through
the lock.

- `server/ui_source.py` (new): `write_source()`, history (copy, prune,
  mark built, list, restore, deleted files), drafts are browser-only.
  `amc.py`'s save and delete handlers call it (two lines).
- `server/ui_scale.py` (extend): text and answer spans, choices kind,
  explanation, figure, numeric questions, `\element` wrapper, sections
  from markers; `apply_edits()` for add / delete / move / retype.
- `server/ui_structure.py` (new): sections model, markers, conversion of
  an unstructured exam, block regeneration for starters.
- `server/ui_bank.py` (new): bank folders, `bank.json`, import from exam
  and file, usage, picker queries, insertion.
- `server/school_templates/olympiad/`: the RJ starter with blocks;
  `README.md` documents the block markers next to the existing ones.
- Browser: `server/static/ui/app.js` gets the tabs, the question list and
  form, the structure and Paper design panels, the History tab, the
  banks page and picker; `katex` vendored under `server/static/ui/vendor/`.
- Routes and events (JSON, `ui-` prefix as before): `/ui/api/source/<file>`
  (text + digest), `ui-source-write`, `/ui/api/history`, `ui-history-restore`,
  `/ui/api/structure`, `ui-structure-edit`, `ui-questions-edit` (batched
  edits with `based_on`), `/ui/api/banks`, `ui-bank-*`, `/ui/api/blocks`,
  `ui-blocks-edit`.
- Tests: `tests-ui/test_ui_logic.py` for the parser, edits, history
  pruning and bank indexing (fast, in the image); `tests-ui/e2e-questions.mjs`
  (form edit, add, reorder, numeric, read-only after printing, restore)
  and `e2e-banks.mjs` (import from exam, pick fixed and per copy, build,
  totals per copy). The RJ starter is covered by the gallery build.

## 10. Phases

Each phase one branch and one merge request, as before.

| Phase | Delivers | Issues | Size |
|---|---|---|---|
| **6 Source history** | `write_source()` with history, "changed meanwhile" check, deleted files kept, built-OK marker, History tab with diff and restore, editor drafts in the browser, main source undeletable | new | M |
| **7 Question editor** | Parser extension (spans, numeric, explanation, figure, macro rules), question list and form with instant maths preview, add / delete / reorder / retype, read-only after printing, "Edit in LaTeX" at the line | #4 | L |
| **8 Structure and RJ template** | Sections model and panel, conversion of unstructured exams, generated instructions, the olympiad starter with blocks, Paper design tab, second logo, `pifont`/FontAwesome switch | new | L |
| **9 Question banks** | Bank folders and page, import from editor, exams and files, tags and search, picker with fixed and per-copy insertion, usage, "Update the bank's copy" | #5 | L |
| later | Shared school banks published by admins; "save an exam as a template" (from the earlier plan); AMC-TXT support if wanted | | |

Phase 6 is small and removes the risk the team raised (losing a source)
before the editors start writing files on their own. Phases 7 and 8 can
be built in parallel by two people once 6 is merged; 9 needs both.

## 11. Risks

| Risk | Mitigation |
|---|---|
| Teachers' LaTeX varies; the form can't read some questions | Read-only with "Edit in LaTeX", never rewritten; the parser is extended for AMC's standard forms only |
| Two tabs or two teachers edit the same file | `based_on` digest; the loser is told to reload, and the history has both versions |
| Markers in the source are edited or removed by hand | The panel falls back to the implicit "all questions" section; a block with a broken marker is shown as "custom LaTeX" and left alone |
| The RJ starter needs packages the image lacks | Only `fontawesome5`, handled by `pifont` and the optional build argument; the gallery build catches regressions |
| Banks grow large (hundreds of questions with figures) | One file per question, `bank.json` as index; listing never parses every file |
| Variable papers confuse marking | Already handled by AMC (catalogue, per-copy totals); the Papers step says "copies differ" when a section is random |

## 12. To decide

1. Personal banks first, shared ones later, as proposed?
2. Form editor and banks for LaTeX exams only (AMC-TXT keeps the text
   editor)?
3. History: 7 days, at least the last 12 versions and at most 100 per
   file (decided 7 Nov), inside the exam folder, excluded from the
   downloadable zip?
4. Blocks rather than a free-form canvas for the paper builder?
5. Build the image with `texmf-dist-fontsextra` for the icons, or accept
   the `pifont` look?
6. Order: 6 → 7 → 8 → 9, or banks (9) before the RJ template (8)?
