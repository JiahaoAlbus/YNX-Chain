# Quant ca272 source-bound runtime candidate

Local unsigned Linux amd64 candidate for source
`ca272f1e0bbeec61ba2e4b8bb465ad6f9dd63ef0` (tree
`3603891459dd99db8328902d2195d1dcd9f08865`).

- Archive: `apps/quant-lab/evidence/release-candidates/ynx-quant-lab-ca272f1e0bbe-linux-amd64-runtime.tar.gz`,
  3,132,697 bytes, SHA-256
  `8d9f37bd648b395ebd83608be752917834fb32c9145746ccab4f998a0f461c2e`.
- Binary: 7,562,962 bytes, SHA-256
  `f9499c36e5ceda3249978b174785df74fe9ce6e0a367ceecbd78522eef09273c`.
- The checksum manifest excludes itself and verified all eight payload files.
  `BUNDLE_MANIFEST.json` binds the exact source commit/tree and the archive
  retains `apps/quant-lab/web`, matching the server's static-root path.

The source fixes a real WebSocket timing data race by isolating stream polling
and ping intervals on each server instance. Both normal and `go test -race`
Quant server suites pass after the change.

The candidate consumes the accepted shared Provider authority in source only.
It is not Linux runtime, public deployment, provider approval, Product Session,
strategy execution, signature, or Testnet order evidence. A fresh Quant-only
host/rollback preflight and Central single-use deployment lease remain required.
