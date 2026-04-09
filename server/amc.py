
from gevent import monkey
monkey.patch_all()

import io
import re
import os
import math
from pathlib import Path
import datetime
import shutil
import tempfile
import sys
import logging
import cups
import io
import zipfile
import tarfile
import base64
import csv
import uuid
from urllib.parse import quote
from unidecode import unidecode
from lxml import etree
import threading

from PIL import Image

from db import Amcdb
from command import amc_command
from basic import *

from flask import Flask, render_template, request, send_file, make_response, url_for
from flask_socketio import SocketIO, emit
from flask_babel import Babel, _

TEMPLATES_DIR="/usr/share/auto-multiple-choice/models"

app = Flask(__name__)

app.config.from_mapping(
    SECRET_KEY='dev',
)
socketio = SocketIO(app, logger=True, async_mode='gevent')
app.socketio = socketio

babel = Babel(app, locale_selector=get_locale)

temp_dir = tempfile.mkdtemp(prefix="amcapp")

app.logger.info(f"Temp dir: {temp_dir}")

def get_db(modules=()):
    db = get_thread_var("db", app.logger)
    if not db:
        pdir = project_dir()
        if pdir:
            app.logger.warning(f"Create DB for thread {threading.get_ident()} ({get_session()})")
            app.logger.debug(
                f"Active threads: " +
                ", ".join([str(x.ident)
                           for x in threading.enumerate()]))
            db = Amcdb(project_dir(), modules)
            set_thread_var("db", db)
        else:
            db = None
    return db

@socketio.on('sid')
def io_id(sid):
    set_var("sid", sid)

@app.route('/')
def index():
    resp = make_response(render_template('index.html'))
    if not request.cookies.get('amcsession'):
        session = str(uuid.uuid4())
        app.logger.info(f"New session: {session}")
        resp.set_cookie('amcsession', session)
    return resp

@app.route('/tab/<tab_name>')
def tab(tab_name):
    return render_template(f"tab_{tab_name}.html")

def serve_pil_image(pil_img):
    img_io = io.BytesIO()
    pil_img.save(img_io, 'JPEG', quality=75)
    img_io.seek(0)
    return send_file(img_io, mimetype='image/jpeg')

@app.route('/fs/<path:path>', methods=['GET', 'POST'])
def fs_file(path):
    path = path.replace("..", "")
    path = projects_dir() + "/" + path
    if request.method == 'POST':
        app.logger.info(f"Uploaded file: {path}")
        if 'file' not in request.files:
            return { "error": "No file part" }
        f = request.files['file']
        if f:
            f.save(path)
            return { "ok": True }
    else:
        app.logger.info(f"Send file: {path}")
        attach = bool(int(request.args.get('attach', "1")))
        ext = path.split(".")[-1].lower()
        if os.path.isfile(path):
            if ext in ('tiff', 'tif') and not attach:
                return serve_pil_image(Image.open(path))
            else:
                return send_file(path,
                                 as_attachment=attach)
        elif os.path.isdir(path):
            return send_dir_as_zip(path,
                                   filename=request.args.get('filename'),
                                   exclude=request.args.get('exclude'))
        else:
            return { "error": "Unknown path type" }

@app.route('/projects_list.html')
def u_projects_list():
    projects = projects_list()
    return render_template("projects_list.html", projects=projects)

def u_open_project(name, to_reload=True):
    name, change = set_project(name)
    if change and name:
        amc_command("db", "upgrade", app=app)
    emit_progress("project-open", [name, to_reload])

@socketio.on('request-project')
def io_request_project(data):
    name, to_reload = data
    u_open_project(name, to_reload)

@socketio.on('source-info')
def io_source_info():
    db = get_db()
    if db:
        emit_progress("defects", db.defects_class())
        emit_progress("ncopies", str(ncopies()))

@socketio.on('adapt-menu')
def io_adapt_menu():
    project = get_var("project_name")
    if project:
        menus = { "main": True, "source": True, "config": True }
        db = get_db()
        if db.layout_npages():
            menus["scans"] = True
            if db.capture_npages():
                menus["grading"] = True
    else:
        menus = { "main": True }
        
    emit_progress("menu", menus)

