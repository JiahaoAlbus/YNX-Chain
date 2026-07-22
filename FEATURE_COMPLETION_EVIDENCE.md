# Feature Completion Evidence

| Capability | Direct evidence | State |
|---|---|---|
| Signed observations | Ed25519 payload, reporter identity, nonce domain, sequence, replay/tamper tests | Local tested |
| Robust scalar aggregation | Weighted median, MAD rejection, staleness, divergence, coverage, confidence, three-source breaker tests | Local tested |
| Typed market data | Strict OHLCV, trades, order book, DEX pool, provider-health validation and `/v1/market-data` | Local tested |
| Last-good and emergency control | Explicit stale/breaker state, durable pause/resume, restart tests | Local tested |
| Integrity and history | HMAC store, event chain, corrections, replay, v1/v2→v3 migrations and backups | Local tested |
| Public read contract | `/health`, `/version`, `/prices`, request/error IDs, security headers | Local tested; not publicly deployed |
| Consumer SDK | Go strict validator rejects stale, breaker, low-source/confidence/coverage and version mismatch | Local tested |
| Provider governance | Three official candidates documented; all inactive pending rights/YNX coverage | Source limitation open |
| Anomaly behavior | Tests cover stale/offline, outlier, divergence, thin source, depeg, DEX reorg replacement, provider deactivation, and historical replay | Local tested; live failover pending |
| Web/PWA | Independent `/oracle`, 12 languages, RTL, themes, reduced motion, PWA shell, live-only queries | Production build/SSR tests and owner-only deployment pass; public access pending |
| Container | Digest-pinned non-root image, Go 1.25.12 binary, read-only cold start, degraded fail-closed health, image SBOM, and clean high/critical Trivy scan | Built/installed locally; not hosted or signed |
| Central integrations | Versioned schemas and consumer handoff manifest | Ready for review; not integrated centrally |

No row implies public Testnet readiness. Public activation requires approved
independent sources, reporter signer custody, a deployed service endpoint,
Explorer/Monitor integration, restore/load evidence, and central consumer
acceptance.
