# JavaScript Node command execution services section

This section owns execution of one explicitly addressed program with an
explicit argument vector and working directory. Shell-language parsing,
command admission policy, and domain-specific success judgments belong to
other services.

Each child service has one executable implementation module addressed by both
its package `exports` and `bin`. The directory is taxonomy and documentation;
it is not itself a package and does not wrap its child services in a registry.
