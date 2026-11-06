# RJ Style Paper Builder: plan

Proposal, November 2026, after the review of MR !12 (phase 8). Replaces the
"Olympiad paper" starter of `questions-banks-templates-plan.md` (section 8)
with a builder in which teachers compose the question paper and the OMR
sheet from blocks laid out in rows and columns, the way Bootstrap lays out
a web page. Nothing here is built yet.

## 1. Summary

- **What was built in !12 is not what we want.** The Olympiad paper starter
  is the RJ paper with a fixed list of parts that can only be switched on
  or off and given a few values. Teachers can't put a logo where they want,
  split a row differently, or design their own OMR sheet.
- **What we want is a question paper builder.** The teacher first chooses
  the kind of paper: answers ticked on the question paper, or on a separate
  answer sheet (OMR). Then they build the paper from **rows**. Each row is
  split into **columns** whose widths adjust automatically, and each column
  holds a **block**: a logo, title lines, student details, the paper code,
  exam information, instructions, free LaTeX, the questions. Each block can
  have a dashed border, a solid one, or none. The OMR sheet is designed the
  same way, with blocks for the name field, the ID grid and the answer
  boxes. Instructions have their own editing panel, and the footer and the
  page have their own settings.
- **Versions get proper codes.** With paper codes on, the teacher says how
  many versions; they are printed A, B, C and so on, and after Z come AA, AB
  and so on, as spreadsheet columns are named.
- **The RJ paper becomes the builder's first layout.** The gallery shows
  "RJ Style Paper Builder" instead of "Olympiad paper". Choosing it opens the
  builder, already filled with the RJ layout (also "Simple" and "Blank").
- **What stays from !12:** the sections (count per copy, shuffle, columns,
  headings), "Organise into a section", the instructions summary per
  section, versions as `\onecopy{n}`, and the plumbing (history, lock,
  conflict check). **What goes:** the Olympiad starter and its fixed parts
  (section 12).

## 2. The builder at a glance

1. **Kind of paper.** "Answers on the question paper" (AMC's boxes next to
   each question) or "Separate answer sheet (OMR)". It decides whether there
   is an answer sheet to design and where AMC's name field goes. It can be
   changed until the papers are printed.
2. **Question paper.** Rows of blocks: the header, the instructions, the
   questions (the sections, in order), the end-of-paper line, rough-work
   pages.
3. **Answer sheet** (separate answer sheet only). Rows of blocks: title,
   paper code, student details with the name field, signatures, ID and class
   grids, numeric answers, choice answers.
4. **Instructions.** A list of LaTeX items with a preview, plus the line per
   section made from the sections.
5. **Versions and codes.** None, letters (A, B … Z, AA …) or numbers (1, 2 …
   or 01, 02 …), and how many versions.
6. **Page and footer.** Paper size, font size, margins, the footer pattern
   and its border, the same number of pages in every copy.

Every change is written to the exam's files through the history, like the
form editor, and the paper is read-only once printed.

## 3. Layout: rows and columns

The paper is a list of rows from top to bottom. A row is split into
columns on a **12-column grid**, as in Bootstrap. Each column holds one
block.

| Column width | Bootstrap | Meaning |
|---|---|---|
| **N of 12** | `col-4` | a fixed share of the line: 4 of 12 is a third |
| **Auto** | `col` | shares what is left with the other auto columns, equally |
| **Fit** | `col-auto` | as wide as its content: a logo, the paper code |

Examples of rows:

```
| logo (fit) |          title lines (auto)           | logo (fit) |
|  student details (7)   | code (fit) |  exam info (auto)          |
|                     instructions (12)                            |
```

Each row also has:

- **Vertical alignment** of its columns: top, middle or bottom.
- **Same height:** the bordered boxes of the row are drawn at the height
  of the tallest, as in the RJ header.
- **Gap** between columns and **space after** the row.
- A row of fixed columns adding up to more than 12 is refused in the panel
  (no wrapping to a second line, unlike Bootstrap), so the paper stays
  predictable. Paper has one width, so there are no breakpoints.

