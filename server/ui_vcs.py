"""
Version history of exams, on git, with the trash and the audit log
(doc/question-bank-plan.md, section 6).

One bare git repository per exam, in a folder only the server writes to,
outside the teacher's own folder:

  MC-Projects/_amcweb/<user>/          (single-user mode: _amcweb/_local/)
    history/exams/<uid>.git    the exam's versions
    history/exams/<uid>.json   what git doesn't hold: the folder the exam
                               was last seen in, the versions that built,
                               named versions, and the files' sizes and
                               dates (so unchanged files aren't read again)
    history/exams/<uid>.lock   one writer at a time
    trash/<id>/exam/           a deleted exam, kept TRASH_DAYS days
    trash/<id>/info.json       its name, who deleted it and when
    audit.jsonl                exams created, deleted, restored, unlocked...

The exam's uid is kept in its amcweb.json. Git never works on the exam
folder: the server reads the files itself and hands git their bytes
(fast-import), and reads versions back as bytes (cat-file). So nothing
a teacher puts in the folder (.gitattributes, a .git folder) is read by
git. Git runs without system or user configuration, hooks or network.

Every save is one change set (commit) holding every file it touched:
change() opens one, and writes made inside it (even from nested calls)
join it. A file changed by something else (the desktop app, a file copy)
is committed as "Changed outside the app" before the next change.

Standard library only (plus filelock, which the server already uses), so
the logic tests run without Flask.
"""
import contextlib
import difflib
import hashlib
import json
import logging
import os
import re
import secrets
import shutil
import stat
import subprocess
import threading
import time

from filelock import FileLock

AMCWEB_DIR = "_amcweb"
LOCAL_OWNER = "_local"       # single-user mode (account names can't start with "_")
TRASH_DAYS = 30
MAX_FILE = 10 * 1024 * 1024  # bigger files (a scanned image dropped in the folder) aren't kept
TEXT_EXTENSIONS = ("tex", "latex", "txt", "sty", "cls", "bib", "yml", "yaml", "csv", "json")
IMAGE_EXTENSIONS = ("png", "jpg", "jpeg", "gif", "svg", "eps", "pdf")
NOT_TRACKED = ("amcweb.json", "options.xml", "description.xml")
MADE_BY_AMC = ("DOC-", "amc-compiled", "_latex")
OLD_HISTORY_DIR = ".history"  # the per-file history kept before this module (converted)
RECORD = "amcweb.json"
BRANCH = "refs/heads/main"
OUTSIDE = "Changed outside the app"
UID_RE = re.compile(r"^[0-9a-f]{32}\Z")
COMMIT_RE = re.compile(r"^[0-9a-f]{40}\Z")
TRASH_ID_RE = re.compile(r"^\d{8}-\d{6}-[0-9a-f]{12}\Z")
_OLD_ID = re.compile(r"^\d{8}T\d{6}Z(-\d+)?\Z")
GIT = shutil.which("git") or "/usr/bin/git"
GC_EVERY = 100               # commits between two "git gc --auto"
_log = logging.getLogger("amcweb.history")
_CONFIG = ("-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false",
           "-c", "core.attributesFile=/dev/null", "-c", "core.pager=cat",
           "-c", "core.quotePath=false", "-c", "protocol.allow=never",
           "-c", "safe.directory=*", "-c", "gc.autoDetach=false",
           "-c", "gc.packRefs=false", "-c", "core.logAllRefUpdates=false",
           "-c", "maintenance.auto=false", "-c", "credential.helper=")


class Conflict(Exception):
    """The file changed since the version an edit was based on. The
    message is the digest of the file as it is now."""


class HistoryError(Exception):
    """Git failed, or a version doesn't exist; the message is for the log."""


# ---------------------------------------------------------------- small helpers

def digest(data):
    """The digest the browser saves against (based_on)."""
    return hashlib.sha256(data).hexdigest()[:32]


def blob_id(data):
    """Git's id of a file's bytes, so unchanged files need no git call."""
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def new_uid():
    """A UUIDv7 as 32 hex digits: time-ordered, never reused."""
    b = bytearray(int(time.time() * 1000).to_bytes(6, "big") + secrets.token_bytes(10))
    b[6] = 0x70 | (b[6] & 0x0F)
    b[8] = 0x80 | (b[8] & 0x3F)
    return b.hex()


def tracked(path):
    """Whether versions of this file are kept: a plain name (no folder, no
    dot-file) with a source, class list, design or image extension, and
    not something AMC or the app writes itself."""
    if not isinstance(path, str) or not path or "/" in path or "\\" in path:
        return False
    if path.startswith((".", '"')) or re.search(r"[\x00-\x1f\x7f]", path):
        return False
    if path in NOT_TRACKED or path.startswith(MADE_BY_AMC) or "." not in path:
        return False
    return path.rsplit(".", 1)[-1].lower() in TEXT_EXTENSIONS + IMAGE_EXTENSIONS


def is_text_name(path):
    return "." in path and path.rsplit(".", 1)[-1].lower() in TEXT_EXTENSIONS


def is_exam(pdir):
    return os.path.isfile(os.path.join(pdir, "options.xml"))


def amcweb_dir(pdir, root):
    """The server-only folder of whoever owns the exam folder PDIR, under
    the projects root ROOT (MC-Projects)."""
    owner = os.path.dirname(os.path.abspath(pdir))
    root = os.path.abspath(root)
    if owner == root:
        sub = LOCAL_OWNER
    else:
        sub = os.path.relpath(owner, root)
        if sub in (".", "..", AMCWEB_DIR) or sub.startswith(".") or os.sep in sub:
            raise HistoryError(f"{pdir} isn't an exam folder")
    return os.path.join(root, AMCWEB_DIR, sub)


