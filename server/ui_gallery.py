#!/usr/bin/env python3
"""
The new-exam wizard's template gallery (doc/features.md, Interface).

Run when the Docker image is built, to compile each template once:

  python3 ui_gallery.py <AMC templates dir> <starter templates dir> <out dir>

For every template it writes <out>/<group>/<id>/paper.pdf (one copy of
the question paper) and thumb.png (its first page), and <out>/index.json.
Templates are AMC's (one folder per language, .tgz files) and our own
starters (server/school_templates, group "school").

Also used by the server: starter_source() fills in a starter's markers.
Standard library only, no Flask (ui_builder, imported for the paper
builder's starter, is standard library too).
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile

STARTER_GROUP = "school"
THUMB_HEIGHT = 420  # pixels


# ---------------------------------------------------------------- starters

def latex_escape(text):
    out = []
    for c in str(text):
        out.append({"\\": r"\textbackslash{}", "&": r"\&", "%": r"\%", "$": r"\$", "#": r"\#",
                    "_": r"\_", "{": r"\{", "}": r"\}", "~": r"\textasciitilde{}",
                    "^": r"\textasciicircum{}"}.get(c, c))
    return "".join(out)


def needs_unicode_engine(school_name):
    """pdflatex with inputenc/fontenc (T1) prints Latin-1 letters; anything
    else (Cyrillic, Greek, Devanagari...) needs XeLaTeX with a Unicode font."""
    try:
        str(school_name or "").encode("latin-1")
        return False
    except UnicodeEncodeError:
        return True


NAME_FIELD = (r"\namefield{\fbox{\begin{minipage}{%s\linewidth}" "\n"
              r"  \vspace*{1mm}Name:\par\vspace*{6mm}\namefielddots\vspace*{1mm}" "\n"
              r"\end{minipage}}}")


def identity_block(code_digits):
    if not code_digits:
        return NAME_FIELD % ".6"
    return ("\\noindent\\begin{minipage}{.46\\linewidth}\n"
            "\\AMCcodeGridInt{student}{%d}\n"
            "\\end{minipage}\\hfill\n"
            "\\begin{minipage}{.5\\linewidth}\n"
            "Write your student number in the boxes on the left, one digit per column, then your name below.\n\n"
            "\\vspace{3ex}\n%s\n\\end{minipage}" % (code_digits, NAME_FIELD % ".95"))


def starter_source(text, fmt, school_name="", logo_file="", code_digits=0, separate=False):
    """A starter's source with its markers filled in (see school_templates/README.md)."""
    code_digits = max(0, min(int(code_digits or 0), 12))
    if fmt == "plain":
        lines = []
        if code_digits:
            lines.append(f"Code: {code_digits}")
        if separate:
            lines.append("SeparateAnswerSheet: 1")
        return re.sub(r"^%%AMCUI:OPTIONS%%\n", "".join(l + "\n" for l in lines), text, flags=re.M)
    school = ""
    if school_name or logo_file:
        school = "\\noindent{\\large\\bf %s}\\hfill" % latex_escape(school_name)
        if logo_file:
            school += "\\includegraphics[height=12mm]{%s}" % logo_file
        school += "\\par\\vspace{3mm}\n"
    text = re.sub(r"^%%AMCUI:SCHOOL%%\n", lambda m: school, text, flags=re.M)
    return re.sub(r"^%%AMCUI:IDENTITY%%\n", lambda m: identity_block(code_digits) + "\n", text, flags=re.M)


def read_description(folder):
    """Title and text from description.xml (as upstream's template_info)."""
    out = {}
    try:
        with open(os.path.join(folder, "description.xml"), encoding="utf-8") as f:
            xml = f.read()
    except OSError:
        return out
    for k in ("title", "text"):
        m = re.search(r"<%s>(.*?)</%s>" % (k, k), xml, re.S)
        if m:
            out[k] = re.sub(r"\s+", " ", m.group(1)).strip()
    return out


# ---------------------------------------------------------------- building the gallery

def _compile(project, env):
    """One copy of the question paper, as the app builds it."""
    for d in ("data", "cr/corrections/pdf", "cr/corrections/jpg", "scans", "exports"):
        os.makedirs(os.path.join(project, d), exist_ok=True)
    r = subprocess.run(["auto-multiple-choice", "prepare", "--mode", "s", "--project-dir", project,
                        "--n-copies", "1", "--no-use-state", "--profile", "default"],
                       env=env, capture_output=True, text=True, timeout=300)
    pdf = os.path.join(project, "DOC-sujet.pdf")
    if not os.path.isfile(pdf):
        print("\n".join((r.stdout + r.stderr).strip().splitlines()[-6:]))
        return None
    return pdf


