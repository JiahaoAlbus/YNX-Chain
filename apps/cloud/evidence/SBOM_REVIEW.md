# Dependency, license, and SBOM review

The authoritative machine-readable dependency inventories are `go.mod`/`go.sum` and the two independently locked mobile `pnpm-lock.yaml` files. No dependency was added without an exact version.

Cloud/Docs service code uses the repository Go module and standard library for HTTP, hashing, JSON, filesystem recovery, and crypto verification. Mobile direct runtime dependencies are Expo 57, React 19, React Native 0.86, safe-area-context, Noble Curves 2.2, Expo Crypto, SecureStore, Localization, FileSystem, Sharing, and Cloud-only DocumentPicker. TypeScript/tsx are development-only.

Review findings:

- Native lockfiles are committed and `pnpm install --frozen-lockfile` is used by iOS CI.
- APK release builds completed Android lint and dependency collection.
- No vendored Apple font, private SDK, PEM, mnemonic, provider key, internal API key, or database secret is included.
- Runtime service credentials come only from operator environment variables and are never sent to Web/native clients.
- Third-party license obligations must be regenerated from the exact lockfiles for any public binary release; these local debug-signed APKs are upload-ready Testnet Preview artifacts, not a public release.

Commands used for review: `go list -m all`, package manifest inspection, Android `assembleRelease`/lint, source secret scan, and exact APK certificate/hash inspection.
