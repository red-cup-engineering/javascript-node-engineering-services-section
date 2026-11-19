# @red-cup-engineering/jsnode-computer

Node workspace computing: reads package.json manifests into jsnode-topology carriers, discovers all workspace packages, resolves dependency structure.

## Usage

```sh
jsnode-computer --help
```

## Incremental duplication scans

`duplication` recomputes workspace package/dependency and consumer ranking on
every run. For repeated scans, opt into a disposable cache of content-addressed
per-file executable-behavior extraction results:

```sh
jsnode-computer duplication services --compact --limit 20 \
  --cache-dir .jsnode-duplication-cache
```

The cache is safe to delete. Entries are addressed by the source SHA-256,
source extension, analyzer version, and cache schema version, so stale or
corrupt entries are ignored. `.jsnode-duplication-cache/` is excluded from Git.

## Subpaths

- `@red-cup-engineering/jsnode-computer/workspace`
- `@red-cup-engineering/jsnode-computer/cli`

## Dependencies

- `@red-cup-engineering/javascript-computer`
- `@red-cup-engineering/jsnode-topology`
