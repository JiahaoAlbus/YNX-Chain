# Weekly v3 Finance handoff

Owner branch: `codex/finance-wallet-flow-20260912`

## Implemented owner scope

- Finance Broker Sandbox uses server-only configuration, a persistent per-owner mapping, exact Wallet-approved order contracts, durable outbox/idempotency state, a one-shot operator worker and explicit reconciliation. Browser code cannot access provider credentials or call the provider write API.
- AI securities output remains draft-only and must be copied into the independently validated order workflow.
- Provider status, HTTP request ID and event cursor are persisted separately. Unknown submission/cancellation outcomes become reconcile-only rather than retryable.
- Domain portfolio valuation distinguishes unavailable evidence from an observed zero and rejects negative/overflowing source amounts.
- The activation planner has a credential-independent `--local-read-only` mode. It reads an existing authoritative file or PostgreSQL record without creating/migrating/importing state, emits only non-sensitive readiness counts and cannot call Alpaca or mutate Finance state.
- Fee policy activation now rejects non-canonical amounts, unsupported sources, whitespace/control characters and unsafe evidence references before any Wallet challenge is created.

## Shared-interface boundary

Finance consumes the existing Wallet/Auth interfaces and does not modify Wallet or RPC shared implementations. No new shared-interface defect was introduced or identified by this checkpoint. Any future callback/provider incompatibility must be routed to Central rather than patched by creating a Finance-specific Wallet protocol.

## External gates that remain false

- Alpaca Broker Sandbox credentials and entitlements: `NOT_VERIFIED`.
- Official provider account reads, market-data reads, POST order, query, DELETE cancel and final reconciliation: `NOT_VERIFIED`.
- Public/current-source deployment of this Weekly v3 implementation: `false` until a separate Finance deployment lease and source-bound readback exist.
- Wallet account approval, signing and chain transaction evidence for this checkpoint: `false`.
- Production approval and live trading: `false`; live origins and live mode remain forbidden.

## Operator continuation

1. Keep writes disabled and run configuration-only doctor/activation reports.
2. With an existing absolute state path and one authorized test owner, run `npm run finance:sandbox:activation-plan -- --local-read-only`. This does not require Broker credentials and does not write state.
3. Supply credentials only through the approved secret channel, then perform the separately authorized bounded read-only provider verification.
4. A provider write still requires a new immediate authorization, exact activation receipt and one eligible execution-requested outbox. No source or local test can promote the official verification flags.
