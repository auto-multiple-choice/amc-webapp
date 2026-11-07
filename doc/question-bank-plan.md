# Question bank, modular questions and version history: plan

Proposal of 7 November 2026, with the decisions taken the same day
(section 11). Covers GitLab issues #5 (question bank) and #15 (restoring
a Paper builder version wiped the design). Replaces section 7 of
`questions-banks-templates-plan.md` (the first bank sketch) and builds on
its section 4 (source history, phase 6) and section 6 (sections,
phase 8).

## 1. Summary

1. **One unit of reuse: the item.** An item is what goes in one AMC
   `\element`: a single question, or a set of questions that share a text
   or a figure and stay together. Each item has a permanent id and its own
   folder, `items/<name>/item.tex`, with its figures. The exam pulls it in
   with `\element{sectionI}{\amcuiItem{alg-017}}`. Tested in the image:
   AMC builds, shuffles and draws such items exactly like inline questions.
2. **Each instructor keeps their own banks; there are no school banks.**
   A bank is organised in groups of items, as an exam is organised in
   sections. Questions move both ways: from a bank into an exam, a whole
   group or selected questions of a group; from an exam into a bank, a
   whole section or selected questions. A moved item is a copy with a
   record of where it came from, so each side can tell when the other has
   changed and offer to update.
3. **LaTeX for those who want it.** Every item and section has a
   Form / LaTeX switch. The LaTeX view edits exactly that item's file. A
   whole section can be opened as one LaTeX document and is split back
   into items on save. Compile errors point to the item's file and line.
