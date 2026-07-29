# YNX AI decision log

## 2026-07-29 — Preserve concurrent dependency and capacity work

During recovery, dependency upgrades and a new capacity test appeared as Dirty Changes. They were inspected rather than discarded, passed targeted Go, race, mobile, audit, and full-repository gates, and were preserved in commits `1cfc0c50` and `c1a29c43`.

## 2026-07-29 — Require Go 1.25.12

A direct `govulncheck` under Go 1.25.7 found 13 reachable standard-library vulnerabilities. The repository now specifies `toolchain go1.25.12`. The targeted AI scan then reported 0 reachable vulnerabilities. The decision is a security gate, not a claim that every required module has no advisory.

## 2026-07-29 — Keep liveness, dependency readiness, and production truth separate

`/healthz` remains local process liveness. `/readyz` checks only configured Gateway reachability. Neither endpoint sets `integratedCentral` or `generationLive` true. This prevents a healthy local process or reachable dependency from being promoted to central/Testnet/public completion.

## 2026-07-29 — Use low-cardinality metrics and route-pattern logs

Metrics aggregate counts, status classes, duration, bytes, and readiness outcomes without account, conversation, prompt, request ID, or raw URL labels. Structured logs use the matched `ServeMux` route pattern and exclude query strings and request bodies. This preserves operational utility without turning observability into a privacy leak or cardinality attack surface.

## 2026-07-29 — Treat trace correlation as partial capability

A bounded W3C `traceparent` may be recorded for correlation, but no span exporter or tracing backend is configured. Distributed tracing therefore remains incomplete until owner 13/30 accepts a backend contract and staged evidence exists.

## 2026-07-29 — Do not invent unit economics

Provider estimates remain estimates. Actual usage, quota, Provider cost, protocol fee, burn/treasury split, and receipts require accepted owner 17 and owner 26 contracts. Unknown values remain unknown; local estimates cannot be retroactively relabeled as actual charges.

## 2026-07-29 — Keep project open

The prior goal coverage summary incorrectly allowed closure while autonomous migration/restore and deeper load work remained and all central/Testnet/public states were false. `goalMayBeClosed` is now false. The next autonomous slice is versioned backup/restore and migration compatibility.