def copy_files_progress(src_folder, dst_folder):
    nfiles = 0
    for root, dirs, files in os.walk(src_folder):
        nfiles += len(files)
    emit_progress("p", 0)
    os.mkdir(dst_folder)
    n = 0
    for root, dirs, files in os.walk(src_folder):
        dst_root = root.replace(src_folder, dst_folder, 1)
        for d in dirs:
            os.mkdir(f"{dst_root}/{d}")
        for f in files:
            try:
                shutil.copy2(f"{root}/{f}", f"{dst_root}/{f}",
                             follow_symlinks=False)
                n += 1
            except:
                pass
            emit_progress("p", n/nfiles)
    return n, nfiles

@socketio.on('project-clone')
def io_project_clone(name):
    clone_name = project_clone_name(name)
    source = project_dir(p=name)
    dest = project_dir(p=clone_name)
    emit_progress("t", _('t.cloning'))
    emit_progress("begin-command")
    n, ntotal = copy_files_progress(source, dest)
    emit_progress("end-command")
    emit("u-projects-list")
    if n==ntotal:
        emit("dialog",
             render_template(
                 "warn_dialog.html",
                 err = "",
                 warn = "",
                 info = _('msg.cloned', name=clone_name)))
    else:
        emit("dialog",
             render_template(
                 "warn_dialog.html",
                 err = _('msg.clone.err', name=clone_name, n=n, ntotal=ntotal),
                 warn = "",
                 info = ""))

@socketio.on('project-delete')
def io_project_clone(name):
    rep = project_dir(p=name)
    shutil.rmtree(rep)
    if get_var("project_name") == name:
        set_project("")
        emit("project-open", ["", False])
    else:
        emit("u-projects-list")

@socketio.on('project-rename')
def io_project_rename(data):
    old, new = data
    new.replace('/','')

    if new == old:
        app.logger.info(f"Project {old} not renamed")
        emit("u-projects-list")
        return

    src = project_dir(p=old)
    dst = project_dir(p=new)
    if(os.path.exists(dst)):
        emit("dialog",
             render_template(
                 "warn_dialog.html",
                 err = _('msg.rename.exists', old=old, new=new),
                 warn = "",
                 info = ""))
    else:
        app.logger.info(f'Project "{old}" renamed to "{new}"')
        os.rename(src, dst)

        if old == get_var("project_name"):
            new, chg = set_project(new)
            emit("project-open", [new, True])
        else:
            emit("u-projects-list")

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
def io_project_new():
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
    rep = project_dir(p=name)
    if os.path.exists(rep):
        if warn:
            emit("dialog",
                 render_template(
                     "warn_dialog.html",
                     err = _('msg.create.exists', name=name),
                     warn = "",
                     info = ""))
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
            
@socketio.on('create-project-empty')
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
        amc_command("db", "upgrade", app=app)
        emit("project-open", [name, True])

def info_remove_root(m, root):
    n = add_var("files_n", 1)
    total = get_var("files_total")
    emit_progress("p", n/total)
    if m.type in (tarfile.SYMTYPE, tarfile.CHRTYPE, tarfile.BLKTYPE,
                  tarfile.FIFOTYPE, tarfile.GNUTYPE_LONGLINK):
        return None
    if m.name.startswith(root):
        m.name = m.name.replace(root, "", 1)
        m.uid = None
        m.gid = None
        m.uname = None
        m.gname = None
        return m
    else:
        return None
        
def tar_extract_options_siblings(tarf, dest):
    emit_progress("t", _('t.options'))
    root = None
    total = 0
    for m in tarf.getmembers():
        total += 1
        app.logger.debug(f"tar> {m.name}")
        o = re.match(r'^(.*/|)options.xml$', m.name)
        if o:
            root = o[1]
            app.logger.debug("found root: " + root)
    set_var("files_total", total)
    set_var("files_n", 0)
    if root:
        emit_progress("t", _('t.extract'))
        emit_progress("p", 0)
        if not os.path.exists(dest):
            os.mkdir(dest)
        tarf.extractall(
            dest, filter=lambda m,p: info_remove_root(m, root))
        return True
    else:
        app.logger.error(f"Can't find options.xml in archive")
        return False

def zip_extract_options_siblings(zipf, dest):
    emit_progress("t", _('t.options'))
    root = None
    total = 0
    for m in zipf.infolist():
        total += 1
        app.logger.debug(f"zip> {m.filename}")
        o = re.match(r'^(.*/|)options.xml$', m.filename)
        if o:
            root = o[1]
            app.logger.debug("found root: " + root)
    if root:
        emit_progress("t", _('t.extract'))
        emit_progress("p", 0)
        if not os.path.exists(dest):
            os.mkdir(dest)
        n = 0
        for m in zipf.infolist():
            n += 1
            if m.filename.startswith(root):
                m.filename = m.filename.replace(root, "", 1)
                if m.filename != "":
                    zipf.extract(m, dest)
            emit_progress("p", n/total)
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
    
