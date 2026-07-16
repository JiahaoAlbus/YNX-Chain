# YNX Developer handoff

## 2026-07-16 final desktop verification correction

This section supersedes stale counts, artifact names and desktop launch claims
later in the original handoff. The correction retains the previously accepted
IDE, pinned compiler, AI review, deployment, receipt/source-match and checkpoint
workflows, and adds the integration gates requested by total control:

- AI streaming is now `POST /ai/stream` with a bounded JSON body containing
  version, random session, product workflow, reviewed model, independent output
  language and prompt. Source/prompt text never appears in the URL. SSE remains
  streaming/cancellable and no provider result is synthesized.
- `DeveloperWalletSession` adopts Wallet Auth v1's exact product-device boundary:
  `ynx-developer-v1`, bundle `com.ynxweb4.developer.testnetpreview`, callback
  `ynxdeveloper://wallet-auth/callback`, sorted `account:read` and
  `developer:deploy` scopes, five-minute expiry, compressed P-256 device key,
  exact approval fields, persistent callback nonce consumption, replay/tamper/
  scope rejection, and two POST Gateway challenge/completion calls. The session
  token stays memory-only. With no reviewed central verifier/provider, sign-in
  fails visibly as unavailable and offers retry; no local-key fallback exists.
- The UI exposes interface locale plus a separately persisted AI-output locale.
  English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch,
  Português, Русский, العربية and Bahasa Indonesia are complete for the audited
  critical vocabulary. Locale auto-detection/manual override/restart persistence,
  `Intl` date/number/plural handling, Arabic RTL, nonblank fallback and localized
  Wallet/private-key/deployment/privacy/recovery/update class language are tested.
- macOS now has native File/Window/App menus, Cmd shortcuts, window-frame
  restoration/reopen behavior, sandboxed task execution, a bundled portable
  arm64 Node runtime, and a fail-closed signed update explanation. The package
  and bundle title explicitly say unsigned **Testnet Preview** and use
  `com.ynxweb4.developer.testnetpreview`. The extracted ZIP now passes resource
  self-test, strict ad-hoc signature classification, a real GUI cold start,
  bundled child-server observation and child cleanup after App termination.
- A native Windows WPF/WebView2 project supplies the same package identity,
  menus/shortcuts, file actions, persistent window geometry, dynamically chosen
  loopback port, bundled `Resources/runtime/node.exe` contract, startup readiness
  failure handling, `asInvoker` permission manifest and unsigned-update refusal.
  A dedicated structural source check verifies this boundary. It is source
  delivery only on this macOS host; no Windows compile, binary, install, signature
  or cold launch is claimed.

## Review identity

- Branch: `codex/ecosystem-developer`
- Worktree: `/Users/huangjiahao/Desktop/YNX Chain Developer`
- Declared objective baseline: `271197feb48fd362292fb2210887edf3109ce4f7`
- Actual branch point: current `main` at `51bed843c5aa8dc53b2dc32b29cb8ca349ff0e95`
- Review commit: the commit containing this handoff; the product task reports the
  exact pushed commit separately.
- Owned paths only: `apps/developer/**`, `packages/developer-client/**`, and this
  handoff.

The branch point differs from the older baseline written in
`PARALLEL_ECOSYSTEM_OBJECTIVES.md` because the requested independent worktree was
created from the current main checkout containing the coordination documents.
No rebase or merge was performed in this product worktree.

## Delivered product

YNX Developer is an independent, dense Web IDE plus a real local macOS package
boundary. It is not a Monaco shell and does not reuse VS Code or Remix branding.

The Web Product implements:

- bounded project creation and JSON import/export;
- IndexedDB persistence with strict path, file-count, per-file and total-size
  limits;
- file tree, source editor, line numbers, autosave, approved-file search and
  local diagnostics;
- checkpoint-backed source diff review, checkpoint creation and confirmed
  revert with audit events;
- exact Solidity `0.8.24`, optimizer-enabled, 200-run compiler validation and
  evidence-backed `/ide/compile` output;
- task/terminal command preview showing command, cwd, environment class and risk;
- read-only allowlisted YNX RPC Tools;
- integrated documentation for compiler, Wallet, AI, platform and recovery
  boundaries;
- Wallet-only deployment review, five-minute authorization intent, separate
  authorization and network approvals, Wallet sign-and-submit adapter, submitted
  versus confirmed states, authoritative receipt, logs query surface and source
  match evidence;
- AI Coding Agent approved-file context selection, privacy/byte preview,
  provider/model health, local token estimate, session-only Gateway access,
  streaming/cancel, source-reference instruction, provider result review,
  explicit machine-applicable file blocks, apply/reject, generated-test support,
  local conversation history, deletion audit, command audit and provider failure
  recovery;
