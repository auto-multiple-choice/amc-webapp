# Papers

## What to do here

- Choose how many copies to print. Add a few spares.
- Build the papers. The layout is detected automatically.
- Check the layout in the preview, then confirm it looks correct. Printing opens after that.

## What this step is for

Building makes the final question paper, the answer key and the other documents, and records where every box is on every page. That record is what lets AMC read the scans later, so it's worth a look before printing.

**The copies differ** when a section puts only some of its questions on each copy (Paper design: "3 of 10 per copy"): they are drawn at random for each copy. The step says so; look at several copies in the preview, not only the first. The answer key and marking follow each copy.

## How to do it

1. Set the **number of copies**. Leave it empty to use the number in the source.
2. Press **Build papers**.
3. Go through a few pages of the layout in the preview panel: the corner marks are outlined in cyan, the answer boxes in green, and the name field in pink.
4. If everything is outlined, press **Looks correct**. Print opens.

Rebuilding the papers asks for the check again. Once the exam is printed, the papers can't be rebuilt.

## Common problems

**A box isn't outlined.** It was drawn without AMC's commands, for example as an image. Use `\correctchoice` and `\wrongchoice`.

**The outlines are shifted.** The LaTeX engine or a package changes the page after AMC places its marks. Choose pdflatex in Exam settings and build again.

**Layout warnings.** Each one says what's wrong. "Material outside the page" usually means a question starts too close to the bottom of a page.
