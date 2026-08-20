# P0 Financial Apps connectivity inventory — 2026-08-20

Scope: Finance, Exchange, DEX, Pay and Quant product clients only. This is a recovery/protection inventory, not a new shared protocol or a migration. No app binary was uploaded or promoted.

## Finance Wave B active checkpoint — 2026-08-20

This section supersedes the pre-activation observations below for **Finance only**. The Integration branch was fetched again immediately before the migration: Financial Apps holds the active heavy lease and `apps/finance/**` path lock. Exchange, Pay, DEX and Quant remain `RESERVED`; they were not edited.

| Contract / boundary | Consumed Finance value | Result |
| --- | --- | --- |
| DApp Connect SDK | `@ynx/dapp-connect-sdk@0.1.0-p0.0`, source `315897e75c0ffe3e63435fe73cfec42244b851cc`, vendored immutable tarball SHA-256 `4a3c47f017a6932015686f20adfd29990a8c317ffdbb3f6fc5c4c9f16be5bc53` | Mobile and browser connection layers use `StandardWalletConnection`; the tarball is tracked in the Finance product. |
| Endpoint manifest | accepted `1.0.0-p0.2`, Integration source `fa0ffd9bbbcc831438078be8e19cebff51b07e5e`, payload SHA-256 `3c606cad1d9bfa71fc507f54b6ad8184a6580c7df75440675b5db921b7e67bb5` | Exact JSON is bundled at `apps/finance/mobile/contract/public-endpoint-manifest.json`; the build runs SHA-256 verification before export. |
| Product API / private session | Finance API `PENDING`; app gateway / Product Session `UNAVAILABLE` in the accepted manifest | No Finance product or private-session request is sent. The UI returns `API_UNAVAILABLE` / `PRODUCT_SESSION_UNAVAILABLE`, retaining Standard Wallet Connection. |
| Removed product logic | P-256 key creation, device proof, Gateway challenge, direct `/sessions/complete`, callback parsing, custom Wallet session persistence, hard-coded Finance API/Gateway | Removed from Finance mobile and browser runtime paths. No recovery material or product proof is retained by Finance. |

### Evidence generated locally

- Finance Web: 15 tests passed; security gate and Go smoke passed.
- Finance mobile: strict typecheck, 7 tests, exact-manifest verification and Android/iOS production bundle export passed.
- Public endpoint probe: REST health and Explorer health returned YNX Testnet identity; EVM JSON-RPC `eth_chainId` returned `0x1917`. A repeat EVM `/health` TLS attempt timed out, so Finance retains the manifest's declared endpoint classification and does not claim a fresh independent EVM-health verification.
- Android candidate: `app-release.apk` was built and installed on `emulator-5560`; package `com.ynxweb4.finance`, version `1.2.0` / code `3`, and `INTERNET` permission were verified. APK SHA-256: `11ca48ff426dd38e68a85f0aa74ca666014da9705e2be2b16c199dfe1bda8328`. It is v2-signed with a newly generated **local Android Debug** certificate (certificate SHA-256 `ee4723ec15eb545dd6fa8975c6d71a15364c2135d587f8363987caeae6bc1aea`); it is not production-signed, hosted, or uploaded.
- Android cold-start visual evidence is incomplete: the existing emulator was locked by the OS credentials confirmation activity immediately after install. No credential bypass was attempted and no screenshot is represented as a Finance UI capture.

### Release handoff and current blockers

1. **Website/download upload:** Integration owns the website release registry and download paths. Do not upload the local debug APK or re-upload an older Android/Windows package. A production signing authority, hosted artifact transaction and central registry entry remain required.
2. **Windows:** Finance has no Windows packaging source (`.exe`, `.msi`, `.msix`, Electron or Tauri project) in this worktree. The request to re-push a Windows installer must be handled by the owning desktop product/integration release pipeline with a newly verified binary, never by relabelling an old archive.
3. **Private Finance features:** blocked truthfully by accepted manifest state (`finance=PENDING`, Product Session unavailable), not by Wallet connection. A later accepted product API endpoint and platform EIP-1193 bridge/WalletConnect installed-client evidence are needed for signed connection E2E.
4. **Next product:** Exchange / Pay / DEX / Quant path locks remain `RESERVED`; no source changes are authorized until Integration activates the next one-product lock.

