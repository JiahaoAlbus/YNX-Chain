# Bridge Third-Party Notices

The current `ynx-bridged` binary imports repository-owned packages and the Go standard library only. `go list -deps` and `go version -m` are checked by `make bridge-supply-chain-check`.

The Go toolchain and standard library are distributed under the Go project license, commonly identified as BSD-3-Clause. The exact Go version is recorded in each generated SBOM and artifact manifest.

Circle CCTP is an inspected external candidate, not a linked dependency or enabled service. Its official reference is recorded in `provider-status.json`; no Circle credential, SDK, contract, trademark asset, or funded route is included.

The Bridge CI build chain also uses the repository Hardhat toolchain. Its transitive `adm-zip` dependency is pinned by npm override to version `0.6.0` under the MIT license and is checked by `make bridge-dependency-audit-check`. This dependency is build-only and is not linked into the Bridge Go binary.

Repository-wide dependencies used by other YNX services are outside this Bridge-binary notice and remain covered by repository-level dependency review. The Bridge-specific build-chain review is recorded in `DEPENDENCY_REVIEW.md`.
