"""
Question banks: the routes (doc/question-bank-plan.md, section 7). The
model is ui_banks.py, histories are ui_vcs.py (target "bank"); the exam
side uses ui.py's helpers. Registered by ui.py on its blueprint.

  GET  /ui/api/banks                     the teacher's banks
  POST /ui/api/banks                     create, rename, describe, delete (to the trash)
  GET  /ui/api/bank/<b>                  a bank as the question editor reads it
  POST /ui/api/bank/<b>/editor           form edits of an item
  GET|POST /ui/api/bank/<b>/source       an item's (or the preamble's) LaTeX
  POST /ui/api/bank/<b>/items            add, delete, move, describe items
  POST /ui/api/bank/<b>/groups           add, rename, describe, move, delete groups
  POST /ui/api/bank/<b>/check            "Check this question" with the bank's preamble
  GET  /ui/api/bank/<b>/completions      macros and question names
  POST /ui/api/bank/<b>/import           RJ-style LaTeX files (\\element blocks) with figures
  POST /ui/api/bank-pull                 bank -> the open exam
  POST /ui/api/bank-save                 the open exam -> a bank
  GET  /ui/api/bank-search               search the teacher's banks (ui_bankindex.py)
  GET  /ui/api/bank/<b>/usage            the exams that printed or hold an item
  GET  /ui/api/bank/<b>/export           the bank as a zip, with its history (ui_bankzip.py)
  POST /ui/api/banks/import              a bank's zip, checked, as a new bank

Copies and their status, updates either way and a section's follow-up of
its group are in ui_bankcopies.py.
"""
import io
import os
import re
import shutil
import sqlite3
import time
import uuid

from flask import jsonify, request, send_file

import ui_bankcopies as copies
import ui_bankindex as bankindex
import ui_banks as banks
import ui_bankzip as bankzip
import ui_items as items
import ui_latex as ltx
import ui_questions as questions_edit
import ui_scale as scale
import ui_structure as paper_structure
import ui_vcs as vcs

ui = None  # the ui module (set by init)
CHECK_PREAMBLE = ("\\documentclass[a4paper]{article}\n\\usepackage{iftex}\n\\ifPDFTeX\\usepackage[utf8]{inputenc}\\usepackage[T1]{fontenc}\\fi\n"
                  "\\usepackage{amsmath,amssymb,graphicx}\n\\usepackage[box,completemulti]{automultiplechoice}\n")
def init(bp, ui_module):
    global ui
    ui = ui_module
    for rule, view, methods in ROUTES:
        bp.add_url_rule(rule, view.__name__, view, methods=methods)
    copies.init(bp, ui_module, __import__(__name__))


# ---------------------------------------------------------------- helpers

def _err(message, code=200, **kw):
    return jsonify(error=message, **kw), code


def _who():
    return ui._who()


def _projects():
    ui.core.headers_info()
    return ui.core.projects_dir()


def _change(bdir, what, kind="save"):
    return vcs.change(bdir, ui._root(), by=_who(), what=what[:200], kind=kind, target="bank")


def _repo(bdir):
    return vcs.Repo(bdir, ui._root(), "bank").open(by=_who())


