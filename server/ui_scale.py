"""
The marking scheme panel's view of an exam's questions
(doc/ui-redesign-plan.md, section 8).

Plain functions, no Flask, so they can be tested on their own:
- question_max(): a question's maximum score from AMC's scoring rules,
  following AMC::Scoring (a perfect copy's score, or MAX);
- read_latex() / read_txt(): the questions found in a source, with the
  places that the panel may change (which answers are correct, the
  question's own \\scoring);
- set_correct() / set_scoring(): those changes, as new source text.

AMC's extracted scale (scoring.sqlite, after "prepare --mode b") is what
counts; a question found in the source is only editable when it agrees
with AMC's data (type, answers, which are correct). Anything unusual is
shown read-only, with a link to the source.
"""
import ast
import re


# ---------------------------------------------------------------- scoring rules

class Unknown(Exception):
    """A rule this module can't evaluate the way AMC would."""


BASE_RULES = "e=0,b=1,m=0,v=0,d=0,auto=-1"   # AMC::Scoring set_default_strategy
NEUTRAL_FULL = "formula={x},MAX={x},v={x},e={x},haut=0,mz=0,d=0"
NEUTRAL_NONE = "formula=0,MAX=0,v=0,e=0,haut=0,mz=0,d=0"
_NEUTRAL_FULL_RE = re.compile(r"^formula=([0-9.]+),MAX=\1,v=\1,e=\1,haut=0,mz=0,d=0$")


def neutral_kind(rule):
    """'none' (not counted), ('full', x) (full marks for everyone) or None."""
    rule = (rule or "").replace(" ", "")
    if rule == NEUTRAL_NONE:
        return "none"
    m = _NEUTRAL_FULL_RE.match(rule)
    return ("full", float(m.group(1))) if m else None


def neutral_rule(kind, points=1):
    if kind == "none":
        return NEUTRAL_NONE
    x = ("%g" % points) if points else "1"
    return NEUTRAL_FULL.format(x=x)


def parse_rules(text):
    """AMC's directives, as AMC::ScoringEnv parse_defs reads them:
    'b=1,m=-0.5' -> [('b', '1'), ('m', '-0.5')]; a value without a name
    (answer scoring such as '2') -> ('_PLAIN_', '2')."""
    out = []
    for part in re.split(r",+", text or ""):
        part = re.sub(r"""^\s*(['"])(.*)\1\s*$""", r"\2", part)
        m = re.match(r"^\s*([.a-zA-Z0-9_-]+)\s*=\s*(.*)$", part, re.S)
        if m:
            value = re.sub(r"""^(['"])(.*)\1$""", r"\2", m.group(2).rstrip())
            out.append((m.group(1), value))
        elif part.strip():
            out.append(("_PLAIN_", part.strip()))
    return out


_ALLOWED = (ast.Expression, ast.BinOp, ast.UnaryOp, ast.Constant, ast.Name, ast.Load,
            ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Mod, ast.USub, ast.UAdd)


def evaluate(expr, variables):
    """Arithmetic over AMC's variables; anything else is Unknown (AMC
    itself hands rules to Perl's eval, so this is the common subset)."""
    expr = str(expr).strip()
    if expr == "":
        return None
    try:
        tree = ast.parse(expr, mode="eval")
    except SyntaxError:
        raise Unknown(expr)
    for node in ast.walk(tree):
        if not isinstance(node, _ALLOWED):
            raise Unknown(expr)
        if isinstance(node, ast.Name) and node.id not in variables:
            raise Unknown(expr)
        if isinstance(node, ast.Constant) and not isinstance(node.value, (int, float)):
            raise Unknown(expr)
    try:
        return float(eval(compile(tree, "<rule>", "eval"), {"__builtins__": {}}, dict(variables)))
    except (ArithmeticError, ValueError):
        raise Unknown(expr)


