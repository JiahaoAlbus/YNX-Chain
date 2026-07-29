# YNX Music blockers

## MUSIC-CENTRAL-001

- Owner: Wallet/Auth, Pay/Data Fabric, Trust, AI and Integration Owners
- Reason: adapters exist locally, but accepted deployed contracts and shared-Testnet negative-vector evidence are absent.
- Evidence: `docs/integration/DEPENDENCY_ACCEPTANCE.md`, `product-release.json`
- Prepared: local adapters, versioned integration contract, replay/tamper vectors and truthful fail-closed behavior.
- Minimum external input: accepted schema/version plus reachable Testnet endpoints and credentials supplied through approved secret management.
- Resume condition: owner acceptance is recorded and endpoints are deployed.
- First action after input: run deployed central happy-path and negative vectors against the exact branch SHA.

## MUSIC-RELEASE-002

- Owner: Product release account owner / Security-SRE / Website Owner
- Reason: production signing, immutable artifact hosting, public runtime deployment, store accounts and website deployment require owner-controlled credentials or approvals.
- Evidence: `product-release.json`, `ARTIFACT_MANIFEST.json`, `public-product-metadata.json`
- Prepared: green exact-source CI, local release metadata, lawful catalog boundaries and website handoff metadata.
- Minimum external input: approved signing/hosting/deployment credentials and release authorization.
- Resume condition: credentials are available in the approved environment and release approval is explicit.
- First action after input: regenerate exact-current artifacts, verify SHA-256/SBOM/provenance, deploy through Owner 28 and verify `https://ynxweb4.com/music`.

## MUSIC-RIGHTS-003

- Owner: Rights/licensing owner
- Reason: no licensed commercial catalog or independent rights review exists.
- Evidence: empty lawful public catalog and `catalogTruth.commercialCatalogIncluded=false`.
- Prepared: rights declaration, provenance, territory and evidence-reference enforcement.
- Minimum external input: independently verifiable ownership/license records and approved media package.
- Resume condition: rights evidence is accepted.
- First action after input: ingest through the private validation path and run rights-expiry/takedown/recovery vectors.

## Cross-owner repository condition

`go test ./...` currently fails outside Music because `artifacts/contracts/devtools/SampleEVMWriteCounter.sol/SampleEVMWriteCounter.json` is absent for BFT/Consensus tests. This is not classified as a Music external blocker and must not be repaired by modifying another Owner's artifact from this worktree.
