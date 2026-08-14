# YNX Calendar SLO and capacity plan

Current product source: `f1305e6b52c7484c099fe6b2f6cbc2b6d36508e2`
Public Web runtime source: `635f6745db8b5d4e4f00253d72fd5ab97da471ac`

## Evidence boundary

A public Testnet Web/API runtime is available, but no production workload or separate staging deployment exists. The values below are direct local/public control checks or pre-acceptance targets. Targets are not achieved SLOs until measured on accepted infrastructure with representative data and sustained concurrency.

## Direct local measurements

| Gate | Observed result | Scope |
|---|---:|---|
| Calendar unit plus state operator tests | 2.044 s | local test process |
| Calendar Race suite | 2.172 s | local test process after build cache |
| Local empty-state backup | 522 bytes | one schema-1 empty state |
| Local empty-state restore command | 61 ms | isolated local filesystem target |
| Browser proof | zero console errors | one desktop and one mobile scenario |
| Service smoke | pass | single local process and bounded scenario |
| Public authenticated concurrent reads | 100/100 | two canonical Wallet users against exact public build `cf92caa3`; control-path concurrency only |
| Current public exact-build probe | pass | build `635f6745`, HTTP 200, binary SHA-256 `b74820c0…`, rollback binary retained |
| Current public concurrent health | 100/100 HTTP 200 | HTTP/2 parallelism 10 with DNS pinned to the published IPv4 address; control-path availability only |
| Independent TLS handshake stress | 18/100 HTTP 200 | parallelism 25 from one source; 82 entrance timeouts, retained as a public-ingress capacity risk |

These measurements are not representative p50/p95/p99 latency, throughput, concurrency or production RTO/RPO.

## Candidate service objectives

| Signal | Candidate objective | Acceptance method |
|---|---|---|
| Availability | 99.9% monthly for accepted Testnet | external probes excluding announced maintenance |
| Read p95 | under 250 ms | representative authenticated event-list workload |
| Mutation preview p95 | under 500 ms | conflict and recurrence workload |
| Mutation approval p95 | under 750 ms excluding central provider latency | persisted state and audit completion |
| Error rate | under 1% excluding validated client errors | bounded route/status metrics |
| Reminder scheduling delay p95 | under 60 s | accepted worker and provider delivery path |
| Backup RPO | at most 15 min candidate | scheduled encrypted backup plus verified retention |
| Restore RTO | under 30 min candidate | provision, restore, verify and promote representative dataset |
| Crash-free session | at least 99.5% candidate | accepted Web/native telemetry |

## Capacity dimensions to measure

- users, calendars and events per user;
- recurring series and expanded occurrences per query;
- attendees, shares and audit records per event;
- mutation previews/approvals per second;
- reminder queue depth and due reminders per minute;
- state file bytes and write amplification;
- backup bytes, duration and storage growth;
- Wallet verifier, AI, Mail and Data Fabric provider latency and rate limits;
- concurrent Web/native sessions and offline replay bursts.

## Benchmark matrix

1. Seed 1k, 10k and 100k events with realistic recurrence, attendee, reminder and audit distributions.
2. Measure cold start, state load, event list/search, recurrence expansion, preview, approval, RSVP and export.
3. Run 1, 10, 50 and 100 concurrent users with bounded mutation ratios.
4. Inject Wallet, Mail, AI and Data Fabric delay/failure without substituting successful mocks.
5. Measure backup and isolated restore at every data tier.
6. Verify digest, counts, recurrence, reminder idempotency and audit continuity after restore.
7. Record p50/p95/p99, throughput, errors, CPU, memory, disk latency, state growth and provider latency.

## Scaling risks

The current single authenticated state file serializes updates under one mutex and rewrites the state envelope for each committed mutation. The server bounds public in-flight requests, and the 100/100 read probe proves a limited concurrent control path, not multi-instance safety, horizontal scaling, high write throughput or large-state efficiency.

Before staging acceptance, Calendar needs an explicit storage migration decision, transaction/locking semantics, backup consistency point, worker ownership, idempotent provider delivery, and rollback plan. A database or distributed store may only be adopted through a versioned migration with full compatibility and restore evidence.

## Recovery acceptance

The local RPO is the backup creation point. The local 61 ms restore result covers an empty state on one machine. Production recovery requires:

- representative encrypted backups;
- approved independent key escrow;
- separate restore host or environment;
- storage/provider outage injection;
- measured verify and promotion time;
- rollback after a failed promotion;
- recurring restore drills with immutable evidence.
