# Supply-Chain Review and Build Allowlist

Version: 0.1.0-candidate  
Evidence date: 2026-07-22  
Source commit: `719e1018267ed5a53e6fae5211c5fd8a1503c35c`  
Decision: not approved for public artifact release

## Inventory and lockfiles

The root npm package now has an explicit private version, allowing native npm CycloneDX generation. `release/sbom-npm.cdx.json` contains 66 components. `release/go-module-inventory.json` records 313 modules from `go list -m -json all`; it is a module inventory, not a standards-complete binary SBOM. Exact inventory and lockfile hashes are in `release/evidence/supply-chain-2026-07-22.json`.

The inventories cover the root dependency graphs only. They do not prove which components are linked into every binary, mobile artifact, SDK, website bundle or future container. They also do not resolve licenses.

## Dependency and static review

`go vet ./...` passed. The repository secret scan passed on the intermediate source. npm audit remains failed: three high-severity findings enter through `adm-zip` in Hardhat development tooling and npm reports no fix. Hardhat is build/development tooling rather than an evidenced server runtime import, but untrusted archives and build input must remain isolated and the finding requires an owner decision or tooling replacement.

Dedicated `govulncheck`, `gosec`, `staticcheck`, `semgrep`, `trivy`, `grype`, `syft`, `hadolint` and `shellcheck` executables were unavailable. Their absence is not a pass. No Dockerfile was found in the inspected checkout depth, so container scanning is not applicable to a current repository-built container; any deployment image must be scanned separately.

## Build-script allowlist

Approved entrypoints for this candidate are repository-tracked Make targets, `go build`/`go test` over declared modules, npm lifecycle scripts explicitly present in `package.json`, and tracked scripts beneath `scripts/build`, `scripts/package`, `scripts/verify`, `scripts/validate` and `scripts/deploy` after code review. Disallow untracked downloaded executables, remote shell pipelines, undeclared package lifecycle hooks, network-fetched compiler input, source mutation during build, and signing inside a general CI step.

Before a production build, list every invoked script and tool version, use a clean isolated workspace and immutable dependencies, disable unnecessary network access, and bind output to source/lockfile/config hashes. Signing occurs only after verification, using a separate approved signer that receives artifact digests—not source secrets.

## Reproducibility result

Two isolated same-host builds of `ynx-chaind` using `CGO_ENABLED=0`, `-trimpath` and an empty Go build ID produced identical 27,487,698-byte binaries with SHA-256 `d8fc1b7582b8531490aab4a110b401189553b51f86ba811710c740a3475c05ee`. This proves a narrow same-host unsigned reproducibility property. It does not prove cross-host/toolchain reproducibility, release linker metadata, signatures, provenance attestation, installation, public hosting or runtime identity.

## Artifact provenance contract

Every releasable artifact needs immutable source commit, dirty-state flag, build recipe/toolchain, dependency and configuration digests, artifact filename/type, SHA-256, bytes, signing class and certificate/key reference, minimum OS/architecture, creation time, builder identity, SBOM/notices hashes, test report and installation/cold-start evidence. Publish through an immutable URL and verify a fresh independent download byte-for-byte.

## Remaining gates

Fix or formally isolate/accept the npm advisory; run dedicated vulnerability/SAST/DAST and applicable artifact scans; complete licenses/notices; generate binary-specific SBOMs; prove cross-environment reproducibility or document controlled variance; establish provenance attestation and production signing; and verify immutable download/install/cold start. Until then, `downloadHosted` and `productionSigned` remain false.
