"""
The new interface (doc/ui-redesign-plan.md).

It replaces upstream's page at "/". Screens are drawn in the browser by
static/ui/app.js; actions go through the server's existing Socket.IO events
(doc-update, create-project-template, ...), so AMC's processing is
unchanged. This module adds the page routes and read-only JSON views of
data that upstream only renders as HTML fragments.

Kept in its own file so merging AMC team updates stays easy.
"""

import base64
import hashlib
import html
import json
import os
import re
import sqlite3
import time
import uuid

import ui_scale as scale

from flask import Blueprint, Response, abort, jsonify, make_response, render_template, request, send_file
from flask import g as flask_g

bp = Blueprint("ui", __name__)
core = None  # the main server module (amc.py), set by init_app()

STEPS = ("questions", "marking-scheme", "papers", "print", "upload-scans",
         "check-scans", "mark", "match-students", "export-marks", "annotate",
         "settings")
DOCUMENTS = ("sujet", "corrige", "catalog", "indiv-solution")
CONFIG_OPTIONS = ("moteur_latex_b", "nombre_copies",
                  "note_max", "note_null", "note_grain", "note_arrondi")
# A scanned page whose boxes sit this close to the detection thresholds
# (AMC's "sensitivity", 0-10) is one a person should look at. Upstream's
# scans report highlights pages from the same level.
SENSITIVITY_TO_CHECK = 8


def init_app(app, server_module):
    global core
    core = server_module
    app.register_blueprint(bp)
    for event, handler in SOCKET_EVENTS.items():
        core.socketio_name(event)(handler)


# ---------------------------------------------------------------- pages

@bp.route("/")
@bp.route("/exams")
@bp.route("/exam/<name>")
@bp.route("/exam/<name>/<step>")
def page(name=None, step=None):
    core.headers_info()
    resp = make_response(render_template(
        "ui_app.html",
        username=core.username(ifnone=""),
        app_version=core.AMCWEB_VERSION or "",
    ))
    # The session id names the browser's temporary folder (uploads,
    # print files); same rule as upstream's page.
    if not core.valid_session(request.cookies.get("amcsession")):
        resp.set_cookie("amcsession", str(uuid.uuid4()), samesite="Lax")
    return resp


# ---------------------------------------------------------------- helpers

def _query(fn, default=None):
    """Run a database query; a missing table means "nothing yet"."""
    try:
        return fn()
    except sqlite3.Error:
        return default


def _has_db(pdir, module):
    # Attaching a database that doesn't exist yet would create an empty
    # file, so only read the ones AMC has already made.
    return os.path.isfile(f"{pdir}/data/{module}.sqlite")


def _float_option(name, default):
    try:
        return float(core.get_option(name))
    except (TypeError, ValueError):
        return default


def _files(directory, exclude=()):
    if not os.path.isdir(directory):
        return []
    return sorted(f for f in os.listdir(directory)
                  if os.path.isfile(f"{directory}/{f}") and f not in exclude)


def _open_project():
    """The project named by the AMC-project header, or None."""
    core.headers_info()
    name = getattr(flask_g, "project_name", None)
    try:
        if not name or not core.project_exists(name):
            return None
    except ValueError:  # not a valid project name
        return None
    return name


def _summary(pdir):
    """Where an exam stands, for the exams list."""
    db = core.Amcdb(pdir)
    state = "draft"
    if _has_db(pdir, "layout") and _query(db.layout_npages, 0):
        state = "built"
        if _query(db.print_timestamp):
            state = "printed"
    if _has_db(pdir, "capture") and _query(db.capture_npages, 0):
        state = "scanned"
    if _has_db(pdir, "scoring") and _query(db.n_graded_students, 0):
        state = "marked"
    if _files(f"{pdir}/exports"):
        state = "exported"
    return state


# ---------------------------------------------------------------- JSON

@bp.route("/ui/api/projects")
def api_projects():
    core.headers_info()
    projects = []
    for name in core.projects_list():
        pdir = core.project_dir(p=name)
        try:
            modified = os.path.getmtime(f"{pdir}/options.xml")
        except OSError:
            modified = None
        projects.append({"name": name, "modified": modified,
                         "state": _summary(pdir)})
    return jsonify(projects=projects)


@bp.route("/ui/api/templates")
def api_templates():
    core.headers_info()
    return jsonify(groups=core.template_groups, templates=core.templates)


@bp.route("/ui/api/status")
def api_status():
    name = _open_project()
    if not name:
        return jsonify(project=None)
    pdir = core.project_dir()
    db = core.Amcdb(pdir)
    out = {
        "project": name,
        "source": core.main_source_file(),
        "copies": core.ncopies(),
        "docs": {d: os.path.isfile(f"{pdir}/DOC-{d}.pdf") for d in DOCUMENTS},
        "layout_pages": 0, "printed": None,
        "scans": 0, "failed": 0, "incomplete": 0, "to_check": 0,
        "marked": 0, "matched": 0, "not_in_list": 0, "unmatched": 0,
        "students_list": bool(core.get_option("listeetudiants")),
        "exports": _files(f"{pdir}/exports"),
        "annotated": len(_files(_annotated_dir(pdir), exclude=("all-students.pdf",))),
        "annotated_single": os.path.isfile(f"{_annotated_dir(pdir)}/all-students.pdf"),
        "marks_info": None, "exports_stale": False, "annotated_stale": False,
    }
    if _has_db(pdir, "layout"):
        out["layout_pages"] = _query(db.layout_npages, 0)
        out["printed"] = _query(db.print_timestamp)
        out["defects"] = [
            {"kind": d[0], "level": d[1], "a": d[2], "b": d[3]}
            for d in _query(db.defects, [])]
        rng = _query(db.student_range)
        out["copies_range"] = list(rng) if rng and rng[0] is not None else None
    if _has_db(pdir, "capture"):
        out["scans"] = _query(db.capture_npages, 0)
        out["failed"] = _query(db.n_failed, 0)
        if out["scans"]:
            counts = _query(db.counts)
            if counts:
                out["incomplete"] = counts[1]
            pages = _query(lambda: db.capture_pages(
                _float_option("seuil", 0.15),
                _float_option("seuil_up", 1.0)), [])
            out["to_check"] = sum(
                1 for p in pages
                if (p.get("sensitivity") or 0) >= SENSITIVITY_TO_CHECK
                and not (p.get("timestamp_manual") or 0) > 0)
    if _has_db(pdir, "scoring"):
        out["marked"] = _query(db.n_graded_students, 0)
    rec = read_record(pdir)
    if out["scans"]:
        counts = {"auto": 0, "manual": 0, "none": 0, "unmatched": 0}
        for s in _query(lambda: sheet_rows(pdir), []):
            counts[s["state"]] += 1
        out["matched"] = counts["auto"] + counts["manual"]
        out["not_in_list"] = counts["none"]
        out["unmatched"] = counts["unmatched"]
    if out["marked"]:
        out.update(results_freshness(pdir, rec, out))
    out["lock"] = exam_lock(pdir, rec)
    out["layout_ok"] = layout_confirmation(pdir, rec)
    out["format"] = "plain" if core.get_option("filter") == "plain" else "latex"
    out["activity"] = list(reversed(rec.get("activity", [])[-30:]))
    return jsonify(out)


@bp.route("/ui/api/files")
def api_files():
    # An exam that no longer exists (renamed, deleted) answers project=None,
    # like the status: the page may still be asking about it for a moment.
    name = _open_project()
    if not name:
        return jsonify(project=None)
    pdir = core.project_dir()
    main = core.main_source_file()
    files = []
    for f in sorted(os.listdir(pdir)):
        if f.startswith(RECORD):
            continue
        level = core.file_level(pdir, main, f)
        # -1 main source, 0 other editable files, 1 other files, 2 folders
        if level <= 1:
            files.append({"name": f, "level": level})
    return jsonify(project=name, main=main, files=files)


@bp.route("/ui/api/config")
def api_config():
    name = _open_project()
    if not name:
        return jsonify(project=None)
    engines = os.environ.get("AMC_LATEX_ENGINES")
    return jsonify(
        project=name,
        options=core.get_options(list(CONFIG_OPTIONS)),
        engines=engines.split(",") if engines else None,
    )


