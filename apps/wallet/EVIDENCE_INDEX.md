# Wallet evidence index

## Runtime images

- `proof/ynx-wallet-locked-current.png`: latest API 36 phone cold launch, English/light/empty onboarding.
- `proof/ynx-wallet-arabic-main.png`: Arabic security copy and mirrored RTL header/layout.
- `proof/ynx-wallet-arabic-rtl.png`: complete twelve-language selector in RTL mode.
- `proof/ynx-wallet-dark-large-text-rtl.png`: dark appearance, Arabic RTL and device font scale 1.3.
- `proof/ynx-wallet-fold-large-screen.png`: 2076×2152 unfolded/foldable large-screen layout.
- `proof/ynx-wallet-authorization.png`: historical pre-normalization Wallet review (`com.ynxweb4.social`); not a current canonical identity claim.
- `proof/ynx-social-product-session.png`: historical pre-normalization installed Social session; not a current canonical identity claim.
- `proof/ynx-social-replay-rejected.png`: historical pre-normalization installed replay rejection; not a current canonical identity claim.
- `proof/ios-simulator-deep-link-rejection.png`: Xcode 26.3 iPhone Simulator after installed cold launch and a malformed canonical deep link; Wallet stays fail closed and renders the rejection.

SHA-256 and byte sizes are recorded in `artifact-manifest.json`. The latest Android install used `com.ynxweb4.wallet/.MainActivity` on API 36 and returned `LaunchState: COLD`, `TotalTime: 2140 ms`, `WaitTime: 2274 ms`; a second cold launch returned 477/513 ms with Wallet as the focused activity. The foldable cold launch returned 15082/15742 ms at physical size 2076×2152.

## Protocol and chain evidence

- `packages/wallet-auth/testdata/signer-v1.json`: deterministic Wallet approval vector.
- `packages/wallet-auth/testdata/gateway-p256-v1.json`: P-256 product-device challenge vector.
- `packages/wallet-auth/testdata/central-lifecycle-v1.json`: restart and revocation lifecycle vector.
- `packages/wallet-auth/testdata/mobile-native-transfer-v1.json`: exact JS/Go native-transfer vector.
- Public-testnet transfer hash `0x7bdf19361936215c8bc753696ce61d78ed089f755eac2d8af5cbfbcb1fdc94b2`: scalar-1 test-vector account, amount 1, fee 1, nonce 2. The authoritative account response subsequently reported balance 87 and nonce 2. This is test-vector/testnet activity, not production funds.

## iOS Simulator evidence

GitHub Actions run [29646381701](https://github.com/JiahaoAlbus/YNX-Chain/actions/runs/29646381701) executed `.github/workflows/wallet-ios.yml` on macOS 15 with Xcode 26.3. It installed dependencies and pods, passed the SDK and Wallet checks, built the unsigned Release `YNXWallet.app`, booted an available iPhone Simulator from shutdown, installed the app, cold-launched `com.ynxweb4.wallet`, resolved `ynxwallet://authorize?request=invalid`, captured the fail-closed rejection screen and uploaded the app plus command evidence. The exact unsigned Simulator bundle is hosted as an engineering-only release asset; this does not claim production signing, an archive, device installation or App Store release.

## Hosted engineering artifacts

- [Android API 24+ test-signed APK](https://github.com/JiahaoAlbus/YNX-Chain/releases/download/wallet-auth-evidence-da82c8b/YNXWallet-Android-test-da82c8b.apk)
- [Unsigned iOS Simulator app zip](https://github.com/JiahaoAlbus/YNX-Chain/releases/download/wallet-auth-evidence-da82c8b/YNXWallet-iOS-Simulator-da82c8b.zip)

Both assets correspond to source commit `da82c8b07b72b615ccb24b86a2a7ac66ee85b4d8`. SHA-256 and byte sizes are recorded in `artifact-manifest.json`.

## Smart Account, mandate and Credential evidence

- `contracts/wallet/YNXSmartAccount.sol` and `YNXEntryPoint.sol`: official ERC-4337 v0.8 EntryPoint integration, owner and UV-required WebAuthn validation, exact-target/selector session keys, per-call/daily native-value limits, batch calls inherited from BaseAccount, emergency epoch revoke and delayed guardian recovery.
- `scripts/contracts/test-smart-account-hardhat.js`: real local EntryPoint `handleOps` for owner, WebAuthn, session-key and counterfactual factory operations; missing-UV, wrong-target, over-limit and post-recovery rejection; 50-operation session soak and local latency benchmark. It explicitly excludes Bundler/RPC/durable-storage/public-chain latency.
- `scripts/contracts/deploy-wallet-smart-account.js`: chainId-6423-only deployment path for a verified existing EntryPoint or the pinned official EntryPoint plus factory. It requires an exact source commit and emits mined transaction references, code hashes and byte counts; it leaves Paymaster/Bundler/sponsored receipt null rather than claiming success.
- `proof/smart-account-hardhat-local.json`: source-commit-bound assertions, source/artifact hashes, byte sizes and the 50-operation local EDR benchmark. All public-network exclusions and false deployment states are machine-readable.
- `packages/wallet-auth/test/smart-account.test.mjs`: operation/policy binding, first-action and anti-Sybil budget properties, malformed-input fuzz, provider/policy faults, 10,000-iteration soak and 20,000-evaluation benchmark.
- `packages/wallet-auth/test/mandate-credential.test.mjs`: no-withdraw/subaccount/DEX allowlist invariants, fee boundaries, capital non-guarantee and minimal Credential disclosure/expiry/status tests, including a 5,000-iteration Credential soak.
- `packages/wallet-auth/test/intent.test.mjs`: secp256k1 Signed Intent bound to Product Session, action and parameter digest; Evidence/Trust, human approval, AI explain-only, canonical export, tamper/expiry/revoke and 2,000-verification soak/benchmark.
- `packages/wallet-auth/test/gateway-adapter.test.mjs` and `testdata/product-session-http-proof-v1.json`: server-selected approved registry, P-256 sender-constrained HTTP proof, exact method/path/body binding, replay persistence, revoke-after-restart and 2,000-proof soak.
- `proof/gateway-benchmark-local.json`: 1,000 complete in-process proof/introspection samples, zero errors, p50 2.931 ms, p95 3.318 ms, p99 4.208 ms and 333.48 operations/second. Its coverage field explicitly excludes network and durable-storage latency.
- `sbom.cdx.json`: CycloneDX 1.6 review graph. `DEPENDENCY_REVIEW.md` records why Expo override errors keep it from release-grade status.
