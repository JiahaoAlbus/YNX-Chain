# YNX Wallet and canonical Wallet Auth handoff

Handoff updated: 2026-07-28. Owned branch: `codex/final-wallet-auth`. Recovery source: preserved `codex/ecosystem-wallet-auth` tip plus its six byte-for-byte verified dirty artifacts.

## Git and ownership

- Preserved starting/remote branch tip: `efe827f467107e23482289a5b1f69ac9ff83e694`.
- Merge base: `b281376eac6fe3cf1ffa8c4b5a44e3546302791f`.
- Current main compatibility merge: `9a434ffa8f8d498d99f577ce97964903afea9cae`, including `origin/main` at `562888318863435382d839958130246973dc1206`.
- Recovered hosted-artifact source commit: `da82c8b07b72b615ccb24b86a2a7ac66ee85b4d8`. Gateway observability source: `2eb3198a99fcd98a1c6d56e3e99e97166ceab7f6`. Encrypted backup runtime source: `c4e476dc52e40ae4c895503a9ed0b756b1884f77`.
- Product-owned implementation remains under `apps/wallet/**`, `packages/wallet-auth/**`, this handoff and `.github/workflows/wallet-ios.yml`. The branch also merges the current central documentation, website-handoff and deployment-gate baseline without claiming central Wallet runtime deployment.

## Honest delivery state

| State | Value | Evidence/boundary |
|---|---:|---|
| implemented-local | true | Independent Wallet, canonical lifecycle, Signed Intent, Smart Account policy, mandate/capital and Credential candidates |
| tested-local | true | Wallet/Auth 99/99 plus Wallet 39/39, typecheck, product-check, SBOM, Android/iOS bundle, documentation, disclosure, deploy dry-run and full Go regression evidence |
| installed-local | Android true; iOS Simulator true | API 36 phone/foldable installed and cold-launched; macOS 15/Xcode 26.3 CI installed and cold-launched the unsigned iOS Simulator app |
| integrated-central | false | Registry document v2, product schema v3, Gateway adapter v2 and observability host v1 are tested candidates; not merged into or deployed by central Gateway |
| deployed-staging | false | Local loopback health/readiness/version/metrics exist; no staging endpoint or exact deployed build response exists |
| deployed-public | false | No Wallet runtime public deployment exists; Wallet documentation is integrated into the public Website content bundle, but the Wallet route lacks direct route-level runtime proof |
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

## Central Registry document v2 / product schema v3 candidate

`packages/wallet-auth/central-registry.json` contains exactly 26 sorted products, adding Quant to the prior 25-product set. Registry v1 migrates only from that exact prior set and deterministically adds Quant as disabled and `pending-review`.

Every entry has an exact product ID, requesting product, client, bundle/package, callback list, sorted least-privilege scopes, `maxScopes`, permitted device algorithms, session duration and revocation policy. There are no wildcard values. All entries are `pending-review` and disabled; schema validation refuses enablement without `approved` review status. The Wallet locally tests exact Social, Pay, Card and Quant tuples while the central candidate remains disabled.

The canonical Social tuple is now `ynx-social-v1` / `com.ynx.social` / `ynx-social://com.ynx.social`, matching the independent Social worktree. All executable fixtures, deterministic vectors and the Android proof harness use that tuple. `registry-conflict-evidence.json` is the only retained record of the deleted `com.ynxweb4.social` / `ynxsocial://wallet-auth/callback` fixture and the legacy central Ed25519/session contract. It is conflict evidence, not an accepted runtime alias or deployment claim. Exact migration, verification and rollout requirements are in `CENTRAL_INTEGRATION.md`.

## Cross-App evidence

- The Android proof harness is a separate `com.ynx.social` package and uses `ynx-social://com.ynx.social`. It owns a non-exportable Android Keystore P-256 key and performs strict schema, callback, Wallet secp256k1 signature, account derivation, device challenge, expiry and replay verification. The harness builds successfully against API 36. The previously captured installed session/replay images predate the Social identity normalization and are retained only as historical visual evidence; executable current-identity proof is the harness plus shared vectors/tests until the controller runs the independent Social app against a deployed Gateway.
- New shared tests complete the exact Pay and Card tuples through Wallet approval, device challenge and product-bound session. Tests reject callback interception, approval/request substitution, scope expansion/reorder, expiry extension, cross-App token use and wrong device/account/introspection.
- A central deployment and second installed Pay/Card binary are not claimed. The shared vectors/SDK are the integration contract until the controller merges and deploys the lifecycle.

## StrategyMandate v2 integration

StrategyMandate v2 binds account, Product Session, Quant engine commit/release, execution kind/account, independent nonce domain, exact venues/assets/markets/methods, typed Vault/Pool/Router targets, capital/position/leverage/order/slippage/gas/frequency/loss/drawdown limits, fees, expiry, kill, revoke and emergency exit. Exchange mandates are subaccount-only and no-withdraw. DEX mandates prohibit transfer, approval, owner/admin and upgrade selectors.