def _read_text(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def _bank_questions(bdir, bank, skip=()):
    gmap = banks.group_map(bank)
    out = []
    for n in bank["all"]:
        if n in skip:
            continue
        fn = items.item_file(n)
        try:
            out += items.annotate(scale.read_latex(_read_text(os.path.join(bdir, fn)), fn), fn, gmap)
        except (OSError, UnicodeDecodeError):
            continue
    return out


def _payload(name, bdir):
    b = banks.read(bdir)
    gmap = banks.group_map(b)
    files = []
    for n in b["all"]:
        f = ui._editor_file(bdir, items.item_file(n), pmap=gmap)
        m = banks.item_meta(bdir, n)
        f["meta"] = {"uid": m.get("uid"), "title": m.get("title") or "", "tags": m.get("tags") or [],
                     "difficulty": m.get("difficulty") or "", "origin": m.get("origin"), "archived": bool(m.get("archived"))}
        files.append(f)
    return {"project": None, "bank": {"name": name, "title": b["title"], "description": b["description"], "uid": b["uid"],
                                      "groups": b["groups"], "loose": b["loose"]},
            "format": "latex", "main": None, "files": files, "lock": False, "modular": True, "can_split": False}


def _scoring_ok(rule):
    return not rule or re.fullmatch(r"[A-Za-z0-9=.,+\-*/() \\]{1,200}", rule)


# ---------------------------------------------------------------- banks

def api_banks():
    pd = _projects()
    return jsonify(banks=banks.list_banks(pd))


def api_banks_edit():
    """create {name, description}; rename {name, new}; describe {name,
    description}; delete {name} (to the trash, with its history)."""
    pd = _projects()
    data = request.get_json(silent=True)
    data = data if isinstance(data, dict) else {}
    op = data.get("op")
    try:
        if op == "create":
            name = banks.check_name(pd, data.get("name"))
            bdir = banks.bank_dir(pd, name)
            os.makedirs(bdir)
            b = banks.new_bank(name, str(data.get("description") or "")[:500])
            with open(os.path.join(bdir, banks.BANK_FILE), "w", encoding="utf-8") as f:
                f.write(banks.to_json(b))
            with open(os.path.join(bdir, banks.PREAMBLE), "w", encoding="utf-8") as f:
                f.write(banks.PREAMBLE_TEXT)
            vcs.snapshot(bdir, ui._root(), by=_who(), what=f"Bank \"{name}\" created", kind="create", target="bank")
            vcs.audit(vcs.amcweb_dir(bdir, ui._root(), "bank"), _who(), "bank created", bank=name, uid=b["uid"])
            return jsonify(ok=True, name=name)
        bdir = ui.bank_dir(str(data.get("name") or ""))
        if not bdir:
            return _err("This bank doesn't exist any more.")
        name = os.path.basename(bdir)
        if op == "rename":
            new = banks.check_name(pd, data.get("new"), exclude=name)
            if new == name:
                return jsonify(ok=True, name=name)
            os.rename(bdir, banks.bank_dir(pd, new))
            nd = banks.bank_dir(pd, new)
            with _change(nd, f"Bank renamed from \"{name}\" to \"{new}\"") as cs:
                b = banks.read(nd)
                b["title"] = new
                cs.write(banks.BANK_FILE, banks.to_json(b).encode("utf-8"))
            vcs.audit(vcs.amcweb_dir(nd, ui._root(), "bank"), _who(), "bank renamed", bank=new, old=name)
            return jsonify(ok=True, name=new)
        if op == "describe":
            with _change(bdir, "Bank description changed") as cs:
                b = banks.read(bdir)
                b["description"] = str(data.get("description") or "")[:500]
                cs.write(banks.BANK_FILE, banks.to_json(b).encode("utf-8"))
            return jsonify(ok=True, name=name)
        if op == "delete":
            info = vcs.trash_exam(bdir, ui._root(), by=_who(), target="bank")
            return jsonify(ok=True, trash=info["id"])
    except banks.BankError as e:
        return _err(str(e))
    except (vcs.HistoryError, OSError) as e:
        ui.core.app.logger.error(f"Banks: {e}")
        return _err("This can't be done just now. The server log has the details.")
    return _err("Unknown action.", 400)


def api_bank(name):
    bdir = ui.bank_dir(name)
    if not bdir:
        return jsonify(project=None, bank=None), 404
    return jsonify(_payload(name, bdir))


# ---------------------------------------------------------------- items of a bank

def _clash(bdir, bank, fn, old, new):
    added = set(banks.question_ids(new)) - set(banks.question_ids(old))
    if not added:
        return None
    others = {q["id"] for q in _bank_questions(bdir, bank, skip={items.item_of(fn)})}
    c = sorted(added & others)
    return c[0] if c else None


def api_bank_editor(name):
    """The question form's edits, on an item of the bank."""
    bdir = ui.bank_dir(name)
    if not bdir:
        return _err("This bank doesn't exist any more.")
    data = request.get_json(silent=True)
    data = data if isinstance(data, dict) else {}
    fn = str(data.get("file") or "")
    b = banks.read(bdir)
    if items.item_of(fn) not in b["all"]:
        return _err("Not an item of this bank.")
    path = os.path.join(bdir, fn)
    raw = open(path, "rb").read()
    text = raw.decode("utf-8", "replace")
    based_on = str(data.get("based_on") or "") or None
    if based_on and based_on != vcs.digest(raw):
        return _err("This item was changed since it was read. Reload to see the changes.", conflict=True)
    try:
        new, what = questions_edit.apply(text, data.get("ops"))
    except questions_edit.EditError as e:
        return _err(str(e))
    if c := _clash(bdir, b, fn, text, new):
        return _err(f"A question is already named \"{c}\" in this bank.")
    if not scale.read_latex(new):
        return _err("This is the item's only question: delete the item instead.")
    try:
        dg = vcs.write(bdir, ui._root(), fn, new.encode("utf-8"), by=_who(), what=what, based_on=based_on, target="bank")
    except vcs.Conflict:
        return _err("This item was changed since it was read. Reload to see the changes.", conflict=True)
    return jsonify(ok=True, digest=dg, what=what, file=ui._editor_file(bdir, fn, pmap=banks.group_map(b)))


def _bank_file(bdir, fn):
    b = banks.read(bdir)
    return fn == banks.PREAMBLE or items.item_of(fn) in b["all"]


def api_bank_source(name):
    bdir = ui.bank_dir(name)
    if not bdir:
        return jsonify(project=None), 404
    fn = request.args.get("file", "") if request.method == "GET" else str((request.get_json(silent=True) or {}).get("file") or "")
    if not _bank_file(bdir, fn):
        return _err("Not a file of this bank.", 400)
    path = os.path.join(bdir, fn)
    if request.method == "GET":
        try:
            raw = open(path, "rb").read()
        except OSError:
            raw = b""
        return jsonify(file=fn, text=raw.decode("utf-8", "replace"), digest=vcs.digest(raw), tracked=True)
    data = request.get_json(silent=True) or {}
    text = data.get("text")
    if not isinstance(text, str):
        return _err("Nothing to save.")
    if p := ltx.problems(text):
        return _err(f"Line {p[0]['line']}: {p[0]['message']}", line=p[0]["line"])
    b = banks.read(bdir)
    if items.item_of(fn):
        if problem := items.check_item_text(text, items.item_of(fn)):
            return _err(problem)
        if c := _clash(bdir, b, fn, _read_text(path), text):
            return _err(f"A question is already named \"{c}\" in this bank.")
    try:
        dg = vcs.write(bdir, ui._root(), fn, text.encode("utf-8"), by=_who(), what=f"{fn}: LaTeX edited",
                       based_on=str(data.get("based_on") or "") or None, target="bank")
    except vcs.Conflict as c:
        return _err("This file was changed since you opened it.", conflict=True, digest=str(c))
    return jsonify(ok=True, digest=dg)


def api_bank_items(name):
    """add {kind, group, after}; delete {item}; move {item, group, before};
    describe {item, title, tags, difficulty, archived}. An archived item is
    hidden from "From a bank"; exams and history keep it."""
    bdir = ui.bank_dir(name)
    if not bdir:
        return _err("This bank doesn't exist any more.")
    data = request.get_json(silent=True)
    data = data if isinstance(data, dict) else {}
    op = data.get("op")
    try:
        with _change(bdir, f"Bank: {op}") as cs:
            b = banks.read(bdir)
            if op == "add":
                kind = data.get("kind") if data.get("kind") in questions_edit.ENVS else "single"
                grp = str(data.get("group") or "") or None
                if grp and not banks.group(b, grp):
                    raise banks.BankError(f"There is no group \"{grp}\" in this bank.")
                qid = questions_edit._free_id(_bank_questions(bdir, b), kind)
                n = items.free_name(qid, b["all"])
                cs.what = f"{qid}: question added" + (f" to {grp}" if grp else "")
                cs.write(items.item_file(n), items.new_item_text(kind, qid).encode("utf-8"))
                cs.write(f"{items.ITEMS_DIR}/{n}/{items.META_FILE}", banks.meta_json().encode("utf-8"))
                after = str(data.get("after") or "")
                g = banks.group(b, grp) if grp else None
                before = g["items"][g["items"].index(after) + 1] if g and after in g["items"] and g["items"].index(after) + 1 < len(g["items"]) else None
                banks.place(b, n, grp, before=before)
                added = {"file": items.item_file(n), "id": qid}
            else:
                n = str(data.get("item") or "")
                if n not in b["all"]:
                    raise banks.BankError(f"The item \"{n}\" isn't in this bank any more.")
                added = None
                if op == "delete":
                    cs.what, cs.kind = f"Item {n} deleted", "delete"
                    banks.place(b, n, None)
                    folder = os.path.join(bdir, items.ITEMS_DIR, n)
                    for f in sorted(os.listdir(folder)):
                        if vcs.tracked(f"{items.ITEMS_DIR}/{n}/{f}"):
                            cs.delete(f"{items.ITEMS_DIR}/{n}/{f}")
                    shutil.rmtree(folder, ignore_errors=True)
                elif op == "move":
                    grp = str(data.get("group") or "") or None
                    cs.what = f"Item {n} moved" + (f" to {grp}" if grp and grp != banks.group_of(b, n) else "")
                    banks.place(b, n, grp, before=str(data.get("before") or "") or None)
                elif op == "describe":
                    m = banks.item_meta(bdir, n)
                    diff = str(data.get("difficulty") or "")
                    if diff and diff not in banks.DIFFICULTIES:
                        raise banks.BankError("Difficulty: easy, medium or hard.")
                    archived = data["archived"] in (True, 1, "1", "true") if "archived" in data else bool(m.get("archived"))
                    cs.what = (f"Item {n} archived" if archived and not m.get("archived") else f"Item {n} back from the archive"
                               if m.get("archived") and not archived else f"Item {n}: title, tags or difficulty changed")
                    cs.write(f"{items.ITEMS_DIR}/{n}/{items.META_FILE}", banks.meta_json(
                        uid=m.get("uid"), title=str(data.get("title", m.get("title") or ""))[:120],
                        tags=banks.tidy_tags(data["tags"]) if "tags" in data else m.get("tags") or [],
                        difficulty=diff if "difficulty" in data else m.get("difficulty") or "",
                        origin=m.get("origin"), created=m.get("created"), archived=archived).encode("utf-8"))
                else:
                    raise banks.BankError("Unknown action.")
            cs.write(banks.BANK_FILE, banks.to_json(b).encode("utf-8"))
    except banks.BankError as e:
        return _err(str(e))
    out = _payload(name, bdir)
    out.update(ok=True, added=added)
    return jsonify(out)


def api_bank_groups(name):
    """add {group, title}; rename {group, new}; describe {group, title,
    instructions, scoring}; move {group, before}; delete {group} (its
    items stay in the bank, in no group)."""
    bdir = ui.bank_dir(name)
    if not bdir:
        return _err("This bank doesn't exist any more.")
    data = request.get_json(silent=True)
    data = data if isinstance(data, dict) else {}
    op, gname = data.get("op"), str(data.get("group") or "")
    try:
        with _change(bdir, f"Bank: group {op}") as cs:
            b = banks.read(bdir)
            if op == "add":
                new = gname or banks.free_group(b, data.get("title") or "group")
                if not banks.GROUP_RE.match(new):
                    raise banks.BankError("A group's name uses letters, digits and -, starting with a letter (40 at most).")
                if banks.group(b, new):
                    raise banks.BankError(f"There is already a group \"{new}\".")
                b["groups"].append({"name": new, "title": str(data.get("title") or new)[:120], "instructions": "", "scoring": "", "items": []})
                cs.what = f"Group {new} added"
            else:
                g = banks.group(b, gname)
                if not g:
                    raise banks.BankError(f"There is no group \"{gname}\" in this bank.")
                if op == "rename":
                    new = str(data.get("new") or "")
                    if not banks.GROUP_RE.match(new) or (banks.group(b, new) and new != gname):
                        raise banks.BankError("That name can't be used (letters, digits and -, starting with a letter; not another group's).")
                    g["name"] = new
                    cs.what = f"Group {gname} renamed to {new}"
                elif op == "describe":
                    for k, most in (("title", 120), ("instructions", 5000), ("scoring", 200)):
                        if k in data:
                            g[k] = str(data.get(k) or "").strip()[:most]
                    if not _scoring_ok(g["scoring"]):
                        raise banks.BankError("The scoring rule contains characters AMC doesn't accept here.")
                    if p := ltx.problems(g["instructions"]):
                        raise banks.BankError(f"The instructions: {p[0]['message']}")
                    cs.what = f"Group {gname}: title, instructions or scoring changed"
                elif op == "move":
                    b["groups"].remove(g)
                    before = next((i for i, x in enumerate(b["groups"]) if x["name"] == data.get("before")), len(b["groups"]))
                    b["groups"].insert(before, g)
                    cs.what = f"Group {gname} moved"
                elif op == "delete":
                    b["groups"].remove(g)
                    cs.what = f"Group {gname} removed (its items stay in the bank)"
                else:
                    raise banks.BankError("Unknown action.")
            cs.write(banks.BANK_FILE, banks.to_json(b).encode("utf-8"))
    except banks.BankError as e:
        return _err(str(e))
    out = _payload(name, bdir)
    out.update(ok=True)
    return jsonify(out)


def api_bank_check(name):
    """Check this question, with the bank's preamble."""
    bdir = ui.bank_dir(name)
    if not bdir:
        return _err("This bank doesn't exist any more.")
    data = request.get_json(silent=True)
    data = data if isinstance(data, dict) else {}
    fn, body = str(data.get("file") or ""), data.get("text")
    if not items.item_of(fn) or not isinstance(body, str) or not body.strip():
        return _err("Nothing to check.")
    if p := ltx.problems(body):
        return jsonify(ok=False, errors=[{"line": p[0]["line"], "message": p[0]["message"], "file": None}], image=None)
    try:
        pre = CHECK_PREAMBLE + _read_text(os.path.join(bdir, banks.PREAMBLE))
    except (OSError, UnicodeDecodeError):
        pre = CHECK_PREAMBLE
    src, first = ltx.check_source(pre, body, items.item_of(fn))
    ok, log, png = ui.compile_check(bdir, src, engine="pdflatex")
    errors = []
    if not ok:
        e = ltx.first_error(log, bdir) or {"file": None, "line": None, "message": "LaTeX stopped.", "context": ""}
        line = e["line"] - first + 1 if e["file"] and e["file"].startswith(ui.CHECK_PREFIX) and e["line"] and e["line"] >= first else None
        errors.append({"line": line, "message": e["message"] if line or not e["file"] else f"{e['message']} (in the bank's preamble)",
                       "context": e["context"], "file": None})
    import base64
    return jsonify(ok=ok, errors=errors, image=("data:image/png;base64," + base64.b64encode(png).decode()) if png else None)


def api_bank_completions(name):
    bdir = ui.bank_dir(name)
    if not bdir:
        return jsonify(project=None)
    b = banks.read(bdir)
    try:
        pre = _read_text(os.path.join(bdir, banks.PREAMBLE))
    except (OSError, UnicodeDecodeError):
        pre = ""
    return jsonify(project=name, macros=ltx.macros(pre), ids=sorted({q["id"] for q in _bank_questions(bdir, b)}), items=b["all"])


# ---------------------------------------------------------------- importing RJ-style LaTeX files

def _definitions(text, known):
    """The package lines and whole macro definitions of TEXT's preamble
    the bank doesn't have yet (KNOWN: its macro names and lines)."""
    pre = ltx.preamble(text) or ""
    out = []
    for m in banks._PACKAGE.finditer(ltx._mask(pre)):
        line = pre[m.start():m.end()]
        if line not in known:
            out.append(line)
    for name, a, b in banks.definition_spans(pre):
        d = pre[a:b].strip()
        if name not in known and d not in known:
            out.append(d)
    return out


def api_bank_import(name):
    """LaTeX files whose questions are \\element{group}{...} blocks (the
    RJ question files), with their figures: each block becomes an item in
    the group of that name (made when missing), figures move into the item
    and are renamed after it, and macro definitions go to the bank's
    preamble. A file without \\element puts each question in a group named
    after the file."""
    bdir = ui.bank_dir(name)
    if not bdir:
        return _err("This bank doesn't exist any more.")
    uploads = [f for f in request.files.getlist("file") if f and f.filename]
    if not uploads:
        return _err("Choose the LaTeX files to import (and their figures).")
    tmp = ui.core.amc_user_tmp(f"bank-import-{uuid.uuid4().hex[:8]}")
    os.makedirs(tmp, exist_ok=True)
    try:
        names = []
        for f in uploads:
            base = os.path.basename(f.filename.replace("\\", "/"))
            if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 ._()+-]{0,120}", base):
                continue
            f.save(os.path.join(tmp, base))
            names.append(base)
        texs = [n for n in names if n.lower().endswith(".tex")]
        if not texs:
            return _err("No .tex file among the files.")
        exists = lambda p: "/" not in p and os.path.isfile(os.path.join(tmp, p))
        report = []
        with _change(bdir, "Questions imported") as cs:
            b = banks.read(bdir)
            taken = set(b["all"])
            ids = {q["id"] for q in _bank_questions(bdir, b)}
            pre_path = os.path.join(bdir, banks.PREAMBLE)
            preamble = _read_text(pre_path) if os.path.isfile(pre_path) else banks.PREAMBLE_TEXT
            known = set(ltx.macros(preamble)) | {l.strip() for l in preamble.split("\n")}
            added_defs = []
            for t in texs:
                text = _read_text(os.path.join(tmp, t))
                try:
                    r = items.split({t: text}, t, exists, taken=taken)
                    found = [(p["group"], p["name"]) for p in items.read_pools(r["pools"])]
                    texts, figures = r["items"], r["figures"]
                except items.EditError:
                    qs = scale.read_latex(text, t)
                    if not qs:
                        report.append(f"{t}: no question found")
                        continue
                    grp = banks.group_name(os.path.splitext(t)[0])
                    texts, found, figures = {}, [], []
                    for q in qs:
                        n = items.free_name(q["id"], taken | set(texts))
                        texts[n], moved = items.relocate_figures(text[q["span"][0]:q["span"][1]] + "\n", n, exists)
                        figures += moved
                        found.append((grp, n))
                for grp_raw, n in found:
                    grp = banks.group_name(grp_raw)
                    if not banks.group(b, grp):
                        b["groups"].append({"name": grp, "title": grp_raw, "instructions": "", "scoring": "", "items": []})
                    body = texts[n]
                    mapping = banks.free_ids(body, ids)
                    body = banks.rename_ids(body, mapping)
                    ids.update(banks.question_ids(body))
                    cs.write(items.item_file(n), body.encode("utf-8"))
                    cs.write(f"{items.ITEMS_DIR}/{n}/{items.META_FILE}", banks.meta_json(
                        title=banks.plain_title(body), origin={"file": t, "at": int(time.time())}).encode("utf-8"))
                    banks.place(b, n, grp)
                    taken.add(n)
                for src, dst in figures:
                    with open(os.path.join(tmp, src), "rb") as fh:
                        cs.write(dst, fh.read())
                defs = [d for d in _definitions(text, known) if d not in added_defs]
                added_defs += defs
                known |= set(ltx.macros("\n".join(defs))) | set(defs)
                report.append(f"{t}: {len(found)} item{'s' if len(found) != 1 else ''}")
            if added_defs:
                cs.write(banks.PREAMBLE, (preamble.rstrip("\n") + "\n" + "\n".join(added_defs) + "\n").encode("utf-8"))
            cs.write(banks.BANK_FILE, banks.to_json(b).encode("utf-8"))
            cs.what = "Imported " + "; ".join(report)
    except (OSError, UnicodeDecodeError) as e:
        ui.core.app.logger.error(f"Bank import: {e}")
        return _err("The files couldn't be read (LaTeX files must be UTF-8 text).")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    out = _payload(name, bdir)
    out.update(ok=True, what="; ".join(report), definitions=len(added_defs))
    return jsonify(out)


