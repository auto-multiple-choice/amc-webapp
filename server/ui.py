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
import colorsys
import functools
import hashlib
import html
import io
import json
import os
import re
import shutil
import sqlite3
import subprocess
import tarfile
import time
import uuid

import ui_gallery as gallery
import ui_legend as legend
import ui_structure as paper_structure
import ui_builder as paper_builder
import ui_questions as questions_edit
import ui_scale as scale
import ui_source as source_history

HISTORY_DIR = source_history.HISTORY_DIR  # kept out of exam downloads (amc.py)

from flask import Blueprint, Response, abort, jsonify, make_response, render_template, request, send_file
from flask import after_this_request
from flask import g as flask_g
from werkzeug.datastructures import FileStorage

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
        core.socketio_name(event)(_guarded(event, handler))


# ---------------------------------------------------------------- pages

@bp.route("/")
@bp.route("/exams")
@bp.route("/new")
@bp.route("/appearance")
@bp.route("/exam/<name>")
@bp.route("/exam/<name>/<step>")
def page(name=None, step=None):
    core.headers_info()
    b = branding()
    resp = make_response(render_template(
        "ui_app.html",
        username=core.username(ifnone=""),
        app_version=core.AMCWEB_VERSION or "",
        school=b.get("name", ""),
        logo=_logo_url(b) or "",
        brand_css=brand_css(b) if b.get("color") else "",
        can_brand="1" if can_brand() else "",
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
        item = {"name": name, "modified": modified}
        try:
            item.update(exam_progress(pdir, name))
        except Exception as e:  # one broken exam mustn't hide the others
            core.app.logger.error(f"Progress of {name}: {e}")
            item.update(state=_summary(pdir), next=None, done=0, meta={}, archived=False)
        projects.append(item)
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
        # Without a class list there is nothing to match them to.
        out["unmatched"] = counts["unmatched"] if core.students_list_file() else 0
    if out["marked"]:
        out.update(results_freshness(pdir, rec, out))
    out["lock"] = exam_lock(pdir, rec)
    out["layout_ok"] = layout_confirmation(pdir, rec)
    out["format"] = "plain" if core.get_option("filter") == "plain" else "latex"
    out["activity"] = list(reversed(rec.get("activity", [])[-30:]))
    out["meta"] = rec.get("meta") or {}
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
    path = _record_file(pdir)
    try:
        with open(path, encoding="utf-8") as f:
            rec = json.load(f)
        return rec if isinstance(rec, dict) else {}
    except OSError:
        return {}
    except ValueError:
        # Damaged: keep it for a look instead of writing over it (it may
        # hold the lock) at the next change.
        try:
            os.replace(path, path + ".corrupt")
            core.app.logger.error(f"Unreadable {path}, kept as {RECORD}.corrupt")
        except OSError:
            pass
        return {}


def _is_exam(pdir):
    return os.path.isfile(os.path.join(pdir, "options.xml"))


def _update_record(pdir, change):
    if not _is_exam(pdir):
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


# ---------------------------------------------------------------- source history
#
# Every write to a source file goes through ui_source, which keeps the
# version it replaces (doc/questions-banks-templates-plan.md, section 4).

def _built_digest(rec, filename):
    return (rec.get("built_sources") or {}).get(filename)


def save_source(pdir, filename, data, what, based_on=None):
    """Write a source file of the exam at PDIR, keeping the earlier
    version. Raises ui_source.Conflict when BASED_ON isn't the digest of
    the file as it is on disk."""
    return source_history.write_source(pdir, filename, data, by=_who(), what=what, based_on=based_on,
                                       built_digest=_built_digest(read_record(pdir), filename))


def store_upload(path, upload, what):
    """Save an uploaded file (/upload, /fs): through the history when it
    is a source file in an exam folder, plainly otherwise."""
    pdir, fn = os.path.split(path)
    if _is_exam(pdir) and source_history.tracked(fn):
        upload.stream.seek(0)
        save_source(pdir, fn, upload.stream.read(), what)
    else:
        upload.save(path)


def delete_file(path):
    """Delete a project file (project-delete-file): a source file of an
    exam goes into the history instead of being lost."""
    pdir, fn = os.path.split(path)
    if _is_exam(pdir) and source_history.tracked(fn):
        source_history.delete_source(pdir, fn, by=_who(), built_digest=_built_digest(read_record(pdir), fn))
        add_activity(pdir, f"File deleted: {fn} (kept in History)")
    else:
        os.unlink(path)


_building = {}  # exam folder -> the sources' digests when its build started


def _source_digests(pdir):
    digests = {}
    for f in _source_files(pdir):
        try:
            with open(os.path.join(pdir, f), "rb") as fh:
                digests[f] = source_history.digest(fh.read())
        except OSError:
            pass
    return digests


def note_building():
    """Before the question paper is built: the sources as they are now,
    which is what the build reads (a save during the build mustn't be
    taken for the version that built)."""
    pdir = core.project_dir()
    _building[pdir] = _source_digests(pdir)


def note_built():
    """After the question paper built: remember which version of each
    source it was built from, so History can show "built OK"."""
    pdir = core.project_dir()
    digests = _building.pop(pdir, None)
    if digests is None:
        digests = _source_digests(pdir)
    if not _is_exam(pdir):
        return
    _update_record(pdir, lambda rec: rec.__setitem__("built_sources", digests))
    source_history.mark_built(pdir, digests)


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
        # A rebuild that failed clears the layout and keeps the old PDF.
        if not (_has_db(pdir, "layout") and _query(core.Amcdb(pdir).layout_npages, 0)):
            return None
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
CHANGED_MEANWHILE = ("This file was changed meanwhile (from another tab, or by another teacher). "
                     "Your change wasn't saved: look at the file again and redo it.")
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
    # change_option() drops a "project:" prefix and puts the name into an
    # XPath, so compare the bare name and allow only plain option names.
    bare = re.sub(r"^(?:project|global):", "", str(name))
    if not re.fullmatch(r"[A-Za-z0-9_]+", bare):
        core.dialog_msg(warn="Unknown setting.")
        return True
    return (bare in LOCKED_OPTIONS
            and refuse_if_locked("This setting changes the papers."))


def delete_refused(filename):
    filename = str(filename)
    if filename == core.main_source_file():
        core.dialog_msg(warn="This is the exam's main source file, so it can't be deleted.")
        return True
    if filename in (RECORD, "options.xml"):
        return refuse_if_locked("The exam's settings and record can't be deleted.")
    ext = filename.rsplit(".", 1)[-1].lower()
    return (ext in SOURCE_EXTENSIONS
            and refuse_if_locked("Source files can't be deleted."))


def _lock_for_path(path):
    """The lock of the exam whose folder holds PATH, or None."""
    root = os.path.realpath(core.projects_dir())
    d = os.path.realpath(os.path.dirname(path))
    while d.startswith(root + os.sep):
        if _is_exam(d):
            return exam_lock(d)
        d = os.path.dirname(d)
    return None


def write_refusal(path, upload):
    """In /upload and /fs (POST): the reason this file can't be written
    to PATH, or None."""
    new = upload.stream.read()
    upload.stream.seek(0)
    return write_refusal_bytes(path, new)


def write_refusal_bytes(path, new):
    """The reason these bytes can't be written to PATH (an exam that is
    printed), or None."""
    if not _lock_for_path(path):
        return None
    fn = os.path.basename(path)
    ext = fn.rsplit(".", 1)[-1].lower() if "." in fn else ""
    if fn in (RECORD, "options.xml"):
        return LOCKED.format(what="This file holds the exam's settings and record.")
    if ext not in SOURCE_EXTENSIONS or not os.path.isfile(path):
        return None  # a new file isn't used by the printed papers
    with open(path, "rb") as f:
        old = f.read()
    if same_layout(old.decode("utf-8", "replace"),
                   new.decode("utf-8", "replace"), ext):
        return None
    return ONLY_SCORING


def upload_refusal(upload, dest):
    """In /upload: the reason this file can't be saved, or None."""
    fn, _ = core.upload_file_parts(upload)
    return write_refusal(os.path.join(core.project_dir(), fn), upload)


# Big uploads. A request through Cloudflare (a public server) carries at
# most 100 MB, so the browser sends bigger uploads in parts (app.js
# upload()): each file is appended part by part to a file in the session's
# temporary folder, then the /upload request names the assembled files in
# "staged" fields (ID:FILENAME) and /upload treats them as files sent with
# it. Leftovers go with the nightly cleanup of temporary folders.
UPLOAD_ID = re.compile(r"[0-9a-f]{32}")
UPLOAD_PART_MAX = 64 * 1024 * 1024


def _staged_path(upload_id):
    return core.amc_user_tmp(f"uploads/{upload_id}", is_file=True)


@bp.route("/ui/api/upload-part", methods=["POST"])
def api_upload_part():
    if (request.content_length or 0) > UPLOAD_PART_MAX + 1024 * 1024:
        return jsonify(error="This part is too big."), 413
    upload_id = request.form.get("id", "")
    part = request.files.get("file")
    try:
        offset = int(request.form.get("offset", ""))
    except ValueError:
        offset = -1
    if not UPLOAD_ID.fullmatch(upload_id) or part is None or offset < 0:
        return jsonify(error="An upload part needs an id, an offset and a file."), 400
    path = _staged_path(upload_id)
    size = os.path.getsize(path) if os.path.exists(path) else 0
    if offset != size:
        # A part sent twice (its answer was lost) or out of order. The
        # browser compares the size to tell which.
        return jsonify(error=f"Upload part out of order (expected offset {size}).", size=size), 409
    with open(path, "ab") as f:
        shutil.copyfileobj(part.stream, f)
    return jsonify(ok=True, size=os.path.getsize(path))


def staged_files():
    """In /upload: the files the browser sent in parts, as uploaded files.
    They are deleted once the request is answered."""
    files = []
    for item in request.form.getlist("staged"):
        upload_id, _, name = item.partition(":")
        path = _staged_path(upload_id) if UPLOAD_ID.fullmatch(upload_id) else None
        if not name or path is None or not os.path.isfile(path):
            for f in files:
                f.close()
            abort(make_response(jsonify(error="An uploaded file is missing. Try again."), 400))
        files.append(FileStorage(stream=open(path, "rb"), filename=name))
    if files:
        @after_this_request
        def remove_staged(resp):
            for f in files:
                f.close()
                try:
                    os.remove(f.stream.name)
                except OSError:
                    pass
            return resp
    return files


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
    if how == "printer" and not (_has_db(pdir, "layout") and _query(core.Amcdb(pdir).print_timestamp)):
        # AMC records the print time once the job reached the print system;
        # none means the print failed (the error has been shown), so the
        # exam stays unlocked.
        add_activity(pdir, "Printing failed: nothing reached the printer")
        return
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

    # Exported marks and annotated sheets came from those marks: without
    # them the exam would still look "exported".
    for sub in ("exports", PREVIEW_DIR, f"{PREVIEW_DIR}/pdf", f"{PREVIEW_DIR}/jpg"):
        d = os.path.join(pdir, sub)
        for f in _files(d):
            try:
                os.unlink(os.path.join(d, f))
            except OSError:
                pass

    def change(rec):
        for k in ("lock", "layout_ok", "marks"):
            rec.pop(k, None)
    _update_record(pdir, change)
    add_activity(pdir, "Unlocked: layout, scans, marks, matches, exported marks and annotated sheets removed")
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
        with open(path, encoding="utf-8", newline="") as f:
            text = f.read()
        new = write_scoring_defaults(text, fmt, values)
    except UnicodeDecodeError:
        core.dialog_msg(warn="The main source file isn't UTF-8 text, so it can't be changed here.")
        return
    except (OSError, TypeError, ValueError) as e:
        core.dialog_msg(warn=html.escape(str(e)) if isinstance(e, ValueError) else "The main source file can't be changed.")
        return
    if new != text:
        what = ("Default scoring changed: single " + (values["S"] or "AMC default")
                + "; multiple " + (values["M"] or "AMC default"))
        try:
            save_source(core.project_dir(), os.path.basename(path), new.encode("utf-8"), what,
                        based_on=source_history.digest(text.encode("utf-8")))
        except (source_history.Conflict, OSError):
            core.dialog_msg(warn=CHANGED_MEANWHILE)
            return
        add_activity(core.project_dir(), what)
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
        # A file saved by Excel as "CSV UTF-8" starts with a byte-order
        # mark, which would stick to the first column's name.
        bom = lambda k: k.lstrip("\ufeff") if isinstance(k, str) else k
        rows = [{bom(k): (v or "").strip() for k, v in r.items() if k is not None}
                for r in core.list_file_read(path)]
        columns = [bom(c) for c in core.list_file_headers(path)[1]]
    except UnicodeDecodeError:
        out["error"] = ("The class list isn't UTF-8 text. Save it again as CSV UTF-8 "
                        "(in Excel: \"CSV UTF-8\"), then upload it.")
        return out
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
    # AMC finds a matched student's row in the class list (the name in the
    # annotated sheets' header) by this column: set it as upstream's
    # do_associate does, or the header loses the name.
    key = core.get_option("liste_key")
    if key and db.get_variable("association", "key_in_list") != key:
        db.set_variable_nocommit("association", "key_in_list", key)
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


def _ensure_match_key(pdir):
    """Exams matched by hand before this was fixed have no key_in_list, so
    AMC can't fill the student's name or class list columns into the
    header: set it from the column chosen in Match students."""
    key = core.get_option("liste_key")
    if not key or not _has_db(pdir, "association"):
        return
    db = core.get_db()
    if not db.get_variable("association", "key_in_list"):
        db.set_variable("association", "key_in_list", key)


def _symbol_options():
    """The AMC settings that draw the symbols: AMC keeps them per teacher
    (cf.default.xml in their settings folder), not per exam. {name: value},
    or None while the teacher has no settings file."""
    try:
        o = core.get_options(["global:" + n for n in legend.option_names()])
    except OSError:
        return None
    return {k.split(":", 1)[1]: v for k, v in o.items()}


def _make_settings_file():
    """An empty AMC settings file for the teacher. AMC writes the file
    itself when an exam is opened, so it is normally there already; but
    without it the symbols chosen here would never reach AMC, which would
    draw its own while the page shows another choice."""
    path = core.user_confdir() + "/cf.default.xml"
    os.makedirs(os.path.dirname(path), exist_ok=True)
    try:
        with open(path, "x", encoding="utf-8") as f:
            f.write('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<global>\n</global>\n')
    except FileExistsError:
        pass


def _annotate_style(pdir):
    """The exam's symbols and key (ui_legend). Its symbols are written into
    the teacher's AMC settings just before AMC annotates, so each exam gets
    its own. A change remakes every sheet."""
    have = _symbol_options()
    st = legend.style_of(read_record(pdir), have or {})
    want = legend.amc_options(st["scheme"])
    if have is None:
        _make_settings_file()
        have = {}
    changed = False
    for k, v in want.items():
        if str(have.get(k) or "") != v:
            core.change_option("global:" + k, v)
            changed = True
    if changed:
        core.annotate_source_change()
    return st


def _stamp_key(pdir, st, pdf=None):
    """Add the key to the annotated sheets (or to one PDF, the preview)."""
    try:
        if pdf:
            size = legend.page_size(pdf) if st["legend"] != "none" else None
            if size:
                legend.stamp(pdf, legend.make_legend(st["scheme"], st["legend"], size, f"{pdir}/{PREVIEW_DIR}"))
        else:
            legend.stamp_folder(_annotated_dir(pdir), st["scheme"], st["legend"], f"{pdir}/{PREVIEW_DIR}")
    except (RuntimeError, OSError, subprocess.SubprocessError) as e:
        core.app.logger.error(f"Annotation key: {e}")
        core.dialog_msg(warn=f"The sheets are annotated, but the key couldn't be added to all of them: {e}")


def on_annotate_style(data):
    """Symbols and key chosen in Annotate: a preset, or custom shapes and
    colours; where the key goes."""
    data = data if isinstance(data, dict) else {}
    preset, where = data.get("preset"), data.get("legend")
    pdir = core.project_dir()
    if preset == "custom":
        try:
            scheme = legend.check_scheme(data.get("scheme"))
        except ValueError as e:
            core.dialog_msg(warn=str(e))
            return
    elif preset not in legend.PRESETS:
        core.dialog_msg(warn="Unknown symbols.")
        return
    if where not in legend.LEGENDS:
        core.dialog_msg(warn="Unknown place for the key.")
        return

    def change(rec):
        rec["annotate_style"] = {"preset": preset, "legend": where, **({"scheme": scheme} if preset == "custom" else {})}
    _update_record(pdir, change)
    _annotate_style(pdir)
    core.annotate_source_change()  # the key changed too: remake every sheet
    core.emit_msg("ui-changed", "annotated")


@bp.route("/ui/api/annotate")
def api_annotate():
    name = _open_project()
    if not name:
        return jsonify(project=None)
    pdir = core.project_dir()
    o = core.get_options(list(ANNOTATE_OPTIONS))
    preview = f"{pdir}/{PREVIEW_DIR}/{PREVIEW_FILE}"
    st = legend.style_of(read_record(pdir), _symbol_options() or {})
    return jsonify(project=name, options=o, default_verdict=DEFAULT_VERDICT,
                   style=st, presets=legend.PRESETS, cases=legend.CASES,
                   shapes=[[k, v] for k, v in legend.SHAPE_NAMES.items()],
                   files=_annotated_files(pdir, student_names(class_list())),
                   preview=f"{PREVIEW_DIR}/{PREVIEW_FILE}" if os.path.isfile(preview) else None)


def on_annotate(data=None):
    """Annotate every sheet (as upstream's do-annotate)."""
    pdir = core.project_dir()
    single = core.get_option("regroupement_type") == "ALL"
    keep = core.to_bool(core.get_option("annotate_dont_overwrite"))
    if not (single or keep):
        core.unlink_indiv_annotated()
    _ensure_match_key(pdir)
    st = _annotate_style(pdir)
    core.emit_msg("begin-command")
    core.emit_msg("t", "Annotating the answer sheets")
    messages, variables = core.amc_command(
        "annotate", *(["--single-output", "all-students.pdf"] if single else []),
        "--progression-id", "ANNOT", "--progression", "1", "--changes-only")
    core.emit_msg("end-command")
    if messages.get("ERR"):
        core.annotate_source_change()
    else:
        _stamp_key(pdir, st)
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
    _ensure_match_key(pdir)
    st = _annotate_style(pdir)
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
    if ok and not messages.get("ERR"):
        _stamp_key(pdir, st, f"{out_dir}/{PREVIEW_FILE}")
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
    current = os.path.basename(core.students_list_file() or "")
    if filename in (RECORD, "options.xml", main) or (
            filename != current
            and os.path.isfile(os.path.join(pdir, filename)) and ext == "txt"
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
        problem = None
        try:
            with open(os.path.join(pdir, f), "rb") as fh:
                raw = fh.read()
        except (OSError, TypeError):
            continue
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            text = raw.decode("utf-8", "replace")
            problem = "The file isn't UTF-8 text."  # shown read-only
        for item in (scale.read_txt(text, f) if fmt == "plain" else scale.read_latex(text, f)):
            item["problem"] = item["problem"] or problem
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
        elif s.get("kind") == "numeric":
            problem = "A numeric question is scored by its \\AMCnumericChoices options (scoreexact, scoreapprox): change them in Questions."
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
        while _is_exam(pdir):
            inputs = source_digest(pdir)
            core.emit_msg("ui-scale", "updating")
            messages, variables = {}, {}
            core.amc_command("prepare", "--mode", "b", "--progression-id", "MAJ", "--progression", "1",
                             messages=messages, variables=variables)
            if not _is_exam(pdir):
                # The exam was deleted while AMC ran, and AMC made its
                # folders again: without options.xml it is no exam, remove it.
                if os.path.isdir(pdir):
                    core.app.logger.info(f"Removing {pdir}, recreated by AMC after the exam was deleted")
                    shutil.rmtree(pdir, ignore_errors=True)
                break
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
    try:
        with open(path, encoding="utf-8", newline="") as f:
            old = f.read()
    except (OSError, UnicodeDecodeError):
        core.dialog_msg(warn="This file isn't UTF-8 text, so it can't be changed here. Edit it in Questions.")
        return
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
    try:
        save_source(pdir, q["file"], new.encode("utf-8"), what, based_on=source_history.digest(old.encode("utf-8")))
    except (source_history.Conflict, OSError):
        core.dialog_msg(warn=CHANGED_MEANWHILE)
        return
    _update_record(pdir, lambda r: r.__setitem__("neutral", neutral))
    add_activity(pdir, what)
    core.emit_msg("ui-changed", "questions")
    refresh_scale(pdir)
    core.emit_msg("ui-changed", "questions")


# ---------------------------------------------------------------- source files and history

def _editable_file(pdir, name):
    """A file the editor may open: a plain name of an editable file (or a
    new one) in the exam folder."""
    if not name or "/" in name or "\\" in name or name.startswith("."):
        return False
    return core.file_level(pdir, core.main_source_file(), name) <= 0


@bp.route("/ui/api/source")
def api_source():
    """A source file's text, with the digest the editor saves against."""
    name = _open_project()
    if not name:
        return jsonify(project=None)
    pdir = core.project_dir()
    fn = request.args.get("file", "")
    if not _editable_file(pdir, fn):
        return jsonify(project=name, error="Not a file of this exam."), 400
    try:
        with open(os.path.join(pdir, fn), "rb") as f:
            data = f.read()
    except OSError:
        return jsonify(project=name, file=fn, error="The file doesn't exist."), 404
    problem = None
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        text = data.decode("utf-8", "replace")
        problem = "The file isn't UTF-8 text, so it is shown read-only."
    return jsonify(project=name, file=fn, text=text, digest=source_history.digest(data),
                   problem=problem, tracked=source_history.tracked(fn))


@bp.route("/ui/api/source", methods=["POST"])
def api_source_save():
    """The editor's save: the text, and the digest of the version it was
    edited from. A file changed meanwhile (another tab, another teacher)
    is refused with conflict=true; the browser decides."""
    name = _open_project()
    if not name:
        return jsonify(error="This exam doesn't exist any more.")
    data = request.get_json(silent=True) or {}
    fn, text = str(data.get("file") or ""), data.get("text")
    pdir = core.project_dir()
    if not isinstance(text, str) or not _editable_file(pdir, fn):
        return jsonify(error="Not a file of this exam.")
    raw = text.encode("utf-8")
    path = os.path.join(pdir, fn)
    if refusal := write_refusal_bytes(path, raw):
        return jsonify(error=refusal)
    try:
        if source_history.tracked(fn):
            dg = save_source(pdir, fn, raw, "Saved in the editor",
                             based_on=str(data.get("based_on") or "") or None)
        else:
            tmp = path + ".tmp"
            with open(tmp, "wb") as f:
                f.write(raw)
            os.replace(tmp, path)
            dg = source_history.digest(raw)
    except source_history.Conflict as c:
        return jsonify(error="This file was changed since you opened it.", conflict=True, digest=str(c))
    except OSError:
        return jsonify(error="This exam doesn't exist any more.")
    core.emit_msg("source-saved")
    return jsonify(ok=True, digest=dg)


@bp.route("/ui/api/history")
def api_history():
    """The versions kept of one file (or of every file), and which files
    have a history, including deleted ones."""
    name = _open_project()
    if not name:
        return jsonify(project=None)
    pdir = core.project_dir()
    fn = request.args.get("file") or None
    if fn is not None and not source_history.tracked(fn):
        return jsonify(project=name, error="No history is kept for this file."), 400
    out = {"project": name, "file": fn, "versions": source_history.versions(pdir, fn),
           "files": source_history.files_with_history(pdir), "current": None,
           "keep_days": source_history.KEEP_DAYS, "keep_at_least": source_history.KEEP_AT_LEAST}
    if fn:
        cur = source_history.current_info(pdir, fn)
        if cur:
            cur["built"] = cur["digest"] == _built_digest(read_record(pdir), fn)
            out["current"] = cur
    return jsonify(out)


@bp.route("/ui/api/history/<vid>")
def api_history_version(vid):
    name = _open_project()
    if not name:
        return jsonify(project=None)
    pdir = core.project_dir()
    fn = request.args.get("file", "")
    data = source_history.read_version(pdir, fn, vid)
    if data is None:
        return jsonify(project=name, error="This version doesn't exist."), 404
    if request.args.get("raw"):  # the version as a file to download
        stem, ext = fn.rsplit(".", 1)
        return send_file(io.BytesIO(data), mimetype="text/plain", as_attachment=True,
                         download_name=f"{stem}.{vid}.{ext}")
    return jsonify(project=name, file=fn, id=vid, text=data.decode("utf-8", "replace"),
                   entry=source_history.entry(pdir, fn, vid))


def on_history_restore(data):
    """Make a kept version the file again; the file as it is now is kept.
    A deleted file comes back."""
    data = data if isinstance(data, dict) else {}
    fn, vid = str(data.get("file") or ""), str(data.get("id") or "")
    pdir = core.project_dir()
    e = source_history.entry(pdir, fn, vid)
    text = source_history.read_version(pdir, fn, vid) if e else None
    if text is None:
        core.dialog_msg(warn="This version doesn't exist any more.")
        return
    path = os.path.join(pdir, fn)
    existed = os.path.isfile(path)
    if not existed and exam_lock(pdir) and fn.rsplit(".", 1)[-1].lower() in SOURCE_EXTENSIONS:
        core.dialog_msg(warn=LOCKED.format(what="A source file that comes back could change the printed papers."))
        return
    if refusal := write_refusal_bytes(path, text):
        core.dialog_msg(warn=refusal)
        return
    label = time.strftime("%d %b %Y %H:%M", time.localtime(e.get("at") or 0))
    try:
        source_history.restore(pdir, fn, vid, by=_who(), what=f"Restored the version of {label}",
                               built_digest=_built_digest(read_record(pdir), fn))
    except OSError:
        core.dialog_msg(warn="This exam doesn't exist any more.")
        return
    add_activity(pdir, f"{fn}: the version of {label} restored" + ("" if existed else " (the file had been deleted)"))
    if not existed:
        core.emit_msg("project-files-list")
    refresh_layout(pdir)  # a builder exam: the layout follows a restored paper.json or exam.tex
    core.emit_msg("ui-history-restored", {"file": fn, "id": vid})
    core.emit_msg("ui-changed", "questions")


# ---------------------------------------------------------------- the question editor

def _editor_file(pdir, fn):
    """One source file as the form editor sees it: its questions in file
    order, with what each form field edits."""
    with open(os.path.join(pdir, fn), "rb") as f:
        raw = f.read()
    out = {"file": fn, "digest": source_history.digest(raw), "problem": None, "questions": [], "groups": []}
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        out["problem"] = "The file isn't UTF-8 text, so it can only be read."
        return out
    qs = scale.read_latex(text, fn)
    counts = {}
    for q in qs:
        counts[q["id"]] = counts.get(q["id"], 0) + 1
    for q in qs:
        problem = q["problem"] if counts[q["id"]] == 1 else "Two questions have this name."
        out["questions"].append({
            "id": q["id"], "line": q["line"], "kind": q["kind"], "group": q["group"],
            "latex": q["text_latex"], "text": q["text"],
            "answers": [{"latex": a["latex"], "text": a["text"], "correct": a["correct"], "opts": a["opts"]}
                        for a in q["answers"]],
            "choices": q["choices"]["kind"] if q["choices"] else None,
            "numeric": {"value": q["numeric"]["value"], "options": q["numeric"]["options"]} if q["numeric"] else None,
            "explain": q["explain"]["latex"] if q["explain"] else "",
            "figure": q["figure"]["file"] if q["figure"] else None,
            "rule": q["scoring"]["rule"] if q["scoring"] else "",
            "problem": problem, "editable": problem is None})
        if q["group"] and q["group"] not in out["groups"]:
            out["groups"].append(q["group"])
    return out


@bp.route("/ui/api/editor")
def api_editor():
    name = _open_project()
    if not name:
        return jsonify(project=None)
    pdir = core.project_dir()
    fmt, _ = _main_source()
    out = {"project": name, "format": fmt, "main": core.main_source_file(), "files": [],
           "lock": bool(exam_lock(pdir))}
    if fmt == "latex":
        out["files"] = [_editor_file(pdir, fn) for fn in _source_files(pdir)]
    return jsonify(out)


@bp.route("/ui/api/editor", methods=["POST"])
def api_editor_edit():
    """Edits from the form (ui_questions.apply), written through the
    history with the digest the form was built from."""
    name = _open_project()
    if not name:
        return jsonify(error="This exam doesn't exist any more.")
    data = request.get_json(silent=True)
    data = data if isinstance(data, dict) else {}
    fn = str(data.get("file") or "")
    pdir = core.project_dir()
    if _main_source()[0] != "latex":
        return jsonify(error="The form editor works with LaTeX exams.")
    if fn not in _source_files(pdir):
        return jsonify(error="Not a source file of this exam.")
    path = os.path.join(pdir, fn)
    try:
        with open(path, "rb") as f:
            raw = f.read()
        text = raw.decode("utf-8")
    except (OSError, UnicodeDecodeError):
        return jsonify(error="This file isn't UTF-8 text, so it can't be changed here.")
    based_on = str(data.get("based_on") or "") or None
    if based_on and based_on != source_history.digest(raw):
        return jsonify(error="This file was changed since the questions were read. Reload to see the changes.", conflict=True)
    try:
        new, what = questions_edit.apply(text, data.get("ops"))
    except questions_edit.EditError as e:
        return jsonify(error=str(e))
    out = new.encode("utf-8")
    if refusal := write_refusal_bytes(path, out):
        return jsonify(error=refusal, locked=True)
    try:
        dg = save_source(pdir, fn, out, what, based_on=based_on)
    except source_history.Conflict:
        return jsonify(error="This file was changed since the questions were read. Reload to see the changes.", conflict=True)
    ops = data.get("ops") or []
    if any(isinstance(o, dict) and o.get("op") in ("answer_correct", "scoring", "add", "delete", "rename") for o in ops):
        add_activity(pdir, what)
    core.emit_msg("ui-changed", "questions")
    return jsonify(ok=True, digest=dg, what=what, file=_editor_file(pdir, fn))


# ---------------------------------------------------------------- paper design: sections

def _all_questions(pdir, files):
    out = []
    for fn in files:
        try:
            with open(os.path.join(pdir, fn), encoding="utf-8") as f:
                out += scale.read_latex(f.read(), fn)
        except (OSError, UnicodeDecodeError):
            continue
    return out


def _structure(pdir):
    """The paper's structure (ui_structure.read) from the main source,
    with the questions of every source file, or None."""
    fmt, path = _main_source()
    main = core.main_source_file()
    if fmt != "latex" or not path or not os.path.isfile(path):
        return None
    with open(path, "rb") as f:
        raw = f.read()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return None
    files = _source_files(pdir)
    out = paper_structure.read(text, main, _all_questions(pdir, files))
    out.update(file=main, digest=source_history.digest(raw), files=[fn for fn in files if fn != main])
    return out


@bp.route("/ui/api/structure")
def api_structure():
    name = _open_project()
    if not name:
        return jsonify(project=None)
    pdir = core.project_dir()
    fmt, _ = _main_source()
    out = {"project": name, "format": fmt, "lock": bool(exam_lock(pdir)),
           "copies_setting": core.get_option("nombre_copies")}
    st = _structure(pdir)
    if st:
        out.update(st)
    else:
        out["error"] = ("Paper design works with LaTeX exams." if fmt != "latex"
                        else "The main source file can't be read.")
    return jsonify(out)


@bp.route("/ui/api/structure", methods=["POST"])
def api_structure_edit():
    """Edits from the Paper design panel (ui_structure.apply) on the main
    source, written through the history with the digest it was read at.
    A renamed section renames the \\element wrappers in the other files."""
    name = _open_project()
    if not name:
        return jsonify(error="This exam doesn't exist any more.")
    data = request.get_json(silent=True)
    data = data if isinstance(data, dict) else {}
    pdir = core.project_dir()
    fmt, path = _main_source()
    main = core.main_source_file()
    if fmt != "latex" or not path or not os.path.isfile(path):
        return jsonify(error="Paper design works with LaTeX exams.")
    with open(path, "rb") as f:
        raw = f.read()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return jsonify(error="The main source isn't UTF-8 text, so it can't be changed here.")
    based_on = str(data.get("based_on") or "") or None
    if based_on and based_on != source_history.digest(raw):
        return jsonify(error="The paper was changed since it was read. Reload to see the changes.", conflict=True)
    files = _source_files(pdir)
    ops = data.get("ops") if isinstance(data.get("ops"), list) else []
    copies = [o.get("n") for o in ops if isinstance(o, dict) and o.get("op") == "copies"]
    if copies and exam_lock(pdir):
        return jsonify(error=LOCKED.format(what="The number of versions changes the papers."), locked=True)
    try:
        new, what, renames = paper_structure.apply(text, ops, _all_questions(pdir, [fn for fn in files if fn != main]))
    except questions_edit.EditError as e:
        return jsonify(error=str(e))
    out = new.encode("utf-8")
    if refusal := write_refusal_bytes(path, out):
        return jsonify(error=refusal, locked=True)
    # a rename reaches the other files' \element wrappers: every file is read and checked before anything is written
    updates = []
    for fn in files:
        if fn == main or not renames:
            continue
        p2 = os.path.join(pdir, fn)
        try:
            with open(p2, "rb") as f:
                t2 = f.read().decode("utf-8")
        except (OSError, UnicodeDecodeError):
            if any(re.search(r"\\element\s*\{\s*" + re.escape(old) + r"\s*\}", open(p2, "rb").read().decode("utf-8", "replace")) for old, _ in renames):
                return jsonify(error=f"{fn} isn't UTF-8 text, so its questions can't be renamed here.")
            continue
        t3 = t2
        for old, new_name in renames:
            t3 = paper_structure.rename_elements(t3, old, new_name)
        if t3 != t2:
            if refusal := write_refusal_bytes(p2, t3.encode("utf-8")):
                return jsonify(error=refusal, locked=True)
            updates.append((fn, t3.encode("utf-8")))
    try:
        dg = save_source(pdir, main, out, what, based_on=based_on)
    except source_history.Conflict:
        return jsonify(error="The paper was changed since it was read. Reload to see the changes.", conflict=True)
    for fn, data2 in updates:
        try:
            save_source(pdir, fn, data2, what)
        except OSError:
            core.app.logger.error(f"{fn}: the renamed groups couldn't be written")
    if copies:
        core.change_option("nombre_copies", int(copies[-1]))  # the app's copies follow the versions
    refresh_layout(pdir)
    add_activity(pdir, what)
    core.emit_msg("ui-changed", "questions")
    return jsonify(ok=True, digest=dg, what=what, structure=_structure(pdir))


# ---------------------------------------------------------------- paper builder (ui_builder.py)

def _builder_design(pdir):
    """paper.json of the exam as bytes-digest and parsed JSON: (None, None)
    when the exam has none, (digest, None) when it can't be parsed."""
    path = os.path.join(pdir, paper_builder.DESIGN_FILE)
    if not os.path.isfile(path):
        return None, None
    with open(path, "rb") as f:
        raw = f.read()
    try:
        return source_history.digest(raw), json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return source_history.digest(raw), None


def _builder_inputs(pdir):
    """The main source's text, its number of versions and the instructions'
    lines per section, for the layout file."""
    fmt, path = _main_source()
    if fmt != "latex" or not path or not os.path.isfile(path):
        return None, 1, []
    try:
        with open(path, encoding="utf-8") as f:
            text = f.read()
    except (OSError, UnicodeDecodeError):
        return None, 1, []
    oc = paper_structure.onecopy(text)
    summary = paper_builder.summary_for(text, _all_questions(pdir, _source_files(pdir)))
    return text, (oc[0] if oc else 1), summary


def _layout_state(pdir, rec):
    """Whether paper-layout.tex is there and whether someone edited it by
    hand since the builder wrote it (its digest is kept in the record)."""
    info = rec.get("builder") or {}
    path = os.path.join(pdir, paper_builder.LAYOUT_FILE)
    if not os.path.isfile(path):
        return {"exists": False, "edited": False}
    with open(path, "rb") as f:
        dg = source_history.digest(f.read())
    return {"exists": True, "edited": bool(info.get("layout_digest")) and info["layout_digest"] != dg}


def write_layout(pdir, design, what="Paper builder: layout rewritten", force=False):
    """paper-layout.tex from the design, through the history, unless the
    teacher keeps hand edits to it (record builder.detached) or has
    edited it and hasn't decided yet (unless FORCE). Returns the digest
    written, or None when nothing was written."""
    rec = read_record(pdir)
    info = rec.get("builder") or {}
    state = _layout_state(pdir, rec)
    if info.get("detached") or (state["edited"] and not force):
        return None
    text, versions, summary = _builder_inputs(pdir)
    if text is None:
        return None
    tex = paper_builder.layout(design, versions, summary).encode("utf-8")
    path = os.path.join(pdir, paper_builder.LAYOUT_FILE)
    if os.path.isfile(path):
        with open(path, "rb") as f:
            if f.read() == tex:
                dg = source_history.digest(tex)
                if info.get("layout_digest") != dg or info.get("detached"):  # the file is the design's again
                    _update_record(pdir, lambda r: r.setdefault("builder", {}).update({"layout_digest": dg, "detached": False}))
                return dg
    if write_refusal_bytes(path, tex):
        return None  # printed: the layout stays as it was built
    dg = save_source(pdir, paper_builder.LAYOUT_FILE, tex, what)
    _update_record(pdir, lambda r: r.setdefault("builder", {}).update({"layout_digest": dg, "detached": False}))
    return dg


def refresh_layout(pdir):
    """After a change elsewhere (sections, versions, a restored file): the
    layout file follows paper.json when the exam has one."""
    _, raw = _builder_design(pdir)
    if raw is None:
        return
    try:
        write_layout(pdir, paper_builder.normalize(raw), "Paper builder: layout updated from the sections")
    except questions_edit.EditError:
        pass


def before_build():
    """Called by the server before a document is built: the layout file is
    brought up to date, and a design that can't be printed stops the
    build with a message. Returns a truthy value to refuse the build."""
    pdir = core.project_dir()
    _, raw = _builder_design(pdir)
    if raw is None:
        return None
    try:
        design = paper_builder.normalize(raw)
    except questions_edit.EditError as e:
        core.dialog_msg(warn=f"The paper can't be built: {e} (Questions › Paper builder)")
        return "refused"
    _, versions, _ = _builder_inputs(pdir)
    errors = [p for p in paper_builder.check(design, versions) if p["level"] == "error"]
    if errors:
        core.dialog_msg(warn=f"The paper can't be built yet: {errors[0]['text']} (Questions › Paper builder)")
        return "refused"
    rec = read_record(pdir)
    if _layout_state(pdir, rec)["edited"] and not (rec.get("builder") or {}).get("detached"):
        core.dialog_msg(warn=f"{paper_builder.LAYOUT_FILE} was edited by hand, so the paper is built from it as it is, not from "
                             "the design. In Questions › Paper builder, choose to keep the edits or to rewrite the file.")
    write_layout(pdir, design, "Paper builder: layout updated for the build")
    return None


def _builder_payload(pdir):
    dg, raw = _builder_design(pdir)
    if dg is None:
        return {"builder": False}
    rec = read_record(pdir)
    info = rec.get("builder") or {}
    out = {"builder": True, "digest": dg, "design": None, "invalid": None, "presets": paper_builder.presets(),
           "detached": bool(info.get("detached")), "layout": _layout_state(pdir, rec),
           "blocks": {t: {"title": b[0], "where": b[1], "flow": b[2], "defaults": b[3]} for t, b in paper_builder.BLOCKS.items()},
           "fields": paper_builder.FIELD_LABELS, "registering": sorted(paper_builder.REGISTERING)}
    if raw is None:
        out["invalid"] = "paper.json can't be read as JSON. Restore an earlier version from History."
        return out
    try:
        design = paper_builder.normalize(raw)
    except questions_edit.EditError as e:
        out["invalid"] = f"paper.json can't be used: {e} Restore an earlier version from History."
        return out
    text, versions, summary = _builder_inputs(pdir)
    images = sorted(f for f in os.listdir(pdir) if f.lower().endswith((".png", ".jpg", ".jpeg", ".pdf")) and not f.startswith(("DOC-", "amc-compiled")))
    out.update(design=design, versions=versions, onecopy=bool(text and paper_structure.onecopy(text)),
               problems=paper_builder.check(design, versions, images), images=images,
               summary=[paper_structure._plain(re.sub(r"^\\amcuiPoint\{(.*)\}$", r"\1", l, flags=re.S)) for l in summary],
               codes=paper_builder.sample_codes(design, versions), max_versions=paper_builder.max_versions(design["codes"]))
    return out


@bp.route("/ui/api/builder")
def api_builder():
    name = _open_project()
    if not name:
        return jsonify(project=None)
    pdir = core.project_dir()
    fmt, _ = _main_source()
    out = {"project": name, "format": fmt, "lock": bool(exam_lock(pdir))}
    out.update(_builder_payload(pdir) if fmt == "latex" else {"builder": False})
    return jsonify(out)


@bp.route("/ui/api/builder", methods=["POST"])
def api_builder_save():
    """The whole design from the builder, checked, written to paper.json
    through the history (with the digest it was read at), then the layout
    file rewritten from it."""
    name = _open_project()
    if not name:
        return jsonify(error="This exam doesn't exist any more.")
    data = request.get_json(silent=True)
    data = data if isinstance(data, dict) else {}
    pdir = core.project_dir()
    if exam_lock(pdir):
        return jsonify(error=LOCKED, locked=True)
    try:
        design = paper_builder.normalize(data.get("design"))
    except questions_edit.EditError as e:
        return jsonify(error=str(e))
    if gallery.needs_unicode_engine(paper_builder.to_json(design)) and core.get_option("moteur_latex_b") != "xelatex":
        core.change_option("moteur_latex_b", "xelatex")  # a detail in another script: the starter's preamble follows the engine
    what = re.sub(r"[^\w ,.:;()'\-’]", "", str(data.get("what") or "changed"))[:80]
    based_on = str(data.get("based_on") or "") or None
    try:
        dg = save_source(pdir, paper_builder.DESIGN_FILE, paper_builder.to_json(design).encode("utf-8"),
                         f"Paper builder: {what}", based_on=based_on)
    except source_history.Conflict:
        return jsonify(error="The design was changed since it was read. Reload to see the changes.", conflict=True)
    write_layout(pdir, design, f"Paper builder: {what}")
    add_activity(pdir, f"Paper builder: {what}")
    core.emit_msg("ui-changed", "questions")
    return jsonify(ok=True, **_builder_payload(pdir))


@bp.route("/ui/api/builder/layout", methods=["POST"])
def api_builder_layout():
    """A hand-edited layout file: "keep" leaves it to the teacher (the
    builder stops writing it), "rewrite" writes it from the design again."""
    name = _open_project()
    if not name:
        return jsonify(error="This exam doesn't exist any more.")
    pdir = core.project_dir()
    if exam_lock(pdir):
        return jsonify(error=LOCKED, locked=True)
    body = request.get_json(silent=True)
    action = body.get("action") if isinstance(body, dict) else None
    if action == "keep":
        _update_record(pdir, lambda r: r.setdefault("builder", {}).update({"detached": True}))
        add_activity(pdir, "Paper builder: the layout file is edited by hand from now on")
    elif action == "rewrite":
        _update_record(pdir, lambda r: r.setdefault("builder", {}).update({"detached": False}))
        _, raw = _builder_design(pdir)
        try:
            write_layout(pdir, paper_builder.normalize(raw), "Paper builder: layout rewritten from the design", force=True)
        except questions_edit.EditError as e:
            return jsonify(error=str(e))
        add_activity(pdir, "Paper builder: layout rewritten from the design")
    else:
        return jsonify(error="Unknown action.")
    core.emit_msg("ui-changed", "questions")
    return jsonify(ok=True, **_builder_payload(pdir))


# ---------------------------------------------------------------- dashboard and new-exam wizard

GALLERY_DIR = os.environ.get("AMC_UI_GALLERY", "/amc-web/gallery")
STARTERS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "school_templates")
STARTER_GROUP = gallery.STARTER_GROUP
# Starters shown in the gallery; "blank" has a separate-answer-sheet variant.
STARTERS = ("blank", "builder", "blank-txt")
STARTER_VARIANTS = {("blank", "separate"): "blank-separate"}
META_FIELDS = ("class", "subject", "date")


# ---------------------------------------------------------------- branding
#
# School name, logo and colours (Appearance), kept with the app's data in
# MC-Projects/_branding/, so ./amc backup includes them. Upstream skips
# "_" folders there, and account names can't start with "_".

BRANDING_DIR = "_branding"
LOGO_TYPES = {"png": "image/png", "jpg": "image/jpeg", "svg": "image/svg+xml"}
LOGO_MAX = 1024 * 1024
NEUTRAL = "#3b5bdb"           # ui.css --brand
SURFACES = {"light": "#ffffff", "dark": "#15181e"}  # ui.css --surface
DARK_TEXT = "#111418"
COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
# Presets keep white button text readable in both themes.
PRESETS = [("Blue", "#3b5bdb"), ("Teal", "#0b7285"), ("Green", "#2b7a3a"), ("Purple", "#7048e8"),
           ("Crimson", "#c92a2a"), ("Orange", "#c2410c"), ("Slate", "#495057")]


def _brand_dir():
    return os.path.join(core.projects_dir(root=True), BRANDING_DIR)


def branding():
    """The school's branding: name, colour, palette, logo file."""
    d = _brand_dir()
    try:
        with open(os.path.join(d, "branding.json"), encoding="utf-8") as f:
            b = json.load(f)
    except (OSError, ValueError):
        b = {}
    b = b if isinstance(b, dict) else {}
    logo = b.get("logo")
    if logo and logo in {f"logo.{e}" for e in LOGO_TYPES} and os.path.isfile(os.path.join(d, logo)):
        b["logo_path"] = os.path.join(d, logo)
    else:
        b.pop("logo", None)
    if not COLOR_RE.match(b.get("color") or ""):
        b.pop("color", None)
    b["palette"] = palette(b.get("color") or NEUTRAL)
    return b


def _rgb(c):
    return tuple(int(c[i:i + 2], 16) / 255 for i in (1, 3, 5))


def _hex(rgb):
    return "#%02x%02x%02x" % tuple(round(max(0.0, min(1.0, x)) * 255) for x in rgb)


def _luminance(c):
    lin = [x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4 for x in _rgb(c)]
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]


def contrast(a, b):
    la, lb = _luminance(a), _luminance(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def theme_palette(color, theme):
    """The brand colour for one theme: changed in lightness only as much as
    needed for it to stand out on the theme's surface (3:1, as for
    controls) and for button text on it to be readable (4.5:1, white or
    near-black)."""
    h, l, s = colorsys.rgb_to_hls(*_rgb(color))
    step = -0.02 if theme == "light" else 0.02
    for _ in range(60):
        c = _hex(colorsys.hls_to_rgb(h, l, s))
        if contrast(c, SURFACES[theme]) >= 3:
            for on in ("#ffffff", DARK_TEXT):
                if contrast(on, c) >= 4.5:
                    return {"brand": c, "on_brand": on, "text_contrast": round(contrast(on, c), 1),
                            "adjusted": c.lower() != color.lower()}
        l = min(1.0, max(0.0, l + step))
    return {"brand": NEUTRAL, "on_brand": "#ffffff", "text_contrast": round(contrast("#ffffff", NEUTRAL), 1),
            "adjusted": True}


def palette(color):
    return {t: theme_palette(color, t) for t in ("light", "dark")}


def brand_css(b):
    """CSS overriding the two brand tokens in each theme (ui.css derives the rest)."""
    p = b["palette"]
    light = f"--brand:{p['light']['brand']};--on-brand:{p['light']['on_brand']};"
    dark = f"--brand:{p['dark']['brand']};--on-brand:{p['dark']['on_brand']};"
    return (f":root{{{light}}}:root[data-theme=\"dark\"]{{{dark}}}"
            f"@media (prefers-color-scheme: dark){{:root:not([data-theme=\"light\"]){{{dark}}}}}")


def can_brand():
    """Admins of the sign-in service in shared-machine mode (the proxy
    sets X-AMC-Admin and strips any copy a browser sends); the local
    user in single-user mode."""
    if not os.environ.get("AMC_USERHEADER"):
        return True
    return request.headers.get("X-AMC-Admin") == "1"


def _logo_url(b):
    return f"/public/branding/logo?v={b.get('updated', 0)}" if b.get("logo") else None


@bp.route("/ui/api/branding")
def api_branding():
    core.headers_info()
    b = branding()
    return jsonify(name=b.get("name", ""), color=b.get("color"), neutral=NEUTRAL, logo=_logo_url(b),
                   palette=b["palette"], can_edit=can_brand(), presets=PRESETS)


@bp.route("/ui/api/branding/palette")
def api_branding_palette():
    color = request.args.get("color", "")
    if not COLOR_RE.match(color):
        return jsonify(error="A colour looks like #1c7ed6."), 400
    return jsonify(palette=palette(color))


def _logo_kind(data):
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    head = data[:2048].lstrip().lower()
    if (head.startswith(b"<?xml") or head.startswith(b"<svg") or head.startswith(b"<!--")) and b"<svg" in head:
        return "svg"
    return None


@bp.route("/ui/branding", methods=["POST"])
def save_branding():
    """Save the school name, colour and logo; "reset" goes back to neutral.
    Needs the AMC-sid header, which a page on another site can't send."""
    core.headers_info()
    if not can_brand() or not request.headers.get("AMC-sid"):
        return jsonify(error="Only administrators can change the appearance."), 403
    d = _brand_dir()
    os.makedirs(d, exist_ok=True)
    b = branding()
    keep = {k: b[k] for k in ("name", "color", "logo") if k in b}
    if request.form.get("reset") == "1":
        keep = {}
    else:
        if "name" in request.form:
            keep["name"] = request.form["name"].strip()[:80]
        if "color" in request.form:
            color = request.form["color"].strip()
            if color and not COLOR_RE.match(color):
                return jsonify(error="A colour looks like #1c7ed6."), 400
            keep["color"] = color.lower() if color else None
        if request.form.get("remove_logo") == "1":
            keep.pop("logo", None)
        upload = request.files.get("logo")
        if upload and upload.filename:
            data = upload.read(LOGO_MAX + 1)
            if len(data) > LOGO_MAX:
                return jsonify(error="The logo is larger than 1 MB."), 400
            kind = _logo_kind(data)
            if not kind:
                return jsonify(error="The logo must be a PNG, JPEG or SVG image."), 400
            tmp = os.path.join(d, f"logo.{kind}.tmp")
            with open(tmp, "wb") as f:
                f.write(data)
            os.replace(tmp, os.path.join(d, f"logo.{kind}"))
            keep["logo"] = f"logo.{kind}"
    for f in os.listdir(d):  # logos no longer used
        if f.startswith("logo.") and f != keep.get("logo"):
            os.unlink(os.path.join(d, f))
    keep = {k: v for k, v in keep.items() if v}
    keep["updated"] = int(time.time())
    keep["by"] = _who()
    tmp = os.path.join(d, "branding.json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(keep, f, indent=1)
    os.replace(tmp, os.path.join(d, "branding.json"))
    core.app.logger.info(f"Branding changed by {_who()}: {keep}")
    return jsonify(ok=True)


# Public, read-only: the sign-in page (a separate service) uses these.

@bp.route("/public/branding.json")
def public_branding():
    b = branding()
    resp = jsonify(name=b.get("name", ""), logo=_logo_url(b), palette=b["palette"])
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@bp.route("/public/branding/logo")
def public_logo():
    b = branding()
    if not b.get("logo_path"):
        abort(404)
    resp = send_file(b["logo_path"], mimetype=LOGO_TYPES[b["logo"].rsplit(".", 1)[1]], max_age=3600)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; img-src data:"
    return resp


@bp.route("/public/branding.js")
def public_branding_js():
    resp = make_response(render_template("ui_branding.js"))
    resp.headers["Content-Type"] = "application/javascript; charset=utf-8"
    resp.headers["Cache-Control"] = "no-cache"
    return resp


def _gallery_index():
    try:
        with open(os.path.join(GALLERY_DIR, "index.json"), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def gallery_templates():
    """Starters first, then AMC's templates, with what the gallery has
    compiled for them."""
    index = _gallery_index()
    out = []
    for tid in STARTERS:
        info = gallery.read_description(os.path.join(STARTERS_DIR, tid))
        if info:
            t = dict(info, gid=STARTER_GROUP, id=tid, starter=True, format="plain" if tid.endswith("-txt") else "latex")
            if tid == "builder":
                t["builder"] = {"presets": paper_builder.presets()}
            out.append(t)
    for t in core.templates:
        out.append(dict(t, starter=False, format="plain" if "txt" in t["id"].lower() else "latex"))
    for t in out:
        built = index.get(f"{t['gid']}/{t['id']}")
        t["preview"] = bool(built)
        t["pages"] = built.get("pages") if built else None
    variant = index.get(f"{STARTER_GROUP}/blank-separate")
    for t in out:
        if t["gid"] == STARTER_GROUP and t["id"] == "blank" and variant:
            t["variants"] = {"separate": "blank-separate"}
    return out


@bp.route("/ui/api/gallery")
def api_gallery():
    core.headers_info()
    groups = [{"id": STARTER_GROUP, "title": "Starters", "text": "Clean starting points"}]
    languages = {"en": "English", "fr": "French", "other": "Other"}  # AMC titles both "Documentation"
    groups += [dict(g, title=languages.get(g["id"]) or re.sub(r"^\[[A-Z]+\]\s*", "", g.get("title") or g["id"]))
               for g in core.template_groups]
    return jsonify(groups=groups, templates=gallery_templates())


@bp.route("/ui/gallery/<gid>/<tid>/<any(thumb, paper):kind>")
def gallery_file(gid, tid, kind):
    core.headers_info()
    known = {(STARTER_GROUP, "blank-separate")} | {(t["gid"], t["id"]) for t in gallery_templates()}
    if (gid, tid) not in known:
        abort(404)
    path = os.path.join(GALLERY_DIR, gid, tid, "thumb.png" if kind == "thumb" else "paper.pdf")
    if not os.path.isfile(path):
        abort(404)
    return send_file(path, max_age=86400)


def _install_builder(rep, style, design, logo):
    """The paper builder starter: paper.json from the chosen preset with
    the wizard's details, the versions in the main source, and the layout
    file written from them."""
    design = design or {}
    d = paper_builder.preset(design.get("preset")) or paper_builder.preset("rj-olympiad")
    d["kind"] = "separate" if style == "separate" else "paper"
    codes = design.get("codes") if isinstance(design.get("codes"), dict) else {}
    d["codes"].update({k: codes[k] for k in ("style", "same_length", "zero_pad") if k in codes})
    paper_builder.apply_fields(d, design.get("fields") if isinstance(design.get("fields"), dict) else {})
    paper_builder.apply_student(d, design.get("student") if isinstance(design.get("student"), dict) else {})
    if logo:
        for r in d["paper"]:
            for c in r["cells"]:
                if c["block"]["type"] == "logo" and not c["block"]["file"]:
                    c["block"]["file"] = logo
                    break
            else:
                continue
            break
    d = paper_builder.normalize(d)
    try:
        versions = max(1, min(int(design.get("versions") or 4), paper_builder.max_versions(d["codes"])))
    except (TypeError, ValueError):
        versions = 4
    with open(os.path.join(rep, paper_builder.DESIGN_FILE), "w", encoding="utf-8") as f:
        f.write(paper_builder.to_json(d))
    main = os.path.join(rep, "exam.tex")
    with open(main, encoding="utf-8") as f:
        text = f.read()
    text, _ = paper_structure.set_copies(text, versions)
    with open(main, "w", encoding="utf-8") as f:
        f.write(text)
    questions = []
    for fn in sorted(os.listdir(rep)):
        if fn.endswith(".tex") and fn != paper_builder.LAYOUT_FILE:
            with open(os.path.join(rep, fn), encoding="utf-8") as f:
                questions += scale.read_latex(f.read(), fn)
    tex = paper_builder.layout(d, versions, paper_builder.summary_for(text, questions))
    with open(os.path.join(rep, paper_builder.LAYOUT_FILE), "w", encoding="utf-8") as f:
        f.write(tex)
    return (versions, source_history.digest(tex.encode("utf-8")),
            any(c["block"]["type"] == "id_grid" for r in d["answer_sheet"] for c in r["cells"]),
            gallery.needs_unicode_engine(paper_builder.to_json(d)))


def _install_starter(tid, rep, style, code_digits, design=None):
    src = os.path.join(STARTERS_DIR, STARTER_VARIANTS.get((tid, style), tid))
    shutil.copytree(src, rep, dirs_exist_ok=True)
    shutil.rmtree(os.path.join(rep, "presets"), ignore_errors=True)
    school = branding()
    logo = ""
    if school.get("logo_path") and school.get("logo_path").lower().endswith((".png", ".jpg", ".jpeg")):
        logo = "school-logo" + os.path.splitext(school["logo_path"])[1].lower()
        shutil.copyfile(school["logo_path"], os.path.join(rep, logo))
    for f in os.listdir(rep):
        if f.endswith((".tex", ".txt")) and f not in ("README.txt",):
            path = os.path.join(rep, f)
            fmt = "plain" if f.endswith(".txt") else "latex"
            with open(path, encoding="utf-8") as fh:
                text = fh.read()
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(gallery.starter_source(text, fmt, school.get("name", ""), logo, code_digits,
                                                separate=(style == "separate")))
    try:
        os.unlink(os.path.join(rep, "description.xml"))
    except OSError:
        pass
    return _install_builder(rep, style, design, logo) if tid == "builder" else None


def on_create_exam(data):
    """The new-exam wizard: details, a template (a starter or one of
    AMC's), the answer sheet style, student code boxes and copies."""
    data = data if isinstance(data, dict) else {}
    name = str(data.get("name") or "").strip()
    gid, tid = str(data.get("gid") or ""), str(data.get("id") or "")
    try:
        core.check_dir_name(name, "project")
        rep = core.check_unused_name(name)
    except ValueError:
        core.dialog_msg(warn="This exam name can't be used.")
        return
    if not rep:
        return  # upstream has said the name is taken
    def number(v, most):
        try:
            return max(0, min(int(v or 0), most))
        except (TypeError, ValueError):
            return 0
    copies, code_digits = number(data.get("copies"), 9999), number(data.get("code"), 12)
    style = "separate" if data.get("style") == "separate" else "paper"
    design = data.get("design") if isinstance(data.get("design"), dict) else None
    built = None
    if gid == STARTER_GROUP:
        if tid not in STARTERS:
            core.dialog_msg(warn="Unknown template.")
            return
        try:
            built = _install_starter(tid, rep, style, code_digits, design)
        except questions_edit.EditError as e:
            shutil.rmtree(rep, ignore_errors=True)
            core.dialog_msg(warn=f"This paper can't be made: {e}")
            return
        if built:
            copies = built[0]  # the versions of a builder paper are its copies
        title = gallery.read_description(os.path.join(STARTERS_DIR, tid)).get("title", tid)
    else:
        if not any(t["gid"] == gid and t["id"] == tid for t in core.templates):
            core.dialog_msg(warn="Unknown template.")
            return
        tpath = core.template_path(f"{gid}/{tid}")
        with tarfile.open(tpath + ".tgz") as tarf:
            if not core.tar_extract_options_siblings(tarf, rep):
                core.dialog_msg(warn="This template can't be used: it holds no AMC project.")
                return
        title = next((t.get("title") for t in core.templates if t["gid"] == gid and t["id"] == tid), tid)
    core.create_project_dirs(rep)
    name, _ = core.set_project(name)
    core.amc_command("db", "upgrade")
    core.remove_uuid(name)
    if copies:
        core.change_option("nombre_copies", copies)
    if gid == STARTER_GROUP and not tid.endswith("-txt") and (gallery.needs_unicode_engine(branding().get("name", ""))
                                                               or (built and built[3])):
        core.change_option("moteur_latex_b", "xelatex")  # the starter's preamble follows the engine
    meta = {k: str(data.get(k) or "").strip()[:120] for k in META_FIELDS}
    _update_record(rep, lambda rec: rec.update({"meta": meta, "starter": tid if gid == STARTER_GROUP else None}))
    if built:
        _update_record(rep, lambda rec: rec.update({"builder": {"layout_digest": built[1], "detached": False}}))
        if built[2]:
            core.change_option("assoc_code", "student")  # the ID grid matches sheets to the class list
    add_activity(rep, f"Exam created from the template \"{title}\"")
    if core.main_source_file():
        source_history.note_current(rep, core.main_source_file(), by=_who(), what=f"Created from the template \"{title}\"")
    core.emit_msg("project-open", [name, True])


def _named_exam(data):
    """For dashboard actions on an exam other than the open one."""
    name = data.get("exam") if isinstance(data, dict) else None
    try:
        if not name or not core.project_exists(name):
            return None
    except ValueError:
        return None
    return core.project_dir(p=name)


def on_exam_meta(data):
    pdir = _named_exam(data)
    if not pdir:
        return
    meta = {k: str(data.get(k) or "").strip()[:120] for k in META_FIELDS}
    _update_record(pdir, lambda rec: rec.__setitem__("meta", meta))
    core.emit_msg("u-projects-list")
    core.emit_msg("ui-changed", "meta")


def on_exam_archive(data):
    pdir = _named_exam(data)
    if not pdir:
        return
    archived = bool(data.get("archived"))
    _update_record(pdir, lambda rec: rec.__setitem__("archived", archived))
    add_activity(pdir, "Archived" if archived else "Taken out of the archive")
    core.emit_msg("u-projects-list")


def exam_progress(pdir, name):
    """Where an exam stands, for its dashboard card: a state, the steps
    done, and the next thing to do."""
    rec = read_record(pdir)
    db = core.Amcdb(pdir)
    has = lambda m: _has_db(pdir, m)
    layout = _query(db.layout_npages, 0) if has("layout") else 0
    lock = exam_lock(pdir, rec)
    layout_ok = layout_confirmation(pdir, rec)
    scans = _query(db.capture_npages, 0) if has("capture") else 0
    problems = 0
    if scans:
        problems += _query(db.n_failed, 0)
        counts = _query(db.counts)
        problems += counts[1] if counts else 0
        try:
            low = float(core.get_option("seuil", p=name) or 0.15)
            high = float(core.get_option("seuil_up", p=name) or 1.0)
        except (TypeError, ValueError):
            low, high = 0.15, 1.0
        problems += sum(1 for p in _query(lambda: db.capture_pages(low, high), [])
                        if (p.get("sensitivity") or 0) >= SENSITIVITY_TO_CHECK
                        and not (p.get("timestamp_manual") or 0) > 0)
    marked = _query(db.n_graded_students, 0) if has("scoring") else 0
    has_list = bool(core.get_option("listeetudiants", p=name))
    unmatched = (sum(1 for s in _query(lambda: sheet_rows(pdir), []) if s["state"] == "unmatched")
                 if marked and has_list else 0)
    exports = _files(f"{pdir}/exports")
    annotated = _files(_annotated_dir(pdir))
    marks = rec.get("marks") or {}
    stale = bool(marks.get("inputs")) and marks["inputs"] != marking_inputs_for(pdir, name)
    built = os.path.isfile(f"{pdir}/DOC-sujet.pdf")
    order = [s for s in STEPS if s != "settings"]
    if not layout:
        nxt = ("papers", "Build the papers") if built else ("questions", "Write the questions")
    elif not lock and not layout_ok:
        nxt = ("papers", "Check the layout")
    elif not lock:
        nxt = ("print", "Print the papers")
    elif not scans:
        nxt = ("upload-scans", "Upload the scans")
    elif problems:
        nxt = ("check-scans", f"Check {problems} scan problem{'' if problems == 1 else 's'}")
    elif not marked or stale:
        nxt = ("mark", "Compute the marks" if not marked else "Recompute the marks")
    elif unmatched:
        nxt = ("match-students", f"Match {unmatched} sheet{'' if unmatched == 1 else 's'} to students")
    elif not exports:
        nxt = ("export-marks", "Export the marks")
    elif not annotated:
        nxt = ("annotate", "Annotate the sheets")
    else:
        nxt = (None, "Done")
    done = len(order) if nxt[0] is None else order.index(nxt[0])
    if rec.get("archived"):
        state = "archived"
    elif exports:
        state = "exported"
    elif marked:
        state = "marked"
    elif scans:
        state = "checking" if problems else "scanned"
    elif lock:
        state = "printed"
    elif layout_ok:
        state = "ready"
    elif layout:
        state = "tocheck"
    else:
        state = "draft"
    return {"state": state, "problems": problems, "done": done, "next": {"step": nxt[0], "text": nxt[1]},
            "meta": rec.get("meta") or {}, "archived": bool(rec.get("archived"))}


def marking_inputs_for(pdir, name):
    """marking_inputs() for an exam other than the open one."""
    saved = getattr(flask_g, "project_name", None)
    flask_g.project_name = name
    try:
        return marking_inputs(pdir)
    finally:
        flask_g.project_name = saved


# ---------------------------------------------------------------- guide
#
# The guide is Markdown in server/guide/en/, one page per step plus an
# overview, so teachers can improve it without touching code. Each step's
# "What to do here" list also feeds the box at the top of that step.

GUIDE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "guide", "en")
GUIDE_PAGES = ("index",) + tuple(s for s in STEPS if s != "settings")


@bp.route("/ui/api/guide")
def api_guide():
    core.headers_info()
    pages = []
    for pid in GUIDE_PAGES:
        try:
            with open(os.path.join(GUIDE_DIR, pid + ".md"), encoding="utf-8") as f:
                text = f.read()
        except OSError:
            continue
        m = re.match(r"#\s+(.+)", text)
        pages.append({"id": pid, "title": m.group(1).strip() if m else pid, "markdown": text})
    return jsonify(pages=pages)


def record_cloned(dest, source_name):
    """Called by upstream's project-clone: a copy starts with its own
    record (not locked by hand, not archived, its layout to check again,
    its own history). Scans in the copy still lock it, as in any exam."""
    def change(rec):
        for k in ("lock", "layout_ok", "archived", "activity"):
            rec.pop(k, None)
    _update_record(dest, change)
    try:
        os.unlink(os.path.join(dest, RECORD + ".lock"))
    except OSError:
        pass
    add_activity(dest, f"Copied from \"{source_name}\"")


# Events that name their exam in their data rather than working on the open one.
NO_PROJECT_EVENTS = {"ui-create-exam", "ui-exam-meta", "ui-exam-archive"}


def _socket_project():
    """The exam a socket message is about (its "proj" field), if it exists."""
    name = getattr(flask_g, "project_name", None)
    try:
        return name if name and core.project_exists(name) else None
    except ValueError:
        return None


def _guarded(event, handler):
    """Run a ui-* handler on an exam that exists. If it raises, the browser
    gets its screen back and a message, instead of "Working…" for ever."""
    @functools.wraps(handler)
    def wrapper(*args):
        if event not in NO_PROJECT_EVENTS and not _socket_project():
            core.dialog_msg(warn="This exam doesn't exist any more.")
            return None
        try:
            return handler(*args)
        except Exception:
            core.app.logger.exception(f"{event} failed")
            core.emit_msg("end-command")
            core.emit_msg("ui-scale", "done")
            core.dialog_msg(err="Something went wrong on the server. The server log has the details.")
            return None
    return wrapper


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
    "ui-annotate-style": on_annotate_style,
    "ui-scale-refresh": on_scale_refresh,
    "ui-question-edit": on_question_edit,
    "ui-create-exam": on_create_exam,
    "ui-exam-meta": on_exam_meta,
    "ui-exam-archive": on_exam_archive,
    "ui-history-restore": on_history_restore,
}
