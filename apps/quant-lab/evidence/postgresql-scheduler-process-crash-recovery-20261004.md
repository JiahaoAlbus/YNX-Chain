# Quant actual scheduled-worker process loss / PostgreSQL recovery

Base 16109eaafe94adbf3bc03bde75848c0ed8e7a3e2, tree
4e5793b8bf88d102108371ba66769d437a9df4e8, branch
codex/exchange-sso-cookie-binding-20261002. Only direct Quant Go tests and this
evidence changed. Production engine, Wallet/SDK/authority, bundles and Host are
unchanged. This closes an engineering evidence gap, not the full product goal.

## Actual exercised transition

The old PostgreSQL scheduler test simulated process loss by calling the internal
claim helper. The new TestPostgreSQLScheduledWorkerSIGKILLRecoversOnlyAtNextDue
executes actual RunDueSchedules in an independent OS process with real
PostgreSQL. Readiness is emitted only after the claim is persisted and its
controlled market History call has actually started and is blocked.

The parent observes Running=true and a nonempty durable RunID, sends SIGKILL to
that exact isolated child, waits for it, and validates actual WaitStatus signal
SIGKILL. No production process or A worker is touched. The original durable
claim remains identical. A second process runs the actual engine at the same
controlled clock and cannot revive the claim early. A third runs at the next
persisted due boundary and produces exactly one completed research result.
Paper and Testnet orders remain empty. A fourth process at the same clock cannot
run again: exact PostgreSQL row revision and complete JSON payload/audit text
remain identical. All four instances read the same real DB, not process memory.

Local fixture bars and deterministic clock are explicitly controlled inputs.
This is real engine computation/storage/process behavior, not public market or
performance evidence, wallet approval, capital execution or real Testnet orders.
It proves the claim-to-market-block crash window, not arbitrary transaction,
mid-computation or deployment failures. It invokes the actual scheduled engine
in test workers; it does not prove a public daemon timer loop/native lifecycle.

The extended helper remains test-binary-only and restricted to 127.0.0.1,
database ynx_quant_qa and quant-process-it-* namespaces. The Paper HTTP helper
continues to use the actual TenantServer. Its previous two-tenant multi-process
test also passes in the final full regression. No new product test endpoint is
included in production binaries.

## Executed results

QA database: retained PostgreSQL 17.11 runtime under
/tmp/ynx-finance-postgres-qa.J359YD, loopback 64623, ynx_quant_qa; local trust/no TLS,
never a production configuration. Started only for owned isolated tests; exact
namespace rows are removed by test cleanup. Final matching namespace count 0.
Cluster was stopped afterward; retained data/runtime files are preserved.

Initial unconfigured command was a compile check with DB test skipped, not a
database pass. First configured attempt failed invalid request before creating
a child because the seed Config omitted the required market adapter. Corrected
that fixture; no production rule was weakened or rewritten.

Final repeat command:
`YNX_QUANT_POSTGRES_TEST_URL=<isolated-QA-URL> go test -count=3 -race -v -run '^TestPostgreSQLScheduledWorkerSIGKILLRecoversOnlyAtNextDue$' ./internal/quantlab`
PASS 11.380s. Actual process groups:
71471 (SIGKILL), 71473 (before due), 71501 (recovery), 71551 (second opening);
71554 (SIGKILL), 71556 (before due), 71577 (recovery), 71581 (second opening);
71603 (SIGKILL), 71605 (before due), 71607 (recovery), 71630 (second opening).

Final complete package with real PostgreSQL enabled:
`YNX_QUANT_POSTGRES_TEST_URL=<isolated-QA-URL> go test -count=1 -race ./internal/quantlab`
PASS 10.786s, including actual Paper HTTP processes, SIGKILL scheduler recovery,
research replay/isolation and existing storage/risk/tenant/readiness tests.
gofmt and git diff --check PASS. No browser source changed; no new browser,
installer, production build, deployment or public validation is claimed here.

## Delivery boundary and next action

Full Finance goal remains NOT_COMPLETE. Current source-bound public, native
installation, real selected-provider approval, Product Session v2 and public
account business remain NOT_VERIFIED. A remains the unique shared/formal build/
Host owner. Current shared successor independent-review HOLD and Host transport
UNKNOWN are preserved; this work does not retry or bypass those branches.

Issues/checkpoints route only to 接续测试网生态审计工作
(01a094cc-0ba3-7901-bcd5-56fce8330c0d). Existing production changes to integrate are
38e8afa41 client risk-unknown admission and 16109eaaf persisted Kill-before-feed.
This checkpoint adds restart evidence without a new schema/format migration.
Next owned work remains complete saved-research and account recovery journeys;
formal compatible release and real public/installed business gates remain
separate and must be coordinated with A rather than marked completed by tests.
