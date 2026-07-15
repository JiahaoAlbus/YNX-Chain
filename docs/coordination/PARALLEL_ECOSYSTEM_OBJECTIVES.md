# Parallel Ecosystem Objectives

This document supplies bounded objectives for independent Codex tasks. The main
task remains the integration authority. Product tasks implement and prove one
product; they do not declare the YNX Chain objective complete.

## Shared foundation for every product task

- Repository: `https://github.com/JiahaoAlbus/YNX-Chain`
- Base repository path: `/Users/huangjiahao/Desktop/YNX Chain`
- Baseline commit: `271197feb48fd362292fb2210887edf3109ce4f7`
- Chain: YNX Chain public testnet, chain ID `ynx_6423-1`, EVM chain ID `6423`
- Native coin and gas/resource asset: `YNXT`; `YNX` is the chain and brand only
- Canonical native account display: `ynx1...`; `0x...` is an explicit EVM
  compatibility representation of the same account bytes
- Product model: separate products, never a consumer super App
- Visual foundation: Klein blue `#002FA7` and white, restrained native hierarchy,
  platform-appropriate Apple-style interaction, accessibility, and recovery
- Official chain logo source: `/Users/huangjiahao/Downloads/ynx logo 扣过.png`
- Truth boundary: public testnet engineering exists; mainnet launch, exchange
  listing, wallet-default support, stablecoin issuer support, production signing,
  store acceptance, partnerships, and independent proof must remain false unless
  exact external evidence is supplied

Every task must use its own Codex worktree and the exact branch named below. Do
not edit another task's worktree. Do not modify the long-term goal file,
`docs/acceptance/GOAL_DIGEST.md`, `docs/acceptance/PROJECT_STATE.md`,
`docs/acceptance/NEXT_ACTION.md`, `docs/acceptance/FEATURE_COMPLETION_TRACKER.md`,
the root `Makefile`, or central Gateway policy. Put proposed central integration
changes in the task's handoff document for the main task to apply.

Every product task must:

1. Read `docs/ecosystem/PRODUCT_ARCHITECTURE.md` and this document.
2. Use real persistent domain state and existing chain APIs; no synthetic public
   counters, hardcoded transaction claims, invented users, empty feature cards,
   or nonfunctional routes.
3. Implement one complete primary workflow including loading, empty, failure,
   retry, authorization, privacy, recovery, and audit states.
4. Add focused unit/integration tests and product-local smoke/check commands.
5. Run the relevant tests plus `go test ./...` when Go code changes, and report
   every test that was not run.
6. Produce `docs/handoffs/<product>.md` with branch, commit, changed paths,
   architecture, test output summary, security boundaries, screenshots/package
   evidence where applicable, incomplete items, blockers, and exact integration
   requests.
7. Commit and push the named branch. Do not merge to `main`.
8. Tell the user: `子目标已完成，请让总控线程核验 <branch> <commit>` only after
   the code, tests, handoff, and push all succeed. Otherwise report the precise
   unfinished gap and keep the task active.

## AI-native rule for every product

Every product is AI-native, but AI must solve a real product workflow rather than
appear as the same generic chat box everywhere.

- Integrate through the permissioned YNX AI Gateway. Never embed provider secrets
  in an App, browser bundle, repository, log, prompt export, or handoff.
- Implement at least one complete, product-specific AI workflow: user intent,
  bounded context selection, data/privacy preview, model/provider status, resource
  or monetary cost estimate, explicit permission, streaming/cancel, result review,
  apply/reject, audit record, retry, provider failure, and appeal/correction where
  the result affects another user.
- AI may draft, summarize, classify, recommend, explain, search authorized data,
  or propose an action. It may not sign a transaction, transfer an asset, publish
  content, send a message, approve a governance request, freeze/seize an asset,
  change permissions, place an order, or execute code without the exact product's
  explicit approval policy and existing human/Wallet boundary.
- Per-product scopes and selected context must be least privilege. A product may
  not silently send contacts, private messages, files, recovery material, payment
  history, health/financial data, source repositories, or Trust evidence to a
  provider.
- Store provider/model, selected context classes, permission, resource usage,
  resulting action, reviewer and timestamps in an auditable record without
  storing secrets. Support revocation and deletion within the truthful retention
  boundary.