Each column has:

- **Border:** none, dashed (the RJ look, `dashbox`) or solid, with a
  default for the whole paper.
- **Alignment** of its content: left, centre or right.
- **Padding** inside the border.

**Why this fits LaTeX.** Earlier we argued against a free-form canvas
where parts are dragged to pixel positions (plan, section 8). A grid of
rows is different: each row becomes a line of side-by-side boxes
(`minipage`s) in LaTeX's normal flow, so AMC can still number, lay out and
read the paper. "N of 12" and "Auto" widths are computed when the LaTeX is
written. A "Fit" column is measured by TeX first (its content is set in a
box and its width read), and the auto columns share what is left. A row
never breaks across pages, except a full-width row holding the questions
or an answer area, which flows normally.

## 4. Question paper blocks

| Block | What it prints | Settings |
|---|---|---|
| **Logo** | an image | the school logo from Appearance or an uploaded image; height |
| **Title lines** | one to four lines, e.g. exam name, organiser | per line: text, size, bold or small caps |
| **Student details** | name line; registration number as a fixed prefix in grey boxes (`MO26`) and digit boxes to write in; class boxes; level box | which lines, number of digits, the prefix, labels |
| **Paper code** | "Code" and the version's code (section 7) | size |
| **Exam information** | date, time, maximum marks, more lines | lines; icons on or off |
| **Labelled box** | a label and a value, e.g. "Level: I" | label, value, size |
| **Instructions** | the instructions (section 5) | heading on or off |
| **Text (LaTeX)** | anything: notation, a table of values, a note | LaTeX, with a preview; presets "Notation" and "Table of values" from the RJ paper |
| **Questions** | the sections, in order, each with its heading | managed in the Sections panel from phase 8 |
| **Line, space, page break** | a rule, vertical space, a new page | thickness, height |
| **End of paper** | "End of Question Paper" centred between rules | text |
| **Rough work** | pages headed "Space for rough work" | how many |

When the answers are on the question paper, the **Student details** block
on the first page carries AMC's name field (the zone AMC cuts out of the
scan), and an **ID grid** block (section 6) can be placed there too. With a
separate answer sheet, the question paper's student details are only
written in; AMC reads the answer sheet.

## 5. Instructions panel

- A list of items, each a LaTeX paragraph with a live preview (KaTeX, as in
  the question form). Items are added, edited, reordered and removed.
- One special item, **"The line per section"**, is regenerated from the
  sections: "Section 1 (Objective Questions): 15 questions, each with
  exactly one correct answer. A correct answer scores +3 and a wrong one
  −0.75." (built in !12, kept).
- Settings: the heading ("Read the following instructions carefully…"),
  the bullet (RJ arrow, dot, number), a rule after the list.
- The Instructions block prints the list wherever it is placed: usually a
  full-width row after the header, sometimes on a page of its own.

## 6. Answer sheet (OMR) designer

Only with a separate answer sheet. Same rows and columns as the question
paper, with these blocks:

| Block | What it prints | Read by AMC |
|---|---|---|
| **Sheet title** | "Optical Mark Recognition (OMR) Sheet" and the exam name | no |
| **Paper code** | the version's code, large | no: AMC knows the copy from the sheet's own marks |
| **Student details** | name line, write-in ID and class boxes, inside AMC's name field | the name zone, kept as an image |
| **ID grid** | digit columns 0 to 9 (`\AMCcodeGridInt`), vertical or horizontal | yes: matched to the class list |
| **Class grid** | the same for the class | yes |
| **Signatures** | student's and invigilator's signature lines | no |
| **Instructions** | LaTeX, e.g. how to darken a numeric answer | no |
| **Numeric answers** | a column of digit boxes per numeric question, in N columns | yes |
| **Choice answers** | the boxes of the other questions, in N columns | yes |
| **All answers** | every question's boxes (`\AMCform`), in N columns | yes |
| **Text (LaTeX)** | anything | no |

Checks shown in the panel and refused at build:

