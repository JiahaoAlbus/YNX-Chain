# YNX AI handoff

## Delivery identity

- Branch: `codex/ecosystem-ai`
- Worktree: `/Users/huangjiahao/Desktop/YNX Chain AI`
- Starting point: `51bed843c5aa8dc53b2dc32b29cb8ca349ff0e95`
- Previous implementation: `5fa7e7795881e67cbf94d69a680726fc6e73fa0e`
- Previous handoff: `5d8ff216e777872785ee282e8591fb27dc5da2f9`
- Release source commit: `859f340632932d4c98395f9ef11733bbb526092c`.
  The final pushed branch tip adds only this immutable source-commit pointer.

## Changed paths

- `apps/ai/**`: embedded responsive Web client, Go product binary, environment
  contract, and independent Expo/React Native Android+iOS product.
- `internal/aiproduct/**`: formal Wallet protocol adapter, encrypted persistent
  conversations and attachments, POST-body Gateway orchestration, SSE/cancel,
  provider/quota truth states, permissions/actions, usage, audit and privacy.
- `docs/handoffs/ai.md`: this integration record.
- `.github/workflows/ynx-ai-mobile.yml`: reproducible Android preview and iOS
  Simulator build/install/runtime evidence jobs.

No long-term goal, acceptance-state file, root `Makefile`, central Gateway policy,
or another product path was changed.

## 2026-07-18 release-truth update

The release contract was expanded after the prior handoff. The authoritative
machine-readable status is `apps/ai/product-release.json`; it intentionally does
not promote local implementation into central integration or deployment.

- Production-default auth no longer exposes either legacy or product-local
  verifier routes. They are registered only with the explicit local-only switch
  `YNX_AI_ALLOW_LOCAL_FIXTURE_AUTH=1`. The canonical shared verifier is not on
  `origin/main`, so production sign-in currently fails closed.
- `apps/ai/integration/` now contains the exact schema-v2 `ynx-ai-v1` registry
  entry, AI-specific digest vector, Wallet registry patch, central POST-body
  Gateway patch, and machine-readable integration state. These are owner merge
  inputs; `integratedCentral=false` until deployed and remotely proven.
- Conversations now add encrypted title/body search, an independently encrypted
  branch with fresh message IDs/nonces, and continue-from-assistant semantics.
  Attachments enforce both 256 KiB size and eight-item quantity bounds.
- Action preview now requires scope, target, exact payload, risk, evidence and
  provider, then preserves the existing approve/reject/
  `approved_not_executed`/Wallet-required lifecycle.
- Public `/healthz` and `/api/meta` expose build and truth flags. Both say
  `integratedCentral=false` and `generationLive=false`; they never infer provider
  success from a handler or configured credential.
- Release artifacts and audits were added: `artifact-manifest.json`,
  `evidence-index.json`, `RELEASE_NOTES.md`, `UI_DESIGN_AUDIT.md`, and runnable
  Android/iOS jobs in `.github/workflows/ynx-ai-mobile.yml`.
- `sbom.cdx.json` contains 811 transitive Go/npm CycloneDX components;
  `DEPENDENCY_REVIEW.md` records the production license groups and review
  boundary. Both central owner patches were regenerated as valid unified diffs
  and passed `git apply --check` against their source branches.
- The final Android manifest removes read/write external storage permissions,
  disables backup, retains only the exact Wallet callback filter, and builds at
  minSdk 24 / targetSdk 36. The current preview APK hash is
  `feca84462a0ae16237bac4c783683958ecf590105345e8f0b205acb9f36501a5`,
  size 69,735,849 bytes, signed by an Android Debug certificate. It is not
  production-signed or hosted.
- The current APK hash was streamed-installed on task-owned API-36
  `emulator-5582`. Ordinary cold launch, force-stop/restart, exact Wallet
  callback deep link cold launch, top-resumed `MainActivity`, package version,
  install time and live process state were verified.
- This host still lacks full Xcode. The new CI job is runnable and performs a
  real Simulator build/install/cold launch/restart/deep-link/hash sequence, but
  it is not a passing-run claim.
- Local browser inspection covered actual 1440×900 light/dark and 390×844
  responsive/fail-closed states. Durable full screenshot coverage, Arabic,
  large-text, tablet, loading/empty/failure/success visual evidence remains open.

## Architecture and completed workflow

The Go product server owns persistence and the server-side AI Gateway key. Both
the existing embedded Web client and the independent native client call this
server; neither receives provider or Gateway credentials.

- In explicit local fixture mode, Sign in with YNX Wallet uses the Task 1 request/approval/challenge
  shapes, canonical JSON domains, exact `ynx_6423-1` network, product client
  `ynx-ai-v1`, bundle `com.ynxweb4.ai`, callback
  `ynxai://wallet-auth/callback`, sorted exact scopes, five-minute one-time
  request, secp256k1 Wallet proof, and a separate P-256 product-device proof.
  Sessions, product device keys, locale, output language, and last conversation
  survive restart in platform secure storage; fixture server sessions survive restart
  as token hashes and remain revocable.
- Conversations support create, select, rename, archive, delete, copy, export,
  retry and encrypted restart persistence. Text/Markdown/JSON attachments are
  size/type bounded, encrypted with authenticated associated data, owner-bound,
  selectable per generation, and deleted with their conversation/account.
- Sensitive generation input is sent only as JSON in `POST /ai/stream`; prompt,
  selected/excluded context, output language, and attachment bodies never enter
  a URL. The client SSE parser preserves partial frames across network chunks.
  Streaming, client/server cancel, timeout, retry, request ID and encrypted final
  persistence are implemented.
- Provider/model/status are live Gateway health results. The configured model is
  the only selectable model until the Gateway publishes a catalog. Aggregate and
  per-message token/resource/money values are visibly estimates with
  `actualUsageReported=false`; money and quota stay unknown unless reported.
