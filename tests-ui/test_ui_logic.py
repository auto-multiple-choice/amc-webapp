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
    # pruning: fake old versions
    d = os.path.join(exam, hist.HISTORY_DIR, "exam.tex")
    now = time.time()
    real = len(hist.versions(exam, "exam.tex"))
    for i in range(45):
        vid = "20200101T%06dZ" % i
        open(os.path.join(d, vid + ".tex"), "wb").write(b"old")
        json.dump({"id": vid, "file": "exam.tex", "at": int(now - (200 - i) * 86400), "by": None, "what": "Saved",
                   "size": 3, "digest": "x%d" % i, "built": i == 3, "deleted": False}, open(os.path.join(d, vid + ".json"), "w"))
    before_vs = hist.versions(exam, "exam.tex")
    newest_built = next(v["id"] for v in before_vs if v["built"])
    hist.prune(exam, "exam.tex", now=now)
    after = hist.versions(exam, "exam.tex")
    check("history: pruning keeps the newest 30 and the newest built version, and drops older ones (a built one too)",
          len(before_vs) == real + 45 and len(after) == 30 and any(v["id"] == newest_built for v in after)
          and not any(v["id"] == "20200101T000003Z" for v in after))
    # ...but an old built version is kept when no newer one built
    hist.write_source(exam, "c.csv", b"a\n", what="Uploaded"); hist.write_source(exam, "c.csv", b"b\n", what="Uploaded")
    d = os.path.join(exam, hist.HISTORY_DIR, "c.csv")
    for i in range(40):
        vid = "20200101T%06dZ" % i
        open(os.path.join(d, vid + ".csv"), "wb").write(b"old")
        json.dump({"id": vid, "file": "c.csv", "at": int(now - (200 - i) * 86400), "by": None, "what": "Uploaded",
                   "size": 3, "digest": "y%d" % i, "built": i == 2, "deleted": False}, open(os.path.join(d, vid + ".json"), "w"))
    hist.prune(exam, "c.csv", now=now)
    after = hist.versions(exam, "c.csv")
    check("history: the newest version that built survives pruning however old", len(after) == 31 and any(v["id"] == "20200101T000002Z" for v in after))
finally:
    shutil.rmtree(tmp, ignore_errors=True)


print(f"\n{ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
