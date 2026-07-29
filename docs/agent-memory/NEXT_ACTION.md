# Next action

Add a non-empty sanitized schema-v1 golden fixture containing one published track, one private artwork object, listener position/history, Trust and Pay idempotency claims, and a multi-event audit chain. Prove byte-for-byte media recovery and replay behavior after v1→v2 migration and backup/restore, then run `go test -race ./internal/music` and update `MIGRATION_COMPATIBILITY.md` plus the coverage matrix.
