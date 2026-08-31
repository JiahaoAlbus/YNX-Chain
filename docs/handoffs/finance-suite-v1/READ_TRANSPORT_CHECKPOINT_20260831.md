# Finance suite read-transport checkpoint — 2026-08-31

Status: source-tested product checkpoints only. None of the entries below proves a public deployment, installed runtime, Wallet approval, signature, order, swap, liquidity action, Strategy Vault execution, or production custody.

## Product checkpoints

| Product | Branch / commit | Read transport change | Focused verification |
| --- | --- | --- | --- |
| Finance suite | `codex/final-finance-suite` / `1239bc43db56807e09ff176f310bda129deb9a88` | Published `ynx-finance-stream-envelope-v1` JSON Schema and version-lock test for read-only `snapshot` / `upsert` / `reconciled` messages. | `npm --prefix packages/finance-domain test` — 8/8; JSON parse gate. |
| DEX | `codex/dex-c7-four-path-manifest-20260831` / `4b3ca5380adda12b4a0a871a9b642b1fc8a8ac37` | The browser `online` event reloads only `/v1/native-snapshot`; it cannot resubmit a Wallet action. | `npm test` — 31/31; `npm run build`; `npm run verify:legacy-route-quarantine`. |
| Exchange | `codex/exchange-a9-runtime-carrier-20260831` / `2f1b0f8bc08e2abedcf27bf9c2af902e49da4618` | `GET /v1/market-data/stream` emits source-labelled SSE snapshots and durable-state reconciliations, with keepalives and subscriber disconnect handling. | `go test ./internal/exchangeproduct ./apps/exchange/server ./cmd/ynx-exchange-seed-testnet`; `go vet ./internal/exchangeproduct ./apps/exchange/server`. |
| Quant | `codex/quant-owner-contract-snapshot` / `5863ddc6a02c0069628fe4d6e8f831f260303271` | `GET /v1/stream` now sends a source-labelled WebSocket `reconciled` envelope when the integrity-protected Quant state changes and holds liveness with ping/pong. | `go test ./internal/quantlab ./apps/quant-lab/server`; `go vet ./internal/quantlab ./apps/quant-lab/server`; `npm --prefix apps/quant-lab test` — 6/6; `npm --prefix apps/quant-lab run build:wallet`. |

## Integration contract

1. Treat all four transports as read-only. They cannot configure a Wallet client, grant a mutation capability, or replace the central Data Fabric envelope.
2. Preserve each product's `requestId`, source provenance, source status, and durable-state identity through any central mapping. `FIN_SOURCE_UNAVAILABLE` is retryable only after the caller has retained its prior write outcome as unknown or terminal; it never means a financial action succeeded.
3. DEX execution remains disabled absent product-owned Chain Core v1.35 custody/mandate proof. Its persisted vault owner must equal the Strategy Mandate owner; a closed vault must hold zero YNXT; engines cannot withdraw, change owner, or widen the mandate.
4. Exchange and Quant file backends truthfully advertise `degraded_single_host`; public multi-instance readiness requires their PostgreSQL paths and a distinct source-bound deployment lease.
5. A reconnect must reload a fresh authoritative snapshot. It must not replay any order, liquidity action, strategy action, Wallet request, or prior idempotency key.

## Central integration still required

- accept and map `release/integration/finance-source-stream-envelope-v1.schema.json` without granting action semantics;
- bind each product commit to its actual public or installed runtime before making any URL claim;
- execute direct visible Wallet lifecycle and Product Session evidence separately;
- obtain product-scoped deployment leases before any host mutation; and
- retain Explorer links, transaction/order identifiers, and rollback evidence only once a product-owned write path is actually accepted.