def _read_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            v = json.load(f)
        return v if isinstance(v, dict) else None
    except (OSError, ValueError):
        return None


def _write_json(path, value):
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(value, f, ensure_ascii=False)
    os.replace(tmp, path)


def _atomic_write(path, data):
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path)


_locks = {}


def _lock(path):
    """One FileLock object per lock file: reentrant in the same request
    (gevent: per greenlet), exclusive between requests and processes."""
    lk = _locks.get(path)
    if lk is None:
        lk = _locks[path] = FileLock(path, timeout=60)
    return lk


def read_uid(pdir):
    rec = _read_json(os.path.join(pdir, RECORD)) or {}
    uid = rec.get("uid")
    return uid if isinstance(uid, str) and UID_RE.match(uid) else None


def write_uid(pdir, uid=None, unless=None):
    """Set the exam's uid in its amcweb.json (a new one when UID is None),
    under the same lock as the app's other changes to that file. UNLESS:
    keep a valid uid already there that isn't this one (so two requests
    giving an exam its uid at once agree). Returns the uid now there;
    uid=False drops it."""
    path = os.path.join(pdir, RECORD)
    if not is_exam(pdir):
        raise FileNotFoundError(f"{pdir}: the exam doesn't exist any more")
    with FileLock(path + ".lock"):
        rec = {}
        if os.path.exists(path):
            rec = _read_json(path)
            if rec is None:  # damaged: keep it for a look, as ui.read_record does
                os.replace(path, path + ".corrupt")
                rec = {}
        have = rec.get("uid") if isinstance(rec.get("uid"), str) and UID_RE.match(rec.get("uid")) else None
        if unless is not None and have and have != unless:
            return have
        if uid is False:
            rec.pop("uid", None)
        else:
            rec["uid"] = uid or new_uid()
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(rec, f, indent=1)
        os.replace(tmp, path)
        return rec.get("uid")


# ---------------------------------------------------------------- git

def _env():
    return {"PATH": os.environ.get("PATH") or "/usr/local/bin:/usr/bin:/bin", "HOME": os.devnull,
            "LC_ALL": "C", "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_TERMINAL_PROMPT": "0", "GIT_ATTR_NOSYSTEM": "1", "GIT_LITERAL_PATHSPECS": "1",
            "GIT_OPTIONAL_LOCKS": "0", "GIT_NO_REPLACE_OBJECTS": "1", "GIT_PAGER": "cat"}


def _git(git_dir, *args, data=None, ok=(0,)):
    p = subprocess.run([GIT, "--git-dir", git_dir, *_CONFIG, *args], input=data,
                       capture_output=True, env=_env(), timeout=300)
    if p.returncode not in ok:
        raise HistoryError(f"git {args[0]} failed ({p.returncode}): "
                           + p.stderr.decode("utf-8", "replace").strip()[:600])
    return p


def _clean(v):
    return re.sub(r"[\x00-\x1f\x7f]", "", str(v))


def _person(by):
    name = re.sub(r"[<>\x00-\x1f\x7f]", "", str(by or "")).strip() or "unknown"
    return f"{name} <{re.sub(r'[^A-Za-z0-9._-]', '_', name)}@amcweb>"


def _trailers(body):
    """The Amcweb-* lines at the end of a commit message, and the message
    without them."""
    lines = body.rstrip("\n").split("\n")
    out = {}
    while lines and (m := re.match(r"^Amcweb-([A-Za-z-]+): ?(.*)$", lines[-1])):
        out[m.group(1).lower()] = m.group(2)
        lines.pop()
    while lines and not lines[-1].strip():
        lines.pop()
    return "\n".join(lines), out


# ---------------------------------------------------------------- one exam's history

