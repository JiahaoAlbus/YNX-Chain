# YNX Exchange 0.1.0-testnet

Public market-data and multi-client checkpoint (2026-08-11):

- Published exact source `bdc88190ec1bfca2d308a58c4c2626fd2d75ac46` and Linux AMD64 binary SHA-256 `4d9a0274cc795cfca4d867aa39fd22f10e052e8569e0ed5e1a7265424832434f` at `https://exchange.ynxweb4.com/` with a retained atomic rollback release.
- Added bounded, venue-selectable persisted Spot and Perpetual trade tapes; an empty tape is always `[]`, never `null`, and unsupported markets or invalid limits fail closed.
- Deployed real persisted-fill OHLC candlesticks for Spot and Perpetual across 1m, 5m, 15m, 1h, 4h and 1d intervals; empty intervals and synthetic prices remain omitted.
- Corrected both admission layers to isolate quotas by the direct client address appended by loopback Caddy while rejecting caller-prepended spoofed addresses.
- The deployed service returned 1,000/1,000 HTTP 200 for distinct simulated clients at concurrency 64 and 60/60 public TLS health responses across Singapore, Silicon Valley and Seoul. Exact evidence and the workstation path limitation are recorded in `evidence/capacity/exchange-market-data-public-2026-08-11.txt`.

Public Testnet checkpoint (2026-08-10):

- Added the domain-separated `ynx-quant-strategy-control-v1` contract. Pause atomically cancels open execution, persists across restart and blocks new exposure; resume requires a distinct Wallet signature; a killed nonce domain cannot be resumed.
- Added byte-stable schema-v1 integrity verification so the historical public venue state migrates to schema 9 without discarding or rewriting unverified data.
- Published source `00972cf25d583d975b9c9dd9c1df1ddba8491df9` at `https://exchange.ynxweb4.com/`; public health and readiness report schema 10 integrity, `ready_public_testnet`, `canonical_product_session_proof` and `approved_enabled`.
- Production end-to-end evidence completed a Wallet-bound signed order as `order_000000000466`, rejected proof replay with HTTP 401, retained the exact Wallet and Exchange state hashes after restart, and returned HTTP 200 for 600/600 concurrent health requests from Singapore, Silicon Valley and Seoul.
- Public deployment still does not imply production custody, external liquidity, Mainnet, production signing or store release.

Final-worktree additions:

