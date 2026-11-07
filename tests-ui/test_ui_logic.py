"""Checks for server/ui.py logic that doesn't need a running app: the
lock's "does this change move anything on the printed paper?" comparison,
reading/writing the default scoring in LaTeX and AMC-TXT sources, and the
results helpers (match states, names from the class list, the class list
file check, and the fingerprint that tells when marks are out of date).

Run with the app's image (it has Flask):
  docker run --rm -v "$PWD/server:/s:ro" -v "$PWD/tests-ui/test_ui_logic.py:/t.py:ro" \
    --entrypoint /venv/bin/python amc-web /t.py
"""
import os
import re
import sys
# The server code: /s in the README's docker command, or next to this file.
SERVER = os.environ.get("AMC_UI_SERVER") or ("/s" if os.path.isdir("/s") else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server"))
sys.path.insert(0, SERVER)
try:
    import ui
except ImportError as e:
    sys.exit(f"Can't import the server code from {SERVER} ({e}). Run this with the app's image, see the docstring.")
ok = fail = 0
def check(name, cond):
    global ok, fail
    print(("PASS " if cond else "FAIL ") + name)
    ok, fail = ok + bool(cond), fail + (not cond)

src = r"""\documentclass{article}
\usepackage{automultiplechoice}
\begin{document}
\onecopy{10}{
\begin{question}{q1}
  What is 2+2? % easy
  \begin{choices}
    \correctchoice{4}
    \wrongchoice{5}
  \end{choices}
\end{question}

\begin{questionmult}{q2}\scoring{haut=2}
  Pick even numbers.
  \begin{choices}
    \correctchoice{2}\wrongchoice{3}
  \end{choices}
\end{questionmult}
}
\end{document}
"""
same = lambda a, b, e="tex": ui.same_layout(a, b, e)
check("identical sources are the same layout", same(src, src))
check("swapping correct/wrong answers is allowed", same(src, src.replace(r"\correctchoice{4}", r"\wrongchoice{4}").replace(r"\wrongchoice{5}", r"\correctchoice{5}")))
check("changing \\scoring{} is allowed", same(src, src.replace("haut=2", "mz=1")))
check("removing \\scoring{} is allowed", same(src, src.replace(r"\scoring{haut=2}", "")))
check("adding a \\scoringDefaultS line is allowed", same(src, src.replace("\\begin{document}\n", "\\begin{document}\n\\scoringDefaultS{b=1,m=-0.25}\n")))
check("changing comments is allowed", same(src, src.replace("% easy", "% very easy")))
check("changing question text is refused", not same(src, src.replace("What is 2+2?", "What is 3+1?")))
check("changing answer text is refused", not same(src, src.replace(r"\correctchoice{4}", r"\correctchoice{four}")))
check("adding a blank line (new paragraph) is refused", not same(src, src.replace("  Pick even numbers.\n", "  Pick even\n\n numbers.\n")))
check("adding an answer is refused", not same(src, src.replace(r"\wrongchoice{5}", r"\wrongchoice{5}\wrongchoice{6}")))
check("changing copies is refused", not same(src, src.replace(r"\onecopy{10}", r"\onecopy{12}")))
check("switching single to multiple is refused", not same(src, src.replace("{question}", "{questionmult}")))
txt = "Title: Test\n\n* Question one?\n+ yes\n- no\n"
check("AMC-TXT: switching + and - is allowed", same(txt, txt.replace("+ yes", "- yes").replace("- no", "+ no"), "txt"))
check("AMC-TXT: adding DefaultScoringS is allowed", same(txt, "DefaultScoringS: b=2\n" + txt, "txt"))
check("AMC-TXT: changing text is refused", not same(txt, txt.replace("Question one", "Question 1"), "txt"))

# default scoring
w = ui.write_scoring_defaults(src, "latex", {"S": "b=1,m=-0.25", "M": ""})
check("writes \\scoringDefaultS after \\begin{document}", "\\begin{document}\n\\scoringDefaultS{b=1,m=-0.25}\n" in w)
check("reading it back", ui.read_scoring_defaults(w, "latex") == {"S": "b=1,m=-0.25", "M": None})
check("the written source has the same layout", same(src, w))
w2 = ui.write_scoring_defaults(w, "latex", {"S": "b=2", "M": "haut=3"})
check("updates S in place, adds M", w2.count("scoringDefaultS") == 1 and "\\scoringDefaultS{b=2}" in w2 and "\\scoringDefaultM{haut=3}" in w2)
w3 = ui.write_scoring_defaults(w2, "latex", {"S": "", "M": ""})
check("empty values remove both lines", "scoringDefault" not in w3 and same(src, w3))
check("removing leaves the source as it was", w3 == src)
fr = src.replace("\\begin{document}\n", "\\begin{document}\n\\baremeDefautS{b=3}\n")
check("reads the French \\baremeDefautS", ui.read_scoring_defaults(fr, "latex")["S"] == "b=3")
w4 = ui.write_scoring_defaults(fr, "latex", {"S": "b=1", "M": ""})
check("replaces the French command", "baremeDefaut" not in w4 and "\\scoringDefaultS{b=1}" in w4)
commented = src.replace("\\begin{document}\n", "\\begin{document}\n% \\scoringDefaultS{b=9}\n")
check("ignores commented-out defaults", ui.read_scoring_defaults(commented, "latex")["S"] is None)
t2 = ui.write_scoring_defaults(txt, "plain", {"S": "b=2", "M": "mz=1"})
check("AMC-TXT: writes DefaultScoring lines", ui.read_scoring_defaults(t2, "plain") == {"S": "b=2", "M": "mz=1"})
check("AMC-TXT: removing restores", ui.write_scoring_defaults(t2, "plain", {"S": "", "M": ""}) == txt)
try:
    ui.write_scoring_defaults("no document here", "latex", {"S": "b=1"}); check("no \\begin{document} raises", False)
except ValueError:
    check("no \\begin{document} raises", True)
check("strategy validation rejects braces", not ui.STRATEGY.match("b=1}\\input{x}"))
check("strategy validation accepts AMC syntax", bool(ui.STRATEGY.match("b=1,m=-0.25,p=0")))
# ---- results helpers, with a stand-in for the server module
import os, sqlite3, tempfile, types
from unidecode import unidecode
import db as amcdb

opts = {"note_max": "20", "seuil": "0.15"}
pdir = tempfile.mkdtemp()
def first_of(l, *proposals):  # as upstream's amc.first_of
    low = {unidecode(x.lower()): x for x in l}
    return next((low[p] for p in proposals if low.get(p)), None)
ui.core = types.SimpleNamespace(
    get_options=lambda names: {n: opts.get(n, "") for n in names},
    get_option=lambda n: opts.get(n, "latex" if n == "filter" else None),
    main_source_file=lambda: opts.get("main", "source.tex"),
    students_list_file=lambda: None,
    project_dir=lambda: pdir,
    Amcdb=amcdb.Amcdb,
    first_of=first_of,
    headers_list=lambda h: [x.strip() for x in h.split(",") if x.strip()],
)

ms = ui._match_state
check("match: automatic", ms("101", None) == ("auto", "101"))
check("match: by hand wins over automatic", ms("101", "150") == ("manual", "150"))
check("match: 'NONE' is not in the class list", ms("101", "NONE") == ("none", None))
check("match: an empty manual match is unmatched", ms("101", "") == ("unmatched", None))
check("match: nothing is unmatched", ms(None, None) == ("unmatched", None))

cl = {"columns": ["id", "surname", "name"], "key": "id", "error": None,
      "rows": [{"id": "101", "surname": "Curie", "name": "Marie"}, {"id": "102", "surname": "", "name": ""}]}
names = ui.student_names(cl)
check("names: surname then first name", names["101"] == "Curie Marie")
check("names: a student without a name gets a placeholder", names["102"] == "Student 2")
fr = {"columns": ["Num", "Nom", "Prénom"], "key": "Num", "error": None, "rows": [{"Num": "7", "Nom": "Noether", "Prénom": "Emmy"}]}
check("names: French column names", ui.student_names(fr)["7"] == "Noether Emmy")
one = {"columns": ["code", "student"], "key": "code", "error": None, "rows": [{"code": "9", "student": "Ada Lovelace"}]}
check("names: otherwise the first other column", ui.student_names(one)["9"] == "Ada Lovelace")
check("names: no key column, no names", ui.student_names(dict(cl, key=None)) == {})

open(os.path.join(pdir, "source.tex"), "w").write("\\begin{document}\\correctchoice{4}\\end{document}")
check("class list: a CSV file is accepted", ui.class_list_refusal("class-10B.csv") is None)
check("class list: other files are refused", ui.class_list_refusal("class.xlsx") is not None)
check("class list: can't replace the main source", ui.class_list_refusal("source.tex") is not None)
check("class list: can't replace the exam's options", ui.class_list_refusal("options.xml") is not None)

os.makedirs(os.path.join(pdir, "data"))
c = sqlite3.connect(os.path.join(pdir, "data", "capture.sqlite"))
c.executescript("""CREATE TABLE capture_page (student, page, copy, timestamp_auto, timestamp_manual, timestamp_annotate);
  CREATE TABLE capture_zone (student, page, copy, type, id_a, id_b, manual);
  INSERT INTO capture_page VALUES (1, 1, 0, 100, 0, 0);
  INSERT INTO capture_zone VALUES (1, 1, 0, 4, 1, 1, -1);""")
c.commit()
fp = ui.marking_inputs
f0 = fp(pdir)
check("fingerprint: stable", fp(pdir) == f0)
open(os.path.join(pdir, "students.csv"), "w").write("id\n1\n")
check("fingerprint: a class list doesn't count", fp(pdir) == f0)
c.execute("UPDATE capture_page SET timestamp_annotate=200"); c.commit()
check("fingerprint: annotating doesn't count", fp(pdir) == f0)
open(os.path.join(pdir, "source.tex"), "w").write("\\begin{document}\\wrongchoice{4}\\end{document}")
f1 = fp(pdir)
check("fingerprint: an answer key change counts", f1 != f0)
opts["note_max"] = "10"
f2 = fp(pdir)
check("fingerprint: a final mark setting counts", f2 != f1)
c.execute("UPDATE capture_zone SET manual=1"); c.commit()
f3 = fp(pdir)
check("fingerprint: a decision in Check scans counts", f3 != f2)
c.execute("INSERT INTO capture_page VALUES (2, 1, 0, 300, 0, 0)"); c.commit()
check("fingerprint: a new scan counts", fp(pdir) != f3)
opts.update(filter="plain", main="source.txt")
open(os.path.join(pdir, "source.txt"), "w").write("* Q?\n+ a\n- b\n")
f4 = fp(pdir)
open(os.path.join(pdir, "source-filtered.tex"), "w").write("generated by AMC")
check("fingerprint: AMC-TXT ignores the LaTeX files AMC writes", fp(pdir) == f4)
open(os.path.join(pdir, "source.txt"), "w").write("* Q?\n- a\n+ b\n")
check("fingerprint: AMC-TXT answer key change counts", fp(pdir) != f4)
opts.update(filter="latex", main="source.tex")

# ---- marking scheme panel (ui_scale.py)
import ui_scale as sc
B = sc.BASE_RULES
single = [(1, True, ""), (2, False, ""), (3, False, ""), (4, False, "")]
mult = [(0, False, ""), (1, True, ""), (2, False, ""), (3, True, "")]   # with AMC's "none of these" box
mx = lambda m, a, rule="", default="": sc.question_max(m, a, [B, "", default, rule])
check("max: single, AMC's default is 1 (as AMC computed for 'prez')", mx(False, single) == 1)
check("max: multiple, AMC's default is 1 per answer box (3, as AMC computed for 'pref')", mx(True, mult) == 3)
check("max: single with b=2", mx(False, single, "b=2,m=-1") == 2)
check("max: multiple with haut=5", mx(True, mult, "haut=5") == 5)
check("max: multiple with mz=2 (all or nothing)", mx(True, mult, "mz=2") == 2)
check("max: single with mz=3", mx(False, single, "mz=3") == 3)
check("max: MAX wins", mx(True, mult, "haut=5,MAX=4") == 4)
check("max: the type's default applies", mx(True, mult, "", "haut=2") == 2)
check("max: as in AMC, a default haut= wins over the question's mz=", mx(True, mult, "mz=1", "haut=2") == 2)
check("max: haut=0 lets the question's mz= apply", mx(True, mult, "haut=0,mz=1", "haut=2") == 1)
check("max: arithmetic over AMC's variables", mx(True, mult, "b=2*NB/N") == 4)
check("max: answer-level points on a single question", sc.question_max(False, [(1, True, "3"), (2, False, "")], [B, "", "", ""]) == 3)
check("max: answer-level b on a multiple question", sc.question_max(True, [(1, True, "b=2"), (2, False, "")], [B, "", "", ""]) == 3)
check("max: neutralised, full marks", mx(False, single, sc.neutral_rule("full", 2)) == 2)
check("max: neutralised, not counted", mx(True, mult, sc.neutral_rule("none")) == 0)
try:
    mx(True, mult, "formula=max(1,2)"); check("max: unknown functions are refused", False)
except sc.Unknown:
    check("max: unknown functions are refused", True)
try:
    mx(True, mult, "set.x=1"); check("max: variable directives are left to AMC", False)
except sc.Unknown:
    check("max: variable directives are left to AMC", True)
check("neutral: recognised", sc.neutral_kind(sc.neutral_rule("full", 3)) == ("full", 3.0) and sc.neutral_kind(sc.neutral_rule("none")) == "none")
check("neutral: other rules aren't", sc.neutral_kind("b=2") is None)

tex = r"""\begin{document}
\onecopy{5}{
\begin{question}{prez}
  Who was a President of France? % a comment
  \begin{choices}
    \correctchoice{René Coty}
    \wrongchoice{Alain Prost}
    \wrongchoice[x]{Marcel {Proust}}
  \end{choices}
\end{question}
% \begin{question}{old}\correctchoice{a}\end{question}
\begin{questionmult}{pref}\scoring{haut=2}
  Which are prefectures?
  \begin{choices}
    \correctchoice{Poitiers}\scoring{b=2}
    \wrongchoice{Sainte-Menehould}
    \bonne{Avignon}
  \end{choices}
\end{questionmult}
}
\end{document}
"""
qs = sc.read_latex(tex, "source.tex")
check("latex: finds both questions, not the commented one", [q["id"] for q in qs] == ["prez", "pref"])
check("latex: types", [q["multiple"] for q in qs] == [False, True])
check("latex: answers and correct ones in source order", [a["correct"] for a in qs[1]["answers"]] == [True, False, True])
check("latex: answer text", [a["text"] for a in qs[0]["answers"]] == ["René Coty", "Alain Prost", "Marcel Proust"])
check("latex: the question's own scoring, not an answer's", qs[1]["scoring"]["rule"] == "haut=2" and qs[0]["scoring"] is None)
check("latex: question text", qs[0]["text"].startswith("Who was a President"))
t1 = sc.set_correct(tex, qs[0], 2, True)
check("latex: a single question keeps one correct answer", "\\wrongchoice{René Coty}" in t1 and "\\correctchoice{Alain Prost}" in t1)
check("latex: changing the answer key keeps the layout", same(tex, t1))
t2 = sc.set_correct(tex, qs[1], 3, False)
check("latex: French commands stay French", "\\mauvaise{Avignon}" in t2 and "\\correctchoice{Poitiers}" in t2)
try:
    sc.set_correct(tex, qs[0], 1, False); check("latex: a single question can't lose its only correct answer", False)
except ValueError:
    check("latex: a single question can't lose its only correct answer", True)
t3 = sc.set_scoring(tex, qs[0], "b=2,m=-1")
check("latex: adds \\scoring after \\begin{question}", "\\begin{question}{prez}\\scoring{b=2,m=-1}" in t3 and same(tex, t3))
t4 = sc.set_scoring(tex, qs[1], "mz=3")
check("latex: replaces the question's \\scoring only", "{pref}\\scoring{mz=3}" in t4 and "\\scoring{b=2}" in t4)
t5 = sc.set_scoring(tex, qs[1], "")
check("latex: an empty rule removes it", "{pref}\n" in t5 and "haut=2" not in t5 and same(tex, t5))

txt = """Title: Test
DefaultScoringM: haut=3

* Who was a President of France?
+ René Coty
- Alain Prost

**[id=pref]{mz=2} Which are prefectures?
+ Poitiers
- Sainte-Menehould
+{2} Avignon

* Second unnamed
- yes
+ no
"""
tq = sc.read_txt(txt, "source.txt")
check("txt: ids as AMC gives them", [q["id"] for q in tq] == ["Q001", "pref", "Q002"])
check("txt: types and answers", [q["multiple"] for q in tq] == [False, True, False] and [a["correct"] for a in tq[1]["answers"]] == [True, False, True])
check("txt: a kind like the LaTeX reader, so the marking panel reads both", [q["kind"] for q in tq] == ["single", "multiple", "single"])
check("txt: the question's scoring", tq[1]["scoring"]["rule"] == "mz=2" and tq[0]["scoring"] is None)
u1 = sc.set_correct(txt, tq[0], 2, True)
check("txt: answer key change", "- René Coty\n+ Alain Prost" in u1 and same(txt, u1, "txt"))
u2 = sc.set_scoring(txt, tq[0], "b=2")
check("txt: adds a scoring group", "*{b=2} Who was" in u2 and same(txt, u2, "txt"))
u3 = sc.set_scoring(txt, tq[1], "")
check("txt: removes a scoring group", "**[id=pref] Which" in u3 and same(txt, u3, "txt"))
check("txt: changing text is still refused", not same(txt, txt.replace("Poitiers", "Paris"), "txt"))

# ---- branding and starters
for colour in ("#3b5bdb", "#ffe066", "#0b1f3a", "#2f9e44", "#ff8787", "#ffffff", "#000000"):
    pal = ui.palette(colour)
    good = all(ui.contrast(pal[t]["brand"], ui.SURFACES[t]) >= 3 and ui.contrast(pal[t]["on_brand"], pal[t]["brand"]) >= 4.5
               for t in ("light", "dark"))
    check(f"palette {colour}: readable buttons and visible controls in both themes", good)
check("presets: white button text, unchanged, in the light theme", all(
    ui.palette(c)["light"]["on_brand"] == "#ffffff" and not ui.palette(c)["light"]["adjusted"] for _, c in ui.PRESETS))
check("palette: the neutral blue is kept as it is in the light theme", ui.palette("#3b5bdb")["light"]["brand"] == "#3b5bdb"
      and not ui.palette("#3b5bdb")["light"]["adjusted"])
check("palette: a pale yellow gets a darker shade in the light theme", ui.palette("#ffe066")["light"]["adjusted"])
check("palette: a dark navy gets a lighter shade in the dark theme", ui.palette("#0b1f3a")["dark"]["adjusted"])
css = ui.brand_css({"palette": ui.palette("#0c8599")})
check("brand CSS sets only the two brand tokens", set(re.findall(r"--([a-z-]+):", css)) == {"brand", "on-brand"})
check("logo: PNG recognised", ui._logo_kind(b"\x89PNG\r\n\x1a\n...") == "png")
check("logo: JPEG recognised", ui._logo_kind(b"\xff\xd8\xff\xe0...") == "jpg")
check("logo: SVG recognised", ui._logo_kind(b'<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>') == "svg")
check("logo: anything else refused", ui._logo_kind(b"GIF89a...") is None and ui._logo_kind(b"<html><script>") is None)

import ui_gallery as g
tpl = open(os.path.join(SERVER, "school_templates/blank/exam.tex")).read()
out = g.starter_source(tpl, "latex", school_name="St. Mary's & Co_ 100%", logo_file="school-logo.png", code_digits=6)
check("starter: school name escaped for LaTeX", r"St. Mary's \& Co\_ 100\%" in out)
check("starter: logo and code boxes", "\\includegraphics[height=12mm]{school-logo.png}" in out and "\\AMCcodeGridInt{student}{6}" in out)
check("starter: no markers left", "%%AMCUI" not in out)
plain = g.starter_source(tpl, "latex")
check("starter: without branding, no school line and a plain name field", "includegraphics[" not in plain and "AMCcodeGridInt" not in plain and "\\namefield" in plain)
txt = g.starter_source(open(os.path.join(SERVER, "school_templates/blank-txt/exam.txt")).read(), "plain", code_digits=8, separate=True)
check("starter: AMC-TXT options", "Code: 8\nSeparateAnswerSheet: 1\n" in txt and "%%AMCUI" not in txt)
hard = g.starter_source(tpl, "latex", school_name="A\\B {C} $1 #2 ~x ^y")
check("starter: every LaTeX special escaped", "\\textbackslash{}B \\{C\\} \\$1 \\#2 \\textasciitilde{}x \\textasciicircum{}y" in hard)
check("starter: a Latin name keeps pdflatex", not g.needs_unicode_engine("Lycée Évariste Galois") and g.needs_unicode_engine("Школа № 5") and g.needs_unicode_engine("विद्यालय"))
import basic
check("names: '_branding', '.hidden', '-x' refused", all(basic.project_name_problem(n) for n in ("_branding", ".hidden", "-x", "", "  ", "a/b", "a\\b", "a:b", "x" * 130, "tab\there")))
check("names: ordinary names allowed", all(basic.project_name_problem(n) is None for n in ("Physics 10B", "Quiz #3", "Épreuve n°2 (2026)", "exam.v2")))

# source history (ui_source.py)
import json, shutil, tempfile, time
import ui_source as hist
tmp = tempfile.mkdtemp()
try:
    exam = os.path.join(tmp, "exam"); os.makedirs(exam); open(os.path.join(exam, "options.xml"), "w").close()
    check("history: sources, class lists and includes are tracked, images and folders aren't",
          all(hist.tracked(n) for n in ("exam.tex", "a.txt", "list.csv", "macros.sty", "x.yml"))
          and not any(hist.tracked(n) for n in ("logo.png", "paper.pdf", "a/b.tex", ".hidden.tex", "noext", "")))
    d1 = hist.write_source(exam, "exam.tex", b"v1\n", by="ann", what="Created")
    check("history: a new file has no earlier version", hist.versions(exam, "exam.tex") == [] and d1 == hist.digest(b"v1\n"))
    time.sleep(1.1)  # ids are per second
    d2 = hist.write_source(exam, "exam.tex", b"v2\n", by="bob", what="Saved in the editor", based_on=d1)
    vs = hist.versions(exam, "exam.tex")
    check("history: the replaced version is kept, with how it was made", len(vs) == 1 and vs[0]["digest"] == d1 and vs[0]["by"] == "ann" and vs[0]["what"] == "Created" and not vs[0]["built"])
    check("history: the file holds the new text", open(os.path.join(exam, "exam.tex"), "rb").read() == b"v2\n")
    try:
        hist.write_source(exam, "exam.tex", b"v3\n", based_on=d1); check("history: a stale based_on is refused", False)
    except hist.Conflict as c:
        check("history: a stale based_on is refused, naming the digest on disk", str(c) == d2)
    check("history: an unchanged save keeps nothing", hist.write_source(exam, "exam.tex", b"v2\n", based_on=d2) == d2 and len(hist.versions(exam, "exam.tex")) == 1)
    time.sleep(1.1)
    hist.write_source(exam, "exam.tex", b"v3\n", by="bob", what="Saved in the editor", built_digest=d2)
    vs = hist.versions(exam, "exam.tex")
    check("history: newest first, and the built version is marked", [v["digest"] for v in vs] == [d2, d1] and vs[0]["built"] and not vs[1]["built"])
    hist.mark_built(exam, {"exam.tex": d1})
    check("history: mark_built marks an older version too", all(v["built"] for v in hist.versions(exam, "exam.tex")))
    check("history: a version can be read back", hist.read_version(exam, "exam.tex", vs[1]["id"]) == b"v1\n")
    check("history: bad ids and names are refused", hist.read_version(exam, "exam.tex", "../x") is None and hist.read_version(exam, "../exam.tex", vs[0]["id"]) is None)
    time.sleep(1.1)
    hist.restore(exam, "exam.tex", vs[1]["id"], by="ann")
    check("history: restore writes the old text and keeps the replaced one", open(os.path.join(exam, "exam.tex"), "rb").read() == b"v1\n" and len(hist.versions(exam, "exam.tex")) == 3)
    with open(os.path.join(exam, "exam.tex"), "wb") as f: f.write(b"outside\n")
    time.sleep(1.1)
    hist.write_source(exam, "exam.tex", b"v5\n", by="ann", what="Saved")
    check("history: a change made outside the app is kept and said so", hist.versions(exam, "exam.tex")[0]["what"] == "Changed outside the app")
    # deleted files
    hist.write_source(exam, "extra.tex", b"e1\n", by="ann", what="Uploaded")
    e = hist.delete_source(exam, "extra.tex", by="bob")
    check("history: a deleted file is kept as deleted", e and e["deleted"] and not os.path.exists(os.path.join(exam, "extra.tex")) and hist.versions(exam, "extra.tex")[0]["deleted"])
    fl = {f["file"]: f for f in hist.files_with_history(exam)}
    check("history: files_with_history tells deleted from existing", fl["exam.tex"]["exists"] and not fl["extra.tex"]["exists"] and fl["extra.tex"]["deleted_at"])
    hist.restore(exam, "extra.tex", hist.versions(exam, "extra.tex")[0]["id"], by="bob")
    check("history: restoring a deleted file brings it back", open(os.path.join(exam, "extra.tex"), "rb").read() == b"e1\n")
    open(os.path.join(exam, "logo.png"), "wb").write(b"png")
    check("history: deleting an untracked file just removes it", hist.delete_source(exam, "logo.png") is None and not os.path.exists(os.path.join(exam, "logo.png")))
    # pruning: fake old versions (older than KEEP_DAYS)
    d = os.path.join(exam, hist.HISTORY_DIR, "exam.tex")
    now = time.time()
    real = len(hist.versions(exam, "exam.tex"))
    def fake(d, name, ext, n, days_ago, built_i):
        for i in range(n):
            vid = "20200101T%06dZ" % i
            open(os.path.join(d, vid + "." + ext), "wb").write(b"old")
            json.dump({"id": vid, "file": name, "at": int(now - days_ago(i) * 86400), "by": None, "what": "Saved",
                       "size": 3, "digest": "%s%d" % (name, i), "built": i == built_i, "deleted": False}, open(os.path.join(d, vid + ".json"), "w"))
    fake(d, "exam.tex", "tex", 45, lambda i: 200 - i, 3)
    before_vs = hist.versions(exam, "exam.tex")
    newest_built = next(v["id"] for v in before_vs if v["built"])
    hist.prune(exam, "exam.tex", now=now)
    after = hist.versions(exam, "exam.tex")
    check("history: pruning keeps the newest KEEP_AT_LEAST and the newest built version, and drops older ones (a built one too)",
          len(before_vs) == real + 45 and len(after) == hist.KEEP_AT_LEAST and any(v["id"] == newest_built for v in after)
          and not any(v["id"] == "20200101T000003Z" for v in after))
    # ...but an old built version is kept when no newer one built
    hist.write_source(exam, "c.csv", b"a\n", what="Uploaded"); hist.write_source(exam, "c.csv", b"b\n", what="Uploaded")
    fake(os.path.join(exam, hist.HISTORY_DIR, "c.csv"), "c.csv", "csv", 40, lambda i: 200 - i, 2)
    hist.prune(exam, "c.csv", now=now)
    after = hist.versions(exam, "c.csv")
    check("history: the newest version that built survives pruning however old", len(after) == hist.KEEP_AT_LEAST + 1 and any(v["id"] == "20200101T000002Z" for v in after))
    # recent versions are all kept, up to MAX_VERSIONS
    hist.write_source(exam, "d.tex", b"a\n", what="Saved")
    fake(os.path.join(exam, hist.HISTORY_DIR, "d.tex"), "d.tex", "tex", hist.MAX_VERSIONS + 20, lambda i: (hist.MAX_VERSIONS + 20 - i) / 1000.0, -1)
    hist.prune(exam, "d.tex", now=now)
    check("history: versions from the last days are kept, but never more than MAX_VERSIONS", len(hist.versions(exam, "d.tex")) == hist.MAX_VERSIONS)
    # a file copied in with an old date: pruning goes by when the version was kept, not by that date
    hist.write_source(exam, "old.tex", b"a\n", what="Saved")
    fake(os.path.join(exam, hist.HISTORY_DIR, "old.tex"), "old.tex", "tex", 20, lambda i: 0.001 * (20 - i), -1)
    with open(os.path.join(exam, "old.tex"), "wb") as f: f.write(b"copied in\n")
    os.utime(os.path.join(exam, "old.tex"), (now - 400 * 86400, now - 400 * 86400))
    hist.write_source(exam, "old.tex", b"b\n", what="Saved")
    check("history: a version with an old date is kept when it was just replaced",
          any(v["digest"] == hist.digest(b"copied in\n") for v in hist.versions(exam, "old.tex")))
    # only the newest deleted version is kept for ever
    for i in range(3):
        time.sleep(1.1)
        hist.write_source(exam, "del.tex", b"d%d\n" % i, what="Saved"); hist.delete_source(exam, "del.tex")
    for v in hist.versions(exam, "del.tex"):
        e = json.load(open(os.path.join(exam, hist.HISTORY_DIR, "del.tex", v["id"] + ".json"))); e["kept_at"] = int(now - 30 * 86400); e["at"] = e["kept_at"]
        json.dump(e, open(os.path.join(exam, hist.HISTORY_DIR, "del.tex", v["id"] + ".json"), "w"))
    fake(os.path.join(exam, hist.HISTORY_DIR, "del.tex"), "del.tex", "tex", hist.KEEP_AT_LEAST, lambda i: 0.001 * i, -1)
    hist.prune(exam, "del.tex", now=now)
    dels = [v for v in hist.versions(exam, "del.tex") if v["deleted"]]
    check("history: of a file deleted several times, the newest deleted version is kept", len(dels) == 1 and dels[0]["digest"] == hist.digest(b"d2\n") and dels[0].get("deleted_at"))
    # a deleted exam's folder isn't brought back by a late save
    gone = os.path.join(tmp, "gone"); os.makedirs(gone); hist.write_source(gone, "exam.tex", b"x\n"); shutil.rmtree(gone)
    try:
        hist.write_source(gone, "exam.tex", b"y\n"); check("history: a save into a deleted exam is refused", False)
    except OSError:
        check("history: a save into a deleted exam is refused, and the folder stays gone", not os.path.exists(gone))
finally:
    shutil.rmtree(tmp, ignore_errors=True)

# the question editor (ui_scale.read_latex spans and ui_questions edits)
import ui_questions as qe
rj = r"""\documentclass{article}
\usepackage{automultiplechoice}
\begin{document}

\element{sectionI}{
  \begin{question}{q01}\scoring{\scoringDefaultS}
    Consider $g(x)=\prod_{i=1}^{7}(1+x^{i!})$. Then the coefficient of $x^{2025}$ is
    \begin{choiceshoriz}[o]
      \wrongchoice{0}
      \correctchoice{1}
      \wrongchoice{2025}
    \end{choiceshoriz}
    \explain{Expand and count.}
  \end{question}
}

\element{numerical}{
  \begin{questionmultx}{nq1}
    Let $AB=5$ and $BC=12$. Compute $780\sin^2(\alpha)$.
    \includegraphics[width=4cm]{figure.png}

    \AMCnumericChoices{390}{digits=3,decimals=0,sign=false}
  \end{questionmultx}
}

\onecopy{4}{
%%% end of the header
\shufflegroup{sectionI}
\insertgroup[1]{sectionI}
\insertgroup{numerical}
}
\end{document}
"""
qs = scale_mod = None
import ui_scale as sc
qs = sc.read_latex(rj, "x.tex")
q1, nq = qs[0], qs[1]
check("editor: questions, groups, kinds and lines are read", [q["id"] for q in qs] == ["q01", "nq1"] and q1["group"] == "sectionI" and nq["group"] == "numerical" and q1["kind"] == "single" and nq["kind"] == "numeric" and q1["line"] == 6)
check("editor: the text span excludes the \\scoring and the answers", rj[slice(*q1["text_span"])] == "Consider $g(x)=\\prod_{i=1}^{7}(1+x^{i!})$. Then the coefficient of $x^{2025}$ is" and q1["text_latex"].startswith("Consider"))
check("editor: the choices environment and its options", q1["choices"]["kind"] == "choiceshoriz" and q1["choices"]["opts"] == "[o]" and rj[slice(*q1["choices"]["inner"])].strip().startswith("\\wrongchoice{0}"))
check("editor: answers with their LaTeX and spans", [a["latex"] for a in q1["answers"]] == ["0", "1", "2025"] and rj[slice(*q1["answers"][1]["full_span"])] == "\\correctchoice{1}" and q1["answers"][1]["correct"])
check("editor: the explanation", q1["explain"]["latex"] == "Expand and count." and rj[slice(*q1["explain"]["span"])] == "\\explain{Expand and count.}")
check("editor: the \\element wrapper is the block", rj[slice(*q1["block_span"])].startswith("\\element{sectionI}{") and rj[slice(*q1["block_span"])].endswith("}") and q1["indent"] == "  ")
check("editor: a numeric question's value, options and figure", nq["numeric"]["value"] == "390" and nq["numeric"]["options"] == "digits=3,decimals=0,sign=false" and nq["figure"]["file"] == "figure.png" and nq["problem"] is None and nq["text_latex"].endswith("{figure.png}"))
check("editor: the marking panel still reads the simple sources", [q["id"] for q in sc.read_latex(src)] == ["q1", "q2"] and sc.read_latex(src)[0]["kind"] == "single" and sc.read_latex(src)[1]["kind"] == "multiple")

def rq(text, qid):
    return next(q for q in sc.read_latex(text) if q["id"] == qid)
t2, what = qe.apply(rj, [{"op": "text", "id": "q01", "latex": "New text with $x^2$."}])
check("editor: text edit replaces only the text", rq(t2, "q01")["text_latex"] == "New text with $x^2$." and "\\scoring{\\scoringDefaultS}" in t2 and t2.count("\\explain{Expand and count.}") == 1 and what == "Question q01: text")
t2, _ = qe.apply(rj, [{"op": "answer_text", "id": "q01", "i": 2, "latex": "$2025$"}, {"op": "answer_correct", "id": "q01", "i": 2, "correct": True}])
a = rq(t2, "q01")["answers"]
check("editor: answer text and answer key edits", [x["latex"] for x in a] == ["0", "1", "$2025$"] and [x["correct"] for x in a] == [False, False, True])
t2, _ = qe.apply(rj, [{"op": "answer_add", "id": "q01", "latex": "4049"}])
a = rq(t2, "q01")["answers"]
check("editor: an added answer follows the last one, indented alike", [x["latex"] for x in a] == ["0", "1", "2025", "4049"] and "\n      \\wrongchoice{2025}\n      \\wrongchoice{4049}\n" in t2)
t3, _ = qe.apply(t2, [{"op": "answer_remove", "id": "q01", "i": 0}])
check("editor: a removed answer takes its line with it", [x["latex"] for x in rq(t3, "q01")["answers"]] == ["1", "2025", "4049"] and "\\wrongchoice{0}" not in t3 and "[o]\n      \\correctchoice{1}" in t3)
t3, _ = qe.apply(t2, [{"op": "answer_move", "id": "q01", "i": 3, "j": 0}])
check("editor: answers can be reordered", [x["latex"] for x in rq(t3, "q01")["answers"]] == ["4049", "0", "1", "2025"] and rq(t3, "q01")["answers"][2]["correct"])
try:
    qe.apply(rj, [{"op": "answer_remove", "id": "nq1", "i": 0}]); check("editor: no answer to remove is an error", False)
except qe.EditError:
    check("editor: no answer to remove is an error", True)
t2, _ = qe.apply(rj, [{"op": "explain", "id": "q01", "latex": "Because."}])
check("editor: the explanation is changed in place", rq(t2, "q01")["explain"]["latex"] == "Because." and t2.count("\\explain") == 1)
t2, _ = qe.apply(rj, [{"op": "explain", "id": "q01", "latex": ""}])
check("editor: an empty explanation removes the line", rq(t2, "q01")["explain"] is None and "\\explain" not in t2 and "\\end{choiceshoriz}\n  \\end{question}" in t2)
t2, _ = qe.apply(rj, [{"op": "explain", "id": "nq1", "latex": "Use the tangent."}])
check("editor: an explanation is added before \\end", rq(t2, "nq1")["explain"]["latex"] == "Use the tangent." and "{figure.png}\n\n    \\AMCnumericChoices{390}{digits=3,decimals=0,sign=false}\n    \\explain{Use the tangent.}\n  \\end{questionmultx}" in t2)
t2, _ = qe.apply(rj, [{"op": "numeric", "id": "nq1", "value": "391", "options": "digits=4,decimals=0,sign=false"}])
check("editor: numeric value and options", rq(t2, "nq1")["numeric"] and rq(t2, "nq1")["numeric"]["value"] == "391" and "digits=4" in t2)
t2, _ = qe.apply(rj, [{"op": "type", "id": "q01", "kind": "multiple"}])
check("editor: single to multiple renames the environment only", rq(t2, "q01")["env"] == "questionmult" and rq(t2, "q01")["kind"] == "multiple" and "\\begin{questionmult}{q01}\\scoring" in t2 and "\\end{questionmult}" in t2 and t2.count("choiceshoriz") == 2)
t2, _ = qe.apply(rj, [{"op": "type", "id": "q01", "kind": "numeric"}])
q = rq(t2, "q01")
check("editor: to numeric replaces the answers by \\AMCnumericChoices", q["kind"] == "numeric" and q["env"] == "questionmultx" and not q["answers"] and q["numeric"]["value"] == "0" and "choiceshoriz" not in t2 and q["explain"]["latex"] == "Expand and count.")
t3, _ = qe.apply(t2, [{"op": "type", "id": "q01", "kind": "single"}])
q = rq(t3, "q01")
check("editor: back to choices gives two answers to fill in", q["kind"] == "single" and [x["latex"] for x in q["answers"]] == ["Answer 1", "Answer 2"] and q["answers"][0]["correct"])
t2, _ = qe.apply(rj, [{"op": "rename", "id": "q01", "new_id": "alg-1"}])
check("editor: renaming", [q["id"] for q in sc.read_latex(t2)] == ["alg-1", "nq1"])
for bad in ("nq1", "a b", "", "x{y}"):
    try:
        qe.apply(rj, [{"op": "rename", "id": "q01", "new_id": bad}]); check(f"editor: bad name {bad!r} refused", False)
    except qe.EditError:
        check(f"editor: bad name {bad!r} refused", True)
t2, what = qe.apply(rj, [{"op": "add", "after": "q01"}])
qs2 = sc.read_latex(t2)
check("editor: a question added after another joins its group", [q["id"] for q in qs2] == ["q01", "q3", "nq1"] and qs2[1]["group"] == "sectionI" and qs2[1]["kind"] == "single" and qs2[1]["indent"] == "  " and what == "Question q3: added" and "\\element{sectionI}{\n  \\begin{question}{q3}" in t2)
t2, _ = qe.apply(rj, [{"op": "add", "kind": "numeric", "group": "numerical"}])
qs2 = sc.read_latex(t2)
check("editor: a numeric question added at the end of its group", [q["id"] for q in qs2] == ["q01", "nq1", "nq2"] and qs2[2]["kind"] == "numeric" and qs2[2]["group"] == "numerical")
t2, _ = qe.apply(rj, [{"op": "add", "kind": "multiple", "qid": "extra"}])
check("editor: added at the end with a chosen name, in the last group", [q["id"] for q in sc.read_latex(t2)] == ["q01", "nq1", "extra"] and sc.read_latex(t2)[2]["group"] == "numerical")
empty = "\\documentclass{article}\n\\begin{document}\n\\onecopy{5}{\n%%% end of the header\n}\n\\end{document}\n"
t2, _ = qe.apply(empty, [{"op": "add"}])
check("editor: the first question goes after the header marker", [q["id"] for q in sc.read_latex(t2)] == ["q1"] and "%%% end of the header\n\n\\begin{question}{q1}" in t2)
t2, _ = qe.apply(rj, [{"op": "delete", "id": "q01"}])
check("editor: deleting takes the whole \\element block", [q["id"] for q in sc.read_latex(t2)] == ["nq1"] and "sectionI}{" not in t2 and "\\begin{document}\n\n\\element{numerical}" in t2)
t2, _ = qe.apply(rj, [{"op": "move", "id": "nq1", "before": "q01"}])
qs2 = sc.read_latex(t2)
check("editor: moving a question before another", [q["id"] for q in qs2] == ["nq1", "q01"] and qs2[0]["group"] == "numerical" and "\\begin{document}\n\n\\element{numerical}{\n  \\begin{questionmultx}{nq1}" in t2 and t2.count("\n\n\n") == 0)
t3, _ = qe.apply(t2, [{"op": "move", "id": "nq1"}])
check("editor: moving to the end", [q["id"] for q in sc.read_latex(t3)] == ["q01", "nq1"] and t3.count("\n\n\n") == 0)
t2, _ = qe.apply(src, [{"op": "answer_add", "id": "q2", "latex": "6"}, {"op": "text", "id": "q1", "latex": "What is 2+3?"}])
check("editor: inline answers and the simple source", [a["latex"] for a in rq(t2, "q2")["answers"]] == ["2", "3", "6"] and rq(t2, "q1")["text_latex"] == "What is 2+3?")
try:
    qe.apply(rj, [{"op": "text", "id": "q01", "latex": "unbalanced {"}]); check("editor: unbalanced braces are refused", False)
except qe.EditError:
    check("editor: unbalanced braces are refused", True)
check("editor: the lock still allows answer key edits but not text", same(rj, qe.apply(rj, [{"op": "answer_correct", "id": "q01", "i": 0, "correct": True}])[0]) and not same(rj, qe.apply(rj, [{"op": "text", "id": "q01", "latex": "Other"}])[0]))

# ---- paper design: sections (ui_structure.py)
import ui_structure as st
blank_src = open(os.path.join(SERVER, "school_templates/blank/exam.tex")).read()
secs = st.read_sections(blank_src)
check("structure: a plain \\insertgroup is a section without markers", [(x["name"], x["count"], x["shuffle"], x["markers"]) for x in secs] == [("general", None, True, False)])
r = st.read(blank_src, "exam.tex", sc.read_latex(blank_src, "exam.tex"))
check("structure: pool, marks from AMC's defaults, no inline questions", r["sections"][0]["pool"] == 2 and r["sections"][0]["marks"]["right"] == "1" and r["inline"] == 0 and r["copies"] == 10 and not r["summary"])
t1, what, ren = st.apply(blank_src, [{"op": "section_set", "name": "general", "heading": "Part A", "count": 1, "columns": 2, "shuffle": False}])
s1 = st.read_sections(t1)[0]
check("structure: editing adds the markers, the macros and multicol", s1["markers"] and s1["heading"] == "Part A" and s1["count"] == 1 and s1["columns"] == 2 and "%%AMCUI:MACROS%%" in t1 and "\\usepackage{multicol}" in t1 and what.startswith("Paper design: section general changed"))
check("structure: shuffle off removes the stray \\shufflegroup", not s1["shuffle"] and "\\shufflegroup{general}" not in t1)
check("structure: the questions and the rest of the file are untouched", t1.count("\\element{general}{\n") == 2 and "%%AMCUI:SCHOOL%%" in t1 and "\\AMCcleardoublepage" in t1)
t2, what, ren = st.apply(t1, [{"op": "section_add", "name": "partB", "heading": "Part B", "shuffle": True, "newpage": True}, {"op": "section_rename", "name": "general", "new": "partA"}, {"op": "section_move", "name": "partB", "before": "partA"}])
check("structure: add, rename (elements too) and move", [x["name"] for x in st.read_sections(t2)] == ["partB", "partA"] and t2.count("\\element{partA}{\n") == 2 and ren == [("general", "partA")] and "\\clearpage" in t2)
r2 = st.read(t2, "exam.tex", sc.read_latex(t2, "exam.tex"))
check("structure: an empty section is flagged; too few questions too", r2["sections"][0]["problem"] == "No question in this section yet." and st.read(st.apply(t2, [{"op": "section_set", "name": "partA", "count": 5}])[0], "exam.tex", sc.read_latex(t2, "exam.tex"))["sections"][1]["problem"] == "Only 2 questions for 5 per copy.")
t3, _, _ = st.apply(t2, [{"op": "section_delete", "name": "partA"}])
check("structure: deleting a section keeps its questions, listed as unused", st.read(t3, "exam.tex", sc.read_latex(t3, "exam.tex"))["unused"] == [{"name": "partA", "pool": 2}] and t3.count("\\element{partA}{\n") == 2)
for bad in ({"op": "section_add", "name": "part B"}, {"op": "section_add", "name": "partB"}, {"op": "section_set", "name": "partB", "count": "x"}, {"op": "section_set", "name": "partB", "heading": "a {b"}, {"op": "section_rename", "name": "partB", "new": "partA"}):
    try:
        st.apply(t2, [bad]); check(f"structure: refused {bad}", False)
    except st.EditError:
        check(f"structure: refused {bad['op']} {bad.get('name')} {bad.get('new', bad.get('count', bad.get('heading', '')))}", True)
# page breaks between sections: the builder starter has three sections, each on a new page
pb_src = open(os.path.join(SERVER, "school_templates/builder/exam.tex")).read()
br = lambda t: st.breaks(st.read_sections(t))
check("structure: page breaks read from the sections", br(pb_src) == (True, True) and st.read(pb_src, "exam.tex", [])["breaks"] == {"first": True, "between": True})
p1, what, _ = st.apply(pb_src, [{"op": "sections_break", "between": False}])
check("structure: each section right after the previous one, the first still on a new page", br(p1) == (True, False) and p1.count("\\clearpage\n\\amcuiSectionHeading") == 1 and what == "Paper design: each section right after the previous one")
p2, what, _ = st.apply(p1, [{"op": "sections_break", "first": False}])
check("structure: the first section's break on its own", br(p2) == (False, False) and "\\clearpage\n\\amcuiSectionHeading" not in p2 and "first section right after" in what)
p3, _, _ = st.apply(p1, [{"op": "section_add", "name": "extra", "heading": "Extra"}])
check("structure: a new section follows the later sections' choice", [x["newpage"] for x in st.read_sections(p3)] == [True, False, False, False] and st.read_sections(st.apply(pb_src, [{"op": "section_add", "name": "extra"}])[0])[-1]["newpage"])
p4, _, _ = st.apply(p1, [{"op": "section_move", "name": "numerical", "before": "sectionI"}])
check("structure: moving a section keeps the paper's page breaks", [x["name"] for x in st.read_sections(p4)] == ["numerical", "sectionI", "sectionII"] and br(p4) == (True, False))
p5, _, _ = st.apply(p1, [{"op": "section_delete", "name": "sectionI"}])
check("structure: removing the first section keeps the paper's page breaks", [x["name"] for x in st.read_sections(p5)] == ["sectionII", "numerical"] and br(p5) == (True, False))
p6, _, _ = st.apply(pb_src, [{"op": "section_set", "name": "sectionII", "newpage": False}])
p7, _, _ = st.apply(p6, [{"op": "section_move", "name": "numerical", "before": "sectionI"}])
check("structure: sections' own differing choices are left as they are", br(p6) == (True, None) and [x["newpage"] for x in st.read_sections(p7)] == [True, True, False])
for bad in ({"op": "sections_break"}, ):
    try:
        st.apply(pb_src, [bad]); check("structure: refused a page-break change without a choice", False)
    except st.EditError:
        check("structure: refused a page-break change without a choice", True)
inline_src = src.replace("\\begin{question}{q1}", "\\noindent Exam\n\n\\begin{question}{q1}")
r = st.read(inline_src, "exam.tex", sc.read_latex(inline_src, "exam.tex"))
check("structure: questions inside \\onecopy are counted as inline", r["inline"] == 2 and r["sections"] == [])
t4, what, _ = st.apply(inline_src, [{"op": "convert"}])
r4 = st.read(t4, "exam.tex", sc.read_latex(t4, "exam.tex"))
check("structure: organising moves them into \\element blocks before \\onecopy", r4["inline"] == 0 and [(x["name"], x["pool"]) for x in r4["sections"]] == [("main", 2)] and t4.index("\\element{main}{") < t4.index("\\onecopy") and "\\noindent Exam" in t4)
check("structure: the moved questions still read the same", [(q["id"], q["text_latex"], [a["correct"] for a in q["answers"]]) for q in sc.read_latex(t4)] == [(q["id"], q["text_latex"], [a["correct"] for a in q["answers"]]) for q in sc.read_latex(inline_src)])
fr_src = inline_src.replace("\\onecopy{10}{", "\\exemplaire{10}{")
t4b, _, _ = st.apply(fr_src, [{"op": "convert"}, {"op": "copies", "n": 3}])
check("structure: AMC's French \\exemplaire works like \\onecopy", st.read(fr_src, "exam.tex", sc.read_latex(fr_src, "exam.tex"))["inline"] == 2 and "\\exemplaire{3}{" in t4b and t4b.index("\\element{main}{") < t4b.index("\\exemplaire"))


# ---- paper builder (ui_builder.py)
import ui_builder as pb
check("builder: letters as spreadsheet columns", [pb.letters(n) for n in (1, 26, 27, 52, 53, 702)] == ["A", "Z", "AA", "AZ", "BA", "ZZ"])
check("builder: code tables", pb.codes_table({"style": "letters"}, 28)[26:] == ["AA", "AB"] and pb.codes_table({"style": "letters", "same_length": True}, 27)[:2] == ["AA", "AB"] and pb.codes_table({"style": "numbers", "zero_pad": True}, 10)[:2] == ["01", "02"] and pb.codes_table({"style": "none"}, 3) == ["", "", ""] and pb.max_versions({"style": "letters", "same_length": True}) == 676 and pb.max_versions({"style": "letters"}) == 702)
check("builder: three presets, the RJ layout first", [x["id"] for x in pb.presets()] == ["rj-olympiad", "simple", "blank"])
rj = pb.preset("rj-olympiad")
check("builder: the RJ preset normalizes with its rows and defaults", rj["kind"] == "separate" and len(rj["paper"]) == 8 and len(rj["answer_sheet"]) == 5 and rj["paper"][1]["cells"][1]["width"] == "fit" and rj["paper"][1]["cells"][0]["align"] == "left" and rj["paper"][0]["cells"][1]["align"] == "center" and rj["paper"][1]["cells"][0]["pad"] == "2mm")
check("builder: only notes on the RJ preset", all(x["level"] == "info" for x in pb.check(rj, 4)) and len(pb.check(rj, 4)) == 2)
for bad, what in (({"paper": [{"cells": [{"width": 7, "block": {"type": "text"}}, {"width": 6, "block": {"type": "text"}}]}]}, "add up"),
                  ({"paper": [{"cells": [{"width": "fit", "block": {"type": "id_grid"}}]}]}, "can't go"),
                  ({"answer_sheet": [{"cells": [{"width": "fit", "block": {"type": "id_grid"}}]}]}, "fixed width"),
                  ({"paper": [{"cells": [{"block": {"type": "nope"}}]}]}, "Unknown block"),
                  ({"paper": [{"cells": [{"block": {"type": "text", "latex": "a {b"}}]}]}, "unbalanced"),
                  ({"paper": [{"cells": [{"block": {"type": "text", "latex": "\\input{x}"}}]}]}, "can't use"),
                  ({"paper": [{"cells": [{"block": {"type": "logo", "file": "../x.png"}}]}]}, "file name"),
                  ({"paper": [{"cells": [{"pad": "big", "block": {"type": "text"}}]}]}, "length"),
                  ({"paper": [{"cells": [{"width": 12, "block": {"type": "text"}}, {"width": "auto", "block": {"type": "text"}}]}]}, "no room"),
                  ({"student": {"id_digits": 40}}, "between"),
                  ({"student": {"id_prefix": "MO 26"}}, "letters, digits"),
                  ({"student": {"box_height": "tall"}}, "height of a box")):
    try:
        pb.normalize(bad); check(f"builder: refused {what}", False)
    except pb.EditError as e:
        check(f"builder: refused {what}", what in str(e))
blank = pb.normalize({"kind": "paper", "paper": [{"cells": [{"block": {"type": "text", "latex": "x"}}]}]})
pr = pb.check(blank, 1)
check("builder: a paper without questions or a name field is flagged", [x["level"] for x in pr].count("error") == 2 and any("Questions block" in x["text"] for x in pr) and any("Student details" in x["text"] for x in pr))
sep = pb.normalize({"kind": "separate", "paper": [{"cells": [{"block": {"type": "questions"}}]}], "answer_sheet": [{"cells": [{"block": {"type": "student"}}]}]})
check("builder: an answer sheet without answer boxes is flagged", any("answer boxes" in x["text"] and x["level"] == "error" for x in pb.check(sep, 1)))
check("builder: too many versions for the codes", any(x["level"] == "error" and "versions" in x["text"] for x in pb.check(pb.normalize({"codes": {"style": "letters", "same_length": True}}), 700)))
check("builder: answer boxes printed twice are refused", any(x["level"] == "error" and "twice" in x["text"] for x in pb.check(pb.normalize({"kind": "separate", "answer_sheet": [{"cells": [{"block": {"type": "all_answers"}}]}, {"cells": [{"block": {"type": "numeric_answers"}}]}]}), 1)))
check("builder: a row needing a row of its own", any("row of its own" in x["text"] for x in pb.check(pb.normalize({"paper": [{"cells": [{"block": {"type": "questions"}}, {"block": {"type": "text"}}]}]}), 1)))
tex = pb.layout(rj, 28, ["\\amcuiPoint{Section 1: one}"])
check("builder: the layout loads AMC with a separate answer sheet, answers in order", "\\usepackage[box,completemulti,separateanswersheet,noshuffle]{automultiplechoice}" in tex and "\\usepackage{graphicx,xcolor,dashbox,multicol,varwidth}" in tex)
check("builder: the code table goes past Z", "\\or AA\\or AB\\fi" in tex and tex.count("\\or ") == 28)
check("builder: the footer from its pattern", "\\AMCsetFoot{\\makebox[\\textwidth][c]{\\dbox{\\texttt{Level I // Code \\amcuiCode{} // Page \\thepage{}}}}}" in tex)
rj2 = pb.normalize({**rj, "fields": {**rj["fields"], "level": ""}})
check("builder: an empty level drops its footer segment", "\\texttt{Code \\amcuiCode{} // Page \\thepage{}}" in pb.layout(rj2, 4))
check("builder: the name field wraps the sheet's student block only", tex.count("\\namefield{") == 1 and tex.index("\\namefield{") > tex.index("\\AMCformBegin"))
check("builder: the instructions block prints the heading and the summary lines", "\\amcuiPoint{Section 1: one}" in tex and "\\begin{center}\\scshape Read the following" in tex and "\\amcuiPoint{Do not open this booklet" in tex)
check("builder: widths fixed, measured and shared", "*8/12\\relax" in tex and "\\sbox\\amcuiBoxb{\\begin{varwidth}" in tex and "\\setlength{\\amcuiWc}{\\dimexpr(\\linewidth-2\\amcuiGapLen-\\amcuiWa-\\amcuiWb)/1\\relax}" in tex)
check("builder: a same-height row measures its boxes; grids are printed once", "\\ifdim\\amcuiTmpLen>\\amcuiRowH" in tex and tex.count("\\AMCcodeGridInt[top,v]{student}{3}") == 1 and tex.count("\\AMCformFilter{\\AMCifcategory{numeric}}") == 1)
aligned = pb.layout(pb.normalize({"paper": [{"align": "middle", "same_height": True, "cells": [{"width": 8, "block": {"type": "student"}}, {"block": {"type": "code", "label": "Code"}}]}, {"align": "bottom", "cells": [{"width": 6, "block": {"type": "student"}}, {"block": {"type": "code", "label": "Code"}}]}, {"cells": [{"block": {"type": "questions"}}]}]}), 2)
check("builder: the boxes of a row line up on their edges, not their first baselines", "\\raisebox{-\\height}{" in tex and aligned.count("\\raisebox{\\dimexpr(\\depth-\\height)/2\\relax}{") == 4 and aligned.count("\\raisebox{\\depth}{") == 2 and "\\relax][c]{" in aligned and "\\begin{minipage}[c]" not in aligned)
check("builder: the gap between columns is printed, on its own line", "\\end{minipage}}}}%\n\\hspace*{\\amcuiGapLen}%\n{\\setlength" in tex and "\\setlength{\\amcuiGapLen}{2mm}%" in tex and "}%\\hspace" not in tex)
check("builder: the writing boxes take their size from the details, not from the padding", "\\setlength{\\amcuiBoxW}{7mm}\\setlength{\\amcuiBoxH}{7mm}" in tex and "\\amcuiCharBox{black}{white}{I}" in tex and "\\setlength{\\fboxsep}{0pt}\\fcolorbox{#1}{#2}{\\parbox[c][\\dimexpr\\amcuiBoxH-2\\fboxrule\\relax][c]" in tex and "\\setlength{\\amcuiBoxW}{9mm}" in pb.layout(pb.normalize({**rj, "student": {**rj["student"], "box_width": "9mm"}}), 2))
check("builder: numeric answers: one box per question, its number on top, side by side", "\\amcuiNumericForm{4}" in tex and "\\newcommand{\\amcuiNumLabel}[1]{\\textsf{Q-\\ifnum#1<10 0\\fi#1}}" in tex and "\\def\\AMCformAfterQuestion{\\end{tabular}\\egroup" in tex and "\\begin{multicols*}{4}\n\\AMCformFilter{\\AMCifcategory{numeric}}" not in tex and "{\\small\\AMC@loc@qf{#1}}" in pb.layout(pb.normalize({**rj, "page": {**rj["page"], "question_style": "default"}}), 2))
no_class = pb.layout(pb.normalize({**rj, "student": {**rj["student"], "klass": False}}), 2)
no_level = pb.layout(pb.normalize({**rj, "student": {**rj["student"], "level": False}}), 2)
check("builder: the class off in Details: no class boxes, no class grid", "{studclass}" not in no_class and "Class: " not in no_class and "{studclass}" in tex and "Class: \\amcuiDigitBoxes" in tex)
check("builder: the level off: no level box, no level in the footer or the title", "\\amcuiCharBox{black}{white}{I}" not in no_level and "\\texttt{Code \\amcuiCode{} // Page \\thepage{}}" in no_level and "Level I" not in no_level and "\\amcuiCharBox{black}{white}{I}" in tex)
check("builder: a class grid with the class off is noted, a student block with only the class is flagged", any(x["level"] == "info" and "Class grid prints nothing" in x["text"] for x in pb.check(pb.normalize({**rj, "student": {**rj["student"], "klass": False}}), 2)) and any(x["level"] == "error" and "nothing to print" in x["text"] for x in pb.check(pb.normalize({"kind": "paper", "student": {"klass": False}, "paper": [{"cells": [{"block": {"type": "student", "name": False, "id": False, "klass": True}}]}, {"cells": [{"block": {"type": "questions"}}]}]}), 1)))
wiz = pb.apply_student(pb.preset("rj-olympiad"), {"klass": False, "level": "0"})
check("builder: the wizard's choice takes the class grid off the sheet", not wiz["student"]["klass"] and not wiz["student"]["level"] and not any(c["block"]["type"] == "class_grid" for r in wiz["answer_sheet"] for c in r["cells"]) and len(wiz["answer_sheet"]) == 5 and pb.apply_student(pb.preset("rj-olympiad"), {})["student"]["klass"] and not any("your class" in c["block"].get("latex", "") for r in wiz["answer_sheet"] for c in r["cells"]) and any("Darken the digits of your registration number" in c["block"].get("latex", "") for r in wiz["answer_sheet"] for c in r["cells"]))
check("builder: the questions split the paper, then filler pages and the sheet", tex.index("\\newcommand{\\amcuiPaperBack}") < tex.index("\\amcuiRoughWork{2}") < tex.index("\\AMCaddpagesto{10}") < tex.index("\\clearpage\n\\AMCformBegin"))
paper_kind = pb.layout(pb.preset("simple"), 2)
check("builder: answers on the paper: the name field on the paper, no form", "\\namefield{" in paper_kind and "\\AMCformBegin" not in paper_kind and "separateanswersheet" not in paper_kind and "\\AMCsetFoot{\\makebox[\\textwidth][c]{Code \\amcuiCode{} // Page \\thepage{}}}" in paper_kind)
front = paper_kind.split("\\newcommand{\\amcuiPaperFront}")[1].split("\\newcommand{\\amcuiPaperBack}")[0]
check("builder: an empty block takes no column, an empty row nothing", "Maximum marks" not in front and "\\amcuiWb" not in front and "\\LARGE" not in front)
check("builder: the digest follows the design", pb.digest(rj) != pb.digest(rj2) and len(pb.digest(rj)) == 12)
bq = sc.read_latex(open(os.path.join(SERVER, "school_templates/builder/questions.tex")).read(), "questions.tex")
check("builder: the summary from the starter's files", len(pb.summary_for(open(os.path.join(SERVER, "school_templates/builder/exam.tex")).read(), bq)) == 3)
check("builder: paper.json of the starter is the RJ preset", json.load(open(os.path.join(SERVER, "school_templates/builder/paper.json"))) == rj)
check("builder: a first section goes before \\amcuiPaperBack", st._insert_point("\\onecopy{2}{\n\\amcuiPaperFront\n\\amcuiPaperBack\n}")[0] == len("\\onecopy{2}{\n\\amcuiPaperFront\n"))

# question editor: inputs that must not break the file (review of !11)
_shared = r"""\documentclass{article}
\begin{document}
\element{g}{
  \begin{question}{a}
    Text % \end{question} not the end
    \begin{choices}
      \correctchoice{yes}
      \wrongchoice{no}
    \end{choices}
  \end{question}
  \begin{questionmult}{b}
    T2
    \begin{choices}
      \correctchoice{x}
      \correctchoice{y}
      \wrongchoice{z}
    \end{choices}
  \end{questionmult}
}
\end{document}
"""
_qs = sc.read_latex(_shared)
check("editor: an \\end{question} in a comment isn't the end of the question", len(_qs) == 2 and len(_qs[0]["answers"]) == 2)
check("editor: questions sharing one \\element{}{} belong to its group", [(q["group"], q.get("element")) for q in _qs] == [("g", "shared"), ("g", "shared")])
_t, _ = qe.apply(_shared, [{"op": "add", "after": "b"}])
check("editor: a question added inside a shared \\element goes in bare, in the group", _t.count("\\element") == 1 and [q["group"] for q in sc.read_latex(_t)] == ["g", "g", "g"])
_t, _ = qe.apply(_shared, [{"op": "answer_text", "id": "a", "i": 0, "latex": "50% sure"}])
check("editor: a bare % in a field is escaped, so it can't comment out the closing brace", "\\correctchoice{50\\% sure}" in _t)
_t, _ = qe.apply(_shared, [{"op": "text", "id": "a", "latex": "ok $\\{1,2\\}$ 100\\% \\textbf{b}"}])
check("editor: escaped braces and \\% pass as typed", "ok $\\{1,2\\}$ 100\\% \\textbf{b}" in _t)
def _refused(ops):
    try:
        qe.apply(_shared, ops)
        return False
    except qe.EditError:
        return True
check("editor: question structure typed in a field is refused",
      all(_refused([{"op": "text", "id": "a", "latex": v}]) for v in ("hi \\end{question} x", "\\begin{choices}", "\\correctchoice{y}", "\\explain{e}", "\\scoring{b=1}")))
check("editor: braces closing before opening are refused", _refused([{"op": "text", "id": "a", "latex": "a } b {"}]))
check("editor: bad indices and a refused answer key are errors in words, not crashes",
      _refused([{"op": "answer_correct", "id": "a", "i": None}]) and _refused([{"op": "answer_move", "id": "a", "i": None, "j": 0}])
      and _refused([{"op": "answer_correct", "id": "a", "i": 0, "correct": False}]) and _refused([{"op": "numeric", "id": "a", "value": "-", "options": ""}]))
_t, _ = qe.apply(_shared, [{"op": "type", "id": "b", "kind": "single"}])
check("editor: multiple -> single keeps the first correct answer only", [a["correct"] for a in sc.read_latex(_t)[1]["answers"]] == [True, False, False])
_t, _ = qe.apply(_shared, [{"op": "answer_correct", "id": "a", "i": 1, "correct": "true"}, {"op": "answer_correct", "id": "a", "i": 0, "correct": "false"}])
check("editor: correct is read as a real boolean", [a["correct"] for a in sc.read_latex(_t)[0]["answers"]] == [False, True])

# paper design: what the teacher wrote stays (review of !12)
import ui_structure as pst
_doc = r"""\documentclass{article}
\def\ptsA{b=3,m=-1}
\begin{document}
\element{a}{\begin{question}{q1} T \begin{choices}\correctchoice{y}\wrongchoice{n}\end{choices}\end{question}}
\element{Part 1}{\begin{question}{q2} T \begin{choices}\correctchoice{y}\wrongchoice{n}\end{choices}\end{question}}
\onecopy{3}{ % note: { here
%%AMCUI:SECTION a%%
\amcuiSectionHeading{Section 1}
\vspace{3cm}
\insertgroup[3]{a}
\insertgroup{b}
%%AMCUI:END SECTION%%
\newpage \insertgroup{Part 1}
\begin{multicols}{2}\insertgroup{d}\end{multicols}
\setgroupmode{a}{withoutreplacement}
}
\end{document}
"""
check("design: \\onecopy is found when a comment inside holds a brace", pst.onecopy(_doc) is not None)
_t = pst.set_section(_doc, "a", {"count": 2, "heading": "New"})
check("design: a rewrite keeps the LaTeX written between the markers", all(x in _t for x in ("\\vspace{3cm}", "\\insertgroup{b}", "\\insertgroup[2]{a}", "\\amcuiSectionHeading{New}")) and "Section 1" not in _t)
_t2 = pst.set_section(_t, "a", {"shuffle": True})
check("design: a second rewrite adds nothing twice", _t2.count("%%AMCUI:SECTION a%%") == 1 and _t2.count("\\insertgroup{b}") == 1 and _t2.count("\\vspace{3cm}") == 1)
_t3 = pst.set_section(_doc, "Part 1", {"count": 1})
_t4 = pst.set_section(_t3, "Part 1", {"count": 2})
check("design: a group named with a space gets markers that are read back, and keeps the \\newpage on its line",
      "%%AMCUI:SECTION Part 1%%" in _t3 and "\\newpage" in _t3 and _t4.count("%%AMCUI:SECTION Part 1%%") == 1 and "\\insertgroup[2]{Part 1}" in _t4)
_t5 = pst.set_section(_doc, "d", {"count": 1})
check("design: a multicols around a plain \\insertgroup is kept, and read as the section's columns",
      "\\begin{multicols}{2}" in _t5 and "\\end{multicols}" in _t5 and [s["columns"] for s in pst.read_sections(_t5) if s["name"] == "d"] == [2])
def _refused_s(fn, *a, **k):
    try:
        fn(*a, **k)
        return False
    except qe.EditError:
        return True
check("design: columns can't nest a multicols the teacher wrote", _refused_s(pst.set_section, _doc, "d", {"columns": 2}))
_t6, _ = pst.rename_section(_doc, "a", "alpha")
check("design: a rename reaches \\setgroupmode and \\element", "\\setgroupmode{alpha}" in _t6 and "\\element{alpha}" in _t6 and "{a}" not in _t6.replace("\\ptsA", ""))
check("design: a rename can't take a group name of another file", _refused_s(pst.rename_section, _doc, "a", "other", other_groups={"other"}))
check("design: an existing group with an odd name can get a section, a new section can't",
      "%%AMCUI:SECTION part_1%%" in pst.add_section(_doc, {"name": "part_1"}, existing={"part_1"})[0] and _refused_s(pst.add_section, _doc, {"name": "part_1"}))
check("design: a macro's value comes from its definition, not a use", pst._macro_value(_doc, "ptsA") == "b=3,m=-1" and pst._macro_value("\\ptsA{x}", "ptsA") is None)
check("design: a bare % in a heading is escaped", "100\\% marks" in pst.set_section(_doc, "a", {"heading": "Total 100% marks"}))
_simple = "\\documentclass{article}\\begin{document}\n\\onecopy{10}{\n\\noindent Header\n\n\\begin{question}{p}\n  T\n  \\begin{choices}\n    \\correctchoice{a}\n  \\end{choices}\n\\end{question}\n\n% \\AMCaddpagesto{3}\n\n\\begin{questionmult}{q}\n    T2\n  \\begin{choices}\n    \\correctchoice{a}\n  \\end{choices}\n\\end{questionmult}\n\n}\n\\end{document}\n"
_t9, _ = pst.convert_inline(_simple)
check("design: organising moves the questions as written", "\\element{main}{\n\\begin{question}{p}\n  T\n  \\begin{choices}\n    \\correctchoice{a}\n  \\end{choices}\n\\end{question}\n}" in _t9)
check("design: organising is refused when LaTeX sits between the questions", _refused_s(pst.convert_inline, _simple.replace("% \\AMCaddpagesto{3}", "\\section*{Part B}")))
_summ = _doc.replace("\\onecopy{3}{ % note: { here", "\\onecopy{3}{\n%%AMCUI:SUMMARY%%\n%%AMCUI:END SUMMARY%%")
_t10, _, _ = pst.apply(_summ, [{"op": "summary"}], [])
check("design: the summary defines the macro its lines use", "\\providecommand{\\amcuiPoint}" in _t10 and "\\amcuiPoint{" in _t10)

# paper builder: review of !13
check("builder: a bare % in raw LaTeX is escaped, so it can't swallow the closing brace",
      pb.normalize({"paper": [{"cells": [{"block": {"type": "text", "latex": "Total 100% of marks"}}]}]})["paper"][0]["cells"][0]["block"]["latex"] == "Total 100\\% of marks"
      and pb.normalize({"paper": [{"cells": [{"block": {"type": "text", "latex": "50\\% kept"}}]}]})["paper"][0]["cells"][0]["block"]["latex"] == "50\\% kept")
check("builder: a fit column with a border adds its own padding, not the default", "+2\\fboxrule+2\\dimexpr2mm\\relax" in tex and "+2\\fboxsep+2\\fboxrule" not in tex)
for bad, what in (({"paper": [{"cells": [{"pad": "5000mm", "block": {"type": "text"}}]}]}, "too long"),
                  ({"answer_sheet": [{"cells": [{"pad": "9999pt", "block": {"type": "text"}}]}]}, "too long")):
    try:
        pb.normalize(bad); check(f"builder: refused a length {what}", False)
    except pb.EditError as e:
        check(f"builder: refused a length {what}", what in str(e))
check("builder: a logo file name may hold spaces", pb.normalize({"paper": [{"cells": [{"block": {"type": "logo", "file": "My Logo.png"}}]}]})["paper"][0]["cells"][0]["block"]["file"] == "My Logo.png")
check("builder: an ID grid twice on the sheet is refused",
      any(x["level"] == "error" and "grid printed twice" in x["text"] for x in pb.check(pb.normalize({"kind": "separate", "paper": [{"cells": [{"block": {"type": "questions"}}]}], "answer_sheet": [{"cells": [{"block": {"type": "student"}}]}, {"cells": [{"block": {"type": "id_grid"}}]}, {"cells": [{"block": {"type": "id_grid"}}]}, {"cells": [{"block": {"type": "all_answers"}}]}]}), 2)))

# ---- annotated sheets: the symbols and the key (ui_legend.py)
import subprocess
import ui_legend as lg
check("legend: AMC's own settings, as it writes them, read as the amc preset",
      lg.same_scheme(lg.scheme_from_options({"annote_color": "red", "symboles_trait": "2", "symbole_0_0_type": "none", "symbole_0_0_color": "black",
                                             "symbole_0_1_type": "circle", "symbole_0_1_color": "#ffff00000000", "symbole_1_0_type": "mark", "symbole_1_0_color": "red",
                                             "symbole_1_1_type": "mark", "symbole_1_1_color": "blue"}), lg.PRESETS["amc"]))
check("legend: an exam without a choice gets the clear scheme, with no settings or AMC's defaults",
      lg.style_of({}, {})["preset"] == "clear" and lg.style_of({}, lg.amc_options(lg.PRESETS["amc"]))["preset"] == "clear")
check("legend: settings customised elsewhere are kept as custom", lg.style_of({}, lg.amc_options(dict(lg.PRESETS["clear"], text="#123456")))["preset"] == "custom")
check("legend: a damaged custom choice falls back to clear", lg.style_of({"annotate_style": {"preset": "custom", "scheme": {"text": "#000000"}}}, {})["preset"] == "clear")
for bad in ({"text": "red"}, dict(lg.PRESETS["clear"], **{"1_1": ["star", "#000000"]}), dict(lg.PRESETS["clear"], width="x")):
    try:
        lg.check_scheme(bad); check("legend: a bad custom scheme is refused", False)
    except ValueError:
        check("legend: a bad custom scheme is refused", True)
check("legend: a custom scheme keeps AMC's option names", set(lg.amc_options(lg.check_scheme(lg.PRESETS["clear"]))) == set(lg.option_names()))

# The key on a folder of sheets: each stamped once and listed; a file whose key fails is left for the next run.
def _blank_pdf(path):
    objs = [b"<</Type/Catalog/Pages 2 0 R>>", b"<</Type/Pages/Kids[3 0 R]/Count 1>>", b"<</Type/Page/Parent 2 0 R/MediaBox[0 0 595.28 841.89]>>"]
    out, offs = b"%PDF-1.4\n", []
    for i, o in enumerate(objs, 1):
        offs.append(len(out)); out += b"%d 0 obj" % i + o + b"endobj\n"
    x = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1) + b"".join(b"%010d 00000 n \n" % o for o in offs)
    out += b"trailer<</Size %d/Root 1 0 R>>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, x)
    with open(path, "wb") as f:
        f.write(out)