- Provider quota/unavailable states must be honest. A canned response, local demo
  string or unverified heuristic cannot be labeled provider-backed AI.

## Task 1: YNX Wallet and Sign in with YNX Wallet

Branch: `codex/ecosystem-wallet-auth`

Primary ownership:

- `apps/wallet/**` (create this independent product root)
- `packages/wallet-auth/**` (create a strict shared protocol package)
- `docs/handoffs/wallet-auth.md`

Objective:

Build the custody and identity foundation used by every YNX product. A user
opens YNX Wallet, owns or imports a native `ynx1...` account, and signs into a
separate product without typing an address or exporting a recovery key.

Required workflow:

- Wallet create/import/backup-confirm/lock/unlock/account switching.
- `Sign in with YNX Wallet` request versioning, one-time nonce, chain ID,
  requesting product, exact callback, requested scopes, issue/expiry time, and
  human-readable purpose.
- Exact allowlist for product/client/binding/callback/scopes; reject unknown
  fields, wrong chain, broad scopes, expiry above five minutes, replay, callback
  substitution, and product mismatch.
- Wallet authorization screen showing requester, scopes, network, account,
  expiry, approve, and reject. Approval requires the existing local biometric
  boundary where supported.
- Wallet signs only the account side. The requesting product keeps its own
  device key and completes the Gateway challenge, so callback interception
  cannot create a session and no recovery key crosses products.
- Persist Wallet secrets only in platform secure storage. Product credentials
  contain public account plus product device secret, never the Wallet account
  secret. Product sessions are revocable and bounded.
- Android and iOS deep-link parsing tests, replay tests, signer vectors, storage
  migration tests, and an Android emulator cross-app proof using separate Wallet
  and Social package IDs.
- Browser-extension architecture and permission contract may be specified, but
  do not claim a production extension until a signed installable artifact exists.

The main task will integrate Gateway registry changes after reviewing the exact
protocol and tests.

## Task 2: YNX Social

Branch: `codex/ecosystem-social`

Primary ownership:

- `apps/social/**` (create the independent product root)
- `internal/social/**` (new orchestration only; reuse Square and Chat contracts)
- `docs/handoffs/social.md`

Objective:

Deliver a coherent social product benchmarked against the complete workflows of
WeChat contacts/messages/moments and Instagram profile/feed/media interaction,
without copying protected branding or layouts. Normal users discover people by
`@handle`, contacts, profile QR, invite links, or recommendations, never by
typing a wallet address.

Required workflow:

- Sign in with YNX Wallet through the protocol contract from Task 1; use a strict
  temporary adapter until that branch is integrated, not a local recovery-key
  login.
- Profile, unique handle, avatar, bio, privacy, block/mute, contacts and requests.
- Direct and group conversations, device-aware E2EE state, delivery/read state,
  attachments with bounded type/size, message retry, and conversation search.
- AI-assisted reply drafts, conversation/thread summaries, translation, inbox
  organization and moderation explanation. Private context is opt-in per action;
  an AI draft is never sent automatically unless the user created a bounded,
  visible and revocable automation rule.
- Feed/moments publishing, media, comments, reactions, following, notifications,
  reporting, moderation outcome, Trust evidence link, and appeal entry.
- No Wallet, Exchange, Shop, Pay, or Network bottom navigation. Payment appears
  only as an explicit cross-product intent.
- Persistent backend additions, abuse/rate limits, restart/tamper tests, and
  Android/iOS product builds. Seeded fixture data is allowed only in isolated
  tests and must never be presented as public chain activity.

## Task 3: YNX Pay and Merchant Console

Branch: `codex/ecosystem-pay`

Primary ownership:

- `apps/pay/**`
- `apps/merchant-console/**`
- `internal/payproduct/**` (product orchestration around existing Pay API)
- `docs/handoffs/pay.md`

Objective:

Build a complete testnet payment loop: merchant onboarding, product/payment
request, payer review, Wallet approval, committed YNXT settlement verification,
receipt, refund/dispute state, webhook delivery, reconciliation, and merchant
analytics based on real records.

Required workflow:

- Consumer scan/deep-link/manual invoice lookup, exact merchant identity and
  amount review, fee disclosure, expiration, reject, Wallet handoff, pending and
  committed receipt.
