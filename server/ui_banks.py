"""
Question banks (doc/features.md): each instructor's
own banks, organised in groups of items, as an exam is organised in
sections. No school banks: a bank belongs to one instructor.

  MC-Projects/<user>/_banks/<bank>/        (single-user mode: MC-Projects/_banks/<bank>/)
    bank.json            uid, title, description, groups: [{name, title,
                         instructions, scoring, items: [item names]}]
    preamble.tex         macros and packages the items rely on
    items/<name>/item.tex, item.json (uid, title, tags, difficulty,
                         origin), and the item's figures

Its history is a git repository like an exam's (ui_vcs.py, target
"bank"). Items move between banks and exams as copies with a record of
where they came from (origin), never as live links. Standard library
only (plus the app's parsers), so tests run without Flask.
"""
import hashlib
import json
import os
import random
import re
import time

import ui_items as items
import ui_latex as ltx
import ui_questions as questions_edit
import ui_scale as scale
import ui_vcs as vcs

BANKS_DIR = vcs.BANKS_DIR
BANK_FILE = vcs.BANK_FILE
PREAMBLE = "preamble.tex"
NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _().,'+-]{0,79}\Z")  # a bank's folder, shown as its name
GROUP_RE = re.compile(r"^[A-Za-z][A-Za-z0-9-]{0,39}\Z")             # as AMC group names in exams
DIFFICULTIES = ("easy", "medium", "hard")
PREAMBLE_TEXT = ("% Macros and packages the items of this bank rely on: \\newcommand, \\usepackage...\n"
                 "% An exam that lacks them gets them when items are added to it.\n"
                 "\\usepackage{amsmath,amssymb}\n")
ID_RE = questions_edit.ID_RE


class BankError(ValueError):
    """Why a bank change can't be made, in words for the teacher."""


# ---------------------------------------------------------------- where banks are

def banks_root(projects_dir):
    return os.path.join(projects_dir, BANKS_DIR)


def bank_dir(projects_dir, name):
    """The folder of bank NAME of the teacher whose projects are in
    PROJECTS_DIR. Raises ValueError for a name that can't be a bank."""
    if not isinstance(name, str) or not NAME_RE.match(name) or name.strip() != name:
        raise ValueError(f"Not a bank name: {name!r}")
    return os.path.join(banks_root(projects_dir), name)


def list_banks(projects_dir):
    root = banks_root(projects_dir)
    out = []
    for n in sorted(os.listdir(root)) if os.path.isdir(root) else []:
        d = os.path.join(root, n)
        if NAME_RE.match(n) and not os.path.islink(d) and os.path.isfile(os.path.join(d, BANK_FILE)):
            b = read(d)
            out.append({"name": n, "title": b["title"], "description": b["description"], "uid": b["uid"],
                        "groups": len(b["groups"]), "items": len(b["all"])})
    return out


def check_name(projects_dir, name, exclude=None):
    """NAME, tidied, if it can be a new bank's name; else BankError."""
    name = re.sub(r"\s+", " ", str(name or "")).strip()
    if not NAME_RE.match(name):
        raise BankError("A bank's name uses letters, digits, spaces and . , - _ ( ) ' + (80 at most), starting with a letter or digit.")
    taken = {b.lower() for b in os.listdir(banks_root(projects_dir))} if os.path.isdir(banks_root(projects_dir)) else set()
    if name.lower() in taken and name.lower() != (exclude or "").lower():
        raise BankError(f"There is already a bank named \"{name}\".")
    return name


def free_name(projects_dir, wanted):
    """A new bank's name from WANTED (an imported bank's title or file
    name): characters a name can't hold dropped, "(2)" added when taken."""
    base = re.sub(r"\s+", " ", re.sub(r"[^A-Za-z0-9 _().,'+-]+", " ", str(wanted or "")))
    base = re.sub(r"^[^A-Za-z0-9]+", "", base).strip()[:70]
    if not base or not base[0].isalnum():
        base = ("Bank " + base).strip()[:70]
    name = base
    for n in range(2, 1000):
        try:
            return check_name(projects_dir, name)
        except BankError:
            name = f"{base} ({n})"
    raise BankError("No free name for this bank.")


