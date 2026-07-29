# YNX Video integration handoff

## Frozen product boundary

YNX 33 owns Video service state, media processing, Viewer, Creator Studio and product-specific integration adapters. It does not own Wallet identity/session issuance, Pay settlement, Trust case authority, canonical event billing, central integration freeze, public deployment or production signing.

Source commit: `cbf35c029acb14011f4bb25e7b230e4d1fbbbd8e`.
Contract: `release/integration/video-contract.json` (`ynx-video-integration-v2`).
Wallet registry request: `internal/video/integration/registry-v2.json`.
Gateway manifest: `internal/video/integration/appgateway-video-manifest.json`.

## Media integrity contract

Every persisted media variant carries its byte count, SHA-256 and explicit `original` or `derivative` lineage. Derivatives bind to the original object key and original SHA-256. The covered adaptive set is the HLS playlist, every HLS segment and the original fallback. State schema v2 backfills legacy records by rehashing stored objects; a missing or unverifiable legacy asset makes the video private and failed.

## Required owner actions

- YNX 02: accept the three exact product registrations and Product Session scopes without wildcard widening.
- YNX 04: expose Wallet-approved Pay intent and authoritative paid-settlement receipt fields used by Video revenue allocation.
- YNX 15: freeze a delegated per-user creator appeal route; Video must not sign as the creator.
- YNX 26: accept versioned Video lifecycle, media-integrity, watch-consent, subscription, report and paid-settlement events.
- YNX 29: run the cross-product vectors and freeze the single accepted versions.
- YNX 30: validate security, artifact provenance, deployment and public status evidence.

## Fail-closed rules

A missing or invalid Product Session, replayed nonce, changed request body, wrong product/bundle/callback/device/scope, expired rights declaration, unavailable scanner, missing derivative, asset digest mismatch, absent authoritative Pay receipt or absent delegated Trust signer must remain an explicit unavailable/failure state. No adapter may manufacture success.

## Local verification

The following passed against source commit `cbf35c029acb14011f4bb25e7b230e4d1fbbbd8e`:

- `go test ./internal/video/...`
- `go test -race ./internal/video/...`
- `go vet ./internal/video/...`
- `npm --prefix apps/video run check`
- `npm --prefix apps/video run smoke`

## Release truth

Local implementation, tests and historical debug/simulator installation evidence exist. No GitHub Actions run or PR currently exists for `codex/final-video`. Central integration, shared-testnet execution, staging/public deployment, hosted downloads, production signing and store release remain false until independently evidenced.