# ---------------------------------------------------------------- bank -> exam

def _exam_includes_pools(pdir):
    return items.includes_pools(ui._main_text(pdir)) or any(items.includes_pools(t) for t in ui._top_sources(pdir).values())


def _exam_groups(pdir):
    main = ui._main_text(pdir)
    return {s["name"] for s in paper_structure.read_sections(main)} | set(items.pool_map(ui._pools_text(pdir)).values()) \
        | {q["group"] for q in ui._all_questions(pdir, ui._source_files(pdir)) if q.get("group")}


def _exam_copies_of(pdir, bank_uid):
    """The uids of the bank's items the exam has a copy of."""
    out = set()
    for en in ui._item_names(pdir):
        o = banks.item_meta(pdir, en).get("origin") or {}
        if o.get("bank_uid") == bank_uid and o.get("item_uid"):
            out.add(o["item_uid"])
    return out


def api_bank_pull():
    """Into the open exam: a whole group (as a new section, or into one),
    selected items of a group, or COUNT of them picked at random (preview
    first: the pick is shown, then added as shown). Each is a copy with a
    record of where it came from (ui_banks.way_in); question names are
    changed where the exam already uses them; the group's scoring goes to
    questions that have none (to all with SCORING_ALL). Items the exam
    already has a copy of are not added twice. One version."""
    name = ui._open_project()
    if not name:
        return _err("This exam doesn't exist any more.")
    pdir = ui.core.project_dir()
    if ui._main_source()[0] != "latex":
        return _err("Question banks work with LaTeX exams.")
    data = request.get_json(silent=True)
    data = data if isinstance(data, dict) else {}
    bdir = ui.bank_dir(str(data.get("bank") or ""))
    if not bdir:
        return _err("This bank doesn't exist any more.")
    b = banks.read(bdir)
    g = banks.group(b, str(data.get("group") or ""))
    if not g:
        return _err("Choose a group of the bank.")
    chosen = data.get("items")
    names = list(dict.fromkeys(n for n in (chosen if isinstance(chosen, list) else g["items"]) if n in g["items"]))
    if not isinstance(chosen, list):  # a whole group or a random pick: archived items stay out
        names = [n for n in names if not banks.item_meta(bdir, n).get("archived")]
    if not names:
        return _err("Choose at least one question.")
    whole = not isinstance(chosen, list) and not data.get("count")
    have = _exam_copies_of(pdir, b["uid"])
    if data.get("count"):
        try:  # drawn from the questions the exam doesn't have yet
            names = banks.pick([n for n in names if banks.item_meta(bdir, n).get("uid") not in have], int(data["count"]), banks.seed_of(data.get("seed")))
        except (TypeError, ValueError):
            return _err("How many questions to pick: a whole number.")
    if data.get("preview"):
        return jsonify(ok=True, chosen=[{"item": n, "title": banks.plain_title(_read_text(os.path.join(bdir, items.item_file(n)))),
                                         "ids": banks.question_ids(_read_text(os.path.join(bdir, items.item_file(n))))} for n in names])
    if ui.exam_lock(pdir):
        return _err(ui.LOCKED.format(what="Questions can't be added now."), locked=True)
    if not _exam_includes_pools(pdir):
        return _err("This exam keeps its questions in its main file. Move them into item files first (Questions › Move questions into item files).")
    mode = data.get("mode") if data.get("mode") in ("new", "into") else "new"
    main_fn = ui.core.main_source_file()
    main = ui._main_text(pdir)
    groups = _exam_groups(pdir)
    if mode == "new":
        sec = banks.free_group(groups, g["name"])
        try:
            others = ui._all_questions(pdir, [f for f in ui._source_files(pdir) if f != main_fn])
            new_main, _, _ = paper_structure.apply(main, [{"op": "section_add", "name": sec, "heading": g["title"] or None,
                                                          "text": g["instructions"] or None, "count": None, "shuffle": False}], others)
        except questions_edit.EditError as e:
            return _err(str(e))
    else:
        sec = str(data.get("section") or "")
        if sec not in groups:
            return _err("Choose a section of the exam.")
        new_main = main
    head = _repo(bdir).head()
    exam_ids = {q["id"] for q in ui._all_questions(pdir, ui._source_files(pdir))}
    exam_items = set(ui._item_names(pdir))
    skipped = [n for n in names if banks.item_meta(bdir, n).get("uid") in have]
    names = [n for n in names if n not in skipped]
    if not names:
        return _err("This exam already has " + ("this question" if len(skipped) == 1 else "these questions") + " from the bank.")
    replace = bool(data.get("scoring_all")) and bool(g["scoring"])
    pools = ui._pools_text(pdir)
    writes, report, uids = {}, [], []
    for n in names:
        files = banks.item_files(os.path.join(bdir, items.ITEMS_DIR, n))
        text = files[items.ITEM_FILE].decode("utf-8", "replace")
        mapping = banks.free_ids(text, exam_ids)
        exam_ids.update(mapping.values())
        exam_ids.update(q for q in banks.question_ids(text) if q not in mapping)
        new_text, scored = banks.way_in(text, mapping, g["scoring"], replace)
        en = items.free_name(n, exam_items)
        exam_items.add(en)
        m = banks.item_meta(bdir, n)
        uids.append(m.get("uid"))
        origin = {"bank": os.path.basename(bdir), "bank_uid": b["uid"], "item": n, "item_uid": m.get("uid"),
                  "revision": head, "fingerprint": banks.fingerprint(text, banks.figures_of(files)),
                  "ids": {k: v for k, v in mapping.items()}, "scoring": g["scoring"] if scored else "", "scored": scored,
                  "replace": replace, "at": int(time.time())}
        writes[items.item_file(en)] = new_text.encode("utf-8")
        writes[f"{items.ITEMS_DIR}/{en}/{items.META_FILE}"] = banks.meta_json(
            title=m.get("title") or "", tags=m.get("tags") or [], difficulty=m.get("difficulty") or "", origin=origin).encode("utf-8")
        for f, d in banks.figures_of(files).items():
            writes[f"{items.ITEMS_DIR}/{en}/{f}"] = d
        pools = items.pools_insert(pools, sec, en)
        report.append(en)
    try:
        bank_pre = _read_text(os.path.join(bdir, banks.PREAMBLE))
    except (OSError, UnicodeDecodeError):
        bank_pre = ""
    exam_defined = ltx.macros(new_main + "".join(t for f, t in ui._top_sources(pdir).items() if f != main_fn))
    exam_all = new_main + "".join(t for f, t in ui._top_sources(pdir).items() if f != main_fn)
    texts = [d.decode("utf-8", "replace") for p, d in writes.items() if p.endswith("/" + items.ITEM_FILE)]
    add_lines = banks.needed_packages(bank_pre, exam_all) + banks.needed(texts, bank_pre, exam_defined)
    clashes = banks.clashes(texts, bank_pre, exam_all)
    try:
        new_main = banks.add_definitions(new_main, add_lines)
    except banks.BankError as e:
        return _err(str(e))
    what = (f"{len(names)} question{'s' if len(names) != 1 else ''} from the bank {os.path.basename(bdir)} › {g['title'] or g['name']}"
            + (f" as the new section {sec}" if mode == "new" else f" into {sec}")
            + (f"; macros and packages added to the preamble: {', '.join([chr(92) + n for n in ltx.macros(chr(10).join(add_lines))] + sorted(banks.packages_of(chr(10).join(add_lines))))}" if add_lines else ""))
    try:
        with ui.history_change(pdir, what):
            for path, d in writes.items():
                ui.save_source(pdir, path, d, what)
            ui.save_source(pdir, items.POOLS_FILE, pools.encode("utf-8"), what)
            if new_main != main:  # last: should a write fail before, the paper still builds as before
                ui.save_source(pdir, main_fn, new_main.encode("utf-8"), what)
    except (vcs.Conflict, OSError, ValueError) as e:
        return _err(f"Not added: {e}")
    if whole and mode == "new":  # a section made from a whole group follows it
        seen = [banks.item_meta(bdir, n).get("uid") for n in g["items"]]
        ui._update_record(pdir, lambda r: r.setdefault("sections_from", {}).__setitem__(
            sec, {"bank_uid": b["uid"], "bank": os.path.basename(bdir), "group": g["name"], "seen": sorted(u for u in seen if u)}))
    else:  # into a section: what it already follows (if the same group) learns of these items; nothing else changes
        copies.note_seen(pdir, sec, b["uid"], g["name"], [banks.item_meta(bdir, n).get("uid") for n in g["items"]] if whole else uids)
    ui.add_activity(pdir, what)
    ui.refresh_layout(pdir)
    ui.core.emit_msg("ui-changed", "questions")
    out = ui._items_payload(pdir, name)
    out.update(ok=True, what=what, section=sec, added=[items.item_file(n) for n in report], skipped=skipped, clashes=clashes)
    return jsonify(out)


