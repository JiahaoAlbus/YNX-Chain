# YNX Trust Center

Standalone evidence, request-validity, review, notice, appeal, correction, expiry and transparency product. It is intentionally not a punishment or native-asset control surface.

```sh
YNX_TRUST_CENTER_DEV_HEADER_AUTH=1 go run ./apps/trust-center
```

The persistent store defaults to `tmp/trust-center/state.json`. Trusted headers are disabled by default and are only enabled by the explicit development flag above. Production access completes the canonical Wallet authorization at `POST /api/auth/session/complete`; the verified session is bound to chain, product, client, bundle, callback, product device key, account, scopes, nonce, purpose, request/approval digests, and a short expiry. Legacy product-local challenge endpoints return `410`.

Configure the central HTTPS Gateway with `YNX_TRUST_CENTER_GATEWAY_URL` and the registered client ID. Until the registry is merged and deployed, authoritative operations fail closed. Configure permissioned AI with server-only `YNX_AI_GATEWAY_URL`, `YNX_AI_GATEWAY_API_KEY`, and `YNX_AI_MODEL`; the browser only submits JSON POST bodies after preview and permission. Recovery operators can inspect or restore the atomic `.bak` store with `go run ./apps/trust-center/cmd/recover`.
