
from gevent import monkey
monkey.patch_all()

import io
import re
import os
import math
from pathlib import Path
import datetime
import time
import shutil
import tempfile
import stat
import sys
import logging
import cups
import io
import zipfile
import tarfile
import base64
import csv
import uuid
import subprocess
from filelock import FileLock
from urllib.parse import quote
from unidecode import unidecode
from lxml import etree
import threading

from PIL import Image

from db import Amcdb
from command import amc_command
from basic import *

import logging
from flask import Flask, Response, abort, render_template, request, send_file, make_response, url_for, send_from_directory, g as flask_g
from flask_socketio import SocketIO, emit
from flask_babel import Babel, _, ngettext
from flask_static_digest import FlaskStaticDigest
from flask_apscheduler import APScheduler

TEMPLATES_DIR = os.environ.get(
    'AMC_TEMPLATES_DIR',
    "/usr/share/auto-multiple-choice/models")

app = Flask(__name__)

AMCWEB_VERSION = None
try:
    import version
    AMCWEB_VERSION = version.APP_VERSION
except Exception as e:
    app.logger.error("App version not found: " + str(e))

app.config.from_mapping(
    SECRET_KEY='dev',
    FLASK_STATIC_DIGEST_BLACKLIST_FILTER = [ ".png", ".svg", ".css~", ".js~" ],
)

origins = None
if os.environ.get('ALLOWED_ORIGINS', ''):
    origins = os.environ['ALLOWED_ORIGINS'].split(',')
socketio_log = (os.environ.get('SOCKETIO_LOG', 'False').lower() == 'true')
socketio = SocketIO(app, async_mode='gevent',
                    cors_allowed_origins=origins,
                    logger=socketio_log, engineio_logger=socketio_log)
app.socketio = socketio

babel = Babel(app, locale_selector=get_locale)

flask_static_digest = FlaskStaticDigest()
flask_static_digest.init_app(app)

cli_command = None
if os.environ.get('FLASK_RUN_FROM_CLI', 'false') == 'true':
    if len(sys.argv) > 2:
        if sys.argv[0].endswith('flask'):
            cli_command = sys.argv[1]
if cli_command == 'run':
    cli_command = None

scheduler = APScheduler()
scheduler.api_enabled = (os.environ.get('FLASK_SCHEDULER_API', 'False').lower() == 'true')
scheduler.timezone = os.environ.get('TZ', 'Europe/Paris')
if not cli_command:
    scheduler.init_app(app)

log_level = os.environ.get('AMC_SERVER_LOGGING')
if log_level=='ERROR':
    app.logger.setLevel(logging.ERROR)
elif log_level=='WARNING':
    app.logger.setLevel(logging.WARNING)
elif log_level=='INFO':
    app.logger.setLevel(logging.INFO)
elif log_level=='DEBUG':
    app.logger.setLevel(logging.DEBUG)

proxy_level = os.environ.get('AMC_SERVER_PROXYLEVEL')
if proxy_level:
    cfg = {}
    for d in proxy_level.split(","):
        kv = d.split("=")
        if len(kv) == 2:
            cfg[kv[0]] = int(kv[1])

    app.logger.info(f"PROXY_LEVEL: {cfg}")

    from werkzeug.middleware.proxy_fix import ProxyFix

    app.wsgi_app = ProxyFix(app.wsgi_app, **cfg)

def to_bool(s):
    return not(str(s).lower() in ['0', 'false', 'no', 'none', ''])
    
app.isolate = to_bool(os.environ.get('AMC_ISOLATE',
                                     os.environ.get("AMC_USERHEADER")))
app.isolate_paths = {}

app.logger.info(f"Isolation: {app.isolate}")

temp_dir = tempfile.mkdtemp(prefix="amcapp")
app.temp_dir = temp_dir

app.logger.info(f"Temp dir: {temp_dir}")

def clean_temp():
    app.logger.debug(f"Clean temp job starting.")
    old_time = time.time() - int(os.environ.get('AMC_TEMP_TIMEOUT_H', 2)) * 3600
    old_dirs = []
    for root, dirs, files in os.walk(temp_dir, topdown=False):
        if os.path.getmtime(root) < old_time:
            old_dirs.append(root)
        for f in files:
            fn = os.path.join(root, f)
            if os.path.getmtime(fn) < old_time:
                app.logger.debug(f"Clean temp file: {fn}")
                try:
                    os.remove(fn)
                except Exception as e:
                    app.logger.error(f"Can't remove temp file {fn}: {e}")
        for f in dirs:
            fn = os.path.join(root, f)
            if os.path.getmtime(fn) < old_time and not os.listdir(fn):
                app.logger.debug(f"Clean temp dir: {fn}")
                try:
                    os.rmdir(fn)
                except Exception as e:
                    app.logger.error(f"Can't remove temp dir {fn}: {e}")
    for fn in old_dirs:
        if not os.listdir(fn):
            app.logger.debug(f"Clean temp dir: {fn}")
            try:
                os.rmdir(fn)
            except Exception as e:
                app.logger.error(f"Can't remove temp dir {fn}: {e}")
    app.logger.debug(f"Clean temp job ended.")
        

@scheduler.task('cron', id='clean_temp_job',
                hour=os.environ.get('AMC_TEMP_CLEAN_H', '3'))
def clean_temp_job():
    clean_temp()

if not cli_command:
    scheduler.start()

@app.route('/ace/<path:filename>')
def custom_static(filename):
    return send_from_directory('ace', filename)

def set_user(fake_user):
    header_name = os.environ.get("AMC_USERHEADER")
    if not header_name:
        # single-user mode
        flask_g._is_admin = False
        flask_g._user = None
        flask_g._real_user = None

    flask_g._real_user = request.headers.get(header_name)
    if flask_g._real_user and flask_g._real_user.startswith(("_", ".")):
        # "_amcweb", "_all", "_branding"... are the server's own folders under
        # MC-Projects: an account of that name would own them.
        app.logger.error(f"Refused account name: {flask_g._real_user!r}")
        abort(403)
    
    admins = os.environ.get("AMC_ADMINS", "").split(",")
    is_admin = bool(flask_g._real_user) and (flask_g._real_user in admins)

    flask_g._is_admin = is_admin
    
    if is_admin:
        flask_g._user = fake_user or flask_g._real_user
    else:
        flask_g._user = flask_g._real_user

def socketio_name(name):

    def socketio_name_(func):

        @socketio.on(name)
        def wrapper_ion(message):
            flask_g.project_name = message.get('proj')
            flask_g._sid = message.get('sid')
            set_user(message.get('fake_user'))
            a = message.get('args')
            current_app.logger.debug(f"⬇️  msg {name} from {flask_g._sid}: {message}")
            if a is not None:
                func(a)
            else:
                func()

        return wrapper_ion

    return socketio_name_

def amc_headers():
    return { k: v for k, v in request.headers.items()
             if k.lower().startswith('amc-') }

def headers_info():
    log = f"🏷️  {amc_headers()}"
    flask_g._sid = request.headers.get('AMC-sid')
    pn = request.headers.get('AMC-project')
    if pn:
        flask_g.project_name = pn
    if request.values.get('user'):
        log += f" 👤 {request.values.get('user')}"
    set_user(request.headers.get('AMC-fake-user')
             or request.values.get('user'))
    log += f" U={flask_g._user} R={flask_g._real_user}"
    if flask_g._is_admin:
        log += " 👑"
    app.logger.debug(log)

def get_db(modules=()):
    pdir = project_dir()
    if pdir:
        db = getattr(flask_g, '_database', None)
        if db and db.project_dir != pdir:
            db = None
        if not db:
            db = Amcdb(project_dir(), modules)
            flask_g._database = db
    else:
        db = None
    return db

def warn_dialog(**kwargs):
    return render_template(
        "warn_dialog.html",
        err=kwargs.get('err', ''), warn=kwargs.get('warn', ''), info=kwargs.get('info', ''),
        cancel_btn=kwargs.get('cancel_btn', False),
        cancel_onclick=kwargs.get('cancel_onclick', 'warn_ok();'),
        cancel_txt=kwargs.get('cancel_txt', _('dialog.cancel')),
        cancel_class=kwargs.get('cancel_class', 'neutral'),
        ok_onclick=kwargs.get('ok_onclick', 'warn_ok();'),
        ok_txt=kwargs.get('ok_txt', _('dialog.ok')),
        ok_class=kwargs.get('ok_class', 'neutral'),
        )

def dialog_msg(**kwargs):
    emit_msg('dialog', warn_dialog(**kwargs))

@socketio_name("inactivity")
def dialog_disconnect():
    emit_msg('dialog-disconnect', warn_dialog(
        warn=_('inactivity.disconnect'),
        ok_onclick='location.reload();',
        ok_txt=_('inactivity.reload'),
    ))

@socketio_name("sleep")
def io_sleep(seconds):
    amc_command("/usr/bin/sleep", str(seconds))
    dialog_msg(info="Sleep ended.")
    
@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

# The new interface answers at "/" (ui.py); upstream's page is no longer served.
def index():
    resp = make_response(render_template(
        'index.html',
        username=username(ifnone=""),
        app_version=AMCWEB_VERSION,
    ))
    if not valid_session(request.cookies.get('amcsession')):
        session = str(uuid.uuid4())
        app.logger.info(f"New session: {session}")
        resp.set_cookie('amcsession', session)
    return resp

@app.route('/version')
def version():
    amc_version = subprocess.check_output(
        ["auto-multiple-choice", "version"], shell=False
    ).decode("utf-8").strip()

    return render_template('version.html',
                           amc_version=amc_version,
                           amcweb_version=AMCWEB_VERSION)

