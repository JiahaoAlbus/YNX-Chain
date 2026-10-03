# Quant PostgreSQL process / Paper risk recovery

Base commit 38e8afa414f275043f79b7674ad7a7a0ed23b53e, tree
d9f3c44b2f82df9b10f08ae04c334bccd0ba0872, branch
codex/exchange-sso-cookie-binding-20261002. Ordinary Quant source/test scope only.
Classification: LOCAL_ISOLATED_PAPER_AND_POSTGRESQL; not public execution,
wallet approval, Testnet trades, real custody or native installation.

## Reproduced and corrected service defect

The new real-PostgreSQL/process/HTTP regression observed HTTP 503 for a fresh
own-strategy intent under a persisted Kill when the restarted process had no
market adapter; expected HTTP 403. That configured race run failed in 3.749s.
The service checked known idempotency and strategy ownership, then fetched the
market before applying the existing Kill guard.

`paperSubmissionLocked` now preserves exact-key replay and changed-key conflict
first, then rejects fresh intents under persisted Kill before adapter/network
work. No new permissions, SDK, live execution or risk model was introduced.
Existing second check after market lookup and settlement guards remain intact.
The unit regression verifies no adapter calls after Kill, exact original replay,
changed-intent conflict and byte-identical durable state.

## Real database and process evidence

Used the retained isolated PostgreSQL 17.11 QA runtime at
/tmp/ynx-finance-postgres-qa.J359YD, loopback port 64623, database ynx_quant_qa.
It was verified stopped, started for these tests, and stopped afterward. This
local QA role uses trust/no TLS, never a production configuration. No SSH/Host
mutation, production DB or credential was used.

`TestPostgreSQLPaperHTTPProcessesReplayRiskAndTenantIsolation` launches two
independent OS processes using the actual Go race test binary and TenantServer,
sharing real PostgreSQL but not process memory. Two isolated local-paper tenant
fixtures have distinct saved strategies/amounts but deliberately the same
idempotency key. Sixteen concurrent HTTP submissions allow only a real receipt
or explicit CAS conflict; exact retries produce one order per tenant. Killing
tenant A leaves B unaffected. Both processes stop cleanly; a third process starts
with no market adapter. Four same-intent replays per tenant match the original
receipt; changed intents conflict, foreign strategies are refused, fresh killed
intents return 403, and fresh non-killed/offline intents return 503. PostgreSQL
revision and complete payload text (including audit/research) remain unchanged
by these reads/refusals; Paper cash/position/orders/risk also remain identical.

The helpers are test-binary-only and refuse non-loopback/non-ynx_quant_qa DB or
non-isolated namespaces. HTTP endpoints are ephemeral loopback. Synthetic market
data is explicitly fixture://synthetic-local-paper-only, not public prices.
These tenant fixtures are not authenticated real Wallet/Product Session users.

Final repeated run:
`YNX_QUANT_POSTGRES_TEST_URL=<isolated-QA-URL> go test -count=3 -race -v -run '^TestPostgreSQLPaperHTTPProcessesReplayRiskAndTenantIsolation$' ./internal/quantlab`
PASS 11.370s. Actual process PIDs: 60736/60739 then 60763 offline;
60789/60791 then 60814 offline; 60849/60851 then 60879 offline.
This three-run result predates the additional file-backed unit test only; it
already includes the final production guard and PostgreSQL payload assertions.

Final complete package with real QA DB:
`YNX_QUANT_POSTGRES_TEST_URL=<isolated-QA-URL> go test -count=1 -race ./internal/quantlab`
PASS 8.086s, including new unit and process tests and existing PG risk/readiness/
tenant/scheduler/state-integrity coverage. Unlike the previous checkpoint's
unconfigured DB run, PostgreSQL integration was actually enabled here.

Final client regression: business-flow 97/97 PASS 0.664s; installed Chrome +
actual local Go risk/reconciliation/lost-response/reload group 5/5 PASS 7.685s.
No real account/signature/order/chain write occurred. Diff whitespace check PASS.
Final SQL count for only this test's quant-process-it-* namespaces was 0;
all owned test rows removed and cluster stopped, retained files preserved.

## Handoff / remaining gates

No DB schema, persisted encoding or package/SDK migration. A must integrate this
six-line service change with the existing reviewed client checkpoint and perform
compatible formal builds/releases. No new installer/artifact/public readback or
ComputerControl evidence; current-source-public, native install, real account
approval, Product Session v2 and real financial business remain NOT_VERIFIED.
The full goal remains active and NOT_COMPLETE. Route issues only to
接续测试网生态审计工作 (01a094cc-0ba3-7901-bcd5-56fce8330c0d).

Next owner work remains durable research/scheduling/Paper recovery and account
isolation, while A owns shared/Host/formal release dependencies. Source tests do
not replace public, installed or user acceptance evidence.
