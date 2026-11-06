# Interface redesign plan

Status: approved (2026-11-06), with the team's decisions on steps, the layout check, printing, languages, classic style, branding and devices. Covers issues #1 (redesign), #2 (template gallery) and #3 (marking scheme panel), plus new requests: a guided step-by-step workflow, locking an exam after printing, a side panel for PDFs and spreadsheets, and school branding.

## 1. Summary

The exam workflow becomes the backbone of the interface. A sidebar shows the ten steps of an exam in two groups, "Before the exam" and "After the exam", each with its status. A teacher can open any step at any time, and each step explains what to do and what comes next. A preview panel on the right shows question papers, answer keys, annotated sheets and exported marks without leaving the page.

Once an exam is printed it is locked. Questions and layout can't change without a deliberate unlock that explains what will be lost. The marking scheme and the answer key stay editable, because changing them doesn't move anything on the printed paper.

Teachers choose between the new style and the current one ("Classic") until the new interface covers everything. Admins can add the school's name, logo and colours.

The work is split into seven phases (0–6). Each phase is one merge request that can be used on its own.

## 2. Decisions so far

| Topic | Decision |
|---|---|
| Steps | Ten steps (section 5). Scans are checked and corrected before marking; papers are matched to students after marking; then marks are exported and sheets annotated. |
| Layout check | Building the papers runs layout detection automatically, then asks the teacher to check the layout. Printing opens only after they confirm "Looks correct". A locked exam skips the check. |
| Locking | After printing, the layout is locked. Only the marking scheme, answer key corrections and similar settings can change (section 6). |
| Mark anyway | Yes: marks can be computed while scan problems remain, behind a warning. |
| Printing | Save the PDF and print elsewhere (for example from a pendrive) everywhere. Printing directly on a printer attached to the shared machine only when that machine runs Linux (section 7). |
| Languages | English first. |
| Classic style | Kept until phase 6 is done, as "Classic style". Each teacher can switch between Classic and the new style, and the new style is offered to Classic users. Discontinuing Classic is decided after phase 6. |
| Look | Neutral by default. Admins can set the school name, logo and a colour palette, detected from the logo or chosen by hand (section 12). |
| Devices | Laptops and desktops. Tablets later. |

## 3. Where we start from

How the current interface (upstream amc-webapp) works:

- **Five icon tabs:** Projects, Source, Scans, Grading and Settings. Scans and Grading stay hidden until the documents are built or scans exist, so a new user can't see what comes later.
- **Editor and document on one screen:** the Source tab holds the LaTeX editor (ACE) and the document viewer side by side. Building and printing are also done there.
- **Grading tab:** marking, matching papers to students, export (ODS or CSV), annotated copies and the public marks link are all on one long page.
- **Settings tab:** exam-specific settings (final mark conversion, annotation, LaTeX engine) sit next to app-wide settings (scan thresholds, CSV headers, view options).
- **Long jobs:** they block the screen with a full-page progress panel.
- **Code:** server-rendered Jinja fragments loaded into the page by about 1,800 lines of plain JavaScript (`server/static/amc.js`) talking to the server over Socket.IO. There is no build step, and the interface is translated into English and French.

The existing logic we build on:

- **Printed and scanned exams are already detected:** the app records a print time when papers are printed through it, and knows how many pages have been scanned. Rebuilding the question paper after that already asks for confirmation ("Rebuilding the subject will remove all the project data"). The lock in section 6 extends this.
- **The answer key and scoring can change without moving boxes:** "Mark" with "Update marking scale" re-reads both from the LaTeX source (`prepare --mode b`) without changing the layout. This is what makes post-print corrections safe.
- **Scan checking is already possible:** after scans are read, AMC knows which pages it couldn't recognise, which pages of a copy are missing, and which boxes it wasn't sure about. A box is uncertain when its darkness falls between the lower and upper thresholds. Each box can be corrected by hand.
- **Printing to a printer goes through a CUPS print server** set in the `CUPS_SERVER` setting. Without one, only saving PDFs works.
- **Templates:** AMC ships 9 English and 9 French templates as `.tgz` files with titles and descriptions in `directory.xml`.

