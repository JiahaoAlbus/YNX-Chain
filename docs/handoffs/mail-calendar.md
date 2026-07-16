# Mail + Calendar handoff

## 2026-07-16 controller correction pass (authoritative)

This section supersedes the earlier Web/PWA-first and placeholder integration
wording below. The existing browser companions and passing domain functions were
preserved, while both products gained independent native mobile clients and the
server adapters were corrected to the accepted central contracts.

### Independent install identities

| Product | Android application ID | iOS bundle ID | Wallet product client | Exact callback |
| --- | --- | --- | --- | --- |
| YNX Mail | `com.ynxweb4.mail` | `com.ynxweb4.mail` | `ynx-mail-v1` | `ynxmail://wallet-auth/callback` |
| YNX Calendar | `com.ynxweb4.calendar` | `com.ynxweb4.calendar` | `ynx-calendar-v1` | `ynxcalendar://wallet-auth/callback` |

Android is a native Java/Material application, not a WebView. iOS is a native
SwiftUI application with an Xcode project, Info.plist, independent icon asset
catalog and String Catalog. The earlier Web/PWA surfaces remain optional desktop
companions; they are not presented as substitutes for the mobile apps.

Each native client owns a P-256 product-device key (Android Keystore; iOS
ThisDeviceOnly Keychain), emits canonical JSON in
`ynxwallet://authorize?request=<base64url>`, persists the pending exact request,
accepts only one `response` query parameter on its exact callback, checks product,
client, bundle, device, callback, nonce and purpose bindings, and persistently
rejects callback replay. A Wallet callback is recorded only as
`gateway_required`; it is never treated as a product session.

The product service now sends the exact Wallet Auth v1 verifier input
`{registryEntry, authorizationRequest, walletApproval, gatewayCompletion}` to
`POST /v1/wallet-auth/verify-session`. It accepts only a live
`wallet-auth-v1` result whose product client, bundle, account and exact scopes
match. Canonical authorization-request digests are persisted so replay remains
rejected across service restart. Tampered account/scope responses are covered by
remote-adapter tests.

AI adapters no longer call invented `/v1/status` or `/v1/product-workflows`
routes. They use the existing AI Gateway `/health` and authenticated
`GET /ai/stream` SSE contract. Mail selected-message and Calendar selected-event
context is assembled only after the existing preview and explicit approval; AI
results remain suggestions/drafts and cannot send, invite, mutate, cancel or
enable automation. Provider/model absence and an empty/error stream fail closed.

### Native product behavior

- Mail provides native inbox/search/compose, restart-persistent drafts, send
  review, bounded attachment disclosure, archive/spam navigation, delivery
  unavailable/offline states, recovery, Wallet sign-in and approved AI context.
  The Go service remains the authoritative implementation for signed threads,
  delivery state/retry, attachment bounds, block/report/appeal, rate/anti-spam,
  audit and YNX-handle-only delivery.
- Calendar provides native timeline/create review, invite handle, system time
  zone, recurrence, reminder/conflict disclosure, restart-persistent event and
  offline queue state, recovery, Wallet sign-in and approved AI context. The Go
  service remains authoritative for preview/approve/revert, RSVP/share,
  recurrence/DST expansion, optimistic conflict control, reminder restart
  recovery and audit.
- Release manifests default to TLS-only traffic. Only the Android debug flavor
  allows cleartext loopback development. Release variants are not debug-signed.
- No contact surface displays Wallet addresses. No mobile client contains a
  provider token, Wallet secret, recovery material or production environment.

### Auditable localization

Both native products ship English, 简体中文, 繁體中文, 日本語, 한국어, Español,
Français, Deutsch, Português, Русский, العربية and Bahasa Indonesia (`en`,
`zh-Hans`, `zh-Hant`, `ja`, `ko`, `es`, `fr`, `de`, `pt`, `ru`, `ar`, `id`).
System locale detection is the default; a manual product locale is persisted
across restart. AI output language is independently persisted. Arabic declares
RTL support and both native layouts switch direction. Android uses localized
date/time formatters and iOS uses locale-aware SwiftUI date controls. Error,
offline, unavailable, privacy, recovery, security, AI approval and accessibility
labels are in the audited catalogs. Generators create the iOS String Catalog
from the Android source catalogs; tests require the exact locale set, nonblank
values and Arabic security wording for every key, preventing silent blanks.

