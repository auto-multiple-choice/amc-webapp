
import os
from lxml import etree
from filelock import FileLock
import threading

from flask import request
from flask_socketio import emit

users = {}

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
    set_thread_var("db", None)

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
    lock = FileLock(f"{of}.lock")
    with lock:
        options.write(of)

def get_option(uid, name):
    options = read_options(uid)
    return first_or_none(options.xpath(f"/*/{name}/text()"))

def get_options(uid, prefix_or_list):
    options = read_options(uid)
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
    