# ---------------------------------------------------------------- exam -> bank

def _exam_sections(pdir):
    """[(section name, heading, instructions, [item names])] in paper order,
    then groups of pools.tex that no section uses."""
    main = ui._main_text(pdir)
    secs = paper_structure.read_sections(main)
    pools = items.read_pools(ui._pools_text(pdir))
    out = [(s["name"], s.get("heading") or "", s.get("text") or "", [p["name"] for p in pools if p["group"] == s["name"]]) for s in secs]
    used = {s["name"] for s in secs}
    for gname in dict.fromkeys(p["group"] for p in pools):
        if gname not in used:
            out.append((gname, "", "", [p["name"] for p in pools if p["group"] == gname]))
    return out


def api_bank_save():
    """From the open exam into a bank: ITEMS (exam item names) into GROUP,
    a whole SECTION as a group, or the WHOLE exam as a new bank (a group
    per section). An item that came from that bank is updated there when
    LINKED is "update", else saved as a new item. The exam's items then
    record where they are in the bank. One version in the bank, one in
    the exam."""
    name = ui._open_project()
    if not name:
        return _err("This exam doesn't exist any more.")
    pdir = ui.core.project_dir()
    data = request.get_json(silent=True)
    data = data if isinstance(data, dict) else {}
    exam_items = set(ui._item_names(pdir))
    pd = ui.core.projects_dir()
    plan = []  # (exam item, group name, group title, instructions)
    if data.get("whole"):
        for sname, heading, text, names in _exam_sections(pdir):
            plan += [(n, sname, re.sub(r"\\[A-Za-z]+\*?|[{}]", "", heading).strip() or sname, text, ) for n in names]
    elif data.get("section"):
        sec = next((s for s in _exam_sections(pdir) if s[0] == data["section"]), None)
        if not sec:
            return _err("This section isn't in the exam any more.")
        gname = str(data.get("group") or "") or banks.GROUP_RE.match(sec[0]) and sec[0] or "section"
        plan = [(n, gname, re.sub(r"\\[A-Za-z]+\*?|[{}]", "", sec[1]).strip() or sec[0], sec[2]) for n in sec[3]]
    else:
        names = data.get("items") if isinstance(data.get("items"), list) else []
        plan = [(n, str(data.get("group") or ""), str(data.get("group_title") or ""), "") for n in names]
    plan = [p for p in plan if p[0] in exam_items]
    if not plan:
        return _err("Nothing to save: choose questions kept in item files (Questions › Move questions into item files).")
    created = None
    try:
        if data.get("whole") or data.get("new_bank"):
            bname = banks.check_name(pd, data.get("new_bank") or name)
            bdir = banks.bank_dir(pd, bname)
            os.makedirs(bdir)
            created = bdir
            nb = banks.new_bank(bname, f"Made from the exam \"{name}\"")
            with open(os.path.join(bdir, banks.BANK_FILE), "w", encoding="utf-8") as f:
                f.write(banks.to_json(nb))
            with open(os.path.join(bdir, banks.PREAMBLE), "w", encoding="utf-8") as f:
                f.write(banks.PREAMBLE_TEXT)
            vcs.snapshot(bdir, ui._root(), by=_who(), what=f"Bank \"{bname}\" created from the exam \"{name}\"", kind="create", target="bank")
        else:
            bdir = ui.bank_dir(str(data.get("bank") or ""))
            if not bdir:
                return _err("Choose a bank.")
        linked_mode = "update" if data.get("linked") == "update" else "new"
        exam_uid = vcs.read_uid(pdir)
        saved = []  # (exam item, bank item, ids exam->bank)
        with _change(bdir, f"Saved from the exam {name}") as cs:
            b = banks.read(bdir)
            bank_ids = {q["id"] for q in _bank_questions(bdir, b)}
            by_uid = {u: n for n in b["all"] if (u := banks.item_meta(bdir, n).get("uid"))}
            for en, gname, gtitle, instr in plan:
                folder = os.path.join(pdir, items.ITEMS_DIR, en)
                files = banks.item_files(folder)
                text = files[items.ITEM_FILE].decode("utf-8", "replace")
                em = banks.item_meta(pdir, en)
                origin = em.get("origin") if isinstance(em.get("origin"), dict) else {}
                target = by_uid.get(origin.get("item_uid")) if b["uid"] and origin.get("bank_uid") == b["uid"] else None
                if target and linked_mode == "update":
                    bfiles = banks.item_files(os.path.join(bdir, items.ITEMS_DIR, target))
                    if banks.fingerprint(bfiles[items.ITEM_FILE].decode("utf-8", "replace"), banks.figures_of(bfiles)) != origin.get("fingerprint"):
                        raise banks.BankError(f"The bank's question {target} changed since this exam took it. Compare them (Questions › Review) to update it.")
                    back = {v: k for k, v in (origin.get("ids") or {}).items()}
                    btext = banks.way_back(text, origin)
                    own = set(banks.question_ids(_read_text(os.path.join(bdir, items.item_file(target)))))
                    clash = sorted((set(banks.question_ids(btext)) - own) & bank_ids)
                    if clash:
                        raise banks.BankError(f"The bank already has a question named \"{clash[0]}\".")
                    bn, ids = target, {k: v for k, v in back.items()}
                    old = banks.item_files(os.path.join(bdir, items.ITEMS_DIR, bn))
                    for f in banks.figures_of(old):
                        if f not in files:
                            cs.delete(f"{items.ITEMS_DIR}/{bn}/{f}")
                else:
                    mapping = banks.free_ids(text, bank_ids)
                    btext = banks.rename_ids(text, mapping)
                    bn = items.free_name(en, b["all"])
                    ids = mapping
                    b["all"].append(bn)
                    cs.write(f"{items.ITEMS_DIR}/{bn}/{items.META_FILE}", banks.meta_json(
                        title=em.get("title") or banks.plain_title(btext), tags=em.get("tags") or [], difficulty=em.get("difficulty") or "",
                        origin={"exam": name, "exam_uid": exam_uid, "item": en, "at": int(time.time())}).encode("utf-8"))
                    if gname:
                        gname = banks.group_name(gname)
                        if not banks.group(b, gname):
                            b["groups"].append({"name": gname, "title": gtitle or gname, "instructions": instr or "", "scoring": "", "items": []})
                        banks.place(b, bn, gname)
                bank_ids.update(banks.question_ids(btext))
                cs.write(items.item_file(bn), btext.encode("utf-8"))
                for f, d in banks.figures_of(files).items():
                    cs.write(f"{items.ITEMS_DIR}/{bn}/{f}", d)
                saved.append((en, bn, ids, btext, banks.figures_of(files), origin if target and linked_mode == "update" else {}))
            # macros of the exam's preamble the saved questions use go to the bank's preamble
            pre_path = os.path.join(bdir, banks.PREAMBLE)
            bank_pre = _read_text(pre_path) if os.path.isfile(pre_path) else banks.PREAMBLE_TEXT
            exam_pre = (ltx.preamble(ui._main_text(pdir)) or "") + "".join(t for t in ui._top_sources(pdir).values())
            add = banks.needed([x[3] for x in saved], exam_pre, ltx.macros(bank_pre))
            clashes = banks.clashes([x[3] for x in saved], exam_pre, bank_pre)
            if add:
                cs.write(banks.PREAMBLE, (bank_pre.rstrip("\n") + "\n" + "\n".join(add) + "\n").encode("utf-8"))
            cs.write(banks.BANK_FILE, banks.to_json(b).encode("utf-8"))
            cs.what = f"{len(saved)} question{'s' if len(saved) != 1 else ''} saved from the exam {name}" + (f"; {len(add)} macro definition{'s' if len(add) != 1 else ''} added to the preamble" if add else "")
        repo = _repo(bdir)
        head = repo.head()
        b = banks.read(bdir)
        what = f"{len(saved)} question{'s' if len(saved) != 1 else ''} saved to the bank {os.path.basename(bdir)}"
        with ui.history_change(pdir, what):
            for en, bn, ids, btext, figs, old in saved:
                em = banks.item_meta(pdir, en)
                origin = {"bank": os.path.basename(bdir), "bank_uid": b["uid"], "item": bn, "item_uid": banks.item_meta(bdir, bn).get("uid"),
                          "revision": head, "fingerprint": banks.fingerprint(btext, figs),
                          "ids": {bid: eid for eid, bid in ids.items()} if ids else {}, "at": int(time.time())}
                if old.get("scored"):  # the way in's scoring, where the way back undid it
                    origin.update(scoring=old.get("scoring") or "", replace=bool(old.get("replace")),
                                  scored={k: v for k, v in old["scored"].items()
                                          if any(q["id"] == k and banks._own_rule(q) == (v or "") for q in scale.read_latex(btext))})
                ui.save_source(pdir, f"{items.ITEMS_DIR}/{en}/{items.META_FILE}", banks.meta_json(
                    uid=em.get("uid"), title=em.get("title") or "", tags=em.get("tags") or [], difficulty=em.get("difficulty") or "",
                    origin=origin, created=em.get("created")).encode("utf-8"), what)
    except banks.BankError as e:
        _undo_created(created)
        return _err(str(e))
    except (vcs.HistoryError, OSError, KeyError) as e:
        _undo_created(created)
        ui.core.app.logger.error(f"Save to bank: {e}")
        return _err("This can't be done just now. The server log has the details.")
    ui.add_activity(pdir, what)
    return jsonify(ok=True, what=what, bank=os.path.basename(bdir), clashes=clashes)


