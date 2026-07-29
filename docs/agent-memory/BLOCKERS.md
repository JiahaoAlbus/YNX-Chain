# Blockers — YNX 21 Bridge

These blockers do not prevent local engineering or unsigned candidate packaging. They prevent executable Testnet asset movement and final product completion.

## BRIDGE-EXT-001 — Approved executable route

- Owner: `29-integration`, `31-governance`, Provider owner
- Reason: No approved Provider or proof-based YNX route exists.
- Evidence: Runtime status reports `officialStablecoinRouteAvailable=false`, `externalSubmissionEnabled=false` and `userAssetMovementEnabled=false`.
- Preparation complete: Provider Registry, official CCTP Sandbox observation, route adapter, fail-closed lifecycle, proof and availability gates.
- Why autonomous resolution is impossible: Route approval changes cross-chain trust, contracts, custody and governance semantics.
- Minimum external input: Versioned route decision, provider agreement status, supported chains/assets and approval authority.
- Resume condition: Accepted route contract bound to source commit and shared Testnet version.
- First action after input: Encode the approved route and contract metadata with fail-closed tests before enabling any submission path.

## BRIDGE-EXT-002 — Contracts, signer custody and funding

- Owner: `01-chain-core`, `02-wallet-auth`, `30-security-sre`, Treasury/operator
- Reason: Verified source/destination contracts, production signer ceremony, funded gas and funded assets are absent.
- Evidence: No accepted contract addresses, HSM/MPC ceremony or funded transfer receipts exist.
- Preparation complete: Relayer threshold verification, key-lifecycle boundary, limits, pause, reconciliation, backup and recovery controls.
- Why autonomous resolution is impossible: Requires keys, custody, funds and irreversible deployment authority.
- Minimum external input: Verified contract manifests, signer custody evidence, funded operator addresses and deployment authorization.
- Resume condition: Inputs pass Security/SRE and Integration acceptance.
- First action after input: Run configuration validation, deploy to isolated Testnet staging and execute a zero-value/no-asset safety rehearsal before funded flows.

## BRIDGE-EXT-003 — Independent acceptance and public mutation authority

- Owner: `30-security-sre`, `29-integration`, `31-governance`
- Reason: Independent security acceptance and authority for public mutation routes are absent.
- Evidence: Public ingress exposes read-only paths only; mutation routes remain unavailable.
- Preparation complete: Threat model, security boundaries, observability, incident, migration, restore, rollback and release evidence.
- Why autonomous resolution is impossible: Independent review and governance approval cannot be self-attested by product owner 21.
- Minimum external input: Signed/versioned acceptance records and approved mutation exposure policy.
- Resume condition: Acceptance artifacts reference the exact release candidate and all required dependency versions.
- First action after input: Validate the candidate against shared Testnet vectors and expose only the specifically approved mutation scopes.

## BRIDGE-EXT-004 — Website product metadata acceptance

- Owner: `28-website`
- Reason: `/bridge` returns HTTP 200 but the fetched shell uses root canonical and generic site metadata.
- Evidence: `docs/bridge/website-handoff.json`.
- Preparation complete: Exact canonical, title, description, Open Graph, JSON-LD and truth-boundary handoff.
- Why autonomous resolution is impossible: Product 21 must not modify the Website owner Worktree.
- Minimum external input: Website acceptance receipt with merge commit, deployment commit and public route verification.
- Resume condition: Route-specific metadata is publicly observed on `ynxweb4.com/bridge`.
- First action after input: Re-fetch HTML and structured metadata, then record acceptance without changing asset-movement claims.