@socketio.on('create-project-template')
def io_create_project_template(data):
    name, template = data
    rep = check_unused_name(name)
    if rep:
        app.logger.info(f"Create project \"{name}\" from template {template}")
        tpath = f"{TEMPLATES_DIR}/{template}"
        if os.path.isfile(tpath + ".tgz"):
            tarf = tarfile.open(tpath + ".tgz")
            if not tar_extract_options_siblings(tarf, rep):
                return
        elif os.path.isdir(tpath):
            if not project_install_from_dir(tpath, rep):
                return
        create_project_dirs(rep)
        name, chg = set_project(name)
        amc_command("db", "upgrade", app=app)
        emit("project-open", [name, True])

def create_from_source_file(name, rep, f, fn):
    create_project_dirs(rep)
    f.save(f"{rep}/{fn}")
    create_options_file(rep, fn)
    emit_progress("end-command")
    u_open_project(name)
    return { "ok": True }

def create_from_archive(name, rep, f):
    emit_progress("t", _('t.archive.save'))
    handle, fn = tempfile.mkstemp()
    f.save(fn)
    ok = False
    if zipfile.is_zipfile(fn):
        zipf = zipfile.ZipFile(fn)
        ok = zip_extract_options_siblings(zipf, rep)
    elif tarfile.is_tarfile(fn):
        tarf = tarfile.open(fn)
        ok = tar_extract_options_siblings(tarf, rep)
    else:
        app.logger.error("Archive type unknown")
    create_project_dirs(rep)
    emit_progress("end-command")
    u_open_project(name)
    return { "ok": ok }

def upload_file_parts(f):
    simple_filename = f.filename.replace("/", "").replace(" ","_")
    ext = ""
    if r := re.match(r'.*\.([a-z0-9]{1,3})$', simple_filename):
        ext = r[1].lower()
    return simple_filename, ext

@app.route('/upload/<dest>', methods=['POST'])
def file_upload(dest):

    request_files = request.files.getlist("file")
    if not request_files:
        return { 'error': 'Empty upload' }

    if request_files[0].filename == '':
        return { 'error': 'Empty file' }

    app.logger.info(f"Upload to {dest}: {len(request_files)} file(s)")

    if dest=="create":
        name = request.form['name']
        rep = check_unused_name(name, warn=False)
        if rep:
            emit_progress("p", 0)
            fn, ext = upload_file_parts(request_files[0])
            if re.match(r'.*\.(tgz|tar\.gz|tar|zip)', fn, re.IGNORECASE):
                return create_from_archive(name, rep, request_files[0])
            elif re.match(r'.*\.(tex|latex|txt)', fn, re.IGNORECASE):
                return create_from_source_file(name, rep, request_files[0], fn)
            else:
                emit_progress("end-command")
                return { "error": f"File {fn} can't be used to create a project" }
        else:
            emit_progress("end-command")
            return { "error": f"Can't create project {name}: already used" }

    elif dest=="project":
        rep = project_dir();
        emit_progress("end-command");
        fn, ext = upload_file_parts(request_files[0])
        if rep:
            request_files[0].save(f"{rep}/{fn}");
            return { "ok": True }
        else:
            return { "error": f"Project unknown" }

    elif dest=="students":
        rep = project_dir();
        emit_progress("end-command");
        fn, ext = upload_file_parts(request_files[0])
        if rep:
            request_files[0].save(f"{rep}/{fn}");
            change_option("listeetudiants", "%PROJET/" + fn)
            return { "ok": True }
        else:
            return { "error": f"Project unknown" }

    elif dest=="scans":
        project_name = request.form['project_name']

        # use the scans subdirectory to store uploaded files
        rep = f"{temp_dir}/{get_session()}/scans"
        Path(rep).mkdir(parents=True, exist_ok=True)
        local_paths = []
        for f in request_files:
            fn, ext = upload_file_parts(f)
            n, path = tempfile.mkstemp(suffix="." + ext, dir=rep)
            f.save(path)
            local_paths.append(path)

        # create a file to list paths of the uploaded files
        n, list_path = tempfile.mkstemp(prefix="list-", dir=rep)
        with open(list_path, "w") as f:
            for p in local_paths:
                print(p, file=f)

        return { 'ok': True,
                 'list': list_path.replace(rep, "%SCANS", 1) }

    else:
        emit_progress("end-command")
        return { "error": f"Unknown upload dest: {dest}" }

