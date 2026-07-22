# YNX Cloud feature completion evidence

Evidence baseline: source commit `7b3c5f427c1751b8d5f43833e281811dd81f76bb` plus the recovered, uncommitted Cloud change set. A final source commit is intentionally not claimed until the change set is committed and pushed.

| Capability | Implemented | Tested | Direct evidence | Remaining proof |
| --- | --- | --- | --- | --- |
| Files, folders, search, metadata, trash | yes | local | `internal/cloud/service_test.go`, canonical smoke | staging/public |
| Download, Range, preview, checksum | yes | local | content tests, HTTP `ServeContent`, canonical smoke | CDN benchmark |
| Versions and restore | yes | local | service tests and canonical smoke | remote migration drill |
| ACL, expiring links, revoke | yes | local | service/server tests and failure vectors | central Wallet staging |
| Quota and audit | yes | local | product-scoped service tests and canonical smoke | billing provider |
| Offline queue and conflict UI | yes | local | Web/native tests; Docs 409 smoke | multi-device staging |
| Backup/restore | yes | local | `scripts/smoke.sh`, `internal/cloud/recovery.go` | cross-region drill |
| Quant/product artifact metadata | yes | local | typed object metadata and multipart lifecycle test | staging/product SDK proof |
| Multipart/resume/cancel | yes, bounded | local | durable upload/part state, restart resume and integrity tests | provider-native streaming; pause is client-side stop/resume |
| Presigned direct upload | yes, adapter contract | local | fail-closed remote adapter, restart/verify tests, Web 8–64 MiB route | provisioned S3-compatible provider and remote proof |
| Production object storage | no | no | local/remote adapter contracts only | provisioned provider, KMS, SLA |
| Millions-of-objects candidate | partial | local | 1m-object/100-sample p50/p95/p99 evidence at exact commit | concurrent, persisted, sharded and remote benchmark |
| AI selected-file boundary | yes | local | product-bound job and selected-object service/client tests | configured gateway staging |
| Export/delete | partial | local | product-scoped verified portable ZIP; product-scoped dedup deletion queue; pending/retry tests | provisioned-provider erasure proof and full-account deletion |
| Logs, IDs, public/restricted health, metrics | partial | local | server observability tests and `OBSERVABILITY.md` | persistent histograms, traces, dashboard, alerts |
| Rate limit and backpressure | yes, single-process | local | deterministic forwarded-IP, reset, saturation, retry and metric tests | distributed limiter and measured tuning |
| State migration and rollback | partial | local | legacy v1/v2 fixtures, byte-identical backups, v1/v2→v3 product migration, v3→legacy rollback hash and tamper tests | previous-binary and remote drill evidence |
| Public `/cloud` Testnet | no | no | none | domain, deployment, remote smoke |

No row marked “local” proves staging, public deployment, production durability, production signing, or store release.
