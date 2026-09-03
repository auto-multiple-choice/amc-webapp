# AMC server environment variables

The following environment variables can be used for configuring the AMC server.

## User handling

>>> [!warning]
The AMC server don't handle authentification and session
management: you must use a reverse proxy that can restrict access to
the AMC web app.
>>>

### Single-user mode

If the `AMC_USERHEADER` environment variable is not set, then the AMC
server runs in single-user mode: a single user should be allowed to
use the server.

### Multiple-users mode

If the `AMC_USERHEADER` environment variable is set, then the AMC
server runs in multiple-user mode: different users can access the
server, and only admins can see other users projects.

>>> [!important]
You must set a reverse-proxy which handle authentification,
and pass a HTTP header named as the value of the `AMC_USERHEADER`
environment variable containing the user name.
>>>

The comma-separated list of admins is passed as the content of the
`AMC_ADMINS` environment variable.

## Directories

`AMC_PROJECTSDIR`: see the [directory structure documentation](directories.md).

## Security

When preparing the documents (eg. the PDF subject), AMC calls LaTeX
and possibly other commands (such as python when using PythonTeX). All
the projects of all users are stored under the same linux user
(running the server), so that all users can get read and write access
to all projects from other users.

While this can be acceptable when you trust all users, you can also
isolate the application users to their projects in two ways:

* You can restrict the set of LaTeX engines that can be used by the
  users listing the allowed ones (separated by commas) in the
  `AMC_LATEX_ENGINES` environment variable. Something like
  `AMC_LATEX_ENGINES=pdflatex,xelatex,lualatex` should avoid
  user-supplied commands execution.

* You can use `AMC_ISOLATE=1` to isolate the preparation process so
  that all commands run while preparing documents have only access to
  the user's projects. This option is set by default in the
  multiple-users mode, however you can use the value `0` to disable
  isolation…  at your own risks!

  Depending on the installation, you may have to set the list of
  folders to give access to for documents preparation. This can be
  done using the `AMC_ISOLATE_*` environment variables, with the
  following default values: `AMC_ISOLATE_ROX=/usr,/bin` (allow access
  to read and execute), `AMC_ISOLATE_RW=/dev/shm,/dev/null` (allow
  access to read and write) and
  `AMC_ISOLATE_RO=/var/lib,/lib,/lib64,/etc/texmf` (allow access to
  read only).

## Fonts

The default font used for AMC-TXT projects can be set in the
`AMC_TXT_DEFAULTFONT` environment variable.

## Printing

To be able to print directly from the AMC server to printers, pass the
CUPS server name to be used in the `CUPS_SERVER` environment variable.

## Templates

If you want to show a custom templates list to all users, prepare them
in a directory and pass this directory in the `AMC_TEMPLATES_DIR`
environment variable.

## Manifest

Set the `PREFERRED_URL_SCHEME` to the scheme to be used to access the
server from outside (eg. `https`). This will only be used in the
*manifest*, that allows users to install the AMC server as a webapp
easily.

## Cleaning temp files

The AMC server will clean old temporary files each day at a time
specified in hours in the `AMC_TEMP_CLEAN_H` environment variable
(defaulting to 3, that is 03:00AM). The time zone used for this time
can be specified in the `TZ` environment variable.

