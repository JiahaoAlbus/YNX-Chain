# YNX Wallet and canonical Wallet Auth handoff

Handoff date: 2026-07-22. Owned branch: `codex/final-wallet-auth`. Worktree: `/Users/huangjiahao/Desktop/YNX Final Worktrees/02-wallet-auth`. Recovery source: preserved `codex/ecosystem-wallet-auth` tip plus its six byte-for-byte verified dirty artifacts.

## Git and ownership

- Preserved starting/remote branch tip: `efe827f467107e23482289a5b1f69ac9ff83e694`.
- Merge base: `b281376eac6fe3cf1ffa8c4b5a44e3546302791f`.
- Compatibility reference observed on `origin/main`: `719e1018267ed5a53e6fae5211c5fd8a1503c35c`.
- Recovered hosted-artifact source commit: `da82c8b07b72b615ccb24b86a2a7ac66ee85b4d8`. Current protocol/product source commit: `31de114bf9944dc89b3d4dea4d7f7abd92b018ba`. The final release-record/handoff commit is reported to the controller because a commit cannot contain its own hash.
- Owned changes are limited to `apps/wallet/**`, `packages/wallet-auth/**`, this handoff and `.github/workflows/wallet-ios.yml`. No central acceptance file, long-term objective, root Makefile or other product source was modified.

## Honest delivery state

| State | Value | Evidence/boundary |
|---|---:|---|
| implemented-local | true | Independent Wallet, canonical lifecycle, Signed Intent, Smart Account policy, mandate/capital and Credential candidates |
| tested-local | true | Wallet 23/23 and SDK 54/54 plus typecheck/product-check pass on the recovered final branch |
| installed-local | Android true; iOS Simulator true | API 36 phone/foldable installed and cold-launched; macOS 15/Xcode 26.3 CI installed and cold-launched the unsigned iOS Simulator app |
| integrated-central | false | Version 3 candidate exists; not merged into/deployed by central Gateway |
| deployed-staging | false | No staging endpoint or version health exists |
| deployed-public | false | No product public deployment exists; public chain RPC use is not product deployment |
| download-hosted | true | GitHub prerelease hosts the exact test-signed APK and unsigned Simulator app with hashes |
| production-signed | false | Android is local test-signed; no Apple product archive |
| store-released | false | No store submission or approval |

## Product identity and information architecture

- Product ID: `wallet`; Android/iOS ID: `com.ynxweb4.wallet`; scheme: `ynxwallet`.
- Network: native `ynx_6423-1`, EVM compatibility chain ID `6423`, native asset `YNXT`.
- Default address is `ynx1...`; `0x...` is accepted only at the internal wire/conversion boundary or an explicitly labelled EVM compatibility view.
- Wallet surfaces are Welcome/Create/Import/Recover, Locked Home, Accounts, Assets/Activity, Receive, biometric Send Review, Authorization Review, Connected Apps, Sessions, Devices, Recovery, Security, Audit and Network. There is no Social, Pay, Shop, DEX or other business navigation.

## Self-custody and native transfer

- secp256k1 account creation/import, strict 64-hex recovery material, deterministic `ynx1` derivation, multiple accounts, explicit switch, removal confirmation and offline lost-device recovery.
- Public manifest and each secret use separate strict storage entries. Secrets use `WHEN_UNLOCKED_THIS_DEVICE_ONLY`; process restart/background starts locked. Strong biometrics gate unlock, import, recovery, signing, authorization, revocation and deletion. New recovery material disables capture and requires exact backup confirmation.
- Restart re-derives every public identity; unknown/missing/mismatched/tampered storage fails closed. Migration discards the legacy cross-product device secret.
- Native transfer is exact version 1 / chain 6423 / type transfer / fee 1, canonical JSON, current authoritative nonce, compressed secp256k1 public key and deterministic low-S DER signature. The JS vector equals the Go vector and rejects account/field/JSON/signature tamper.
- Live testnet proof used the public scalar-1 test vector only: signed hash `0x7bdf19361936215c8bc753696ce61d78ed089f755eac2d8af5cbfbcb1fdc94b2`, amount 1, fee 1, nonce 2. The authoritative account then returned balance 87 and nonce 2.

## Canonical protocol candidate

Transport remains `ynxwallet://authorize?request=<base64url(canonical JSON)>`. The strict pipeline is:

1. Authorization Request
2. Wallet Approval
3. Product Device Challenge
4. Gateway Completion
5. Product Session
6. Introspection
7. Revocation

The final session binds version, chain, product, client, bundle, callback, device algorithm/key/binding, account, exact ordered scopes, nonce, purpose, request digest, approval digest, session binding, issue and expiry time. Unknown fields, callback state/substitution, scope expansion/reorder, wrong product/account/device, expiry, replay, tamper and cross-App reuse fail closed.