## Activation read

Central P0 status was re-read from the Integration control plane at 2026-08-20:

| Required condition | Current result |
| --- | --- |
| `heavy.owner = financial-apps` | no — `wallet-platform` retains the accepted checkpoint lease; Financial Apps is Wave B `READY_FOR_INDEPENDENT_OWNER` |
| `dappConnectSDK = ACCEPTED` | yes — `0.1.0-p0.0`, source `315897e75c0ffe3e63435fe73cfec42244b851cc` (PR #105) |
| `walletTransport = ACCEPTED` | yes — `p0-wallet-connection-v1`, source `66003e76e804da16d472255efde50cb879055b96` (PR #104) |
| `endpointManifest = ACCEPTED` | no — `CANDIDATE_NOT_ACCEPTED`; public endpoint verification blocked |
| error contract accepted | yes — `p0-wallet-connection-v1` Wallet Protocol contract |

Therefore P0 heavy migrations, SDK adoption, release builds, installer uploads and official-download changes remain prohibited by the user's five-condition activation rule. The product source remains protected and unchanged by this inventory.

## Branch and delivery inventory

| Product | Protected worktree / current head | Public/runtime or artifact observation | P0 migration priority |
| --- | --- | --- | --- |
| Finance | `finance-suite` / `c38726238cf81fae870454217843613a3b285bbe` | Android package is recorded in `apps/finance/product-release.json`; Finance has Android and iOS native clients. Current installed-client connectivity has legacy direct Wallet/Gateway logic. | 1 |
| Exchange | `07-exchange` / `a8f05cd15bef0975ea002ad5e6bf2905b544c735` | Public web health is declared at `https://exchange.ynxweb4.com/api/health`; Android and iOS clients exist. | 2 |
| Pay | `04-pay` / `53eb677c0e41d1ddf73d7faa105958181dc29236` | Android/iOS client exists; its worktree has untracked generated `dist-public` and `dist-web` artifacts, left untouched. | 3 |
| DEX | `27-dex` / `acee458bdf19bd460d73a20ddfb3ed62cb9da80f` | Public DEX health is declared at `https://dex.ynxweb4.com/health`; current product shell is PWA/web only. | 4 |
| Quant | `08-quant-lab` / `5cd5a9a9efc2883f6e1fab7378bee7e581cf38d6` | Public web health is declared at `https://quant.ynxweb4.com/api/health`; older macOS and unsigned Windows archives are hosted but do not match the newer public runtime source. | 5 |

Open product PRs include Finance #86, Exchange #88, DEX #85/#91, Pay #48 and the archived Quant candidate metadata. No product is collapsed into a combined P0 PR.

## Connectivity and duplication findings

| Product | Platforms presently represented | Blocking migration findings |
| --- | --- | --- |
| Finance | Web/PWA, Android, iOS, API | Dedicated web and mobile Wallet flows directly create challenges, persist callbacks and call Gateway completion. Development examples contain loopback URLs; reviewed public action URLs are also hard-coded. |
| Exchange | Web/PWA, Android, iOS, API | Dedicated mobile/web Wallet code and vendor Wallet Auth copy; public API callbacks are embedded. Needs SDK adapter replacement without changing exact order semantics. |
| Pay | Web, Android, iOS, API | Existing Wallet/Auth dependencies and local/test endpoint material require manifest-based selection. No generated artifact may be promoted before the accepted manifest. |
| DEX | Web/PWA, API | Browser Wallet and callback routes are product-local. No Android, iOS, macOS or Windows client is presently represented, so none can truthfully be re-uploaded as a new P0 build. |
| Quant | Web/PWA, macOS, Windows, API | Product-local Wallet Auth vendor and desktop endpoint configuration exist. Hosted Windows build is unsigned and has no recorded cold-start verification. |

The scan found Wallet/Gateway-related implementation files in all five products (Finance 22 files, Exchange 29, DEX 6, Pay 9, Quant 20); this is a migration queue, not proof that every result is a duplicate. The accepted SDK scanner must make the authoritative classification.

The accepted SDK migration scanner was subsequently run against each product. It classified Finance `wallet.ts` as generic Device Proof/local-session-fallback work; Exchange's vendor evidence as legacy Ed25519 session material; Pay test material as legacy Ed25519 session material; and Quant's web wallet entry as an unsafe relative API. Loopback findings in test/dev scripts and operations documentation are local harness/documentation debt, not public endpoint proof. These results are queued for per-product cleanup only after the accepted endpoint manifest unblocks activation.

## Artwork inventory

Finance, Exchange and Pay each have Android/iOS icon and splash assets. DEX has web SVG/maskable icons. Quant has a web logo but no independent Android/iOS asset set. None currently demonstrates the complete P0 independent artwork package (vector motif, app icon, adaptive/monochrome icon, splash, installer cover, screenshots, manifest and hash) for every platform.

## Installed-client networking audit

| Product/platform | Current evidence | Required P0 closure after activation |
| --- | --- | --- |
| Finance Android | `INTERNET` permission and HTTPS/custom-scheme callback filters are present; no APK/AAB is checked into the product source. | Bind an accepted manifest, verify App Link host/path, DNS/TLS, health/version/schema/min-client and restart/reconnect before a new upload. |
| Exchange Android | `INTERNET` permission and HTTPS/custom-scheme filters are present; no artifact is checked in. | Add SDK Standard Connection and manifest-bound endpoint selection; verify the exact Wallet order flow on-device. |
| Pay Android | `INTERNET` permission and HTTPS/custom-scheme filters are present; no artifact is checked in. | Bind receipt recovery and faucet return to accepted SDK/deep-link paths, then perform device install/restart evidence. |
| DEX | There is no Android/iOS/desktop client source in the product worktree, only a web/PWA shell. | Do not imply an installable DEX app; first establish a supported client and its manifest/artwork/release process. |
| Quant Windows | The only hosted Windows artifact is an unsigned cross-compiled ZIP from `70382c37`; it has no Windows cold-start verification and differs from public runtime source `44328648`. | Replace only after accepted manifest binding, real Windows install/cold-start/reconnect evidence, source/artifact identity match and a truthful unsigned/testnet classification unless production signing is separately authorized. |

Loopback endpoints in Quant desktop and E2E scripts are local-test harnesses, not proof of a public installed-client transport. They must not be copied into an accepted production manifest.

## Current test checkpoint

| Product | Command | Result |
| --- | --- | --- |
| Finance | `npm test --prefix apps/finance` and `npm test --prefix apps/finance/mobile` | pass: 15 web + 6 mobile |
| Exchange | `npm test --prefix apps/exchange` | pass: 11 |
| DEX | `npm test --prefix apps/dex` | blocked in the current Node 26 test environment: the global `localStorage` is undefined and six App tests fail before assertions; 11 non-App tests pass. No source change is retained before the P0 owner lease is activated. |
| Pay | `npm ci --prefix apps/pay && npm test --prefix apps/pay` | pass: 14 using Pay's own locked `@noble/curves` dependency rather than the incompatible root installation |
| Quant | `npm test --prefix apps/quant-lab` | pass: 9 |

## Activation-ready migration sequence

After every central checkpoint, reread the campaign, assignment, locks, leases and accepted-contract records. Only if all five activation conditions are accepted:

1. Finance: replace product-local connection/session/callback code with the accepted SDK; preserve public reads when Product Session is unavailable and surface source/as-of/coverage/error.
2. Exchange: use Standard Connection for exact Wallet-approved actions and optional Product Session for private account/order data; preserve market data under private-session degradation.
3. Pay: use Standard Connection for exact payment intent and Product Session only for private history; validate authoritative receipt after return/restart.
4. DEX: use Standard Connection for approval and exact swap intent; leave public pools/tokens readable and do not represent routing as executable without product evidence.
5. Quant: keep the engine/mandate boundary; no private key or withdrawal capability; keep kill/revoke and private API rejection while Standard Connection survives Product Session degradation.

Each product then gets a separate commit and candidate PR, endpoint-manifest binding, platform permission checks, Android/iOS/Desktop network/restart/reconnect evidence, artwork manifest/hash, fresh package SHA-256, and only then a truthful public download entry. Shared SDK, Wallet, Gateway Kernel and Central Registry changes remain proposals for their owners.
