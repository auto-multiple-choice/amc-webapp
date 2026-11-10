# Tests for the new interface

Run them from the repository root.

## Icons

```
python3 tests-ui/check_icons.py          # check
python3 tests-ui/check_icons.py --write  # rewrite server/templates/ui_icons.html
```

The app's icon file only keeps icons named in `server/templates/*.html`, so icons used from `server/static/ui/app.js` are listed in `ui_icons.html`. Run the check after adding an icon; a missing one shows as a black square.

## Server logic

`test_ui_logic.py` checks the parts of `server/ui.py` that don't need a running app:
- the lock's "does this change move anything on the printed paper?" comparison;
- writing the default scoring into LaTeX and AMC-TXT sources;
- the results helpers: match states, student names from the class list, which files can be uploaded as a class list, the fingerprint that tells when marks are out of date, and the CSV export's settings passed to AMC (decimal mark, separator, class list columns);
- the marking scheme panel (`server/ui_scale.py`): question maximums the way AMC computes them, reading questions from LaTeX and AMC-TXT, and answer key and scoring edits;
- branding: the contrast-checked palette, logo file types, and the starters' school header.
- the version history (`server/ui_vcs.py`): a git repository per exam outside the teacher's folder, change sets (a builder save is one version), the "changed meanwhile" check, changes made outside the app, restoring one file, the whole exam or one change (with a three-way merge, refused when changes overlap), undoing a restore, built and named versions, a planted `.gitattributes` or `.git` config that does nothing, copies (in and outside the app) and renames, the conversion of the old `.history/` folders, a damaged repository started again, the trash (restore under a free name, removal after 30 days) and the audit log; and the changes in words (`server/ui_changes.py`) for questions, the paper design and other files.
- questions kept in items (`server/ui_items.py`): pools.tex read, added to, moved in, removed from and renamed; item names and paths; an item's questions in its section; pools counted by element (a set is one), inline exams too; the item-file check; and splitting an exam (items per `\element`, sets kept together, figures moved and renamed, a file that only held questions removed, questions outside sections left in place), the two starters included.
- LaTeX for pro users (`server/ui_latex.py`): braces and environments that don't balance (escaped braces, `\verb`, comments and verbatim ignored), a log's first error traced to the item's file and line, the one-question check document, a section document split back (changed, missing, doubled separators refused), the preamble's macros; and a question written inline getting its LaTeX replaced, refused when it doesn't balance, holds two questions or takes a used name.
- question banks (`server/ui_banks.py`): where banks live and which names they can have, `bank.json` read tidied, items placed and ordered in groups, free group names, the bank list, a second bank of the same name refused, question names changed where they clash (and swapped), fingerprints, the random pick, tags, the macros and packages an item needs found and added to an exam once, and a bank's own history and trash; copies (the way in and back exactly, every status, merges, names a newer version adds, macros defined differently); the search index (`server/ui_bankindex.py`: prefixes, accents, filters, a file changed by hand read again, archived items, a damaged index rebuilt, what is typed can't break the query), usage (an exam printed again counts once, "not printed since"), the exams holding a copy; bank zips (`server/ui_bankzip.py`: only a bank's kind of files, names climbing out, absolute names and links refused, a folder at the top, size limits unpacked), a bank's history in a git bundle (a broken one refused), and the names of imported banks; question statistics (`server/ui_stats.py`: share right, separation, answers chosen by the strongest and weakest, the notes, too few copies, a summary over exams, an exam marked again replacing its figures) and blueprints (rows checked, drawn without repeats, rows short of questions in words); who changed each line (blame), a log over several files, and `./amc doctor` (sound histories, a damaged one, one whose bank is gone).
- the question editor (`server/ui_questions.py`): the spans the parser finds (text, answers, choices, numeric, explanation, figure, `\element` groups) and every edit operation, including where new questions go;
- saving the papers (`server/ui_print.py`): a separate answer sheet found in the sources (LaTeX package option, AMC-TXT, comments ignored), each copy's question pages and answer sheet pages, the copies cut with qpdf into two folders (a copy named by its student, one that can't be cut left whole, no half-made files), and the zip with its folders;
- emailing results (`server/ui_mail.py`): addresses and class list cells, finding the email column, AMC's codes in the message, one-line headers whatever is typed, the PDF attached, the admin's settings checked (password kept, removed, never sent back; mode 600), each teacher's daily count, and sending through a small SMTP server (signing in, a refused address and a wrong password in words);
- the annotated sheets' symbols and key (`server/ui_legend.py`): AMC's settings read back as a preset, the default and custom choices, refused schemes, and the key stamped once on each file, with a file whose key failed left for the next run.

