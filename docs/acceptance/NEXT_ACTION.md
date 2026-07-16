# Next Action

Highest-priority bounded delivery (2026-07-16):

Current single action: commit the locally verified upgrade source-release gate, collect a fresh four-node source manifest/binary audit bound to that exact target, and if the restricted gate passes, deploy the follower-replication, snapshot-v2 integrity, and fault-monitoring release through the ordinary authoritative path, followers first and primary last. Then prove v2 persistence, fresh exact convergence, and alertable recovery on all three followers before and after one bounded follower restart.

Why this is next:

- The public chain still depends on one producer and three authenticated read-only followers while the approval-gated BFT transition remains intentionally inactive.
- Current source now exposes the real replication lifecycle, `catchingUp`, freshness, exact source/local height and hash, lag, attempts, successes, failures, timestamps, bounded error evidence, Prometheus telemetry, alerts, and Grafana panels.
- Current source now also seals the complete authoritative snapshot as v2, durably syncs replacement, permits one marker-free v1 migration, rejects later downgrade/corruption, and restores in-memory state when replication persistence fails.
- Local lifecycle, degraded recovery, persisted-state restart, exact convergence, race, smoke, and verification checks pass. Pinned Prometheus rule tests now prove that degraded, prolonged catch-up, lag, and consecutive-failure alerts fire after their configured hold time and clear after recovery.
- This source is not yet deployed. A later 2026-07-16 read-only cycle observed public block growth and successful strict SSH on all four roles, including recovered Seoul access. The public release remains `0d31850f74b2`; exact-release mismatch and the absent not-yet-installed target manifest kept mutation blocked. The new local source-release audit closes that sequencing gap without weakening runtime or connectivity gates.

Files to touch:

- `internal/chain`, `cmd/ynx-chaind`
- `scripts/deploy`, `scripts/verify`
- API, operations, and acceptance documentation only after matching evidence exists

Required execution and proof:

- Run `upgrade-source-release-audit` against fresh strict-SSH evidence and require every role's live source release, installed manifest, and `ynx-chaind` checksum to match before the restricted deployment-readiness gate.
- If the gate passes, create scoped backups including `devnet-state.json` and `devnet-state.integrity-version`, deploy and verify the three followers first, and deploy the primary last without starting any BFT transaction phase.
- Require every upgraded role to persist snapshot v2 plus the exact integrity marker; treat any digest, marker, or migration error as a stop condition and preserve rollback evidence.
- Require each follower to report `status=synced`, `catchingUp=false`, `fresh=true`, and exact source/local height and hash equality.
- Configure and verify one protected or node-local Prometheus scrape target for each follower without exposing RPC or replication credentials.
- Restart one follower only, verify it first returns to a catching-up lifecycle, then require a newly authenticated exact equality result.
- During the controlled interruption, prove the expected follower alert becomes observable and clears after recovery.
- Verify public block growth and transaction/receipt continuity after the restart.
- If ingress or SSH remains unsafe, record the external blocker and continue local chain/BFT engineering without claiming remote proof.

Validation commands:

- `go test ./...`
- `go test -race ./internal/chain ./cmd/ynx-chaind`
- `make validator-peer-readiness-check`
- `make monitoring-check`
- `make replication-alert-check`
- `make deploy-source-integrity-check`
- `make verify-testnet-check`
- `make replication-compression-check`
- `make smoke-test`
- `make test`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `GOMAXPROCS=2 make preflight`
- `make objective-state-check`

Completion standard:

- Exact release identity and scoped backup evidence exist on all four authoritative roles.
- Every role has persisted a valid snapshot v2 and downgrade marker without losing the pre-upgrade backup.
- All followers expose fresh exact source/local equality, and one follower repeats it after a controlled restart.
- All three follower scrape targets are protected, distinguishable, and produce one observed-and-cleared controlled interruption alert.
- Public chain growth and transaction/receipt continuity remain intact.
- No BFT cutover, mainnet launch, exchange listing, issuer support, wallet default support, partnership, or independent proof is inferred.

Explicitly not doing:

- Do not execute any BFT freeze, signer installation, dependency transition, ingress cutover, or public rollback phase without the required external approval.
- Do not expand bounded EVM/IDE except to preserve passing tests.
- Do not merge product branches out of dependency order.
- Do not modify or replace the long-term goal file.