def _undo_created(bdir):
    """A bank made for a save that then failed goes, with its history."""
    if not bdir or not os.path.isdir(bdir):
        return
    uid = vcs.read_uid(bdir, "bank")
    shutil.rmtree(bdir, ignore_errors=True)
    if uid:
        vcs._drop_history(vcs.amcweb_dir(bdir, ui._root(), "bank"), uid, "bank")


# ---------------------------------------------------------------- search, usage (ui_bankindex.py)

def _since(value):
    """"never": never printed; a number of days: not printed in that long."""
    if value == "never":
        return 1  # not printed since the start of time
    try:
        days = int(value)
    except (TypeError, ValueError):
        return None
    return int(time.time()) - days * 86400 if days > 0 else None


def api_bank_search():
    """q (words, as prefixes), bank, group, difficulty, kind, tag (one or
    more, all needed), unused ("never", or days), archived=1."""
    pd = _projects()
    a = request.args
    bank_uid = None
    if a.get("bank"):
        bdir = ui.bank_dir(a["bank"])
        if not bdir:
            return jsonify(items=[])
        bank_uid = banks.read(bdir)["uid"]
    kind = a.get("kind") if a.get("kind") in bankindex.KINDS else None
    diff = a.get("difficulty") if a.get("difficulty") in banks.DIFFICULTIES else None
    try:
        limit = max(1, min(int(a.get("limit") or 500), 2000))
    except ValueError:
        limit = 500
    try:
        found = bankindex.search(ui._owner_home(), pd, q=a.get("q", "")[:200], bank=bank_uid, group=a.get("group") or None,
                                 difficulty=diff, kind=kind, tags=[t[:40] for t in a.getlist("tag")][:10],
                                 unused_since=_since(a.get("unused")), archived=a.get("archived") == "1", limit=limit)
    except (sqlite3.Error, OSError) as e:
        ui.core.app.logger.error(f"Bank search: {e}")
        return jsonify(items=[], error="Search isn't available just now.")
    return jsonify(items=found)


