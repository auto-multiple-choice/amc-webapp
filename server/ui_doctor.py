#!/usr/bin/env python3
"""
./amc doctor (doc/question-bank-plan.md, section 8): a look at the app's
server-only folder, MC-Projects/_amcweb, for every teacher.

  - each history (exams and banks): git fsck, and whether its exam or bank
    still exists, is in the trash, or is gone (an orphan: kept, listed);
  - the trash: entries and what they hold;
  - the bank search index: read again from the banks (with --rebuild-index,
    thrown away first and rebuilt);
  - the question statistics kept for banks.

Nothing is removed. Exit status 1 when a history is damaged.

  docker compose exec -T amc-web python3 /amc-web/server/ui_doctor.py [--rebuild-index]
"""
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import ui_bankindex as bankindex  # noqa: E402
import ui_vcs as vcs  # noqa: E402


def fsck(git_dir):
    p = subprocess.run([vcs.GIT, "--git-dir", git_dir, *vcs._CONFIG, "fsck", "--no-progress", "--no-dangling"],
                       capture_output=True, env=vcs._env(), timeout=600)
    return p.returncode == 0, (p.stderr or p.stdout).decode("utf-8", "replace").strip()[:300]


def check(root, rebuild=False, out=print):
    """Look at every teacher's folder under ROOT/_amcweb. Returns the
    number of damaged histories."""
    amcweb = os.path.join(root, vcs.AMCWEB_DIR)
    if not os.path.isdir(amcweb):
        out(f"No {vcs.AMCWEB_DIR} folder in {root}: nothing to check yet.")
        return 0
    damaged = 0
    for owner in sorted(os.listdir(amcweb)):
        home = os.path.join(amcweb, owner)
        if not os.path.isdir(home) or owner.startswith("."):
            continue
        projects = root if owner == vcs.LOCAL_OWNER else os.path.join(root, owner)
        out(f"\n== {owner if owner != vcs.LOCAL_OWNER else 'this computer'} ({projects})")
        trash = vcs.list_trash(home)
        trashed = {t.get("uid") for t in trash}
        for kind, target in (("exams", "exam"), ("banks", "bank")):
            d = os.path.join(home, "history", kind)
            gits = sorted(x for x in os.listdir(d) if x.endswith(".git") and vcs.UID_RE.match(x[:-4])) if os.path.isdir(d) else []
            ok_n, orphans = 0, []
            for g in gits:
                uid = g[:-4]
                good, why = fsck(os.path.join(d, g))
                meta = vcs._read_json(os.path.join(d, uid + ".json")) or {}
                folder = meta.get("folder")
                here = bool(folder) and vcs.is_target(folder, target) and vcs.read_uid(folder, target) == uid
                if not good:
                    damaged += 1
                    out(f"  DAMAGED {kind[:-1]} history {uid} ({meta.get('name') or '?'}): {why}")
                elif here:
                    ok_n += 1
                elif uid in trashed:
                    ok_n += 1
                else:
                    orphans.append(f"{meta.get('name') or '?'} ({uid})")
            out(f"  {kind}: {len(gits)} histor{'y' if len(gits) == 1 else 'ies'}, {ok_n} with their {kind[:-1]} or in the trash"
                + (f"; {len(orphans)} whose {kind[:-1]} is gone (kept): {', '.join(orphans[:10])}{' …' if len(orphans) > 10 else ''}" if orphans else ""))
        out(f"  trash: {len(trash)} entr{'y' if len(trash) == 1 else 'ies'}" + (f" ({', '.join(t.get('name') or '?' for t in trash[:10])})" if trash else ""))
        index = os.path.join(home, bankindex.INDEX)
        if rebuild:
            for ext in ("", "-wal", "-shm", "-journal"):
                try:
                    os.unlink(index + ext)
                except OSError:
                    pass
        if os.path.isdir(os.path.join(projects, "_banks")) or os.path.exists(index):
            try:
                db, dirs = bankindex.refresh(home, projects)
                n = db.execute("SELECT count(*) FROM items").fetchone()[0]
                db.close()
                out(f"  bank index: {len(dirs)} bank{'s' if len(dirs) != 1 else ''}, {n} question{'s' if n != 1 else ''}" + (" (rebuilt)" if rebuild else " (up to date)"))
            except Exception as e:  # noqa: BLE001 - a report, not a crash
                out(f"  bank index: can't be read ({e}); run with --rebuild-index")
        stats = os.path.join(home, bankindex.STATS_DIR)
        if os.path.isdir(stats):
            out(f"  question statistics kept for banks: {len([f for f in os.listdir(stats) if f.endswith('.json')])} exam(s)")
    out("\n" + ("All histories are sound." if not damaged else f"{damaged} damaged histor{'y' if damaged == 1 else 'ies'}: "
                "the exams and banks themselves are fine (their files are the truth). Back up MC-Projects/_amcweb, then move "
                "a damaged <uid>.git aside: that history starts again from the files the next time it is opened."))
    return damaged


def main(argv):
    root = os.environ.get("AMC_PROJECTSDIR") or os.path.expanduser("~/MC-Projects")
    return 1 if check(root, rebuild="--rebuild-index" in argv) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
