"""
The new interface (doc/ui-redesign-plan.md).

It replaces upstream's page at "/". Screens are drawn in the browser by
static/ui/app.js; actions go through the server's existing Socket.IO events
(doc-update, create-project-template, ...), so AMC's processing is
unchanged. This module adds the page routes and read-only JSON views of
data that upstream only renders as HTML fragments.

Kept in its own file so merging AMC team updates stays easy.
"""

import html
import json
import os
import re
import sqlite3
import time
import uuid

from flask import Blueprint, jsonify, make_response, render_template, request
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
        "marked": 0, "matched": 0,
        "students_list": bool(core.get_option("listeeleves")),
        "exports": _files(f"{pdir}/exports"),
        "annotated": len(_files(f"{pdir}/cr/corrections/pdf",
                                exclude=("all-students.pdf",))),
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
    if _has_db(pdir, "association"):
        out["matched"] = _query(db.n_real_identifications, 0)
    rec = read_record(pdir)
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
            line = TXT_ANSWER.sub(r"\1±", raw)
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


SOCKET_EVENTS = {
    "ui-layout-ok": on_layout_ok,
    "ui-mark-printed": on_mark_printed,
    "ui-printed": on_printed,
    "ui-unlock": on_unlock,
    "ui-scoring-defaults": on_scoring_defaults,
}
