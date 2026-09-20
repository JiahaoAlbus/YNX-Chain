# Weekly v3 Finance handoff

Owner branch: `codex/finance-wallet-flow-20260912`

Current implementation checkpoint: `c20709da38bc2a4823efb9870046b6afb7775992` / tree `8ff6ce4f3074eb6bcb64b2d5dc47dbd6b8ba48cb`

Evidence: `apps/finance/evidence/finance-weekly-v3-credential-independent-final-20260920.json`

Public deployment: `https://finance.ynxweb4.com/` remains healthy and source-bound to implementation `9912d29f82d5ceca689f07e20e944648a2be6de3`. The current source checkpoint above is not yet deployed. Existing deployment evidence and rollback are recorded in `apps/finance/evidence/finance-weekly-v3-public-deployment-20260919.json` and `apps/finance/handoff/finance-weekly-v3-public-release-20260919.md`.

## Implemented owner scope

- Finance Broker Sandbox uses server-only configuration, a persistent per-owner mapping, exact Wallet-approved order contracts, durable outbox/idempotency state, a one-shot operator worker and explicit reconciliation. Browser code cannot access provider credentials or call the provider write API.
- AI securities output remains draft-only and must be copied into the independently validated order workflow.
- Provider status, HTTP request ID and event cursor are persisted separately. Unknown submission/cancellation outcomes become reconcile-only rather than retryable.
- Domain portfolio valuation distinguishes unavailable evidence from an observed zero and rejects negative/overflowing source amounts.
- The activation planner has a credential-independent `--local-read-only` mode. It reads an existing authoritative file or PostgreSQL record without creating/migrating/importing state, emits only non-sensitive readiness counts and cannot call Alpaca or mutate Finance state.
- Fee policy activation now rejects non-canonical amounts, unsupported sources, whitespace/control characters and unsafe evidence references before any Wallet challenge is created.
- Broker account linkage is globally one-to-one across Finance users and remains atomic across concurrent file or PostgreSQL writers. A provider account already owned by another YNX user is rejected without mutating either account.
- A single credential-independent end-to-end test now covers persistent account linkage, exact order draft, real approval signature verification, durable callback/outbox, owner-scoped execution request, adapter preflight/submit, reconciliation to filled state and restart readback. All provider data in this test is an isolated fixture and is never reported as official Sandbox verification.
- Controlled verification errors report `providerWriteAttempted=false` when Wallet approval or another local preflight blocks the flow before dispatch.

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
