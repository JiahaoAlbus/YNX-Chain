# Developer macOS ARM64 DMG candidate handoff

## Exact candidate

- Product: YNX Developer Testnet Preview `0.2.0`
- Source commit: `ccab67b2ceaeeaeb962dd6e67696bb3f73835120`
- Source tree: `38524871d45f8239377ed832fe04b51bceee476f`
- Artifact: `ynx-developer-testnet-preview-macos-arm64-unsigned.dmg`
- Bytes: `300467545`
- SHA-256: `71eb57a55521ea42949ed24d8f5b078a3b9cfa1032cabcd2ca2717c64e6fe775`
- Minimum macOS: `13.0`; architecture: `arm64`
- Signature: `adhoc-no-team-id`; Developer ID signing and notarization are false.
- Embedded SBOM: CycloneDX, 269 components, SHA-256 `601e41366738c6e29882df45fc6061fa29938bbe59cca1fb4dd9a5fee629a679`.

## Direct local evidence

The candidate DMG was mounted read-only, copied into an isolated Applications root, and verified with its embedded provenance and ad-hoc signature. It passed native self-test, cold launch, bundled JavaScript/C++ toolchain detection, a real bounded C++ compile, C++ document-symbol request, workspace persistence across a second launch, and child-process cleanup.

The local machine had no installed YNX Wallet and no registered `ynxwallet` handler. Wallet approval, signing, sending, and Product Session lifecycle are therefore false. This evidence is an installed-app proof only; it is not a Wallet proof.

## Publication boundary

The candidate is deliberately unhosted. No public URL, external HTTPS byte readback, production signature, notarization, store release, or source-bound public runtime is claimed. Its `runtimeCheckpoint` is historical and is not a current public-source assertion.

Website/Integration may publish it only after all of the following are independently recorded:

1. Upload this exact byte stream to immutable official storage and read back its bytes and SHA-256 over external HTTPS.
2. Bind the download record to this exact source commit/tree and preserve a rollback target.
3. Replace any public macOS installer wording that points to a ZIP; do not call a ZIP an installer.
4. Preserve `adhoc-no-team-id`, `notarized=false`, and `productionSigned=false` until real signing/notarization evidence exists.

The machine-readable record is `apps/developer/evidence/desktop/macos-current-ccab67b2.json`.