# ---------------------------------------------------------------- bank.json

def _read_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            v = json.load(f)
        return v if isinstance(v, dict) else {}
    except (OSError, ValueError):
        return {}


def item_names(bdir):
    d = os.path.join(bdir, items.ITEMS_DIR)
    if not os.path.isdir(d) or os.path.islink(d):
        return []
    return sorted(n for n in os.listdir(d) if items.NAME_RE.match(n) and not os.path.islink(os.path.join(d, n))
                  and os.path.isfile(os.path.join(d, n, items.ITEM_FILE)))


def read(bdir):
    """The bank, tidied: groups list only items that exist (each once);
    "loose" holds items in no group; "all" every item, in group order."""
    raw = _read_json(os.path.join(bdir, BANK_FILE))
    on_disk = item_names(bdir)
    seen, groups = set(), []
    for g in raw.get("groups") if isinstance(raw.get("groups"), list) else []:
        if not isinstance(g, dict) or not GROUP_RE.match(str(g.get("name") or "")) or any(x["name"] == g["name"] for x in groups):
            continue
        names = [n for n in (g.get("items") if isinstance(g.get("items"), list) else []) if n in on_disk and n not in seen]
        seen.update(names)
        groups.append({"name": g["name"], "title": str(g.get("title") or ""), "instructions": str(g.get("instructions") or ""),
                       "scoring": str(g.get("scoring") or ""), "items": names})
    loose = [n for n in on_disk if n not in seen]
    return {"uid": raw.get("uid") if isinstance(raw.get("uid"), str) and vcs.UID_RE.match(raw.get("uid")) else None,
            "title": str(raw.get("title") or os.path.basename(bdir)), "description": str(raw.get("description") or ""),
            "created": raw.get("created"), "groups": groups, "loose": loose,
            "all": [n for g in groups for n in g["items"]] + loose}


def to_json(bank):
    out = {"uid": bank.get("uid"), "title": bank.get("title") or "", "description": bank.get("description") or "",
           "created": bank.get("created") or int(time.time()),
           "groups": [{"name": g["name"], "title": g.get("title") or "", "instructions": g.get("instructions") or "",
                       "scoring": g.get("scoring") or "", "items": list(g.get("items") or [])} for g in bank.get("groups") or []]}
    return json.dumps(out, indent=1, ensure_ascii=False) + "\n"


def new_bank(title, description=""):
    return {"uid": vcs.new_uid(), "title": title, "description": description, "created": int(time.time()), "groups": []}


def group(bank, name):
    return next((g for g in bank["groups"] if g["name"] == name), None)


def group_of(bank, item):
    return next((g["name"] for g in bank["groups"] if item in g["items"]), None)


def group_map(bank):
    return {n: g["name"] for g in bank["groups"] for n in g["items"]}


def free_group(bank_or_names, base):
    names = {g["name"] for g in bank_or_names["groups"]} if isinstance(bank_or_names, dict) else set(bank_or_names)
    base = re.sub(r"[^A-Za-z0-9-]+", "-", str(base or "group")).strip("-") or "group"
    if not base[0].isalpha():
        base = "g-" + base
    base = base[:36]
    name, n = base, 1
    while name in names:
        n += 1
        name = f"{base}-{n}"
    return name


def group_name(raw):
    """The group name RAW can be in a bank: itself when GROUP_RE takes it,
    else its letters, digits and - (the same RAW always gives the same
    name, so an import's items of one group stay together)."""
    raw = str(raw or "")
    if GROUP_RE.match(raw):
        return raw
    base = re.sub(r"[^A-Za-z0-9-]+", "-", raw).strip("-")[:40].strip("-") or "group"
    return base if base[0].isalpha() else ("g-" + base)[:40]


def seed_of(value):
    """A client-given seed random.Random can take, or None."""
    return value if isinstance(value, (str, int)) and not isinstance(value, bool) and len(str(value)) <= 200 else None


def place(bank, item, group_name, before=None):
    """Put ITEM in GROUP (before another item, or at its end); out of any
    other group. GROUP None: in no group."""
    for g in bank["groups"]:
        if item in g["items"]:
            g["items"].remove(item)
    if group_name is None:
        return bank
    g = group(bank, group_name)
    if g is None:
        raise BankError(f"There is no group \"{group_name}\" in this bank.")
    if before and before in g["items"]:
        g["items"].insert(g["items"].index(before), item)
    else:
        g["items"].append(item)
    return bank


