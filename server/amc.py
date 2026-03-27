
import re
import os
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
from urllib.parse import quote
from unidecode import unidecode
from lxml import etree
import threading

from db import Amcdb
from command import amc_command
from basic import *

from flask import Flask, render_template, request, send_file
from flask_socketio import SocketIO, emit

TEMPLATES_DIR="/usr/share/auto-multiple-choice/models"

app = Flask(__name__)

app.config.from_mapping(
    SECRET_KEY='dev',
)
socketio = SocketIO(app)
app.socketio = socketio

temp_dir = tempfile.mkdtemp(prefix="amcapp")

app.logger.info(f"Temp dir: {temp_dir}")

def get_db(modules=(), uid=None):
    if uid is None:
        uid = request.sid
    db = get_thread_var("db", app.logger)
    if not db:
        app.logger.warning(f"Create DB for thread {threading.get_ident()} ({uid})")
        app.logger.debug(
            f"Active threads: " +
            ", ".join([str(x.ident)
                       for x in threading.enumerate()]))
        db = Amcdb(project_dir(uid), modules)
        set_thread_var("db", db)
    return db

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/<uid>/fs/<path:path>', methods=['GET', 'POST'])
def fs_file(uid, path):
    if uid not in users:
        return { "error": "wrong user id" }
    path = path.replace("..", "")
    path = projects_dir(uid) + "/" + path
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
        if os.path.isfile(path):
            return send_file(path,
                             as_attachment=attach)
        elif os.path.isdir(path):
            return send_dir_as_zip(path,
                                   filename=request.args.get('filename'),
                                   exclude=request.args.get('exclude'))
        else:
            return { "error": "Unknown path type" }

def is_project_dir(path):
    return os.path.isdir(path) and os.path.isfile(path + "/options.xml")

def projects_list(projects_dir):
    return sorted([ path for path in os.listdir(projects_dir)
             if is_project_dir(projects_dir + "/" + path) ])

@socketio.on('projects-list')
def io_projects_list():
    projects = projects_list(projects_dir(request.sid))
    emit("projects-list",
         render_template("projects_list.html", projects=projects))

@socketio.on('project-name')
def io_project_name(name):
    set_project(name)
    if name:
        amc_command(request.sid, "db", "upgrade", app=app)
        emit("ncopies", str(ncopies(request.sid)))
    adapt_menu()

def adapt_menu(uid=None):
    project = get_var("project_name", uid=uid)
    if project:
        menus = { "source": True }
        db = get_db()
        if db.layout_npages():
            menus["scans"] = True
            if db.capture_npages():
                menus["grading"] = True
    else:
        menus = { "main": True }
        
    emit("menu", menus)

def copy_files_progress(src_folder, dst_folder):
    nfiles = 0
    for root, dirs, files in os.walk(src_folder):
        nfiles += len(files)
    emit("p", 0)
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
            emit("p", n/nfiles)
    return n, nfiles

@socketio.on('project-clone')
def io_project_clone(name):
    clone_name = project_clone_name(request.sid, name)
    source = project_dir(request.sid, p=name)
    dest = project_dir(request.sid, p=clone_name)
    emit("t", "Cloning project…")
    emit("begin-command")
    n, ntotal = copy_files_progress(source, dest)
    emit("end-command")
    io_projects_list()
    if n==ntotal:
        emit("dialog",
             render_template(
                 "warn_dialog.html",
                 err = "",
                 warn = "",
                 info = f"Project cloned to {clone_name}."))
    else:
        emit("dialog",
             render_template(
                 "warn_dialog.html",
                 err = f"Errors while cloning to {clone_name}: only {n} files copied out of {ntotal}.",
                 warn = "",
                 info = ""))

@socketio.on('project-delete')
def io_project_clone(name):
    rep = project_dir(request.sid, p=name)
    shutil.rmtree(rep)
    io_projects_list()

@socketio.on('project-rename')
def io_project_rename(data):
    old, new = data
    new.replace('/','')

    if new == old:
        app.logger.info(f"Project {old} not renamed")
        io_projects_list()
        return

    src = project_dir(request.sid, p=old)
    dst = project_dir(request.sid, p=new)
    if(os.path.exists(dst)):
        emit("dialog",
             render_template(
                 "warn_dialog.html",
                 err = f'Can\'t rename "{old}" to "{new}": "{new}" already exists.',
                 warn = "",
                 info = ""))
    else:
        app.logger.info(f'Project "{old}" renamed to "{new}"')
        os.rename(src, dst)
        io_projects_list()

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
        t = tarfile.open(filename)
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
                    
