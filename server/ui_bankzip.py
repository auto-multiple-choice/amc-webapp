"""
A question bank as a zip (doc/question-bank-plan.md, section 7.8): to move
it between the Mac and a server, or to give a colleague a copy that then
becomes their own bank.

  bank.json, preamble.tex, items/<name>/<files>   the bank's files
  history.bundle                                  its history (git bundle)

Reading a zip is checked like an exam archive: only those names (item
folders with the strict item name pattern, files history keeps), no links,
no absolute paths or "..", limits on the number and size of files (also
when unpacked, against zip bombs). A zip made by hand with the bank's
folder at its top is read too. Standard library only.
"""
import os
import re
import stat
import zipfile
import zlib

import ui_banks as banks
import ui_items as items
import ui_vcs as vcs

BUNDLE = "history.bundle"
MAX_FILES = 20000
MAX_FILE = 50 * 1024 * 1024      # one file, unpacked
MAX_TOTAL = 200 * 1024 * 1024    # all files, unpacked


class ZipError(ValueError):
    """Why a zip can't be read as a bank, in words for the teacher."""


def write(bdir, out, bundle=None):
    """The bank at BDIR as a zip into OUT (a path or a file object), with
    BUNDLE (a path) as its history when given."""
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for rel in (banks.BANK_FILE, banks.PREAMBLE):
            p = os.path.join(bdir, rel)
            if os.path.isfile(p) and not os.path.islink(p):
                z.write(p, rel)
        for n in banks.item_names(bdir):
            folder = os.path.join(bdir, items.ITEMS_DIR, n)
            for f in sorted(os.listdir(folder)):
                p = os.path.join(folder, f)
                rel = f"{items.ITEMS_DIR}/{n}/{f}"
                if os.path.isfile(p) and not os.path.islink(p) and vcs.tracked(rel):
                    z.write(p, rel)
        if bundle and os.path.isfile(bundle):
            z.write(bundle, BUNDLE, compress_type=zipfile.ZIP_STORED)


def allowed(rel):
    """RELATIVE is a name a bank's zip may hold."""
    if rel in (banks.BANK_FILE, banks.PREAMBLE, BUNDLE):
        return True
    parts = rel.split("/")
    return (len(parts) == 3 and parts[0] == items.ITEMS_DIR and items.NAME_RE.match(parts[1]) is not None
            and vcs.tracked(rel))


def read(path, dest):
    """Unpack the bank zip at PATH into the empty folder DEST, checked.
    Returns (files written, names skipped). Raises ZipError."""
    try:
        z = zipfile.ZipFile(path)
    except (zipfile.BadZipFile, OSError):
        raise ZipError("This file isn't a zip.")
    with z:
        infos = [i for i in z.infolist() if not i.is_dir()]
        if len(infos) > MAX_FILES:
            raise ZipError(f"The zip holds more than {MAX_FILES} files.")
        # macOS metadata a zip made in the Finder carries
        infos = [i for i in infos if not i.filename.startswith("__MACOSX/") and not os.path.basename(i.filename).startswith("._")]
        names = [i.filename for i in infos]
        for n in names:
            if "\\" in n or "\0" in n or n.startswith("/") or re.match(r"^[A-Za-z]:", n) or ".." in n.split("/"):
                raise ZipError(f"The zip holds a file with a name that isn't allowed: {n[:120]}")
        # a zip made by hand from the bank's folder: everything under one folder
        prefix = ""
        tops = {n.split("/", 1)[0] for n in names if "/" in n}
        if banks.BANK_FILE not in names and len(tops) == 1 and all("/" in n for n in names):
            top = tops.pop()
            if f"{top}/{banks.BANK_FILE}" in names:
                prefix = top + "/"
        if prefix + banks.BANK_FILE not in names:
            raise ZipError("This zip isn't a question bank: it has no bank.json.")
        written, skipped, total = [], [], 0
        try:
            _unpack(z, infos, prefix, dest, written, skipped)
        except (zipfile.BadZipFile, RuntimeError, NotImplementedError, zlib.error, EOFError) as e:  # a bad CRC, encrypted or odd entries
            raise ZipError(f"The zip can't be unpacked: {str(e)[:120]}")
    return written, skipped


def _unpack(z, infos, prefix, dest, written, skipped):
        total = 0
        for i in infos:
            rel = i.filename[len(prefix):] if i.filename.startswith(prefix) else None
            if not rel:
                continue
            if stat.S_ISLNK(i.external_attr >> 16):
                raise ZipError(f"The zip holds a link ({rel[:120]}), which isn't allowed.")
            if not allowed(rel):
                skipped.append(rel)
                continue
            if i.file_size > MAX_FILE:
                raise ZipError(f"{rel} is too big (more than {MAX_FILE // 1024 // 1024} MB).")
            target = os.path.join(dest, *rel.split("/"))
            os.makedirs(os.path.dirname(target), exist_ok=True)
            size = 0
            with z.open(i) as src, open(target, "wb") as out:
                while chunk := src.read(1 << 20):
                    size += len(chunk)
                    total += len(chunk)
                    if size > MAX_FILE or total > MAX_TOTAL:  # the sizes the zip claims can lie
                        raise ZipError(f"The zip is too big unpacked (more than {MAX_TOTAL // 1024 // 1024} MB in all).")
                    out.write(chunk)
            written.append(rel)