class Repo:
    """The history of the exam at PDIR (ROOT: the projects root)."""

    def __init__(self, pdir, root):
        self.pdir = os.path.abspath(pdir)
        self.root = os.path.abspath(root)
        self.home = amcweb_dir(self.pdir, self.root)
        self.dir = os.path.join(self.home, "history", "exams")
        self.uid = None
        self.meta = None
        self._data = {}  # bytes read from disk during this request, by path

    # -- where things are
    @property
    def git_dir(self):
        return os.path.join(self.dir, self.uid + ".git")

    @property
    def meta_path(self):
        return os.path.join(self.dir, self.uid + ".json")

    @property
    def lock(self):
        return _lock(os.path.join(self.dir, self.uid + ".lock"))

    # -- opening
    def open(self, by=None, first_what=None, first_kind="start"):
        """Find (or start) the exam's history. A new history first takes in
        the old per-file history (.history/), then the files as they are,
        as FIRST_WHAT. An exam copied outside the app (same uid as an exam
        that still exists elsewhere) gets a new uid and its own history."""
        if not is_exam(self.pdir):
            raise FileNotFoundError(f"{self.pdir}: the exam doesn't exist any more")
        os.makedirs(self.dir, exist_ok=True)
        uid = read_uid(self.pdir)
        copy_of = None
        if uid:
            meta = _read_json(os.path.join(self.dir, uid + ".json"))
            folder = (meta or {}).get("folder")
            if folder and folder != self.pdir and is_exam(folder) and read_uid(folder) == uid:
                copy_of = os.path.basename(folder)
        if copy_of:
            uid = write_uid(self.pdir, unless=read_uid(self.pdir))
        elif not uid:
            uid = write_uid(self.pdir, unless="")
        self.uid = uid
        with self.lock:
            if not os.path.isdir(self.git_dir):
                what = first_what or (f"Copy of \"{copy_of}\" made outside the app" if copy_of else "History started")
                self._create(by, what, "copy" if copy_of else first_kind)
            else:
                self._load()
                if self.meta.get("folder") != self.pdir:
                    self.meta["folder"] = self.pdir  # renamed, moved, back from the trash
                    self.meta["name"] = os.path.basename(self.pdir)
                    self._save_meta()
        return self

    def _head_ref(self):
        try:
            with open(os.path.join(self.git_dir, *BRANCH.split("/")), encoding="ascii") as f:
                h = f.read().strip()
            return h if COMMIT_RE.match(h) else None
        except OSError:
            return None

    def _load(self):
        self.meta = _read_json(self.meta_path) or {}
        head = self._head_ref()
        if head and head == self.meta.get("head") and isinstance(self.meta.get("tree"), dict):
            return
        # The cache doesn't match the repository (first use, a crash between
        # the commit and the cache): read the tree from git, or start again
        # from the files when the repository is damaged.
        try:
            if head is None:
                raise HistoryError("no branch")
            _git(self.git_dir, "cat-file", "-e", head + "^{commit}")
            self.meta["head"] = head
            self.meta["tree"] = self.tree_at(head)
            self.meta.setdefault("stat", {})
            self._save_meta()
        except HistoryError as e:
            aside = os.path.join(self.dir, f"{self.uid}.damaged-{int(time.time())}.git")
            os.replace(self.git_dir, aside)
            audit(self.home, None, "history restarted", exam=os.path.basename(self.pdir), uid=self.uid,
                  reason=str(e)[:300], kept_as=os.path.basename(aside))
            self._create(None, "History restarted from the files (the earlier history was damaged and kept aside)", "start")

    def _create(self, by, what, kind):
        tmp = self.git_dir + ".new"
        shutil.rmtree(tmp, ignore_errors=True)
        subprocess.run([GIT, *_CONFIG, "init", "-q", "--bare", "--initial-branch=main", tmp],
                       check=True, capture_output=True, env=_env(), timeout=60)
        os.replace(tmp, self.git_dir)
        old = self.meta or {}
        self.meta = {"uid": self.uid, "folder": self.pdir, "name": os.path.basename(self.pdir),
                     "created": int(time.time()), "head": None, "tree": {}, "stat": {},
                     "built": old.get("built", []), "names": old.get("names", []), "since_gc": 0}
        self._save_meta()
        by = None if kind == "start" else by  # the files as they were found aren't the work of whoever looked
        if self._convert_old_history():
            self._record_outside()
        elif self._record_outside(by=by, what=what, kind=kind) is None:
            self._commit([({}, by, what, kind, None, {})], allow_empty=True)

    def _save_meta(self):
        _write_json(self.meta_path, self.meta)

    # -- the files on disk
    def _disk(self):
        """The tracked files on disk: {path: blob id}, None for a file too
        big to keep. Files whose size and date haven't changed aren't read."""
        out = {}
        cache = self.meta.setdefault("stat", {})
        try:
            names = os.listdir(self.pdir)
        except OSError:
            names = []
        for name in names:
            if not tracked(name):
                continue
            path = os.path.join(self.pdir, name)
            try:
                st = os.lstat(path)
            except OSError:
                continue
            if not stat.S_ISREG(st.st_mode):
                continue
            if st.st_size > MAX_FILE:
                out[name] = None
                continue
            c = cache.get(name)
            if c and c[0] == st.st_size and c[1] == st.st_mtime_ns:
                out[name] = c[2]
                continue
            try:
                with open(path, "rb") as f:
                    data = f.read()
            except OSError:
                continue
            if len(data) > MAX_FILE:
                out[name] = None
                continue
            self._data[name] = data
            out[name] = blob_id(data)
            cache[name] = [st.st_size, st.st_mtime_ns, out[name]]
            self._stat_changed = True
        for name in list(cache):
            if name not in out:
                del cache[name]
                self._stat_changed = True
        return out

    def _note_written(self, path, data):
        try:
            st = os.lstat(os.path.join(self.pdir, path))
            self.meta.setdefault("stat", {})[path] = [st.st_size, st.st_mtime_ns, blob_id(data)]
        except OSError:
            pass

    def _disk_bytes(self, path):
        if path in self._data:
            return self._data[path]
        try:
            with open(os.path.join(self.pdir, path), "rb") as f:
                return f.read()
        except OSError:
            return None

    def _record_outside(self, by=None, what=OUTSIDE, kind="outside"):
        """Commit what changed on disk since the last version. Returns the
        new commit, or None when nothing changed."""
        disk = self._disk()
        tree = self.meta.get("tree") or {}
        changes, newest = {}, 0
        for path, b in disk.items():
            if b is not None and tree.get(path) != b:
                data = self._disk_bytes(path)
                if data is None:
                    continue
                changes[path] = data
                try:
                    newest = max(newest, int(os.stat(os.path.join(self.pdir, path)).st_mtime))
                except OSError:
                    pass
        for path in tree:
            if path not in disk:
                changes[path] = None
        if not changes:
            if getattr(self, "_stat_changed", False):
                self._stat_changed = False
                self._save_meta()  # files read again (touched, same text): remember their dates
            return None
        at = newest if kind == "outside" and newest else None
        return self._commit([(changes, by, what, kind, at, {})])

    def record_outside(self):
        with self.lock:
            self._load()
            return self._record_outside()

    # -- committing
    def _commit(self, commits, allow_empty=False):
        """Commit a list of (changes, by, what, kind, at, extra trailers),
        in order, in one git process. CHANGES maps a path to its bytes, or
        None to remove it. Returns the last commit's id."""
        stream = bytearray()
        parent = self.meta.get("head")
        tree = dict(self.meta.get("tree") or {})
        made = 0
        self._made = []
        now = int(time.time())
        for changes, by, what, kind, at, extra in commits:
            changes = {p: d for p, d in changes.items()
                       if (d is None and p in tree) or (d is not None and tree.get(p) != blob_id(d))}
            self._made.append(bool(changes) or allow_empty)
            if not changes and not allow_empty:
                continue
            msg = (str(what or "Saved").strip() or "Saved") + "\n\n" + f"Amcweb-Kind: {kind}\n"
            if by:
                msg += f"Amcweb-By: {_clean(by)}\n"
            for k, v in (extra or {}).items():
                msg += f"Amcweb-{k}: {_clean(v)}\n"
            body = msg.encode("utf-8")
            person = _person(by).encode("utf-8")
            stream += b"commit " + BRANCH.encode() + b"\n"
            stream += b"author %s %d +0000\n" % (person, int(at or now))
            stream += b"committer %s %d +0000\n" % (person, now)
            stream += b"data %d\n%s\n" % (len(body), body)
            if parent and not made:
                stream += b"from %s\n" % parent.encode()
            for path in sorted(changes):
                data = changes[path]
                if data is None:
                    stream += b"D " + path.encode("utf-8") + b"\n"
                    tree.pop(path, None)
                else:
                    stream += b"M 100644 inline " + path.encode("utf-8") + b"\n"
                    stream += b"data %d\n" % len(data) + data + b"\n"
                    tree[path] = blob_id(data)
            made += 1
        if not made:
            return None
        stream += b"done\n"
        _git(self.git_dir, "fast-import", "--quiet", "--done", data=bytes(stream))
        head = self._head_ref()
        if not head:
            raise HistoryError("fast-import left no branch")
        self.meta["head"] = head
        self.meta["tree"] = tree
        self.meta["since_gc"] = int(self.meta.get("since_gc") or 0) + made
        if self.meta["since_gc"] >= GC_EVERY:
            self.meta["since_gc"] = 0
            try:
                _git(self.git_dir, "gc", "--auto", "--quiet")
            except (HistoryError, subprocess.TimeoutExpired):
                pass
        self._save_meta()
        return head

    # -- reading
    def check_commit(self, cid):
        """CID if it is a version of this exam, else None."""
        if not isinstance(cid, str) or not COMMIT_RE.match(cid):
            return None
        p = _git(self.git_dir, "merge-base", "--is-ancestor", cid, BRANCH, ok=(0, 1, 128))
        return cid if p.returncode == 0 else None

    def is_ancestor(self, a, b):
        return _git(self.git_dir, "merge-base", "--is-ancestor", a, b, ok=(0, 1)).returncode == 0

    def tree_at(self, cid):
        """{path: blob id} of a version."""
        out = {}
        raw = _git(self.git_dir, "ls-tree", "-r", "-z", "--full-tree", cid).stdout
        for rec in raw.split(b"\0"):
            if not rec:
                continue
            info, _, path = rec.partition(b"\t")
            parts = info.split()
            if len(parts) == 3 and parts[1] == b"blob":
                out[path.decode("utf-8", "surrogateescape")] = parts[2].decode()
        return out

    def blob(self, bid):
        if not bid:
            return None
        return _git(self.git_dir, "cat-file", "blob", bid).stdout

    def read(self, cid, path):
        """The bytes of PATH in version CID, or None."""
        if not tracked(path):
            return None
        bid = self.tree_at(cid).get(path)
        return self.blob(bid) if bid else None

    def head(self):
        return self.meta.get("head")

    def log(self, path=None, limit=100, skip=0):
        """Versions, newest first: [entry], and how many there are in all."""
        args = ["log", "-z", "--format=%H%x1f%P%x1f%at%x1f%B", f"--max-count={int(limit)}", f"--skip={int(skip)}", BRANCH]
        count = ["rev-list", "--count", BRANCH]
        if path:
            args += ["--", path]
            count += ["--", path]
        raw = _git(self.git_dir, *args).stdout.decode("utf-8", "replace")
        entries = []
        for rec in raw.split("\0"):
            if not rec.strip():
                continue
            parts = rec.split("\x1f", 3)
            if len(parts) < 4:
                continue
            cid, parents, at, body = parts
            what, tr = _trailers(body)
            entries.append({"id": cid, "parent": (parents.split() or [None])[0], "at": int(at or 0),
                            "by": tr.get("by") or None, "what": what or "Saved", "kind": tr.get("kind") or "save",
                            "restores": tr.get("restores"), "undoes": tr.get("undoes"), "files": []})
        if entries:
            out = _git(self.git_dir, "diff-tree", "--root", "-r", "-z", "--no-renames", "--name-status", "--stdin",
                       data="\n".join(e["id"] for e in entries).encode() + b"\n").stdout
            by_id = {e["id"]: e for e in entries}
            toks = out.split(b"\0")
            cur, i = None, 0
            while i < len(toks):
                t = toks[i].decode("utf-8", "surrogateescape")
                if t in by_id:
                    cur = by_id[t]
                elif cur is not None and t and len(t) <= 2 and t[0] in "AMDT" and i + 1 < len(toks):
                    cur["files"].append({"file": toks[i + 1].decode("utf-8", "surrogateescape"),
                                         "status": {"A": "added", "D": "removed"}.get(t[0], "changed")})
                    i += 1
                i += 1
        built = set(self.meta.get("built") or [])
        names = self.meta.get("names") or []
        for e in entries:
            e["built"] = e["id"] in built
            e["names"] = [n for n in names if n.get("id") == e["id"]]
        total = int(_git(self.git_dir, *count).stdout.strip() or 0)
        return entries, total

    def entry(self, cid):
        """One version, with the files it changed."""
        return self._log_from(cid)[0]

    def _log_from(self, cid):
        raw = _git(self.git_dir, "log", "-z", "--format=%H%x1f%P%x1f%at%x1f%B", "--max-count=1", cid).stdout
        rec = raw.decode("utf-8", "replace").split("\0")[0]
        parts = rec.split("\x1f", 3)
        if len(parts) < 4:
            return None, 0
        what, tr = _trailers(parts[3])
        e = {"id": parts[0], "parent": (parts[1].split() or [None])[0], "at": int(parts[2] or 0),
             "by": tr.get("by") or None, "what": what or "Saved", "kind": tr.get("kind") or "save",
             "restores": tr.get("restores"), "undoes": tr.get("undoes"), "files": []}
        e["built"] = e["id"] in set(self.meta.get("built") or [])
        e["names"] = [n for n in self.meta.get("names") or [] if n.get("id") == e["id"]]
        before = self.tree_at(e["parent"]) if e["parent"] else {}
        after = self.tree_at(e["id"])
        for path in sorted(set(before) | set(after)):
            if before.get(path) != after.get(path):
                e["files"].append({"file": path, "status": "added" if path not in before
                                   else "removed" if path not in after else "changed"})
        return e, 1

    def files(self):
        """Every file that has a history: whether it exists now, and when it
        was removed if it doesn't."""
        raw = _git(self.git_dir, "log", "-z", "--format=%x1e%at", "--name-status", "--no-renames", BRANCH).stdout
        seen = {}
        at = 0
        toks = raw.split(b"\0")
        i = 0
        while i < len(toks):
            t = toks[i].decode("utf-8", "surrogateescape").strip("\n")
            if t.startswith("\x1e"):
                head, _, rest = t[1:].partition("\n")
                at = int(head or 0)
                t = rest.strip("\n")
            if t and len(t) <= 2 and t[0] in "AMDT" and i + 1 < len(toks):
                path = toks[i + 1].decode("utf-8", "surrogateescape")
                if path not in seen:
                    seen[path] = at if t[0] == "D" else None
                i += 1
            i += 1
        disk = set(self.meta.get("tree") or {})
        return [{"file": p, "exists": p in disk, "deleted_at": None if p in disk else seen[p]}
                for p in sorted(seen)]

    # -- marks and names
    def mark_built(self, cid):
        with self.lock:
            self._load()
            built = [c for c in self.meta.get("built") or [] if c != cid] + [cid]
            self.meta["built"] = built[-500:]
            self.meta["last_built"] = cid
            self._save_meta()

    def last_built(self):
        return self.meta.get("last_built")

    def name_version(self, cid, name, by=None, auto=False):
        name = re.sub(r"[\x00-\x1f\x7f]", "", str(name or "")).strip()[:80]
        if not name:
            return
        with self.lock:
            self._load()
            names = [n for n in self.meta.get("names") or [] if not (n.get("id") == cid and n.get("name") == name)]
            names.append({"id": cid, "name": name, "by": by, "at": int(time.time()), "auto": bool(auto)})
            self.meta["names"] = names[-1000:]
            self._save_meta()

    def unname_version(self, cid, name):
        with self.lock:
            self._load()
            self.meta["names"] = [n for n in self.meta.get("names") or []
                                  if not (n.get("id") == cid and n.get("name") == name)]
            self._save_meta()

    # -- restoring
    def disk_state(self):
        """{path: blob id} of the tracked files on disk now, which are first
        committed if they changed outside the app (so every blob is in the
        repository)."""
        with self.lock:
            self._load()
            self._record_outside()
            return dict(self.meta.get("tree") or {})

    def plan_exam(self, cid):
        """The writes that bring every tracked file back to version CID:
        {path: bytes, or None to remove}."""
        target = self.tree_at(cid)
        now = self.disk_state()
        plan = {}
        for path in sorted(set(target) | set(now)):
            if target.get(path) != now.get(path):
                plan[path] = self.blob(target[path]) if path in target else None
        return plan

    def plan_file(self, cid, path):
        target = self.tree_at(cid).get(path)
        now = self.disk_state().get(path)
        if target == now:
            return {}
        return {path: self.blob(target) if target else None}

    def plan_undo(self, cid):
        """The writes that take back only the change made in version CID,
        and the files where that can't be done because they were changed
        again since: (plan, [(path, why)])."""
        e, _ = self._log_from(cid)
        after = self.tree_at(cid)
        before = self.tree_at(e["parent"]) if e and e["parent"] else {}
        now = self.disk_state()
        plan, problems = {}, []
        for path in sorted(set(before) | set(after)):
            b, a, n = before.get(path), after.get(path), now.get(path)
            if a == b:
                continue
            if n == a:
                plan[path] = self.blob(b) if b else None
            elif n == b:
                continue  # already back as it was
            elif a and b and n and is_text_name(path):
                merged = self._merge(n, a, b)
                if merged is None:
                    problems.append((path, "it was changed again since, in the same places"))
                else:
                    plan[path] = merged
            else:
                problems.append((path, "it was changed again since" if n else "it was removed since"))
        return plan, problems

    def _merge(self, ours, base, theirs):
        """Three-way merge of blobs: the file now, with the change from BASE
        to THEIRS applied. None when they overlap."""
        p = _git(self.git_dir, "merge-file", "-p", "--object-id", ours, base, theirs, ok=tuple(range(0, 128)))
        return p.stdout if p.returncode == 0 else None

    def apply(self, plan, by, what, kind, extra=None, based_on=None):
        """Write a plan as one version. BASED_ON (path -> blob id on disk
        when the plan was made) refuses the whole plan if any file changed
        meanwhile. Returns the new commit, or None when nothing changed."""
        with change(self.pdir, self.root, by=by, what=what, kind=kind, extra=extra) as cs:
            if based_on is not None:
                now = {p: b for p, b in cs.repo._disk().items() if b}
                for path in plan:
                    if now.get(path) != based_on.get(path):
                        raise Conflict(path)
            for path, data in plan.items():
                if data is None:
                    cs.delete(path)
                else:
                    cs.write(path, data)
        return cs.commit_id

    # -- old history (.history/, before this module)
    def _convert_old_history(self):
        root = os.path.join(self.pdir, OLD_HISTORY_DIR)
        if not os.path.isdir(root) or os.path.islink(root):
            return False
        events = []  # (at, seq, path, data or None, by, what, built)
        seq = 0
        current = {}
        for name in sorted(os.listdir(root)):
            d = os.path.join(root, name)
            if not tracked(name) or not os.path.isdir(d) or os.path.islink(d):
                continue
            current[name] = _read_json(os.path.join(d, "current.json")) or {}
            ext = name.rsplit(".", 1)[-1].lower()
            for f in os.listdir(d):
                if not f.endswith(".json") or f == "current.json":
                    continue
                e = _read_json(os.path.join(d, f))
                if not e or not _OLD_ID.match(str(e.get("id", ""))) or e.get("file") != name:
                    continue
                try:
                    with open(os.path.join(d, e["id"] + "." + ext), "rb") as fh:
                        data = fh.read()
                except OSError:
                    continue
                at = int(e.get("at") or 0)
                seq += 1
                events.append((at, seq, name, data, e.get("by"), e.get("what") or "Saved", bool(e.get("built"))))
                if e.get("deleted"):
                    seq += 1
                    events.append((int(e.get("deleted_at") or at), seq, name, None, None, f"File deleted: {name}", False))
        # The files as they are now, when the old history says how they were
        # made, take their place in time (after their own earlier versions).
        for path, cur in current.items():
            data = self._disk_bytes(path) if tracked(path) else None
            if data is not None and len(data) <= MAX_FILE and cur.get("digest") == digest(data):
                seq += 1
                events.append((int(cur.get("at") or 0), seq, path, data, cur.get("by"), cur.get("what") or "Saved", False))
        events.sort(key=lambda x: (x[0], x[1]))
        # Versions written together (a builder save wrote paper.json and its
        # layout in the same second, by the same person) become one.
        commits, built_marks = [], []
        for at, _, path, data, by, what, built in events:
            last = commits[-1] if commits else None
            if last and abs(last[4] - at) <= 2 and last[1] == by and last[2] == what and path not in last[0]:
                last[0][path] = data
                last[6] = last[6] or built
            else:
                commits.append([{path: data}, by, what, "converted", at, {}, built])
        if commits and self._commit([tuple(c[:6]) for c in commits]):
            ids = _git(self.git_dir, "rev-list", "--reverse", BRANCH).stdout.decode().split()
            made = iter(ids)
            for c, was_made in zip(commits, self._made):
                cid = next(made, None) if was_made else None
                if c[6] and cid:
                    built_marks.append(cid)
        # Files the old history never kept (they came with the template).
        tree = self.meta.get("tree") or {}
        fresh = {p: self._disk_bytes(p) for p, b in self._disk().items() if b and p not in tree}
        if fresh:
            self._commit([(fresh, None, "History started (files the old history didn't keep)", "start", None, {})])
        self.meta["built"] = (self.meta.get("built") or []) + built_marks
        self._save_meta()
        shutil.rmtree(root, ignore_errors=True)
        audit(self.home, None, "old history converted", exam=os.path.basename(self.pdir), uid=self.uid,
              versions=len(commits))
        return bool(commits)


