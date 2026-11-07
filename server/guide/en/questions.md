# Questions

## What to do here

- Write each question with its answers, and mark which answers are correct.
- Save, then build the preview to see the question paper on the right.
- If the build fails, the message explains why and links to the LaTeX log.

## What this step is for

The questions live in a source file, written in LaTeX or in AMC's plain-text format (AMC-TXT). AMC turns it into the question paper, with a box beside each answer.

## How to do it

In **LaTeX**, a question with one correct answer looks like this:

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

In **plain text**, start a single-answer question with `*`, a multiple-answer one with `**`, a correct answer with `+` and a wrong one with `-`.

1. Edit the source in the editor.
2. Save with the button or Ctrl+S (Cmd+S on a Mac).
3. Press **Build preview**: the question paper appears in the preview panel.
4. To use an image or another file, add it with **Add a file**, then refer to it by its exact name.

Once the exam is printed, the questions are read-only. Correct the answer key and scoring in [Marking scheme](guide:marking-scheme).

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