## 4. Goals and principles

1. **Follow the exam, not the tool.** Navigation follows the teacher's job, step by step.
2. **Free movement, honest status.** Every step is always reachable. A step that isn't ready yet explains why and links to what's needed, instead of being hidden.
3. **Hard to break a printed exam.** Dangerous changes are blocked by the server, not just greyed out in the browser. Unlocking states the consequences, with counts.
4. **Problems before marks.** Unreadable pages and uncertain boxes are resolved before marks are computed.
5. **See results in place.** Documents and spreadsheets open in the preview panel; downloads are optional.
6. **Explain as we go.** Each step carries a short guide, and the full guide is one click away.
7. **Modern, calm and accessible:** neutral look, light and dark themes, readable type, clear focus states and keyboard support. Designed for laptop and desktop screens: comfortable from 1280 pixels wide and usable down to 1024.
8. **Works offline on the school network.** Fonts, icons and libraries are bundled; nothing loads from the internet.
9. **Stay mergeable with AMC updates.** New interface code lives in new files. Changes to upstream files are small, listed in each MR, and kept to hooks.

## 5. The exam steps

### Layout

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│ [logo] Springfield High   Exams / Physics mid-term (10B)   🔒 Printed 5 Nov  ◐  👤 Priya │
├──────────────────┬───────────────────────────────────────────┬─────────────────────┤
│ BEFORE THE EXAM  │ 6 · Check scans                           │ PREVIEW         ⤢ ✕ │
│ ✓ 1 Questions    │ ┌───────────────────────────────────────┐ │ Page 3 · Copy 17    │
│ ✓ 2 Marking scheme│ │ What to do here                     ˄ │ │ ┌─────────────────┐ │
│ ✓ 3 Papers       │ │ • Fix pages the app couldn't read     │ │ │                 │ │
│ 🔒 4 Print       │ │ • Check boxes it wasn't sure about    │ │ │  scanned page   │ │
│ AFTER THE EXAM   │ │ • Marks come next, once this is clear │ │ │  with boxes     │ │
│ ✓ 5 Upload scans │ └───────────────────────────────────────┘ │ │                 │ │
│ ● 6 Check scans 14│ Unreadable pages      2   [Fix →]         │ └─────────────────┘ │
│ ○ 7 Mark         │  Missing pages         0   ✓               │  ◀ prev   next ▶    │
│ ○ 8 Match students│ Boxes to check       12   [Review →]      │                     │
│ ○ 9 Export marks │                                           │  ⭳ Download  ↗ Open │
│ ○ 10 Annotate    │ Next: Mark (after these are resolved)     │                     │
│ ──────────────── │                                           │                     │
│ ⚙ Exam settings  │                                           │                     │
│ ? Guide          │                                           │                     │
└──────────────────┴───────────────────────────────────────────┴─────────────────────┘
```

- **Top bar:**
  - the school logo and name, if set;
  - a breadcrumb (Exams / exam name);
  - the exam's state (Draft, Layout to check, Ready to print, Printed and locked, Marked, Results exported);
  - the theme switch and the account menu (with "Switch to Classic style").
- **Step sidebar:** ten steps in two groups. Each shows ✓ done, ● needs attention (with a count), ○ not started, or 🔒 locked.
- **Work area:** the current step. It always starts with a short "What to do here" box that can be collapsed, and ends with the next action.
- **Preview panel:** section 10. It can be resized, maximised and closed, and it remembers its width.
- **Exam dashboard:** the start page, replacing the projects list (section 9).

### Before the exam

| Step | The teacher | The page shows | Done when |
|---|---|---|---|
| **1 Questions** | Writes and edits questions | LaTeX editor today, the form editor later (#4). A live preview of the paper sits in the preview panel, and errors are explained in plain words with a link to the line | The source compiles without errors |
| **2 Marking scheme** | Sets scoring rules and the answer key | The marking panel (section 8): defaults, per-question rules, final mark conversion, answer key. Stays editable after printing | The scale has been extracted and shows a total |
| **3 Papers** | Chooses the number of copies, builds the final papers and checks the layout | Number of copies with a "print a few spare copies" hint; builds the question paper, answer key and catalogue; preview of each document. Templates that print names on the papers ask for the class list here. Building runs **layout detection automatically**. Then a **"Check the layout"** prompt shows the detected corner marks, boxes and name field over each page, lists any layout warnings, and asks the teacher to confirm "Looks correct". Rebuilding the papers clears the confirmation. A locked exam skips the check | Papers built and the layout confirmed |
| **4 Print** | Saves the PDF to print elsewhere, or prints on the shared machine's printer (Linux shared machines only) | Opens once the layout is confirmed; before that it explains why and links to the check. Both methods side by side where direct printing is available (section 7). The exam locks afterwards (section 6) | Saved for printing, printed, or marked as printed |

### After the exam

| Step | The teacher | The page shows | Done when |
|---|---|---|---|
| **5 Upload scans** | Uploads the scanned answer sheets | Drag-and-drop upload with progress per file; scan options (photocopied sheets, several scans of one copy). Each page is then detected automatically: corner marks found, page and copy identified, boxes read | Every uploaded page has been processed |
| **6 Check scans** | Fixes what detection couldn't settle | Three lists: **unreadable pages** (with likely causes: rotation, resolution, wrong exam) to fix or delete; **missing pages** in a copy; **boxes to check**, which AMC wasn't sure about (a faint mark, a crossed-out answer, a bubble filled badly). The review queue shows each box zoomed, with keyboard shortcuts to accept or flip it. Detection sensitivity (the two thresholds) sits under "Advanced" | All three lists are empty (every item fixed or accepted) |
| **7 Mark** | Computes the marks | A checklist from step 6. "Compute marks" is enabled once it's clear; "Mark anyway" exists behind a warning listing what's unresolved. Marking always re-reads the latest marking scheme and answer key. Afterwards, answers that break the rules, such as two ticks on a single-answer question, are listed with a link to the page | Marks computed with the latest scan corrections and marking scheme |
| **8 Match students** | Links each answer sheet to a student | Class list import (CSV) with a preview of the columns; choosing which column matches the student code on the sheet; automatic matching; then a manual queue showing each sheet's name box next to a searchable class list | Every sheet matched to a student (or marked as not in the list) |
| **9 Export marks** | Gets the marks out | A sortable marks table with a histogram; export to CSV or ODS (options: absent students, statistics, ticked boxes), previewed in the panel; the public marks link; later email (#7) and item analysis (#6) | Marks exported |
| **10 Annotate** | Produces marked answer sheets | How sheets are annotated (where the marks appear, header text) and how they are saved: one PDF per student or one for the class, file name pattern, include the question paper or the corrected answer key, keep existing files. "Preview one student" shows a sample in the panel before generating all; then download all | Annotated sheets generated |

Steps stay reachable in any order. For example, step 8 can be opened before the exam to load the class list early. A step that depends on an earlier one shows an empty state, such as "No scans yet. Scans come after the papers are printed. [Go to Print]".

Changing the marking scheme or answer key after step 7 marks steps 7, 9 and 10 as "out of date", with a "Recompute marks" button. Correcting a box in step 6 does the same.

## 6. Locking an exam after printing

### States

```
 Draft ──build papers──▶ Layout to check ──"Looks correct"──▶ Ready to print
   ▲                          ▲                                  │
   │                          └──── rebuild papers ◀─────────────┤
   │                                                             │ save for printing /
   │                                                             │ print / "Mark as printed"
   │                                                             ▼
   └──────── Unlock (typed confirmation, data removed) ◀──── Locked ──scans arrive──▶ Locked (in progress)