# ---------------------------------------------------------------- change sets

_active = threading.local()


class ChangeSet:
    """The writes of one save, committed together when it closes. With no
    repository (git failed), the files are still written: saving the
    teacher's work matters more than recording it, and the next save that
    works records it as changed outside the app."""

    def __init__(self, repo, by, what, kind, extra, pdir=None):
        self.repo, self.by, self.what, self.kind, self.extra = repo, by, what, kind, dict(extra or {})
        self.pdir = repo.pdir if repo else os.path.abspath(pdir)
        self.changes = {}
        self.commit_id = None

    def _path(self, path):
        if not tracked(path):
            raise ValueError(f"{path}: no history is kept for this file")
        return os.path.join(self.pdir, path)

    def write(self, path, data, based_on=None):
        """Write DATA (bytes). BASED_ON is the digest of the file the edit
        was made from: a different file on disk raises Conflict."""
        full = self._path(path)
        if not os.path.isdir(self.pdir):
            raise FileNotFoundError(f"{self.pdir}: the exam doesn't exist any more")
        try:
            with open(full, "rb") as f:
                current = f.read()
        except FileNotFoundError:
            current = None
        if based_on and current is not None and digest(current) != based_on:
            raise Conflict(digest(current))
        if current == data:
            return digest(data)
        _atomic_write(full, data)
        if len(data) <= MAX_FILE and self.repo:
            self.changes[path] = data
            self.repo._note_written(path, data)
        return digest(data)

    def delete(self, path, based_on=None):
        full = self._path(path)
        if based_on:
            with open(full, "rb") as f:
                if digest(f.read()) != based_on:
                    raise Conflict(path)
        os.unlink(full)
        if self.repo:
            self.changes[path] = None
            self.repo.meta.get("stat", {}).pop(path, None)

    def commit(self):
        if self.changes and self.repo:
            try:
                self.commit_id = self.repo._commit([(self.changes, self.by, self.what, self.kind, None, self.extra)])
            except (HistoryError, OSError, subprocess.TimeoutExpired) as e:
                _log.error(f"{self.pdir}: \"{self.what}\" was saved but not kept in the history ({e}); "
                           "the next change keeps it as changed outside the app")
        return self.commit_id


