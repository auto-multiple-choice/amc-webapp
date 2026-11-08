"""
The RJ Style Paper Builder (doc/features.md): the question
paper and the answer sheet composed from rows of blocks on a 12-column
grid, the way Bootstrap lays out a web page.

The design is kept in paper.json in the exam folder (section 9 of the
plan) and this module writes paper-layout.tex from it: the packages, the
page and footer settings, the version code, and the macros
\\amcuiPaperFront (the rows before the questions), \\amcuiPaperBack (the
rows after them, the filler pages and the answer sheet) that the main
source calls inside \\onecopy. The sections stay in the main source and
are edited by ui_structure.

A row is a line of side-by-side minipages. A column's width is a fixed
share of the line ("7" of 12), "auto" (what is left, shared equally) or
"fit" (as wide as its content, measured by TeX in a box first). Each
column holds one block; blocks have a border (none, dashed, solid), an
alignment and a padding. A row never breaks across pages, except a
full-width row holding a flowing block (the questions, the instructions,
an answer area) without a border, which is printed in the normal flow.

Standard library only (ui_gallery imports it when the image is built).
"""
import copy
import hashlib
import json
import os
import re

import ui_structure as structure
from ui_questions import EditError

FORMAT = 1
DESIGN_FILE = "paper.json"
LAYOUT_FILE = "paper-layout.tex"
PRESETS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "school_templates", "builder", "presets")

KINDS = ("paper", "separate")
CODE_STYLES = {"letters": 702, "numbers": 999, "none": 999}  # the most versions each allows
BORDERS = ("default", "none", "dashed", "solid")
ALIGNS = ("left", "center", "right")
VALIGNS = ("top", "middle", "bottom")
SIZES = ("giant", "Huge", "huge", "LARGE", "Large", "large", "normalsize", "small")
STYLES = ("plain", "bold", "smallcaps", "boldsc", "italic")
BULLETS = ("arrow", "dot", "number", "none")
MARGINS = {"normal": "inner=20mm,outer=20mm,top=10mm,bottom=18mm",
           "narrow": "inner=14mm,outer=14mm,top=8mm,bottom=16mm",
           "wide": "inner=26mm,outer=26mm,top=14mm,bottom=22mm"}
QUESTION_STYLES = ("rj", "default")
FIELDS = ("exam_name", "organiser", "level", "date", "time", "max_marks")
FIELD_LABELS = {"exam_name": "Exam", "organiser": "Organiser", "level": "Level", "date": "Date",
                "time": "Time", "max_marks": "Maximum marks"}
MAX_ROWS = 60
MAX_CELLS = 8      # per row: one length register and one box each
MAX_FIT = 4
MAX_TEXT = 20000
_LETTERS = "abcdefgh"

_DIM = re.compile(r"^-?(\d+(?:\.\d+)?)(pt|mm|cm|in|ex|em|bp)$")
_MAX_MM = {"pt": 1422, "mm": 500, "cm": 50, "in": 20, "ex": 200, "em": 200, "bp": 1422}  # about 50cm, TeX's own limit is 575cm
_FILE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._ -]{0,99}$")
_ID = re.compile(r"^[a-z][a-z0-9]{0,15}$")
_TOKEN = re.compile(r"\{(exam_name|organiser|level|date|time|max_marks|code|page)\}")

# type: (title, where it may go, prints in the flow when alone in a row, defaults)
BLOCKS = {
    "logo": ("Logo", "both", False, {"file": "", "height": "18mm"}),
    "title": ("Title lines", "both", False, {"lines": [{"field": "exam_name", "size": "LARGE", "style": "boldsc"},
                                                       {"field": "organiser", "size": "large", "style": "plain"}]}),
    "student": ("Student details", "both", False, {"name": True, "id": True, "klass": False, "level": True,
                                                   "name_label": "Name", "id_label": "Reg. No.",
                                                   "class_label": "Class", "level_label": "Level"}),
    "code": ("Paper code", "both", False, {"label": "Code", "size": "Huge"}),
    "info": ("Exam information", "both", False, {"lines": ["date", "max_marks", "time"]}),
    "box": ("Labelled box", "both", False, {"label": "Level", "value": "{level}", "size": "large"}),
    "instructions": ("Instructions", "paper", True, {"heading": True}),
    "text": ("Text (LaTeX)", "both", True, {"latex": ""}),
    "questions": ("Questions", "paper", True, {}),
    "rule": ("Line", "both", True, {"thickness": "0.4pt"}),
    "space": ("Space", "both", True, {"height": "3mm"}),
    "pagebreak": ("Page break", "both", True, {}),
    "end": ("End of paper", "paper", True, {"text": "End of Question Paper"}),
    "rough": ("Rough work", "paper", True, {"pages": 2, "text": "Space for Rough Work"}),
    "id_grid": ("ID grid", "sheet", False, {"label": "Reg. No.", "orientation": "v"}),
    "class_grid": ("Class grid", "sheet", False, {"label": "Class", "orientation": "v"}),
    "signatures": ("Signatures", "sheet", False, {"lines": ["Student's signature", "Invigilator's signature"]}),
    "numeric_answers": ("Numeric answers", "sheet", True, {"columns": 4, "heading": "Mark your numerical answers here"}),
    "choice_answers": ("Choice answers", "sheet", True, {"columns": 3, "heading": "Mark your choice for the objective questions"}),
    "all_answers": ("All answers", "sheet", True, {"columns": 2, "heading": ""}),
}
FLOW = {t for t, b in BLOCKS.items() if b[2]}
ANSWER_BLOCKS = ("numeric_answers", "choice_answers", "all_answers")
# Blocks that register boxes with AMC: typeset once only, so never measured in a box.
REGISTERING = {"id_grid", "class_grid", "numeric_answers", "choice_answers", "all_answers"}
DEFAULT_ALIGN = {"title": "center", "code": "center", "box": "center", "end": "center", "id_grid": "center",
                 "class_grid": "center", "numeric_answers": "center", "choice_answers": "center",
                 "all_answers": "center", "logo": "center"}

DEFAULTS = {
    "format": FORMAT,
    "kind": "separate",
    "codes": {"style": "letters", "same_length": False, "zero_pad": False},
    "fields": {k: "" for k in FIELDS},
    "student": {"id_prefix": "", "id_digits": 3, "class_digits": 2, "box_width": "7mm", "box_height": "7mm", "klass": True, "level": True},
    "page": {"margins": "normal", "border": "dashed", "shuffle_answers": False, "question_style": "rj",
             "footer": {"pattern": "Level {level} // Code {code} // Page {page}", "align": "center",
                        "border": "dashed", "mono": True},
             "sheet_footer": None, "fill_pages": 0},
    "instructions": {"heading": "Read the following instructions carefully before attempting the question paper.",
                     "bullet": "arrow", "rule": True, "items": []},
    "paper": [],
    "answer_sheet": [],
}


