# Requirement and evidence matrix

This matrix prevents implementation, test, installation, integration, deployment, signing, and release states from being conflated. “Pending” means the required evidence does not yet exist.

| Requirement area | Current evidence | State |
|---|---|---|
| Signed provider observations | Ed25519 verification covers schema, reporter, provider, nonce domain, hash, signature, sequence, and timestamps | Implemented and locally tested |
| Replay and tamper rejection | Unit/race tests cover wrong domain, changed values, wrong keys, duplicate IDs, and non-increasing sequences | Implemented and locally tested |
| Provider registry | Strict entries require coverage, license, terms, storage rights, auth, limits, timestamps, region, cost, retention, fallback, removal plan, status, key, and weight | Implemented and locally tested; real providers pending |
| Aggregation | Liquidity-aware weighted median, MAD outlier rejection, staleness/future rejection, divergence, coverage, confidence, and circuit breaker | Implemented and locally tested; production bake-off pending |
| Minimum independent sources | Default policy requires three; health and price APIs fail closed or report explicit limitation | Implemented and locally tested; real sources pending |
| Last good value | Returned only with `stale=true`, circuit breaker, failure, and settlement prohibition | Implemented and locally tested |
| Raw/normalized/aggregate storage | Raw observations, deterministic normalized events, durable aggregate decisions, corrections, and controls share a versioned integrity/event-chain envelope | Implemented and locally tested |
| Corrections | Original is retained and correction carries reason, effective time, actor, audit ID, and signed corrected observation | Implemented and locally tested |
| Historical replay | Replays original or corrected view as of an explicit time; backup/restore drill passes | Implemented and locally tested |
| Public APIs | `/health`, `/version`, `/prices`, provider registry, replay, and signed ingestion handlers exist | Implemented and locally tested; public deployment pending |
| Structured market data | Strict signed OHLCV, trade batches, CLOB books, DEX pool states, and provider-health payloads normalize into a source/version/asOf/coverage/stale live feed and are prohibited from scalar price aggregation | Implemented and locally tested |
| Consumer validation SDK | Go SDK rejects schema mismatch, stale/future data, unsafe quality, insufficient sources, low confidence, malformed lineage, remote plain HTTP, and clients without timeouts | Implemented and locally tested; additional languages pending |
| Chain system module/precompile | Deterministic no-HTTP consensus handoff and rejection vectors exist; module implementation pending | Handoff ready; implementation pending |
| Exchange index/mark/funding | Authority boundary and rejection vectors exist; product adapter and liquidation drill pending | Handoff ready; implementation pending |
| DEX Oracle/TWAP | Existing source semantics recovered; canonical adapter pending | Partial |
| Quant live/history | Existing consumer semantics recovered; canonical adapter pending | Partial |
| Finance, Pay, Explorer, Monitor, Bridge, Gateway, Wallet/Auth | Owner-specific authority boundaries, required outputs, rejection conditions, and acceptance evidence are machine-readable | Handoff ready; owner acceptance pending |
| Provider outage/manipulation/depeg/reorg simulations | Explicit tests cover stale/offline data, outlier manipulation, cross-source divergence, thin sources, truthful depeg values, same-height DEX replacement, provider deactivation, and historical replay | Implemented and locally tested; live failover pending |
| SLO/capacity and unit economics | Bounded in-process p50/p95/p99/throughput/error measurements, conservative Testnet objectives, storage assumptions, external gaps, and cost/scale model are documented | Local baseline complete; staging/WAN/provider evidence pending |
| Observability and incident operations | Structured trace-correlated logs, request/error IDs, health/version, isolated Prometheus metrics, operations and incident procedures exist; central alerts/dashboard/status integration pending | Partial |
| Security and supply chain | Threat model/boundaries, Go and production-Web vulnerability gates, three CycloneDX SBOMs, secret scans, a digest-pinned non-root container, a clean high/critical Trivy image scan, and repeatable local live-container DAST exist; full Web build-tree audit, public-origin DAST, signature, and provenance remain open | Partial; release blocked |
| Web/PWA docs and 12-language accessibility | Independent `/oracle` production build, SSR tests, PWA shell, 12 localized runtime/risk vocabularies, Arabic RTL, themes, focus, reduced motion, and 390px responsive rules | Implemented and locally tested; assistive-tech/public audit pending |
| Public metadata and release record | Public metadata, candidate release record, feature/evidence indexes, notes, platform/KPI decisions, and minimal operator request exist | Implemented locally; public URLs/artifacts pending |
| Local installation and cold start | Web dependencies install/build; pinned non-root container builds and starts read-only with an isolated inactive safety-check registry, then truthfully returns degraded 0/3-source health | Installed locally; no production registry or public artifact |
| Central integration | Pending | Pending |
| Web deployment | Sites production deployment succeeded with owner-only access; unauthenticated `/oracle` returns HTTP 401 | Private evidence only; `deployedPublic=false` |
| Oracle API staging/public deployment | Direct probes prove unavailable | False |
| Hosted/signed/store artifacts | No public Oracle artifact is hosted, production-signed, or store-released | False |

## Product state booleans

The machine-readable release record is authoritative once created. Until the full current commit is tested and recorded, even locally implemented code must not promote `implementedLocal` or `testedLocal` for the product as a whole.
