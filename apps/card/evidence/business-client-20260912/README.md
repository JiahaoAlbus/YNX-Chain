# Card business client development

`src/cardBusinessClient.ts` implements the new Card-owned `/api/card/v1` contract.
It does not use the legacy `/app/card/v1` routes or legacy session-token headers.
The host is fixed to `https://card.ynxweb4.com`, while the exact backend source
commit must be supplied from the deployment binding. Server responses now bind
that source and the authenticated session owner.

The client accepts the shared SDK `createIntrospectionProof` capability. It does
not implement DeviceProof, call introspect in advance, open a Wallet, request an
account, sign an application or broadcast a transaction. Every explicit retry
gets a new one-time proof while preserving the caller's business idempotency key.
Timeout, invalidation, changed account and rotated Session discard stale results
without changing the independent Standard Wallet.

Application, Card and funding responses are validated before publication. An
ACTIVE application needs its backend approval reference and linked Card. Credited
funding needs receipt bindings; pending intents do not become a spendable balance.
Non-Testnet, unbound-source, foreign-owner, sensitive-data and HTML fallback
responses fail closed. Canonical Wallet error codes remain distinct from Card API
errors; untrusted remote human error text is not displayed.

`integration-02` contains 14 passing targeted tests but a failed typecheck due to
an indirect React Native import entering the server compilation. The follow-up
uses the canonical error contract directly, without importing the UI wallet
module. Logs remain separate rather than overwriting the failed attempt.
The tests include a real local HTTP/SQLite workflow. Its Session verifier
is explicitly a fixture. The shared application verifier rejects a forged
approved response, leaving the persisted application DEGRADED with no card or
funding. These are not live Session or installed/public product proofs.

Next integration remains: wire the UI to this client with the shared native
proof method; consume the native request/return package and shared server session
consumer; provide persistent Node hosting and the canonical reverse proxy; then
build, install, publish and verify the actual product. The old APK/public alias
were not changed by this slice. No real approval, funding, payment or migration
gate is promoted.

`server/smoke-runtime.mjs` can exercise the separate Node backend process with an
ephemeral empty encrypted database and disabled external dependencies. It never
uses a test Wallet secret, remote RPC or live Card account.
