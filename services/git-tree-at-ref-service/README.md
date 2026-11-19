# git-tree-at-ref-service

The repository's tracked tree at a commit, read from git objects alone: no export, no worktree, no checkout.
A submodule is read at its gitlink, from its own object store. Two views of one repository compare by blob id
(`changedPaths`), which is how a gate reads what a candidate changed without reading what it did not.