def api_bank_usage(name):
    """The exams that printed the item (the usage log), and the exams
    holding a copy of it now."""
    bdir = ui.bank_dir(name)
    if not bdir:
        return _err("This bank doesn't exist any more.")
    n = request.args.get("item", "")
    b = banks.read(bdir)
    if n not in b["all"]:
        return _err("Not an item of this bank.")
    uid = banks.item_meta(bdir, n).get("uid")
    u = bankindex.usage(ui._owner_home()).get((b["uid"], uid)) or {}
    printed = sorted(({"exam": exam, "at": at} for at, exam in (u.get("exams") or {}).values()), key=lambda x: -x["at"])
    held = [{"exam": e, "item": i} for e, i in bankindex.exams_with(ui.core.projects_dir(), b["uid"], uid)]
    return jsonify(item=n, printed=printed, copies=held)


# ---------------------------------------------------------------- a bank as a zip (ui_bankzip.py)

def api_bank_export(name):
    bdir = ui.bank_dir(name)
    if not bdir:
        return _err("This bank doesn't exist any more.", 404)
    tmp = ui.core.amc_user_tmp(f"bank-export-{uuid.uuid4().hex[:8]}")
    os.makedirs(tmp, exist_ok=True)
    try:
        bundle = os.path.join(tmp, bankzip.BUNDLE)
        try:
            _repo(bdir).bundle(bundle)
        except (vcs.HistoryError, OSError) as e:
            ui.core.app.logger.error(f"Bank export: {name}: no history in the zip: {e}")
            bundle = None
        buf = io.BytesIO()
        bankzip.write(bdir, buf, bundle)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    buf.seek(0)
    vcs.audit(vcs.amcweb_dir(bdir, ui._root(), "bank"), _who(), "bank downloaded", bank=os.path.basename(bdir))
    return send_file(buf, mimetype="application/zip", as_attachment=True, download_name=f"{os.path.basename(bdir)}.zip")


