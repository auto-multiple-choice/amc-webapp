# New style: prototype (phase 0)

A clickable mock-up of the new interface, for agreeing on the layout, the flow and the look before the real work starts. It follows [the redesign plan](../ui-redesign-plan.md).

It runs entirely in the browser with made-up data. It doesn't talk to AMC, and nothing you click changes a real exam.

## Open it

Open `doc/design/prototype.html` from your copy of the repository in Chrome, Edge, Firefox or Safari:

- macOS: `open doc/design/prototype.html`
- Linux: `xdg-open doc/design/prototype.html`
- Windows: double-click the file

GitLab doesn't display HTML pages, so open it from a local copy.

## What to try

- **Dashboard:** exam cards with their state and next step. Click **New exam** to walk through the wizard and the template gallery.
- **The ten steps:** open the Physics mid-term exam and click through the sidebar.
- **Before the exam:**
  - Use **Prototype controls** (bottom of the screen) to set the exam state to *Draft*.
  - In **Papers**, build the papers, check the layout and confirm **Looks correct**.
  - In **Print**, save the PDFs and see the exam lock.
- **After printing:**
  - **Questions** is read-only, with **Unlock to edit questions…** (type the exam name to confirm).
  - **Marking scheme** stays editable: click answers to correct the key. Saving after marking marks the results "out of date".
- **Check scans:** fix unreadable pages and review uncertain boxes with the <kbd>T</kbd>, <kbd>N</kbd> and <kbd>→</kbd> keys.
- **Mark:** blocked until Check scans is clear, with **Mark anyway…** behind a warning.
- **Match students, Export marks, Annotate:** manual matching, the marks table and histogram, annotation settings with a one-student preview.
- **Preview panel:** drag its left edge to resize, maximise it, or close it with the button in the top bar.
- **Appearance** (account menu): school name, logo with colours suggested from it ("Try a sample logo"), presets, and the contrast check.
- **Theme:** the moon button switches between the computer's setting, light and dark.
- **Prototype controls:** turn off "Shared machine runs Linux" to see Print offer only saving PDFs.

## Files

| File | Role |
|---|---|
| `server/static/ui/ui.css` | The design system: colour tokens (light, dark, branding), layout and components. Phase 1 reuses it as is. |
| `doc/design/prototype.html`, `prototype.js`, `prototype.css` | The mock-up: screens, made-up data and drawn papers. Not used by the app. |
| `doc/design/prototype-selftest.js` | Clicks through a whole exam and reports PASS/FAIL. Open `prototype.html?selftest=1` and scroll to the bottom. |

Icons come from the Iconoir set already bundled with the app (`src-icons/iconoir.css`).
