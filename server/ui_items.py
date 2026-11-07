"""
Questions kept in their own files (doc/question-bank-plan.md, section 4).

  <exam>/pools.tex                 which items each section draws from, in order
  <exam>/items/<name>/item.tex     what goes inside \\element{G}{...}: one
                                   question, or a set (a shared text and
                                   the questions that go with it)
  <exam>/items/<name>/item.json    the item's uid, which never changes
  <exam>/items/<name>/<name>-1.png its figures, named after it

pools.tex starts with the \\amcuiItem macro, so an exam only needs
\\input{pools} before its \\insertgroup lines, and the desktop app builds
it unchanged:

  \\element{sectionI}{\\amcuiItem{alg-017}}

An exam can mix items with questions written in its main file. split()
moves an exam's \\element blocks into items. Standard library only (plus
the app's parsers), so tests run without Flask.
"""
import json
import re
import time

import ui_questions as questions_edit
import ui_scale as scale
import ui_vcs as vcs

ITEMS_DIR = vcs.ITEMS_DIR
NAME_RE = vcs.ITEM_NAME_RE
POOLS_FILE = "pools.tex"
ITEM_FILE = "item.tex"
META_FILE = "item.json"
MACRO = r"\providecommand{\amcuiItem}[1]{\begingroup\graphicspath{{items/#1/}}\input{items/#1/item.tex}\endgroup}"
HEADER = ("% The questions of each section, in order: one \\element per item,\n"
          "% and each item is a folder in items/. Written by the app; hand edits are kept.\n"
          "%%AMCUI:ITEMS%%\n" + MACRO + "\n%%AMCUI:END ITEMS%%\n")
_POOL_LINE = re.compile(r"\\element\s*\{([^{}]*)\}\s*\{\s*\\amcuiItem\s*\{([^{}]*)\}\s*\}")
_INPUT_POOLS = re.compile(r"\\input\s*\{\s*pools(?:\.tex)?\s*\}")
_ITEM_FILE = re.compile(r"^items/([A-Za-z0-9][A-Za-z0-9-]{0,63})/item\.tex\Z")
IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".pdf", ".eps")


class EditError(questions_edit.EditError):
    pass


def item_file(name):
    return f"{ITEMS_DIR}/{name}/{ITEM_FILE}"


def item_of(fn):
    """The item name of an item file's path, else None."""
    m = _ITEM_FILE.match(fn or "")
    return m.group(1) if m else None


def sanitize(text):
    """An item name from a question id: letters, digits and -."""
    name = re.sub(r"[^A-Za-z0-9-]+", "-", str(text or "")).strip("-")[:64].strip("-")
    return name or "q"


def free_name(base, taken):
    base = sanitize(base)
    name, n = base, 1
    while name.lower() in {t.lower() for t in taken}:  # folder names: Windows and macOS ignore case
        n += 1
        name = f"{base[:60]}-{n}"
    return name


def meta_json(title=""):
    return json.dumps({"uid": vcs.new_uid(), "title": title, "created": int(time.time())}, indent=1) + "\n"


# ---------------------------------------------------------------- pools.tex

def read_pools(text):
    """The items of each section, in order: [{"group", "name", "span"}],
    span being the whole line. Lines in comments are skipped."""
    out = []
    for m in _POOL_LINE.finditer(text or ""):
        if scale._in_comment(text, m.start()):
            continue
        s = text.rfind("\n", 0, m.start()) + 1
        e = text.find("\n", m.end())
        e = len(text) if e < 0 else e + 1
        out.append({"group": m.group(1).strip(), "name": m.group(2).strip(), "span": (s, e)})
    return out


def pool_map(text):
    """{item name: its section}, the first line naming it."""
    out = {}
    for p in read_pools(text):
        out.setdefault(p["name"], p["group"])
    return out


def new_pools():
    return HEADER


def pools_insert(text, group, name, after=None, before=None):
    """Add NAME to GROUP: after or before another item, or at the end of
    the group (a new region for a group without items yet)."""
    text = text or new_pools()
    if MACRO not in text and "\\amcuiItem" not in text.split("\\element", 1)[0]:
        text = HEADER + text
    line = f"\\element{{{group}}}{{\\amcuiItem{{{name}}}}}\n"
    pools = read_pools(text)
    ref = next((p for p in pools if p["name"] == (before or after)), None) if (before or after) else None
    if ref:
        at = ref["span"][0] if before else ref["span"][1]
        return text[:at] + line + text[at:]
    same = [p for p in pools if p["group"] == group]
    if same:
        at = same[-1]["span"][1]
        return text[:at] + line + text[at:]
    if not text.endswith("\n"):
        text += "\n"
    return text + f"%%AMCUI:POOL {group}%%\n{line}%%AMCUI:END POOL%%\n"