@app.route('/tex/automultiplechoice.sty')
def request_sty_file():
    sty_path = subprocess.check_output(
        ["kpsewhich", "automultiplechoice.sty"]
    ).decode("utf-8").strip()
    return send_file(sty_path, as_attachment=True, mimetype='text/x-tex')

@app.route('/public/status.json')
def public_status():
    return { "running": True }

@app.route('/public/<uuids>/marks.csv')
def marks_csv(uuids):
    csv_content = "id,mark,total\n"

    # Each uuid means a walk over every project folder, and this address
    # needs no sign-in: keep the list short and the ids plausible.
    uuid_list = uuids.split(":")
    if len(uuid_list) > 20 or not all(re.fullmatch(r'[0-9A-Za-z-]{1,64}', u) for u in uuid_list):
        abort(404)

    for uuid in uuid_list:
        pdirs = find_projects_by_uuid(uuid, check_option="app_public_marks")
        if len(pdirs) == 0:
            app.logger.warning(f"Project not found: UUID={uuid}")
            abort(404)
        elif len(pdirs) > 1:
            app.logger.error(f"Multiple projects with UUID={uuid}")
            for d in pdirs:
                app.logger.error("* " + d)
            abort(500)

        app.logger.debug(f"🔍 {uuid} → {pdirs[0]}")
        db = Amcdb(pdirs[0])
        for m in db.associated_marks():
            csv_content += f"\"{m[0]}\",{m[1]},{m[2]}\n"

    return Response(csv_content, mimetype='text/csv')
        

@socketio_name('is-online')
def io_is_online(*client_version):
    if client_version:
        client_version = client_version[0]
    else:
        client_version = ""
    app.logger.debug(f"📶 {flask_g._sid} (u={flask_g._real_user}) is online from {request.remote_addr}, version '{client_version}'")
    if client_version and AMCWEB_VERSION and (client_version != AMCWEB_VERSION):
        emit_msg("reload")

@app.route('/tab/<tab_name>')
def tab(tab_name):
    headers_info()
    vs = {}
    if tab_name == "scans":
        db = get_db()
        vs["nmaxpages"] = db.npages_max()
    if tab_name == "grading":
        u = project_uuid()
        vs["public_marks_link"] = f"{request.root_url}public/{u}/marks.csv"
    if tab_name == "config":
        vs["latex_engines"] = None
        engines = os.environ.get('AMC_LATEX_ENGINES')
        if engines:
            vs["latex_engines"] = []
            current_engine = get_option("moteur_latex_b")
            for e in engines.split(","):
                selected = (current_engine == e)
                if selected:
                    current_engine = None
                vs["latex_engines"].append({ "code": e, "selected": True,
                                             "available": True})
            if current_engine is not None:
                vs["latex_engines"].insert(0,
                    { "code": current_engine, "selected": True, "available": False })
        vs["package_options"] = get_option("global:add_package_options")
    return render_template(f"tab_{tab_name}.html", **vs)

def serve_pil_image(pil_img):
    img_io = io.BytesIO()
    pil_img.save(img_io, 'JPEG', quality=75)
    img_io.seek(0)
    return send_file(img_io, mimetype='image/jpeg')

def fs_path_to_local(path, with_fs=True, current_project=False):
    if with_fs:
        path = lstrip_text(path, "/fs/", "")

    if current_project:
        base = project_dir()
    else:
        base = projects_dir()

    if not base:
        return None

    base = os.path.realpath(base)
    path = os.path.realpath(os.path.join(base, path))
    if path == base or path.startswith(base + "/"):
        amcweb = os.path.realpath(os.path.join(projects_dir(root=True), ui.vcs.AMCWEB_DIR))
        if path == amcweb or path.startswith(amcweb + "/"):
            app.logger.error(f"The server's own folder: {path}")
            return None  # history, trash and audit log (single-user mode: inside the projects folder)
        return path
    else:
        app.logger.error(f"Outside base [{base}]: {path}")
        return None

@app.route('/fs/<path:path>', methods=['GET', 'POST'])
def fs_file(path):
    headers_info()
    path = fs_path_to_local(path, with_fs=False)

    if path is None:
        return { "error": "Path not found" }
    
    if request.method == 'POST':
        app.logger.info(f"Uploaded file: {path}")
        if 'file' not in request.files:
            return { "error": "No file part" }
        f = request.files['file']
        if f:
            if refusal := ui.write_refusal(path, f):
                return { "error": refusal }  # printed exam (ui.py)
            ui.store_upload(path, f, "Saved")  # history (ui.py)
            return { "ok": True }
    else:
        app.logger.info(f"Send file: {path}")
        attach = bool(int(request.args.get('attach', "1")))
        ext = path.split(".")[-1].lower()
        if os.path.isfile(path):
            if ext in ('tiff', 'tif') and not attach:
                return serve_pil_image(Image.open(path))
            else:
                mtype = None
                if path.lower().endswith( (".log", ".tex", ".py", ".pl") ):
                    mtype = "text/plain"
                resp = send_file(path, mimetype=mtype,
                                 as_attachment=attach)
                if not attach and ext not in ('pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp') \
                   and mtype != "text/plain":
                    # An HTML or SVG file from an imported project would
                    # otherwise run its scripts as this site.
                    resp.headers['Content-Security-Policy'] = 'sandbox'
                    resp.headers['X-Content-Type-Options'] = 'nosniff'
                return resp
        elif os.path.isdir(path):
            return send_dir_as_zip(path,
                                   filename=request.args.get('filename'),
                                   exclude=request.args.get('exclude'))
        else:
            return { "error": "Unknown path type" }

@app.route('/projects_list.html')
def u_projects_list():
    headers_info()
    all_users = bool(request.args.get('all')) and flask_g._is_admin
    if all_users:
        projects = all_projects_list()
    else:
        projects = projects_list()
        if projects:
            projects = [ (None, projects) ]
    return render_template("projects_list.html",
                           projects=projects)

def u_open_project(name, to_reload=True):
    name, change = set_project(name)
    if change and name:
        options_file, empty = option_file_from_name("")
        lock = FileLock(options_file + ".lock")
        with lock:
            amc_command("db", "upgrade")
    emit_msg("project-open", [name, to_reload])

@socketio_name('request-project')
def io_request_project(data):
    name, to_reload = data
    u_open_project(name, to_reload)

@socketio_name('source-info')
def io_source_info():
    db = get_db()
    if db:
        emit_msg("defects", db.defects_class())
        emit_msg("ncopies", str(ncopies()))

@socketio_name('adapt-menu')
def io_adapt_menu_():
    io_adapt_menu()

def io_adapt_menu():
    if flask_g.project_name:
        menus = { "main": True, "source": True, "config": True }
        if get_option("global:activate_ahead"):
            menus['scans'] = True
            menus['grading'] = True
        else:
            db = get_db()
            if db.layout_npages():
                menus["scans"] = True
                if db.capture_npages():
                    menus["grading"] = True
    else:
        menus = { "main": True }

    if flask_g._is_admin:
        if flask_g._user != flask_g._real_user:
            menus["admin-back"] = True
        else:
            menus["admin-search"] = True
        
    emit_msg("menu", menus)

def copy_files_progress(src_folder, dst_folder):
    nfiles = 0
    for root, dirs, files in os.walk(src_folder):
        nfiles += len(files)
    emit_msg("p", 0)
    os.mkdir(dst_folder)
    n = 0
    for root, dirs, files in os.walk(src_folder):
        dirs[:] = [d for d in dirs if not ui.copy_skipped(d)]  # dot-folders and scratch folders stay out (ui.py)
        dst_root = lstrip_text(root, src_folder, dst_folder)
        for d in dirs:
            os.mkdir(f"{dst_root}/{d}")
        for f in files:
            try:
                shutil.copy2(f"{root}/{f}", f"{dst_root}/{f}",
                             follow_symlinks=False)
                n += 1
            except:
                pass
            emit_msg("p", n/nfiles)
    return n, nfiles

@socketio_name('project-clone')
def io_project_clone(name):
    clone_name = project_clone_name(name)
    source = project_dir(p=name)
    dest = project_dir(p=clone_name)
    emit_msg("t", _('t.cloning'))
    emit_msg("begin-command")
    n, ntotal = copy_files_progress(source, dest)
    remove_uuid(clone_name)
    ui.record_cloned(dest, name)  # its own lock, archive and history (ui.py)
    emit_msg("end-command")
    emit_msg("u-projects-list")
    if n==ntotal:
        dialog_msg(info = _('msg.cloned', name=clone_name))
    else:
        dialog_msg(
            err = _('msg.clone.err', name=clone_name, n=n, ntotal=ntotal))

@socketio_name('project-delete')
def io_project_clone(name):
    rep = project_dir(p=name)
    try:
        ui.trash_exam(rep)  # kept in the trash for 30 days, with its history (ui.py)
    except Exception:
        app.logger.exception(f"Can't move {rep} to the trash")
        dialog_msg(err="The exam couldn't be moved to the trash, so it wasn't deleted. The server log has the details.")
        emit_msg("u-projects-list")
        return
    if flask_g.project_name == name:
        set_project("")
        emit_msg("project-open", ["", False])
    else:
        emit_msg("u-projects-list")

@socketio_name('project-rename')
def io_project_rename(data):
    old, new = data
    if problem := project_name_problem(new):
        dialog_msg(err=problem)
        emit_msg("u-projects-list")
        return

    if new == old:
        app.logger.info(f"Project {old} not renamed")
        emit_msg("u-projects-list")
        return

    src = project_dir(p=old)
    dst = project_dir(p=new)
    if(os.path.exists(dst)):
        dialog_msg(err = _('msg.rename.exists', old=old, new=new))
    else:
        app.logger.info(f'Project "{old}" renamed to "{new}"')
        os.rename(src, dst)
        ui.exam_renamed(dst, old, new)  # history and audit log (ui.py)

        if old == flask_g.project_name:
            new, chg = set_project(new)
            emit_msg("project-open", [new, True])
        else:
            emit_msg("u-projects-list")

