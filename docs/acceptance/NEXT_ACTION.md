# Next Action

Current single action: implement and locally/dry-run verify one approval-gated fresh-anchor public BFT cutover transaction with automatic rollback. Do not execute public routing changes until the explicit cutover gate, production custody inputs, and rollback rehearsal pass.

Why this action:

- All fifteen BFT Gateway compatibility capabilities now have local and private four-validator candidate proof, including bounded IDE contract state, receipts, real logs, direct Comet matching, four-application equality, cleanup, and rollback.
- The candidate is intentionally absent and public endpoints still run authoritative producer/follower replication.
- `publicCutoverReady=false` is correct: capability completeness alone does not solve final snapshot timing, mutation freeze, service/ingress transition, custody, continuity, or automatic rollback.
- The next real engineering gap is a bounded, reversible transition transaction, not more opcode, contract, feature, Explorer UI, or marketing work.

Required work:

- Add an explicit runtime cutover authorization input to `ynx-bft-gatewayd`; default false and fail closed. It may report ready only when authorization is present and all fifteen capabilities are implemented.
- Build a cutover orchestrator that prebuilds binaries, verifies current HEAD/release identity, host keys, overlay, production custody paths, disk, backups, public endpoint identity, and candidate absence before any mutation.
- Install a reversible ingress mutation freeze that preserves read health, reject new public mutations during the final snapshot window, and record the freeze evidence.
- Pause authoritative block production only after the freeze gate passes, export a final fresh migration, bind the approved validator manifest, deploy the candidate, and require four-signer/common-hash/four-application state evidence.
- Start persistent BFT Gateway and dependent BFT-mode services on loopback, rebuild/resume Indexer from the retained candidate boundary, and verify Explorer/API continuity before changing ingress.
- Atomically switch ingress with a checksummed backup, then require public chain identity, no height regression, height growth, four validators, EVM receipt/log behavior, Faucet/AI/Pay/Trust/Resource/IDE checks, Indexer lag, Explorer SSE, release identity, and cross-region health.
- Define automatic rollback thresholds for any service failure, identity mismatch, height stall/regression, signer loss, index lag, or evidence mismatch. Rollback must restore ingress, authoritative producer/followers, mutation routes, and public health from the backup point.
- Keep a dry-run/self-test mode that proves every command, ordering constraint, cleanup path, and failure injection without touching public services.

Files to touch:

- `internal/bftgateway` and `cmd/ynx-bft-gatewayd` for explicit default-false runtime authorization and tests.
- `scripts/deploy`, `scripts/ops`, and `scripts/verify` for freeze, final snapshot, cutover, continuity gates, failure injection, and automatic rollback.
- service/env examples and operations/API docs only after real flags and handlers exist.
- `docs/acceptance/FEATURE_COMPLETION_TRACKER.md`, `PROJECT_STATE.md`, and `NEXT_ACTION.md` after verified local/dry-run evidence.
- Do not modify or replace the long-term goal file.

Validation commands:

- `go test ./...`
- `make test`
- `make bft-gateway-check`
- `make bft-ide-contract-check`
- `make bft-evm-receipt-check`
- `make consensus-production-package-check`
- `make consensus-public-cutover-check`
- add and run a cutover transaction self-test/failure-injection check
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `make objective-state-check`
- `make preflight`

Completion standard:

- Default and ordinary candidate Gateway health remain `publicCutoverReady=false` even with fifteen implemented capabilities.
- Explicit authorization is necessary but not sufficient; stale/non-current release, missing custody, incomplete candidate evidence, absent freeze, failed dependencies, or failed continuity must block readiness and cutover.
- Dry-run and injected failures restore the exact pre-cutover service/ingress state and leave authoritative public health intact.
- A public cutover is not complete until live public proof passes after the switch and rollback remains available; do not infer this from private candidate evidence.

Explicitly not doing:

- No new EVM opcodes, Counter behavior, Hardhat artifacts, sample contracts, arbitrary IDE execution, or unrelated Explorer/UI expansion.
- No public routing switch before the explicit gate and production custody/rollback evidence pass.
- No mainnet, exchange-listing, stablecoin-issuer, wallet-default, partnership, public BFT, or goal-completion claim before real public proof.
