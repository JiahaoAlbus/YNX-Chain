# YNX Developer installer replacement handoff — 2026-08-21

Owner: `11-developer`
Website owner: `28-website`
Integration owner: `29-integration`

This record supersedes every prior Developer website instruction that treats a
`.zip` desktop bundle as an installer. ZIP is source/internal evidence only;
it must never be linked, labelled, or recovered as a macOS or Windows installer.

## Current authoritative matrix

| Platform | Required public format | Exact source | Artifact and installation evidence | Website state |
| --- | --- | --- | --- | --- |
| macOS arm64 | `.dmg` containing a launchable `.app` | `95daaa89825738e61747f0e02555ce1b9b84a75a` / tree `a67c816b8fe69b063c4ab795f00e07078fae3068` | Local macOS build produced `ynx-developer-testnet-preview-macos-arm64-unsigned.dmg`, 289,904,574 bytes, SHA-256 `3cd5ecff96138f2e872ac7e8f0da4a47f9c39f6414c51fab0af3922e1a284ac9`. It is UDZO, signed ad-hoc with no Team ID, and was mounted, copied from the DMG to an isolated Applications directory, cold-launched, cleanly exited, second-launched, completed a bounded C++ compile, preserved a workspace, and removed its isolated installation/mount at verifier exit. | `HOSTING_AND_NETWORK_PROOF_REQUIRED`; local artifact is not an immutable public download and cannot receive a website CTA. |
| Windows x64 | `.msix` (or a signed `.exe`) | `95daaa89825738e61747f0e02555ce1b9b84a75a` / tree `a67c816b8fe69b063c4ab795f00e07078fae3068` | CI run `32482417841` produced `ynx-developer-testnet-preview-windows-x64-test-signed.msix`, 71,572,169 bytes, SHA-256 `f5f1133195ab385f5ab975bd40afcebf168930312582d264e803116fc4dcd3d3`. The runner verified its test-only certificate, installed it, cold-launched and second-launched the installed payload, then removed it. | `BUILD_AND_INSTALL_PROOF_IN_PROGRESS`; test-only CI artifact is not an immutable public download and cannot receive a website CTA. |

The Windows runner did not surface an interactive AppsFolder window, so it
launched the installed payload directly. That is valid installed-payload
cold/second-launch evidence, but it is not Start-menu-visible proof. Its
certificate is self-signed for test use, not Authenticode production signing.

## Release boundary

- Public `developer.ynxweb4.com` and main-website download cards remain in the
  matrix state above. There is **no current public installer URL** for either
  platform.
- Do not publish a ZIP fallback, temporary GitHub Actions artifact URL, a local
  filesystem link, or a `localhost` endpoint.
- Do not call the Windows artifact production-signed, store-ready, notarized,
  immutable, or publicly hosted.
- Do not call the macOS artifact Developer ID signed, notarized,
  immutable, publicly hosted, or network-verified. It requires macOS 13.0+
  arm64; its recommended future HTTP content type is
  `application/x-apple-diskimage`, but no public HTTP response exists yet.
- The prior official ZIP routes are revoked as installer claims. A rollback
  returns the website to this no-download matrix; it must not revive those ZIP
  claims.

## Preconditions for a future website upload

Owner 28 may restore a macOS or Windows CTA only after Integration receives a
new exact source-bound handoff containing all of the following for that row:

1. Immutable official-domain HTTPS URL and byte-for-byte SHA-256 readback.
2. Format inspection (`.dmg` with launchable `.app`; `.msix`/`.exe` for
   Windows), exact bytes, minimum OS, and signing classification.
3. Installation, cold launch, clean exit, second launch, and uninstall proof
   from the installed product—not archive extraction alone.
4. Real project creation, dependency installation, and actual execution for
   every available JS/TS, Python, Go, C++, and Solidity toolchain. Unavailable
   toolchains must be individually recorded as unavailable, never simulated.
5. Exact YNX Testnet connection evidence, AI Build availability/error boundary,
   and proof that the packaged flow does not substitute `localhost`.
6. Website deployment commit, public HTTP/hash readback, and a rollback record
   that removes the new CTA without restoring ZIP installer claims.

## Existing evidence and remaining blocker

- A direct visible readback of `https://ynxweb4.com/developer` on 2026-08-21
  showed both macOS and Windows as `Not ready`, with the explicit replacement
  messages and no ZIP installer CTA. The page's audit source label was
  `70f7c3ca`; this proves only the visible matrix, not an installer artifact.
- Windows source-format/install evidence is available only in the temporary
  Actions artifact from run `32482417841`; the uploaded artifact ZIP SHA-256
  is `09f472ec16b01552c82d5f4b8c633ad59b77a5e57f8beeeaba3a3958c25ca8b5`
  (143,527,082 bytes). It contains the MSIX, test certificate, provenance,
  SBOM, and install evidence; it is not a public installer URL.
- The macOS arm64 DMG's local verification is source-bound to `95daaa89` and
  includes mounted-image inspection, an isolated copy installation, ad-hoc
  signature classification (`TeamIdentifier=not set`), cold launch, clean
  exit, second launch, workspace persistence, bounded C++ compilation, volume
  detach, and removal of the temporary Applications root. Its stable-file
  rollback boundary is manual removal/replacement of the app; no signed update
  or rollback channel exists.
- macOS networking is deliberately **not** passed: the bundled desktop runtime
  has `deny network*`, and no accepted desktop endpoint manifest exists. This
  is a deliberate security boundary, not evidence of YNX Testnet connectivity.
  Integration must approve a bounded endpoint manifest and a network test
  before any networked-desktop or website claim.
- The source-side Developer Wallet connection checkpoint predates this
  installer evidence and must not be used to relabel either artifact as
  publicly approved.

Creating or publishing this handoff does not make either installer public,
installed, signed, or website-ready.
