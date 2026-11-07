# Questions

## What to do here

- Pick a question on the left and change it in the form: its text, answers, which answers are correct, scoring. Changes are saved as you type.
- Add, move and delete questions with the buttons. Build the preview to see the question paper on the right.
- **Paper builder** lays out the paper. On an exam made with the RJ Style Paper Builder: rows and columns of blocks for the question paper and the answer sheet, the instructions, the details printed on the paper. On any exam: the sections (which questions are printed, how many per copy, shuffled or not) and the versions.
- Prefer LaTeX? The **LaTeX** tab edits the source itself; **Edit in LaTeX** jumps to the question.

## What this step is for

The questions live in a source file, written in LaTeX or in AMC's plain-text format (AMC-TXT). AMC turns it into the question paper, with a box beside each answer. The form reads and writes that file, so the desktop app and the LaTeX tab always see the same questions.

## The form

- **Type:** single answer (one box to tick), multiple answers (any number), or numeric (students write a number in digit boxes).
- **Question** and **answers** are LaTeX: write maths between `$` signs, for example `$x^2 + 1$`; the preview under the text shows it as students will read it. Tick the correct answer (single) or answers (multiple).
- **Numeric:** the correct number, and AMC's options for the boxes: `digits=3` (three digits), `decimals=1` (one decimal place), `sign=true` (a sign box), `scoreexact=2` (points for the exact answer).
- **Explanation:** printed on the answer key only.
- **Figure:** insert an image file; it goes under the question text.
- **Name:** how the question is called in the marks (letters, digits, `.`, `_`, `-`). **Scoring:** the question's own rule, if it shouldn't follow the default from [Marking scheme](guide:marking-scheme).
- A question written in a way the form can't read (a macro, two `\scoring` commands) is listed with a warning: open it with **Edit in LaTeX**.

## Paper builder

The **Paper builder** tab lays out the paper. It changes the exam's files like the form does, and every change goes to History.

**Sections.** A section is a group of questions printed together, under a heading. For each one:

- **Questions per copy:** all of them, or fewer. With fewer, each copy draws its own questions from the section: "15 of 18 per copy" prints 15 questions chosen among 18. A warning shows when a section has fewer questions than it should print.
- **Shuffle** the questions in each copy, **columns** (1 to 4), **start on a new page**.
- **Page breaks**, for the whole paper, above the list: each section after the first **starts on a new page** or **continues after the previous section**, and a box says whether the first section starts on a new page or follows the header and instructions on the same page. The choice is kept when a section is added, moved or removed. A section's own **start on a new page** can still differ; the panel then says how many start on a new page.
- **Heading** and **instructions** printed above the questions.
- **Add a question** to a section opens it in the form. **Add a section**, move sections up and down, rename or remove one. A removed section's questions stay in the source and are listed as not printed, with a button to give them a section again.
- In an exam written by hand (AMC's own templates, for example), a heading printed above a section in the LaTeX stays as it is; a heading set here is printed in addition.
- An exam whose questions are written directly in the paper, outside any section, shows **Organise into a section**: the questions are moved into one section, unchanged, so they can be counted and shuffled.

**The paper.** On an exam made from AMC's templates or the blank starter, the layout of the paper (its header, instructions and answer sheet) is edited in the LaTeX tab; the sections are printed where the file inserts them. A paper whose instructions carry a line per section (between `%%AMCUI:SUMMARY%%` markers) has **Update the line per section**, which rewrites those lines from the sections' counts and marks.

**Versions.** A paper can be printed in a few versions (A, B, C…), each drawing its own questions from the sections; the copies are photocopied from them, and the app's number of copies follows. When you upload the scans, say that the sheets were photocopied.

### The RJ Style Paper Builder

An exam created from the **RJ Style Paper Builder** composes its paper here, from blocks laid out in rows and columns the way a web page is, and keeps the design in `paper.json`.

- **Question paper** and **Answer sheet** tabs show the page as rows. A row is split into columns on a 12-column grid: a column takes a fixed share ("8 of 12"), **auto** (what is left, shared equally) or **fit** (as wide as its content, for a logo or the paper code). Each column holds one block, with a border (dashed, solid or none), an alignment and a padding; a row can align its columns and draw its boxes at the same height. Click a block to change it on the right; the row's own settings (how its columns line up, the same height for all its boxes, the gap between them and the space after the row) are shown under the block. Drag blocks between columns and rows, or use the buttons. **Add a row** offers a few splits.
- **Blocks** on the question paper: logo, title lines, student details (name, registration number in boxes, class, level), paper code, exam information, labelled box, instructions, text in LaTeX, the questions (the sections, in order), line, space, page break, end of paper, rough-work pages. On the answer sheet: student details (AMC's name field), ID and class grids that AMC reads, signatures, numeric answers (each question's grid with its number on top, side by side, a set number to a line), choice answers or all answers, and the same logo, title, code and text blocks.
- **Instructions:** a list of LaTeX items with a preview, a heading, the bullet style, and **the line per section**, made from the sections' counts and marks.
- **Details:** the exam name, organiser, level, date, time and maximum marks, typed once and printed wherever a block or the footer uses them; the registration number's prefix and digits, and the size of the boxes a student writes in (7mm square unless changed).
- **Versions and page:** the kind of paper (answers on the question paper, or a separate answer sheet), the versions and their codes (letters A, B… then AA, AB…, numbers, or none), margins, borders, question numbers, the footer pattern (`Level {level} // Code {code} // Page {page}`; a segment whose detail is empty is left out) and the same number of pages in every copy.
- The builder writes `paper-layout.tex` from the design, at each change and before each build. Edit that file by hand and the builder asks whether to keep your changes (it then stops writing the file) or rewrite it. A design that can't be printed (no Questions block, an answer sheet without answer boxes or a name field) is flagged, and the build waits until it is fixed.

Once the exam is printed, the Paper builder is read-only.

## In LaTeX

A question with one correct answer looks like this:

```
\begin{question}{capital}
  What is the capital of France?
  \begin{choices}
    \correctchoice{Paris}
    \wrongchoice{Lyon}
    \wrongchoice{Marseille}
  \end{choices}
\end{question}
```

For a question that can have several correct answers, use `questionmult` instead of `question`. Each question needs its own name (here `capital`).

In **plain text** (AMC-TXT), start a single-answer question with `*`, a multiple-answer one with `**`, a correct answer with `+` and a wrong one with `-`. AMC-TXT exams use the LaTeX tab only.

1. Edit the source in the editor.
2. Save with the button or Ctrl+S (Cmd+S on a Mac).
3. Press **Build preview**: the question paper appears in the preview panel.
4. To use an image or another file, add it with **Add a file**, then refer to it by its exact name.

Once the exam is printed, the questions are read-only: only the correct answers and scoring can still change, here or in [Marking scheme](guide:marking-scheme).

## Earlier versions

Every time a source file is saved, the version it replaces is kept. **History** (in the bar above the editor) lists them with who saved them and when; the version the question paper was last built from is marked **built OK**. Click a version to see what changed since, and **Restore this version** to make it the file again (the file as it is now is kept too).

A file deleted with **Delete** also goes to History and can be restored from there. The exam's main source file can't be deleted. Versions from the last 7 days are kept; a file that hasn't changed for longer keeps its last 12 versions.

Text typed but not saved is kept in your browser: if the page is closed by accident, the editor offers it back the next time the file is opened.

## Common problems

**The build fails.** It's usually a LaTeX error. Open the log from the message: the line number shows where. Common causes are a missing closing brace `}` and a special character used without a backslash: write `\%`, `\&`, `\#` and `\_`.

**An image doesn't appear.** Add the image file with **Add a file**, and use exactly the same name in `\includegraphics{...}`.

**"Leave without saving?"** You changed the source without saving. Save first, or leave and lose the changes (the unsaved text is still offered back the next time you open the file).

**A file was broken or deleted.** Open **History**: pick the version marked **built OK**, or the one from before the change, and restore it.

**"This file was changed since you opened it."** The same file was saved from another tab or by another teacher. Keep your version (theirs stays in History), or load theirs (your text is kept as unsaved text).