@socketio.on('data-capture')
def io_data_capture(list_path):
    rep = f"{temp_dir}/{get_session()}/scans"
    list_path = list_path.replace("%SCANS", rep, 1)
    db = get_db()
    orientation = db.orientation()
    lock_scans_mode()
    emit_progress("begin-command")
    emit_progress("t", _('t.scans.extract'))
    messages, variables = amc_command(
        "getimages",
        "--list", list_path,
        "--orientation", orientation,
        "--copy-to", project_dir() + "/scans",
        "--progression-id", "GETI", app=app
    )
    emit_progress("t", _('t.automatic'))
    amc_command(
        "analyse",
        "--liste-fichiers", list_path,
        "--unlink-on-global-err",
        "--progression-id", "SCAN",
        "--progression", "1",
        messages=messages, variables=variables, app=app
    )
    emit_progress("end-command")
    emit_progress("scans-report")
    show_messages(messages)
    io_adapt_menu()
    
@socketio.on('ncopies')
def io_ncopies(n):
    n = int(n)
    change_option("nombre_copies", n)

@socketio.on('source-code')
def io_source_code(filename):
    if not filename:
        filename = main_source_file()
    if not filename:
        filename = default_source_file()
        change_option("texsrc", filename)
    emit("source-name", filename)

    mode = "plain_text"
    if re.match(r'.*\.(tex|latex)$', filename, re.IGNORECASE):
        mode = "latex"
    elif re.match(r'.*\.(yml|yaml)$', filename, re.IGNORECASE):
        mode = "yaml"
    elif re.match(r'.*\.(csv)$', filename, re.IGNORECASE):
        mode = "csv"

    fn = project_dir() + "/" + filename
    filecontent = ""
    if os.path.exists(fn):
        with open(fn, "r") as f:
            filecontent = f.read()
    emit("source-code", [mode, filecontent])

@socketio.on('source-save')
def io_source_save(filename, code):
    with open(project_dir() + "/" + filename, "w") as f:
        f.write(code)
    emit("source-saved");

def file_level(base, main_source, f):
    ff = f"{base}/{f}"
    if os.path.isdir(ff):
        return 2
    if f == main_source:
        return -1
    if re.match(r'.*\.(tex|yaml|yml|csv|txt)$', f, re.IGNORECASE):
        return 0
    else:
        return 1

@socketio.on('project-config')
def io_project_config():
    emit("selected-config",
         get_options(
             ["moteur_latex_b",
              "note_null", "note_max", "note_grain", "note_arrondi",
              "verdict", "annote_position",
              "global:bw_threshold",
              "global:tolerance_marque_inf", "global:tolerance_marque_sup",
              "global:try_three", "global:ascii_filenames",
              "global:view_histogram",
             ]
         ))

@app.route('/files_list.html')
def u_files_list():
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
        base_url=f"/fs/{get_var('project_name')}")

@app.route('/defects_list.html')
def u_defects_list():
    db = get_db()
    return render_template(
        "defects_list.html",
        defects = db.defects())

@socketio.on("project-delete-file")
def io_project_delete_file(data):
    filename, all_files = data
    filename = filename.replace("/", "")
    base = project_dir()
    if base:
        try:
            os.unlink(f"{base}/{filename}")
        except Exception as e:
            app.logger.error("Can't delete project file: " + str(e))
            return
        io_files_list(all_files)
    else:
        app.logger.error("Can't delete project file: unknown project")

@app.route('/document/<doc_type>', methods=['POST'])
def u_document_type(doc_type):
    url = request.json.get('url')
    return render_template(f"document_{doc_type}.html",
                           url=url)

