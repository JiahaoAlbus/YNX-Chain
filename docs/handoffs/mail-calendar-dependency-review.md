# Mail + Calendar dependency, license and SBOM review — 2026-07-19

Scope: implementation and release artifacts at
`e227c4f0505537b19f4588ea26478c54518f0a4c`.

## Runtime dependency result

| Product | Runtime dependency surface | License evidence | Result |
| --- | --- | --- | --- |
| YNX Mail Go service/desktop package | Go standard library plus `golang.org/x/crypto v0.33.0` | upstream three-clause BSD license is embedded at `licenses/golang.org-x-crypto.LICENSE`; `SBOM-go-build.txt` is generated from the packaged binary | reviewed |
| YNX Calendar Go service/desktop package | Go standard library only | `SBOM-go-build.txt` is generated from the packaged binary | reviewed |
| Android apps | AndroidX AppCompat/Core and Material dependencies resolved by Gradle | debug APK metadata and Gradle dependency graph were built successfully; release remains debug/test signed | reviewed for Testnet Preview, not a production-signing review |
| iOS apps | Apple SwiftUI, CryptoKit, Security and UIKit SDK frameworks | Xcode CI compiled and linked the exact source commit; artifact is unsigned Simulator-only | reviewed for Simulator Preview, not App Store review |

The repository has no top-level product license file. The Testnet Preview is
therefore owner-published from the repository's GitHub account and does not
grant an inferred open-source license beyond the explicit third-party notices.

## Development-only dependency result

Both product packages use `playwright 1.61.1` under Apache-2.0 for browser
proof. It is a development dependency and is not embedded in the Go desktop,
Android or iOS artifacts. `npm audit --omit=dev --json` reported zero runtime
vulnerabilities for both products on this pass.

## Reproduction

```bash
go list -deps ./apps/mail
go list -deps ./apps/calendar
npm audit --prefix apps/mail --omit=dev
npm audit --prefix apps/calendar --omit=dev
npm run proof:desktop --prefix apps/mail
npm run proof:desktop --prefix apps/calendar
```

The hosted release includes `SHA256SUMS.txt`, platform evidence, immutable
GitHub asset URLs, exact sizes and signing classifications. This review does not
upgrade central integration, staging deployment or production-signing status.
