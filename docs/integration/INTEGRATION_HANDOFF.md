# YNX Shop integration handoff

Source commit: `4267fdbf3ff581043bafef5c357d915f1904b964`  
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

The privacy source is tested locally across Commerce, Web and native static contracts. It is not present on the existing staging deployment, which still reports source `38e2f68`.

## Release truth

Existing Staging and hosted artifacts are evidence for source `38e2f68deb91d5f26e5aeec2318e260cd0742115`. Current source `4267fdbf3ff581043bafef5c357d915f1904b964` is implemented and tested locally but is not current-source installed, centrally integrated, staged, public, hosted, production signed or store released.

## Acceptance sequence

1. 02 Wallet/Auth accepts and deploys the registry tuple.
2. 04 Pay provisions the Shop Testnet merchant/payout and confirms the evidence schema.
3. 26 Data Fabric accepts or revises the candidate event envelope.
4. 29 Integration freezes the contract and runs cross-product vectors.
5. 30 Security/SRE builds immutable current-source artifacts and deploys Staging.
6. Shop, Pay, Trust, Explorer and Monitor execute the positive order/refund/dispute flow plus negative replay/tamper/fake-payment vectors.
7. 28 Website consumes the public metadata only after the release record references current direct evidence.
