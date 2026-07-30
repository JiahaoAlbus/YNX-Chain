# Feature completion evidence

| Capability | Implemented local | Tested local | Public evidence |
| --- | ---: | ---: | ---: |
| Canonical proposal lifecycle, quorum, threshold, and timelock | Yes | Yes | No public deployment |
| Signed vote and delegation integrity | Yes | Yes | No public deployment |
| Authoritative object, parameter, and role registries | Yes | Yes | No public deployment |
| Registry enforcement at startup, proposal, voting, finalization, execution, and restore gates | Yes | Yes | No public deployment |
| Persistent upgrade and signed canary execution gates | Yes | Yes | No public deployment |
| Emergency, conflict, appeal, correction, and discussion records | Yes | Yes | No public deployment |
| Gateway assertion and scoped Product Session boundary | Yes | Yes | No production identity provider evidence |
| Canonical Chain Core/Comet execution adapter | Yes | Yes | No shared-Testnet acceptance |
| Chain execution receipt reconciliation | Yes | Yes | No public transaction evidence |
| Multiprocess four-validator lifecycle drill | Yes | Yes | Local evidence only |
| Public read APIs, health, version, metrics, and audit | Yes | Yes | No public endpoint |
| Governance UI against the real public API contract | Yes | Yes | No public endpoint |
| UI dependency lock, build, type-check, locale tests, real-Chrome test, and vulnerability audit | Yes | Yes | No public endpoint |
| Deterministic Go binaries, SBOM, source archive, secret scan, and forbidden-text scan | Yes | Yes | Exact-head CI pending for current evidence commit |
| Solidity governance contracts | Yes | No | No deployment |
| Explorer, Monitor, Trust, Data Fabric, and Security/SRE acceptance | No | No | No |
| Shared Testnet acceptance | No | No | No |
| Website handoff and Vercel/DNS deployment | No | No | No |
| Production signing and public downloads | No | No | No |
| 12-language boundaries, locale-aware dates, and Arabic RTL | Yes | Yes | Local Chrome evidence only |

## Immutable implementation evidence

- Frozen Governance source candidate and immutable workflow hardening: `5640209e9c7df9789916bd99f61124db566842b4`
- Authoritative registry gates: `b1b460d8e798f50381c819c80294c679a7fc6d1f`
- Accessible 12-locale UI, browser gate, and patched gRPC runtime: `0ed74c9e737ca6d5bbdf226f6ca487dc398b4755`
- Multiprocess Testnet lifecycle: `27921c8298e22616f983c87fd0d8c51a49495cfd`
- Chain receipt verification: `7e342ec`
- Comet execution client: `0640f26`
- Chain Core submission: `ddc7f98`
- Consensus execution audit: `322e795`

## Local verification evidence

- `bash scripts/verify/governance-check.sh`
- `bash scripts/verify/governance-testnet-drill.sh`
- `go test -race -count=1 ./internal/governance ./chain/governance`
- `node scripts/verify/github-actions-pins-check.mjs`
- `make contract-tooling-check && make test`
- `go test ./...`
- `GOTOOLCHAIN=go1.25.12 go run golang.org/x/vuln/cmd/govulncheck@latest ./internal/governance ./chain/governance ./cmd/ynx-governanced ./cmd/ynx-governance-state`
- `npm --prefix apps/governance test`
- `npm --prefix apps/governance run build`
- `npm --prefix apps/governance run test:browser`
- `npm --prefix apps/governance audit --audit-level=moderate`

The frozen-candidate local checks passed on 2026-07-30, including zero npm vulnerabilities, deterministic binaries, full repository tests, and a successful four-validator lifecycle with Canary, canonical execution, receipt verification, restart, and state restore. They do not substitute for GitHub Actions, shared-Testnet transaction evidence, public hosting, or external audit evidence.

## External blockers

- No accepted shared-Testnet transaction, Explorer, Monitor, Trust, Data Fabric, or Security/SRE evidence is present.
- No production signer custody or release-signing authority is present.
- No staging/public governance endpoint, Vercel project, DNS authority, or website acceptance record is present.
- Public support, security, privacy, and status destinations remain unassigned.

These blockers require external owners or credentials; the runtime must continue to report them as degraded rather than fabricating success.
