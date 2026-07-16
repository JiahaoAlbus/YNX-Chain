# Explorer & Monitor handoff

## Delivery identity

- Branch: `codex/ecosystem-explorer-monitor`
- Worktree: `/Users/huangjiahao/Desktop/YNX Chain Explorer Monitor`
- Rework base: `2e5ef561c5ae782b9e5dfaff0ca5a013df390423`
- Completion commit: use the pushed branch tip returned with this handoff.
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

The real stream and API collections are paginated in the browser without
inventing records. Evidence selections are URL-addressable (`kind` + `id`) and
survive direct navigation. The installable PWA caches only the static product
shell; all `/api/`, `/chain/` and `/ai-gateway/` evidence is always network
fetched. Offline, upstream-unavailable, stale and catching-up states remain
explicit.

Explorer AI sends at most 6,000 characters from the currently selected public
transaction/receipt/contract/resource/Trust evidence. The context preview names
the included sources. The provider-backed result streams through the
permissioned Gateway and remains review-only; it has no mutation route.

### YNX Monitor

`apps/monitor` is a separate dark operations product with an independent
Express control plane and atomic mode-`0600` JSON state. The state envelope is
HMAC-authenticated and rejected on tamper at restart. It uses HMAC-signed,
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

In addition to password login, Monitor implements Sign in with YNX Wallet as a
five-minute, one-time challenge for chain `6423` / network `ynx_6423-1`. The
signature and exact challenge binding are verified only through the configured
central Wallet Gateway interface. Replay is rejected, challenges persist over
restart, and wallet accounts receive roles only from the server-side
`YNX_MONITOR_WALLET_ROLES` map. No browser- or wallet-supplied role is trusted.
The PWA shell never caches `/ops/` responses.

Logs are read-only and limited to the server-side `YNX_MONITOR_LOG_SOURCES`
allowlist. Reads are capped to the last 65,536 bytes / 200 lines, long lines are
bounded, common credential patterns are redacted, and every read is audited.
No configured source returns `not_configured`, never fake logs.

Monitor AI submits only the selected persisted incident fields and evidence to
the permissioned Gateway, records the context classes and advisory-only
authority in local audit, and requests a summary plus runbook proposal. It has
no route that can acknowledge, restart, rotate keys, execute rollback or mutate
operations state.

Both products support English, 简体中文, 繁體中文, 日本語, 한국어, Español,
Français, Deutsch, Português, Русский, العربية and Bahasa Indonesia. Locale and
independent AI-output language are system-detected, manually selectable and
persisted across reloads. Dates and numbers use `Intl`; Arabic sets document
RTL. Automated tests verify 12-locale key fallback, RTL/persistence, responsive
overflow and live service-worker registration.

## Security and truth boundaries

- Provider, AI Gateway and upstream service keys never enter browser bundles,
  screenshots, state, logs or handoff.
- Production users and session secrets are mandatory. Built-in local accounts
  exist only behind explicit `YNX_MONITOR_DEV_USERS=1` for Playwright.
- Monitor mutations require authenticated `operator`; viewer denial is tested.
- `YNX_MONITOR_STATE_INTEGRITY_KEY` is mandatory in production and must be a
  separate high-entropy server secret. Wallet authentication fails closed when
  the central verifier is absent.
- Alert and incident state is real persisted operator/probe evidence. Empty is a
  valid state. The screenshots intentionally show current failed local probes,
  not invented incidents or uptime.
- Explorer source evidence stays public and read-only. Unsupported or absent
  upstream records are shown as empty/unavailable.
- No ingress, Caddy, DNS, chain deployment, root Makefile, acceptance document,
  Gateway policy or `internal/explorer` file was modified.

## Verification evidence

Completion pass on 2026-07-16 used fresh `npm ci --ignore-scripts` installs from
both committed lockfiles. Both products resolved Playwright `1.61.1`; no result
below relies on the pre-upgrade `node_modules` tree.

