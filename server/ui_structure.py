"""
The paper's structure: the sections of a LaTeX exam
(doc/questions-banks-templates-plan.md, section 6).

A *section* is an AMC group: questions wrapped in \\element{name}{...}
and printed by \\insertgroup[n]{name} in the \\onecopy body. The panel
owns one region per section, between markers, and rewrites it from the
form fields:

    %%AMCUI:SECTION sectionI%%
    \\clearpage
    \\amcuiSectionHeading{Section 1: Objective Questions}
    \\amcuiSectionText{This section ...}
    \\shufflegroup{sectionI}
    \\begin{multicols}{2}
    \\insertgroup[15]{sectionI}
    \\end{multicols}
    %%AMCUI:END SECTION%%

An exam written without markers still shows its \\insertgroup commands as
sections (count and shuffle editable; the first other edit adds the
markers), and an exam whose questions sit inside \\onecopy can be
organised: each question moves into an \\element and one section takes
their place.

Page breaks: each section starts on a new page (the \\clearpage line) or
not. The panel also sets them for the whole paper: the first section,
and every later one (on a new page, or right after the previous
section). That choice is kept when a section is added, moved or removed,
unless the sections have their own, differing settings.

An instructions summary, one line per section made from the sections'
counts and marks, is kept up to date between %%AMCUI:SUMMARY%% markers
when the paper has them. Everything else in the file is left as written.
Standard library only.
"""
import re

import ui_scale as scale
import ui_questions
from ui_questions import EditError

NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9-]{0,39}$")  # names the panel gives
# names it can manage when the LaTeX already has them (\element{Part 1}): anything a marker line can hold
LOOSE_NAME_RE = re.compile(r"^[^%{}\\\n\r]{1,60}$")
MAX_TEXT = 5000

_SECTION_BEGIN = re.compile(r"^([ \t]*)%%AMCUI:SECTION[ \t]+([^%\n]+?)[ \t]*%%[ \t]*$", re.M)
_SECTION_END = re.compile(r"^[ \t]*%%AMCUI:END SECTION%%[ \t]*$", re.M)
_SUMMARY_BEGIN = re.compile(r"^([ \t]*)%%AMCUI:SUMMARY%%[ \t]*$", re.M)
_SUMMARY_END = re.compile(r"^[ \t]*%%AMCUI:END SUMMARY%%[ \t]*$", re.M)

_ONECOPY = re.compile(r"\\(?:onecopy|exemplaire)\s*\{\s*(\d+)\s*\}\s*\{")  # \exemplaire: AMC's French name
_INSERT = re.compile(r"\\insertgroup(?![A-Za-z])\s*(?:\[\s*(\d+)\s*\])?\s*\{([^{}]*)\}")
_SHUFFLE = re.compile(r"\\shufflegroup(?![A-Za-z])\s*\{([^{}]*)\}")
_MULTICOLS = re.compile(r"\\begin\s*\{multicols\*?\}\s*\{\s*(\d+)\s*\}")
_HEADING = re.compile(r"\\amcuiSectionHeading(?![A-Za-z])")
_TEXT = re.compile(r"\\amcuiSectionText(?![A-Za-z])")
_NEWPAGE = re.compile(r"\\(?:clearpage|newpage|pagebreak)(?![A-Za-z])")
_SHEET_START = re.compile(r"\\(?:AMCcleardoublepage|AMCaddpagesto|AMCformBegin|AMCform|amcuiPaperBack)(?![A-Za-z])")

MACROS = ("%%AMCUI:MACROS%%\n"
          "% Section headings written by the Paper design panel.\n"
          "\\providecommand{\\amcuiSectionHeading}[1]{\\par\\vspace{2ex}{\\centering\\bfseries\\Large #1\\par}\\vspace{1ex}\\hrule\\vspace{2ex}}\n"
          "\\providecommand{\\amcuiSectionText}[1]{\\noindent #1\\par\\vspace{1.5ex}\\hrule\\vspace{2ex}}\n"
          "%%AMCUI:END MACROS%%\n")
# One line of the instructions summary: an item inside a list, a paragraph elsewhere.
POINT_MACRO = ("\\makeatletter\\providecommand{\\amcuiPoint}[1]{\\ifnum\\@listdepth>0 \\item #1\\else\\par\\noindent #1\\par\\smallskip\\fi}\\makeatother"
               "  % the Paper design panel's summary lines\n")

_ESCAPES = {"\\": r"\textbackslash{}", "&": r"\&", "%": r"\%", "$": r"\$", "#": r"\#",
            "_": r"\_", "{": r"\{", "}": r"\}", "~": r"\textasciitilde{}", "^": r"\textasciicircum{}"}


def latex_escape(text):
    return "".join(_ESCAPES.get(c, c) for c in str(text))


