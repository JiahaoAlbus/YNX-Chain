# Dependency, license and SBOM review

Review date: 2026-07-18.

- `npm audit --omit=dev --audit-level=high` passes for Wallet: no high or critical finding. npm reports ten moderate transitive findings in Expo build tooling through `xcode`/`uuid`; the proposed automatic fix downgrades Expo across a breaking boundary, so it is not applied. These packages do not handle Wallet keys at runtime, but the finding must be rechecked on every Expo upgrade.
- `packages/wallet-auth` has three installed packages and `npm audit --omit=dev` reports zero vulnerabilities.
- Direct runtime inventory is fixed by `package-lock.json`: Noble curves/hashes, Expo SDK 57 modules, React Native 0.86, React 19, SVG/QR and the local canonical auth package.
- `npm query '*' --omit=dev` license inventory found MIT, ISC, BSD-2/3, Apache-2.0, MPL-2.0, CC0/CC-BY, Python-2.0, BlueOak, 0BSD and declared dual-license packages. The only entries without upstream license metadata were the two YNX packages; they are now explicitly `UNLICENSED`, so no outbound license grant is implied.
- npm's built-in CycloneDX generator currently fails closed with `ESBOMPROBLEMS` because Expo's installed dependency tree marks several compatible pinned overrides as `invalid`. No incomplete SBOM is committed. `package-lock.json` remains the complete machine-readable dependency graph; producing a release CycloneDX file is a release-engineering gate after the Expo dependency tree is normalized.
