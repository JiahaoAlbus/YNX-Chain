# Next Action

Highest-priority bounded delivery (2026-07-16):

Current single action: deploy the exact follower-replication-runtime release through the ordinary authoritative deployment path, then prove fresh exact convergence on all three followers before and after one bounded follower restart.

Why this is next:

- The public chain still depends on one producer and three authenticated read-only followers while the approval-gated BFT transition remains intentionally inactive.
- Current source now exposes the real replication lifecycle, `catchingUp`, freshness, exact source/local height and hash, lag, attempts, successes, failures, timestamps, and bounded error evidence.
- Local lifecycle, degraded recovery, persisted-state restart, exact convergence, race, smoke, and verification checks pass.
- This source is not yet deployed. The latest operator diagnostic found healthy source Caddy/loopback services but intermittent external TLS and subsequent SSH closure, so no fresh remote completion is claimed.

Files to touch:

- `internal/chain`, `cmd/ynx-chaind`
- `scripts/deploy`, `scripts/verify`
- API, operations, and acceptance documentation only after matching evidence exists

Required execution and proof:

- Run the deployment-readiness gate against fresh SSH, ingress, host-key, and rollback evidence.
- If the gate passes, create scoped backups and deploy the exact pushed release to the four authoritative roles without starting any BFT transaction phase.
- Require each follower to report `status=synced`, `catchingUp=false`, `fresh=true`, and exact source/local height and hash equality.
- Restart one follower only, verify it first returns to a catching-up lifecycle, then require a newly authenticated exact equality result.
- Verify public block growth and transaction/receipt continuity after the restart.
- If ingress or SSH remains unsafe, record the external blocker and continue local chain/BFT engineering without claiming remote proof.

Validation commands:

- `go test ./...`
- `go test -race ./internal/chain ./cmd/ynx-chaind`
- `make validator-peer-readiness-check`
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
- All followers expose fresh exact source/local equality, and one follower repeats it after a controlled restart.
- Public chain growth and transaction/receipt continuity remain intact.
- No BFT cutover, mainnet launch, exchange listing, issuer support, wallet default support, partnership, or independent proof is inferred.

Explicitly not doing:

- Do not execute any BFT freeze, signer installation, dependency transition, ingress cutover, or public rollback phase without the required external approval.
- Do not expand bounded EVM/IDE except to preserve passing tests.
- Do not merge product branches out of dependency order.
- Do not modify or replace the long-term goal file.
