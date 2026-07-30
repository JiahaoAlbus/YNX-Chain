# Feature Completion Evidence

| Capability | Direct evidence | State |
|---|---|---|
| Signed observations | Ed25519 payload, reporter identity, nonce domain, sequence, replay/tamper tests | Local tested |
| Robust scalar aggregation | Weighted median, MAD rejection, signed-rate divergence, overflow-safe arithmetic, staleness, coverage, confidence, and three-source breaker tests | Local tested |
| Exchange derivatives | Oracle-owned Index, Funding Reference, and Mark derivation; explicit component lineage; funding window and clamp; provider-derived value rejection; stale and funding-spike fail-closed tests | Local tested and frozen at `8f4310988a6641c5b023497c74e901ff508771fe` |
| Typed market data | Strict OHLCV, trades, order book, DEX pool, provider-health validation and `/v1/market-data` | Local tested |
| Last-good and emergency control | Explicit stale/breaker state, durable pause/resume, restart tests | Local tested |
| Integrity and history | HMAC store, event chain, corrections, replay, v1/v2→v3 migrations and backups | Local tested |
| Public read contract | `/health`, `/version`, `/prices`, `/markets`, `/providers`, `/status`, `/history`, `/corrections`, `/metrics`, `/v1/index`, `/v1/funding`, `/v1/mark`, request/error IDs, and security headers | Local tested; limited-source public HTTPS control plane verified at deployment commit `f71d5ca5c2ede28477fbadff36701a9f040e311f`; authoritative prices remain unavailable at 0/3 sources |
| Consumer SDKs | Go and TypeScript strict validators reject schema/request mismatch, unknown fields, stale/future data, breaker/failure states, insufficient source/confidence/coverage, malformed lineage, unsafe derivatives, remote plain HTTP, unbounded responses, and missing timeouts | Go race tests passed; TypeScript compile passed and 18 canonical/negative tests passed at `6e811f74c3d68aa70d3216fea9682e932f9a3e73` |
| Consumer CLI | `ynx-oracle-cli` binds market, type, policy version, maximum age, confidence, and coverage; it emits JSON only after Go SDK validation and produces no output for unsafe values | Race tests passed; deterministic candidate packaging verified at frozen source `8f4310988a6641c5b023497c74e901ff508771fe` |
| Release artifacts | Deterministic macOS arm64 and Linux arm64 server/CLI archives, TypeScript npm candidate, Go module candidate, canonical manifest, SHA-256/bytes, target validation, CycloneDX SBOM, provenance, detached-signature verification path and tamper rejection | Tested-local unsigned candidates at `8f4310988a6641c5b023497c74e901ff508771fe`; macOS install/cold start/version binding/shutdown passed; Linux native cold start, hosting and production signing remain open |
| Provider governance | Three official candidates documented; all inactive pending rights/YNX coverage | Source limitation open |
| Anomaly behavior | Tests cover stale/offline, outlier, divergence, thin source, depeg, DEX reorg replacement, provider deactivation, and historical replay | Local tested; live failover pending |
| Web/PWA | Independent `/oracle`, 12 languages, RTL, themes, reduced motion, PWA shell, live-only queries | Production build/SSR and real-Chrome keyboard/semantics/RTL/theme/reduced-motion/200%-text/390px tests pass at `a3c3275`; public access and manual VoiceOver/TalkBack evidence remain pending |
| Container | Digest-pinned non-root image, Go 1.25.12 binary, read-only cold start, degraded fail-closed health, image SBOM, clean high/critical Trivy scan, and repeatable live DAST smoke | Built/installed locally; not hosted or signed |
| Central integrations | Versioned schemas, owner-specific authority boundaries, acceptance evidence, and SDK-executed accept/reject vectors | Ready for owner review; not integrated centrally |

No row implies authoritative public Testnet readiness. A limited-source public
control plane exists, but final activation still requires approved independent
sources, reporter signer custody, central consumer acceptance, public Oracle Web,
Explorer/Monitor evidence, Linux arm64 native artifact cold-start evidence,
artifact hosting/production signing, and live restore/load/failover evidence.
