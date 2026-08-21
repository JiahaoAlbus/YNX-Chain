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
| macOS Intel | `.dmg` containing a launchable `.app` | `6f2f199f0d81b1a45995f726efcf0752b1493712` / tree `601b392301e480df554d6073f45d1a52c3c9dd74` | No source-bound Intel DMG exists yet. GitHub Actions run `32472126350` is pending with zero assigned jobs, so it has no runner output, bytes, checksum, signature, launch, or uninstall evidence. | `BUILD_AND_INSTALL_PROOF_IN_PROGRESS`; do not expose a download CTA. |
| Windows x64 | `.msix` (or a signed `.exe`) | `6f2f199f0d81b1a45995f726efcf0752b1493712` / tree `601b392301e480df554d6073f45d1a52c3c9dd74` | CI run `32472126371` produced `ynx-developer-testnet-preview-windows-x64-test-signed.msix`, 71,572,171 bytes, SHA-256 `f65315bdbda20ea1b2f44eddc287ffc350675070d9a8098b758f2df62b9df421`. The runner verified the test-only certificate, installed the MSIX, launched its installed payload cold and a second time, then removed it. | `BUILD_AND_INSTALL_PROOF_IN_PROGRESS`; test-only CI artifact is not an immutable public download and cannot receive a website CTA. |

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
  Actions artifact from run `32472126371`; its outer artifact SHA-256 is
  `ee9743ecc4e5080e01dc781bacf203a38768f26be1c6385d967f3e3369249033`.
- The single current macOS blocker is external GitHub macOS Intel runner
  allocation for run `32472126350`. No source or product failure has been
  observed because the workflow has not received a job.
- The source-side Developer Wallet connection checkpoint is independently
  pushed at `366e523252c08871e51d93add534b4513746f1b6`; it is not an installer
  artifact and must not be used to relabel the `6f2f199f` installer evidence.

Creating or publishing this handoff does not make either installer public,
installed, signed, or website-ready.
