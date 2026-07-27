# YNX Explorer Integration Handoff

## Status

- Product owner: `12-explorer`
- Contract: `release/integration/explorer-contract.json`
- Contract status: source-bound candidate awaiting 29 Integration freeze
- Goal status: Active
- Stage: PROTECT
- Source commit: `eb3d19091feff85a7cdbc09c20ed06ed402c74a7`
- Public deployment: not claimed

## Implemented slice

The Explorer and Indexer now expose server-driven opaque cursor pagination for blocks and transactions. Cursors are versioned, HMAC authenticated, feed-bound and rejected when malformed, tampered, reused across feeds, unsupported or anchored to a record that is no longer retained.

The Explorer web client consumes the returned cursor rather than slicing a bounded dashboard snapshot. A first-page refresh invalidates later cached pages so a newly finalized block cannot silently create overlap or gaps in a previously cached continuation.

Canonical public evidence routes are:

- `/block/{height}`
- `/tx/{hash}`
- `/address/{address}`

Legacy `?kind={kind}&id={id}` links remain readable during migration. Search results resolve directly to the canonical route, and browser back/forward restores the evidence drawer.

## Canonical summary migration

The Go Explorer summary is authoritative:

- `rpcHeight`
- `indexedHeight`
- `syncLagBlocks`
- `network` as a network identity object
- `truthfulStatus`
- `lastCheckedAt`

The web client still reads the legacy `latestHeight`, string `network` and top-level `chainId` fields for old-client compatibility. New producers should not emit a second conflicting summary schema.

## Cursor security and operations

`YNX_INDEXER_CURSOR_KEY` is an optional secret reference for stable cursor validation across restarts. It must contain at least 32 bytes and must be supplied through the approved secret mechanism; it must not be committed or pasted into chat.

When the key is absent, the Indexer generates a process-scoped random key. In that mode, cursors issued before a restart expire and fail closed. `/health` and `/ynx/overview` expose `cursorPersistence` so operators and clients do not assume restart-stable pagination.

## Failure semantics

- Upstream Indexer HTTP 400 for cursor rejection maps to Explorer HTTP 400.
- Indexer outage or other upstream failure maps to Explorer HTTP 502, even when the request contains a cursor.
- No UI or HTTP 200 response is treated as evidence of chain finality without the corresponding authoritative record.

## Verification state

Passed against the current source:

- Explorer/Indexer Go suites and command packages;
- Explorer/Indexer Race tests;
- Explorer/Indexer binary build;
- `npm test`: 14 tests;
- production web build;
- accessibility contract: 1 test;
- Playwright desktop/mobile: 10 tests;
- disposable local-Testnet Indexer resume/metrics smoke;
- disposable local-Testnet Explorer API/search/metrics smoke;
- Explorer npm audit: 0 vulnerabilities;
- Explorer product security scan: 36 source and release files.

Repository-wide `go test ./...` remains red only in other-owner key-permission and Hardhat selector-metadata paths. Root Hardhat tooling reports three High advisories through `adm-zip` with no npm fix; these packages are not shipped by Explorer.

See `product-release.json` for the exact truthful release status.

## Consumer actions

### 29 Integration

Freeze `explorer.integration.v1`, especially:

- canonical Summary field ownership;
- `invalid_cursor` versus `upstream_unavailable` semantics;
- public evidence envelope requirements;
- final public Explorer origin.

### 30 Security / SRE / Release

Provide the approved secret reference and rotation/runbook pattern for `YNX_INDEXER_CURSOR_KEY`, plus artifact provenance and public deployment controls.

### 28 Website

Consume the canonical deep-link routes and product metadata. Do not index query-string legacy routes as canonical pages.

### Data owners

Chain Core, Economics, Oracle, Data Fabric, Exchange, DEX and Quant must provide source/version/asOf/stale/coverage facts. Explorer will not derive or invent missing prices, PnL, solvency, revenue, TPS or finality.

## Next engineering action

Create and push the reviewed checkpoint, bind this contract and its evidence to the resulting source commit, then proceed to the next highest-priority uncovered runtime requirement: versioned public evidence envelopes with explicit source/as-of/version/stale/coverage/correction fields.
