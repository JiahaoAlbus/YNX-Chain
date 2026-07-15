# YNX Cloud & Docs handoff

## Branch and baseline

- Branch: `codex/ecosystem-cloud-docs`
- Implementation commit: `efc360ff3bd32e337febfcbdf19c0aa7012412ff`
- Worktree baseline: `51bed84` (`main` at task launch), which descends from the
  declared shared baseline `271197f` and adds the parallel product objectives.
- No merge to `main`, deployment, public availability, unlimited storage, or
  production durability is claimed.

## Changed paths

- `apps/cloud/**`: standalone Cloud Web product, local daemon entrypoint, product
  checks, client test and smoke command.
- `apps/docs/**`: standalone Docs Web product, autosave/conflict/offline client,
  product check and client test.
- `internal/cloud/**`: persistent domain service, content-addressed blob store,
  strict authenticated HTTP API, security interfaces and tests.
- `docs/handoffs/cloud-docs.md`: this integration record.

No long-term goal, acceptance state, root `Makefile`, central Gateway policy or
another product path was changed.

## Architecture

`ynx-cloudd` serves two separate clients at `/cloud/` and `/docs/` over one
bounded storage/permission service. Cloud and Docs use distinct Wallet client
bindings, callbacks and scope allowlists:

- Cloud: `com.ynx.cloud.web`, `/cloud/auth/callback`
- Docs: `com.ynx.docs.web`, `/docs/auth/callback`

The service accepts only `ynx_6423-1` assertions with a canonical `ynx1...`
account, five-minute maximum expiry, device public key, exact product/client/
callback/scopes and a persisted one-time nonce. Session tokens are returned once;
only their hashes are persisted. The default Wallet verifier fails closed. The
`-dev-wallet` adapter accepts a fixed test assertion only on a loopback listener.

File bodies and document versions remain off-chain in SHA-256 content-addressed
objects. Metadata is written atomically with a full-state integrity digest and
mode `0600`; every download re-hashes the blob. Chain-facing product language is
limited to identity, permissions, hashes or settlement evidence. No large body is
sent to the chain.

The object model covers files, folders, safe upload/download/text preview,
search, recent, starred, trash/restore, immutable versions, version restore,
physical version-aware quota, IndexedDB offline upload queue/sync, explicit
owner/editor/viewer permissions, inherited folder grants, expiry, revocation,
time-bounded view links, access requests/approval, audit and recovery.

Docs adds create/edit, optimistic `baseVersion` autosave, immutable history,
version-bound comments and mentions, 45-second bounded presence, local text
export, device-local offline drafts and a two-pane conflict recovery flow. A
stale offline draft never overwrites a newer server version.

## AI-native workflow

Cloud supports selected-file summary, citation-grounded answer and folder-plan
proposal. Docs supports selected-version drafting/revision. Both show the exact
object/version context, provider/model status and estimated resource units,
require explicit consent, expose queued/running/cancel status, return citations,
require apply/reject review and persist audit events. The default provider is
honestly unavailable; no canned response is substituted. Client-encrypted
objects are rejected from AI context.

AI cannot enumerate the drive, read an unselected version, share, delete or
overwrite. Applying a Docs result only places it into the local editor as a dirty
draft; normal version-aware autosave still controls persistence.

## Security and recovery boundaries

- Upload maximum: 8 MiB per object; account quota defaults to 64 MiB and counts
  unique physical blobs across retained versions, including trashed objects.
- Default malware boundary: scanner interface plus extension/MIME policy and
  EICAR rejection. This is not represented as a production antivirus service.
- Client encryption metadata accepts only `AES-256-GCM` with an explicit,
  user-held recovery policy. The service stores ciphertext and has no key or
  silent recovery capability.
- Strict JSON parsing, body bounds, exact methods, CSP/security headers, bearer
  authorization, role checks, link expiry/revocation, nonce replay rejection,
  immutable hashes and audit records are enforced server-side.
- Interrupted queued/running AI jobs fail on restart and require fresh consent.
- Local state is deterministic across restart. It is bounded engineering storage,
  not multi-region, backed-up or production-durable infrastructure.

## Verification

Passed on 2026-07-15:

```text
go test ./internal/cloud ./apps/cloud/cmd/ynx-cloudd
  ok internal/cloud
  ynx-cloudd: no test files

npm --prefix apps/cloud test
  1 passed
npm --prefix apps/cloud run check
  YNX Cloud static, accessibility and product-boundary checks passed

npm --prefix apps/docs test
  1 passed
npm --prefix apps/docs run check
  YNX Docs static, accessibility and recovery checks passed

bash apps/cloud/scripts/smoke.sh
  YNX Cloud & Docs smoke passed

npm run hardhat:build
npm run contracts:selectors
go test ./...
  passed (all packages; generated artifacts remain ignored)

make secret-scan
  secret scan passed
make env-check
  env templates present; real deployment env values remain external
make no-placeholder-check
  no disallowed deployment filler found

git diff --check
  passed
node --check apps/cloud/web/app.js
node --check apps/docs/web/app.js
  passed
```

Focused Go tests cover persistence/restart, object tamper detection, physical
quota, scanner rejection, client-encrypted AI exclusion, folder permission
inheritance, grant revocation, access approval, link expiry/revocation, Wallet
nonce replay, version conflicts, version restore, comments, AI review and strict
HTTP authorization/parsing. Client checks cover offline queue/draft recovery,
conflict handling, Wallet isolation, AI consent and reduced-motion/accessibility
markers.

Chrome visual inspection was performed at 1440x1000 and 390x844. The first
390px Cloud pass exposed horizontal overflow; `apps/cloud/web/mobile.css` was
added to constrain the top bar, navigation and workspace. Screenshots were kept
outside Git because they are local verification evidence rather than release
artifacts.

## Honest incomplete and external boundaries

- Main integration must supply the reviewed Task 1 Wallet assertion verifier.
  Without it, normal sign-in fails closed; only the explicit loopback smoke
  verifier exists.
- Main integration must supply a permissioned YNX AI Gateway adapter and provider
  credentials server-side. Without it, UI and API report provider unavailable.
- Production object storage, replicated metadata, backup/restore drills,
  independent malware scanning, KMS/HSM recovery, retention/legal policy,
  measured capacity/SLOs, deployment and independent audit do not exist here.
- No chain anchoring writer is added. If the main task chooses to anchor an object
  hash or permission evidence, it must add a reviewed bounded intent; file and
  document bodies must remain off-chain.
- No native mobile/desktop package or public deployment is claimed by this Web
  product branch.

## Exact main-task integration requests

1. Review and register the two exact Wallet client bindings/callbacks/scopes
   above, then inject a `cloud.WalletVerifier` backed by the accepted Task 1
   protocol. Do not enable `-dev-wallet` outside loopback smoke.
2. Add a server-side `cloud.AIProvider` adapter to the accepted YNX AI Gateway,
   preserving selected object/version context, cancel propagation and audit.
3. Decide the deployment-specific persistent object/metadata/backup/AV/KMS stack
   before changing durability language.
4. Add central routing, service supervision, release checks and public docs only
   after reviewing this branch; the product task intentionally did not modify the
   root `Makefile` or central Gateway policy.
