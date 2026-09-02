# Docker

This project builds two docker images: `amc-webapp/main` (with the
main LaTeX packages) and `amc-webapp/full` (with all LaTeX packages).

Please see [this page](environment.md) the meaning of all environment
variable that can be used for configuring the AMC server.

## Single-user mode local server

### Building the image and using docker-compose

You can build locally the docker image and run it with
```sh
git clone https://gitlab.com/auto-multiple-choice/amc-webapp.git
cd amc-webapp
docker compose up -d
```
Then go to http://localhost:8001

### Using the project image

If your home directory is `/home/jojo` and your user id and group id
are 1000, you can launch the AMC server locally using the following
docker command. Upon startup, just go to http://localhost:8000 on your
favorite browser.

```sh
docker run -u 1000:1000 -v /home/jojo/.AMC.d:/amc-web/files/.AMC.d  -v /home/jojo/MC-Projects:/amc-web/files/MC-Projects -p 127.0.0.1:8000:5000 registry.gitlab.com/auto-multiple-choice/amc-webapp/full
```

## Multiple-users mode public server

To setup a public server for different users, several continers can be used:

* a reverse proxy (eg. traefik) with an authentification middleware (eg. tinyproxy).

* a CUPS server for printing.

* the AMC server container.

Dwnload an tweak the sample [compose.yaml](compose.yaml) file, lauch
the containers with `docker compose up -d` and go to
http://amc.example.com on your favorite browser.

