# Mail + Calendar handoff

## Source

- Branch: `codex/ecosystem-mail-calendar`
- Declared baseline: `271197feb48fd362292fb2210887edf3109ce4f7`
- Actual branch point: `51bed84` (`origin/main` at task launch); the declared
  baseline is an ancestor and the intervening commit only adds the parallel
  ecosystem delivery contracts used by this task.
- Implementation commit: `3738356` (`feat: build YNX Mail and Calendar products`).
- Final branch tip: use the commit reported by the product task.
- Worktree: `/Users/huangjiahao/Desktop/YNX Chain Mail Calendar`
- Ownership changed: `apps/mail/**`, `apps/calendar/**`, `internal/mail/**`, and
  this handoff. No acceptance state, root Makefile or central Gateway policy was
  changed.

## Delivered products

### YNX Mail

YNX Mail is a separate Web/PWA and Go service (`com.ynx.mail`) with a persistent
Mail domain model and an explicit `mail:account` / `mail:recover` Wallet boundary.
It implements:

- one-time, five-minute Wallet challenge, exact product/scope/device binding,
  opaque product sessions, replay rejection, revoke and recovery that revokes
  every older session;
- inbox, signed threads and replies, compose, device/offline draft, persistent
  draft, explicit send review, search, sent/archive/spam folders and folder
  recovery;
- local YNX `@handle` delivery, per-recipient delivered/failed state, honest
  unknown/external/blocked reasons and explicit failed-delivery retry;
- Mail-service Ed25519 sender attestation with a persisted mode-`0600` identity
  key and UI wording that does not misrepresent it as a Wallet signature;
- attachment upload, persistence and download with 10 MiB combined bounds,
  SHA-256/size verification and executable/package/HTML rejection;
- persisted five-per-minute account rate limit, deterministic anti-spam routing,
  sender block/unblock, Trust report/case list/appeal and account audit UI/API;
- selected-message AI summarize, draft reply, translate and organize workflows
  with data/provider/model/cost preview, explicit approval, SSE state, provider
  cancellation, result review, apply/reject and audit. Apply only writes a draft;
  it never sends mail or enables automation.

Delivery truth: this service only delivers between known local YNX handles.
`internet_mail_delivery_not_supported` is stored for domain/protocol recipients.
There is no SMTP, MX/DNS, IP reputation, abuse desk or live external delivery
proof, so internet-wide email delivery is not claimed.

Encryption truth: state files are mode `0600`, but bodies and attachment bytes
are plaintext at rest and are not E2EE. The exact missing E2EE key-directory,
rotation, multi-device and recovery controls are documented in
`apps/mail/README.md`.

### YNX Calendar

YNX Calendar is a separate Web/PWA and Go service (`com.ynx.calendar`) with an
independent `calendar:account` / `calendar:recover` Wallet session. It implements:

- create, update and cancel as persistent preview -> approve -> optional revert
  changes; optimistic versions reject stale writes and mutation IDs make offline
  synchronization idempotent;
- known-`@handle` invites, pending/accepted/tentative/declined RSVP, viewer/editor
  sharing and owner unshare recovery without exposing Wallet addresses;
- IANA time-zone parsing and UTC persistence, bounded daily/weekly/monthly
  recurrence that preserves local wall-clock time across DST;
- conflict discovery across recurrence occurrences, explicit conflict override
  and audited decision metadata;
- local reminders with per-occurrence persisted delivery, duplicate prevention,
  background processing and a `delivered_late_after_restart` recovery state;
- offline queueing that only creates a preview on reconnect and never silently
  creates, invites, updates or cancels;
- HTTPS-only meeting links without credentials, wallet hosts or signing paths;
- event/share/RSVP/reminder/change/AI audit UI and account/session recovery;
- selected-event AI propose-times, agenda, follow-up and conflict workflows with
  data/provider/model/cost preview, approval, SSE state, real cancellation,
  review and audit. Applying retains a suggestion and does not mutate Calendar.

Scheduling truth: reminder evidence is local-product delivery, not email, push or
meeting-provider delivery. No production scheduling service is claimed.

## Architecture

Each product embeds its own static PWA and exposes its own `/v1` handler. Domain
state is copied before mutation, validated, written to a mode-`0600` temporary
file and atomically renamed. This makes restart behavior deterministic and avoids
partial state after a failed write.

Wallet verification and AI generation use server-only adapters. Provider tokens
never enter the browser, state file, log, screenshot or Git. Both adapters fail
honestly when their endpoint is not configured. The browser deep links to YNX
Wallet and only accepts a callback matching the locally stored challenge.

Mail and Calendar do not share sessions, package IDs, storage or broad tokens.
Contact-facing payloads contain handles. Account identifiers are stored only as
one-way hashes on the user/session side of each service.

## Test evidence

