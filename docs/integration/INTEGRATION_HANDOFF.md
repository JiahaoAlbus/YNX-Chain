# YNX Merchant Console integration handoff

Status: **Active / FREEZE**  
Owner: `05-merchant-console`  
Contract: `release/integration/merchant-console-contract.json`  
Runtime source commit: `1f7963c8153a8a75cbbec0baadd1471ca5f2c9e9`

## What is locally authoritative

The Merchant Console owns merchant membership/RBAC, short merchant-console sessions after canonical Wallet/Gateway completion, merchant-scoped operational state, provider connection references, webhook operations, reconciliation export, merchant presentation of authoritative settlement evidence, and reviewable AI drafts.

It does **not** own Wallet identity, central session issuance, chain finality, central Pay settlement, Quant PnL/high-water-mark facts, Trust decisions, Billing Ledger facts, protocol economics, public deployment or shared-Testnet acceptance.

## Frozen product tuple

- Product: `pay-merchant`
- Client: `ynx-merchant-console-v1`
- Bundle: `com.ynxweb4.merchant-console`
- Callback: `https://pay.ynxweb4.com/merchant/wallet-auth/callback`
- Chain: `ynx_6423-1`
- Ordered scopes: `account:read`, `merchant:session:create`
- Device proof: `p256-sha256`
- Authorization request maximum TTL: five minutes
- Merchant session TTL: fifteen minutes

Any product, client, bundle, callback, chain, scope, device, digest, nonce, timestamp or membership mismatch fails closed.

## Current local acceptance

- Wallet/Gateway request parsing, device proof, replay/tamper/cross-product rejection: tested locally.
- Owner/Finance/Developer/Support/Viewer RBAC and membership-change invalidation: tested locally.
- Central-Pay-backed invoice and exact settlement evidence acceptance: tested locally with deterministic adapters.
- Refund/dispute records: tested locally; they never move funds.
- Webhook signature, retry, redirect/SSRF/DNS-rebinding containment: tested locally.
- Reconciliation schema v1: golden-tested locally.
- Provider registry and server-side probe evidence: tested locally; official adapters are not yet complete.
- Backup/restore/rollback, observability, release metadata and reproducible web bundle: tested locally.

## Required central contracts

| Owner | Required input | Merchant behavior while absent |
|---|---|---|
| 02 Wallet/Auth | accepted registry tuple, challenge/completion, introspection, expiry and revoke | no fallback login; central integration remains false |
| 04 Pay | authoritative invoice, settlement, receipt and refund execution | no UI/webhook-created paid state |
| 08 Quant | signed strategy identity, realized net PnL and high-water-mark evidence | performance fee values remain unavailable |
| 13 Monitor | metrics/alerts/incident ingestion | process-local metrics only |
| 14 AI | provider-neutral run, context consent, model/cost and audit | AI provider unavailable is shown honestly |
| 15 Trust | dispute/evidence/status/appeal references | local record only; no decision claim |
| 17 Economics | fee, burn, treasury, reserve definitions | no inferred fee split |
| 21 Bridge | cross-chain settlement lifecycle | cross-chain settlement unavailable |
| 26 Data Fabric | canonical events and Billing Ledger | no central ledger claim |
| 28 Website | `/merchant-console`, downloads, support/privacy/security/status and SEO | metadata only, no public URL claim |
| 29 Integration | unique protocol freeze and shared-Testnet acceptance | contract remains pending acceptance |
| 30 Security/SRE | artifact, provenance, deploy, backup and incident gates | local unsigned artifacts only |

## Release truth

`implementedLocal=true` and `testedLocal=true`. All installation, central integration, staging/public deployment, hosted download, production signing and store release states remain false.

## Recovery state

Three bounded pushes of runtime commit `1f7963c` returned upstream HTTP 502. A verified recovery bundle exists at `release/recovery/merchant-console-1f7963c.bundle`, SHA-256 `5fd0082dfbde40c335d07a68a7e5004ea745f4319c21cf3a4b8d6aed84d8e91e`. This is recovery evidence, not remote synchronization.

## Next integration action

Validate `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`, submit the contract to 29 Integration, then implement the highest-priority autonomous gaps: official sandbox adapters, signed Quant/Billing evidence ingestion, data rights state machines, operational search/pagination/bulk confirmation, full authenticated i18n/a11y, and reproducible capacity evidence.
