# Blockers

## RM-BLOCK-001 — Central integration acceptance

- Owner: Products `02`, `01`, `26`, `12`, `13`, `15`, coordinated by Product `29`
- Reason: Resource Market cannot authoritatively own Wallet/Auth, Chain settlement, Billing Ledger, Explorer, Monitor, or Trust services.
- Evidence: `docs/integration/INTEGRATION_HANDOFF.md`, `docs/integration/DEPENDENCY_ACCEPTANCE.md`, `release/integration/resource-market-contract.json`
- Prepared: frozen contract, schemas, adapters, negative vectors, fail-closed local implementation and passing CI
- Minimum external input: central acceptance/merge target and deployed Testnet endpoints tied to an approved source SHA
- Recovery condition: central routes are deployed and the supplied vectors can be executed
- First action after recovery: run the central contract and replay/overflow/failure vectors against deployed services

## RM-BLOCK-002 — Independent Testnet providers and funded settlement

- Owner: Resource provider operators and Testnet asset/custody owner
- Reason: local fixtures cannot prove independent provider operation or authoritative asset settlement.
- Evidence: `apps/resource-market/operator-inputs.request.json`
- Prepared: provider lifecycle, matching, capacity, metering, failure, retry, refund, bond and appeal paths are locally tested
- Minimum external input: two approved independent provider endpoints/identities, approved secret-manager references, and a funded bounded Testnet account/signer path
- Recovery condition: providers and settlement path pass health, identity and source-SHA checks
- First action after recovery: execute the complete success and failure/recovery sequence and persist receipts

## RM-BLOCK-003 — Public deployment and website closure

- Owner: Product `28` Website and deployment/DNS owner
- Reason: Product `16` must not directly modify the Website worktree or claim a generated handoff is deployed.
- Evidence: `apps/resource-market/public-product-metadata.json`, `apps/resource-market/product-release.json`
- Prepared: canonical route `/resource-market`, public metadata, risk text and FAQ contract
- Minimum external input: accepted Website handoff, deployed HTTPS service origin, DNS/public route ownership and remote health/version endpoints
- Recovery condition: `https://ynxweb4.com/resource-market` serves the approved content and remote indexability checks pass
- First action after recovery: run content, canonical, robots, sitemap, Open Graph, JSON-LD and remote smoke verification

## RM-BLOCK-004 — Production signing and professional review

- Owner: Product `30`, custody/signing owner, legal/security reviewers
- Reason: production keys, irreversible signing authority, store accounts and professional approvals are external controlled inputs.
- Evidence: `apps/resource-market/operator-inputs.request.json`
- Prepared: unsigned candidate build, hashes, SBOM path, notices, threat model and review packet
- Minimum external input: approved secure signer references, public certificate chain, named legal/security reviewers and artifact-host approval
- Recovery condition: signed artifacts and review records bind the exact candidate source and digest
- First action after recovery: verify signatures, provenance, review scope and immutable hosted bytes before changing release states
