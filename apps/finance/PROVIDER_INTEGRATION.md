# Finance Broker Sandbox integration — incremental checkpoint

Authority: `YNX_Codex_Weekly_v3_Credential_Independent_ZH.md`, read 2026-09-19. This adds to Finance; it does not replace planning, reports, Wallet or the existing chain. No network configuration migration is included.

## Verified documentation, not verified credentials

Official sources read on 2026-09-19:

- [Authentication](https://docs.alpaca.markets/us/docs/authentication): Broker Sandbox and its auth host are distinct from personal Trading/Paper. M2M client credentials support body-posted client secret and private-key JWT; legacy authentication remains documented.
- [Broker getting started](https://docs.alpaca.markets/us/docs/getting-started-with-broker-api): assets `/v1/assets`, Broker orders `/v1/trading/accounts/{account_id}/orders`, SSE events and `X-Request-ID` audit correlation.
- [Trading account](https://docs.alpaca.markets/us/reference/gettradingaccount): Finance reads cash, buying power and the trading/account/suspension fences from `/v1/trading/accounts/{account_id}/account`; it does not use the account-registration route or personal `/v2/account` endpoint for trading preflight.
- [Broker orders](https://docs.alpaca.markets/us/reference/getallordersforaccount): account-scoped `/v1/trading/accounts/{account_id}/orders`, bounded to 500 per read by this adapter.
- [Broker positions](https://docs.alpaca.markets/us/v1.4.2/reference/getpositionsforaccount): account-scoped `/v1/trading/accounts/{account_id}/positions`.
- [Trade events v2](https://docs.alpaca.markets/us/v1.1/reference/subscribetotradev2sse): `/v2/events/trades` is the documented SSE event source; the legacy v1 route is deprecated for new partners.
- [Broker FAQ](https://docs.alpaca.markets/us/docs/broker-api-faq): Broker and personal Trading API serve different account models. No external stress tests are authorized.

Implementation: Go standard-library HTTP, no third-party Alpaca SDK. Broker REST path version v1; no claim that a locally pinned SDK/schema is the provider's latest release. Fixed sandbox origins, no redirects or environment proxy, bounded time/body, no automatic retries. Official account entitlements remain unknown.

## Authentication choice

Default `client_credentials` uses `client_secret_post`, caches tokens in server memory with expiry safety margin and concurrent refresh serialization. Tokens are credentials, not durable business state. The implementation never prints them. Explicit `legacy_basic` supports operators actually provisioned Broker key/secret credentials; there is no silent fallback between modes. `private_key_jwt` is **unsupported**, not emulated; if that is the only provisioned method, implement it before activation. Broker credentials must never enter Web/mobile bundles or public status.

## Implemented credential-independent boundary and explicit gaps

Implemented: fail-closed server configuration; normalized asset search, account/cash/buying-power, orders and positions reads; provider-verified owner watchlists; bounded read-only reconciliation; safe provider errors/request IDs; public no-secret module status; guest not-configured UI; and read-only doctor. The persistent resolver is backed by Finance state v2 and is keyed by authenticated YNX subject + provider + trading environment. It also stores the operator-verified Wallet public key used for order approval, so the browser never asks a user to type either a Broker asset UUID or Wallet public key. There is no shared global Broker account and no browser-supplied provider account selection.

The accepted `finance-order-approval-v1` files are imported byte-for-byte with four source SHA-256 values. Finance derives the subject from trusted session identity, validates exact decimals without floats, persists challenges/orders/journal/outbox, arbitrates reject/revoke/expire/consume through one CAS and allocates one stable `client_order_id`. Manual and AI-produced draft fields use the same deterministic validator. The provider adapter's submit/cancel methods are deliberately fail-closed and perform no POST in this checkpoint.

Implemented product entry: public provider-backed asset search; authenticated owner watchlist; owner snapshot; controlled refresh/reconcile; persisted local approval/outbox/journal recovery; and a cancellation-intent route that never contacts the provider. Challenge/callback are authenticated and remain Finance-profile writes. The operator-only worker now provides account linking, query, reconciliation, bounded SSE application, one-shot dispatch and one-shot cancellation. Provider submit/cancel still require the separate write flag and exact activation receipt; no browser route can invoke them.

Still unverified: official credentials, market-data entitlement, simulated funding, real v2 SSE transport, an authorized low-frequency provider write, public deployment and visible Wallet approval. All unconfigured provider reads fail explicitly and no fallback asset, balance, order or trade is synthesized.

Frozen shared authority: `finance-order-approval-v1.md` SHA-256 `f236823ba32a892c4157745490d2ff2767dcc33928b4d4b9dbbbfb8e0dc334f3` plus schema `c3e61e2...`, transport `f45c7ab4...` and vectors `f8f4810e...`. Product Session identity is not order approval. DEX/Card signatures are not repurposed. Submission stays disabled even if credentials exist or an operator prematurely turns on the write flag.

Six independent statuses: implemented=credential-independent-core; contractTested=local-fixture-only; officialSandboxVerified=false; publicDeployed=false; publicVerified=false; productionApproved=false. The presence of credentials or a successful asset GET cannot change these aggregate gates.
