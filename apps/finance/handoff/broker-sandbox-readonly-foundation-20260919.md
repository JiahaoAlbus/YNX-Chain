# Finance Weekly v3 — read-only Broker foundation

Worktree: `/Users/huangjiahao/Desktop/YNX Final Worktrees/24-finance-flow-20260912`.
Branch: `codex/finance-wallet-flow-20260912`.
Clean predecessor: `0c7d8cb43a02412026c035b13d3fd54b00383fcd`.
Scope: `apps/finance/**`, `internal/finance/**` only. No shared Wallet/network, DEX, Exchange, Quant, Pay or deployment changes.

## Actual changes

- Server-only strict config/defaults + JSON schema. testnet/6423/sandbox only; live, foreign endpoints, personal Paper origin, premature writes, unsupported auth and global account env mapping fail closed without crashing existing Finance.
- Broker M2M client-secret-post token acquisition/cache and explicit legacy Basic. No redirect, env proxy, retry or raw upstream error leakage. 10-second bounded calls, 4 MiB body cap. No SDK signature logic copied.
- Normalized v1 assets and account status via a persistent-owner-resolver boundary. Actual persistent account mapping is **not implemented** at this checkpoint. No provider data/account endpoint exposed directly to anonymous browser clients.
- Public no-secret `/api/broker/status`, Finance guest-visible Sandbox status including disabled/missing/unknown states, manual read-only retry and permanently disabled submit. Missing amounts stay unknown, not zero. Existing planning/private/Standard Wallet paths retained.
- `finance:doctor`, explicit `--network-read-only`, and `finance:sandbox:verify --network-read-only` use the bounded real adapter. Default verify refuses order workflow. No operator network check was performed; this run's doctor was config-only.
- Provider integration/activation and minimal external-input request docs. `private_key_jwt` unsupported; no fallback to personal Trading API. No new credentials requested in chat.

## Verification on 2026-09-19

- `go test -race -count=1 ./internal/finance ./internal/finance/brokerage ./apps/finance/cmd/broker-tools ./apps/finance/cmd/server` PASS.
- `go test -race ./internal/finance/... ./apps/finance/cmd/...` PASS including existing admin tests.
- `go vet ./internal/finance/... ./apps/finance/cmd/...` PASS.
- `go build ./apps/finance/cmd/server ./apps/finance/cmd/broker-tools` PASS (local host build, not installation/public evidence).
- `npm test` in apps/finance: **51/51 PASS**. Existing private/Standard Wallet fixture regression and actual local Chrome guest Sandbox four-case tests; mobile 390px/no overflow, refresh, no injected-provider calls or new tabs. Fixture results are not installed-wallet or official Broker evidence.
- `npm run security`, `node --check web/app.js`, `git diff --check`: PASS.
- `npm run finance:doctor`: DISABLED + BLOCKED_CREDENTIALS, networkAttempted=false, writeAttempted=false.

## Truth and remaining work

implemented=partial; contractTested=true for this read-only slice only; officialSandboxVerified=false; publicDeployed=false; publicVerified=false; productionApproved=false.

Still required: accepted Finance-only Wallet approval schema/scope/verifier, persistent user/provider/environment mapping, exact-money drafts and deterministic controls, durable idempotent outbox/unknown reconciliation, order submission/query/cancel, position/cash/market-data adapter, persisted events/cursors, manual+AI draft UI and official credential-bound testing. No claim that work package A is complete.

Wallet's read-only handoff says existing Product Session/DEX/Card capabilities cannot approve securities orders. New schema/domain remains a proposal. Next action is bilateral schema/test-vector freezing without asking Wallet to occupy a concurrent write slot; Finance then owns mapping/order journal/execution checks. Real provider permission, account/sign/transaction remain separately authorized.

Rollback: disable module flag and roll back owner source/release through normal authorized procedure if ever deployed. No state migration or existing-record deletion in this slice; no services were restarted. DEX was preserved and paused separately at `1d58b107ed93c79969224c449f933b46aeb5c126`; unfinished native terminal archival and Exchange cache release remain deferred.
