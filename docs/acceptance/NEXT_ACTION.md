# Next Action

Current unreviewed packet: `tmp/production-custody-review/custody-review-21392a5f6a0e-20260713T104917Z` is bound to commit `21392a5f6a0e` and active public signer manifest `89ea82399b1c9907d5ed4a61132dceb068d0fbe136c1e7780b2e88b654d69ae3`. Every external assertion remains false, so it authorizes nothing. After the offline procedures and independent review, regenerate it for the exact future execution commit; freeze and full-cutover execution now require the reviewed file itself and exact approval match.

Current single action: complete offline recovery, owner handover, rotation evidence, and independent review for the five active owner-local service signers. The first non-FileVault-volume ceremony was never uploaded or funded, was abandoned, and its files were removed. Active identities were regenerated directly on the separate FileVault-protected volume at `/Volumes/Data/Users/huangjiahao/.ynx-chain-custody/production-service-signers/service-signers-20260713T101647Z`; its same-volume recovery staging verification passes, but it is not an offline backup. The primary still has no `/etc/ynx/consensus-signers/{faucet,ai,pay,trust,resource}.key`, so no BFT service signer is remotely active. Keep the existing exact-commit freeze-rehearsal packet deliberately unapproved. Do not install signer files or execute freeze, pause, snapshot, candidate, dependencies, ingress, or public cutover until offline restore and rotation are verified, owner handover is recorded, and a different independent reviewer returns the exact mode-`0600` approval required by the relevant transaction. No BFT transaction mutation phase has run on production.

Current authoritative baseline (verified 2026-07-13): deployed runtime release `0ee044bd7d78` is live on all four roles. All roles matched release-manifest SHA-256 `ead0efab4cc1def179c3347be55e9ea6df16afb7883cb81458cd52383d7673b4` and daemon SHA-256 `e020a42ee4e0f043572699ec47abc734644bc75000750eb1afdbf12b67120822`; fixed height `80608` matched hash `efabca1c02d2bce411b4603232b2a527fc0d2ff77b38942446ccde85a0f8bf56` on all four roles. The exact-release Singapore smoke passed chain, current-chain Web4 binding, and mutable ecosystem flows except provider-backed AI generation. The read-only rehearsal passed at `tmp/public-bft-production-rehearsal/rehearsal-0ee044bd7d78-20260713T083256Z` with no remote mutation or ingress change. The new review packet is at `tmp/public-bft-freeze-rehearsal-approval/freeze-rehearsal-0ee044bd7d78-20260713T083400Z`; it is deliberately unapproved and authorizes nothing. This route is not independent third-party proof.

Current control-plane status (verified 2026-07-13): all named transaction phases exist and their scripts are present in deployed release `0ee044bd7d78`. They bind transaction/commit/release, final snapshot, validator manifest/genesis, candidate package, signer-file inputs, dependency migration continuity, checksummed ingress files, exact public builds, height/four-validator identity, root-path EVM, Indexer/Explorer lag, unchanged signers, service health, freeze state, and automatic rollback evidence. The newer local full-cutover approval/evidence/candidate-binding validators also require a custody reviewer distinct from the transaction approver plus affirmative validator recovery, service-signer recovery, owner handover, and rotation evidence. Ten phase failures restore the modeled authoritative baseline; candidate/dependency/ingress command paths pass dry-run and focused failure fixtures. These newer validators are not in deployed release `0ee044bd7d78`, and deployment of control-plane files is not execution: no live transaction phase, ingress switch, or public BFT cutover occurred.

Public proof is still incomplete because the configured AI provider returns HTTP `429 insufficient_quota` for authenticated SSE generation. The Web4 legacy-chain gap is closed: public health and strict Singapore-routed smoke verify a fail-closed live binding to `ynx_6423-1` / `6423` / `YNXT` and release `ynx-chain-0ee044bd7d78`. Independent third-party vantage evidence and public BFT are still absent. Record these honestly; do not weaken the proof gate or claim public BFT.

Current custody boundary (verified 2026-07-13): validator key/state/node files exist under owner-controlled host-local paths with mode `0600`; no private contents were read during inventory. Five distinct active service signer identities exist under owner-local mode-`0600` custody on a FileVault-protected volume with a byte-matched same-volume recovery staging copy and non-secret public manifest SHA-256 `89ea82399b1c9907d5ed4a61132dceb068d0fbe136c1e7780b2e88b654d69ae3`. The staging copy does not prove offline recovery. Remote service signer files do not exist. The freeze-rehearsal and full-cutover approval chains require a custody reviewer distinct from the transaction approver, an exact `sha256:<digest>` review-packet reference, and explicit validator recovery, service-signer recovery, owner handover, and rotation attestations. The public-only default-false packet generator and strict validator pass local self-tests, but no real packet has been completed and no independent reviewer has supplied evidence. The generated freeze template defaults those fields to false, free-form references fail closed, and the old unapproved packet is not sufficient under the new gate.

Why this action:

- All fifteen BFT Gateway compatibility capabilities now have local and private four-validator candidate proof, including bounded IDE contract state, receipts, real logs, direct Comet matching, four-application equality, cleanup, and rollback.
- The candidate is intentionally absent and public endpoints still run authoritative producer/follower replication.
- `publicCutoverReady=false` is correct: capability completeness alone does not solve final snapshot timing, mutation freeze, service/ingress transition, custody, continuity, or automatic rollback.
- The next real engineering gap is a bounded, reversible transition transaction, not more opcode, contract, feature, Explorer UI, or marketing work.

Required work:

