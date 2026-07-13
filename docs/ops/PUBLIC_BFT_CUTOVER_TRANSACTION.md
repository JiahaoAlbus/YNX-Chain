# Public BFT Cutover Transaction

YNX Chain public BFT cutover is an approval-gated transaction. The transaction engine and all forward/reverse production-driver phases are implemented and locally failure-tested: read-only preflight, scoped backup, mutation freeze/unfreeze, read-preserving authoritative pause/resume, final snapshot export, transaction-bound candidate deploy/verify/rollback, parallel candidate dependency startup/continuity/rollback, checksummed ingress switch/restore, public continuity verification, and recovery verification. Running the plan target does not change services or ingress. The completed control plane is not deployed and does not constitute approval to execute it.

## Safety gates

- `PUBLIC_BFT_CUTOVER_MODE` defaults to `plan`; only `execute` can invoke a driver.
- Execution requires `PUBLIC_BFT_CUTOVER_APPROVED=yes`, an executable driver, a clean `main` worktree, and a mode-`0600` approval file.
- Approval must be valid for no more than 24 hours and bind the exact 12-character commit and `ynx-bft-gateway-<commit>` release.
- Approval must explicitly set both `publicCutoverAuthorized` and `automaticRollbackRequired` to `true`.
- Full-cutover approval and every downstream approval-evidence/candidate-binding validator require the same independent custody boundary as the bounded rehearsal: custody reviewer distinct from transaction approver, a compact non-secret evidence reference, validator and five-service signer recovery, owner handover, and rotation verification. Legacy or self-reviewed approval evidence fails closed.
- Approval must bind `validatorManifestSha256` and a whole-second UTC `candidateGenesisTime`. Candidate generation requires that exact public-key-only manifest, a genesis time between the final snapshot timestamp and 30 minutes after it, and an approval that is still valid.
- The bounded freeze-rehearsal approval is separately fail-closed on custody review: its transaction approver and custody reviewer must be different identified people, the reviewer must provide a non-secret evidence reference, and validator-key recovery, all five service-signer recovery paths, owner handover, and rotation procedure must each be explicitly verified. The generated template defaults every custody assertion to false.
- Candidate deployment additionally requires `PUBLIC_BFT_PRODUCTION_CANDIDATE_APPROVED=yes`. Automatic candidate rollback consumes the transaction-local validated approval evidence and remains available after approval expiry so an in-flight failure cannot lose its rollback permission.
- Parallel dependency startup additionally requires `PUBLIC_BFT_PRODUCTION_DEPENDENCIES_APPROVED=yes`, a verified transaction candidate, and five owner-controlled mode-`0600` signer files under `/etc/ynx/consensus-signers`. Forward signer inputs are not required for automatic dependency rollback.
- Ingress switching additionally requires `PUBLIC_BFT_PRODUCTION_INGRESS_APPROVED=yes` and passed candidate dependency continuity. Automatic ingress rollback consumes transaction-local approval evidence and does not require the forward ingress approval variable.
- Gateway readiness remains false unless its separate runtime authorization, complete capabilities, release identity, and UTC build identity all pass.
- Evidence is written with a restrictive umask to a transaction-specific directory.
- The authoritative API, BFT Gateway, Faucet, AI, Pay, Trust, and Resource services share `YNX_MUTATION_FREEZE_FILE`. An atomic marker enables the freeze without a restart. GET/HEAD/OPTIONS, supported read-only EVM JSON-RPC calls, and AI chat remain available; state-changing requests return HTTP `503` with retry headers.

## Driver contract

`PUBLIC_BFT_CUTOVER_DRIVER` receives one phase name per invocation. Production implementations must fail closed, write phase evidence under `PUBLIC_BFT_CUTOVER_TRANSACTION_DIR`, and make every rollback operation idempotent.

Forward order:

1. `preflight`
2. `backup`
3. `freeze_mutations`
4. `pause_authoritative`
5. `export_final_snapshot`
6. `deploy_candidate`
7. `verify_candidate`
8. `start_dependencies`
9. `verify_continuity`
10. `switch_ingress`
11. `verify_public`
12. `unfreeze_mutations`

