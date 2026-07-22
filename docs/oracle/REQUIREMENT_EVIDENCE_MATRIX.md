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
| Chain system module/precompile | Integration contract and implementation pending | Pending |
| Exchange index/mark/funding | Adapter and test vectors pending | Pending |
| DEX Oracle/TWAP | Existing source semantics recovered; canonical adapter pending | Partial |
| Quant live/history | Existing consumer semantics recovered; canonical adapter pending | Partial |
| Finance, Pay, Explorer, Monitor, Bridge | Integration manifests and test vectors pending | Pending |
| Provider outage/manipulation/depeg/reorg simulations | Core stale/outlier/divergence tests exist; full scenario suite pending | Partial |
| SLO/capacity and unit economics | Pending measured evidence | Pending |
| Observability and incident operations | Structured trace-correlated logs, request/error IDs, health/version, isolated Prometheus metrics, operations and incident procedures exist; central alerts/dashboard/status integration pending | Partial |
| Security and supply chain | Core cryptographic boundary tests exist; threat model, SBOM, scans, provenance, reproducibility pending | Partial |
| Web/PWA docs and 12-language accessibility | Pending | Pending |
| Public metadata and release record | Pending | Pending |
| Local installation and cold start | Pending | Pending |
| Central integration | Pending | Pending |
| Staging/public deployment | Direct probes prove unavailable | False |
| Hosted/signed/store artifacts | No Oracle artifacts found | False |

## Product state booleans

The machine-readable release record is authoritative once created. Until the full current commit is tested and recorded, even locally implemented code must not promote `implementedLocal` or `testedLocal` for the product as a whole.
