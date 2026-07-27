# YNX Music dependency acceptance

Source commit: `74716a19d95fc191b54102adc02000a91fafec24`  
Contract: `release/integration/music-contract.json` (`music-contract-v1`)  
Current stage: **PROTECT**  
Central integration: **not accepted**

This file records only direct acceptance evidence. A local adapter, schema proposal or passing mock does not make a central dependency integrated.

| Dependency | Owner | Adapter local | Contract test local | Owner accepted | Shared Testnet | Required acceptance evidence |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Wallet / Auth | YNX 02 | Yes | Yes | No | No | Registry merge for `ynx-music-v1`; challenge/session/introspection endpoints; wrong product, bundle, device, scope, expiry, revoke, replay and tamper vectors; deployed health/version bound to exact source |
| Pay | YNX 04 | Yes | Yes | No | No | Review URI contract; signed committed-settlement receipt; receipt replay/tamper/amount/payee/allocation vectors; no status beyond `requires_wallet_review` without receipt |
| Trust Center | YNX 15 | Yes | Yes | No | No | Canonical case create/update schema; evidence hash and decision reference; owner acceptance; deployed negative vectors |
| AI | YNX 14 | Yes | Yes | No | No | Consent-bound proposal schema; provider/model/cost status; streaming cancellation and malformed-response vectors; no action authority |
| Data Fabric / Billing Ledger | YNX 26 | Proposed | No | No | No | Accepted canonical usage, allocation and settlement event versions; deduplication domain; retention and replay semantics |
| Explorer | YNX 12 | No | No | No | No | Read-only public evidence schema for published tracks, rights hash, usage and settlement receipts without private listener data |
| Monitor | YNX 13 | No | No | No | No | Metrics, health, version, alert and SLO dashboard acceptance |
| Website | YNX 28 | Package local | JSON local | No | No | Consume `public-product-metadata.json`; publish canonical `/music`; keep website/runtime/download/signing states separate |
| Integration | YNX 29 | Package local | No | No | No | Freeze one contract version, resolve event conflicts, execute shared vectors and record Owner Acceptance |
| Security / SRE | YNX 30 | No | No | No | No | Threat model, scans, artifact provenance, backup/restore, release and public-deployment gate acceptance |

## Fail-closed recovery conditions

- Missing or unhealthy Wallet introspection: protected Music APIs return unauthorized; no local compatibility token is minted.
- Missing Pay: settlement remains a local review intent and never becomes paid.
- Missing Trust: local case remains open with central linkage absent; no central decision is invented.
- Missing AI: proposal failure is shown as unavailable or retryable; library state is unchanged.
- Missing Data Fabric: usage and allocation stay local evidence and are not described as canonical billing records.
- Missing Website or deployment authority: public URLs, hosted downloads and publication booleans remain false.

## Acceptance update rule

Change any `No` above only when the accepting owner provides an exact contract version, source commit, test run or transaction/receipt evidence, and the corresponding negative vectors pass. The Integration owner must freeze conflicting definitions rather than permit permanent dual protocols.
