# Dependency, license, and SBOM review

The authoritative dependency inputs are `go.mod`/`go.sum` and the two independently locked mobile `pnpm-lock.yaml` files. `SBOM.cdx.json` converts them into a deterministic CycloneDX 1.5 inventory; the security gate verifies every current Go module and every locked pnpm package is represented.

Cloud/Docs service code uses the repository Go module and standard library for HTTP, hashing, JSON, filesystem recovery, and crypto verification. Mobile direct runtime dependencies are Expo 57, React 19, React Native 0.86, safe-area-context, Noble Curves 2.2, Expo Crypto, SecureStore, Localization, FileSystem, Sharing, and Cloud-only DocumentPicker. TypeScript/tsx are development-only.

Review findings:

- Native lockfiles are committed and `pnpm install --frozen-lockfile` is used by iOS CI.
- APK release builds completed Android lint and dependency collection.
- No vendored Apple font, private SDK, PEM, mnemonic, provider key, internal API key, or database secret is included.
- Runtime service credentials come only from operator environment variables and are never sent to Web/native clients.
- Package scripts must exactly match `security/build-script-allowlist.json`; dependency lifecycle scripts are not authorized as product build entrypoints.
- The security gate runs Go vet, production-surface forbidden-content/secret checks, lock/SBOM/material verification, APK archive inspection, and exact artifact hash/size verification.
- Third-party license obligations must be regenerated from the exact lockfiles for any public binary release; these local debug-signed APKs are upload-ready Testnet Preview artifacts, not a public release.

Current commands: `node apps/cloud/scripts/generate-security-artifacts.mjs <source-commit>` for reviewed regeneration and `npm --prefix apps/cloud run security` for verification. Historical Android `assembleRelease`/lint and adb install evidence remain local; a fresh reproducible build and production attestation are not claimed.
