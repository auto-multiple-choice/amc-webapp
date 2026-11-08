"""
LaTeX for those who want it (doc/features.md, Writing questions).

- problems(): why some LaTeX won't build, found without running LaTeX
  (braces and environments that don't balance), with the line, so a save
  is refused instead of breaking the paper.
- first_error(): the first error of a LaTeX log, traced to the file and
  line it comes from (an item's file rather than "line 900 of exam.tex").
- check_source(): a question compiled alone with the exam's preamble.
- section_document() / split_section(): a section's items as one
  document, with "%%%% item <name> %%%%" separator lines.
- macros(): the commands a preamble defines, for completion.

Standard library only, so tests run without Flask.
"""
import re

SEPARATOR = re.compile(r"^%%%% item ([A-Za-z0-9][A-Za-z0-9-]{0,63}) %%%%[ \t\r]*$", re.M)
_SEPARATOR_LIKE = re.compile(r"^[ \t]*%{3,}[ \t]*item\b.*$", re.M | re.I)
_VERBATIM = re.compile(r"\\begin\s*\{(verbatim\*?|lstlisting|minted|comment)\}(.*?)\\end\s*\{\1\}", re.S)
_TOKENS = re.compile(r"\\begin\s*\{([^{}]*)\}|\\end\s*\{([^{}]*)\}|[{}]")
_BEGIN_DOC = re.compile(r"\\begin\s*\{document\}")
_MACRO_DEF = re.compile(r"\\(?:newcommand|renewcommand|providecommand|DeclareMathOperator|DeclareRobustCommand)\*?\s*\{?\s*\\([A-Za-z@]+)"
                        r"|\\(?:def|gdef|edef|let)\s*\\([A-Za-z@]+)")
CHECK_GROUP = "amcuicheck"


def _line(text, pos):
    return text.count("\n", 0, pos) + 1


_INLINE_VERB = ("verb", "lstinline", "mintinline")


def _mask(text):
    """TEXT with comments, escaped characters (\\{ \\} \\% \\\\), \\verb (and
    \\lstinline, \\mintinline) and verbatim environments replaced by
    spaces, positions kept. Verbatim bodies are cut first, so a \\verb or
    a % inside one can't swallow its \\end."""
    out = list(text)
    i, n = 0, len(text)
    skip = {m.start(2): m.end(2) for m in _VERBATIM.finditer(text)}
    while i < n:
        if i in skip:
            for k in range(i, skip[i]):
                if out[k] != "\n":
                    out[k] = " "
            i = skip[i]
            continue
        c = text[i]
        if c == "\\" and i + 1 < n:
            nxt = text[i + 1]
            if nxt.isalpha():
                j = i + 1
                while j < n and text[j].isalpha():
                    j += 1
                word = text[i + 1:j]
                if word in _INLINE_VERB:
                    k = j
                    if k < n and text[k] == "*":          # \verb*
                        k += 1
                    if word == "lstinline" and k < n and text[k] == "[":
                        k = text.find("]", k)
                        k = n if k < 0 else k + 1
                    if word == "mintinline" and k < n and text[k] == "{":
                        k = text.find("}", k)
                        k = n if k < 0 else k + 1
                    if k < n and not text[k].isalpha() and text[k] not in " \t\n":
                        delim = "}" if text[k] == "{" else text[k]
                        eol = text.find("\n", k + 1)
                        eol = n if eol < 0 else eol
                        end = text.find(delim, k + 1, eol)   # closed on its own line, else to the line end
                        end = eol - 1 if end < 0 else end
                        for m in range(i, end + 1):
                            if out[m] != "\n":
                                out[m] = " "
                        i = end + 1
                        continue
                i = j
                continue
            out[i] = " "
            if nxt != "\n":
                out[i + 1] = " "
            i += 2
            continue
        if c == "%":
            end = text.find("\n", i)
            end = n if end < 0 else end
            for k in range(i, end):
                out[k] = " "
            i = end
            continue
        i += 1
    return "".join(out)


def problems(text):
    """[{"line", "message"}]: the first place where braces or environments
    don't balance, or [] when they do."""
    t = _mask(text)
    stack = []  # ("{", pos) or ("env", name, pos)
    for m in _TOKENS.finditer(t):
        if m.group(1) is not None:
            stack.append(("env", m.group(1).strip(), m.start()))
        elif m.group(2) is not None:
            name = m.group(2).strip()
            if stack and stack[-1][0] == "{":
                return [{"line": _line(text, stack[-1][1]), "message": f"This {{ isn't closed before \\end{{{name}}} (line {_line(text, m.start())})."}]
            if not stack:
                return [{"line": _line(text, m.start()), "message": f"\\end{{{name}}} without a \\begin{{{name}}}."}]
            if stack[-1][1] != name:
                return [{"line": _line(text, m.start()), "message": f"\\end{{{name}}} closes \\begin{{{stack[-1][1]}}} of line {_line(text, stack[-1][2])}."}]
            stack.pop()
        elif m.group(0) == "{":
            stack.append(("{", m.start()))
        else:
            if not stack:
                return [{"line": _line(text, m.start()), "message": "This } closes nothing."}]
            if stack[-1][0] != "{":
                return [{"line": _line(text, m.start()), "message": f"This }} closes nothing inside \\begin{{{stack[-1][1]}}} of line {_line(text, stack[-1][2])}."}]
            stack.pop()
    if stack:
        top = stack[-1]
        if top[0] == "{":
            return [{"line": _line(text, top[1]), "message": "This { is never closed."}]
        return [{"line": _line(text, top[2]), "message": f"\\begin{{{top[1]}}} is never closed."}]
    return []