`CentralWalletSessionStore` is a runnable reference for an atomic completion: nonce/request/challenge consumption and session/audit creation occur in one state transition. Restart validates snapshot shape, consumption coverage and audit hash continuity. Introspection requires the exact client, bundle, device and requested scopes.

Revocation boundaries are:

- session binding: one session;
- approval digest: all sessions derived from one Wallet approval;
- product device binding: all sessions for that exact product device;
- account logout watermark: every account session issued at/before the all-devices logout.

## Version 3 central registry candidate

`packages/wallet-auth/central-registry.json` contains exactly 25 sorted products: Wallet, Social, Pay, Merchant Console, Card, Exchange, Shop, Seller Console, Developer, Explorer, Monitor, AI, Trust Center, Resource Market, Music, Video, Creator Studio, Cloud, Docs, Browser, Search, Finance, Mail, Calendar and DEX.

Every entry has an exact product ID, requesting product, client, bundle/package, callback list, sorted least-privilege scopes, `maxScopes`, permitted device algorithms, session duration and revocation policy. There are no wildcard values. All entries are `pending-review` and disabled; schema validation refuses enablement without `approved` review status. The Wallet locally reviews only the exact observed Social, Pay and Card tuples while the central candidate remains disabled.

The canonical Social tuple is now `ynx-social-v1` / `com.ynx.social` / `ynx-social://com.ynx.social`, matching the independent Social worktree. All executable fixtures, deterministic vectors and the Android proof harness use that tuple. `registry-conflict-evidence.json` is the only retained record of the deleted `com.ynxweb4.social` / `ynxsocial://wallet-auth/callback` fixture and the legacy central Ed25519/session contract. It is conflict evidence, not an accepted runtime alias or deployment claim. Exact migration, verification and rollout requirements are in `CENTRAL_INTEGRATION.md`.

## Cross-App evidence

- The Android proof harness is a separate `com.ynx.social` package and uses `ynx-social://com.ynx.social`. It owns a non-exportable Android Keystore P-256 key and performs strict schema, callback, Wallet secp256k1 signature, account derivation, device challenge, expiry and replay verification. The harness builds successfully against API 36. The previously captured installed session/replay images predate the Social identity normalization and are retained only as historical visual evidence; executable current-identity proof is the harness plus shared vectors/tests until the controller runs the independent Social app against a deployed Gateway.
- New shared tests complete the exact Pay and Card tuples through Wallet approval, device challenge and product-bound session. Tests reject callback interception, approval/request substitution, scope expansion/reorder, expiry extension, cross-App token use and wrong device/account/introspection.
- A central deployment and second installed Pay/Card binary are not claimed. The shared vectors/SDK are the integration contract until the controller merges and deploys the lifecycle.

## Localization, accessibility and visual evidence

Runtime catalogs: en, zh-CN, zh-TW, ja, ko, es, fr, de, pt, ru, ar and id. Onboarding, locked state, primary account actions and authorization safety copy no longer fall back to English in the eleven translated catalogs. Device locale detection/manual persistence, Arabic RTL, `Intl` dates/numbers/YNXT/plurals, system light/dark, high-text-contrast palettes, reduced-motion sheets, font scaling, screen-reader labels/roles/state and touch targets are tested.

Installed evidence includes English phone/light, Arabic main/selector RTL, dark + 1.3× font + RTL, a 2076×2152 foldable/unfolded surface and the Xcode 26.3 iPhone Simulator fail-closed deep-link screen. The three pre-normalization authorization/session/replay images are explicitly historical rather than current canonical identity evidence. Hashes/sizes are in `apps/wallet/artifact-manifest.json`; design findings are in `UI_DESIGN_AUDIT.md`.

## Verification performed

