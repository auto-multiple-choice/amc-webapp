"""
Question statistics after marking (doc/question-bank-plan.md, P3; issue #6):
for each question, the share of copies that got it right, how well it
separates strong from weak students, and which answers were chosen, with
what to look at in words. Kept per bank item across exams.

Read from AMC's databases in the exam's data/ folder, read-only:
  scoring.sqlite  scoring_score (each copy's score per question), scoring_title,
                  scoring_question (indicative questions), scoring_answer
                  (correct answers per paper)
  capture.sqlite  capture_zone type 4 (each box's darkness, and the teacher's
                  correction in Check scans)

Answers are numbered in the order of the source (AMC shuffles the printed
order, not the numbers); 0 is AMC's "none of these" box.

How well a question separates (the discrimination index): the copies are
ranked by their total without this question; the share right among the
strongest 27% minus the share right among the weakest 27%. From -1 to 1:
0.3 and more is good, under 0.15 poor, below 0 a sign of a wrong key.

Standard library only.
"""
import math
import os
import sqlite3

MIN_COPIES = 10   # fewer: the separation and the notes aren't worth much
NOBODY = "Nobody chose"
GROUP = 0.27      # the strongest and weakest share of copies compared


def _connect(path):
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=10)


def read(pdir, low=0.15, high=1.0):
    """What the statistics need, from the exam's databases: {"titles":
    {q: title}, "scores": {(student, copy): {q: (score, max)}}, "ticks":
    {(student, copy): {q: {answers}}}, "correct": {q: {answers}},
    "indicative": {q}}. None when the exam has no marks yet. LOW and HIGH
    are the darkness thresholds of a ticked box (the exam's settings)."""
    data = os.path.join(pdir, "data")
    sp, cp = os.path.join(data, "scoring.sqlite"), os.path.join(data, "capture.sqlite")
    if not os.path.isfile(sp):
        return None
    out = {"titles": {}, "scores": {}, "ticks": {}, "correct": {}, "indicative": set()}
    db = _connect(sp)
    try:
        if not db.execute("SELECT name FROM sqlite_master WHERE name='scoring_score'").fetchone():
            return None
        out["titles"] = {q: t for q, t in db.execute("SELECT question, title FROM scoring_title")}
        out["indicative"] = {q for q, in db.execute("SELECT DISTINCT question FROM scoring_question WHERE indicative=1")}
        for student, copy, q, score, mx in db.execute("SELECT student, copy, question, score, max FROM scoring_score"):
            out["scores"].setdefault((student, copy), {})[q] = (score or 0.0, mx or 0.0)
        for q, a in db.execute("SELECT DISTINCT question, answer FROM scoring_answer WHERE correct=1"):
            out["correct"].setdefault(q, set()).add(a)
    finally:
        db.close()
    if not out["scores"]:
        return None
    if os.path.isfile(cp):
        db = _connect(cp)
        try:
            for student, copy, q, a, black, total, manual in db.execute(
                    "SELECT student, copy, id_a, id_b, black, total, manual FROM capture_zone WHERE type=4"):
                prop = black / total if total and total > 0 else None
                ticked = bool(manual) if manual is not None and manual >= 0 else (prop is not None and low <= prop <= high)
                if ticked:
                    out["ticks"].setdefault((student, copy), {}).setdefault(q, set()).add(a)
        finally:
            db.close()
    return out


def _right(score, mx):
    return mx > 0 and score >= mx - 1e-9


