# Bridge Third-Party Notices

The current `ynx-bridged` binary imports repository-owned packages and the Go standard library only. `go list -deps` and `go version -m` are checked by `make bridge-supply-chain-check`.

The Go toolchain and standard library are distributed under the Go project license, commonly identified as BSD-3-Clause. The exact Go version is recorded in each generated SBOM and artifact manifest.

Circle CCTP is an inspected external candidate, not a linked dependency or enabled service. Its official reference is recorded in `provider-status.json`; no Circle credential, SDK, contract, trademark asset, or funded route is included.

Repository-wide dependencies used by other YNX services are outside this Bridge-binary notice and remain covered by repository-level dependency review.
