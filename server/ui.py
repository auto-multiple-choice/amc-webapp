"""
The new interface (doc/ui-redesign-plan.md).

It replaces upstream's page at "/". Screens are drawn in the browser by
static/ui/app.js; actions go through the server's existing Socket.IO events
(doc-update, create-project-template, ...), so AMC's processing is
unchanged. This module adds the page routes and read-only JSON views of
data that upstream only renders as HTML fragments.

Kept in its own file so merging AMC team updates stays easy.
"""

import os
import sqlite3
import uuid

from flask import Blueprint, jsonify, make_response, render_template, request
from flask import g as flask_g

bp = Blueprint("ui", __name__)
core = None  # the main server module (amc.py), set by init_app()

STEPS = ("questions", "marking-scheme", "papers", "print", "upload-scans",
         "check-scans", "mark", "match-students", "export-marks", "annotate",
         "settings")
DOCUMENTS = ("sujet", "corrige", "catalog", "indiv-solution")
CONFIG_OPTIONS = ("moteur_latex_b", "nombre_copies")
# A scanned page whose boxes sit this close to the detection thresholds
# (AMC's "sensitivity", 0-10) is one a person should look at. Upstream's
# scans report highlights pages from the same level.
SENSITIVITY_TO_CHECK = 8


def init_app(app, server_module):
    global core
    core = server_module
    app.register_blueprint(bp)


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
