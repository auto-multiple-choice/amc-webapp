# AMC web application
This project allows to work with your [Auto Multiple Choice (AMC)](https://www.auto-multiple-choice.net) projects through a web browser instead of the Gtk GUI integrated with AMC.

## Local installation

### Prerequisites
- A working installation of a very recent version of AMC
- python3
- git, make, terser

### Installation
First clone this project:
```sh
git clone https://gitlab.com/a10684/amc-webapp.git
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
> The server don't handle authentification and session management: you must use a reverse proxy that can restrict access to the AMC web app. Anyone that can use the web app can execute any command on the server, delete all other's work, etc. Give only access to the server to persons you trust.

You can go as for local installation, adding `-h 0.0.0.0` to the `flask` command so that the server can be accessed from your reverse proxy.

You can also use a docker container, built from the `Dockerfile` that installs AMC and the server together.

### Configuration

Some [environment variables](doc/environment.md) can be used to
configure your server.
