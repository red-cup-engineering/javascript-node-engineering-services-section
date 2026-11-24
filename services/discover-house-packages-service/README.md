# discover-house-packages-service

`discoverHousePackages(root)` maps each scoped package name to the directory whose manifest holds it,
from the manifests that actually exist (no registry is maintained). A name owned twice goes to its
non-legacy, shallowest directory; the other directories are reported as duplicates.
