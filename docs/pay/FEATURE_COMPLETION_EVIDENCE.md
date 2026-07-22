# YNX Pay feature completion evidence

Status is evidence-based: `verified`, `partial`, `missing`, or `unavailable`.

| Requirement | Status | Evidence or gap |
|---|---|---|
| Canonical Wallet/Gateway client bindings | partial | package and fail-closed tests pass locally; central registry is not integrated |
| Invoice/payment link/QR and review | verified locally | Pay client tests and production exports; no current install proof |
| Authoritative committed receipt | verified locally | Go settlement matching and replay tests; fresh public transaction proof missing |
| Refund request and dispute | partial | request/evidence workflows pass; authoritative refund transaction lifecycle incomplete |
| Webhook signature/retry/audit | partial | signature and retry tests pass; explicit dead-letter/manual resolution coverage incomplete |
| Tip, split and recurring draft | missing | no complete persisted API/UI workflow |
| Smart account and sponsorship | partial | fail-closed HTTPS adapter, device/account/merchant budgets, first-payment eligibility, attribution, call-data binding and authoritative UserOperation receipt tests pass locally; no configured public paymaster or live receipt |
| Stablecoin settlement | unavailable | no reviewed official Testnet asset/provider configuration |
| Cross-chain entry | partial | optional HTTPS adapter and persisted monotonic quote/source/finality/attestation/destination/refund lifecycle pass local tests; no approved configured provider or live destination proof |
| Explainable payment routing | partial | native, active-sponsored and bridge candidates are scored from disclosed cost, time, risk, finality, health and user limits; Wallet selection is audited and non-executing; no live provider comparison evidence |
| Quant/service billing | missing | no external high-water-mark evidence validator |
| Android/iOS | partial | builds/tests exist; current install/cold-launch and signed release evidence missing |
| Merchant web | verified locally | tests and static production build pass; staging/public deployment missing |
| Migration/restore | partial | versioned integrity store exists; full fixture migration and timed restore drill missing |
| Observability/SLO | missing deployed evidence | requirements documented; metrics/traces/dashboard not verified |
| Public `/pay`, hosted artifacts | missing | no direct deployment or immutable download evidence |
