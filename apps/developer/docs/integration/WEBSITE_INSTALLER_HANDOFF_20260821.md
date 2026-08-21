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
| macOS Intel | `.dmg` containing a launchable `.app` | `366e523252c08871e51d93add534b4513746f1b6` / tree `3d9f6d2065c0a07ec4d506209c2199a5354c5cc2` | No source-bound Intel DMG exists yet. GitHub Actions run `32477893397` is pending with zero assigned jobs, so it has no runner output, bytes, checksum, signature, launch, or uninstall evidence. | `BUILD_AND_INSTALL_PROOF_IN_PROGRESS`; do not expose a download CTA. |
| Windows x64 | `.msix` (or a signed `.exe`) | `366e523252c08871e51d93add534b4513746f1b6` / tree `3d9f6d2065c0a07ec4d506209c2199a5354c5cc2` | CI run `32477893280` produced `ynx-developer-testnet-preview-windows-x64-test-signed.msix`, 71,572,213 bytes, SHA-256 `c844cb3aa216f164a7fb2ff6712bbded1e76cc03c073c5a641e95b8e057c5980`. The runner verified its test-only certificate, installed it, cold-launched and second-launched the installed payload, then removed it. | `BUILD_AND_INSTALL_PROOF_IN_PROGRESS`; test-only CI artifact is not an immutable public download and cannot receive a website CTA. |

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
  Actions artifact from run `32477893280`; the uploaded artifact ZIP SHA-256
  is `722f9a8af5e3bf6d0dc28b6887fb0d2dc116da500fbb3d048c145dbd9db4c691`
  (143,527,086 bytes). It contains the MSIX, test certificate, provenance,
  SBOM, and install evidence; it is not a public installer URL.
- The single current macOS blocker is external GitHub macOS Intel runner
  allocation for run `32477893397`. No source or product failure has been
  observed because the workflow has not received a job.
- The source-side Developer Wallet connection checkpoint is incorporated in
  `366e523252c08871e51d93add534b4513746f1b6`; it is not an installer artifact
  and must not be used to relabel the MSIX evidence as publicly approved.

Creating or publishing this handoff does not make either installer public,
installed, signed, or website-ready.