def _pages(pdf):
    try:
        info = subprocess.run(["pdfinfo", pdf], capture_output=True, text=True, timeout=60).stdout
        return int(re.search(r"^Pages:\s+(\d+)", info, re.M).group(1))
    except (OSError, AttributeError, subprocess.SubprocessError):
        return None


def _store(pdf, dest):
    os.makedirs(dest, exist_ok=True)
    subprocess.run(["pdftoppm", "-png", "-f", "1", "-l", "1", "-scale-to-y", str(THUMB_HEIGHT),
                    "-scale-to-x", "-1", pdf, os.path.join(dest, "thumb")], check=True, timeout=120)
    for f in os.listdir(dest):  # pdftoppm names it thumb-1.png (or thumb-01.png)
        if f.startswith("thumb-") and f.endswith(".png"):
            os.replace(os.path.join(dest, f), os.path.join(dest, "thumb.png"))
    shutil.copyfile(pdf, os.path.join(dest, "paper.pdf"))  # last: a folder is complete or absent


def build(amc_dir, starters_dir, out):
    env = dict(os.environ)
    env["HOME"] = env.get("HOME") or tempfile.mkdtemp()
    os.makedirs(env["HOME"], exist_ok=True)  # AMC keeps its settings there
    index = {}
    jobs = []
    for group in sorted(os.listdir(amc_dir)):
        gdir = os.path.join(amc_dir, group)
        if os.path.isdir(gdir):
            jobs += [(group, f[:-4], os.path.join(gdir, f)) for f in sorted(os.listdir(gdir)) if f.endswith(".tgz")]
    if os.path.isdir(starters_dir):
        jobs += [(STARTER_GROUP, d, os.path.join(starters_dir, d)) for d in sorted(os.listdir(starters_dir))
                 if os.path.isdir(os.path.join(starters_dir, d))]
    failed = []
    for group, tid, src in jobs:
        work = tempfile.mkdtemp()
        try:
            if src.endswith(".tgz"):
                with tarfile.open(src) as t:
                    t.extractall(work, filter="data")
                # AMC's archives hold one folder with options.xml
                roots = {os.path.dirname(os.path.join(r, f)) for r, _, fs in os.walk(work) for f in fs if f == "options.xml"}
                project = sorted(roots, key=len)[0] if roots else work
            else:
                project = os.path.join(work, tid)
                shutil.copytree(src, project)
                for f in os.listdir(project):
                    path = os.path.join(project, f)
                    if f.endswith((".tex", ".txt")):
                        with open(path, encoding="utf-8") as fh:
                            text = fh.read()
                        with open(path, "w", encoding="utf-8") as fh:
                            fh.write(starter_source(text, "plain" if f.endswith(".txt") else "latex",
                                                    school_name="Your school"))
                if os.path.isfile(os.path.join(project, "paper.json")):  # the paper builder's starter
                    import ui_builder
                    import ui_scale
                    questions = []
                    for f in sorted(os.listdir(project)):
                        if f.endswith(".tex") and f != ui_builder.LAYOUT_FILE:
                            with open(os.path.join(project, f), encoding="utf-8") as fh:
                                questions += ui_scale.read_latex(fh.read(), f)
                    ui_builder.write_layout_file(project, 1, questions)
            pdf = _compile(project, env)
            if pdf:
                _store(pdf, os.path.join(out, group, tid))
                index[f"{group}/{tid}"] = {"pages": _pages(pdf)}
                print(f"gallery: {group}/{tid} ok")
            else:
                print(f"gallery: {group}/{tid} didn't compile")
                failed.append(f"{group}/{tid}")
                shutil.rmtree(os.path.join(out, group, tid), ignore_errors=True)
        except Exception as e:  # one broken AMC template mustn't stop the build
            print(f"gallery: {group}/{tid} failed: {e}")
            failed.append(f"{group}/{tid}")
            shutil.rmtree(os.path.join(out, group, tid), ignore_errors=True)
        finally:
            shutil.rmtree(work, ignore_errors=True)
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, indent=1)
    print(f"gallery: {len(index)} of {len(jobs)} templates")
    # Our own starters must build (the wizard relies on them), and a
    # gallery with nothing in it means AMC itself is broken.
    bad_starters = [t for t in failed if t.startswith(STARTER_GROUP + "/")]
    if bad_starters or not index:
        sys.exit(f"gallery: build failed: {', '.join(bad_starters) or 'no template compiled'}")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    build(*sys.argv[1:])