def api_banks_import():
    """A bank's zip as a new bank of the teacher: checked (ui_bankzip.read),
    named after NAME, the bank's title or the file, its history taken from
    the zip when it can be. It keeps its uid unless this teacher has it
    already (then it is a separate bank)."""
    pd = _projects()
    up = request.files.get("file")
    if not up or not up.filename:
        return _err("Choose a bank's zip.")
    tmp = ui.core.amc_user_tmp(f"bank-zip-{uuid.uuid4().hex[:8]}")
    os.makedirs(tmp, exist_ok=True)
    try:
        zpath = os.path.join(tmp, "upload.zip")
        up.save(zpath)
        unpacked = os.path.join(tmp, "bank")
        os.makedirs(unpacked)
        written, skipped = bankzip.read(zpath, unpacked)
        b = banks.read(unpacked)
        wanted = str(request.form.get("name") or "").strip() or b["title"] or re.sub(r"\.zip$", "", os.path.basename(up.filename), flags=re.I)
        name = banks.free_name(pd, wanted)
        home = ui._owner_home()
        uid = b["uid"]
        if not uid or uid in {x["uid"] for x in banks.list_banks(pd)} or os.path.exists(os.path.join(home, "history", "banks", f"{uid}.git")):
            uid = vcs.new_uid()
        bundle = os.path.join(unpacked, bankzip.BUNDLE)
        if os.path.isfile(bundle):
            os.replace(bundle, os.path.join(tmp, bankzip.BUNDLE))
            bundle = os.path.join(tmp, bankzip.BUNDLE)
        else:
            bundle = None
        b.update(uid=uid, title=name)
        with open(os.path.join(unpacked, banks.BANK_FILE), "w", encoding="utf-8") as f:
            f.write(banks.to_json(b))
        if not os.path.isfile(os.path.join(unpacked, banks.PREAMBLE)):
            with open(os.path.join(unpacked, banks.PREAMBLE), "w", encoding="utf-8") as f:
                f.write(banks.PREAMBLE_TEXT)
        bdir = banks.bank_dir(pd, name)
        os.makedirs(banks.banks_root(pd), exist_ok=True)
        shutil.move(unpacked, bdir)
        history = bool(bundle) and vcs.import_bundle(bdir, ui._root(), bundle, "bank")
        what = f"Bank \"{name}\" imported from {os.path.basename(up.filename)[:120]}" + ("" if history or not bundle else " (its history couldn't be read, so it starts here)")
        vcs.snapshot(bdir, ui._root(), by=_who(), what=what, kind="save" if history else "create", target="bank")
        vcs.audit(vcs.amcweb_dir(bdir, ui._root(), "bank"), _who(), "bank imported", bank=name, uid=uid, history=history,
                  files=len(written), skipped=len(skipped))
    except bankzip.ZipError as e:
        return _err(str(e))
    except banks.BankError as e:
        return _err(str(e))
    except (vcs.HistoryError, OSError, ValueError) as e:
        ui.core.app.logger.error(f"Bank import: {e}")
        return _err("This zip couldn't be imported. The server log has the details.")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return jsonify(ok=True, name=name, history=history, items=len(banks.read(bdir)["all"]), skipped=skipped[:20])