- exactly one name field per copy;
- every question has its boxes somewhere: "Numeric answers" and "Choice
  answers", or "All answers";
- with versions photocopied (section 7), an **ID grid** is strongly
  advised: it is how sheets are matched to students without reading
  names.

The box size and spacing come from the RJ settings
(`\AMCboxStyle`, `\AMCformHSpace`, `\AMCformVSpace`) and can be changed in
"Page and footer".

## 7. Versions and paper codes

- **Codes:** none, letters, or numbers. With codes on, the teacher says how
  many versions. Each version is one AMC copy (`\onecopy{n}`); every
  version draws its own questions from the sections, and the copies handed
  out are photocopies of the versions. When uploading the scans, the
  teacher says that the sheets were photocopied.
- **Letters after Z.** Yes: version 27 is **AA**, as spreadsheet columns
  are named.

  | Versions | Codes |
  |---|---|
  | 1 to 26 | A … Z |
  | 27 to 52 | AA … AZ |
  | 53 to 78 | BA … BZ |
  | up to 702 | … ZZ |

  Option **"Same length for every version"**: when there are more than 26
  versions, every code has two letters (AA, AB … for versions 1, 2 …), so
  all papers look alike. Off by default.
- **Numbers:** 1, 2, 3 … or with leading zeros, 01, 02 … 99.
- The code is printed by the **Paper code** blocks and can be used in the
  footer. The RJ paper's `\paperCode` used `\@Alph`, which stops at Z with
  a LaTeX error; the builder writes its own macro from AMC's copy number.

## 8. Page and footer

- Paper size (A4, Letter), font size (10, 11, 12 pt), margins.
- **Footer:** a pattern with fields, e.g. `Level {level} // Code {code} //
  Page {page}` or `Page {page} of {pages}`, its alignment and border (none,
  dashed, solid). The same on both sheets, or one per sheet. If `{level}` is null then we should not print `Level {level} // ` in question paper.
- **Same number of pages in every copy** (`\AMCaddpagesto{n}`), so the
  answer sheet is always the last sheet.
- Box style and spacing on the answer sheet (section 6).
- Icons: FontAwesome when the image has it, Zapf Dingbats otherwise (the
  `texmf-dist-fontsextra` question stays open).

## 9. Where the design is kept

Two ways, to decide (section 14, point 1).

**Recommended: a design file and a generated layout file.** The builder
keeps the design in `paper.json` in the exam folder and writes
`paper-layout.tex` from it. The main source only inputs it:

```
\input{paper-layout}          % preamble: page, footer, macros
...
\onecopy{4}{
  \amcuiPaperFront            % rows before the questions
  %%AMCUI:SECTION sectionI%%  ... the sections, as in !12 ...
  \amcuiPaperBack             % rows after the questions
  \amcuiAnswerSheet           % the OMR sheet, when there is one
}
```

- The questions and sections stay in the LaTeX, edited by the form and
  the Sections panel as now.
- `paper.json` and `paper-layout.tex` both go through the history. The
  layout file records the digest it was written with; if someone edits it
  by hand, the builder says so and offers "Keep my changes" (the exam
  leaves the builder and is edited in LaTeX from then on) or "Rewrite it"
  (the hand edits stay in History).
- A **Text (LaTeX)** block covers most needs for custom LaTeX without
  leaving the builder.

**Alternative: markers in the LaTeX** (as !12 does for its parts). Every
row and column would be a marked region rewritten from its settings. It
keeps one source of truth, but nested rows and columns make the markers
fragile, and a hand edit inside a row is lost at its next change anyway.

Example of `paper.json` (shortened):

