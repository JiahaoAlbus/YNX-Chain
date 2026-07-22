# Third-party notices

The Governance binaries are built from the YNX Chain Go module. Direct dependencies declared by the module are:

- `github.com/cometbft/cometbft v0.38.23` — Apache License 2.0.
- `github.com/decred/dcrd/dcrec/secp256k1/v4 v4.4.0` — ISC License.
- `golang.org/x/crypto v0.33.0` — BSD 3-Clause License.

The release packager emits a CycloneDX SBOM containing every module and version selected by the Go module graph. Transitive license identifiers remain `NOASSERTION` until an automated license-classification review and legal approval are completed; omission of a classification is not a claim that no license obligations apply. Source license files from the selected modules are authoritative.