def template_group_info(g):
    f = f"{TEMPLATES_DIR}/{g}/directory.xml"
    if os.path.isfile(f):
        desc = etree.parse(f)
        info = { "id": g }
        for k in ("title", "text"):
            info[k] = first_or_none(desc.xpath(f"/description/{k}/text()"))
        return info
    else:
        return { "id": g, "title": g, "text": "" }

def template_info(gid, tid, filename):
    info = {}
    desc = None
    if os.path.isdir(filename):
        if os.path.isfile(f"{filename}/description.xml"):
            desc = etree.parse(f"{filename}/description.xml")
    else:
        try:
            t = tarfile.open(filename)
        except Exception as e:
            t = None
            app.logger.error(f"Can't open project file {filename}: " + str(e))

        if t:
            for m in t.getmembers():
                if m.name.endswith("/description.xml"):
                    desc = etree.parse(t.extractfile(m))

    if desc:
        for k in ("title", "text"):
            i = first_or_none(desc.xpath(f"/description/{k}/text()"))
            if i:
                info[k] = i
                
    if info:
        info["id"] = tid
        info["gid"] = gid
        return info
    else:
        return None

template_groups = []
templates = []
for g in sorted(os.listdir(TEMPLATES_DIR)):
    rep = f"{TEMPLATES_DIR}/{g}"
    if os.path.isdir(rep):
        template_groups.append(template_group_info(g))
        for t in sorted(os.listdir(rep)):
            if os.path.isdir(t) or t.endswith(".tgz"):
                tid = t.replace(".tgz","")
                info = template_info(g, tid, f"{rep}/{t}")
                if info:
                    templates.append(info)

app.logger.info(f"Templates: {len(templates)}, from {len(template_groups)} groups")
                    
@app.route('/project_new.html')
def u_project_new():
    headers_info()
    return render_template(
        "project_new.html",
        groups=template_groups, templates=templates
    )

def create_project_dirs(rep):
    for d in ("", "/data", "/exports", "/scans", "/anonymous",
              "/cr", "/cr/corrections", "/cr/corrections/jpg", "/cr/corrections/pdf",
              "/cr/diagnostic"):
        if not os.path.exists(rep + d):
            os.mkdir(rep + d)

def check_unused_name(name, warn=True):
    if problem := project_name_problem(name):
        app.logger.warning(f"Refused project name {name!r}: {problem}")
        if warn:
            dialog_msg(err=problem)
        return None
    rep = project_dir(p=name)
    if os.path.exists(rep):
        app.logger.warn(f"Project already exists: {rep}")
        if warn:
            dialog_msg(err = _('msg.create.exists', name=name))
        return None
    else:
        return rep

def create_options_file(rep, source_file, filt=None):
    if filt is None:
        filt = "plain"
        if re.match(r'.*\.(tex|latex)$', source_file, re.IGNORECASE):
            filt = "latex"
    with open(f"{rep}/options.xml", "w") as options_file:
            options_file.write(
                """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<project>
  <texsrc>%PROJET/""" + source_file + """</texsrc>
  <filter>""" + filt + """</filter>
</project>
"""
            )

def remove_uuid(project_name=None):
    change_option("uuid", "", p=project_name)

def project_uuid(project_name=None):
    u = get_option("uuid", p=project_name)
    if not u:
        u = str(uuid.uuid4())
        change_option("uuid", u, p=project_name)
    return u

def check_uuid(options_file, u, check_option=None):
    o = [ "uuid" ]
    if check_option:
        o.append(check_option)
    v = get_options_from_xml(options_file, o)
    ok = (v[ "uuid" ] == u)
    if check_option:
        ok = ok and (
            v.get(check_option)
            and v[check_option].lower() not in ("0", "false"))
    return ok

def find_projects_by_uuid(u, check_option=None):

    if not u:
        return []
    
    psdir = projects_dir(root=True)
    ok_dirs = []
    for root, dirs, files in os.walk(psdir):
        for f in files:
            if f == "options.xml":
                if check_uuid(os.path.join(root, f), u,
                              check_option=check_option):
                    ok_dirs.append(root)
    return ok_dirs 
            
@socketio_name('create-project-empty')
def io_create_project_empty(data):
    name, stype = data
    rep = check_unused_name(name)
    if rep:
        app.logger.info(f"Create empty project \"{name}\" with source {stype}")
        create_project_dirs(rep)
        if stype == "plain":
            f = "source.txt"
        else:
            f = "source.tex"
        with open(f"{rep}/{f}", "w") as source_file:
            source_file.write("\n")
        create_options_file(rep, f, filt=stype)
        name, chg = set_project(name)
        amc_command("db", "upgrade")
        remove_uuid(name)
        emit_msg("project-open", [name, True])

def info_remove_root(m, root, dest=None, skip_special=True):
    flask_g.files_n += 1
    n = flask_g.files_n
    total = flask_g.files_total
    emit_msg("p", n/total)
    if skip_special and m.type not in (tarfile.REGTYPE, tarfile.AREGTYPE,
                                       tarfile.DIRTYPE):
        app.logger.info(f"Skip from Tar file: {m.name}")
        return None
    if m.type in (tarfile.SYMTYPE, tarfile.CHRTYPE, tarfile.BLKTYPE,
                  tarfile.FIFOTYPE, tarfile.GNUTYPE_LONGLINK):
        return None
    if m.name.startswith(root):
        m.name = m.name.replace(root, "", 1)
        if ui.archive_skipped(m.name):  # dot-folders (a planted .git) stay out (ui.py)
            return None
        m.uid = None
        m.gid = None
        m.uname = None
        m.gname = None
        # The archive comes from the browser: a member named "../x", an
        # absolute name or a link pointing elsewhere would land outside the
        # project folder (another user's project, in multi-user mode).
        # Python's "data" filter refuses exactly those.
        if dest is not None:
            try:
                return tarfile.data_filter(m, dest)
            except tarfile.FilterError as e:
                app.logger.warning(f"Skip from Tar file: {m.name} ({e})")
                return None
        return m
    else:
        return None
        
def tar_extract_options_siblings(tarf, dest, skip_special=True):
    emit_msg("t", _('t.options'))
    root = None
    total = 0
    for m in tarf.getmembers():
        total += 1
        app.logger.debug(f"tar> {m.name}")
        o = re.match(r'^(.*/|)options.xml$', m.name)
        if o:
            root = o[1]
            app.logger.debug("found root: " + root)
    flask_g.files_total = total
    flask_g.files_n = 0
    if root is not None:
        emit_msg("t", _('t.extract'))
        emit_msg("p", 0)
        if not os.path.exists(dest):
            os.mkdir(dest)
        tarf.extractall(
            dest, filter=lambda m,p: info_remove_root(m, root, dest=p,
                                                      skip_special=skip_special))
        return True
    else:
        app.logger.error(f"Can't find options.xml in archive")
        return False

def zip_extract_options_siblings(zipf, dest, skip_special=True):
    emit_msg("t", _('t.options'))
    root = None
    total = 0
    for m in zipf.infolist():
        total += 1
        app.logger.debug(f"zip> {m.filename}")
        o = re.match(r'^(.*/|)options.xml$', m.filename)
        if o:
            root = o[1]
            app.logger.debug("found root: " + root)
    if root is not None:
        emit_msg("t", _('t.extract'))
        emit_msg("p", 0)
        if not os.path.exists(dest):
            os.mkdir(dest)
        n = 0
        for m in zipf.infolist():
            n += 1
            if m.filename.startswith(root):
                m.filename = m.filename.replace(root, "", 1)
                if m.filename != "":
                    skip = ui.archive_skipped(m.filename)  # dot-folders (a planted .git) stay out (ui.py)
                    if skip_special and not skip:
                        mode = m.external_attr >> 16
                        reg = stat.S_ISDIR(mode) or stat.S_ISREG(mode)
                        skip = not reg
                    if skip:
                        app.logger.info(f"Skip from Zip file: {m.filename}")
                    else:
                        zipf.extract(m, dest)
            emit_msg("p", n/total)
        return True
    else:
        return False

def project_install_from_dir(source_dir, dest):
    options_found = False
    finished = False
    while not finished:
        finished = True
        if os.path.isfile(f"{source_dir}/options.xml"):
            options_found = True
        else:
            x = os.listdir(source_dir)
            if len(x)==1:
                d = f"{source_dir}/{x[0]}"
                if os.path.isdir(d):
                    source_dir = d
                    finished = False

    if options_found:
        shutil.copytree(source_dir, dest)
        return True
    else:
        app.logger.error(f"Can't find options.xml in directory {source_dir}")
        return False
    
def template_path(template):
    # The template id ("group/name") comes from the browser: keep it inside
    # TEMPLATES_DIR, or it could name any directory the server can read,
    # such as another user's project, and copy it into the new project.
    base = os.path.normpath(os.path.abspath(TEMPLATES_DIR))
    tpath = os.path.normpath(os.path.join(base, str(template)))
    if not tpath.startswith(base + os.sep):
        raise ValueError(f"Invalid template: {template!r}")
    return tpath