def latex_unescape(text):
    out = str(text)
    for plain, esc in sorted(_ESCAPES.items(), key=lambda kv: -len(kv[1])):
        out = out.replace(esc, plain)
    return out


# ---------------------------------------------------------------- pieces of the file

def _line_bounds(text, pos):
    """The whole line holding POS: (start, end after its newline)."""
    s = text.rfind("\n", 0, pos) + 1
    e = text.find("\n", pos)
    return s, (len(text) if e < 0 else e + 1)


def _lines_around(text, span):
    s, e = span
    ls = text.rfind("\n", 0, s) + 1
    le = text.find("\n", e)
    le = len(text) if le < 0 else le + 1
    if text[ls:s].strip() == "" and text[e:le].strip() == "":
        return ls, le
    return s, e


def _tidy_blank(text, pos):
    """At most one blank line where lines were removed at POS."""
    while text[max(0, pos - 2):pos] == "\n\n" and text[pos:pos + 1] == "\n":
        text = text[:pos] + text[pos + 1:]
    return text


def _regions(text, begin, end):
    """Marked regions of one kind, in file order; each with the opening
    line's match, the span of the whole region (whole lines) and the
    inner span between the marker lines."""
    out, pos = [], 0
    while True:
        m = begin.search(text, pos)
        if not m:
            return out
        e = end.search(text, m.end())
        if not e:
            return out
        ls, le = _line_bounds(text, m.start())
        es, ee = _line_bounds(text, e.start())
        out.append({"m": m, "start": ls, "end": ee, "inner": (le, es), "indent": m.group(1),
                    "line": text.count("\n", 0, ls) + 1})
        pos = ee


def _latex(value, what="This text"):
    s = str(value if value is not None else "").replace("\r\n", "\n").strip()
    if len(s) > MAX_TEXT:
        raise EditError(f"{what} is too long.")
    s = ui_questions._latex(s)  # braces by depth, a bare % escaped, no question structure
    if "%%AMCUI" in s:
        raise EditError("This text can't hold a panel marker.")
    return s


def _braced(text, i):
    """The {...} group at text[i] (after spaces), skipping % comments:
    (content, start, end)."""
    while i < len(text) and text[i] in " \t":
        i += 1
    if i >= len(text) or text[i] != "{":
        return None
    depth, j = 0, i
    while j < len(text):
        c = text[j]
        if c == "\\":
            j += 2
            continue
        if c == "%":
            nl = text.find("\n", j)
            j = len(text) if nl < 0 else nl
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return text[i + 1:j], i, j + 1
        j += 1
    return None


def onecopy(text):
    """(copies, body span, position of \\onecopy) of the paper, or None."""
    for m in _ONECOPY.finditer(text):
        if scale._in_comment(text, m.start()):
            continue
        b = _braced(text, m.end() - 1)
        if b:
            return int(m.group(1)), (m.end(), b[2] - 1), m.start()
    return None


def _in_multicols(text, pos):
    """Whether POS sits inside a \\begin{multicols} the teacher wrote."""
    depth = 0
    for m in re.finditer(r"\\(begin|end)\s*\{multicols\*?\}", text[:pos]):
        if not scale._in_comment(text, m.start()):
            depth += 1 if m.group(1) == "begin" else -1
    return depth > 0


def _body(text):
    oc = onecopy(text)
    return oc[1] if oc else (0, len(text))


def ensure_macros(text):
    """The heading macros, defined before \\begin{document} when the file
    doesn't have them (a starter has its own)."""
    if re.search(r"\\(?:providecommand|newcommand|renewcommand|def)\s*\{?\\amcuiSectionHeading(?![A-Za-z])", text):
        return text
    m = re.search(r"^[ \t]*\\begin\s*\{document\}", text, re.M)
    if not m:
        raise EditError("The file has no \\begin{document}.")
    return text[:m.start()] + MACROS + "\n" + text[m.start():]


def ensure_point_macro(text):
    """\\amcuiPoint, used by the instructions summary's lines."""
    if re.search(r"\\(?:providecommand|newcommand|renewcommand|def)\s*\{?\\amcuiPoint(?![A-Za-z])", text):
        return text
    m = re.search(r"^[ \t]*\\begin\s*\{document\}", text, re.M)
    if not m:
        raise EditError("The file has no \\begin{document}.")
    return text[:m.start()] + POINT_MACRO + text[m.start():]


def ensure_package(text, package):
    for m in re.finditer(r"\\usepackage\s*(?:\[[^\]]*\])?\s*\{([^{}]*)\}", text):
        if not scale._in_comment(text, m.start()) and package in [p.strip() for p in m.group(1).split(",")]:
            return text
    m = re.search(r"^[ \t]*\\begin\s*\{document\}", text, re.M)
    if not m:
        raise EditError("The file has no \\begin{document}.")
    return text[:m.start()] + "\\usepackage{" + package + "}\n" + text[m.start():]


