# YNX Docs Integration Handoff

## Identity

- Product: YNX Docs
- Owner: YNX 35
- Runtime source commit: `5d04c144987fd35d09925db72bd882719a2e7df9`
- Candidate contract: `release/integration/docs-contract.json`
- Test vectors: `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`
- Current phase: PROTECT, requesting FREEZE review
- Product status: ACTIVE

## Runtime delivered locally

The current runtime provides Wallet-gated Web/mobile entry, document/folder listing and creation, deterministic optimistic autosave, offline draft recovery, explicit conflict handling, rename/move/duplicate, version history and restore, comments with exact-version anchors and thread resolution, permission/link/access-request services, versioned Text/Markdown/HTML/JSON export with two-hash evidence, bounded AI review, persisted audit/Trust adapters, and an offline operator backup/restore drill that verifies state and object hashes while excluding sessions, nonces and presence.

The service is implemented in `internal/cloud` but YNX Docs remains a separate product. HTTP authorization enforces the product boundary: Cloud sessions cannot read or mutate Docs objects, folders containing Docs cannot be moved/copied/shared by a Cloud session, Docs audit events are filtered from Cloud, and Cloud cannot submit Docs content to AI.

## Required central freezes

### YNX 02 — Wallet/Auth

Accept the exact Web and mobile tuples and required scopes recorded in the contract. Execute replay, wrong product/client/bundle/callback/chain/device, scope widening, expiry and revoke vectors. No wildcard scope or long-lived browser credential is allowed.

### YNX 20 — Cloud/Object Store

Accept the object/version/hash/owner/ACL/retention/delete/restore semantics. Document plaintext and export bytes remain off-chain. Provider failure must be explicit; no static green health or fallback content is allowed.

### YNX 14 — AI Gateway

Accept selected-version-only context, explicit consent, provider/model/cost status, cancel, preview and approve/reject. AI may draft but cannot overwrite, share or delete a document without user action.

### YNX 15 — Trust

Accept the evidence envelope with distinct `actor`, `action`, `objectId`, `hash`, `at` and `details`. Trust evidence must not contain plaintext or claim public/on-chain verification until a real accepted receipt exists.

### YNX 26 — Data Fabric

Freeze canonical event names and idempotency/billing fields. Store no document plaintext in the ledger. Billing must use disclosed provider/compute/storage/export units only.

### YNX 12/13 — Explorer/Monitor

Define how version/save/export/permission evidence, health, ready, version, alerts and incident state are surfaced without exposing document content or internal paths.

### YNX 29 — Integration

Review conflicts, freeze exactly one contract version and schedule the shared Testnet sequence. Do not silently support divergent permanent scope/event/error definitions.

### YNX 30 — Security/SRE/Release

Review and accept the local backup schema and restore drill, then provide artifact, SBOM, provenance, signing and deployment gates. The backup is local integrity evidence only: it is not encrypted, signed, off-site or production-durable. Local Expo exports are not hosted or signed release artifacts.

### YNX 28 — Website

Consume `public-product-metadata.json` only after freeze. The `/docs` page may be published independently of the Runtime; `websitePublished` and `deployedPublic` must remain separate.

## Shared Testnet sequence

1. Wallet approval and product session.
2. Create folder and document.
3. Edit and autosave version 2.
4. Disconnect, edit offline and advance the server from another client.
5. Reconnect and prove no silent overwrite.
6. Save a recovered local copy or accept the server version.
7. Create anchored comment, reply, resolve and reopen.
8. Restore version 1 as a new version.
9. Grant viewer/editor access, create expiring link, revoke both and verify denial.
10. Export exact versions in all supported formats and reconcile source/output hashes.
11. Run AI on one selected version, reject one result and approve one result after preview.
12. Restart the service and verify state/object bytes/audit integrity.
13. Record Trust/Data Fabric/Explorer/Monitor evidence.
14. Repeat core operations from native Android/iOS builds.

## Known blockers and non-claims

- No central owner has accepted the candidate contract.
- No shared Testnet or public Runtime probe has run.
- No PDF export is claimed.
- No device install, cold-start, production signing or store release is claimed.
- No retained hosted artifact, SBOM or provenance exists yet.
- Local backup/restore is verified, but off-site durability, encryption, signing and an accepted operational RPO remain unproven.
- Full repository `go test ./...` remains blocked by central failures outside YNX 35; targeted Docs gates are green.

## Merge requirement

Central integration must preserve source commit attribution and product boundaries. Any change to the Wallet tuple, scopes, event names, error codes, state schema or release truth flags requires an explicit new contract version and migration plan.