@bp.route("/ui/api/scoring")
def api_scoring():
    name = _open_project()
    if not name:
        return jsonify(project=None)
    fmt, path = _main_source()
    out = {"project": name, "format": fmt, "file": os.path.basename(path) if path else None,
           "S": None, "M": None}
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            out.update(read_scoring_defaults(f.read(), fmt))
    except (OSError, TypeError):
        out["error"] = "The main source file can't be read."
    return jsonify(out)


@bp.route("/ui/api/printers")
def api_printers():
    """Printers for direct printing. Only offered when the launcher has
    connected the machine's print system (Linux shared machines)."""
    core.headers_info()
    if not os.environ.get("CUPS_SERVER"):
        return jsonify(available=False, printers=[])
    try:
        found = core.cups.Connection().getPrinters()
    except Exception as e:  # CUPS unreachable or misconfigured
        core.app.logger.error(f"Can't list printers: {e}")
        return jsonify(available=False, printers=[], error=str(e))
    return jsonify(available=bool(found), printers=[
        {"id": k, "name": v.get("printer-info") or k} for k, v in sorted(found.items())])


# ---------------------------------------------------------------- exam record
#
# amcweb.json, in the exam's folder, keeps what AMC itself doesn't: who
# confirmed the layout and when, who marked the exam as printed, and the
# exam's activity list.

RECORD = "amcweb.json"
ACTIVITY_MAX = 200


def _record_file(pdir):
    return os.path.join(pdir, RECORD)


def read_record(pdir):
    try:
        with open(_record_file(pdir), encoding="utf-8") as f:
            rec = json.load(f)
        return rec if isinstance(rec, dict) else {}
    except (OSError, ValueError):
        return {}


def _update_record(pdir, change):
    if not os.path.isdir(pdir):
        return {}  # the exam was deleted meanwhile: don't bring its folder back
    path = _record_file(pdir)
    with core.FileLock(path + ".lock"):
        rec = read_record(pdir)
        change(rec)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(rec, f, indent=1)
        os.replace(tmp, path)
    return rec


def _who():
    return core.username(ifnone="") or None


def add_activity(pdir, what):
    entry = {"at": int(time.time()), "by": _who(), "what": what}

    def change(rec):
        activity = rec.setdefault("activity", [])
        activity.append(entry)
        del activity[:-ACTIVITY_MAX]
    _update_record(pdir, change)


def _build_stamp(pdir):
    try:
        return str(os.stat(f"{pdir}/DOC-sujet.pdf").st_mtime_ns)
    except OSError:
        return None


def layout_confirmation(pdir, rec=None):
    """Who confirmed the layout of the current build, or None. Rebuilding
    the question paper makes an earlier confirmation void."""
    rec = read_record(pdir) if rec is None else rec
    ok = rec.get("layout_ok") or {}
    stamp = _build_stamp(pdir)
    if stamp and ok.get("stamp") == stamp:
        return {"at": ok.get("at"), "by": ok.get("by")}
    return None


def exam_lock(pdir, rec=None):
    """The exam is locked once printed (AMC's print time, or "Mark as
    printed") or scanned. Returns None, or since/by/how."""
    rec = read_record(pdir) if rec is None else rec
    lock = rec.get("lock") or {}
    db = core.Amcdb(pdir)
    printed = _query(db.print_timestamp) if _has_db(pdir, "layout") else None
    scans = _query(db.capture_npages, 0) if _has_db(pdir, "capture") else 0
    if not (lock or printed or scans):
        return None
    since = lock.get("since")
    if not since and printed:
        try:
            since = int(float(printed))
        except ValueError:
            since = None
    return {"since": since, "by": lock.get("by"),
            "how": lock.get("how") or ("printed" if printed else "scanned")}


# ---------------------------------------------------------------- the lock
#
# Called from upstream's handlers in amc.py (one line each), so the server
# refuses changes that would make printed papers unreadable, whatever page
# or browser tab sends them.

LOCKED_OPTIONS = ("moteur_latex_b", "nombre_copies", "texsrc", "filter")
SOURCE_EXTENSIONS = ("tex", "latex", "txt", "sty", "cls", "yml", "yaml")
LOCKED = ("This exam has been printed, so its questions and layout are "
          "locked. {what} To change them, unlock the exam first (this "
          "removes its scans and marks), or work on a copy.")
ONLY_SCORING = ("This exam has been printed, so only answer key and "
                "scoring changes can be saved now: switching \\correctchoice "
                "and \\wrongchoice, or changing \\scoring{…} and the default "
                "scoring. Undo the other changes, or unlock the exam first "
                "(this removes its scans and marks).")


def _current_lock():
    name = getattr(flask_g, "project_name", None)
    try:
        if not name or not core.project_exists(name):
            return None
    except ValueError:
        return None
    return exam_lock(core.project_dir())


def refuse_if_locked(what):
    """In a socket handler: tell the user and return True when locked."""
    if _current_lock():
        core.dialog_msg(warn=LOCKED.format(what=what))
        return True
    return False


def option_refused(name):
    return (str(name) in LOCKED_OPTIONS
            and refuse_if_locked("This setting changes the papers."))


def delete_refused(filename):
    ext = str(filename).rsplit(".", 1)[-1].lower()
    return (ext in SOURCE_EXTENSIONS
            and refuse_if_locked("Source files can't be deleted."))


def upload_refusal(upload, dest):
    """In /upload: the reason this file can't be saved, or None."""
    if not _current_lock():
        return None
    fn, ext = core.upload_file_parts(upload)
    path = os.path.join(core.project_dir(), fn)
    if ext not in SOURCE_EXTENSIONS or not os.path.isfile(path):
        return None  # a new file isn't used by the printed papers
    new = upload.stream.read()
    upload.stream.seek(0)
    with open(path, "rb") as f:
        old = f.read()
    if same_layout(old.decode("utf-8", "replace"),
                   new.decode("utf-8", "replace"), ext):
        return None
    return ONLY_SCORING


BRACED = r"\{(?:[^{}]|\{[^{}]*\})*\}"
SCORING_COMMAND = re.compile(
    r"\\(?:scoringDefault[SM]|baremeDefaut[SM]|scoring|bareme)\s*" + BRACED)
CHOICE_COMMAND = re.compile(r"\\(?:correctchoice|wrongchoice|bonne|mauvaise)(?![A-Za-z])")
COMMENT = re.compile(r"(?<!\\)%.*$")
TXT_DEFAULT_LINE = re.compile(r"^\s*DefaultScoring[SM]\s*:", re.I)
TXT_ANSWER = re.compile(r"^(\s*)[+-]")
TXT_Q_SCORING = re.compile(r"^(\s*\*{1,2}(?:<[^>]*>)?(?:\[[^\]]*\])?)\{[^}]*\}")
TXT_A_SCORING = re.compile(r"^(\s*[+-](?:\[[^\]]*\])?)\{[^}]*\}")


def _normalized_lines(text, latex):
    lines = []
    for raw in text.splitlines():
        if not raw.strip():
            lines.append("")            # a real blank line ends a paragraph
            continue
        if latex:
            line = COMMENT.sub("", raw)
            line = SCORING_COMMAND.sub("", line)
            line = CHOICE_COMMAND.sub(r"\\CHOICE", line)
        else:
            if TXT_DEFAULT_LINE.match(raw):
                continue
            line = TXT_Q_SCORING.sub(r"\1", raw)
            line = TXT_A_SCORING.sub(r"\1", line)
            line = TXT_ANSWER.sub(r"\1±", line)
        line = re.sub(r"[ \t]+", " ", line).strip()
        if line:
            lines.append(line)          # lines left empty (comments,
                                        # scoring only) don't count
    out = []
    for line in lines:                  # several blank lines = one
        if line == "" and out and out[-1] == "":
            continue
        out.append(line)
    return "\n".join(out).strip()


def same_layout(old, new, ext):
    """True when the two sources differ only in ways that can't move
    anything on the printed papers: scoring, which answers are correct,
    comments, spacing within lines."""
    if ext in ("tex", "latex", "sty", "cls"):
        return _normalized_lines(old, True) == _normalized_lines(new, True)
    if ext == "txt":
        return _normalized_lines(old, False) == _normalized_lines(new, False)
    return old == new


# ---------------------------------------------------------------- default scoring

STRATEGY = re.compile(r"^[A-Za-z0-9=.,+\-*/() ]{0,200}$")
LATEX_DEFAULT = re.compile(r"\\(?:scoringDefault|baremeDefaut)([SM])\s*\{([^{}]*)\}")
TXT_DEFAULT = re.compile(r"^[ \t]*DefaultScoring([SM])[ \t]*:[ \t]*(.*?)[ \t]*$", re.I)


