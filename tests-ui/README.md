# Tests for the new interface

Run them from the repository root.

## Icons

```
python3 tests-ui/check_icons.py          # check
python3 tests-ui/check_icons.py --write  # rewrite server/templates/ui_icons.html
```

The app's icon file only keeps icons named in `server/templates/*.html`, so icons used from `server/static/ui/app.js` are listed in `ui_icons.html`. Run the check after adding an icon; a missing one shows as a black square.

## End to end, in a real browser

`e2e.mjs` drives headless Chrome through the app:
- creates an exam from a template;
- edits, saves and builds the question paper;
- checks the step sidebar, the preview panel and the unsaved-changes warning;
- renames, duplicates and deletes the exam;
- switches the theme.

It needs Node 22 or later and Google Chrome (set `CHROME=/path/to/chrome` if it isn't in the usual place).

**Use a test copy of the app with an empty data folder, never your real exams.** The test creates and deletes exams.

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

Screenshots are saved to the folder given as the second argument, if any.
