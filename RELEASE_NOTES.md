# YNXT Economics Local Candidate Release Notes

## 2026-07-22 local integration candidate

This branch adds transparent current fixed-fee accounting, versioned staking delegation/unbond/withdrawal, Treasury snapshots, YUSD test-unit reconciliation, liquid-staking and security-pool candidates, per-lane fee-market simulation, and seeded Low/Medium/High macro stress. `/ynxt` and `/economics` expose current-versus-candidate boundaries in 12 locales with RTL, accessibility states and source-labelled failures.

Operations now include Request IDs, process health, Prometheus request/error/latency metrics, exact-commit local capacity evidence and a YUSD copy/hash/restore drill. Security delivery includes explicit trust boundaries, CycloneDX SBOM, third-party notice inventory, script allowlist, dependency review, local reproducible-build evidence and scan records.

This is not a Mainnet or public Testnet deployment. Current consensus still uses fixed fee v1; dynamic issuance, fee-market burn/splits, reward issuance, slashing, liquid staking, Safety Module, service pools and Treasury execution are not activated. YUSD has no real value, custodian, attestation or external redemption rail.

Release flags remain false for installation, central integration, staging/public deployment, hosted download, production signing and store release. Full npm audit has an unresolved High development-tooling chain through Hardhat/`adm-zip` with no available fix. DAST, container scan, public monitor, hosted status/support/privacy/security URLs, audited contracts, secure signers, custody, governance activation and public evidence are absent.