```

The layout check happens only before the first print. Once locked, the layout can't change, so there is nothing to re-check.

### What can change once locked

| Allowed (doesn't move anything on paper) | Blocked (would make printed sheets unreadable) |
|---|---|
| Marking scheme: defaults and per-question scoring | Question text, answer text, order, layout options |
| Answer key corrections: which answers are correct, within the question's type | Adding or removing questions or answers |
| Neutralising a question: give everyone full marks, or don't count it | Changing a single-answer question into a multiple-answer one (AMC can print these differently) |
| Final mark conversion: maximum mark, rounding, granularity | Number of copies; rebuilding the question paper |
| Annotation settings, class list, export options | LaTeX engine and other build settings |

### How it works

- **Lock triggers:**
  - saving the papers "for printing" (the pendrive route);
  - sending them to a printer;
  - the "Mark as printed" button, for any other route.

  Opening or downloading a document to look at it in step 3 doesn't lock.
- **Lock record:** the app's existing print time, plus our own record of who locked the exam and when, stored with the project.
- **Banner:** a locked exam shows "Printed on 5 Nov by Priya. Questions and layout are locked. You can still change the marking scheme and correct the answer key."
- **Read-only editor:** the LaTeX editor becomes read-only. Answer key and scoring changes go through the marking panel, which edits only the scoring and correct/wrong macros in the source.
- **Server enforcement:** the server refuses saves, rebuilds, copy-count changes and build settings on a locked exam. A stale browser tab, a second teacher or the Classic style can't bypass the lock.
- **Safety check on save:** when a locked exam's source is saved, the server compares the old and new source. Any difference outside the allowed macros (`\scoring{…}`, `\scoringDefaultS/M{…}`, `\correctchoice` ↔ `\wrongchoice` and the French `\bonne` ↔ `\mauvaise`) is refused with an explanation. It's a cheap text comparison, with no compile needed.
- **Re-marking:** after an allowed change, step 7 shows "The answer key changed. Recompute marks?", which runs Mark with "Update marking scale". The change is recorded in the exam's activity list.
- **Unlocking:** "Unlock to edit questions" opens a dialog listing exactly what will be lost: "64 scanned pages, 30 matched students and computed marks will be removed. Printed papers will no longer match." The teacher types the exam name to confirm.

## 7. Printing

| Save for printing elsewhere (every system) | Print on the shared machine (Linux only) |
|---|---|
| Choose the range of copies, then download the print-ready PDF files to take on a pendrive. This is the existing "print to files", made clearer | Pick a printer attached to the shared machine and the range of copies. Shows the queue and lets the teacher cancel jobs. The printer list, queue and cancel already exist |

- **Print checklist:** both routes show it before the file or job is produced: paper size A4, print at 100% (no "fit to page"), single- or double-sided as the template expects, and corner marks fully visible. A wrong scale is the most common reason scans fail later.
- **Direct printing is Linux only.** On a Linux shared machine, the app connects to the machine's own print system (CUPS), and a new launcher command, `./amc printer`, sets that up. On macOS and Windows, saving PDFs is the only route: the Print step shows just that option, and `./amc printer` explains why.

## 8. Marking scheme and answer key panel (#3)

```
┌ Marking scheme ────────────────────────────────────────────────────────────┐
│ Defaults                                                                   │
│   Single-answer questions   [ 1 point, no penalty           ▾]             │
│   Multiple-answer questions [ Proportional, wrong ticks −  ▾] Advanced ▸   │
│ Final mark                                                                 │
│   Out of [20]   Rounding [nearest ▾]   Steps of [0.5]   Blank sheet [0]    │
│ Questions                                          Total: 24 points → /20  │
│   Q1  Newton's 2nd law      single    A ✓ B C D     1 pt   (default)  ✎    │
│   Q2  Units of force        multiple  A ✓ B ✓ C D   2 pts  custom     ✎    │
│   Q3  Free fall             single    A B C ✓ D     1 pt   ⚠ neutralised    │
└────────────────────────────────────────────────────────────────────────────┘
```

- **Defaults:** presets for common rules, such as "1 point, no penalty", "1 point, −0.25 for a wrong answer", "all or nothing" and "proportional". They're written as AMC's `\scoringDefaultS` / `\scoringDefaultM`. An "Advanced" field accepts any AMC scoring strategy for teachers who know the syntax.
- **Per question:** override the scoring, correct the answer key by clicking answers (single-answer questions keep exactly one correct answer), or neutralise a question.
- **Final mark:** moves here from Settings (maximum mark, rounding, granularity, mark for a blank sheet).
- **Totals:** taken from AMC's own extracted scale, so what the panel shows is what AMC will compute.
- **Where questions come from:** the panel reads them from the source, understanding AMC's standard macros. A question written with unusual LaTeX is shown read-only with an "edit in LaTeX" link. Once the form editor (#4) exists, the panel reads its data directly.
- **After printing:** the panel stays fully usable. This is the "only the marking scheme and answer key can change" rule from section 6.

## 9. Exam dashboard, new-exam wizard and template gallery (#2)

**Dashboard.** One card per exam showing its name, class and subject, date, a state chip ("Draft", "Printed", "Checking scans: 14 to review", "Marked", "Exported") and the next action. It has search and filters (class, state, date) and lets teachers archive old exams. Class, subject and date are kept in a small file of our own next to the AMC project, because AMC doesn't store them.

**New-exam wizard:**
1. Name, class, subject and date.
2. Pick a template.
3. Answer sheet style (on the question paper or separate) and number of copies.
4. Create, which opens step 1.

```
┌ Choose a template ─────────────────────────────── [English ▾] [⌕ search] ┐
│ ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐                   │
│ │ ▤▤▤▤▤▤▤▤ │  │ ▤▤▤▤▤▤▤▤ │  │ ▤▤▤▤▤▤▤▤ │  │ ▤▤▤▤▤▤▤▤ │                   │
│ │ ▤▤▤  ▢▢▢ │  │ ▢▢▢▢ ▢▢▢ │  │ ▤▤▤▤▤▤▤▤ │  │ ▤▤ ▢▢ ▢▢ │                   │
│ └──────────┘  └──────────┘  └──────────┘  └──────────┘                   │
│ Simple        Separate       Scoring       Nominative                    │
│ 1 page        answer sheet   examples      sheets                        │
│        Click a card: full PDF in the preview panel · [Use this template] │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Previews:** each template is compiled once and its PDF and first-page thumbnail are cached for everyone. This happens on first use or when the image is built, and in shared mode the compile runs in the sandbox.
- **Contents:** AMC's English and French templates, plus our own school templates kept in this repo. School templates can use the school name and logo from branding (section 12). Later, teachers can "save an exam as a template", and admins can publish templates to all teachers.
- **Security:** template ids keep going through the existing `template_path()` check.

