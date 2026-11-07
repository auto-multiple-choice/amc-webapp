"""
Copies of bank items in exams (doc/question-bank-plan.md, sections 7.2 and
7.4): their status, the comparison, updates either way, and a section's
follow-up of the group it was made from. The model is ui_banks.py
(way_in, way_back, status); registered by ui_bankapi.init().

  GET  /ui/api/bank-copies           the open exam's copies and their status,
                                     and what the groups its sections came from gained
  GET  /ui/api/bank-copy?item=<n>    one copy compared with the bank
  POST /ui/api/bank-copy             take (the bank's version), push (update the
                                     bank's copy), keep (this exam's), merge
  POST /ui/api/bank-follow           a section's follow-up: "not these"

A copy is never a live link: nothing here runs unless the teacher asks.
After printing, taking from the bank goes through the lock (an answer key
or scoring fix passes; anything that moves boxes is refused).
"""
import os
import subprocess

from flask import jsonify, request

import ui_banks as banks
import ui_items as items
import ui_latex as ltx
import ui_scale as scale
import ui_vcs as vcs

ui = None    # the ui module
api = None   # ui_bankapi (helpers shared with the other bank routes)


def init(bp, ui_module, api_module):
    global ui, api
    ui, api = ui_module, api_module
    for rule, view, methods in ROUTES:
        bp.add_url_rule(rule, view.__name__, view, methods=methods)


# ---------------------------------------------------------------- reading

class _Banks:
    """The teacher's banks by uid, and their items by uid, read once per request."""

    def __init__(self, projects_dir):
        self.dirs = {}
        root = banks.banks_root(projects_dir)
        for n in sorted(os.listdir(root)) if os.path.isdir(root) else []:
            d = os.path.join(root, n)
            if banks.NAME_RE.match(n) and not os.path.islink(d) and vcs.is_target(d, "bank"):
                uid = banks.read(d)["uid"]
                if uid:
                    self.dirs.setdefault(uid, d)
        self._items, self._read = {}, {}

    def dir(self, uid):
        return self.dirs.get(uid)

    def bank(self, uid):
        d = self.dir(uid)
        if d and d not in self._read:
            self._read[d] = banks.read(d)
        return self._read.get(d)

    def item(self, bank_uid, item_uid):
        """The name of the bank's item with that uid, or None."""
        d = self.dir(bank_uid)
        if not d:
            return None
        if d not in self._items:
            b = self.bank(bank_uid)
            self._items[d] = {banks.item_meta(d, n).get("uid"): n for n in b["all"]}
        return self._items[d].get(item_uid)


def _item_state(folder):
    """(item.tex text, figures) of an item folder."""
    files = banks.item_files(folder)
    return files.get(items.ITEM_FILE, b"").decode("utf-8", "replace"), banks.figures_of(files)


def _copy(pdir, n, bk):
    """The status of the exam's item N, or None when it isn't a bank copy."""
    origin = banks.origin_of(banks.item_meta(pdir, n))
    if not origin.get("bank_uid") or not origin.get("item_uid"):
        return None
    text, figs = _item_state(os.path.join(pdir, items.ITEMS_DIR, n))
    bdir = bk.dir(origin["bank_uid"])
    bn = bk.item(origin["bank_uid"], origin["item_uid"]) if bdir else None
    if bn:
        btext, bfigs = _item_state(os.path.join(bdir, items.ITEMS_DIR, bn))
    else:
        btext, bfigs = None, {}
    st = banks.status(text, figs, origin, btext, bfigs)
    return {"item": n, "file": items.item_file(n), "status": st, "words": banks.STATUS_WORDS[st],
            "bank": os.path.basename(bdir) if bdir else origin.get("bank"), "bank_found": bool(bdir),
            "bank_item": bn or origin.get("item"), "bank_uid": origin["bank_uid"], "item_uid": origin["item_uid"]}