@socketio.on('project-new')
def io_project_new():
    emit("project-new",
         render_template(
             "project_new.html",
             groups=template_groups, templates=templates
         ))

def create_project_dirs(rep):
    for d in ("", "/data", "/exports", "/scans", "/anonymous",
              "/cr", "/cr/corrections", "/cr/corrections/jpg", "/cr/corrections/pdf",
              "/cr/diagnostic"):
        if not os.path.exists(rep + d):
            os.mkdir(rep + d)

def check_unused_name(name, uid=None, warn=True):
    if uid is None:
        uid = request.sid
    rep = project_dir(uid, p=name)
    if os.path.exists(rep):
        if warn:
            emit("dialog",
                 render_template(
                     "warn_dialog.html",
                     err = f"Can't create project \"{name}\": some file or directory already exists with this name.",
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
        emit("project-open", name)

def info_remove_root(m, root, uid=None):
    if uid:
        n = add_var("files_n", 1, uid=uid)
        total = get_var("files_total", uid=uid)
        socketio.emit("p", n/total, to=uid)
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
        
def tar_extract_options_siblings(tarf, dest, uid=None):
    if uid:
        socketio.emit("t", "Looking for the options file…", to=uid)
    root = None
    total = 0
    for m in tarf.getmembers():
        total += 1
        app.logger.debug(f"tar> {m.name}")
        o = re.match(r'^(.*/|)options.xml$', m.name)
        if o:
            root = o[1]
            app.logger.debug("found root: " + root)
    set_var("files_total", total, uid=uid)
    set_var("files_n", 0, uid=uid)
    if root:
        if uid:
            socketio.emit("t", "Extracting…", to=uid)
            socketio.emit("p", 0, to=uid)
        if not os.path.exists(dest):
            os.mkdir(dest)
        tarf.extractall(
            dest, filter=lambda m,p: info_remove_root(m, root, uid=uid))
        return True
    else:
        app.logger.error(f"Can't find options.xml in archive")
        return False

def zip_extract_options_siblings(zipf, dest, uid=None):
    if uid:
        socketio.emit("t", "Looking for the options file…", to=uid)
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
        if uid:
            socketio.emit("t", "Extracting…", to=uid)
            socketio.emit("p", 0, to=uid)
        if not os.path.exists(dest):
            os.mkdir(dest)
        n = 0
        for m in zipf.infolist():
            n += 1
            if m.filename.startswith(root):
                m.filename = m.filename.replace(root, "", 1)
                if m.filename != "":
                    zipf.extract(m, dest)
            if uid:
                socketio.emit("p", n/total, to=uid)
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
        emit("project-open", name)

def create_from_source_file(uid, rep, f, fn):
    create_project_dirs(rep)
    f.save(f"{rep}/{fn}")
    create_options_file(rep, fn)
    socketio.emit("end-command", to=uid)
    return { "ok": True }

def create_from_archive(uid, rep, f):
    socketio.emit("t", "Saving archive…", to=uid)
    handle, fn = tempfile.mkstemp()
    f.save(fn)
    ok = False
    if zipfile.is_zipfile(fn):
        zipf = zipfile.ZipFile(fn)
        ok = zip_extract_options_siblings(zipf, rep, uid=uid)
    elif tarfile.is_tarfile(fn):
        tarf = tarfile.open(fn)
        ok = tar_extract_options_siblings(tarf, rep, uid=uid)
    else:
        app.logger.error("Archive type unknown")
    socketio.emit("end-command", to=uid)
    return { "ok": ok }

@app.route('/<uid>/upload/<dest>', methods=['POST'])
def file_upload(uid, dest):
    if 'file' not in request.files:
        return { 'error': 'File missing' }
    f = request.files['file']
    fn = f.filename.replace("/", "").replace(" ","_")
    ext = ""
    if r := re.match(r'.*\.([a-z0-9]{1,3})$', fn):
        ext = r[1].lower()
    if fn == '':
        return { 'error': 'Empty file' }
    if dest=="create":
        name = request.form['name']
        rep = check_unused_name(name, uid=uid, warn=False)
        if rep:
            socketio.emit("p", 0, to=uid)
            if re.match(r'.*\.(tgz|tar\.gz|tar|zip)', fn, re.IGNORECASE):
                return create_from_archive(uid, rep, f)
            elif re.match(r'.*\.(tex|latex|txt)', fn, re.IGNORECASE):
                return create_from_source_file(uid, rep, f, fn)
            else:
                socketio.emit("end-command", to=uid)
                return { "error": f"File {fn} can't be used to create a project" }
        else:
            socketio.emit("end-command", to=uid)
            return { "error": f"Can't create project {name}: already used" }
    elif dest=="project":
        rep = project_dir(uid);
        socketio.emit("end-command", to=uid);
        if rep:
            f.save(f"{rep}/{fn}");
            return { "ok": True }
        else:
            return { "error": f"Project unknown" }
    elif dest=="scans":
        project_name = request.form['project_name']
        rep = f"{temp_dir}/{uid}/scans"
        Path(rep).mkdir(parents=True, exist_ok=True)
        n, path = tempfile.mkstemp(suffix="." + ext, dir=rep)
        f.save(path)
        n, list_path = tempfile.mkstemp(prefix="list-", dir=rep)
        with open(list_path, "w") as f:
            print(path, file=f)
        socketio.emit("begin-command", to=uid)
        socketio.emit("t", "Extracting scans images…", to=uid)
        messages, variables = amc_command(
            uid, "getimages",
            "--list", list_path,
            "--copy-to", project_dir(uid) + "/scans",
            "--progression-id", "GETI", app=app
        )
        socketio.emit("t", "Automatic data capture…", to=uid)
        amc_command(
            uid, "analyse",
            "--liste-fichiers", list_path,
            "--unlink-on-global-error",
            "--progression-id", "SCAN",
            "--progression", "1",
            messages=messages, variables=variables, app=app
        )
        socketio.emit("end-command", to=uid)
        lock_scans_mode()
        show_messages(messages)
        adapt_menu()
        return { "ok": True }
    else:
        socketio.emit("end-command", to=uid)
        return { "error": f"Unknown upload dest: {dest}" }

    
@socketio.on('ncopies')
def io_ncopies(n):
    n = int(n)
    change_option(request.sid, "nombre_copies", n)

@socketio.on('source-code')
def io_source_code(filename):
    if not filename:
        filename = main_source_file(request.sid)
    if not filename:
        filename = default_source_file(request.sid)
        change_option(request.sid, "texsrc", filename)
    emit("source-name", filename)

    mode = "plain_text"
    if re.match(r'.*\.(tex|latex)$', filename, re.IGNORECASE):
        mode = "latex"
    elif re.match(r'.*\.(yml|yaml)$', filename, re.IGNORECASE):
        mode = "yaml"
    elif re.match(r'.*\.(csv)$', filename, re.IGNORECASE):
        mode = "csv"

    fn = project_dir(request.sid) + "/" + filename
    filecontent = ""
    if os.path.exists(fn):
        with open(fn, "r") as f:
            filecontent = f.read()
    emit("source-code", [mode, filecontent])

@socketio.on('source-save')
def io_source_save(filename, code):
    with open(project_dir(request.sid) + "/" + filename, "w") as f:
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
    
@socketio.on("files-list")
def io_files_list(all_files):
    base = project_dir(request.sid)
    main_source = main_source_file(request.sid)
    files = [ (file_level(base, main_source, f), f)
              for f in os.listdir(base) ]
    if not all_files:
        files = [ x for x in files if x[0]<=0 ]
    emit("files-list",
         render_template("files_list.html",
                         files=sorted(files),
                         base_url=f"/{request.sid}/fs/{get_var('project_name')}"))

@socketio.on("project-delete-file")
def io_project_delete_file(data):
    filename, all_files = data
    filename = filename.replace("/", "")
    base = project_dir(request.sid)
    if base:
        try:
            os.unlink(f"{base}/{filename}")
        except e:
            app.logger.error("Can't delete project file" + e)
            return
        io_files_list(all_files)
    else:
        app.logger.error("Can't delete project file: unknown project")

@socketio.on("doc-type")
def io_doc_type(t):
    if not t:
        emit("document-content",
             [False, render_template("document_choose.html")])

    if t=="calage":
        db = get_db(modules=("layout",))
        if db.layout_npages() > 0 :
            emit("document-content",
                 [False, False, render_template("document_calage.html")])
            layout_set_page(1, 1)
        else:
            emit("document-content",
                 [False, False, render_template("document_missing.html")])

    else:
        doc = "/DOC-" + t + ".pdf"
        filename = project_dir(request.sid) + doc

        if os.path.isfile(filename):
            can_print = False
            danger = False
            if t == "sujet":
                can_print = True
                db = get_db()
                if db.capture_npages() or db.print_timestamp():
                    danger = True
                
            url = "/" + request.sid + "/fs/" + get_var("project_name") + doc
            emit("document-content",
                 [can_print, danger, render_template("document_content.html",
                                                     url=url)])
        else:
            emit("document-content",
                 [False, False, render_template("document_missing.html")])

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
    amc_command(request.sid, "db", "clear", steps, app=app)
    adapt_menu()

@socketio.on("doc-update")
def io_doc_update(t):
    if not t:
        return { "error": "Document type missing" }
    app.logger.info(f"Doc update: {t} for {get_var('project_name')}")
    emit("begin-command")

    if t == "sujet":
        emit("t", "Clear all project data…")
        clear_data("mep:")

    mode = {
        "sujet": "s[]",
        "catalog": "C",
        "corrige": "S",
        "indiv-solution": "k",
    }.get(t)

    if not mode:
        app.logger.error(f"Unknown mode: {t}")
        return

    messages, variables = amc_command(request.sid,
                                      "prepare",
                                      "--mode", mode,
                                      "--progression-id", "MAJ", app=app)
    app.logger.info(f"Variables: {variables}")

    e = len(messages["ERR"])
    if t == "sujet" and e == 0:
        emit("t", "Detecting layouts…")
        amc_command(request.sid,
                    "meptex",
                    "--progression-id", "MEP",
                    "--progression", "1",
                    messages=messages, variables=variables, app=app)

    emit("end-command")
    show_messages(messages)
    adapt_menu()
    io_doc_type(t)

@app.route("/<sid>/layout/<student>/<page>/<filename>")
def get_layout_file(sid, student, page, filename):
    return send_file(f"{temp_dir}/{sid}/{student}/{page}/{filename}")
    
def layout_set_page(student, page):
    rep = f"{temp_dir}/{request.sid}/{student}/{page}"
    Path(rep).mkdir(parents=True, exist_ok=True)
    messages, variables = amc_command(request.sid, "db", "layout-image",
                                      f"{student}/{page}",
                                      "--dest-file", f"{rep}/layout",
                                      "--css-url", "/static/svg.css",
                                      app=app)
    log_messages(messages)
    url = f"/{request.sid}/layout/{student}/{page}/layout.svg"
    emit("layout-set-page", [f"{student}/{page}", url])

@socketio.on("layout-add")
def io_layout_add(data):
    db = get_db(modules=("layout",))
    page, delta = data
    student, page = list(map(int, page.split("/")))
    student, page = db.layout_page_add(student, page, delta)
    layout_set_page(student, page)

@socketio.on("print-dialog")
def io_print_dialog():
    db = get_db()
    student_min, student_max = db.student_range()
    conn = cups.Connection()
    ps = conn.getPrinters()
    printers = []
    for i in sorted(list(ps)):
        printers.append({
            "id": i,
            "name": f"{i} ({ps[i].get('printer-info','?')})",
        })              
    emit("print-dialog",
         render_template('print_dialog.html',
                         printers=printers,
                         student_min=student_min, student_max=student_max))

@socketio.on("print-to-printer")
def io_print_to_printer(data):
    student1, student2, printer = data
    emit("begin-command")
    emit("t", f"Printing subject to {printer}…")
    messages, variables = amc_command(
        request.sid, "imprime",
        "--methode", "cups",
        "--imprimante", printer,
        "--student-min", student1,
        "--student-max", student2,
        app=app
    )
    log_messages(messages)
    emit("end-command")
    n = show_messages(messages)
    emit("print-done")
    if n==0:
        emit("dialog",
             render_template(
                 "warn_dialog.html",
                 err = "", warn = "",
                 info = "Printing done!"))

@socketio.on("print-to-files")
def io_print_to_files(data):
    student1, student2 = data
    app.logger.info(f"Printing <{get_var('project_name')}> to files: {student1}--{student2}")
    rep = f"{temp_dir}/{request.sid}/printed/{get_var('project_name')}"
    Path(rep).mkdir(parents=True, exist_ok=True)
    for f in os.listdir(rep):
        os.remove(f"{rep}/{f}")
    emit("begin-command")
    emit("t", f"Printing subject to files…")
    messages, variables = amc_command(
        request.sid, "imprime",
        "--methode", "file",
        "--student-min", student1,
        "--student-max", student2,
        "--progression-id", "PRT",
        "--progression", "1",
        "--output", rep,
        app=app
    )
    log_messages(messages)
    emit("end-command")
    n = show_messages(messages)
    if n==0:
        emit("print-done")
        emit("print-to-files",
             f"/{request.sid}/printed/{get_var('project_name')}/printed.zip")

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
        
@app.route("/<sid>/printed/<project>/printed.zip")
def build_printed_zip(sid, project):
    rep = f"{temp_dir}/{sid}/printed/{project}"
    return send_dir_as_zip(rep, name="printed.zip", recursive=False)

@socketio.on('scans-mode-change')
def io_scans_mode_change(m):
    change_option(request.sid, "auto_capture_mode", m)

@socketio.on('scans-mode')
def io_scans_mode():
    m = get_option(request.sid, "auto_capture_mode")
    if m is not None:
        emit("scans-mode", m)
    else:
        app.logger.warning("Options: auto_capture_mode not found")
        emit("scans-mode", -1)

def lock_scans_mode(uid=None):
    if uid is None:
        uid = request.sid
    m = int(get_option(uid, "auto_capture_mode"))
    if m is None or m < 0:
        m = 0
        emit("scans-mode", m)
        change_option(request.sid, "auto_capture_mode", m)
    socketio.emit("lock-photocopy", to=uid)
    return m

def scans_report(threshold, threshold_up):
    db = get_db()
    pages = db.capture_pages(threshold, threshold_up)
    app.logger.info(f"Scans report: {len(pages)} pages")
    if pages:
        emit("lock-photocopy")
    else:
        emit("unlock-photocopy")
    emit("scans-report",
         render_template('scans_report.html',
                         pages=pages))

@socketio.on('scans-report')
def io_scans_report():
    threshold = float(get_option(request.sid, "seuil"))
    threshold_up = float(get_option(request.sid, "seuil_up"))
    emit("thresholds", [threshold, threshold_up])
    scans_report(threshold, threshold_up)

@socketio.on('set-thresholds')
def io_set_thresholds(data):
    change_option(request.sid, "seuil", data[0])
    change_option(request.sid, "seuil_up", data[1])
    scans_report(float(data[0]), float(data[1]))

@app.route("/<sid>/manual/<student>/<page>/<copy>/<filename>")
def get_manual_file(sid, student, page, copy, filename):
    return send_file(f"{temp_dir}/{sid}/{student}/{page}/{copy}/{filename}")
    
@socketio.on('scans-page-select')
def io_scans_page_select(data):
    student, page, copy = data
    rep = f"{temp_dir}/{request.sid}/{student}/{page}/{copy}"
    Path(rep).mkdir(parents=True, exist_ok=True)
    messages, variables = amc_command(request.sid, "db", "layout-image",
                                      f"{student}/{page}:{copy}",
                                      "--scan",
                                      "--dest-file", f"{rep}/manual",
                                      "--url-prefix", f"/{request.sid}/manual/{student}/{page}/{copy}/",
                                      app=app)
    log_messages(messages)
    url = f"/{request.sid}/manual/{student}/{page}/{copy}/manual.svg"

    with open(rep + "/manual.svg", "r") as svgf:
        svg = svgf.read()
    
    scans_page_zooms(student, page, copy)

    emit("scans-manual",
         render_template("manual_view.html",
                         svg=svg,
                         student=student, page=page, copy=copy))

    emit("update-ticked-zooms")

def scans_page_zooms(student, page, copy, uid=None):
    if uid is None:
        uid = request.sid
    db = get_db(uid=uid)
    zooms = sorted(db.page_zooms(student, page, copy), key=lambda z: z['prop'])
    for z in zooms:
        z["image"] = "data:image/png;base64," + base64.b64encode(z["imagedata"]).decode("utf-8")
    emit("scans-zooms",
         render_template("zooms.html", zooms=zooms))

@socketio.on('set-manual')
def io_set_manual(data):
    student, page, copy, question, answer, ticked = data
    db = get_db()
    db.set_manual(student, page, copy, question, answer, ticked,
                  uid=request.sid, app=app)
    emit("tick-box", [question, answer, ticked])

@socketio.on('revert-manual')
def io_revert_manual(data):
    student, page, copy = data
    threshold = float(get_option(request.sid, "seuil"))
    threshold_up = float(get_option(request.sid, "seuil_up"))
    db = get_db()
    boxes = db.get_boxes_status(student, page, copy,
                                threshold, threshold_up)
    db.revert_manual(student, page, copy)
    # update view
    emit("disallow-revert")
    for b in boxes:
        if b["auto_ticked"] != b["manual"]:
            emit("tick-box", [ b["question"], b["answer"], b["auto_ticked"] ])

@socketio.on('add-student')
def io_add_student(student):
    app.logger.info(f"Add student: {student}")
    m = lock_scans_mode()
    db = get_db()
    first_page, copy = db.add_student(student, m)
    if first_page:
        io_scans_report()
        emit("scans-page-select", [student, first_page, copy])
        io_scans_page_select([student, first_page, copy])
        adapt_menu()

@socketio.on('show-marks')
def io_show_marks():
    db = get_db()
    marks, maxis = db.get_marks()
    full = float(get_option(request.sid, "note_max"))
    if full == 0:
        if len(maxis) == 1:
            full = maxis[0]
        else:
            full = None
    if marks:
        mean = sum(marks)/len(marks)
    else:
        mean = None
    emit("show-marks",
         render_template("show_marks.html",
                         marks=marks, nmarks=len(marks),
                         mean=mean, full=full))

@socketio.on('do-mark')
def io_do_mark(update):
    messages = {}
    variables = {}
    emit("begin-command")
    if update:
        amc_command(
            request.sid, "prepare",
            "--mode", "b",
            "--progression-id", "MAJ", "--progression", "1",
            messages=messages, variables=variables, app=app
        )
    amc_command(
        request.sid, "note",
        "--progression-id", "GRD",
        "--progression", "1",
        messages=messages, variables=variables, app=app
    )
    emit("end-command")
    show_messages(messages)
    io_show_marks()
    io_identification()

def students_list_file(uid=None):
    if uid is None:
        uid = request.sid
    path = get_option(uid, "listeetudiants")
    pdir = project_dir(uid)
    if path:
        path = path.replace('%PROJETS/', projects_dir(uid) + "/", 1)
        path = path.replace('%PROJET/', pdir + "/", 1)
    else:
        filename = None
        for x in ('students.csv', 'students.txt',
                  'etudiants.csv', 'etudiants.txt'):
            if os.path.isfile(f"{pdir}/{x}"):
                filename = x
        if filename:
            change_option(uid, "listeetudiants", "%PROJET/" + filename)
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
    lkey = get_option(request.sid, "liste_key")
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
    change_option(request.sid, "liste_key", lkey)
    if force:
        db = get_db()
        db.clear_associations()
        io_identification()

@socketio.on('change-acode')
def io_change_lkey(acode):
    change_option(request.sid, "assoc_code", acode)

@socketio.on('identification')
def io_identification():
    path = students_list_file()
    if path:
        ldir, lname = os.path.split(path)
        rows = list_file_read(path)
        ukeys = unique_keys(rows)
    else:
        lname = None
        ukeys = []

    lkey = get_option(request.sid, "liste_key")
    if (not lkey) or (lkey not in ukeys):
        lkey = None
        for x in ('etud','etu','student','number','id','ID'):
            if x in ukeys:
                lkey = x
        if lkey:
            change_option(request.sid, "liste_key", lkey)

    db = get_db()
    codes = db.codes_list()
    n_id = db.n_identifications()
    n_students = db.n_graded_students()
    acode = get_option(request.sid, "assoc_code")
    if not acode:
        if len(codes) == 1:
            acode = codes[0]
            change_option(request.sid, "assoc_code", acode)
        
    emit("identification",
         render_template("identification.html",
                         filename=lname, ukeys=ukeys, lkey=lkey,
                         codes=codes, acode=acode,
                         n_id=n_id, n_students=n_students))

@socketio.on('association-clear')
def io_association_clear():
    db = get_db()
    db.clear_associations()
    io_identification()
    
@socketio.on('association-auto')
def io_association_auto():
    messages, variables = amc_command(
            request.sid, "association-auto",
            app=app
    )
    show_messages(messages)
    io_identification()

@socketio.on('assoc-sheets')
def io_assoc_sheets():
    db = get_db()
    sheets = db.get_assoc_sheets()
    emit("assoc-sheets",
         render_template("assoc_sheets.html", sheets=sheets))

    students = students_flat_list()
    back = {}
    for i in range(len(students)):
        back[students[i][0]] = i
    for s in sheets:
        eff = s[3] if s[3] is not None else s[2]
        i = back.get(eff)
        if i is not None:
            students[i][2] = True
    emit("students-list",
         render_template("students_list.html", students=students))

@socketio.on('select-assoc-sheet')
def io_select_assoc_sheet(data):
    student, copy = data
    db = get_db()
    path = db.get_namefield_image(student, copy)
    if path:
        path = f"/{request.sid}/fs/{get_var('project_name')}/cr/{path}"
    emit("namefield",
         render_template("namefield.html",
                         student=student, copy=copy,
                         path=path))

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
         get_options(request.sid,
                     ["format_export", "export_include_abs", "export_ods_stats",
                      "export_ods_statsindic", "export_ods_group", "export_ods_groupsep",
                      "export_csv_ticked"]))

@socketio.on('set-config')
def io_set_config(data):
    change_option(request.sid, *data)

def send_dir_list(t, subdir, signal,
                  zip_text="Download all",
                  filename=None,
                  exclude=None):
    if not t:
        t = int(datetime.datetime.now().timestamp())
    rep = project_dir(request.sid) + "/" + subdir
    fsdir = f"/{request.sid}/fs/{get_var('project_name')}/{subdir}"
    files = [ (f,
              f"{fsdir}/{quote(f)}",
              os.path.getmtime(f"{rep}/{f}") > t)
             for f in os.listdir(rep)
             if os.path.isfile(f"{rep}/{f}") ]
    files.sort()
    args = []
    if filename: args.append(f"filename={filename}")
    if exclude: args.append(f"exclude={exclude}")
    emit(signal,
         render_template("files.html", files=files, fsdir=fsdir,
                         args="&".join(args),
                         zip_text=zip_text))

@socketio.on('exported-files')
def io_exported_files(t):
    project = get_var("project_name")
    send_dir_list(t, "exports", "exported-files",
                  filename=f"{project}-exported.zip")

@socketio.on('do-export')
def io_do_export():
    t = int(datetime.datetime.now().timestamp())
    emit("begin-command")
    emit("t", "Exporting…")
    module = get_option(request.sid, "format_export")
    path = project_dir(request.sid) + "/exports/marks." + module.lower()
    messages, variables = amc_command(
        request.sid, "export",
        "--module", module,
        "--output", path,
        "--export-ods-filter",
        app=app
    )
    emit("end-command")
    io_exported_files(t)
    show_messages(messages)
        
@socketio.on('annotation-config')
def io_annotation_config():
    emit("selected-config",
         get_options(
             request.sid,
             ["regroupement_type", "regroupement_compose",
              "add_corrected", "modele_regroupement"]))

def unlink_indiv_annotated(uid):
    rep = project_dir(uid) + "/cr/corrections/pdf"
    for f in os.listdir(rep):
        path = f"{rep}/{f}"
        if os.path.isfile(path) and f != "all-students.pdf":
            os.unlink(path)
    
@socketio.on("do-annotate")
def io_do_annotate():
    single = (get_option(request.sid, "regroupement_type") == "ALL")
    if not single:
        unlink_indiv_annotated(request.sid)
    t = int(datetime.datetime.now().timestamp())
    args = []
    emit("begin-command")
    emit("t", "Annotating…")
    if single:
        args += ["--single-output", "all-students.pdf"]
    messages, variables = amc_command(
        request.sid, "annotate",
        *args,
        "--progression-id", "ANNOT",
        "--progression", "1",
        app=app
    )
    emit("end-command")
    io_annotated_files(t)
    show_messages(messages)

@socketio.on('annotated-files')
def io_annotated_files(t):
    project = get_var("project_name")
    send_dir_list(t, "cr/corrections/pdf", "annotated-files",
                  zip_text="Download all individual files",
                  filename=f"{project}-annotated.zip",
                  exclude="all-students.pdf")

if __name__ == '__main__':
    socketio.run(app, debug=True)