- `packages/wallet-auth npm test`: 30/30 pass; `npm pack --dry-run` includes central docs, registry, conflict report, schemas and vectors.
- `apps/wallet npm run check`: typecheck, 23/23 tests, product boundary check, Android/iOS Hermes exports pass.
- `apps/wallet npm audit --omit=dev --audit-level=high`: pass with no high/critical; ten moderate Expo build-tool findings documented. SDK audit: zero findings.
- `npm run hardhat:build && npm run contracts:selectors && go test ./...`: pass after generating the repository's ignored contract fixtures.
- root `make test`: pass.
- root `make preflight`: pass after using the host's working `/usr/bin/python3` and creating the ignored `tmp/` directory required by the existing Exchange fixture; the default third-party Python installation is killed by macOS before startup.
- Android SDK 36 `assembleRelease`: pass, 352 tasks. Final APK is 78,035,858 bytes, SHA-256 `3d7dd0b349721f2364a2ec0519269bee2933c8b718ba26fc68e7e3354ae15256`.
- API 36 phone install: success; cold launch 2140/2274 ms and second cold launch 477/513 ms, focused MainActivity verified.
- Pixel 9 Pro Fold install: success; 2076×2152, cold launch 15082/15742 ms.
- iOS: Android/iOS Hermes exports pass; all iOS plists pass `plutil`. GitHub Actions run [29646381701](https://github.com/JiahaoAlbus/YNX-Chain/actions/runs/29646381701) passed SDK/Wallet checks and pods, built with Xcode 26.3, booted an iPhone Simulator, installed the unsigned Release app, cold-launched `com.ynxweb4.wallet`, routed a malformed `ynxwallet://authorize` URL to the fail-closed rejection UI, captured a screenshot and uploaded the app/evidence artifact. This host still has CommandLineTools only.
- Dependency/license boundary and the reproducible 431-component CycloneDX review SBOM are documented in `DEPENDENCY_REVIEW.md`. Four Expo override tree errors keep release-grade completeness false; package locks remain authoritative.
- `git diff --check`, owned-path, secret/placeholder and final worktree checks are rerun before push.
- Smart Account policy/mandate/Credential/Signed Intent gates cover property/fuzz/fault, 10,000 sponsorship evaluations, 5,000 Credential parses, 2,000 signed export verifications and a 20,000-evaluation sponsorship benchmark. The new Solidity account additionally executes owner, UV-required WebAuthn and bounded-session UserOperations through the official EntryPoint on local Hardhat EDR, rejects missing UV/wrong target/over-limit/post-recovery sessions, and runs a 50-operation soak.
- The default-disabled Paymaster executes local first-action, merchant, developer and product sponsorship, conservatively reserves product/subject budgets, observes postOp cost, rejects tamper/replay/second-first-action/unapproved target and restricts Risk Officer authority to disabling. The ERC-7769 adapter adds strict health/estimate/send/lookup/receipt with 4 dedicated tests and a 100-request isolated-fixture soak. Neither is deployed publicly.
- Canonical Gateway adapter: 7 tests covering server-authoritative registry selection, P-256 HTTP proof binding, replay, restart/revoke and 2,000 unique proof operations; the local 1,000-sample benchmark measured p50 2.931 ms, p95 3.318 ms, p99 4.208 ms, zero errors and 333.48 operations/second without network or disk latency.

## Artifact record

- Android release APK: test-signed, min API 24, 78,035,858 bytes, SHA-256 `3d7dd0b349721f2364a2ec0519269bee2933c8b718ba26fc68e7e3354ae15256`; [hosted engineering artifact](https://github.com/JiahaoAlbus/YNX-Chain/releases/download/wallet-auth-evidence-da82c8b/YNXWallet-Android-test-da82c8b.apk).
- Android Hermes: 4,446,705 bytes, SHA-256 `d3fb4d403eb46d54adbf5e8811ff36abeb0146b5a54c6b17ac6e246628bf7349`.
- iOS Hermes: 4,440,970 bytes, SHA-256 `6c8b372e34ae7cd22984eb3518da9abe1a876de5d7cf4de2e6c2686d71360555`.
- iOS Simulator zip: unsigned, 16,442,130 bytes, SHA-256 `1396a275c90b1333c8cda80acf4428553e995cdcc87f8eaa3baf11fbfc7b3a43`; [hosted engineering artifact](https://github.com/JiahaoAlbus/YNX-Chain/releases/download/wallet-auth-evidence-da82c8b/YNXWallet-iOS-Simulator-da82c8b.zip).
- Staging/public product/health/version URLs: none. The GitHub prerelease is artifact hosting only, not a product deployment.

## Controller integration requests and external blockers

1. Review the version 3 registry conflicts and exact 25-product entries, approve only verified tuples, merge the shared package into the central Gateway and deploy the atomic lifecycle/introspection/revocation store. Until verified remotely, `integratedCentral` remains false.
2. Have each product adopt the canonical request/callback/challenge/completion SDK; remove legacy query-field login and custom/local session verifiers. Exercise installed Wallet↔product flows against the deployed central lifecycle.
3. Provide owner-controlled Android production keystore, Apple signing/provisioning and store accounts; perform physical-device biometric/screen-reader/recovery drills. Engineering artifacts are hosted, but production-signed/store states remain false.
4. Commission external mobile/cryptographic review and decide whether a chain-compatible native non-exportable transaction signer/device-integrity policy is required before mainnet.
5. Normalize the Expo dependency tree so a complete CycloneDX SBOM can be generated without `ESBOMPROBLEMS`; do not publish an incomplete SBOM.