def _follow(pdir, rec, bk, exam_copies):
    """For each section made from a whole group: the group's items the exam
    hasn't seen yet, and the section's copies no longer in the group."""
    out = []
    secs = {s[0] for s in api._exam_sections(pdir)}
    for sec, f in (rec.get("sections_from") or {}).items():
        if not isinstance(f, dict) or sec not in secs:  # a section renamed or removed: nothing to follow
            continue
        b = bk.bank(f.get("bank_uid"))
        g = banks.group(b, f.get("group")) if b else None
        if not g:
            continue
        bdir = bk.dir(f["bank_uid"])
        uids = {banks.item_meta(bdir, n).get("uid"): n for n in g["items"]}
        in_exam = {c["item_uid"] for c in exam_copies if c["bank_uid"] == f["bank_uid"]}
        seen = set(f.get("seen") or []) | in_exam
        new = [{"item": n, "title": banks.item_meta(bdir, n).get("title") or banks.plain_title(_item_state(os.path.join(bdir, items.ITEMS_DIR, n))[0])}
               for u, n in uids.items() if u not in seen and not banks.item_meta(bdir, n).get("archived")]
        pools = items.read_pools(ui._pools_text(pdir))
        in_sec = {p["name"] for p in pools if p["group"] == sec}
        gone = [c["item"] for c in exam_copies if c["bank_uid"] == f["bank_uid"] and c["item"] in in_sec
                and c["item_uid"] not in uids and c["item_uid"] not in set(f.get("gone_seen") or [])]
        if new or gone:
            out.append({"section": sec, "bank": os.path.basename(bdir), "group": g["name"], "title": g["title"] or g["name"],
                        "new": new, "gone": gone})
    return out


def copies_payload(pdir, name):
    bk = _Banks(ui.core.projects_dir())
    copies = [c for c in (_copy(pdir, n, bk) for n in ui._item_names(pdir)) if c]
    lock = bool(ui.exam_lock(pdir))
    rec = ui.read_record(pdir)
    counts = {}
    for c in copies:
        counts[c["status"]] = counts.get(c["status"], 0) + 1
    return {"project": name, "copies": copies, "counts": counts, "lock": lock,
            "follow": [] if lock else _follow(pdir, rec, bk, copies), "blueprints": rec.get("blueprints") or {}}


def api_bank_copies():
    name = ui._open_project()
    if not name:
        return jsonify(project=None, copies=[], follow=[])
    pdir = ui.core.project_dir()
    try:
        return jsonify(copies_payload(pdir, name))
    except (OSError, ValueError, vcs.HistoryError) as e:
        ui.core.app.logger.error(f"Bank copies: {e}")
        return jsonify(project=name, copies=[], follow=[], error="The copies' status couldn't be read.")


# ---------------------------------------------------------------- one copy

def _context(n):
    """Everything about the open exam's item N and its bank item, or an
    error message."""
    name = ui._open_project()
    if not name:
        return None, "This exam doesn't exist any more."
    pdir = ui.core.project_dir()
    if n not in ui._item_names(pdir):
        return None, "This question isn't in the exam any more."
    meta = banks.item_meta(pdir, n)
    origin = banks.origin_of(meta)
    if not origin.get("bank_uid"):
        return None, "This question didn't come from a bank."
    bk = _Banks(ui.core.projects_dir())
    bdir = bk.dir(origin["bank_uid"])
    if not bdir:
        return None, "The bank this question came from isn't among your banks any more."
    bn = bk.item(origin["bank_uid"], origin.get("item_uid"))
    raw = open(os.path.join(pdir, items.item_file(n)), "rb").read()
    text, figs = _item_state(os.path.join(pdir, items.ITEMS_DIR, n))
    c = {"name": name, "pdir": pdir, "item": n, "meta": meta, "origin": origin, "bdir": bdir, "bank": bk.bank(origin["bank_uid"]),
         "bn": bn, "text": text, "figs": figs, "digest": vcs.digest(raw), "btext": None, "bfigs": {}, "base": None, "base_figs": None}
    if bn:
        c["btext"], c["bfigs"] = _item_state(os.path.join(bdir, items.ITEMS_DIR, bn))
        c["bank_fp"] = banks.fingerprint(c["btext"], c["bfigs"])
        try:
            repo = api._repo(bdir)
            rev = repo.check_commit(origin.get("revision"))
            if rev:
                tree = repo.tree_at(rev)
                prefix = f"{items.ITEMS_DIR}/{bn}/"
                base = repo.blob(tree.get(prefix + items.ITEM_FILE))
                if base is not None:
                    c["base"] = base.decode("utf-8", "replace")
                    c["base_figs"] = {p[len(prefix):]: repo.blob(b) for p, b in tree.items()
                                      if p.startswith(prefix) and p[len(prefix):] not in (items.ITEM_FILE, items.META_FILE)}
        except (vcs.HistoryError, OSError) as e:
            ui.core.app.logger.error(f"Bank copy base: {e}")
    c["status"] = banks.status(text, figs, origin, c["btext"], c["bfigs"])
    # exam names of the other items' questions, for names the bank's version adds
    others = [f for f in ui._source_files(pdir) if f != items.item_file(n)]
    c["taken"] = {q["id"] for q in ui._all_questions(pdir, others)}
    return c, None


