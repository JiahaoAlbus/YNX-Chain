# YNX Creator Studio Dependency Acceptance

Status: **candidate; no central acceptance yet**  
Owner: YNX 34  
Protected source commit: `192da88b0ca3897278893711fb08e1373b0562b2`  
Updated: 2026-07-27T15:47:21Z

## Acceptance ledger

| Dependency | Canonical owner | Contract required | Local adapter/evidence | Acceptance state | Required acceptance proof |
|---|---|---|---|---|---|
| Wallet/Auth + App Gateway | YNX 02 | Product tuple, exact scopes, device challenge, product session, introspection, expiry, revoke and request attestation | Gateway verifier and replay/tamper tests exist | Not accepted | Central registry commit plus shared Testnet positive and wrong-product/bundle/device/scope/replay vectors |
| Pay | YNX 04 | Testnet receipt verification, payout intent, refund and dispute lifecycle | Receipt verifier interface, owner-only payout intent and replay checks exist | Not accepted | Current Pay contract, receipt IDs, refund vectors and Wallet approval evidence |
| Data Fabric / Billing Ledger | YNX 26 | Canonical creator usage, cost, revenue, split, refund and dispute events | Persisted local events and audit records exist | Not accepted | Frozen schema/event version and reconciliation vectors without duplicate allocation |
| Trust Center | YNX 15 | Rights case, takedown, appeal and correction ownership | Local independent rights review/takedown/appeal state exists | Not accepted | Canonical Trust case IDs/events and delegated negative tests |
| Explorer | YNX 12 | Public evidence references for applicable receipts/events/cases | No central/public evidence | Not accepted | Current-source public evidence references with no private/internal data |
| Monitor | YNX 13 | Health/version, structured metrics, alerts and request/error/audit correlation | Local health/version and audit IDs only | Not accepted | Dashboard/alert evidence tied to current source and deployed endpoint |
| Integration | YNX 29 | Unique schema, event, scope and machine error-code freeze | Candidate contract and vectors exist | Not accepted | Central integration commit and explicit owner acceptance ledger |
| Security/SRE | YNX 30 | Scanner, backup/restore, SBOM/provenance, artifact and release policy | Local fail-closed scanner adapter; restore/race/vet tests green | Not accepted | Approved scanner smoke, security gates, artifact manifest and release evidence |
| Website | YNX 28 | `/creator-studio` metadata, page, screenshot/artifact manifest, status and SEO | Product metadata/handoff authored locally | Not consumed | Website source commit and public canonical URL evidence |

## Mandatory negative acceptance vectors

- Missing, expired or revoked product session.
- Wrong product, bundle, callback, device, account or chain.
- Scope widening or wildcard scope.
- Nonce replay and changed replay.
- Team invite accepted by the wrong account or replayed after acceptance/expiry.
- Team action after role removal or revoke.
- Public publication without exact source-bound rights.
- Creator/owner self-verification of rights.
- Rights expiry, rejection or source-lineage mismatch after publication.
- Pay receipt replay, usage-event replay, wrong video/owner or inactive monetization.
- Finance role attempting to create or redirect payout.
- AI output applied without explicit review.
- Restore with tampered archive, traversal path or non-empty destination.

## State transition rule

This file may move a dependency to accepted only when it records the canonical owner, exact accepted contract/schema version, central source commit, executed vector IDs and raw evidence location. Local implementation or passing local tests alone do not change `integratedCentral`.