def question_max(multiple, answers, rules):
    """The maximum score of a question, as AMC computes it: MAX if given,
    else the score of a copy that ticks exactly the correct answers.

    answers: [(number, correct, answer rules)], number 0 being AMC's
    "none of these" box; rules: the rule strings in AMC's order (base,
    the exam's, the type's default, the question's own).
    Raises Unknown for rules AMC would evaluate in ways this can't."""
    d = {}
    for text in rules:
        for k, v in parse_rules(text):
            if k.startswith("set") or k == "requires":
                raise Unknown(k)
            if k != "_PLAIN_":
                d[k] = v
    plain = [a for a in answers if a[0] != 0]
    nb = sum(1 for a in plain if a[1])
    n_ticked = sum(1 for a in answers if a[1])
    var = {"N": len(plain), "NB": nb, "NM": len(plain) - nb, "NBC": nb, "NMC": 0,
           "N_ALL": len(answers), "N_RIGHT": len(answers), "N_TICKED": n_ticked,
           "NONEOF_TICKED": 0, "IMULT": 1 if multiple else 0, "IS": 0 if multiple else 1}

    def ev(k, src=None):
        src = d if src is None else src
        return evaluate(src[k], var) if k in src else None

    if "MAX" in d:
        return ev("MAX") or 0.0
    if n_ticked == 0:
        return ev("v") or 0.0
    if multiple:
        if ev("haut"):
            d["d"] = "%s-N" % ev("haut")
            d.setdefault("p", "0")
        elif ev("mz"):
            mz = ev("mz")
            d["d"] = str(mz)
            d.setdefault("p", "0")
            d["b"] = "0"
            d["m"] = str(-(abs(mz) + abs(ev("p") or 0) + 1))
        if d.get("formula", "").strip():
            score = ev("formula") or 0.0
        else:
            score = 0.0
            for _, _, rule in plain:
                ad = dict(d)
                ad.update((k, v) for k, v in parse_rules(rule) if k != "_PLAIN_")
                score += ev("b", ad) or 0.0
                if "bforce" in ad:
                    d["force"] = ad["bforce"]
        if "force" in d:
            return ev("force") or 0.0
        score += ev("d") or 0.0
        p, ceiling = ev("p"), ev("P")
        if p is not None and score < p:
            score = p
        if ceiling is not None and score > ceiling:
            score = ceiling
        return score
    if "mz" in d:
        d["b"] = d["mz"]
        d["d"] = "0"
    if d.get("formula", "").strip():
        return ev("formula") or 0.0
    ticked = [a for a in answers if a[1]][-1]
    values = [v for k, v in parse_rules(ticked[2]) if k == "_PLAIN_"]
    if values:
        return evaluate(values[-1], var) or 0.0
    auto = ev("auto")
    if auto is not None and auto > -1:
        return ticked[0] + auto - 1
    return ev("b") or 0.0


# ---------------------------------------------------------------- LaTeX sources

_BEGIN_Q = re.compile(r"\\begin\s*\{(questionmult|question)\}\s*\{([^{}]*)\}")
_CHOICE = re.compile(r"\\(correctchoice|wrongchoice|bonne|mauvaise)(?![A-Za-z])")
_CHOICES_ENV = re.compile(r"\\(begin|end)\s*\{(choices|choiceshoriz|choicescustom|reponses|reponseshoriz)\}")
_SCORING = re.compile(r"\\(scoring|bareme)(?![A-Za-z])\s*")
_CORRECT = {"correctchoice": True, "bonne": True, "wrongchoice": False, "mauvaise": False}
_SWAP = {("correctchoice", False): "wrongchoice", ("wrongchoice", True): "correctchoice",
         ("bonne", False): "mauvaise", ("mauvaise", True): "bonne"}


def _in_comment(text, pos):
    start = text.rfind("\n", 0, pos) + 1
    i = start
    while i < pos:
        if text[i] == "\\":
            i += 2
            continue
        if text[i] == "%":
            return True
        i += 1
    return False


def _braced(text, i):
    """The {...} group at text[i] (after spaces): (content, start, end)."""
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
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return text[i + 1:j], i, j + 1
        j += 1
    return None


