# YNX Music third-party review

The Music daemon's machine-readable Go runtime dependency inventory is `SBOM.spdx.json`. The SBOM records package identities and versions, not a legal conclusion; `NOASSERTION` is used where license resolution has not been independently reviewed.

The Android application has no bundled third-party runtime library. Its only declared dependencies are JUnit 4.13.2 for local and instrumentation tests; JUnit and Hamcrest are test-only and are not packaged in the release APK. The Web surface has no npm/runtime dependency. Apple system frameworks and Android platform APIs are supplied by their respective operating systems.

This engineering inventory is not legal advice and does not establish commercial music rights. Any public catalog requires rights-owner evidence, territorial review, CDN agreements and independent counsel before production use.