# ---------------------------------------------------------------- items

def item_meta(bdir, name):
    return _read_json(os.path.join(bdir, items.ITEMS_DIR, name, items.META_FILE))


def meta_json(uid=None, title="", tags=(), difficulty="", origin=None, created=None, archived=False):
    m = {"uid": uid or vcs.new_uid(), "title": title or "", "tags": [t for t in tags if t][:20],
         "difficulty": difficulty if difficulty in DIFFICULTIES else "", "created": created or int(time.time())}
    if origin:
        m["origin"] = origin
    if archived:
        m["archived"] = True
    return json.dumps(m, indent=1, ensure_ascii=False) + "\n"


def tidy_tags(text):
    tags = [re.sub(r"\s+", " ", t).strip()[:40] for t in re.split(r"[,;\n]", str(text or ""))]
    out = []
    for t in tags:
        if t and t.lower() not in [x.lower() for x in out]:
            out.append(t)
    return out[:20]


def item_files(folder):
    """The files of an item folder: {name: bytes} (item.tex, item.json, figures)."""
    out = {}
    for f in sorted(os.listdir(folder)) if os.path.isdir(folder) else []:
        p = os.path.join(folder, f)
        if os.path.isfile(p) and not os.path.islink(p) and vcs.tracked(f"{items.ITEMS_DIR}/x/{f}"):
            with open(p, "rb") as fh:
                out[f] = fh.read()
    return out


def figures_of(files):
    return {f: d for f, d in files.items() if f not in (items.ITEM_FILE, items.META_FILE)}


def fingerprint(text, figures=None, ids=None):
    """What an item is, independent of where it is kept: its LaTeX (spacing
    at line ends ignored, question names as they were in the bank when IDS
    maps bank names to exam names) and its figures."""
    t = text.decode("utf-8", "replace") if isinstance(text, bytes) else (text or "")
    if ids:
        back = {v: k for k, v in ids.items()}
        t = rename_ids(t, back)
    h = hashlib.sha256("\n".join(l.rstrip() for l in t.strip().split("\n")).encode("utf-8"))
    for name in sorted(figures or {}):
        h.update(b"\0" + name.encode("utf-8") + b"\0" + hashlib.sha256(figures[name]).digest())
    return h.hexdigest()[:32]


def question_ids(text):
    return [q["id"] for q in scale.read_latex(text or "")]


def rename_ids(text, mapping):
    """TEXT with its questions renamed (old -> new)."""
    ops = [{"op": "rename", "id": old, "new_id": new} for old, new in mapping.items() if old != new and old in question_ids(text)]
    if not ops:
        return text
    # two steps, so a swap (a -> b, b -> a) doesn't clash midway
    tmp = {}
    for i, op in enumerate(ops):
        tmp[op["new_id"]] = f"amcuitmp{i}x"
        text, _ = questions_edit.apply(text, [{"op": "rename", "id": op["id"], "new_id": tmp[op["new_id"]]}])
    for new, t in tmp.items():
        text, _ = questions_edit.apply(text, [{"op": "rename", "id": t, "new_id": new}])
    return text


def free_ids(text, taken):
    """{old: new} for the questions of TEXT whose names are TAKEN."""
    taken = set(taken)
    out = {}
    for qid in question_ids(text):
        if qid in taken:
            out[qid] = _free_id(qid, taken)
            taken.add(out[qid])
        else:
            taken.add(qid)
    return out


def _free_id(qid, taken):
    n, new = 2, f"{qid}-2"
    while new in taken or not ID_RE.match(new):
        n += 1
        new = f"{qid[:58]}-{n}"
    return new


def pick(names, n, seed=None):
    """N of NAMES at random (once: the pick is shown, then kept)."""
    names = list(names)
    n = max(0, min(int(n), len(names)))
    return random.Random(seed).sample(names, n)