- Explorer `npm run build`: passed; TypeScript and Vite production bundle.
- Explorer `npm test`: 7/7 passed, including 12-locale resolution, dashboard data classification,
  stale/catching-up, SSE reconnect and bounded polling failure cutoff.
- Explorer `npm run test:a11y`: passed.
- Explorer `npm run test:e2e`: 6/6 passed on system Chrome at desktop and iPhone
  13 emulation. The post-fix PWA/RTL subset also passed 2/2 with real service
  worker registration.
- Monitor `npm run build`: passed; TypeScript and Vite production bundle.
- Monitor `npm test`: 11/11 passed, including login failure, viewer/operator
  RBAC, wallet replay rejection, restart recovery, state tamper rejection, logs
  read boundary, explicit acknowledgement, audit and non-executing rollback.
- Monitor `npm run test:a11y`: passed.
- Monitor Playwright: desktop 3/3 and mobile 3/3 passed, including operator
  login, viewer denial, RTL persistence, PWA registration, and zero horizontal
  overflow. Tests run one worker with a 90-second ceiling because Chrome cold
  startup on this host is slow; no product wait was weakened.
- Local real service smoke: started the repository local chain, seeded a real
  account and committed transfer, then ran `ynx-indexerd`, `ynx-explorerd` and
  the real `ynx-ai-gatewayd`. Explorer required canonical
  `rpc-and-indexer-backed` summary evidence, non-empty indexed blocks and
  transactions, validators and SSE. Monitor required all eight bounded probes
  to be healthy; unavailable probes now fail smoke instead of only checking the
  probe count.
- Explorer production BFF smoke: served `dist`, returned the YNX Explorer title,
  and truthfully returned `503 ai_gateway_not_configured` with no AI key.
- `git diff --check`: passed.
- Vite and `@vitejs/plugin-react` are pinned in both products to `8.1.4` and
  `6.0.3`; Playwright is upgraded to `1.61.1`, and the transitive `esbuild`
  version is overridden to `0.28.1`. Online `npm audit --audit-level=low`
  completed for both product lockfiles with `found 0 vulnerabilities`, and both
  production builds passed.
- Go tests were not rerun because no Go file changed.

The final desktop/mobile Playwright rerun passed Explorer 6/6 and Monitor 6/6
with the upgraded browser-test dependency. The hardened local service smoke
passed with 10 indexed blocks and 3 indexed transactions in Explorer and 8/8
healthy Monitor probes. These counts are ephemeral local-chain evidence, not
public network statistics.

The products are intentionally Web-first public/operator tools. Installable PWA
companions, responsive mobile layouts, icons and standalone launch entrypoints
are delivered. Android APK and iOS Xcode/Simulator evidence are not applicable
to this product architecture; no native shell, store signing or mobile-store
publication is claimed.

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
   `YNX_MONITOR_STATE_PATH` backup policy plus a distinct
   `YNX_MONITOR_STATE_INTEGRITY_KEY`.
3. Create least-privilege Explorer/Monitor YNX AI Gateway client bindings and
   inject the two server-side keys. Provider quota/unavailable must remain an
   explicit 503/stream failure.
4. Provide the redacted local log-file allowlist through
   `YNX_MONITOR_LOG_SOURCES`; do not add a browser-visible log credential.
5. Apply Caddy, DNS, public ingress and service deployment changes centrally.
   Suggested local product ports are Explorer `4673`, Monitor Web `4674`, and
   Monitor control plane `4675`; the main task may remap them at ingress.
6. Configure `YNX_MONITOR_WALLET_AUTH_URL`, its server-only Gateway credential,
   the exact public origin, and the server-owned wallet role map. The product
   correctly reports `wallet_gateway_not_configured` until this is provided.

There is no claim of public deployment, historical SLO compliance, production
operator enrollment or provider-backed AI success until the main task supplies
and verifies those external values.
