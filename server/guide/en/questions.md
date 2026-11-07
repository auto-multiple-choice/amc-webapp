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
- **Details:** the exam name, organiser, level, date, time and maximum marks, typed once and printed wherever a block or the footer uses them; whether the paper has a **level** and a **class** at all (off, no block prints them: no level box or footer level, no class boxes, no class grid on the answer sheet), the registration number's prefix and digits, and the size of the boxes a student writes in (7mm square unless changed).
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

## Questions in their own files

An exam made in the app keeps each question in its own file, `items/<name>/item.tex`, with its figures beside it. A question that shares a text or a figure with others (a passage and its questions) is one item, a **set**: its questions stay together and are drawn as one. `pools.tex` lists which items each section draws from, in order. The paper prints the same as when the questions were written in the main file.

In the form, **Add**, the arrows and **Delete** add, move and delete items; moving past the first or last question of a section moves it into the next one. **Edit in LaTeX** opens the question's own file. An older exam, or one made from one of AMC's templates, keeps its questions in its main file: **Move questions into item files** (under the list of questions) moves them, figures included, in one step that History can undo. Question banks will take questions from these files.

## Quicker editing

- **Drag and drop**: drag a question in the list onto another to put it before that one, or onto a section's heading to put it at the end of that section. Sections in Paper design and a bank's questions (between groups too) move the same way. The arrow buttons still work, with the keyboard too.
- **Duplicate** (above a question kept in an item file): a copy with a new name, right after it, ready to change.
- **In the paper**: opens the built question paper in the preview at the page where the question's boxes are on the first copy. While the preview shows the question paper, it follows the question you pick.
- **The scoring dialog** offers the scoring rules your preamble defines as macros (`\def\exactS{b=3,m=-1}`), by name.
- **Save as a template** (Exam settings) keeps the exam's questions, sections, paper and settings, without scans, marks or history; **New exam › My templates** starts from it. Delete a template from there.

## Question banks

Your **question banks** (top right, next to the Guide) keep questions to use again, in **groups** (Algebra, Geometry…), the way an exam keeps them in sections. Only you see your banks.

- **From a bank…** (above the list of questions, or on a section in Paper design) adds questions to this exam: a whole group as a new section (its title becomes the heading, its instructions and default scoring come along), a whole group into a section, the questions you tick, or a number of them picked at random from the group's questions this exam doesn't have yet (shown first, then added as shown). The exam gets **copies**: changing them doesn't change the bank. A question whose name the exam already uses gets a new name in the copy, and a question the exam already has isn't added twice. The group's default scoring goes to the questions without their own (or to every question, if you tick it). Macros and packages the questions need come into the exam's preamble; a macro the exam already defines differently is shown with both definitions, and the exam keeps its own.
- **Save to a bank…** copies questions the other way: one question (above it in the form), a whole section (in Paper design, as a group), or the whole exam as a new bank with a group per section (Exam settings). A question that came from that bank can update the bank's copy or be saved as a new one.
- Both only work on questions kept in item files; an older exam first needs **Move questions into item files**.

Each copy shows whether it still matches its bank question: **Up to date**, **Bank updated** (the bank's question changed since), **Edited here** (this exam's copy changed), **Both changed**, or **Not in the bank any more**. Copies that changed are listed above the questions (**Review…**) and marked in the list; **Compare…** (on the question, or in that list) shows what changed and offers:

- **Take the bank's version**: the copy becomes the bank's question again, with the same new names and scoring it got when it was added.
- **Update the bank's copy**: the bank's question becomes this exam's version (a new version in the bank's History). Other exams with a copy then see "Bank updated".
- **Keep this exam's**: the bank's newer version isn't offered again; the copy shows "Edited here".
- **Combine both**: when both changed, the changes of each side are kept. Where both changed the same lines, the text opens with the two versions marked to choose by hand.

Nothing changes until you choose. Once the exam is printed, only answer key and scoring fixes can be taken from a bank. A section made from a whole group says when the group gains questions (**Add them to the section** or **Not these**), or when one of its questions was removed from the group, until the exam is printed.

On a bank's page the questions are edited with the same form, LaTeX view and History as in an exam; each one also has a difficulty and tags. **Import LaTeX…** reads files whose questions are `\element{group}{…}` blocks (like the RJ question files), with their figures. A deleted bank goes to the Trash for 30 days.

**Finding questions.** Above a bank's questions, and in **From a bank…**, a search box and filters narrow the list: words of the question, its title or tags (the start of a word is enough: *quadr* finds *quadratic*), difficulty, kind, tag, and **never printed** or **not printed for 3 months / a year**. A random pick draws from the questions the filters show. The **Question banks** page searches all your banks at once; a click opens the question in its bank.