@contextlib.contextmanager
def change(pdir, root, by=None, what="Saved", kind="save", extra=None):
    """One version for every write made inside (also by nested calls for
    the same exam). Changes made outside the app since the last version
    are committed first, as their own version."""
    key = os.path.abspath(pdir)
    sets = getattr(_active, "sets", None)
    if sets is None:
        sets = _active.sets = {}
    if key in sets:
        yield sets[key]
        return
    try:
        repo = Repo(pdir, root).open(by=by)
    except (HistoryError, subprocess.SubprocessError) as e:
        _log.error(f"{pdir}: the history can't be opened ({e}); saving without it")
        cs = sets[key] = ChangeSet(None, by, what, kind, extra, pdir=pdir)
        try:
            yield cs
        finally:
            del sets[key]
        return
    with repo.lock:
        repo._load()
        repo._record_outside()
        cs = ChangeSet(repo, by, what, kind, extra)
        sets[key] = cs
        try:
            yield cs
        finally:
            del sets[key]
            cs.commit()


def write(pdir, root, path, data, by=None, what="Saved", based_on=None):
    """Write one file as its own version (or as part of the change set
    open for this exam). Returns the digest of what is on disk."""
    with change(pdir, root, by=by, what=what) as cs:
        return cs.write(path, data, based_on=based_on)


