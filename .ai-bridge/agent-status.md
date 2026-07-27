# YNX Bridge Agent Status

- Product: YNX Bridge & Interoperability
- Status: ACTIVE
- Phase: TESTNET
- Workspace: designated YNX 21 worktree verified
- Branch: `codex/final-bridge`
- Verified source commit: `3060deee4132bcd6bdc0d9284e0291391fa3bc4e`
- Upstream: `origin/codex/final-bridge`
- Local/remote relation: synchronized at `3060deee4132bcd6bdc0d9284e0291391fa3bc4e` before this evidence update
- Concurrent writer risk: none detected for the 21-bridge worktree
- Dirty state: CI evidence and coverage updates pending checkpoint commit
- Public execution: disabled
- Public read-only deployment: present at `https://rest.ynxweb4.com/app/bridge`
- Executable YNX route: unavailable
- Real deposit/withdrawal evidence: absent
- Bridge-specific GitHub Actions: run `30278915644` succeeded for source `3060deee4132bcd6bdc0d9284e0291391fa3bc4e`
- Verification artifact: ID `8657978658`, 28,048 bytes, expires 2026-08-26; metadata verified, archive content download not independently unpacked because Blob TLS handshakes timed out twice
- Bridge-specific GitHub Release: absent
- Publishable server/SDK release artifact: absent
- npm dependency state: `npm ci` reported 3 high-severity vulnerabilities; advisory JSON retrieval timed out and remains unresolved

## Current verified tests

- GitHub Actions Bridge verification job `90019987980` — success
- Pinned Hardhat contract artifact generation and contract-tooling validation — success in clean Linux CI
- `go test -count=1 -race ./internal/bridgegateway ./cmd/ynx-bridged` — success locally and in CI
- `go test -count=1 ./...` — success in clean Linux CI after pinned contract generation
- `make bridge-sdk-check` — success
- `make bridge-integration-check` — success
- `make bridge-route-adapter-check` — success with public-read/provider-connectivity/execution truth separation
- `make bridge-data-lifecycle-check` — success
- `make bridge-observability-check` — success
- `make bridge-migration-check` — success with Race detector and machine-readable evidence
- `make bridge-capacity-check` — success as bounded local measurement only
- `make bridge-restore-check` — success; corruption rejected and accepted mutation loss 0
- `make bridge-supply-chain-check` — success; reproducible Linux/amd64 unsigned-local-testnet binary gate
- `make no-placeholder-check` and `make secret-scan` — success
- `make bridge-provider-check` — failed closed after two Circle Sandbox connection timeouts during recovery

## Last protected engineering slice

Commit `3060deee4132bcd6bdc0d9284e0291391fa3bc4e` adds the pinned contract build prerequisite required for a clean GitHub Actions checkout. Run `30278915644` then completed every Bridge verification step successfully and uploaded verification artifact `8657978658`.

## Next action

Protect this CI evidence update, classify and remediate the npm High advisories, then build reproducible downloadable server and SDK candidate artifacts with SBOM, provenance, hashes, install, and cold-start evidence.
