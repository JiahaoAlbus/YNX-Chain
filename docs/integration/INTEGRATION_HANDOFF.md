# YNX AI Integration Handoff

## Identity

- Product: YNX AI (`14-ai`)
- Worktree: `/Users/huangjiahao/Desktop/YNX Final Worktrees/14-ai`
- Branch: `codex/final-ai`
- Runtime source commit: `2678a8b0cf3f9463ec7fc205caab486993bf5f18`
- Evidence checkpoint: `b066b65aac8c8b197ab9b38659e937e73544daf1`
- Contract: `release/integration/ynx-ai-contract.json`
- Cross-product vectors: `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`

## Frozen product boundary

YNX AI is a constrained advice, drafting, explanation, research, preview, and proposal layer. It does not sign, pay, refund, trade, swap, withdraw, issue or freeze cards, publish or send content, delete external data, change permissions or risk, mint or burn, execute Treasury or Governance, alter consensus, or perform rollback.

Tool approval ends in `approved_not_executed`. Chain actions retain a separate Wallet review and signature boundary.

## Wallet/Auth dependency

Owner: `02-wallet-auth`.

The accepted tuple must be exact:

- Product client: `ynx-ai-v1`
- Product: `ai`
- Bundle: `com.ynxweb4.ai`
- Callback: `ynxai://wallet-auth/callback`
- Device algorithm: `p256-sha256`
- Ordered scopes: `ai:actions`, `ai:attachments`, `ai:conversations`, `ai:data-control`, `ai:generate`, `ai:permissions`
- Session lifetime: at most 300 seconds

Production must use `verifyCentralWalletSession` and `assertCentralWalletSessionActive`. Wrong product, client, bundle, callback, device, scope order, scope widening, timestamp, nonce, replay, expiry, device revoke, approval revoke, and session revoke fail closed.

Until owner acceptance and remote evidence exist, local fixture auth is not a production authority and `integratedCentral` remains false.

## Generation Gateway contract

Owner: `14-ai`; deployment and release support: `30-security-sre`; protocol acceptance: `29-integration`.

The current runtime implements:

- `POST /ai/stream` only;
- no query parameters;
- exact `application/json` request body;
- unknown-field and extra-value rejection;
- 2 MiB body limit;
- bounded prompt, session, context lists, attachments, attachment names, attachment text, and continuation reference;
- 12 output-language identifiers;
- explicit `selected_files` consent before any attachment content is accepted;
- Gateway SSE `metadata`, `token`, and `done` events;
- product generation SSE `metadata`, `token`, `done`, and truthful `error` events;
- audit storage of request metadata and original prompt hash, not raw prompt or attachment text;
- stable JSON failures containing `code`, `error`, and `requestId`;
- Provider HTTP 429 preservation as `provider_rate_limited`, with upstream response bodies redacted.

The legacy `GET /ai/stream?session=...&q=...` route is rejected and must never be restored by rollback.

## Generation cancellation

Active generation state is bound to its owning Wallet account. A different authenticated account receives HTTP 404 and does not learn whether the generation exists. The owner receives HTTP 202 and the SSE stream terminates with an interrupted, non-completion error.

## Current verification

Passed locally:

```text
go test ./internal/aigateway
go test -race ./internal/aigateway
go test ./internal/aigateway ./internal/aiproduct ./cmd/ynx-ai-gatewayd
go test ./internal/aiproduct
go test -race ./internal/aiproduct
node apps/ai/scripts/release-check.mjs
```

The macOS linker emitted a known malformed `LC_DYSYMTAB` warning during race-linking, but both race suites exited successfully.

## Required owner actions

### 02 Wallet/Auth

Review and merge the exact registry tuple and canonical digest vector. Return accepted registry version, verifier version, commit, CI evidence, and remote negative-vector results.

### 13 Monitor

Accept Gateway and product metrics, request/error/audit identifiers, provider/upstream health, active streams, rate-limit errors, cancellation, timeout, and provider failure signals. Define alerts and incident evidence.

### 15 Trust Center

Accept appeal and correction linkage for AI output disputes. AI may organize evidence and draft an appeal, but does not decide or enforce a Trust action.

### 26 Data Fabric

Freeze canonical usage and billing events. Missing provider usage must remain `actualUsageReported=false`; no charge, quota, burn, Treasury allocation, or receipt may be fabricated.

### 28 Website

Publish the canonical `/ai` route, metadata, FAQ, support, privacy, security, status, screenshots, and artifact links only from accepted release evidence.

### 29 Integration

Freeze this contract as the unique YNX AI protocol version and run the cross-product test vectors against the shared Testnet.

### 30 Security/SRE

Deploy the exact runtime commit, inject credentials through secure references, add scans/provenance, run backup and rollback drills, and return immutable staging/public and artifact evidence. Rollback must disable generation rather than restore prompt-in-query transport.

## Truthful release state

- implementedLocal: true
- testedLocal: true
- installedLocal: false
- integratedCentral: false
- deployedStaging: false
- deployedPublic: false
- downloadHosted: false
- productionSigned: false
- storeReleased: false
- generationLive: false

No provider-backed staging success, public endpoint, production-signed mobile artifact, App Store/Play release, or central Wallet integration is claimed.
