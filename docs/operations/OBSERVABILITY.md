# Observability, Support, and Recovery Evidence

Status: partial implementation; production routing and ownership unverified

## Existing telemetry

The repository includes Prometheus scrape examples, alert rules, a starter Grafana dashboard, and metrics for chain height, pending transactions, persistence failure, replication freshness/lag/failures, indexer and explorer lag, faucet outcomes, and AI/Pay/Trust/Resource gateway outcomes. Gateway responses include request identifiers on supported paths. This is implementation evidence, not proof that a production collector, dashboard, pager, or retention policy is running.

## Required signal contract

Every externally handled request should carry or receive a non-secret request ID. Value-moving workflows additionally need stable transaction hash, idempotency key, actor/service identity, policy/config digest, and bounded audit reference. Logs must be structured, UTC timestamped, severity classified, and redacted. Never log private keys, API keys, authentication headers, raw identity documents, full provider payloads, or unnecessary personal data.

Metrics must cover request count/status/latency, active requests, bounded queue depth, timeouts, rate-limit decisions, transaction submission and inclusion, block height/interval, peer/quorum health, replication freshness, indexer lag, process CPU/memory/file descriptors, disk capacity/growth, provider latency/error/429 state, and certificate/key expiry. Cardinality must be bounded: do not label metrics with addresses, transaction hashes, request IDs, or free text.

Distributed tracing is not evidenced. Before enabling it, define sampling, baggage allowlist, provider/data residency, retention, and deletion. Trace IDs may link service events; payload bodies and signer material must remain excluded.

## Dashboard and alert requirements

The launch dashboard must show the SLO indicators in `SLO_CAPACITY_PLAN.md`, current error-budget consumption, release identity, traffic, latency percentiles, error classes, block progress, replication, indexer lag, dependencies, and saturation. Alerts must be actionable, deduplicated, tested, and linked to a runbook. Page on user-impacting unavailability, halted block production, persistence/integrity failure, stale authoritative replicas, sustained indexer lag, audit-log failure, and credential/certificate expiry. Ticket lower-urgency capacity and cost trends.

Existing rules are a base, not full closure: request latency SLOs, disk, process saturation, quorum, provider limits, certificate expiry, and error-budget alerts remain to be implemented and tested.

## Status and incident communication

A public status surface must report affected service, start time, impact, mitigation, and next-update time without exposing exploit details. Update at a predefined cadence during incidents. Close with restoration time and, for material incidents, a post-incident review covering timeline, cause, user impact, detection, response, corrective actions, owners, and due dates.

No public status provider or verified support route is evidenced in this repository. Publish links only after ownership, access, retention, abuse handling, and failover are tested.

## Support, disputes, and refunds

Support intake must assign a case ID, authenticate sensitive requests, minimize collected data, state expected response time, and separate general help from security, privacy, legal, abuse, transaction dispute, and merchant refund routes. Operators must never request seed phrases or private keys.

For a disputed transaction, preserve chain ID, transaction hash, time, involved product, user-visible error, request ID, and provider references. State clearly that final public-chain transactions may not be reversible. Merchant refunds are separate transactions governed by merchant policy; a refund record is not proof that external value was returned. Escalate suspected account compromise and sanctions/legal requests through approved counsel and security procedures.

## Recovery evidence packet

For every drill or incident, retain: release/config digest; topology; alert and acknowledgement timestamps; redacted logs/metrics; backup identity and hash; restore start/finish; restored height/hash and invariant results; RTO/RPO observation; missing/replayed transaction reconciliation; decision makers; and follow-up actions. Evidence containing secrets or personal data belongs in controlled storage, with only hashes and access references in the repository.

## Launch gate

Observability readiness remains false until collectors, dashboards, alert delivery, status, support routing, retention, redaction tests, and one end-to-end recovery drill are verified in the intended environment with named owners.
