# YNX Cloud feature completion evidence

Evidence baseline: local source commit `ead4d6732c5d942cf8b821e0fd50a06403ac62e5`. Remote publication, staging, and public evidence remain separately unproven and are not implied by this local source reference.

| Capability | Implemented | Tested | Direct evidence | Remaining proof |
| --- | --- | --- | --- | --- |
| Files, folders, search, metadata, trash | yes | local | `internal/cloud/service_test.go`, canonical smoke | staging/public |
| Download, Range, preview, checksum | yes | local | content tests, HTTP `ServeContent`, canonical smoke | CDN benchmark |
| Versions and restore | yes | local | service tests and canonical smoke | remote migration drill |
| ACL, expiring links, revoke | yes | local | service/server tests and failure vectors | central Wallet staging |
| Quota, usage, and audit | partial | local | product-scoped persistent ingress/egress/scan/AI counters, exact current storage, zero-charge report, service/server tests | storage byte-hours, attributable backup/replication, provider invoice and approved pricing |
| Offline queue and conflict UI | yes | local | Web/native tests; Docs 409 smoke | multi-device staging |
| Backup/restore | yes | local | `scripts/smoke.sh`, `internal/cloud/recovery.go` | cross-region drill |
| Quant/product artifact metadata | yes | local | typed object metadata and multipart lifecycle test | staging consumer proof |
| JavaScript/TypeScript SDK | yes | local | dependency-free ESM/types package and `tests/sdk.test.mjs` | publish immutable package and run staging consumer proof |
| Multipart/resume/cancel | yes, bounded | local | durable upload/part state, restart resume and integrity tests | provider-native streaming; pause is client-side stop/resume |
| Presigned direct upload | yes, adapter contract | local | fail-closed remote adapter, restart/verify tests, Web 8–64 MiB route | provisioned S3-compatible provider and remote proof |
| Production object storage | no | no | local/remote adapter contracts only | provisioned provider, KMS, SLA |
| Millions-of-objects candidate | partial | local | 1m-object/100-sample p50/p95/p99 evidence at exact commit | concurrent, persisted, sharded and remote benchmark |
| AI selected-file boundary | yes | local | product-bound job and selected-object service/client tests | configured gateway staging |
| Export/delete | partial | local | product-scoped verified portable ZIP; product-scoped dedup deletion queue; pending/retry tests | provisioned-provider erasure proof and full-account deletion |
| Logs, IDs, public/restricted health, metrics | partial | local | server observability tests and `OBSERVABILITY.md` | persistent histograms, traces, dashboard, alerts |
| Rate limit and backpressure | yes, single-process | local | deterministic forwarded-IP, reset, saturation, retry and metric tests | distributed limiter and measured tuning |
| State migration and rollback | partial | local | legacy v1/v2/v3 fixtures, byte-identical backups, product and schema-v4 usage migration, current→legacy rollback hash and tamper tests | previous-binary and remote drill evidence |
| Public `/cloud` Testnet | no | no | none | domain, deployment, remote smoke |

No row marked “local” proves staging, public deployment, production durability, production signing, or store release.
