# JavaScript argv parsing services section

This section owns transformations from a supplied JavaScript-host argument
vector to admitted command arguments. It does not own process execution,
standard streams, help rendering, or application-specific option policy.

The section itself is the package (`@red-cup-engineering/javascript-argv-parsing-services-section`).
Each transformation is one script under `scripts/`, exported by its own
subpath (`./parse-javascript-argv`, `./project-javascript-argv-tail`) and
carried by its own `bin` entry; a script's module is both its library face and
its CLI. A new argv-parsing transformation is a new script here, never a new
sibling package.
