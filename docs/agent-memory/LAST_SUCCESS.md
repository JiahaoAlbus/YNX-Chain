# Last successful checkpoint

At `2026-07-29T02:56:17Z`, YNX Video completed and pushed two protected checkpoints:

1. `cbf35c029acb14011f4bb25e7b230e4d1fbbbd8e` — implemented per-asset media SHA-256, bytes and original/derivative lineage, state schema v2, legacy backfill and fail-closed migration behavior.
2. `1572846c4ef676b6b6844e9678e3139df913f36c` — bound Integration Contract v2, cross-product vectors, evidence and truthful release metadata to the implementation commit.

Local and remote `codex/final-video` matched at `1572846c4ef676b6b6844e9678e3139df913f36c` before this memory checkpoint.

Successful gates:

- `go test ./internal/video/...`
- `go test -race ./internal/video/...`
- `go vet ./internal/video/...`
- `npm --prefix apps/video run check`
- `npm --prefix apps/video run smoke`
- JSON parsing for all changed integration/release records

No PR, final-branch Actions run, Video release, public deployment or production-signed artifact was claimed.
