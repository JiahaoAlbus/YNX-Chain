# YNX AI blockers

Updated: 2026-07-29T02:55:12Z

These blockers do not prevent the autonomous migration, backup/restore, load, accessibility, or artifact-hardening slices listed in `NEXT_ACTION.md`.

## AI-BLK-001 — Central Wallet/Auth and Integration acceptance

- Owner: 02 Wallet/Auth and 29 Integration
- Reason: production sign-in and shared protocol claims require canonical registry/verifier acceptance and deployment.
- Evidence: `release/integration/ynx-ai-contract.json`, `docs/integration/INTEGRATION_HANDOFF.md`, and cross-product vectors exist; `integratedCentral=false`.
- Preparation complete: fail-closed production boundary, formal local vectors, registry entry, patches, and stable error contract.
- Why YNX 14 cannot solve it alone: the central registry, verifier, shared Testnet, and protocol freeze are owned outside this Worktree.
- Minimum external input: accepted contract/version, deployed endpoint/registry identifier, source SHA, and owner-signed acceptance evidence.
- Resume condition: central acceptance and deployment evidence is available.
- First action after input: run real Wallet login, revoke, replay, scope-escalation, device-binding, and callback-substitution vectors against the accepted deployment.

## AI-BLK-002 — Provider-backed staging and shared Testnet

- Owner: 29 Integration, 30 Security/SRE, and authorized Provider operator
- Reason: no authorized staging deployment, Provider credential/quota, or shared-Testnet endpoint exists.
- Evidence: local Provider success/failure fixtures pass; `generationLive=false`, `deployedStaging=false`, and `testnetVerified=false`.
- Preparation complete: Provider-neutral Gateway, POST-body SSE, cancel, quota/error truth, restricted-content guard, and readiness contract.
- Why YNX 14 cannot solve it alone: credentials, paid quota, network deployment, and shared environment authority are external.
- Minimum external input: secret-managed Provider configuration, immutable deployment SHA/URL, accepted Gateway registry, and test Wallet account.
- Resume condition: staging health and source SHA can be independently verified.
- First action after input: execute the full shared-Testnet matrix and capture Provider request IDs, Explorer/Monitor evidence, quotas, cancellation, audit, export, and deletion.

## AI-BLK-003 — Canonical billing and tokenomics receipts

- Owner: 17 Tokenomics and 26 Data Fabric/Billing Ledger
- Reason: actual Provider usage, fee split, burn/treasury semantics, correction, and receipt schemas are not frozen.
- Evidence: `apps/ai/UNIT_ECONOMICS.md`; `actualUsageReported=false` remains enforced.
- Preparation complete: estimates are labeled and unknown values remain unknown; canonical receipt requirements and negative cases are documented.
- Why YNX 14 cannot solve it alone: these are central economic facts owned by 17 and 26.
- Minimum external input: versioned schemas, registry identifiers, idempotency/correction rules, fee reconciliation rules, and test vectors.
- Resume condition: both owners publish accepted contracts and vectors.
- First action after input: implement the adapter and negative reconciliation tests without changing historical estimates into actuals.

## AI-BLK-004 — iOS runtime and production signing

- Owner: 30 Security/SRE and authorized Apple account holder
- Reason: the current host lacks a full Xcode/simctl environment; no production signing assets or store authority are available.
- Evidence: iOS source and runnable macOS workflow exist, but no passing Simulator or signed-release run is claimed.
- Preparation complete: native project, callback scheme, bundle ID, CI commands, locale/RTL checks, and hash step.
- Minimum external input: authorized macOS/Xcode runner for Simulator evidence; signing identity/profile only for signed delivery.
- Resume condition: the workflow can run on an approved host.
- First action after input: build, install, cold-start, restart, deep-link, RTL, dark, large-text, hash, and capture signing-class evidence.

## AI-BLK-005 — Public route, hosted downloads, release, and store delivery

- Owner: 28 Website, 30 Security/SRE, and release/store account holders
- Reason: no Vercel/public runtime, canonical `/ai` page evidence, immutable artifact hosting, production signing, or store release exists.
- Evidence: `apps/ai/product-release.json` truth flags remain false; no YNX AI GitHub Release was found.
- Preparation complete: public metadata, product release truth, Website handoff inputs, artifact hash/signing class, SBOM, and documentation.
- Why YNX 14 cannot solve it alone: website deployment, public DNS/runtime, release authority, production signing, and store accounts are external.
- Minimum external input: accepted Website handoff/deployment SHA, public URLs, artifact hosting destination, release authorization, and signing/store credentials where applicable.
- Resume condition: owner-controlled deployment/release channels are available.
- First action after input: verify page content, canonical/OG/JSON-LD/robots/sitemap, hosted hashes, support/privacy/security/status links, then update truth flags only from direct evidence.