@socketio_name('create-project-template')
def io_create_project_template(data):
    name, template = data
    rep = check_unused_name(name)
    if rep:
        app.logger.info(f"Create project \"{name}\" from template {template}")
        tpath = template_path(template)
        if os.path.isfile(tpath + ".tgz"):
            tarf = tarfile.open(tpath + ".tgz")
            if not tar_extract_options_siblings(tarf, rep):
                return
        elif os.path.isdir(tpath):
            if not project_install_from_dir(tpath, rep):
                return
        create_project_dirs(rep)
        name, chg = set_project(name)
        amc_command("db", "upgrade")
        remove_uuid(name)
        emit_msg("project-open", [name, True])

def create_from_source_file(name, rep, f, fn):
    create_project_dirs(rep)
    f.save(f"{rep}/{fn}")
    create_options_file(rep, fn)
    emit_msg("end-command")
    u_open_project(name)
    return { "ok": True }

def create_from_archive(name, rep, f):
    emit_msg("t", _('t.archive.save'))
    handle, fn = tempfile.mkstemp()
    f.save(fn)
    ok = False
    skip = to_bool(os.environ.get('AMC_ARCHIVE_SKIP_SPECIAL', 1))
    if zipfile.is_zipfile(fn):
        zipf = zipfile.ZipFile(fn)
        ok = zip_extract_options_siblings(zipf, rep,
                                          skip_special=skip)
    elif tarfile.is_tarfile(fn):
        tarf = tarfile.open(fn)
        ok = tar_extract_options_siblings(tarf, rep,
                                          skip_special=skip)
    else:
        app.logger.error("Archive type unknown")
    if not ok:
        emit_msg("end-command")
        return { "error": f"Archive {f.filename} doesn't contain a valid AMC project" }
    create_project_dirs(rep)
    remove_uuid(name)
    ui.exam_imported(rep)  # the history in a "Download with history" zip (ui.py)
    emit_msg("end-command")
    u_open_project(name)
    return { "ok": ok }

def upload_file_parts(f):
    simple_filename = re.sub(r'[<>\\ /*?$@&^#]', '_', f.filename)
    ext = ""
    if r := re.match(r'.*\.([a-z0-9]{1,5})$', simple_filename):
        ext = r[1].lower()
    return simple_filename, ext

def next_filename(f):
    ext = ''
    i = 0
    if r := re.match(r'(.*)(\.[a-z0-9]{1,5})$', f):
        f = r[1]
        ext = r[2].lower()
    if r := re.match(r'(.+)_([0-9]+)$', f):
        f = r[1]
        i = int(r[2])
    i += 1
    return f"{f}_{i:04}{ext}"

def int_prefix(s, sep="_"):
    if r := re.match(r'([0-9]+)' + sep, s):
        return int(r[1])
    else:
        return 0

@app.route('/upload/<dest>', methods=['POST'])
def file_upload(dest):
    headers_info()
    
    request_files = request.files.getlist("file") + ui.staged_files()  # big uploads (ui.py)
    if not request_files:
        return { 'error': 'Empty upload' }

    if request_files[0].filename == '':
        return { 'error': 'Empty file' }

    app.logger.info(f"Upload to {dest}: {len(request_files)} file(s)")

    if dest=="create":
        name = request.form['name']
        rep = check_unused_name(name, warn=False)
        if rep:
            emit_msg("p", 0)
            fn, ext = upload_file_parts(request_files[0])
            if re.match(r'.*\.(tgz|tar\.gz|tar|zip)', fn, re.IGNORECASE):
                return create_from_archive(name, rep, request_files[0])
            elif re.match(r'.*\.(tex|latex|txt)', fn, re.IGNORECASE):
                return create_from_source_file(name, rep, request_files[0], fn)
            else:
                emit_msg("end-command")
                return { "error": f"File {fn} can't be used to create a project" }
        else:
            emit_msg("end-command")
            return { "error": f"Can't create project {name}: already used" }

    elif dest=="project" or dest=="source":
        rep = project_dir();
        emit_msg("end-command");
        fn, ext = upload_file_parts(request_files[0])
        if rep and (refusal := ui.upload_refusal(request_files[0], dest)):
            return { "error": refusal }  # printed exam (ui.py)
        if rep:
            ui.store_upload(f"{rep}/{fn}", request_files[0], "Saved in the editor" if dest=="source" else "Uploaded")  # history (ui.py)
            if dest=="source":
                emit_msg("source-saved")
            return { "ok": True }
        else:
            return { "error": f"Project unknown" }

    elif dest=="students":
        rep = project_dir();
        emit_msg("end-command");
        fn, ext = upload_file_parts(request_files[0])
        if rep and (refusal := ui.class_list_refusal(fn)):
            return { "error": refusal }  # not a class list (ui.py)
        if rep:
            request_files[0].save(f"{rep}/{fn}");
            set_students_list("%PROJET/" + fn)
            return { "ok": True }
        else:
            return { "error": f"Project unknown" }

    elif dest=="scans":
        project_name = request.form['project_name']

        # use the scans subdirectory to store uploaded files
        rep = amc_user_tmp("scans")
        local_paths = []
        for f in request_files:
            fn, ext = upload_file_parts(f)
            path = f"{rep}/{fn}"
            while os.path.exists(path):
                path = next_filename(path)
            f.save(path)
            local_paths.append(path)

        # create a file to list paths of the uploaded files
        n, list_path = tempfile.mkstemp(prefix="list-", dir=rep)
        with open(list_path, "w") as f:
            for p in local_paths:
                print(p, file=f)

        return { 'ok': True,
                 'list': lstrip_text(list_path, rep, "%SCANS") }

    else:
        emit_msg("end-command")
        return { "error": f"Unknown upload dest: {dest}" }

@socketio_name('data-capture')
def io_data_capture(list_path):
    rep = amc_user_tmp("scans")
    list_path = os.path.normpath(lstrip_text(str(list_path), "%SCANS", rep))
    if not list_path.startswith(rep + "/"):
        # The list names the files AMC reads: only the ones this session uploaded.
        app.logger.error(f"Scan list outside the session's folder: {list_path}")
        return
    db = get_db()
    orientation = db.orientation()
    lock_scans_mode()
    emit_msg("begin-command")

    messages = {}
    variables = {}
    
    if int(get_option("pdfform")):
        amc_command(
            "read-pdfform",
            "progression-id", "PDF",
            "--list", list_path,
            messages=messages, variables=variables)
    
    emit_msg("t", _('t.scans.extract'))
    amc_command(
        "getimages",
        "--list", list_path,
        "--orientation", orientation,
        "--copy-to", project_dir() + "/scans",
        "--progression-id", "GETI",
        messages=messages, variables=variables
    )
    emit_msg("t", _('t.automatic'))
    amc_command(
        "analyse",
        "--liste-fichiers", list_path,
        "--unlink-on-global-err",
        "--progression-id", "SCAN",
        "--progression", "1",
        messages=messages, variables=variables
    )
    emit_msg("end-command")
    emit_msg("scans-report")
    show_messages(messages)
    io_adapt_menu()
    
@socketio_name('ncopies')
def io_ncopies(n):
    if ui.refuse_if_locked("The number of copies can't change."):
        return
    n = re.sub(r'[^0-9]+', '', str(n))
    if n:
        n = int(n)
    else:
        n = 0
    change_option("nombre_copies", n)

@socketio_name('source-code')
def io_source_code(filename):
    if not filename:
        filename = main_source_file()
    if not filename:
        filename = default_source_file()
        change_option("texsrc", filename)

    mode = "plain_text"
    if re.match(r'.*\.(tex|latex)$', filename, re.IGNORECASE):
        mode = "latex"
    elif re.match(r'.*\.(yml|yaml)$', filename, re.IGNORECASE):
        mode = "yaml"
    elif re.match(r'.*\.(csv)$', filename, re.IGNORECASE):
        mode = "csv"
    elif re.match(r'.*\.(txt)$', filename, re.IGNORECASE):
        mode = "amc_txt"
    elif re.match(r'.*\.(pl)$', filename, re.IGNORECASE):
        mode = "perl"
    elif re.match(r'.*\.(py)$', filename, re.IGNORECASE):
        mode = "python"

    url = f"/fs/{flask_g.project_name}/{filename}"

    emit_msg("source-name", [filename, mode, url])

def file_level(base, main_source, f):
    ff = f"{base}/{f}"
    if os.path.isdir(ff):
        return 2
    if f == main_source:
        return -1
    if re.match(r'.*\.(tex|yaml|yml|csv|txt|py|pl)$', f, re.IGNORECASE):
        return 0
    else:
        return 1

@socketio_name('project-config')
def io_project_config():
    emit_msg("selected-config",
         get_options(
             ["moteur_latex_b",
              "note_null", "note_max", "note_grain", "note_arrondi",
              "verdict", "annote_position", "multiple_copies",
              "global:force_textpos",
              "global:bw_threshold",
              "global:tolerance_marque_inf", "global:tolerance_marque_sup",
              "global:try_three", "global:ascii_filenames",
              "global:view_histogram", "global:activate_ahead",
              "global:csv_name_headers", "global:csv_surname_headers"
             ]
         ))

def context_args(args = None):
    if args is None:
        args = dict()
    if flask_g._user != flask_g._real_user:
        args["user"] = flask_g._user
    s = "?" + "&".join([ f"{k}={v}"
                         for k,v in args.items() ])
    return s

@socketio.on('alert-warn')
def io_alert_warn(msg):
    dialog_msg(warn=_(msg))

@socketio.on('confirm')
def io_confirm(data):
    msg, msg_args, ok_type, cancel_type, command = data
    okmsg, ok_class = ok_type.split(":")
    okmsg = 'btn.' + okmsg
    cancelmsg, cancel_class = cancel_type.split(":")
    cancelmsg = 'btn.' + cancelmsg
    dialog_msg(warn=_(msg).format(*msg_args),
               ok_txt=_(okmsg), ok_class=ok_class,
               cancel_btn=True,
               cancel_txt=_(cancelmsg), cancel_class=cancel_class,
               ok_onclick='warn_ok();' + command)

