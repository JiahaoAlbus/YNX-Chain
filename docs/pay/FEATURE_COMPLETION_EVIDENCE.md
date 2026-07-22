# YNX Pay feature completion evidence

Status is evidence-based: `verified`, `partial`, `missing`, or `unavailable`.

| Requirement | Status | Evidence or gap |
|---|---|---|
| Canonical Wallet/Gateway client bindings | partial | package and fail-closed tests pass locally; central registry is not integrated |
| Invoice/payment link/QR and review | verified locally | Pay client tests and production exports; no current install proof |
| Authoritative committed receipt | verified locally | Go settlement matching and replay tests; fresh public transaction proof missing |
| Refund request and dispute | partial | refund request, aggregate partial limit, owner/finance plus merchant-Wallet authorization, central submission and authoritative committed refund evidence pass local tests; no fresh public refund transaction. Dispute review remains Trust-owned |
| Webhook signature/retry/audit | verified locally | HMAC identity, timestamp and payload binding, exponential retry, terminal dead-letter state, no automatic dead-letter retry, role-gated manual replay with a new delivery ID, reason, idempotency and audit are covered by race tests; no public receiver evidence |
| Tip, split and recurring draft | missing | no complete persisted API/UI workflow |
| Smart account and sponsorship | partial | fail-closed HTTPS adapter, device/account/merchant budgets, first-payment eligibility, attribution, call-data binding and authoritative UserOperation receipt tests pass locally; no configured public paymaster or live receipt |
| Stablecoin settlement | partial / externally unavailable | Local typed registry, public read endpoint and fail-closed approval tests distinguish YNXT, Testnet stablecoin and fiat. Circle's official USDC contract and CCTP domain lists were checked on 2026-07-22 and do not list YNX/6423, so USDC remains `unavailable` with no fabricated address; no live provider settlement exists |
| Cross-chain entry | partial | optional HTTPS adapter and persisted monotonic quote/source/finality/attestation/destination/refund lifecycle pass local tests; no approved configured provider or live destination proof |
| Explainable payment routing | partial | native, active-sponsored and bridge candidates are scored from disclosed cost, time, risk, finality, health and user limits; Wallet selection is audited and non-executing; no live provider comparison evidence |
| Quant/service billing | missing | no external high-water-mark evidence validator |
| Android/iOS | partial | builds/tests exist; current install/cold-launch and signed release evidence missing |
| Merchant web | verified locally | tests and static production build pass; staging/public deployment missing |
| Migration/restore | partial | versioned integrity store exists; full fixture migration and timed restore drill missing |
| Observability/SLO | missing deployed evidence | requirements documented; metrics/traces/dashboard not verified |
| Public `/pay`, hosted artifacts | missing | no direct deployment or immutable download evidence |
