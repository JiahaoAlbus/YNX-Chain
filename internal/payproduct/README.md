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

Optional AI Gateway variables are `YNX_PAY_PRODUCT_AI_URL`,
`YNX_PAY_PRODUCT_AI_KEY`, and `YNX_PAY_PRODUCT_AI_MODEL`. When absent, AI runs
fail honestly as `provider_unavailable`. Cross-chain settlement is always
reported as `unavailable` until the central integration authority supplies a
real approved bridge route.