# ---------------------------------------------------------------- sections

# The lines of a region the panel writes itself, in the order it writes them.
# Anything else between the markers (a \\vspace, a note, another command) is
# kept where it was, anchored to the panel line it followed.
_KINDS = ("begin", "newpage", "heading", "text", "shuffle", "cols_begin", "insert", "cols_end")


def _owned_kind(line, name):
    """Which of the panel's lines this is, or None."""
    t = line.strip()
    n = re.escape(name)
    if re.fullmatch(r"\\(?:clearpage|newpage|pagebreak)", t):
        return "newpage"
    if re.fullmatch(r"\\shufflegroup\s*\{\s*" + n + r"\s*\}", t):
        return "shuffle"
    if re.fullmatch(r"\\begin\s*\{multicols\*?\}\s*\{\s*\d+\s*\}", t):
        return "cols_begin"
    if re.fullmatch(r"\\end\s*\{multicols\*?\}", t):
        return "cols_end"
    if re.fullmatch(r"\\insertgroup\s*(?:\[\s*\d+\s*\])?\s*\{\s*" + n + r"\s*\}", t):
        return "insert"
    return None


def _parse_region(text, r):
    a, b = r["inner"]
    inner = text[a:b]
    sec = {"name": r["m"].group(2), "heading": None, "text": None, "count": None, "shuffle": False,
           "columns": 0, "newpage": False, "markers": True, "span": (r["start"], r["end"]),
           "line": r["line"], "indent": r["indent"], "extras": []}
    lines = inner.split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    last, i = "begin", 0
    while i < len(lines):
        line = lines[i]
        t = line.strip()
        kind = _owned_kind(line, sec["name"])
        if kind is None and (_HEADING.match(t) or _TEXT.match(t)):
            # \amcuiSectionHeading{...}: the braces may run over several lines
            which = "heading" if _HEADING.match(t) else "text"
            rest = "\n".join(lines[i:])
            m = (_HEADING if which == "heading" else _TEXT).match(rest.lstrip())
            g = _braced(rest.lstrip(), m.end())
            if g and rest.lstrip()[g[2]:].split("\n", 1)[0].strip() == "":
                sec[which] = g[0].strip() or None
                i += rest.lstrip()[:g[2]].count("\n") + 1
                last = which
                continue
        if kind == "insert":
            im = _INSERT.search(line)
            sec["count"] = int(im.group(1)) if im.group(1) else None
        elif kind == "shuffle":
            sec["shuffle"] = True
        elif kind == "cols_begin":
            sec["columns"] = int(_MULTICOLS.search(line).group(1))
        elif kind == "newpage":
            sec["newpage"] = True
        if kind:
            last = kind
        elif t != "":
            sec["extras"].append((last, line))
        i += 1
    return sec


def read_sections(text):
    """The sections of the paper, in order: marked regions and plain
    \\insertgroup commands in the \\onecopy body."""
    body = _body(text)
    sections, covered = [], []
    for r in _regions(text, _SECTION_BEGIN, _SECTION_END):
        if not (body[0] <= r["start"] < body[1]):
            continue
        sections.append(_parse_region(text, r))
        covered.append((r["start"], r["end"]))
    shuffled = {sm.group(1).strip() for sm in _SHUFFLE.finditer(text, body[0], body[1])
                if not scale._in_comment(text, sm.start()) and not any(s <= sm.start() < e for s, e in covered)}
    for m in _INSERT.finditer(text, body[0], body[1]):
        if scale._in_comment(text, m.start()) or any(s <= m.start() < e for s, e in covered):
            continue
        name = m.group(2).strip()
        ls, le = _line_bounds(text, m.start())
        span = (ls, le)
        if ls > 0:  # a \shufflegroup{name} on the line before belongs to it
            ps = text.rfind("\n", 0, ls - 1) + 1
            if re.fullmatch(r"[ \t]*\\shufflegroup\s*\{\s*" + re.escape(name) + r"\s*\}[ \t]*\n", text[ps:ls]):
                span = (ps, le)
        # whatever else shares the line (\newpage before, \end{multicols} after) is kept around the command
        extras = []
        if text[ls:m.start()].strip():
            extras.append(("begin", text[ls:m.start()].rstrip()))
        if text[m.end():le].strip():
            extras.append(("insert", re.match(r"[ \t]*", text[ls:]).group(0) + text[m.end():le].strip()))
        sections.append({"name": name, "heading": None, "text": None,
                         "count": int(m.group(1)) if m.group(1) else None, "shuffle": name in shuffled,
                         "columns": 0, "newpage": False, "markers": False, "span": span,
                         "line": text.count("\n", 0, m.start()) + 1,
                         "indent": re.match(r"[ \t]*", text[ls:]).group(0), "extras": extras})
    sections.sort(key=lambda s: s["span"][0])
    return sections


