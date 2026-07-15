# AMC server directories structure

This file explains where you can find the files handled by AMC.  In
the following, 

* `~` denote the home directory of the user that runs the server.

* `$PROJECTSDIR` is the content of the environment variable
  `AMC_PROJECTSDIR`, or, if unset, `~/MC-Projects`.

## Single-user mode

When running in single-user mode (environment variable `AMC_USERHEADER` not set):

* The projects directories for the current user can be found in the
  directory `$PROJECTSDIR`.

* The AMC user configuration files (including global configuration)
  are stored in the `~/.AMC.d/` directory.
  
## Multiple-users mode

When running in multiple-users mode, the user name is passed to the
server in HTTP header which name is the value of the `AMC_USERHEADER`
environment variable. This user name is written `$USER` in the
following. If the HTTP header is wmpty, `$USER` is set to `_all`.

If the user name can be found in the comma-separated list provided as
the environment variable `AMC_ADMINS`, then the user is an *admin*.

* The projects directories for the current user can be found in the
  directory `$PROJECTSDIR/$USER/`.

* The AMC user configuration files (including user-specific global
  configuration) are stored in the `$PROJECTSDIR/$USER/_config` directory.
  If this directory does not exist, it is created and the content of
  `$PROJECTSDIR/_default_config` is (recursively) copied to it.
  
* CSV students lists that can be found in the
  `$PROJECTSDIR/_shared_lists` directory will be made available to all
  users: they will be able to copy them easily to any project (and
  then modify these copies if needed).