```json
{
  "format": 1,
  "kind": "separate",
  "codes": {"style": "letters", "versions": 4, "same_length": false},
  "page": {"paper": "a4", "font_size": 11, "border": "dashed",
           "footer": {"pattern": "Level {level} // Code {code} // Page {page}", "border": "dashed"},
           "fill_pages": 10},
  "paper": [
    {"align": "middle", "cells": [
      {"width": "fit", "border": "none", "block": {"type": "logo", "file": "school-logo.png", "height": "18mm"}},
      {"width": "auto", "border": "none", "block": {"type": "title", "lines": [
        {"text": "Mathematics Olympiad 2026", "size": "LARGE", "style": "smallcaps"},
        {"text": "Mathematics Association, IIT Bombay"}]}},
      {"width": "fit", "border": "none", "block": {"type": "logo", "file": "iitb.png", "height": "18mm"}}]},
    {"same_height": true, "cells": [
      {"width": 7, "block": {"type": "student", "name": true, "id": {"prefix": "MO26", "digits": 3}, "level": "I"}},
      {"width": "fit", "block": {"type": "code"}},
      {"width": "auto", "block": {"type": "info", "lines": ["date", "max_marks", "time"]}}]},
    {"cells": [{"width": 12, "border": "none", "block": {"type": "instructions"}}]},
    {"cells": [{"width": 12, "border": "none", "block": {"type": "questions"}}]},
    {"cells": [{"width": 12, "border": "none", "block": {"type": "end"}}]},
    {"cells": [{"width": 12, "border": "none", "block": {"type": "rough", "pages": 2}}]}
  ],
  "answer_sheet": ["… rows, as for the paper …"],
  "instructions": {"heading": true, "items": [{"latex": "Do not open this booklet until the invigilators say so."}, {"summary": true}]}
}
```

## 10. Screens

The Questions step keeps three tabs: **Questions** (the form),
**Paper builder** (replaces Paper design) and **LaTeX**. The Paper builder
tab has its own tabs: Question paper, Answer sheet (separate answer sheet
only), Instructions, Sections, Versions and page.

```
 Question paper | Answer sheet | Instructions | Sections | Versions and page
┌──────────────────────────────────────────────┐ ┌ Selected: Student details ─┐
│ ⋮⋮ ┌─────┐┌──────────────────────┐┌─────┐  │ │ Width   [7 of 12 ▾]        │
│    │logo ││ Mathematics Olympiad ││logo │ + │ │ Border  (•) dashed ( ) none│
│    └─────┘└──────────────────────┘└─────┘  │ │ Name line           [x]    │
│ ⋮⋮ ┌┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┐┌┄┄┄┐┌┄┄┄┄┄┄┄┄┄┄┄┐   │ │ ID prefix [MO26] digits [3]│
│    ┆Name / Reg. No ┆┆ A ┆┆Date / Time ┆ + │ │ Class boxes         [ ]    │
│    └┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┘└┄┄┄┘└┄┄┄┄┄┄┄┄┄┄┄┘   │ │ Level box  [I]             │
│ ⋮⋮ ┌────────────── Instructions ─────────┐ │ └────────────────────────────┘
│    └─────────────────────────────────────┘ │
│ ⋮⋮ ┌────────────── Questions ────────────┐ │   [ Preview the first page ]
│ [+ Add a row ▾]                            │
└──────────────────────────────────────────────┘
```

- The canvas is a schematic of the page in the browser (CSS grid with the
  same widths), redrawn instantly. **Preview the first page** compiles one
  copy for the real look in a few seconds; **Build preview** builds the
  papers as now.
- **Add a row** offers layouts: one column; two or three equal; logo, title,
  logo (fit, auto, fit); 8 + 4; 4 + 8; 3 + 6 + 3.
- **Drag and drop** where it is natural: rows by their handle, blocks
  between columns, a column's edge to change its width (it snaps to
  twelfths). Buttons do the same for keyboard use.
- Clicking a block selects it; its settings are on the right.

**Wizard.** The gallery shows "RJ Style Paper Builder". After choosing it:
kind of paper (on the question paper, or separate answer sheet), the
starting layout (RJ Olympiad, Simple, Blank), versions and codes; the exam
name and date fill the title lines and exam information. Creating opens
Questions › Paper builder.

## 11. Technical approach

Same rules as before: new code in new files, upstream files touched in one
line each, no build step, every write through the history and the lock.

