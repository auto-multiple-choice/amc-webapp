
import os
from lxml import etree
from filelock import FileLock
import threading

from flask import request, current_app
from flask_socketio import emit

users = {}

def get_session():
    session = request.cookies.get('amcsession')
    if not session:
        raise RuntimeError("No session")
    return session

def set_var(name, value):
    uid = get_session()
    if not users.get(uid):
        users[uid] = {}
    users[uid][name] = value

def get_var(name):
    uid = get_session()
    if not users.get(uid):
        users[uid] = {}
    return users[uid].get(name)

def emit_progress(*data):
    sid = get_var("sid")
    if sid:
        current_app.socketio.emit(*data, to=sid)
    else:
        current_app.logger.error(f"Can't find socket ID to send signal! session={request.cookies.get('amcsession')}")

def clean_thread_vars(v, logger):
    ts = set(x.ident for x in threading.enumerate())
    for k in list(v.keys()):
        if k not in ts:
            logger.warn(f"Delete DB for thread {k}")
            del v[k]

def get_thread_var(name, logger):
    v = get_var(name)
    if v:
        try:
            clean_thread_vars(v, logger)
        except Exception as e:
            logger.error(e)
    else:
        v = {}
        set_var(name, v)
    return v.get(threading.get_ident())

def set_thread_var(name, value):
    v = get_var(name)
    if not v:
        v = {}
        set_var(name, v)
    v[threading.get_ident()] = value

def add_var(name, delta):
    uid = get_session()
    if not users.get(uid):
        users[uid] = {}
    if not users[uid].get(name):
        users[uid][name] = 0
    users[uid][name] += delta
    return users[uid][name]

def set_project(name):
    set_var("project_name", name)
    set_thread_var("db", None)

def projects_dir():
    return os.path.expanduser('~') + "/Projets-QCM"

def project_dir(p=None):
    if not p:
        p = get_var("project_name")
    if p:
        return projects_dir() + "/" + p
    else:
        return None

def project_clone_name(name):
    d = projects_dir()
    i = 0
    while i<1000:
        i += 1
        nn = f"{name}_{i:03}"
        if not os.path.exists(f"{d}/{nn}"):
            return(nn)
    return None

def read_options():
    d = project_dir()
    of = d + "/" + "options.xml"
    options = etree.parse(of)
    return options

def first_or_none(l):
    if l:
        return l[0]
    else:
        return None

def change_option(name, value):
    d = project_dir()
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
    lock = FileLock(f"{of}.lock")
    with lock:
        options.write(of)

def options_dict():
    options = read_options()
    d = {}
    for e in options.xpath("/*/*"):
        d[e.tag] = e.text
    return e

def get_option(name):
    options = read_options()
    return first_or_none(options.xpath(f"/*/{name}/text()"))

def get_options(prefix_or_list):
    options = read_options()
    o = {}
    if isinstance(prefix_or_list, str):
        es = options.xpath("/*/*[starts-with(name(),'" + prefix_or_list + "')]")
    else:
        es = [ first_or_none(options.xpath(f"/*/{name}"))
               for name in prefix_or_list ]
    for x in es:
        if x is not None:
            o[x.tag] = x.text
            if o[x.tag] is None:
                o[x.tag] = ""
    return o

def main_source_file():
    src = get_option("texsrc")
    if src:
        return src.replace("%PROJET/", "")
    else:
        return None

def default_source_file():
    filt = get_option("filter")
    if filt == "plain":
        return "source.txt"
    else:
        return "source.tex"

def ncopies():
    return get_option("nombre_copies")
    
