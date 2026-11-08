"""
What changed between two versions of an exam's files, in words, for the
History panel and the restore confirmation (doc/features.md,
Version history): "q3: text edited; answer 2 made correct", "Question paper: row 2
added (Logo, Title lines)", "class.csv added".

describe(old, new) takes {path: bytes or None} for the files that differ
and returns a list of {"file", "lines": [sentences]}. Standard library
only (plus the app's own parsers), so tests run without Flask.
"""
import difflib
import json

import ui_builder as paper_builder
import ui_scale as scale

MAX_LINES = 12  # per file; the rest is "and N more changes"


def _plural(n, one, many=None):
    return f"{n} {one if n == 1 else (many or one + 's')}"


def _text(data):
    if data is None:
        return None
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("utf-8", "replace")


def _line_counts(old, new):
    a = (old or "").splitlines()
    b = (new or "").splitlines()
    added = removed = 0
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=len(a) * len(b) > 4_000_000).get_opcodes():
        if tag != "equal":
            removed += i2 - i1
            added += j2 - j1
    return added, removed


def _lines_phrase(old, new):
    added, removed = _line_counts(old, new)
    parts = []
    if added:
        parts.append(f"{added} line{'s' if added != 1 else ''} added")
    if removed:
        parts.append(f"{removed} removed" if added else f"{removed} line{'s' if removed != 1 else ''} removed")
    return ", ".join(parts) if parts else "only spacing changed"


# ---------------------------------------------------------------- questions

def _questions(text, filename):
    try:
        qs = scale.read_latex(text, filename)
    except Exception:  # a file in the middle of an edit: no question summary
        return None
    out = {}
    for q in qs:
        out.setdefault(q["id"], q)
    return out


def _letter(i):
    return chr(ord("A") + i) if i < 26 else str(i + 1)


def question_changes(old_text, new_text, filename=""):
    """Sentences about the questions of a LaTeX file, or None when the file
    has no question in either version."""
    qa, qb = _questions(old_text or "", filename), _questions(new_text or "", filename)
    if qa is None or qb is None or (not qa and not qb):
        return None
    out = []
    added = [i for i in qb if i not in qa]
    removed = [i for i in qa if i not in qb]
    if added:
        out.append(("Question added: " if len(added) == 1 else "Questions added: ") + ", ".join(added))
    if removed:
        out.append(("Question removed: " if len(removed) == 1 else "Questions removed: ") + ", ".join(removed))
    order_a = [i for i in qa if i in qb]
    order_b = [i for i in qb if i in qa]
    if order_a != order_b:
        out.append("Questions reordered")
    for qid in order_b:
        a, b = qa[qid], qb[qid]
        parts = []
        if a["kind"] != b["kind"]:
            parts.append(f"now a {'numeric' if b['kind'] == 'numeric' else 'multiple-answer' if b['kind'] == 'multiple' else 'single-answer'} question")
        if a.get("group") != b.get("group"):
            parts.append(f"moved to {b.get('group') or 'no section'}")
        if a.get("text_latex") != b.get("text_latex"):
            parts.append("text edited")
        aa, ab = a["answers"], b["answers"]
        if len(aa) != len(ab):
            parts.append(f"{_plural(len(ab), 'answer')} (was {len(aa)})")
        else:
            for i, (x, y) in enumerate(zip(aa, ab)):
                if x["correct"] != y["correct"]:
                    parts.append(f"answer {_letter(i)} made {'correct' if y['correct'] else 'wrong'}")
                if x["latex"] != y["latex"]:
                    parts.append(f"answer {_letter(i)} edited")
        if (a.get("numeric") or {}).get("value") != (b.get("numeric") or {}).get("value"):
            parts.append("numeric answer changed")
        elif (a.get("numeric") or {}).get("options") != (b.get("numeric") or {}).get("options"):
            parts.append("numeric answer's format changed")
        if (a.get("scoring") or {}).get("rule") != (b.get("scoring") or {}).get("rule"):
            parts.append("scoring changed")
        if (a.get("explain") or {}).get("latex") != (b.get("explain") or {}).get("latex"):
            parts.append("explanation edited")
        if parts:
            out.append(f"{qid}: " + "; ".join(parts))
    return out


# ---------------------------------------------------------------- the paper design

def _design(data):
    try:
        d = json.loads(_text(data) or "")
        return d if isinstance(d, dict) else None
    except ValueError:
        return None


def _block_title(t):
    return paper_builder.BLOCKS.get(t, (t,))[0]


def _cells(row):
    return [c for c in (row.get("cells") or []) if isinstance(c, dict)] if isinstance(row, dict) else []


def _row_blocks(row):
    return ", ".join(_block_title((c.get("block") or {}).get("type")) for c in _cells(row)) or "empty"


