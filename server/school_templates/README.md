# Starter templates

Templates of our own for the new-exam wizard, next to AMC's (in
`/usr/share/auto-multiple-choice/models`). Each folder is an AMC project:
`description.xml` (title and text shown in the gallery), `options.xml`
and the source.

When an exam is created from one, the server replaces these lines in the
source (`server/ui.py`, `starter_source()`):

- `%%AMCUI:SCHOOL%%`: the school name and logo from Appearance, or nothing;
- `%%AMCUI:IDENTITY%%`: the name field, with student code boxes when the
  teacher asks for them (LaTeX);
- `%%AMCUI:OPTIONS%%`: AMC-TXT header lines (code boxes, separate answer
  sheet).

The gallery's previews are compiled from these folders when the Docker
image is built (`server/ui_gallery.py`).