def _section(sections, name):
    for s in sections:
        if s["name"] == name:
            return s
    raise EditError(f"The section \"{name}\" isn't in the paper any more.")


def region_text(sec, indent="", extras=()):
    """The region's lines from the section's fields; EXTRAS, lines the
    teacher wrote between the markers, stay after the panel line they
    followed."""
    name = sec["name"]
    cols = int(sec.get("columns") or 0)
    n = sec.get("count")
    own = {"begin": f"{indent}%%AMCUI:SECTION {name}%%",
           "newpage": f"{indent}\\clearpage" if sec.get("newpage") else None,
           "heading": f"{indent}\\amcuiSectionHeading{{{sec['heading']}}}" if sec.get("heading") else None,
           "text": f"{indent}\\amcuiSectionText{{{sec['text']}}}" if sec.get("text") else None,
           "shuffle": f"{indent}\\shufflegroup{{{name}}}" if sec.get("shuffle") else None,
           "cols_begin": f"{indent}\\begin{{multicols}}{{{cols}}}" if cols > 1 else None,
           "insert": f"{indent}\\insertgroup" + (f"[{int(n)}]" if n else "") + f"{{{name}}}",
           "cols_end": f"{indent}\\end{{multicols}}" if cols > 1 else None}
    lines = []
    for kind in _KINDS:
        if own[kind]:
            lines.append(own[kind])
        lines += [line for anchor, line in extras if anchor == kind]
    lines.append(f"{indent}%%AMCUI:END SECTION%%")
    return "\n".join(lines) + "\n"


def _fields(sec, fields):
    """The section's fields with FIELDS applied and checked."""
    new = {k: sec.get(k) for k in ("name", "heading", "text", "count", "shuffle", "columns", "newpage")}
    for k in ("heading", "text", "count", "shuffle", "columns", "newpage"):
        if k in fields:
            new[k] = fields[k]
    new["heading"] = _latex(new.get("heading") or "", "The heading") or None
    new["text"] = _latex(new.get("text") or "", "The instructions") or None
    n = new.get("count")
    try:
        n = int(n) if n not in (None, "", 0, "0", "all") else None
    except (TypeError, ValueError):
        raise EditError("The number of questions per copy is a whole number.") from None
    if n is not None and not 1 <= n <= 999:
        raise EditError("The number of questions per copy is between 1 and 999.")
    new["count"] = n
    try:
        cols = int(new.get("columns") or 0)
    except (TypeError, ValueError):
        raise EditError("Columns: 1 to 4.") from None
    if not 0 <= cols <= 4:
        raise EditError("Columns: 1 to 4.")
    new["columns"] = cols if cols > 1 else 0
    new["shuffle"] = bool(new.get("shuffle"))
    new["newpage"] = bool(new.get("newpage"))
    return new


def _prepare(text, new):
    if new.get("heading") or new.get("text"):
        text = ensure_macros(text)
    if new.get("columns"):
        text = ensure_package(text, "multicol")
    return text


def _drop_stray_shuffle(text, name):
    """\\shufflegroup{name} lines outside the section's own region."""
    body = _body(text)
    covered = [(r["start"], r["end"]) for r in _regions(text, _SECTION_BEGIN, _SECTION_END)]
    for m in reversed(list(_SHUFFLE.finditer(text, body[0], body[1]))):
        if m.group(1).strip() != name or scale._in_comment(text, m.start()) or any(s <= m.start() < e for s, e in covered):
            continue
        s, e = _lines_around(text, (m.start(), m.end()))
        text = text[:s] + text[e:]
    return text


def set_section(text, name, fields):
    """Rewrite one section's region from its fields (adding the markers
    to a plain \\insertgroup); what else the teacher wrote between the
    markers stays."""
    sec = _section(read_sections(text), name)
    if not LOOSE_NAME_RE.match(name):
        raise EditError(f"The group \"{name}\" has a name the panel can't write; rename it in the LaTeX tab.")
    new = _fields(sec, fields)
    if new["columns"] and (_in_multicols(text, sec["span"][0])
                           or any(_MULTICOLS.search(line) for _, line in sec.get("extras") or ())):
        raise EditError("This section is already inside a \\begin{multicols} written in the LaTeX; set its columns there.")
    text = _prepare(text, new)
    sec = _section(read_sections(text), name)
    out = text[:sec["span"][0]] + region_text(new, sec["indent"], sec.get("extras") or ()) + text[sec["span"][1]:]
    return _drop_stray_shuffle(out, name) if not sec["markers"] else out


def breaks(sections):
    """The page breaks as the panel shows them: (first, between). FIRST:
    whether the first section starts on a new page; BETWEEN: whether each
    later section does, None when they differ or there is only one."""
    if not sections:
        return None, None
    rest = {bool(s["newpage"]) for s in sections[1:]}
    return bool(sections[0]["newpage"]), (rest.pop() if len(rest) == 1 else None)


