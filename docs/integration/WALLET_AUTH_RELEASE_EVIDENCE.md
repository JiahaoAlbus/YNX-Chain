# Wallet/Auth platform release evidence

This is the central Integration view of platform delivery. The authoritative machine-readable record is `release/integration/wallet-auth-release-evidence-matrix.json`; it consumes Owner evidence without redefining Core network facts or Wallet/Auth protocol.

## Frozen snapshot

| Surface | Accepted direct boundary | Explicitly not promoted |
| --- | --- | --- |
| Gateway | Public Testnet authorization lifecycle, proof signing, replay rejection and revoke | Asset transaction, reconnect, native deployment, production signing, store release |
| Web PWA | Exact pushed proof for Edge-local install, visible first/second windows and live `0x1917` RPC | Cold process launch, callback, reconnect, public hosting |
| Browser extensions | Unsigned bundle build | Browser installation, extension launch, signing, store listing |
| Android API 36 | Disposable-QA build, fresh install, two cold launches, exact Testnet identity | Onboarding QA remains pending; persistent/production signature, hosted current artifact, account/sign/tx/callback/reconnect |
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

The 2026-08-14 resumed snapshot froze commits only where the shared repository's local Owner branch and `origin/<branch>` remote-tracking ref were identical. A fresh live recheck was unavailable because the resumed sandbox could not resolve GitHub; this limitation promoted no gate and is recorded in the machine-readable matrix.

Two later rescue commits are protected but excluded from release truth while push remains pending: Core `4b7ffa680fab9b56e949c28cea523d0334943b59` and Android `7a6d30bc90f63c52e27340c10334e16c2e774643`. Owner-reported passing tests do not make either commit remote, centrally integrated, hosted or public.

Later Owner signals also remain queued rather than consumed: Web `3829aa6d` awaits exact remote readback, iOS/macOS `9810d6fd56c5eb71d450ee71dbc18eb86e143ea1` awaits current-source CI, and Desktop AppImage run `31765520859` is in progress. None changes a release boolean.