def _main_source():
    fmt = "plain" if core.get_option("filter") == "plain" else "latex"
    main = core.main_source_file()
    return fmt, os.path.join(core.project_dir(), main) if main else None


def read_scoring_defaults(text, fmt):
    found = {"S": None, "M": None}
    for line in text.splitlines():
        if fmt == "latex":
            for m in LATEX_DEFAULT.finditer(COMMENT.sub("", line)):
                found[m.group(1)] = m.group(2).strip()
        else:
            m = TXT_DEFAULT.match(line)
            if m:
                found[m.group(1).upper()] = m.group(2)
    return found


def write_scoring_defaults(text, fmt, values):
    """Set (or, with an empty value, remove) the default scoring for single
    (S) and multiple (M) questions in the main source."""
    lines = text.split("\n")
    for kind in ("S", "M"):
        value = (values.get(kind) or "").strip()
        done = False
        out = []
        for line in lines:
            if fmt == "latex":
                code = COMMENT.sub("", line)
                pattern = re.compile(r"\\(?:scoringDefault|baremeDefaut)" + kind + r"\s*\{[^{}]*\}")
                if pattern.search(code):
                    if value:
                        new = pattern.sub(lambda m: "\\scoringDefault" + kind + "{" + value + "}", code, count=1)
                        out.append(new + line[len(code):])
                        done = True
                    else:
                        rest = pattern.sub("", code)
                        if rest.strip() or line[len(code):].strip():
                            out.append(rest + line[len(code):])
                    continue
            else:
                m = TXT_DEFAULT.match(line)
                if m and m.group(1).upper() == kind:
                    if value and not done:
                        out.append(f"DefaultScoring{kind}: {value}")
                        done = True
                    continue
            out.append(line)
        if value and not done:
            if fmt == "latex":
                at = next((i for i, l in enumerate(out)
                           if "\\begin{document}" in COMMENT.sub("", l)), None)
                if at is None:
                    raise ValueError("The main source has no \\begin{document} "
                                     "line, so the default scoring can't be added.")
                out.insert(at + 1, "\\scoringDefault" + kind + "{" + value + "}")
            else:
                out.insert(0, f"DefaultScoring{kind}: {value}")
        lines = out
    return "\n".join(lines)


# ---------------------------------------------------------------- socket events

def on_layout_ok():
    pdir = core.project_dir()
    stamp = _build_stamp(pdir)
    if not stamp or not (core.get_db().layout_npages() or 0):
        core.dialog_msg(warn="Build the papers first: there is no layout to confirm yet.")
        return
    entry = {"at": int(time.time()), "by": _who(), "stamp": stamp}
    _update_record(pdir, lambda rec: rec.__setitem__("layout_ok", entry))
    add_activity(pdir, "Layout checked and confirmed")
    core.emit_msg("ui-changed", "layout_ok")


def on_mark_printed():
    pdir = core.project_dir()
    if not (core.get_db().layout_npages() or 0):
        core.dialog_msg(warn="Build the papers first.")
        return
    lock = {"since": int(time.time()), "by": _who(), "how": "manual"}
    _update_record(pdir, lambda rec: rec.setdefault("lock", lock))
    add_activity(pdir, "Marked as printed: the exam is locked")
    core.emit_msg("ui-changed", "lock")


def on_printed(data):
    """The browser reports a finished print job (AMC already recorded the
    print time); keep who did it, and how, for the activity list."""
    data = data if isinstance(data, dict) else {}
    how = "printer" if data.get("how") == "printer" else "files"
    copies = str(data.get("copies", ""))[:20]
    pdir = core.project_dir()
    lock = {"since": int(time.time()), "by": _who(), "how": how}
    _update_record(pdir, lambda rec: rec.setdefault("lock", lock))
    add_activity(pdir, ("Printed on the shared machine" if how == "printer"
                        else "Papers saved for printing")
                 + (f" (copies {copies})" if copies else ""))
    core.emit_msg("ui-changed", "lock")


def on_unlock(data):
    name = (data or {}).get("name") if isinstance(data, dict) else None
    if name != flask_g.project_name:
        core.dialog_msg(warn="Type the exam's name exactly to unlock it.")
        return
    pdir = core.project_dir()
    # Same clearing as rebuilding the question paper: layout, scans,
    # marks and student matches.
    core.clear_data("mep:")
    core.get_db().clear_print_timestamp()

    def change(rec):
        rec.pop("lock", None)
        rec.pop("layout_ok", None)
    _update_record(pdir, change)
    add_activity(pdir, "Unlocked: layout, scans, marks and matches removed")
    core.emit_msg("ui-changed", "unlock")


def on_scoring_defaults(data):
    data = data if isinstance(data, dict) else {}
    values = {k: str(data.get(k) or "").strip() for k in ("S", "M")}
    for kind, value in values.items():
        if not STRATEGY.match(value):
            core.dialog_msg(warn=f"The scoring rule '{html.escape(value)}' contains characters AMC doesn't accept here.")
            return
    fmt, path = _main_source()
    try:
        with open(path, encoding="utf-8") as f:
            text = f.read()
        new = write_scoring_defaults(text, fmt, values)
    except (OSError, TypeError, ValueError) as e:
        core.dialog_msg(warn=str(e) if isinstance(e, ValueError) else "The main source file can't be changed.")
        return
    if new != text:
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(new)
        os.replace(tmp, path)
        add_activity(core.project_dir(), "Default scoring changed: single "
                     + (values["S"] or "AMC default") + "; multiple "
                     + (values["M"] or "AMC default"))
    core.emit_msg("ui-scoring-saved", values)


# ---------------------------------------------------------------- scans

def _thresholds():
    return _float_option("seuil", 0.15), _float_option("seuil_up", 1.0)


def box_uncertain(prop, low, high):
    """Same rule as AMC's page "sensitivity" (8 or more out of 10): the
    box's darkness is within 20% of a threshold."""
    if prop is None:
        return False
    rel = []
    if low > 0:
        rel.append(abs(prop - low) / low)
    if high < 1:
        rel.append(abs(prop - high) / (1 - high))
    return bool(rel) and min(rel) <= 1 - SENSITIVITY_TO_CHECK / 10


def _rows(db, sql, args=()):
    db.db.row_factory = sqlite3.Row
    return [dict(r) for r in db.db.execute(sql, args).fetchall()]


def _local_scan(pdir, path):
    """A scan's path as stored by AMC, relative to the exam folder."""
    if path.startswith("%PROJET/"):
        return path[len("%PROJET/"):]
    if path.startswith(pdir + "/"):
        return path[len(pdir) + 1:]
    return None


def page_boxes(db, student, page, copy, images=False):
    low, high = _thresholds()
    db.use_module("capture")
    db.use_module("layout")
    rows = _rows(db, """
        SELECT z.id_a AS question, z.id_b AS answer, z.black, z.total, z.manual,
               """ + ("z.imagedata," if images else "") + """
               b.char AS label, q.name AS name
        FROM capture.capture_zone AS z
        LEFT JOIN layout.layout_box AS b
          ON b.student=z.student AND b.page=z.page AND b.question=z.id_a
             AND b.answer=z.id_b AND b.role=1
        LEFT JOIN layout.layout_question AS q ON q.question=z.id_a
        WHERE z.student=? AND z.page=? AND z.copy=? AND z.type=4
        ORDER BY z.id_a, z.id_b""", (student, page, copy))
    boxes = []
    for r in rows:
        prop = r["black"] / r["total"] if r["total"] and r["total"] > 0 else None
        auto = prop is not None and low <= prop <= high
        manual = r["manual"] if r["manual"] is not None and r["manual"] >= 0 else None
        box = {"question": r["question"], "answer": r["answer"],
               "name": r["name"], "label": r["label"],
               "prop": None if prop is None else round(prop, 3),
               "auto": auto, "manual": None if manual is None else bool(manual),
               "ticked": auto if manual is None else bool(manual),
               "uncertain": box_uncertain(prop, low, high)}
        if images and r.get("imagedata"):
            box["image"] = "data:image/png;base64," + base64.b64encode(r["imagedata"]).decode()
        boxes.append(box)
    return boxes


