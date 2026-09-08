
import os
import re
import subprocess

from basic import *

from flask import current_app

def command_str(command):
    return " ".join([ '"'+str(x)+'"' if (x=="" or " " in  x)
                      else str(x)
                      for x in command ])

def amc_command(*args,
                messages=None, variables=None):

    env = os.environ.copy()
    env["AMC_USERCONFDIR"] = user_confdir()
    locale = get_locale()
    if locale == "en":
        env["LANG"] = "C"
    elif locale == "fr":
        env["LANG"] = "fr_FR.UTF-8"
    
    if messages is None:
        messages = {}
    for k in ("ERR", "INFO", "WARN"):
        if not messages.get(k):
            messages[k] = []
    if variables is None:
        variables = {}

    if args[0].startswith("/"):
        command = [ *args ]
    else:
        command = [ "/usr/bin/auto-multiple-choice",
                *args ]
        command += ["--no-use-state", "--profile", "default"]
        command += ["--project-dir", project_dir()]

    if args[0] == "prepare":
        command += ["--log", project_dir() + "/_latex.log"]
        po = get_options(["global:force_textpos", "moteur_latex_b"])
        package_options = []
        if po["global:force_textpos"]:
            package_options.append("textpos")
            
        engines = os.environ.get('AMC_LATEX_ENGINES')
        if engines:
            if po["moteur_latex_b"] not in engines.split(","):
                messages['ERR'].append(
                    f":LaTeX engine not available: {po['moteur_latex_b']}")
                return messages, variables
            command += [ "--no-allow-commands", "--no-allow-engine-change" ]
        command += [ "--add-package-options", ",".join(package_options) ]

        if current_app.isolate:
            isolate = [
                'landrun',
                '--best-effort',
                '--log-level', 'info',
                '--rox', current_app.isolate_paths['ROX'],
                '--rw', current_app.isolate_paths['RW'],
                '--ro', current_app.isolate_paths['RO'],
                '--env', 'HOME', '--env', 'PATH', '--env', 'LANG',
                '--env', 'AMC_USERCONFDIR',
                '--env', 'AMC_TXT_DEFAULTFONT',
                '--env', 'AMC_TXT_DEFAULTFONT_ARABIC',
                '--rw', projects_dir(),
            ]
            if not os.environ.get("AMC_USERHEADER"):
                isolate += [ '--ro', user_confdir() ]
            isolate.append('--')
            command = isolate + command

    current_app.logger.info("c-cmd> " + command_str(command))

    try:
        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            env=env,
        )
    except Exception as e:
        current_app.logger.error(f"Command execution error: {str(e)}")
        messages['ERR'].append(f":Execution error: {str(e)}")
        return messages, variables
    
    prop = 0

    while True:
        line = process.stdout.readline()
        if not line:
            break  # Reached the end of stdout
        line = line.strip()
        current_app.logger.debug("c-out> " + line)
        avance = re.match(r'===<(.*)>=\+([0-9,.]+(?:e[+-]?[0-9]+)?)', line)
        if avance:
            aid = avance[1]
            delta = float(avance[2])
            prop += delta
            if prop < 0:
                prop=0
            if prop > 1:
                prop = 1
            emit_msg("p", prop)
        avance = re.match(r'===<(.*)>=T\((.*)\)$', line)
        if avance:
            aid = avance[1]
            text = avance[2]
            prop = 0
            emit_msg("t", text)
            emit_msg("p", prop)
        m = re.match(r'^(ERR|INFO|WARN)([:>])(.*)', line)
        if m:
            messages[m[1]].append(m[2] + m[3])
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

    current_app.logger.debug(f"Return value: {ret}")

    if ret is None:
        messages['ERR'].append(":The process did not end properly.")
    elif ret != 0:
        messages['ERR'].append(f":The process returned an error code: {ret}")
    
    return messages, variables

