# YNX Video integration handoff

## Frozen product boundary

YNX 33 owns Video service state, media processing, Viewer, Creator Studio and product-specific integration adapters. It does not own Wallet identity/session issuance, Pay settlement, Trust case authority, canonical event billing, central integration freeze, public deployment or production signing.

Source commit: `11e64797c64cd64d1c6e53f0295c17997bde6f97`.
Contract: `release/integration/video-contract.json`.
Wallet registry request: `internal/video/integration/registry-v2.json`.
Gateway manifest: `internal/video/integration/appgateway-video-manifest.json`.

## Required owner actions

- YNX 02: accept the three exact product registrations and Product Session scopes without wildcard widening.
- YNX 04: expose Wallet-approved Pay intent and authoritative paid-settlement receipt fields used by Video revenue allocation.
- YNX 15: freeze a delegated per-user creator appeal route; Video must not sign as the creator.
- YNX 26: accept versioned Video lifecycle, watch-consent, subscription, report and paid-settlement events.
- YNX 29: run the cross-product vectors and freeze the single accepted versions.
- YNX 30: validate security, artifact provenance, deployment and public status evidence.

## Fail-closed rules

A missing or invalid Product Session, replayed nonce, changed request body, wrong product/bundle/callback/device/scope, expired rights declaration, unavailable scanner, absent authoritative Pay receipt or absent delegated Trust signer must remain an explicit unavailable/failure state. No adapter may manufacture success.

## Release truth

Local implementation, tests and historical debug/simulator installation evidence exist. Central integration, staging/public deployment, hosted downloads, production signing and store release remain false until independently evidenced.