def pools_remove(text, name):
    out = text
    for p in reversed(read_pools(text)):
        if p["name"] == name:
            out = out[:p["span"][0]] + out[p["span"][1]:]
    # a region left empty goes too
    return re.sub(r"^%%AMCUI:POOL [^%\n]*%%\n%%AMCUI:END POOL%%\n", "", out, flags=re.M)


def pools_rename_group(text, old, new):
    text = re.sub(r"(\\element\s*\{)\s*" + re.escape(old) + r"\s*(\}\s*\{\s*\\amcuiItem)", lambda m: m.group(1) + new + m.group(2), text)
    return re.sub(r"^%%AMCUI:POOL " + re.escape(old) + r"%%$", f"%%AMCUI:POOL {new}%%", text, flags=re.M)


def includes_pools(text):
    return any(not scale._in_comment(text, m.start()) for m in _INPUT_POOLS.finditer(text or ""))


# ---------------------------------------------------------------- questions in items

def annotate(questions, fn, pmap):
    """Questions read from an item file belong to the item's section (from
    pools.tex); every question gets an element_id, so pools count elements
    (what \\insertgroup[n] draws), not questions."""
    name = item_of(fn)
    for q in questions:
        if name:
            q["item"] = name
            q["group"] = pmap.get(name)
            q["element"] = "item"
            q["element_id"] = f"item:{name}"
        elif not q.get("element_id"):
            q["element_id"] = f"{fn}#{q['block_span'][0]}"
    return questions


def ordered_files(names, pools_text):
    """Item files in pool order, then items no section uses (by name)."""
    seen, out = set(), []
    for p in read_pools(pools_text):
        if p["name"] in names and p["name"] not in seen:
            seen.add(p["name"])
            out.append(item_file(p["name"]))
    return out + [item_file(n) for n in sorted(names) if n not in seen]


def new_item_text(kind, qid):
    return questions_edit.new_block(kind, qid) + "\n"


def check_item_text(text, name):
    """Why this LaTeX can't be an item's file, or None."""
    if not text.strip():
        return "The item is empty."
    if not scale.read_latex(text, item_file(name)):
        return "The item has no question (\\begin{question}…\\end{question})."
    if re.search(r"\\element\s*\{", text):
        return "An item holds what goes inside \\element{…}{…}, not the \\element itself."
    return None


# ---------------------------------------------------------------- splitting an exam into items

def _dedent(text):
    lines = text.split("\n")
    pads = [len(l) - len(l.lstrip(" \t")) for l in lines if l.strip()]
    pad = min(pads) if pads else 0
    return "\n".join(l[pad:] if l.strip() else "" for l in lines).strip("\n") + "\n"


def _block_span(text, start, end):
    """The lines a block covers, when nothing else is on them."""
    ls = text.rfind("\n", 0, start) + 1
    s = ls if text[ls:start].strip() == "" else start
    le = text.find("\n", end)
    le = len(text) if le < 0 else le
    e = le + 1 if text[end:le].strip() == "" and le < len(text) else (le if text[end:le].strip() == "" else end)
    return s, e


def _only_comments(text):
    return all(not l.strip() or l.lstrip().startswith("%") for l in text.split("\n"))


def _input_line(main, fn):
    """The span of the \\input of FN in the main file, or None."""
    stem = fn[:-4] if fn.endswith(".tex") else fn
    for m in re.finditer(r"\\(?:input|include)\s*\{\s*" + re.escape(stem) + r"(?:\.tex)?\s*\}", main):
        if not scale._in_comment(main, m.start()):
            return _block_span(main, m.start(), m.end())
    return None


def _apply(text, edits):
    if not edits:
        return text
    for s, e, new in sorted(edits, key=lambda x: (x[0], x[1]), reverse=True):
        text = text[:s] + new + text[e:]
    return re.sub(r"\n{3,}", "\n\n", text)  # the blank lines around removed blocks (one paragraph break either way)


def _questions_by_group(files, pools_text, items):
    """(id, group) of every question, for checking that a split moved them all."""
    pmap = pool_map(pools_text)
    out = []
    for fn, text in files.items():
        if text is None or fn == POOLS_FILE:
            continue
        out += [(q["id"], q["group"]) for q in annotate(scale.read_latex(text, fn), fn, pmap)]
    for name, text in items.items():
        out += [(q["id"], q["group"]) for q in annotate(scale.read_latex(text, item_file(name)), item_file(name), pmap)]
    return sorted(out, key=lambda x: (x[0], x[1] or ""))