- Gateway health `429` remains HTTP 429 and renders as quota exhaustion. Gateway
  unavailable remains unavailable. Tests prove both paths persist no user or
  assistant message and generate no canned substitute.
- Tool, product-action and chain-action records expose scope, description and
  payload preview. Reject calls the Gateway. Approve requires the user to choose
  an active, exact-scope Gateway permission, calls the Gateway, persists
  `approved_not_executed`, and never executes. Chain actions still require a
  separate YNX Wallet review/signature. Review and privacy screens expose the
  linked audit history.
- Data controls cover allowed context types, explicit attachment selection,
  AES-256-GCM content at rest, 1-90 day retention, conversation/account delete,
  session revoke, local audit linkage, and Trust appeal records/link.
- The native UI supports audited locale catalogs for `en`, `zh-CN`, `zh-TW`,
  `ja`, `ko`, `es`, `fr`, `de`, `pt`, `ru`, `ar`, and `id`; system/app/output
  language choices persist. Arabic applies RTL direction and localized date,
  number, money and plural formatters are verified.

## Security and truth boundaries

- No provider key, Gateway key, Wallet secret, recovery material, session token,
  attachment plaintext, or conversation plaintext is committed or browser
  delivered.
- AI cannot sign, transfer, publish, send, change permissions, freeze, or bypass
  Wallet, Trust, product authorization, explicit permission or human review.
- Approval records review only; it is never represented as execution.
- Provider success is accepted only from a successful provider-backed Gateway
  stream containing non-empty provider content. Unavailable, empty, interrupted,
  timeout and quota paths are failures and create no substitute answer.
- Android source and release package request no storage or overlay permission.
  Release validation showed only INTERNET, SecureStore biometric permissions and
  the package-local dynamic-receiver permission.

## Verification evidence (2026-07-18/19 CST)

Passed:

```text
go vet ./...
go test ./...
go test -race ./internal/aiproduct
go test ./internal/aiproduct -run '^$' -fuzz FuzzBoundedTextAndCleanListInvariants -fuzztime=3s
bash apps/ai/scripts/smoke.sh
pnpm run check                         # typecheck, 7 tests, policies, Android+iOS bundles
JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
  NODE_ENV=production ANDROID_HOME=/Users/huangjiahao/Library/Android/sdk \
  ANDROID_SDK_ROOT=/Users/huangjiahao/Library/Android/sdk \
  apps/ai/mobile/android/gradlew --no-daemon --max-workers=2 \
  -Dkotlin.compiler.execution.strategy=in-process :app:assembleRelease
make secret-scan
make no-placeholder-check
git diff --check
```

The Web smoke built the Go binary, cold-started it with a non-provider endpoint,
loaded the embedded UI and metadata, and verified provider-unavailable truth
copy. The mobile bundle check generated Hermes bundles for Android and iOS.

The repository-level `make ai-gateway-check` was attempted three times. The
first two attempts exceeded its fixed 20-second `go run` startup window under
concurrent native builds. After warming the Go cache, the Gateway started, but
the check correctly failed because a pre-existing service on
`127.0.0.1:6420` accepted a direct `/ai/actions` bypass with HTTP 201 instead of
the required upstream-auth HTTP 401. This is central devnet state outside the AI
product branch; it is not recorded as passed and was not mutated or hidden.

Current Android native evidence for APK `feca8446…501a5` on task-owned API 36
`emulator-5582`:

```text
adb install -r app-release.apk -> Performing Streamed Install / Success
ordinary launch, force-stop/restart -> MainActivity resumed
am start -W -a android.intent.action.VIEW \
  -d 'ynxai://wallet-auth/callback?error=cancelled' com.ynxweb4.ai \
  -> LaunchState: COLD, Status: ok
dumpsys activity activities -> topResumedActivity com.ynxweb4.ai/.MainActivity
```

The first debug install attempt exposed a development-bundle dependency and one
unstable emulator instance. It is not counted as product evidence. The bundled
release APK was then installed and cold-started successfully on the healthy
emulator with no fatal/runtime script error.

## Exact incomplete external items and integration requests

1. **Wallet registry integration:** Task 1's central document already has a
   disabled/pending-review AI tuple, but its three scopes do not match this
   product and the Wallet-side reviewed allow-list omits AI. The integration
   owner must review the supplied valid patch for exact client `ynx-ai-v1`,
   product `ai`, bundle `com.ynxweb4.ai`, callback
   `ynxai://wallet-auth/callback`, and scopes `ai:actions`, `ai:attachments`,
   `ai:conversations`, `ai:data-control`, `ai:generate`, `ai:permissions` before
   a real cross-App Wallet approval can succeed. This branch does not bypass the
   registry or fabricate approval.
2. **Central Gateway POST route:** this client now requires `POST /ai/stream` and
   never sends prompts in query parameters. The central Gateway in the baseline
   still registers only `GET /ai/stream`; its owning integration thread must add
   the authenticated POST-body equivalent before provider generation can work.
   Until then the client truthfully shows Gateway/provider failure.
3. **Provider metadata:** add authenticated provider catalog/capabilities, quota,
   actual provider token/resource charge and money metadata. Until supplied, one
   configured model is shown and quota/actual cost remain unknown.
4. **iOS native run:** the iOS project and bundle passed, but this host has no
   Xcode application or `simctl`. No iOS Simulator install/run is claimed. Run
   the checked-in project on an Xcode host and record bundle install, cold launch,
   callback routing and Arabic RTL evidence.
5. Supply production state path/key, private Gateway URL/key, Trust URL, provider
   name/rates, signing identities and deployment authority through intake. No
   production provider success, signed store artifact or production deployment
   is claimed.