ROUTES = [
    ("/ui/api/banks", api_banks, ["GET"]),
    ("/ui/api/banks", api_banks_edit, ["POST"]),
    ("/ui/api/bank/<name>", api_bank, ["GET"]),
    ("/ui/api/bank/<name>/editor", api_bank_editor, ["POST"]),
    ("/ui/api/bank/<name>/source", api_bank_source, ["GET", "POST"]),
    ("/ui/api/bank/<name>/items", api_bank_items, ["POST"]),
    ("/ui/api/bank/<name>/groups", api_bank_groups, ["POST"]),
    ("/ui/api/bank/<name>/check", api_bank_check, ["POST"]),
    ("/ui/api/bank/<name>/completions", api_bank_completions, ["GET"]),
    ("/ui/api/bank/<name>/import", api_bank_import, ["POST"]),
    ("/ui/api/bank-pull", api_bank_pull, ["POST"]),
    ("/ui/api/bank-save", api_bank_save, ["POST"]),
    ("/ui/api/bank-search", api_bank_search, ["GET"]),
    ("/ui/api/bank/<name>/usage", api_bank_usage, ["GET"]),
    ("/ui/api/bank/<name>/export", api_bank_export, ["GET"]),
    ("/ui/api/banks/import", api_banks_import, ["POST"]),
]
