# YNX Trust Center

Standalone evidence, request-validity, review, notice, appeal, correction, expiry and transparency product. It is intentionally not a punishment or native-asset control surface.

```sh
YNX_TRUST_CENTER_DEV_HEADER_AUTH=1 go run ./apps/trust-center
```

The persistent store defaults to `tmp/trust-center/state.json`. Trusted headers are disabled by default and are only enabled by the explicit development flag above. Non-development ingress supplies opaque sessions through server-only `YNX_TRUST_CENTER_SESSIONS_JSON`; the accepted Wallet session adapter must populate `sessionStorage.ynxSession`. Configure permissioned AI with server-only `YNX_AI_GATEWAY_URL`, `YNX_AI_GATEWAY_API_KEY`, and `YNX_AI_MODEL`.
