# YNX Docs Decisions

## D-001 — Preserve the existing Cloud-backed Docs runtime

YNX Docs remains an independent product surface while reusing the shared `internal/cloud` storage service. Product authorization is enforced at the HTTP boundary; Cloud sessions must not enumerate, read, mutate, share, audit or submit Docs content to AI.

## D-002 — Production Web login is Wallet-only

The production entry is `apps/docs/web/app-secure.js`. The prior loopback development-signature path is no longer reachable from the product bundle. Recovery keys and substitute long-lived browser credentials are not accepted.

## D-003 — Current collaboration primitive is server-serialized revision

The implemented primitive is optimistic `baseVersion` save with deterministic conflict rejection and explicit offline/manual recovery. This is an implementation state, not the final bake-off decision. CRDT and OT are not claimed as implemented.

## D-004 — Duplicate is a new owned object, not a permission clone

A duplicate copies the visible untrashed subtree and current object bytes only. It resets version numbering, ownership and timestamps, and does not copy ACLs, comments, links or trash state. Persistence failure rolls back the complete in-memory mutation.

## D-005 — Comment anchors bind exact text and exact version

Anchors are rune ranges with server-derived quote verification. Replies join a root thread; resolved threads reject new replies until reopened.

## D-006 — Export evidence is two-hash evidence

Every supported export records the source object hash and the produced export hash. HTML export escapes document text. Supported local formats are Text, Markdown, HTML and JSON; PDF is not claimed.

## D-007 — State schema v2 is a forward migration

Version 1 state is integrity-checked before migration. Existing comments receive `threadId=id`; migrated state is persisted as schema v2. Rollback migration remains unimplemented.

## D-008 — Trust payload fields are explicit

`actor`, `action`, `objectId` and `hash` have distinct JSON tags. Evidence does not contain document plaintext and does not imply public or on-chain verification.

## D-009 — Out-of-scope central failures remain visible

Full-repository failures in consensus, Devtools contract artifacts, faucet and Trust signer permissions are recorded but not modified from the Docs worktree. Targeted Docs gates must stay green while central owners repair their modules.