# ---------------------------------------------------------------- version codes

def letters(n):
    """Spreadsheet column names: 1 = A, 26 = Z, 27 = AA, 702 = ZZ."""
    out = ""
    while n > 0:
        n, r = divmod(n - 1, 26)
        out = chr(65 + r) + out
    return out


def max_versions(codes):
    style = codes.get("style", "letters")
    if style == "letters" and codes.get("same_length"):
        return 676  # AA to ZZ
    return CODE_STYLES.get(style, 999)


def codes_table(codes, n):
    """The code printed on each version, 1 to N."""
    style = codes.get("style", "letters")
    if style == "none":
        return [""] * n
    if style == "numbers":
        width = len(str(n)) if codes.get("zero_pad") else 0
        return [str(i).zfill(width) for i in range(1, n + 1)]
    shift = 26 if codes.get("same_length") and n > 26 else 0
    return [letters(i + shift) for i in range(1, n + 1)]


# ---------------------------------------------------------------- presets

def presets():
    """The starting layouts offered by the wizard, [{id, title, text}]."""
    out = []
    if not os.path.isdir(PRESETS_DIR):
        return out
    for f in sorted(os.listdir(PRESETS_DIR)):
        if f.endswith(".json"):
            try:
                with open(os.path.join(PRESETS_DIR, f), encoding="utf-8") as fh:
                    d = json.load(fh)
            except (OSError, ValueError):
                continue
            out.append({"id": f[:-5], "title": d.get("title") or f[:-5], "text": d.get("text") or "",
                        "order": d.get("order", 99)})
    out.sort(key=lambda p: (p["order"], p["id"]))
    return [{k: p[k] for k in ("id", "title", "text")} for p in out]


def preset(pid):
    """A preset's design, normalized, or None."""
    if not re.fullmatch(r"[a-z0-9-]{1,40}", str(pid or "")):
        return None
    path = os.path.join(PRESETS_DIR, pid + ".json")
    try:
        with open(path, encoding="utf-8") as fh:
            d = json.load(fh)
    except (OSError, ValueError):
        return None
    d.pop("title", None)
    d.pop("text", None)
    d.pop("order", None)
    return normalize(d)


# ---------------------------------------------------------------- the design: checks and defaults

def _str(v, most=500, what="This text"):
    s = str(v if v is not None else "").replace("\r", "")
    if len(s) > most:
        raise EditError(f"{what} is too long.")
    return s


def _line(v, most=500, what="This text"):
    return _str(v, most, what).replace("\n", " ").strip()


def _bool(v):
    return v in (True, 1, "1", "true", "on", "yes")


def _int(v, lo, hi, what):
    try:
        n = int(str(v).strip())
    except (TypeError, ValueError):
        raise EditError(f"{what} is a whole number.") from None
    if not lo <= n <= hi:
        raise EditError(f"{what}: between {lo} and {hi}.")
    return n


def _dim(v, default, what):
    s = _line(v).replace(" ", "") or default
    m = _DIM.match(s)
    if not m:
        raise EditError(f"{what} is a length such as 3mm, 1.5cm or 2ex.")
    if float(m.group(1)) > _MAX_MM[m.group(2)]:
        raise EditError(f"{what} is too long for a page.")
    return s


def _choice(v, choices, default):
    s = str(v if v is not None else "").strip()
    return s if s in choices else default


def _latex(v, what="This LaTeX"):
    s = _str(v, MAX_TEXT, what)
    # a bare % would comment out the closing brace of the box the text goes in: "100%" is meant literally
    s = re.sub(r"(?<!\\)((?:\\\\)*)%", r"\1\\%", s)
    depth = 0
    i = 0
    while i < len(s):
        c = s[i]
        if c == "\\":
            i += 2
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth < 0:
                raise EditError(f"{what} has an unbalanced brace.")
        i += 1
    if depth:
        raise EditError(f"{what} has an unbalanced brace.")
    if re.search(r"\\(?:input|include|write|openout|immediate|catcode)(?![A-Za-z])", s):
        raise EditError(f"{what} can't use \\input, \\include or \\write here.")
    return s


def _file(v):
    s = _line(v, 120, "A file name")
    if s and not _FILE.match(s):
        raise EditError("A file name uses letters, digits, . _ and - only.")
    return s


def _block(raw, where):
    """A block with its type's defaults filled in and its values checked."""
    if not isinstance(raw, dict):
        raise EditError("A block is missing.")
    t = str(raw.get("type") or "")
    if t not in BLOCKS:
        raise EditError(f"Unknown block \"{t}\".")
    title, place, _, defaults = BLOCKS[t]
    if place != "both" and place != where:
        raise EditError(f"{title} can't go on the {'answer sheet' if where == 'sheet' else 'question paper'}.")
    b = {"type": t}
    d = {**defaults, **{k: v for k, v in raw.items() if k in defaults}}
    if t == "logo":
        b["file"] = _file(d["file"])
        b["height"] = _dim(d["height"], "18mm", "The logo height")
    elif t == "title":
        lines = []
        for ln in (d["lines"] if isinstance(d["lines"], list) else [])[:6]:
            if not isinstance(ln, dict):
                continue
            item = {"size": _choice(ln.get("size"), SIZES, "large"), "style": _choice(ln.get("style"), STYLES, "plain")}
            if ln.get("field") in FIELDS:
                item["field"] = ln["field"]
            else:
                item["text"] = _line(ln.get("text"), 300, "A title line")
            lines.append(item)
        b["lines"] = lines
    elif t == "student":
        for k in ("name", "id", "klass", "level"):
            b[k] = _bool(d[k])
        for k in ("name_label", "id_label", "class_label", "level_label"):
            b[k] = _line(d[k], 60, "A label")
    elif t == "code":
        b["label"] = _line(d["label"], 60, "The label")
        b["size"] = _choice(d["size"], SIZES, "Huge")
    elif t == "info":
        lines = []
        for ln in (d["lines"] if isinstance(d["lines"], list) else [])[:10]:
            if isinstance(ln, str) and ln in FIELDS:
                lines.append(ln)
            elif isinstance(ln, dict):
                lines.append({"label": _line(ln.get("label"), 60, "A label"), "value": _line(ln.get("value"), 300, "A value")})
        b["lines"] = lines
    elif t == "box":
        b["label"] = _line(d["label"], 60, "The label")
        b["value"] = _line(d["value"], 300, "The value")
        b["size"] = _choice(d["size"], SIZES, "large")
    elif t == "instructions":
        b["heading"] = _bool(d["heading"])
    elif t == "text":
        b["latex"] = _latex(d["latex"], "The text")
    elif t == "rule":
        b["thickness"] = _dim(d["thickness"], "0.4pt", "The line thickness")
    elif t == "space":
        b["height"] = _dim(d["height"], "3mm", "The space")
    elif t == "end":
        b["text"] = _line(d["text"], 120, "The text")
    elif t == "rough":
        b["pages"] = _int(d["pages"], 0, 10, "Rough-work pages")
        b["text"] = _line(d["text"], 120, "The text")
    elif t in ("id_grid", "class_grid"):
        b["label"] = _line(d["label"], 60, "The label")
        b["orientation"] = _choice(d["orientation"], ("v", "h"), "v")
    elif t == "signatures":
        b["lines"] = [_line(x, 60, "A signature line") for x in (d["lines"] if isinstance(d["lines"], list) else [])[:4]]
    elif t in ANSWER_BLOCKS:
        b["columns"] = _int(d["columns"], 1, 8, "Columns")
        b["heading"] = _line(d["heading"], 120, "The heading")
    return b


