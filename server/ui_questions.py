"""
The question editor's edits to a LaTeX source (doc/questions-banks-templates-plan.md,
section 5). Each edit replaces one span found by ui_scale.read_latex(),
so everything else in the file stays as the teacher wrote it. The file
is parsed again after every edit, because positions move.

apply(text, ops) takes a list of edits (dicts with an "op" and usually
the question's "id") and returns the new text with a description of
what changed, for the exam's history. Standard library only.
"""
import re

import ui_scale as scale

ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$")
ENVS = {"single": "question", "multiple": "questionmult", "numeric": "questionmultx"}
NUMERIC_DEFAULT = "digits=3,decimals=0,sign=false"
MAX_LATEX = 20000  # a question's text or an answer


class EditError(ValueError):
    """Why an edit can't be made, in words for the teacher."""


def _find(text, qid):
    qs = scale.read_latex(text)
    found = [q for q in qs if q["id"] == qid]
    if not found:
        raise EditError(f"The question \"{qid}\" isn't in this file any more.")
    if len(found) > 1:
        raise EditError(f"Two questions are named \"{qid}\"; rename one in the LaTeX.")
    return found[0], qs


def _answer(q, i):
    try:
        return q["answers"][int(i)]
    except (IndexError, TypeError, ValueError):
        raise EditError("No such answer.") from None


def _latex(value):
    s = str(value if value is not None else "").replace("\r\n", "\n").strip()
    if len(s) > MAX_LATEX:
        raise EditError("This text is too long.")
    if s.count("{") != s.count("}"):
        raise EditError("The braces { } don't match up.")
    return s


def _replace(text, span, new):
    return text[:span[0]] + new + text[span[1]:]


def _line_indent(text, pos):
    s = text.rfind("\n", 0, pos) + 1
    return re.match(r"[ \t]*", text[s:]).group(0)


def _lines_around(text, span):
    """The span widened to whole lines when nothing else shares them."""
    s, e = span
    ls = text.rfind("\n", 0, s) + 1
    le = text.find("\n", e)
    le = len(text) if le < 0 else le + 1
    if text[ls:s].strip() == "" and text[e:le].strip() == "":
        return ls, le
    return s, e


def _remove_lines(text, span):
    s, e = _lines_around(text, span)
    out = text[:s] + text[e:]
    while out[max(0, s - 2):s] == "\n\n" and out[s:s + 1] == "\n":  # one blank line, not two
        out = out[:s] + out[s + 1:]
    return out


# ---------------------------------------------------------------- one question

def set_text(text, q, latex):
    latex = _latex(latex)
    s, e = q["text_span"]
    if s == e:  # no text yet: on its own line after the opening
        ind = q["indent"] + "  "
        return text[:s] + "\n" + ind + latex.replace("\n", "\n" + ind) + text[e:]
    return _replace(text, (s, e), latex)


def set_answer_text(text, q, i, latex):
    a = _answer(q, i)
    if a["text_span"] is None:
        raise EditError("This answer has no text between braces.")
    return _replace(text, a["text_span"], _latex(latex))


def add_answer(text, q, latex, correct=False):
    ch = q["choices"]
    if not ch:
        raise EditError("This question has no list of answers.")
    cmd = ("\\correctchoice" if correct else "\\wrongchoice") + "{" + _latex(latex) + "}"
    if q["answers"]:
        last = q["answers"][-1]
        at = last["full_span"][1]
        ind = _line_indent(text, last["full_span"][0])
    else:
        at = ch["inner"][0]
        ind = _line_indent(text, ch["span"][0]) + "  "
    return text[:at] + "\n" + ind + cmd + text[at:]


def remove_answer(text, q, i):
    a = _answer(q, i)
    if len(q["answers"]) <= 1:
        raise EditError("A question keeps at least one answer.")
    return _remove_lines(text, a["full_span"])


def move_answer(text, q, i, j):
    n = len(q["answers"])
    i, j = int(i), int(j)
    if not (0 <= i < n and 0 <= j < n):
        raise EditError("No such answer.")
    spans = [a["full_span"] for a in q["answers"]]
    pieces = [text[s:e] for s, e in spans]
    gaps = [text[spans[k][1]:spans[k + 1][0]] for k in range(n - 1)]
    order = list(range(n))
    order.insert(j, order.pop(i))
    out = "".join(pieces[idx] + (gaps[k] if k < n - 1 else "") for k, idx in enumerate(order))
    return text[:spans[0][0]] + out + text[spans[-1][1]:]


def set_numeric(text, q, value, options):
    n = q["numeric"]
    if not n:
        raise EditError("This isn't a numeric question.")
    value, options = _latex(value), _latex(options)
    if not re.fullmatch(r"-?[0-9]+([.,][0-9]+)?", value):
        raise EditError("The answer of a numeric question is a number.")
    if not re.fullmatch(r"[A-Za-z0-9=.,+\-*/ ]*", options):
        raise EditError("The numeric options contain characters AMC doesn't accept.")
    out = text
    if n["options_span"]:
        out = _replace(out, n["options_span"], options)
    else:
        out = out[:n["span"][1]] + "{" + options + "}" + out[n["span"][1]:]
    return _replace(out, n["value_span"], value)


