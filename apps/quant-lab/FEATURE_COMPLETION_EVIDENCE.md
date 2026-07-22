# Feature completion evidence

Evidence date: 2026-07-22. Evidence is local unless explicitly stated.

| Requirement | State | Direct evidence |
| --- | --- | --- |
| deterministic event/OOS backtest | tested local | `internal/quantlab/service_test.go` determinism, split, walk-forward, sensitivity, regime tests |
| actual YNX market tape boundary | tested local | market adapter tests reject malformed/non-authoritative or insufficient history |
| paper partial fills/reconciliation | tested local | paper service tests and browser evidence |
| venue-neutral execution adapters | Paper and Shadow tested local | versioned intent schema; Paper partial-fill translation; Shadow zero-fill/no-submit; sequence, idempotency, stale-feed, limit and reconciliation tests; Exchange/DEX implementations absent |
| risk kill switch | tested local | mismatch, persistence, browser, and multi-daemon smoke tests |
| lifecycle | tested local | sequential transition, risk evidence, and Wallet-mandate tests |
| bounded Testnet adapter contract | implemented/tested with injected test doubles | expiry, notional, position, daily loss, slippage, gas, frequency, oracle freshness, venue health, replay, idempotency, and broker-proof tests; no authoritative risk feed or deployed broker claim |
| mandate revoke | tested local | immediate, idempotent, restart-persistent revoke tests |
| REST and WebSocket | tested local | HTTP strict-schema/role tests and metadata-bearing WebSocket test |
| CLI | tested local | approval and loopback gates; backup record test |
| Python/TypeScript SDK | built/tested local | Python unit tests and wheel build; Node tests and package dry-run |
| worker sandbox boundary | tested local | Ed25519 package signature, source/artifact hashes, scan evidence, dependency allowlist, resource bounds, zero host/network/key/secret permission, payload tamper rejection; arbitrary source execution absent |
| state backup/restore | tested local | atomic backup, restore drill, schema/integrity and tamper rejection |
| PnL/fee attribution | tested local | alpha/beta residual, fee/slippage, realized/unrealized/net dual reconciliation, explicit unsupported components |
| dataset catalog | tested local | version/hash, rights/terms, lineage, correction/bias, source/asOf/coverage/confidence/failure, private consent, persistence and duplicate rejection |
| web accessibility/i18n | tested local | 12 catalog parity, Arabic RTL, 390 px overflow, light/dark browser evidence |
| independent daemons | built/smoked local | core, worker, paper, risk, web, CLI builds; cross-process risk propagation smoke |
| Docker Compose | schema parsed only | Docker daemon unavailable; image build/installation false |
| Kubernetes | candidate YAML parsed only | no cluster apply, rollout, persistence, or recovery evidence |
| macOS desktop | installed/tested local candidate | arm64 app bundle built, ad-hoc signed, installed in user Applications, version/API/frontend cold-launch smoke passed |
| Windows desktop | built local candidate | x64 binaries and archive cross-compiled; no Windows host launch/install evidence |
| canonical Gateway/Wallet integration | not achieved | handoff records only; local writes remain loopback preview |
| real Exchange/DEX Testnet | not achieved | no transaction hash, fill, vault receipt, revoke propagation, or emergency-exit receipt |
| public web/download | not achieved | no verified public endpoint or immutable hosted artifact |

Passing local tests cannot promote any final-column item to deployed, installed,
integrated, signed, hosted, or released.
