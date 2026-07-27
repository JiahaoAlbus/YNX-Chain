# YNX Finance Dependency Acceptance

Finance accepts external capabilities only as versioned, read-only evidence. A dependency is not accepted merely because an endpoint exists or returns HTTP 200.

## Universal acceptance gate

Every source owner must provide:

1. Owner and immutable source version or commit.
2. Network, product, authorized Wallet account and asset identity.
3. Record-level source and `asOf`, plus exact timestamp semantics.
4. Bounded coverage, pagination and completeness rules.
5. Synchronization, stale, partial, unavailable and recovery states.
6. Canonical error codes and negative test vectors.
7. Data rights, retention, license and jurisdiction where applicable.
8. No private key, seed, signer, withdrawal, owner-change or risk-override capability.
9. Restart, replay, tamper and account-isolation evidence.
10. Direct Testnet proof before `integratedCentral` or `testnetVerified` changes.

Missing fields fail closed. Finance must display an unavailable or partial state rather than infer values.

## Current dependency decisions

| Owner | Dependency | Local adapter | Central acceptance | Decision |
|---|---|---:|---:|---|
| 02 Wallet/Auth | Product session, introspection, expiry, revoke | Tested locally | No | Exact registry and vector ready; central merge/deployment/installed approval pending. |
| 12 Explorer | Health, authorized account, latest indexed activity | Tested locally | No | Accepted only as bounded local adapter contract; complete history remains prohibited. |
| 04 Pay | Owned receipt and dispute evidence | Tested locally | No | Authorized remote smoke pending secret-managed read credential. |
| 07 Exchange | Subaccounts, positions, orders, fills, fees, funding, PnL | No | No | Await versioned read-only contract and vectors. |
| 27 DEX | Vault, LP, swaps, fees, IL inputs, redemption | No | No | Await versioned read-only contract and vectors. |
| 08 Quant Lab | Strategy, mandate, PnL, drawdown, fees, risk and exit | No | No | Await canonical read model; Finance will not implement a Quant Engine. |
| 17 Economics | Issuance, burn, staking, treasury and service fees | Partial YNXT/staked balance | No | Await public versioned economics evidence API. |
| 14 AI | Draft categorization, explanations and budgets | Tested locally | No | Provider staging, quota, cost and retention evidence pending. |
| 13 Monitor | Source, API, recovery and SLO observability | No | No | Request/error IDs, metrics and trace propagation pending. |
| 26 Data Fabric | Canonical Finance read/audit events | No | No | Event schema and billing boundary pending. |
| 28 Website | `/finance`, metadata, downloads and SEO | Local web only | No | Public route, functional API and evidence not deployed. |
| 29 Integration | Shared Testnet freeze and proof | No | No | Cross-product sources and central Wallet are incomplete. |
| 30 Security/SRE | Secret, backup, artifact and release policy | Partial local audit | No | Deployment, restore drill, provenance and production signing pending. |

## Explicit rejection conditions

Finance rejects a dependency that:

- treats Testnet, sandbox, simulator, unsigned or local-test-signed output as production;
- omits source, version, `asOf`, coverage or failure state;
- allows caller-provided account identity to override Wallet introspection;
- exposes withdrawal, transfer, signing, owner-change, leverage, risk or treasury mutation;
- represents a quote, webhook, forecast, AI output or HTTP success as asset settlement;
- represents YNXT amount as fiat value, market cap, revenue, APY or guaranteed return;
- silently overwrites historical corrections;
- uses a mock or placeholder in a production bundle;
- cannot demonstrate replay, tamper, wrong-account and stale-data rejection.

## Re-evaluation rule

A dependency moves from pending to accepted only after the owner supplies its frozen contract, Finance implements the adapter and negative tests, Integration verifies the shared Testnet flow and the release record points to direct evidence. Documentation alone does not change release status.
