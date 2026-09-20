# Weekly v3 Finance handoff

Owner branch: `codex/finance-wallet-flow-20260912`

Current implementation checkpoint: `c20709da38bc2a4823efb9870046b6afb7775992` / tree `8ff6ce4f3074eb6bcb64b2d5dc47dbd6b8ba48cb`

Evidence: `apps/finance/evidence/finance-weekly-v3-credential-independent-final-20260920.json`

Current Linux release candidate: `apps/finance/evidence/release-candidates/finance-weekly-v3-c20709da38bc-linux-amd64.tar.gz`, 30,251,651 bytes, SHA-256 `839b1c97ac03471d13a7a036e6e0ea3b4054f2468140398a9e6cfda32c3f33a5`. Its source is the implementation checkpoint above, its build-tool checkpoint is `3c32c6133da7a758baa3551fbd1221c28445cc5c`, and its two independent builds were byte-identical. Verification evidence is `apps/finance/evidence/finance-weekly-v3-c20709da38bc-candidate-verification-20260920.json`; the deployment and rollback operation card is `apps/finance/handoff/finance-weekly-v3-c207-release-card-20260920.md`.

Public deployment: `https://finance.ynxweb4.com/` remains healthy and source-bound to implementation `9912d29f82d5ceca689f07e20e944648a2be6de3`. The current source checkpoint above is not yet deployed. Existing deployment evidence and rollback are recorded in `apps/finance/evidence/finance-weekly-v3-public-deployment-20260919.json` and `apps/finance/handoff/finance-weekly-v3-public-release-20260919.md`.

The current candidate is repository-published only. No public deployment, provider read, provider write, official Sandbox verification, Live activation or Mainnet activation was performed while producing it.

## Graceful-drain continuation (2026-09-20)

The actual deployed ingress/process boundary is the Go `ynx-finance.service`: it serves Finance Web/API and the bounded Wallet completion/revoke proxy. The separate Node gateway in `apps/finance/gateway` is optional source and is not the current deployment ingress, so this continuation does not create a second drain authority there.

The Go service now enters an atomic, one-way drain on `SIGTERM`, `SIGINT`, or authenticated loopback `POST /internal/drain`. Readiness fails immediately, new business/transaction/Wallet-proxy admission is rejected, admitted requests are counted and may finish within the configured timeout, and health/metrics expose the drain state and active request count. Timeout is explicit and forces listener closure rather than being reported as graceful success. Durable mappings, orders and outbox records are unchanged across drain and store reopen.

Exact implementation checkpoint: `b87eb0a8a675734c92c932ff893486ee96852c10` / tree `15292de717bf69658ff823c5ed67ca62560dbf87`. Evidence: `apps/finance/evidence/finance-graceful-drain-20260920.json`.

Full Go tests, race tests, vet, build, Finance smoke, 54 browser/contract tests, the 231-file security gate, optional gateway tests, Finance Mobile typecheck/tests/Android+iOS export and the Wallet migration-evidence evaluator passed. The legacy `apps/finance/web/verify-wallet-connect.mjs` still references the absent `wallet-connect-entry.js`; that independent pre-existing script drift was reported to the successor ecosystem audit and generated bundles were restored unchanged.

This is a local source/test checkpoint only. It has not been deployed and does not promote any Wallet approval, provider, transaction, Sandbox or public-runtime flag.

## Implemented owner scope

- Finance Broker Sandbox uses server-only configuration, a persistent per-owner mapping, exact Wallet-approved order contracts, durable outbox/idempotency state, a one-shot operator worker and explicit reconciliation. Browser code cannot access provider credentials or call the provider write API.
- AI securities output remains draft-only and must be copied into the independently validated order workflow.
- Provider status, HTTP request ID and event cursor are persisted separately. Unknown submission/cancellation outcomes become reconcile-only rather than retryable.
- Domain portfolio valuation distinguishes unavailable evidence from an observed zero and rejects negative/overflowing source amounts.
- The activation planner has a credential-independent `--local-read-only` mode. It reads an existing authoritative file or PostgreSQL record without creating/migrating/importing state, emits only non-sensitive readiness counts and cannot call Alpaca or mutate Finance state.
- Fee policy activation now rejects non-canonical amounts, unsupported sources, whitespace/control characters and unsafe evidence references before any Wallet challenge is created.
- Activation readiness reports approval-pending, approved-but-not-consumed, rejected/revoked, local `execution_blocked`, execution, reconcile, terminal and inconsistent states separately. Approval expiry and owner-to-provider mapping change before provider POST are local blocks with no provider correlation, not provider rejections. Exact legacy v2 records with one of those two local codes and no provider evidence migrate to `execution_blocked`; canonical `PROVIDER_REJECTED` records remain unchanged. Readiness requires one globally eligible lifecycle across request and worker queues. Every outbox must match its order/request/provider identity before classification, and terminal orders require matching provider correlation plus canonical rejection semantics. Unknown or contradictory combinations remain fail-closed and are never mislabeled terminal, reconcile-only or ready.
- Broker account linkage is globally one-to-one across Finance users and remains atomic across concurrent file or PostgreSQL writers. A provider account already owned by another YNX user is rejected without mutating either account.
- A single credential-independent end-to-end test now covers persistent account linkage, exact order draft, real approval signature verification, durable callback/outbox, owner-scoped execution request, adapter preflight/submit, reconciliation to filled state and restart readback. All provider data in this test is an isolated fixture and is never reported as official Sandbox verification.
- Controlled verification errors report `providerWriteAttempted=false` when Wallet approval or another local preflight blocks the flow before dispatch.
- The Linux candidate contains the source-bound server, authenticated backup/verify/restore admin, read-only activation diagnostics, one-shot Broker worker, exact Web assets, `.env.example` and a per-file manifest. All four binaries are static Linux/amd64 ELF64 executables.
- A Docker-isolated Linux cold start returned 200 for health, version, readiness, guest Broker status and exact Web assets. An absent state stayed absent. A separate v1-state cold start returned health/version/readiness without changing the v1 file; the existing migration and authenticated backup/restore tests pass against the same source tree.

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
5. Public deployment requires a fresh Finance deployment lease and the rollback-first procedure in the candidate operation card. Do not reuse the 2026-09-19 baseline hashes or hard-coded one-off deployment script.