- same-origin, body-bounded `/chain`, `/ai-gateway` and `/app-gateway` proxy prefixes for the
  local Web and desktop servers. Incoming browser headers are not forwarded
  wholesale.

`packages/developer-client` contains framework-independent state machines for
projects, persistence, diagnostics, commands, chain/RPC, AI and Wallet deployment
so the UI does not own security decisions.

## Workflow and truth matrix

| Workflow | Implemented evidence | Truth boundary |
| --- | --- | --- |
| Project create/import/export | bounded JSON format, deterministic templates, unit tests | export intentionally excludes AI history, audit and credentials |
| Persistence/restart | IndexedDB adapter and memory adapter, browser reload restored the project | browser-local, not collaborative server storage |
| File tree/editor/search | live Web interaction at desktop and 390 px | text editor, no claim of language-server completeness |
| Diagnostics | pinned pragma, SPDX and brace diagnostics plus authoritative compile output | local diagnostics never replace compiler evidence |
| Source control | full checkpoint before/after diff, checkpoint and confirmed revert | local checkpoint model, not remote Git status |
| Compile | live local chain returned pinned compiler config and artifact hash | unsupported compiler versions fail before request; bounded execution only |
| Tests/tasks/terminal | native desktop bridge syncs approved snapshot and streams real Node exit/output | Web Product is preview-only; no result is synthesized |
| RPC Tools | strict read-only method allowlist | mutating RPC such as `eth_sendTransaction` is rejected |
| Wallet deploy | exact adapter contract, review/authorization/final approval/receipt state machine and tests | unavailable without integrated YNX Wallet provider; Developer never falls back to `/ide/deploy` or stores a key |
| Receipt/logs/source match | authoritative RPC receipt and verifier evidence parsers | local matched evidence is not remote public proof |
| AI coding | Gateway health/stream client, least-privilege context, review/apply/reject/history/failure tests | no provider-backed success claimed because this run had no configured provider access |
| Recovery | persistence errors, unavailable upstreams, failed provider retry, checkpoint revert, desktop child cleanup | destructive recovery remains confirmed and audited |

## Desktop package evidence

`apps/developer/scripts/package-local-macos.sh` built and resource-self-tested:

- `.ynx-developer-local/YNX Developer Testnet Preview.app`
- `.ynx-developer-local/ynx-developer-testnet-preview-macos-unsigned.zip`
- tested ZIP SHA-256:
  `5f89cc7497a9f2c294af705159a1c7d4afa6abfcfbfe9bda8741ec0d48ea6154`
- code-sign classification: `Signature=adhoc`, `TeamIdentifier=not set`

The macOS linker and packaging step apply only an ad-hoc signature. This artifact
has no Developer ID/team identity, notarization, installer signature, update
signature, Windows binary, independent audit or distribution approval. It is the
**unsigned Testnet Preview** class and is not a signed production desktop release.
On this macOS host, the verifier extracted the ZIP into a new temporary install
directory, launched the real App process, observed its packaged Node child running
`Resources/server.mjs`, terminated the App and verified child cleanup. This is
local extracted-package cold-start evidence, not Gatekeeper distribution,
notarization, installed production release or signed update evidence.

The native command bridge accepts only `test` and `check`, validates project
paths and sizes, writes only the approved project snapshot, launches Node without
a shell, uses `sandbox-exec` to deny network and out-of-workspace writes, streams
real output, returns the real exit code and propagates cancellation.

## Visual and accessibility evidence

- Desktop Browser QA: dense four-column IDE, Klein blue `#002FA7`, visible
  project/editor/output/AI boundaries, real project creation and project reload.
- Responsive Browser QA: explicit 390 × 844 viewport, no page-width overflow,
  code editor retains intentional horizontal code scrolling, and the AI workflow
  remains accessible through a tested mobile drawer.
- Semantic landmarks, skip link, labeled editor/RPC/Wallet/AI controls, keyboard
  focus rings, reduced-motion support, contrast-aware status colors and mobile
  breakpoints are present.

## Security boundaries

- No Wallet private key, mnemonic, recovery material, provider secret, real
  `.env`, PEM or signing store is stored or logged.
- Gateway access is session-only in the UI and is not persisted or exported.
- AI sees only explicitly checked project files. Stored history records the
  approved path list, provider/model/status/result and audit metadata, not the
  Gateway token.
- AI writes require a second review and explicit `ynx-file path=...` blocks.
- Commands require preview plus approval; write-capable tasks require write
  approval. Network/destructive/deploy commands are not in the desktop command
  allowlist.
- Deployment has independent review, Wallet authorization and network approval
  gates. A transaction hash is only `submitted-unconfirmed`; success requires an
  authoritative successful receipt with a contract address.
- Source status distinguishes local source/bytecode evidence from
  `remotePublicProofStatus`. The UI never upgrades local evidence to public
  verification.