def _pages_to_check(db):
    low, high = _thresholds()
    return [p for p in db.capture_pages(low, high)
            if (p.get("sensitivity") or 0) >= SENSITIVITY_TO_CHECK
            and not (p.get("timestamp_manual") or 0) > 0]


@bp.route("/ui/api/scans")
def api_scans():
    name = _open_project()
    if not name:
        return jsonify(project=None)
    pdir = core.project_dir()
    low, high = _thresholds()
    try:
        mode = int(core.get_option("auto_capture_mode"))
    except (TypeError, ValueError):
        mode = -1
    out = {"project": name, "low": low, "high": high, "photocopy": mode == 1,
           "mode_locked": False, "multi_scan_mode": core.get_option("multi_scan_mode") or "",
           "pages": [], "failed": [], "missing": [], "complete": 0, "incomplete": 0,
           "max_pages": None}
    db = core.Amcdb(pdir)
    if _has_db(pdir, "layout"):
        out["max_pages"] = _query(db.npages_max)
    if not _has_db(pdir, "capture"):
        return jsonify(out)
    for p in _query(lambda: db.capture_pages(low, high), []):
        out["pages"].append({
            "student": p["student"], "page": p["page"], "copy": p["copy"],
            "checked": bool((p.get("timestamp_manual") or 0) > 0),
            "sensitivity": None if p.get("sensitivity") is None else round(p["sensitivity"], 1),
            "to_check": (p.get("sensitivity") or 0) >= SENSITIVITY_TO_CHECK
                        and not (p.get("timestamp_manual") or 0) > 0})
    out["mode_locked"] = bool(out["pages"])
    for f in _query(db.failed_scans, []):
        local = _local_scan(pdir, f[0])
        out["failed"].append({"path": f[0], "file": os.path.basename(f[0]),
                              "local": local, "time": f[1]})
    counts = _query(db.counts)
    if counts:
        out["complete"], out["incomplete"] = counts[0], counts[1]
        out["missing"] = [{"student": m[0], "page": m[1], "copy": m[2]} for m in counts[2]]
    return jsonify(out)


@bp.route("/ui/api/scan-page")
def api_scan_page():
    if not _open_project():
        return jsonify(project=None)
    try:
        student, page, copy = (int(request.args[k]) for k in ("student", "page", "copy"))
    except (KeyError, ValueError):
        return jsonify(error="student, page and copy are needed"), 400
    db = core.Amcdb(core.project_dir())
    try:
        boxes = page_boxes(db, student, page, copy, images=True)
    except sqlite3.Error:
        boxes = []
    return jsonify(project=flask_g.project_name, student=student, page=page,
                   copy=copy, boxes=boxes)


def on_review_page(data):
    """Record a page as checked by a person: the given boxes are set as
    decided; with no decisions, every box keeps what was detected."""
    data = data if isinstance(data, dict) else {}
    try:
        student, page, copy = (int(data[k]) for k in ("student", "page", "copy"))
        decisions = [(int(q), int(a), bool(t)) for q, a, t in data.get("decisions", [])][:1000]
    except (KeyError, TypeError, ValueError):
        core.dialog_msg(warn="This page couldn't be recorded.")
        return
    db = core.get_db()
    if not decisions:
        boxes = page_boxes(db, student, page, copy)
        if boxes:
            decisions = [(boxes[0]["question"], boxes[0]["answer"], boxes[0]["ticked"])]
    for question, answer, ticked in decisions:
        # The first one also copies what was detected to the whole page.
        db.set_manual(student, page, copy, question, answer, ticked, True)
    core.emit_msg("ui-changed", "review")


def on_accept_detected(data):
    """Record every page still to check as checked, keeping what was detected."""
    db = core.get_db()
    pages = _pages_to_check(db)
    if pages:
        core.emit_msg("t", f"Accepting {len(pages)} pages as detected")
        core.emit_msg("begin-command")
        for i, p in enumerate(pages):
            boxes = page_boxes(db, p["student"], p["page"], p["copy"])
            if boxes:
                db.set_manual(p["student"], p["page"], p["copy"], boxes[0]["question"],
                              boxes[0]["answer"], boxes[0]["ticked"], True)
            core.emit_msg("p", (i + 1) / len(pages))
        core.emit_msg("end-command")
        add_activity(core.project_dir(), f"{len(pages)} pages accepted as detected")
    core.emit_msg("ui-changed", "review")


# ---------------------------------------------------------------- results
#
# Mark, Match students, Export marks, Annotate. AMC does the work
# (prepare --mode b, note, association-auto, export, annotate); this adds
# what the screens need: whether marks are out of date, the class list as
# data, the sheets with their matches, and an activity entry for each run.

def _annotated_dir(pdir):
    return f"{pdir}/cr/corrections/pdf"


PREVIEW_DIR = "cr/corrections"          # inside the exam folder
PREVIEW_FILE = "ui-preview.pdf"         # one student's annotated sheet
MARK_OPTIONS = ("note_max", "note_null", "note_min", "note_grain", "note_arrondi",
                "note_max_plafond", "seuil", "seuil_up")
EXPORT_OPTIONS = ("format_export", "export_include_abs", "export_ods_stats",
                  "export_csv_ticked", "export_sort", "app_public_marks")
ANNOTATE_OPTIONS = ("annote_position", "verdict", "regroupement_type",
                    "modele_regroupement", "regroupement_compose", "add_corrected",
                    "annotate_dont_overwrite")
# AMC's own default header text (AMC::Config defaut_verdict)
DEFAULT_VERDICT = "%(ID)\nMark: %s/%m (total score: %S/%M)"
KEY_CANDIDATES = ("etud", "etu", "student", "number", "id", "ID")  # as upstream
NOT_IN_LIST = "NONE"                    # AMC's manual match for "not in the list"


def _db_for(pdir, *modules):
    """An Amcdb with these modules, or None while one doesn't exist yet."""
    if not all(_has_db(pdir, m) for m in modules):
        return None
    db = core.Amcdb(pdir)
    for m in modules:
        db.use_module(m)
    db.db.row_factory = None
    return db


def _source_files(pdir):
    """The main source and the other LaTeX files next to it (\\input).
    For AMC-TXT only the main source: AMC writes LaTeX files of its own
    next to it each time it reads it."""
    main = core.main_source_file()
    if core.get_option("filter") == "plain":
        return [main] if main and os.path.isfile(os.path.join(pdir, main)) else []
    return [f for f in sorted(os.listdir(pdir))
            if (f == main or f.rsplit(".", 1)[-1].lower() in ("tex", "latex"))
            and os.path.isfile(os.path.join(pdir, f))]


def source_digest(pdir):
    h = hashlib.sha256()
    for f in _source_files(pdir):
        with open(os.path.join(pdir, f), "rb") as fh:
            h.update(f.encode() + b"\0" + hashlib.sha256(fh.read()).digest())
    return h.hexdigest()[:32]


def marking_inputs(pdir):
    """A fingerprint of what the marks depend on: the LaTeX or AMC-TXT
    sources (scoring and answer key), the final mark settings, the
    detection thresholds, and the scanned pages with every decision made in
    Check scans. Marks computed from different inputs are out of date."""
    h = hashlib.sha256()
    h.update(source_digest(pdir).encode())
    h.update(json.dumps(core.get_options(list(MARK_OPTIONS)), sort_keys=True).encode())
    db = _db_for(pdir, "capture")
    if db:
        for sql in ("SELECT student, page, copy, timestamp_auto, timestamp_manual"
                    " FROM capture.capture_page ORDER BY 1, 2, 3",
                    "SELECT student, page, copy, id_a, id_b, manual FROM capture.capture_zone"
                    " WHERE type=4 AND manual>=0 ORDER BY 1, 2, 3, 4, 5"):
            for row in _query(lambda sql=sql: db.db.execute(sql).fetchall(), []):
                h.update(repr(tuple(row)).encode())
    return h.hexdigest()[:32]


def _newest(paths):
    times = [os.path.getmtime(p) for p in paths if os.path.isfile(p)]
    return max(times) if times else None