@socketio.on("doc-type")
def io_doc_type(t):
    if not t:
        emit("document-content",
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
                
            url = "/fs/" + get_var("project_name") + doc
            template_name = "content"

    emit("document-content", [can_print, danger,
                              template_name, url])

def select_messages(messages):
    if len(messages) > 10:
        messages = ["<i>Only display the first 10 messages…</i>"] + messages[:10]
    return "<br>\n". join(messages)

def show_messages(messages):
    if len(messages["WARN"]) + len(messages["ERR"]) > 0:
        emit("dialog",
             render_template(
                 "warn_dialog.html",
                 err = select_messages(messages["ERR"]),
                 warn = select_messages(messages["WARN"]),
                 info = ""))
    return len(messages["ERR"])

def log_messages(messages):
    if len(messages["WARN"]) + len(messages["ERR"]) > 0:
        app.logger.error(select_messages(messages["ERR"]))
        app.logger.warning(select_messages(messages["WARN"]))

def clear_data(steps):
    app.logger.info(f"Clear data: {steps}")
    amc_command("db", "clear", steps, app=app)
    io_adapt_menu()

@socketio.on("doc-update")
def io_doc_update(t):
    if not t:
        return { "error": "Document type missing" }
    app.logger.info(f"Doc update: {t} for {get_var('project_name')}")
    emit_progress("begin-command")

    if t == "sujet":
        emit_progress("t", _('t.clear'))
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
                                      "--progression-id", "MAJ", app=app)
    app.logger.info(f"Variables: {variables}")

    e = len(messages["ERR"])
    if t == "sujet" and e == 0:
        emit_progress("t", _('t.layouts'))
        amc_command("meptex",
                    "--store-defects",
                    "--progression-id", "MEP",
                    "--progression", "1",
                    messages=messages, variables=variables, app=app)
        db = get_db()
        emit_progress("defects", db.defects_class())

    emit_progress("end-command")
    show_messages(messages)
    io_adapt_menu()
    io_doc_type(t)

@app.route("/layout/<student>/<page>/<filename>")
def get_layout_file(student, page, filename):
    return send_file(f"{temp_dir}/{get_session()}/{student}/{page}/{filename}")
    
def layout_set_page(student, page):
    rep = f"{temp_dir}/{get_session()}/{student}/{page}"
    Path(rep).mkdir(parents=True, exist_ok=True)
    messages, variables = amc_command(
        "db", "layout-image",
        f"{student}/{page}",
        "--dest-file", f"{rep}/layout",
        "--css-url", "/static/svg.css",
        app=app)
    log_messages(messages)
    url = f"/layout/{student}/{page}/layout.svg"
    emit("layout-set-page", [f"{student}/{page}", url])

@socketio.on("layout-init")
def io_layout_init():
    layout_set_page(1, 1)
    
@socketio.on("layout-add")
def io_layout_add(data):
    db = get_db(modules=("layout",))
    page, delta = data
    student, page = list(map(int, page.split("/")))
    student, page = db.layout_page_add(student, page, delta)
    layout_set_page(student, page)

@app.route("/print_dialog.html")
def io_print_dialog():
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

@socketio.on("print-to-printer")
def io_print_to_printer(data):
    student1, student2, printer = data
    emit_progress("begin-command")
    emit_progress("t", _('t.print_to', printer=printer))
    messages, variables = amc_command(
        "imprime",
        "--methode", "cups",
        "--imprimante", printer,
        "--student-min", student1,
        "--student-max", student2,
        app=app
    )
    log_messages(messages)
    emit_progress("end-command")
    n = show_messages(messages)
    emit("print-done")
    if n==0:
        emit("dialog",
             render_template(
                 "warn_dialog.html",
                 err = "", warn = "",
                 info = _('msg.printing.done')))

@socketio.on("print-to-files")
def io_print_to_files(data):
    student1, student2 = data
    app.logger.info(f"Printing <{get_var('project_name')}> to files: {student1}--{student2}")
    rep = f"{temp_dir}/{get_session()}/printed/{get_var('project_name')}"
    Path(rep).mkdir(parents=True, exist_ok=True)
    for f in os.listdir(rep):
        os.remove(f"{rep}/{f}")
    emit_progress("begin-command")
    emit_progress("t", _('t.print.files'))
    messages, variables = amc_command(
        "imprime",
        "--methode", "file",
        "--student-min", student1,
        "--student-max", student2,
        "--progression-id", "PRT",
        "--progression", "1",
        "--output", rep,
        app=app
    )
    log_messages(messages)
    emit_progress("end-command")
    n = show_messages(messages)
    if n==0:
        emit("print-done")
        emit("print-to-files",
             f"/printed/{get_var('project_name')}/printed.zip")

def send_dir_as_zip(path, name=None, recursive=True,
                    filename=None, exclude=None):
    exclude_files = set(exclude.split(",")) if exclude else set()
    if name is None:
        name = re.sub(r'.*/', "", path) + ".zip"
    data = io.BytesIO()
    with zipfile.ZipFile(data, mode='w') as z:
        if recursive:
            for root, dirs, files in os.walk(path):
                subroot = root.replace(path, ".", 1)
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
    rep = f"{temp_dir}/{get_session()}/printed/{project}"
    return send_dir_as_zip(rep, name="printed.zip", recursive=False)