def _rows_changes(label, ra, rb):
    out = []
    ra = [r for r in ra if isinstance(r, dict)] if isinstance(ra, list) else []
    rb = [r for r in rb if isinstance(r, dict)] if isinstance(rb, list) else []
    ids_a = [r.get("id") for r in ra]
    ids_b = [r.get("id") for r in rb]
    for i, r in enumerate(rb):
        if r.get("id") not in ids_a:
            out.append(f"{label}: row {i + 1} added ({_row_blocks(r)})")
    for i, r in enumerate(ra):
        if r.get("id") not in ids_b:
            out.append(f"{label}: row {i + 1} removed ({_row_blocks(r)})")
    common_a = [i for i in ids_a if i in ids_b]
    common_b = [i for i in ids_b if i in ids_a]
    if common_a != common_b:
        out.append(f"{label}: rows reordered")
    for i, r in enumerate(rb):
        if r.get("id") not in ids_a:
            continue
        old = ra[ids_a.index(r.get("id"))]
        ca = {c.get("id"): c for c in _cells(old)}
        cb = {c.get("id"): c for c in _cells(r)}
        parts = []
        for cid, c in cb.items():
            t = (c.get("block") or {}).get("type")
            if cid not in ca:
                parts.append(f"{_block_title(t)} added")
            elif (ca[cid].get("block") or {}).get("type") != t:
                parts.append(f"{_block_title((ca[cid].get('block') or {}).get('type'))} replaced by {_block_title(t)}")
            elif ca[cid].get("block") != c.get("block"):
                parts.append(f"{_block_title(t)} changed")
            elif {k: v for k, v in ca[cid].items() if k != "block"} != {k: v for k, v in c.items() if k != "block"}:
                parts.append(f"{_block_title(t)}: width, border or alignment changed")
        for cid, c in ca.items():
            if cid not in cb:
                parts.append(f"{_block_title((c.get('block') or {}).get('type'))} removed")
        if [c.get("id") for c in _cells(old) if c.get("id") in cb] != [c.get("id") for c in _cells(r) if c.get("id") in ca]:
            parts.append("columns reordered")
        if {k: v for k, v in old.items() if k != "cells"} != {k: v for k, v in r.items() if k != "cells"}:
            parts.append("row settings changed")
        if len(ca) != len(cb) and not any("added" in p or "removed" in p for p in parts):
            parts.append(f"{len(ca)} → {len(cb)} columns")
        if parts:
            out.append(f"{label}, row {i + 1}: " + "; ".join(parts))
    return out


def design_changes(old, new):
    """Sentences about two versions of paper.json (bytes or None)."""
    a, b = _design(old), _design(new)
    if old is not None and new is not None and (a is None or b is None):
        return [f"The design {'can no longer' if b is None else 'can now'} be read"]
    a, b = a or {}, b or {}
    out = []
    if a.get("kind") != b.get("kind") and a and b:
        out.append("Answer sheet: " + ("separate sheet" if b.get("kind") == "separate" else "on the question paper"))
    out += _rows_changes("Question paper", a.get("paper"), b.get("paper"))
    out += _rows_changes("Answer sheet", a.get("answer_sheet"), b.get("answer_sheet"))
    fa, fb = a.get("fields") or {}, b.get("fields") or {}
    changed = [paper_builder.FIELD_LABELS.get(k, k) for k in paper_builder.FIELDS if fa.get(k) != fb.get(k)]
    if changed and a and b:
        out.append("Details: " + ", ".join(changed) + " changed")
    ia, ib = a.get("instructions") or {}, b.get("instructions") or {}
    na, nb = len(ia.get("items") or []), len(ib.get("items") or [])
    if na != nb and a and b:
        out.append(f"Instructions: {na} → {nb} items")
    elif ia != ib and a and b:
        out.append("Instructions edited")
    if a and b:
        if (a.get("student") or {}) != (b.get("student") or {}):
            out.append("Student ID settings changed")
        pa, pb = a.get("page") or {}, b.get("page") or {}
        keys = [k for k in sorted(set(pa) | set(pb)) if pa.get(k) != pb.get(k)]
        if keys:
            names = {"margins": "margins", "border": "border", "shuffle_answers": "answer shuffling",
                     "question_style": "question style", "fill_pages": "pages per copy",
                     "footer": "footer", "sheet_footer": "answer sheet footer"}
            out.append("Page: " + ", ".join(names.get(k, k) for k in keys) + " changed")
        if (a.get("codes") or {}) != (b.get("codes") or {}):
            out.append("Version codes changed")
    if not out and a != b:
        out.append("Design settings changed")
    return out


# ---------------------------------------------------------------- all files

def describe(old, new):
    """[{"file", "status", "lines"}] for every path in OLD or NEW whose
    bytes differ (None: the file isn't there)."""
    out = []
    for path in sorted(set(old) | set(new)):
        a, b = old.get(path), new.get(path)
        if a == b:
            continue
        status = "added" if a is None else "removed" if b is None else "changed"
        lines = []
        ext = path.rsplit(".", 1)[-1].lower() if "." in path else ""
        if path == paper_builder.DESIGN_FILE:
            lines = design_changes(a, b)
        elif status == "changed" and ext in ("tex", "latex"):
            ta, tb = _text(a), _text(b)
            q = question_changes(ta, tb, path)
            lines = list(q or [])
            if not lines or _outside_questions_changed(ta, tb, path):
                lines.append(("Other lines: " if q else "") + _lines_phrase(ta, tb))
        elif status == "changed" and ext in ("txt", "sty", "cls", "bib", "yml", "yaml", "csv", "json"):
            lines = [_lines_phrase(_text(a), _text(b))]
        elif status == "changed":
            lines = ["replaced"]
        if status == "added" and ext in ("tex", "latex"):
            q = _questions(_text(b) or "", path)
            if q:
                lines = [f"with {_plural(len(q), 'question')}"]
        if len(lines) > MAX_LINES:
            lines = lines[:MAX_LINES] + [f"and {len(lines) - MAX_LINES} more changes"]
        out.append({"file": path, "status": status, "lines": lines})
    return out


def _outside_questions_changed(ta, tb, path):
    """Whether lines outside the questions changed too (the preamble, the
    layout), so the summary doesn't hide them."""
    def strip(text):
        qs = _questions(text or "", path) or {}
        spans = sorted(q["block_span"] for q in qs.values())
        out, pos = [], 0
        for s, e in spans:
            if s >= pos:
                out.append(text[pos:s])
                pos = e
        out.append(text[pos:])
        return "".join(out).split()
    try:
        return strip(ta) != strip(tb)
    except Exception:
        return True
