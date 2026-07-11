# Trust API

The deployable public Trust and Chain Law boundary is `cmd/ynx-trustd`, implemented by `internal/trustgateway`. It authenticates requests, assigns request IDs, enforces request and evidence-export size limits, rate limits clients, and writes redacted JSONL audit records containing body hashes instead of request bodies.

Canonical lot lineage, pro-rata trace state, advisory labels, evidence packets, Request Validity records, appeals, false-positive corrections, tracking reviews, and transparency records remain persistent in `ynx-chaind`. In deployed configuration, a dedicated upstream key prevents direct access through the general chain API.

Run `make trust-api-check` for local real-process verification. This is local verification only until the Trust public endpoint passes remote smoke and current-release identity checks.
