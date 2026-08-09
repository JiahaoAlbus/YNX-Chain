# YNX Developer operations

Build the Web product with `npm run build`. Static hosting must provide bounded,
authenticated same-origin proxy equivalents and a version/health endpoint before
`deployedStaging` can become true. Never place a provider or Wallet secret in the
bundle.

Build the unsigned local macOS package with `scripts/package-local-macos.sh` and
verify the extracted artifact with `scripts/verify-local-macos-package.sh`. The
packager refuses tracked uncommitted Developer changes and embeds source commit,
Git tree, runtime checkpoint, platform/signing class and SBOM SHA-256. Record the
final ZIP SHA-256 and bytes externally because a package cannot embed its own
non-circular final digest.
The verifier must launch the extracted App twice, require a real bounded C++
compile, prove workspace persistence, verify child cleanup and require a
complete CycloneDX inventory containing the bundled Node/npm runtime and native
dependencies. A package that only passes static resource inspection is not
eligible for the official direct-download URL.
Windows packaging and cold launch run on a real Windows host through
`developer-windows.yml`; use its JSON evidence and artifact checksum, never the
macOS structural source check, for Windows claims.

Production release requires owner-controlled Developer ID and Authenticode
identities, notarization/installer policy, signed update metadata, rollback,
hosted immutable artifacts and clean-install/cold-start proof. An ad-hoc or
unsigned Testnet Preview must remain visibly classified and must not self-update.
