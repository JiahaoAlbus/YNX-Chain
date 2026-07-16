# YNX Browser & Search handoff

## Branch and commits

- Branch: `codex/ecosystem-browser-search`
- Baseline: `51bed843c5aa8dc53b2dc32b29cb8ca349ff0e95`
- Implementation commit: `54fad972b9dc28e49a2590fef19ded1d5c876136`
- Platform/contracts continuation: the final pushed branch tip reported to the
  integration task
- Final handoff commit: the branch tip reported to the integration task
- Ownership stayed within `apps/browser/**`, `apps/search/**`,
  `packages/web4-permissions/**`, and this file.

## Delivered architecture

### Browser

- The release-buildable macOS host uses the system WebKit `WKWebView`, not a
  hand-written web engine. Standard tabs use the default WebKit data store;
  private tabs use `WKWebsiteDataStore.nonPersistent()` and are excluded from
  recovery/history persistence.
- Browser state atomically persists tabs, history, bookmarks, download records,
  crash recovery state and bounded audit entries. Private state is memory-only.
- `@ynx/web4-permissions` canonicalizes exact HTTP(S) origins, produces distinct
  origin partitions, validates supported site permissions, and keeps private
  grants off disk.
- The Chromium-compatible host implementation enables strict site isolation,
  sandbox/context isolation, disables Node access in page content, mediates
  permission requests by exact origin, stops configured phishing-list matches,
  and exposes certificate/security state without claiming complete protection.
- Wallet requests fail closed on unknown fields, chain mismatch, callback
  substitution, scopes, expiry above five minutes and replay. Transaction review
  shows native `ynx1...` sender/recipient, exact YNXT amount, fee, memo/data and
  contract-data warning. Browser approval returns a Wallet handoff only; the
  browser never signs.
- Browser AI supports authorized-current-page summary, selected-tab comparison,
  permission explanation and signing explanation contexts. Context selection
  rejects private tabs, history, Wallet identity and unrelated tabs. The Gateway
  flow exposes provider state, estimate, explicit consent, streaming/cancel,
  review and audit; absent Gateway configuration fails honestly.
- Update policy accepts only a newer semantic version with valid signature
  evidence. The compiled local binary is unsigned and is not presented as a
  distributed update.
- Android now has a source-buildable system-WebView application; iOS/iPadOS has
  a native WKWebView project; Windows has a WebView2/WPF feasibility host.
  `apps/browser/PLATFORM_EVIDENCE.md` separates actual build/parse evidence from
  signing, store and distribution work that has not happened.
- Shared product contracts cover 12 locales (`en`, `zh-Hans`, `zh-Hant`, `ja`,
  `ko`, `es`, `fr`, `de`, `pt`, `ru`, `ar`, `id`) and Arabic RTL. Localized
  security, signing and privacy text is tested not to fall back to stronger or
  misleading English-only semantics.

### Search

- A persistent JSON index registers only operator-authorized HTTPS sources with
  recorded authorization evidence and `respect` or evidenced override robots
  policy. Fetches are bounded by redirect policy, timeout, content type and
  2 MB response size.
- Query results expose the exact source URL, source label, published/fetched/
  indexed freshness, lexical score and a source snippet. Filters cover source,
  freshness and content type; pagination is bounded and deterministic.
- Index status distinguishes registered, robots check, indexing, ready,
  robots-blocked, disabled and failed. The UI states that coverage is limited to
  registered authorized sources and makes no neutrality/global-coverage claim.
- Removal, correction and appeal are persistent auditable cases. Appeals require
  an existing parent case; an accepted removal deletes the matching indexed
  document. The web UI now submits all three case types and returns the stored
  case ID plus the current central-Trust referral boundary.
- Search AI previews the exact retrieved source set, provider/model state and
  resource estimate before consent. Streaming requires Gateway citation metadata
  and rejects any URL outside the retrieved indexed set. Retrieval sources and
  inference are separate response fields; cancel, retry, accept, reject and
  correction-review paths are exposed and audited.

## Security and truth boundaries

- No provider, Wallet, signing, admin or deployment secret is in the repository.
- AI Gateway tokens stay server/operator-side. Page/private/history/Wallet
  context is not sent silently.
