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
| macOS Wallet arm64 | Run 31768312759: ad-hoc native CI build/install, distinct cold/second PIDs, Keychain canary and malformed callback delivery/rejection | Successful authorization/recovery, Testnet, signing, tx, Developer ID, notarization, public hosting/store |
| Linux/Windows desktop x64 | Current-HEAD native CI build/install/cold/second launch and exact Testnet read | Wallet signing, transaction, reconnect, hosted download, production signature |
| macOS desktop x64 | Native CI upgrade/install/cold/second launch, exact Testnet read and DMG/ZIP post-upload hash verification | Packages remain unsigned/unnotarized; hosted download, production signature and store release |
| Linux desktop arm64 AppImage | Native arm64 portable cold/second lifecycle, exact Testnet read and post-upload hash verification | installedLocal/installedNativeCI false; hosted download, production signature and store release |
| Linux desktop arm64 deb | Native CI install, upgrade, cold/second lifecycle, exact Testnet read, fail-close, uninstall and redownload hash | installedLocal false; unsigned, non-hosted and not store released |
| Windows desktop arm64 | Windows 11 arm64 native CI install/upgrade, cold/second lifecycle, exact Testnet read, fail-close, uninstall and readback hash | installedLocal false; Authenticode NotSigned, non-hosted and not store released |
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

The frozen checkpoints are Core `bdb40572570b02b913dbfb14165d35d54a1129ba`, Web `0b3ffa8faabad2caa49b1c00db493261e2d98bca`, Android `4739a60e1fa0e3d0b6862e129330f9e9ca202887`, iOS/macOS `d71c9c9626f584fcb91aadf7aa44b8928f949385`, and Desktop/CLI/SDK `931b70fc0dd4e7ff01542065099aeaa0b3f25a51`.

macOS Universal run 31768901687 is green but remains unconsumed until an Owner evidence SHA and hashes exist. No local/CI lifecycle changes public, hosted, production-signing or store truth.

The public audit is machine-readable at `release/integration/wallet-auth-public-evidence-audit.json` and fail-closed verified by `scripts/verify/wallet-auth-public-evidence-audit-check.mjs`. It records public RPC/health/website observations separately from current-source deployment, exact downloads, signing level and ComputerControl evidence.
