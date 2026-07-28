# YNX Monitor Current Plan

Current phase: `PROTECT`  
Goal state: `ACTIVE`  
Implementation source: `f3ab30068bc6ae3358cc2e6102ec3735abeae70f`

## Protected checkpoint

- Exact worktree and branch verified; no concurrent writer detected.
- Implementation source is pushed to `origin/codex/final-monitor`; local and upstream SHA are equal.
- Monitor tests: 31/31 passed, including 13 public-status integrity, redaction, replay, approval, and file-boundary cases.
- Production TypeScript/Vite build passed.
- Managed desktop/mobile E2E: 8/8 passed.
- Production dependency audit: 0 vulnerabilities.
- Changed production placeholder and changed-file secret-shaped assignment scans passed.
- Authenticated mutations require exact Origin allowlisting and a session-bound CSRF token.
- `/status` is a separate signed, approved, source-pinned, stale/replay-aware public projection that never reads private OpsStore state.

## Non-green gates

- `go test ./...` remains non-green in cross-product consensus/faucet/trust key-permission tests and missing compiled EVM fixtures outside `13-monitor` ownership.
- `npm run smoke` failed because node, identity, validator, peer, peer-sync, Explorer, Indexer, and AI endpoints were all unavailable. No Testnet or dependency-health claim is made.
- `29-integration` has not frozen the candidate contract; no approved public-status publisher feed, hosted endpoint, Website consumption, artifact, install, signing, or public probe exists.

## Evidence binding

Contract, release, coverage, integration handoff, cross-product vectors, dependency acceptance, evidence index, feature evidence, decisions, questions, and execution log are bound to the protected public-status implementation source. Historical source commits remain preserved in the execution log.

## Exact next engineering action

Create the Monitor threat model and executable supply-chain gates: SBOM generation, third-party notices and license/dependency review, secret and SAST scans, DAST inputs, artifact provenance, and reproducibility evidence. Continue all local work while central endpoints and contract acceptance remain unavailable.
