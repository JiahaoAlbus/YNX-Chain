# YNXT Economics Threat Model

## Scope and trust assets

This model covers current fixed-fee disclosure, staking state/actions, Treasury snapshots, candidate simulators, the YUSD test-unit sandbox, Explorer economics routes, generated public metadata and release evidence. Candidate models are not consensus authority. Protected assets are consensus supply and fee conservation, delegation/unbonding liabilities, YUSD reserve/supply/audit integrity, source and release truth, operator credentials, build provenance and user exit rights.

## Trust boundaries and threats

| Boundary | Principal threats | Implemented control | Remaining gate |
| --- | --- | --- | --- |
| Signed wallet action to Gateway/consensus | Replay, wrong chain/product, nonce reuse, scope widening, forged signer | Existing signed action domains, nonce and canonical address checks; rejected mutations are atomic | Central Wallet/App Gateway integration and public replay drill remain false |
| Consensus state and fee/staking ledgers | Hidden mint/burn, recipient mismatch, supply loss, tampered migration | Versioned AppHash domains, conservation validation, fee audit hash, migration tamper rejection | Governance activation, staging migration and external audit |
| Candidate policy to public disclosure | Model presented as active chain state, guaranteed return/peg, stale evidence | Current and candidate sections separated; source/as-of/version/coverage/failure and false release/risk booleans | Independent review and public deployment evidence |
| YUSD operator API to persistent state | Credential theft, unauthorized mint, replay, reserve fabrication, state tamper, blocked exit | Dedicated secret, constant-time auth, idempotency digest, limits, pause/outage queue, full integrity/audit/reconciliation validation | Real custodian/attestation/legal review are absent; no real value |
| Treasury and security models | Arbitrary transfer, recursive restaking, cross-pool contagion, secret support | No transfer executor; explicit buckets, isolated pools, max slash/cooldown/waterfall simulation | Multisig, timelock, adjudication, funding and audited contracts |
| Browser/API | False health, injection, internal error leakage, traffic exhaustion | Static escaped metadata, JSON encoding, visible unavailable states, Request ID, process health and metrics | Edge headers/rate limits, DAST, external monitor and hosted alerting |
| Build and dependency graph | Lockfile drift, compromised dependency/script, leaked secret, unverifiable artifact | Locked Go/npm graphs, deterministic SBOM, script allowlist, secret/no-filler/static gates | Hosted CI provenance, artifact signing and independent dependency review |

## Abuse cases and response

An attacker may spam disclosure requests, replay a YUSD mutation, alter a state file, submit a premature withdrawal, disguise burn as revenue, manipulate stress assumptions, or replace a generated artifact. Rate-limit abuse at ingress once deployed; replay/tamper paths fail closed locally; premature staking exit is rejected atomically; economic output labels assumptions and separates burn/revenue; generated evidence is bound to commit and digest. Any invariant failure requires mutation freeze, evidence preservation, rollback to a matching binary/state pair, and public correction. No administrator is authorized to mint production YNXT/YUSD, move Treasury assets, activate candidates or bypass governance through this package.
