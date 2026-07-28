# YNX Docs Dependency Acceptance

Runtime source commit: `5d04c144987fd35d09925db72bd882719a2e7df9`

Contract: `release/integration/docs-contract.json`

Status: pending central acceptance; local adapters and fail-closed vectors are ready.

| Owner | Dependency | Local contract evidence | Acceptance state | Required next evidence |
|---|---|---|---|---|
| YNX 02 | Wallet/Auth, approval tuple, Product Session, introspection, expiry and revoke | Web/mobile bindings; replay/scope/product tests | Pending | Signed owner acceptance plus shared wrong-product/bundle/device/scope/expiry/revoke results |
| YNX 20 | Object Store, object/version metadata, retention, delete and restore | Local/remote adapters with hash validation; schema v2; local offline backup/restore drill passes | Pending | Accepted remote schema and outage behavior |
| YNX 14 | AI Gateway provider/model/cost/status/cancel/review | Selected-version context and fail-closed product boundary | Pending | Real provider Testnet E2E with cost and rejected-result audit |
| YNX 15 | Trust evidence and appeal | Distinct evidence JSON fields; source/export hashes; no plaintext | Pending | Accepted evidence schema plus Trust receipt/report/appeal test |
| YNX 26 | Canonical events and Billing Ledger | Candidate event list in contract | Pending | Frozen event version, idempotency and billing semantics |
| YNX 12/13 | Explorer/Monitor evidence | No accepted integration yet | Pending | Traceable event/health/version evidence and alert probe |
| YNX 29 | Protocol freeze and shared Testnet | Contract and cross-product vectors ready | Pending | Conflict review, frozen version and execution order |
| YNX 30 | Security/SRE/release/backup/artifact gate | Targeted unit/race/vet/build checks and local hash-verified backup/restore drill pass | Pending | Accept backup schema; provide release policy, SBOM/provenance, scans and public gate |
| YNX 28 | Canonical `/docs` Website page | Product metadata will be generated locally | Pending | Metadata consumption and separate website/runtime publication proof |

## Acceptance rules

- Silence is not acceptance.
- A local adapter or successful mock does not set `integratedCentral=true`.
- Each owner acceptance must identify the accepted contract version and exact source commit.
- Any conflict in scope, event, digest, error or release status is escalated to YNX 29; the Docs service must not support two permanent competing contracts.
- Until acceptance, dependent paths remain fail-closed and public/deployment flags remain false.