def _as_exam(c, text):
    """A bank text of this item as the exam's copy would be: (text, ids, scored)."""
    o = c["origin"]
    ids = banks.extend_ids(text, o.get("ids"), c["taken"])
    out, scored = banks.way_in(text, ids, o.get("scoring") or "", bool(o.get("replace")))
    return out, ids, scored


def api_bank_copy_get():
    c, err = _context(str(request.args.get("item") or ""))
    if err:
        return jsonify(error=err)
    out = {"item": c["item"], "status": c["status"], "words": banks.STATUS_WORDS[c["status"]],
           "bank": os.path.basename(c["bdir"]), "bank_item": c["bn"], "digest": c["digest"], "bank_fp": c.get("bank_fp"),
           "lock": bool(ui.exam_lock(c["pdir"])), "can_merge": False}
    if c["btext"] is None:
        return jsonify(out)
    theirs, _, _ = _as_exam(c, c["btext"])
    out["take"] = vcs.text_diff(c["text"], theirs)                                       # what taking the bank's changes here
    out["push"] = vcs.text_diff(c["btext"], banks.way_back(c["text"], c["origin"]))      # what updating the bank's copy changes there
    out["figures"] = sorted(set(c["figs"]) ^ set(c["bfigs"]) | {f for f in c["figs"] if f in c["bfigs"] and c["figs"][f] != c["bfigs"][f]})
    if c["base"] is not None:
        base, _, _ = _as_exam(c, c["base"])
        out["since_bank"] = vcs.text_diff(base, theirs)    # changed in the bank since the copy
        out["since_here"] = vcs.text_diff(base, c["text"])  # changed here since the copy
        out["can_merge"] = c["status"] == "both"
    if out["lock"]:
        out["take_refused"] = _take_refusal(c, theirs, c["bfigs"])
    return jsonify(out)


def _take_refusal(c, new_text, new_figs):
    """Why this exam (printed) can't take NEW_TEXT and NEW_FIGS, or None."""
    if not ui.exam_lock(c["pdir"]):
        return None
    if new_figs != c["figs"]:
        return "This exam has been printed, and the bank's version changes a figure. Only answer key and scoring fixes can be taken now."
    why = ui.write_refusal_bytes(os.path.join(c["pdir"], items.item_file(c["item"])), new_text.encode("utf-8"))
    return ("This exam has been printed, so only answer key and scoring fixes can be taken from the bank; "
            "this version changes more than that.") if why else None


def _origin(c, **kw):
    o = dict(c["origin"])
    o.update(kw)
    return o


def _write_exam_item(c, text, figs, origin, what):
    """The exam's item as TEXT with FIGS and ORIGIN, as one version."""
    pdir, n = c["pdir"], c["item"]
    with ui.history_change(pdir, what):
        if text != c["text"]:
            ui.save_source(pdir, items.item_file(n), text.encode("utf-8"), what, based_on=c["digest"])
        for f, d in figs.items():
            if c["figs"].get(f) != d:
                ui.save_source(pdir, f"{items.ITEMS_DIR}/{n}/{f}", d, what)
        for f in c["figs"]:
            if f not in figs:
                vcs.delete(pdir, ui._root(), f"{items.ITEMS_DIR}/{n}/{f}", by=ui._who())
        m = c["meta"]
        ui.save_source(pdir, f"{items.ITEMS_DIR}/{n}/{items.META_FILE}", banks.meta_json(
            uid=m.get("uid"), title=m.get("title") or "", tags=m.get("tags") or [], difficulty=m.get("difficulty") or "",
            origin=origin, created=m.get("created")).encode("utf-8"), what)


def _check_exam_text(c, text):
    if banks.CONFLICT_RE.search(text):
        return "The text still has the <<<<<<< ======= >>>>>>> marks of the places to choose: keep one side of each and remove the marks."
    if p := ltx.problems(text):
        return f"Line {p[0]['line']}: {p[0]['message']}"
    if problem := items.check_item_text(text, c["item"]):
        return problem
    clash = sorted(set(banks.question_ids(text)) & c["taken"])
    if clash:
        return f"Another question of the exam is named \"{clash[0]}\"."
    return None


