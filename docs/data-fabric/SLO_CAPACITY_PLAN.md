# Data Fabric SLO and Capacity Plan

## Evidence boundary

The repository has bounded local and CI evidence for 100 concurrent account
sessions, 1,000 signed producers, Outbox/InBox replay, consumer crash,
backpressure, JetStream leader loss/route partition, and PostgreSQL streaming
standby promotion. It does not establish production capacity, availability,
multi-host RTO/RPO, or a million-user claim.

## Measured signals and gates

| Signal | Existing evidence | Production target status |
|---|---|---|
| Producer throughput, p50/p95/p99 | `scripts/data-fabric/api-capacity` and CI artifact | Not approved or representative |
| Queue depth/backpressure | bounded 1,000-producer and capacity-pressure drills | Not deployed |
| Duplicate/replay correctness | Outbox/Inbox, long-replay and crash tests | Locally/CI verified |
| RTO/RPO | PostgreSQL resilience drill reports bounded one-host measures | No production objective accepted |
| Storage growth/cost | evidence structures exist | No approved workload forecast |
| Availability/error budget | metrics/rules definitions exist | No public SLO or on-call evidence |

Before staging, Integration/SRE must approve workload, budget, target RTO/RPO,
retention, broker/database topology and failure window through
`release/data-fabric/operator-inputs.request.json`. Dashboard and alert
configuration are in `infra/data-fabric/` but are not deployed proof.