## 10. Preview panel

- **What it shows:**
  - Documents: question paper, answer key, catalogue, corrected copies.
  - Layout check pages and LaTeX logs.
  - Scanned pages with their detected boxes (used by step 6).
  - Annotated sheets, with previous/next student and search by name.
  - Exported marks: CSV as a sortable table; ODS as a download with a table preview of the same data.
  - Class list files before import.
- **Controls:** resize by dragging, maximise to the full width, open in a new tab, download, close. The panel remembers its width. Below about 1280 pixels it opens over the work area instead of beside it.
- **PDF viewing:** start with the browser's built-in viewer, as today. If teachers need the same controls in every browser (page thumbnails, search), we bundle PDF.js locally later.

## 11. Step-by-step guide

- **"What to do here":** every step starts with 3 to 5 bullet points, collapsible and remembered per user.
- **Full guide:** opens in the preview panel. Each step's page covers what it is for, how to do it, and common problems with fixes (for example "Pages not recognised: scan at 300 dpi, check the print was at 100%, use photocopy mode for photocopied sheets").
- **Exam checklist on the dashboard:** progress through the ten steps and the single next action, such as "Next: check 14 scan problems".
- **Short first-run tour:** points out the sidebar, preview panel and guide. It can be skipped and replayed from the Guide menu.
- **Editable content:** the guide is written in Markdown files in this repo (`server/guide/en/`), so teachers can improve it without touching code.

