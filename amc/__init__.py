
import re
import os
from pathlib import Path
import tempfile
import sys
import logging
import subprocess
import cups
import io
import zipfile
from lxml import etree

from amc.db import Amcdb

from flask import Flask, render_template, request, send_file
from flask_socketio import SocketIO, emit

DEBUG=True

app = Flask(__name__)

app.config.from_mapping(
    SECRET_KEY='dev',
)
socketio = SocketIO(app)

users = {}

temp_dir = tempfile.mkdtemp(prefix="amcapp")

app.logger.info(f"Temp dir: {temp_dir}")

def set_var(name, value):
    sid = request.sid
    if not users.get(sid):
        users[sid] = {}
    users[sid][name] = value

def get_var(name):
    sid = request.sid
    if not users.get(sid):
        users[sid] = {}
    return users[sid].get(name)

def set_project(name):
    set_var("project_name", name)

def get_db(modules=()):
    return Amcdb(project_dir(request.sid), modules)

def projects_dir(uid):
    return os.path.expanduser('~') + "/Projets-QCM"

def project_dir(uid):
    p = get_var("project_name")
    if p:
        return projects_dir(uid) + "/" + p
    else:
        return None

def read_options(uid):
    d = project_dir(uid)
    of = d + "/" + "options.xml"
    options = etree.parse(of)
    return options

def change_option(uid, name, value):
    d = project_dir(uid)
    of = d + "/" + "options.xml"
    options = etree.parse(of)
    x = options.xpath("/project/" + name)[0]
    x.text = str(value)
    options.write(of)

def main_source_file(uid):
    options = read_options(uid)
    src = options.xpath("/project/texsrc/text()")[0]
    return src.replace("%PROJET/", "")

def ncopies(uid):
    options = read_options(uid)
    n = options.xpath("/project/nombre_copies/text()")[0]
    return n
    
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
        return send_file(path,
                         as_attachment=True)

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

@socketio.on('ncopies')
def io_ncopies(n):
    n = int(n)
    change_option(request.sid, "nombre_copies", n)

@socketio.on('source-code')
def io_source_code(filename):
    if not filename:
        filename = main_source_file(request.sid)
    emit("source-name", filename)
    filecontent = ""
    with open(project_dir(request.sid) + "/" + filename, "r") as f:
        filecontent = f.read()
    emit("source-code", filecontent)

@socketio.on('source-save')
def io_source_save(filename, code):
    with open(project_dir(request.sid) + "/" + filename, "w") as f:
        f.write(code)
    emit("source-saved");

@socketio.on("files-list")
def io_files_list():
    files = [ f for f in os.listdir(project_dir(request.sid))
              if re.match(r'.*\.(tex|yaml|yml|csv|txt)$', f, re.IGNORECASE) ]
    emit("files-list",
         render_template("files_list.html", files=sorted(files)))

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
                *args,
                "--project-dir", project_dir(uid) ]
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
        if DEBUG:
            app.logger.info(line)
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
                                      "--dest-file", f"{rep}/layout")
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

@app.route("/<sid>/printed/<project>/printed.zip")
def build_printed_zip(sid, project):
    rep = f"{temp_dir}/{sid}/printed/{project}"

    data = io.BytesIO()
    with zipfile.ZipFile(data, mode='w') as z:
        for f_name in os.listdir(rep):
            z.write(f"{rep}/{f_name}", arcname=f_name)
    data.seek(0)
    return send_file(
        data,
        mimetype='application/zip',
        as_attachment=True,
        download_name='printed.zip'
    )

if __name__ == '__main__':
    socketio.run(app, debug=True)
