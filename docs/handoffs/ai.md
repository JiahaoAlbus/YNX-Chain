# YNX AI handoff

## Delivery identity

- Branch: `codex/ecosystem-ai`
- Worktree: `/Users/huangjiahao/Desktop/YNX Chain AI`
- Starting point: `51bed843c5aa8dc53b2dc32b29cb8ca349ff0e95`
- Declared shared baseline: `271197feb48fd362292fb2210887edf3109ce4f7`
- Baseline note: the task branch was created from the current `main` tip because
  it contains the parallel-product objective, architecture, and integration
  contract. No rebase or merge was performed.
- Implementation commit: `5fa7e7795881e67cbf94d69a680726fc6e73fa0e`
- Delivery commit: the final pushed branch tip containing this handoff.

## Changed paths

- `apps/ai/**`: independent embedded Web client, product binary, environment
  contract, documentation, and product-local smoke command.
- `internal/aiproduct/**`: Wallet-bound auth, encrypted persistence, Gateway
  orchestration, conversation/data-control APIs, permissions/actions, usage,
  audit, appeals, cancellation, tests, and security headers.
- `docs/handoffs/ai.md`: this integration record.

No long-term goal, acceptance-state file, root `Makefile`, central AI Gateway
policy, or unrelated product path was changed.

## Architecture and complete workflow

`apps/ai` builds one Go binary with an embedded responsive Web client. Browser
code talks only to `internal/aiproduct`; the server alone holds the AI Gateway
access key. The product state is an atomic mode-0600 JSON file whose message
bodies are AES-256-GCM ciphertext authenticated with account, conversation, and
message identifiers. Conversation metadata, bounded retention policy, token
hashes, permission/action records, appeals, revocation state, and SHA-256-linked
audit records remain restart-persistent. Plaintext message previews are not
stored.

The implemented user workflow includes:

- Sign in with YNX Wallet using a five-minute single-use challenge bound to
  `ynx_6423-1`, `6423`, product `ynx-ai`, exact callback, device Ed25519 key,
  purpose, and exact least-privilege scopes. Both the native account
  secp256k1 signature and device signature are required. Sessions are hashed,
  scope-checked, rate-limited, expiring, and revocable.
- Conversation create, select, long-scroll, rename, archive/unarchive, delete,
  encrypted restart persistence, retry, copy, JSON export, and empty states.
- Provider-backed Gateway SSE, visible streaming, client and server cancel,
  generation timeout recovery, request-ID persistence, and retryable honest
  errors. Provider health failure creates no user or assistant message and never
  substitutes a canned/local answer.
- Current provider/model/status display. The current Gateway exposes exactly one
  configured model; attempts to request a different model fail. Quota remains
  explicitly `unknown` because the Gateway does not report it.
- Per-message and aggregate input/output token, resource, and optional money
  estimates. They are labeled estimates and `actualUsageReported=false`.
  Monetary cost stays unknown unless an operator supplies rate metadata.
- Context inclusion and exclusion, policy allowlisting, context conflicts,
  recovery-material exclusion notice, provider privacy boundary, 1-90 day
  retention, encrypted-body on/off policy, per-conversation deletion, account
  deletion, and session revocation.
- Tool, product-action, and chain-action proposals with exact scope,
  description, payload preview, separate scoped permission, approve/reject,
  permission history, and audit. Approval persists as
  `approved_not_executed`. Chain actions still require a separate YNX Wallet
  review/signature; this product contains no execution route.
- Usage, linked local audit chain, persistent Trust appeal records, and a Trust
  Center link.

## Security and truth boundaries

- No provider key, Gateway key, Wallet secret, recovery material, session token,
  or plaintext conversation body is present in Git or browser-delivered code.
- AI cannot sign, transfer, publish, send, change permissions, freeze, or bypass
  Wallet, Trust, product authorization, or explicit human review.
- Action approval is not action execution. No approved action is automatically
  dispatched by this product.
- Provider/model availability is derived from live Gateway `/health`; there is
  no fake provider catalog or success state.
- Quota and actual provider token/money usage are not claimed. Character-based
  token/resource estimates are visibly separated from actual usage.
- Account deletion removes conversations, encrypted content, local permissions,
  actions, appeals, and policy state, removes pending Wallet challenges, and
  revokes every local product session. The minimal deletion audit record remains
  for accountability.
- CSP, no-store, frame denial, referrer, MIME, permissions policy, strict JSON,
  input bounds, owner checks, scope checks, request rate limits, one-time
  challenges, low-S signature verification, atomic persistence, and authenticated
  encryption are enforced server-side.

## Verification evidence

Passed on 2026-07-15 in the isolated worktree:

```text
go vet ./internal/aiproduct ./apps/ai
node --check apps/ai/web/app.js
npm ci
npm run hardhat:build
npm run contracts:selectors
go test ./...
bash apps/ai/scripts/smoke.sh
make no-placeholder-check
make secret-scan
make env-check
git diff --check
```

The initial full-repository test run lacked ignored Hardhat artifacts. After the
lockfile install, pinned Hardhat build, and repository selector-metadata command,
`go test ./...` passed. `apps/ai/scripts/smoke.sh` passed focused auth, replay,
scope authorization, encrypted persistence/restart, provider success/failure,
no-canned-answer, context, deletion, tool/chain approval, cancellation, build,
cold-start, embedded UI, and metadata checks.

Interactive local browser verification covered:

- desktop width 1280 and mobile width 390 with no horizontal document overflow;
- Wallet request creation and complete account-plus-device proof sign-in;
- separate app shell, conversation workspace, long-message container, responsive
  mobile conversation drawer, privacy/review/audit surfaces;
- provider-unavailable presentation exactly as `Provider unavailable` and
  `No substitute answers` when no Gateway/provider was running.

No production deployment, app-store package, signed desktop/mobile artifact, or
successful production provider generation is claimed.

## Incomplete external items and exact integration requests

1. Accept Task 1's shared Sign in with YNX Wallet protocol and register the
   product ID, package/bundle ID `com.ynxweb4.ai`, callback
   `ynx-ai://com.ynxweb4.ai/auth/callback`, and the four YNX AI scopes. Replace
   this strict temporary compatible adapter only after that contract is merged.
2. Extend the central AI Gateway with a POST-body streaming route. Its current
   `GET /ai/stream?session=...&q=...` contract can expose prompts to intermediary
   URL logs even though Gateway audit stores only hashes. The client currently
   follows the existing contract and must be deployed over a controlled private
   hop until the central route is changed.
3. Add authenticated provider catalog/model capability, quota, provider token
   usage, resource charge, and monetary-cost metadata to the Gateway. Until then
   the client intentionally offers only the configured model and displays quota
   and actual cost as unknown.
4. Add a central permission-revoke endpoint. Current Gateway permissions are
   bounded to at most 24 hours; local product sessions/data are immediately
   revocable/deletable, but this branch does not invent a Gateway revoke route.
5. Supply an authenticated Trust appeal-create API contract if appeals should be
   submitted remotely. This branch persists the appeal, audit, and Trust deep
   link without claiming remote case creation.
6. Supply production environment values and deployment authority through the
   existing intake process. Required inputs are the absolute mode-restricted
   state path, 32-byte content key, private Gateway URL/key, exact Wallet
   callback, Trust URL, provider display name, and optional estimate rates.

These are central integration or external-operation items and were not worked
around with synthetic behavior.
