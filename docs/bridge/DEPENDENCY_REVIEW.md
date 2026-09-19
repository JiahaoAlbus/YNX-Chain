# Bridge Dependency Review

## Scope

The `ynx-bridged` server binary imports repository-owned Go packages and the Go standard library. The root npm dependency tree is build-only tooling used by the Bridge GitHub Actions workflow to generate deterministic Solidity artifacts required by repository integration tests. Build-only status does not exempt a Critical or High advisory because compromised or resource-exhausting build tooling can still invalidate release artifacts and CI availability.

## 2026-07-27 advisory closure

The npm Bulk Advisory API reported one High advisory in the locked build tree:

- Package: `adm-zip`
- Locked vulnerable version: `0.4.16`
- Advisory: `1123686` / `GHSA-xcpc-8h2w-3j85`
- Title: crafted ZIP file triggers a 4 GB memory allocation
- Severity: High
- CVSS: 7.5
- CWE: CWE-400, CWE-789
- Vulnerable range: `<0.6.0`

Hardhat still declared `adm-zip ^0.4.16`, so upgrading Hardhat alone did not guarantee the fixed release. The root package now uses an exact npm override:

```json
{
  "overrides": {
    "adm-zip": "0.6.0"
  }
}
```

The regenerated lockfile contains only the intended dependency change from `adm-zip 0.4.16` to `0.6.0`. No suppression or ignored advisory is used.

## Verification gates

`make bridge-dependency-audit-check`:

1. Reads every concrete package version from package-lock v3.
2. Calls the official npm Bulk Advisory endpoint with three bounded attempts.
3. Fails closed after repeated Registry failure.
4. Fails on every Critical or High advisory.
5. Reports lower severities for explicit review rather than hiding them.

Compatibility verification after the override includes:

- clean `npm ci`
- official npm install audit reporting zero vulnerabilities
- npm Bulk Advisory reporting zero advisories across 86 locked packages
- Hardhat build and selector metadata generation
- contract-tooling coherence check
- the BFT Gateway and Consensus tests that consume generated Solidity artifacts
- Bridge Race tests
- clean Linux GitHub Actions verification

## Release boundary

`adm-zip` is not linked into the Bridge Go binary and is not a user-facing provider dependency. It remains part of the auditable release build chain. Any future Critical or High advisory blocks Bridge candidate packaging until upgraded, removed, or covered by a specific, expiring, owner-approved suppression with reachability evidence.
