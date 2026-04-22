
import re
import os
import shutil
from pathlib import Path
from lxml import etree
from filelock import FileLock
import threading

from flask import request, current_app, g as flask_g
from flask_socketio import emit

def lstrip_text(s, prefix, replace=''):
    return re.sub('^' + re.escape(prefix), replace, s)

def get_locale():
    return request.accept_languages.best_match(['fr', 'en'])

def get_session():
    session = request.cookies.get('amcsession')
    if not session:
        raise RuntimeError("No session")
    return session

def emit_msg(*data):
    if getattr(request, 'sid', None):
        # socket.io context, use direct emit
        flask_g._sid = request.sid
        emit(*data)
    else:
        # HTTP request context, get sid to use from request
        sid = getattr(flask_g, '_sid', None)
        if sid:
            current_app.socketio.emit(*data, to=sid)
        else:
            current_app.logger.error(f"Can't find socket ID to send signal! session={request.cookies.get('amcsession')}")
            flask_g._sid = None
    current_app.logger.debug(f"📢 msg {data[0]} to {flask_g._sid}")

def set_project(name):
    old_project = flask_g.project_name
    if not project_exists(name):
        name = ""
    if name != old_project:
        flask_g.project_name = name
        flask_g._database = None
    return name, old_project != name

def user_confdir():
    if os.environ.get("AMC_USERHEADER"):
        ucd = projects_dir() + "/_config"
        if not os.path.exists(ucd):
            default_ucd = projects_dir(root=True) + "/_default_config"
            if os.path.isdir(default_ucd):
                shutil.copytree(default_ucd, ucd, symlinks=True)
        return ucd
    else:
        return os.path.expanduser('~') + "/.AMC.d"

def username():
    u = None
    if k := os.environ.get("AMC_USERHEADER"):
        u = request.headers.get(k)
    if u is None:
        u = "AMC"
    return u

def projects_dir(root=False):
    pdir = os.environ.get("AMC_PROJECTSDIR",
                          os.path.expanduser('~') + "/MC-Projects")
    k = os.environ.get("AMC_USERHEADER")
    if k and not root:
        if subdir := request.headers.get(k):
            pdir += ("/" + subdir)
        else:
            pdir += "/_all"
    Path(pdir).mkdir(parents=True, exist_ok=True)
    return pdir

def project_dir(p=None):
    if not p:
        p = flask_g.project_name
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

def option_file_from_name(name, p=None):
    if name.startswith("global:"):
        name = name.replace("global:", "", 1)
        options_file = user_confdir() + "/cf.default.xml"
    else:
        name = re.sub(r'^project:', '', name)
        options_file = project_dir(p) + "/options.xml"
    return options_file, name

def change_option(name, value, p=None):
    options_file, name = option_file_from_name(name, p=p)
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

def get_option_from_xml(xml_file, name):
    options = etree.parse(xml_file)
    return first_or_none(options.xpath(f"/*/{name}/text()"))

def get_options_from_xml(xml_file, names):
    v = {}
    options = etree.parse(xml_file)
    for n in names:
        v[n] = first_or_none(options.xpath(f"/*/{n}/text()"))
    return v

def get_option(name, p=None):
    options_file, name = option_file_from_name(name, p=p)
    return get_option_from_xml(options_file, name)

def get_options(names_list, p=None):
    o = {}
    options = {}

    for name in names_list:
        options_file, short_name = option_file_from_name(name, p=p)
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
    