@socketio.on('scans-mode-change')
def io_scans_mode_change(m):
    change_option("auto_capture_mode", m)

@socketio.on('scans-mode')
def io_scans_mode():
    m = get_option("auto_capture_mode")
    if m is not None:
        emit("scans-mode", m)
    else:
        app.logger.warning("Options: auto_capture_mode not found")
        emit("scans-mode", -1)

def lock_scans_mode():
    m = int(get_option("auto_capture_mode"))
    if m is None or m < 0:
        m = 0
        emit_progress("scans-mode", m)
        change_option("auto_capture_mode", m)
    emit_progress("lock-photocopy")
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

    questions_textpos = db.questions_with_textpos()

    n_complete, n_incomplete, missing = db.counts()
    n_failed = db.n_failed()
    
    pages = db.capture_pages(threshold, threshold_up)
    for p in pages:
        p["sens-level"] = discretize(p.get("sensitivity"),
                                     [ 6, 8, 9, 9.5 ])
        p["mse-level"] = discretize(p.get("mse"),
                                    [ 4, 6, 10, 15 ])
    app.logger.info(f"Scans report: {len(pages)} pages")
    if pages:
        emit_progress("lock-photocopy")
    else:
        emit_progress("unlock-photocopy")
    return render_template('scans_report.html',
                           n_complete=n_complete, n_incomplete=n_incomplete,
                           n_failed=n_failed,
                           questions_textpos=questions_textpos,
                           pages=pages)

@socketio.on('n-incomplete-details')
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
        
    emit("dialog",
         render_template(
             "warn_dialog.html",
             err = "",
             warn = "",
             info = render_template("incomplete_details.html",
                                    n_incomplete=n_incomplete,
                                    missing=miss_sorted)))

@app.route('/scans_report.html')
def u_scans_report():
    threshold = float(get_option("seuil"))
    threshold_up = float(get_option("seuil_up"))
    emit_progress("thresholds", [threshold, threshold_up])
    return scans_report(threshold, threshold_up)

@app.route('/failed_report.html')
def u_failed_report():
    db = get_db()
    purl = "/fs/" + get_var("project_name") + "/"
    failed = db.failed_scans()
    scans = []
    for f in failed:
        d, fn = os.path.split(f[0])
        url = purl + f[0].replace("%PROJET/", "", 1)
        scans.append({ "filename": f[0], "file": fn, "url": url })
    return render_template('failed_report.html',
                           scans=scans)

@socketio.on('failed-delete')
def io_failed_delete(filename):
    db = get_db()
    n = db.failed_delete(filename)
    if n:
        emit("failed-report")
    else:
        emit("tab-scans")

@socketio.on('failed-pre-process')
def io_failed_pre_process(filename):
    pdir = project_dir()
    orig_path = filename.replace("%PROJET", pdir, 1)
    d, fn = os.path.split(orig_path)
    pp_file = "/cr/diagnostic/" + fn + ".png"
    pp_path = pdir + pp_file
    pp_url  = "/fs/" + get_var("project_name") + pp_file

    amc_command(
        "analyse",
        "--debug-image-dir", f"{pdir}/cr/diagnostic",
        "--no-tag-overwritten",
        orig_path)
        
    emit("failed-pp-url", pp_url)

@app.route('/set_thresholds.html', methods=['POST'])
def x_set_thresholds():
    seuil = float(request.json.get('seuil'))
    seuil_up = float(request.json.get('seuil_up'))
    change_option("seuil", seuil)
    change_option("seuil_up", seuil_up)
    return scans_report(seuil, seuil_up)

@app.route("/manual/<student>/<page>/<copy>/<filename>")
def get_manual_file(student, page, copy, filename):
    return send_file(f"{temp_dir}/{get_session()}/{student}/{page}/{copy}/{filename}")
    
@app.route('/scans_page_select.html', methods=['POST'])
def x_scans_page_select():
    student = request.json.get('student')
    page = request.json.get('page')
    copy = request.json.get('copy')
    question = request.json.get('question')
    rep = f"{temp_dir}/{get_session()}/{student}/{page}/{copy}"
    Path(rep).mkdir(parents=True, exist_ok=True)

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
        *params,
        app=app)
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
    db = get_db()
    zooms = sorted(db.page_zooms(student, page, copy), key=lambda z: z['prop'])
    for z in zooms:
        z["image"] = "data:image/png;base64," + base64.b64encode(z["imagedata"]).decode("utf-8")
    return render_template("zooms.html", zooms=zooms);

