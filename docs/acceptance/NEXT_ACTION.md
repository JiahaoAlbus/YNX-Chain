# Next Action

Current single action: verify the production driver's read-only current-topology rehearsal, then implement its transaction-bound backup and remote mutation-freeze phases. Stop before pausing authoritative production or changing public ingress. Do not execute later phases until custody inputs, freeze/snapshot/candidate evidence, rollback rehearsal, and explicit live approval pass.

Current authoritative baseline (verified 2026-07-12): the current repository release is live on all four roles. Gzip snapshot transport and the bounded 45-second follower timeout are deployed. `make verify-testnet` observed the three followers at common height `44246` and common hash `48d6c3adec7496c878cd1f0128cba06b7cf371a3e0efd04ed2708b547266c6bf`; follower writes returned HTTP 409. The previous replication-lag blocker is resolved.

Public proof is still incomplete for two independent reasons: the configured AI provider returns HTTP 429 for authenticated SSE generation, and `web4.ynxweb4.com` still reports legacy chain `ynx_9102-1`. Record these honestly; do not weaken the proof gate or claim public BFT.

Why this action:

- All fifteen BFT Gateway compatibility capabilities now have local and private four-validator candidate proof, including bounded IDE contract state, receipts, real logs, direct Comet matching, four-application equality, cleanup, and rollback.
- The candidate is intentionally absent and public endpoints still run authoritative producer/follower replication.
- `publicCutoverReady=false` is correct: capability completeness alone does not solve final snapshot timing, mutation freeze, service/ingress transition, custody, continuity, or automatic rollback.
- The next real engineering gap is a bounded, reversible transition transaction, not more opcode, contract, feature, Explorer UI, or marketing work.

Required work:

- Keep the implemented Gateway runtime authorization default false; preserve its capability, release, commit, and UTC build identity gates.
- Preserve the deployed gzip replication and bounded follower timeout, and require follower convergence within the configured lag threshold before every rehearsal or cutover phase.
- Use restricted upgrade mode only for the reviewed old-release-to-current-release transition; it must not suppress chain, height, validator, EVM, service, governance, or SSH failures.
- Map every implemented transaction phase to reviewed Tencent operations using the current verified host/key/role inventory. The production driver must be idempotent and write evidence for every remote action.
- Keep the implemented production preflight driver current: it must prebuild binaries and verify current HEAD/release identity, strict SSH host keys, overlay, production custody paths, disk, backup path, public role identity, candidate absence, freeze absence, and fixed-height convergence before any mutation.
- Implement transaction-bound, checksum-verified scoped backups as the next idempotent driver phase; do not reuse the legacy broad backup that includes unrelated V2 state.
- Deploy and remotely verify the implemented shared marker-based mutation freeze; preserve supported read-only EVM/HTTP health, reject writes, and record freeze/unfreeze evidence.
- Pause authoritative block production only after the freeze gate passes, export a final fresh migration, bind the approved validator manifest, deploy the candidate, and require four-signer/common-hash/four-application state evidence.
- Start persistent BFT Gateway and dependent BFT-mode services on loopback, rebuild/resume Indexer from the retained candidate boundary, and verify Explorer/API continuity before changing ingress.
- Atomically switch ingress with a checksummed backup, then require public chain identity, no height regression, height growth, four validators, EVM receipt/log behavior, Faucet/AI/Pay/Trust/Resource/IDE checks, Indexer lag, Explorer SSE, release identity, and cross-region health.
- Define automatic rollback thresholds for any service failure, identity mismatch, height stall/regression, signer loss, index lag, or evidence mismatch. Rollback must restore ingress, authoritative producer/followers, mutation routes, and public health from the backup point.
- Keep the non-mutating plan and clean temporary-repository self-test proving ordering, cleanup, and failure injection without touching public services.

Files to touch:

- production driver and service templates under `scripts/deploy`, `scripts/ops`, and `scripts/verify` for real freeze, final snapshot, continuity gates, ingress, and remote automatic rollback.
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
- `make public-bft-cutover-transaction-check`
- `make public-bft-production-rehearsal-check`
- `make public-bft-production-rehearsal`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `make objective-state-check`
- `make preflight`
- `make remote-smoke-test` (expected to remain failed until the external AI 429 and legacy Web4 service are resolved)

Completion standard:

- Default and ordinary candidate Gateway health remain `publicCutoverReady=false` even with fifteen implemented capabilities.
- Explicit authorization is necessary but not sufficient; stale/non-current release, missing custody, incomplete candidate evidence, absent freeze, failed dependencies, or failed continuity must block readiness and cutover.
- Dry-run and injected failures restore the exact pre-cutover service/ingress state and leave authoritative public health intact.
- A public cutover is not complete until live public proof passes after the switch and rollback remains available; do not infer this from private candidate evidence.

Explicitly not doing:

- No new EVM opcodes, Counter behavior, Hardhat artifacts, sample contracts, arbitrary IDE execution, or unrelated Explorer/UI expansion.
- No public routing switch before the explicit gate and production custody/rollback evidence pass.
- No mainnet, exchange-listing, stablecoin-issuer, wallet-default, partnership, public BFT, or goal-completion claim before real public proof.