def set_breaks(text, first=None, between=None):
    """The first section on a new page or not (FIRST), every later one on
    a new page or right after the previous one (BETWEEN); None leaves it."""
    for i, sec in enumerate(read_sections(text)):
        want = first if i == 0 else between
        if want is None or bool(sec["newpage"]) == bool(want):
            continue
        text = set_section(text, sec["name"], {"newpage": bool(want)})
    return text


def _keep_breaks(text, before):
    """After a section is moved or removed: the paper-wide choice stays
    (the first section and the later ones), unless the sections had
    their own, differing choices."""
    first, between = before
    return text if between is None else set_breaks(text, first, between)


def group_names(text):
    """Every group named in the file: sections and \\element wrappers."""
    names = {s["name"] for s in read_sections(text)}
    for m in re.finditer(r"\\element\s*\{([^{}]*)\}", text):
        if not scale._in_comment(text, m.start()):
            names.add(m.group(1).strip())
    return names


def _check_name(name, text, others=(), existing=()):
    """A new section's name: a plain word; or a group the LaTeX already
    has (EXISTING), whatever it is called, for a section that prints it."""
    name = str(name or "").strip()
    if not NAME_RE.match(name) and not (name in existing and LOOSE_NAME_RE.match(name)):
        raise EditError("A section's name is a word of letters, digits and - (40 at most), starting with a letter.")
    if name in {s["name"] for s in read_sections(text)} or name in others:
        raise EditError(f"A section named \"{name}\" exists already.")
    return name


def _insert_point(text):
    """Where a first section goes: before the answer sheet (or the paper
    builder's closing part), else at the end of the \\onecopy body."""
    oc = onecopy(text)
    if oc:
        a, e = oc[1]
        for m in _SHEET_START.finditer(text, a, e):
            if not scale._in_comment(text, m.start()):
                ls, _ = _line_bounds(text, m.start())
                return ls, re.match(r"[ \t]*", text[ls:]).group(0)
        ls, _ = _line_bounds(text, e)
        return ls, ""
    m = re.search(r"^[ \t]*\\end\s*\{document\}", text, re.M)
    if not m:
        raise EditError("Nowhere to put a section: the file has no \\onecopy or \\end{document}.")
    return m.start(), ""


def add_section(text, fields, after=None, existing=()):
    name = _check_name(fields.get("name"), text, existing=existing)
    base = {"name": name, "shuffle": False, "columns": 0}
    secs = read_sections(text)
    if "newpage" not in fields and secs:
        # a section added after others follows their page breaks
        base["newpage"] = bool(breaks(secs)[1]) if len(secs) > 1 else False
    new = _fields(base, fields)
    new["name"] = name
    text = _prepare(text, new)
    sections = read_sections(text)
    if after:
        ref = _section(sections, after)
        at, indent = ref["span"][1], ref["indent"]
    elif sections:
        at, indent = sections[-1]["span"][1], sections[-1]["indent"]
    else:
        at, indent = _insert_point(text)
    lead = "" if at == 0 or text[at - 1] == "\n" else "\n"
    return text[:at] + lead + region_text(new, indent) + text[at:], name


def rename_elements(text, old, new):
    """\\element{old}{ -> \\element{new}{ (also for the other source files)."""
    return re.sub(r"(\\element\s*\{\s*)" + re.escape(old) + r"(\s*\})", lambda m: m.group(1) + new + m.group(2), text)


def rename_section(text, old, new, other_groups=()):
    """OTHER_GROUPS: the groups named in the other source files, which the
    new name mustn't take either."""
    sec = _section(read_sections(text), old)
    new = _check_name(new, text, (group_names(text) | set(other_groups)) - {sec["name"]})
    out = re.sub(r"(\\(?:insertgroup|shufflegroup|cleargroup|setgroupmode)(?![A-Za-z])\s*(?:\[[^\]]*\])?\s*\{\s*)" + re.escape(old) + r"(\s*\})",
                 lambda m: m.group(1) + new + m.group(2), text)
    out = re.sub(r"(%%AMCUI:SECTION[ \t]+)" + re.escape(old) + r"([ \t]*%%)", lambda m: m.group(1) + new + m.group(2), out)
    return rename_elements(out, old, new), new


def move_section(text, name, before=None):
    """Move a section before another one, or to the end."""
    for n in (name, before):
        if n and not _section(read_sections(text), n)["markers"]:
            text = set_section(text, n, {})
    sec = _section(read_sections(text), name)
    block = text[sec["span"][0]:sec["span"][1]]
    out = _tidy_blank(text[:sec["span"][0]] + text[sec["span"][1]:], sec["span"][0])
    sections = read_sections(out)
    if before:
        at = _section(sections, before)["span"][0]
    elif sections:
        at = sections[-1]["span"][1]
    else:
        return text
    lead = "" if at == 0 or out[at - 1] == "\n" else "\n"
    return out[:at] + lead + block + out[at:]


