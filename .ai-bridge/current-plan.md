# YNX Developer Current Plan

## Product lock

- Product: `11｜YNX Developer / AI Build`
- Worktree: `/Users/huangjiahao/Desktop/YNX Final Worktrees/11-developer`
- Branch: `codex/final-developer`
- Current phase: `FREEZE`
- Runtime checkpoint: `8f352d0159eef0ab60fb6411e949cfcf3aafb551`
- macOS package source: `9bcb984d475a39cc9fcd7e46fbb00adaee0421ca`
- Windows package source: `5edacf918fa6a4ebaaa96c2270aa9fd579d1af6e`
- Long-term goal: Active

## Completed current-source desktop proof

### macOS arm64

- ZIP SHA-256: `55ec683a9ec59db89331bb4ae45c2666ae4e26921b59ac6ec8284efe268281f9`
- ZIP bytes: `38450127`
- Source tree: `a0c61afe7ba9e209eab326dcc02fc6568de201d8`
- Embedded SBOM SHA-256: `801af226eda24a8ad4e880f8d36da197ef8af375b62153435dd4c0c75cc8ac12`
- Signing class: `adhoc-no-team-id`
- Embedded provenance, extracted resource self-test, GUI cold start, bundled server observation and child cleanup passed.

### Windows x64

- GitHub Actions run: `30280327020`
- Job: `90024771435`
- Exact source commit: `5edacf918fa6a4ebaaa96c2270aa9fd579d1af6e`
- Source tree: `f8687d6cce6e187d96daefd2e30757cf49f7c9dc`
- Runtime checkpoint: `8f352d0159eef0ab60fb6411e949cfcf3aafb551`
- ZIP SHA-256: `92d2e85210740c44f2c3f2f08eb3ea1a2a84b30c836106498d4ba48696e62a54`
- ZIP bytes: `106341640`
- Embedded SBOM SHA-256: `15a29bf7e746a9b8cb9cfa10eed21c24c6bb53686cb3f45c00384390c2897e4c`
- Signing class: `unsigned-no-authenticode`; Authenticode status `NotSigned`.
- Client `22/22`, Web `17/17`, `dotnet publish win-x64`, embedded provenance, native self-test, portable extraction, WPF cold launch, bundled server observation, child cleanup and Artifact upload passed.
- GitHub Artifact ID `8658611304`; outer digest `sha256:888478649d2f9e2241469e439d918260e4ad8b2c7e7cc40861a0e8925ace7762`; outer bytes `105947974`; expires `2026-08-10T15:33:26Z`.
- The CI artifact is transient and is not an immutable public product download.

## Release truth

- `implementedLocal=true`
- `testedLocal=true`
- `installedLocal=true` for current-source macOS arm64 and Windows x64 Testnet Preview packages
- `integratedCentral=false`
- `deployedStaging=false`
- `deployedPublic=false`
- `downloadHosted=false`
- `productionSigned=false`
- `storeReleased=false`

## Next autonomous engineering slice

Create current-source installed-browser accessibility evidence for API Studio and the IDE shell: keyboard-only operation, tab order and focus visibility, Arabic RTL, screen-reader semantics, 200% zoom/dynamic text, reduced motion, Light/Dark and 390px no-overflow. Prefer deterministic Playwright automation and screenshots if the existing toolchain supports it; otherwise add a bounded browser audit harness without introducing a production dependency or fake visual claim.

## Subsequent priorities

1. Accepted host credential broker plus one official provider sandbox vector.
2. Data Fabric redacted audit events and Monitor integration.
3. Canonical Wallet product/deployment acceptance.
4. Real Wallet-signed YNX Testnet deployment and Explorer proof.
5. SLO/capacity and unit-economics measurement.
6. Public staging, immutable artifacts, SEO/public evidence and release gates.
