# YNX Wallet 1.0.1 Testnet Preview

## 1.0.1 Android update

- Adds the product-independent `ynxwallet://open` launcher used by official Connect YNX Wallet entry points. It only accepts the exact launcher URI and does not authorize, sign or submit a transaction.
- Establishes a persistent Testnet release signing identity so later preview APKs can use Android in-place updates from 1.0.1 onward.
- Verified on a fresh Android 16/API 36 AVD: first cold launch, `ynxwallet://open`, a second cold launch, warm single-task delivery and zero fatal app crashes.
- Important migration notice: the previously hosted 1.0.0 preview was signed by a different ephemeral test certificate. Android cannot update it in place. Back up recovery material, uninstall 1.0.0, then install 1.0.1.
- This remains a Testnet preview. It is not production-signed and is not a Play Store or App Store release.

## 1.0.0 baseline

## Included

- Independent Wallet information architecture covering onboarding, locked home, accounts, assets/activity, receive, biometric Send Review, authorization review, connected apps, sessions, devices, recovery, security, audit and network.
- Canonical native YNXT transfer payload/signature compatible with the Go chain implementation; live public-testnet evidence advanced the test-vector account from nonce 1 to nonce 2.
- Versioned 25-product central registry candidate with all unreviewed entries disabled/pending-review, exact least-privilege fields and a conflict report.
- Atomic reference lifecycle for challenge completion, introspection, replay persistence and four revocation boundaries.
- Twelve locale catalogs, Arabic RTL, system light/dark, font scaling, high-contrast state and reduced-motion behavior.
- Android API 36 release build/install/cold-launch evidence plus phone, foldable, RTL and large-text screenshots. iOS Hermes output and runnable macOS Simulator CI are included.
- Strict Smart Account UserOperation/sponsorship policy, Quant/Exchange/DEX mandate, capital review and selective-disclosure Credential candidates with property, fuzz, fault, soak and benchmark coverage.
- Product Session-bound secp256k1 Signed Intent with typed Evidence/Trust, biometric or external-signer human approval, AI explain-only boundary, canonical export, expiry and immediate revoke checks.
- Recovery, Reference, Parity, Web4 Identity, API Registry, Migration, SLO/Capacity, Unit Economics, notices, KPI and machine-readable public/operator metadata.
- Canonical Gateway local observability: truthful health/readiness/version, Prometheus metrics with bounded labels, generated request/trace/error IDs, exact remote build identity and redacted structured events with sink-failure isolation.
- Encrypted canonical Gateway backup/restore with exact state recovery, persisted replay rejection, rollback/age policy, no-overwrite semantics, fail-closed file-permission/link checks, validated legacy-state normalization and rejection of unsupported future state schemas.
- Release-grade CycloneDX 1.6 runtime SBOM: pinned generator, clean npm 11 tree, 431 components, 504 dependency nodes, complete license metadata and byte-for-byte reproducibility gate.
- Current main website-handoff and documentation authority baseline, including the canonical Wallet page contract and verified public support/privacy/security/status routes.
- Hosted test-signed Android and unsigned iOS Simulator engineering artifacts with SHA-256 and byte counts; executed iOS CI install/cold-launch/deep-link rejection evidence.

## Not released

Central registry/Gateway deployment, Monitor acceptance, staging/public observability endpoints, deployed Bundler/Paymaster, sponsored on-chain receipt, public product hosting, production signing, physical Apple device build, store review and external security audit remain false. Hosted binaries are engineering evidence only.
