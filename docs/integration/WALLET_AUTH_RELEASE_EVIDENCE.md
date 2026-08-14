# Wallet/Auth platform release evidence

This is the central Integration view of platform delivery. The authoritative machine-readable record is `release/integration/wallet-auth-release-evidence-matrix.json`; it consumes Owner evidence without redefining Core network facts or Wallet/Auth protocol.

## Frozen snapshot

| Surface | Accepted direct boundary | Explicitly not promoted |
| --- | --- | --- |
| Gateway | Public Testnet authorization lifecycle, proof signing, replay rejection and revoke | Asset transaction, reconnect, native deployment, production signing, store release |
| Web PWA | Exact pushed proof for Edge-local install, visible first/second windows, live `0x1917` RPC and fail-closed provider identity invalidation | Cold process launch, registered callback, real-provider reconnect, public hosting |
| Browser extensions | Unsigned bundle; Edge popup RPC `0x1917`; isolated-profile MV3 injection, fixture accounts/lifecycle and wrong-chain rejection | installedLocal, Chrome injection, live provider RPC, connect/add/switch/sign/tx/release, hosted/store listing |
| Android API 36 | Historical disposable-QA lifecycle; current canonical callback/replay, mutation journal, audit serialization and exact-account rename fail-close tests | Current-source device install/interaction; persistent/production signature, hosted artifact, sign/tx/callback/reconnect |
| iOS Simulator | Run 31766659407: ad-hoc Simulator install, cold PID 25811, second PID 26098, callback PID 34080, malformed callback delivered then rejected | Testnet, physical device, successful authorization, signing, tx, reconnect, public hosting, production/store |
| macOS Wallet Universal | Run 31769976021: x86_64+arm64 ad-hoc package; arm64 install/cold/second, two callback rejections, Keychain canary and recovery absence before/after biometric-unavailable attempt | x86_64 lifecycle, authorization/recovery success, Testnet, Universal Link, signing/tx, Developer ID, notarization, public hosting/store |
| Linux/Windows desktop x64 | Current-HEAD native CI build/install/cold/second launch and exact Testnet read | Wallet signing, transaction, reconnect, hosted download, production signature |
| macOS desktop x64 | Native CI upgrade/install/cold/second launch, exact Testnet read and DMG/ZIP post-upload hash verification | Packages remain unsigned/unnotarized; hosted download, production signature and store release |
| Linux desktop arm64 AppImage | Native arm64 portable cold/second lifecycle, exact Testnet read and post-upload hash verification | installedLocal/installedNativeCI false; hosted download, production signature and store release |
| Linux desktop arm64 deb | Native CI install, upgrade, cold/second lifecycle, exact Testnet read, fail-close, uninstall and redownload hash | installedLocal false; unsigned, non-hosted and not store released |
| Linux desktop arm64 RPM | Fedora 42 arm64 DNF and RPM scripts; install/upgrade, sandbox, GUI lifecycle, Testnet/fail-close/uninstall/hash | rollback not tested; installedLocal/signing/hosting/store false |
| Windows desktop arm64 | Windows 11 arm64 native CI install/upgrade, cold/second lifecycle, exact Testnet read, fail-close, uninstall and readback hash | installedLocal false; Authenticode NotSigned, non-hosted and not store released |
| Windows CLI arm64 | Run 31770348463: Windows 11 arm64 upgrade/install/cold/second, frozen vectors, temporary P-256 self-test, exact `0x1917`, fail-close, uninstall and hash readback | Win10/Server2016 not directly tested; temporary P-256 is not production account/tx signing; Authenticode NotSigned; local/public/hosted/production/store false |
| Go SDK | Run 31772532074: deterministic 0.1.0 formal archive, clean extract/install, module+consumer tests, Auth vector, exact `0x1917`, temporary device proof and download reverify | not publicly published/hosted; production account/tx signing, production signature and store false |
| Linux/Windows CLI | Native package lifecycle, exact Testnet read and ephemeral P-256 device proof | Asset signing/transaction, public hosting, production signature |
| TypeScript SDK | Reproducible local tarball, clean-consumer install/import and exact Testnet read | npm publication, automatic signing/transaction, production signature |

`sign` is intentionally narrower than package signing. A disposable Android certificate, unsigned executable, ad-hoc macOS bundle or simulator linker signature never satisfies either the Wallet signing gate or `productionSigned`.

## Verification

Run the local immutable-object gate:

```sh
node scripts/verify/wallet-auth-release-evidence-matrix.mjs
```

Add bounded remote branch and exact Actions-run checks when GitHub is reachable:

```sh
node scripts/verify/wallet-auth-release-evidence-matrix.mjs --remote
```

The verifier rejects a `true` gate unless a direct evidence record explicitly supports that exact platform/gate pair. It also rejects production/store promotion for temporary, unpacked, simulator, disposable, unsigned, ad-hoc or local-only artifact classes.

The 2026-08-14 resumed snapshot was upgraded through GitHub Git-database readback. Every consumed checkpoint has an exact remote commit, parent, tree and evidence blob; Owner branches were fetched without touching the working tree. These source advances promoted no public, hosted, production, store, callback, reconnect, signing or transaction gate without direct evidence.