@app.route('/files_list.html')
def u_files_list():
    headers_info()
    all_files = request.args.get("all")
    base = project_dir()
    main_source = main_source_file()
    files = [ (file_level(base, main_source, f), f)
              for f in os.listdir(base) ]
    if not all_files:
        files = [ x for x in files if x[0]<=0 ]

    return render_template(
        "files_list.html",
        files=sorted(files),
        suffix=context_args(),
        base_url=f"/fs/{flask_g.project_name}")

@app.route('/defects_list.html')
def u_defects_list():
    headers_info()
    db = get_db()
    return render_template(
        "defects_list.html",
        defects = db.defects())

@socketio_name("project-delete-file")
def io_project_delete_file(data):
    filename, all_files = data
    if ui.delete_refused(filename):
        return
    path = fs_path_to_local(filename, with_fs=False, current_project=True)
    if path:
        try:
            ui.delete_file(path)  # source files go into the history (ui.py)
        except Exception as e:
            app.logger.error("Can't delete project file: " + str(e))
            return
        emit_msg("project-files-list")
    else:
        app.logger.error("Can't delete project file: unknown project or wrong path")

@app.route('/document/<doc_type>', methods=['POST'])
def u_document_type(doc_type):
    headers_info()
    url = request.json.get('url')
    if url:
        opts = {"attach": "0"}
        path = fs_path_to_local(url)
        if path is not None and os.path.exists(path):
            opts["t"] = str(os.path.getmtime(path))
        else:
            app.logger.warning(f"Document not found: {path}")
        url = url + context_args(opts)
    return render_template(f"document_{doc_type}.html",
                           url=url)

@socketio_name("doc-type")
def io_doc_type_(t):
    io_doc_type(t)

def io_doc_type(t):
    if not t:
        emit_msg("document-content",
                      [False, False, "choose", None])

    can_print = False
    danger = False
    url = None
    template_name = "missing"
        
    if t=="calage":
        db = get_db(modules=("layout",))
        if db.layout_npages() > 0 :
            template_name = "calage"

    else:
        doc = "/DOC-" + t + ".pdf"
        filename = project_dir() + doc

        if os.path.isfile(filename):
            if t == "sujet":
                can_print = True
                db = get_db()
                if db.capture_npages() or db.print_timestamp():
                    danger = True
                
            url = "/fs/" + flask_g.project_name + doc
            template_name = "content"

    emit_msg("document-content", [can_print, danger,
                                       template_name, url])

def select_messages(messages, after=None):
    if not messages:
        return ""
    first_of = len(messages) > 12
    text = ""
    in_code = False
    to_show = messages[:12]
    if first_of:
        to_show.append(":<i>[...]</i>")
    if after:
        to_show += after
    for m in to_show:
        if m.startswith(":"):
            if in_code:
                text += "</div>\n"
            text += m[1:] + "<br/>\n"
        elif m.startswith(">"):
            text += "\n"
            if not in_code:
                text += '<div class="msgcode">'
            text += m[1:]
            in_code = True
        else:
            current_app.logger.info(f"Discarded message: {m}")
    if in_code:
        text += "</div>\n"
    return text

def show_messages(messages, variables=None):
    n = 0
    after_err = []
    n += len(messages.get("ERR", []))
    if n > 0:
        if variables and smooth_int(variables.get('latex_errors')):
            path = project_dir() + "/_latex.log"
            if os.path.isfile(path):
                url = f"/fs/{flask_g.project_name}/_latex.log" + context_args(
                    {"attach": "0"})
                after_err.append(
                    f':<a href="{url}" target="_log">' + _('latex.log') + '</a>'
                )
    n += len(messages.get("WARN", []))
    n += len(messages.get("INFO", []))
    if n > 0:
        dialog_msg(
            err = select_messages(messages.get("ERR"),
                                  after=after_err),
            warn = select_messages(messages.get("WARN")),
            info = select_messages(messages.get("INFO"))
            )
    return len(messages["ERR"])

def log_messages(messages):
    if len(messages["WARN"]) + len(messages["ERR"]) > 0:
        app.logger.error(select_messages(messages["ERR"]))
        app.logger.warning(select_messages(messages["WARN"]))

def clear_data(steps):
    app.logger.info(f"Clear data: {steps}")
    amc_command("db", "clear", steps)
    io_adapt_menu()

@socketio_name("doc-update")
def io_doc_update(t):
    if not t:
        return { "error": "Document type missing" }
    app.logger.info(f"Doc update: {t} for {flask_g.project_name}")
    if (t == "sujet" and ui.refuse_if_locked("Rebuilding the question paper would make the printed papers unreadable.")) or ui.before_build():
        return
    emit_msg("begin-command")

    if t == "sujet":
        ui.note_building()  # history: the sources this build reads (ui.py)
        emit_msg("t", _('t.clear'))
        clear_data("mep:")
        db = get_db()
        db.clear_print_timestamp()

    mode = {
        "sujet": "s[]",
        "catalog": "C",
        "corrige": "S",
        "indiv-solution": "k",
    }.get(t)

    if not mode:
        app.logger.error(f"Unknown mode: {t}")
        return

    messages, variables = amc_command("prepare",
                                      "--mode", mode,
                                      "--progression-id", "MAJ")
    app.logger.info(f"Variables: {variables}")

    e = len(messages["ERR"])
    if t == "sujet" and e == 0:
        ui.note_built()  # history: which source versions built (ui.py)
        db = get_db()
        
        emit_msg("t", _('t.layouts'))
        amc_command("meptex",
                    "--store-defects",
                    "--progression-id", "MEP",
                    "--progression", "1",
                    messages=messages, variables=variables)

        for k,v in variables.items():
            if k.startswith("project:"):
                change_option(k, v)
        v = variables.get("pgfseed:subject")
        if v is not None:
            db.set_variable("layout", "build:pgfseed", v)

        emit_msg("defects", db.defects_class())

    emit_msg("end-command")
    show_messages(messages, variables=variables)
    io_adapt_menu()
    io_doc_type(t)

@app.route("/layout/<student>/<page>/<filename>")
def get_layout_file(student, page, filename):
    return send_file(amc_user_tmp(f"{student}/{page}/{filename}", is_file=True))
    
def layout_set_page(student, page):
    rep = amc_user_tmp(f"{student}/{page}")
    messages, variables = amc_command(
        "db", "layout-image",
        f"{student}/{page}",
        "--dest-file", f"{rep}/layout",
        "--css-url", "/static/svg.css")
    log_messages(messages)
    url = f"/layout/{student}/{page}/layout.svg"
    emit_msg("layout-set-page", [f"{student}/{page}", url])

@socketio_name("layout-init")
def io_layout_init():
    db = get_db(modules=("layout",))
    student, page = db.first_page()
    layout_set_page(student, page)
    
@socketio_name("layout-add")
def io_layout_add(data):
    db = get_db(modules=("layout",))
    page, delta = data
    student, page = list(map(int, page.split("/")))
    student, page = db.layout_page_add(student, page, delta)
    layout_set_page(student, page)

@app.route("/print_dialog.html")
def io_print_dialog():
    headers_info()
    db = get_db()
    student_min, student_max = db.student_range()
    ps = []
    try:
        conn = cups.Connection()
        ps = conn.getPrinters()
    except Exception as e:
        app.logger.error(f"Cannot connect to CUPS ({os.environ.get('CUPS_SERVER')}): " + str(e))
    printers = []
    for i in sorted(list(ps)):
        printers.append({
            "id": i,
            "name": f"{i} ({ps[i].get('printer-info','?')})",
        })              
    return render_template('print_dialog.html',
                           printers=printers,
                           student_min=student_min, student_max=student_max)

def n_waiting_print(cancel=False):
    prefix = get_option("job_prefix")
    if not prefix:
        return 0

    try:
        conn = cups.Connection()
        js = conn.getJobs()
    except Exception as e:
        app.logger.error(f"Cannot connect to CUPS ({os.environ.get('CUPS_SERVER')}): " + str(e))
        return 0
    n = 0

    for j in js.keys():
        job_name = conn.getJobAttributes(
            j, requested_attributes=["job-name"]
        ).get("job-name", "")
        if job_name.startswith(prefix):
            if cancel:
                conn.cancelJob(j, purge_job=True)
            else:
                n += 1
    return n

@socketio_name("n-waiting-print")
def io_n_waiting_print():
    emit_msg("n-waiting-print", n_waiting_print())

@socketio_name("cancel-printing")
def io_cancel_printing():
    emit_msg("n-waiting-print", n_waiting_print(cancel=True))
    

@socketio_name("print-to-printer")
def io_print_to_printer(data):
    student1, student2, printer = data
    emit_msg("begin-command")
    emit_msg("t", _('t.print_to', printer=printer))

    prefix = username() + ":" + unidecode(flask_g.project_name) + ":"
    change_option("job_prefix", prefix)
    messages, variables = amc_command(
        "imprime",
        "--methode", "cups",
        "--imprimante", printer,
        "--student-min", student1,
        "--student-max", student2,
        "--progression", "1",
        "--progression-id", "print",
        allow_cups=True
    )
    log_messages(messages)
    emit_msg("end-command")
    n = show_messages(messages)
    emit_msg("print-done")
    if n==0:
        dialog_msg(info = _('msg.printing.done'))