- Preserve the implemented role-specific owner-controlled ceremony for Faucet, AI, Pay, Trust, and Resource signers; never commit, print, or overwrite private material.
- Move the recovery staging copy to an owner-controlled offline encrypted medium, restore into a temporary restricted directory, and rerun ceremony verification before any signer file is installed on the primary.
- Record owner handover acknowledgement and a reviewed rotation path without placing secrets in Git or approval evidence.
- Generate the public-only custody review packet from the active signer manifest/status only after the offline restore and rotation procedure have actually been observed; the independent reviewer must fill it, validate it, and provide its exact hash without adding secret material.
- Keep the transaction approver and custody reviewer distinct; bind only a non-secret evidence reference into approval output and reject self-review or any false recovery/handover/rotation assertion.
- Keep the implemented Gateway runtime authorization default false; preserve its capability, release, commit, and UTC build identity gates.
- Preserve the deployed gzip replication and bounded follower timeout, and require follower convergence within the configured lag threshold before every rehearsal or cutover phase.
- Use restricted upgrade mode only for the reviewed old-release-to-current-release transition; it must not suppress chain, height, validator, EVM, service, governance, or SSH failures.
- Map every implemented transaction phase to reviewed Tencent operations using the current verified host/key/role inventory. The production driver must be idempotent and write evidence for every remote action.
- Keep the implemented production preflight driver current: it must prebuild binaries and verify current HEAD/release identity, strict SSH host keys, overlay, production custody paths, disk, backup path, public role identity, candidate absence, freeze absence, and fixed-height convergence before any mutation.
- Preserve the implemented transaction-bound, checksum-verified scoped backup phase and its explicit approval/commit/release gates. It is locally and dry-run verified only; execute it remotely only inside an approved current-commit transaction. Do not reuse the legacy broad backup that includes unrelated V2 state.
- Preserve the implemented transaction-bound marker-based mutation freeze/unfreeze phases. Their fixture and four-role dry-run checks pass, but live execution is still pending a current-HEAD rehearsal and explicit approval. During a future bounded rehearsal, preserve supported read-only EVM/HTTP health, reject writes, record freeze/unfreeze evidence, and automatically unfreeze on any failure.
- Use only the dedicated freeze-rehearsal transaction and approval schema for the first bounded live marker exercise. The generated template must remain unapproved until reviewed; authoritative pause, candidate deployment, dependency transition, ingress change, and public cutover must remain explicitly unauthorized.
- Require `verify_recovery` after normal and automatic unfreeze: marker absent, services active, REST/EVM reads available, mutation probes no longer frozen, primary height growing, four-role lag bounded, and a common fixed-height hash.
- Pause authoritative block production only after the freeze gate passes, export a final fresh migration, bind the approved validator manifest, deploy the candidate, and require four-signer/common-hash/four-application state evidence.
- Preserve the implemented candidate contract: exact final-snapshot input, approved public-manifest SHA-256, bounded approved genesis time, mode-`0600` binding/archive evidence, four-role verification, and automatic rollback permission that survives in-flight approval expiry.
- Preserve the implemented parallel dependency boundary: exact-current binaries under the candidate root, five file-backed signer identities, raw-key overrides cleared, transaction-owned Indexer/log state, migration-parent continuity, bounded lag, and no public-ingress change.
- Preserve the implemented ingress/public threshold boundary. A future independently approved live transaction must still add post-unfreeze mutable receipt/log, Faucet/AI/Pay/Trust/Resource/IDE, Explorer SSE, and cross-region proof before being called complete; the in-transaction frozen verification is intentionally read-only.
- Preserve automatic rollback on service failure, identity mismatch, height stall/regression, signer drift, index lag, freeze mismatch, or evidence mismatch. Rollback order must remain ingress, dependencies, candidate, authoritative resume, unfreeze, then recovery verification.
- Keep the non-mutating plan and clean temporary-repository self-test proving ordering, cleanup, and failure injection without touching public services.

Files to touch:

- acceptance state plus independently reviewed custody/approval evidence only; do not add new cutover behavior unless a failing gate exposes a real defect.
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
- `make public-bft-freeze-rehearsal-approval-template-check`
- `make public-bft-freeze-rehearsal-transaction-check`
- `make public-bft-production-rehearsal-check`
- `make public-bft-production-recovery-check`
- `make public-bft-production-driver-check`
- `make public-bft-production-rehearsal`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `make objective-state-check`
- `make preflight`
- `make remote-smoke-test` (expected to remain failed until external AI provider quota is restored)
- `make remote-smoke-transport-check`
- `ENV_FILE=.env.deploy make remote-smoke-test-via-sg` (operator-controlled cross-region evidence; not independent third-party proof)

Completion standard:

- Default and ordinary candidate Gateway health remain `publicCutoverReady=false` even with fifteen implemented capabilities.
- Explicit authorization is necessary but not sufficient; stale/non-current release, missing custody, incomplete candidate evidence, absent freeze, failed dependencies, or failed continuity must block readiness and cutover.
- Dry-run and injected failures restore the exact pre-cutover service/ingress state and leave authoritative public health intact.
- A public cutover is not complete until live public proof passes after the switch and rollback remains available; do not infer this from private candidate evidence.

Explicitly not doing:

- No new EVM opcodes, Counter behavior, Hardhat artifacts, sample contracts, arbitrary IDE execution, or unrelated Explorer/UI expansion.
- No public routing switch before the explicit gate and production custody/rollback evidence pass.
- No mainnet, exchange-listing, stablecoin-issuer, wallet-default, partnership, public BFT, or goal-completion claim before real public proof.
