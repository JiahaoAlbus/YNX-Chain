# YNX Docs Current Plan

Status: ACTIVE  
Phase: PROTECT → FREEZE  
Runtime source commit: `376d8a42a641cf312d2b7330af0ed8566371c2e5`

## Protected slice

- Docs-only Wallet and scope boundary is fail-closed across object, folder subtree, permission, audit and AI operations.
- Document/folder rename, move and duplicate are implemented; duplicate is atomic on persistence failure and does not copy ACLs, comments or links.
- Versioned Text, Markdown, HTML and JSON export emits source/output hashes and audit evidence.
- Version-bound comment anchors, threads, replies, resolve and reopen are implemented with tamper checks.
- State schema v1 migrates to v2 without bypassing the stored integrity hash.
- Production Web entry no longer contains the prior loopback development-signature path.
- Trust evidence JSON fields are distinct and covered by remote-payload tests.

## Verification retained

- `go test ./internal/cloud -count=1` — pass.
- `go test -race ./internal/cloud -count=1` — pass.
- `go vet ./internal/cloud` — pass.
- `npm --prefix apps/docs test` — 3/3 pass.
- `npm --prefix apps/docs run check` — pass.
- `pnpm run check` in `apps/docs/mobile` — TypeScript, Wallet test, 12-locale/RTL audit and Android+iOS Expo export pass.
- `go test ./...` — blocked by pre-existing, out-of-scope failures in consensus key-permission tests, missing Devtools contract artifacts, faucet key-permission tests and Trust signer-permission tests. Do not suppress or repair those modules from this worktree.

## Immediate next actions

1. Freeze `release/integration/docs-contract.json` and cross-product vectors with exact Wallet tuple, scopes, event names and error semantics.
2. Add deterministic collaboration bake-off and decide server-serialized revision versus CRDT/OT/offline merge.
3. Implement restart/backup/restore and old-client/rollback migration drills.
4. Complete Web share/revoke/trash inspectors and mobile parity for object/comment/export operations.
5. Add structured ready/version/log/metrics/trace support and bounded load measurements.
6. Generate SBOM, provenance and retained release artifacts only after YNX 30 release policy acceptance.
7. Execute shared Testnet E2E after Wallet/Cloud/AI/Trust/Gateway contracts are accepted.

The protected checkpoint is not product completion.