### Correction-pass evidence

| Gate | Evidence | Result |
| --- | --- | --- |
| Mail service | `go test ./internal/mail` | pass, including exact central verifier contract and tampered-account rejection |
| Calendar service | `go test ./internal/calendar` | pass, including exact central verifier contract and tampered-scope rejection |
| Mail product | `npm test && npm run build && npm run check:ios && npm run smoke` in `apps/mail` | pass; 5 Node tests, Go binary, Swift parse, plist/pbxproj lint, smoke |
| Calendar product | same command in `apps/calendar` | pass; 5 Node tests, Go binary, Swift parse, plist/pbxproj lint, smoke |
| Native i18n | `node --test apps/{mail,calendar}/tests/native-i18n.test.mjs` | 4/4 pass across all 12 enumerated locales |
| Mail Android | `ANDROID_HOME=... gradle :app:assembleDebug --max-workers=1` | pass; 32 tasks; 6,405,207-byte installable debug APK; SHA-256 `c01f7766c2c3c7e728136fff28329bb1989dbe54aedac90b6a7960171efd5d2f` |
| Calendar Android | same | pass; 32 tasks; 6,404,458-byte installable debug APK; SHA-256 `f233c3b8c68ca06e9776e1b231fabd8d21db2fb71455649306f621eb2b8fa030` |
| Android install/cold launch | clean install on dedicated API 36 AVD, then `am start -W -S` | both pass independently: Mail `COLD`, `TotalTime: 8204`; Calendar `COLD`, `TotalTime: 2327`; both packages remained installed together |
| iOS native build | Xcode 16.3, generic iOS Simulator build with `CODE_SIGNING_ALLOWED=NO EXCLUDED_SOURCE_FILE_NAMES=Assets.xcassets` | both pass; SwiftUI, Info.plist and all 12 String Catalog localizations compiled and linked. Asset exclusion is limited to this proof because the host has SDK 18.4 but only runtimes 18.5/26.2; normal release must compile the catalog against a matching runtime |
| iOS install/cold launch | clean install on iPhone 16 Pro / iOS 18.5 Simulator, then `simctl launch` | both pass independently after adding the required `CFBundleExecutable`/`CFBundlePackageType`: Mail PID 16674, command wall 7.97 s; Calendar PID 16786, command wall 0.88 s; both bundle IDs remained installed together and both rendered screenshots were inspected |

Android physical-device note: no physical device remained connected at final
verification. The install/cold-launch evidence above is emulator evidence, not a
physical-device or store-release claim.

Desktop/browser proof was rerun after its Wallet fixture was corrected to send
the complete four-part central Wallet Auth v1 verifier input. Both desktop and
mobile viewports passed with named controls and zero page errors. Current hashes:

- Mail desktop `56e5e9aed54af86cd5ef620b7117cc2c7887005a701d1fa3f959a7dc2b148eea`;
  Mail mobile `c696fa13ce777922668894db71fd8d43732b8ddbafb6987204eb7959e8acff39`.
- Calendar desktop `03cb5ef40ab08413a537ed8dc7f590c9f3f931019617e0ac52a327c0f5367130`;
  Calendar mobile `25e1c144c7a93c760c2702bd39305352096fb304cee74084eaf8c29ed57fb6f2`.
- Android rendered screenshot hashes: Mail
  `a017a3846ae9862ebe6e47f8c4de12990d8102993268e033f822c56d1314743f`;
  Calendar `fddeba2c5d98141dc23a812b396cc35111e7ae1422bf146b5a13b771d1ca6539`.