_d = tempfile.mkdtemp(); _pdfs = os.path.join(_d, "pdf"); os.makedirs(_pdfs)
for n in ("a.pdf", "b.pdf"):
    _blank_pdf(os.path.join(_pdfs, n))
_keys = lambda n: subprocess.run(["pdftotext", os.path.join(_pdfs, n), "-"], capture_output=True, text=True).stdout.count("Key:")
check("legend: a blank page has no key", lg.page_size(os.path.join(_pdfs, "a.pdf")) == (595.28, 841.89) and _keys("a.pdf") == 0)
_stamp = lg.stamp
def _failing(pdf, legend):
    if pdf.endswith("b.pdf"):
        raise RuntimeError("no key for b")
    return _stamp(pdf, legend)
lg.stamp = _failing
try:
    lg.stamp_folder(_pdfs, lg.PRESETS["clear"], "right", _d); _raised = False
except RuntimeError:
    _raised = True
lg.stamp = _stamp
with open(os.path.join(_d, lg.STAMPED), encoding="utf-8") as f:
    _rec = json.load(f)
check("legend: a file whose key fails is reported, and the others listed as stamped", _raised and "a.pdf" in _rec and "b.pdf" not in _rec and _keys("a.pdf") == 1 and _keys("b.pdf") == 0)
check("legend: the next run stamps only that file", lg.stamp_folder(_pdfs, lg.PRESETS["clear"], "right", _d) == 1 and _keys("a.pdf") == 1 and _keys("b.pdf") == 1)
check("legend: ...and a run after that stamps nothing", lg.stamp_folder(_pdfs, lg.PRESETS["clear"], "right", _d) == 0 and _keys("a.pdf") == 1)
check("legend: the key names the cases", "Correct, not ticked" in subprocess.run(["pdftotext", os.path.join(_pdfs, "a.pdf"), "-"], capture_output=True, text=True).stdout)
shutil.rmtree(_d)

print(f"\n{ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
