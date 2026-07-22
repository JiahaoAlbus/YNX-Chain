# Merchant product API contract

Contract date: 2026-07-22. The implementation source of truth is
`internal/payproduct/server.go`; this document describes the current v1 HTTP
surface and does not claim a deployed endpoint.

## Transport and common behavior

- JSON requests are limited to 1 MiB and decoded strictly; unknown fields and
  trailing data are rejected.
- Every response carries `X-Request-ID` and `X-Trace-ID`. Error responses also
  carry `X-Error-ID` and return `{error,errorId,requestId,code}` without provider
  bodies, stack traces, credentials or server paths.
- Merchant-console endpoints accept only `Authorization: Bearer <session>` from
  the canonical Wallet/Gateway session exchange. Sessions bind merchant,
  account, role and membership version and expire after five minutes. Role
  changes invalidate older sessions.
- Gateway settlement/refund/dispute endpoints use the canonical signed Gateway
  assertion headers and exact request digest. Bootstrap and monitoring use
  separate server-only headers. There is no fallback authentication.

## Route inventory

| Method and route | Authority | Permission | Success | Purpose |
|---|---|---|---:|---|
| `GET /health` | public | direct checks only | 200/503 | Process/store evidence; dependencies remain `unverified` when not checked |
| `GET /internal/metrics` | `X-YNX-Monitor-Key` | dedicated 24+ character key | 200 | Process-local bounded request metrics; fails closed when unconfigured |
| `POST /v1/merchants/onboard` | `X-YNX-Bootstrap-Key` | deployment bootstrap | 201 | Create merchant/owner and return one-time credentials |
| `POST /v1/merchant/sessions` | canonical Wallet/Gateway assertion | registered owner/staff account | 201 | Exchange exact product/device/account approval for a short session |
| `POST /v1/merchant/members` | merchant session | `members` (owner) | 200 | Grant/update one Wallet account role; last active owner is protected |
| `GET /v1/merchant/state` | merchant session | `read` | 200 | Merchant-scoped operational snapshot |
| `GET /v1/merchant/analytics` | merchant session | `read` | 200 | Analytics derived only from persisted authoritative records |
| `POST /v1/merchant/catalog` | merchant session | `invoice` | 201 | Create idempotent catalog item |
| `POST /v1/merchant/invoices` | merchant session | `invoice` | 201 | Create signed central-Pay-backed invoice |
| `GET /v1/invoices/{id}` | public invoice ID | public receipt lookup | 200 | Read signed invoice and authoritative settlement status |
| `POST /v1/invoices/{id}/settlements` | canonical Pay Gateway assertion | exact signed payment result | 201 | Submit settlement; commits only after matching central Pay evidence |
| `POST /v1/invoices/{id}/refund-requests` | canonical Pay Gateway assertion | exact payer/session binding | 201 | Record request only; never executes refund funds |
| `POST /v1/invoices/{id}/disputes` | canonical Pay Gateway assertion | exact payer/session binding | 201 | Record dispute/Trust references only; AI cannot decide it |
| `PUT /v1/merchant/webhook` | merchant session | `webhook` | 200 | Set HTTPS public-DNS receiver on port 443; local/IP destinations fail closed |
| `POST /v1/merchant/webhook/rotate` | merchant session | `webhook` | 200 | Rotate server-side secret; browser never receives it |
| `POST /v1/merchant/webhooks/{id}/retry` | merchant session | `webhook` | 200 | Retry persisted merchant-owned delivery |
| `GET /v1/merchant/reconciliation.csv` | merchant session | `reconcile` | 200 | Download schema-v1 CSV with authoritative settlement evidence |
| `GET /v1/merchant/providers/catalog` | merchant session | `read` | 200 | Read versioned official-provider catalog metadata |
| `PUT /v1/merchant/providers` | merchant session | `provider-manage` | 200 | Register opaque server-side credential reference |
| `POST /v1/merchant/providers/{id}/test` | merchant session | `provider-test` | 200 | Persist adapter-supplied probe evidence; never invent health |
| `POST /v1/merchant/providers/{id}/disable` | merchant session | `provider-manage` | 200 | Disable connection across supported states |
| `GET /v1/merchant/capital` | merchant session | `reconcile` | 200 | Evidence/disclosure view only; no funds action |
| `POST /v1/merchant/ai/runs` | merchant session | `ai-run` | 201 | Start explicit allow-once analysis/draft workflow |
| `POST /v1/merchant/ai/runs/{id}/review` | merchant session | `ai-review` | 200 | Apply/reject/cancel a draft record; cannot execute financial action |

## Role mapping

- Owner: every merchant permission.
- Finance: read, invoice, reconciliation/capital, refund/dispute cases, AI run and
  AI review.
- Developer: read, webhook, provider configuration and provider tests.
- Support: read, refund/dispute cases and AI run.
- Viewer: read only.

Unknown roles and permissions fail closed and are covered by fuzz, fault and
100,000-iteration soak tests.

Webhook delivery never follows redirects or environment proxies. The production
transport validates every DNS answer, rejects mixed public/private answers and
dials the selected validated address directly while retaining the original TLS
hostname. Resolution faults become operator-visible retry/failed records; they
cannot become successful health or delivery evidence.

## Reconciliation schema v1

The response uses `Content-Type: text/csv; charset=utf-8`, attachment filename
`ynx-pay-reconciliation.csv`, and `X-YNX-Reconciliation-Schema: 1`. Columns are:

`invoice_id, central_invoice_id, merchant_id, amount_ynxt, fee_ynxt, status,
transaction_hash, block_number, created_at, expires_at`

Pending rows leave transaction/block empty. Committed rows copy the persisted
authoritative transaction hash and block. `TestReconciliationCSVGoldenSchemaAndEvidenceFields`
is the golden compatibility gate; changing columns/order/format requires a new
schema version and migration note.
