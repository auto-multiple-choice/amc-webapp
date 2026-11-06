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
- the results helpers: match states, student names from the class list, which files can be uploaded as a class list, and the fingerprint that tells when marks are out of date;
- the marking scheme panel (`server/ui_scale.py`): question maximums the way AMC computes them, reading questions from LaTeX and AMC-TXT, and answer key and scoring edits;
- branding: the contrast-checked palette, logo file types, and the starters' school header.

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

### Results

`e2e-results.mjs` tests Mark, Match students, Export marks and Annotate:
- it makes a 4-copy exam with student code boxes (`\AMCcodeGridInt`), and scans with the codes filled in, one page left out and two boxes ticked on a single-answer question;
- **Mark:** "Mark anyway" past the missing page, the rule-breaking answer and its link to the page, "out of date" after a final mark change, and recomputing;
- **Match students:** loading a class list, automatic matching, matching by hand with the keyboard, moving a student to another sheet, "Not in the class list" and "Back to automatic";
- **Export marks:** the table, histogram, sorting and search, CSV (previewed) and ODS files, and the shareable link;
- **Annotate:** previewing one student, annotating all sheets, previous/next in the preview, the zip download, and "out of date" after a settings change;
- the exam's history.

```
node tests-ui/e2e-results.mjs http://127.0.0.1:8095 /tmp/amc-test-shots
```

With `AMC_E2E_KEEP=1`, the test exam is kept afterwards, to look at it.

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