The frozen checkpoints are Core `0c747c6030b5a475a1f12dc7e57345555c23055d`, Web `deca6f4fe29dafdccb3736f237e6e8829e094eec`, Android `f1edbec46ad4300beec406873b03db2da7c72e4b`, iOS/macOS `7a3a110fb7cd9a33512ce4db87ddd8387cb730d5`, and Desktop/CLI/SDK `2802876f8470264c4a8819f1426e28f957a09289`. Web remains unhosted. iOS run 31786857637 directly proves steps 14–17 while step18 recovery fails; the next source/run remains pending. The macOS arm64 CLI is the sole official YNX-domain download.

iOS run 31786857637/job 94724590965 ended failure only at recovery step18. Direct successful scope: cold PID 28338, second PID 29129, callback PID 35715, Keychain add/read/delete OSStatus 0/0/0, malformed callback received and visibly rejected, and Universal Link policy fail-close. Artifact 9214296692 is 98,461,111 bytes with digest `fd7fa00f37461132c1b9d8799b773bd62ff32603a88a9c03d910ec502acb5afd`. Recovery and biometric success, authorization success, official hosting and every production distribution claim remain false.

iOS run 31785220186/job 94719518072 passed entitlement extraction and signing verification, then `simctl install` succeeded but SpringBoard rejected the first launch at 09:01:13Z. No process ID, Keychain probe, second launch or callback exists; steps 16–18 were skipped. The embedded entitlement plist is identical across arm64/x86_64 with SHA-256 `40af00c37606ac1a411d773cfe7640e464ff0a84f8ff6f5dc8661006b07430cd`. Follow-up run 31786857637 has not reached terminal evidence, so all new launch/auth/recovery/public claims remain false.

The isolated publication-kit verification reproduced PWA 272,706 bytes / `63d83cd20925f2d52c0f21f548fa7a857a4d056e03e5fa16244f173164a7d287`, Chrome/Edge 188,846 bytes / `c733093dea47c6612c8a9d5ecea40be2227f62402f4b4966955c9e1accf4e2aa`, and Firefox 188,883 bytes / `417d9b9e5babf05fdfdf8161504389eb99c636be75f94444bf4ff91a9b4536b3`. Its self-test passes, while the live `--expect-unpublished` monitor records 0/9 artifact passes and registry mismatch. Web hosting/deployment remains false until the production command exits zero.

macOS arm64 CLI run 31776448279 proves native-CI install/upgrade, cold/second start, frozen Auth vector, ephemeral device proof without key persistence, exact `0x1917`, fail-close, uninstall and connector rehash. The official URL is `https://www.ynxweb4.com/downloads/wallet/sha256-21db36f1c80d4e88520918de141a7f71921817799270ff671db88179023b5591/ynx-wallet-cli-darwin-arm64.gz`; independent re-download returned HTTP 200 `application/gzip`, 4,904,463 bytes and SHA-256 `21db36f1c80d4e88520918de141a7f71921817799270ff671db88179023b5591`. The three YNX aliases and public registry/page bundle bind the artifact. `downloadHosted` and current `deployedPublic` are true only for this candidate; ad-hoc signing, failed rollback attempt, no account/tx and no store keep all production claims false.

Linux x64 RPM run 31776185699 proves Fedora 42 x64 DNF/RPM scripts, install→upgrade→rollback→re-upgrade, sandbox state, GUI cold/second launch, exact `0x1917`, RPC fail-close, uninstall and artifact rehash. The RPM is 86,926,281 bytes with SHA-256 `8cf24d83dd5da5851484eab14ce9e6cd16946c95699a7af1e11048bbd7692bea`; it is unsigned and unhosted.

Core source `d5bb0a036827878b291b2c26b1f7e09ca31a93b1` and evidence `b8467853060db04c2981abb7fcfa22d4cfdcf65b` prove local Smart Account batch semantics: owner/WebAuthn success, Session Key AA24 rejection without nonce/target mutation, and failed-subcall rollback. Wallet/Auth 184/184 passed. This is Hardhat EDR in-process only and promotes no external Bundler or deployment gate.

Android source `c1568cc2585426cda0a7705fec3766581323fc42` and checkpoint `8666c0bb0535270e595f3db54e7d2e35b18afe66` prove finally-zeroing for temporary decoded 32-byte Uint8Array keys across 8 signing domains after success or exception. Wallet/Auth 115/115, Wallet 104/104 and Hermes 2749 passed. The immutable JavaScript secret string returned by SecureStore is explicitly not claimed zeroed; no device or release truth is promoted.

iOS run 31774232444 ended in failure. It preserves cold PID 30853, second PID 30975, and a malformed callback delivered through the system Open sheet to PID 39845 then rejected by the app UI. Step 15 did not execute `openurl`; recovery failed. Commit `50d3b2e2c5bd77456b84f348c48fa4a9ed76b5b3` freezes only the recovery-precondition workflow source and does not turn the failed run into a CI pass. Deep-link delivery, recovery/biometric, auth success, Universal Link and public/signing gates remain false.

Android `6f096503793218ddfd9b3b1cd6403a07d4fafb97` remains queued. Unknown rollback descendants are not consumed. Public/hosted/production/store truth is unchanged.

The public audit is machine-readable at `release/integration/wallet-auth-public-evidence-audit.json` and fail-closed verified by `scripts/verify/wallet-auth-public-evidence-audit-check.mjs`. It records public RPC/health/website observations separately from current-source deployment, exact downloads, signing level and ComputerControl evidence.
