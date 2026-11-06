# Starter templates

Templates of our own for the new-exam wizard, next to AMC's (in
`/usr/share/auto-multiple-choice/models`). Each folder is an AMC project:
`description.xml` (title and text shown in the gallery), `options.xml`
and the source.

When an exam is created from one, the server replaces these lines in the
source (`server/ui.py`, `starter_source()`):

- `%%AMCUI:SCHOOL%%`: the school name and logo from Appearance, or nothing
  (LaTeX starters only: AMC-TXT has no place for a logo, and its header is
  written by AMC);
- `%%AMCUI:IDENTITY%%`: the name field, with student code boxes when the
  teacher asks for them (LaTeX);
- `%%AMCUI:OPTIONS%%`: AMC-TXT header lines (code boxes, separate answer
  sheet).

## Starters with blocks (Paper design)

A starter with a `blocks.json` (the Olympiad paper, `olympiad/`) is laid
out from Questions › Paper design (`server/ui_structure.py`). Its source
carries these markers, each on a line of its own:

- `%%AMCUI:PARAMS%%` … `%%AMCUI:END PARAMS%%`: the paper's settings, one
  `\def\amcuiName{value}` per line. `blocks.json` gives each one a label,
  a type (`text`, `latex`, `number`, `bool`, `choice`, `file`) and limits;
  `"wizard": true` asks for it in the new-exam wizard.
- `%%AMCUI:BLOCK id%%` … `%%AMCUI:END BLOCK%%`: an optional part of the
  paper. Switched off, its opening line reads `%%AMCUI:BLOCK id off%%` and
  its lines are kept, commented with `%|`. In `blocks.json`, `fixed` parts
  don't move (the OMR sheet stays last), `required` parts can't be
  switched off, and `summary` marks the part holding the instructions
  summary.
- `%%AMCUI:SECTION name%%` … `%%AMCUI:END SECTION%%`: one section, rewritten
  from the panel's fields (heading, instructions, count, shuffle, columns,
  new page). Questions belong to it by `\element{name}{...}`. A plain
  `\insertgroup{name}` without markers is also read as a section, and
  gets its markers when it is first edited.
- `%%AMCUI:SUMMARY%%` … `%%AMCUI:END SUMMARY%%`: one `\amcuiPoint{...}`
  per section, regenerated from the sections' counts and marks.

The layout macros live in a file of their own (`paper-design.tex`) that
the panel never rewrites. Icons use FontAwesome when the image has it
(`TEXLIVE_PKGS=texmf-dist-fontsextra`), Zapf Dingbats (`pifont`) otherwise.

A school name that pdflatex can't print (letters outside Latin-1, such as
Cyrillic or Devanagari) switches the new exam to XeLaTeX; the LaTeX
starters load `inputenc`/`fontenc` or `fontspec` according to the engine.

The gallery's previews are compiled from these folders when the Docker
image is built (`server/ui_gallery.py`). A starter that doesn't compile
fails the build.
