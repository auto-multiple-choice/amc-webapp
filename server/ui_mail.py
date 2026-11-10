"""
Emailing results: each student's annotated sheet and mark (issue #7).

The administrator sets the mail server once (Email sending, admins only);
teachers then send from an exam's Email results screen. Mail goes out from
the server process with smtplib, not through AMC's AMC-mailing: the SMTP
password never has to be readable inside AMC's sandbox, and the app can
show a preview, send a test, record each student's status and stop
midway.

Kept in the server's own folder (MC-Projects/_amcweb/_mail/), which /fs
never serves and no teacher's sandbox can read:
- settings.json (mode 600): host, port, security, user, password, sender,
  the daily limit per teacher and the pause between emails;
- teachers/<owner>.json: emails sent today, and the teacher's last reply-to
  and test addresses.

The message text uses AMC's own codes, as the annotated sheets' header
does: %s mark, %m out of, %S points, %M maximum points, %n exam,
%(ID) the student's name, %(column) any class list column.

No Flask here: server/ui.py does the requests; tests-ui/test_ui_logic.py
checks this module.
"""

import json
import os
import re
import smtplib
import ssl
import time
from email.headerregistry import Address
from email.message import EmailMessage
from email.utils import formatdate, make_msgid

MAIL_DIR = "_mail"            # inside the server's own folder (ui_vcs.AMCWEB_DIR)
SECURITY = ("starttls", "ssl", "none")
DEFAULT_PORTS = {"starttls": 587, "ssl": 465, "none": 25}
DEFAULTS = {"host": "", "port": 587, "security": "starttls", "user": "", "password": "",
            "from_address": "", "from_name": "", "daily_limit": 300, "delay": 1.0}
LIMIT_MAX = 5000
DELAY_MAX = 30
TIMEOUT = 30

DEFAULT_SUBJECT = "%n: your marked answer sheet"
DEFAULT_BODY = ("Dear %(ID),\n\n"
                "Your mark for %n is %s out of %m.\n\n"
                "Your marked answer sheet is attached.\n")

_ATOM = r"[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+"
_LABEL = r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?"
ADDRESS_RE = re.compile(rf"^{_ATOM}(?:\.{_ATOM})*@{_LABEL}(?:\.{_LABEL})+$")
HOST_RE = re.compile(r"^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$|^\[?[0-9A-Fa-f:.]+\]?$")
OWNER_RE = re.compile(r"[^A-Za-z0-9_.@-]")
EMAIL_COLUMNS = ("email", "e-mail", "mail", "courriel", "email address", "e-mail address")


# ---- addresses

def valid_address(a):
    return isinstance(a, str) and len(a) <= 254 and bool(ADDRESS_RE.match(a))


def split_addresses(cell):
    """The addresses in a class list cell: one, or several separated by
    commas, semicolons or spaces. Returns (addresses, the first bad one)."""
    parts = [p for p in re.split(r"[,;\s]+", (cell or "").strip()) if p]
    bad = next((p for p in parts if not valid_address(p)), None)
    return parts, bad


def guess_email_column(columns, rows):
    """The class list column holding email addresses: one named like it,
    else the first where most filled cells are addresses."""
    low = {c.strip().lower(): c for c in columns}
    for name in EMAIL_COLUMNS:
        if name in low:
            return low[name]
    for c in columns:
        cells = [r.get(c, "") for r in rows if r.get(c)]
        if cells and sum(1 for v in cells if not split_addresses(v)[1]) >= max(1, 0.8 * len(cells)):
            return c
    return None


# ---- the message text

def format_number(x):
    """As AMC writes marks into text (AMC::Substitute, 4 significant digits)."""
    if x is None:
        return ""
    try:
        x = float(x)
    except (TypeError, ValueError):
        return str(x)
    return f"{x:.4g}"


_CODE = re.compile(r"%\(([^()\n]*)\)|%([sSmMn])")


