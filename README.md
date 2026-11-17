# AMC web application

Run your [Auto Multiple Choice (AMC)](https://www.auto-multiple-choice.net) exams from a web browser: write the questions, build and print the papers, read the scans, mark, and return the annotated sheets.

This is a version of the AMC team's [web app](https://gitlab.com/auto-multiple-choice/amc-webapp) with a one-command launcher, sign-in for shared machines and a new interface.

## Quick start

You need [Docker](https://docs.docker.com/get-docker/) and git. You don't need AMC or LaTeX: the app builds both inside its Docker image.

macOS and Linux:

```sh
git clone https://gitlab.com/rjanain/amc-webapp.git && cd amc-webapp && ./amc start
```

Windows:

```bat
git clone https://gitlab.com/rjanain/amc-webapp.git
cd amc-webapp
.\amc.cmd start
```

The first start builds the image (about 4 GB; keep 15 GB of disk free) and takes 10 to 30 minutes. Later starts take seconds. The app opens at http://localhost:8090, and your exams are kept in `AMC-Web/MC-Projects` in your home folder.

From then on, `./amc start` is the only command you need.

## Commands

On Windows, type `.\amc.cmd` in place of `./amc`.

| Command | What it does |
|---|---|
| `./amc start` | Build if needed, start the app and open it in the browser |
| `./amc stop` | Stop the app; exams are kept |
| `./amc status` | Show whether the app is running, and where |
| `./amc update` | Pull the latest version, then restart |
| `./amc import <folder>...` | Copy existing AMC project folders into the app |
| `./amc backup` | Save all exams to `AMC-Web/backups` |
| `./amc help` | List every command |

Settings (port, data folder, time zone) are in `.env`, written on the first start and explained in [.env.example](.env.example). Run `./amc restart` after editing it.

## Several teachers

- **Shared machine.** `./amc login on` adds sign-in, HTTPS and one projects folder per teacher, and asks for the first admin account. The admin adds the other teachers on the Admin page. On Linux, `./amc printer on` lets the app print directly.
- **Public server** (Linux). `./amc public on amc.example.org` serves the app at a web address through a Cloudflare Tunnel. The steps are in [doc/public-hosting.md](doc/public-hosting.md).

## What this version adds

- Ten steps, from Questions to Annotate, with a preview panel beside the work.
- Questions as forms or LaTeX, sections, and a paper builder with an OMR answer sheet.
- Version history: every save is a version to compare and restore, and deleted exams go to a trash.
- Question banks for each instructor, with statistics after marking.
- Marks exported as CSV or ODS, and annotated sheets emailed to students.

The full list is in [doc/features.md](doc/features.md).

## Without Docker

Only this way needs AMC on the machine, and a newer AMC than release 1.7.0: the app uses the `auto-multiple-choice db` command, added after it. Build AMC from [its source](https://gitlab.com/auto-multiple-choice/auto-multiple-choice). You also need Python 3, git, make, uglify-js and qpdf.

```sh
git clone https://gitlab.com/rjanain/amc-webapp.git
cd amc-webapp
python3 -m venv venv
. venv/bin/activate
pip3 install -r requirements.txt
make
cd server
flask --app amc run
```

Then open http://localhost:5000. The template gallery has no previews this way; the [Dockerfile](Dockerfile) shows every step of a full installation.

> [!warning]
> Run this way, the server has no sign-in: anyone who can reach its port can use it. Keep it on your own computer, or put it behind a reverse proxy that handles sign-in, as `./amc login on` does.

## Documentation

- [doc/features.md](doc/features.md): what this version adds, and where exams, banks and history are kept.
- [doc/public-hosting.md](doc/public-hosting.md): a public server step by step, with accounts, updates and backups.
- [doc/environment.md](doc/environment.md) and [doc/directories.md](doc/directories.md): the AMC team's notes on the server's environment variables and folders.
- [tests-ui/README.md](tests-ui/README.md): the tests.
- In the app, the Guide has one page per step.

## Licence

[GNU AGPL version 3](https://www.gnu.org/licenses/agpl-3.0.html). The AMC team holds the copyright of the original web app, and Rakesh Jana of this version's changes. The bundled libraries are listed in [LICENSE.md](LICENSE.md).
