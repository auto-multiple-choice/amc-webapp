# Questions

## What to do here

- Pick a question on the left and change it in the form: its text, answers, which answers are correct, scoring. Changes are saved as you type.
- Add, move and delete questions with the buttons. Build the preview to see the question paper on the right.
- **Paper design** sets the sections: which questions are printed, how many per copy, shuffled or not, and their headings. On an Olympiad paper it also switches parts of the paper on and off.
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

## Paper design

The **Paper design** tab lays out the paper. It changes the exam's LaTeX like the form does, and every change goes to History.

**Sections.** A section is a group of questions printed together, under a heading. For each one:

- **Questions per copy:** all of them, or fewer. With fewer, each copy draws its own questions from the section: "15 of 18 per copy" prints 15 questions chosen among 18. A warning shows when a section has fewer questions than it should print.
- **Shuffle** the questions in each copy, **columns** (1 to 4), **start on a new page**.
- **Heading** and **instructions** printed above the questions.
- **Add a question** to a section opens it in the form. **Add a section**, move sections up and down, rename or remove one. A removed section's questions stay in the source and are listed as not printed, with a button to give them a section again.
- In an exam written by hand (AMC's own templates, for example), a heading printed above a section in the LaTeX stays as it is; a heading set here is printed in addition.
- An exam whose questions are written directly in the paper, outside any section, shows **Organise into a section**: the questions are moved into one section, unchanged, so they can be counted and shuffled.

**Parts of the paper** (Olympiad paper starter). Each part can be unticked to leave it out: title lines, header boxes, instructions page, notation, table of values, rough-work pages, the same number of pages in every copy, the footer. The sections and the OMR sheet always stay. A part that is off keeps its text in the file, so ticking it again brings it back as it was. Move parts up and down; **Settings** changes their values: exam name, organiser, logos, registration digits, date and time, columns on the OMR sheet. **Update from the sections** rewrites the instructions page's line per section from the sections' counts and marks; the rest of the page is yours to edit in the LaTeX tab.

**Versions.** An Olympiad paper is printed in a few versions (A, B, C…), each drawing its own questions; the copies are photocopied from them. When you upload the scans, say that the sheets were photocopied.

Once the exam is printed, Paper design is read-only.

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