def api_bank_copy_post():
    """take: the bank's version into the exam (the changes made on the way
    in made again); push: this exam's copy into the bank (they undone);
    keep: this exam's copy stays, the bank's version is acknowledged (it
    then shows "Edited here"); merge: both sets of changes, or TEXT, the
    places chosen by hand."""
    data = request.get_json(silent=True)
    data = data if isinstance(data, dict) else {}
    op = data.get("op")
    c, err = _context(str(data.get("item") or ""))
    if err:
        return jsonify(error=err)
    if data.get("digest") != c["digest"]:  # the comparison the choice was made from, both sides
        return jsonify(error="This question was changed meanwhile. Look at the comparison again.", conflict=True)
    if c["btext"] is not None and data.get("bank_fp") != c.get("bank_fp"):
        return jsonify(error="The bank's question was changed meanwhile. Look at the comparison again.", conflict=True)
    if c["btext"] is None:
        return jsonify(error="This question isn't in the bank any more. Save it to a bank as a new question instead.")
    n, bank_name = c["item"], os.path.basename(c["bdir"])
    try:
        head = api._repo(c["bdir"]).head()
        if op == "take":
            theirs, ids, scored = _as_exam(c, c["btext"])
            if why := _take_refusal(c, theirs, c["bfigs"]):
                return jsonify(error=why, locked=True)
            what = f"{n}: the bank's version taken from {bank_name}"
            _write_exam_item(c, theirs, c["bfigs"], _origin(c, revision=head, fingerprint=c["bank_fp"], ids=ids, scored=scored, seen_fp=None), what)
        elif op == "keep":
            # The copy's base stays what it was copied from (a later "Combine both" merges from it);
            # only this bank version is set aside, so it isn't offered again.
            what = f"{n}: this exam's version kept (the bank's newer version of {c['bn']} set aside)"
            _write_exam_item(c, c["text"], c["figs"], _origin(c, seen_fp=c["bank_fp"], seen_revision=head), what)
        elif op == "merge":
            theirs, ids, scored = _as_exam(c, c["btext"])
            if isinstance(data.get("text"), str):
                text = data["text"]
            else:
                if c["base"] is None:
                    return jsonify(error="The version this copy was made from isn't in the bank's history, so the changes can't be combined.")
                base, _, _ = _as_exam(c, c["base"])
                text, conflicts = banks.merge_texts(c["text"], base, theirs)
                if conflicts:
                    return jsonify(ok=False, conflicts=conflicts, text=text)
            if why := _check_exam_text(c, text):
                return jsonify(error=why)
            if c["bfigs"] != c["figs"] and c["base_figs"] is not None:
                figs = dict(c["figs"])
                for f, d in c["bfigs"].items():  # figures the bank changed since the copy, this exam didn't
                    if c["base_figs"].get(f) != d and c["figs"].get(f) == c["base_figs"].get(f):
                        figs[f] = d
            else:
                figs = c["figs"]
            if why := _take_refusal(c, text, figs):
                return jsonify(error=why, locked=True)
            what = f"{n}: the bank's changes combined with this exam's"
            _write_exam_item(c, text, figs, _origin(c, revision=head, fingerprint=c["bank_fp"], ids=ids, scored=scored, seen_fp=None), what)
        elif op == "push":
            what = push(c)
        else:
            return jsonify(error="Unknown action."), 400
    except vcs.Conflict:
        return jsonify(error="This question was changed meanwhile. Look at the comparison again.", conflict=True)
    except banks.BankError as e:
        return jsonify(error=str(e))
    except (vcs.HistoryError, OSError, subprocess.SubprocessError) as e:
        ui.core.app.logger.error(f"Bank copy: {e}")
        return jsonify(error="This can't be done just now. The server log has the details.")
    pdir = c["pdir"]
    ui.add_activity(pdir, what)
    if op != "push" and op != "keep":
        ui.refresh_layout(pdir)
        ui.core.emit_msg("ui-changed", "questions")
    out = ui._items_payload(pdir, c["name"])
    out.update(ok=True, what=what, copies=copies_payload(pdir, c["name"]))
    return jsonify(out)


