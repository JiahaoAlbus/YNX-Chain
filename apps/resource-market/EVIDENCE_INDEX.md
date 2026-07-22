# Evidence index

## Reproducible local gates

- `go test -count=1 ./internal/resourcemarket ./internal/resourceproduct ./apps/resource-market`
- `go test -race -count=1 ./internal/resourcemarket ./internal/resourceproduct`
- `./apps/resource-market/check.sh`
- `./scripts/verify/resource-market-capacity.sh`
- `evidence/android-debug-install-20260722.json` — fresh Android debug build, package/signing inspection, emulator install and measured cold start; explicitly not production signing or full Web feature parity.
- `evidence/android-debug-cold-start-20260722.png` — SHA-256-bound screenshot of the installed Android 16 emulator surface.
- `node scripts/verify-trust-resource-wallet-vectors.mjs`

## Exact artifacts

- `evidence/local-capacity-20260722.json`: narrow local matching-read measurement.
- `integration/canonical-wallet-v1-test-vector.json`: test-only cross-product claim vector, not deployment proof.
- `integration/canonical-wallet-registry.json`: central merge input, not central integration proof.
- `product-release.json`: authoritative boolean status record.
- `FEATURE_COMPLETION_EVIDENCE.md`: requirement-level status and missing proof.
- `UI_DESIGN_AUDIT.md`: recovered UI review and screenshot references.
- `docs/handoffs/trust-resource-artifact-manifest.json`: recovered debug artifact hashes; must be regenerated after source commit.

Screenshots and test logs produced before the final source commit are design/build evidence only. Public URLs, transaction hashes, CI runs, install recordings, signed artifacts and source-commit-bound hashes are absent and therefore not claimed.
