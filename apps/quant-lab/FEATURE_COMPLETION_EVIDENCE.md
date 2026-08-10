# Feature completion evidence

Evidence date: 2026-08-10. Evidence is local unless explicitly stated.

| Requirement | State | Direct evidence |
| --- | --- | --- |
| deterministic event/OOS backtest | tested local | `internal/quantlab/service_test.go` determinism, split, walk-forward, sensitivity, regime tests |
| actual YNX market tape boundary | tested local | market adapter tests reject malformed/non-authoritative or insufficient history |
| paper partial fills/reconciliation | tested local | paper service tests and browser evidence |
| venue-neutral execution adapters | Paper, Shadow and Exchange owner transport tested local; DEX boundary tested local | versioned intent schema; Paper partial-fill translation; Shadow zero-fill/no-submit; stateless Exchange mandate/order transport with request-scoped user session and exact signing payloads; DEX boundary only; terminal receipt binding; limit, freshness, sequence, idempotency and replay checks; durable reservation/completion ledger; pending-unknown fail closure; authoritative reconciliation delta and persistent kill-switch tests; no authenticated public user receipt or DEX owner transport |
| risk kill switch | tested local | mismatch, persistence, browser, and multi-daemon smoke tests |
| lifecycle | tested local | sequential transition, risk evidence, and Wallet-mandate tests |
| bounded Testnet adapter contract | implemented/tested with injected doubles and HTTP Exchange adapter | expiry, notional, position, daily loss, slippage, gas, frequency, projected leverage, drawdown, liquidity, depeg, concentration, cancel/API reliability, supplied VaR/ES, oracle freshness, venue health, overflow, replay, idempotency and broker-proof tests; concurrent remote calls do not hold the state mutex; sessions and order signatures are not persisted or exposed; no authenticated public user receipt or authoritative production risk-feed claim |
| mandate revoke | tested local | immediate, idempotent, restart-persistent revoke tests |
| REST and WebSocket | tested local | HTTP strict-schema/role tests and metadata-bearing WebSocket test |
| local observability | tested local | request/trace/error IDs, WebSocket correlation, redacted JSON route logs, Prometheus request/risk/reconciliation/kill/pending/build metrics, readiness signals; no trace backend or delivered alerts |
| CLI | tested local | approval and loopback gates; backup record test |
| Python/TypeScript SDK | built/tested local | Python unit tests and wheel build; Node tests and package dry-run |
| worker sandbox boundary | tested local | Ed25519 package signature, source/artifact hashes, scan evidence, dependency allowlist, resource bounds, zero host/network/key/secret permission, payload tamper rejection; arbitrary source execution absent |
| strategy/adapter examples | tested local | research-only built-in template denies privileged permissions/profit claim/execution eligibility; Shadow intent conforms to venue-neutral v1 schema; no invented Exchange/DEX receipt examples |
| state backup/restore | tested local | atomic backup, restore drill, schema/integrity and tamper rejection |
| PnL/fee attribution | tested local | alpha/beta residual, fee/slippage, realized/unrealized/net dual reconciliation, explicit unsupported components |
| dataset catalog | tested local | version/hash, rights/terms, lineage, correction/bias, source/asOf/coverage/confidence/failure, private consent, persistence and duplicate rejection |
| web accessibility/i18n | tested local | 12 catalog parity, Arabic RTL, 390 px overflow, light/dark browser evidence |
| independent daemons | built/smoked local | core, worker, paper, risk, web, CLI builds; cross-process risk propagation smoke |
| Docker Compose | schema parsed only | Docker daemon unavailable; image build/installation false |
| Kubernetes | candidate YAML parsed only | no cluster apply, rollout, persistence, or recovery evidence |
| macOS desktop | installed/tested local candidate | arm64 app bundle built, ad-hoc signed, installed in user Applications, version/API/frontend cold-launch smoke passed |
| Windows desktop | built local candidate | x64 binaries and archive cross-compiled; no Windows host launch/install evidence |
| canonical Gateway/Wallet integration | not achieved | the Exchange session is request scoped and Wallet signatures are forwarded, but the Quant product registration remains pending/disabled and no canonical public Product Session receipt is evidenced |
| real Exchange/DEX Testnet | partially implemented, not accepted | Exchange owner transport and signing payloads are locally tested against the owner contract; the public Exchange exposes the adapter, but no authenticated user mandate/order receipt has been captured; DEX owner transport, vault receipt, revoke propagation and emergency-exit receipt remain absent |
| public web/download | deployed public candidate | `https://quant.ynxweb4.com/`, the fail-closed Exchange execution workbench, and commit-addressed macOS/Windows candidate archives were verified from source `70382c37ccb8c601c88e72c4cbe189fa072dc5db`; this proves deployment, not enabled Wallet registration or a real authenticated order receipt |

Passing local tests cannot promote any final-column item to deployed, installed,
integrated, signed, hosted, or released.