def set_explain(text, q, latex):
    latex = _latex(latex)
    if q["explain"]:
        if latex:
            return _replace(text, q["explain"]["inner"], latex)
        return _remove_lines(text, q["explain"]["span"])
    if not latex:
        return text
    at = q["end_start"]
    ls = text.rfind("\n", 0, at) + 1
    ind = q["indent"] + "  "
    if text[ls:at].strip() == "":  # \end on its own line: a line before it
        return text[:ls] + ind + "\\explain{" + latex + "}\n" + text[ls:]
    return text[:at] + "\n" + ind + "\\explain{" + latex + "}\n" + q["indent"] + text[at:]


def set_type(text, q, kind):
    if kind not in ENVS:
        raise EditError("Unknown question type.")
    if kind == q["kind"]:
        return text
    out = text
    new_env = ENVS[kind]
    # the environment's name, end first so the begin's position holds
    em = re.compile(r"\\end\s*\{" + q["env"] + r"\}").match(out, q["end_start"])
    out = out[:em.start()] + "\\end{" + new_env + "}" + out[em.end():]
    bm = re.compile(r"\\begin\s*\{" + q["env"] + r"\}").match(out, q["span"][0])
    out = out[:bm.start()] + "\\begin{" + new_env + "}" + out[bm.end():]
    q2, _ = _find(out, q["id"])
    ind, ind2 = q2["indent"] + "  ", q2["indent"] + "    "
    if kind == "numeric" and q2["choices"]:
        out = _replace(out, q2["choices"]["span"], "\\AMCnumericChoices{0}{" + NUMERIC_DEFAULT + "}")
    elif kind == "numeric" and not q2["numeric"]:
        out = out[:q2["end_start"]] + "\\AMCnumericChoices{0}{" + NUMERIC_DEFAULT + "}\n" + q2["indent"] + out[q2["end_start"]:]
    elif kind != "numeric" and q2["numeric"]:
        out = _replace(out, q2["numeric"]["span"],
                       "\\begin{choices}\n" + ind2 + "\\correctchoice{Answer 1}\n" + ind2 + "\\wrongchoice{Answer 2}\n" + ind + "\\end{choices}")
    return out


def rename(text, q, qs, new_id):
    new_id = str(new_id or "").strip()
    if not ID_RE.match(new_id):
        raise EditError("A question's name uses letters, digits and . _ - : only (64 at most).")
    if any(x["id"] == new_id for x in qs if x is not q):
        raise EditError(f"Another question is already named \"{new_id}\".")
    m = re.compile(r"(\\begin\s*\{" + q["env"] + r"\}\s*\{)([^{}]*)(\})").match(text, q["span"][0])
    return text[:m.start(2)] + new_id + text[m.end(2):]


# ---------------------------------------------------------------- questions in the file

def new_block(kind, qid, indent="", group=None):
    if kind not in ENVS:
        raise EditError("Unknown question type.")
    env = ENVS[kind]
    i2, i4 = indent + "  ", indent + "    "
    lines = [f"{indent}\\begin{{{env}}}{{{qid}}}", f"{i2}Question text"]
    if kind == "numeric":
        lines.append(f"{i2}\\AMCnumericChoices{{0}}{{{NUMERIC_DEFAULT}}}")
    else:
        lines += [f"{i2}\\begin{{choices}}", f"{i4}\\correctchoice{{Answer 1}}",
                  f"{i4}\\wrongchoice{{Answer 2}}", f"{i2}\\end{{choices}}"]
    lines.append(f"{indent}\\end{{{env}}}")
    if group:
        return "\n".join([f"{indent}\\element{{{group}}}{{"] + ["  " + l for l in lines] + [f"{indent}}}"])
    return "\n".join(lines)


def _free_id(qs, kind):
    ids = {q["id"] for q in qs}
    prefix = "nq" if kind == "numeric" else "q"
    n = sum(1 for q in qs if q["kind"] == kind) + 1 if kind == "numeric" else len(qs) + 1
    while f"{prefix}{n}" in ids:
        n += 1
    return f"{prefix}{n}"