def tidy_blueprint(rows, bank):
    """A blueprint as the teacher sent it, checked: at most 20 rows of
    {count (1-200), difficulty, group (of BANK) and tag, each "" for any}."""
    out = []
    for r in rows[:20] if isinstance(rows, list) else []:
        if not isinstance(r, dict):
            continue
        try:
            n = int(r.get("count") or 0)
        except (TypeError, ValueError, OverflowError):  # OverflowError: 1e999 parses as infinity
            continue
        if n < 1:
            continue
        out.append({"count": min(n, 200), "difficulty": r.get("difficulty") if r.get("difficulty") in DIFFICULTIES else "",
                    "group": r.get("group") if group(bank, str(r.get("group") or "")) else "",
                    "tag": re.sub(r"\s+", " ", str(r.get("tag") or "")).strip()[:40]})
    return out


def blueprint_pick(candidates, rows, seed=None):
    """Draw at random for each row of a blueprint ("3 easy from Algebra"):
    CANDIDATES [{item, group, difficulty, tags}] matching the row, never one
    drawn already. The pick is made once, then shown and kept. Returns
    (items, [(row index, how many were found) for rows short of questions])."""
    rnd = random.Random(seed)
    taken, out, short = set(), [], []
    for i, r in enumerate(rows):
        tag = (r.get("tag") or "").lower()
        pool = [c["item"] for c in candidates if c["item"] not in taken
                and (not r.get("difficulty") or c.get("difficulty") == r["difficulty"])
                and (not r.get("group") or c.get("group") == r["group"])
                and (not tag or tag in [x.lower() for x in c.get("tags") or []])]
        got = rnd.sample(pool, min(r["count"], len(pool)))
        if len(got) < r["count"]:
            short.append((i, len(got)))
        taken.update(got)
        out += got
    return out, short


def blueprint_words(row, found):
    """A blueprint row short of questions, in words."""
    what = " ".join(x for x in (row.get("difficulty"), f"tagged {row['tag']}" if row.get("tag") else "") if x)
    return (f"{row['count']} {what + ' ' if what else ''}question{'s' if row['count'] != 1 else ''}"
            + (f" from {row['group']}" if row.get("group") else "") + f": only {found} available")


def plain_title(text, most=80):
    """A question's text as a short plain title."""
    qs = scale.read_latex(text or "")
    t = (qs[0]["text"] if qs else re.sub(r"\\[A-Za-z]+|[{}$]", " ", text or "")).strip()
    return re.sub(r"\s+", " ", t)[:most]


# ---------------------------------------------------------------- macros an item needs

MACROS_BEGIN = "%%AMCUI:BANK MACROS%%"
MACROS_END = "%%AMCUI:END BANK MACROS%%"
_USED = re.compile(r"\\([A-Za-z@]+)")


def definition_spans(text):
    """[(macro name, start, end)] of the macro definitions TEXT holds,
    whole: a \\newcommand body of several lines, its [n] arguments, a
    \\def's #1#2, a \\let's target. Comments and verbatim are ignored."""
    masked = ltx._mask(text or "")
    out = []
    n = len(masked)
    for m in ltx._MACRO_DEF.finditer(masked):
        name = m.group(1) or m.group(2)
        start = text.rfind("\n", 0, m.start()) + 1
        if masked[start:m.start()].strip():
            start = m.start()
        i = last = m.end()
        braced = False
        while i < n:
            c = masked[i]
            if c in " \t":
                i += 1
            elif c == "}" and not braced:  # the } of \newcommand{\name}
                i += 1
                last = i
            elif c == "[":
                j = masked.find("]", i)
                i = last = n if j < 0 else j + 1
            elif c == "{":
                depth, j = 0, i
                while j < n:
                    if masked[j] == "{":
                        depth += 1
                    elif masked[j] == "}":
                        depth -= 1
                        if depth == 0:
                            break
                    j += 1
                i = last = j + 1
                braced = True
                k = i
                while k < n and masked[k] in " \t":
                    k += 1
                if k >= n or masked[k] not in "{[":
                    break
            elif c == "#" and not braced:
                i = last = i + 2
            elif c in "\\=" and not braced:  # \let\a=\b, \def\x\y
                j = i + 1
                while j < n and masked[j].isalpha():
                    j += 1
                i = last = max(j, i + 1)
            else:
                break
        if not braced:  # \let and the like: the rest of the line
            eol = masked.find("\n", m.end())
            last = n if eol < 0 else eol
        out.append((name, start, last))
    return out


