# PNPM native policy receiving

PNPM owns native dependency selection and effective age policy. The proposed
PNPM Engineering package and first-party eligibility classifier remain separate
unadmitted work; this existing section's test exercises the supported PNPM CLI.

The publication command must not change age policy when choosing an isolated
cache. Its native regression supplies the existing publication command projection,
PNPM 11.28.5, loopback metadata and a child-local controlled clock. It observes
Organizing 0.3.4 immediately before and after 1,440 minutes, under strict project
policy, and checks refusal/lock selection plus unchanged manifest and policy.
Metadata is synthetic; no actual supplier tarball or live consumer is installed.

Run from the Code repository with an explicitly qualified native tool and the
publication owner under review:

```sh
QUALIFIED_PNPM_ENTRY=/qualified/pnpm/bin/pnpm.mjs \
PUBLICATION_COMMAND_MODULE=/publication/src/package-manager.mjs \
node --test --test-concurrency=1 test/pnpm-native-release-age.test.mjs
```

The existing Code `test/**/*.test.mjs` runner discovers the same test. Without
both explicitly supplied providers it skips, rather than selecting ambient tools
or reporting native policy receiving. This assay does not qualify the proposed
first-party classifier or establish FeltOS's complete installed closure.