def results_freshness(pdir, rec, status):
    """Whether marks, exported files and annotated sheets are out of date.
    Marks computed elsewhere (no record) count as up to date."""
    marks = rec.get("marks") or {}
    stale = marks["inputs"] != marking_inputs(pdir) if marks.get("inputs") else None
    out = {"marks_info": {"at": marks.get("at"), "by": marks.get("by"), "stale": stale}}
    since = max(marks.get("at") or 0, rec.get("matches_at") or 0)
    newest = _newest([f"{pdir}/exports/{f}" for f in status["exports"]])
    out["exports_stale"] = bool(newest and (stale or newest < since))
    db = _db_for(pdir, "capture")
    changed = _query(lambda: int(db.get_variable("capture", "annotate_source_change") or 0), 0) if db else 0
    adir = _annotated_dir(pdir)
    newest = _newest([f"{adir}/{f}" for f in _files(adir)])
    out["annotated_stale"] = bool(newest and (stale or newest < max(since, changed)))
    return out


# ---- the class list

def class_list():
    """The exam's class list as data, or None when there is none. Uses
    upstream's reader (comment lines, sniffed separator), so AMC and the
    screens read the file the same way."""
    path = core.students_list_file()
    if not path:
        return None
    out = {"file": os.path.basename(path), "columns": [], "rows": [], "unique": [],
           "key": None, "error": None}
    try:
        rows = [{k: (v or "").strip() for k, v in r.items() if k is not None}
                for r in core.list_file_read(path)]
        columns = core.list_file_headers(path)[1]
    except Exception as e:  # unreadable, empty, or no separator found
        core.app.logger.warning(f"Can't read class list {path}: {e}")
        out["error"] = ("The class list can't be read. Save it as CSV with column "
                        "names on the first line, one student per line.")
        return out
    out["columns"] = [c for c in columns if c]
    out["rows"] = rows
    out["unique"] = [c for c in out["columns"]
                     if rows and len({r.get(c, "") for r in rows}) == len(rows)
                     and all(r.get(c) for r in rows)]
    key = core.get_option("liste_key")
    if not key or key not in out["unique"]:
        key = next((c for c in KEY_CANDIDATES if c in out["unique"]), None)
        if key is None:  # same names, any case: "Student", "ID"
            lower = {c.lower(): c for c in out["unique"]}
            key = next((lower[c.lower()] for c in KEY_CANDIDATES if c.lower() in lower), None)
        if key:
            core.change_option("liste_key", key)
    out["key"] = key
    return out


def _name_columns(columns):
    o = core.get_options(["global:csv_name_headers", "global:csv_surname_headers"])
    first = core.first_of(columns, "prenom", "name", "firstname", "first name",
                          *core.headers_list(o["global:csv_name_headers"] or ""))
    last = core.first_of(columns, "nom", "surname", "lastname", "last name",
                         *core.headers_list(o["global:csv_surname_headers"] or ""))
    return first, last


def student_names(cl):
    """id -> display name ("Surname Firstname", like upstream), from the class list."""
    if not cl or cl.get("error") or not cl.get("key"):
        return {}
    first, last = _name_columns(cl["columns"])
    other = next((c for c in cl["columns"] if c != cl["key"]), None)
    names = {}
    for i, r in enumerate(cl["rows"]):
        parts = [r.get(last, ""), r.get(first, "")] if (first or last) else [r.get(other, "")]
        names[r.get(cl["key"], "")] = " ".join(p for p in parts if p) or f"Student {i + 1}"
    return names


# ---- sheets and their matches

def _match_state(auto, manual):
    real = manual if manual is not None else auto
    if real == NOT_IN_LIST:
        return "none", None
    if not real:
        return "unmatched", None
    return ("manual" if manual is not None else "auto"), real


def sheet_rows(pdir):
    """Every scanned answer sheet (a copy) with its match."""
    db = _db_for(pdir, "capture")
    if not db:
        return []
    assoc = _has_db(pdir, "association")
    if assoc:
        db.use_module("association")
    rows = db.db.execute(
        "SELECT p.student, p.copy, " + ("a.auto, a.manual" if assoc else "NULL, NULL")
        + " FROM (SELECT student, copy FROM capture.capture_page GROUP BY student, copy) AS p"
        + (" LEFT JOIN association.association_association AS a"
           " ON a.student=p.student AND a.copy=p.copy" if assoc else "")
        + " ORDER BY p.student, p.copy").fetchall()
    out = []
    for student, copy, auto, manual in rows:
        state, real = _match_state(auto, manual)
        out.append({"student": student, "copy": copy, "auto": auto, "manual": manual,
                    "state": state, "id": real})
    return out


@bp.route("/ui/api/students")
def api_students():
    name = _open_project()
    if not name:
        return jsonify(project=None)
    pdir = core.project_dir()
    cl = class_list()
    names = student_names(cl)
    db = core.Amcdb(pdir)
    codes = _query(db.codes_list, []) if _has_db(pdir, "scoring") else []
    code = core.get_option("assoc_code")
    if not code and len(codes) == 1:
        code = codes[0]
        core.change_option("assoc_code", code)
    read = {}
    if code and code != "<preassoc>" and _has_db(pdir, "scoring"):
        sdb = _db_for(pdir, "scoring")
        read = {(s, c): v for s, c, v in _query(lambda: sdb.db.execute(
            "SELECT student, copy, value FROM scoring.scoring_code WHERE code=?",
            (code,)).fetchall(), [])}
    marked = set()
    if _has_db(pdir, "scoring"):
        sdb = _db_for(pdir, "scoring")
        marked = {(s, c) for s, c in _query(lambda: sdb.db.execute(
            "SELECT student, copy FROM scoring.scoring_mark").fetchall(), [])}
    sheets = _query(lambda: sheet_rows(pdir), [])
    taken = {}
    for s in sheets:
        s["name"] = names.get(s["id"]) if s["id"] else None
        s["code_read"] = read.get((s["student"], s["copy"]))
        s["marked"] = (s["student"], s["copy"]) in marked
        if s["id"]:
            taken.setdefault(s["id"], []).append([s["student"], s["copy"]])
    students = [{"id": i, "name": n, "sheets": taken.get(i, [])} for i, n in names.items()]
    students.sort(key=lambda x: x["name"].lower())
    list_info = None
    if cl:
        list_info = {k: cl[k] for k in ("file", "columns", "unique", "key", "error")}
        list_info["count"] = len(cl["rows"])
    return jsonify(project=name, list=list_info, codes=codes, code=code or None,
                   multiple=core.to_bool(core.get_option("multiple_copies")),
                   sheets=sheets, students=students)


@bp.route("/ui/namefield/<project>/<int:student>/<int:copy>")
def namefield_image(project, student, copy):
    """The name field AMC cut out of a scanned sheet. The exam is in the
    address (not a header) so an <img> can load it."""
    core.headers_info()
    flask_g.project_name = project
    try:
        if not core.project_exists(project):
            abort(404)
    except ValueError:
        abort(404)
    pdir = core.project_dir()
    db = _db_for(pdir, "capture")
    row = _query(lambda: db.db.execute(
        "SELECT image, imagedata FROM capture.capture_zone WHERE student=? AND copy=? AND type=2",
        (student, copy)).fetchone()) if db else None
    if not row:
        abort(404)
    image, data = row
    if data:
        mime = "image/png" if bytes(data[:4]) == b"\x89PNG" else "image/jpeg"
        return Response(bytes(data), mimetype=mime, headers={"Cache-Control": "no-store"})
    if image and not image.startswith("text:"):
        path = os.path.realpath(os.path.join(pdir, "cr", image))
        if path.startswith(os.path.realpath(pdir) + "/") and os.path.isfile(path):
            return send_file(path, max_age=0)
    abort(404)


# ---- marks

@bp.route("/ui/api/marks")
def api_marks():
    name = _open_project()
    if not name:
        return jsonify(project=None)
    pdir = core.project_dir()
    o = core.get_options(["note_max", "note_null", "note_grain"])
    out = {"project": name, "rows": [], "rule_breaks": [], "options": o}
    db = _db_for(pdir, "scoring")
    if not db:
        return jsonify(out)
    match = {(s["student"], s["copy"]): s for s in _query(lambda: sheet_rows(pdir), [])}
    names = student_names(class_list())
    for student, copy, total, mx, mark in _query(lambda: db.db.execute(
            "SELECT student, copy, total, max, mark FROM scoring.scoring_mark"
            " ORDER BY student, copy").fetchall(), []):
        m = match.get((student, copy), {})
        out["rows"].append({"student": student, "copy": copy, "total": total, "max": mx,
                            "mark": mark, "id": m.get("id"), "state": m.get("state", "unmatched"),
                            "name": names.get(m.get("id")) if m.get("id") else None})
    # Answers that break a question's rules, such as two boxes ticked on a
    # single-answer question: AMC scores them with "e" and records why='E'.
    if _has_db(pdir, "layout"):
        db.use_module("layout")
        out["rule_breaks"] = [
            {"student": s, "copy": c, "question": q, "title": t, "page": p}
            for s, c, q, t, p in _query(lambda: db.db.execute(
                """SELECT s.student, s.copy, s.question, t.title,
                     (SELECT min(b.page) FROM layout.layout_box AS b
                       WHERE b.student=s.student AND b.question=s.question AND b.role=1)
                   FROM scoring.scoring_score AS s
                   LEFT JOIN scoring.scoring_title AS t ON t.question=s.question
                   WHERE s.why='E' ORDER BY s.student, s.copy, s.question""").fetchall(), [])]
    return jsonify(out)