- AI invoice extraction, merchant support drafting, reconciliation explanation
  and anomaly review with source records. AI cannot approve, sign, settle, refund
  or redirect a payment.
- Merchant catalog item or amount request, signed invoice, webhook endpoint and
  secret rotation, delivery retries, idempotency, reconciliation export, refund
  request, dispute, and Trust/appeal evidence.
- No simulated paid state. Paid requires the existing authoritative committed
  transaction verification. Cross-chain settlement remains unavailable until a
  real bridge route exists.
- Separate consumer App and merchant Web console with product-appropriate
  navigation, tests, smoke command, and truthful empty/unavailable states.

## Task 4: YNX Exchange

Branch: `codex/ecosystem-exchange`

Primary ownership:

- `apps/exchange/**`
- `internal/exchangeproduct/**`
- `docs/handoffs/exchange.md`

Objective:

Build a testnet exchange product benchmarked against Binance workflow breadth:
markets, asset/network selection, deposit, withdrawal review, orders, trade
history, fees, risk controls, account security, support, and proof surfaces.

Required boundaries:

- This is not an exchange listing and not a production custody venue.
- Use a deterministic testnet market engine with persistent orders/trades only if
  it is clearly an owned YNX test venue; never fabricate third-party liquidity,
  volume, users, or counterparties.
- Deposit/withdrawal must use canonical YNX network metadata, confirmation
  policy, real chain reads, exact idempotency, and explicit custody boundaries.
- Cross-chain deposit/withdrawal remains disabled until approved bridge adapters,
  relayer custody, asset routes, and external proof exist.
- Provide responsive Web/pro terminal and mobile product foundations, complete
  order lifecycle tests, restart/replay tests, and a reproducible smoke command.
- AI may explain markets, summarize owned account activity, surface risk evidence
  and draft an order. It cannot invent price/volume, provide unsupported return
  promises, place/cancel an order, withdraw, or change risk controls without the
  exact user approval workflow.

## Task 5: YNX Shop

Branch: `codex/ecosystem-shop`

Primary ownership:

- `apps/shop/**`
- `apps/seller-console/**`
- `internal/commerce/**`
- `docs/handoffs/shop.md`

Objective:

Build an Amazon-class workflow boundary for a YNX-native marketplace: buyer
discovery through settlement and post-purchase resolution, plus a separate
seller console. This means workflow completeness, not copied Amazon UI.

Required workflow:

- Buyer profile, search/filter, catalog/product/variants/inventory, cart,
  shipping address, order review, Pay invoice handoff, confirmed order, shipment,
  delivery, review, cancellation, return, refund request, dispute, and Trust link.
- Seller onboarding, catalog/inventory/order/fulfillment/return management,
  settlement records, policy and audit history.
- Persistent order state machine, inventory reservation, idempotency, no
  overselling under concurrency, restart recovery, authorization, and abuse
  controls.
- Do not mark an order paid without real Pay settlement evidence. Use explicit
  unavailable states for logistics, taxation, or external integrations that do
  not yet exist.
- AI may assist catalog creation, buyer search, comparison, support, fulfillment
  triage and return explanations using authorized records. Publishing, pricing,
  purchase, refund and seller-policy changes require explicit product approval.

## Task 6: YNX Developer

Branch: `codex/ecosystem-developer`

Primary ownership:

- `apps/developer/**`
- `packages/developer-client/**`
- `docs/handoffs/developer.md`

Objective:

Build a usable VS Code/Codex/Remix-class YNX developer product over the already
bounded chain execution surface. It must be a complete engineering loop, not an
editor mockup: projects, repository context, editor, source control review,
compile, tests, diagnostics, terminal/tasks, AI coding agent, deploy review,
Wallet signing, receipt/log inspection, source verification, RPC tools,
documentation and recovery.

Required boundaries:

- Do not expand bounded EVM opcode coverage or claim arbitrary Ethereum/EVM
  compatibility. Unsupported compilation/deployment paths must fail clearly.
- Use the pinned compiler/toolchain and existing real artifacts; no fake deploy
  success, transaction hash, logs, or verified-source badge.
