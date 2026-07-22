# Security boundaries and threat model

Assets: Wallet identity, merchant membership, short-lived console session, invoice signing key, merchant credential, webhook secret, Gateway key, settlement evidence, audit log and provider credentials.

Trust boundaries:

1. Browser to canonical Wallet: product/device/callback/scope/nonce/request-bound approval.
2. Gateway to Merchant service: short-lived HMAC assertion; replay cache; exact body/path binding.
3. Merchant service to central Pay/Trust/providers: server-to-server official adapters with scoped credentials.
4. Merchant service to webhook receiver: HTTPS plus versioned HMAC over event ID, timestamp and exact payload hash.
5. Persistent state: HMAC envelope and atomic replacement.

Threats covered by tests include replay, body substitution, cross-product callback, scope escalation, role escalation, last-owner removal, stale role session, invoice tamper, settlement mismatch, provider outage, webhook payload tamper/retry, webhook SSRF/DNS rebinding/redirect containment and AI execution boundary.

Webhook delivery accepts only HTTPS public DNS names on the standard TLS port,
rejects local/internal names and IP literals at configuration, re-resolves every
delivery, rejects the whole DNS answer if any address is non-public, and the
production transport dials only a validated resolved address with redirects and
environment proxies disabled. Unsafe DNS faults persist as retry evidence without
making a network call.

Open threats: multi-instance replay coordination, distributed persistence, credential rotation workflow, provider compromise, rate exhaustion, retention/deletion, production-scale disaster restore, DAST and hosted artifact provenance. These block production readiness.