def on_mark(data=None):
    """Compute the marks, always from the latest marking scheme and answer
    key (as upstream's do-mark with "update the scale" ticked)."""
    pdir = core.project_dir()
    inputs = marking_inputs(pdir)
    sources = source_digest(pdir)
    messages, variables = {}, {}
    core.emit_msg("begin-command")
    core.emit_msg("t", "Reading the marking scheme")
    core.amc_command("prepare", "--mode", "b", "--progression-id", "MAJ", "--progression", "1",
                     messages=messages, variables=variables)
    scale_entry = {"inputs": sources, "at": int(time.time()),
                   "error": "The questions can't be read: the source doesn't compile. Fix it in Questions."
                   if messages.get("ERR") else None}
    _update_record(pdir, lambda rec: rec.__setitem__("scale", scale_entry))
    core.u_exports_available()
    core.emit_msg("t", "Computing the marks")
    core.amc_command("note", "--progression-id", "GRD", "--progression", "1",
                     messages=messages, variables=variables)
    core.emit_msg("end-command")
    if not messages.get("ERR"):
        n = _query(core.get_db().n_graded_students, 0)
        entry = {"at": int(time.time()), "by": _who(), "inputs": inputs}
        _update_record(pdir, lambda rec: rec.__setitem__("marks", entry))
        add_activity(pdir, f"Marks computed for {n} cop{'y' if n == 1 else 'ies'}")
        core.emit_msg("ui-toast", f"Marks computed for {n} cop{'y' if n == 1 else 'ies'}.")
    core.show_messages(messages, variables)
    core.emit_msg("ui-changed", "marks")


# ---- matching sheets to students

def _matches_changed(pdir):
    _update_record(pdir, lambda rec: rec.__setitem__("matches_at", int(time.time())))


def on_class_list_loaded(data=None):
    cl = class_list()
    pdir = core.project_dir()
    if cl and not cl["error"]:
        add_activity(pdir, f"Class list loaded: {cl['file']} ({len(cl['rows'])} students)")
    core.emit_msg("ui-changed", "students")


def on_class_list_remove(data=None):
    """Remove the class list file and every match (as upstream's
    studentslist-delete)."""
    pdir = core.project_dir()
    path = core.students_list_file()
    if path and os.path.realpath(path).startswith(os.path.realpath(pdir) + "/"):
        try:
            os.unlink(path)
        except OSError as e:
            core.app.logger.error(f"Can't delete class list {path}: {e}")
    if _has_db(pdir, "association"):
        core.clear_data("assoc")
    core.set_students_list("")
    _matches_changed(pdir)
    add_activity(pdir, "Class list removed, with every match")
    core.emit_msg("ui-changed", "students")


def on_match_auto(data=None):
    pdir = core.project_dir()
    db = core.get_db()
    core.emit_msg("begin-command")
    core.emit_msg("t", "Matching sheets to students")
    messages, variables = core.amc_command("association-auto")
    core.emit_msg("end-command")
    n = _query(lambda: db.n_identifications(manual=False), 0) if _has_db(pdir, "association") else 0
    if not messages.get("ERR"):
        db.set_variable("association", "key_in_list", core.get_option("liste_key"))
        db.set_variable("association", "code", core.get_option("assoc_code"))
        db.annotate_source_change()
        _matches_changed(pdir)
        add_activity(pdir, f"Automatic matching: {n} sheet{'' if n == 1 else 's'} matched")
        core.emit_msg("ui-toast", f"{n} sheet{' was' if n == 1 else 's were'} matched automatically.")
        messages["INFO"] = []  # the count is shown above
    core.show_messages(messages)
    core.emit_msg("ui-changed", "matches")


def on_match(data):
    """Match one sheet: to a student (their id in the class list), to
    nobody in the list ("NONE"), or back to the automatic match (None).
    A student already matched to another sheet is taken off it, unless one
    student may have several sheets; that sheet goes back to the sheets to
    match."""
    data = data if isinstance(data, dict) else {}
    try:
        student, copy = int(data["student"]), int(data["copy"])
    except (KeyError, TypeError, ValueError):
        core.dialog_msg(warn="This sheet couldn't be matched.")
        return
    sid = data.get("id")
    sid = None if sid is None else str(sid).strip()[:200] or None
    pdir = core.project_dir()
    if sid not in (None, NOT_IN_LIST) and sid not in student_names(class_list()):
        core.dialog_msg(warn=f"No student with the code {html.escape(sid)} in the class list.")
        return
    if not _has_db(pdir, "association"):
        core.amc_command("db", "upgrade")  # creates AMC's databases, as opening an exam does
    db = core.get_db()
    db.use_module("association")
    db.use_module("capture")
    db.db.row_factory = None
    freed = []
    if sid not in (None, NOT_IN_LIST) and not core.to_bool(core.get_option("multiple_copies")):
        freed = [list(r) for r in db.db.execute(
            """SELECT student, copy FROM association.association_association
               WHERE (manual=? OR (auto=? AND manual IS NULL)) AND NOT (student=? AND copy=?)""",
            (sid, sid, student, copy)).fetchall()]
        for s, c in freed:
            db.db.execute("UPDATE association.association_association SET manual='' "
                          "WHERE student=? AND copy=?", (s, c))
    cur = db.db.execute("INSERT OR IGNORE INTO association.association_association "
                        "(student, copy, manual, auto) VALUES (?, ?, ?, NULL)", (student, copy, sid))
    if cur.rowcount <= 0:
        db.db.execute("UPDATE association.association_association SET manual=? "
                      "WHERE student=? AND copy=?", (sid, student, copy))
    db.commit()
    db.annotate_source_change()
    _matches_changed(pdir)
    core.emit_msg("ui-matched", {"student": student, "copy": copy, "id": sid, "freed": freed})


def on_match_clear(data=None):
    pdir = core.project_dir()
    if _has_db(pdir, "association"):
        core.get_db().clear_associations()
    _matches_changed(pdir)
    add_activity(pdir, "Every match removed")
    core.emit_msg("ui-changed", "matches")


# ---- export

def _export_module():
    return "CSV" if (core.get_option("format_export") or "").lower() == "csv" else "ods"


@bp.route("/ui/api/export")
def api_export():
    name = _open_project()
    if not name:
        return jsonify(project=None)
    pdir = core.project_dir()
    o = core.get_options(list(EXPORT_OPTIONS))
    o["format_export"] = _export_module()
    files = [{"name": f, "time": int(os.path.getmtime(f"{pdir}/exports/{f}")),
              "size": os.path.getsize(f"{pdir}/exports/{f}")} for f in _files(f"{pdir}/exports")]
    link = None
    if core.to_bool(o["app_public_marks"]):
        link = f"{request.root_url}public/{core.project_uuid()}/marks.csv"
    return jsonify(project=name, options=o, files=files, public_link=link)


def on_export(data=None):
    pdir = core.project_dir()
    module = _export_module()
    os.makedirs(f"{pdir}/exports", exist_ok=True)
    core.emit_msg("begin-command")
    core.emit_msg("t", "Exporting the marks")
    messages, variables = core.amc_command(
        "export", "--module", module, "--output", f"{pdir}/exports/marks.{module.lower()}",
        "--export-ods-filter")
    core.emit_msg("end-command")
    if not messages.get("ERR"):
        add_activity(pdir, f"Marks exported ({module.upper()})")
    core.show_messages(messages)
    core.emit_msg("ui-exported", {"file": f"marks.{module.lower()}", "ok": not messages.get("ERR")})
    core.emit_msg("ui-changed", "exports")


