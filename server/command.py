
import re
import subprocess

from basic import *

def command_str(command):
    return " ".join([ '"'+str(x)+'"' if (x=="" or " " in  x)
                      else str(x)
                      for x in command ])

def amc_command(*args,
                messages=None, variables=None,
                app=None):

    env = os.environ.copy()
    env["AMC_USERCONFDIR"] = user_confdir()
    
    if messages is None:
        messages = {}
    for k in ("ERR", "INFO", "WARN"):
        if not messages.get(k):
            messages[k] = []
    if variables is None:
        variables = {}

    command = [ "/usr/bin/auto-multiple-choice",
                *args ]
    command += ["--project-dir", project_dir()]
    if app:
        app.logger.info("c-cmd> " + command_str(command))

    try:
        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            env=env,
        )
    except Exception as e:
        messages['ERR'].append(f"Execution error: {str(e)}")
        return messages, variables
    
    prop = 0

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
            emit_progress("p", prop)
        avance = re.match(r'===<(.*)>=T\((.*)\)$', line)
        if avance:
            aid = avance[1]
            text = avance[2]
            prop = 0
            emit_progress("t", text)
            emit_progress("p", prop)
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

    try:
        ret = process.wait(5)
    except TimeoutExpired:
        ret = None

    if ret is None:
        messages['ERR'].append("The process did not end properly.")
    elif ret != 0:
        messages['ERR'].append(f"The process return an error code: {ret}")
    
    return messages, variables

