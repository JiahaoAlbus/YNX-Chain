# YNX Seller Console Dependency Acceptance

Source commit: `937cf10f387bd1d31d86652ab06d74bc6185f35c`  
Stage: `FREEZE`  
Goal status: `Active`

No dependency below is accepted merely because a local adapter, local Outbox, historical endpoint, or passing fixture exists. Acceptance requires the exact owner contract and direct shared-environment evidence.

| Owner | Required contract | Acceptance tests | State | Unblock condition |
|---|---|---|---|---|
| 02 Wallet/Auth | `ynx-seller-v1`, bundle `com.ynxweb4.seller-console`, callback `ynxseller://wallet-auth/callback`, ordered scopes `account:read`, `shop:seller:operate`, plus `POST /v1/product-authorizations/revocations` for `seller_store` | valid session; wrong product/bundle/device; scope widening/reordering; expiry; revoke; replay; exact request/account/product/bundle/resource receipt binding; unavailable/rejected behavior; invitation acceptance account equals the canonical session account | Pending | Central registry and store-scoped authorization-revocation contract deployed; shared vectors pass |
| 04 Pay | Exact committed settlement and refund evidence | wrong invoice/intent/merchant/payout/payer/amount/hash/block rejected; valid evidence accepted once | Pending | Testnet merchant configuration and authoritative endpoint available |
| 15 Trust Center | Dispute/appeal evidence reference | provider success stored; outage remains unavailable; no local adjudication | Pending | Trust Testnet endpoint and contract accepted |
| 26 Data Fabric | Canonical Seller events and billing ledger; consume local role-update, invitation and revocation Outbox candidates | idempotent ingest; source/schema/event and role/invitation/revocation bindings retained; unavailable/rejected never normalized to confirmed; invitation states remain distinct; no Seller-side fee reconstruction | Pending | Event schema/version and ingest acknowledgement frozen |
| 13 Monitor | Health, version, SLO and incident signals | stale/down dependency visible; no fake healthy | Pending | Monitor ingestion contract accepted |
| 28 Website | Canonical `/seller-console` route, public metadata and current artifacts | canonical URL, metadata, status and immutable artifact hashes match current source commit | Pending | Current-source release bundle hosted |
| 29 Integration | Shared Testnet freeze and end-to-end proof | Wallet login → invite/accept/role update → revoke/invalidate → catalog/inventory → order → Pay → fulfillment → refund/dispute → recovery | Pending | Central dependencies available and merged |
| 30 Security/SRE | Secret, artifact, backup, restore and release gates | secret scan, SBOM, provenance, restore drill, remote smoke | Pending | Security release review completed |

## Locally verified but not centrally accepted

- First-time Seller membership requires acceptance by the exact target canonical Wallet account.
- Invitation identifiers alone grant no authority; wrong-account access returns not found.
- Role, invitation, Audit and Outbox writes roll back together when persistence fails.
- Owner-only role revocation removes local Seller authority before the Wallet call.
- A store-scoped Wallet receipt is accepted only when request, account, product, bundle, resource, count, identifier and time bindings are valid.
- Missing, rejected or mismatched receipts remain `unavailable` or `rejected`; role regrant stays blocked.
- Snapshot v6 persists invitations, roles, revocations and append-only Seller Outbox records across restart.

## Explicitly not accepted

- Historical Seller staging at commit `38e2f68` is not current-source deployment evidence.
- A local product session adapter, invitation acceptance or Outbox record is not central Wallet or Data Fabric acceptance.
- A local HTTP 200 response is not central integration or a business-complete transaction.
- Seller approval is not authoritative Pay settlement or refund evidence.
- Manual carrier input is not provider-verified tracking.
