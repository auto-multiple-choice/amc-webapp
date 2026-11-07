"""
The search index of a teacher's question banks, and the usage of their
items (doc/question-bank-plan.md, sections 7.2 and 7.7).

  _amcweb/<user>/bank-index.sqlite   full-text search (SQLite FTS5) on the
                                     items' text, titles and tags, with their
                                     group, kind, difficulty and archived flag
  _amcweb/<user>/bank-usage.jsonl    one line per bank item copy printed:
                                     exam uid and name, bank and item uids, when

Both are outside teachers' folders. The index is rebuilt from the files
when it is missing or behind: each bank has a stamp (sizes and dates of its
files), so a bank changed by the app, restored from History or edited by
hand is read again. The files are the truth; the index can always be
thrown away. Usage is recorded when an exam is printed (the lock), not when
questions are added, so a question dropped before printing doesn't count.
Standard library only.
"""
import hashlib
import json
import logging
import os
import re
import sqlite3
import time

import ui_banks as banks
import ui_items as items
import ui_scale as scale
import ui_vcs as vcs

INDEX = "bank-index.sqlite"
USAGE = "bank-usage.jsonl"
SCHEMA = 1
INDEX_TEXT_MAX = 200 * 1024   # an item's LaTeX beyond this is indexed by its start only
_DAMAGED = ("malformed", "not a database", "file is not a database", "unsupported file format", "file is encrypted")
KINDS = ("single", "multiple", "numeric", "set")
_log = logging.getLogger("amcweb.banks")


# ---------------------------------------------------------------- the index file

def _connect(home):
    os.makedirs(home, exist_ok=True)
    path = os.path.join(home, INDEX)
    for attempt in (1, 2):
        db = sqlite3.connect(path, timeout=15)
        try:
            version = db.execute("PRAGMA user_version").fetchone()[0]
            if version != SCHEMA:
                db.executescript("""
                    DROP TABLE IF EXISTS banks; DROP TABLE IF EXISTS items; DROP TABLE IF EXISTS fts;
                    CREATE TABLE banks (uid TEXT PRIMARY KEY, name TEXT, stamp TEXT);
                    CREATE TABLE items (bank_uid TEXT, item TEXT, uid TEXT, grp TEXT, title TEXT, kind TEXT, nq INTEGER,
                                        difficulty TEXT, tags TEXT, archived INTEGER, ord INTEGER, UNIQUE (bank_uid, item));
                    CREATE VIRTUAL TABLE fts USING fts5(title, body, tags, tokenize = 'unicode61 remove_diacritics 2');
                """)
                db.execute(f"PRAGMA user_version = {SCHEMA}")
                db.commit()
            return db
        except sqlite3.DatabaseError as e:
            db.close()
            # Only a damaged file is thrown away (it is rebuilt from the files): a lock held by
            # another request, a full disk or a read-only file aren't damage.
            if attempt == 2 or not any(w in str(e).lower() for w in _DAMAGED):
                raise
            for ext in ("", "-wal", "-shm", "-journal"):
                try:
                    os.unlink(path + ext)
                except OSError:
                    pass


def stamp(bdir):
    """Sizes and dates of a bank's files: changes when any of them does."""
    h = hashlib.sha256()
    for rel in (banks.BANK_FILE, banks.PREAMBLE):
        try:
            st = os.stat(os.path.join(bdir, rel))
            h.update(f"{rel}:{st.st_size}:{st.st_mtime_ns}\n".encode())
        except OSError:
            pass
    root = os.path.join(bdir, items.ITEMS_DIR)
    for n in sorted(os.listdir(root)) if os.path.isdir(root) else []:
        for f in (items.ITEM_FILE, items.META_FILE):
            try:
                st = os.stat(os.path.join(root, n, f))
                h.update(f"{n}/{f}:{st.st_size}:{st.st_mtime_ns}\n".encode())
            except OSError:
                pass
    return h.hexdigest()[:24]


_COMMENT = re.compile(r"(?<!\\)%.*$", re.M)
_COMMAND = re.compile(r"\\(?:begin|end)\s*\{[^{}]*\}(?:\{[^{}]*\})?|\\[A-Za-z@]+\*?|\\.")


def plain(text):
    """The words of an item's LaTeX, for searching."""
    t = _COMMENT.sub(" ", text or "")
    t = _COMMAND.sub(" ", t)
    return re.sub(r"\s+", " ", re.sub(r"[{}$&~^_\[\]]", " ", t)).strip()


def kind_of(qs):
    return "set" if len(qs) > 1 else (qs[0]["kind"] if qs else "")


def _bank_dirs(projects_dir):
    root = banks.banks_root(projects_dir)
    out = []
    for n in sorted(os.listdir(root)) if os.path.isdir(root) else []:
        d = os.path.join(root, n)
        if banks.NAME_RE.match(n) and not os.path.islink(d) and vcs.is_target(d, "bank"):
            out.append(d)
    return out


def _text(value):
    """A string field of item.json (a file the teacher may edit by hand), or ""."""
    return value if isinstance(value, str) else ""