def delete_section(text, name):
    sec = _section(read_sections(text), name)
    return _tidy_blank(text[:sec["span"][0]] + text[sec["span"][1]:], sec["span"][0])


def inline_questions(text, questions=None):
    """Questions written inside the \\onecopy body without an \\element."""
    oc = onecopy(text)
    if not oc:
        return []
    a, e = oc[1]
    qs = scale.read_latex(text) if questions is None else questions
    return [q for q in qs if q["group"] is None and a <= q["span"][0] < e]


def convert_inline(text, name="main"):
    """Move the questions written inside \\onecopy into \\element{name}
    blocks before it, and print them with one section in their place."""
    if not onecopy(text):
        raise EditError("The file has no \\onecopy{...}{...} block, so its questions can't be organised here.")
    inline = inline_questions(text)
    if not inline:
        raise EditError("Every question is in a section already.")
    taken = group_names(text)
    base = name if NAME_RE.match(str(name or "")) else "main"
    name, k = base, 1
    while name in taken:
        k += 1
        name = f"{base}{k}"
    first_ls = _line_bounds(text, inline[0]["block_span"][0])[0]
    indent = re.match(r"[ \t]*", text[first_ls:]).group(0)
    # between the questions, only blank lines and comments: anything else would change place
    for a, b in zip(inline, inline[1:]):
        between = text[a["block_span"][1]:b["block_span"][0]]
        if any(l.strip() and not l.strip().startswith("%") for l in between.split("\n")):
            raise EditError("There is LaTeX between the questions (a heading, a space...). Organising would move the "
                            "questions away from it: move it before or after them in the LaTeX tab first.")
    elements, out = [], text
    for q in reversed(inline):
        s, e = _lines_around(out, q["block_span"])
        elements.append(f"\\element{{{name}}}{{\n" + out[s:e].rstrip("\n") + "\n}")
        out = _tidy_blank(out[:s] + out[e:], s)
    elements.reverse()
    out = out[:first_ls] + region_text({"name": name, "count": None, "shuffle": False, "columns": 0}, indent) + out[first_ls:]
    oc_line = _line_bounds(out, onecopy(out)[2])[0]
    head = "% Questions: one \\element per question, so the Paper design panel can count and shuffle them.\n"
    return out[:oc_line] + head + "\n\n".join(elements) + "\n\n" + out[oc_line:], name


# ---------------------------------------------------------------- versions

def set_copies(text, n):
    """\\onecopy{N}: the number of versions of a paper whose copies are
    photocopied (the app's own copies setting follows it)."""
    try:
        n = int(n)
    except (TypeError, ValueError):
        raise EditError("The number of versions is a whole number.") from None
    if not 1 <= n <= 999:
        raise EditError("Versions: 1 to 999.")
    oc = onecopy(text)
    if not oc:
        raise EditError("The file has no \\onecopy{...}{...} block.")
    m = _ONECOPY.match(text, oc[2])
    return text[:m.start(1)] + str(n) + text[m.end(1):], n


# ---------------------------------------------------------------- marks and the summary

def _macro_value(text, name):
    """The value \\def or \\newcommand gives macro NAME, or None."""
    pat = re.compile(r"\\(?:def|(?:re)?newcommand\*?|providecommand\*?)\s*\{?\s*\\" + re.escape(name) + r"(?![A-Za-z])\s*\}?\s*(?:\[\d\])?\s*\{")
    m = pat.search(text)
    while m and scale._in_comment(text, m.start()):
        m = pat.search(text, m.end())
    if not m:
        return None
    g = _braced(text, m.end() - 1)
    return g[0] if g else None


def expand_macros(text, rule, depth=4):
    """Macros in a scoring rule replaced by their \\def values, a few levels."""
    for _ in range(depth):
        changed = False
        def sub(m):
            nonlocal changed
            v = _macro_value(text, m.group(1))
            if v is None:
                return m.group(0)
            changed = True
            return v
        rule = re.sub(r"\\([A-Za-z]+)", sub, rule)
        if not changed:
            break
    return rule


def _number(s):
    try:
        v = float(s)
    except (TypeError, ValueError):
        return None
    return str(int(v)) if v == int(v) else ("%g" % v)


