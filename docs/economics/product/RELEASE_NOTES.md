# YNXT Economics Local Candidate Release Notes

## 2026-07-30 protected Integration-bound source candidate

- Froze Product 17 engineering source at `a377bef61a7082b5b1ae0ebd35d4b97846649b68`.
- Bound the branch to accepted Integration ancestor `470da14faa51914beed2ee6c75a43df013e63b20`.
- Preserved Application v18 / committed state v12 while retaining staking, economics disclosure, reserve projection and YUSD sandbox behavior.
- Rebuilt and verified the five-binary unsigned Testnet CLI candidate; package hash is `sha256:5b4f3ba84dea6201ddf885ba1f5e80adf8be4fc35f649dcc0c34f1bef6976c31`.
- Regenerated the 419-component CycloneDX 1.5 SBOM at `sha256:a33dbcebc9c638aa4a4a5e0e0def5c527d391d9a46ad4985ecc493a47916d9ea`.
- Shared Testnet, public deployment, hosted runnable download, production signing, store release and Mainnet release remain false.

## 2026-07-22 local integration candidate

This branch adds transparent current fixed-fee accounting, versioned staking delegation/unbond/withdrawal, Treasury snapshots, YUSD test-unit reconciliation, liquid-staking and security-pool candidates, per-lane fee-market simulation, and seeded Low/Medium/High macro stress. `/ynxt` and `/economics` expose current-versus-candidate boundaries in 12 locales with RTL, accessibility states and source-labelled failures.

Operations now include Request IDs, process health, Prometheus request/error/latency metrics, exact-commit local capacity evidence and a YUSD copy/hash/restore drill. Security delivery includes explicit trust boundaries, CycloneDX SBOM, third-party notice inventory, script allowlist, dependency review, local reproducible-build evidence and scan records.

This is not a Mainnet or public Testnet deployment. Current consensus still uses fixed fee v1; dynamic issuance, fee-market burn/splits, reward issuance, slashing, liquid staking, Safety Module, service pools and Treasury execution are not activated. YUSD has no real value, custodian, attestation or external redemption rail.

Release flags remain false for installation, central integration, staging/public deployment, hosted download, production signing and store release. Full npm audit has an unresolved High development-tooling chain through Hardhat/`adm-zip` with no available fix. DAST, container scan, public monitor, hosted status/support/privacy/security URLs, audited contracts, secure signers, custody, governance activation and public evidence are absent.
