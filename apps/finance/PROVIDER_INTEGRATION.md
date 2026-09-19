# Finance Broker Sandbox integration — incremental checkpoint

Authority: `YNX_Codex_Weekly_v3_Credential_Independent_ZH.md`, read 2026-09-19. This adds to Finance; it does not replace planning, reports, Wallet or the existing chain. No network configuration migration is included.

## Verified documentation, not verified credentials

Official sources read on 2026-09-19:

- [Authentication](https://docs.alpaca.markets/us/docs/authentication): Broker Sandbox and its auth host are distinct from personal Trading/Paper. M2M client credentials support body-posted client secret and private-key JWT; legacy authentication remains documented.
- [Broker getting started](https://docs.alpaca.markets/us/docs/getting-started-with-broker-api): assets `/v1/assets`, Broker orders `/v1/trading/accounts/{account_id}/orders`, SSE events and `X-Request-ID` audit correlation.
- [Account read](https://docs.alpaca.markets/us/reference/getaccount): `/v1/accounts/{account_id}`.
- [Trading account](https://docs.alpaca.markets/us/reference/gettradingaccount): `/v1/trading/accounts/{account_id}/account`; not the personal `/v2/account` endpoint.
- [Broker FAQ](https://docs.alpaca.markets/us/docs/broker-api-faq): Broker and personal Trading API serve different account models. No external stress tests are authorized.

Implementation: Go standard-library HTTP, no third-party Alpaca SDK. Broker REST path version v1; no claim that a locally pinned SDK/schema is the provider's latest release. Fixed sandbox origins, no redirects or environment proxy, bounded time/body, no automatic retries. Official account entitlements remain unknown.

## Authentication choice

Default `client_credentials` uses `client_secret_post`, caches tokens in server memory with expiry safety margin and concurrent refresh serialization. Tokens are credentials, not durable business state. The implementation never prints them. Explicit `legacy_basic` supports operators actually provisioned Broker key/secret credentials; there is no silent fallback between modes. `private_key_jwt` is **unsupported**, not emulated; if that is the only provisioned method, implement it before activation. Broker credentials must never enter Web/mobile bundles or public status.

## Implemented slice and explicit gaps

Implemented: fail-closed server configuration, normalized assets and owner-resolved account-status reads, safe provider errors/request IDs, public no-secret module status, guest not-configured UI, read-only doctor. An `AccountResolver` must read a persistent owner/provider/environment mapping; there is no shared global Broker account. No browser route exposes direct provider account selection.

Not yet implemented: persistent mapping writes, market-data entitlement/read adapter, exact-money order validation, outbox/idempotency, submit/query/cancel, positions/cash, event cursor/reconciliation, watchlist, AI order drafts, complete order UI. `Capabilities()` labels these honestly. This is not the completed work package.

Wallet handoff read: `wallet-resume-20260919/finance-order-approval-handoff.md`, Wallet owner baseline 3720cd63. Finance securities proof/domain/scope is a proposal, not an accepted SDK capability. Product Session identity is not order approval. DEX/Card signatures must not be repurposed. Submission stays disabled even if credentials exist or an operator prematurely turns on the write flag.

Six independent statuses for this slice: implemented=partial; contractTested=local-fixture-only (see handoff test results); officialSandboxVerified=false; publicDeployed=false; publicVerified=false; productionApproved=false. The presence of credentials or a successful asset GET cannot change these aggregate gates.