def _cell(raw, where, j):
    if not isinstance(raw, dict):
        raise EditError("A column is missing.")
    w = raw.get("width", "auto")
    if w in ("auto", "fit"):
        width = w
    else:
        width = _int(w, 1, 12, "A column width")
    c = {"id": str(raw.get("id") or "") if _ID.match(str(raw.get("id") or "")) else f"c{j + 1}",
         "width": width,
         "border": _choice(raw.get("border"), BORDERS, "default"),
         "pad": _dim(raw.get("pad"), "2mm", "The padding"),
         "block": _block(raw.get("block"), where)}
    c["align"] = _choice(raw.get("align"), ALIGNS, DEFAULT_ALIGN.get(c["block"]["type"], "left"))
    if width == "fit" and c["block"]["type"] in REGISTERING:
        raise EditError(f"{BLOCKS[c['block']['type']][0]} can't be sized to its content (AMC prints it once only): give it a fixed width.")
    return c


def _row(raw, where, i):
    if not isinstance(raw, dict):
        raise EditError("A row is missing.")
    cells = raw.get("cells")
    if not isinstance(cells, list) or not cells:
        raise EditError(f"Row {i + 1} has no column.")
    if len(cells) > MAX_CELLS:
        raise EditError(f"A row has at most {MAX_CELLS} columns.")
    r = {"id": str(raw.get("id") or "") if _ID.match(str(raw.get("id") or "")) else f"r{i + 1}",
         "align": _choice(raw.get("align"), VALIGNS, "top"),
         "same_height": _bool(raw.get("same_height")),
         "gap": _dim(raw.get("gap"), "2mm", "The gap between columns"),
         "after": _dim(raw.get("after"), "3mm", "The space after the row"),
         "cells": [_cell(c, where, j) for j, c in enumerate(cells)]}
    fixed = sum(c["width"] for c in r["cells"] if isinstance(c["width"], int))
    if fixed > 12:
        raise EditError(f"Row {i + 1}: the columns add up to {fixed} of 12.")
    if sum(1 for c in r["cells"] if c["width"] == "fit") > MAX_FIT:
        raise EditError(f"A row has at most {MAX_FIT} columns sized to their content.")
    if fixed == 12 and any(c["width"] != "fit" and not isinstance(c["width"], int) for c in r["cells"]):
        raise EditError(f"Row {i + 1}: the fixed columns fill the row, so there is no room for an auto column.")
    ids = [c["id"] for c in r["cells"]]
    if len(set(ids)) != len(ids):
        for j, c in enumerate(r["cells"]):
            c["id"] = f"c{j + 1}"
    return r


def _rows(raw, where):
    rows = raw if isinstance(raw, list) else []
    if len(rows) > MAX_ROWS:
        raise EditError(f"At most {MAX_ROWS} rows.")
    out = [_row(r, where, i) for i, r in enumerate(rows)]
    ids = [r["id"] for r in out]
    if len(set(ids)) != len(ids):
        for i, r in enumerate(out):
            r["id"] = f"r{i + 1}"
    return out


def normalize(raw):
    """The design with every value checked and every default filled in.
    Raises EditError for anything that can't be printed."""
    if not isinstance(raw, dict):
        raise EditError("The design isn't an object.")
    d = copy.deepcopy(DEFAULTS)
    d["kind"] = _choice(raw.get("kind"), KINDS, "separate")
    c = raw.get("codes") if isinstance(raw.get("codes"), dict) else {}
    d["codes"] = {"style": _choice(c.get("style"), tuple(CODE_STYLES), "letters"),
                  "same_length": _bool(c.get("same_length")), "zero_pad": _bool(c.get("zero_pad"))}
    f = raw.get("fields") if isinstance(raw.get("fields"), dict) else {}
    d["fields"] = {k: _line(f.get(k), 300, FIELD_LABELS[k]) for k in FIELDS}
    s = raw.get("student") if isinstance(raw.get("student"), dict) else {}
    prefix = _line(s.get("id_prefix"), 12, "The ID prefix")
    if prefix and not re.fullmatch(r"[A-Za-z0-9-]{1,12}", prefix):
        raise EditError("The ID prefix uses letters, digits and - only.")
    d["student"] = {"id_prefix": prefix, "id_digits": _int(s.get("id_digits", 3), 1, 10, "ID digits"),
                    "class_digits": _int(s.get("class_digits", 2), 1, 4, "Class digits"),
                    "box_width": _dim(s.get("box_width"), "7mm", "The width of a box"),
                    "box_height": _dim(s.get("box_height"), "7mm", "The height of a box"),
                    # the class and the level on the paper at all: off, no block prints them
                    "klass": _bool(s.get("klass", True)), "level": _bool(s.get("level", True))}
    p = raw.get("page") if isinstance(raw.get("page"), dict) else {}
    d["page"]["margins"] = _choice(p.get("margins"), tuple(MARGINS), "normal")
    d["page"]["border"] = _choice(p.get("border"), ("none", "dashed", "solid"), "dashed")
    d["page"]["shuffle_answers"] = _bool(p.get("shuffle_answers"))
    d["page"]["question_style"] = _choice(p.get("question_style"), QUESTION_STYLES, "rj")
    d["page"]["fill_pages"] = _int(p.get("fill_pages", 0), 0, 60, "Pages per copy")
    d["page"]["footer"] = _footer(p.get("footer"), DEFAULTS["page"]["footer"])
    d["page"]["sheet_footer"] = _footer(p.get("sheet_footer"), None) if isinstance(p.get("sheet_footer"), dict) else None
    ins = raw.get("instructions") if isinstance(raw.get("instructions"), dict) else {}
    d["instructions"]["heading"] = _line(ins.get("heading", DEFAULTS["instructions"]["heading"]), 300, "The heading")
    d["instructions"]["bullet"] = _choice(ins.get("bullet"), BULLETS, "arrow")
    d["instructions"]["rule"] = _bool(ins.get("rule", True))
    items = []
    for it in (ins.get("items") if isinstance(ins.get("items"), list) else [])[:40]:
        if isinstance(it, dict) and it.get("summary"):
            items.append({"summary": True})
        elif isinstance(it, dict):
            items.append({"latex": _latex(it.get("latex"), "An instruction")})
    d["instructions"]["items"] = items
    d["paper"] = _rows(raw.get("paper"), "paper")
    d["answer_sheet"] = _rows(raw.get("answer_sheet"), "sheet")
    return d


