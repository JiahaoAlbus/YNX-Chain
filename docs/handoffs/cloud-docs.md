# YNX Cloud & Docs handoff

## Scope and claim boundary

- Branch: `codex/ecosystem-cloud-docs`
- Returned candidate baseline: `82e095e4c545c38df74c6bf2a7cfa8aae719d111`
- Owned paths only: `apps/cloud/**`, `apps/docs/**`, `internal/cloud/**`, and
  this handoff.
- No merge to `main`, central production integration, remote deployment, public
  availability, production signing, TestFlight, App Store, Google Play,
  unlimited storage, production durability, or real-time collaboration is
  claimed. Android installation below is an emulator-only test package result.

Cloud and Docs are now Android/iOS-first React Native products. Their existing
Web clients remain companion surfaces, not substitutes for the native apps. No
desktop shell was added because this branch does not yet deliver enough distinct
filesystem, shortcut, multi-window and window-restoration value to justify one.

## Native product identities

| Product | Android / iOS ID | Deep link | Wallet client |
| --- | --- | --- | --- |
| Cloud | `com.ynxweb4.cloud` | `ynxcloud://wallet-auth/callback` | `ynx-cloud-mobile-v1` |
| Docs | `com.ynxweb4.docs` | `ynxdocs://wallet-auth/callback` | `ynx-docs-mobile-v1` |

Both products include generated Gradle and Xcode projects, independent launch
entries and icons based on the supplied YNX artwork. Platform secure storage
holds the session, selected UI locale, independently selected AI-output locale,
and the device-bound P-256 secret. Recovery keys and Wallet private material are
never requested or stored.

The Wallet request is limited to five minutes and binds chain, product, client,
bundle, callback, sorted scopes, nonce, device key and canonical purpose. The
callback parser rejects scheme/host/path, product, chain, bundle, callback,
device-key and scope substitution. The service persists one-time nonces and
rejects replay after restart. The canonical English Wallet purpose is kept
stable as protocol signing text; localized explanatory UI is not substituted
into signed bytes.

## Service and central integration contracts

`ynx-cloudd` remains one bounded authorization/storage service for two separate
products. It now exposes explicit fail-closed adapters:

- Wallet: `YNX_WALLET_VERIFY_URL` + `YNX_WALLET_VERIFY_TOKEN`, calling
  `POST /v1/wallet-auth/verify` and requiring the verifier response to bind the
  same account/product/client/bundle/callback.
- AI: `YNX_AI_GATEWAY_URL` + `YNX_AI_GATEWAY_TOKEN` + `YNX_AI_MODEL`, calling
  the selected-context YNX AI Gateway SSE contract. No unavailable-provider
  fallback fabricates an answer.
- Trust: `YNX_TRUST_URL` + `YNX_TRUST_TOKEN`, sending bounded audit/hash
  evidence to `POST /v1/cloud/evidence`. The default remains explicitly
  `local-audit-only-no-public-trust-evidence`.
- Object storage: `YNX_OBJECT_STORE_URL` + `YNX_OBJECT_STORE_TOKEN`, using
  authenticated `PUT /objects/{sha256}` and `GET /objects/{ref}`. Responses are
  size bounded and re-hashed. The default remains explicitly
  `bounded-local-filesystem-not-production-durable`.

Remote adapters require HTTPS, except loopback HTTP used by tests. Missing token,
binding mismatch, response hash mismatch, oversized bodies and non-loopback HTTP
fail closed. Health reports object durability and Trust boundaries. Bodies stay
off-chain; only identity, permission, hash or settlement evidence may cross the
chain/service boundary.

## Cloud native workflow

The native client supports Wallet sign-in, file/folder views, recent, starred,
trash/restore, safe picker upload with the 8 MiB bound, content download/export,
immutable version inspection, manual sync and a persisted multi-item offline
upload queue. A queue item is removed only after its server create succeeds.
Offline sync is create-only: a same-name remote item is never overwritten, and
the failed item plus all later queue entries remain available for retry/recovery.

Selecting a file exposes explicit time-bounded viewer grants, 24-hour links,
grant/link revocation, audit inspection and single-selected-version AI summary.
AI shows the exact file/version context before consent, never reads the rest of
the drive, and requires accept/reject review; accepting is reference-only and
does not overwrite the source. Cloud never automatically shares, deletes or
overwrites.

## Docs native workflow

The native client supports create/open/edit, version-aware autosave, immutable
history, version-bound comments and `ynx1...` mentions, text export, local draft
recovery and explicit retry. Every local draft stores its base version. A stale
draft opens conflict recovery and can either use the server version or create a
separate recovered document; it never silently overwrites.

Presence is a 20-second bounded heartbeat and the product copy explicitly says
it is not real-time collaboration. AI receives only the open document version
after a confirmation that names that version. The result is review-only;
apply/reject is explicit, and apply first places text into the local editor so
normal version-aware autosave still controls persistence.

## Web and desktop feasibility

The independently served `/cloud/` and `/docs/` clients remain the current Web
and desktop-browser surfaces. Product-local checks cover CSP-safe static assets,
keyboard/accessibility markers, responsive CSS, offline persistence, Wallet
isolation, selected-context AI approval and conflict recovery; the service smoke
loads both routes through `ynx-cloudd`. This is runnable desktop-browser evidence,
not a signed macOS or Windows package.

The Cloud Web surface supplies folder creation/navigation, authorized search,
quota display, preview, version restore, share/access-request flows and audit in
addition to the native lifecycle. The Docs Web surface supplies searchable
documents, version-aware autosave, comments, bounded presence, export and the
side-by-side conflict recovery path. Both call the same server-enforced API.