def delete(pdir, root, path, by=None, what=None):
    with change(pdir, root, by=by, what=what or f"File deleted: {path}", kind="delete") as cs:
        cs.delete(path)


def snapshot(pdir, root, by=None, what=OUTSIDE, kind="outside"):
    """Commit whatever changed on disk; returns the newest version's id."""
    repo = Repo(pdir, root).open(by=by, first_what=what if kind != "outside" else None,
                                 first_kind=kind if kind != "outside" else "start")
    with repo.lock:
        repo._load()
        repo._record_outside(by=by, what=what, kind=kind)
        return repo.head()


def start_copy(pdir, root, by, source_name):
    """A copy made in the app: a new uid and a history of its own, whose
    first version says where it came from."""
    shutil.rmtree(os.path.join(pdir, OLD_HISTORY_DIR), ignore_errors=True)
    write_uid(pdir, False)
    repo = Repo(pdir, root).open(by=by, first_what=f"Copied from \"{source_name}\"", first_kind="copy")
    audit(repo.home, by, "exam copied", exam=os.path.basename(pdir), source=source_name, uid=repo.uid)
    return repo


# ---------------------------------------------------------------- comparing

_WORD = re.compile(r"\s+|\w+|[^\w\s]", re.UNICODE)
MAX_DIFF_LINES = 20000