The Gateway adapter requires a fresh unconsumed P-256 HTTP proof for activation, action authorization, inventory, revoke, kill and emergency exit. The state store persists action nonce/digest consumption and terminal states across restart. The shared vector is `packages/wallet-auth/testdata/strategy-mandate-v2.json`; the machine contract and owner acceptance boundaries are under `release/integration/` and `docs/integration/`.

No central merge, YNX Testnet mandate receipt, Explorer proof or Monitor proof is claimed.

## Localization, accessibility and visual evidence

Runtime catalogs: en, zh-CN, zh-TW, ja, ko, es, fr, de, pt, ru, ar and id. Onboarding, locked state, primary account actions and authorization safety copy no longer fall back to English in the eleven translated catalogs. Device locale detection/manual persistence, Arabic RTL, `Intl` dates/numbers/YNXT/plurals, system light/dark, high-text-contrast palettes, reduced-motion sheets, font scaling, screen-reader labels/roles/state and touch targets are tested.

Installed evidence includes English phone/light, Arabic main/selector RTL, dark + 1.3× font + RTL, a 2076×2152 foldable/unfolded surface and the Xcode 26.3 iPhone Simulator fail-closed deep-link screen. The three pre-normalization authorization/session/replay images are explicitly historical rather than current canonical identity evidence. Hashes/sizes are in `apps/wallet/artifact-manifest.json`; design findings are in `UI_DESIGN_AUDIT.md`.

## Verification performed

