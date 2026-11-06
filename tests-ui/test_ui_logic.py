"""Checks for server/ui.py logic that doesn't need a running app: the
lock's "does this change move anything on the printed paper?" comparison,
and reading/writing the default scoring in LaTeX and AMC-TXT sources.

Run with the app's image (it has Flask):
  docker run --rm -v "$PWD/server:/s:ro" -v "$PWD/tests-ui/test_ui_logic.py:/t.py:ro" \
    --entrypoint /venv/bin/python amc-web /t.py
"""
import sys
sys.path.insert(0, "/s")
import ui
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
print(f"\n{ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
