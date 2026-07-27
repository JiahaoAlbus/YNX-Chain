# YNX Trust Center Release Notes

## Active local candidate — 2026-07-27

Source runtime: `d31811280ba741026c74a836a212f78fe88c172a`

### Added

- Exact per-route central Wallet scope enforcement; wildcard, duplicate, unknown, whitespace-mutated and insufficient scopes fail closed.
- Subject-scoped JSON export at `GET /api/export`, requiring `trust:evidence:read` and excluding other subjects, central sessions, replay internals and persistence seals.
- `ynx-trust-backup create|restore` for immutable mode-`0600` backups and verified clean-path restore.
- Backup manifest with state SHA-256, exact bytes, record counts, sequence and envelope integrity.
- Restore checks for source type/mode, strict schema, manifest consistency, nested state integrity, persisted Wallet bindings, no-overwrite and independent cold start.

### Corrected

- Fixed the subject-export `Content-Disposition` header so the emitted filename does not contain escaped quote characters.
- Removed the previously documented open defect that route scopes were persisted but not enforced.

### Verified locally

```text
go test -race ./internal/trustproduct ./cmd/ynx-trust-backup
go vet ./internal/trustproduct ./cmd/ynx-trust-backup ./apps/trust-center
go test ./internal/trustgateway ./internal/trustproduct ./apps/trust-center ./cmd/ynx-trust-backup
./apps/trust-center/check.sh
```

### Release truth

This is not an installed, centrally integrated, shared-Testnet, staged, public, hosted, production-signed or store-released build. No Trust-specific GitHub Actions run, Release or Artifact exists at this checkpoint. Repository-wide `go test ./...` remains red outside the Trust slice because generated Solidity devtool artifacts are absent and two host-permission fixtures fail.

### Next autonomous gate

Create a reproducible unsigned Trust server/CLI bundle with SBOM, third-party notices, provenance, hashes, dependency/license/secret scans and local install/cold-start evidence.
