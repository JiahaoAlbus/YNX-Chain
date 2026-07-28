# YNX Developer Agent Status

- Status: `active`
- Phase: `FREEZE`
- Product: `11-developer`
- Branch: `codex/final-developer`
- Runtime checkpoint: `8f352d0159eef0ab60fb6411e949cfcf3aafb551`
- macOS package source: `9bcb984d475a39cc9fcd7e46fbb00adaee0421ca`
- Windows package source: `5edacf918fa6a4ebaaa96c2270aa9fd579d1af6e`
- Remote target: `origin/codex/final-developer`
- Local/upstream equality: verified at `5edacf918fa6a4ebaaa96c2270aa9fd579d1af6e` before current evidence-only edits

## Latest verified delivery

Current-source API Studio is installed and cold-launched in both desktop preview classes:

- macOS arm64: local unsigned/ad-hoc package with embedded provenance, resource self-test, GUI cold start, bundled server observation and child cleanup.
- Windows x64: GitHub Actions run `30280327020`, job `90024771435`, exact head `5edacf918fa6a4ebaaa96c2270aa9fd579d1af6e`, Windows Server 2025; compile, native self-test, portable extraction, Authenticode `NotSigned` classification, WPF cold launch, bundled server observation, child cleanup and Artifact upload all passed.

## Windows artifact evidence

- Source tree: `f8687d6cce6e187d96daefd2e30757cf49f7c9dc`
- Runtime checkpoint: `8f352d0159eef0ab60fb6411e949cfcf3aafb551`
- ZIP SHA-256: `92d2e85210740c44f2c3f2f08eb3ea1a2a84b30c836106498d4ba48696e62a54`
- ZIP bytes: `106341640`
- Embedded SBOM SHA-256: `15a29bf7e746a9b8cb9cfa10eed21c24c6bb53686cb3f45c00384390c2897e4c`
- Signing class: `unsigned-no-authenticode`
- Authenticode status: `NotSigned`
- GitHub Artifact ID: `8658611304`
- Outer Artifact digest: `sha256:888478649d2f9e2241469e439d918260e4ad8b2c7e7cc40861a0e8925ace7762`
- Outer Artifact bytes: `105947974`
- Expires: `2026-08-10T15:33:26Z`
- Hosted/public download: false; this is a transient CI artifact.

## Release truth

- implementedLocal: true
- testedLocal: true
- installedLocal overall: true
- current-source API Studio installedLocal on macOS arm64: true
- current-source API Studio installedLocal on Windows x64: true
- integratedCentral: false
- deployedStaging: false
- deployedPublic: false
- downloadHosted: false
- productionSigned: false
- storeReleased: false

## Current blockers

No blocker prevents local engineering. Central acceptance remains pending for Wallet/Auth, AI Gateway, Data Fabric audit events, Integration freeze, Security/SRE host credential broker review and provider-owned templates. Immutable public hosting, Developer ID/notarization and Authenticode production signing require later owner/operator inputs.

## Exact next action

Build installed-browser accessibility evidence for the current source: deterministic keyboard/focus navigation, Arabic RTL, screen-reader semantics, 200% zoom/dynamic text, reduced motion, Light/Dark and 390px no-overflow, with truthful automation and screenshot evidence where supported.
