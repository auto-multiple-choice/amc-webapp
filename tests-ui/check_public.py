"""Checks of the public address (./amc public on), without a browser.

It runs inside the amc-auth container and talks to caddy's tunnel site
(caddy:8091) the way cloudflared does, so it needs no Cloudflare and works
on a test copy as well as on the server:

    docker compose exec -T amc-auth python - HOST < tests-ui/check_public.py

HOST is AMC_PUBLIC_HOST (e.g. amc.example.org). It makes a temporary account,
checks that:
- a visitor must sign in, and a browser can't claim a user with X-AMC-User;
- failed sign-ins are counted per visitor address (CF-Connecting-IP), and
  X-Forwarded-For sent by the browser is ignored;
- the app's live connection (socket.io) accepts https://HOST as origin and
  refuses others;
- pages and files are marked private for caches, static files aren't;
- other host names get nothing from the tunnel site;
then deletes the account.
"""

import http.client
import re
import secrets
import sys

sys.path.insert(0, "/app")
import app as auth  # noqa: E402  (the sign-in service's own module)

HOST = sys.argv[1] if len(sys.argv) > 1 else ""
if not HOST:
    sys.exit("Usage: python - HOST < check_public.py")

ORIGIN = f"https://{HOST}"
# One fixed name: the app gives each account that opens it a projects
# folder, which this container cannot remove, so at most one is left behind
# (empty; remove it with the command in doc/public-hosting.md).
USER = "check-public"
PASSWORD = secrets.token_urlsafe(12)
failures = 0
checks = 0


def check(what, ok, detail=""):
    global failures, checks
    checks += 1
    if not ok:
        failures += 1
    print(f"{'ok  ' if ok else 'FAIL'} {what}{'' if ok or not detail else ': ' + str(detail)}")


def request(method, path, ip="203.0.113.10", host=HOST, headers=None, body=None, cookies=None):
    conn = http.client.HTTPConnection("caddy", 8091, timeout=30)
    h = {"Host": host, "CF-Connecting-IP": ip, "Accept": "text/html"}
    if cookies:
        h["Cookie"] = "; ".join(f"{k}={v}" for k, v in cookies.items())
    if body is not None:
        h["Content-Type"] = "application/x-www-form-urlencoded"
    h.update(headers or {})
    conn.request(method, path, body=body, headers=h)
    r = conn.getresponse()
    data = r.read().decode("utf-8", "replace")
    set_cookies = {}
    for k, v in r.getheaders():
        if k.lower() == "set-cookie":
            name, _, rest = v.partition("=")
            set_cookies[name] = rest.split(";", 1)[0]
    conn.close()
    return r.status, dict((k.lower(), v) for k, v in r.getheaders()), data, set_cookies


def form(fields):
    from urllib.parse import urlencode
    return urlencode(fields)


def sign_in(password, ip, extra_headers=None):
    """One sign-in attempt; returns (status, body, cookies)."""
    _, _, page, cookies = request("GET", "/auth/login", ip=ip)
    m = re.search(r'name="csrf" value="([^"]+)"', page)
    csrf = m.group(1) if m else ""
    status, _, body, new = request("POST", "/auth/login", ip=ip, cookies=cookies, headers=extra_headers,
                                   body=form({"csrf": csrf, "next": "/", "username": USER, "password": password}))
    cookies.update(new)
    return status, body, cookies


with auth.app.app_context():
    with auth.db():  # left over from an interrupted run
        auth.db().execute("DELETE FROM users WHERE username = ?", (USER,))
    auth.create_user(USER, PASSWORD, False, must_change=False)

try:
    # Sign-in is required, and a browser can't claim to be someone.
    status, h, _, _ = request("GET", "/")
    check("A visitor is sent to the sign-in page", status in (302, 303) and "/auth/login" in h.get("location", ""), status)
    status, h, _, _ = request("GET", "/", headers={"X-AMC-User": USER, "X-AMC-Admin": "1"})
    check("X-AMC-User from a browser is ignored", status in (302, 303) and "/auth/login" in h.get("location", ""), status)

    # Failed sign-ins are counted per visitor, not per tunnel.
    spoof = {"X-Forwarded-For": "198.51.100.99"}
    for _ in range(auth.FailedSignIns.PER_ACCOUNT):
        sign_in("wrong-password", "203.0.113.20", spoof)
    _, body, _ = sign_in("wrong-password", "203.0.113.20", spoof)
    check("Repeated failures lock that visitor out", "Too many failed attempts" in body)
    _, body, _ = sign_in("wrong-password", "203.0.113.30", spoof)
    check("...but not another visitor (and the browser's X-Forwarded-For is ignored)",
          "Wrong username or password" in body)
    status, _, cookies = sign_in(PASSWORD, "203.0.113.30")
    check("The other visitor signs in", status in (302, 303) and auth.COOKIE in cookies, status)
    session = {auth.COOKIE: cookies.get(auth.COOKIE, "")}

    # The app's live connection accepts the public origin only.
    poll = "/socket.io/?EIO=4&transport=polling"
    status, _, body, _ = request("GET", poll, cookies=session, headers={"Origin": ORIGIN, "Accept": "*/*"})
    check(f"The live connection accepts {ORIGIN}", status == 200 and body.startswith("0{"), f"{status} {body[:80]}")
    status, _, _, _ = request("GET", poll, cookies=session, headers={"Origin": "https://evil.example", "Accept": "*/*"})
    check("...and refuses another origin", status == 400, status)

    # Caches: private pages, cacheable static files.
    status, h, page, _ = request("GET", "/", cookies=session)
    check("The app opens once signed in", status == 200 and "<title>" in page, status)
    check("Pages are private for caches", h.get("cache-control") == "private, no-cache", h.get("cache-control"))
    status, h, _, _ = request("GET", "/fs/no-such-exam/DOC-sujet.pdf", cookies=session, headers={"Accept": "*/*"})
    check("Exam files are private for caches", h.get("cache-control") == "private, no-cache", h.get("cache-control"))
    m = re.search(r'(/static/[^"\']+\.(?:css|js))', page)
    if m:
        status, h, _, _ = request("GET", m.group(1), cookies=session, headers={"Accept": "*/*"})
        check("Static files stay cacheable", status == 200 and "private" not in h.get("cache-control", ""),
              f"{status} {h.get('cache-control')}")
    else:
        check("The page links a static file", False)

    # Only the public host name is served.
    status, _, body, _ = request("GET", "/auth/login", host="other.example")
    check("Another host name gets nothing", "Sign in" not in body, status)
finally:
    with auth.app.app_context():
        with auth.db():
            auth.db().execute("DELETE FROM users WHERE username = ?", (USER,))

print(f"{checks} checks, {failures} failed")
sys.exit(1 if failures else 0)