- `server/ui_builder.py` (new): the `paper.json` schema and its checks,
  the layout presets, the LaTeX generator (rows and columns, the blocks,
  the version code macro, the footer), the answer sheet checks.
- `server/school_templates/builder/`: the starter (`exam.tex` with the
  inputs and the sections) and the presets (`rj-olympiad.json`,
  `simple.json`, `blank.json`); the RJ preset's sample questions from !12.
- The LaTeX of the Olympiad starter's `paper-design.tex` (header boxes,
  OMR grids, answer areas) becomes the generator's block templates.
- Routes: `/ui/api/builder` (GET the design, POST changes with the digest
  they were made from), "Preview the first page" as a one-copy build. The
  sections keep `/ui/api/structure`.
- Browser: the builder in its own script, `server/static/ui/builder.js`,
  loaded next to `app.js`.
- Tests: logic checks for the generator (widths, borders, every block, the
  version codes 1, 26, 27, 52, 53, 702, the answer sheet checks) and a
  compile of each preset at image build; `tests-ui/e2e-builder.mjs` for
  the wizard, the canvas, the OMR designer, versions and the lock.

## 12. What happens to MR !12

| Kept | Removed |
|---|---|
| Sections: heading, instructions, count per copy, shuffle, columns, new page; pool and marks; add, move, rename, remove | The "Olympiad paper" starter (`school_templates/olympiad/`) |
| "Organise into a section" for questions written in `\onecopy` | Its fixed parts with on/off switches (`%%AMCUI:BLOCK%%`) and its parameters (`%%AMCUI:PARAMS%%`) |
| The instructions summary per section | The wizard's Options page for starters with blocks |
| Versions as `\onecopy{n}`, the app's copies following | The "parts of the paper" column of Paper design |
| History, lock and conflict check for the paper | |

Recommended: remove the starter from !12 before it is merged, so `main`
never offers it, and keep the rest. The builder then comes as its own
merge request.

## 13. Steps

| Step | Delivers | Size |
|---|---|---|
| **B0** | !12 without the Olympiad starter and its parts (section 12) | S |
| **B1** | Layout engine (rows, columns, widths, borders, alignment, same height), question paper blocks, `paper.json` and the generated layout file, the canvas with drag and drop, first-page preview | L |
| **B2** | Kind of paper, the answer sheet designer and its checks | L |
| **B3** | Instructions panel, versions and codes, page and footer | M |
| **B4** | Wizard and gallery card, presets (RJ Olympiad, Simple, Blank), guide | M |

Question banks (phase 9) come after B4, or before B1 (section 14, point 3).

## 14. To decide

1. Where the design is kept: `paper.json` and a generated layout file
   (recommended), or markers in the LaTeX?
2. MR !12: remove the Olympiad starter before merging (recommended), or
   merge it and remove it in B0?
3. The builder before question banks (phase 9), or banks first?
4. Codes after Z: spreadsheet style, 27 = AA (recommended), with "same
   length for every version" as an option?
5. Drag and drop on the canvas, with buttons as well (recommended)?
6. FontAwesome icons: build the image with `texmf-dist-fontsextra`, or keep
   the Zapf Dingbats look? (I think latex has fontawesome5 style file, can we not use that?)
7. Later: saving a row or a whole layout to reuse in other exams, and
   sharing layouts across the school.

## 15. Risks

| Risk | Mitigation |
|---|---|
| A row's content is taller than the space left on the page | Rows never break; the build reports overfull pages and the canvas marks the row |
| A logo file is missing | Each image is printed only if the file exists (`\IfFileExists`); the panel warns |
| The answer sheet lacks a name field or some questions' boxes | Checked in the panel and refused at build (section 6) |
| Boxes too close together to read | The RJ box style and spacing are the defaults; a minimum is enforced |
| Hand edits to the generated layout file | Digest check, then "Keep my changes" or "Rewrite it" (section 9) |
| The design format changes later | `"format": 1` in `paper.json`, one generator, server-side checks |
