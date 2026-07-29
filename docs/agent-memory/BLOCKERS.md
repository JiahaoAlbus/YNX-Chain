# YNX 27 DEX blockers and external gates

Updated: 2026-07-29T02:27:50Z

The product remains `ACTIVE`, not `EXTERNAL BLOCKED`, because autonomous protocol, recovery, security, capacity, accessibility and documentation work remains.

## DEX-XPROD-001 — Shared Developer/API selector metadata

- Owner: YNX 11 Developer / YNX 01 shared chain runtime
- Reason: repository-wide `go test ./...` fails in unchanged `internal/api` tests because Hardhat ABI selector metadata is empty.
- Evidence: `docs/integration/CROSS_OWNER_ISSUES.md`
- Prepared: exact failing tests, symptoms, scope check and acceptance condition are recorded; all focused DEX gates pass.
- Why YNX 27 cannot resolve it here: the failure belongs to shared Developer/API selector generation, outside the DEX ownership boundary.
- Recovery condition: the shared owner returns a source commit where `go test ./internal/api` and `go test ./...` pass without weakening selector checks.
- First action after resolution: rebase/accept the dependency commit and rerun the complete DEX and repository gates.

## DEX-EXT-001 — Canonical Wallet/Gateway acceptance

- Owner: YNX 02 and YNX 29
- Reason: client `ynx-dex-web-v1`, bundle `com.ynxweb4.dex.web`, scopes, approval digest, device/product binding, revoke and introspection are not accepted centrally.
- Evidence: `release/integration/ynx-dex-contract.json`, `docs/integration/DEPENDENCY_ACCEPTANCE.md`
- Prepared: fail-closed PWA state, exact SDK approval validators and cross-product vectors.
- Minimum external input: accepted registry entry and executable central test endpoint/vector version.
- Recovery condition: wrong-product, wrong-bundle, wrong-device, scope-widening, expiry and revoke vectors pass.
- First action after input: run the frozen cross-product Wallet/Gateway vectors without changing the DEX-owned contract.

## DEX-EXT-002 — Oracle and Testnet deployment inputs

- Owner: YNX 19, YNX 29 and the authorized Testnet operator
- Reason: reviewed Oracle contract/policy, canonical token/treasury addresses, secure signer path and funded deployer are absent.
- Evidence: `release/operator-inputs.request.json`, `docs/integration/INTEGRATION_HANDOFF.md`
- Prepared: deployment guard, typed Oracle boundaries, depeg/stale failure paths and local contract suites.
- Minimum external input: approved addresses and protected signer/funding mechanism; no secret material in chat.
- Recovery condition: preflight validates addresses, policy and signer path.
- First action after input: deploy to YNX Testnet, verify bytecode and execute bounded smoke receipts.

## DEX-EXT-003 — Independent security acceptance

- Owner: YNX 30 and an independent auditor
- Reason: no independent smart-contract/security audit exists.
- Evidence: `docs/dex/SECURITY_REPORT.md`, `docs/dex/SBOM.cdx.json`
- Prepared: adversarial/property suites, threat boundaries, notices and local artifact verification.
- Minimum external input: accepted audit scope/provider and remediation acceptance process.
- Recovery condition: findings are resolved or explicitly accepted with evidence.
- First action after input: bind the audit report and remediation commits to the Release candidate.

## DEX-EXT-004 — Public artifact and Website publication

- Owner: YNX 28 and YNX 30
- Reason: no immutable hosted artifact, production signature, DEX GitHub Release or verified `/dex` public page exists.
- Evidence: `public-product-metadata.json`, `product-release.json`
- Prepared: local unsigned PWA/SDK artifacts, SHA-256/bytes, screenshots and Website handoff metadata.
- Minimum external input: accepted signing class, immutable host and Website deployment window.
- Recovery condition: direct public probes bind URL content and downloads to the exact Release source.
- First action after input: verify hosted hashes, public route semantics, canonical/SEO metadata and status separation.