- A question counts as **used** when an exam with a copy of it is printed (or marked as printed), not when it is added: a question dropped before printing doesn't count. A bank's question shows which exams printed it and which hold a copy now; the list shows how many times it was printed.
- **By a blueprint** in **From a bank…**: rows such as "3 easy from Algebra" and "5 medium from any group" (difficulty, group and tag, each optional). **Pick** draws the questions at random once, from those this exam doesn't have, and shows them (with the rows that couldn't be filled) before **Add to the exam**. The blueprint is kept for the section and offered again next time.
- After an exam is marked, a bank's question shows how it did: the share right and how well it separated strong from weak students, over every exam marked with a copy of it (see Mark › How each question did).
- **Archived**: a question you don't want to offer any more. It is hidden from **From a bank…** (tick **Archived too** to see it) and left out when a whole group is added; exams that have it, and History, keep it.
- **Download as a zip** (in the bank's **⋯** menu) saves the bank with its history; **Import a bank…** on the Question banks page reads such a zip as a new bank of your own, to move a bank between your computer and a server, or to give a colleague a copy. The zip is checked first: only a bank's kind of files are taken.

## LaTeX for those who prefer it

Every question has a **Form | LaTeX** switch above it. **LaTeX** shows the question's own LaTeX: the item's file (for a set, all its questions), or, in an exam written in one file, the question from `\begin{question}` to `\end{question}`. The choice is remembered, so the questions keep opening in LaTeX.

- **Save** (or Ctrl+S, or leaving the question) writes it. A save whose braces or environments don't balance, or that gives a question a name already used, is refused with the line, and nothing is written. After printing, only the answer key and scoring can change, as in the form.
- **Check this question** compiles what is typed, saved or not, alone with the exam's preamble, in a few seconds. It shows how the question prints, or the error at its line (click the line to go there).
- Typing a backslash offers AMC's environments (`question`, `questionmult`, `questionmultx`, `choices`…) and the exam's own macros; question names are offered too.
- In Paper design, **Edit as LaTeX** on a section opens all its questions as one document, each starting at a line `%%%% item <name> %%%%`. Move those lines to reorder; add one with a new name to add a question. Saving first says what will change. A missing or changed separator line is refused, never guessed.
- When a build fails, the Questions step names the file, the line and the question (`items/alg-018/item.tex, line 5`), and **Open it** opens that question's LaTeX there.

## Earlier versions

Every save is kept as a version of the exam, for good: who saved it, when, and what changed. A save that touches several files (the Paper builder writes the design and its layout) is one version. **History** (in the bar above the editor, in Paper design and in the Paper builder) lists the versions; saves made close together by the same person are grouped into one editing session, which opens with a click. The version the question paper was last built from is marked **built OK**, and printing names the version that was printed.

Click a version to see what it changed, in words ("q3: answer B made correct", "Question paper: row 2 removed") and line by line, with the changed words highlighted. The list above the changes can show instead what changed since that version, or the differences with any other version. For the Paper builder's design, **Picture of the design** draws it as the builder does.

Three ways to go back, each asking first and saying what will change:

- **Restore the exam to this version**: every file comes back as it was, so files that belong together (the design and its layout, the questions and the paper) come back together.
- **Restore only this file**: one file comes back; the others stay as they are.
- **Undo this change**: only what that version changed is taken back; later changes stay. If the same lines were changed again later, the app says so and changes nothing.

Each restore is itself a new version, so it can be undone the same way. **Name this version** gives a version a name ("Checked by the head of department") to find and compare with later. A file deleted with **Delete** stays in History and can be restored from there; the exam's main source file can't be deleted. A file changed outside the app (by the desktop app, or copied in) is kept as a version "Changed outside the app" before the next change.

**More in History:**

- **Who changed each line**: with a file chosen at the top, this view shows the file with, beside each run of lines, who changed it last, when, and in which version (a click opens that version).
- **Side by side**: the changes with the old lines on the left and the new ones on the right.
- **Build this version**: compiles the exam as it was in that version, in a scratch folder, and shows the PDF. Nothing in the exam changes; use it to see what an older version looked like before restoring it.
- **The history of a section**: in Paper design, **History** on a section lists only the versions that changed its questions.
- **With history** (at the top of History) downloads the exam as a zip with its whole history. **Import an exam…** on the Exams page reads such a zip, or any AMC project archive, as a new exam; the history comes along. Hidden folders in an archive (such as `.git`) are left out.

Text typed but not saved is kept in your browser: if the page is closed by accident, the editor offers it back the next time the file is opened.

## Common problems

**The build fails.** It's usually a LaTeX error. Open the log from the message: the line number shows where. Common causes are a missing closing brace `}` and a special character used without a backslash: write `\%`, `\&`, `\#` and `\_`.

**An image doesn't appear.** Add the image file with **Add a file**, and use exactly the same name in `\includegraphics{...}`.

**"Leave without saving?"** You changed the source without saving. Save first, or leave and lose the changes (the unsaved text is still offered back the next time you open the file).

**A file was broken or deleted.** Open **History**: pick the version marked **built OK**, or the one from before the change, and restore the file or the whole exam. A restore can be undone.

**An exam was deleted by mistake.** Deleted exams go to the **Trash** (on the Exams page) for 30 days, with their history. Restore it from there.

**"This file was changed since you opened it."** The same file was saved from another tab or by another teacher. Keep your version (theirs stays in History), or load theirs (your text is kept as unsaved text).