def definitions(preamble):
    """{macro name: its whole definition} in a bank's preamble, in order."""
    out = {}
    for name, s, e in definition_spans(preamble or ""):
        out.setdefault(name, preamble[s:e].strip())
    return out


def needed(texts, preamble, defined):
    """The definitions of PREAMBLE that TEXTS use and DEFINED (the exam's
    own macros) lacks, with the macros those definitions use in turn, in
    the preamble's order."""
    defs = definitions(preamble)
    defined = set(defined)
    queue = [n for n in defs if n not in defined and n in {m for t in texts for m in _USED.findall(t or "")}]
    want = set()
    while queue:
        n = queue.pop(0)
        if n in want:
            continue
        want.add(n)
        queue += [m for m in _USED.findall(defs[n]) if m in defs and m not in defined and m not in want and m != n]
    lines = []
    for n in defs:
        if n in want and defs[n] not in lines:
            lines.append(defs[n])
    return lines


def add_definitions(main, lines):
    """MAIN with LINES in its bank-macros region, made before
    \\begin{document} when missing (or when a hand edit left only one of
    its markers). Lines already there aren't repeated."""
    if not lines:
        return main
    s, e = main.find(MACROS_BEGIN), main.find(MACROS_END)
    if 0 <= s < e:
        have = main[s:e]
        new = [l for l in lines if l not in have]
        return main[:e] + "".join(l + "\n" for l in new) + main[e:] if new else main
    m = re.search(r"\\begin\s*\{document\}", ltx._mask(main))
    if not m:
        raise BankError("The exam's main file has no \\begin{document}.")
    block = MACROS_BEGIN + "\n% Macros the questions from question banks use.\n" + "".join(l + "\n" for l in lines) + MACROS_END + "\n"
    return main[:m.start()] + block + main[m.start():]


_PACKAGE = re.compile(r"\\(?:usepackage|RequirePackage)\s*(\[[^\]]*\])?\s*\{([^{}]*)\}")


def packages_of(text):
    """The packages TEXT loads (comments ignored)."""
    out = set()
    for m in _PACKAGE.finditer(ltx._mask(text or "")):
        out |= {p.strip() for p in m.group(2).split(",") if p.strip()}
    return out


def needed_packages(preamble, exam_text):
    """The \\usepackage lines of a bank's PREAMBLE loading packages the
    exam doesn't load yet."""
    have = packages_of(exam_text)
    lines = []
    for m in _PACKAGE.finditer(ltx._mask(preamble or "")):
        names = [p.strip() for p in m.group(2).split(",") if p.strip()]
        missing = [p for p in names if p not in have]
        if missing:
            lines.append(f"\\usepackage{m.group(1) or ''}{{{','.join(missing)}}}")
            have |= set(missing)
    return lines


def clashes(texts, preamble, exam_text):
    """Macros TEXTS use that the bank's PREAMBLE and the exam (EXAM_TEXT)
    both define, differently: [{"macro", "bank", "exam"}]. The exam's
    definition is kept; the teacher is told, never overwritten silently."""
    used = {m for t in texts for m in _USED.findall(t or "")}
    mine, theirs = definitions(preamble), definitions(ltx.preamble(exam_text) or exam_text)
    norm = lambda line: re.sub(r"\\(?:re|provide)?newcommand\*?|\\providecommand\*?|\s+", "", line.split("%")[0])
    return [{"macro": "\\" + n, "bank": mine[n], "exam": theirs[n]} for n in sorted(used)
            if n in mine and n in theirs and norm(mine[n]) != norm(theirs[n])]


# ---------------------------------------------------------------- copies (section 7.4)
#
# An exam's copy of a bank item is the bank's text with the changes made on
# the way in: questions renamed where the exam already used the name, and
# the group's scoring given to questions. The record (origin in the exam's
# item.json) keeps those changes, so the way back undoes them and the
# status compares like with like:
#   origin = {bank, bank_uid, item, item_uid, revision (the bank's version),
#             fingerprint (of the bank's item at that version), ids {bank
#             name: exam name}, scoring (the rule given), scored {bank name:
#             rule it had before, "" for none}, replace, at}

