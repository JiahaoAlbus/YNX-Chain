# Mail SLO and capacity plan

## Testnet objectives

These are targets, not production achievements.

| Signal | Testnet target | Evidence source |
|---|---:|---|
| Authenticated native-mail availability | 99.9% / 30 days | route counters and probes |
| Read latency | p95 ≤ 300 ms, p99 ≤ 750 ms | server histogram |
| Native delivery enqueue | p95 ≤ 500 ms | persisted delivery audit |
| Internet-provider submission | p95 ≤ 5 s | provider span and receipt |
| Retry queue age | p95 ≤ 5 minutes | durable queue metrics |
| Backup RPO | ≤ 15 minutes | scheduled backup evidence |
| Restore RTO | ≤ 60 minutes | isolated restore drill |

## Measured local baseline

Apple M2, darwin/arm64, 2026-07-29. `TestMailHTTPReadCapacity` sent
1,000 `/v1/health` reads through the current handler at concurrency 25:

| Requests | Failures | Throughput | p50 | p95 | p99 |
|---:|---:|---:|---:|---:|---:|
| 1,000 | 0 | 74,398.3 req/s | 11.459 µs | 1.481416 ms | 2.258292 ms |

This is an in-process local baseline. It does not prove central Wallet,
multi-instance, public-network, Internet-provider, complaint/bounce, or
production capacity.

Backup/restore tests prove authenticated state backup, tamper rejection, restore
and state equivalence locally. Deployed RTO/RPO remain unmeasured until a
scheduled remote backup and isolated restore drill are timed.

## Remaining measurements

- Repeat concurrency 1/10/25/50/100 for 30 minutes with CPU, RSS and errors.
- Record storage growth per account, message, attachment, delivery attempt,
  complaint, appeal, audit entry and AI job.
- Measure native queue depth/age and provider submission, bounce, complaint and
  retry latency against the approved sandbox.
- Connect privacy-safe route/source metrics, traces and alerts to Monitor.
- Run production-volume backup/restore and record exact RTO/RPO.

