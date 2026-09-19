# Finance Broker Sandbox integration — incremental checkpoint

Authority: `YNX_Codex_Weekly_v3_Credential_Independent_ZH.md`, read 2026-09-19. This adds to Finance; it does not replace planning, reports, Wallet or the existing chain. No network configuration migration is included.

## Verified documentation, not verified credentials

Official sources read on 2026-09-19:

- [Authentication](https://docs.alpaca.markets/us/docs/authentication): Broker Sandbox and its auth host are distinct from personal Trading/Paper. M2M client credentials support body-posted client secret and private-key JWT; legacy authentication remains documented.
- [Broker getting started](https://docs.alpaca.markets/us/docs/getting-started-with-broker-api): assets `/v1/assets`, Broker orders `/v1/trading/accounts/{account_id}/orders`, SSE events and `X-Request-ID` audit correlation.
- [Account read](https://docs.alpaca.markets/us/reference/getaccount): `/v1/accounts/{account_id}`.
- [Trading account](https://docs.alpaca.markets/us/reference/gettradingaccount): `/v1/trading/accounts/{account_id}/account`; not the personal `/v2/account` endpoint.
- [Broker orders](https://docs.alpaca.markets/us/reference/getallordersforaccount): account-scoped `/v1/trading/accounts/{account_id}/orders`, bounded to 500 per read by this adapter.
- [Broker positions](https://docs.alpaca.markets/us/v1.4.2/reference/getpositionsforaccount): account-scoped `/v1/trading/accounts/{account_id}/positions`.
- [Trade events v2](https://docs.alpaca.markets/us/v1.1/reference/subscribetotradev2sse): `/v2/events/trades` is the documented SSE event source; the legacy v1 route is deprecated for new partners.
- [Broker FAQ](https://docs.alpaca.markets/us/docs/broker-api-faq): Broker and personal Trading API serve different account models. No external stress tests are authorized.

Implementation: Go standard-library HTTP, no third-party Alpaca SDK. Broker REST path version v1; no claim that a locally pinned SDK/schema is the provider's latest release. Fixed sandbox origins, no redirects or environment proxy, bounded time/body, no automatic retries. Official account entitlements remain unknown.

## Authentication choice

Default `client_credentials` uses `client_secret_post`, caches tokens in server memory with expiry safety margin and concurrent refresh serialization. Tokens are credentials, not durable business state. The implementation never prints them. Explicit `legacy_basic` supports operators actually provisioned Broker key/secret credentials; there is no silent fallback between modes. `private_key_jwt` is **unsupported**, not emulated; if that is the only provisioned method, implement it before activation. Broker credentials must never enter Web/mobile bundles or public status.

## Implemented credential-independent boundary and explicit gaps

Implemented: fail-closed server configuration; normalized assets, account/cash/buying-power, orders and positions reads; bounded read-only reconciliation; safe provider errors/request IDs; public no-secret module status; guest not-configured UI; and read-only doctor. The persistent resolver is backed by Finance state v2 and is keyed by authenticated YNX subject + provider + trading environment. There is no shared global Broker account and no browser-supplied provider account selection.

The accepted `finance-order-approval-v1` files are imported byte-for-byte with four source SHA-256 values. Finance derives the subject from trusted session identity, validates exact decimals without floats, persists challenges/orders/journal/outbox, arbitrates reject/revoke/expire/consume through one CAS and allocates one stable `client_order_id`. Manual and AI-produced draft fields use the same deterministic validator. The provider adapter's submit/cancel methods are deliberately fail-closed and perform no POST in this checkpoint.

Still unwired: market-data entitlement/read source, v2 SSE cursor consumer, public challenge/callback/submit/cancel routes, provider POST, provider cancellation, watchlist and the complete interactive order UI. Official credentials, multi-user account mappings, market-data rights, simulated funding and an authorized low-frequency write run are unverified. No fixture or local signature changes those facts.

Frozen shared authority: `finance-order-approval-v1.md` SHA-256 `f236823ba32a892c4157745490d2ff2767dcc33928b4d4b9dbbbfb8e0dc334f3` plus schema `c3e61e2...`, transport `f45c7ab4...` and vectors `f8f4810e...`. Product Session identity is not order approval. DEX/Card signatures are not repurposed. Submission stays disabled even if credentials exist or an operator prematurely turns on the write flag.

Six independent statuses: implemented=credential-independent-core; contractTested=local-fixture-only; officialSandboxVerified=false; publicDeployed=false; publicVerified=false; productionApproved=false. The presence of credentials or a successful asset GET cannot change these aggregate gates.
