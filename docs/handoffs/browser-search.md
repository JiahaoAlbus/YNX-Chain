# YNX Browser & Search handoff

## Branch and commits

- Branch: `codex/ecosystem-browser-search`
- Baseline: `51bed843c5aa8dc53b2dc32b29cb8ca349ff0e95`
- Implementation commit: `54fad972b9dc28e49a2590fef19ded1d5c876136`
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
  document.
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
| `cd packages/web4-permissions && npm test` | pass: 5/5 |
| `cd apps/browser && npm run check` | pass: 6/6 tests, smoke pass, Swift release build pass |
| `cd apps/search && npm run check` | pass: 7/7 tests, smoke pass |
| local HTTP `/api/search?q=origin` smoke | pass; returned cited authorized fixture URL |
| `make no-placeholder-check` | pass |
| `make secret-scan` | pass |
| `make env-check` | pass |
| `npm run hardhat:build && npm run contracts:selectors && make test` | pass; generated contract artifacts remained ignored |
| `git diff --check` | pass |

The unsigned local WebKit release binary was built at
`apps/browser/native/.build/release/YNXBrowserNative` and had SHA-256
`cfb95afe70511be661cddd73077f0b64f6e1649a976ef0c1f1a7982482ab43a0` at
handoff time. `.build` is ignored. The in-app screenshot runner could not reach
the host-local loopback service because it runs behind a separate local-network
boundary, so no screenshot is claimed; responsive/accessibility structure is
covered by focused DOM/CSS tests.

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