def split(files, main, exists, taken=()):
    """Move the \\element blocks of an exam's LaTeX files into items.

    FILES: {file name: text} of the exam's own LaTeX files (not pools.tex
    or the generated layout); MAIN: the main file; EXISTS(path): whether a
    file is in the exam (figures); TAKEN: item names already used.

    Returns {"files": {name: new text, or None to remove}, "pools": text,
    "items": {name: item.tex text}, "figures": [(from, to)], "kept": n
    questions left in place (not in an \\element)}. Raises EditError when
    the exam can't be split cleanly."""
    if main not in files:
        raise EditError("The main file can't be read.")
    taken = set(taken)
    pools_text = files.get(POOLS_FILE) or ""
    order = [main] + sorted(f for f in files if f not in (main, POOLS_FILE))
    items, groups, figures = {}, {}, []
    edits = {f: [] for f in order}
    first_in = {}  # file -> position of its first block
    for fn in order:
        text = files[fn]
        pos = 0
        for m in scale._ELEMENT_OPEN.finditer(text):
            if m.start() < pos or scale._in_comment(text, m.start()):
                continue
            body = scale._braced(text, m.end())
            if not body:
                continue
            content = text[body[1] + 1:body[2] - 1]
            if _POOL_LINE.fullmatch(text[m.start():body[2]].strip()):
                continue  # already an item
            qs = scale.read_latex(content)
            if not qs:
                continue  # an element without a question stays where it is
            group = m.group(1).strip()
            name = free_name(qs[0]["id"] + ("-set" if len(qs) > 1 else ""), taken | set(items))
            item = _dedent(content)
            k = 0
            for f in reversed(list(scale._FIGURE.finditer(item))):
                ref = f.group(2).strip()
                src = next((c for c in ([ref] if "." in ref.rsplit("/", 1)[-1] else [ref + e for e in IMAGE_EXTS])
                            if ".." not in c.split("/") and not c.startswith("/") and exists(c)), None)
                if not src:
                    continue
                k += 1
                ext = "." + src.rsplit(".", 1)[-1].lower()
                new = f"{name}-{k}{ext}"
                figures.append((src, f"{ITEMS_DIR}/{name}/{new}"))
                shown = new if "." in ref.rsplit("/", 1)[-1] else new[:-len(ext)]
                item = item[:f.start(2)] + shown + item[f.end(2):]
            items[name] = item
            groups.setdefault(group, []).append(name)
            s, e = _block_span(text, m.start(), body[2])
            edits[fn].append((s, e, ""))
            first_in.setdefault(fn, s)
            pos = body[2]
    if not items:
        raise EditError("There is no question inside an \\element{…}{…} to move into an item.")
    out = {}
    main_text = files[main]
    for fn in order[1:]:
        if fn not in first_in:
            continue
        new = _apply(files[fn], edits[fn])
        span = _input_line(main_text, fn)
        if _only_comments(new) and span:
            out[fn] = None  # the file only held questions: it goes, and pools.tex takes its place
            edits[main].append((span[0], span[1], ""))
            first_in.setdefault("\\input", span[0])
            first_in["\\input"] = min(first_in["\\input"], span[0])
        elif not span:
            raise EditError(f"{fn} holds questions but the main file doesn't \\input it directly, so it can't be split here.")
        else:
            out[fn] = new
            first_in["\\input"] = min(first_in.get("\\input", span[0]), span[0])
    if not includes_pools(main_text) and not any(includes_pools(files[f]) for f in order[1:]):
        at = min(v for k, v in first_in.items() if k in (main, "\\input"))
        # the first block (or \input) removed there becomes \input{pools}
        new_edits = []
        placed = False
        for s, e, rep in edits[main]:
            if s == at and not placed:
                new_edits.append((s, e, "\\input{pools}\n"))
                placed = True
            else:
                new_edits.append((s, e, rep))
        if not placed:  # before the \input of a file that keeps other content
            new_edits.append((at, at, "\\input{pools}\n"))
        edits[main] = new_edits
    out[main] = _apply(main_text, edits[main])
    for group, names in groups.items():
        for name in names:
            pools_text = pools_insert(pools_text, group, name)
    out[POOLS_FILE] = pools_text
    before = _questions_by_group({f: files[f] for f in order}, files.get(POOLS_FILE) or "", {})
    after = _questions_by_group({f: (out.get(f, files[f])) for f in order}, pools_text, items)
    if before != after:
        raise EditError("The exam can't be split cleanly (a question would change section or go missing). Nothing was changed.")
    kept = sum(1 for q in after if q[1] is None)
    return {"files": out, "pools": pools_text, "items": items, "figures": figures, "kept": kept}
