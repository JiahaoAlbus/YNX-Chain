# Security boundaries and threat model

Assets: Wallet identity, merchant membership, short-lived console session, invoice signing key, merchant credential, webhook secret, Gateway key, settlement evidence, audit log and provider credentials.

Trust boundaries:

1. Browser to canonical Wallet: product/device/callback/scope/nonce/request-bound approval.
2. Gateway to Merchant service: short-lived HMAC assertion; replay cache; exact body/path binding.
3. Merchant service to central Pay/Trust/providers: server-to-server official adapters with scoped credentials.
4. Merchant service to webhook receiver: HTTPS plus versioned HMAC over event ID, timestamp and exact payload hash.
5. Persistent state: HMAC envelope and atomic replacement.

Threats covered by tests include replay, body substitution, cross-product callback, scope escalation, role escalation, last-owner removal, stale role session, invoice tamper, settlement mismatch, provider outage, webhook payload tamper/retry and AI execution boundary.

Open threats: multi-instance replay coordination, distributed persistence, credential rotation workflow, SSRF/DNS rebinding for webhook destinations, provider compromise, rate exhaustion, retention/deletion, disaster restore, DAST and hosted artifact provenance. These block production readiness.