def compute(data):
    """[{qnum, title, n, right, mean, separation, upper, lower, answers:
    [{answer, share, upper, lower, correct}], notes: [words]}] in question
    order. RIGHT is the share of copies with full marks; SEPARATION None
    when there are fewer than MIN_COPIES copies."""
    if not data:
        return []
    papers = sorted(data["scores"])
    totals = {p: sum(s for q, (s, m) in data["scores"][p].items() if q not in data["indicative"]) for p in papers}
    out = []
    for q in sorted({q for p in papers for q in data["scores"][p]}):
        rows = [(p, *data["scores"][p][q]) for p in papers if q in data["scores"][p]]
        rows = [r for r in rows if r[2] > 0]  # a question worth nothing (or not on this copy)
        n = len(rows)
        if not n:
            continue
        right = sum(_right(s, m) for _, s, m in rows) / n
        mean = sum(s / m for _, s, m in rows) / n
        # the copies ranked by their total without this question
        ranked = sorted(rows, key=lambda r: (totals[r[0]] - r[1], r[0]))
        k = max(1, math.ceil(n * GROUP))
        lower, upper = ranked[:k], ranked[-k:]
        share = lambda grp: sum(_right(s, m) for _, s, m in grp) / len(grp)
        sep = None if n < MIN_COPIES else round(share(upper) - share(lower), 2)
        answers = []
        seen = sorted({a for p, _, _ in rows for a in data["ticks"].get(p, {}).get(q, ())} | data["correct"].get(q, set()))
        for a in seen:
            ticked = lambda grp: sum(a in data["ticks"].get(p, {}).get(q, ()) for p, _, _ in grp) / len(grp)
            answers.append({"answer": a, "share": round(ticked(rows), 3), "upper": round(ticked(upper), 3),
                            "lower": round(ticked(lower), 3), "correct": a in data["correct"].get(q, set())})
        out.append({"qnum": q, "title": data["titles"].get(q, f"Question {q}"), "n": n, "right": round(right, 3),
                    "mean": round(mean, 3), "separation": sep, "upper": round(share(upper), 3), "lower": round(share(lower), 3),
                    "answers": answers, "notes": []})
    return out


def notes(stat, labels=None, choices=None):
    """What to look at, in words. LABELS: {answer number: how to name it}
    ("B: 3/4"); CHOICES: the answer numbers the question has (to find one
    nobody chose)."""
    labels = labels or {}
    name = lambda a: labels.get(a) or ("none of these" if a == 0 else f"answer {a}")
    out = []
    if stat["n"] < MIN_COPIES:
        out.append(f"Only {stat['n']} cop{'y' if stat['n'] == 1 else 'ies'}: too few to say much.")
        return out
    sep = stat["separation"]
    chosen = {a["answer"]: a for a in stat["answers"]}
    correct = {a["answer"] for a in stat["answers"] if a["correct"]}
    # the most telling first: a key to check, then the rest
    if sep is not None and sep < 0:
        out.append("Weaker students did better than stronger ones on it: check the answer key.")
    for a in stat["answers"]:
        if not a["correct"] and a["upper"] >= 0.2 and a["upper"] > a["lower"]:
            out.append(f"The wrong {name(a['answer'])} attracts strong students more than weak ones: check it isn't right too.")
    if stat["right"] >= 0.9:
        out.append("Very easy: almost everyone got it right.")
    elif stat["right"] <= 0.25:
        out.append("Very hard: few got it right. Check the answer key, and that it was taught.")
    if sep is not None and 0 <= sep < 0.15 and 0.25 < stat["right"] < 0.9:
        out.append("It separates strong from weak students poorly.")
    for c in choices or ():
        if c and c not in correct and (c not in chosen or chosen[c]["share"] == 0):
            out.append(f"{NOBODY} {name(c)}: it doesn't work as a wrong answer.")
    return out


def worth_a_look(stat, found):
    """FOUND (the notes) say more than that an answer was never chosen."""
    return stat["n"] >= MIN_COPIES and any(not n.startswith(NOBODY) for n in found)


def summary(entries):
    """Statistics of a bank item over several exams ([{n, right,
    separation}]): copies in all, and the share right and separation
    weighted by copies."""
    entries = [e for e in entries if e.get("n")]
    n = sum(e["n"] for e in entries)
    if not n:
        return None
    seps = [(e["separation"], e["n"]) for e in entries if e.get("separation") is not None]
    sn = sum(w for _, w in seps)
    return {"exams": len(entries), "n": n, "right": round(sum(e["right"] * e["n"] for e in entries) / n, 3),
            "separation": round(sum(s * w for s, w in seps) / sn, 2) if sn else None}