- Recovered the most complete local Exchange commit and previously untracked product truth records into `codex/final-exchange`.
- Added backward-compatible GTC plus wallet-authorized Post-only, IOC and FOK limit-order semantics. Post-only rejects liquidity-taking orders, FOK rejects without reserving or partially filling when full executable quantity is absent, and IOC expires and releases any remainder atomically.
- Added wallet-authorized, idempotent atomic mass cancel with deterministic creation-time/order-ID cancellation order and complete reserve release.
- Added race-tested direct vectors for each new order policy and ledger conservation after partial IOC and mass cancel.
- Added the Exchange-native Quant Execution Adapter v1 with Wallet-signed subaccount/market/method/capital/leverage/expiry/nonce mandates, Gateway-scoped REST routes, authoritative sequence reconciliation, and explicit denial of withdrawal, ownership, transfer, risk-override and key-export powers.
- Added price-protected Market IOC orders and deterministic price-time-ID ordering in public native order-book snapshots.
- Added atomic Wallet-authorized amend with deterministic priority reset, reserve replacement, FOK/Post-only preflight, idempotent replay and mutation-free failure behavior; exposed the same primitive through Quant Adapter v1.
- Added persisted Wallet-authorized Dead-man arm/heartbeat/disarm, startup plus one-second expiry sweeps, atomic reserve-releasing cancellation, restart persistence and mandatory signed rearm after expiry.
- Added integrity-first persistent-state schema v1/v2→v3 migration while preserving legacy v1 GTC order authorization compatibility.
- Added schema v3 persisted hash-chained execution events and real Market/User/Drop Copy WebSockets with snapshot/replay, monotonic sequence recovery, same-origin enforcement, Gateway Header authentication and query-token rejection.
- Added schema v4 native Stop/Take-Profit conditions that reserve funds up front, trigger only from persisted YNX matches, enter the same CLOB, emit sequenced events and release safely on cancel/reject.
- Extended Mass Cancel, Quant Kill and Dead-man expiry to cancel both active and pending conditional orders with exact result counts.
- Added actual-match-sourced Trailing conditions: creation fails without persisted price evidence, favorable trades update the high/low watermark, and signed-offset reversal activates through the native CLOB.
- Added schema v5 native OCO groups with one shared reserve, deterministic leg priority, atomic peer cancellation, cancel-by-leg semantics and full Mass Cancel/Quant Kill/Dead-man coverage.
- Added schema v6 native TWAP schedules with Wallet-signed fixed-price protection, upfront reservation, deterministic IOC child slices, persisted restart continuation, explicit cancellation and full Mass Cancel/Quant Kill/Dead-man coverage; exposed the same bounded primitive through Quant Adapter v1.
- Replaced static health semantics with separate liveness and integrity-backed local readiness, added validated/generated request IDs and basic Prometheus HTTP counters, and added a SHA-verified backup/restore drill that reconciles balances, orders, fills and chained evidence.
- Added correlated Error IDs and low-cardinality error codes with internal-error redaction, plus JSON runtime logs limited to request/error ID, normalized route, method, status and duration.
- Added a bounded direct-client fixed-window request limiter and 128-slot process concurrency gate with explicit correlated 429/503 responses; only the rightmost address appended by the loopback Caddy proxy is trusted.
- Added schema v7 native iceberg orders with full signed reservation, display-only book/market-stream quantity, deterministic replenishment behind queued liquidity, restart-stable priority, ordinary/mass/dead-man/Quant-kill cancellation and Quant Adapter submission.
- Sanitized every public book order to remove account, reserved balance, Wallet authorization digest and cumulative private fill state.
- Added schema v8 native scale plans with one Wallet authorization, deterministic exact price levels, aggregate atomic reservation/creation, persisted parent-child reconciliation, partial-fill status, whole-plan cancel, Mass Cancel/Dead-man one-plan counting and Quant Adapter submit/cancel/kill.
- Added schema v9 persistent Quant strategy control: `ynx-quant-strategy-kill-v1` is domain-separated from Mass Cancel, atomically cancels the subaccount market and permanently revokes the exact nonce domain across restart.
- Changed Quant capital from a per-request check to aggregate open execution notional across ordinary, conditional, OCO, TWAP, iceberg and scale plans; reconciliation now reports nonce-domain state, capital, exposure and open orders.
- Fixed bounded peer-rate state to reclaim expired windows before using the overflow bucket, preventing stale peers from causing prolonged false throttling.
- Added direct HTTP kill/reconcile negative tests, generated v8-shaped to v9 migration/tamper vectors, and an Exchange-owned release-content scan that does not depend on unavailable external search tools.
- Runtime evidence for these additions is source commit `42f2f48e1ecc3816337d4c6f83ab4cf230f4a01d`.

This testnet preview delivers the independent Exchange Mobile and Exchange Pro surfaces backed by a deterministic, persisted YNX-owned venue engine.

Highlights:

- Five native tabs: Markets, Trade, Orders, Assets, and Account; 12 locales with Arabic RTL.
- Canonical Wallet Auth is deployed from central commit `ec2d2e6e2b16a877be71f5d8a02694b2454ac0a0`; the exact Exchange client, bundle, callback and five scopes are approved and enabled for public-Testnet Product Sessions.
- Native session completion uses `POST /v1/wallet/sessions/complete`; every account request carries a fresh sender-constrained P-256 proof to `POST /v1/wallet/sessions/introspect`. Bearer-only and legacy challenge/session routes are absent.
- Public completion and `exchange:read` introspection both returned HTTP 200; the bounded receipt is `integration/public-wallet-session-evidence-20260804.json`.
- Fixed-point balance reservation, price-time matching, partial/full fills, cancellation, self-trade prevention, fees, nonce/idempotency, replay rejection, tamper rejection, restart recovery, and chained audit.
- DepositIntent requires configured custody plus committed Indexer evidence. Withdrawal stops at reviewed/pending operator broadcast. Cross-chain and production custody are unavailable.
- AI may explain or draft and requires explicit approval for Wallet review; it cannot submit, cancel, withdraw, or mutate security state.
- Public market tape exposes only actual persisted matches. An empty venue returns an empty book/tape—never synthetic liquidity, price, volume, or trades.
- Android Testnet Preview Release built and installed on API 36. iOS production Hermes export passes and a macOS CI job performs Simulator build/install/cold launch/deep link evidence when Xcode is available.

Not production-ready: Wallet-approved product-action signing, withdrawal broadcast/custody operations, cross-chain routing, AI provider approval, production signing, store release, and independent security/legal/accessibility reviews remain required.