@socketio_name("print-to-files")
def io_print_to_files(data):
    student1, student2 = data
    app.logger.info(f"Printing <{flask_g.project_name}> to files: {student1}--{student2}")
    rep = amc_user_tmp(f"printed/{flask_g.project_name}")
    for f in os.listdir(rep):
        os.remove(f"{rep}/{f}")
    emit_msg("begin-command")
    emit_msg("t", _('t.print.files'))
    messages, variables = amc_command(
        "imprime",
        "--methode", "file",
        "--student-min", student1,
        "--student-max", student2,
        "--progression-id", "PRT",
        "--progression", "1",
        "--output", rep,
    )
    log_messages(messages)
    emit_msg("end-command")
    n = show_messages(messages)
    if n==0:
        emit_msg("print-done")
        emit_msg("print-to-files",
             f"/printed/{flask_g.project_name}/printed.zip")

def send_dir_as_zip(path, name=None, recursive=True,
                    filename=None, exclude=None):
    exclude_files = set(exclude.split(",")) if exclude else set()
    if name is None:
        name = re.sub(r'.*/', "", path) + ".zip"
    data = io.BytesIO()
    with zipfile.ZipFile(data, mode='w') as z:
        if recursive:
            for root, dirs, files in os.walk(path):
                dirs[:] = [d for d in dirs if d != ui.HISTORY_DIR]  # earlier versions stay out of the zip (ui.py)
                subroot = lstrip_text(root, path, ".")
                for f in files:
                    if f not in exclude_files:
                        z.write(f"{root}/{f}", arcname=f"{subroot}/{f}")
        else:
            for f_name in os.listdir(path):
                if f_name not in exclude_files:
                    z.write(f"{path}/{f_name}", arcname=f_name)
    data.seek(0)
    return send_file(
        data,
        mimetype='application/zip',
        as_attachment=True,
        download_name=(filename or name)
    )
        
@app.route("/printed/<project>/printed.zip")
def build_printed_zip(project):
    rep = amc_user_tmp(f"printed/{project}")
    return send_dir_as_zip(rep, name="printed.zip", recursive=False)

@socketio_name('scans-mode-change')
def io_scans_mode_change(m):
    change_option("auto_capture_mode", m)

@socketio_name('scans-mode')
def io_scans_mode():
    m = get_option("auto_capture_mode")
    if m is not None:
        emit_msg("scans-mode", m)
    else:
        app.logger.warning("Options: auto_capture_mode not found")
        emit_msg("scans-mode", -1)

@socketio_name('scans-params')
def io_scans_params():
    emit_msg("selected-config",
         get_options(
             ["global:scanslist_allcols",
              "multi_scan_mode",
              ]
             ))

def lock_scans_mode():
    m = int(get_option("auto_capture_mode"))
    if m is None or m < 0:
        m = 0
        emit_msg("scans-mode", m)
        change_option("auto_capture_mode", m)
    emit_msg("lock-photocopy")
    return m

def discretize(value, thresholds):
    if value is None:
        return None
    l = 0
    for i in range(len(thresholds)):
        if value >= thresholds[i]:
            l = i + 1
    return l

def scans_report(threshold, threshold_up):
    db = get_db()

    allcols = get_option("global:scanslist_allcols")

    questions_textpos = db.questions_with_textpos()

    n_complete, n_incomplete, missing = db.counts()
    n_failed = db.n_failed()
    
    pages = db.capture_pages(threshold, threshold_up)
    mse_max = 0
    sens_max = 0
    for p in pages:
        p["sens-level"] = discretize(p.get("sensitivity"),
                                     [ 6, 8, 9, 9.5 ])
        p["mse-level"] = discretize(p.get("mse"),
                                    [ 4, 6, 10, 15 ])
        if p.get("mse"):
            mse_max = max(mse_max, p.get("mse"))
        if p.get("sensitivity"):
            sens_max = max(sens_max, p.get("sensitivity"))
    app.logger.info(f"Scans report: {len(pages)} pages")
    if pages:
        emit_msg("lock-photocopy")
    else:
        emit_msg("unlock-photocopy")
    return render_template('scans_report.html',
                           n_complete=n_complete, n_incomplete=n_incomplete,
                           n_failed=n_failed,
                           questions_textpos=questions_textpos,
                           hide_mse=(mse_max <= 4),
                           hide_sens=(sens_max <= 5),
                           allcols=allcols,
                           pages=pages)

@socketio_name('n-incomplete-details')
def io_incomplete_details():
    db = get_db()
    n_complete, n_incomplete, missing = db.counts()
    miss = {}
    for p in missing:
        sc = (p[0], p[2])
        if not miss.get(sc):
            miss[sc] = []
        miss[sc].append(p[1])
    miss_sc = sorted(miss.keys())
    miss_sorted = []
    for sc in miss_sc:
        sc_text = str(sc[0])
        if sc[1]:
            sc_text += ":" + str(sc[1])
        miss_sorted.append(
            { "sc": sc_text,
              "pages": ", ".join([str(x) for x in sorted(miss[sc])]) })
        
    dialog_msg(info = render_template("incomplete_details.html",
                                      n_incomplete=n_incomplete,
                                      missing=miss_sorted))

@app.route('/scans_report.html')
def u_scans_report():
    headers_info()
    threshold = float(get_option("seuil"))
    threshold_up = float(get_option("seuil_up"))
    emit_msg("thresholds", [threshold, threshold_up])
    return scans_report(threshold, threshold_up)

@app.route('/failed_report.html')
def u_failed_report():
    headers_info()
    db = get_db()
    pdir = project_dir() + "/"
    purl = "/fs/" + flask_g.project_name + "/"
    failed = db.failed_scans()
    scans = []
    for f in failed:
        d, fn = os.path.split(f[0])
        if f[0].startswith("%PROJET/"):
            local_f = lstrip_text(f[0], "%PROJET/", "")
        elif f[0].startswith(pdir):
            local_f = lstrip_text(f[0], pdir, "")
        else:
            local_f = f[0]
        url = purl + local_f + context_args({"attach": "0"})
        scans.append({ "filename": f[0], "file": fn, "url": url, "i": int_prefix(fn) })
    scans.sort(key=lambda x: (x["i"], x["file"]))
    return render_template('failed_report.html',
                           scans=scans)

@socketio_name('failed-delete')
def io_failed_delete(filename):
    db = get_db()
    n = db.failed_delete(filename)
    if n:
        emit_msg("failed-report")
    else:
        emit_msg("tab-scans")

@socketio_name('failed-pre-process')
def io_failed_pre_process(filename):
    pdir = project_dir()
    orig_path = lstrip_text(filename, "%PROJET", pdir)
    d, fn = os.path.split(orig_path)
    pp_file = "/cr/diagnostic/" + fn + ".png"
    pp_path = pdir + pp_file
    pp_url  = "/fs/" + flask_g.project_name + pp_file + context_args()

    amc_command(
        "analyse",
        "--debug-image-dir", f"{pdir}/cr/diagnostic",
        "--no-tag-overwritten",
        orig_path)
        
    emit_msg("failed-pp-url", pp_url)

@app.route('/set_thresholds.html', methods=['POST'])
def x_set_thresholds():
    headers_info()
    seuil = float(request.json.get('seuil'))
    seuil_up = float(request.json.get('seuil_up'))
    change_option("seuil", seuil)
    change_option("seuil_up", seuil_up)
    return scans_report(seuil, seuil_up)

@app.route("/manual/<student>/<page>/<copy>/<filename>")
def get_manual_file(student, page, copy, filename):
    return send_file(amc_user_tmp(f"{student}/{page}/{copy}/{filename}", is_file=True))
    
@app.route('/scans_page_none.html')
def x_scans_page_none():
    headers_info()
    return render_template("scans_page_none.html")

@app.route('/scans_page_select.html', methods=['POST'])
def x_scans_page_select():
    headers_info()
    student = request.json.get('student')
    page = request.json.get('page')
    copy = request.json.get('copy')
    question = request.json.get('question')
    rep = amc_user_tmp(f"{student}/{page}/{copy}")

    params = [
        f"{student}/{page}:{copy}",
        "--scan",
        "--dest-file", f"{rep}/manual",
        "--url-prefix", f"/manual/{student}/{page}/{copy}/"
    ]
    if question is not None:
        params += ["--question-number", str(question) ]
    messages, variables = amc_command(
        "db", "layout-image",
        *params)
    log_messages(messages)
    url = f"/manual/{student}/{page}/{copy}/manual.svg"

    with open(rep + "/manual.svg", "r") as svgf:
        svg = svgf.read()
    
    scans_page_zooms(student, page, copy)

    return render_template("manual_view.html",
                           svg=svg,
                           student=student, page=page, copy=copy)

@app.route("/zooms/<student>/<page>/<copy>")
def scans_page_zooms(student, page, copy):
    headers_info()
    db = get_db()
    zooms = sorted(db.page_zooms(student, page, copy), key=lambda z: z['prop'])
    for z in zooms:
        z["image"] = "data:image/png;base64," + base64.b64encode(z["imagedata"]).decode("utf-8")
    return render_template("zooms.html", zooms=zooms);

@socketio_name('set-manual')
def io_set_manual(data):
    student, page, copy, question, answer, ticked, all_page = data
    db = get_db()
    db.set_manual(student, page, copy, question, answer, ticked, all_page)
    emit_msg("tick-box", [question, answer, ticked])

@socketio_name('revert-manual')
def io_revert_manual(data):
    student, page, copy = data
    threshold = float(get_option("seuil"))
    threshold_up = float(get_option("seuil_up"))
    db = get_db()
    boxes = db.get_boxes_status(student, page, copy,
                                threshold, threshold_up)
    db.revert_manual(student, page, copy)
    # update view
    emit_msg("disallow-revert")
    for b in boxes:
        if b["auto_ticked"] != b["manual"]:
            emit_msg("tick-box", [ b["question"], b["answer"], b["auto_ticked"] ])

