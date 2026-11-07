#!/usr/bin/env python3
"""Check that every icon the new interface uses will be in icons.css.

Upstream's icon build keeps only icons named in server/templates/*.html, so
icons used from server/static/ui/app.js and builder.js must be listed in
server/templates/ui_icons.html, and must exist in the Iconoir set.

Run from the repository root:  python3 tests-ui/check_icons.py
Rewrite the list:               python3 tests-ui/check_icons.py --write
"""
import re
import sys

JS = "server/static/ui/app.js, builder.js, banks.js and stats.js"
JS_FILES = ("server/static/ui/app.js", "server/static/ui/builder.js", "server/static/ui/banks.js", "server/static/ui/stats.js")
LIST = "server/templates/ui_icons.html"
ICONOIR = "src-icons/iconoir.css"

js = "\n".join(open(f, encoding="utf-8").read() for f in JS_FILES)
available = set(re.findall(r"\.iconoir-([a-z0-9-]+)::before",
                           open(ICONOIR, encoding="utf-8").read()))
# Icons are often chosen at runtime (ic(open ? 'expand' : 'collapse'), or
# from lookup tables), so take every quoted string that names an icon.
# A few extra icons in icons.css cost little; a missing one shows as a
# black square.
used = {m for m in re.findall(r"'([a-z0-9-]+)'", js) if m in available}
listed = set(re.findall(r'<i class="iconoir-([a-z0-9-]+)"',
                        open(LIST, encoding="utf-8").read()))

if "--write" in sys.argv:
    with open(LIST, encoding="utf-8") as f:
        head = f.read().split("#}", 1)[0] + "#}\n"
    with open(LIST, "w", encoding="utf-8") as f:
        f.write(head + "".join(f'<i class="iconoir-{n}"></i>\n' for n in sorted(used)))
    listed = used

problems = []
for name in sorted(used - listed):
    problems.append(f"{name}: used in {JS} but missing from {LIST}")
for name in sorted(set(re.findall(r"ic\('([a-z0-9-]+)'", js)) - available):
    problems.append(f"{name}: not an Iconoir icon")
if problems:
    print("\n".join(problems))
    sys.exit(1)
print(f"OK: {len(used)} icons, all listed and available.")
