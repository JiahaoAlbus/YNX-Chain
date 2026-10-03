# Exchange Web write-contract continuation

Observed owner base: c70b1b073895ff81c21d32e93dd22765a47cb309, clean before this continuation. No shared authority or production change.

The current Web private adapter requests only `exchange:read`. The accepted service-side v2 policy allows only GET account, margin account and liability proof. Web action handlers in `web/app.js` deliberately send no write request. This is a functional gap, not a successful order/support/settings workflow.

| Existing service route | Existing legacy scope | Required shared decision before Web activation |
| --- | --- | --- |
| POST /v1/support | exchange:read | Explicit non-financial write grant, accepted route/proof contract and SDK entry |
| PUT /v1/security | exchange:read | Explicit settings write grant; legacy read label is not permission to widen v2 |
| POST /v1/ai/drafts | exchange:ai | Accepted draft scope and request contract |
| POST /v1/orders; POST /v1/orders/{id}/cancel | exchange:trade | Exact authorization, preview/confirmation and native signature contract |
| POST /v1/deposits | exchange:deposit | Accepted observation/write boundary and proof contract |
| POST /v1/withdrawals/review | exchange:withdrawal-review | Exact review/signature authority; no transfer implied |

Product-owned handlers, UI, validation, persistence, idempotency and recovery can continue under ordinary ownership. Shared Wallet/Auth/SSO/registration permissions and release graph remain their owner's responsibility. No v1 fallback or read-to-write elevation is allowed. First actionable shared input is the support/settings method-route-scope/proof/SDK contract, separate from financial operations.

Regression extends the real Go v2 fail-closed test with support, AI draft, cancellation, deposit and withdrawal routes. Each must return 403 before any shared authority call; private degradation must leave guest orderbook readable. Existing support tests exercise idempotency, account isolation, restart and CAS recovery independently; they do not prove Web authorization or public release.

Command: `go test -race ./internal/exchangeproduct -run 'TestBrowserV2FailClosedWithoutLegacyOrWriteFallback|TestOwnedSupport' -count=1 -timeout=120s`.

Public/provider approval, signatures, orders, transactions and installed delivery remain unproved. Dependency was sent to the user-designated chat 接续测试网生态审计工作 (01a094cc-0ba3-7901-bcd5-56fce8330c0d), not the former audit chat.
