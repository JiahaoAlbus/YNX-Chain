# YNX Wallet 1.0.22 Testnet Preview source candidate

## Included in the candidate

- Android, iOS and Expo source versions advance to 1.0.22. Android versionCode and iOS build advance to 28, separate from the historical 1.0.21 source candidate.
- The 1.0.21 native transfer recovery and WalletConnect account and lock controls are integrated with the confidential Finance order handoff. Wallet reviews the exact order after a signed ticket claim, persists an approval or rejection before delivery, and returns only an opaque code and bound state in the callback URL.
- A pre-cutover v1 Finance request may be recovered only through its existing secure journal and a server-authorized signed recovery ticket. The source keeps fresh SHA-256 callback binding separate from the historical random-state mode.
- The lockfile-based SBOM includes optional platform components consistently across local ARM and hosted macOS builds.

## Release boundaries

This is an integrated source candidate. The Finance backend exchange and legacy recovery routes, exact common-source cross-test, new Android/iOS installed upgrade, production signing, physical devices, stores and official-site publication remain unverified. The published 1.0.20 assets stay unchanged.

---

# YNX Wallet 1.0.21 Testnet Preview source candidate

## Included in the candidate

- Expo, Android and iOS source versions advance to 1.0.21. Android versionCode and iOS build advance from 26 to 27 so a new APK can be evaluated as an upgrade over the published 1.0.20 APK.
- This candidate includes the native receipt recovery changes at the specified PR 194 source head, `1d3a10e4076158d70a5f0275d2c7ba7914300e17`.
- The published 1.0.20 APK/AAB, their asset IDs, byte sizes, SHA-256 values and download URLs remain historical records.

## Release boundaries

This is source only. The exact merged release commit, built artifacts, signing identity and installed 26→27 upgrade QA are pending. Production signing, stores, physical devices, WalletConnect Relay, official-site publication and live transfer remain false or `NOT_VERIFIED`.

---

# YNX Wallet 1.0.20 Testnet Preview source candidate

## Included in the candidate

- Android, iOS and Expo versions advance together to 1.0.20, with Android versionCode 26 and iOS build 26.
- A strictly verified successful native receipt (`status=0x1`) is archived as immutable per-transaction-hash terminal evidence. Reopening Send after a restart reconciles the active outbox to `done` and releases the next transfer without a manual Done acknowledgement.
- Automatic recovery refreshes Dashboard balance, nonce and activity immediately only when recovery actually moves an active outbox to `done` and its screen lease remains current. An initially terminal record does not repeat that callback.
- Pending, unknown, unsupported, memory-only, not-found or malformed results remain blocking and cannot authorize a replacement. Recovery checks the original transaction and never rebroadcasts automatically.
- The published 1.0.19 APK/AAB and their identifiers, sizes and SHA-256 values remain unchanged historical assets.

## Release boundaries

This commit is source-only. Exact-merge APK/AAB builds, artifact hashes, signatures, asset IDs and release URLs remain absent until publication. Production signing, stores, physical devices, WalletConnect Relay, official-site publication, Faucet mutation and live transfer are false or `NOT_VERIFIED`.

---

# YNX Wallet 1.0.0 Testnet Preview

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
