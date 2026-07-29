# Decision Log

## 2026-07-29 — Preserve truthful local observability

- Decision: expose separate health, readiness, version and metrics endpoints instead of expanding a static green health response.
- Reason: operators and central Monitor/SRE owners need distinct process truth, readiness basis, immutable build identity and scrapeable measurements.
- Boundary: readiness proves only initialized local state and configured adapters; it does not prove upstream, Testnet or public availability.

## 2026-07-29 — Use bounded low-cardinality metrics

- Decision: publish aggregate counters/gauges and a duration sum/count under `ynx_docs_` without route, account, object or document labels.
- Reason: this provides useful local evidence while avoiding unaccepted cardinality and privacy exposure.
- Deferred: histogram buckets, route/status labels, retention and SLO thresholds require YNX 13/30 acceptance.

## 2026-07-29 — Correlate without logging sensitive payloads

- Decision: validate or generate request/trace IDs, generate error IDs on failures, and log method/path/status/bytes/duration only.
- Reason: incident correlation must not collect authorization headers, request bodies, document content or account identifiers.

## 2026-07-29 — Keep runtime source and checkpoint identity distinct

- Decision: evidence files bind the implemented runtime to source commit `3c404c4f4d2c9967e660882349a19c94aebd08f1`; the evidence checkpoint SHA is the Git commit containing those files.
- Reason: a committed file cannot truthfully embed the hash of its own containing commit. Recovery must resolve the containing commit with Git and preserve the exact runtime source attribution separately.