# ---- annotate

def _annotated_files(pdir, names):
    """Annotated sheets with the copy and student they belong to (AMC's
    report of annotated files), then any other PDF in the folder."""
    adir = _annotated_dir(pdir)
    present = set(_files(adir))
    out = []
    db = _db_for(pdir, "report") if _has_db(pdir, "report") else None
    if db:
        match = {(s["student"], s["copy"]): s for s in _query(lambda: sheet_rows(pdir), [])}
        for s, c, f in _query(lambda: db.db.execute(
                "SELECT student, copy, file FROM report.report_student WHERE type=1"
                " ORDER BY student, copy").fetchall(), []):
            if f in present:
                m = match.get((s, c), {})
                out.append({"file": f, "student": s, "copy": c,
                            "name": names.get(m.get("id")) if m.get("id") else None})
                present.discard(f)
    for f in sorted(present):
        if f.lower().endswith(".pdf"):
            out.append({"file": f, "student": None, "copy": None, "name": None,
                        "all": f == "all-students.pdf"})
    return out


@bp.route("/ui/api/annotate")
def api_annotate():
    name = _open_project()
    if not name:
        return jsonify(project=None)
    pdir = core.project_dir()
    o = core.get_options(list(ANNOTATE_OPTIONS))
    preview = f"{pdir}/{PREVIEW_DIR}/{PREVIEW_FILE}"
    return jsonify(project=name, options=o, default_verdict=DEFAULT_VERDICT,
                   files=_annotated_files(pdir, student_names(class_list())),
                   preview=f"{PREVIEW_DIR}/{PREVIEW_FILE}" if os.path.isfile(preview) else None)


def on_annotate(data=None):
    """Annotate every sheet (as upstream's do-annotate)."""
    pdir = core.project_dir()
    single = core.get_option("regroupement_type") == "ALL"
    keep = core.to_bool(core.get_option("annotate_dont_overwrite"))
    if not (single or keep):
        core.unlink_indiv_annotated()
    core.emit_msg("begin-command")
    core.emit_msg("t", "Annotating the answer sheets")
    messages, variables = core.amc_command(
        "annotate", *(["--single-output", "all-students.pdf"] if single else []),
        "--progression-id", "ANNOT", "--progression", "1", "--changes-only")
    core.emit_msg("end-command")
    if messages.get("ERR"):
        core.annotate_source_change()
    else:
        n = len(_files(_annotated_dir(pdir), exclude=("all-students.pdf",)))
        add_activity(pdir, "Annotated sheets made: " + ("one file for the class" if single
                                                        else f"{n} file{'' if n == 1 else 's'}"))
    core.show_messages(messages)
    core.emit_msg("ui-changed", "annotated")


def on_annotate_preview(data):
    """Annotate one sheet into a separate file, to check the settings.
    AMC doesn't record single-file output as a student's annotated sheet,
    so this leaves the real annotated sheets alone."""
    data = data if isinstance(data, dict) else {}
    try:
        student, copy = int(data["student"]), int(data["copy"])
    except (KeyError, TypeError, ValueError):
        core.dialog_msg(warn="Choose a sheet to preview.")
        return
    pdir = core.project_dir()
    out_dir = f"{pdir}/{PREVIEW_DIR}"
    os.makedirs(out_dir, exist_ok=True)
    try:
        os.unlink(f"{out_dir}/{PREVIEW_FILE}")
    except OSError:
        pass
    id_file = core.amc_user_tmp("annotate-preview.txt", is_file=True)
    with open(id_file, "w") as f:
        f.write(f"{student}:{copy}\n" if copy else f"{student}\n")
    core.emit_msg("begin-command")
    core.emit_msg("t", "Annotating one sheet")
    messages, variables = core.amc_command(
        "annotate", "--id-file", id_file, "--pdf-dir", out_dir, "--single-output", PREVIEW_FILE,
        "--progression-id", "ANNOT", "--progression", "1")
    core.emit_msg("end-command")
    ok = os.path.isfile(f"{out_dir}/{PREVIEW_FILE}")
    if messages.get("ERR") or not ok:
        if not messages.get("ERR"):
            messages["ERR"].append(":AMC didn't make the preview.")
        core.show_messages(messages)
    core.emit_msg("ui-annotate-preview", {"file": f"{PREVIEW_DIR}/{PREVIEW_FILE}" if ok else None,
                                          "student": student, "copy": copy})


def class_list_refusal(filename):
    """In /upload/students: a class list is a .csv or .txt file, and it
    can't replace one of the exam's own files."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ("csv", "txt"):
        return "A class list is a CSV file (.csv or .txt)."
    pdir = core.project_dir()
    main = core.main_source_file()
    if filename in (RECORD, "options.xml", main) or (
            os.path.isfile(os.path.join(pdir, filename)) and ext == "txt"
            and core.get_option("filter") == "plain"):
        return f"{filename} is one of the exam's own files. Rename the class list and upload it again."
    return None


# ---------------------------------------------------------------- marking scheme panel
#
# Questions come from AMC's extracted scale (scoring.sqlite, written by
# "prepare --mode b"), so what the panel shows is what AMC will compute.
# A question is editable when the source has it in a form the panel
# understands and that agrees with AMC's data (ui_scale.py). Changes are
# written to the source (scoring and which answers are correct only, so
# they pass the lock), then the scale is extracted again in the
# background.

QUESTION_SIMPLE, QUESTION_MULT = 1, 2
_scale_jobs = {}  # exam folder -> {"pending": bool}: one extraction at a time


def extracted_scale(pdir):
    """AMC's extracted scale: per question (first copy that has it) its
    title, type and answers, with the rules for computing maxima."""
    db = _db_for(pdir, "scoring")
    if not db:
        return None
    q = db.db.execute
    titles = dict(_query(lambda: q("SELECT question, title FROM scoring.scoring_title").fetchall(), []))
    defaults = dict(_query(lambda: q("SELECT type, strategy FROM scoring.scoring_default").fetchall(), []))
    main = dict(_query(lambda: q("SELECT student, strategy FROM scoring.scoring_main").fetchall(), []))
    answers = {}
    for st, qn, an, correct, rule in _query(lambda: q(
            "SELECT student, question, answer, correct, strategy FROM scoring.scoring_answer"
            " ORDER BY student, question, answer").fetchall(), []):
        answers.setdefault((st, qn), []).append((an, bool(correct), rule or ""))
    per_student, first = {}, {}
    for st, qn, qtype, indicative, rule in _query(lambda: q(
            "SELECT student, question, type, indicative, strategy FROM scoring.scoring_question"
            " ORDER BY student, question").fetchall(), []):
        item = {"question": qn, "title": titles.get(qn, str(qn)), "multiple": qtype == QUESTION_MULT,
                "indicative": bool(indicative), "rule": rule or "",
                "answers": answers.get((st, qn), []),
                "rules": [scale.BASE_RULES, main.get(st, ""), defaults.get(qtype, ""), rule or ""]}
        per_student.setdefault(st, []).append(item)
        first.setdefault(qn, item)
    return {"first": first, "per_student": per_student}


def _code_digit(title, pdir):
    db = _db_for(pdir, "layout")
    pattern = (_query(db.code_digit_pattern) if db else None) or r"\.(\d+)$"
    return bool(re.search(pattern, title or ""))


def source_questions(pdir):
    """Questions found in the sources, by id; ids found twice are kept as
    a list so they can be refused."""
    fmt, _ = _main_source()
    found = {}
    files = [core.main_source_file()] if fmt == "plain" else _source_files(pdir)
    for f in files:
        try:
            with open(os.path.join(pdir, f), encoding="utf-8", errors="replace") as fh:
                text = fh.read()
        except (OSError, TypeError):
            continue
        for item in (scale.read_txt(text, f) if fmt == "plain" else scale.read_latex(text, f)):
            found.setdefault(item["id"], []).append(item)
    return found


def _agrees(src, amc, fresh):
    """Whether the source question and AMC's data describe the same thing."""
    plain = [a for a in amc["answers"] if a[0] != 0]
    if src["multiple"] != amc["multiple"] or len(src["answers"]) != len(plain):
        return False
    return not fresh or all(s["correct"] == a[1] for s, a in zip(src["answers"], plain))