4. **Real version control, built on git.** One git repository per exam
   and per bank, run by the server; teachers see "versions", never git
   commands. Each save is one change set covering every file it touched
   (the builder's `paper.json` and `paper-layout.tex` together), kept
   forever. History shows who changed what, a summary in words
   ("alg-017: answer C made correct"), word-level diffs, any two versions
   compared, named versions ("Printed 12 Nov"), a preview of a version
   before restoring it, and restore of the whole exam, one file, or one
   change. Git is already in the image.
5. **Deleting loses nothing.** A deleted exam goes to a Trash for 30
   days, its history is kept outside the exam folder, and destructive
   actions go to an audit log. This is what would have saved the design
   in #15.
6. **Order:** P0 history and trash (fixes #15) → P1 items in exams and
   the LaTeX panels → P2 question banks → P3 item analysis (#6) and
   blueprints.

## 2. What was checked (7 November 2026)

| Question | Finding |
|---|---|
| Does AMC accept a question kept in its own file inside `\element`? | Yes. A test exam in the `amc-web` image: `\element{sectionI}{\amcuiItem{…}}`, where the macro sets `\graphicspath` and `\input`s `items/<name>/item.tex`, with `\shufflegroup`, `\insertgroup[2]` and 4 copies. It built with no error and layout detection worked. Each copy got two different elements. A two-question set stayed together and counted as one element. `\verb` inside an item file works (the file is read when the group is inserted, not when `\element` is read). A figure in the item's folder was found. |
| Is git available? | Yes, git 2.54 is in the image (the Dockerfile installs it to fetch AMC; the image is single-stage, so it stays). Python 3.14.10 has `uuid.uuid7()`. Its SQLite (3.53) has FTS5 full-text search. |
| Can a paper's LaTeX write into a history folder? | No. TeX runs with `openout_any=p`: it refuses to write dot-files or anything outside the exam folder. |
| Can a teacher write into a dot-folder of an exam? | Yes. `/fs/<path>` (POST) accepts any path inside the teacher's own folder, dot-folders included, and archive import unpacks whatever the archive holds. A git repository must therefore **not** live in a teacher's folder: a planted `config` can make git run commands (filter and textconv drivers) as the server, which can read every teacher's exams. Repositories go in `MC-Projects/_amcweb/`, outside every teacher's folder (6.1). |
| What can the LaTeX sandbox reach? | landrun gives read-write to the teacher's own projects folder (`--rw projects_dir()`); TeX itself only writes inside the exam folder. |
| Section pool counts | `ui_structure.pools()` counts questions, but `\insertgroup[n]` draws elements. A section holding a two-question set shows a pool one too large, and the "pool too small" warning can be wrong. Fixed in P1. |
| Backups | `./amc backup` saves the whole `MC-Projects` folder, so `_amcweb` and the banks are included. |

**What #15 tells us** (from the code; not reproduced yet):

- The restore did keep the design. `restore()` writes through
  `write_source()`, which keeps the version it replaces, so the builder's
  work was still in History after both restores. It was lost when the
  exam was deleted: History lives inside the exam folder, and deleting an
  exam removes the folder (there is no trash).
- A builder save writes `paper.json`, then `paper-layout.tex`, as two
  separate versions (`api_builder_save` → `save_source`, then
  `write_layout` → `save_source`). History is per file, so there is no
  "the paper as it was at 13:05" to go back to, only one file's version.
- For `paper.json` the version view shows raw JSON. The comparison only
  works for the file open in the editor, and nothing draws the design.
  Only the size column hinted that those versions were nearly blank.

P0 fixes all three: change sets, a picture and a comparison for every
kind of file, "Undo restore", and a trash. It also adds the missing test:
restore a `paper.json` version and check the design and the layout.

## 3. The pieces and their ids

| Piece | What it is | Id |
|---|---|---|
| Question | one `\begin{question}`, `questionmult` or `questionmultx` | AMC id (`alg-017`), unique in the exam, shown in marks exports; frozen after printing, as now |
| Item | one `\element`: a question, or a set (shared text + questions, kept together, in order) | a **name** (`alg-017`), readable and unique in its exam or bank, used as the folder name; and a **uid** (UUIDv7) that never changes and follows the item between bank and exams |
| Section (exam) | heading, instructions, a pool of items, how many per copy, shuffle | AMC group name (`sectionI`), unique in the exam. Renaming already rewrites every `\element`; with P0 that becomes one version |
| Group (bank) | a named, ordered list of items in a bank, with a title, instructions and a default scoring | name, unique in the bank |
| Exam | main file, preamble, paper layout, sections | folder name, as now, plus a uid in `amcweb.json`, so history, trash and usage survive renames |
| Bank | one instructor's library of items, in groups | name and uid |

For a one-question item, the item name and the AMC id are the same. In a
set, the questions are `<name>-a`, `<name>-b`… unless the author chose
other ids.

## 4. Modular exam layout

```
<exam>/
  exam.tex                  main file: preamble, \input{pools}, the paper with its section regions (phase 8 markers)
  pools.tex                 which items each section draws from, in order (managed; a pro can edit it)
  items/
    alg-017/item.tex        the item's LaTeX
    alg-017/item.json       uid, title, tags, where it came from (bank, uid, revision, changes applied)
    alg-017/alg-017-1.png   its figures
    set-004/item.tex        a set: shared text + set-004-a, set-004-b
  paper.json, paper-layout.tex    Paper builder exams, as now
```

`pools.tex`:

```latex
%%AMCUI:POOL sectionI%%
\element{sectionI}{\amcuiItem{alg-017}}
\element{sectionI}{\amcuiItem{set-004}}
%%AMCUI:END POOL%%
```

`\amcuiItem` is defined in a managed region of the preamble
(`%%AMCUI:ITEMS%%`). The exam stays plain LaTeX, so the desktop app and a
downloaded copy of the folder build it unchanged.

- **Figures** live in the item's folder and are named after the item
  (`alg-017-1.png`). LaTeX looks in the main folder before
  `\graphicspath`, so a bare `fig.png` could pick up a file of the exam
  itself. Import and conversion rename figures that way.
- **An item file holds what was inside `\element{}{…}`**, without the
  `\element` itself. Moving an item to another section is one line in
  `pools.tex`, and the same file works in a bank.
- **Old exams keep working.** Questions written inline in `exam.tex`
  (every exam made so far, and every hand-written one) are read and edited
  exactly as today. New exams made in the app use items. "Split into item
  files" converts an exam in one change set (questions into item folders,
  figures moved and renamed, pools written), and History can undo it. An
  exam can mix inline questions and items.
- **The parser** (`read_latex`) follows `pools.tex` into the item files.
  Each question knows its item, file and span, so the form editor, the
  marking panel and the lock work on item files as they do on `exam.tex`.
  The lock check (`same_layout`) runs per file, item files included.
  Pools count elements, not questions.
- **AMC-TXT exams** stay as they are (no items, no banks), as decided in
  the earlier plan.

## 5. Editing: form and LaTeX

```
┌ Questions ── [Questions] [Paper design] [LaTeX] [History] ─────────────── Build preview ┐
│ Section I · 15 of 18 per copy │ alg-017 · Single answer          [Form | LaTeX]  ⋯     │
│ ⋮ alg-017  Coefficient of… ✓  │ ┌─────────────────────────────────────────────────────┐ │
│ ⋮ alg-018  Sum of primes…  ●  │ │ 1 \begin{question}{alg-017}                         │ │
│ ⋮ set-004  Passage: … (3)  ✓  │ │ 2   \scoring{\scoringDefaultS}                      │ │
│ + Add a question              │ │ 3   Find the coefficient of $x^{2025}$ in …         │ │
│ + From a bank…                │ │ 4   \begin{choices}                                 │ │
│ Section II · 5 of 5           │ │ …                                                   │ │
│ [Edit section as LaTeX]       │ └─────────────────────────────────────────────────────┘ │
│ [Save section to a bank…]     │ From Olympiad 2025 › Algebra · Bank updated  ⇄          │
│                               │ [Check this question]                   Saved · 12:41   │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Form | LaTeX switch** on every item. Form is the phase 7 editor.
  LaTeX is an ACE editor on the item's file (or on the question's span in
  an old exam). A preference, "Open questions in LaTeX", makes LaTeX the
  default for teachers who prefer it.
- **Saving LaTeX** goes through the same checks as the form: AMC ids stay
  unique, environments balance, nothing outside the item is touched. A
  save that doesn't parse is refused with the line, never half-written.
  After printing, only answer key and scoring changes pass, as now.
- **Check this question** compiles the item alone in a small document
  with the exam's preamble (a few seconds) and shows any error at its
  line. A full build maps LaTeX errors to item files too: with `\input`,
  LaTeX's log names the file, so the teacher sees
  `items/alg-018/item.tex:5: Undefined control sequence` instead of a
  line number in a 900-line `exam.tex`.
- **Edit section as LaTeX** opens the whole section as one document:
  every item in pool order, separated by lines like
  `%%%% item alg-017 %%%%`. Saving first shows what will happen ("2 items
  changed, 1 added"), then splits it back into item files in one change
  set. A missing or altered separator is refused, never guessed.
- **The LaTeX tab** stays for the main files (`exam.tex`, `pools.tex`,
  preamble files). `paper-layout.tex` stays generated by the builder; a
  hand edit there makes the builder stop rewriting it, as now.
- Conveniences: snippets for AMC environments; completion of item ids and
  of the exam's macros.
- The same form, LaTeX view and "Check this question" edit items in a
  bank (7.6).

## 6. Version history

### 6.1 Where it is kept, and why

- Everything the server keeps for an instructor, apart from their exams
  and banks, goes in one server-only folder,
  `MC-Projects/_amcweb/<user>/` (single-user mode: `MC-Projects/_amcweb/_local/`, a name no account can take):

  ```
  _amcweb/<user>/
    history/exams/<exam-uid>.git   one git repository per exam; the exam folder is its working tree
    history/banks/<bank-uid>.git   one per bank
    trash/<exam-uid>/              deleted exams (6.4)
    audit.jsonl                    audit log (6.4)
    bank-index.sqlite              search index of the instructor's banks (7.7)
  ```

- **Outside the teacher's folder**, because the teacher can write anything
  there (section 2: `/fs`, archive import), and a planted git `config`
  or SQLite file would then be opened by the server. `_amcweb` is outside
  every teacher's folder: account names can't start with `_`, and the
  exam list already skips `_` folders. In single-user mode the one user
  can reach it, which is harmless (it is their own machine).
- **Keyed by the exam's uid**, so renaming keeps the history. Copying an
  exam starts a new history whose first version says where it came from.
  An exam copied outside the app (desktop app, file manager) carries a
  duplicate uid; the copy gets a new uid and a fresh history.
- **Git runs in a fixed environment:** no system or global config, hooks
  off (`core.hooksPath=/dev/null`), fsmonitor off, no pager, no network,
  output read with `-z` and porcelain formats. Only the commands the
  server needs; teachers never type git commands.
- The exam zip download leaves history out (as now); "Download with
  history" adds a git bundle for pro users.

### 6.2 What is kept

- **Tracked:** the sources (`*.tex`, `*.sty`, `*.cls`, `*.bib`),
  `paper.json`, class lists (`*.csv`), `items/**`, and images in the exam
  folder up to 10 MB. **Not tracked:** what AMC makes (`DOC-*`,
  `amc-compiled*`, `data/`, `cr/`, scans, exports), `amcweb.json`,
  `options.xml`. Files are named explicitly; the scans folder is never
  scanned.
- **One change set (commit) per save**, with every file the save touched.
  A builder save is one version holding `paper.json` and
  `paper-layout.tex`. Renaming a section is one version for every file it
  rewrote. Adding a whole bank group is one version.
- Each version records who, when and how (the existing "what" text:
  "Paper builder: logo added", "alg-017: answer key changed"), plus
  machine-readable trailers (kind of change, items touched) for filtering.
- **Kept forever.** Git stores text compressed and as deltas, so the
  7-day / 100-version pruning goes. The form saves 0.9 s after the last
  keystroke, which makes many small versions; the list groups them into
  editing sessions (same person, gaps under 10 minutes), each one
  expandable.
- **`based_on` stays** (the hash of the file as read), so two tabs can't
  overwrite each other.
- A file changed outside the app is committed as "Changed outside the
  app" before the next change, as now.
- The version that last built is marked. Printing (the lock) names a
  version "Printed <date>" automatically. Teachers can name versions too
  ("Checked by the head of department").
- **Existing `.history/` folders** are converted when an exam is first
  opened: each file's versions become versions in time order, labelled
  "from the old history". The folder is then removed.
- Banks have the same history: every change to an item, a group or the
  bank's preamble is a version, with the same panel.

### 6.3 The History panel

```
┌ History · MA39209 Week 12 ─────────────── [Whole exam ▾] [Compare…] [Name this version] ┐
│ ● Now                                                                                    │
│ ▾ Today 13:05–13:06 · rakesh · Paper builder (4 changes)                                 │
│     13:06  Paper builder: row added                      paper.json, paper-layout.tex    │
│     13:05  Paper builder: logo block added                                               │
│ ▸ Today 12:40 · rakesh · Questions (31 changes)                          built OK        │
│ ◆ 6 Nov · Printed 6 Nov                                                                  │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ 13:05 · Paper builder: logo block added                                                  │
│ What changed: Row 1: logo block added (3 columns); Title lines: second line edited       │
│ [Picture of the design]  [Changes, word by word]  [Build this version]                   │
│ [Restore the exam to this version]  [Restore only paper.json]  [Undo this change]        │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Scope:** the whole exam, one file, one item, or one section.
- **What changed, in words**, above the line diff. For questions, the
  parser compares the two versions ("alg-017: text edited; answer C made
  correct; scoring changed"). For the builder, the two designs are
  compared ("Row 2: header boxes 3 → 2 columns; logo removed"). For
  files: added, removed, renamed.
- **Diffs** side by side or inline, with changes highlighted word by word
  inside a line (LaTeX paragraphs are long lines); images side by side.
- **Compare any two versions**, for example "Printed" against now.
- **Blame** (pro): who last changed each line of a file.
- **Preview before restoring:** the questions as the form shows them,
  the design drawn as in the builder, or "Build this version" (compiled in
  a scratch folder; the exam isn't touched).
- **Restore, three ways:** the whole exam to that point (the default, so
  files that belong together come back together); only one file or item;
  or undo just one change (applied in reverse, and refused with an
  explanation when later changes overlap it). Every restore is a new
  version and offers "Undo restore". The confirmation says what will
  change ("removes 6 blocks and 2 rows"). After printing, the lock
  applies as now.

### 6.4 Trash and audit log

- Deleting an exam moves it to `_amcweb/<user>/trash/<exam-uid>/` for 30
  days; its history stays. "Trash" on the Exams page restores it (under a
  new name if the old one is taken). After 30 days both are removed. On a
  shared machine, admins can see and restore an instructor's trash.
  Deleting a bank works the same way.
- An append-only audit log (`_amcweb/<user>/audit.jsonl`, plus a line in
  the server log) records exams and banks created, deleted, restored and
  renamed, exams unlocked, versions restored: who, when, what. #15 noted
  that deleting an exam leaves no trace today.

## 7. Question banks

### 7.1 One instructor, their own banks

- Each instructor has their own banks, as many as they want ("Olympiad
  2025", "Class 9 physics"). Nobody else sees or edits them. There are no
  school-level banks to maintain. On a shared machine, an instructor's
  banks sit in their own folder, like their exams.
- A bank is organised in **groups** ("Algebra", "Geometry", "Numeric
  answers"), each an ordered list of items with a title, instructions and
  a default scoring. An exam is organised the same way, in sections
  holding items. Moving questions is copying items between a group and a
  section:

```
Bank "Olympiad 2025"                                    Exam "MO Level I"
  Algebra   (18 items)  ── pull the whole group ───▶   Section I (15 of 18 per copy)
  Geometry  (12 items)  ── pull 4 selected ────────▶   Section II
  Numeric   (9 items)   ◀── save a whole section ──    Section III
  Probability (6 items) ◀── save selected questions ─  any section
```

- Where: `MC-Projects/<user>/_banks/<bank>/` (single-user mode:
  `MC-Projects/_banks/<bank>/`). The exam list skips `_` folders. History,
  trash and the search index are in `_amcweb` (6.1).

### 7.2 Bank → exam: pulling questions

```
┌ Add from a bank ─ to Section I (15 per copy, 12 in the pool) ────────────────────────────┐
│ Bank [Olympiad 2025 ▾]   Group [Algebra (18) ▾]                  [Add the whole group]   │
│ [search…]   Difficulty [any ▾]   Kind [any ▾]   Tags [any ▾]   Not used since [2025 ▾]   │
│ ☐ alg-017  Coefficient of x^2025 in …      hard    used 2× (last: L1 2025)  in this exam │
│ ☑ alg-018  Sum of primes p dividing …      medium  never used                            │
│ ☑ set-004  Passage: compound interest (3)  easy    used 1×                               │
│ [Preview]                       2 chosen · [Pick 6 at random from the shown ones] [Add]  │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

- **A whole group**, either as a new section (it takes the group's name,
  title, instructions and default scoring; the teacher then sets how many
  per copy and shuffle) or into an existing section.
- **Selected questions of a group**, ticked by hand (search, difficulty,
  tags, kind, "not used since"), or "pick n at random from the shown
  ones". A random pick is made once, at that moment, and shown for
  review; it never changes at build time. They go into the section the
  dialog was opened from, or one chosen in it.
- **A set** (a passage and its questions) is picked whole, because its
  questions share their text.
- **Fixed or different per copy** comes from the section settings of
  phase 8: insert all, or `\insertgroup[n]` with shuffle.
- Items already in this exam are shown as such and not added twice.
- **A section made from a whole group remembers it.** When the group later
  gains or loses items, the exam says so ("Algebra has 2 new questions")
  and offers to add them, until the exam is printed.
- **Macros:** definitions the items need are added to the exam's preamble
  in a managed region per bank. A macro the exam already defines
  differently is flagged with both definitions, never overwritten
  silently. Packages the items need are added the same way.
- **Scoring belongs to the section.** Items may carry `\scoring`. When
  the section has a default, the dialog offers to drop the item's own;
  that is recorded as a change applied on the way in (7.4), so the item
  still shows "Up to date".
- **Usage** is recorded in the bank when the exam is printed (the lock),
  not when the items are added, so a question dropped before printing
  doesn't count as used.

### 7.3 Exam → bank: saving questions

```
┌ Save to a bank ─ 3 questions from Section III ─────────────────────────────┐
│ Bank   [Olympiad 2025 ▾]   or [+ New bank]                                 │
│ Group  (•) New group [Section III      ]   ( ) Existing group [Numeric ▾]  │
│ Tags   difficulty [medium ▾]   [+ tag]                                     │
│ nq2 came from this bank:  (•) Update the bank's copy   ( ) Save as new     │
│ Macros: \N will be added to the bank's preamble                            │
│                                                       [Cancel]  [Save]     │
└────────────────────────────────────────────────────────────────────────────┘
```

- **A whole section** → a new group (named after the section, with its
  heading, instructions and default scoring) or an existing group.
- **Selected questions** from any section → a chosen group. A question in
  a set brings its whole set.
- **The whole exam** → a new bank, each section becoming a group ("Make a
  bank from this exam").
- Figures go along. Macros the questions use from the exam's preamble go
  into the bank's `preamble.tex`; a clash with a different definition
  already in the bank is shown, never overwritten.
- **No duplicates by accident:** a question that came from this bank
  offers "Update the bank's copy" (a new revision in the bank) or "Save
  as new".
- After saving, the exam's items are linked to their bank copies (status
  "Up to date", 7.4), so a later edit on either side shows up. Inline
  questions in an old exam are copied without a link; "Split into item
  files" first if the link is wanted.

Other ways to fill a bank:

- **A LaTeX file** such as RJ's `questionbank/input/level1-2025.tex`: each
  `\element` group becomes a bank group, and questions sharing one
  `\element` become a set. A preview with a checkbox per question comes
  first.
- **Written in the bank**, with the same form and LaTeX editor and "Check
  this question" (compiled with the bank's preamble in a scratch folder
  inside the instructor's own folder).

### 7.4 A copy, never a live link

An item moved between a bank and an exam is a copy. The exam's
`item.json` records the bank, the item uid, the revision (a fingerprint
of the item's exact content, a hash over its files) and any changes
applied on the way in: an id renamed because the exam already had it, or
the item's own scoring dropped in favour of the section's.

Why not link:

1. **Marking needs what was printed.** AMC records the layout and the
   answer key per question when papers are built. A live link would let
   a bank edit change a printed exam, or quietly change an answer key
   before printing.
2. **A build depends only on the exam folder.** Editing, renaming or
   deleting a bank can never break an exam's build.
3. **The exam stays whole:** the zip download, the desktop app, backups,
   and moving an exam between the Mac and amc.rjana.in all keep working.

Each linked item shows a status, computed from the fingerprints:

| Status | Meaning | Offered |
|---|---|---|
| Up to date | the exam's copy is the bank's revision | — |
| Bank updated | the bank has a newer revision | see the difference; take it |
| Edited here | the exam's copy was changed | update the bank's copy, or save it as a new question |
| Both changed | both | three-way comparison: take the bank's, keep mine, or merge by hand in the LaTeX view |

After printing, taking a bank revision goes through the lock. An answer
key or scoring fix passes ("the bank corrected the key of alg-017: apply
it to this exam before marking?"); anything that moves boxes is refused.

### 7.5 Bank layout and metadata

```
_banks/olympiad-2025/
  bank.json        name, uid, description, groups in order: name, title, instructions,
                   default scoring, items in order
  preamble.tex     packages and macros the items need (\N, \Z, \scoringDefaultS…)
  items/alg-017/item.tex, item.json, alg-017-1.png
```

`item.json` in a bank:

```json
{ "schema": 1, "uid": "01a1b560-cd5e-72e4-81ae-7143124e79f2", "name": "alg-017",
  "title": "Coefficient of x^2025", "kind": "single", "questions": ["alg-017"],
  "difficulty": "hard", "tags": ["polynomials", "IITB MO 2025"],
  "requires": { "packages": [], "macros": ["\\N"] },
  "authors": ["rakesh"], "notes": "" }
```

- An item belongs to one group. Moving it to another group changes
  `bank.json` only; "Copy to group" makes a new item with a new uid.
- **Content, metadata and usage are kept apart.** `item.tex` and its
  figures are the content: the fingerprint covers them, and exams copy
  them. Title, difficulty and tags are in `item.json`, so retagging
  doesn't make every exam say "Bank updated". Usage is derived data in
  the index (7.7).
- **Tags:** the tag field offers the tags already used in the bank, so
  they don't drift ("Polynomials" against "polynomial"). Difficulty is
  easy / medium / hard.
- `requires` is filled automatically: commands an item uses that the
  bank's preamble defines, and packages it needs.

### 7.6 The bank page

A "Question banks" page next to Exams: the instructor's banks; in a
bank, its groups and items with search and filters; an item opens in the
same Form / LaTeX editor as in an exam, with its history and the exams
that use it. Groups can be added, renamed, reordered, and given a title,
instructions and a default scoring. Archiving an item hides it from the
"Add from a bank" dialog without removing it from exams or history.

### 7.7 Search

One SQLite index per instructor (`_amcweb/<user>/bank-index.sqlite`),
with full-text search on the questions' plain text, the tags and the
usage. It is rebuilt from the files when missing or behind a bank's
latest version: the files are the truth and the index can always be
thrown away. Target: under 200 ms for 5,000 items.

### 7.8 Moving a bank

A bank can be exported as a zip (items, `bank.json`, `preamble.tex`, and
its history as a git bundle) and imported elsewhere: to move it between
the Mac and amc.rjana.in, or to give a colleague a copy that then becomes
their own bank.

## 8. Security and integrity

- Repositories, the trash, the audit log and the index are outside
  teachers' folders (6.1); git runs in a fixed environment; paths are
  checked against an allow-list (`items/<name>/…` with a strict name
  pattern).
- Archive import and exam copy drop dot-folders and any `.git` in them.
- An instructor's banks are only reachable through their own account.
  Bank zips are checked on import like exam archives (names, sizes, no
  links).
- The lock (printed exams) applies to every write: form, LaTeX panel,
  section document, restore, bank update.
- A check at start (or `./amc doctor`): `git fsck` on the repositories,
  index rebuilds, and histories whose exam is gone and not in the trash.

## 9. Phases

Each phase: one branch, one merge request, logic tests and browser
tests, in both modes.

| Phase | Delivers | Issues | Size |
|---|---|---|---|
| **P0 History and trash** | `ui_vcs.py`: a git repository per exam, change sets, `based_on`, outside changes, named versions, built and printed marks. Every writer goes through change sets (a builder save is one version). Conversion of `.history/`. History panel: sessions, summary in words, word diff, any two versions compared, preview, restore whole / one file / one change, undo restore. Exam uid, trash, audit log. Test restoring `paper.json` | #15 | L |
| **P1 Items in exams** | `\amcuiItem`, `items/`, `pools.tex`; parser following items; form editor, marking panel and lock on item files; Form / LaTeX switch; section as one LaTeX document; "Check this question"; errors mapped to item files; "Split into item files"; new exams made with items; pools counted by element | #4 follow-up | L |
| **P2 Question banks** | banks per instructor with groups and history; bank page; pull a whole group (as a new section or into one) or selected questions; save a whole section, selected questions or the whole exam to a bank; import of RJ-style LaTeX files; fingerprints, status, three-way comparison, update either side; group follow-up; macros and packages; usage at printing; search index; bank zip export and import; bank trash | #5 | XL |
| **P3 Analysis and blueprints** | item statistics after marking (share of right answers, how well an item separates strong from weak students, which wrong answers attract), kept per bank item across exams; blueprints ("3 easy + 5 medium from Algebra") that fill a section's pool for review | #6 | L |

Tests to add:

- **Logic:** the repository wrapper, change sets, the three restores,
  `.history/` conversion, item parsing, the section document split,
  fingerprints and status, changes applied on the way in, group pull and
  section save, the index.
- **Browser:** History (restore `paper.json` and `exam.tex`, undo restore,
  compare), trash, the LaTeX panel and the section document; pull a whole
  group as a new section and selected questions into a section, fixed and
  per copy, then build and check the copies; save a section and selected
  questions to a bank; the update flow both ways.
- **Security:** a `.gitattributes` filter planted in an exam does
  nothing; `/fs` can't reach `_amcweb`; one instructor can't reach
  another's banks.

## 10. Risks

| Risk | Mitigation |
|---|---|
| git is slow on Docker Desktop shared folders (single-user mode) | files named explicitly (never a scan of the scans folder), `--no-optional-locks`; budget: a save under 150 ms, measured in P0 on the Mac and on the server |
| A repository gets damaged (disk full, killed process) | the exam's files are the truth: a damaged repository is moved aside and restarted from the files, with a warning; `git fsck` at start; backups include `_amcweb` |
| A teacher's LaTeX doesn't fit the item model (macros spanning questions, odd `\element` content) | old exams keep inline questions; "Split" refuses what it can't split cleanly and names the question |
| Figure names or macros clash between banks | figures named after their item; macro clashes shown with both definitions |
| Large banks (thousands of items with figures) | one folder per item, index for lists and search, pages of results |
| The desktop app or a hand edit breaks the markers | as now: unknown regions are left alone and shown as custom LaTeX; `\amcuiItem` is ordinary LaTeX |
| Scope | each phase is useful alone; P0 is worth having without banks |

## 11. Decided (7 November 2026)

1. **Banks belong to one instructor.** No school-level banks. An
   instructor pulls a whole group or selected questions of a group from
   their bank into an exam, and saves a whole section or selected
   questions from an exam into their bank.
2. Items (a question or a set) in their own folders; new exams made that
   way; old exams left inline unless converted.
3. Exams and banks always exchange copies with a revision record, never
   live links.
4. History on git, outside teachers' folders, kept forever, replacing
   `.history/` (converted).
5. Trash for deleted exams and banks, kept 30 days.
6. Order P0 → P1 → P2 → P3.

## 12. Status

- **P0 (history and trash, #15): built** on `feature/history-p0`.
  `server/ui_vcs.py` (repositories, change sets, restores, trash, audit
  log), `server/ui_changes.py` (changes in words), the History panel and
  the Trash in `app.js`, 40 logic checks and the rewritten
  `e2e-history.mjs` (ending with the #15 scenario). Git works on bytes
  the server reads itself (fast-import, cat-file), never on the exam
  folder, so nothing in the folder is read by git.
  Left for later: "Build this version" (compile a version in a scratch
  folder), blame, "Download with history" (git bundle), the admins' view
  of another instructor's trash, and a start-up check of all
  repositories (`./amc doctor`).