def _index_bank(db, bdir, b, st):
    uid = b["uid"]
    db.execute("DELETE FROM fts WHERE rowid IN (SELECT rowid FROM items WHERE bank_uid = ?)", (uid,))
    db.execute("DELETE FROM items WHERE bank_uid = ?", (uid,))
    gmap = banks.group_map(b)
    for i, n in enumerate(b["all"]):
        try:
            with open(os.path.join(bdir, items.item_file(n)), encoding="utf-8", errors="replace") as f:
                text = f.read(INDEX_TEXT_MAX + 1)
        except OSError:
            continue
        try:
            m = banks.item_meta(bdir, n)
            if len(text) > INDEX_TEXT_MAX:  # a huge file (an imported zip): its start is enough to find it
                text, qs = text[:INDEX_TEXT_MAX], []
            else:
                qs = scale.read_latex(text)
            title = _text(m.get("title")) or banks.plain_title(text)
            tags = [t for t in (m.get("tags") or []) if isinstance(t, str)] if isinstance(m.get("tags"), list) else []
            cur = db.execute("INSERT INTO items (bank_uid, item, uid, grp, title, kind, nq, difficulty, tags, archived, ord) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                             (uid, n, _text(m.get("uid")) or None, gmap.get(n), title, kind_of(qs), len(qs), _text(m.get("difficulty")),
                              json.dumps(tags, ensure_ascii=False), 1 if m.get("archived") else 0, i))
            db.execute("INSERT INTO fts (rowid, title, body, tags) VALUES (?,?,?,?)",
                       (cur.lastrowid, title, " ".join(q["id"] for q in qs) + " " + plain(text), " ; ".join(tags)))
        except (sqlite3.Error, ValueError, TypeError) as e:  # one odd item doesn't keep the others out of the index
            _log.warning(f"{bdir}/{n}: not indexed ({e})")
    db.execute("INSERT OR REPLACE INTO banks (uid, name, stamp) VALUES (?,?,?)", (uid, os.path.basename(bdir), st))


def refresh(home, projects_dir):
    """Bring the index up to date with the teacher's banks. Returns the
    open database and {bank uid: folder}."""
    db = _connect(home)
    try:
        known = {uid: s for uid, s in db.execute("SELECT uid, stamp FROM banks")}
        dirs = {}
        for d in _bank_dirs(projects_dir):
            st = stamp(d)
            b = banks.read(d)
            if not b["uid"] or b["uid"] in dirs:
                continue
            dirs[b["uid"]] = d
            if known.get(b["uid"]) != st:
                _index_bank(db, d, b, st)
            elif db.execute("SELECT name FROM banks WHERE uid = ?", (b["uid"],)).fetchone()[0] != os.path.basename(d):
                db.execute("UPDATE banks SET name = ? WHERE uid = ?", (os.path.basename(d), b["uid"]))
        for uid in set(known) - set(dirs):
            db.execute("DELETE FROM fts WHERE rowid IN (SELECT rowid FROM items WHERE bank_uid = ?)", (uid,))
            db.execute("DELETE FROM items WHERE bank_uid = ?", (uid,))
            db.execute("DELETE FROM banks WHERE uid = ?", (uid,))
        db.commit()
    except BaseException:
        db.close()
        raise
    return db, dirs


# ---------------------------------------------------------------- usage

def note_printed(home, exam, exam_uid, copies, by=None):
    """An exam was printed: each of its COPIES [(bank uid, item uid, bank
    item name)] is used once more."""
    if not copies:
        return 0
    at = int(time.time())
    os.makedirs(home, exist_ok=True)
    with vcs.FileLock(os.path.join(home, USAGE + ".lock")):
        with open(os.path.join(home, USAGE), "a", encoding="utf-8") as f:
            for bank_uid, item_uid, item in copies:
                f.write(json.dumps({"at": at, "by": by, "exam": exam, "exam_uid": exam_uid, "bank_uid": bank_uid,
                                    "item_uid": item_uid, "item": item}, ensure_ascii=False) + "\n")
    return len(copies)


def usage(home):
    """{(bank uid, item uid): {"exams": {exam uid: (at, name)}, "last": at,
    "last_exam": name}} from the usage log (an exam printed again counts once)."""
    out = {}
    try:
        f = open(os.path.join(home, USAGE), encoding="utf-8")
    except OSError:
        return out
    with f:
        for line in f:
            try:
                r = json.loads(line)
                key = (r["bank_uid"], r["item_uid"])
                at = int(r["at"])
            except (ValueError, KeyError, TypeError):
                continue
            u = out.setdefault(key, {"exams": {}, "last": 0, "last_exam": None})
            u["exams"][r.get("exam_uid") or r.get("exam")] = (at, r.get("exam"))
            if at >= u["last"]:
                u["last"], u["last_exam"] = at, r.get("exam")
    return out


# ---------------------------------------------------------------- statistics (ui_stats.py)

STATS_DIR = "stats"