@app.route('/pages/<question>')
def j_pages_with_question(question):
    headers_info()
    db = get_db()
    pages = db.pages_with_question(question)
    return pages
            
@socketio_name('add-student')
def io_add_student(student):
    app.logger.info(f"Add student: {student}")
    m = lock_scans_mode()
    db = get_db()
    student, first_page, copy = db.add_student(student, m)
    if first_page:
        emit_msg("scans-page-select", [student, first_page, copy])
        io_adapt_menu()

@socketio_name('add-student-syntax')
def io_add_student_syntax():
    dialog_msg(err = _('add.student.syntax'))

@socketio_name('delete-scans')
def io_delete_scans(scans):
    db = get_db()
    for p in scans:
        db.delete_scan_page_data(p["student"], p["page"], p["copy"])
    db.commit()
    emit_msg("scans-report")
        
@app.route('/show_marks.html')
def x_show_marks():
    headers_info()
    db = get_db()
    marks, maxis = db.get_marks()
    o = get_options(
        ["note_null", "note_max", "note_grain",
         "global:view_histogram"])
    mini = float(o["note_null"])
    full = float(o["note_max"])
    grain = float(o["note_grain"])
    histogram = o["global:view_histogram"]
    if full == 0:
        if len(maxis) == 1:
            full = maxis[0]
        else:
            full = None
    if marks:
        mean = sum(marks)/len(marks)
    else:
        mean = None

    if histogram and full and marks:
        n_class = 20 if len(marks) >= 40 else 10
        if grain and grain > 0:
            max_class = abs(full-mini)/grain
            n_class = min(max_class, n_class)

        classes = [
            { "low":  mini + i*(full-mini)/n_class,
              "high": mini + (i+1)*(full-mini)/n_class,
              "n": 0 }
            for i in range(n_class) ]
        for x in marks:
            i = n_class * (x-mini)/(full-mini)
            i = math.floor(i+0.001)
            i = min(i, n_class-1)
            i = max(i, 0)
            classes[i]["n"] += 1
        clmax = max(1, max([c["n"] for c in classes]))
        for c in classes:
            c["pc"] = c["n"] / clmax * 100

        classes.reverse()
    else:
        classes = None
        clmax = None

    emit_msg("n-marks", len(marks))
        
    return render_template("show_marks.html",
                           marks=marks, nmarks=len(marks),
                           mean=mean, full=full,
                           classes=classes)

@socketio_name('do-mark')
def io_do_mark(update):
    messages = {}
    variables = {}
    emit_msg("begin-command")
    if update:
        emit_msg("t", _('t.mark.extract'))
        amc_command(
            "prepare",
            "--mode", "b",
            "--progression-id", "MAJ", "--progression", "1",
            messages=messages, variables=variables
        )
        u_exports_available()
    emit_msg("t", _('t.mark.compute'))
    amc_command(
        "note",
        "--progression-id", "GRD",
        "--progression", "1",
        messages=messages, variables=variables
    )
    emit_msg("end-command")
    show_messages(messages)
    emit_msg("update-marks")
    emit_msg("update-identification")

@socketio_name('studentslist-delete')
def io_studentslist_delete():
    old = get_option("listeetudiants")
    pdir = project_dir()
    if old.startswith("%PROJET/"):
        old = lstrip_text(old, '%PROJET/', pdir + "/")
    if os.path.realpath(old).startswith(os.path.realpath(pdir) + "/"):
        try:
            os.unlink(old)
        except Exception as e:
            app.logger.error(f"Can't delete students list file {old}: {e}")
    clear_data("assoc")
    set_students_list("")
    emit_msg("update-identification")

@socketio_name('studentslist-shared')
def io_studentslist_shared(name):
    name = name.replace("/", "") + ".csv"
    path = students_shared_dir() + "/" + name
    imported = fs_path_to_local(name, with_fs=False, current_project=True)

    if not imported:
        return
    
    try:
        shutil.copyfile(path, imported)
    except Exception as e:
        app.logger.error("Error while copying {path} to {imported}: {e}")
        return
    set_students_list("%PROJET/" + name)
    emit_msg("update-identification")

def students_list_file():
    path = get_option("listeetudiants")
    pdir = project_dir()
    if path:
        path = lstrip_text(path, '%PROJETS/', projects_dir() + "/")
        path = lstrip_text(path, '%PROJET/', pdir + "/")

        if not os.path.isfile(path):
            path = None
            set_students_list(None)

    if not path:
        filename = None
        for x in ('students.csv', 'students.txt',
                  'etudiants.csv', 'etudiants.txt'):
            if os.path.isfile(f"{pdir}/{x}"):
                filename = x

        if not filename:
            cand = [ f for f in os.listdir(pdir)
                     if f.lower().endswith(".csv") ]
            if len(cand) == 1:
                filename = cand[0]
                
        if filename:
            set_students_list("%PROJET/" + filename)
            path = f"{pdir}/{filename}"
                          
    # With the separator: without it, user "ann" could point her list at
    # "anna"'s projects.
    if path and not os.path.realpath(path).startswith(os.path.realpath(projects_dir()) + os.sep):
        app.logger.error(f"Students list file outside base: {path}")
        path = None
        set_students_list(None)

    return path

def list_file_read(path):
    skip = 0
    f = open(path, "r")
    line = "#"
    while line[0]=="#":
        skip = f.tell()
        line = f.readline()
    f.seek(skip)
    dialect = csv.Sniffer().sniff(f.read(1024), ",:;\t")
    f.seek(skip)
    reader = csv.DictReader(f, dialect=dialect)
    rows = []
    for row in reader:
        rows.append(row)
    f.close()
    return rows

def list_file_headers(path):
    skip = 0
    f = open(path, "r")
    line = "#"
    while line[0]=="#":
        skip = f.tell()
        line = f.readline()
    f.seek(skip)
    dialect = csv.Sniffer().sniff(f.read(1024), ",:;\t")
    f.seek(skip)
    reader = csv.reader(f, dialect=dialect)
    headers = next(iter(reader))
    f.close()
    return dialect, headers

def unique_keys(rows):
    if not rows:
        return []
    ukeys = []
    for k in rows[0].keys():
        x = [r[k] for r in rows]
        if len(x) == len(list(set(x))):
            ukeys.append(k)
    return ukeys

def first_of(l, *proposals, index=False):
    unil = {}
    for i, x in enumerate(l):
        if index:
            unil[ unidecode(x.lower()) ] = i
        else:
            unil[ unidecode(x.lower()) ] = x
    for i, x in enumerate(proposals):
        if unil.get(x):
            return unil[x]
    return None

def headers_list(hlist):
    return [h.strip() for h in hlist.split(",")
            if h.strip()]

def students_flat_list():
    o = get_options(["liste_key",
                     "global:csv_name_headers", "global:csv_surname_headers"])
    lkey = o.get('liste_key')
    path = students_list_file()
    rows = list_file_read(path)
    if not rows:
        return []

    ks = list(rows[0].keys())
    k_name = first_of(ks, "prenom", "name",
                      *headers_list(o['global:csv_name_headers']))
    k_surname = first_of(ks, "nom", "surname",
                         *headers_list(o['global:csv_surname_headers']))

    flat = []
    for i, r in enumerate(rows):
        n = []
        if r.get(k_surname):
            n.append(r[k_surname])
        if r.get(k_name):
            n.append(r[k_name])
        if not n:
            n.append(_('student.list.number').format(i+1))
        flat.append( [r[lkey], " ".join(n), None] )

    flat.sort(key=lambda x: x[1])
    return flat

def student_id_exists(sid):
    lkey = get_option("liste_key")
    path = students_list_file()
    rows = list_file_read(path)

    list_ids = [ s[lkey] for s in rows ]
    return sid in list_ids

def student_new(sid, surname, name):
    o = get_options(["liste_key",
                     "global:csv_name_headers", "global:csv_surname_headers"])
    lkey = o.get('liste_key')
    path = students_list_file()
    dialect, headers = list_file_headers(path)

    i_id = headers.index(lkey)
    i_name = first_of(headers, "prenom", "name",
                      *headers_list(o['global:csv_name_headers']), index=True)
    i_surname = first_of(headers, "nom", "surname",
                         *headers_list(o['global:csv_surname_headers']), index=True)
    s_new = [ "" for i in range(len(headers)) ]
    s_new[i_id] = sid
    if i_name:
        s_new[i_name] = name
    else:
        surname = surname + " " + name
    if i_surname:
        s_new[i_surname] = surname
        
    with open(path, 'a', newline='') as csvfile:
        studentswriter = csv.writer(csvfile, dialect)
        studentswriter.writerow(s_new)

@socketio_name('change-lkey')
def io_change_lkey(data):
    lkey, force = data
    change_option("liste_key", lkey)
    if force:
        db = get_db()
        db.clear_associations()
        emit_msg("update-identification")

@socketio_name('change-acode')
def io_change_lkey(acode):
    change_option("assoc_code", acode)

