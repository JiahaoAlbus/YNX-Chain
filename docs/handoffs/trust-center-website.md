# YNX Trust Center Website Handoff

## Ownership and canonical identity

- Product owner: `15-trust-center`
- Consumer owner: `28-website`
- Product: YNX Trust Center
- Product slug: `trust-center`
- Canonical route: `https://ynxweb4.com/trust-center`
- Product repository: `https://github.com/JiahaoAlbus/YNX-Chain`
- Source branch: `codex/final-trust-center`
- Source-bound preview commit: `1baeccada8e72eab8277803973d0e598dcf19b51`

`ynxweb4.com` is the only canonical YNX product domain. `huangjeo.com` is not a YNX product, release, documentation, status or support domain. Legitimate `mcpXX.huangjeo.com` service addresses are unrelated to this website handoff and must not be rewritten.

## Publishable product statement

YNX Trust Center is the YNX Testnet product for request validity, bounded sourced evidence, independent human review, appeals, corrections and aggregate transparency. It cannot freeze, seize, blacklist, confiscate or transfer native YNXT. AI may explain selected evidence or draft an appeal, but it cannot decide, punish, label or mutate a case.

## Current release truth

- `implementedLocal`: true
- `testedLocal`: true
- `installedLocal`: true
- `downloadHosted`: true
- `integratedCentral`: false
- `deployedStaging`: false
- `deployedPublic`: false
- `productionSigned`: false
- `storeReleased`: false

The hosted asset is an unsigned Linux amd64 Testnet preview. It is not a production service, mainnet release, notarized binary, mobile-store package or independently attested production artifact.

## Hosted preview

- Release: `trust-center-v0.1.0-testnet-preview.1`
- Release evidence: `https://github.com/JiahaoAlbus/YNX-Chain/releases/tag/trust-center-v0.1.0-testnet-preview.1`
- Archive: `ynx-trust-center-1baeccada8e7-linux-amd64.tar.gz`
- Download: `https://github.com/JiahaoAlbus/YNX-Chain/releases/download/trust-center-v0.1.0-testnet-preview.1/ynx-trust-center-1baeccada8e7-linux-amd64.tar.gz`
- SHA-256: `92805078f0a8daebc1e329a293e625d161b600c70371d4cfb7a2ed57e47d1850`
- Bytes: `4526557`
- Signing class: `unsigned-local`
- Successful workflow: GitHub Actions run `30416831778`

The release also hosts `artifact-manifest.json`, `bom.cdx.json`, `provenance.json`, `verification.json`, `SHA256SUMS` and `THIRD_PARTY_NOTICES.txt`.

## Website content inputs

Authoritative machine-readable input:

- `public-product-metadata.json`
- `product-release.json`
- `release/integration/trust-center-contract.json`

Required page sections:

1. direct product answer and due-process boundary;
2. feature summary for evidence, validity, review, appeal, correction, export and transparency;
3. Testnet-preview status banner;
4. exact hosted archive checksum and unsigned status;
5. FAQ explaining that Trust Center cannot control YNXT and AI cannot decide cases;
6. explicit central-integration, public-deployment and production-signing limitations;
7. links to release evidence, SBOM, provenance, verification and notices.

## SEO and structured-data requirements

- Canonical: `https://ynxweb4.com/trust-center`
- Title: `YNX Trust Center | Evidence, Appeals and Transparency`
- H1: `Evidence and due process, without hidden asset control`
- Structured data candidates: `SoftwareApplication`, `WebApplication`, `FAQPage`
- Application category: `SecurityApplication`
- Operating systems: `Web, Linux, Android, iOS`
- Sitemap, robots, Open Graph and JSON-LD must point only to `ynxweb4.com` product URLs.

Do not expose local paths, branch names, MCP hosts, private infrastructure, unavailable support routes or production claims in public metadata. Do not publish support, privacy, security or status URLs until those public routes actually exist.

## Acceptance evidence required from 28 Website

Return all of the following before product 15 may set `deployedPublic=true`:

- Website repository source commit and deployed Vercel commit;
- successful deployment record;
- live `https://ynxweb4.com/trust-center` HTTP status and content proof;
- canonical, Open Graph, robots, sitemap and JSON-LD validation;
- checksum and release-link equivalence with this handoff;
- mobile and desktop route screenshots;
- no `huangjeo.com` product canonical or handoff links;
- rollback evidence and exact unresolved blockers.

Creating or consuming this handoff does not itself prove website deployment.