@socketio.on('set-manual')
def io_set_manual(data):
    student, page, copy, question, answer, ticked, all_page = data
    db = get_db()
    db.set_manual(student, page, copy, question, answer, ticked, all_page,
                  app=app)
    emit("tick-box", [question, answer, ticked])

@socketio.on('revert-manual')
def io_revert_manual(data):
    student, page, copy = data
    threshold = float(get_option("seuil"))
    threshold_up = float(get_option("seuil_up"))
    db = get_db()
    boxes = db.get_boxes_status(student, page, copy,
                                threshold, threshold_up)
    db.revert_manual(student, page, copy)
    # update view
    emit("disallow-revert")
    for b in boxes:
        if b["auto_ticked"] != b["manual"]:
            emit("tick-box", [ b["question"], b["answer"], b["auto_ticked"] ])

@app.route('/pages/<question>')
def j_pages_with_question(question):
    db = get_db()
    pages = db.pages_with_question(question)
    return pages
            
@socketio.on('add-student')
def io_add_student(student):
    app.logger.info(f"Add student: {student}")
    m = lock_scans_mode()
    db = get_db()
    first_page, copy = db.add_student(student, m)
    if first_page:
        emit("scans-page-select", [student, first_page, copy])
        io_adapt_menu()

@app.route('/show_marks.html')
def x_show_marks():
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

    emit_progress("n-marks", len(marks))
        
    return render_template("show_marks.html",
                           marks=marks, nmarks=len(marks),
                           mean=mean, full=full,
                           classes=classes)

@socketio.on('do-mark')
def io_do_mark(update):
    messages = {}
    variables = {}
    emit_progress("begin-command")
    if update:
        emit_progress("t", _('t.mark.extract'))
        amc_command(
            "prepare",
            "--mode", "b",
            "--progression-id", "MAJ", "--progression", "1",
            messages=messages, variables=variables, app=app
        )
    emit_progress("t", _('t.mark.compute'))
    amc_command(
        "note",
        "--progression-id", "GRD",
        "--progression", "1",
        messages=messages, variables=variables, app=app
    )
    emit_progress("end-command")
    show_messages(messages)
    emit_progress("update-marks")
    emit_progress("update-identification")

def students_list_file():
    path = get_option("listeetudiants")
    pdir = project_dir()
    if path:
        path = path.replace('%PROJETS/', projects_dir() + "/", 1)
        path = path.replace('%PROJET/', pdir + "/", 1)

        if not os.path.isfile(path):
            path = None
            change_option("listeetudiants", None)
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
            change_option("listeetudiants", "%PROJET/" + filename)
            path = f"{pdir}/{filename}"
                          
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

def unique_keys(rows):
    if not rows:
        return []
    ukeys = []
    for k in rows[0].keys():
        x = [r[k] for r in rows]
        if len(x) == len(list(set(x))):
            ukeys.append(k)
    return ukeys

def first_of(l, *proposals):
    unil = {}
    for x in l:
        unil[ unidecode(x.lower()) ] = x
    for x in proposals:
        if unil.get(x):
            return unil[x]
    return None

def students_flat_list():
    lkey = get_option("liste_key")
    path = students_list_file()
    rows = list_file_read(path)
    if not rows:
        return []

    ks = list(rows[0].keys())
    k_name = first_of(ks, "name", "prenom")
    k_surname = first_of(ks, "surname", "nom")

    flat = []
    for r in rows:
        n = []
        if r.get(k_surname):
            n.append(r[k_surname])
        if r.get(k_name):
            n.append(r[k_name])
        flat.append( [r[lkey], " ".join(n), None] )

    flat.sort(key=lambda x: x[1])
    return flat

@socketio.on('change-lkey')
def io_change_lkey(data):
    lkey, force = data
    change_option("liste_key", lkey)
    if force:
        db = get_db()
        db.clear_associations()
        emit_progress("update-identification")

@socketio.on('change-acode')
def io_change_lkey(acode):
    change_option("assoc_code", acode)

@app.route('/identification.html')
def x_identification():
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
    n_id = db.n_identifications()
    n_students = db.n_graded_students()
    acode = get_option("assoc_code")
    if not acode:
        if len(codes) == 1:
            acode = codes[0]
            change_option("assoc_code", acode)
        
    return render_template(
        "identification.html",
        filename=lname, ukeys=ukeys, lkey=lkey,
        codes=codes, acode=acode,
        n_id=n_id, n_students=n_students)