After mutation freeze begins, any failure invokes all reverse operations: `rollback_ingress`, `rollback_dependencies`, `rollback_candidate`, `resume_authoritative`, `unfreeze_mutations`, and `verify_rollback`. Calling every operation is intentional because a driver can mutate state and fail before returning.

`deploy_candidate` generates its package only from `PUBLIC_BFT_CUTOVER_TRANSACTION_DIR/final-snapshot/migration.json`. It verifies the remote snapshot evidence, raw snapshot SHA-256, paused height/hash/state boundary, approved validator-manifest SHA-256, exact genesis time, generated package, and a mode-`0600` binding record before running four-role deployment. Candidate archives are mode `0600`, checksum-verified after upload, deleted through a remote exit trap, and absent after installation. Candidate binaries live under `/var/lib/ynx-chain/consensus-candidate/bin`; they do not overwrite `/usr/local/bin`, so candidate-state removal also removes the executable surface. `verify_candidate` requires four-role common consensus evidence. `rollback_candidate` stops and removes candidate services/state/releases, proves candidate ports are free, and keeps authoritative `ynx-chaind` active.

`start_dependencies` first requires the authoritative Indexer to reach the exact final-snapshot height and verifies its stored tip hash against the approved migration hash. It copies that database into a transaction-owned directory, then starts current-commit candidate binaries for BFT Gateway, Indexer, Explorer, Faucet, AI, Pay, Trust, and Resource on loopback ports `27620` and `27626-27632`. The BFT Gateway maps only the candidate first block's empty Comet parent to the approved authoritative migration hash; a non-empty mismatch fails closed. This permits Indexer parent continuity from the authoritative tip without fabricating retained candidate history.

All candidate dependency binaries and writable state remain under transaction or candidate roots. Existing raw signer variables are explicitly cleared, the five services load only their approved signer files, and Faucet/audit logs are isolated from authoritative logs. `verify_continuity` requires candidate height growth, the exact migration anchor and build identities, Indexer progress across the boundary within bounded lag, a real RPC/indexer-backed Explorer, and healthy signer-bound BFT-mode Faucet/AI/Pay/Trust/Resource services. `publicCutoverReady`, `publicIngressChanged`, and public authorization remain false. `rollback_dependencies` removes only transaction-owned units, env, and state; it then proves authoritative services active and candidate ports free. These paths are locally fixture/dry-run verified only and have not run on the public hosts.

`switch_ingress` creates mode-`0600` transaction-owned backups and checksum manifests for the managed YNX Caddy snippet and/or Nginx configuration. It first changes the candidate Gateway runtime authorization to true and requires exact Gateway build/readiness evidence, then replaces only the eight managed loopback upstreams and validates/reloads active ingress. Any intermediate failure restores both ingress files and Gateway authorization. `rollback_ingress` verifies backup checksums, restores authoritative upstreams, returns Gateway authorization to false, and revalidates the active ingress; repeated rollback rechecks the restored file checksums.

`verify_public` is read-only and runs while mutation freeze is still active. It requires public Gateway height growth beyond the migration boundary, chain ID `6423`, Comet chain `ynx_6423-1`, four validators, exact current builds, root-path EVM chain ID `0x1917`, bounded Indexer/Explorer lag, healthy BFT-mode Faucet/AI/Pay/Trust/Resource services, unchanged signer identities from private continuity evidence, and HTTP `503` on a public mutation probe. Any identity, height, signer, lag, health, or freeze mismatch triggers the transaction's automatic reverse sequence. This operator-run verification is not independent public proof.

## Commands

```bash
make public-bft-cutover-plan
make public-bft-cutover-transaction-check
make public-bft-production-driver-check
make mutation-freeze-check
```

The transaction check uses a clean temporary Git repository and a local state driver. It verifies a successful transition and injects failures after ten mutating or post-mutation phases, requiring the exact authoritative baseline and a passed rollback journal each time. The production-driver check separately exercises candidate input/package tampering, missing approvals, automatic-rollback consent, archive custody, dependency migration/lag failures, ingress switch/restore, public continuity failures, repeated rollback, and all four candidate role command paths with `DEPLOY_DRY_RUN=1`.

Do not run execute mode until the production driver maps every phase to reviewed remote commands, custody inputs are available, the rollback rehearsal passes against the current public topology, and a live approval file is issued. Local self-test evidence is not public BFT proof.