def push(c):
    """This exam's copy into the bank's item (one version there), then the
    exam's record follows (one version here). Returns what was done."""
    bdir, bn, n = c["bdir"], c["bn"], c["item"]
    btext = banks.way_back(c["text"], c["origin"])
    if banks.CONFLICT_RE.search(btext):  # the bank takes only what would build
        raise banks.BankError("This exam's question still has <<<<<<< ======= >>>>>>> marks; finish combining it first.")
    if p := ltx.problems(btext):
        raise banks.BankError(f"This exam's question doesn't balance (line {p[0]['line']}: {p[0]['message']}); fix it before updating the bank.")
    if problem := items.check_item_text(btext, bn):
        raise banks.BankError(problem)
    with api._change(bdir, f"{bn} updated from the exam {c['name']}") as cs:
        b = banks.read(bdir)
        others = {q["id"] for q in api._bank_questions(bdir, b, skip={bn})}
        clash = sorted(set(banks.question_ids(btext)) & others)
        if clash:
            raise banks.BankError(f"The bank already has another question named \"{clash[0]}\".")
        cs.write(items.item_file(bn), btext.encode("utf-8"))
        for f, d in c["figs"].items():
            if c["bfigs"].get(f) != d:
                cs.write(f"{items.ITEMS_DIR}/{bn}/{f}", d)
        for f in c["bfigs"]:
            if f not in c["figs"]:
                cs.delete(f"{items.ITEMS_DIR}/{bn}/{f}")
        pre_path = os.path.join(bdir, banks.PREAMBLE)
        bank_pre = api._read_text(pre_path) if os.path.isfile(pre_path) else banks.PREAMBLE_TEXT
        exam_pre = (ltx.preamble(ui._main_text(c["pdir"])) or "") + "".join(ui._top_sources(c["pdir"]).values())
        add = banks.needed([btext], exam_pre, ltx.macros(bank_pre))
        if add:
            cs.write(banks.PREAMBLE, (bank_pre.rstrip("\n") + "\n" + "\n".join(add) + "\n").encode("utf-8"))
    head = api._repo(bdir).head()
    what = f"{n}: the bank's copy ({bn} in {os.path.basename(bdir)}) updated from this exam"
    rule = (c["origin"].get("scoring") or "").strip()
    scored = {k: v for k, v in (c["origin"].get("scored") or {}).items()
              if any(q["id"] == k and banks._own_rule(q) == (v or "") for q in scale.read_latex(btext))}
    _write_exam_item(c, c["text"], c["figs"], _origin(c, revision=head, fingerprint=banks.fingerprint(btext, c["figs"]),
                                                      scored=scored if rule else {}, seen_fp=None), what)
    return what


# ---------------------------------------------------------------- a section's group

def api_bank_follow():
    """dismiss {section}: the group's new items and the section's copies no
    longer in the group are known; they aren't offered again."""
    name = ui._open_project()
    if not name:
        return jsonify(error="This exam doesn't exist any more.")
    pdir = ui.core.project_dir()
    data = request.get_json(silent=True)
    data = data if isinstance(data, dict) else {}
    sec = str(data.get("section") or "")
    payload = copies_payload(pdir, name)
    f = next((x for x in payload["follow"] if x["section"] == sec), None)
    if not f:
        return jsonify(ok=True, copies=payload)
    bdir = ui.bank_dir(f["bank"])
    b = banks.read(bdir) if bdir else None
    g = banks.group(b, f["group"]) if b else None
    uids = [banks.item_meta(bdir, n).get("uid") for n in (g["items"] if g else [])]
    gone_uids = [c["item_uid"] for c in payload["copies"] if c["item"] in f["gone"]]

    def change(rec):
        s = (rec.get("sections_from") or {}).get(sec)
        if isinstance(s, dict):
            s["seen"] = sorted(set(s.get("seen") or []) | {u for u in uids if u})
            s["gone_seen"] = sorted(set(s.get("gone_seen") or []) | set(gone_uids))
    ui._update_record(pdir, change)
    return jsonify(ok=True, copies=copies_payload(pdir, name))


def note_seen(pdir, section, bank_uid, group, uids):
    """Items added to SECTION from the group it follows are seen."""
    def change(rec):
        s = (rec.get("sections_from") or {}).get(section)
        if isinstance(s, dict) and s.get("bank_uid") == bank_uid and s.get("group") == group:
            s["seen"] = sorted(set(s.get("seen") or []) | {u for u in uids if u})
    ui._update_record(pdir, change)


ROUTES = [
    ("/ui/api/bank-copies", api_bank_copies, ["GET"]),
    ("/ui/api/bank-copy", api_bank_copy_get, ["GET"]),
    ("/ui/api/bank-copy", api_bank_copy_post, ["POST"]),
    ("/ui/api/bank-follow", api_bank_follow, ["POST"]),
]