def marks(text, rule, kind, numeric_options=""):
    """What a question earns, from its rule (or the file's defaults):
    {"right": "3", "wrong": "-0.75", "blank": "0"} with what is known."""
    if kind == "numeric":
        opts = numeric_options or ""
        if "scoreexact" not in opts:
            opts = _macro_value(text, "AMCnumericOpts") or ""
        opts = expand_macros(text, opts)
        m = re.search(r"scoreexact\s*=\s*([-0-9.]+)", opts)
        return {"right": _number(m.group(1)) if m else None, "wrong": "0", "blank": "0"}
    rule = (rule or "").strip()
    if not rule:
        d = re.search(r"\\scoringDefault" + ("M" if kind == "multiple" else "S") + r"\s*\{", text)
        while d and scale._in_comment(text, d.start()):
            d = re.compile(r"\\scoringDefault" + ("M" if kind == "multiple" else "S") + r"\s*\{").search(text, d.end())
        if d:
            g = _braced(text, d.end() - 1)
            rule = g[0] if g else ""
    rule = expand_macros(text, rule)
    vals = dict(re.findall(r"([a-zA-Z]+)\s*=\s*([-0-9.]+)", rule))
    right = vals.get("b", "1" if kind == "single" else None)
    if kind == "multiple" and "b" not in vals:
        right = None
    wrong = vals.get("m", vals.get("e", "0" if kind == "single" else None))
    blank = vals.get("v", "0")
    return {"right": _number(right) if right is not None else None,
            "wrong": _number(wrong) if wrong is not None else None, "blank": _number(blank)}


def _plain(latex):
    return scale._plain_text(latex or "", 120)


def summary_lines(sections):
    """One instructions line per section, LaTeX, from its count, kind and marks."""
    out = []
    for i, s in enumerate(sections, 1):
        n = s.get("count") or s.get("pool") or 0
        if not n:
            continue
        kinds = s.get("kinds") or {}
        kind = max(kinds, key=kinds.get) if kinds else "single"
        head = re.sub(r"^(?:Section|Part)\s+[0-9IVXA-Z]+\s*[:.\-–—]\s*", "", _plain(s.get("heading")) or "", flags=re.I) or s["name"]
        what = {"single": "each with exactly one correct answer",
                "multiple": "each with one or more correct answers",
                "numeric": "each answered with a number"}[kind]
        digits = s.get("digits")
        if kind == "numeric" and digits:
            what = f"each answered with a whole number of {digits} digits, between {'0' * digits} and {'9' * digits}"
        line = f"\\amcuiPoint{{\\textbf{{Section {i} ({latex_escape(head)}):}} {n} question{'s' if n != 1 else ''}, {what}."
        mk = s.get("marks") or {}
        if mk.get("right"):
            line += f" A correct answer scores \\(\\mathbf{{+{mk['right'].lstrip('+')}}}\\)"
            w = mk.get("wrong")
            if w and _number(w) not in ("0", None):
                line += f" and a wrong one \\(\\mathbf{{{w if w.startswith('-') else '-' + w}}}\\)"
                if mk.get("blank") in ("0", None):
                    line += "; an unanswered question scores 0"
            else:
                line += "; there is no negative marking"
            line += "."
        out.append(line + "}")
    return out


def regenerate_summary(text, sections):
    regions = _regions(text, _SUMMARY_BEGIN, _SUMMARY_END)
    if not regions:
        raise EditError("This paper has no instructions summary to update.")
    r = regions[0]
    indent = r["indent"]
    lines = summary_lines(sections) or ["% No section yet: add sections in Paper design, then update this summary."]
    return text[:r["inner"][0]] + "".join(f"{indent}{l}\n" for l in lines) + text[r["inner"][1]:]


# ---------------------------------------------------------------- reading it all

def pools(questions):
    """Per group: how many elements (what \\insertgroup[n] draws: a question,
    or a set of questions kept together), of which kinds, with which rules."""
    out, seen = {}, set()
    for q in questions:
        g = q.get("group")
        if not g:
            continue
        p = out.setdefault(g, {"n": 0, "questions": 0, "kinds": {}, "rules": {}, "numeric": "", "file": q.get("file")})
        el = q.get("element_id") or id(q)
        if (g, el) not in seen:
            seen.add((g, el))
            p["n"] += 1
        p["questions"] += 1
        p["kinds"][q["kind"]] = p["kinds"].get(q["kind"], 0) + 1
        rule = (q["scoring"] or {}).get("rule", "") or ""
        p["rules"][rule] = p["rules"].get(rule, 0) + 1
        if q.get("numeric") and not p["numeric"]:
            p["numeric"] = q["numeric"].get("options") or ""
    return out


def sections_with_pools(text, questions):
    """The sections of TEXT with their pools, kinds and marks from QUESTIONS
    (every question of the exam, ui_scale.read_latex)."""
    return _with_pools(text, read_sections(text), pools(questions))