def _is_binary(data, path):
    return data is not None and (not is_text_name(path) or b"\0" in data[:8192])


def _split(text):
    lines = text.split("\n")
    if len(lines) > 1 and lines[-1] == "":
        lines.pop()
    return lines


def _words(a, b):
    """Word-level segments of two versions of a line: [[changed, text]]."""
    ta, tb = _WORD.findall(a), _WORD.findall(b)
    sm = difflib.SequenceMatcher(None, ta, tb, autojunk=False)
    if sm.ratio() < 0.3:
        return None, None
    sa, sb = [], []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if i2 > i1:
            sa.append([0 if tag == "equal" else 1, "".join(ta[i1:i2])])
        if j2 > j1:
            sb.append([0 if tag == "equal" else 1, "".join(tb[j1:j2])])
    return sa, sb


def text_diff(a, b, context=3):
    """Line diff of two texts, with word-level changes inside changed
    lines: rows ["c", line] (same), ["d", line, words] (only in A),
    ["a", line, words] (only in B), ["g", n] (n unchanged lines folded),
    and the numbers of lines added and removed."""
    A, B = _split(a), _split(b)
    if len(A) + len(B) > MAX_DIFF_LINES:
        return {"too_big": True, "added": None, "removed": None, "rows": []}
    sm = difflib.SequenceMatcher(None, A, B, autojunk=len(A) * len(B) > 4_000_000)
    rows, added, removed = [], 0, 0
    ops = sm.get_opcodes()
    for k, (tag, i1, i2, j1, j2) in enumerate(ops):
        if tag == "equal":
            run = A[i1:i2]
            head = 0 if k == 0 else context
            tail = 0 if k == len(ops) - 1 else context
            if len(run) > head + tail + 1:
                rows += [["c", x] for x in run[:head]] + [["g", len(run) - head - tail]] + [["c", x] for x in run[len(run) - tail:]]
            else:
                rows += [["c", x] for x in run]
            continue
        dels, adds = A[i1:i2], B[j1:j2]
        removed += len(dels)
        added += len(adds)
        pairs = min(len(dels), len(adds)) if tag == "replace" else 0
        wd, wa = [], []
        for i in range(pairs):
            x, y = _words(dels[i], adds[i]) if len(dels[i]) + len(adds[i]) < 4000 else (None, None)
            wd.append(x)
            wa.append(y)
        rows += [["d", x, wd[i] if i < pairs else None] for i, x in enumerate(dels)]
        rows += [["a", y, wa[i] if i < pairs else None] for i, y in enumerate(adds)]
    return {"too_big": False, "added": added, "removed": removed, "rows": rows}


def file_diff(path, old, new):
    """What changed in one file between two versions (bytes or None)."""
    out = {"file": path, "status": "added" if old is None else "removed" if new is None else "changed",
           "old_size": None if old is None else len(old), "new_size": None if new is None else len(new)}
    if _is_binary(old, path) or _is_binary(new, path):
        out["binary"] = True
        return out
    out["binary"] = False
    out.update(text_diff((old or b"").decode("utf-8", "replace"), (new or b"").decode("utf-8", "replace")))
    return out


# ---------------------------------------------------------------- trash

def _size(path):
    total = 0
    for d, _, files in os.walk(path):
        for f in files:
            try:
                total += os.lstat(os.path.join(d, f)).st_size
            except OSError:
                pass
    return total


