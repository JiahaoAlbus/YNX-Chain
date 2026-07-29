# Recovery and audit evidence

Source commit: `33eaf45a148f5bf6449ab42adfc3e4e03e2857b9`.

- State writes use mode-0600 atomic replacement, a required HMAC integrity key,
  and a verified sequence/SHA-256 audit chain.
- Every unsafe HTTP operation requires a persisted idempotency key. Exact replay
  after restart returns the stored response; changed method/path/body conflicts;
  an interrupted `running` record fails closed for operator recovery.
- `video-recover backup` creates a gzip tar archive with a versioned manifest and
  SHA-256 for every state/object file. `restore` rejects traversal, links, duplicate
  or unexpected paths, wrong keys, nonempty targets and corrupt state/audit chains
  before atomic target replacement.
- `TestBackupRoundTrip`, negative restore tests and fuzz coverage pass under
  `go test -race ./internal/video/...`.
- The release-bound CLI was also executed against an initialized local store:
  backup and restore both printed `verified`, source/restored `state.json` hashes
  matched at `bb160594c74e7e04a1c7340963373d2159c85f5ccd5ecb0b0217baac285e89c2`,
  and the 453-byte drill archive hash was
  `7431a64c35ad5f1a2fabd1b89bb538f06141d9b9cc9d7d1239fd51a52bae0c13`.
- Restart normalization marks interrupted scan/transcode/AI work recoverable-failed
  instead of reporting success. Media processing retry is explicit and audited.

Boundary: this proves the local recovery implementation and tests. It is not a
production backup, HA object-store restore, disaster-recovery RTO/RPO or operator
approval drill.
