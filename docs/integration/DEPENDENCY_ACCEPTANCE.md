# YNX Seller Console Dependency Acceptance

Source commit: `a90d1ee59eec38c15ce42b39420f2625ed758dd0`  
Stage: `FREEZE`  
Goal status: `Active`

No dependency below is accepted merely because a local adapter, local Outbox, Website handoff, historical endpoint, or passing fixture exists. Acceptance requires the exact central-owner contract and direct shared-environment evidence.

| Owner | Required contract | Local preparation | State | Unblock condition |
|---|---|---|---|---|
| 02 Wallet/Auth | `ynx-seller-v1`, bundle `com.ynxweb4.seller-console`, callback `ynxseller://wallet-auth/callback`, ordered scopes `account:read`, `shop:seller:operate`, plus store-scoped authorization revocation | Registry patch, adapter, receipt binding, invitation-account binding and negative vectors complete | Pending | Central registry and revocation contract deployed; shared vectors pass |
| 04 Pay | Exact committed settlement and refund evidence | Exact invoice/intent/merchant/payout/payer/asset/amount/hash/block/Audit binding implemented | Pending | Testnet merchant configuration and authoritative endpoint available |
| 15 Trust Center | Dispute and appeal evidence reference | Request/display-only boundary and outage behavior implemented | Pending | Trust Testnet endpoint and schema accepted |
| 26 Data Fabric | Canonical Seller events and Billing Ledger facts | Versioned local role, invitation and revocation Outbox plus idempotent-ingest vectors complete | Pending | Event schema/version and ingest acknowledgement frozen |
| 13 Monitor | Health, version, SLO and incident signals | Local health/version/capability endpoints exist | Pending | Monitor ingestion contract accepted and shared signals observed |
| 28 Website | Canonical `/seller-console` route and current metadata | `public-product-metadata.json` and Website handoff complete for `ynxweb4.com` | Pending | Exact current-source route deployed and canonical/OG/JSON-LD/Sitemap/robots verified |
| 29 Integration | Shared Testnet freeze and end-to-end proof | Machine contract and cross-product vectors complete locally | Pending | Central dependencies available and exact shared vectors executed |
| 30 Security/SRE | Artifact, SBOM, provenance, backup, migration/restore and release gates | Rollback/data-lifecycle implementation, runbook and local evidence complete | Pending | Security release review, staging-copy restore drill and immutable artifact evidence completed |

## Locally verified but not centrally accepted

- First-time Seller membership requires acceptance by the exact target canonical Wallet account.
- Invitation identifiers alone grant no authority; wrong-account access returns not found.
- Role, invitation, revocation, Audit and Outbox writes roll back together when persistence fails.
- Owner-only role revocation removes local Seller authority before the Wallet call.
- A store-scoped Wallet receipt is accepted only when request, account, product, bundle, resource, count, identifier and time bindings are valid.
- Snapshot v6 rejects future versions, exports only representable v3/v4/v5 rollback state, and preserves HMAC integrity.
- Store-scoped owner data export and preview-first transient retention are locally tested.
- Public metadata and the Website handoff are prepared, but no current-source canonical route is verified.

## Acceptance procedure

1. The central owner reviews the exact source commit and machine-readable contract.
2. The central owner records the accepted schema/version and endpoint or adapter identity.
3. Both products execute the relevant positive and negative vectors in the shared environment.
4. Evidence records source commits, timestamps, request/receipt bindings and environment identity.
5. Seller Console updates `integratedCentral` only after direct acceptance evidence exists.
6. A handoff, local mock, HTTP 200 response or configured endpoint alone is insufficient.

## Explicitly not accepted

- Historical Seller staging at commit `38e2f68` is not current-source deployment evidence.
- A local product session adapter, invitation acceptance or Outbox record is not central Wallet or Data Fabric acceptance.
- A Website handoff is not deployment on `ynxweb4.com`.
- A local HTTP 200 response is not central integration or a business-complete transaction.
- Seller approval is not authoritative Pay settlement or refund evidence.
- Manual carrier input is not provider-verified tracking.

Minimum external inputs are listed in `release/integration/operator-inputs.request.json`.
