# YNX AI central integration request

These files are merge inputs, not evidence of central integration or deployment.

- `wallet-registry-entry.json` is the exact schema-v2 AI product registration.
- `wallet-auth-vector.json` binds the AI client, bundle, callback, device algorithm, network, ordered scopes, purpose, lifetime, and canonical request digest.
- `wallet-registry.patch` is for the Wallet-auth owner branch. The owner must run the canonical package's parser, signer, replay, tamper, expiry, callback interception, scope escalation, cross-app and restart suites.
- `central-ai-gateway-post.patch` replaces the query-prompt route with an exact JSON POST body. The Gateway owner must extend the accepted body schema deliberately before accepting optional context and attachment fields; unknown fields remain fail-closed.

Production must call `verifyCentralWalletSession` transactionally, then call `assertCentralWalletSessionActive` before every use. The local Go verifier predates the canonical shared package and is retained only as a local test fixture; release preflight must reject it as a production auth authority. Until the registry and shared verifier are merged and deployed, `integratedCentral` is false and production Wallet sign-in is fail-closed.
