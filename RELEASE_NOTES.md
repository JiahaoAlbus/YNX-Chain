# YNX Trust Center Release Notes

## 0.1.0 Testnet Preview 1 — 2026-07-29

Source runtime and artifact commit: `1baeccada8e72eab8277803973d0e598dcf19b51`

GitHub prerelease: `trust-center-v0.1.0-testnet-preview.1`

### Added

- Exact per-route central Wallet scope enforcement; wildcard, duplicate, unknown, whitespace-mutated and insufficient scopes fail closed.
- Subject-scoped JSON export at `GET /api/export`, requiring `trust:evidence:read` and excluding other subjects, central sessions, replay internals and persistence seals.
- `ynx-trust-backup create|restore` for immutable mode-`0600` backups and verified clean-path restore.
- Backup manifest with state SHA-256, exact bytes, record counts, sequence and envelope integrity.
- Restore checks for source type/mode, strict schema, manifest consistency, nested state integrity, persisted Wallet bindings, no-overwrite and independent cold start.
- Reproducible Linux amd64 server/CLI bundle with CycloneDX SBOM, third-party notices, local provenance, SHA-256 manifest and verification record.
- Manually dispatchable Trust Center workflow for bounded recovery and release verification.

### Corrected

- Fixed the subject-export `Content-Disposition` header so the emitted filename does not contain escaped quote characters.
- Removed the previously documented open defect that route scopes were persisted but not enforced.
- Corrected CI module verification so missing cached modules are resolved through the configured Go proxy and verified against `go.sum`, while actual release compilation remains `GOPROXY=off` and `GOSUMDB=off`.

### Verified

```text
go test -race ./internal/trustproduct ./cmd/ynx-trust-backup ./apps/trust-center
go vet ./internal/trustproduct ./cmd/ynx-trust-backup ./apps/trust-center
./apps/trust-center/check.sh
GitHub Actions trust-center run 30416831778
```

The successful GitHub Actions run produced identical binaries across two builds, a deterministic archive, passing `go mod verify`, focused secret/placeholder scans, a passing Go vulnerability-database scan, license review, SBOM/provenance evidence and a clean install/cold-start `/health` identity check.

### Hosted artifact

- Name: `ynx-trust-center-1baeccada8e7-linux-amd64.tar.gz`
- SHA-256: `92805078f0a8daebc1e329a293e625d161b600c70371d4cfb7a2ed57e47d1850`
- Bytes: `4526557`
- Signing class: unsigned Testnet preview

### Release truth

`implementedLocal`, `testedLocal`, `installedLocal` and `downloadHosted` are true for the source-bound Testnet preview. `integratedCentral`, `deployedStaging`, `deployedPublic`, `productionSigned` and `storeReleased` remain false.

The canonical Gateway registration, shared-Testnet execution, legal/privacy retention policy, current native mobile install evidence, production signing, independent deployment approval and `https://ynxweb4.com/trust-center` public route remain incomplete. This prerelease is not mainnet, production, notarized or store-released.

Repository-wide `go test ./...` remains red outside the Trust slice because generated Solidity devtool artifacts are absent and two host-permission fixtures fail. No repository-wide green claim is made.