def note_stats(home, exam, exam_uid, entries):
    """An exam's marks were computed: the statistics of its copies of bank
    items, [{bank_uid, item_uid, question (the bank's name), n, right,
    separation, answers}], replace the exam's earlier ones."""
    if not exam_uid or not vcs.UID_RE.match(exam_uid):
        return
    d = os.path.join(home, STATS_DIR)
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, f"{exam_uid}.json")
    if not entries:
        if os.path.exists(path):
            os.unlink(path)
        return
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"exam": exam, "exam_uid": exam_uid, "at": int(time.time()), "items": entries}, f, ensure_ascii=False)
    os.replace(tmp, path)


def stats_of(home, bank_uid, item_uid):
    """The statistics of a bank item in every exam marked with a copy of it:
    [{exam, at, question, n, right, separation, answers}], newest first."""
    d = os.path.join(home, STATS_DIR)
    out = []
    for f in sorted(os.listdir(d)) if os.path.isdir(d) else []:
        if not f.endswith(".json"):
            continue
        try:
            with open(os.path.join(d, f), encoding="utf-8") as fh:
                rec = json.load(fh)
        except (OSError, ValueError):
            continue
        for e in rec.get("items") or []:
            if isinstance(e, dict) and e.get("bank_uid") == bank_uid and e.get("item_uid") == item_uid:
                out.append(dict(e, exam=rec.get("exam"), at=rec.get("at")))
    return sorted(out, key=lambda e: -(e.get("at") or 0))


# ---------------------------------------------------------------- searching

def fts_query(text):
    """A full-text query from what the teacher typed: every word, as a
    prefix (alg finds algebra), all of them needed."""
    words = re.findall(r"\w+", str(text or ""), re.UNICODE)[:12]
    return " AND ".join(f'"{w}"*' for w in words)


def search(home, projects_dir, q="", bank=None, group=None, difficulty=None, kind=None, tags=(),
           unused_since=None, archived=False, limit=500):
    """Items matching, in bank and group order: [{bank, bank_uid, item, uid,
    group, title, kind, nq, difficulty, tags, archived, used, last_used,
    last_exam}]. BANK is a bank's uid; TAGS must all be on the item;
    UNUSED_SINCE (a time) keeps items never printed, or last printed
    before it; ARCHIVED items only when asked."""
    fq = fts_query(q)
    if str(q or "").strip() and not fq:  # typed, but no word in it: nothing matches, rather than everything
        return []
    db, dirs = refresh(home, projects_dir)
    try:
        sql = ("SELECT items.bank_uid, banks.name, items.item, items.uid, items.grp, items.title, items.kind, items.nq, "
               "items.difficulty, items.tags, items.archived FROM items JOIN banks ON banks.uid = items.bank_uid")
        where, args = [], []
        if fq:
            sql += " JOIN fts ON fts.rowid = items.rowid"
            where.append("fts MATCH ?")
            args.append(fq)
        for col, val in (("items.bank_uid", bank), ("items.grp", group), ("items.difficulty", difficulty), ("items.kind", kind)):
            if val:
                where.append(f"{col} = ?")
                args.append(val)
        if not archived:
            where.append("items.archived = 0")
        sql += (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY banks.name, items.ord"
        if not (tags or unused_since):  # tags and usage are filtered below, over every row, so no match is missed
            sql += " LIMIT ?"
            args.append(int(limit))
        rows = db.execute(sql, args).fetchall()
    except sqlite3.OperationalError as e:  # what is typed is cleaned first (fts_query), so this is worth a look
        _log.warning(f"Bank search ({fq!r}): {e}")
        rows = []
    finally:
        db.close()
    use = usage(home)
    want = {t.lower() for t in tags or () if t}
    out = []
    for bank_uid, bname, item, uid, grp, title, kd, nq, diff, tags_json, arch in rows:
        try:
            tg = json.loads(tags_json or "[]")
        except ValueError:
            tg = []
        if want and not want <= {t.lower() for t in tg}:
            continue
        u = use.get((bank_uid, uid)) or {}
        if unused_since and u.get("last") and u["last"] >= int(unused_since):
            continue
        out.append({"bank": bname, "bank_uid": bank_uid, "item": item, "uid": uid, "group": grp, "title": title, "kind": kd,
                    "nq": nq, "difficulty": diff, "tags": tg, "archived": bool(arch), "used": len(u.get("exams") or {}),
                    "last_used": u.get("last") or None, "last_exam": u.get("last_exam")})
        if len(out) >= int(limit):
            break
    return out


# ---------------------------------------------------------------- the exams using an item

def exams_with(projects_dir, bank_uid, item_uid):
    """The teacher's exams holding a copy of the item: [(exam, exam item)]."""
    out = []
    for e in sorted(os.listdir(projects_dir)) if os.path.isdir(projects_dir) else []:
        d = os.path.join(projects_dir, e)
        if e.startswith(("_", ".")) or os.path.islink(d) or not os.path.isfile(os.path.join(d, "options.xml")):
            continue
        root = os.path.join(d, items.ITEMS_DIR)
        for n in sorted(os.listdir(root)) if os.path.isdir(root) and not os.path.islink(root) else []:
            o = banks.origin_of(banks.item_meta(d, n))
            if o.get("bank_uid") == bank_uid and o.get("item_uid") == item_uid:
                out.append((e, n))
    return out
