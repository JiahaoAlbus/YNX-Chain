# YNX DEX dependency acceptance

Source commit: `4d9f9c807efb2529836a1324b17c697e91a23421`

No central dependency is accepted merely because a local adapter or fixture passes. Each owner must return an exact version, source commit, environment, health/version evidence and the relevant cross-product vector results.

| Dependency | Owner | Required contract | Local adapter status | Acceptance status |
| --- | --- | --- | --- | --- |
| Wallet/Auth/Gateway | YNX 02 | Client `ynx-dex-web-v1`, bundle `com.ynxweb4.dex.web`, P-256 device binding, exact scopes including `dex:vault:execute`, approval digest, introspection, expiry and revoke | Implemented and tested locally; PWA fails closed when unavailable | Pending |
| Quant Engine | YNX 08 | Typed quote/execute/reconcile adapter only; no DEX backtest, optimization or capital allocation; no arbitrary recipient or owner mutation | CPMM and direct StableSwap Vault requests tested locally | Pending |
| Explorer | YNX 12 | Exact transaction/block/log/method/nonce proof and reorg removal | Indexed reconciliation implemented locally | Blocked by Testnet deployment |
| Monitor | YNX 13 | Non-static health/ready/version, cursor/RPC/reorg/schema alerts, request/error/audit identifiers | Health/version surface exists locally; alert integration incomplete | Pending |
| Trust Center | YNX 15 | Source, tests, artifact hashes, audit/deployment/signing status and known limitations | Truthful local release records exist | Pending |
| Oracle | YNX 19 | Reviewed source-labelled price/peg facts with age, confidence/coverage, version, depeg policy and outage semantics | Typed stale/depeg boundaries tested locally | Pending |
| Finance | YNX 24 | Principal/fee/incentive separation and transaction-bound attribution; no fake revenue or unrealized-profit fee | Local fee invariants exist | Pending |
| Data Fabric & Billing Ledger | YNX 26 | Canonical event identity, idempotency, reorg semantics, schema version and fee class | Typed Indexer events implemented locally | Pending |
| Website | YNX 28 | Consume `/dex` metadata; separate website publication from runtime deployment; no links before hosted evidence | Public metadata package prepared | Pending |
| Integration | YNX 29 | Freeze one owner/version for scopes, events, errors, schemas and deployment addresses | Candidate contract and vectors prepared | Pending |
| Security/SRE | YNX 30 | Audit findings, secret/dependency/license/SAST/artifact gates, provenance, signer/hosting and public status policy | Local contract and artifact gates pass; audit/public release absent | Pending |

## Acceptance procedure

1. Validate the owner and exact source/version before exercising an adapter.
2. Run the relevant entries in `CROSS_PRODUCT_TEST_VECTORS.json`, including all negative cases.
3. Save raw request/response, transaction, event, health and version evidence without secrets.
4. Record accepted schema/event/error/scope versions in the Integration owner repository.
5. Keep DEX fail closed if owner identity, scope, source metadata, expiry, health or version is missing.
6. Re-run affected migration, recovery, release and public gates after any accepted contract changes.

## Explicit non-acceptance

- A mock, fixture, local dev server or static green health response is not central acceptance.
- A Testnet RPC probe without deployed DEX bytecode is not DEX Testnet acceptance.
- A Website page is not runtime deployment.
- A Wallet preview without exact approval/introspection/revoke evidence is not transaction authorization.
- A price response without source, age and failure semantics is not an accepted Oracle fact.
