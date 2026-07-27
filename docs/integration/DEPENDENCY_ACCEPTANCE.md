# YNX Seller Console Dependency Acceptance

Source commit: `pending-checkpoint`  
Stage: `FREEZE`  
Goal status: `Active`

No dependency below is accepted merely because a local adapter or historical endpoint exists. Acceptance requires the exact contract version and direct test evidence.

| Owner | Required contract | Acceptance tests | State | Unblock condition |
|---|---|---|---|---|
| 02 Wallet/Auth | `ynx-seller-v1`, bundle `com.ynxweb4.seller-console`, callback `ynxseller://wallet-auth/callback`, ordered scopes `account:read`, `shop:seller:operate` | valid session; wrong product/bundle/device; scope widening/reordering; expiry; revoke; replay | Pending | Central registry deployment and shared vector pass |
| 04 Pay | Exact committed settlement and refund evidence | wrong invoice/intent/merchant/payout/payer/amount/hash/block rejected; valid evidence accepted once | Pending | Testnet merchant configuration and authoritative endpoint available |
| 15 Trust Center | Dispute/appeal evidence reference | provider success stored; outage remains unavailable; no local adjudication | Pending | Trust Testnet endpoint and contract accepted |
| 26 Data Fabric | Canonical Seller events and billing ledger | idempotent ingest; source/audit IDs retained; no Seller-side fee reconstruction | Pending | Event schema/version frozen |
| 13 Monitor | Health, version, SLO and incident signals | stale/down dependency visible; no fake healthy | Pending | Monitor ingestion contract accepted |
| 28 Website | Canonical `/seller-console` route, public metadata and current artifacts | canonical URL, metadata, status and immutable artifact hashes match current source commit | Pending | Current-source release bundle hosted |
| 29 Integration | Shared Testnet freeze and end-to-end proof | Wallet login → RBAC → catalog/inventory → order → Pay → fulfillment → refund/dispute → recovery | Pending | Central dependencies available and merged |
| 30 Security/SRE | Secret, artifact, backup, restore and release gates | secret scan, SBOM, provenance, restore drill, remote smoke | Pending | Security release review completed |

## Explicitly not accepted

- Historical Seller staging at commit `38e2f68` is not current-source deployment evidence.
- A local HTTP 200 response is not central integration or a business-complete transaction.
- Seller approval is not authoritative Pay settlement or refund evidence.
- Manual carrier input is not provider-verified tracking.
