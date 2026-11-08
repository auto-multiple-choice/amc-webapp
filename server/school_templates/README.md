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

## The paper builder's starter (`builder/`)

The RJ Style Paper Builder (`server/ui_builder.py`, `doc/features.md`)
keeps the paper's design in `paper.json` and writes `paper-layout.tex` from
it: the packages, the page and footer, the version code and the macros
`\amcuiPaperFront` and `\amcuiPaperBack` that `exam.tex` calls inside
`\onecopy` around the sections. `presets/` holds the layouts the wizard
offers (`rj-olympiad`, `simple`, `blank`; `title`, `text` and `order` are
for the wizard, the rest is a design); `paper.json` of the folder is the RJ
preset, so the gallery shows it. The gallery build writes the layout file
before compiling (`ui_gallery.py` imports `ui_builder`), and so does the
wizard when an exam is created; the exam's copy of the starter has no
`presets/` folder.

## Markers for Paper builder

Questions › Paper builder (`server/ui_structure.py`) reads and writes these
markers in a LaTeX source, each on a line of its own:

- `%%AMCUI:SECTION name%%` … `%%AMCUI:END SECTION%%`: one section, rewritten
  from the panel's fields (heading, instructions, count, shuffle, columns,
  new page). Questions belong to it by `\element{name}{...}`. A plain
  `\insertgroup{name}` without markers is also read as a section, and
  gets its markers when it is first edited.
- `%%AMCUI:SUMMARY%%` … `%%AMCUI:END SUMMARY%%`: one `\amcuiPoint{...}`
  per section, regenerated from the sections' counts and marks, when the
  paper has them.

A school name that pdflatex can't print (letters outside Latin-1, such as
Cyrillic or Devanagari) switches the new exam to XeLaTeX; the LaTeX
starters load `inputenc`/`fontenc` or `fontspec` according to the engine.

The gallery's previews are compiled from these folders when the Docker
image is built (`server/ui_gallery.py`). A starter that doesn't compile
fails the build.