## 12. Classic style and branding

### Classic and new style

- **Choosing a style:** every teacher can pick "New style" or "Classic style". The choice is saved per teacher, and a switch sits in both styles: the account menu in the new style, a small bar in Classic.
- **First visit:** after the new style ships, a teacher's first visit asks "Try the new style?" A Classic user sees a dismissible "Try the new style" bar.
- **Same data underneath:** both styles work on the same exams, and switching opens the same exam where possible.
- **Classic as upstream made it:** Classic gets no new features. The lock still applies there, because the server enforces it, and Classic shows the server's explanation.
- **Cost:** low. Classic is upstream's page, kept at `/classic` anyway; the switch adds a per-teacher setting, a redirect and a small bar. If it causes trouble, we drop the choice and keep `/classic` as a plain fallback link.
- **Decision:** whether to discontinue Classic is decided after phase 6.

### Branding

- **Neutral by default.** Admins get an "Appearance" page with:
  - **School name**, shown in the top bar, on the sign-in page and in the browser tab.
  - **Logo**, as an image upload (PNG, JPEG or SVG).
  - **Colour palette:** suggested automatically from the logo's main colours, or picked from presets or a colour picker. The app derives the full palette for light and dark themes and checks text contrast, so a pale logo colour can't make buttons unreadable. There is a live preview and "Reset to neutral".
