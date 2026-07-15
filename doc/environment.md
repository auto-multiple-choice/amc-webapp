# AMC server environment variables

The following environment variables can be used for configuring the AMC server.

## User handling

>>> [!warning]
The AMC server don't handle authentification and session
management: you must use a reverse proxy that can restrict access to
the AMC web app. Anyone that can use the web app can execute any
command on the server, delete all other's work, etc. Give only
access to the server to persons you trust.
>>>

### Single-user mode

If the `AMC_USERHEADER` environment variable is not set, then the AMC
server runs in single-user mode: a single user should be allowed to
use the server.

### Multiple-user mode

If the `AMC_USERHEADER` environment variable is set, then the AMC
server runs in multiple-user mode: different users can access the
server, and only admins can see other users projects.

>>> [!note]
You must set a reverse-proxy which handle authentification,
and pass a HTTP header named as the value of the `AMC_USERHEADER`
environment variable containing the user name.
>>>

The comma-separated list of admins is passed as the content of the
`AMC_ADMINS` environment variable.

## Directories

`AMC_PROJECTSDIR`: see [this page](directories.md).

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