@app.route('/identification.html')
def x_identification():
    headers_info()
    path = students_list_file()
    if path:
        ldir, lname = os.path.split(path)
        rows = list_file_read(path)
        ukeys = unique_keys(rows)
    else:
        lname = None
        ukeys = []

    lkey = get_option("liste_key")
    if (not lkey) or (lkey not in ukeys):
        lkey = None
        for x in ('etud','etu','student','number','id','ID'):
            if x in ukeys:
                lkey = x
        if lkey:
            change_option("liste_key", lkey)

    db = get_db()
    codes = db.codes_list()
    n_id = db.n_real_identifications()
    n_students = db.n_graded_students()
    acode = get_option("assoc_code")
    if not acode:
        if len(codes) == 1:
            acode = codes[0]
            change_option("assoc_code", acode)
        
    return render_template(
        "identification.html",
        students_shared=sorted(students_shared_lists()),
        filename=lname, ukeys=ukeys, lkey=lkey,
        codes=codes, acode=acode,
        n_id=n_id, n_students=n_students)

@socketio_name('association-clear')
def io_association_clear():
    db = get_db()
    db.clear_associations()
    emit_msg("update-identification")
    
@socketio_name('association-auto')
def io_association_auto():
    db = get_db()
    n_before = db.n_identifications(manual=False)
    messages, variables = amc_command(
            "association-auto",
    )
    n_after = db.n_identifications(manual=False)
    if n_after > n_before:
        m = ngettext("assoc.auto.one", "assoc.auto.plural",
                     n_after-n_before)
    else:
        m = _("assoc.auto.none")
    messages["INFO"].append(":" + m)
    show_messages(messages)
    db.set_variable("association", "key_in_list", get_option("liste_key"))
    db.set_variable("association", "code", get_option("assoc_code"))
    emit_msg("update-identification")

@app.route("/assoc_sheets.html")
def x_assoc_sheets():
    headers_info()
    db = get_db()
    sheets = db.get_assoc_sheets()
    return render_template("assoc_sheets.html", sheets=sheets)

@app.route("/students_list.html")
def x_students_list():
    headers_info()
    db = get_db()
    sheets = db.get_assoc_sheets()
    students = students_flat_list()
    back = {}
    for i in range(len(students)):
        back[students[i][0]] = i
    for s in sheets:
        eff = s[3] if s[3] is not None else s[2]
        i = back.get(eff)
        if i is not None:
            students[i][2] = True
    return render_template("students_list.html", students=students)

@app.route('/namefield/<student>/<copy>')
def x_namefield(student, copy):
    headers_info()
    db = get_db()
    path = db.get_namefield_image(student, copy)
    if path and not path.startswith("text:"):
        path = f"/fs/{flask_g.project_name}/cr/{path}{context_args()}"
    return render_template("namefield.html",
                           student=student, copy=copy,
                           path=path)

@socketio_name('association-config')
def io_annotation_config():
    emit_msg("selected-config",
         get_options(
             ["global:filter_beginning"]))

def do_associate(student, copy, student_id):
    db = get_db()
    
    old_lkey = db.get_variable("association", "key_in_list")
    lkey = get_option("liste_key")
    if old_lkey != lkey:
        db.set_variable_nocommit("association", "key_in_list", lkey)
        if old_lkey:
            app.logger.warning(f"key_in_list changed! {old_lkey} -> {lkey}")

    multiple_copies = get_option("multiple_copies")
    to_rm = db.associate(student, copy, student_id, multiple_copies)
    app.logger.info(f"Associated: [{student},{copy}] <-> \"{student_id}\" | {to_rm}")
    emit_msg("update-association",
             [ student, copy, student_id, to_rm ])

@socketio_name('associate')
def io_associate(data):
    student, copy, student_id = data
    do_associate(student, copy, student_id)

@socketio_name('associate-new')
def io_associate_new(data):
    sid, surname, name, student, copy = data
    if student_id_exists(sid):
        app.logger.warning(f"Student id already exists: {sid} / {surname} {name}")
        dialog_msg(err=_('newstudent.exists', sid=sid))
    else:
        app.logger.debug(f"New student: {sid} / {surname} {name}")
        student_new(sid, surname, name)
        do_associate(student, copy, sid)
        emit_msg("update-students-list")

def u_exports_available():
    db = get_db()
    gs = db.groupsep_available()
    if len(gs)==1:
        o = get_option("export_ods_groupsep")
        if o != gs[0]:
            change_option("export_ods_groupsep", gs[0])
            emit_msg("selected-config", get_options(["export_ods_groupsep"]))
    emit_msg("export-available",
             { "grading-indic": bool(db.indicative_questions()),
               "grading-groups": bool(gs),
               "export_ods_groupsep": gs,
              })
    
@socketio_name('export-config')
def io_export_config():
    u_exports_available()
    emit_msg("selected-config",
         get_options(["format_export", "export_include_abs", "export_ods_stats",
                      "export_ods_statsindic", "export_ods_group", "export_ods_groupsep",
                      "export_csv_ticked",
                      "app_public_marks"
                      ]))

ANNOTATION_OPTIONS = (
    'annote_chsign',
    'annote_color',
    'annote_ecart',
    'annote_font_name',
    'annote_position',
    'annote_rtl',
    'embedded_format',
    'embedded_jpeg_quality',
    'embedded_max_size',
    'regroupement_compose',
    'symbole_0_0_color',
    'symbole_0_0_type',
    'symbole_0_1_color',
    'symbole_0_1_type',
    'symbole_1_0_color',
    'symbole_1_0_type',
    'symbole_1_1_color',
    'symbole_1_1_type',
    'symboles_indicatives',
    'symboles_trait',
    'verdict',
    'verdict_q',
    )

def annotate_source_change(db=None):
    if db is None:
        db = get_db()
    if db:
        db.annotate_source_change()

def set_students_list(filepath):
    change_option("listeetudiants", filepath)
    annotate_source_change()

@socketio_name('set-config')
def io_set_config(data):
    if ui.option_refused(data[0]):
        return
    success, name = change_option(*data)
    if success and (name in ANNOTATION_OPTIONS):
        annotate_source_change()
    if name == "activate_ahead":
        io_adapt_menu()

def send_dir_list(t, subdir,
                  zip_text="Download",
                  filename=None,
                  exclude=None):
    if not t:
        t = int(datetime.datetime.now().timestamp())
    rep = project_dir() + "/" + subdir
    fsdir = f"/fs/{flask_g.project_name}/{subdir}"
    files = [ (f,
              f"{fsdir}/{quote(f)}{context_args()}",
              os.path.getmtime(f"{rep}/{f}") > t)
             for f in os.listdir(rep)
             if os.path.isfile(f"{rep}/{f}") ]
    files.sort()
    archive_args = {}
    if filename: archive_args["filename"] = filename
    if exclude: archive_args["exclude"] = exclude
    app.logger.debug(f"context: {context_args()}")
    return render_template("files.html", files=files,
                           fsdir_url=fsdir + context_args(args=archive_args),
                           zip_text=zip_text)

@app.route("/exported_files.html", methods=['POST'])
def x_exported_files():
    headers_info()
    t = request.json.get('t')
    project = flask_g.project_name
    return send_dir_list(t, "exports",
                         zip_text=_('files.all'),
                         filename=f"{project}-exported.zip")

@socketio_name('do-export')
def io_do_export():
    t = int(datetime.datetime.now().timestamp())
    emit_msg("begin-command")
    emit_msg("t", _('t.export'))
    module = get_option("format_export")
    path = project_dir() + "/exports/marks." + module.lower()
    messages, variables = amc_command(
        "export",
        "--module", module,
        "--output", path,
        "--export-ods-filter",
    )
    emit_msg("end-command")
    emit_msg("update-exported-files", t)
    show_messages(messages)
        
@socketio_name('annotation-config')
def io_annotation_config():
    emit_msg("selected-config",
         get_options(
             ["regroupement_type", "regroupement_compose",
              "add_corrected", "modele_regroupement",
              "annotate_dont_overwrite"]))

def unlink_indiv_annotated():
    rep = project_dir() + "/cr/corrections/pdf"
    for f in os.listdir(rep):
        path = f"{rep}/{f}"
        if os.path.isfile(path) and f != "all-students.pdf":
            os.unlink(path)
    
@socketio_name("do-annotate")
def io_do_annotate():
    single = (get_option("regroupement_type") == "ALL")
    keep = to_bool(get_option("annotate_dont_overwrite"))
    if not (single or keep):
        unlink_indiv_annotated()
    t = int(datetime.datetime.now().timestamp())
    args = []
    emit_msg("begin-command")
    emit_msg("t", _('t.annotate'))
    if single:
        args += ["--single-output", "all-students.pdf"]
    messages, variables = amc_command(
        "annotate",
        *args,
        "--progression-id", "ANNOT",
        "--progression", "1",
        "--changes-only",
    )
    emit_msg("end-command")
    emit_msg("update-annotated-files", t)
    if len(messages.get("ERR", [])) > 0:
        annotate_source_change()
    show_messages(messages)

@app.route('/annotated_files.html', methods=['POST'])
def x_annotated_files():
    headers_info()
    t = request.json.get('t')
    project = flask_g.project_name
    return send_dir_list(t, "cr/corrections/pdf",
                         zip_text=_('files.indiv'),
                         filename=f"{project}-annotated.zip",
                         exclude="all-students.pdf")

@app.route('/manifest.json')
def x_manifest():
    return {
        "short_name": "AMC",
        "name": "Auto Multiple Choice",
        "description": "Auto Multiple Choice on " + request.host,
        "icons": [
            { "src": url_for('static', filename='menu-amc.svg',
                             _scheme=os.environ.get('PREFERRED_URL_SCHEME'),
                             _external=True),
              "sizes": "any"
             },
        ],
        "start_url": "./",
        "scope": ".",
        "display": "standalone",
        "theme_color": "#000000",
        "background_color": "#ffffff",
    }

# The new interface (doc/features.md)
import ui
ui.init_app(app, sys.modules[__name__])

if __name__ == '__main__':
    socketio.run(app, debug=True)