def _plain_text(latex, limit=160):
    t = re.sub(r"(?<!\\)%.*", " ", latex)
    t = re.sub(r"\\(?:scoring|bareme)\s*\{[^{}]*\}", " ", t)
    t = re.sub(r"\\[a-zA-Z]+\*?(\[[^\]]*\])?", " ", t)
    t = re.sub(r"[{}$~\\]", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t if len(t) <= limit else t[:limit - 1].rstrip() + "…"


def read_latex(text, filename=""):
    """The questions of a LaTeX source: id, file, line, type, answers
    (text, correct, where the command is) and the question's own
    \\scoring (rule and where it is)."""
    questions = []
    for m in _BEGIN_Q.finditer(text):
        if _in_comment(text, m.start()):
            continue
        env, qid = m.group(1), m.group(2).strip()
        end = re.compile(r"\\end\s*\{" + env + r"\}").search(text, m.end())
        if not end:
            continue
        q = {"id": qid, "file": filename, "format": "latex", "multiple": env == "questionmult",
             "line": text.count("\n", 0, m.start()) + 1, "begin_end": m.end(),
             "answers": [], "scoring": None, "problem": None}
        lo, hi = m.end(), end.start()
        spans, depth, start = [], 0, None
        for e in _CHOICES_ENV.finditer(text, lo, hi):
            if _in_comment(text, e.start()):
                continue
            if e.group(1) == "begin":
                depth += 1
                if depth == 1:
                    start = e.start()
            elif depth:
                depth -= 1
                if depth == 0:
                    spans.append((start, e.end()))
        inside = lambda pos: any(a <= pos < b for a, b in spans)
        for c in _CHOICE.finditer(text, lo, hi):
            if _in_comment(text, c.start()):
                continue
            j = c.end()
            opt = re.match(r"\s*\[[^\]]*\]", text[j:hi])
            if opt:
                j += opt.end()
            g = _braced(text, j)
            q["answers"].append({"cmd": c.group(1), "at": (c.start() + 1, c.end()),
                                 "correct": _CORRECT[c.group(1)],
                                 "text": _plain_text(g[0], 80) if g else ""})
        own = []
        for s in _SCORING.finditer(text, lo, hi):
            if _in_comment(text, s.start()) or inside(s.start()):
                continue
            g = _braced(text, s.end())
            if g:
                own.append({"rule": g[0].strip(), "at": (s.start(), g[2]), "inner": (g[1] + 1, g[2] - 1)})
        if len(own) > 1:
            q["problem"] = "The question has more than one \\scoring command."
        q["scoring"] = own[0] if own else None
        first_choices = spans[0][0] if spans else hi
        q["text"] = _plain_text(text[lo:first_choices])
        if not q["answers"]:
            q["problem"] = q["problem"] or "No \\correctchoice or \\wrongchoice found."
        questions.append(q)
    return questions


# ---------------------------------------------------------------- AMC-TXT sources

_TXT_Q = re.compile(r"^(\s*)(\*{1,2})(<[^>]*>)?(\[[^\]]*\])?(\{[^}]*\})?\s*(.*)$")
_TXT_A = re.compile(r"^(\s*)([+-])(\[[^\]]*\])?(\{[^}]*\})?\s*(.*)$")
_TXT_GROUP = re.compile(r"^\s*\*[()]")


def _txt_options(group):
    out = {}
    for part in (group or "")[1:-1].split(","):
        if "=" in part:
            k, v = part.split("=", 1)
            out[k.strip().lower()] = v.strip()
    return out


def read_txt(text, filename=""):
    """The questions of an AMC-TXT source. Ids are as AMC gives them:
    the id= or name= option, else Q001, Q002... in order."""
    questions, n, pos, current = [], 0, 0, None
    for i, line in enumerate(text.split("\n")):
        start = pos
        pos += len(line) + 1
        if not line.strip() or line.lstrip().startswith("#") or _TXT_GROUP.match(line):
            continue
        m = _TXT_Q.match(line)
        if m:
            opts = _txt_options(m.group(4))
            qid = opts.get("id") or opts.get("name")
            if not qid:
                n += 1
                qid = "Q%03d" % n
            # where the {scoring} group goes: after *, <...> and [...]
            after = start + len(m.group(1)) + len(m.group(2)) + len(m.group(3) or "") + len(m.group(4) or "")
            sc = m.group(5)
            current = {"id": qid, "file": filename, "format": "txt", "multiple": m.group(2) == "**",
                       "line": i + 1, "answers": [], "problem": None, "text": _plain_text(m.group(6)),
                       "scoring": ({"rule": sc[1:-1].strip(), "at": (after, after + len(sc)), "inner": (after + 1, after + len(sc) - 1)}
                                   if sc else None),
                       "scoring_insert": after}
            questions.append(current)
            continue
        a = _TXT_A.match(line)
        if a and current is not None:
            sign = start + len(a.group(1))
            current["answers"].append({"cmd": a.group(2), "at": (sign, sign + 1),
                                       "correct": a.group(2) == "+", "text": _plain_text(a.group(5), 80)})
    for q in questions:
        if not q["answers"]:
            q["problem"] = "No answers (+ or - lines) found."
    return questions


# ---------------------------------------------------------------- changes

def set_correct(text, q, answer, correct):
    """Mark answer number `answer` (1 = first in the source) correct or
    not. A single-answer question keeps exactly one correct answer."""
    if not 1 <= answer <= len(q["answers"]):
        raise ValueError("No such answer.")
    want = []
    for i, a in enumerate(q["answers"], 1):
        if i == answer:
            want.append(bool(correct))
        elif not q["multiple"] and correct:
            want.append(False)
        else:
            want.append(a["correct"])
    if not q["multiple"] and sum(want) != 1:
        raise ValueError("A single-answer question needs exactly one correct answer.")
    out = text
    for a, w in sorted(zip(q["answers"], want), key=lambda x: -x[0]["at"][0]):
        if a["correct"] == w:
            continue
        s, e = a["at"]
        new = ("+" if w else "-") if q["format"] == "txt" else _SWAP[(a["cmd"], w)]
        out = out[:s] + new + out[e:]
    return out


def set_scoring(text, q, rule):
    """Set the question's own scoring rule; an empty rule removes it (the
    default scoring applies)."""
    rule = (rule or "").strip()
    sc = q["scoring"]
    if q["format"] == "txt":
        if sc:
            s, e = sc["at"]
            return text[:s] + ("{%s}" % rule if rule else "") + text[e:]
        if not rule:
            return text
        at = q["scoring_insert"]
        return text[:at] + "{%s}" % rule + text[at:]
    if sc:
        if rule:
            s, e = sc["inner"]
            return text[:s] + rule + text[e:]
        s, e = sc["at"]
        return text[:s] + text[e:]
    if not rule:
        return text
    at = q["begin_end"]
    return text[:at] + "\\scoring{%s}" % rule + text[at:]