def trash_exam(pdir, root, by=None):
    """Move the exam to its owner's trash (its history stays). Returns the
    trash entry."""
    repo = Repo(pdir, root).open(by=by)
    name = os.path.basename(repo.pdir)
    with repo.lock:
        repo._load()
        repo._record_outside()
        tid = time.strftime("%Y%m%d-%H%M%S", time.gmtime()) + "-" + repo.uid[:12]
        dest = os.path.join(repo.home, "trash", tid)
        os.makedirs(dest)
        info = {"id": tid, "name": name, "uid": repo.uid, "deleted_at": int(time.time()), "by": by,
                "size": _size(repo.pdir)}
        _write_json(os.path.join(dest, "info.json"), info)
        try:
            shutil.move(repo.pdir, os.path.join(dest, "exam"))
        except OSError:
            shutil.rmtree(dest, ignore_errors=True)
            raise
        repo.meta["folder"] = os.path.join(dest, "exam")
        repo._save_meta()
    audit(repo.home, by, "exam deleted (moved to the trash)", exam=name, uid=repo.uid, trash=tid)
    purge_trash(repo.home)
    return info


def list_trash(home, now=None):
    """The exams in the trash, newest first, with the days they have left."""
    purge_trash(home, now=now)
    now = now or time.time()
    out = []
    d = os.path.join(home, "trash")
    for tid in (os.listdir(d) if os.path.isdir(d) else []):
        info = _read_json(os.path.join(d, tid, "info.json"))
        if not info or not TRASH_ID_RE.match(tid) or not os.path.isdir(os.path.join(d, tid, "exam")):
            continue
        info["id"] = tid
        info["days_left"] = max(0, -int(-(info.get("deleted_at", 0) + TRASH_DAYS * 86400 - now) // 86400))
        out.append(info)
    return sorted(out, key=lambda x: x.get("deleted_at", 0), reverse=True)


def _free_name(projects_dir, name):
    if not os.path.exists(os.path.join(projects_dir, name)):
        return name
    n = 1
    while True:
        cand = f"{name} (restored)" if n == 1 else f"{name} (restored {n})"
        if not os.path.exists(os.path.join(projects_dir, cand)):
            return cand
        n += 1


def restore_trash(home, tid, projects_dir, by=None):
    """Put an exam back, under its name or a free one. Returns the name."""
    if not isinstance(tid, str) or not TRASH_ID_RE.match(tid):
        raise HistoryError("No such exam in the trash.")
    d = os.path.join(home, "trash", tid)
    info = _read_json(os.path.join(d, "info.json"))
    if not info or not os.path.isdir(os.path.join(d, "exam")):
        raise HistoryError("No such exam in the trash.")
    name = str(info.get("name") or "Restored exam")
    if name.startswith((".", "_", "-")) or "/" in name or "\\" in name:
        name = "Restored exam"
    name = _free_name(projects_dir, name)
    shutil.move(os.path.join(d, "exam"), os.path.join(projects_dir, name))
    shutil.rmtree(d, ignore_errors=True)
    audit(home, by, "exam restored from the trash", exam=name, uid=info.get("uid"), trash=tid)
    return name


def _drop_history(home, uid):
    """Remove the history of UID unless an exam still uses it."""
    if not isinstance(uid, str) or not UID_RE.match(uid):
        return
    hdir = os.path.join(home, "history", "exams")
    meta = _read_json(os.path.join(hdir, uid + ".json")) or {}
    folder = meta.get("folder")
    if folder and is_exam(folder) and read_uid(folder) == uid and "/trash/" not in folder.replace(os.sep, "/"):
        return
    shutil.rmtree(os.path.join(hdir, uid + ".git"), ignore_errors=True)
    for ext in (".json", ".lock"):
        try:
            os.unlink(os.path.join(hdir, uid + ext))
        except OSError:
            pass


def delete_trash(home, tid, by=None, why="deleted for good"):
    """Remove an exam from the trash for good, with its history."""
    if not isinstance(tid, str) or not TRASH_ID_RE.match(tid):
        raise HistoryError("No such exam in the trash.")
    d = os.path.join(home, "trash", tid)
    info = _read_json(os.path.join(d, "info.json")) or {}
    if not os.path.isdir(d):
        raise HistoryError("No such exam in the trash.")
    shutil.rmtree(d)
    _drop_history(home, info.get("uid"))
    audit(home, by, f"exam {why}", exam=info.get("name"), uid=info.get("uid"), trash=tid)


def purge_trash(home, now=None):
    """Exams kept longer than TRASH_DAYS go for good."""
    now = now or time.time()
    d = os.path.join(home, "trash")
    for tid in (os.listdir(d) if os.path.isdir(d) else []):
        if not TRASH_ID_RE.match(tid):
            continue
        info = _read_json(os.path.join(d, tid, "info.json")) or {}
        if info.get("deleted_at", now) + TRASH_DAYS * 86400 <= now:
            try:
                delete_trash(home, tid, why=f"removed from the trash after {TRASH_DAYS} days")
            except (OSError, HistoryError):
                pass


# ---------------------------------------------------------------- audit log

def audit(home, by, action, **fields):
    """Append one line to the owner's audit log; returns the entry."""
    entry = {"at": int(time.time()), "by": by, "action": action, **fields}
    try:
        os.makedirs(home, exist_ok=True)
        with _lock(os.path.join(home, "audit.lock")):
            with open(os.path.join(home, "audit.jsonl"), "a", encoding="utf-8") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except OSError:
        pass
    return entry


def read_audit(home, limit=200):
    try:
        with open(os.path.join(home, "audit.jsonl"), encoding="utf-8") as f:
            lines = f.readlines()[-limit:]
    except OSError:
        return []
    out = []
    for line in reversed(lines):
        try:
            out.append(json.loads(line))
        except ValueError:
            pass
    return out