def _with_pools(text, sections, by_group):
    for s in sections:
        p = by_group.get(s["name"])
        s["pool"] = p["n"] if p else 0
        s["kinds"] = p["kinds"] if p else {}
        kind = max(p["kinds"], key=p["kinds"].get) if p and p["kinds"] else "single"
        rule = max(p["rules"], key=p["rules"].get) if p and p["rules"] else ""
        s["rule"] = rule or None
        s["marks"] = marks(text, rule, kind, p["numeric"] if p else "")
        d = re.search(r"digits\s*=\s*(\d+)", p["numeric"]) if p and kind == "numeric" else None
        s["digits"] = int(d.group(1)) if d else None
        s["problem"] = None
        if not s["pool"]:
            s["problem"] = "No question in this section yet."
        elif s["count"] and s["count"] > s["pool"]:
            s["problem"] = f"Only {s['pool']} question{'s' if s['pool'] != 1 else ''} for {s['count']} per copy."
    return sections


def read(text, main, questions):
    """The paper's structure for the panel. QUESTIONS: every question of
    the exam (all source files, ui_scale.read_latex)."""
    by_group = pools(questions)
    sections = _with_pools(text, read_sections(text), by_group)
    # where a question added to a section goes: the file of its group's
    # questions, else the file with most grouped questions, else the main file
    counts = {}
    for q in questions:
        if q.get("group") and q.get("file"):
            counts[q["file"]] = counts.get(q["file"], 0) + 1
    default_file = max(counts, key=counts.get) if counts else main
    for s in sections:
        p = by_group.get(s["name"])
        s["file"] = (p and p.get("file")) or default_file
    oc = onecopy(text)
    inline = inline_questions(text, [q for q in questions if q.get("file") == main]) if oc else []
    used = {s["name"] for s in sections}
    unused = [{"name": g, "pool": p["n"]} for g, p in sorted(by_group.items()) if g not in used]
    return {"copies": oc[0] if oc else None, "onecopy": bool(oc),
            "sections": [{k: s[k] for k in ("name", "heading", "text", "count", "shuffle", "columns", "newpage",
                                             "markers", "line", "pool", "kinds", "rule", "marks", "problem", "file")}
                         for s in sections],
            "inline": len(inline), "unused": unused,
            "breaks": dict(zip(("first", "between"), breaks(sections))),
            "summary": bool(_regions(text, _SUMMARY_BEGIN, _SUMMARY_END))}


# ---------------------------------------------------------------- applying edits

def apply(text, ops, others=()):
    """Apply the panel's edits in order. Returns (text, what changed,
    renames) where renames = [(old, new)] to apply to the other source
    files' \\element wrappers. OTHERS: the other files' questions, for
    the summary."""
    if not isinstance(ops, list) or not ops or len(ops) > 100:
        raise EditError("Nothing to change.")
    other_groups = {q["group"] for q in others if q.get("group")}
    done, renames = [], []
    for op in ops:
        if not isinstance(op, dict):
            raise EditError("Unknown change.")
        kind = str(op.get("op", ""))
        name = str(op.get("name", "") or "")
        if kind == "section_set":
            text = set_section(text, name, op)
            done.append(f"section {name} changed")
        elif kind == "section_add":
            text, new = add_section(text, op, after=op.get("after") or None, existing=group_names(text) | other_groups)
            done.append(f"section {new} added")
        elif kind == "section_rename":
            text, new = rename_section(text, name, op.get("new"), other_groups)
            renames.append((name, new))
            done.append(f"section {name} renamed to {new}")
        elif kind == "section_move":
            before = breaks(read_sections(text))
            text = _keep_breaks(move_section(text, name, op.get("before") or None), before)
            done.append(f"section {name} moved")
        elif kind == "section_delete":
            before = breaks(read_sections(text))
            text = _keep_breaks(delete_section(text, name), before)
            done.append(f"section {name} removed")
        elif kind == "sections_break":
            first, between = op.get("first"), op.get("between")
            if first is None and between is None:
                raise EditError("Nothing to change.")
            if not read_sections(text):
                raise EditError("No section yet.")
            text = set_breaks(text, None if first is None else bool(first), None if between is None else bool(between))
            if between is not None:
                done.append("every section on a new page" if between else "each section right after the previous one")
            if first is not None:
                done.append("the first section on a new page" if first else "the first section right after what comes before it")
        elif kind == "convert":
            text, new = convert_inline(text, op.get("name") or "main")
            done.append(f"questions organised into section {new}")
        elif kind == "copies":
            text, n = set_copies(text, op.get("n"))
            done.append(f"{n} versions")
        elif kind == "summary":
            qs = scale.read_latex(text) + list(others)
            text = regenerate_summary(ensure_point_macro(text), _with_pools(text, read_sections(text), pools(qs)))
            done.append("instructions summary updated")
        else:
            raise EditError("Unknown change.")
    seen = []
    for d in done:
        if d not in seen:
            seen.append(d)
    return text, "Paper design: " + "; ".join(seen), renames