def _footer(raw, default):
    base = default or {"pattern": "", "align": "center", "border": "none", "mono": True}
    f = raw if isinstance(raw, dict) else {}
    return {"pattern": _line(f.get("pattern", base["pattern"]), 200, "The footer"),
            "align": _choice(f.get("align"), ALIGNS, base["align"]),
            "border": _choice(f.get("border"), ("none", "dashed", "solid"), base["border"]),
            "mono": _bool(f.get("mono", base["mono"]))}


def check(design, versions, files=()):
    """What the panel shows and what stops a build: [{level, text, sheet,
    row}] with level error, warning or info."""
    design = _effective(design)
    out = []
    def add(level, text, sheet=None, row=None):
        out.append({"level": level, "text": text, "sheet": sheet, "row": row})
    kind = design["kind"]
    types = lambda rows: [c["block"]["type"] for r in rows for c in r["cells"]]
    paper, sheet = types(design["paper"]), types(design["answer_sheet"])
    if paper.count("questions") == 0:
        add("error", "The question paper has no Questions block, so no question would be printed.", "paper")
    elif paper.count("questions") > 1:
        add("error", "The question paper has two Questions blocks; keep one.", "paper")
    for where, rows in (("paper", design["paper"]), ("sheet", design["answer_sheet"] if kind == "separate" else [])):
        for i, r in enumerate(rows):
            t = [c["block"]["type"] for c in r["cells"]]
            if len(r["cells"]) > 1 and any(x in ("questions", "rough", "pagebreak") for x in t):
                add("error", f"Row {i + 1}: {BLOCKS[next(x for x in t if x in ('questions', 'rough', 'pagebreak'))][0]} takes a row of its own.", where, i)
            for c in r["cells"]:
                b = c["block"]
                border = design["page"]["border"] if c["border"] == "default" else c["border"]
                if (b["type"] == "instructions" or (b["type"] == "text" and len(b["latex"]) > 2000)) and border != "none":
                    add("warning", f"Row {i + 1}: a bordered {BLOCKS[b['type']][0].lower()} block can't break across pages; take the border off if it may be long.", where, i)
                if b["type"] == "logo" and b["file"] and files and b["file"] not in files:
                    add("warning", f"Row {i + 1}: the logo file \"{b['file']}\" isn't in the exam folder, so nothing is printed there.", where, i)
                if b["type"] == "logo" and not b["file"] and not any(x["row"] == i and x["sheet"] == where and "no image" in x["text"] for x in out):
                    add("info", f"Row {i + 1}: {'the logos have' if t.count('logo') > 1 else 'the logo has'} no image yet.", where, i)
                if b["type"] == "code" and design["codes"]["style"] == "none":
                    add("warning", f"Row {i + 1}: the paper code block prints nothing while versions have no code.", where, i)
                if b["type"] == "text" and not b["latex"].strip():
                    add("info", f"Row {i + 1}: the text block is empty.", where, i)
                if b["type"] == "class_grid" and not design["student"]["klass"]:
                    add("info", f"Row {i + 1}: the Class grid prints nothing while the class is off in Details.", where, i)
                if b["type"] == "student" and not (b["name"] or b["id"] or (b["klass"] and design["student"]["klass"]) or (b["level"] and design["fields"]["level"])):
                    add("error", f"Row {i + 1}: the student details block has nothing to print; tick at least the name.", where, i)
    if kind == "paper":
        n = paper.count("student")
        if n == 0:
            add("error", "Answers on the question paper: the paper needs a Student details block, where AMC reads the student's name.", "paper")
        elif n > 1:
            add("info", "Only the first Student details block is AMC's name field.", "paper")
    else:
        n = sheet.count("student")
        if n == 0:
            add("error", "The answer sheet needs a Student details block: AMC reads the student's name there.", "sheet")
        elif n > 1:
            add("info", "Only the first Student details block on the answer sheet is AMC's name field.", "sheet")
        if "all_answers" not in sheet and not ("numeric_answers" in sheet and "choice_answers" in sheet):
            missing = [BLOCKS[t][0] for t in ("numeric_answers", "choice_answers") if t not in sheet]
            add("error", "The answer sheet needs the answer boxes: an All answers block, or Numeric answers and Choice answers"
                + (f" (missing: {', '.join(missing)})." if "all_answers" not in sheet and len(missing) < 2 else "."), "sheet")
        if "all_answers" in sheet and ("numeric_answers" in sheet or "choice_answers" in sheet):
            add("error", "All answers already prints every question's boxes, and AMC refuses boxes printed twice: remove it or the Numeric and Choice answers blocks.", "sheet")
        if any(sheet.count(t) > 1 for t in ANSWER_BLOCKS):
            add("error", "An answer block is on the answer sheet twice: AMC refuses boxes printed twice. Keep one.", "sheet")
        for t in ("id_grid", "class_grid"):
            if sheet.count(t) > 1:
                add("error", f"The {BLOCKS[t][0]} is on the answer sheet twice: AMC refuses a grid printed twice. Keep one.", "sheet")
        if versions > 1 and "id_grid" not in sheet:
            add("info", "With several versions, an ID grid on the answer sheet lets AMC match sheets to students without reading names.", "sheet")
        if "student" in paper:
            add("info", "On the question paper the student details are only written in; AMC reads the answer sheet.", "paper")
    if versions > max_versions(design["codes"]):
        add("error", f"{versions} versions: at most {max_versions(design['codes'])} with these codes.")
    return out


