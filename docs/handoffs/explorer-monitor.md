# Explorer & Monitor handoff

## Delivery identity

- Branch: `codex/ecosystem-explorer-monitor`
- Worktree: `/Users/huangjiahao/Desktop/YNX Chain Explorer Monitor`
- Implementation commit: recorded in the final handoff commit below
- Ownership changed only under `apps/explorer/**`, `apps/monitor/**`, and this handoff.

## Product architecture

### YNX Explorer

`apps/explorer` is a standalone public React/Vite product plus a read-only
same-origin Node BFF. The browser consumes canonical `ynx-explorerd` `/api/*`
data and the existing chain RPC for receipt, contract/source, governance and
Trust evidence. The BFF exposes only GET proxy paths, keeps the YNX AI Gateway
key server-side, serves the production bundle, and returns an explicit `503`
when AI is not configured.

The UI contains blocks, transactions, accounts, contracts, validators,
resources, YNXT token metadata, governance, Trust, analytics, source links,
universal search and evidence deep links. It reports connecting, live, bounded
polling fallback, stale, catching-up and unavailable states. It never derives or
displays synthetic TPS, token price, market cap, validator state, balance,
uptime or market data.

Explorer AI sends at most 6,000 characters from the currently selected public
transaction/receipt/contract/resource/Trust evidence. The context preview names
the included sources. The provider-backed result streams through the
permissioned Gateway and remains review-only; it has no mutation route.

### YNX Monitor

`apps/monitor` is a separate dark operations product with an independent
Express control plane and atomic mode-`0600` JSON state. It uses HMAC-signed,
one-hour bearer sessions over server-configured scrypt password hashes and
separates `viewer` from `operator` on every mutation route.

The product probes current node, release identity, validator, peer, peer-sync,
Explorer, Indexer and AI Gateway endpoints with 2.5-second bounds. SLO shows
only the current passing probe count; it never infers historical uptime. Failed
real probes create persisted alerts. Incidents, alert acknowledgement, backup
evidence, rollback proposals and audit records are persisted. Acknowledge needs
the exact operator phrase `ACKNOWLEDGE`. Rollback needs
`APPROVE ROLLBACK PROPOSAL` and is saved as `approved-not-executed`; there is no
infrastructure execution route.

Logs are read-only and limited to the server-side `YNX_MONITOR_LOG_SOURCES`
allowlist. Reads are capped to the last 65,536 bytes / 200 lines, long lines are
bounded, common credential patterns are redacted, and every read is audited.
No configured source returns `not_configured`, never fake logs.

Monitor AI submits only the selected persisted incident fields and evidence to
the permissioned Gateway, records the context classes and advisory-only
authority in local audit, and requests a summary plus runbook proposal. It has
no route that can acknowledge, restart, rotate keys, execute rollback or mutate
operations state.

## Security and truth boundaries

- Provider, AI Gateway and upstream service keys never enter browser bundles,
  screenshots, state, logs or handoff.
- Production users and session secrets are mandatory. Built-in local accounts
  exist only behind explicit `YNX_MONITOR_DEV_USERS=1` for Playwright.
- Monitor mutations require authenticated `operator`; viewer denial is tested.
- Alert and incident state is real persisted operator/probe evidence. Empty is a
  valid state. The screenshots intentionally show current failed local probes,
  not invented incidents or uptime.
- Explorer source evidence stays public and read-only. Unsupported or absent
  upstream records are shown as empty/unavailable.
- No ingress, Caddy, DNS, chain deployment, root Makefile, acceptance document,
  Gateway policy or `internal/explorer` file was modified.

## Verification evidence

- Explorer `npm run build`: passed; TypeScript and Vite production bundle.
- Explorer `npm test`: 5/5 passed, including dashboard data classification,
  stale/catching-up, SSE reconnect and bounded polling failure cutoff.
- Explorer `npm run test:a11y`: passed.
- Explorer `npm run test:e2e`: 4/4 passed on system Chrome at desktop and iPhone
  13 emulation, including catch-up rendering and zero horizontal overflow.
- Monitor `npm run build`: passed; TypeScript and Vite production bundle.
- Monitor `npm test`: 6/6 passed, including login failure, viewer/operator RBAC,
  logs read boundary, explicit acknowledgement, audit and non-executing rollback.
- Monitor `npm run test:a11y`: passed.
- Monitor `npm run test:e2e`: 4/4 passed on desktop/mobile, including operator
  login, viewer denial and zero mobile/desktop horizontal overflow.
- Local real service smoke: started the repository local chain, seeded a real
  account, ran `ynx-indexerd` and `ynx-explorerd`, then passed Explorer checks for
  `/health`, summary, blocks, transactions, validators and SSE. Monitor passed
  all eight bounded probes against those real services.
- Explorer production BFF smoke: served `dist`, returned the YNX Explorer title,
  and truthfully returned `503 ai_gateway_not_configured` with no AI key.
- `git diff --check`: passed.
- Go tests were not rerun because no Go file changed.

## Screenshot evidence

- `apps/explorer/screenshots/explorer-desktop.png`
- `apps/explorer/screenshots/explorer-mobile.png`
- `apps/monitor/screenshots/monitor-desktop.png`
- `apps/monitor/screenshots/monitor-mobile.png`

## Incomplete external integration and exact requests

These are intentionally left to the main integration task:

1. Route the public Explorer origin to the Explorer product BFF and preserve SSE
   buffering/cache headers. Do not expose `YNX_EXPLORER_AI_KEY`.
2. Route Monitor only behind the approved operator ingress/TLS boundary; keep
   its control plane private and provide production `YNX_MONITOR_USERS`, a
   high-entropy `YNX_MONITOR_SESSION_SECRET`, and durable
   `YNX_MONITOR_STATE_PATH` backup policy.
3. Create least-privilege Explorer/Monitor YNX AI Gateway client bindings and
   inject the two server-side keys. Provider quota/unavailable must remain an
   explicit 503/stream failure.
4. Provide the redacted local log-file allowlist through
   `YNX_MONITOR_LOG_SOURCES`; do not add a browser-visible log credential.
5. Apply Caddy, DNS, public ingress and service deployment changes centrally.
   Suggested local product ports are Explorer `4673`, Monitor Web `4674`, and
   Monitor control plane `4675`; the main task may remap them at ingress.

There is no claim of public deployment, historical SLO compliance, production
operator enrollment or provider-backed AI success until the main task supplies
and verifies those external values.