It runs with the app's image:

```
docker run --rm -v "$PWD/server:/s:ro" -v "$PWD/tests-ui/test_ui_logic.py:/t.py:ro" \
  --entrypoint /venv/bin/python amc-web /t.py
```

## End to end, in a real browser

`e2e.mjs` drives headless Chrome through the app:
- creates an exam from a template;
- edits, saves and builds the question paper;
- checks the step sidebar, the preview panel and the unsaved-changes warning;
- renames, duplicates and deletes the exam;
- confirms the layout, sets the default scoring and the final mark;
- saves the PDFs for printing, which locks the exam, and checks that the server refuses changes that would move things on the printed papers while allowing answer key corrections;
- unlocks the exam;
- switches the theme.

It needs Node 22 or later and Google Chrome (set `CHROME=/path/to/chrome` if it isn't in the usual place).

**Use a test copy of the app with an empty data folder, never your real exams.** The tests create and delete exams, and the branding test resets the appearance. Each test first checks that nothing of yours is in the way (an exam with a test name, real branding, or any exam at all for the dashboard test) and refuses to run otherwise; `AMC_E2E_FORCE=1` overrides that. An exam a test made is deleted even when the test fails midway.

### Single computer

```
mkdir -p /tmp/amc-test-data
AMC_DATA_DIR=/tmp/amc-test-data AMC_PORT=8095 \
  docker compose -p amctest -f docker-compose.yml -f docker-compose.override.yml up -d --build
node tests-ui/e2e.mjs http://127.0.0.1:8095 /tmp/amc-test-shots
docker compose -p amctest down
```

### Shared machine (sign-in and HTTPS)

Start a separate stack with `compose.login.yml` and `AMC_SITES=https://localhost:8096` (see `./amc` for the other variables), create an account with `flask user add` in the `amc-auth` container, then:

```
AMC_E2E_USER=tester AMC_E2E_PASS='…' node tests-ui/e2e.mjs https://localhost:8096
```

With `AMC_E2E_PRINTER=1`, the test prints on the app's printer instead of saving PDFs (the app must see a print system, as after `./amc printer on`).

Screenshots are saved to the folder given as the second argument, if any.

### Scans

`e2e-scans.mjs` tests Upload scans and Check scans:
- it makes an exam with two pages per copy, builds and locks it;
- it makes realistic scans with `make_scans.py`, which renders AMC's question paper and draws marks at the box positions AMC recorded, including faint marks AMC is unsure about, a blank page and a copy with a page left out;
- it uploads the scans through the page and works through unreadable, missing and uncertain pages.

```
node tests-ui/e2e-scans.mjs http://127.0.0.1:8095 /tmp/amc-test-shots
```

It also checks the upload parts that big uploads go in (`/ui/api/upload-part`). With `AMC_E2E_PARTS=1`, the scans themselves go up in 8 KB parts, the way uploads over 64 MB do on a public server.

### Print

`e2e-print.mjs` tests Save PDFs for an exam with a separate answer sheet (the blank starter, asking for it under the package's other name, `ensemble`): the choice shown and on by default, with each part's pages; a range with none of the exam's copies refused, without locking the exam; the zip with `question-papers/` and `answer-sheets/`, a file of the right pages per copy, named after the exam; no zip for an exam with nothing saved, or for an address that climbs out of the saved papers; "One PDF per copy" saved for the exam and giving whole copies; and an exam with the answers on the question paper, which has nothing to separate, even with another LaTeX file in its folder that asks for a separate answer sheet. It writes into the exam's folder with `docker exec` and needs `curl`.

```
node tests-ui/e2e-print.mjs http://127.0.0.1:8095 /tmp/amc-test-shots
```

### Public server

`check_public.py` checks the tunnel site of public server mode (`./amc public on`, `doc/public-hosting.md`) without a browser or Cloudflare: it runs in the `amc-auth` container and talks to `caddy:8091` the way `cloudflared` does. It checks sign-in, that failed sign-ins count per visitor address (`CF-Connecting-IP`) and ignore the browser's `X-Forwarded-For`, the live connection's allowed origin, the cache headers and the host name. It makes a temporary account and deletes it.

```
docker compose exec -T amc-auth python - amc.example.org < tests-ui/check_public.py
```

### Results

`e2e-results.mjs` tests Mark, Match students, Export marks and Annotate:
- it makes a 4-copy exam with student code boxes (`\AMCcodeGridInt`), and scans with the codes filled in, one page left out and two boxes ticked on a single-answer question;
- **Mark:** "Mark anyway" past the missing page, the rule-breaking answer and its link to the page, "out of date" after a final mark change, and recomputing;
- **Match students:** loading a class list, automatic matching, matching by hand with the keyboard, moving a student to another sheet, "Not in the class list" and "Back to automatic";
- **Export marks:** the table, histogram, sorting and search, CSV (previewed) and ODS files, and the shareable link; the CSV's decimal point and commas by default with the class list's columns (roll number, email), then a decimal comma with semicolons and a column left out;
- **Annotate:** previewing one student, annotating all sheets, previous/next in the preview, the zip download, and "out of date" after a settings change: the student's name in the header (`%(name) %(surname)`), also for an exam matched by hand before that was fixed (it removes AMC's `key_in_list` to check); "Clear in black and white" symbols by default, written to the teacher's AMC settings; the key on each page, once, also after annotating again; "AMC's colours" and a custom shape;
- **Email results** (with `AMC_E2E_SMTP` and `AMC_E2E_MAILPIT`, a [Mailpit](https://mailpit.axllent.org) SMTP sink the app can reach): setting up Email sending with a test email before saving, the password never sent back, the email column found, who can and can't get an email, the old annotated sheets flagged, the preview with the codes filled in as the text is typed, a test to the teacher that records nothing, sending to each student (sender, reply-to, subject and the PDF checked in Mailpit), the statuses, and the daily limit stopping a round;
- the exam's history.

```
node tests-ui/e2e-results.mjs http://127.0.0.1:8095 /tmp/amc-test-shots
```

For the email checks, add a Mailpit container to the test copy's compose project (image `axllent/mailpit`, its web port published, say, on 8027) and point the test at it:

```
AMC_E2E_SMTP=mailpit:1025 AMC_E2E_MAILPIT=http://127.0.0.1:8027 node tests-ui/e2e-results.mjs http://127.0.0.1:8095 /tmp/amc-test-shots
```

With `AMC_E2E_KEEP=1`, the test exam is kept afterwards, to look at it.

### Question banks

`e2e-banks.mjs`: a bank made from the Question banks page, a group and questions added and edited with the form, difficulty and tags kept, the bank's History; an RJ-style file imported (its `\element` group, a figure moved and renamed, a macro to the preamble); then in an exam from the blank starter: a whole group as a new section (heading, both questions, a clashing name renamed, where each copy came from), ticked questions into a section with the macro and package they need, a random pick shown then added with its figure; the paper builds; a question saved into a new group of the bank, the copy updated in the bank without a duplicate, a section saved as a group, the whole exam saved as a new bank (a group per section); a bank deleted to the Trash and restored with its history.

```
node tests-ui/e2e-banks.mjs http://127.0.0.1:8095 /tmp/amc-test-shots
```

`e2e-copies.mjs`: copies of bank questions in an exam. A group with a default scoring added from the picker (which says so); three copies up to date, a question the exam has refused a second time; an edit in the bank shown as "Bank updated" above the questions and in the list, compared, and taken (the scoring given on the way in kept, one version); an edit in the form shown as "Edited here", and "Update the bank's copy" (the bank gets the text without that scoring, a version in its History); edits on both sides combined, then the same line changed on both sides finished by hand (a save with the marks left refused); "Keep this exam's"; a section offering a question its group gained ("Add it"), then "Not these", and a question deleted from the bank; a macro the exam defines differently flagged with both definitions; the paper builds; once printed, a bank version changing the text refused and an answer key fix taken, and the group's new questions no longer offered.

```
node tests-ui/e2e-copies.mjs http://127.0.0.1:8095 /tmp/amc-test-shots
```

`e2e-search.mjs`: finding questions and moving banks. A bank of five questions in two groups: the bank page's filters (words as prefixes with the search box keeping the focus, a difficulty, a tag); a question archived (kept, shown dimmed); in an exam, "From a bank" hiding it until "Archived too", its search filtering the group, a whole group added without it; the paper printed, the copies counted as used with the exam, "Never printed" leaving them out, the item listing the exams that printed it and hold a copy; the search of all banks finding a question and opening it in its bank; the bank downloaded as a zip and imported again as a separate bank with its history; a file that isn't a zip refused.

```
node tests-ui/e2e-search.mjs http://127.0.0.1:8095 /tmp/amc-test-shots
```

`e2e-stats.mjs`: blueprints and question statistics. A bank of five questions (two easy, two medium, one hard); an exam's section filled by a blueprint in "From a bank" (the pick shown first, with a row short of questions, then added; the blueprint kept for the section); 12 copies printed and scanned with chosen answers (copies 7-12 strong, 1-6 weak, one question whose key looks wrong); marked; AMC's answer numbers checked to follow the source; the share right and separation of each question, its answers named from the source and the notes in words, in the Mark step; and the figures kept with the bank's questions and shown there.

```
node tests-ui/e2e-stats.mjs http://127.0.0.1:8095 /tmp/amc-test-shots
```

### History extras

`e2e-history-extras.mjs`: who changed each line of an item (a click opening that version); changes side by side; a version's file downloaded from a plain link; "Build this version" (a PDF, and its text read in the container: the version's, not today's); the history of one section (a save of the main file left out), also in the panel; "With history" downloaded and imported again as an exam (every version, the last named "Imported …", no `history.bundle` left behind); an archive with a planted `.git` (at the top and in an item) and a dot-folder imported from the Exams page's "Import an exam…" without them; `./amc doctor`'s check.

```
node tests-ui/e2e-history-extras.mjs http://127.0.0.1:8095 /tmp/amc-test-shots
```

### Editor extras

`e2e-editor-extras.mjs`: Duplicate (a copy with a new name right after it, the same question, one version); a question dragged onto another (real drag events); the scoring dialog offering the preamble's `\def\exactS{b=3,m=-1}` and using it by name; with enough questions for two pages and the paper built, "In the paper" opening the preview at the question's page, then following another question picked (the section shuffles, so its page is asked for); a section drawing 5 of 13 questions and the Papers step saying the copies differ; a section dragged before another in Paper design; a bank's question dragged into another group; the exam saved as a template (in "My templates", with a preview), offered in the wizard with a way to delete it, a new exam made from it (the same sections and questions, a history of its own), and the template deleted.

```
node tests-ui/e2e-editor-extras.mjs http://127.0.0.1:8095 /tmp/amc-test-shots
```

### LaTeX for pro users

`e2e-latex.mjs`: the Form | LaTeX switch on an item (completion on, a save with an unclosed brace refused with its line, "Check this question" compiling it with a picture, the save, a failing check pointing at its line, leaving the question saving what was typed, the choice remembered after a reload); a section edited as one document (reordered, an item added after "what will happen", a changed separator refused); a build error traced to the item's file, line and question, and "Open it"; and a question written inline in an AMC template exam, renamed through its LaTeX. In shared mode the check runs in the sandbox; a check that `\input`s another teacher's file fails without showing it.

```
node tests-ui/e2e-latex.mjs http://127.0.0.1:8095 /tmp/amc-test-shots
```

### Questions in items

`e2e-items.mjs`: a new exam from the blank starter keeps its questions in items listed by `pools.tex`; the form edits an item's file, adds a numeric question as a new item after the selected one, moves an item down and up, and deletes it (History keeps it); Paper design counts items and adds one to a section; a question can't take a name another item uses; the paper builds, and the marking scheme panel reads each question from its item file; after printing, items can't be added but an answer key can still be corrected. Then an exam made from AMC's Groups template is split into items (same questions, same sections, same pools), builds, and the split is undone from History.

```
node tests-ui/e2e-items.mjs http://127.0.0.1:8095 /tmp/amc-test-shots
```

### Version history and trash

`e2e-history.mjs` tests History and the Trash: versions kept on each save and grouped into editing sessions, what a version changed (in words and line by line), what changed since and the differences between any two versions, restoring one file and undoing that restore, naming a version, "built OK" after a build, a save that conflicts with another tab (keep mine, load theirs), the unsaved text kept in the browser across a reload, a deleted file brought back, the whole exam restored to its first version, the main source that can't be deleted, the exam zip without any history, `/fs` refusing the server's own folder, and an exam deleted to the Trash and restored with its history. It ends with issue #15: a Paper builder design emptied, seen as a picture, restored with its layout in one version, and the restore undone. `deleteExam()` in `cdp.mjs` also removes the test's exam from the Trash.

```
node tests-ui/e2e-history.mjs http://127.0.0.1:8095 /tmp/amc-test-shots
```

### Question editor

`e2e-editor.mjs` tests the form in the Questions step: reading the template's questions; editing the text (with the KaTeX preview), answers, the answer key, scoring, explanation, name and type; adding (numeric), moving and deleting questions; a question the form can't read; "Edit in LaTeX" and back; a stale edit after another tab changed the source; what stays editable after printing; and an AMC-TXT exam, which keeps the LaTeX tab only. The other browser tests open the LaTeX tab (`qtab: 'latex'` in `cdp.mjs`).

```
node tests-ui/e2e-editor.mjs http://127.0.0.1:8095 /tmp/amc-test-shots
```

### Paper design

`e2e-design.mjs` tests Questions › Paper design: an exam from the blank starter through the wizard; sections (heading, questions per copy, columns, shuffle, a pool too small, add, add a question to a section, move, rename, remove and give back); versions, a value out of range; the build; History; read-only after printing. Then an exam from AMC's "simple" template, whose questions are written in the paper, organised into a section. The logic checks in `test_ui_logic.py` cover `ui_structure.py` on the blank starter.

```
node tests-ui/e2e-design.mjs http://127.0.0.1:8095 /tmp/amc-test-shots
```

### Paper builder

`e2e-builder.mjs` tests Questions › Paper builder on an exam from the RJ Style Paper Builder: the wizard (kind of paper, layout, details, versions, no class); the canvas (a block's settings and width, a typed setting saved without redrawing, the row's settings under the block with a gap typed, a width the row has no room for, blocks and rows moved, rows added and removed, a block's type changed); the answer sheet's checks and a build refused by them; the Instructions, Details and Versions and page tabs (an item with its preview, a detail escaped for LaTeX, 30 versions with codes past Z, the kind of paper); the page breaks between sections; the layout file written from the design, edited by hand, kept or rewritten; the build; History; read-only after printing. The logic checks in `test_ui_logic.py` cover `ui_builder.py`: codes, presets, refusals, the checks and the generated LaTeX.

```
node tests-ui/e2e-builder.mjs http://127.0.0.1:8095 /tmp/amc-test-shots
```

### Marking scheme panel

`e2e-marking.mjs` tests the per-question panel: the answer key, preset and own rules, "all or nothing", neutralising (full marks, not counted) and back, totals, the read-only editor and allowed corrections after printing, and an AMC-TXT exam. `e2e-results.mjs` also checks that the panel's points equal AMC's after marking, and that a "not counted" question drops out of the total.

### Dashboard and new-exam wizard

`e2e-dashboard.mjs` needs a copy of the app with **no exams**. It creates exams through the wizard (a starter with a separate answer sheet and code boxes, which it builds, and one of AMC's AMC-TXT templates), then checks the dashboard: state, next step, progress, search, filters, sort, archive, and editing the class, subject and date.

### Guide and tour

`e2e-guide.mjs` opens the guide from the dashboard and inside an exam, follows its links, checks that the step boxes come from it, and walks through the first-run tour (start, replay, Escape). The other tests mark the tour as seen, so it doesn't cover their pages.

### Branding

`e2e-branding.mjs` sets a school name, a logo (it makes a PNG) and colours on the Appearance page, checks the top bar, browser tab and colours, the public branding addresses, an exam from a starter that prints the name and logo, and "Reset to neutral". In shared-machine mode, run it with an admin account to also check the sign-in page, and with `AMC_E2E_NOT_ADMIN=1` and a teacher's account to check that changes are refused.

### Notes for all

The scans and results tests run `make_scans.py` in the app's container with `docker exec`. They find the container from the address they test (the compose project publishing that port; in shared-machine mode that is caddy's, and they take its `amc-web` service); `AMC_E2E_CONTAINER` names it directly. `AMC_E2E_USER`/`AMC_E2E_PASS` sign in first, as above.

`make_scans.py` takes options as JSON (faint marks, blank page, missing page, student codes, double ticks); see the top of the file. `fixtures.mjs` has the shared setup (a printed exam, test scans) and `cdp.mjs` the small Chrome driver.
