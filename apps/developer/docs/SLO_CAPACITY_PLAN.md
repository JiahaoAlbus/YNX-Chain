# Developer SLO and capacity plan

The protected candidate gate validates 12 concurrent isolated tenants and one
restart/recovery cycle. It does not establish production SLOs. Before a public
SLO claim, Central/SRE must collect version-bound p50/p95/p99 request latency,
queue wait, runtime cold start, error rate, workspace storage growth, resource
limits, provider latency and RTO/RPO over an agreed observation interval.

Until then, capacity is bounded by the candidate systemd limits and per-runtime
leases; no availability percentage, tenant quota or throughput commitment is
published.
