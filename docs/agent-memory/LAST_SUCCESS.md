# YNX Calendar last success

At 2026-07-29T02:50:09Z, runtime source `b00f32da16218edb90fcc9f9b504607e374077ce` was committed and pushed to `origin/codex/final-calendar`. Local and remote branch SHAs were equal.

The runtime checkpoint provides:

- explicit Calendar state payload schema version 1;
- authenticated legacy schema-zero compatibility and future-schema fail-closed behavior;
- deterministic HMAC-authenticated backup with state SHA-256;
- isolated restore that never overwrites live state;
- rejection of tamper, wrong product, incompatible version, stale/future time, absolute/path escape, symbolic-link traversal and existing targets;
- operator backup/restore CLI;
- passing Go, Race, Vet, Web, build, smoke and browser gates;
- a successful local backup/restore drill with matching digest and live state unchanged.

The current uncommitted evidence slice binds that runtime SHA to release records, integration vector CAL-X-013, Website route-fallback evidence, operations, migration, observability, SLO/capacity, unit economics and agent recovery files.