# ---------------------------------------------------------------- LaTeX logs

_FILE_TOKEN = re.compile(r"\(((?:\./|/)[^\s()]+)|[()]")
_FILE_LINE = re.compile(r"^((?:\./|/)[^:\n]+\.(?:tex|sty|cls|ltx)):(\d+): (.*)$")
LOG_WIDTH = 79  # TeX wraps its log at this width: a line that long goes on in the next one


def _unwrap(log):
    """The log's lines, with the ones TeX wrapped joined again."""
    out, carry = [], ""
    for line in (log or "").split("\n"):
        if len(line) == LOG_WIDTH and not line.startswith("! "):
            carry += line
            continue
        out.append(carry + line)
        carry = ""
    if carry:
        out.append(carry)
    return out


def first_error(log, pdir=""):
    """The first error of a LaTeX log: {"file", "line", "message",
    "context"}; file is relative to the exam folder ("items/x/item.tex"),
    or None when the error is in a package or can't be traced. Reads the
    file:line: form (-file-line-error) when the log has it; otherwise the
    files TeX says it opened, telling a file's ( from a warning's."""
    stack = []  # a file's path, or None for a ( that opened no file
    lines = _unwrap(log)
    at = None
    for idx, line in enumerate(lines):
        if line.startswith("! "):
            at = idx
            break
        m = _FILE_LINE.match(line)
        if m:
            at = idx
            break
        for m in _FILE_TOKEN.finditer(line):
            if m.group(0) == ")":
                if stack:
                    stack.pop()
            elif m.group(0) == "(":
                stack.append(None)
            else:
                stack.append(m.group(1))
    if at is None:
        return None
    m = _FILE_LINE.match(lines[at])
    if m:
        path, lineno, message = m.group(1), int(m.group(2)), m.group(3).strip()
    else:
        path, lineno, message = next((f for f in reversed(stack) if f and f.endswith((".tex", ".sty", ".cls", ".ltx"))), None), None, lines[at][2:].strip()
    context = ""
    for line in lines[at + 1:at + 40]:
        m = re.match(r"^l\.(\d+) ?(.*)$", line)
        if m:
            lineno, context = int(m.group(1)), m.group(2).strip()
            break
    rel = None
    if path:
        root = (pdir or "").rstrip("/") + "/"
        if path.startswith("./"):
            rel = path[2:]
        elif pdir and path.startswith(root):
            rel = path[len(root):]
    return {"file": rel, "line": lineno, "message": message, "context": context}


# ---------------------------------------------------------------- one question alone

def preamble(main_text):
    """The main file up to \\begin{document}, or None."""
    m = _BEGIN_DOC.search(_mask(main_text or ""))
    return main_text[:m.start()] if m else None


def check_source(pre, body, item=None):
    """A document that prints BODY (a question, or a set) once, with the
    exam's preamble PRE. ITEM: the item's name, so its figures are found.
    Returns (source, the line BODY starts at)."""
    head = pre.rstrip("\n") + "\n\\begin{document}\n"
    if item:
        head += "\\graphicspath{{items/" + item + "/}}\n"
    head += "\\onecopy{1}{\n\\element{" + CHECK_GROUP + "}{\n"
    first = head.count("\n") + 1
    return head + body.rstrip("\n") + "\n}\n\\insertgroup{" + CHECK_GROUP + "}\n}\n\\end{document}\n", first


# ---------------------------------------------------------------- a section as one document

def section_document(entries):
    """ENTRIES: [(item name, its LaTeX)] in pool order. Raises ValueError
    naming an item whose text holds a line that reads like a separator:
    the document couldn't be split back as it was."""
    for name, text in entries:
        if _SEPARATOR_LIKE.search(text):
            raise ValueError(f"The item {name} holds a line that looks like a separator (%%%% item ...); edit it in the form.")
    return "".join(f"%%%% item {name} %%%%\n{text.strip(chr(10))}\n\n" for name, text in entries)


def split_section(text):
    """[(item name, LaTeX, line of its separator)] from a section document.
    Raises ValueError (with the line) when a separator is missing, changed
    or doubled, or text comes before the first one."""
    text = (text or "").replace("\r\n", "\n")
    seps = list(SEPARATOR.finditer(text))
    good = {m.start() for m in seps}
    for m in _SEPARATOR_LIKE.finditer(text):
        if m.start() not in good:
            raise ValueError(f"Line {_line(text, m.start())}: this separator line was changed. It must read %%%% item <name> %%%%.")
    if not seps:
        raise ValueError("The separator lines (%%%% item <name> %%%%) are missing.")
    if text[:seps[0].start()].strip():
        raise ValueError("Line 1: there is text before the first separator line.")
    out, seen = [], set()
    for i, m in enumerate(seps):
        name = m.group(1)
        if name.lower() in seen:
            raise ValueError(f"Line {_line(text, m.start())}: the item {name} appears twice.")
        seen.add(name.lower())
        end = seps[i + 1].start() if i + 1 < len(seps) else len(text)
        out.append((name, text[m.end():end].strip("\n") + "\n", _line(text, m.start())))
    return out


def macros(text):
    """The names of the commands TEXT defines (without the backslash)."""
    out = []
    for m in _MACRO_DEF.finditer(_mask(text or "")):
        name = m.group(1) or m.group(2)
        if name and name not in out:
            out.append(name)
    return out
