# Public server

How to run the app at a web address such as `https://amc.example.org`, on a Linux server, through a Cloudflare Tunnel. It is shared-machine mode (sign-in, one projects folder per teacher, the LaTeX sandbox) with Cloudflare in front.

```
browser ─HTTPS─> Cloudflare ═tunnel═> cloudflared ─HTTP─> caddy:8091 ─> amc-auth  (sign-in)
                                                                    └─> amc-web   (AMC)
```

- `cloudflared` connects out to Cloudflare, so the server opens no port for the app and its address stays private. Cloudflare provides the HTTPS certificate browsers trust.
- `compose.tunnel.yml` adds `cloudflared`, Caddy's tunnel site (`caddy/tunnel/site.caddy`) and memory/processor limits for the app. `./amc public on` adds it to `COMPOSE_FILE` in `.env`.
- Caddy's own HTTPS port (`AMC_PORT`, 8090) stays on `127.0.0.1`: the launcher checks the app through it, and an admin can reach it over SSH (`ssh -L 8090:localhost:8090 server`, then `https://localhost:8090`).

## What the server needs

- Linux with Docker and Docker Compose 2.24.4 or newer.
- A kernel with Landlock (Linux 5.13+, enabled; Ubuntu 22.04 and 24.04 have it). It keeps teachers' LaTeX away from each other's projects. `./amc start` checks it and stops if it is missing. On a VPS, that means a KVM plan, not OpenVZ.
- About 2 GB of memory for the app at busy times (LaTeX, reading scans), plus swap, and 15 GB of free disk for the first build (image about 4 GB, plus build cache).
- A domain whose DNS is on Cloudflare.

## 1. Create the tunnel

From any computer with `cloudflared` signed in to the Cloudflare account (`cloudflared tunnel login`, choosing the domain's zone):

```
cloudflared tunnel create amc
cloudflared tunnel route dns amc amc.example.org
cloudflared tunnel token amc          # prints the token for the server
```

`route dns` creates the `amc.example.org` record in the zone `cloudflared tunnel login` chose. If that zone is another domain, the record is created under it (`amc.example.org.other-domain`): check in the DNS page.

Or in the dashboard: Zero Trust > Networks > Tunnels > Create a tunnel > Cloudflared. Copy the token from the install command. Add a public hostname `amc.example.org` with service `HTTP` and URL `caddy:8091`.

The token gives control of the tunnel: keep it out of chat and email.

## 2. Start the app on the server

```
git clone https://gitlab.com/rjanain/amc-webapp.git /opt/amc-webapp
cd /opt/amc-webapp
./amc public on amc.example.org      # asks for the token, builds, starts
```

The repository is private: clone it with a GitLab deploy token (Settings > Repository > Deploy tokens, scope `read_repository`), as `https://<token-user>:<token>@gitlab.com/...`. `./amc update` then pulls with it.

The first start builds the image (10–40 minutes depending on the server). Then `./amc public on` asks for the first admin's username and prints a starting password. When the server also runs other things, set the app's share in `.env` and run `./amc restart`:

```
AMC_MEMORY=1536m     # default 2g
AMC_CPUS=1.5         # default 2
```

Check it:

```
./amc public status                  # address, and whether the tunnel is connected
docker compose exec -T amc-auth python - amc.example.org < tests-ui/check_public.py
```

`check_public.py` talks to Caddy's tunnel site the way `cloudflared` does. It checks sign-in, the visitor addresses behind the tunnel, the app's live connection and cache headers, using a temporary account it deletes afterwards.

## 3. Accounts

Sign in at `https://amc.example.org` with the admin account. Open the user menu > Account, password and sign out > Admin (`/auth/admin`):

- **Add a teacher**: a username (lowercase letters, digits, `.`, `_`, `-`). Leave the starting password empty to get one generated, shown once. Send it to the teacher, who must choose their own at the first sign-in.
- **Reset password**, **Disable**, **Delete**: on each account's row. Deleting keeps the teacher's exams in the projects volume.
- **Can manage accounts** (or **Let manage accounts** on a row) makes another admin. Teachers never see each other's exams, admins included.

There is no "forgot password" email: an admin resets it. On the server, `./amc user add NAME --temporary`, `./amc user passwd NAME` and `./amc user list` do the same.

## 4. Cloudflare Access (optional)

To keep everyone but your teachers away from the sign-in page, put Cloudflare Access in front. Bots and scanners then never reach the app. Teachers sign in twice: Cloudflare first (a one-time code sent by email), then the app.

In Zero Trust > Access > Applications:

1. **Add an application > Self-hosted**: domain `amc.example.org`. Policy: action Allow, include "Emails" with the teachers' addresses, or "Emails ending in" your school's domain. Pick a session duration (a week, say).
2. If teachers use shareable marks links: a second self-hosted application for `amc.example.org/public/*`, with a policy whose action is **Bypass**, include Everyone. A more specific path wins over the first application.

Adding a teacher then takes two steps: their email in the Access policy, and their account on the Admin page.

## 5. Cloudflare limits

On the Free plan:

- **100 MB per request.** The interface sends bigger uploads (a class's scans) in 32 MB pieces (`app.js` `upload()`, `ui.py` `api_upload_part`), so this is no limit for teachers.
- **125 seconds per plain request.** Long jobs (building papers, reading scans, marking, annotating) run over the app's live connection, which isn't limited this way.
- **Caching.** Caddy marks every page and file `private, no-cache` except `/static/`, so Cloudflare doesn't keep exams or marks. Nothing to set in Cloudflare.

Leave Rocket Loader off (Speed > Optimization; off by default): it rewrites the app's scripts.

## 6. Updates and backups

```
./amc update                         # pulls our main, rebuilds if needed, restarts
./amc backup                         # projects + accounts to AMC_DATA_DIR/backups
```

A nightly backup, keeping two weeks, in the server user's crontab (`crontab -e`):

```
30 2 * * * cd /opt/amc-webapp && ./amc backup >/dev/null 2>&1 && find "$HOME/AMC-Web/backups" -name 'amc-backup-*.tar.gz' -mtime +14 -delete
```

Backups on the same server don't survive losing the server: copy them elsewhere regularly, e.g. `rsync -a server:AMC-Web/backups/ ~/AMC-Backups/`.

## Turning it off

`./amc public off` stops the public address. Sign-in stays on, and the app stays reachable on the server only. To remove the tunnel too: `cloudflared tunnel delete amc` and delete the DNS record.

## When something is wrong

| What you see | Look at |
|---|---|
| Cloudflare error 1033 (tunnel not connected) | `./amc public status`, `docker compose logs cloudflared` (wrong token?) |
| Cloudflare 502 | the app is down or starting: `./amc status`, `./amc logs` |
| The page loads but nothing happens ("connecting…") | `AMC_PUBLIC_HOST` must be exactly the address in the browser; `./amc restart` after changing it |
| An empty page | the request reached Caddy under another host name: check the tunnel's public hostname |
| Teachers locked out after wrong passwords | it lasts 15 minutes per account and visitor address; an admin can reset the password |