- Arbitrary Ethereum/EVM compatibility is never claimed. Unsupported compiler,
  RPC, Wallet and verifier paths fail explicitly.

## Checks run

Product-local checks:

- `cd packages/developer-client && npm test` — 16 tests passed, including POST
  privacy, Wallet binding/replay/tamper, all locales, RTL and persistence.
- `cd apps/developer && npm test` — 7 tests passed.
- `cd apps/developer && npm run check` — passed.
- `cd apps/developer && npm run build` — passed.
- `cd apps/developer && npm run live-check` — real local chain `6423` / `YNXT`,
  compiler `0.8.24`, artifact hash returned, mutating RPC rejected.
- `cd apps/developer && npm run proxy-check` — same-origin `/chain` proxy passed.
- `cd apps/developer && npm run desktop:sandbox-check` — 2 tests passed;
  network and out-of-workspace writes denied.
- `cd apps/developer && ./scripts/package-local-macos.sh` — built, resource
  self-test passed, strict ad-hoc classification verified and SHA-256 emitted.
- `cd apps/developer && ./scripts/verify-local-macos-package.sh` — extracted ZIP
  signature, bundled runtime, real App cold start and child cleanup passed.
- `cd apps/developer && npm run desktop:windows-source-check` — WPF/WebView2,
  identity, `asInvoker`, bundled runtime, loopback readiness, cleanup and
  unsigned-update source boundaries passed; no Windows build was claimed.
- In-app Browser desktop project create/reload and 390 px responsive interaction
  checks — passed after correcting the mobile AI activity-rail clipping issue.

Repository gates:

- `make test` — passed after the repository's ignored Hardhat artifacts and
  selector metadata were generated with the pinned toolchain.
- `make no-placeholder-check`, `make secret-scan`, `make env-check`, and
  `make objective-state-check` — passed.
- `PATH='/usr/bin:/Applications/ChatGPT.app/Contents/Resources:/opt/homebrew/bin:/bin:/usr/sbin:/sbin' make preflight` — passed in the repository's native
  one-clean-local-chain-per-check model, including Android/iOS Hermes bundles.
  The explicit PATH selects working system Python 3.9 while retaining Codex `rg`
  and Homebrew Node/Go. An initial run with the previous optional
  `GOMAXPROCS=1` setting exceeded a 15-second `go run` health window under host
  load; after warming the Go cache, the unmodified full preflight passed without
  that non-required single-core restriction.

## Incomplete/external boundaries

- No signed macOS/Windows production release exists. Windows source was not
  compiled or launched on this macOS worktree. The macOS extracted unsigned ZIP
  cold-launched locally, but no Developer ID, notarized installer, Gatekeeper
  distribution, signed updater, Windows build or installed production claim is
  made.
- No public Web deployment was performed. Static hosting must supply equivalent
  authenticated `/chain` and `/ai-gateway` routing.
- No real provider-backed AI response was requested because no operator Gateway
  access token/provider configuration was supplied. Provider-unavailable behavior
  and streaming protocol are covered by tests.
- No real Wallet transaction was signed or deployed. The exact reviewed Wallet
  Auth envelope is implemented, but the central registry/verifier and injected
  Wallet-only provider remain outside this product branch. The UI and client fail
  closed instead of using the unsigned local `/ide/deploy` shortcut.
- No remote public source-verification badge is claimed.
- Collaboration/server persistence and production language-server breadth are
  later product work, not represented by empty UI.

## Exact central integration requests

1. Register the exact `ynx-developer-v1` binding, bundle, callback and scopes in
   the central Wallet registry, verify the canonical P-256 Gateway completion,
   and expose authenticated same-origin `/app-gateway` routing.
2. Expose a Wallet provider equivalent to:
   `getProductDevicePublicKey(clientId)`, `authorize(exactRequest)` and
   `signProductChallenge(exactChallenge)`, plus deployment methods
   `authorizeDeployment(exactReview)` and
   `signAndSubmitDeployment({review, authorization})`. It must bind client,
   callback, account, chain, artifact, constructor args, nonce and expiry; verify
   request identity; show Wallet review; sign/submit inside Wallet; and return no
   secret material.
3. Map the Wallet deployment submission to the accepted signed YNX transaction
   path. Do not connect this UI to plain `/ide/deploy`, because that endpoint does
   not prove Wallet-only signing.
4. Make the central AI Gateway accept the exact POST-body Developer workflow;
   do not restore prompt-bearing query transport. Supply production hosting/
   desktop update/signing work only after exact source,
   artifact checksum, Developer ID/Windows certificate, install, cold-launch,
   update and rollback evidence is available.
5. Do not update central acceptance/product claims until the integration task has
   rerun Wallet, provider, public TLS and remote source-proof checks.