- The AI coding agent can index only user-approved project files, answer with
  source references, propose patch diffs, explain diagnostics, generate tests,
  invoke allowlisted build/test commands, inspect results, and iterate. File
  writes require diff review; terminal commands expose command/cwd/environment
  class before execution; destructive/network/deploy commands require separate
  confirmation; transaction signing remains exclusively in YNX Wallet.
- Support provider/model selection through YNX AI Gateway, context inclusion and
  exclusion, token/resource estimate, streaming/cancel, conversation history,
  checkpoints, patch apply/reject/revert, command audit and provider-unavailable
  recovery. Never claim a test or deployment passed unless its process/chain
  evidence exists.
- Separate Web product from signed macOS/Windows distribution work. An unsigned
  local package is not a released desktop App.
- Add project persistence/import/export, diagnostics, terminal/task output,
  network status, Wallet authorization, deployment confirmation, receipt and
  source-match workflow, AI patch/command permission tests, tests, and packaging
  evidence.

## Task 7: YNX Explorer and Monitor

Branch: `codex/ecosystem-explorer-monitor`

Primary ownership:

- `apps/explorer/**`
- `apps/monitor/**`
- `internal/explorerui/**` only when server rendering support is necessary
- `docs/handoffs/explorer-monitor.md`

Objective:

Deliver two distinct products: a public TRONSCAN-class Explorer over canonical
`ynx-explorerd` live data, and an authenticated Grafana-class operator Monitor.
Both use Apple-style information hierarchy and motion while remaining dense,
fast, searchable, and operationally useful.

Required workflow:

- Explorer: real-time SSE with bounded fallback, blocks, transactions, accounts,
  contracts, validators, resources, tokens, governance, Trust, analytics, source
  verification, universal search, deep links, mobile responsiveness, and clear
  upstream/stale states.
- Monitor: node/validator/peer/release/SLO/incident/alert/log/rollback views,
  authentication, role separation, acknowledgement and audit state.
- Explorer AI can explain a selected real transaction, receipt, contract, resource
  or Trust record with linked evidence. Monitor AI can summarize a selected
  incident and propose a runbook step; it cannot acknowledge an alert, restart a
  service, rotate a key or execute rollback without operator approval.
- Never invent TPS, validators, transactions, token prices, balances, incidents,
  uptime, or market data. Empty and unavailable are valid states.
- Add component/data tests, accessibility tests, SSE reconnect tests, responsive
  screenshots, and Playwright checks against real local services. Public claims
  require fresh live endpoint evidence.

## Task 8: YNX AI

Branch: `codex/ecosystem-ai`

Primary ownership:

- `apps/ai/**`
- `internal/aiproduct/**`
- `docs/handoffs/ai.md`

Objective:

Build a separate AI client over the existing permissioned AI Gateway with
ChatGPT-class conversation usability: sessions, streaming, model/provider
status, tool/action review, usage and cost, data controls, audit, and appeals.

Required workflow:

- Sign in with YNX Wallet, create/rename/archive conversations, stream and cancel
  generation, retry, copy/export, inspect provider/model and resource cost.
- Explicit permission review for tools and chain actions; no AI action executes
  without the existing review/approval boundary.
- Show provider quota/unavailable states honestly. Never substitute a canned
  answer and label it provider-backed generation.
- Persistent conversation metadata with bounded encrypted content policy,
  permission/audit history, Trust/appeal link, unit/integration tests and smoke.

## Task 9: YNX Trust Center and Resource Market

Branch: `codex/ecosystem-trust-resource`

Primary ownership:

- `apps/trust-center/**`
- `apps/resource-market/**`
- `internal/trustproduct/**`
- `internal/resourceproduct/**`
- `docs/handoffs/trust-resource.md`

Objective:

Build two separate complete service windows over existing persistent APIs.
Trust Center handles evidence, request validity, illegal/overbroad rejection,
appeals, false-positive correction and transparency. Resource Market handles
balances, staking/delegation/rental, sponsored pools, pricing, income, history,
policy, revocation and disputes.

Required boundaries:

- Native YNXT cannot be directly frozen, seized, blacklisted, or transferred by
  a governance request. UI wording and tests must preserve this rule.
- Trust conclusions require evidence and explicit review state. No fake risk,
  hidden record, AI auto-punishment, or unsupported conclusion.
- Resource sponsorship moves bounded resource capacity, not user assets. Display
  exact owner, beneficiary, limits, expiry, source, fee and audit records.
