# YNX Exchange dependency and license review

Evidence source commit: `42f2f48e1ecc3816337d4c6f83ab4cf230f4a01d`.

The runtime inventory is recorded in `SBOM.cdx.json`. The native client uses pinned lockfile versions. Direct Exchange server modules embedded by `go version -m` are:

- `github.com/decred/dcrd/dcrec/secp256k1/v4` v4.4.0 — ISC;
- `github.com/gorilla/websocket` v1.5.3 — BSD-2-Clause;
- `golang.org/x/crypto` v0.33.0 — BSD-3-Clause;
- `golang.org/x/sys` v0.30.0 — BSD-3-Clause.

The reviewed direct mobile runtime packages are permissive-license packages; Lucide and secp256k1 use ISC. No GPL or proprietary runtime dependency is intentionally linked into the Exchange artifacts. This statement is a repository review, not external legal advice.

The local Darwin ARM64 build is unsigned. The Android preview uses a debug signing key and is not a production/store artifact. The iOS Simulator workflow disables code signing. Production signing, notarization, store review, custody approval and legal-language review remain external gates.

Verified commands on 2026-07-27:

- `go version -m` on the source-bound local server build;
- `go vet ./internal/exchangeproduct ./apps/exchange/server`;
- `npm --prefix apps/exchange test`;
- `npm --prefix apps/exchange run test:browser`;
- `npm --prefix apps/exchange run validate:release`.

The shared repository secret/placeholder scripts depend on `rg`. In this environment `rg` was absent and those scripts returned false green, so they were not accepted as evidence. The Exchange-owned Node validator performs the applicable filler and secret-pattern scan without external dependencies.

Remaining supply-chain work: automated license extraction, lockfile diff approval, SAST/DAST, container/artifact scanning, reproducibility comparison, signed provenance and independent legal/security review.