STATUS_WORDS = {"same": "Up to date", "bank": "Bank updated", "here": "Edited here", "both": "Both changed",
                "kept": "Bank's newer version set aside", "gone": "Not in the bank any more"}


def origin_of(meta):
    """An item's origin record (where its copy came from), typed: ids and
    scored as {str: str}, text fields as str or None. {} when the item
    isn't a bank copy. item.json is a file the teacher may edit by hand."""
    o = (meta or {}).get("origin")
    if not isinstance(o, dict):
        return {}
    out = dict(o)
    for k in ("ids", "scored"):
        v = o.get(k)
        out[k] = {str(a): ("" if b is None else str(b)) for a, b in v.items()} if isinstance(v, dict) else {}
    for k in ("bank", "bank_uid", "item", "item_uid", "revision", "fingerprint", "seen_fp", "scoring"):
        if k in out and not isinstance(out[k], str):
            out[k] = None
    out["replace"] = bool(o.get("replace"))
    return out


def _own_rule(q):
    return ((q.get("scoring") or {}).get("rule") or "").strip()


def way_in(text, ids=None, scoring="", replace=False):
    """A bank item's TEXT as an exam's copy: SCORING given to its questions
    that have none (to every one when REPLACE), then questions renamed (IDS:
    bank name -> exam name). Returns (text, scored): the bank names of the
    questions whose scoring was set, with the rule they had before."""
    scored = {}
    scoring = (scoring or "").strip()
    if scoring:
        for qid in question_ids(text):
            q = next(x for x in scale.read_latex(text) if x["id"] == qid)
            own = _own_rule(q)
            if own == scoring or (own and not replace):
                continue
            scored[qid] = own
            text = scale.set_scoring(text, q, scoring)
    return rename_ids(text, ids or {}), scored


def way_back(text, origin):
    """An exam's copy TEXT as the bank's item: question names back, and the
    scoring given on the way in taken back where it is still that rule."""
    origin = origin or {}
    ids = origin.get("ids") or {}
    text = rename_ids(text, {v: k for k, v in ids.items()})
    rule = (origin.get("scoring") or "").strip()
    for qid, before in (origin.get("scored") or {}).items():
        q = next((x for x in scale.read_latex(text) if x["id"] == qid), None)
        if q and _own_rule(q) == rule:
            text = scale.set_scoring(text, q, before or "")
    return text


def extend_ids(text, ids, taken):
    """IDS (bank name -> exam name) with names for TEXT's questions that
    have none yet and whose name is TAKEN in the exam."""
    ids = {k: v for k, v in (ids or {}).items() if k in question_ids(text)}
    taken = set(taken) | set(ids.values())
    for qid in question_ids(text):
        if qid in ids:
            continue
        if qid in taken:
            ids[qid] = _free_id(qid, taken)
            taken.add(ids[qid])
        else:
            taken.add(qid)
    return ids


def status(exam_text, exam_figures, origin, bank_text, bank_figures):
    """"same", "bank" (the bank has a newer revision), "here" (the exam's
    copy was changed), "both", or "gone" (the bank's item isn't there)."""
    if bank_text is None:
        return "gone"
    here = fingerprint(way_back(exam_text, origin), exam_figures) != origin.get("fingerprint")
    bank_fp = fingerprint(bank_text, bank_figures)
    there = bank_fp != origin.get("fingerprint")
    if not there:
        return "here" if here else "same"
    if bank_fp == origin.get("seen_fp"):  # "Keep this exam's" was chosen for this bank version
        return "here" if here else "kept"
    return "both" if here else "bank"


def merge_texts(mine, base, theirs):
    """Three-way merge (git merge-file, outside any repository): (text,
    conflicts). Conflicting places are marked <<<<<<< this exam / ======= /
    >>>>>>> the bank."""
    return vcs.merge_text(mine, base, theirs, labels=("this exam", "as copied", "the bank"))


CONFLICT_RE = re.compile(r"^(<{7}|={7}|>{7})([ \t\r]|$)", re.M)