def substitute(text, v):
    """AMC's codes in TEXT, from V: mark, max (out of), total, points (max
    points), exam, name, columns (the student's class list row). An unknown
    %(column) stays as typed, so the preview shows the mistake."""
    def one(m):
        if m.group(1) is not None:
            key = m.group(1)
            if key == "ID":
                return v.get("name") or ""
            cols = v.get("columns") or {}
            return cols[key] if key in cols else m.group(0)
        return {"s": format_number(v.get("mark")), "m": format_number(v.get("max")),
                "S": format_number(v.get("total")), "M": format_number(v.get("points")),
                "n": v.get("exam") or ""}[m.group(2)]
    return _CODE.sub(one, text or "")


# Control characters, and everything Python's email library takes for a
# line break in a header (str.splitlines: also \v, \f, \x1c-\x1e, \x85 and
# the Unicode line and paragraph separators, which come with pasted text).
# It refuses a header holding one, so they go before it sees them.
_CONTROL = re.compile("[\x00-\x1f\x7f-\x9f\u2028\u2029]+")


def one_line(s, most=300):
    """A header value: no line breaks or control characters, not too long."""
    return _CONTROL.sub(" ", s or "").strip()[:most]


def same_addresses(sent_to, to):
    """Whether an email recorded as sent to SENT_TO (the log's text) went
    to the addresses TO, whatever their order or capitals."""
    return {a.lower() for a in split_addresses(sent_to)[0]} == {a.lower() for a in to}


def build_message(settings, to, subject, body, attachment=None, reply_to=None):
    """An email to the addresses TO, from the sender the admin set.
    ATTACHMENT: (file name, bytes) of a PDF."""
    msg = EmailMessage()
    msg["From"] = Address(display_name=one_line(settings.get("from_name"), 100), addr_spec=settings["from_address"])
    msg["To"] = ", ".join(to)
    if reply_to and valid_address(reply_to):
        msg["Reply-To"] = reply_to
    msg["Subject"] = one_line(subject) or "(no subject)"
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid(domain=settings["from_address"].rsplit("@", 1)[1])
    msg.set_content((body or "").replace("\r\n", "\n"))
    if attachment:
        name, data = attachment
        msg.add_attachment(data, maintype="application", subtype="pdf", filename=one_line(name, 150) or "sheet.pdf")
    return msg


def sender_text(s):
    """The sender as people read it: Name <address>."""
    name = one_line(s.get("from_name"), 100)
    return f"{name} <{s['from_address']}>" if name else s["from_address"]


# ---- settings

def mail_dir(amcweb_root):
    return os.path.join(amcweb_root, MAIL_DIR)


def _write_json(path, data, mode=0o600):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1)
    os.chmod(tmp, mode)
    os.replace(tmp, path)


def _read_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def load_settings(d):
    s = dict(DEFAULTS)
    s.update({k: v for k, v in _read_json(os.path.join(d, "settings.json")).items() if k in DEFAULTS})
    return s


def configured(s):
    return bool(s.get("host") and valid_address(s.get("from_address") or ""))


def public_settings(s):
    """The settings for the admin's page: never the password."""
    out = {k: v for k, v in s.items() if k != "password"}
    out["password_set"] = bool(s.get("password"))
    out["configured"] = configured(s)
    return out


