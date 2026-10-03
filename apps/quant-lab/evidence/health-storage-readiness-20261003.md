# Quant health storage readiness — 2026-10-03

Owner source predecessor: `8186ae67d20bffaa1b26957356ec48197c79feca`.
Ordinary backend/test change only; no Host, authority, SDK or release-pin changes.

## Correction

`/health` previously returned `ready=true` for filesystem snapshots even though
`/ready` correctly rejected those as non-deployable multi-instance storage.
Health now derives `ready` from the same `StorageStatus().multiInstance` fact.
HTTP 200 and `status=ok` still express liveness when the snapshot is readable;
`ready=false` discloses the storage deployment gap. No database configuration is
created or changed by this correction. Readiness is not product completion or
Wallet/private-service authorization.

Filesystem health regression requires an explicit false readiness field.
The actual PostgreSQL tenant-server health regression requires true readiness
alongside PostgreSQL backend and multi-instance storage disclosure.

## Executed gates

- `go test -race ./internal/quantlab`: PASS (2.840 s); optional database tests in
  this unconfigured invocation do not count as executed PostgreSQL evidence.
- `go vet ./internal/quantlab`: PASS.
- `node apps/quant-lab/scripts/test-postgres-isolated.mjs --postgres-bin-dir /tmp/ynx-quant-postgres-qa.7c340A/runtime/bin`: PASS.
- Actual isolated PostgreSQL 17.11 root:
  `/private/tmp/ynx-quant-postgres-it-9AmJq7`.
- Required database integration passes: 14; actual database stop/start verified.
- Post-restart full race regression passes: 108.
- Integration log SHA256:
  `bd0df063a71e6f8070ff774a3a96ac0c9e61b360e10d08f77227b5c4d10c321b`.
- Full regression log SHA256:
  `9deddc4f51241cc23a381ecb61fa6785e4ffa25171941ebeac8c736a1b509616`.
- Server stopped; remaining QA state/event rows `0|0`; production database unused.
- `gofmt` and `git diff --check`: PASS.

## Publication dependency

Fresh public readback in `public-guest-runtime-readback-20261003.md` reports old
commit `664b80b00ac576317524f25b49fc01d1c0db7196` and filesystem storage with
`multiInstance=false`. This correction is local source/tests, not a public
deployment or resolution of that configuration gap. The unique release Owner
must integrate the owned backend hunk, configure actual durable tenant storage,
and separately verify source-bound public health/readiness and concurrency.
Account approval, signatures, orders, transactions and aggregate completion
remain unproved; no such operation was requested or performed here.
