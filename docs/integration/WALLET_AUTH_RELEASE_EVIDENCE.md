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

The frozen checkpoints are Core `774a1f756890043e88626d13b6c9679a2ad6d288`, Web `7d569d1babb85e6d28bb6bfc3b3c0c5fd828255d`, Android `4739a60e1fa0e3d0b6862e129330f9e9ca202887`, iOS/macOS `04450cff296511018447e5d4886803081149f596`, and Desktop/CLI/SDK `0985090cc5640a7bc6f614acba1f32ba24e6dc55`. Its AppImage parent proves the portable lifecycle and artifact facts; the handoff adds no gate. A rollback checkpoint mentioned inside the Owner contract is deliberately not consumed without its authorized terminal handoff.

Android `6f096503793218ddfd9b3b1cd6403a07d4fafb97` remains queued. Unknown rollback descendants are not consumed. Public/hosted/production/store truth is unchanged.

The public audit is machine-readable at `release/integration/wallet-auth-public-evidence-audit.json` and fail-closed verified by `scripts/verify/wallet-auth-public-evidence-audit-check.mjs`. It records public RPC/health/website observations separately from current-source deployment, exact downloads, signing level and ComputerControl evidence.