def check_settings(data, old):
    """New settings from the admin's form DATA, over OLD: an empty password
    keeps the old one, unless clear_password. Raises ValueError in words."""
    data = data if isinstance(data, dict) else {}
    s = dict(old)
    host = str(data.get("host", "")).strip()
    if host and not HOST_RE.match(host):
        raise ValueError("The mail server is a host name such as smtp.gmail.com.")
    s["host"] = host
    security = data.get("security", "starttls")
    if security not in SECURITY:
        raise ValueError("Choose how the connection is secured.")
    s["security"] = security
    try:
        port = int(data.get("port") or DEFAULT_PORTS[security])
    except (TypeError, ValueError):
        port = 0
    if not 1 <= port <= 65535:
        raise ValueError("The port is a number from 1 to 65535, such as 587.")
    s["port"] = port
    s["user"] = one_line(str(data.get("user", "")), 254)
    if data.get("password"):  # also after "Remove the saved password": what is typed counts
        s["password"] = str(data["password"])[:500]
    elif data.get("clear_password"):
        s["password"] = ""
    elif s.get("password") and host.lower() != str(old.get("host") or "").lower():
        # The saved password was typed for the server it is sent to. It
        # never follows a change of server: a test email through a server
        # of one's own would be a way to read it.
        if host and s["user"]:
            raise ValueError("The mail server changed: type its password again.")
        s["password"] = ""
    addr = str(data.get("from_address", "")).strip()
    if host and not valid_address(addr):
        raise ValueError("The sender's address isn't an email address.")
    if addr and not valid_address(addr):
        raise ValueError("The sender's address isn't an email address.")
    s["from_address"] = addr
    s["from_name"] = one_line(str(data.get("from_name", "")), 100)
    try:
        s["daily_limit"] = max(1, min(LIMIT_MAX, int(data.get("daily_limit") or DEFAULTS["daily_limit"])))
        s["delay"] = max(0.0, min(float(DELAY_MAX), float(data.get("delay") if data.get("delay") not in (None, "") else DEFAULTS["delay"])))
    except (TypeError, ValueError, OverflowError):
        raise ValueError("The limit and the pause are numbers.")
    return s


def save_settings(d, s):
    _write_json(os.path.join(d, "settings.json"), {k: s[k] for k in DEFAULTS})


# ---- each teacher's count of emails today, and remembered addresses

def _teacher_file(d, owner):
    return os.path.join(d, "teachers", OWNER_RE.sub("_", owner or "_local") + ".json")


def teacher(d, owner):
    t = _read_json(_teacher_file(d, owner))
    today = time.strftime("%Y-%m-%d")
    if t.get("date") != today:
        t["date"], t["count"] = today, 0
    return t


def remaining(d, owner, limit):
    return max(0, int(limit) - int(teacher(d, owner).get("count") or 0))


def update_teacher(d, owner, sent=0, **remember):
    t = teacher(d, owner)
    t["count"] = int(t.get("count") or 0) + sent
    for k, v in remember.items():
        if v:
            t[k] = v
    _write_json(_teacher_file(d, owner), t)
    return t


# ---- sending

def connect(s, timeout=TIMEOUT):
    """An SMTP connection, secured and signed in as the settings say."""
    if s["security"] == "ssl":
        conn = smtplib.SMTP_SSL(s["host"], int(s["port"]), timeout=timeout, context=ssl.create_default_context())
    else:
        conn = smtplib.SMTP(s["host"], int(s["port"]), timeout=timeout)
        if s["security"] == "starttls":
            conn.starttls(context=ssl.create_default_context())
    try:
        if s.get("user"):
            conn.login(s["user"], s.get("password") or "")
    except Exception:
        try:
            conn.quit()
        except Exception:
            pass
        raise
    return conn


def explain(e):
    """An SMTP error in words for a teacher or the admin."""
    if isinstance(e, smtplib.SMTPAuthenticationError):
        return "The mail server refused the user name or password (for Gmail, use an app password)."
    if isinstance(e, smtplib.SMTPRecipientsRefused):
        return "The mail server refused the address: " + "; ".join(
            f"{a}: {c} {m.decode(errors='replace') if isinstance(m, bytes) else m}" for a, (c, m) in e.recipients.items())[:300]
    if isinstance(e, smtplib.SMTPSenderRefused):
        return f"The mail server refused the sender address ({e.smtp_code})."
    if isinstance(e, smtplib.SMTPResponseException):
        m = e.smtp_error.decode(errors="replace") if isinstance(e.smtp_error, bytes) else str(e.smtp_error)
        return f"The mail server answered {e.smtp_code}: {m}"[:300]
    if isinstance(e, ssl.SSLError):
        return f"The secure connection failed ({e.reason or e}). Check the port and the security setting."[:300]
    if isinstance(e, (TimeoutError, OSError)) and not isinstance(e, smtplib.SMTPException):
        return f"Can't reach the mail server: {e.strerror or e}"[:300]
    return str(e)[:300] or e.__class__.__name__
