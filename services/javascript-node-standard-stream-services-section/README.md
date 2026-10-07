# JavaScript Node standard-stream services section

This section owns the primitive effects that move text across Node.js standard
streams. Parsing, serialization, and application policy remain separate
transformations.

Each service has one implementation module and one operation. The input reader
uses that module as both package export and command. The output writer is
intentionally import-only: standard output is the effect target, so it cannot
also carry an NDJSON receipt without mixing two protocols on one stream.
