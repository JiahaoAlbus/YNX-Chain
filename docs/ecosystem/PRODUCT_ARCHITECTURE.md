# YNX Ecosystem Product Architecture

## Product rule

YNX Chain is one ecosystem, not one overloaded screen. Shared `ynx1...` identity, YNXT settlement, Trust evidence, resource accounting, and signed APIs connect the products. A service becomes a visible product only when its protocol, persistence, security controls, user workflow, tests, deployment, and truthful status are real.

The portfolio must not put every backend service in the main App bottom bar. A five-tab bar is already the practical upper bound. Deeper capabilities belong in domain navigation, a searchable ecosystem launcher, universal links, or a separate application suited to the workflow.

## Product portfolio

### YNX App for iOS and Android

The primary consumer application owns the daily identity boundary:

- Home: account status, relevant activity, and safe ecosystem entry points.
- Social: Square feed, Chat, contacts, notifications, and later profile/moments-style publishing inside one social domain.
- Wallet: YNXT assets, receive, send, resource usage, and explicit EVM compatibility detail.
- Pay: scan/import, payment review, receipts, merchant identity, refunds, and disputes when the matching protocols are live.
- Activity: unified transactions, payments, social notifications, Trust evidence, and security events.

Chat, feed, contacts, and moments-style publishing are related social routes, not unrelated bottom tabs. Settings, device management, security, network, and developer mode are secondary routes.

### YNX Developer Suite

IDE, contract tooling, deployment, logs, RPC keys, project management, and documentation need dense desktop workflows. They belong in a dedicated Web and desktop application for macOS and Windows, with mobile limited to monitoring and approvals. The current bounded IDE is an engineering subset, not a complete developer product.

### YNX Explorer

Explorer remains a standalone public Web application backed by live Indexer/RPC data. It should grow into accounts, blocks, transactions, contracts, validators, tokens, resources, governance, Trust evidence, analytics, and verified source workflows. It must not become a static page inside the consumer App.

### YNX Commerce

Shop, merchant console, catalog, orders, inventory, checkout, settlement, refunds, disputes, and seller analytics form one commerce domain. Consumer discovery can open from YNX App, while merchant operations require a separate Web/desktop console. No Shop UI is shipped until a real order and settlement lifecycle exists.

### YNX Browser

A browser is a separate security product, not an iframe or placeholder route. It requires a proven browser engine, origin isolation, permission mediation, wallet/session controls, phishing protection, downloads, updates, and platform packaging. It can share YNX identity and Pay APIs only through explicit consent boundaries.

### Infrastructure products

AI Gateway, Trust, Anti-Illegal Request, Request Validity, Appeal/Transparency, Resource Market, custody, bridge, issuer, and exchange-readiness controls are platform capabilities. They receive user windows only where a complete workflow exists, such as an AI conversation client, Trust case center, resource marketplace, or governance console. Readiness packages remain documentation and controls, not consumer applications.

## Platform matrix

| Surface | Primary role | Delivery boundary |
| --- | --- | --- |
| iOS / Android | daily identity, social, wallet, Pay, approvals | native interaction and secure local keys |
| Web | Explorer, docs, public status, Square fallback, commerce discovery | responsive public and signed browser workflows |
| macOS / Windows | IDE, developer console, merchant operations, validator/operator tooling | dense professional workflows and signed releases |
| Chain services | RPC, Indexer, Chat, Square, Pay, Trust, AI, Resource, governance | authenticated APIs, persistence, audit, monitoring, rollback |

Linux desktop packaging is a later distribution target where the same real desktop workflow is stable. Platform packaging does not turn an incomplete service into a finished product.

## Navigation and integration

- Use stable product routes and universal links rather than one long page.
- Use one ecosystem registry sourced from verified capability metadata; unavailable products show an honest readiness state and no fake launch action.
- Preserve `ynx1...` as the native default. `0x...` remains an explicit EVM compatibility representation.
- Use account-bound sessions and least-privilege scopes between products. Sharing an account does not imply sharing private keys or unrestricted sessions.
- Put Trust/appeal evidence beside the transaction, payment, social report, or governance request that created it.
- Put developer documentation in the official site with direct routes and search; external repositories remain source links, not the only documentation UI.

## Delivery gate

A product or module is visible as usable only after all applicable items exist:

1. Real domain model and persistent state.
2. Authenticated and bounded API handlers.
3. Fail-closed security and abuse controls.
4. Complete primary workflow, error states, recovery, and audit evidence.
5. Unit/integration tests and a reproducible smoke target.
6. Exact deployment/package evidence for the claimed platform.
7. Live-data verification where a public claim is made.
8. Explicit incomplete and external-approval boundaries.

This architecture is a delivery boundary, not a claim that Shop, Browser, complete IDE, desktop packages, groups, moments, or the other target products already exist.
