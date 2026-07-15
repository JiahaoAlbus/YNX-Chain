# YNX Ecosystem Product Architecture

## Product rule

YNX Chain is a full-stack blockchain ecosystem made of distinct products, not one overloaded super App. Wallet is a wallet, Social is a social network, Exchange is an exchange, Shop is commerce, and Monitor is an operator tool. Each product has its own package, bundle identifier, navigation, release evidence, security scopes, and product-appropriate icon.

Shared `ynx1...` identity, YNXT settlement, Trust evidence, resource accounting, and signed APIs connect products only through explicit consent. A Social user finds people by `@handle`, contacts, invite links, or QR codes. The chain account remains the cryptographic principal and is not the normal friend-search interface.

Klein blue `#002FA7` and white are the ecosystem foundation. Apple-style means restrained hierarchy, platform-native interaction, motion, accessibility, clear recovery, and predictable navigation. It does not mean copying Apple or a benchmark product's protected artwork or exact interface.

The current `com.ynxweb4.mobile` build is an internal integration and acceptance shell. It is not the final consumer product and must not be marketed as the YNX ecosystem App.

## Independent product portfolio

| Product | Primary benchmark | Required complete workflow | Delivery boundary | Current truth |
| --- | --- | --- | --- | --- |
| YNX Social | WeChat contacts/messages/moments plus Instagram publishing/discovery | profile and unique handle, contacts, direct and group messaging, feed, media, notifications, privacy, moderation, Trust/appeal | separate iOS/Android App; bounded Web companion | bounded Square, profile, alert, and E2EE direct-message engineering exists; complete Social product is not delivered |
| YNX Wallet | MetaMask plus modern native wallet safety | account creation/import/recovery, assets, send/receive, activity, DApp permissions, signing review, networks, hardware/custody boundaries | separate iOS/Android App and browser extension; later desktop | native test wallet engineering exists; owner production signing, extension, stores, and independent audit are incomplete |
| YNX Pay | Apple Pay/Alipay-style payment ergonomics over YNXT and approved assets | scan, invoice, payer review, merchant identity, receipt, refund, dispute, merchant acceptance | separate consumer Pay App where justified; merchant SDK and console | Pay API and bounded native payment flow exist; complete merchant network and production settlement proof are incomplete |
| YNX Exchange | Binance-style market, account, order, custody, and risk workflows | markets, deposits, withdrawals, order book, orders, trade history, fees, controls, proof and support | separate mobile App plus professional Web/desktop terminal | testnet integration candidate exists; no exchange listing, production custody, or complete trading venue is claimed |
| YNX Shop | Amazon-style search, catalog, cart, checkout, fulfillment, returns, reviews, and seller operations | buyer and seller lifecycle from catalog to settlement, refund, dispute, Trust evidence | separate consumer App/Web plus seller console | target product; no usable Shop is claimed until order and settlement state machines exist |
| YNX Explorer | TRONSCAN-class live chain coverage with Apple-style interaction discipline | live blocks, transactions, accounts, contracts, validators, resources, tokens, governance, Trust, analytics, source verification | standalone public Web/PWA | real RPC/Indexer-backed Explorer exists; feature breadth and availability hardening remain incomplete |
| YNX Developer | VS Code/Remix-class project and deployment workflows | editor, compile, test, deploy, verify, logs, RPC keys, docs, projects, collaboration | standalone Web and signed macOS/Windows desktop App | bounded IDE execution exists; complete IDE and signed desktop distributions are incomplete |
| YNX AI | ChatGPT-style conversation ergonomics over permissioned AI Gateway | conversations, model/provider status, tools, usage/cost, permissions, audit, data controls | separate mobile/Web/desktop client | Gateway engineering exists; successful provider-backed production generation remains externally blocked |
| YNX Monitor | Grafana/explorer-grade operational visibility | nodes, validators, peers, releases, incidents, alerts, logs, SLOs, rollback evidence | separate authenticated Web/desktop operator product | monitoring endpoints and checks exist; complete operator product is not delivered |
| YNX Trust Center | case-management and transparency workflows | evidence, tracing, request validity, rejection reasons, appeals, correction, transparency reports | standalone Web and contextual universal links from other products | protocol/API engineering exists; full public case-center product remains incomplete |
| YNX Resource Market | cloud marketplace-style capacity management | resource balance, rental/delegation, sponsored pools, pricing, income, history, disputes | standalone Web/mobile product | runtime slices exist; current public release and complete marketplace workflow remain incomplete |
| YNX Browser | Safari/Chrome-class browsing with explicit Web4 permissions | proven engine, origin isolation, tabs, downloads, permissions, phishing controls, wallet/session mediation, updates | separate desktop/mobile browser | target product; no browser is claimed |

Benchmarks define expected workflow completeness and usability, not partnerships, compatibility approval, copied code, or copied branding.

## Shared platform, separate trust

- Every product uses a distinct package/bundle identifier and a least-privilege Gateway client binding.
- A user may link the same native account across products without exporting a private key from one App to another.
- Social stores and displays profile identity; Wallet owns asset custody UI; neither impersonates the other.
- Universal links and QR payloads carry bounded intents such as a Social profile, Pay invoice, Explorer transaction, or DApp permission request.
- Product icons may share the YNX design language but must remain recognizable by function. The canonical YNX logo identifies the chain and parent ecosystem.
- The official website is a searchable ecosystem directory, documentation surface, status source, and deep-link router. It is not a substitute for the independent products.

## Platform matrix

| Surface | Primary role |
| --- | --- |
| iOS / Android | separate Social, Wallet, Pay, Exchange, Shop, AI, and approval clients where the complete workflow is real |
| Web / PWA | Explorer, docs, official status, Exchange terminal, Shop, Trust Center, Resource Market, and bounded product companions |
| macOS / Windows | Developer, Exchange professional terminal, merchant operations, Monitor, and later Browser |
| Browser extension | Wallet DApp permissions and transaction signing only |
| Chain services | RPC, Indexer, Chat, Square, Pay, Trust, AI, Resource, governance, and audited product APIs |

Linux packaging is a later distribution target after the corresponding desktop workflow is stable.

## Delivery order

1. Preserve the existing mixed mobile build as an internal acceptance shell only.
2. Deliver separate YNX Social and YNX Wallet packages from already real protocol capabilities.
3. Complete Social handle/contact discovery and remove chain-address friend search.
4. Add product-specific Gateway bindings, key-consent boundaries, packaging checks, installed-device proof, and truthful store-signing status.
5. Deliver each later product only after its persistent domain workflow and security controls are real.

## Delivery gate

A product is visible as usable only after all applicable items exist:

1. Real domain model and persistent state.
2. Authenticated, bounded API handlers and least-privilege client scopes.
3. Fail-closed security and abuse controls.
4. Complete primary workflow, error states, recovery, and audit evidence.
5. Unit/integration tests and a reproducible smoke target.
6. Exact deployment/package evidence for the claimed platform.
7. Live-data verification where a public claim is made.
8. Explicit incomplete and external-approval boundaries.

This architecture is a delivery contract. It does not claim that complete Social, Wallet, Pay, Exchange, Shop, Developer, AI, Monitor, Trust Center, Resource Market, or Browser products are already launched.
