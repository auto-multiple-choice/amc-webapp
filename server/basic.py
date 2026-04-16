
import os
from pathlib import Path
from lxml import etree
from filelock import FileLock
import threading

from flask import request, current_app
from flask_socketio import emit

users = {}

def get_locale():
    return request.accept_languages.best_match(['fr', 'en'])

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
    old_project = get_var("project_name")
    if not project_exists(name):
        name = ""
    if name != old_project:
        set_var("project_name", name)
        set_thread_var("db", None)
    return name, old_project != name

def user_confdir():
    if os.environ.get("AMC_USERHEADER"):
        return projects_dir() + "/config"
    else:
        return os.path.expanduser('~') + "/.AMC.d"

def projects_dir():
    pdir = os.environ.get("AMC_PROJECTSDIR",
                          os.path.expanduser('~') + "/MC-Projects")
    if k := os.environ.get("AMC_USERHEADER"):
        if subdir := request.headers.get(k):
            pdir += ("/" + subdir)
    Path(pdir).mkdir(parents=True, exist_ok=True)
    return pdir

def project_dir(p=None):
    if not p:
        p = get_var("project_name")
    if p:
        return projects_dir() + "/" + p
    else:
        return None

def project_paths_absolute(paths):
    ps_dir = projects_dir() + "/"
    p_dir = project_dir() + "/"
    return [
        x.replace("%PROJETS/", ps_dir, 1).replace("%PROJET/", p_dir, 1)
        for x in paths ]

def is_project_dir(path):
    return os.path.isdir(path) and os.path.isfile(path + "/options.xml")

def projects_list():
    pdir = projects_dir()
    return sorted([ path for path in os.listdir(pdir)
             if is_project_dir(pdir + "/" + path) ])

def project_exists(name):
    if name:
        pdir = project_dir(p=name)
        return is_project_dir(pdir)
    else:
        return False

def project_clone_name(name):
    d = projects_dir()
    i = 0
    while i<1000:
        i += 1
        nn = f"{name}_{i:03}"
        if not os.path.exists(f"{d}/{nn}"):
            return(nn)
    return None

def first_or_none(l):
    if l:
        return l[0]
    else:
        return None

def option_file_from_name(name):
    if name.startswith("global:"):
        name = name.replace("global:", "", 1)
        options_file = user_confdir() + "/cf.default.xml"
    else:
        options_file = project_dir() + "/options.xml"
    return options_file, name

def change_option(name, value):
    options_file, name = option_file_from_name(name)
    options = etree.parse(options_file)
    x = first_or_none(options.xpath("/*/" + name))
    if x is None:
        glob = options.xpath("/*")[0]
        opt = etree.Element(name)
        opt.text = str(value)
        glob.append(opt)
    else:
        x.text = str(value)
    lock = FileLock(options_file + ".lock")
    with lock:
        options.write(options_file)

def get_option(name):
    options_file, name = option_file_from_name(name)
    options = etree.parse(options_file)
    return first_or_none(options.xpath(f"/*/{name}/text()"))

def get_options(names_list):
    o = {}
    options = {}

    for name in names_list:
        options_file, short_name = option_file_from_name(name)
        if not options.get(options_file):
            options[options_file] = etree.parse(options_file)
        e = first_or_none(
            options[options_file].xpath(f"/*/{short_name}"))
        if e is None:
            o[name] = ""
        else:
            o[name] = "" if e.text is None else e.text

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
    