| Gate | Command / evidence | Result |
| --- | --- | --- |
| Mail domain | `go test ./internal/mail` | pass; persistence/restart, thread, search, signed delivery, retry, attachment tamper/bounds, spam/rate, block, Trust, auth/replay/recovery, AI approval/cancel/provider failure, strict HTTP |
| Calendar domain | `go test ./internal/calendar` | pass; persistence/restart, event/change states, offline idempotency, conflict, recurrence/DST, time zone, invite/RSVP/share/unshare, cancel/revert, reminder recovery, meeting boundary, auth/recovery, AI approval/cancel/provider failure, strict HTTP |
| Repository Go | `npm ci && npm run hardhat:build && npm run contracts:selectors && go test ./...` | pass; initial run lacked ignored Hardhat artifacts, then the documented build generated them and the complete Go suite passed |
| Mail UI | `npm test --prefix apps/mail` | 3/3 pass plus JS syntax checks |
| Calendar UI | `npm test --prefix apps/calendar` | 3/3 pass plus JS syntax check |
| Product builds | `npm run build --prefix apps/mail`; `npm run build --prefix apps/calendar` | pass; `/tmp/ynx-maild`, `/tmp/ynx-calendard` |
| Smoke | `npm run smoke --prefix apps/mail`; `npm run smoke --prefix apps/calendar` | pass; embedded UI, JS and truthful health flags |
| Browser proof | bundled Playwright + `apps/*/tests/browser-proof.cjs` | desktop 1440x960 and mobile 390x844 pass; named interactive controls; reduced-motion; zero page errors |
| Placeholder | `make no-placeholder-check` | pass |
| Secrets | `make secret-scan` | pass |
| Environment | `make env-check` | pass; real deployment values remain external |
| Objective state | `make objective-state-check` | pass; no objective files changed |
| Diff hygiene | `git diff --check` | pass |

Browser screenshot evidence (generated locally and intentionally covered by the
repository-wide `artifacts/` ignore rule; rerun the browser-proof scripts to
reproduce):

- `apps/mail/tests/artifacts/mail-desktop.png` —
  `30b388d0aceef339a82911e48fa577b2368903198f484b1cad01c66a01c29173`
- `apps/mail/tests/artifacts/mail-mobile.png` —
  `677bb0fd21161b8017f8edac59166e522cc83ba1ceca878aa993594522608e7e`
- `apps/calendar/tests/artifacts/calendar-desktop.png` —
  `c87415f218f7655f47635253877f01de9706528f6a27f0d6f1e9cd6001a3684c`
- `apps/calendar/tests/artifacts/calendar-mobile.png` —
  `343eab77fcc9c1d1e7ddcebbf72e1e4a9a59f82c7ec8900a5507f9beb4c685c5`

The UI uses Klein blue `#002FA7` and white, with a reading/writing split for Mail
and a conflict-aware time grid for Calendar. Static tests verify desktop/mobile
breakpoints, reduced motion, labels, focus targets and the absence of decorative
gradient/neon styles. The screenshots were also inspected after generation.

## Security and privacy boundaries

- Strict JSON decoding rejects unknown fields and multiple values; request sizes,
  text, recipient, attachment, invite, recurrence, reminder and meeting-link
  bounds fail closed.
- Product sessions are bearer tokens whose hashes alone are persisted. Account
  recovery requires a new exact Wallet recovery proof and revokes older sessions.
- AI authorization checks every selected message/event against the product
  session. A late provider result cannot revive a cancelled job.
- Mail signing keys and state are runtime files ignored by Git. Browser proof
  uses ephemeral mock verifier processes only inside the test script; no test
  bypass exists in either product binary.
- Neither UI displays `ynx1...` or `0x...` contact identifiers. The browser UI
  contract tests explicitly reject those patterns.
- Content is escaped before dynamic HTML insertion; meeting links are validated
  HTTPS links with `noopener noreferrer` and no authority transfer.

## Incomplete external boundaries (not claimed)

These do not make the bounded local products synthetic, but they prevent public
production claims:

1. Central Wallet Auth has not yet registered `com.ynx.mail` and
   `com.ynx.calendar`, their exact scopes/callbacks or the proposed verifier
   routes. Without that external binding, sign-in/recovery fails honestly.
2. Central YNX AI Gateway has not yet accepted the product workflow endpoint or
   supplied a provider token/quota. Provider-backed live generation is not
   claimed; the adapters and failure states are implemented and tested.
3. No deployment, public TLS route, uptime evidence, signed desktop/mobile store
   package or production owner acceptance exists for these branch products.
4. Mail has no SMTP/DNS/reputation/external abuse handling, malware scanner,
   encrypted-at-rest deployment or E2EE device-key system.
5. Calendar has no external push/email reminder provider or meeting-provider
   integration. Meeting links remain bounded navigation.

## Exact integration requests

1. Wallet Auth review and register:
   - product IDs `com.ynx.mail`, `com.ynx.calendar`;
   - scopes `mail:account`, `mail:recover`, `calendar:account`,
     `calendar:recover`;
   - exact PWA callbacks and server-to-server verification contracts currently
     called as `/v1/mail/verify` and `/v1/calendar/verify`.
2. AI Gateway review and bind product-scoped status/workflow routes for the eight
   named workflows. Preserve selected-ID context, provider/model/cost evidence,
   cancellation and server-only credentials.
3. Integration authority may add deployment/systemd/reverse-proxy configuration
   after choosing hosts, secrets, TLS names, backups and rollback paths. No such
   central files were changed here.
4. Trust integration may forward local Mail cases into the accepted Trust case
   service only after defining idempotent case mapping and appeal authorization;
   local cases must not be silently marked externally accepted.

## Reviewer quick start

```bash
go test ./internal/mail ./internal/calendar
npm test --prefix apps/mail
npm test --prefix apps/calendar
npm run smoke --prefix apps/mail
npm run smoke --prefix apps/calendar
```

For a full repository Go run from a clean clone, run `npm ci`,
`npm run hardhat:build` and `npm run contracts:selectors` first because the
required Hardhat artifacts are intentionally ignored by Git.
