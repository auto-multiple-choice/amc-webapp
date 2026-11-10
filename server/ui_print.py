"""
Saving the papers: each copy's question paper and answer sheet apart.

For an exam with a separate answer sheet, Save PDFs gives two files per
copy, in two folders of the zip:

    question-papers/0001-questions.pdf
    answer-sheets/0001-answer-sheet.pdf

so they can be printed apart (another paper, single- or double-sided,
answer sheets first). AMC still prints one PDF per copy (it records the
print time and each copy's file); each file is then cut at the pages AMC
counts as the answer sheet: the pages with answer boxes or the name field,
the same pages its own --split uses (AMC-imprime.pl,
subjectpageForStudentA). AMC's --split isn't used because with names
printed on the papers (pre-association) it gives every part of a copy the
same file name, so the parts overwrite each other.

No Flask here: server/ui.py does the requests; tests-ui/test_ui_logic.py
checks this module.
"""

import os
import re
import subprocess
import zipfile

QUESTIONS_DIR = "question-papers"
SHEETS_DIR = "answer-sheets"

_USEPACKAGE_AMC = re.compile(r"\\usepackage\s*\[([^\]]*)\]\s*\{automultiplechoice\}")
_SEPARATE_OPTIONS = ("separateanswersheet", "ensemble")  # the package's two names for it
_TXT_SEPARATE = re.compile(r"^[ \t]*SeparateAnswerSheet:[ \t]*(.*)$", re.M | re.I)
_COMMENT = re.compile(r"(?<!\\)%.*")


def built_with_separate_sheet(value):
    """What AMC recorded when it built the papers, from the layout variable
    build:ensemble (written by the LaTeX package, "yes" or "no"): True,
    False, or None when the build left no such record."""
    return {"yes": True, "no": False}.get(value)


def has_separate_sheet(texts, plain=False):
    """Whether the sources TEXTS ask AMC for a separate answer sheet: the
    package option separateanswersheet or ensemble (LaTeX), or
    SeparateAnswerSheet (AMC-TXT). Commented-out lines don't count.

    Only for papers AMC hasn't built: built_with_separate_sheet() is what
    AMC did, however the sources ask for it (\\PassOptionsToPackage, a class
    file), and whatever other files lie in the exam's folder."""
    for t in texts:
        if plain:
            # As AMC reads it (Filter/plain.pm, parse_bool): the last such
            # line counts, and anything but nothing, 0, no or false is yes.
            values = _TXT_SEPARATE.findall(t)
            if values and values[-1].strip().lower() not in ("", "0", "no", "false"):
                return True
            continue
        t = _COMMENT.sub("", t)
        for m in _USEPACKAGE_AMC.finditer(t):
            if any(o.strip() in _SEPARATE_OPTIONS for o in m.group(1).split(",")):
                return True
    return False


# AMC-imprime.pl's two queries: a copy's pages in the question paper, and
# its answer sheet's pages (boxes AMC reads, role 1, or the name field).
COPY_PAGES_SQL = ("SELECT student, MIN(subjectpage), MAX(subjectpage) FROM layout.layout_page"
                  " GROUP BY student")
SHEET_PAGES_SQL = ("SELECT p.student, MIN(p.subjectpage), MAX(p.subjectpage) FROM layout.layout_page AS p,"
                   " (SELECT student, page FROM layout.layout_box WHERE role=1"
                   "  UNION SELECT student, page FROM layout.layout_zone WHERE zone='__n') AS a"
                   " ON p.student=a.student AND p.page=a.page GROUP BY p.student")


def page_ranges(copy_pages, sheet_pages):
    """For one copy, from its pages in the question paper (first, last) and
    its answer sheet's: the pages of the copy's own PDF (its first page is
    1) that hold the questions and the answer sheet, as qpdf page ranges.
    None when there is nothing to cut: no answer sheet, or nothing else."""
    if not copy_pages or not sheet_pages or None in copy_pages or None in sheet_pages:
        return None
    first, last = copy_pages
    a, b = sheet_pages
    if not first <= a <= b <= last:
        return None
    n = last - first + 1
    a, b = a - first + 1, b - first + 1
    questions = ([f"1-{a - 1}"] if a > 1 else []) + ([f"{b + 1}-{n}"] if b < n else [])
    if not questions:
        return None
    return {"questions": ",".join(questions), "sheet": f"{a}-{b}",
            "pages_questions": n - (b - a + 1), "pages_sheet": b - a + 1}


def _qpdf(src, pages, dest, run):
    r = run(["qpdf", src, "--pages", ".", pages, "--", dest],
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=300)
    # 3: done, with warnings
    return r.returncode in (0, 3) and os.path.isfile(dest)


def split_copies(folder, copies, run=subprocess.run):
    """Cut printed copies into FOLDER/question-papers/<name>-questions.pdf
    and FOLDER/answer-sheets/<name>-answer-sheet.pdf. COPIES: (path of the
    copy's PDF, page_ranges() or None). A copy that can't be cut stays
    whole where it is. Returns (copies cut, copies left whole)."""
    qdir, sdir = os.path.join(folder, QUESTIONS_DIR), os.path.join(folder, SHEETS_DIR)
    cut = whole = 0
    for path, ranges in copies:
        if not os.path.isfile(path):
            continue
        if not ranges:
            whole += 1
            continue
        os.makedirs(qdir, exist_ok=True)
        os.makedirs(sdir, exist_ok=True)
        stem = os.path.splitext(os.path.basename(path))[0]
        outs = [(ranges["questions"], os.path.join(qdir, f"{stem}-questions.pdf")),
                (ranges["sheet"], os.path.join(sdir, f"{stem}-answer-sheet.pdf"))]
        try:
            ok = all(_qpdf(path, pages, dest, run) for pages, dest in outs)
        except (OSError, subprocess.SubprocessError):
            ok = False
        if ok:
            os.unlink(path)
            cut += 1
        else:
            for _, dest in outs:
                if os.path.exists(dest):
                    os.unlink(dest)
            whole += 1
    for d in (qdir, sdir):
        if os.path.isdir(d) and not os.listdir(d):
            os.rmdir(d)
    return cut, whole


def zip_folder(folder, out):
    """Zip FOLDER's files into the file object OUT, with their paths inside
    FOLDER (question-papers/0001-questions.pdf, or 0001.pdf)."""
    with zipfile.ZipFile(out, mode="w") as z:
        for root, dirs, files in os.walk(folder):
            dirs.sort()
            for f in sorted(files):
                full = os.path.join(root, f)
                if os.path.isfile(full) and not os.path.islink(full):
                    z.write(full, arcname=os.path.relpath(full, folder).replace(os.sep, "/"))
