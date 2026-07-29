# YNX Docs Current Plan

Status: ACTIVE
Phase: PROTECT → central FREEZE review
Runtime source commit: `3c404c4f4d2c9967e660882349a19c94aebd08f1`

## Protected runtime slices

- Docs-only Wallet and product boundaries fail closed across objects, folder subtrees, permissions, audit and AI operations.
- Rename, move and duplicate are implemented; duplicate is atomic on persistence failure and does not copy ACLs, comments or links.
- Versioned Text, Markdown, HTML and JSON export emits source/output hashes and audit evidence.
- Version-bound comment anchors, threads, replies, resolve and reopen include tamper checks.
- State schema v1 migrates to v2 without bypassing the stored integrity hash.
- Local backup/restore verifies state and immutable object hashes while excluding sessions, nonces and presence.
- Runtime observability now includes health, readiness, version, Prometheus metrics, build identity, structured request logs, and request/trace/error correlation IDs.
- Production Web entry does not contain the prior loopback development-signature path.
- Trust evidence JSON fields are distinct and covered by remote-payload tests.

## Verification retained

- `go test ./internal/cloud -count=1` — pass at runtime source commit.
- `go test -race ./internal/cloud -count=1` — pass at runtime source commit.
- `go vet ./internal/cloud` — pass at runtime source commit.
- `go test ./apps/cloud/cmd/ynx-cloudd` — pass at runtime source commit.
- `npm --prefix apps/docs test` — 3/3 pass on prior protected slice.
- `npm --prefix apps/docs run check` — pass on prior protected slice.
- `pnpm run check` in `apps/docs/mobile` — TypeScript, Wallet test, 12-locale/RTL audit and Android+iOS Expo export pass on prior protected slice.
- `go test ./...` remains blocked by pre-existing failures owned by central modules; YNX 35 must not suppress or repair them from this worktree.

## Immediate next actions

1. Submit `release/integration/docs-contract.json` and `DOCS-OBSERVABILITY-IDENTITY` to YNX 13/29/30 for schema freeze, dashboard ingestion and alert probes.
2. Add deterministic collaboration bake-off evidence and freeze server-serialized revisions versus CRDT/OT/offline merge.
3. Add rollback migration, old-client compatibility and corrupted-migration recovery drills.
4. Complete Web share/revoke/trash inspectors and mobile parity for object/comment/export operations.
5. Add bounded load measurements, SLO/capacity plan and operational RPO evidence.
6. Generate retained SBOM, provenance and scanned release artifacts only through accepted YNX 30 policy.
7. Execute shared Testnet E2E only after Wallet/Cloud/AI/Trust/Gateway contracts are accepted.

This checkpoint is not product completion and does not establish public deployment.
