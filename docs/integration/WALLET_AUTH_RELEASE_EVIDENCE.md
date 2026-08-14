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
| macOS | Local ad-hoc build/install/open and second open | Canonical bridge callback, Testnet, signing, notarization, public hosting |
| Linux/Windows desktop x64 | Current-HEAD native CI build/install/cold/second launch and exact Testnet read | Wallet signing, transaction, reconnect, hosted download, production signature |
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

The frozen checkpoints are Core `674d07c3157ce33a4ee6419fd599aac5b2703255`, Web `85af602dc96ae476c723f8646de55a081b89ed46`, Android `52825ac7fce0d962271a920397eb838862130301`, iOS/macOS `3150165e14f38031b9a089b029b623f67cd6df85`, and Desktop/CLI/SDK `1bdb7fb4991937eba4f74341bd123214f9776e92`.

Later Owner signals remain queued rather than consumed: Core session-inventory source `806f342723bdc7911367b9db9a72c4f33cd0a3db` and Web offline source `40cbf6f2` await their terminal evidence checkpoints; iOS/macOS `9810d6fd56c5eb71d450ee71dbc18eb86e143ea1` still lacks completed current-source CI in this slice. The Core branch descendant `979b791a87320718e66832cf690755792e998ab5` is readable but lacks explicit Owner terminal authority. None changes a release boolean.
