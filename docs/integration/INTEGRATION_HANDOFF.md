# YNX Creator Studio Integration Handoff

Owner: **YNX 34**  
Status: **FREEZE candidate; not centrally integrated**  
Protected runtime source: `8a7e9b930f89be5587e6547aa23241db70d436f4`  
Updated: 2026-07-29T02:44:50Z

## Product boundary

YNX Creator Studio is a Web-first professional control console for creator identity/team access, content upload/processing, rights, publication, moderation, analytics, revenue evidence and bounded AI proposals. It is independent from Video Viewer, Music Listener and Social.

Creator Studio owns its local workflow and adapter contracts. It does not own central Wallet/Auth, App Gateway, Pay, Data Fabric/Billing Ledger, Trust, Monitor, Explorer, Security/SRE release policy or Website deployment.

## Freeze package

- Machine contract: `release/integration/creator-studio-contract.json`
- Cross-product vectors: `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`
- Dependency ledger: `docs/integration/DEPENDENCY_ACCEPTANCE.md`
- Coverage matrix: `.ai-bridge/full-goal-coverage.json`
- Release truth: `apps/creator-studio/product-release.json`
- Website metadata: `apps/creator-studio/public-product-metadata.json`

## Creator Studio-owned facts

### Wallet tuple candidate

- Product client: `ynx-creator-studio-web-v1`
- Requesting product: `ynx-creator-studio`
- Bundle: `com.ynxweb4.creator-studio.web`
- Device algorithm: `p256-sha256`
- Browser session header: `X-YNX-App-Session`
- Scopes: `ai.video.propose`, `pay.payout.intent`, `video.creator`, `video.read`

The callback currently recorded in the repository registry is an integration candidate. It is not evidence that DNS, central registration or public routing exists.

### Role boundary

- Owner: team administration, full content control, analytics/revenue view and payout intent.
- Editor: content metadata/publish, rights declaration and bounded AI proposal.
- Uploader: upload/assets/processing retry and bounded AI proposal.
- Analyst: analytics only.
- Finance: analytics/revenue and dispute only; no payout redirection.
- Moderator: local content moderation/appeal operations; not global rights verification.
- Viewer: team-restricted read only.

Owner cannot be delegated. Team identities must be canonical YNX Wallet accounts. Role changes/revokes advance channel authorization version; persisted membership is checked on every request.

### Rights boundary

Public/unlisted publication requires an active declaration whose source SHA-256 equals the uploaded media SHA-256. Contributor splits use canonical Wallet accounts and total 10,000 basis points. Creator/owner self-review is rejected. Commercial eligibility and revenue require independent verified rights. Expiry, rejection or lineage mismatch removes audience access.

### Analytics boundary

Analytics reads now expose `source=ynx.creator-studio.persisted-events`, `version=analytics.v1`, UTC `as_of`, authorization-bounded channel/video/event coverage, unique-user count and completed-view count. Viewer account identities are not returned. Editors receive no analytics, Analysts receive usage without revenue, and Finance access remains separately authorized. This is local persisted-event provenance, not central Data Fabric acceptance or public audience evidence.

### Revenue boundary

Revenue is recorded only through an injected authoritative receipt verifier, approved monetization, independently verified rights and unallocated usage evidence. The channel owner remains the revenue/payout owner. A Finance team member may dispute evidence but cannot create a payout intent for itself. Local Testnet/loopback records have no asserted real-world value.

### AI boundary

AI may prepare and run suggestions, stream output and await explicit review. It cannot publish, assert rights, record revenue, create payout, delete unrelated data or change team authority automatically.

## Current verification

Green product-owned gates:

- Creator Web `npm run check` and `npm run smoke`
- Go package unit/HTTP/migration/restore tests
- Go race and vet
- Repository-owned media real FFmpeg HLS processing
- Backup/restore integrity and traversal-negative tests

The local ClamAV process smoke is not green: the installed daemon configuration does not parse and the local signature database is absent. The runtime remains fail closed. No mock scanner is substituted.

Full-repository preflight also has failures outside Creator Studio ownership: consensus transaction key permission, faucet key permission, trust gateway signer permission and missing SampleEVMWriteCounter artifacts. These must be closed by their owners before final repository release.

## Merge order requested from YNX 29

1. Freeze Wallet tuple, exact scopes, machine error codes and request-attestation version.
2. Freeze Data Fabric creator usage/cost/revenue/refund/dispute event schemas.
3. Accept Pay receipt/payout/refund vectors and Trust rights/takedown/appeal vectors.
4. Add Monitor correlation/metrics and Explorer/public-evidence references.
5. Run shared signed Testnet E2E, including all negative vectors.
6. Pass Security/SRE scanner, backup, SBOM/provenance, artifact and release gates.
7. Permit Website to consume metadata and deploy the product page.
8. Permit public runtime deployment only after the preceding evidence remains bound to the deployed source commit.

## Acceptance response format

Each owner should return:

- Owner/product name
- Accepted contract/schema version
- Accepted source commit
- Central integration commit
- Executed vector IDs
- Raw evidence path or immutable public evidence reference
- Remaining blockers and recovery conditions

Until that response exists, `integratedCentral`, `deployedStaging`, `deployedPublic`, `downloadHosted`, `productionSigned` and `storeReleased` remain false.
