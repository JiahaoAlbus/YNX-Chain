# YNX Shop integration handoff

Source commit: `a9f9ff932ede1091882509a219755b4b18a88c92`
Contract: `release/integration/ynx-shop-contract.json`  
Test vectors: `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`  
Status: Candidate for 29 Integration freeze; not centrally integrated or current-source deployed.

## Product ownership

YNX Shop owns buyer catalog, profile, cart, inventory reservation, order lifecycle, fulfillment state, return/refund request state, review state and buyer privacy operations. It does not own Wallet identity, Pay settlement, Trust authority, Data Fabric canonical envelopes, public Website publication or release infrastructure.

## Wallet/Auth handoff

The exact registry input is `internal/commerce/integration/shop-registry-v2.json`:

- client: `ynx-shop-v1`
- product: `shop`
- bundle: `com.ynxweb4.shop`
- callback: `ynxshop://wallet-auth/callback`
- ordered scopes: `account:read`, `shop:orders:write`, `shop:profile:write`
- device algorithm: `p256-sha256`

The central owner must merge this exact tuple, preserve ordered scopes and run replay, callback substitution, wrong-product, wrong-bundle, wrong-device, expiry and revoke vectors. Until deployment is evidenced, authenticated staging remains fail closed and `integratedCentral` stays false.

## Pay handoff

Shop accepts only committed Pay evidence that exactly matches the order intent, merchant, payout, payer, asset, amount, invoice, intent digest, transaction hash, block and audit fields. A quote, webhook, HTTP success or provider acknowledgement is not settlement. The Pay owner must provision a bounded Shop Testnet merchant and payout address through the approved operator path and return references, not key material.

## Trust handoff

Shop sends bounded order/dispute evidence and accepts case status plus evidence/appeal URLs. Trust cannot pay, refund, freeze, seize, blacklist or move YNXT. Unsupported authority fields must fail closed.

## Data Fabric handoff

The contract contains candidate Shop events and the required envelope fields. Event names remain candidates until 26 Data Fabric and 29 Integration freeze one version. Shop will not maintain a second canonical event format after acceptance.

## Privacy handoff

Current source adds:

- `GET /api/privacy/export`
- `POST /api/privacy/delete`
- exact confirmation `DELETE_MY_SHOP_DATA`
- deletion refusal while any order is non-terminal
- deletion of profile, address, cart, AI jobs and buyer-scoped request state
- pseudonymization of terminal order personal fields
- preservation of authoritative public-chain settlement evidence and integrity records

The privacy source is tested locally across Commerce, Web and native static contracts. Web/PWA, Android and iOS privacy controls and dynamic results cover all twelve locales, with Arabic RTL wiring and Arabic-script values verified statically. It is not present on a current-source staging deployment.

## Migration and observability handoff

Current persistence schema is v2. A valid v1 snapshot migrates forward atomically; unsupported future versions fail closed. An explicit rollback to v1 first writes an exact v2 recovery point, then omits buyer profiles, carts and rate windows because v1 cannot represent them. Exact restore, HMAC verification, tamper rejection and old-client vectors pass locally. See `MIGRATION_COMPATIBILITY.md`.

`GET /metrics` exposes bounded Prometheus runtime, state and dependency gauges. Raw paths, accounts, order/product IDs, tokens and request data are forbidden as labels. `/health` exposes exact build, process start, integrity and Wallet/Pay/Trust/AI availability. Local load evidence is in `SLO_CAPACITY_PLAN.md`; it is not public capacity. Unit-economics formulas and required verified operator inputs are in `UNIT_ECONOMICS.md`.

## Release truth

Historical Staging and hosted artifacts were evidence for source `38e2f68deb91d5f26e5aeec2318e260cd0742115`, but the historical Shop Staging and API URLs returned HTTP 404 during the 2026-07-29 recovery audit. Current source `a9f9ff932ede1091882509a219755b4b18a88c92` is implemented and tested locally but is not current-source installed, centrally integrated, staged, public, hosted, production signed or store released. `https://ynxweb4.com/shop` returned the generic website shell with a homepage canonical, so a Shop-specific public page is not verified.

## Acceptance sequence

1. 02 Wallet/Auth accepts and deploys the registry tuple.
2. 04 Pay provisions the Shop Testnet merchant/payout and confirms the evidence schema.
3. 26 Data Fabric accepts or revises the candidate event envelope.
4. 29 Integration freezes the contract and runs cross-product vectors.
5. 30 Security/SRE builds immutable current-source artifacts and deploys Staging.
6. Shop, Pay, Trust, Explorer and Monitor execute the positive order/refund/dispute flow plus negative replay/tamper/fake-payment vectors.
7. 28 Website consumes the public metadata only after the release record references current direct evidence.