- `packages/wallet-auth npm test`: 100/100 pass; `npm pack --dry-run` includes central docs, Registry v2, Gateway adapter/Node host, encrypted backup/restore, StrategyMandate runtime and deterministic vectors.
- `apps/wallet npm run check`: typecheck, 39/39 tests, product/release/coverage/SBOM gates and Android/iOS Hermes exports pass.
- Offline production audits with `npm audit --offline --omit=dev --audit-level=high`: Wallet app and Wallet/Auth both report zero vulnerabilities; Browser/JS SDK tests remain green.
- `npm run contracts:check` and `umask 0022; go test ./...`: pass. The MCP default `umask 0077` tightened two non-Wallet unsafe-permission fixtures to `0600`, so the standard fixture precondition is recorded rather than changing another product's source.
- root `make test`: pass.
- root `make preflight`: pass after using the host's working `/usr/bin/python3` and creating the ignored `tmp/` directory required by the existing Exchange fixture; the default third-party Python installation is killed by macOS before startup.
- Android SDK 36 `assembleRelease`: pass, 352 tasks. Final APK is 78,035,858 bytes, SHA-256 `3d7dd0b349721f2364a2ec0519269bee2933c8b718ba26fc68e7e3354ae15256`.
- API 36 phone install: success; cold launch 2140/2274 ms and second cold launch 477/513 ms, focused MainActivity verified.
- Pixel 9 Pro Fold install: success; 2076×2152, cold launch 15082/15742 ms.
- iOS: Android/iOS Hermes exports pass; all iOS plists pass `plutil`. GitHub Actions run [29646381701](https://github.com/JiahaoAlbus/YNX-Chain/actions/runs/29646381701) passed SDK/Wallet checks and pods, built with Xcode 26.3, booted an iPhone Simulator, installed the unsigned Release app, cold-launched `com.ynxweb4.wallet`, routed a malformed `ynxwallet://authorize` URL to the fail-closed rejection UI, captured a screenshot and uploaded the app/evidence artifact. This host still has CommandLineTools only.
- Dependency/license boundary now includes a release-grade deterministic CycloneDX 1.6 runtime SBOM. The generator is pinned to `@cyclonedx/cyclonedx-npm@6.0.0`; `npm run sbom:check` proves a clean npm 11 production tree, 431 components, 504 dependency nodes, license metadata for all 431 components and current SHA-256 `4b1c905a01ce7fc9f923973c9a97a2de3662a515251d387ba3a7ecdcc087dd85` without `--ignore-npm-errors`. Source-only prerelease `wallet-auth-v1.0.0-source-candidate` is bound to `c7a6bded387223429f0708f80b50f086d8ff944d`; all six assets were downloaded and hash-verified.
- The Wallet-owned `release-content:check` scans 22 runtime/config/public-metadata files without external binaries. It replaces no central owner capability: `docs/integration/SECURITY_GATE_CONFLICT.md` records that repository-level placeholder/secret scripts produced false success when `rg` was missing. The 40-item `.ai-bridge/full-goal-coverage.json` is also executable-validated for unique IDs, allowed states, exact commits, evidence paths and concrete blockers, including the explicit `huangjeo.com` ownership boundary.
- `git diff --check`, owned-path, secret/placeholder and final worktree checks are rerun before push.
- Smart Account policy/mandate/Credential/Signed Intent gates cover property/fuzz/fault, 10,000 sponsorship evaluations, 5,000 Credential parses, 2,000 signed export verifications and a 20,000-evaluation sponsorship benchmark. The new Solidity account additionally executes owner, UV-required WebAuthn and bounded-session UserOperations through the official EntryPoint on local Hardhat EDR, rejects missing UV/wrong target/over-limit/post-recovery sessions, and runs a 50-operation soak.
- The default-disabled Paymaster executes local first-action, merchant, developer and product sponsorship, conservatively reserves product/subject budgets, observes postOp cost, rejects tamper/replay/second-first-action/unapproved target and restricts Risk Officer authority to disabling. The ERC-7769 adapter adds strict health/estimate/send/lookup/receipt with 4 dedicated tests and a 100-request isolated-fixture soak. Neither is deployed publicly.
- Canonical Gateway adapter: 7 tests covering server-authoritative registry selection, P-256 HTTP proof binding, replay, restart/revoke and 2,000 unique proof operations; the local 1,000-sample benchmark measured p50 2.931 ms, p95 3.318 ms, p99 4.208 ms, zero errors and 333.48 operations/second without network or disk latency.
- Canonical Gateway observability at source `2eb3198a99fcd98a1c6d56e3e99e97166ceab7f6`: Node-host 8/8 and package 94/94 pass; a real loopback CLI process returned `/health`, `/ready`, `/version` and Prometheus `/metrics`, emitted redacted canonical JSON events, and rejected remote classification without exact source/release/build-time identity. `apps/wallet/proof/gateway-observability-local-2026-07-27.json` binds hashes and explicitly leaves central Monitor, staging and public states false.
- Gateway recovery runtime was introduced at `c4e476dc52e40ae4c895503a9ed0b756b1884f77`; current verification source `a5c99e4e26e150aa6cf4138f4ecf8ac6d1ea8b2f` passes 100/100 package tests and 6/6 focused recovery tests. AES-256-GCM backup preserves exact canonical Gateway state, consumed-proof replay rejection, revocations and mandates; wrong key, tamper, broad permissions, links, stale/future recovery points, existing restore targets and unsupported future state schemas fail closed. `apps/wallet/proof/gateway-backup-restore-local-2026-07-29.json` records validated legacy-state normalization, the 20-sample local drill and explicit false central/KMS/cross-region/production-RTO states.
- Main compatibility merge `9a434ffa8f8d498d99f577ce97964903afea9cae`: Wallet/Auth 99/99, Wallet App 39/39 plus both bundles, all documentation/disclosure/package gates, the complete deploy dry-run and `go test ./...` pass.

## Artifact record

- Android release APK: test-signed, min API 24, 78,035,858 bytes, SHA-256 `3d7dd0b349721f2364a2ec0519269bee2933c8b718ba26fc68e7e3354ae15256`; [hosted engineering artifact](https://github.com/JiahaoAlbus/YNX-Chain/releases/download/wallet-auth-evidence-da82c8b/YNXWallet-Android-test-da82c8b.apk).
- Android Hermes: 4,446,705 bytes, SHA-256 `d3fb4d403eb46d54adbf5e8811ff36abeb0146b5a54c6b17ac6e246628bf7349`.
- iOS Hermes: 4,440,970 bytes, SHA-256 `6c8b372e34ae7cd22984eb3518da9abe1a876de5d7cf4de2e6c2686d71360555`.
- iOS Simulator zip: unsigned, 16,442,130 bytes, SHA-256 `1396a275c90b1333c8cda80acf4428553e995cdcc87f8eaa3baf11fbfc7b3a43`; [hosted engineering artifact](https://github.com/JiahaoAlbus/YNX-Chain/releases/download/wallet-auth-evidence-da82c8b/YNXWallet-iOS-Simulator-da82c8b.zip).
- Staging/public Wallet runtime/health/version URLs: none. The GitHub prerelease is artifact hosting only, not a product deployment. The publicly hosted Website documentation bundle designates `https://ynxweb4.com/wallet` as the canonical Wallet route, and general support/privacy/security/status routes are verified by the Website evidence record; the Wallet route itself has not received direct route-level public verification.

## Controller integration requests and external blockers

1. Review Central Registry document v2 / product schema v3 conflicts and exact 26-product entries, approve only verified tuples, merge Gateway adapter v2 plus observability host v1 into the central Gateway, deploy the atomic lifecycle/introspection/revocation/mandate store, and bind `/version` to the exact deployed source/release/build time before Monitor acceptance. Until verified remotely, `integratedCentral` remains false.
2. Have each product adopt the canonical request/callback/challenge/completion SDK; remove legacy query-field login and custom/local session verifiers. Exercise installed Wallet↔product flows against the deployed central lifecycle.
3. Provide owner-controlled Android production keystore, Apple signing/provisioning and store accounts; perform physical-device biometric/screen-reader/recovery drills. Engineering artifacts are hosted, but production-signed/store states remain false.
4. Commission external mobile/cryptographic review and decide whether a chain-compatible native non-exportable transaction signer/device-integrity policy is required before mainnet.
