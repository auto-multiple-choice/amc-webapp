"""
Source history (doc/questions-banks-templates-plan.md, section 4).

Every change to a source file keeps the version it replaces, a deleted
file is kept too, the version that last built correctly is marked, and
any version can be restored. Versions live in the exam folder:

  .history/<file>/<id>.<ext>   the version itself
  .history/<file>/<id>.json    who made it, when, how, its digest, built
  .history/<file>/current.json how the file as it is now was made

so they follow the exam when it is renamed, copied, deleted or backed up.
Standard library only (plus filelock, which the server already uses), so
tests can run it without Flask.
"""
import hashlib
import json
import os
import re
import time

from filelock import FileLock

HISTORY_DIR = ".history"
# Versions from the last KEEP_DAYS are kept; a file that hasn't changed for
# longer keeps its last KEEP_AT_LEAST versions whatever their age; and no
# file keeps more than MAX_VERSIONS (a busy week of marking-panel clicks).
KEEP_DAYS = 7
KEEP_AT_LEAST = 12
MAX_VERSIONS = 100
# Files whose earlier versions are kept: the sources and what they
# include, and class lists. Images and PDFs are not.
EXTENSIONS = ("tex", "latex", "txt", "sty", "cls", "yml", "yaml", "csv")
MAX_SIZE = 4 * 1024 * 1024  # bigger than any source; images stay out
_ID = re.compile(r"^\d{8}T\d{6}Z(-\d+)?\Z")


class Conflict(Exception):
    """The file changed since the version the edit was based on. The
    message is the digest of the file as it is now."""


def digest(data):
    return hashlib.sha256(data).hexdigest()[:32]


def tracked(filename):
    """Whether earlier versions of this file are kept: a plain name (no
    folder) with a source extension."""
    if not filename or "/" in filename or "\\" in filename or filename.startswith("."):
        return False
    return "." in filename and filename.rsplit(".", 1)[-1].lower() in EXTENSIONS


def _dir(pdir, filename):
    return os.path.join(pdir, HISTORY_DIR, filename)


def _lock(pdir, filename):
    if not os.path.isdir(pdir):
        raise FileNotFoundError(f"{pdir}: the exam doesn't exist any more")  # don't bring a deleted exam's folder back
    os.makedirs(os.path.join(pdir, HISTORY_DIR), exist_ok=True)
    return FileLock(os.path.join(pdir, HISTORY_DIR, filename + ".lock"))


def _read_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            v = json.load(f)
        return v if isinstance(v, dict) else None
    except (OSError, ValueError):
        return None


def _write_json(path, value):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(value, f)
    os.replace(tmp, path)


def _new_id(d):
    base = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    vid, n = base, 1
    while os.path.exists(os.path.join(d, vid + ".json")):
        n += 1
        vid = f"{base}-{n}"
    return vid


def _note_current(pdir, filename, data, by, what):
    """Remember how the file as it is now was made, for its history entry
    when it is replaced later."""
    d = _dir(pdir, filename)
    os.makedirs(d, exist_ok=True)
    _write_json(os.path.join(d, "current.json"),
                {"at": int(time.time()), "by": by or None, "what": what, "digest": digest(data)})


def note_current(pdir, filename, by=None, what=""):
    """Record how a file written by other code (a new exam's template) was
    made, so its first history entry says so."""
    path = os.path.join(pdir, filename)
    if not tracked(filename) or not os.path.isfile(path):
        return
    with open(path, "rb") as f:
        _note_current(pdir, filename, f.read(), by, what)


def current_info(pdir, filename):
    """How the file as it is now was made (when, who, what), when it was
    written through here; else "Changed outside the app"."""
    path = os.path.join(pdir, filename)
    if not tracked(filename) or not os.path.isfile(path):
        return None
    with open(path, "rb") as f:
        dg = digest(f.read())
    cur = _read_json(os.path.join(_dir(pdir, filename), "current.json")) or {}
    if cur.get("digest") == dg:
        return {"digest": dg, "at": int(cur.get("at") or 0), "by": cur.get("by"), "what": cur.get("what") or ""}
    return {"digest": dg, "at": int(os.stat(path).st_mtime), "by": None, "what": "Changed outside the app"}


def keep_version(pdir, filename, built_digest=None, deleted=False):
    """Copy the file as it is now into the history. Returns the entry, or
    None when there is nothing to keep (no file, not tracked, or the newest
    version already holds the same text)."""
    path = os.path.join(pdir, filename)
    if not tracked(filename) or not os.path.isfile(path):
        return None
    with open(path, "rb") as f:
        data = f.read()
    if len(data) > MAX_SIZE:
        return None
    d = _dir(pdir, filename)
    os.makedirs(d, exist_ok=True)
    dg = digest(data)
    newest = next(iter(versions(pdir, filename)), None)
    if newest and newest["digest"] == dg and not deleted:
        return newest
    cur = _read_json(os.path.join(d, "current.json")) or {}
    if cur.get("digest") == dg:
        at, by, what = int(cur.get("at") or time.time()), cur.get("by"), cur.get("what") or ""
    else:  # written by something else (the desktop app, a file copy)
        at, by, what = int(os.stat(path).st_mtime), None, "Changed outside the app"
    vid = _new_id(d)
    now = int(time.time())
    # "at" is when this text was written (shown to the teacher); "kept_at"
    # is when it went into the history, which is what pruning goes by, so
    # a file copied in with an old date isn't dropped at once.
    entry = {"id": vid, "file": filename, "at": at, "kept_at": now, "by": by, "what": what,
             "size": len(data), "digest": dg,
             "built": bool(built_digest) and dg == built_digest, "deleted": bool(deleted)}
    if deleted:
        entry["deleted_at"] = now
    with open(os.path.join(d, vid + "." + filename.rsplit(".", 1)[-1].lower()), "wb") as f:
        f.write(data)
    _write_json(os.path.join(d, vid + ".json"), entry)
    prune(pdir, filename)
    return entry


