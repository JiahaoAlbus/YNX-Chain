# YNX Trust Center Release Notes

## 0.1.0 Testnet Preview 2 — 2026-07-29

Source runtime and artifact commit: `4d40557229b4232119026cb8c012db3bef2f1be9`

GitHub prerelease: `trust-center-v0.1.0-testnet-preview.2`

### Added

- Exact per-route central Wallet scope enforcement; wildcard, duplicate, unknown, whitespace-mutated and insufficient scopes fail closed.
- Subject-scoped JSON export at `GET /api/export`, requiring `trust:evidence:read` and excluding other subjects, central sessions, replay internals and persistence seals.
- `ynx-trust-backup create|restore` for immutable mode-`0600` backups and verified clean-path restore.
- Backup manifest with state SHA-256, exact bytes, record counts, sequence and envelope integrity.
- Restore checks for source type/mode, strict schema, manifest consistency, nested state integrity, persisted Wallet bindings, no-overwrite and independent cold start.
- Reproducible Linux amd64 server/CLI bundle with CycloneDX SBOM, third-party notices, provenance, SHA-256 manifest and verification record.
- Manually dispatchable Trust Center workflow for bounded recovery and release verification.
- Browser-level accessibility evidence for desktop and 390px mobile rendering, keyboard focus order, interactive accessible names, reduced-motion behavior and 12-locale `lang`/RTL consistency.
- Named polite AI explanation result status region.

### Corrected

- Fixed the subject-export `Content-Disposition` header so the emitted filename does not contain escaped quote characters.
- Removed the previously documented open defect that route scopes were persisted but not enforced.
- Corrected CI module verification so missing cached modules are resolved through the configured Go proxy and verified against `go.sum`, while actual release compilation remains `GOPROXY=off` and `GOSUMDB=off`.
- Closed the UI accessibility gap where the focusable AI result had no role, live-region behavior or accessible name.

### Verified

```text
go test -race ./internal/trustproduct ./cmd/ynx-trust-backup ./apps/trust-center
go vet ./internal/trustproduct ./cmd/ynx-trust-backup ./apps/trust-center
./apps/trust-center/check.sh
cd apps/trust-center && npm run test:ui
go test ./apps/trust-center
GitHub Actions trust-center run 30418987619
```

Playwright passed 5/5 tests covering 1440×1000 desktop, 390×844 mobile, keyboard focus, accessible names, reduced motion, honest empty/failure states, 12 locales and Arabic RTL. The successful GitHub Actions run produced identical binaries across two builds, a deterministic archive, passing `go mod verify`, focused secret/placeholder scans, a passing Go vulnerability-database scan, license review, SBOM/provenance evidence and a clean install/cold-start `/health` identity check.

### Hosted artifact

- Name: `ynx-trust-center-4d40557229b4-linux-amd64.tar.gz`
- SHA-256: `48c1ee8ebac0ac8aa9f68b98e8ce011783be1e33ed98e11033ea757280a6eb85`
- Bytes: `4526591`
- Signing class: unsigned Testnet preview

### Release truth

`implementedLocal`, `testedLocal`, `installedLocal` and `downloadHosted` are true for the source-bound Testnet preview. `integratedCentral`, `deployedStaging`, `deployedPublic`, `productionSigned` and `storeReleased` remain false.

The canonical Gateway registration, shared-Testnet execution, legal/privacy retention policy, current native mobile install evidence, manual assistive-technology review, production signing, independent deployment approval and `https://ynxweb4.com/trust-center` public route remain incomplete. This prerelease is not mainnet, production, notarized or store-released.

Repository-wide `go test ./...` remains red outside the Trust slice because generated Solidity devtool artifacts are absent and two host-permission fixtures fail. No repository-wide green claim is made.
