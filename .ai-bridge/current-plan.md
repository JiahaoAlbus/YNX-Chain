# YNX Monitor Current Plan

Current phase: `PROTECT`  
Goal state: `ACTIVE`  
Implementation source: `5914e02134cd17ad20c6d8c9846864861cdfd4a3`

## Protected checkpoint

- Exact worktree, branch, and repository identity verified; no concurrent writer detected.
- Monitor runtime/UI plus supply-chain tests: 35/35 passed.
- Production TypeScript/Vite build passed; two clean builds produced identical manifests.
- Managed desktop/mobile E2E baseline: 8/8 passed.
- Production dependency audit: 0 vulnerabilities.
- Built-in credential scan: 690 tracked text files, 0 findings.
- SAST: 12 production source files, 0 findings.
- Dependency review: 163 locked production packages; integrity, HTTPS, and license policy passed.
- Artifact scan: 0 prohibited public strings.
- Threat model, CycloneDX SBOM, notices, dependency review, DAST plan, build manifest, unsigned local provenance, and summary exist under `release/monitor/security/`.
- Authenticated mutations require exact Origin allowlisting and a session-bound CSRF token.
- `/status` is a separate signed, approved, source-pinned, stale/replay-aware public projection that never reads private OpsStore state.

## Non-green gates

- `go test ./...` remains non-green in cross-product consensus/faucet/trust key-permission tests and missing compiled EVM fixtures outside `13-monitor` ownership.
- `npm run smoke` failed because node, identity, validator, peer, peer-sync, Explorer, Indexer, and AI endpoints were all unavailable. No Testnet or dependency-health claim is made.
- `29-integration` has not frozen the candidate contract; no approved public-status publisher feed, hosted endpoint, Website consumption, immutable artifact, install, signing, or public probe exists.
- Local provenance is unsigned/non-hermetic and no hosted DAST target exists.
- `registry.npmmirror.com` is present in the lock file and awaits central Security/SRE acceptance.
- The shared repository secret-scan script can false-pass when `rg` is absent; Monitor uses an independent built-in scanner.

## Evidence binding

Runtime security evidence is bound to `5914e02134cd17ad20c6d8c9846864861cdfd4a3`. Later evidence-only checkpoint commits do not change that protected implementation source. Historical source commits remain preserved in Git and the recovery records.

## Exact next engineering action

Implement typed backup, restore-drill, and rollback-proposal operator UI flows with capability gating, explicit approval phrases, independent-verifier states, and managed desktop/mobile tests. Continue all local work while central endpoints and contract acceptance remain unavailable.