- iOS rendered screenshot hashes: Mail
  `16b90dd969c73ecac3ed10844005de99a9b89db88a832a5e7bba08dcbee628f3`;
  Calendar `12e38f04b93ca83a09b7b4814861c271cd71f487d7111e8d99317c61f3e6fe56`.

### Still external and not claimed

1. Central Wallet registry must add the two exact product clients, bundles,
   callbacks, sorted scopes and `p256-sha256`, and expose the accepted central
   verifier in the target Gateway environment. Until then sign-in is visibly
   unavailable after local callback validation.
2. A deployed AI Gateway must provide a product-session credential, provider,
   model, quota and authoritative cost estimate. No live AI/provider result is
   claimed by this branch.
3. Mail remains known-YNX-handle delivery only. There is no SMTP/MX/DNS,
   internet reputation, external abuse operation or live internet delivery.
4. Calendar invitations/reminders are local product state. There is no claimed
   production push/email/external-calendar or meeting-provider delivery.
5. There is no deployment, production signing, TestFlight, App Store, Google
   Play, central merge or public release claim.

## Source

- Branch: `codex/ecosystem-mail-calendar`
- Declared baseline: `271197feb48fd362292fb2210887edf3109ce4f7`
- Actual branch point: `51bed84` (`origin/main` at task launch); the declared
  baseline is an ancestor and the intervening commit only adds the parallel
  ecosystem delivery contracts used by this task.
- Implementation commit: `3738356` (`feat: build YNX Mail and Calendar products`).
- AI interaction follow-up: `7efc5b1` (bounded multi-message organization,
  visible provider cancellation and action-specific review/apply behavior).
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
  `6e0988deb9076aaeeb45ddd62ec7566c2be5ccec0f6139e46783a861e2552007`
- `apps/mail/tests/artifacts/mail-mobile.png` —
  `913c32930d74b502514d13eaf424100eba499de9c4c4f790366ebaf48a84273c`
- `apps/calendar/tests/artifacts/calendar-desktop.png` —
  `0263e3a7a21412a6c9555a1887d31f422abc66bbce9c26128ba44b6b2d3e1ab7`
- `apps/calendar/tests/artifacts/calendar-mobile.png` —
  `ca8efcb56e0307ad10fc61d66cb18924712c19ba55d1158e9269878436282b1a`

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

1. Central Wallet Auth has not yet registered clients `ynx-mail-v1` and
   `ynx-calendar-v1`, bundles `com.ynxweb4.mail` and
   `com.ynxweb4.calendar`, their exact scopes/callbacks and P-256 algorithms.
   Without that external binding, sign-in/recovery fails honestly.
2. Central YNX AI Gateway has not yet supplied product-session credentials,
   provider/model quota or an authoritative cost estimate. Provider-backed live
   generation is not claimed; `/health` and `/ai/stream` adapters fail closed.
3. No deployment, public TLS route, uptime evidence, signed desktop/mobile store
   package or production owner acceptance exists for these branch products.
4. Mail has no SMTP/DNS/reputation/external abuse handling, malware scanner,
   encrypted-at-rest deployment or E2EE device-key system.
5. Calendar has no external push/email reminder provider or meeting-provider
   integration. Meeting links remain bounded navigation.

## Exact integration requests

1. Wallet Auth review and register:
   - client IDs `ynx-mail-v1`, `ynx-calendar-v1`;
   - bundles `com.ynxweb4.mail`, `com.ynxweb4.calendar`;
   - scopes `mail:account`, `mail:recover`, `calendar:account`,
     `calendar:recover`;
   - exact native callbacks `ynxmail://wallet-auth/callback` and
     `ynxcalendar://wallet-auth/callback`, sorted scopes, `p256-sha256`, and the
     `POST /v1/wallet-auth/verify-session` central verifier contract.
2. AI Gateway issue product-session credentials for the existing `/health` and
   `/ai/stream` boundary. Preserve selected-ID context,
   provider/model/cost evidence, cancellation and server-only credentials.
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
