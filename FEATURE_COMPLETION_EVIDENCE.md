# YNX Exchange feature completion evidence

Evidence baseline commit: `42f2f48e1ecc3816337d4c6f83ab4cf230f4a01d`

Status vocabulary: `proven`, `partial`, `missing`, or `external-blocked`. A passing narrow test does not prove a broader product claim.

| Requirement | Status | Current direct evidence | Required closure evidence |
|---|---|---|---|
| Deterministic native Spot CLOB | proven | `internal/exchangeproduct/service.go`, race tests in `service_test.go` | Preserve while extending order semantics |
| Price-time priority, partial fill, reservation, cancel, STP, fees, restart/tamper rejection | proven | `go test -race ./internal/exchangeproduct`; persistent state/audit tests | Release-commit CI log |
| T+0 user trading loop | partial | Test credit/deposit intent, order, match, account snapshot and withdrawal review exist | Two independent users on shared Testnet, transaction/receipt evidence and restart reconciliation |
| Market, post-only, IOC, FOK, stop, TP, OCO, trailing, TWAP, iceberg, scale and amend | partial | Wallet-authorized deterministic implementations and race-tested reserve/restart semantics exist | Atomic heterogeneous batch vectors remain missing |
| Cancel/mass-cancel priority and dead-man switch | partial | Single/mass cancel and persisted Wallet-signed dead-man arm/heartbeat/disarm; startup and one-second runtime sweeps | Cancel-vs-match stress and deployed scheduler evidence |
| REST, WebSocket and drop copy | partial | REST plus persisted hash-chained Market/User/Drop Copy streams, snapshot/replay, same-origin checks, Gateway header auth, account filtering and redaction | FIX candidate, deployed reconnect/load evidence and retention policy |
| Margin, perpetual, funding and liquidation | missing | No authoritative position or margin engine | Mark/index/oracle, margin, liquidation and default-waterfall implementation and vectors |
| Portfolio margin and unified account | missing | No portfolio risk state | Scenario-grid engine and independent risk vectors |
| Standard Quant Execution Adapter | partial | Exchange-native v1 covers state reads, persisted streams, submit/amend, TP/SL/OCO/TWAP/iceberg/scale, cancel and mass cancel. Kill is a Wallet-signed persistent nonce-domain revocation plus atomic subaccount-market mass cancel. Reconciliation is nonce-domain isolated and returns active/killed state, aggregate exposure, capital, open-order IDs and event sequence. | Native leverage, funding, complete risk views and a separately signed pause/resume contract |
| Quant permission boundary | proven for current Spot adapter | Signed mandate binds exact subaccount, market, methods, aggregate capital, 1x leverage, expiry and nonce domain. Aggregate exposure survives restart and is released by authoritative fill/cancel transitions. Negative tests cover wrong subaccount, expiry, aggregate excess, scope widening, legacy-signature rejection for kill and forbidden asset-control capabilities. | Re-audit when margin/perp methods are introduced |
| UltraLiquidity | missing | Cross-chain is honestly unavailable; no synthetic liquidity | CLOB/CLMM/StableSwap/RFQ/solver/batch/CoW/JIT/vault/POL/cross-chain adapters and total-execution-cost router |
| Maker quality and market integrity | partial | Self-trade prevention exists | Spoof/layer/wash controls, quality scoring, surveillance alerts and real-flow provenance |
| Solvency and exit | missing | Audit/ledger exist; no liabilities tree or withdrawal-capacity proof | Assets/liabilities/encumbrance/reserve ratio/Merkle liabilities/insurance/exit drill |
| Canonical Wallet/Auth/Gateway | partial | Fail-closed Gateway adapter and exact registry request; local tests | Central registry and action-verification acceptance |
| Mobile Android/iOS | partial | Android preview evidence is recorded; iOS workflow exists | Final-commit APK rebuild and iOS Simulator CI artifact/install/cold-launch |
| Web Pro | partial | Responsive terminal, unit tests, Playwright 390px test and local service smoke | Hosted stateful deployment and device accessibility audit |
| 12 languages and Arabic RTL | partial | Mobile and Quant catalogs pass; Mobile has 59 audited keys | Exchange Pro full 12-language runtime/error/legal coverage |
| Migration/backup/restore/deprecation | partial | Schema v1→v9 verifies exact v1 and v8 integrity before additive migration and atomic rewrite. v9 persists Quant kill state and nonce-domain ownership. Local SHA-verified restore preserves balances, orders, fills, ledger/audit/event chains. | Remote encrypted restore drill, downgrade migration, full old-client matrix, deprecation, export/delete and retention |
| Observability/support | partial | Liveness, integrity-backed readiness, version, correlated request/error IDs, JSON scheduler logs, Prometheus process counters, audit/support cases and runbooks | Traces, route histograms, WebSocket/provider/business metrics, alerts/dashboard/status and deployed monitor integration |
| Security/supply chain | partial | Threat model, strict body/header/time limits, stale-window-reclaiming bounded peer rate state, 128-slot concurrency gate, SBOMs and dependency reviews. `npm run validate:release` scans Exchange runtime/doc filler and secret patterns without external tools. | Distributed limits, SAST/DAST/container/artifact scans, provenance, reproducibility, external review and final lockfile/build-script review |
| Public Testnet acceptance | missing | No final public evidence | Two users; Spot/Margin/Perp; profit/loss; fee attribution; breach/kill/revoke; restart/reconcile; UltraLiquidity; solvency; Explorer/Finance/Monitor evidence |
| Public deployment/download/sign/store | missing | Release booleans are false | Immutable URLs, hashes, bytes, signatures, install/cold-start and store evidence |

## Verified local baseline on 2026-07-27

Source commit: `42f2f48e1ecc3816337d4c6f83ab4cf230f4a01d`.

- `go test ./internal/exchangeproduct -count=1`
- `go test -race ./internal/exchangeproduct -count=1`
- `go vet ./internal/exchangeproduct ./apps/exchange/server`
- `go build -o /tmp/ynx-exchange-preflight ./apps/exchange/server`
- `npm --prefix apps/exchange test`
- `npm --prefix apps/exchange run test:browser`
- `npm --prefix apps/exchange run smoke`
- `npm --prefix apps/exchange run validate:release`
- `go test ./internal/exchangeproduct -run NoTestMatches -bench 'BenchmarkPlaceOrderPersistent|BenchmarkOrderBookSnapshot1000' -benchtime=100x -count=1`

Observed Apple M2 local sample: persistent order p50 `12.18 ms`, p95 `17.40 ms`, p99 `45.81 ms`; 1,000-order book snapshot `0.468 ms/op`. These are local samples, not public capacity claims.

Repository-wide `go test ./...` remains blocked outside Exchange ownership by missing generated contract artifacts and key-permission assumptions in Chain/Consensus/Faucet/Trust packages. Exchange tests remained green. GitHub Actions listing also timed out twice during TLS handshake; no CI-success claim is made from that query. Shared `rg`-based validators were not counted as passing because `rg` was absent and their shell control flow returned false green.
