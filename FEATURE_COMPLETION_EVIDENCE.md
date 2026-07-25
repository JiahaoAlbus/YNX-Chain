# Feature Completion Evidence

| Capability | Direct evidence | State |
|---|---|---|
| Signed observations | Ed25519 payload, reporter identity, nonce domain, sequence, replay/tamper tests | Local tested |
| Robust scalar aggregation | Weighted median, MAD rejection, signed-rate divergence, overflow-safe arithmetic, staleness, coverage, confidence, and three-source breaker tests | Local tested |
| Exchange derivatives | Oracle-owned Index, Funding Reference, and Mark derivation; explicit component lineage; funding window and clamp; provider-derived value rejection; stale and funding-spike fail-closed tests | Local tested at `66c110adf43a713af67f88b2381c5ae2e66e4e6d` |
| Typed market data | Strict OHLCV, trades, order book, DEX pool, provider-health validation and `/v1/market-data` | Local tested |
| Last-good and emergency control | Explicit stale/breaker state, durable pause/resume, restart tests | Local tested |
| Integrity and history | HMAC store, event chain, corrections, replay, v1/v2→v3 migrations and backups | Local tested |
| Public read contract | `/health`, `/version`, `/prices`, `/markets`, `/providers`, `/status`, `/history`, `/corrections`, `/metrics`, `/v1/index`, `/v1/funding`, `/v1/mark`, request/error IDs, and security headers | Local tested; not publicly deployed |
| Consumer SDK | Go strict validator rejects stale, breaker, low-source/confidence/coverage, unknown value types, malformed lineage, missing or mismatched derivative metadata, and clamped derived values | Local tested |
| Provider governance | Three official candidates documented; all inactive pending rights/YNX coverage | Source limitation open |
| Anomaly behavior | Tests cover stale/offline, outlier, divergence, thin source, depeg, DEX reorg replacement, provider deactivation, and historical replay | Local tested; live failover pending |
| Web/PWA | Independent `/oracle`, 12 languages, RTL, themes, reduced motion, PWA shell, live-only queries | Production build/SSR tests and owner-only deployment pass; public access pending |
| Container | Digest-pinned non-root image, Go 1.25.12 binary, read-only cold start, degraded fail-closed health, image SBOM, clean high/critical Trivy scan, and repeatable live DAST smoke | Built/installed locally; not hosted or signed |
| Central integrations | Versioned schemas, owner-specific authority boundaries, acceptance evidence, and SDK-executed accept/reject vectors | Ready for owner review; not integrated centrally |

No row implies public Testnet readiness. Public activation requires approved
independent sources, reporter signer custody, a deployed service endpoint,
Explorer/Monitor integration, restore/load evidence, and central consumer
acceptance.
