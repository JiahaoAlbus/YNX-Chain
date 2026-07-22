# Governance App Gateway handoff

The Governance product must remain a standalone product at `/governance`. The central App Gateway remains the only Wallet ownership and product-session authority. Governance does not mint tokens, accept browser bearer tokens, or define a compatibility login.

## Required central integration

1. Register the exact HTTPS product binding `https://governance.test.ynx.network`; do not use wildcard origins.
2. Introspect the `X-YNX-App-Session` and `X-YNX-Device-ID` pair against the canonical App Gateway session store before forwarding a protected request.
3. Require active status, exact product binding, exact device, unexpired session, and non-revoked session.
4. Send identity to the loopback Governance upstream through the HMAC-SHA-256 assertion defined by the integration manifest. Bind the assertion to method, escaped path, request-body SHA-256, account, device, session, product, timestamp, and nonce. Never forward the plaintext browser session token to Governance.
5. Remove client-supplied verified-identity headers at ingress and replace them only after successful introspection.
6. Keep Governance role resolution inside authoritative Governance state. The Gateway proves identity and product binding; it does not grant council powers.
7. Route public reads and protected mutations exactly as listed in `release/integration/governance-app-gateway.manifest.json`.
8. Return a generic authorization failure and an external Error ID. Do not expose token hashes, device public keys, server paths, or internal stack traces.

## Acceptance vectors

| Vector | Expected result |
| --- | --- |
| Active session, correct product, device, and action role | Request reaches Governance |
| Wallet or Social product session | `401`, no upstream mutation |
| Correct session with a different device | `401`, no upstream mutation |
| Expired or revoked session | `401`, no upstream mutation |
| Valid identity without the required Governance role | `401`, no upstream mutation |
| Client supplies `X-YNX-Verified-Account` | Header is discarded and replaced after introspection |
| Replayed internal nonce | `401`, no upstream mutation |
| Body, method, path, or identity changed after signing | `401`, no upstream mutation |
| Internal assertion older than 30 seconds | `401`, no upstream mutation |
| Governance upstream unavailable | Truthful `503`, no success response |

The manifest currently records `integratedCentral=false`. It may become `true` only after these vectors pass against the central Gateway and the evidence names the exact source commit.