def write_source(pdir, filename, data, by=None, what="Saved", based_on=None, built_digest=None):
    """Write DATA (bytes) to the file, keeping the version it replaces.
    BASED_ON is the digest of the version the change was made from: a
    different file on disk raises Conflict (two tabs, two teachers).
    BUILT_DIGEST is the digest of the version that last built, if any.
    Returns the digest of what is now on disk."""
    if not tracked(filename):
        raise ValueError("Not a source file.")
    path = os.path.join(pdir, filename)
    with _lock(pdir, filename):
        current = None
        if os.path.isfile(path):
            with open(path, "rb") as f:
                current = f.read()
        if based_on and current is not None and digest(current) != based_on:
            raise Conflict(digest(current))
        if current == data:
            return digest(data)  # nothing changed
        if current is not None:
            keep_version(pdir, filename, built_digest=built_digest)
        tmp = path + ".tmp"
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, path)
        _note_current(pdir, filename, data, by, what)
    return digest(data)


def delete_source(pdir, filename, by=None, built_digest=None):
    """Remove the file, keeping it in the history as deleted. Returns the
    history entry, or None for an untracked file (just removed)."""
    path = os.path.join(pdir, filename)
    if not tracked(filename):
        os.unlink(path)
        return None
    with _lock(pdir, filename):
        entry = keep_version(pdir, filename, built_digest=built_digest, deleted=True)
        os.unlink(path)
        d = os.path.join(_dir(pdir, filename), "current.json")
        if os.path.exists(d):
            os.unlink(d)
    return entry


def versions(pdir, filename=None):
    """The versions kept, newest first: of one file, or of every file."""
    root = os.path.join(pdir, HISTORY_DIR)
    if filename is not None:
        names = [filename] if tracked(filename) else []
    else:
        names = sorted(os.listdir(root)) if os.path.isdir(root) else []
    out = []
    for name in names:
        d = _dir(pdir, name)
        if not os.path.isdir(d):
            continue
        for f in os.listdir(d):
            if f.endswith(".json") and f != "current.json":
                e = _read_json(os.path.join(d, f))
                if e and _ID.match(str(e.get("id", ""))) and e.get("file") == name:
                    out.append(e)
    out.sort(key=lambda e: (e.get("at", 0), e["id"]), reverse=True)
    return out


def files_with_history(pdir):
    """Each file that has versions kept: its name, whether it still
    exists, how many versions, and when it was deleted if it was."""
    root = os.path.join(pdir, HISTORY_DIR)
    out = []
    for name in (sorted(os.listdir(root)) if os.path.isdir(root) else []):
        vs = versions(pdir, name)
        if not vs:
            continue
        exists = os.path.isfile(os.path.join(pdir, name))
        out.append({"file": name, "exists": exists, "versions": len(vs),
                    "deleted_at": None if exists else next((v.get("deleted_at") or v["at"] for v in vs if v.get("deleted")), None)})
    return out


def read_version(pdir, filename, vid):
    """The bytes of one version, or None."""
    if not tracked(filename) or not _ID.match(str(vid)):
        return None
    d = _dir(pdir, filename)
    e = _read_json(os.path.join(d, vid + ".json"))
    if not e:
        return None
    try:
        with open(os.path.join(d, vid + "." + filename.rsplit(".", 1)[-1].lower()), "rb") as f:
            return f.read()
    except OSError:
        return None


def entry(pdir, filename, vid):
    if not tracked(filename) or not _ID.match(str(vid)):
        return None
    return _read_json(os.path.join(_dir(pdir, filename), vid + ".json"))


def restore(pdir, filename, vid, by=None, what=None, built_digest=None):
    """Make a kept version the file again (the file as it was is kept).
    Returns the new digest, or None when the version doesn't exist."""
    data = read_version(pdir, filename, vid)
    if data is None:
        return None
    e = entry(pdir, filename, vid) or {}
    label = time.strftime("%Y-%m-%d %H:%M", time.gmtime(e.get("at", 0))) if e.get("at") else vid
    return write_source(pdir, filename, data, by=by, what=what or f"Restored the version of {label} UTC",
                        built_digest=built_digest)


def mark_built(pdir, digests):
    """Mark the versions whose text is what was built (file -> digest)."""
    for name, dg in digests.items():
        for e in versions(pdir, name):
            if e["digest"] == dg and not e.get("built"):
                e["built"] = True
                _write_json(os.path.join(_dir(pdir, name), e["id"] + ".json"), e)


def prune(pdir, filename, now=None):
    """Drop versions older than KEEP_DAYS beyond the newest KEEP_AT_LEAST,
    and any beyond MAX_VERSIONS. The newest version that built, and the
    newest version of a deleted file, are always kept."""
    now = time.time() if now is None else now
    vs = versions(pdir, filename)
    newest_built = next((e["id"] for e in vs if e.get("built")), None)
    newest_deleted = next((e["id"] for e in vs if e.get("deleted")), None)
    d = _dir(pdir, filename)
    for i, e in enumerate(vs):
        if e["id"] in (newest_built, newest_deleted):
            continue
        kept = e.get("kept_at") or e.get("at", 0)
        if i >= MAX_VERSIONS or (i >= KEEP_AT_LEAST and kept < now - KEEP_DAYS * 86400):
            for suffix in (".json", "." + filename.rsplit(".", 1)[-1].lower()):
                try:
                    os.unlink(os.path.join(d, e["id"] + suffix))
                except OSError:
                    pass
