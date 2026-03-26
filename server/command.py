
import re
import subprocess

from basic import *

def command_str(command):
    return " ".join([ x if x else '""' for x in command ])

def amc_command(uid, *args,
                messages=None, variables=None,
                app=None):
    command = [ "/usr/bin/auto-multiple-choice",
                *args ]
    if uid:
        command += ["--project-dir", project_dir(uid)]
    if app:
        app.logger.info("c-cmd> " + command_str(command))
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
        if app:
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
            app.socketio.emit("p", prop, to=uid)
        avance = re.match(r'===<(.*)>=T\((.*)\)$', line)
        if avance:
            aid = avance[1]
            text = avance[2]
            prop = 0
            app.socketio.emit("t", text, to=uid)
            app.socketio.emit("p", prop, to=uid)
        m = re.match(r'^(ERR|INFO|WARN)[:>]\s*(.*)', line)
        if m:
            messages[m[1]].append(m[2])
        v = re.match(r'^VAR:\s*([^=]+)=(.*)', line)
        if v:
            variables[v[1]] = v[2]
        v = re.match(r'^VAR\+:\s*(.*)', line)
        if v:
            variables[v[1]] = int(variables.get(v[1],0)) + 1
        of = re.match(r'^(OK|FAILED)', line)
        if of:
            variables[of[1]] = int(variables.get(of[1], 0)) + 1
            
    return messages, variables

