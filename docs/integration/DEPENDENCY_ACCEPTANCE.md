# YNXT Economics Dependency Acceptance

This file records acceptance gates, not assumed approvals. Every dependency remains unaccepted until the owning product supplies direct evidence against `ynx.economics.integration.v1`.

| Dependency owner | Contract input | Acceptance test | Current state | Failure behavior |
| --- | --- | --- | --- | --- |
| 01 Chain Core | Economic runtime state, fee/supply events, staking risk transitions, migration and rollback | Replay both deterministic vectors; reproduce event/state hashes; reject malformed or unsupported versions | pending | Keep current fixed-fee and inactive candidate controls |
| 02 Wallet/Auth | Product/session tuple, scopes, signed review and revoke behavior | Wrong product/device/scope, expiry, replay, tamper and revoke tests fail closed | pending | No user mutation or signing route |
| 07 Exchange | Fee, funding, insurance and solvency mapping | Reconcile burn separately from revenue and prevent duplicated ledger recognition | pending | No Exchange-derived economics activation |
| 08 Quant | Realized-net PnL, cost deductions, high-water mark and approval | Reject loss, unrealized profit and non-breached high-water-mark charges | pending | Performance fee unavailable |
| 19 Oracle | Price, reserve ratio, depeg reference, source/asOf/version/failure | Stale, unavailable and contradictory provider tests | pending | Stable settlement and depeg-dependent actions pause or queue |
| 21 Bridge | Cross-chain exposure and asset lifecycle | Failure, reorg, delayed finality and inconsistent supply tests | pending | Cross-chain mint/redemption disabled |
| 26 Data Fabric | Canonical event and Billing Ledger schemas | Byte-stable event ingestion; fee and supply reconciliation; duplicate rejection | pending | Events remain local evidence only |
| 12 Explorer | Public projection of accepted events | Show source/asOf/version, burn/revenue split, candidate status and evidence links | pending | Public projection remains local-only |
| 13 Monitor | Economic anomaly and integrity alerts | Trigger supply mismatch, fee mismatch, invalid signatures, timelock and tamper alerts | pending | No central monitoring claim |
| 31 Governance | Proposal, threshold, timelock and protocol-control interface | Schedule/activate within bounds; early activation and over-limit changes rejected | pending | Candidate parameters cannot activate |
| 29 Integration | Contract freeze and merge order | All mandatory owners consume the same contract/version and vectors | pending | `integratedCentral=false` |
| 28 Website | Public `/ynxt` and `/economics` publication | Canonical URLs, risk language, release truth, accessibility and public evidence | pending | `deployedPublic=false` |

## Acceptance record schema

Each owner must return a machine-readable record containing:

- `contractId`
- `contractSourceCommit`
- `owner`
- `consumerSourceCommit`
- `acceptedSchemaVersions`
- `acceptedEventTypes`
- `testVectorIds`
- `testCommands`
- `evidencePathsOrURLs`
- `acceptedAt`
- `limitations`
- all nine release-state claims supported by direct evidence

`consumerSourceCommit` is independent for each owner. 29 Integration must pin the exact Economics source commit plus the accepted 01/12/13/26/29 consumer commits before validation. Every required owner then signs the same canonical payload hash in canonical owner order using an accepted Ed25519 key. Missing, duplicate, reordered, stale, future-dated, commit-rebound or over-promoted evidence is rejected fail closed by `internal/economics/shared_testnet_acceptance.go`.

An acceptance record that omits a failed vector, changes economic meaning, or claims deployment from local evidence is rejected. A passing local validator fixture is not an acceptance record and does not change any central, staging, shared-Testnet, public or production state.

## Current blocking inputs

The following inputs are legitimately external and are not requested as secrets in chat:

- accepted Chain Core and Governance interfaces;
- secure signer path and Treasury multisig;
- stablecoin provider or custodian and reserve attestation;
- Oracle provider and Bridge contracts;
- public deployment authority, domain/DNS and Testnet funding;
- legal and compliance review.

All independent local engineering, adapters, validation, simulations and evidence work must continue while these inputs are pending.
