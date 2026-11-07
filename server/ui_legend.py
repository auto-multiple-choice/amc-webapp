"""
Symbols on annotated sheets, and the key that explains them.

AMC marks every answer box of an annotated sheet according to two facts:
should it be ticked (the correct answer), and was it ticked. Each of the
four cases has a shape (none, circle, mark = a cross, box = a square) and a
colour, kept in the exam's options (symbole_<correct>_<ticked>_type and
_color), plus the colour of the marks and header text (annote_color).

AMC's own colours are red and blue, with a cross both for a correct answer
that wasn't ticked and for a correct tick: once printed in greyscale the two
can't be told apart. The "clear" scheme, the default, gives each case its
own shape and a dark colour that stays visible in greyscale.

AMC has no key for its symbols, so after it has made the annotated PDFs the
app stamps one on every page (qpdf --overlay), in the right margin or the
top right corner. The key itself is a one-page PDF drawn with TikZ.

Standard library only, plus pdflatex, pdfinfo and qpdf from the image.
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile

SHAPES = ("none", "mark", "circle", "box")
SHAPE_NAMES = {"none": "Nothing", "mark": "Cross", "circle": "Circle", "box": "Square"}
# AMC's cases, "<should be ticked>_<was ticked>", in the order the key lists them.
CASES = (("1_1", "Ticked, correct"), ("0_1", "Ticked, wrong"),
         ("1_0", "Correct, not ticked"), ("0_0", "Not ticked, not correct"))
LEGENDS = ("right", "top", "none")
COLOR = re.compile(r"^#[0-9a-f]{6}$")

PRESETS = {
    # Distinct shapes, dark colours (each prints as a dark grey).
    "clear": {"text": "#1a237e", "width": 2,
              "1_1": ["box", "#1b5e20"], "0_1": ["mark", "#b71c1c"],
              "1_0": ["circle", "#0d47a1"], "0_0": ["none", "#000000"]},
    # AMC's own defaults (AMC::Config).
    "amc": {"text": "#ff0000", "width": 2,
            "1_1": ["mark", "#0000ff"], "0_1": ["circle", "#ff0000"],
            "1_0": ["mark", "#ff0000"], "0_0": ["none", "#000000"]},
}
DEFAULT_STYLE = {"preset": "clear", "legend": "right"}

STAMPED = "ui-legend-stamped.json"   # in cr/corrections: which PDFs carry the key


# ---------------------------------------------------------------- schemes

def option_names():
    names = ["annote_color", "symboles_trait"]
    for case, _ in CASES:
        names += [f"symbole_{case}_type", f"symbole_{case}_color"]
    return names


def _color(v, default):
    """A colour as AMC writes it (#rrggbb or #rrrrggggbbbb) as #rrggbb."""
    v = str(v or "").strip().lower()
    if COLOR.match(v):
        return v
    m = re.match(r"^#([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})$", v)
    if m:
        return "#" + "".join(f"{int(x, 16) * 255 // 65535:02x}" for x in m.groups())
    named = {"red": "#ff0000", "blue": "#0000ff", "black": "#000000", "green": "#008000"}
    return named.get(v, default)


def scheme_from_options(o):
    """The scheme the exam's AMC options describe."""
    amc = PRESETS["amc"]
    out = {"text": _color(o.get("annote_color"), amc["text"])}
    try:
        out["width"] = max(1, min(int(float(o.get("symboles_trait") or amc["width"])), 6))
    except ValueError:
        out["width"] = amc["width"]
    for case, _ in CASES:
        shape = str(o.get(f"symbole_{case}_type") or amc[case][0])
        out[case] = [shape if shape in SHAPES else amc[case][0],
                     _color(o.get(f"symbole_{case}_color"), amc[case][1])]
    return out


def same_scheme(a, b):
    return all(a[k] == b[k] for k in ("text", "width")) and all(a[c] == b[c] for c, _ in CASES)


def check_scheme(raw):
    """A custom scheme from the browser, checked. Raises ValueError."""
    raw = raw if isinstance(raw, dict) else {}
    out = {"text": _color(raw.get("text"), ""), "width": raw.get("width", 3)}
    if not out["text"]:
        raise ValueError("Choose a colour for the marks and header text.")
    try:
        out["width"] = max(1, min(int(out["width"]), 6))
    except (TypeError, ValueError):
        raise ValueError("The line width is a whole number from 1 to 6.") from None
    for case, label in CASES:
        v = raw.get(case)
        if not (isinstance(v, (list, tuple)) and len(v) == 2 and v[0] in SHAPES and _color(v[1], "")):
            raise ValueError(f"\"{label}\" needs a shape and a colour.")
        out[case] = [v[0], _color(v[1], "")]
    return out


def style_of(rec, options):
    """The exam's annotation style: {preset, legend, scheme}. Exams that
    never chose one get the clear scheme, unless their AMC options were set
    by hand (AMC's desktop app, say): then those are kept as custom."""
    st = rec.get("annotate_style") if isinstance(rec.get("annotate_style"), dict) else {}
    legend = st.get("legend") if st.get("legend") in LEGENDS else DEFAULT_STYLE["legend"]
    preset = st.get("preset")
    if preset in PRESETS:
        return {"preset": preset, "legend": legend, "scheme": PRESETS[preset]}
    if preset == "custom" and isinstance(st.get("scheme"), dict):
        try:
            return {"preset": "custom", "legend": legend, "scheme": check_scheme(st["scheme"])}
        except ValueError:
            pass
    # The teacher's AMC settings hold the symbols of the exam they annotated
    # last: AMC's defaults (never changed) or the clear scheme mean the
    # default; anything else was chosen, and is kept as custom.
    current = scheme_from_options(options)
    if (not any(options.get(n) for n in option_names()) or same_scheme(current, PRESETS["amc"])
            or same_scheme(current, PRESETS["clear"])):
        return {"preset": "clear", "legend": legend, "scheme": PRESETS["clear"]}
    return {"preset": "custom", "legend": legend, "scheme": current}


def amc_options(scheme):
    """The AMC options that draw this scheme."""
    out = {"annote_color": scheme["text"], "symboles_trait": str(scheme["width"])}
    for case, _ in CASES:
        out[f"symbole_{case}_type"], out[f"symbole_{case}_color"] = scheme[case]
    return out


# ---------------------------------------------------------------- the key

def _tikz_symbol(shape, color, ticked):
    """A small answer box, shaded when the case is a ticked box, with the
    symbol drawn as AMC draws it on the sheet: a cross through the box from
    corner to corner, a circle through its corners, or a square on its
    outline."""
    rgb = color[1:].upper()
    box = r"\filldraw[fill=black!22,draw=black!70,line width=0.3pt]" if ticked else r"\draw[black!70,line width=0.3pt]"
    out = [r"\definecolor{s}{HTML}{%s}" % rgb, box + r" (-1mm,-1mm) rectangle (1mm,1mm);"]
    if shape == "mark":
        out.append(r"\draw[s,line width=0.8pt] (-1.15mm,-1.15mm) -- (1.15mm,1.15mm) (-1.15mm,1.15mm) -- (1.15mm,-1.15mm);")
    elif shape == "circle":
        out.append(r"\draw[s,line width=0.8pt] (0,0) circle (1.414mm);")
    elif shape == "box":
        out.append(r"\draw[s,line width=1pt] (-1mm,-1mm) rectangle (1mm,1mm);")
    # The same bounding box for every symbol, so that each box sits at the
    # same height and the shapes stay centred on it in the line of text.
    out.append(r"\useasboundingbox (-2.2mm,-2.2mm) rectangle (2.2mm,2.2mm);")
    return r"\tikz[baseline=-0.7ex,line join=miter]{%s}" % " ".join(out)


def legend_tex(scheme, where, width_pt, height_pt):
    """LaTeX for a page of WIDTH x HEIGHT points, empty but for the key."""
    items = [r"%s\,%s" % (_tikz_symbol(*scheme[case], ticked=case.endswith("_1")), label)
             for case, label in CASES if scheme[case][0] != "none"]
    text = r"\textbf{Key:}\enspace " + r"\quad ".join(items)
    if where == "top":
        node = r"\node[anchor=north east,inner sep=0] at (%.2f,%.2f) {%s};" % (width_pt - 14.2, height_pt - 9.9, text)
    else:  # right: along the right edge, read from the bottom
        node = r"\node[rotate=90,anchor=center,inner sep=0] at (%.2f,%.2f) {%s};" % (width_pt - 14.2, height_pt / 2, text)
    return "\n".join([
        r"\documentclass{standalone}",
        r"\usepackage[T1]{fontenc}",
        r"\usepackage{lmodern}",
        r"\usepackage{tikz}",
        r"\begin{document}",
        r"\definecolor{keytext}{HTML}{%s}" % scheme["text"][1:].upper(),
        r"\begin{tikzpicture}[x=1pt,y=1pt]",
        r"\useasboundingbox (0,0) rectangle (%.2f,%.2f);" % (width_pt, height_pt),
        r"\begin{scope}[font=\sffamily\footnotesize,text=keytext]",
        node,
        r"\end{scope}",
        r"\end{tikzpicture}",
        r"\end{document}", ""])


def legend_key(scheme, where):
    """What the key depends on: when it changes, stamped files are redone."""
    return hashlib.sha256(json.dumps([where, scheme], sort_keys=True).encode()).hexdigest()[:16]


def page_size(pdf):
    """The first page's size in points, or None."""
    try:
        out = subprocess.run(["pdfinfo", "-f", "1", "-l", "1", pdf], capture_output=True,
                             text=True, timeout=30, check=False).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    m = re.search(r"Page\s+1\s+size:\s+([\d.]+)\s+x\s+([\d.]+)", out) or re.search(r"Page size:\s+([\d.]+)\s+x\s+([\d.]+)", out)
    return (round(float(m.group(1)), 2), round(float(m.group(2)), 2)) if m else None


def make_legend(scheme, where, size, cache_dir):
    """The key as a PDF page of SIZE (points), made once per scheme and size."""
    name = f"ui-legend-{legend_key(scheme, where)}-{size[0]:.0f}x{size[1]:.0f}.pdf"
    path = os.path.join(cache_dir, name)
    if os.path.isfile(path):
        return path
    with tempfile.TemporaryDirectory(prefix="amc-legend-") as tmp:
        with open(os.path.join(tmp, "key.tex"), "w", encoding="utf-8") as f:
            f.write(legend_tex(scheme, where, *size))
        r = subprocess.run(["pdflatex", "-no-shell-escape", "-interaction=nonstopmode", "-halt-on-error", "key.tex"],
                           cwd=tmp, capture_output=True, text=True, timeout=120, check=False)
        if r.returncode != 0 or not os.path.isfile(os.path.join(tmp, "key.pdf")):
            raise RuntimeError("The key for the annotated sheets couldn't be drawn: "
                               + (r.stdout[-400:] if r.stdout else r.stderr[-400:]))
        for old in os.listdir(cache_dir):  # keys of other schemes aren't needed any more
            if old.startswith("ui-legend-") and old.endswith(".pdf") and not old.startswith(name[:27]):
                try:
                    os.unlink(os.path.join(cache_dir, old))
                except OSError:
                    pass
        shutil.copyfile(os.path.join(tmp, "key.pdf"), path)
    return path


def stamp(pdf, legend):
    """Put the key on every page of PDF, in place."""
    tmp = pdf + ".key.tmp"
    r = subprocess.run(["qpdf", "--warning-exit-0", pdf, "--overlay", legend, "--from=", "--repeat=1", "--", tmp],
                       capture_output=True, text=True, timeout=300, check=False)
    if r.returncode != 0 or not os.path.isfile(tmp):
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise RuntimeError(f"The key couldn't be added to {os.path.basename(pdf)}: {r.stderr.strip()[-300:]}")
    os.replace(tmp, pdf)


def _signature(path):
    st = os.stat(path)
    return [st.st_size, st.st_mtime_ns]


def stamp_folder(pdf_dir, scheme, where, cache_dir):
    """Add the key to the annotated PDFs that don't carry this one yet.
    AMC remakes only the sheets that changed (--changes-only), so a list of
    stamped files (size, time, key) tells which ones still need it. Returns
    the number of files stamped."""
    record_path = os.path.join(cache_dir, STAMPED)
    try:
        with open(record_path, encoding="utf-8") as f:
            done = json.load(f)
    except (OSError, ValueError):
        done = {}
    key = legend_key(scheme, where)
    pdfs = sorted(f for f in os.listdir(pdf_dir) if f.lower().endswith(".pdf")) if os.path.isdir(pdf_dir) else []
    n = 0
    new = {}
    for f in pdfs:
        path = os.path.join(pdf_dir, f)
        entry = done.get(f)
        if entry and entry[:2] == _signature(path):
            # Unchanged since it was stamped. A change of key remakes every
            # sheet (annotate_source_change), except sheets the teacher
            # chose to keep: never stamp a second key over the first.
            new[f] = entry
            continue
        if where != "none":
            size = page_size(path)
            if size:
                stamp(path, make_legend(scheme, where, size, cache_dir))
                n += 1
        new[f] = _signature(path) + [key]
    tmp = record_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(new, fh)
    os.replace(tmp, record_path)
    return n
