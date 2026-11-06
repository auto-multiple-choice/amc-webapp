# AMC web application
This project allows to work with your [Auto Multiple Choice (AMC)](https://www.auto-multiple-choice.net) projects through a web browser instead of the Gtk GUI integrated with AMC.

## This copy

This is our own version of the AMC team's web app (https://gitlab.com/auto-multiple-choice/amc-webapp), with:

- a one-command launcher: `./amc start` (macOS, Linux) or `amc.cmd start` (Windows) builds the Docker image, starts the app at http://localhost:8090 and opens it. `./amc help` lists the other commands (stop, update, import, backup...). Settings are in `.env`, explained in `.env.example`.
- a shared-machine mode (`./amc login on`): sign-in with accounts, HTTPS, one projects folder per teacher, and direct printing on Linux (`./amc printer on`).
- a new interface built around the ten steps of an exam, from the questions to the annotated sheets. The plan and decisions are in `doc/ui-redesign-plan.md`; its tests are in `tests-ui/` (see `tests-ui/README.md`).

The rest of this file is the AMC team's documentation for running the server without the launcher.

## Local installation

### Prerequisites
- A working installation of a very recent version of AMC
- python3
- git, make, terser

### Installation
First clone this project:
```sh
git clone https://gitlab.com/auto-multiple-choice/amc-webapp.git
```
Install the python dependencies in a virtual environment:
```sh
python3 -m venv venv
. venv/bin/activate
pip3 install -r requirements.txt
```
Build the translations files and ACE mode:
```sh
make
```
Run the server:
```sh
cd server
flask --app amc run
```
Connect you browser to http://locahost:5000

## Web server

> [!warning]
> The server don't handle authentification and session management: you must use a reverse proxy that can restrict access to the AMC web app.

You can go as for local installation, adding `-h 0.0.0.0` to the `flask` command so that the server can be accessed from your reverse proxy.

You can also [use a docker container](doc/docker.md), built from the `Dockerfile` that installs AMC and the server together.

### Configuration

Some [environment variables](doc/environment.md) can be used to
configure your server.
