# Quant persistent research schedules resume without a browser

Source predecessor `ae7c6e3b4e6cb5ea47def14f03180e6df2fe0707`.
Ordinary existing research scheduling change; no new trading permission or
capital product, shared SDK/authority modification, Host action or deployment.

## Defect and actual implementation

TenantServer's ticker previously only traversed the process-local opened-tenant
cache. After restart that cache was empty, so persisted enabled schedules did
not resume until the user opened a workspace. Existing core schedule tests
proved durable claims but did not prove this TenantServer startup behavior.

Before each scheduler tick, discover only persisted tenants with an enabled
research schedule. PostgreSQL uses an exact namespace prefix equality, not LIKE
wildcards, a bounded query and existing state load/integrity validation. Local
filesystem discovery accepts existing regular `.json` tenant names, ignores
symlink/directory entries and requires verified persisted state. Discovery
respects the existing finite workspace capacity; unknown/corrupt/unavailable
state or capacity failure fails closed and emits a fixed, non-secret message.

No schedule is enabled by discovery. Disabled workspaces are not opened.
Existing durable claim, explicit stop and CAS fences remain authoritative.
Scheduler execution remains saved research/backtests only, not Paper/Testnet
orders. `StartScheduler` now returns a completion channel that callers may use
to observe cancellation; existing statement-style callers remain compatible.
The new test explicitly joins both scheduler workers before database cleanup.
No durable schema or optional-field compatibility change is introduced.

## Executed restart and concurrent-instance proof

Filesystem and actual PostgreSQL fixtures persist one opted-in schedule plus a
disabled workspace, close the original TenantServer, then construct two new
TenantServers with empty caches. No HTTP/browser/tenant-opening request is made
to either restarted service. Their real tickers discover the persisted schedule.
Direct store reads require exactly one additional experiment; after both
workers stop, final state still has exactly two experiments (original + new),
zero Paper orders and zero Testnet orders. The disabled workspace is not loaded.

PostgreSQL additionally seeds a foreign namespace whose name differs at `_`;
it could match an unsafe LIKE prefix. Its enabled schedule must not be loaded
by this service. Market bars and the business clock are controlled QA inputs,
not proof of live market provenance or public strategy execution.

- Go race regression `./internal/quantlab ./apps/quant-lab/server`: PASS.
- Go vet, gofmt, node syntax, diff checks: PASS.
- Actual isolated PostgreSQL 17.11 runner: 18 required integration passes, actual
  database stop/start persistence verified, 113 full race regression passes.
- Final QA root `/private/tmp/ynx-quant-postgres-it-fknFgr`.
- Integration log SHA256
  `649f2c886b4bcffaed8517f067ec18c3de4a5f7d7f35e4fa62addb638f1f4031`.
- Full regression log SHA256
  `08b45b7eefe22e2b757646efb1090f9e854d512c87e42f807092219600302d5b`.
- Owned server stopped, remaining QA state/event rows `0|0`, production DB unused.
- Earlier single-restarted-service QA also passed at
  `/private/tmp/ynx-quant-postgres-it-FEtBww`; the final proof above strengthens
  this to two concurrently restarted services. No Host operation occurred.

## Publication and remaining scope

Release Owner must admit the new `tenant_schedule_recovery.go` helper with the
TenantServer ticker delta and tests, in addition to prior exact ordinary inputs.
No whole checkout/authority replacement or formal pin override is permitted.
Current public old source/storage and real account/Wallet/session/business
closure remain unproved. This local actual database proof is not public release,
installation, real market-data provenance or a claim that all schedulers exceed
the existing configured capacity. Full finance goal remains active/incomplete.