- **Where it's stored:** with the app's data, outside any exam, and included in `./amc backup`.
- **Sign-in page:** it belongs to the separate sign-in service, so it fetches the logo and colours from a public, read-only address.
- **Admin rights:** in shared-machine mode, admins are the sign-in service's admins. Their admin flag reaches the app the same way the username does, and the proxy strips any copy sent by a browser. In single-user mode, the local user can edit branding.

## 13. Further recommendations

1. **Background jobs with progress:** compiling, reading scans, marking and annotating show progress in the step header and as notifications instead of blocking the screen. Teachers can keep working or switch steps while a job runs.
2. **Plain-language errors:** LaTeX errors are shown as a short message plus "show details" (log in the preview panel) and "go to line".
3. **Activity list per exam:** "Printed by Priya, 5 Nov", "Answer key changed for Q3, marks recomputed". This helps on a shared machine and when a student questions a mark.
4. **Consistent confirmations:** destructive actions say exactly what will be lost, with counts. The riskiest ones (unlock, delete exam) need the exam name typed.
5. **Unsaved-changes guard and autosave** of the source draft. Building the official papers stays an explicit action.
6. **Settings split three ways:**
   - exam settings, under the exam;
   - personal preferences (theme, style, guide boxes), under the account menu;
   - administration (accounts, appearance, shared templates), admins only.
7. **Keyboard support:** Ctrl/Cmd+S to save, and single-key shortcuts in the scan review and matching queues.
8. **Accessibility:** WCAG AA contrast (also enforced for school colours), visible focus, everything reachable by keyboard, labels on icon buttons.
9. **Links to every exam and step** (for example `/exam/physics-midterm/check-scans`), so refresh, back and bookmarks work.
10. **Export or archive an exam as a zip** from the dashboard, alongside the existing `./amc backup`.

## 14. Technical approach

- **New code in new files:**
  - `server/ui.py`, a Flask blueprint for the new pages, the exam status summary, lock actions, branding, the style switch and the template gallery;
  - `server/templates/ui/`;
  - `server/static/ui/` (stylesheet with design tokens, JavaScript modules).
- **Upstream files touched (kept small, listed in each MR):**
  - `server/amc.py`: register the blueprint, move upstream's page to `/classic`, and add lock checks in the existing build, save, copy-count and settings handlers.
  - `server/templates/index.html`: the Classic style's switch bar.
  - Translation catalogues: new strings.
- **Our own existing files:**
  - `auth/` gets branding on the sign-in pages and passes the admin flag;
  - `caddy/Caddyfile` strips a browser-sent admin flag;
  - the launcher gets `./amc printer`.