def _max(item):
    try:
        return scale.question_max(item["multiple"], item["answers"], item["rules"])
    except scale.Unknown:
        return None


@bp.route("/ui/api/questions")
def api_questions():
    name = _open_project()
    if not name:
        return jsonify(project=None)
    pdir = core.project_dir()
    rec = read_record(pdir)
    sc = rec.get("scale") or {}
    fresh = bool(sc.get("inputs")) and sc["inputs"] == source_digest(pdir) and _has_db(pdir, "scoring")
    out = {"project": name, "format": _main_source()[0], "fresh": fresh,
           "updating": pdir in _scale_jobs, "error": sc.get("error") if fresh else None,
           "questions": [], "totals": None, "neutral": rec.get("neutral") or {}}
    data = extracted_scale(pdir)
    if not data or not data["first"]:
        return jsonify(out)
    src = source_questions(pdir)
    # AMC's own maxima, when the marks are up to date
    amc_max = {}
    if rec.get("marks", {}).get("inputs") == marking_inputs(pdir):
        db = _db_for(pdir, "scoring")
        amc_max = {qn: mx for qn, mx in _query(lambda: db.db.execute(
            "SELECT question, max FROM scoring.scoring_score GROUP BY question").fetchall(), [])}
    for qn in sorted(data["first"]):
        amc = data["first"][qn]
        if _code_digit(amc["title"], pdir):
            continue  # a digit of a student code grid
        found = src.get(amc["title"], [])
        s = found[0] if len(found) == 1 else None
        problem = None
        if not found:
            problem = "This question isn't written in a way the panel can read (for example it comes from a macro)."
        elif len(found) > 1:
            problem = "Two questions have this name in the source."
        elif s["problem"]:
            problem = s["problem"]
        elif not _agrees(s, amc, fresh):
            problem = "The source and AMC's reading of it don't agree for this question."
        rule = s["scoring"]["rule"] if s and s["scoring"] else ""
        neutral = scale.neutral_kind(rule)
        texts = [a["text"] for a in s["answers"]] if s else []
        mx = amc_max.get(qn)
        out["questions"].append({
            "question": qn, "title": amc["title"], "multiple": amc["multiple"],
            "indicative": amc["indicative"], "text": s["text"] if s else "",
            "answers": [{"answer": no, "correct": (s["answers"][no - 1]["correct"] if s and not problem and no else c),
                         "text": "None of these" if no == 0 else (texts[no - 1] if no - 1 < len(texts) else f"Answer {no}")}
                        for no, c, _ in amc["answers"]],
            "rule": rule, "kind": "none" if neutral == "none" else "full" if neutral else "custom" if rule else "default",
            "max": mx if mx is not None else _max(amc), "max_from": "amc" if mx is not None else "rules",
            "rules_max": _max(amc),
            "answer_rules": any(rule for _, _, rule in amc["answers"]),
            "editable": problem is None, "problem": problem,
            "file": s["file"] if s else (found[0]["file"] if found else None),
            "line": s["line"] if s else (found[0]["line"] if found else None)})
    # Total per copy, from the rules (questions can differ between copies)
    totals, unknown = [], False
    for st, items in data["per_student"].items():
        t = 0.0
        for item in items:
            if item["indicative"]:
                continue
            m = _max(item)
            if m is None:
                unknown = True
            else:
                t += m
        totals.append(t)
    if totals:
        out["totals"] = {"min": min(totals), "max": max(totals), "unknown": unknown}
    return jsonify(out)


def refresh_scale(pdir, report_errors=False):
    """Extract the scale again (AMC's prepare --mode b). A request while
    one runs makes it run once more afterwards."""
    if pdir in _scale_jobs:
        _scale_jobs[pdir]["pending"] = True
        return
    _scale_jobs[pdir] = {"pending": False}
    try:
        while True:
            inputs = source_digest(pdir)
            core.emit_msg("ui-scale", "updating")
            messages, variables = {}, {}
            core.amc_command("prepare", "--mode", "b", "--progression-id", "MAJ", "--progression", "1",
                             messages=messages, variables=variables)
            if not os.path.isdir(pdir):
                break  # deleted meanwhile
            errors = [m.lstrip(":>") for m in messages.get("ERR", [])]
            entry = {"inputs": inputs, "at": int(time.time()),
                     "error": ("The questions can't be read: the source doesn't compile. "
                               "Fix it in Questions.") if errors else None}
            _update_record(pdir, lambda rec: rec.__setitem__("scale", entry))
            if errors and report_errors:
                core.show_messages(messages, variables)
            if not _scale_jobs[pdir]["pending"]:
                break
            _scale_jobs[pdir]["pending"] = False
    finally:
        _scale_jobs.pop(pdir, None)
    core.emit_msg("ui-scale", "done")


def on_scale_refresh(data=None):
    refresh_scale(core.project_dir(), report_errors=True)


def on_question_edit(data):
    """Change one question: which answers are correct, its own scoring
    rule, or neutralise it (full marks for everyone, or not counted)."""
    data = data if isinstance(data, dict) else {}
    title, action = str(data.get("title", "")), data.get("action")
    pdir = core.project_dir()
    found = source_questions(pdir).get(title, [])
    if len(found) != 1 or found[0]["problem"]:
        core.dialog_msg(warn="This question can't be changed here. Edit it in Questions.")
        return
    q = found[0]
    path = os.path.join(pdir, q["file"])
    with open(path, encoding="utf-8") as f:
        old = f.read()
    rec = read_record(pdir)
    neutral = dict(rec.get("neutral") or {})
    try:
        if action == "correct":
            new = scale.set_correct(old, q, int(data["answer"]), bool(data.get("correct")))
            what = f"Answer key changed: {title}"
        elif action == "rule":
            rule = str(data.get("rule") or "").strip()
            if not STRATEGY.match(rule):
                raise ValueError(f"The scoring rule '{rule}' contains characters AMC doesn't accept here.")
            new = scale.set_scoring(old, q, rule)
            neutral.pop(title, None)
            what = f"Scoring of {title}: " + (rule or "default")
        elif action == "neutral":
            how = data.get("how")
            current = q["scoring"]["rule"] if q["scoring"] else ""
            if how in ("full", "none"):
                if not scale.neutral_kind(current):
                    neutral[title] = current
                points = 1
                if how == "full":
                    amc = (extracted_scale(pdir) or {"first": {}})["first"]
                    item = next((x for x in amc.values() if x["title"] == title), None)
                    points = (_max(dict(item, rules=item["rules"][:3] + [neutral.get(title, "")])) if item else None) or 1
                new = scale.set_scoring(old, q, scale.neutral_rule(how, points))
                what = f"{title} neutralised: " + ("full marks for everyone" if how == "full" else "not counted")
            else:
                new = scale.set_scoring(old, q, neutral.pop(title, ""))
                what = f"{title} counted normally again"
        else:
            raise ValueError("Unknown change.")
    except (KeyError, TypeError, ValueError) as e:
        core.dialog_msg(warn=html.escape(str(e)) if isinstance(e, ValueError) else "This change couldn't be made.")
        return
    if new == old:
        return
    ext = q["file"].rsplit(".", 1)[-1].lower()
    if exam_lock(pdir) and not same_layout(old, new, ext):
        core.dialog_msg(warn=ONLY_SCORING)
        return
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(new)
    os.replace(tmp, path)
    _update_record(pdir, lambda r: r.__setitem__("neutral", neutral))
    add_activity(pdir, what)
    core.emit_msg("ui-changed", "questions")
    refresh_scale(pdir)
    core.emit_msg("ui-changed", "questions")


SOCKET_EVENTS = {
    "ui-layout-ok": on_layout_ok,
    "ui-mark-printed": on_mark_printed,
    "ui-printed": on_printed,
    "ui-unlock": on_unlock,
    "ui-scoring-defaults": on_scoring_defaults,
    "ui-review-page": on_review_page,
    "ui-accept-detected": on_accept_detected,
    "ui-mark": on_mark,
    "ui-class-list-loaded": on_class_list_loaded,
    "ui-class-list-remove": on_class_list_remove,
    "ui-match-auto": on_match_auto,
    "ui-match": on_match,
    "ui-match-clear": on_match_clear,
    "ui-export": on_export,
    "ui-annotate": on_annotate,
    "ui-annotate-preview": on_annotate_preview,
    "ui-scale-refresh": on_scale_refresh,
    "ui-question-edit": on_question_edit,
}
