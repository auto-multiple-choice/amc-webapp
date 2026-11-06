#!/usr/bin/env python3
"""Make test scans for an exam whose papers are built.

Renders the question paper (DOC-sujet.pdf) and draws a mark in one answer
box per question, at the positions AMC recorded in its layout database.
A few cases need a person, as real scans do:

- copies 1 and 2: the first mark on page 1 is faint (between "empty" and
  "ticked"), so AMC is unsure about that box;
- a blank page AMC can't read;
- the last copy's last page is left out (an incomplete copy).

Run inside the app's container (it has pdftoppm and Pillow):
  /venv/bin/python make_scans.py "/amc-web/files/MC-Projects/<exam>" /tmp/scans

Prints a JSON summary of what was drawn.
"""
import json
import os
import sqlite3
import subprocess
import sys

from PIL import Image, ImageDraw

DPI = 150
TICK = 0.55    # share of the box area filled for a clear tick
FAINT = 0.08   # share filled for a faint mark: AMC then measures about 15% dark,
               # next to its lower threshold (it measures inside the box border)


def fill(draw, box, scale, share):
    xmin, xmax, ymin, ymax = box
    sx, sy = scale
    cx, cy = (xmin + xmax) / 2 * sx, (ymin + ymax) / 2 * sy
    half_w = (xmax - xmin) * sx * share ** 0.5 / 2
    half_h = (ymax - ymin) * sy * share ** 0.5 / 2
    draw.rectangle([cx - half_w, cy - half_h, cx + half_w, cy + half_h], fill=0)


def main():
    pdir, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    tmp = os.path.join(out, "_render")
    os.makedirs(tmp, exist_ok=True)
    subprocess.run(["pdftoppm", "-r", str(DPI), "-gray", "-png",
                    os.path.join(pdir, "DOC-sujet.pdf"), os.path.join(tmp, "p")], check=True)
    rendered = sorted(f for f in os.listdir(tmp) if f.endswith(".png"))

    db = sqlite3.connect(os.path.join(pdir, "data", "layout.sqlite"))
    pages = db.execute("SELECT student, page, subjectpage, width, height "
                       "FROM layout_page ORDER BY student, page").fetchall()
    last_student = max(p[0] for p in pages)
    last_page = max(p[1] for p in pages if p[0] == last_student)

    drawn, files = [], []
    for student, page, subjectpage, width, height in pages:
        if student == last_student and page == last_page and last_page > 1:
            continue  # leave out: an incomplete copy
        img = Image.open(os.path.join(tmp, rendered[subjectpage - 1])).convert("L")
        scale = (img.width / width, img.height / height)
        draw = ImageDraw.Draw(img)
        boxes = db.execute("SELECT question, answer, xmin, xmax, ymin, ymax FROM layout_box "
                           "WHERE role=1 AND student=? AND page=? ORDER BY question, answer",
                           (student, page)).fetchall()
        questions = {}
        for q, a, *coords in boxes:
            questions.setdefault(q, []).append((a, coords))
        for n, (q, answers) in enumerate(sorted(questions.items())):
            a, coords = answers[(student + q) % len(answers)]
            faint = student in (1, 2) and page == 1 and n == 0
            fill(draw, coords, scale, FAINT if faint else TICK)
            drawn.append({"student": student, "page": page, "question": q,
                          "answer": a, "faint": faint})
        name = f"scan-{student:03d}-{page}.png"
        img.save(os.path.join(out, name))
        files.append(name)

    blank = Image.new("L", img.size, 255)
    blank.save(os.path.join(out, "scan-blank.png"))
    files.append("scan-blank.png")
    for f in rendered:
        os.remove(os.path.join(tmp, f))
    os.rmdir(tmp)
    print(json.dumps({"files": files, "marks": drawn,
                      "missing": {"student": last_student, "page": last_page}}))


if __name__ == "__main__":
    main()