@socketio.on('association-clear')
def io_association_clear():
    db = get_db()
    db.clear_associations()
    emit_progress("update-identification")
    
@socketio.on('association-auto')
def io_association_auto():
    messages, variables = amc_command(
            "association-auto",
            app=app
    )
    show_messages(messages)
    emit_progress("update-identification")

@app.route("/assoc_sheets.html")
def x_assoc_sheets():
    db = get_db()
    sheets = db.get_assoc_sheets()
    return render_template("assoc_sheets.html", sheets=sheets)

@app.route("/students_list.html")
def x_students_list():
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
    db = get_db()
    path = db.get_namefield_image(student, copy)
    if path:
        path = f"/fs/{get_var('project_name')}/cr/{path}"
    return render_template("namefield.html",
                           student=student, copy=copy,
                           path=path)

@socketio.on('associate')
def io_associate(data):
    student, copy, student_id = data
    db = get_db()
    to_rm = db.associate(student, copy, student_id)
    app.logger.info(f"Associated: [{student},{copy}] <-> \"{student_id}\" | {to_rm}")
    emit("update-association",
         [ student, copy, student_id, to_rm ])

@socketio.on('export-config')
def io_export_config():
    emit("selected-config",
         get_options(["format_export", "export_include_abs", "export_ods_stats",
                      "export_ods_statsindic", "export_ods_group", "export_ods_groupsep",
                      "export_csv_ticked"]))

@socketio.on('set-config')
def io_set_config(data):
    change_option(*data)

def send_dir_list(t, subdir,
                  zip_text="Download",
                  filename=None,
                  exclude=None):
    if not t:
        t = int(datetime.datetime.now().timestamp())
    rep = project_dir() + "/" + subdir
    fsdir = f"/fs/{get_var('project_name')}/{subdir}"
    files = [ (f,
              f"{fsdir}/{quote(f)}",
              os.path.getmtime(f"{rep}/{f}") > t)
             for f in os.listdir(rep)
             if os.path.isfile(f"{rep}/{f}") ]
    files.sort()
    args = []
    if filename: args.append(f"filename={filename}")
    if exclude: args.append(f"exclude={exclude}")
    return render_template("files.html", files=files, fsdir=fsdir,
                           args="&".join(args),
                           zip_text=zip_text)

@app.route("/exported_files.html", methods=['POST'])
def x_exported_files():
    t = request.json.get('t')
    project = get_var("project_name")
    return send_dir_list(t, "exports",
                         zip_text=_('files.all'),
                         filename=f"{project}-exported.zip")

@socketio.on('do-export')
def io_do_export():
    t = int(datetime.datetime.now().timestamp())
    emit_progress("begin-command")
    emit_progress("t", _('t.export'))
    module = get_option("format_export")
    path = project_dir() + "/exports/marks." + module.lower()
    messages, variables = amc_command(
        "export",
        "--module", module,
        "--output", path,
        "--export-ods-filter",
        app=app
    )
    emit_progress("end-command")
    emit_progress("update-exported-files", t)
    show_messages(messages)
        
@socketio.on('annotation-config')
def io_annotation_config():
    emit("selected-config",
         get_options(
             ["regroupement_type", "regroupement_compose",
              "add_corrected", "modele_regroupement"]))

def unlink_indiv_annotated():
    rep = project_dir() + "/cr/corrections/pdf"
    for f in os.listdir(rep):
        path = f"{rep}/{f}"
        if os.path.isfile(path) and f != "all-students.pdf":
            os.unlink(path)
    
@socketio.on("do-annotate")
def io_do_annotate():
    single = (get_option("regroupement_type") == "ALL")
    if not single:
        unlink_indiv_annotated()
    t = int(datetime.datetime.now().timestamp())
    args = []
    emit_progress("begin-command")
    emit_progress("t", _('t.annotate'))
    if single:
        args += ["--single-output", "all-students.pdf"]
    messages, variables = amc_command(
        "annotate",
        *args,
        "--progression-id", "ANNOT",
        "--progression", "1",
        app=app
    )
    emit_progress("end-command")
    emit_progress("update-annotated-files", t)
    show_messages(messages)

@app.route('/annotated_files.html', methods=['POST'])
def x_annotated_files():
    t = request.json.get('t')
    project = get_var("project_name")
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

if __name__ == '__main__':
    socketio.run(app, debug=True)