- Add end-to-end case/pool lifecycles, role/authorization tests, persistence and
  replay tests, accessibility and responsive product checks.

## Second-wave independent products

These are separate products, not tabs added to Wallet or Social. They may be
implemented in parallel, but the main task integrates them only after the Wallet
authorization contract is accepted. Media and financial products also require
rights, moderation, custody, and jurisdiction boundaries before any production
claim.

## Task 10: YNX Music

Branch: `codex/ecosystem-music`

Primary ownership:

- `apps/music/**`
- `internal/music/**`
- `docs/handoffs/music.md`

Objective:

Build a separate streaming music product with Spotify/Apple Music-class workflow
coverage and YNX-native creator settlement evidence. Do not copy their UI,
catalog, artwork, audio, branding, or ranking data.

Required workflow:

- Sign in with YNX Wallet, listener profile, home/library/search, artist/album/
  track pages, playlists, favorites, queue, playback controls, history, downloads
  state, explicit-content controls, reporting, and account/privacy settings.
- Creator onboarding, owned/licensed audio upload, metadata/artwork, release
  state, rights declaration, takedown/dispute, usage records, revenue allocation,
  Pay settlement intent, and Trust evidence.
- Persistent catalog/library/playlist/playback-position state and a proven media
  engine. Tests may use repository-owned generated tones; public builds must not
  contain unlicensed commercial recordings or fabricated listeners/royalties.
- Royalty and payout status must derive from real usage and settlement records.
  No fake charts, streams, earnings, artists, or labels.
- AI may create playlists from the user's real library, improve owned metadata,
  assist discovery, draft creator descriptions and explain royalty records.
  Generated audio/artwork must be labeled with provenance and cannot imitate or
  claim rights to protected artists.

## Task 11: YNX Video and Creator Studio

Branch: `codex/ecosystem-video`

Primary ownership:

- `apps/video/**`
- `apps/creator-studio/**`
- `internal/video/**`
- `docs/handoffs/video.md`

Objective:

Build a separate YouTube-class video product and creator console: publishing,
discovery, playback, subscriptions, comments, moderation, analytics and bounded
YNXT monetization, without copying protected media or interface assets.

Required workflow:

- Upload/transcode/status, owned-content declaration, title/description/thumbnail,
  visibility, channel, subscriptions, playlists, search, adaptive playback,
  captions, history, comments, reporting, appeal and takedown states.
- Creator analytics from real records, explicit monetization eligibility, Pay
  receipt/payout intents, revenue audit and dispute state.
- Bounded object storage and media processing with quotas, malware/type/size
  checks, authorization, restart recovery, and abuse controls.
- Use only repository-owned test media. Never fabricate public views, watch time,
  subscribers, revenue, recommendations, copyright ownership, or partnerships.
- AI may summarize authorized videos, create chapters/captions, assist search,
  draft metadata and explain moderation. Publication, rights declarations,
  takedowns and monetization changes remain human-approved.

## Task 12: YNX Cloud and Docs

Branch: `codex/ecosystem-cloud-docs`

Primary ownership:

- `apps/cloud/**`
- `apps/docs/**`
- `internal/cloud/**`
- `docs/handoffs/cloud-docs.md`

Objective:

Build separate Drive-class storage and Docs-class editing products using shared
YNX identity and explicit file permissions.

Required workflow:

- Files/folders, upload/download, preview, search, recent/starred/trash/restore,
  versions, quota, offline/sync state, sharing, link expiry, access requests,
  revocation, audit and recovery.
- Document create/edit/autosave/version history, comments, mentions, bounded
  collaboration presence, export and conflict recovery.
- Client-side encryption boundaries, key recovery policy, object integrity,
  content size/type controls, malware scanning interface, persistence and
  authorization tests.
- Chain stores identity, permissions, hashes or settlement evidence where useful;
  it must not store arbitrary large file bodies. Never advertise unlimited or
  production-durable storage without measured infrastructure evidence.
- AI may summarize selected files, answer with file/version citations, draft or
  revise documents and organize a proposed folder plan. Users preview exact file
  context and diffs; AI cannot silently read the drive, share, delete or overwrite.

## Task 13: YNX Browser and Search

Branch: `codex/ecosystem-browser-search`

Primary ownership:

- `apps/browser/**`
- `apps/search/**`
- `packages/web4-permissions/**`
- `docs/handoffs/browser-search.md`

Objective:

Build a separate browser using a proven platform engine plus an explicit Web4
permission and Wallet-session layer. Build a bounded search product over sources
that YNX is authorized and technically able to index.

Required workflow:

- Tabs, history, bookmarks, downloads, private mode, site permissions, phishing
  warning, origin isolation, certificate/security information, update boundary,
  crash recovery, Wallet authorization and transaction review.
- Search query/results, source URL, freshness, filters, pagination, abuse removal,
  robots/source policy, correction/appeal and indexing status.
- Do not hand-roll a web engine. Use WebKit/Chromium platform components and
  prove permission isolation. Do not claim global-web index coverage, private
  browsing guarantees, phishing protection quality, or search neutrality without
  corresponding evidence.
- Browser AI may summarize the current authorized page, compare selected tabs and
  explain permission/signing requests. Search AI answers must cite indexed source
  URLs and distinguish retrieval from inference; it cannot silently transmit
  browsing history or Wallet identity.

## Task 14: YNX Finance

Branch: `codex/ecosystem-finance`

Primary ownership:

- `apps/finance/**`
- `internal/finance/**`
- `docs/handoffs/finance.md`

Objective:

Build a separate personal-finance and on-chain asset management product. It may
benchmark modern banking ergonomics, but must not be named or marketed as a bank,
deposit institution, broker, investment adviser, lender, or yield product unless
the required licensed entity and external approvals actually exist.

Required workflow:

- Wallet-authorized read-only portfolio, YNXT balance/activity, budgets,
  categories, recurring-payment reminders, Pay receipts, statements, export,
  privacy, security alerts and support/dispute links.
- Optional protocol modules must expose exact counterparty, custody, contract,
  principal-loss, fee, liquidity and jurisdiction risk before any signature.
- No promised return, fake APY, fake fiat balance, fake card, fake credit, fake
  insurance, fake custody, hidden leverage, automatic asset freeze, or unsupported
  cross-chain balance.
- AI may categorize owned activity, explain fees, draft budgets and surface
  anomalies with exact records. It cannot promise returns, recommend an action as
  guaranteed, sign, transfer, trade, borrow, lend or change account controls.

## Task 15: YNX Mail and Calendar

Branch: `codex/ecosystem-mail-calendar`

Primary ownership:

- `apps/mail/**`
- `apps/calendar/**`
- `internal/mail/**`
- `internal/calendar/**`
- `docs/handoffs/mail-calendar.md`

Objective:

Build separate mail and calendar products with YNX identity, product handles and
explicit sharing. Do not expose wallet addresses as ordinary contact identifiers.

Required workflow:

- Mail inbox/thread/compose/draft/send/search/archive/spam/block/report/attachment/
  delivery-failure flows, signed sender identity and account recovery.
- Calendar create/invite/RSVP/update/cancel/reminder/time-zone/recurrence/share/
  conflict/offline flows and bounded meeting links.
- Persistent delivery/event state, E2EE capability boundaries, anti-spam/rate
  controls, attachment checks, audit, Trust report/appeal and protocol interop
  boundaries. Do not claim internet-wide email delivery until DNS reputation,
  SMTP delivery, abuse handling and live proof exist.
- Mail AI may summarize selected threads, draft replies, translate and organize
  an inbox; Calendar AI may propose times, agendas and follow-ups. Sending mail,
  inviting people, changing an event or enabling automation requires visible,
  revocable approval and never exposes unrelated mailbox/calendar content.

## Integration order

The main task reviews and integrates in this order:

1. Wallet authentication protocol and product session boundary.
2. Social and AI identity consumers.
3. Pay and Trust/Resource cross-product intents.
4. Shop settlement integration.
5. Exchange custody/network boundary.
6. Explorer/Monitor observability across all accepted services.
7. Developer product against the exact accepted chain capability surface.
8. Music/Video rights and creator-settlement products.
9. Cloud/Docs and Mail/Calendar permission and recovery products.
10. Browser/Search isolation and source-policy products.
11. Finance only within the accepted non-bank, non-custodial boundary.

Integration order does not block parallel implementation. It controls when a
branch may be merged and publicly described as usable.
