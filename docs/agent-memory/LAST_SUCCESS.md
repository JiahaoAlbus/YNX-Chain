# YNX Seller Console Last Success

## Runtime checkpoint

- Commit: `a90d1ee59eec38c15ce42b39420f2625ed758dd0`
- Branch: `codex/final-seller-console`
- Push: successful
- Local/Remote equality after push: verified

The checkpoint added:

- owner-only store-scoped Seller data portability exports;
- audited export access and deep-copy isolation;
- preview-first transient retention with a 30-day minimum cutoff;
- explicit confirmation and integrity-key requirement for retention pruning;
- protected orders, settlement/refund evidence, Seller authority records, Outbox, Audit, idempotency, buyer profiles and carts;
- CLI preview/apply controls;
- HTTP and restart tests.

## Evidence checkpoint

- Commit: `365318525937cb0b0c69f19ac7859094bc2e7cbe`
- Push: successful
- Local/Remote equality after push: verified

The evidence checkpoint:

- corrected stale source bindings left at `937cf10f` and older checkpoints;
- documented Snapshot v6 future-version refusal and bounded rollback export;
- added data-lifecycle contract and vectors;
- added `MIGRATION_COMPATIBILITY.md`;
- created current-source public metadata and Owner 28 Website handoff for `ynxweb4.com`;
- created minimum operator-input requests;
- kept deployment, central integration, release and public status false where direct evidence is absent.

## Verification

- `go test ./internal/commerce/...`: passed.
- `go test -race ./internal/commerce`: passed with a non-failing macOS linker warning.
- `go vet ./internal/commerce/...`: passed.
- `npm test` in `apps/seller-console`: passed.
- `npm run build` in `apps/seller-console`: passed.
- Release/integration/public JSON documents parsed successfully.
