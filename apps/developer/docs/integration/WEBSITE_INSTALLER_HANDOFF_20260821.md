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
| macOS arm64 | `.dmg` containing a launchable `.app` | `8168ad7df04ea07d02208280c190eb5051549a74` / tree `7f7e057874d58010f37e7204ee91995b7417c2c8` | Local macOS build produced `ynx-developer-testnet-preview-macos-arm64-unsigned.dmg`, 294,282,136 bytes, SHA-256 `1c0adaa4095128b1f88a59b8570245ec5b0f200d29cd51b2cf5c249927089edb`. It is UDZO, signed ad-hoc with no Team ID, and was mounted, copied from the DMG to an isolated Applications directory, cold-launched, cleanly exited, second-launched, completed bounded C++ compilation and a real clangd document-symbol request, preserved a workspace, and removed its isolated installation/mount at verifier exit. | `HOSTING_AND_NETWORK_PROOF_REQUIRED`; local artifact is not an immutable public download and cannot receive a website CTA. |
| Windows x64 | `.msix` (or a signed `.exe`) | `8168ad7df04ea07d02208280c190eb5051549a74` / tree `7f7e057874d58010f37e7204ee91995b7417c2c8` | CI run `32497840351` produced `ynx-developer-testnet-preview-windows-x64-test-signed.msix`, 71,572,176 bytes, SHA-256 `1c21140947cb9a985208aabd88cbbf7fd996c767b49876ddaf469a84e7dc1ce8`. The runner verified its test-only certificate, installed it, cold-launched and second-launched the installed payload, then removed it. | `BUILD_AND_INSTALL_PROOF_IN_PROGRESS`; test-only CI artifact is not an immutable public download and cannot receive a website CTA. |

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
  Actions artifact from run `32497840351`; the uploaded artifact ZIP SHA-256
  is `5b41b25f026e8136b68ac45143e52f94b43f336f7970cce595ea9c6b244d6ac5`
  (143,527,067 bytes). It contains the MSIX, test certificate, provenance,
  SBOM, and install evidence; it is not a public installer URL.
- The macOS arm64 DMG's local verification is source-bound to `8168ad7d` and
  includes mounted-image inspection, an isolated copy installation, ad-hoc
  signature classification (`TeamIdentifier=not set`), cold launch, clean
  exit, second launch, workspace persistence, bounded C++ compilation, a real
  clangd `documentSymbols` response with two symbols, volume detach, and
  removal of the temporary Applications root. Its stable-file rollback
  boundary is manual removal/replacement of the app; no signed update or
  rollback channel exists.
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
