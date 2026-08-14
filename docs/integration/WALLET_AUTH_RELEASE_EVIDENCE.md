# Wallet/Auth platform release evidence

This is the central Integration view of platform delivery. The authoritative machine-readable record is `release/integration/wallet-auth-release-evidence-matrix.json`; it consumes Owner evidence without redefining Core network facts or Wallet/Auth protocol.

## Frozen snapshot

| Surface | Accepted direct boundary | Explicitly not promoted |
| --- | --- | --- |
| Gateway | Public Testnet authorization lifecycle, proof signing, replay rejection and revoke | Asset transaction, reconnect, native deployment, production signing, store release |
| Web PWA | Exact pushed proof for Edge-local install, visible first/second windows, live `0x1917` RPC and fail-closed provider identity invalidation | Cold process launch, registered callback, real-provider reconnect, public hosting |
| Browser extensions | Unsigned bundle build | Browser installation, extension launch, signing, store listing |
| Android API 36 | Historical disposable-QA build/install/two cold launches/Testnet identity; current-source biometric, callback/replay and relock tests | Current-source device install/interaction; persistent/production signature, hosted artifact, sign/tx/callback/reconnect |
| iOS Simulator | Current HEAD pending in Actions at snapshot time | Every current-candidate promotion gate remains false |
| macOS Wallet arm64 | Local ad-hoc build/install/open and second open | Canonical bridge callback, Testnet, signing, notarization, public hosting |
| Linux/Windows desktop x64 | Current-HEAD native CI build/install/cold/second launch and exact Testnet read | Wallet signing, transaction, reconnect, hosted download, production signature |
| macOS desktop x64 | Native CI upgrade/install/cold/second launch, exact Testnet read and DMG/ZIP post-upload hash verification | Packages remain unsigned/unnotarized; hosted download, production signature and store release |
| Linux desktop arm64 | Native arm64 AppImage portable cold/second lifecycle, exact Testnet read and post-upload hash verification | installedLocal/installedNativeCI false; hosted download, production signature and store release |
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

The frozen checkpoints are Core `e2aaff33832507b4a5ebf44d522a9b7ffa5d5ba4`, Web `d8f96c0649576cc645b3bc1651148dd0318bc243`, Android `a0101ac491c2790d5cfdef99c2e11e3807d81aca`, iOS/macOS `3150165e14f38031b9a089b029b623f67cd6df85`, and Desktop/CLI/SDK `f76a416ebde087e16f1c0c02c80dc392e8c365e8`.

The iOS/macOS checkpoint `4c8c464dffee289fd9173569915638f873409198` remains queued because Integration has no Owner terminal successful current-source CI statement. It changes no release boolean.
