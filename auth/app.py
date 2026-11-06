"""Sign-in service for the AMC web app on a shared machine.

Caddy calls GET /auth/verify before passing any request on to AMC. A request
from a signed-in user gets 200 with the username in the X-AMC-User header,
which Caddy copies onto the request for AMC (AMC reads it through
AMC_USERHEADER). Anything else is sent to the sign-in page (page loads) or
refused with 401 (background requests).

Accounts are created by admins, on the admin page or with `flask user add`;
there is no self sign-up. Sessions are stored server side, so signing out,
disabling an account or resetting a password ends them at once.
"""

import functools
import hashlib
import os
import re
import secrets
import sqlite3
import threading
import time

import click
from flask import (Flask, abort, flash, g, make_response, redirect,
                   render_template, request, session, url_for)
from werkzeug.security import check_password_hash, generate_password_hash

DATA_DIR = os.environ.get("AUTH_DATA_DIR", "/data")
DB_PATH = os.path.join(DATA_DIR, "users.sqlite")
USER_HEADER = os.environ.get("AMC_USERHEADER", "X-AMC-User")
SECURE_COOKIES = os.environ.get("AUTH_SECURE_COOKIES", "1") != "0"

COOKIE = "amc_auth"
SESSION_IDLE = 12 * 3600       # signed out after 12 hours without activity
SESSION_MAX = 7 * 24 * 3600    # and after 7 days in any case
MIN_PASSWORD = 8
# Usernames become directory names under MC-Projects, where names starting
# with "_" are reserved (_shared_lists, _default_config, _all).
USERNAME_RE = re.compile(r"[a-z0-9][a-z0-9._-]{1,31}")

app = Flask(__name__, static_url_path="/auth/static")


# --- setup ------------------------------------------------------------------

def load_secret_key():
    path = os.path.join(DATA_DIR, "secret_key")
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        with open(path, "rb") as f:
            return f.read()
    key = secrets.token_bytes(32)
    with os.fdopen(fd, "wb") as f:
        f.write(key)
    return key