def digest(design):
    """A short fingerprint of the design, written in the layout file."""
    return hashlib.sha1(json.dumps(design, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()[:12]


def to_json(design):
    return json.dumps(design, indent=1, ensure_ascii=False) + "\n"


# ---------------------------------------------------------------- the LaTeX

esc = structure.latex_escape


def _fields(design, text):
    """{exam_name} and the other fields replaced by their values (escaped);
    {code} and {page} are left for the footer."""
    def sub(m):
        k = m.group(1)
        if k in ("code", "page"):
            return m.group(0)
        return esc(design["fields"].get(k, ""))
    return _TOKEN.sub(sub, esc_tokens(text))


def esc_tokens(text):
    """Escape plain text while keeping its {field} tokens."""
    parts = _TOKEN.split(text)
    out = []
    for i, p in enumerate(parts):
        out.append("{" + p + "}" if i % 2 else esc(p))
    return "".join(out)


_SIZE = {"giant": r"\fontsize{40}{48}\selectfont", "Huge": r"\Huge", "huge": r"\huge", "LARGE": r"\LARGE",
         "Large": r"\Large", "large": r"\large", "normalsize": r"\normalsize", "small": r"\small"}
_STYLE = {"plain": "", "bold": r"\bfseries", "smallcaps": r"\scshape", "boldsc": r"\scshape\bfseries", "italic": r"\itshape"}
_ALIGN = {"left": r"\raggedright", "center": r"\centering", "right": r"\raggedleft"}
_VALIGN = {"top": "t", "middle": "c", "bottom": "b"}
_LIFT = {"t": r"-\height", "c": r"\dimexpr(\depth-\height)/2\relax", "b": r"\depth"}


def _digit_boxes(n):
    return r"\amcuiDigitBoxes{%d}" % n


def _prefix_boxes(prefix):
    return "".join(r"\amcuiPrefixBox{%s}" % esc(ch) for ch in prefix)


def _effective(design):
    """The design as printed: with the level off, the level is empty
    wherever a block or the footer would print it."""
    if design["student"]["level"]:
        return design
    return {**design, "fields": {**design["fields"], "level": ""}}


def _block_tex(design, b, where, summary, namefield):
    """The LaTeX of one block. SUMMARY: the instructions lines per section."""
    t = b["type"]
    f = design["fields"]
    st = design["student"]
    if t == "logo":
        return r"\amcuiLogo{%s}{%s}" % (b["file"], b["height"]) if b["file"] else ""
    if t == "title":
        lines = []
        for ln in b["lines"]:
            text = esc(f.get(ln["field"], "")) if "field" in ln else _fields(design, ln["text"])
            if text.strip():
                lines.append("{%s%s %s}" % (_SIZE[ln["size"]], _STYLE[ln["style"]], text))
        return r"\\[1mm]".join(lines)
    if t == "student":
        lines = []
        if b["name"]:
            lines.append(r"%s: \dotfill" % esc(b["name_label"]))
        parts = []
        if b["id"]:
            parts.append(r"%s: %s%s" % (esc(b["id_label"]), _prefix_boxes(st["id_prefix"]), _digit_boxes(st["id_digits"])))
        if b["klass"] and st["klass"]:
            parts.append(r"%s: %s" % (esc(b["class_label"]), _digit_boxes(st["class_digits"])))
        if b["level"] and f.get("level"):
            parts.append(r"%s: \amcuiCharBox{black}{white}{%s}" % (esc(b["level_label"]), esc(f["level"])))
        while parts:
            pair, parts = parts[:2], parts[2:]
            lines.append(r" \hfill ".join(pair))
        if not lines:
            return ""
        body = r"\vspace*{3mm}" + "\n" + (r"\\[3mm]" + "\n").join(lines)
        if namefield:
            return "%%AMCUI-NAMEFIELD%%" + body
        return body
    if t == "code":
        code = "{%s\\amcuiCode}" % _SIZE[b["size"]]
        if b["label"]:
            return r"\begin{tabular}{@{}c@{}}%s\\[1ex]%s\end{tabular}" % (esc(b["label"]), code)
        return code
    if t == "info":
        lines = []
        for ln in b["lines"]:
            if isinstance(ln, str):
                if f.get(ln):
                    lines.append("%s: %s" % (esc(FIELD_LABELS[ln]), esc(f[ln])))
            elif ln.get("value") or ln.get("label"):
                lines.append("%s%s" % ((esc(ln["label"]) + ": ") if ln["label"] else "", _fields(design, ln["value"])))
        return r"\\[0.12in]".join(lines)
    if t == "box":
        value = _fields(design, b["value"])
        label = ("{\\bfseries %s:} " % esc(b["label"])) if b["label"] else ""
        return "{%s %s%s}" % (_SIZE[b["size"]], label, value) if (label or value.strip()) else ""
    if t == "instructions":
        ins = design["instructions"]
        out = []
        if b["heading"] and ins["heading"]:
            out.append(r"\begin{center}\scshape %s\end{center}" % _fields(design, ins["heading"]))
        items = []
        for it in ins["items"]:
            if it.get("summary"):
                items += [re.sub(r"^\\amcuiPoint\{(.*)\}$", r"\1", s, flags=re.S) for s in summary]
            elif it["latex"].strip():
                items.append(it["latex"].strip())
        if ins["bullet"] == "number":
            if items:
                out.append(r"\begin{enumerate}" + "\n" + "\n".join(r"\item %s" % x for x in items) + "\n" + r"\end{enumerate}")
        else:
            out += [r"\amcuiPoint{%s}" % x for x in items]
        if ins["rule"]:
            out.append(r"\vspace{2ex}\hrule\vspace{2ex}")
        return "\n".join(out)
    if t == "text":
        return b["latex"].strip()
    if t == "questions":
        return ""  # the split between \amcuiPaperFront and \amcuiPaperBack
    if t == "rule":
        return r"\par\noindent\rule{\linewidth}{%s}\par" % b["thickness"]
    if t == "space":
        return r"\vspace{%s}" % b["height"]
    if t == "pagebreak":
        return r"\clearpage"
    if t == "end":
        return r"\amcuiCenterRule{%s}" % esc(b["text"]) if b["text"] else ""
    if t == "rough":
        return r"\amcuiRoughWork{%d}{%s}" % (b["pages"], esc(b["text"])) if b["pages"] else ""
    if t == "class_grid" and not st["klass"]:
        return ""
    if t in ("id_grid", "class_grid"):
        code, digits = ("student", st["id_digits"]) if t == "id_grid" else ("studclass", st["class_digits"])
        label = (r"{\bfseries %s}\\[1ex]\hrule\vspace{2ex}" % esc(b["label"]) + "\n") if b["label"] else ""
        return r"\begin{center}" + "\n" + label + r"\AMCcodeGridInt[top,%s]{%s}{%d}" % (b["orientation"], code, digits) + "\n" + r"\vspace{1ex}\end{center}"
    if t == "signatures":
        lines = [r"%s: \dotfill" % esc(x) for x in b["lines"] if x]
        return (r"\vspace*{6mm}" + "\n" + (r"\\[6mm]" + "\n").join(lines)) if lines else ""
    if t in ANSWER_BLOCKS:
        if t == "numeric_answers":
            # each question's number above its grid, the grids side by side (no columns to overflow)
            head = (r"\dbox{\bfseries %s}\par" % esc(b["heading"]) + "\n") if b["heading"] else ""
            return head + r"\amcuiNumericForm{%d}" % b["columns"]
        head = (r"\dbox{\bfseries %s}\\[2ex]" % esc(b["heading"]) + "\n") if b["heading"] else ""
        inner = {"choice_answers": r"\AMCformFilter{!\AMCifcategory{numeric}}",
                 "all_answers": r"\AMCform"}[t]
        if b["columns"] > 1:
            env = "multicols*" if where == "boxed" else "multicols"
            inner = (r"\setlength{\columnsep}{2ex}\setlength{\columnseprule}{1pt}" + "\n"
                     + r"\begin{%s}{%d}" % (env, b["columns"]) + "\n" + inner + "\n" + r"\end{%s}" % env)
        return head + inner
    return ""


def _measure_tex(content, align):
    """The content set as a box of its natural width (a "fit" column)."""
    return r"\begin{varwidth}{\linewidth}%s %s\end{varwidth}" % (_ALIGN[align], content)


def _row_tex(design, row, where, summary, namefield_cell):
    """One row: the widths (fixed, measured, shared), the same-height
    measure, then the columns side by side."""
    page_border = design["page"]["border"]
    # a block with nothing to print (an empty field, no logo yet) takes no room
    cells = [c for c in row["cells"] if _block_tex(design, c["block"], "boxed", summary, False).replace("%%AMCUI-NAMEFIELD%%", "").strip()]
    n = len(cells)
    if not n:
        return ""
    # a flowing block alone in its row, without a border: printed in the normal flow
    if n == 1 and cells[0]["block"]["type"] in FLOW and (page_border if cells[0]["border"] == "default" else cells[0]["border"]) == "none":
        b = cells[0]["block"]
        content = _block_tex(design, b, "flow", summary, False)
        if not content:
            return ""
        align = _ALIGN[cells[0]["align"]] if cells[0]["align"] != "left" else ""
        body = "{%s %s\\par}" % (align, content) if align else content
        after = r"\par\vspace{%s}" % row["after"] if b["type"] not in ("pagebreak", "space") else ""
        return body + after + "\n"
    gaps = (r"%d\amcuiGapLen" % (n - 1)) if n > 1 else "0pt"
    lines = [r"\noindent\begingroup\setlength{\amcuiGapLen}{%s}%%" % row["gap"]]
    contents = []
    for j, c in enumerate(cells):
        border = page_border if c["border"] == "default" else c["border"]
        is_name = namefield_cell is c
        content = _block_tex(design, c["block"], "boxed", summary, is_name)
        content = content.replace("%%AMCUI-NAMEFIELD%%", "")
        contents.append((content, border, is_name))
    # 1. fixed and measured widths
    fixed_terms, fit_terms, autos = [], [], []
    for j, c in enumerate(cells):
        L = _LETTERS[j]
        content, border, _ = contents[j]
        if isinstance(c["width"], int):
            lines.append(r"\setlength{\amcuiW%s}{\dimexpr(\linewidth-%s)*%d/12\relax}%%" % (L, gaps, c["width"]))
            fixed_terms.append(r"\amcuiW%s" % L)
        elif c["width"] == "fit":
            lines.append(r"\sbox\amcuiBox%s{%s}%%" % (L, _measure_tex(content, c["align"])))
            extra = (r"+2\fboxrule+2\dimexpr%s\relax" % c["pad"]) if border != "none" else ""  # the cell's own padding
            lines.append(r"\setlength{\amcuiW%s}{\dimexpr\wd\amcuiBox%s%s\relax}%%" % (L, L, extra))
            fit_terms.append(r"\amcuiW%s" % L)
        else:
            autos.append(L)
    if autos:
        used = "".join("-" + x for x in fixed_terms + fit_terms)
        for L in autos:
            lines.append(r"\setlength{\amcuiW%s}{\dimexpr(\linewidth-%s%s)/%d\relax}%%" % (L, gaps, used, len(autos)))
    # 2. the columns, measured first when the row's boxes share one height
    def column(j, height, measuring=False):
        c = cells[j]
        L = _LETTERS[j]
        content, border, is_name = contents[j]
        is_name = is_name and not measuring
        inner_w = r"\amcuiW%s" % L if border == "none" else r"\dimexpr\amcuiW%s-2\fboxsep-2\fboxrule\relax" % L
        pos = _VALIGN[row["align"]]
        h = ""
        if height:  # the row's shared height; the content sits where the row aligns
            h = "[%s][%s]" % (r"\amcuiRowH" if border == "none" else r"\dimexpr\amcuiRowH-2\fboxsep-2\fboxrule\relax", pos)
        mp = r"\begin{minipage}[t]%s{%s}%s %s\end{minipage}" % (h, inner_w, _ALIGN[c["align"]], content)
        frame = {"none": "%s", "dashed": r"\dbox{%s}", "solid": r"\fbox{%s}"}[border] % mp
        if is_name:
            frame = r"\namefield{%s}" % frame
        # The boxes line up on their edges (top, centre or bottom), not on
        # their first baselines: a box starting with a tall line would
        # otherwise sit higher than one starting with a space.
        return r"{\setlength{\fboxsep}{%s}\raisebox{%s}{%s}}" % (c["pad"], _LIFT[pos], frame)
    measurable = [j for j in range(n) if cells[j]["block"]["type"] not in REGISTERING]
    if row["same_height"] and n > 1 and len(measurable) > 1:
        lines.append(r"\setlength{\amcuiRowH}{0pt}%")
        for j in measurable:
            L = _LETTERS[j]
            lines.append(r"\sbox\amcuiBox%s{%s}%%" % (L, column(j, False, True)))
            lines.append(r"\setlength{\amcuiTmpLen}{\dimexpr\ht\amcuiBox%s+\dp\amcuiBox%s\relax}\ifdim\amcuiTmpLen>\amcuiRowH\setlength{\amcuiRowH}{\amcuiTmpLen}\fi%%" % (L, L))
        cols = [column(j, j in measurable) for j in range(n)]
    else:
        cols = [column(j, False) for j in range(n)]
    # each column ends its line with "%"; the gap sits on a line of its own
    # (an \hspace* so that TeX can't wrap the row there)
    lines.append(("%\n" + r"\hspace*{\amcuiGapLen}%" + "\n").join(cols) + "%")
    lines.append(r"\endgroup\par\vspace{%s}" % row["after"])
    return "\n".join(lines) + "\n"


def _footer_tex(design, footer):
    """\\AMCsetFoot from the pattern: a segment whose fields are all empty
    is dropped (no "Level  //" when there is no level)."""
    if not footer or not footer["pattern"].strip():
        return r"\AMCsetFoot{}"
    segments = []
    for seg in footer["pattern"].split("//"):
        seg = seg.strip()
        if not seg:
            continue
        toks = _TOKEN.findall(seg)
        static = [t for t in toks if t not in ("code", "page")]
        if static and all(not design["fields"].get(t) for t in static) and len(static) == len(toks):
            continue
        if static and any(not design["fields"].get(t) for t in static):
            seg = _TOKEN.sub(lambda m: m.group(0) if m.group(1) in ("code", "page") or design["fields"].get(m.group(1)) else "", seg).strip()
        tex = _fields(design, seg).replace("{code}", r"\amcuiCode{}").replace("{page}", r"\thepage{}")
        segments.append(tex)
    if not segments:
        return r"\AMCsetFoot{}"
    text = " // ".join(segments)
    if footer["mono"]:
        text = r"\texttt{%s}" % text
    text = {"none": "%s", "dashed": r"\dbox{%s}", "solid": r"\fbox{%s}"}[footer["border"]] % text
    return r"\AMCsetFoot{\makebox[\textwidth][%s]{%s}}" % ({"left": "l", "center": "c", "right": "r"}[footer["align"]], text)


def _namefield_cell(design):
    """The cell that carries AMC's name field: the first student block of
    the answer sheet (separate sheet) or of the paper."""
    rows = design["answer_sheet"] if design["kind"] == "separate" else design["paper"]
    for r in rows:
        for c in r["cells"]:
            if c["block"]["type"] == "student":
                return c
    return None


def layout(design, versions, summary=()):
    """paper-layout.tex for DESIGN, printed in VERSIONS versions, with the
    instructions' lines per section SUMMARY (ui_structure.summary_lines)."""
    design = _effective(design)
    design = normalize(design)
    versions = max(1, min(int(versions or 1), 999))
    page = design["page"]
    opts = ["box", "completemulti"]
    if design["kind"] == "separate":
        opts.append("separateanswersheet")
    if not page["shuffle_answers"]:
        opts.append("noshuffle")
    codes = codes_table(design["codes"], versions)
    out = [
        "%% %s: written by Questions > Paper builder from %s (design %s)." % (LAYOUT_FILE, DESIGN_FILE, digest(design)),
        "% The builder rewrites this file at each change and before each build. To edit",
        "% the layout by hand instead, choose \"Keep my changes\" in the builder first.",
        "",
        r"\usepackage{graphicx,xcolor,dashbox,multicol,varwidth}",
        r"\usepackage[%s]{automultiplechoice}" % ",".join(opts),
        "",
        "% ------ Page, boxes and footer ------",
        r"\setlength{\parindent}{0pt}",
        r"\AMCcodeHspace=1em",
        r"\AMCcodeVspace=1em",
        r"\AMCformHSpace=0.7em",
        r"\AMCformVSpace=.9ex",
        r"\AMCboxStyle{shape=square,size=2.5ex,down=.4ex,rule=.5pt,outsidesep=.1em,color=black}",
        r"\renewcommand\AMCsubjectPageTag{}",
        r"\newgeometry{%s,headheight=17mm,headsep=0mm,footskip=0mm,foot=12mm,marginparwidth=0mm,marginparsep=0mm,includehead,includefoot}" % MARGINS[page["margins"]],
        r"\def\columnseprulecolor{\color{black!50}}",
    ]
    if page["question_style"] == "rj":
        out += [
            "% Question numbers in the RJ style: Q-1〉",
            r"\def\AMCchoiceLabelFormat#1{\color{black!50}\scriptsize{#1}}",
            r"\def\AMCbeginQuestion#1#2{\par\hspace{-1mm}{\textsf{Q-#1}}$\rangle$#2 \hspace{0mm}}",
            r"\def\AMCformQuestion#1{\par\hspace{-1mm}{\textsf{Q-\ifnum#1<10 0\fi#1}}$\rangle$ }",
            r"\def\multiSymbole{\raisebox{0.2ex}{\small$\blacktriangleright$}}",
        ]
    out += [
        "",
        "% ------ The version's code, from AMC's copy number ------",
        r"\makeatletter",
        r"\newcommand{\amcuiCode}{\ifcase\AMCid@etud ?%s\fi}" % "".join(r"\or " + (c if c else r"\relax") for c in codes),
        r"\newcommand{\amcuiNumLabel}[1]{%s}" % (r"\textsf{Q-\ifnum#1<10 0\fi#1}" if page["question_style"] == "rj" else r"{\small\AMC@loc@qf{#1}}"),
        r"\makeatother",
        "",
        "% ------ Small pieces ------",
        r"\newlength{\amcuiGapLen}\newlength{\amcuiRowH}\newlength{\amcuiTmpLen}",
        "".join(r"\newlength{\amcuiW%s}" % L for L in _LETTERS),
        "".join(r"\newsavebox{\amcuiBox%s}" % L for L in _LETTERS),
        r"\newcount\amcuiCount",
        "% A box for one handwritten letter or digit: its size is set here, not by the block's padding",
        r"\newlength{\amcuiBoxW}\newlength{\amcuiBoxH}\setlength{\amcuiBoxW}{%s}\setlength{\amcuiBoxH}{%s}" % (design["student"]["box_width"], design["student"]["box_height"]),
        r"\newcommand{\amcuiCharBox}[3]{{\setlength{\fboxsep}{0pt}\fcolorbox{#1}{#2}{\parbox[c][\dimexpr\amcuiBoxH-2\fboxrule\relax][c]{\dimexpr\amcuiBoxW-2\fboxrule\relax}{\centering\mbox{}#3}}}}",
        r"\newcommand{\amcuiBoxOne}{\amcuiCharBox{black}{white}{}\:}",
        r"\newcommand{\amcuiDigitBoxes}[1]{\amcuiCount=0 \loop\ifnum\amcuiCount<#1 \amcuiBoxOne\advance\amcuiCount by 1 \repeat}",
        r"\newcommand{\amcuiPrefixBox}[1]{\amcuiCharBox{black!40}{black!40}{\color{white}\large #1}\:}",
        r"\newcommand{\amcuiLogo}[2]{\IfFileExists{#1}{\includegraphics[height=#2]{#1}}{}}",
        r"\newcommand{\amcuiBullet}{%s}" % {"arrow": r"$\blacktriangleright$", "dot": r"\textbullet", "number": "", "none": ""}[design["instructions"]["bullet"]],
        r"\newcommand{\amcuiPoint}[1]{\par\noindent\amcuiBullet\ #1\par\vspace{1ex}}",
        r"\newcommand{\amcuiCenterRule}[1]{\vspace{0.1\baselineskip}\centerline{\rule{0.35\linewidth}{.4pt}\dbox{#1}\rule{0.35\linewidth}{.4pt}}\vspace{0.25\baselineskip}}",
        r"\newcommand{\amcuiRoughWork}[2]{\amcuiCount=0 \loop\ifnum\amcuiCount<#1 \clearpage\amcuiCenterRule{#2}\advance\amcuiCount by 1 \repeat}",
        "% Numeric answers: one box per question, its number above its grid, the boxes side by",
        "% side, #1 to a line (wider grids take more room and the next ones wrap). AMC opens and",
        "% closes each question with \\AMCformQuestion and \\AMCformAfterQuestion; each grid is",
        "% typeset once, in a box that is placed once.",
        r"\newlength{\amcuiNumW}\newlength{\amcuiNumT}\newlength{\amcuiNumGap}\setlength{\amcuiNumGap}{3mm}\newsavebox{\amcuiNumBox}",
        r"\newcommand{\amcuiNumericForm}[1]{\par{\setlength{\amcuiNumW}{\dimexpr(\linewidth-\amcuiNumGap*(#1-1))/#1\relax}%",
        r"  \def\AMCformBeforeQuestion{\leavevmode}%",
        r"  \def\AMCformQuestion##1{\setbox\amcuiNumBox\hbox\bgroup\begin{tabular}[t]{@{}c@{}}\amcuiNumLabel{##1}\\[.6ex]}%",
        r"  \def\AMCformAfterQuestion{\end{tabular}\egroup\setlength{\amcuiNumT}{\ifdim\wd\amcuiNumBox>\amcuiNumW\wd\amcuiNumBox\else\amcuiNumW\fi}\makebox[\amcuiNumT]{\box\amcuiNumBox}\hspace{\amcuiNumGap}}%",
        r"  \lineskiplimit=0pt\lineskip=2.5ex\relax\nointerlineskip\vspace{2ex}%",
        r"  \AMCformFilter{\AMCifcategory{numeric}}\par}}",
        "",
    ]
    name_cell = _namefield_cell(design)
    paper_rows = design["paper"]
    split = next((i for i, r in enumerate(paper_rows) if any(c["block"]["type"] == "questions" for c in r["cells"])), len(paper_rows))
    front = "".join(_row_tex(design, r, "paper", summary, name_cell) for r in paper_rows[:split])
    back = "".join(_row_tex(design, r, "paper", summary, name_cell) for r in paper_rows[split + 1:])
    out += ["% ------ The question paper, before the questions ------",
            r"\newcommand{\amcuiPaperFront}{%", _footer_tex(design, page["footer"]), front.rstrip("\n"), "}", ""]
    tail = [back.rstrip("\n")] if back.strip() else []
    if page["fill_pages"]:
        tail.append(r"\AMCaddpagesto{%d}" % page["fill_pages"])
    if design["kind"] == "separate":
        tail.append(r"\clearpage")
        tail.append(r"\AMCformBegin")
        if page["sheet_footer"]:
            tail.append(_footer_tex(design, page["sheet_footer"]))
        sheet = "".join(_row_tex(design, r, "sheet", summary, name_cell) for r in design["answer_sheet"])
        tail.append(sheet.rstrip("\n"))
    out += ["% ------ After the questions: the end of the paper, filler pages, the answer sheet ------",
            r"\newcommand{\amcuiPaperBack}{%"] + [x for x in tail if x] + ["}", ""]
    return "\n".join(out)


# ---------------------------------------------------------------- putting it together

def summary_for(main_text, questions):
    """The instructions' lines per section, from the main source and every
    question of the exam (ui_scale.read_latex)."""
    return structure.summary_lines(structure.sections_with_pools(main_text, questions))


def read_design(pdir):
    """paper.json of the exam, raw, or None when the exam has none."""
    path = os.path.join(pdir, DESIGN_FILE)
    if not os.path.isfile(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_layout_file(pdir, versions, questions=()):
    """For the gallery build: paper-layout.tex next to paper.json, plainly."""
    raw = read_design(pdir)
    if raw is None:
        return None
    design = normalize(raw)
    main = os.path.join(pdir, "exam.tex")
    summary = []
    if os.path.isfile(main):
        with open(main, encoding="utf-8") as f:
            text = f.read()
        oc = structure.onecopy(text)
        versions = oc[0] if oc else versions
        summary = summary_for(text, list(questions))
    tex = layout(design, versions, summary)
    with open(os.path.join(pdir, LAYOUT_FILE), "w", encoding="utf-8") as f:
        f.write(tex)
    return tex


def sample_codes(design, versions):
    """What the canvas shows as the paper code: the first and last codes."""
    table = codes_table(design["codes"], max(1, min(int(versions or 1), 999)))
    return {"first": table[0], "last": table[-1]}


def apply_student(design, student):
    """The wizard's choice of a level and a class: off, the class grids
    leave the sheet (a block printing nothing would only puzzle)."""
    for k in ("klass", "level"):
        if k in (student or {}):
            design["student"][k] = _bool(student[k])
    if not design["student"].get("klass", True):
        for rows in (design["paper"], design["answer_sheet"]):
            for r in rows:
                r["cells"] = [c for c in r["cells"] if c.get("block", {}).get("type") != "class_grid"]
                for c in r["cells"]:  # the RJ sheet's instruction line
                    if c["block"].get("type") == "text":
                        c["block"]["latex"] = c["block"]["latex"].replace("Darken your class and the digits of", "Darken the digits of")
            rows[:] = [r for r in rows if r["cells"]]
    return design


def apply_fields(design, fields):
    """The wizard's details into a preset: exam name, date... (unknown keys ignored)."""
    for k, v in (fields or {}).items():
        if k in FIELDS and isinstance(v, str):
            design["fields"][k] = v[:300]
    return design
