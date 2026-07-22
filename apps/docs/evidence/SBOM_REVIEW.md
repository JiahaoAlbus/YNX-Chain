# Dependency, license, and SBOM review

Docs uses the shared audited Go service inventory recorded in `apps/cloud/evidence/SBOM_REVIEW.md` and an independent `apps/docs/mobile/pnpm-lock.yaml`. Direct runtime dependencies are Expo 57, React 19, React Native 0.86, safe-area-context, Noble Curves 2.2, Expo Crypto, SecureStore, Localization, FileSystem, and Sharing.

The lockfile is committed; CI installs it frozen. Android release lint/dependency collection passed. Source scanning found no PEM, mnemonic, private key, provider credential, or database secret. Exact third-party notices must be generated from this lockfile before a public/store release; the current APK is a local debug-certificate Testnet Preview.
