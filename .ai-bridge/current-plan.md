# YNX AI current plan

Status: active. Current phase: autonomous migration, backup/restore, and compatibility hardening.

Protected remote checkpoints:

- Gateway/provider error semantics: `2678a8b0cf3f9463ec7fc205caab486993bf5f18`
- Frozen integration contract: `b066b65aac8c8b197ab9b38659e937e73544daf1`
- Product AI Registry enforcement: `8c7af8d2509a1a0dc2f7d306b0f9c7c5c43ff154`
- Dependency and capacity remediation: `1cfc0c5085032a3a83745a8e65879d87aa223c63`
- Truthful observability and SLO evidence: `906478672995242972842d3cf6af6d9c66da3cab`

Latest verified gates:

1. `go test -count=1 ./internal/aiproduct`
2. `go test -race -count=1 ./internal/aiproduct`
3. `go vet ./internal/aiproduct ./apps/ai`
4. `node apps/ai/scripts/release-check.mjs`
5. `go test ./...`
6. Targeted AI `govulncheck`: 0 reachable vulnerabilities under Go 1.25.12.

Exact next autonomous slice:

1. Define a bounded versioned encrypted-state backup manifest.
2. Implement atomic backup creation and restore validation without plaintext or key material.
3. Reject wrong product, schema, checksum, key, truncation, replay, and incompatible rollback.
4. Add restart/restore/tamper/rollback/audit-continuity tests.
5. Publish `apps/ai/MIGRATION_COMPATIBILITY.md` with honest local and staged evidence boundaries.
6. Run all product, race, vet, Release Gate, full-Go, and vulnerability gates.
7. Commit, push, verify local and remote equality, then update recovery evidence.

Central Wallet acceptance, Provider credentials, canonical billing/tokenomics, staging/public deployment, iOS signing/runtime, Website deployment, and shared Testnet remain cross-owner inputs. They do not block this autonomous slice.