def add_question(text, qs, kind="single", after=None, group=None, qid=None):
    """A new question after AFTER (a question's id), or at the end of
    GROUP's questions, or after the last question; in an exam without
    questions yet, after the header marker or before \\end{document}."""
    if qid:
        if not ID_RE.match(str(qid)):
            raise EditError("A question's name uses letters, digits and . _ - : only.")
        if any(q["id"] == qid for q in qs):
            raise EditError(f"A question is already named \"{qid}\".")
    else:
        qid = _free_id(qs, kind)
    ref = None
    if after:
        ref = next((q for q in qs if q["id"] == after), None)
        if not ref:
            raise EditError(f"The question \"{after}\" isn't in this file any more.")
        if group is None:
            group = ref["group"]
    elif group:
        ref = next((q for q in reversed(qs) if q["group"] == group), None)
    if ref is None and qs:
        ref = qs[-1]
        if group is None:
            group = ref["group"]
    if ref:
        at = text.find("\n", ref["block_span"][1])
        at = len(text) if at < 0 else at
        indent = _line_indent(text, ref["block_span"][0]) if group else ref["indent"]
        return text[:at] + "\n\n" + new_block(kind, qid, indent, group) + text[at:], qid
    m = re.search(r"^[ \t]*%%% end of the header[^\n]*$", text, re.M)
    if m:
        return text[:m.end()] + "\n\n" + new_block(kind, qid, _line_indent(text, m.start()), group) + text[m.end():], qid
    m = re.search(r"\\end\s*\{document\}", text)
    if not m:
        raise EditError("Nowhere to put a question: the file has no \\end{document}.")
    return text[:m.start()] + new_block(kind, qid, "", group) + "\n\n" + text[m.start():], qid


def delete_question(text, q):
    return _remove_lines(text, q["block_span"])


def move_question(text, q, before=None):
    """Move the question's block before another question's, or to the
    end when BEFORE is None."""
    s, e = _lines_around(text, q["block_span"])
    block = text[s:e]
    if not block.endswith("\n"):
        block += "\n"
    out = text[:s] + text[e:]
    while out[max(0, s - 2):s] == "\n\n" and out[s:s + 1] == "\n":
        out = out[:s] + out[s + 1:]
    qs = scale.read_latex(out)
    if before:
        t = next((x for x in qs if x["id"] == before), None)
        if not t:
            raise EditError(f"The question \"{before}\" isn't in this file any more.")
        at = out.rfind("\n", 0, t["block_span"][0]) + 1
        return out[:at] + block + "\n" + out[at:]
    if not qs:
        return text
    at = out.find("\n", qs[-1]["block_span"][1])
    at = len(out) if at < 0 else at + 1
    return out[:at] + "\n" + block + out[at:]


# ---------------------------------------------------------------- applying edits

def apply(text, ops):
    """Apply the edits in order. Returns (new text, what changed) or raises
    EditError. Each edit is a dict with "op" and, except for "add", "id"."""
    if not isinstance(ops, list) or not ops or len(ops) > 200:
        raise EditError("Nothing to change.")
    done = {}
    for op in ops:
        if not isinstance(op, dict):
            raise EditError("Unknown change.")
        kind, qid = str(op.get("op", "")), str(op.get("id", "") or "")
        if kind == "add":
            text, new_id = add_question(text, scale.read_latex(text), kind=str(op.get("kind") or "single"),
                                        after=op.get("after") or None, group=op.get("group") or None,
                                        qid=op.get("qid") or None)
            done.setdefault(new_id, []).append("added")
            continue
        q, qs = _find(text, qid)
        if kind == "text":
            text = set_text(text, q, op.get("latex", ""))
            what = "text"
        elif kind == "answer_text":
            text = set_answer_text(text, q, op.get("i"), op.get("latex", ""))
            what = "answers"
        elif kind == "answer_correct":
            text = scale.set_correct(text, q, int(op.get("i", -1)) + 1, bool(op.get("correct")))
            what = "answer key"
        elif kind == "answer_add":
            text = add_answer(text, q, op.get("latex", "Answer"), bool(op.get("correct")))
            what = "answers"
        elif kind == "answer_remove":
            text = remove_answer(text, q, op.get("i"))
            what = "answers"
        elif kind == "answer_move":
            text = move_answer(text, q, op.get("i"), op.get("j"))
            what = "answers"
        elif kind == "numeric":
            text = set_numeric(text, q, op.get("value", "0"), op.get("options", NUMERIC_DEFAULT))
            what = "numeric answer"
        elif kind == "explain":
            text = set_explain(text, q, op.get("latex", ""))
            what = "explanation"
        elif kind == "type":
            text = set_type(text, q, str(op.get("kind") or ""))
            what = "type"
        elif kind == "scoring":
            rule = str(op.get("rule") or "").strip()
            if rule and not re.fullmatch(r"[A-Za-z0-9=.,+\-*/() \\]{1,200}", rule):
                raise EditError("The scoring rule contains characters AMC doesn't accept here.")
            text = scale.set_scoring(text, q, rule)
            what = "scoring"
        elif kind == "rename":
            text = rename(text, q, qs, op.get("new_id"))
            what = f"renamed to {str(op.get('new_id')).strip()}"
        elif kind == "delete":
            text = delete_question(text, q)
            what = "deleted"
        elif kind == "move":
            text = move_question(text, q, op.get("before") or None)
            what = "moved"
        else:
            raise EditError("Unknown change.")
        done.setdefault(qid, []).append(what)
    parts = []
    for qid, whats in done.items():
        seen = []
        for w in whats:
            if w not in seen:
                seen.append(w)
        parts.append(f"{qid}: " + ", ".join(seen))
    return text, "Question " + "; ".join(parts)
