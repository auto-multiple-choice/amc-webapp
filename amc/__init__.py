
import re
import os
from pathlib import Path
import shutil
import tempfile
import sys
import logging
import subprocess
import cups
import io
import zipfile
import tarfile
from lxml import etree

from amc.db import Amcdb

from flask import Flask, render_template, request, send_file
from flask_socketio import SocketIO, emit

TEMPLATES_DIR="/usr/share/auto-multiple-choice/models"

app = Flask(__name__)

app.config.from_mapping(
    SECRET_KEY='dev',
)
socketio = SocketIO(app)

users = {}

temp_dir = tempfile.mkdtemp(prefix="amcapp")

app.logger.info(f"Temp dir: {temp_dir}")

def set_var(name, value, uid=None):
    if uid is None:
        uid = request.sid
    if not users.get(uid):
        users[uid] = {}
    users[uid][name] = value

def get_var(name, uid=None):
    if uid is None:
        uid = request.sid
    if not users.get(uid):
        users[uid] = {}
    return users[uid].get(name)

def add_var(name, delta, uid=None):
    if uid is None:
        uid = request.sid
    if not users.get(uid):
        users[uid] = {}
    if not users[uid].get(name):
        users[uid][name] = 0
    users[uid][name] += delta
    return users[uid][name]

def set_project(name):
    set_var("project_name", name)

def get_db(modules=()):
    return Amcdb(project_dir(request.sid), modules)

def projects_dir(uid):
    return os.path.expanduser('~') + "/Projets-QCM"

def project_dir(uid, p=None):
    if not p:
        p = get_var("project_name", uid=uid)
    if p:
        return projects_dir(uid) + "/" + p
    else:
        return None

def project_clone_name(uid, name):
    d = projects_dir(uid)
    i = 0
    while i<1000:
        i += 1
        nn = f"{name}_{i:03}"
        if not os.path.exists(f"{d}/{nn}"):
            return(nn)
    return None

def read_options(uid):
    d = project_dir(uid)
    of = d + "/" + "options.xml"
    options = etree.parse(of)
    return options

def first_or_none(l):
    if l:
        return l[0]
    else:
        return None

def change_option(uid, name, value):
    d = project_dir(uid)
    of = d + "/" + "options.xml"
    options = etree.parse(of)
    x = first_or_none(options.xpath("/*/" + name))
    if x is None:
        glob = options.xpath("/*")[0]
        opt = etree.Element(name)
        opt.text = str(value)
        glob.append(opt)
    else:
        x.text = str(value)
    options.write(of)

def get_option(uid, name):
    options = read_options(uid)
    return first_or_none(options.xpath(f"/*/{name}/text()"))

def main_source_file(uid):
    src = get_option(uid, "texsrc")
    if src:
        return src.replace("%PROJET/", "")
    else:
        return None

def default_source_file(uid):
    filt = get_option(uid, "filter")
    if filt == "plain":
        return "source.txt"
    else:
        return "source.tex"

def ncopies(uid):
    return get_option(uid, "nombre_copies")
    
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
            return send_dir_as_zip(path)
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
        amc_command(request.sid, "db", "upgrade")
        emit("ncopies", str(ncopies(request.sid)))

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
                 [False, render_template("document_calage.html")])
            layout_set_page(1, 1)
        else:
            emit("document-content",
                 [False, render_template("document_missing.html")])

    else:
        doc = "/DOC-" + t + ".pdf"
        filename = project_dir(request.sid) + doc

        if os.path.isfile(filename):
            can_print = (t == "sujet")
            url = "/" + request.sid + "/fs/" + get_var("project_name") + doc
            emit("document-content",
                 [can_print, render_template("document_content.html",
                                             url=url)])
        else:
            emit("document-content",
                 [False, render_template("document_missing.html")])

def amc_command(uid, *args, messages=None, variables=None):
    command = [ "/usr/bin/auto-multiple-choice",
                *args ]
    if uid:
        command += ["--project-dir", project_dir(uid)]
    process = subprocess.Popen(command,
                               stdout=subprocess.PIPE,
                               stderr=subprocess.STDOUT,
                               text=True)
    prop = 0
    if messages is None:
        messages = { "ERR":[], "INFO":[], "WARN":[] }
    if variables is None:
        variables = {}
    while True:
        line = process.stdout.readline()
        if not line:
            break  # Reached the end of stdout
        line = line.strip()
        app.logger.debug("c-out> " + line)
        avance = re.match(r'===<(.*)>=\+([0-9,.]+(?:e[+-]?[0-9]+)?)', line)
        if avance:
            aid = avance[1]
            delta = float(avance[2])
            prop += delta
            if prop < 0:
                prop=0
            if prop > 1:
                prop = 1
            emit("p", prop)
        avance = re.match(r'===<(.*)>=T\((.*)\)$', line)
        if avance:
            aid = avance[1]
            text = avance[2]
            prop = 0
            emit("t", text)
            emit("p", prop)
        m = re.match(r'^(ERR|INFO|WARN)[:>]\s*(.*)', line)
        if m:
            messages[m[1]].append(m[2])
        v = re.match(r'^VAR:\s*([^=]+)=(.*)', line)
        if v:
            variables[v[1]] = v[2]
        v = re.match(r'^VAR\+:\s*(.*)', line)
        if v:
            variables[v[1]] = int(variables[v[1]]) + 1
        of = re.match(r'^(OK|FAILED)', line)
        if of:
            variables[of[1]] = int(variables.get(of[1], 0)) + 1
            
    return messages, variables

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
    amc_command(request.sid, "db", "clear", steps)

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
                                      "--progression-id", "MAJ")
    app.logger.info(f"Variables: {variables}")

    e = len(messages["ERR"])
    if t == "sujet" and e == 0:
        emit("t", "Detecting layouts…")
        amc_command(request.sid,
                    "meptex",
                    "--progression-id", "MEP",
                    "--progression", "1",
                    messages=messages, variables=variables)

    emit("end-command")
    show_messages(messages)
        
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
                                      "--css-url", "/static/svg.css")
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
        "--output", rep
    )
    log_messages(messages)
    emit("end-command")
    n = show_messages(messages)
    if n==0:
        emit("print-done")
        emit("print-to-files",
             f"/{request.sid}/printed/{get_var('project_name')}/printed.zip")

def send_dir_as_zip(path, name=None, recursive=True):
    if name is None:
        name = re.sub(r'.*/', "", path) + ".zip"
    data = io.BytesIO()
    with zipfile.ZipFile(data, mode='w') as z:
        if recursive:
            for root, dirs, files in os.walk(path):
                subroot = root.replace(path, ".", 1)
                for f in files:
                    z.write(f"{root}/{f}", arcname=f"{subroot}/{f}")
        else:
            for f_name in os.listdir(path):
                z.write(f"{path}/{f_name}", arcname=f_name)
    data.seek(0)
    return send_file(
        data,
        mimetype='application/zip',
        as_attachment=True,
        download_name=name
    )
        
@app.route("/<sid>/printed/<project>/printed.zip")
def build_printed_zip(sid, project):
    rep = f"{temp_dir}/{sid}/printed/{project}"
    send_dir_as_zip(rep, name="printed.zip", recursive=False)

if __name__ == '__main__':
    socketio.run(app, debug=True)
