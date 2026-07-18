# Dependency and license review

The runtime inventory is recorded in `SBOM.cdx.json`. The native client uses pinned lockfile versions. Its direct runtime packages are MIT except Lucide (ISC); the Go service directly reaches only ISC/BSD-3-Clause modules outside this repository. No dependency with a GPL or proprietary runtime obligation is linked into the Exchange artifacts.

The Android preview is signed with the repository's debug keystore and is not a production/store artifact. The iOS Simulator workflow disables code signing. Production signing, notarization, store review, custody approval, and legal-language review remain external gates.

Review commands: `npm ls --all`, direct `package.json` license inspection, `go list -deps`, `go version -m`, repository secret scan, placeholder scan, and `git diff --check`.
