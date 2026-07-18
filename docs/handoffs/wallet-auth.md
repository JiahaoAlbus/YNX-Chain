# YNX Wallet and canonical Wallet Auth handoff

Handoff date: 2026-07-18. Owned branch: `codex/ecosystem-wallet-auth`. Worktree: `/Users/huangjiahao/Desktop/YNX Chain Wallet Auth`.

## Git and ownership

- Preserved starting/remote branch tip: `efe827f467107e23482289a5b1f69ac9ff83e694`.
- Merge base: `b281376eac6fe3cf1ffa8c4b5a44e3546302791f`.
- Compatibility reference observed on `origin/main`: `719e1018267ed5a53e6fae5211c5fd8a1503c35c`.
- Product source/evidence commit: `9fc011341e16678af3bd9e8cd403af0c90607a2f`. The final release-record/handoff branch tip is reported to the controller because a commit cannot contain its own hash.
- Owned changes are limited to `apps/wallet/**`, `packages/wallet-auth/**`, this handoff and `.github/workflows/wallet-ios.yml`. No central acceptance file, long-term objective, root Makefile or other product source was modified.

## Honest delivery state

| State | Value | Evidence/boundary |
|---|---:|---|
| implemented-local | true | Independent Wallet plus canonical SDK, registry and lifecycle code |
| tested-local | true | Wallet 23/23, SDK 30/30, typecheck/product-check/bundles and root `make test` pass |
| installed-local | Android true; iOS false | API 36 phone and 2076×2152 foldable installed/cold-launched; host lacks full Xcode |
| integrated-central | false | Version 3 candidate exists; not merged into/deployed by central Gateway |
| deployed-staging | false | No staging endpoint or version health exists |
| deployed-public | false | No product public deployment exists; public chain RPC use is not product deployment |
| download-hosted | false | APK is local/ignored and has no immutable download URL |
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

`registry-conflict-evidence.json` records the observed Social identity/callback conflict and the legacy central Ed25519/session contract. It does not claim a deployment. Exact migration, verification and rollout requirements are in `CENTRAL_INTEGRATION.md`.

## Cross-App evidence

- Existing Android proof uses separate `com.ynxweb4.social` and `com.ynxweb4.wallet` packages: Wallet reviewed the request; Social verified the Wallet approval and completed a non-exportable Android Keystore P-256 device challenge; callback replay was rejected persistently.
- New shared tests complete the exact Pay and Card tuples through Wallet approval, device challenge and product-bound session. Tests reject callback interception, approval/request substitution, scope expansion/reorder, expiry extension, cross-App token use and wrong device/account/introspection.
- A central deployment and second installed Pay/Card binary are not claimed. The shared vectors/SDK are the integration contract until the controller merges and deploys the lifecycle.

## Localization, accessibility and visual evidence

Runtime catalogs: en, zh-CN, zh-TW, ja, ko, es, fr, de, pt, ru, ar and id. Device locale detection/manual persistence, Arabic RTL, `Intl` dates/numbers/YNXT/plurals, system light/dark, high-text-contrast palettes, reduced-motion sheets, font scaling, screen-reader labels/roles/state and touch targets are tested.

New installed evidence includes English phone/light, Arabic main/selector RTL, dark + 1.3× font + RTL and a 2076×2152 foldable/unfolded surface. Existing authorization, product-session and replay-rejection evidence remains. Hashes/sizes are in `apps/wallet/artifact-manifest.json`; design findings are in `UI_DESIGN_AUDIT.md`.

## Verification performed

- `packages/wallet-auth npm test`: 30/30 pass; `npm pack --dry-run` includes central docs, registry, conflict report, schemas and vectors.
- `apps/wallet npm run check`: typecheck, 23/23 tests, product boundary check, Android/iOS Hermes exports pass.
- `apps/wallet npm audit --omit=dev --audit-level=high`: pass with no high/critical; ten moderate Expo build-tool findings documented. SDK audit: zero findings.
- `npm run hardhat:build && npm run contracts:selectors && go test ./...`: pass after generating the repository's ignored contract fixtures.
- root `make test`: pass.
- root `make preflight`: pass after using the host's working `/usr/bin/python3` and creating the ignored `tmp/` directory required by the existing Exchange fixture; the default third-party Python installation is killed by macOS before startup.
- Android SDK 36 / Java 17 `assembleRelease`: pass, 352 tasks. APK is 78,028,122 bytes, SHA-256 `444df6d9801297092d9a03dd682104fe41462c22c1d2856776ad43236c46278b`.
- API 36 phone install: success; cold launch 2140/2274 ms and second cold launch 477/513 ms, focused MainActivity verified.
- Pixel 9 Pro Fold install: success; 2076×2152, cold launch 15082/15742 ms.
- iOS: Android/iOS Hermes exports pass; all iOS plists pass `plutil`; workflow YAML parses. Local `xcodebuild`/`simctl`/CocoaPods are unavailable because only CommandLineTools is installed. `.github/workflows/wallet-ios.yml` is the runnable macOS 15 unsigned Simulator build and artifact workflow.
- Dependency/license boundary and failed-closed CycloneDX generation are documented in `DEPENDENCY_REVIEW.md`. Package locks are the complete machine-readable inventory.
- `git diff --check`, owned-path, secret/placeholder and final worktree checks are rerun before push.

## Artifact record

- Android release APK: local only, test-signed, min API 24, 78,028,122 bytes, SHA-256 `444df6d9801297092d9a03dd682104fe41462c22c1d2856776ad43236c46278b`.
- Android Hermes: 4,438,800 bytes, SHA-256 `ccdc93108e483974b7e7d47b7661f2c9b12eab185d65b57a80afb0930b7a7e8d`.
- iOS Hermes: 4,433,193 bytes, SHA-256 `f2f68dc6ee2805ba2befb8c521a546a623781f656dd07db1e19f356ad10bd65a`.
- Artifact URLs: none. Staging/public/health/version URLs: none.

## Controller integration requests and external blockers

1. Review the version 3 registry conflicts and exact 25-product entries, approve only verified tuples, merge the shared package into the central Gateway and deploy the atomic lifecycle/introspection/revocation store. Until verified remotely, `integratedCentral` remains false.
2. Have each product adopt the canonical request/callback/challenge/completion SDK; remove legacy query-field login and custom/local session verifiers. Exercise installed Wallet↔product flows against the deployed central lifecycle.
3. Provide owner-controlled Android production keystore, Apple signing/provisioning and store accounts; execute the included iOS CI on macOS, perform physical-device biometric/screen-reader/recovery drills and host immutable artifacts. Until then hosted/signed/store states remain false.
4. Commission external mobile/cryptographic review and decide whether a chain-compatible native non-exportable transaction signer/device-integrity policy is required before mainnet.
5. Normalize the Expo dependency tree so a complete CycloneDX SBOM can be generated without `ESBOMPROBLEMS`; do not publish an incomplete SBOM.