- Private browsing is not described as perfect: downloaded files, websites,
  networks, the OS and other software can retain activity.
- Phishing handling is only an exact configured-list warning and is not described
  as complete protection.
- Search does not claim global web coverage, neutrality, a production corpus or
  independent ranking proof.
- No production Wallet callback registry, AI Gateway binding, signed desktop
  distribution, notarization, public Search deployment or live authorized corpus
  is claimed.

## Verification evidence

| Command | Result |
| --- | --- |
| `cd packages/web4-permissions && npm test` | pass: 12/12 |
| `cd apps/browser && npm run check` | pass: 9/9 tests, smoke pass, macOS Swift release build pass |
| `ANDROID_SDK_ROOT=/Users/huangjiahao/Library/Android/sdk ./apps/browser/scripts/build-android.sh` | pass: API 36 compile/dex/align and v3 debug signature verification |
| `swiftc -parse apps/browser/ios/YNXBrowser/*.swift` plus `plutil -lint` | pass: all Swift syntax, Info.plist and Xcode project parse |
| `xmllint --noout apps/browser/windows/YNXBrowser.Windows/*` (XML/XAML/project files) | pass: Windows project structure parses; no Windows compile claimed |
| `cd apps/search && npm run check` | pass: 10/10 tests, smoke pass |
| local HTTP `/api/search?q=origin` smoke | pass; returned cited authorized fixture URL |
| local HTTP UI assets plus correction-to-appeal flow | pass; shared locale module served, cases persisted and parent linkage returned |
| `make no-placeholder-check` | pass |
| `make secret-scan` | pass |
| `make env-check` | pass |
| `make test` | pass: all root `cmd/...` and `internal/...` Go packages |
| `git diff --check` | pass |

The unsigned local WebKit release binary was built at
`apps/browser/native/.build/release/YNXBrowserNative` and had SHA-256
`81d0f008b35b97e8b3b494835d579b56255743381b7eeeca01b6250d54ecccda` at
handoff time. The ignored Android debug APK had SHA-256
`2e0e5d468776a454f16e150dcfe8c79c9285227073862b6e225044f7d9195f98`.
The available Android emulator had not completed package/activity service boot,
full Xcode is absent, and `dotnet` is absent, so Android launch, iOS build/run and
Windows compile/run are explicitly not claimed. Responsive/accessibility and
platform-contract structure are covered by focused tests; detailed evidence is
in `apps/browser/PLATFORM_EVIDENCE.md`.

## Focused test coverage

- Origin separation and persisted vs private permission decisions.
- Private tabs/history/download metadata and crash recovery exclusion.
- Wallet callback substitution, scope, chain, expiry and replay rejection.
- Exact signing-review fields and contract-data warning.
- Authorized AI context and rejection of private/history/Wallet data.
- Source registration, robots denial, freshness/filter/pagination and indexing
  status.
- Removal/correction/appeal linkage and audit state.
- Source citation, retrieval/inference split, consent, provider-unavailable and
  unindexed-stream-citation rejection.
- Semantic labels, live regions, focus visibility, reduced motion and responsive
  search layout.
- Twelve-locale key completeness, localized privacy/signing semantics, locale
  resolution, ICU formatting and Arabic RTL.
- Android/iOS/Windows mature-engine declarations, product identity, Wallet
  callback binding, secure device identity, private-store/profile and update
  boundary structure.

## Integration requests for the main task

1. Register distinct least-privilege Gateway clients/scopes for Browser and
   Search, and supply the reviewed Wallet callback/scope allowlist. Do not place
   those secrets or central policy changes in this branch.
2. Provide the operator-approved Search source inventory with authorization and
   robots evidence; an empty corpus is the correct state until then.
3. Route the Browser new-tab Search URL to the reviewed Search deployment, then
   add TLS/health/rollback evidence in the integration branch.
4. Connect the existing YNX AI Gateway streaming contracts and provider status;
   provider-backed success remains unclaimed until a real configured request is
   observed.
5. Apply Apple signing/notarization and signed update metadata before describing
   the macOS binary as distributed or update-ready.

No central Gateway policy, root Makefile, long-term goal or acceptance-state file
was edited.
