# YNX Pay product service

This product-local service orchestrates the existing authoritative Pay API. It
never marks an invoice committed from client state: `committed` is stored only
after the central Pay API returns a matching `paid` settlement with a non-zero
block and canonical transaction/audit evidence.

Run with `go run ./internal/payproduct/cmd/ynx-pay-productd`. Required variables:

- `YNX_PAY_PRODUCT_INTEGRITY_KEY` (32+ byte hex or raw base64)
- `YNX_PAY_PRODUCT_BOOTSTRAP_KEY`
- `YNX_PAY_PRODUCT_PUBLIC_URL`
- `YNX_PAY_PRODUCT_CENTRAL_URL`
- `YNX_PAY_PRODUCT_CENTRAL_KEY`
- `YNX_PAY_PRODUCT_CENTRAL_MERCHANT_ID` (the merchant identity bound to that
  central credential; product merchant IDs remain separate and are audited)

Optional AI Gateway variables are `YNX_PAY_PRODUCT_AI_URL`,
`YNX_PAY_PRODUCT_AI_KEY`, and `YNX_PAY_PRODUCT_AI_MODEL`. When absent, AI runs
fail honestly as `provider_unavailable`. Cross-chain settlement is always
reported as `unavailable` until the central integration authority supplies a
real approved bridge route.

Wallet authorization implements the central Wallet/Gateway contract: canonical
Wallet request and approval, compact low-S secp256k1 account signature, P-256
product-device challenge completion, exact product/bundle/scope binding, expiry
and persisted replay rejection. Settlement accepts only a Wallet-signed payment
result bound to the exact signed invoice quote. It then asks the central Pay API
for the transaction and persists `committed` only when the authoritative
transaction, block and audit evidence match.

`prove-testnet-commit.sh` is the live evidence injection gate. It accepts only
real Wallet-produced intent/result JSON files and an authenticated product
session, submits them unchanged, and verifies the returned and subsequently
looked-up receipt against the exact transaction hash. Missing external evidence
fails closed; the script never creates a signature or settlement.

`live-testnet-proof.mjs` is the operator acceptance harness. With explicit
product, central Gateway, RPC, faucet and bootstrap endpoints, it creates cryptographic Wallet
and Gateway requests, signs and broadcasts a native YNXT transaction, waits for
authoritative committed evidence, and exercises receipt, refund, dispute,
webhook, reconciliation, audit, replay rejection and AI status. It writes the
sanitized result to `proof/live-testnet-payment.json`; it never injects a paid
status.

Webhook deliveries bind the HMAC to `YNX_PAY_WEBHOOK_V1`, delivery ID, exact
RFC3339Nano timestamp and payload hash. Receivers must validate
`X-YNX-Delivery-ID`, `X-YNX-Timestamp`, `X-YNX-Payload-SHA256`,
`X-YNX-Signature-Version` and `X-YNX-Signature`, then reject reused delivery
IDs. Delivery attempts, retry state and secret version are persistent.
