#!/usr/bin/env python3
"""
./amc doctor (doc/features.md, Maintenance): a look at the app's
server-only folder, MC-Projects/_amcweb, for every teacher.

  - each history (exams and banks): git fsck, and whether its exam or bank
    still exists, is in the trash, or is gone (an orphan: kept, listed);
  - the trash: entries and what they hold;
  - the bank search index: how many banks and questions it holds (with
    --rebuild-index, thrown away and built again from the banks);
  - the question statistics kept for banks.

Nothing is removed or changed (the trash isn't purged, the index isn't
touched) unless --rebuild-index is given. Exit status 1 when a history is
damaged.

  docker compose exec -T amc-web python3 /amc-web/server/ui_doctor.py [--rebuild-index]
"""
import os
import sqlite3
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import ui_bankindex as bankindex  # noqa: E402
import ui_vcs as vcs  # noqa: E402


def fsck(git_dir):
    try:
        p = subprocess.run([vcs.GIT, "--git-dir", git_dir, *vcs._CONFIG, "fsck", "--no-progress", "--no-dangling"],
                           capture_output=True, env=vcs._env(), timeout=600)
    except subprocess.TimeoutExpired:
        return False, "git fsck didn't finish in 10 minutes"
    except OSError as e:
        return False, f"git couldn't run: {e}"
    return p.returncode == 0, (p.stderr or p.stdout).decode("utf-8", "replace").strip()[:300]


def _uids_in(projects, target):
    """The uids of the exams (or banks) in a teacher's folder, read from the
    folders themselves: a history whose exam was renamed outside the app
    still has its exam."""
    if target == "bank":
        root = os.path.join(projects, vcs.BANKS_DIR)
        dirs = [os.path.join(root, n) for n in (os.listdir(root) if os.path.isdir(root) else [])]
    else:
        dirs = [os.path.join(projects, n) for n in (os.listdir(projects) if os.path.isdir(projects) else []) if not n.startswith(("_", "."))]
    out = set()
    for d in dirs:
        if os.path.isdir(d) and not os.path.islink(d) and vcs.is_target(d, target):
            u = vcs.read_uid(d, target)
            if u:
                out.add(u)
    return out


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
        trash = vcs.list_trash(home, purge=False)  # a look: nothing goes
        trashed = {t.get("uid") for t in trash}
        for kind, target in (("exams", "exam"), ("banks", "bank")):
            d = os.path.join(home, "history", kind)
            gits = sorted(x for x in os.listdir(d) if x.endswith(".git") and vcs.UID_RE.match(x[:-4])) if os.path.isdir(d) else []
            present = _uids_in(projects, target)
            ok_n, orphans = 0, []
            for g in gits:
                uid = g[:-4]
                good, why = fsck(os.path.join(d, g))
                meta = vcs._read_json(os.path.join(d, uid + ".json")) or {}
                folder = meta.get("folder")
                here = (bool(folder) and vcs.is_target(folder, target) and vcs.read_uid(folder, target) == uid) or uid in present
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
        if rebuild:  # asked for: the index is thrown away and built again from the banks
            for ext in ("", "-wal", "-shm", "-journal"):
                try:
                    os.unlink(index + ext)
                except OSError:
                    pass
            try:
                db, dirs = bankindex.refresh(home, projects)
                n = db.execute("SELECT count(*) FROM items").fetchone()[0]
                db.close()
                out(f"  bank index: {len(dirs)} bank{'s' if len(dirs) != 1 else ''}, {n} question{'s' if n != 1 else ''} (rebuilt)")
            except Exception as e:  # noqa: BLE001 - a report, not a crash
                out(f"  bank index: couldn't be rebuilt ({e})")
        elif os.path.exists(index):  # a look only, read-only: the app brings it up to date at the next search
            try:
                db = sqlite3.connect(f"file:{index}?mode=ro", uri=True, timeout=10)
                try:
                    nb = db.execute("SELECT count(*) FROM banks").fetchone()[0]
                    n = db.execute("SELECT count(*) FROM items").fetchone()[0]
                finally:
                    db.close()
                out(f"  bank index: {nb} bank{'s' if nb != 1 else ''}, {n} question{'s' if n != 1 else ''} (as last built; the app brings it up to date when searching)")
            except sqlite3.Error as e:
                out(f"  bank index: can't be read ({e}); run with --rebuild-index")
        elif os.path.isdir(os.path.join(projects, vcs.BANKS_DIR)):
            out("  bank index: not built yet (built at the first search)")
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