A desktop shell was deliberately not added. Cloud still lacks the separately
proven filesystem sync, shortcut, multi-window and restoration behavior that
would justify a native desktop distribution, while Docs currently gains no
security or workflow capability over its desktop Web surface. Native desktop
packaging therefore remains feasible after those workflows exist, but is not
claimed delivered by this branch.

## Persistence, authorization and security

- Metadata is atomic JSON with a state integrity digest and mode `0600`.
- File/version bodies are SHA-256 content-addressed and verified on every read.
- Sessions persist only as token hashes and support revocation and expiry.
- Owner/editor/viewer authorization, inherited folder grants, expiry,
  revocation, link access, access requests and audit are enforced server-side.
- Quota counts retained physical version blobs; the default is 64 MiB and is
  never described as unlimited.
- Upload names, type/extension and body sizes are bounded. The scanner interface
  and EICAR rejection exist, but are not represented as production antivirus.
- Client encryption accepts only the declared AES-256-GCM/user-held recovery
  boundary. Encrypted content is excluded from AI; no silent server recovery is
  claimed.
- Queued/running AI jobs fail on restart and require new consent.

## Internationalization and accessibility

Both native products provide English, 简体中文, 繁體中文, 日本語, 한국어,
Español, Français, Deutsch, Português, Русский, العربية and Bahasa Indonesia.
They detect the system locale, allow manual UI and independent AI-output locale
selection, persist both choices across restart, use `Intl` date formatting,
provide an Arabic RTL layout path, and localize privacy, security, recovery,
offline, unavailable and accessibility-facing core labels. Audit scripts require
all 12 locale rows, non-empty key coverage, RTL and safety/AI markers. Core
native controls expose button/tab roles, selected state, labels and live regions
for failures and generated results.

## Verification evidence

Passed on 2026-07-17:

```text
go test ./internal/cloud ./apps/cloud/cmd/ynx-cloudd
  passed, including remote adapter integrity and native Wallet binding/replay

go test ./...
  passed across the repository

bash apps/cloud/scripts/smoke.sh
  YNX Cloud & Docs smoke passed

npm --prefix apps/cloud test && npm --prefix apps/cloud run check
  1 client test + Cloud product/accessibility checks passed
npm --prefix apps/docs test && npm --prefix apps/docs run check
  1 client test + Docs autosave/conflict/accessibility checks passed

npm run hardhat:build && npm run contracts:selectors
  passed; no contract changes and selector metadata regenerated
make secret-scan && make env-check && make no-placeholder-check
  passed after the final test-fixture cleanup

Cloud native:
  pnpm install                    lockfile supply-chain policy passed
  pnpm run typecheck              passed
  pnpm test                       1 Wallet binding test passed
  pnpm run i18n-check             12 locales / RTL / safety / AI controls passed
  pnpm run prebuild               Android and iOS projects generated
  pnpm run bundle                 Android + iOS Metro bundles passed (~1.7 MB each)

Docs native:
  pnpm install                    lockfile supply-chain policy passed
  pnpm run typecheck              passed
  pnpm test                       1 Wallet isolation test passed
  pnpm run i18n-check             12 locales / RTL / recovery / AI controls passed
  pnpm run prebuild               Android and iOS projects generated
  pnpm run bundle                 Android + iOS Metro bundles passed (~1.7 MB each)

Android test-only release package (JDK 17 / SDK 36):
  Cloud assembleRelease           passed; 66 MB
  Cloud APK SHA-256               39573955c5fce96c705aecaf854911813c06233bbf80b4020085e8e87e2a55c7
  Cloud emulator install          Success
  Cloud cold launch               com.ynxweb4.cloud/.MainActivity, 1384 ms, PID observed
  Cloud launch screenshot SHA-256 d4d82da0f42cc82c801e66df6f7d94ce5147341fdd314aadd00b127af02653fa

  Docs assembleRelease            passed; 66 MB
  Docs APK SHA-256                42d9077c1c108dcffc93d5ece5efd72e9091057bf0cf996c6e19a0e2a5d7e99e
  Docs emulator install           Success
  Docs cold launch                com.ynxweb4.docs/.MainActivity, 2307 ms, PID observed
  Docs launch screenshot SHA-256  8c30a79063602f87358a7a827a40da4bb1ddd6ba44fdd5f19b23f9880ab774c7
```

The generated `dist/`, `node_modules`, native build directories and APK/IPA/AAB
outputs are ignored and are not committed. Android release packages use only the
generated development keystore and are test evidence, not production-signed AABs.

## Honest incomplete and external blockers

- The central Gateway must provide reviewed production URLs/tokens for Wallet,
  AI, Trust and object storage. This branch implements and tests contracts but
  does not claim those services are integrated, installed or public.
- Production replicated metadata/object storage, backup/restore drills,
  independent malware scanning, KMS/HSM recovery, retention/legal policy,
  measured capacity/SLOs, deployment and independent audit remain external.
- Complete Xcode and `simctl` are absent on this host: `xcodebuild` points to
  `/Library/Developer/CommandLineTools` and Simulator evidence is pending. The
  complete generated Xcode projects and iOS Metro bundles are present, but no
  iOS native binary, signing or Simulator cold launch is claimed.

## Remaining main-control actions

1. Review and register the four exact native/Web Wallet identities and inject
   production Wallet verification without enabling `-dev-wallet` outside
   loopback smoke.
2. Supply reviewed AI, Trust and durable object-storage endpoints and credentials
   through deployment secret management; do not commit them.
3. Choose replicated metadata, backup, AV, KMS and retention infrastructure
   before changing durability or public-availability language.
4. Add central routing, supervision, release gates and public docs only after
   independently reviewing this candidate branch.