- **Reuse, don't rewrite, the server side:** the new interface calls the existing Socket.IO events and AMC commands. New JSON endpoints are added only where the new screens need data the old HTML fragments don't provide. The first is an exam status summary: documents built, print time and lock, pages scanned, unreadable, missing and to check, marks computed and out of date, students matched, exports and annotated files.
- **No build step:** plain JavaScript modules and CSS custom properties, the same style as upstream. Libraries are vendored into the repo (nothing fetched at runtime), and the Docker build and `./amc start` stay as they are.
- **Tests:**
  - Browser tests for the new screens, reusing upstream's Selenium harness, run in both modes (single user, and shared machine with sign-in).
  - The lock and its server-side refusals get dedicated tests, including from the Classic style.
  - Upstream's own browser tests (`tests/`) keep running against `/classic` to check the server side.
- **Translations:** every new string goes through the existing translation system, in English.

## 15. Phases

Each phase is one branch and one merge request. Sizes are relative (S, M, L).

| Phase | Delivers | Issues | Size |
|---|---|---|---|
| **0 Design sign-off** | A clickable prototype (static HTML in `doc/design/`, opened in a browser) of the shell, a step page, the check-scans step, the locked banner, the gallery, the marking panel and the appearance page | #1 | S |
| **1 Shell, design system, style switch** | Top bar, step sidebar with live statuses, work area, generic preview panel, light and dark themes, links per exam and step, exam status endpoint. Existing screens hosted in the new shell and restyled; Classic style at `/classic` with the per-teacher switch | #1 | L |
| **2 Dashboard, wizard, gallery, branding** | Exam dashboard with states and filters, new-exam wizard, template gallery with cached previews, the admin Appearance page, branding on the sign-in page | #2 | M |
| **3 Guided steps** | All ten step pages with "What to do here", empty states, next actions, the "out of date" logic, the dashboard checklist, guide content and the first-run tour | #1 | M |
| **4 Layout check, print and lock** | Automatic layout detection and the "Check the layout" confirmation; print step with both routes and the print checklist, opened by the confirmation; lock after printing with server enforcement and source comparison; unlock flow; activity list; `./amc printer` for Linux shared machines | new | L |
| **5 Marking scheme panel** | Marking scheme and answer key panel, final mark settings, neutralising questions, the recompute prompt | #3 | M |
| **6 Scans, matching and results** | Check-scans review queue with shortcuts; mark checklist with "Mark anyway"; class-list import preview and manual matching queue; marks table and histogram; CSV table view; annotation settings with "Preview one student" and the annotated sheets browser | #1 | L |

After phase 6: decide whether to discontinue the Classic style.

Later, plugging into the same steps:
- the form question editor (#4) and question bank (#5) go in step 1;
- item analysis (#6) and email (#7) go in step 9;
- tablet support.

## 16. Risks

| Risk | Mitigation |
|---|---|
| AMC team interface changes won't appear in the new style automatically | Review their front-end changes at each update merge; keep our changes to upstream files small; keep Classic until the decision |
| Teachers' LaTeX varies, and the marking panel can't understand everything | Support AMC's standard macros; show anything else read-only with "edit in LaTeX"; the form editor (#4) removes this problem for new exams |
| Lock bypassed by editing LaTeX directly or from Classic | Enforced on the server, plus the source comparison on every save of a locked exam |
| Direct printing needs a Linux shared machine with a working print system | Saving PDFs works everywhere; `./amc printer` checks the setup and says what's missing |
| A school colour makes text hard to read | The palette is derived and contrast-checked; "Reset to neutral" |
| Browsers' built-in PDF viewers differ (Safari) | Test the main browsers in phase 1; switch to bundled PDF.js if needed |
| Phases 1, 4 and 6 are large | Each is split into smaller commits behind the Classic fallback; nothing is removed until its replacement works |

## 17. Still open

Nothing. Testing on the real shared machine is tracked in #8.