os.makedirs(DATA_DIR, exist_ok=True)
app.config.update(
    SECRET_KEY=load_secret_key(),
    # Flask's own cookie only carries the form token and notices, and only
    # the service's pages need it.
    SESSION_COOKIE_NAME="amc_auth_form",
    SESSION_COOKIE_PATH="/auth",
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SECURE=SECURE_COOKIES,
    SESSION_COOKIE_SAMESITE="Lax",
    MAX_CONTENT_LENGTH=64 * 1024,
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    username      TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    is_admin      INTEGER NOT NULL DEFAULT 0,
    disabled      INTEGER NOT NULL DEFAULT 0,
    must_change   INTEGER NOT NULL DEFAULT 1,
    created_at    INTEGER NOT NULL,
    last_login    INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    username   TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    last_seen  INTEGER NOT NULL
);
"""

with sqlite3.connect(DB_PATH) as _conn:
    _conn.executescript(SCHEMA)
_conn.close()


def db():
    if "db" not in g:
        conn = sqlite3.connect(DB_PATH, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        g.db = conn
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


# --- accounts ---------------------------------------------------------------

DUMMY_HASH = generate_password_hash(secrets.token_urlsafe(16))


def now():
    return int(time.time())


def token_hash(token):
    # Only hashes are stored, so a copy of the database holds no live sessions.
    return hashlib.sha256(token.encode()).hexdigest()


def get_user(username):
    return db().execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()


def username_problem(name):
    if not USERNAME_RE.fullmatch(name):
        return ("Usernames are 2 to 32 characters: lowercase letters, digits, "
                "'.', '_' or '-', starting with a letter or a digit.")
    return None


def password_problem(password, username):
    if len(password) < MIN_PASSWORD:
        return f"Use at least {MIN_PASSWORD} characters for the password."
    if password.lower() == username:
        return "Don't use the username as the password."
    return None


def new_password():
    return secrets.token_urlsafe(9)


def create_user(username, password, is_admin, must_change):
    with db():
        db().execute(
            "INSERT INTO users (username, password_hash, is_admin, must_change, created_at)"
            " VALUES (?, ?, ?, ?, ?)",
            (username, generate_password_hash(password), int(is_admin), int(must_change), now()))


def set_password(username, password, must_change):
    with db():
        db().execute("UPDATE users SET password_hash = ?, must_change = ? WHERE username = ?",
                     (generate_password_hash(password), int(must_change), username))
        db().execute("DELETE FROM sessions WHERE username = ?", (username,))


# --- sessions ---------------------------------------------------------------

def current_user():
    """Row of the signed-in user, or None (cached for the request)."""
    if "user" in g:
        return g.user
    g.user = None
    token = request.cookies.get(COOKIE)
    if not token:
        return None
    h = token_hash(token)
    row = db().execute(
        "SELECT u.*, s.created_at AS session_created, s.last_seen AS session_seen"
        " FROM sessions s JOIN users u ON u.username = s.username"
        " WHERE s.token_hash = ?", (h,)).fetchone()
    if row is None:
        return None
    t = now()
    if (row["disabled"] or t - row["session_seen"] > SESSION_IDLE
            or t - row["session_created"] > SESSION_MAX):
        with db():
            db().execute("DELETE FROM sessions WHERE token_hash = ?", (h,))
        return None
    if t - row["session_seen"] > 60:
        with db():
            db().execute("UPDATE sessions SET last_seen = ? WHERE token_hash = ?", (t, h))
    g.user = row
    return row


def start_session(user, target):
    token = secrets.token_urlsafe(32)
    t = now()
    with db():
        db().execute("INSERT INTO sessions VALUES (?, ?, ?, ?)",
                     (token_hash(token), user["username"], t, t))
        db().execute("UPDATE users SET last_login = ? WHERE username = ?", (t, user["username"]))
        db().execute("DELETE FROM sessions WHERE last_seen < ? OR created_at < ?",
                     (t - SESSION_IDLE, t - SESSION_MAX))
    session.clear()   # fresh form token once signed in
    dest = url_for("account", next=target) if user["must_change"] else target
    resp = redirect(dest)
    resp.set_cookie(COOKIE, token, max_age=SESSION_MAX, path="/", httponly=True,
                    secure=SECURE_COOKIES, samesite="Lax")
    return resp


def end_this_session(resp):
    token = request.cookies.get(COOKIE)
    if token:
        with db():
            db().execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash(token),))
    session.clear()
    resp.delete_cookie(COOKIE, path="/", httponly=True, secure=SECURE_COOKIES, samesite="Lax")
    return resp


def safe_next(target):
    """Only follow redirects to pages of this site."""
    if (not target or not target.startswith("/") or target.startswith("//")
            or "\\" in target or target.startswith("/auth/")):
        return "/"
    return target


def signed_in(view):
    @functools.wraps(view)
    def wrapper(*args, **kwargs):
        if current_user() is None:
            return redirect(url_for("login"))
        return view(*args, **kwargs)
    return wrapper


def admin_only(view):
    @functools.wraps(view)
    def wrapper(*args, **kwargs):
        user = current_user()
        if user is None:
            return redirect(url_for("login"))
        if user["must_change"]:
            return redirect(url_for("account"))
        if not user["is_admin"]:
            abort(403)
        return view(*args, **kwargs)
    return wrapper


# --- forms and failed sign-ins ----------------------------------------------

def csrf_token():
    if "csrf" not in session:
        session["csrf"] = secrets.token_urlsafe(32)
    return session["csrf"]


app.jinja_env.globals["csrf_token"] = csrf_token


@app.before_request
def check_csrf():
    if request.method == "POST":
        sent = request.form.get("csrf", "")
        if not sent or not secrets.compare_digest(sent, session.get("csrf", "")):
            abort(400, "This form has expired. Go back, reload the page and try again.")


class FailedSignIns:
    """Failed sign-ins over the last 15 minutes, kept in memory (the service
    runs as a single process)."""

    WINDOW = 15 * 60
    PER_ACCOUNT = 5     # per username from one address
    PER_ADDRESS = 30    # from one address, whatever the usernames

    def __init__(self):
        self._lock = threading.Lock()
        self._times = {}

    def _recent(self, key, t):
        times = [x for x in self._times.get(key, ()) if t - x < self.WINDOW]
        if times:
            self._times[key] = times
        else:
            self._times.pop(key, None)
        return times

    def wait_seconds(self, username, addr):
        t = time.time()
        with self._lock:
            for key, limit in (((username, addr), self.PER_ACCOUNT), (addr, self.PER_ADDRESS)):
                times = self._recent(key, t)
                if len(times) >= limit:
                    return int(self.WINDOW - (t - times[-limit])) + 1
        return 0

    def failed(self, username, addr):
        t = time.time()
        with self._lock:
            for key in ((username, addr), addr):
                self._times.setdefault(key, []).append(t)

    def succeeded(self, username, addr):
        with self._lock:
            self._times.pop((username, addr), None)


failed_sign_ins = FailedSignIns()


def client_addr():
    # Caddy sets X-Forwarded-For to the real client address (it trusts no
    # proxy in front of it), and only Caddy can reach this service.
    return (request.headers.get("X-Forwarded-For") or request.remote_addr or "").split(",")[0].strip()


@app.after_request
def security_headers(resp):
    if request.path != "/auth/verify":
        resp.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; frame-ancestors 'none'; form-action 'self'")
        resp.headers.setdefault("X-Frame-Options", "DENY")
        resp.headers.setdefault("Referrer-Policy", "same-origin")
    resp.headers.setdefault("Cache-Control", "no-store")
    return resp


# --- routes -----------------------------------------------------------------

@app.get("/auth/verify")
def verify():
    user = current_user()
    if user is not None and not user["must_change"]:
        resp = make_response("", 200)
        resp.headers[USER_HEADER] = user["username"]
        # The app lets admins change the school's appearance.
        resp.headers["X-AMC-Admin"] = "1" if user["is_admin"] else "0"
        return resp
    original = request.headers.get("X-Forwarded-Uri", "/")
    wants_page = (request.headers.get("X-Forwarded-Method", "GET") == "GET"
                  and "text/html" in request.headers.get("Accept", ""))
    if not wants_page:
        return make_response("Sign-in required\n", 401)
    if user is not None:     # signed in, but must choose a password first
        return redirect(url_for("account", next=safe_next(original)))
    return redirect(url_for("login", next=safe_next(original)))


@app.get("/auth/health")
def health():
    return "ok\n"


@app.route("/auth/login", methods=["GET", "POST"])
def login():
    target = safe_next(request.values.get("next"))
    if request.method == "GET" and current_user() is not None:
        return redirect(target)
    error = None
    username = ""
    if request.method == "POST":
        username = request.form.get("username", "").strip().lower()
        password = request.form.get("password", "")
        addr = client_addr()
        wait = failed_sign_ins.wait_seconds(username, addr)
        if wait:
            error = f"Too many failed attempts. Try again in {wait // 60 + 1} minutes."
        else:
            user = get_user(username)
            # Check a hash even for unknown names, so response times don't
            # reveal which accounts exist.
            ok = check_password_hash(user["password_hash"] if user else DUMMY_HASH, password)
            if user is not None and ok:
                if user["disabled"]:
                    error = "This account is disabled. Ask an admin to enable it."
                else:
                    failed_sign_ins.succeeded(username, addr)
                    return start_session(user, target)
            else:
                failed_sign_ins.failed(username, addr)
                error = "Wrong username or password."
    return render_template("login.html", error=error, next=target, username=username)


@app.post("/auth/logout")
def logout():
    return end_this_session(redirect(url_for("login")))


@app.route("/auth/account", methods=["GET", "POST"])
@signed_in
def account():
    user = current_user()
    target = safe_next(request.values.get("next"))
    error = None
    if request.method == "POST":
        action = request.form.get("action")
        if action == "password":
            current = request.form.get("current", "")
            new = request.form.get("new", "")
            if not check_password_hash(user["password_hash"], current):
                error = "Your current password is wrong."
            elif problem := password_problem(new, user["username"]):
                error = problem
            elif new != request.form.get("confirm", ""):
                error = "The two new passwords don't match."
            elif check_password_hash(user["password_hash"], new):
                error = "Choose a password different from the current one."
            else:
                token = request.cookies.get(COOKIE, "")
                with db():
                    db().execute("UPDATE users SET password_hash = ?, must_change = 0 WHERE username = ?",
                                 (generate_password_hash(new), user["username"]))
                    # Sign out other browsers, keep this one.
                    db().execute("DELETE FROM sessions WHERE username = ? AND token_hash != ?",
                                 (user["username"], token_hash(token)))
                if user["must_change"]:
                    return redirect(target)
                flash("Password changed. Other browsers using your account were signed out.")
                return redirect(url_for("account"))
        elif action == "logout-everywhere":
            with db():
                db().execute("DELETE FROM sessions WHERE username = ?", (user["username"],))
            return end_this_session(redirect(url_for("login")))
        else:
            abort(400)
    return render_template("account.html", user=user, error=error, next=target)


@app.route("/auth/admin", methods=["GET", "POST"])
@admin_only
def admin():
    me = current_user()
    revealed = None     # (username, password) shown once on this page
    if request.method == "POST":
        action = request.form.get("action")
        name = request.form.get("username", "").strip().lower()
        if action == "create":
            password = request.form.get("password", "") or new_password()
            problem = username_problem(name) or password_problem(password, name)
            if problem:
                flash(problem, "error")
            elif get_user(name):
                flash(f"An account named {name} already exists.", "error")
            else:
                create_user(name, password, request.form.get("is_admin") == "1", must_change=True)
                revealed = (name, password)
        else:
            user = get_user(name)
            if user is None:
                flash("There is no such account.", "error")
            elif name == me["username"] and action in ("disable", "delete", "demote"):
                flash("You can't do that to your own account.", "error")
            elif action == "reset":
                password = new_password()
                set_password(name, password, must_change=True)
                revealed = (name, password)
            elif action in ("disable", "enable"):
                with db():
                    db().execute("UPDATE users SET disabled = ? WHERE username = ?",
                                 (int(action == "disable"), name))
                    if action == "disable":
                        db().execute("DELETE FROM sessions WHERE username = ?", (name,))
                flash(f"Account {name} {action}d.")
            elif action in ("promote", "demote"):
                with db():
                    db().execute("UPDATE users SET is_admin = ? WHERE username = ?",
                                 (int(action == "promote"), name))
                flash(f"{name} {'can now' if action == 'promote' else 'can no longer'} manage accounts.")
            elif action == "delete":
                with db():
                    db().execute("DELETE FROM users WHERE username = ?", (name,))
                flash(f"Account {name} deleted. Its exam projects are still in MC-Projects/{name}.")
            else:
                abort(400)
        if revealed is None:
            return redirect(url_for("admin"))
    users = db().execute(
        "SELECT username, is_admin, disabled, must_change, created_at, last_login"
        " FROM users ORDER BY username").fetchall()
    return render_template("admin.html", users=users, me=me, user=me, revealed=revealed)


@app.template_filter("when")
def when(ts):
    return time.strftime("%Y-%m-%d %H:%M", time.localtime(ts)) if ts else "never"


# --- command line: flask user ... -------------------------------------------

@app.cli.group("user")
def user_cli():
    """Manage accounts."""


@user_cli.command("add")
@click.argument("username")
@click.option("--admin", "make_admin", is_flag=True, help="Allow this account to manage accounts.")
@click.option("--temporary", is_flag=True,
              help="Generate a starting password to change at first sign-in.")
def user_add(username, make_admin, temporary):
    """Create an account."""
    name = username.strip().lower()
    if problem := username_problem(name):
        raise click.ClickException(problem)
    if get_user(name):
        raise click.ClickException(f"An account named {name} already exists.")
    if temporary:
        password = new_password()
    else:
        password = click.prompt(f"Password for {name}", hide_input=True, confirmation_prompt=True)
        if problem := password_problem(password, name):
            raise click.ClickException(problem)
    create_user(name, password, make_admin, must_change=temporary)
    click.echo(f"Account {name} created{' (can manage accounts)' if make_admin else ''}.")
    if temporary:
        click.echo(f"Starting password: {password}")


@user_cli.command("passwd")
@click.argument("username")
def user_passwd(username):
    """Set an account's password (signs it out everywhere)."""
    name = username.strip().lower()
    if not get_user(name):
        raise click.ClickException(f"There is no account named {name}.")
    password = click.prompt(f"New password for {name}", hide_input=True, confirmation_prompt=True)
    if problem := password_problem(password, name):
        raise click.ClickException(problem)
    set_password(name, password, must_change=False)
    click.echo(f"Password for {name} changed.")


@user_cli.command("list")
def user_list():
    """List accounts."""
    rows = db().execute("SELECT * FROM users ORDER BY username").fetchall()
    if not rows:
        click.echo("No accounts yet.")
    for r in rows:
        flags = [f for f, on in (("admin", r["is_admin"]), ("disabled", r["disabled"]),
                                 ("must change password", r["must_change"])) if on]
        click.echo(f"{r['username']:<24} last sign-in: {when(r['last_login']):<17} {', '.join(flags)}")


@user_cli.command("count")
def user_count():
    """Print the number of accounts."""
    click.echo(db().execute("SELECT COUNT(*) FROM users").fetchone()[0])


@user_cli.command("enable")
@click.argument("username")
def user_enable(username):
    """Re-enable a disabled account."""
    with db():
        n = db().execute("UPDATE users SET disabled = 0 WHERE username = ?",
                         (username.strip().lower(),)).rowcount
    if not n:
        raise click.ClickException(f"There is no account named {username}.")
    click.echo(f"Account {username} enabled.")
