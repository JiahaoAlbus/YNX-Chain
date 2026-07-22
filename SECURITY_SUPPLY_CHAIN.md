# YNX Data Fabric Security and Supply Chain

## Current direct evidence

- `npm ci --ignore-scripts` installs the exact lockfile without dependency lifecycle scripts.
- `adm-zip` is overridden to `0.6.0`, the fixed range for GHSA-xcpc-8h2w-3j85. Hardhat build, selector generation and all Go repository tests pass with the override.
- `npm audit --audit-level=high` reports zero known vulnerabilities in the current lockfile.
- Official `govulncheck` 1.6.0 reports zero reachable vulnerabilities after upgrading the toolchain to Go 1.25.12, `golang.org/x/net` to 0.53.0, and gRPC to 1.79.3. The scanner still reports vulnerabilities in required modules whose vulnerable symbols are not called; this is not equivalent to a clean transitive-module inventory.
- `release/npm-sbom.spdx.json` is SPDX 2.3, inventories 67 Node build-tool packages and contains no local user path.
- `go version -m` on the daemon and worker reports the exact runtime module set: `klauspost/compress`, `lib/pq`, `nats.go`, `nkeys`, `nuid`, and `golang.org/x/crypto`, in addition to the repository module and standard library.
- `release/go-runtime-sbom.spdx.json` records that runtime set as SPDX 2.3; it is an unreleased dirty-worktree dependency inventory, not a final binary-bound SBOM or provenance claim.
- The dedicated workflow pins checkout, Go and Node setup Actions to exact commits; permissions are read-only.
- The workflow runs complete Go tests, Data Fabric race tests, vet, pinned `govulncheck`, Node audit, locked artifact generation, secret scan, SBOM validation, path-reproducible builds and artifact hashes.
- `scripts/data-fabric/quality-gates.sh` rejects placeholder/fake-success language in owned runtime/public surfaces, development-path leaks in public metadata, scoped secret patterns, invalid machine records, and whitespace errors.

## Build-script allowlist

Allowed scripts are `hardhat build` and `node scripts/contracts/generate-selector-metadata.mjs`. Dependency lifecycle scripts are disabled during CI installation. Any new preinstall/install/postinstall/prepare script requires source review, owner, purpose, network/file effects and explicit workflow approval.

## Remaining gates

No remote Data Fabric CI run exists at the final commit. Deeper source SAST beyond `go vet`, DAST, container scanning, malware scanning, binary signing, immutable artifact hosting, SLSA provenance, reproducible two-builder comparison and public artifact verification remain incomplete. Current Node and Go SPDX records inventory dependencies; a release SBOM must bind final binary SHA-256, bytes, OS/architecture, Go toolchain and source commit.
