# Blockers

Updated: 2026-07-29T02:39:00Z

These blockers do not prevent the next autonomous artifact-packaging slice.

## SHOP-EXT-001 — Wallet/Auth registry deployment

- Owner: 02 Wallet/Auth, then 29 Integration.
- Reason: canonical Gateway does not yet evidence the exact Shop product registry tuple.
- Evidence: `internal/commerce/integration/shop-registry-v2.json`; `docs/integration/DEPENDENCY_ACCEPTANCE.md`.
- Prepared: exact client, bundle, callback, ordered scopes, device algorithm and negative vectors.
- Why Shop cannot resolve it: Shop must not modify another product worktree or deploy central Gateway authority.
- Minimum input: deployed Gateway build/commit and accepted registry tuple, followed by a positive and negative product-session test window.
- Resume action: execute Shop Wallet challenge/session/introspection vectors against the accepted build.

## SHOP-EXT-002 — Pay merchant and payout

- Owner: 04 Pay, then 29 Integration.
- Reason: no approved Shop Testnet merchant ID and canonical payout address are provisioned.
- Evidence: `release/integration/ynx-shop-contract.json`; `docs/integration/DEPENDENCY_ACCEPTANCE.md`.
- Prepared: strict settlement/refund adapter and mismatch/replay tests.
- Why Shop cannot resolve it: Shop must not invent a merchant, payout address, signer, or service key.
- Minimum input: approved Shop Testnet merchant reference, payout address and accepted Pay evidence version through the operator path.
- Resume action: run committed payment, refund, replay and mismatch vectors without exposing credentials.

## SHOP-EXT-003 — Current native build hosts

- Owner: approved Android/iOS build environment or 30 Security/SRE.
- Reason: current host lacks a configured Android SDK path and full Xcode/Simulator.
- Prepared: Android/iOS source, static contracts, localization and CI workflow.
- Minimum input: current-source API 36 Android build environment and full Xcode Simulator environment.
- Resume action: build/install/cold-start/restart/deep-link both current-source native products and record exact artifacts.

## SHOP-EXT-004 — Shop-specific public page and deployment

- Owner: 28 Website after 29 Integration/30 Security-SRE handoff.
- Reason: historical Staging routes return 404; `/shop` serves a generic SPA shell with homepage canonical.
- Prepared: public metadata, integration handoff, truthful status and website requirements.
- Minimum input: accepted current artifact/release metadata and Website deployment authority.
- Resume action: publish a Shop-specific page with canonical, JSON-LD, sitemap, Open Graph, status/support/security/privacy and exact release evidence, then verify content rather than status code alone.

## SHOP-EXT-005 — Production approval

- Owner: Founder/authorized signing, legal, custody, Security/SRE and store accounts.
- Reason: production signing, provider agreements, legal approval, audit and store submission require external authority.
- Prepared: testnet product boundaries, signing restrictions, security/privacy documentation and artifact requirements.
- Minimum input: approved production keys/accounts/agreements through secure operator channels, never in repository or chat.
- Resume action: execute the corresponding production ceremony and record non-secret evidence.
