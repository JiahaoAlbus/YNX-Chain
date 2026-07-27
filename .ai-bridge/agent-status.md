# YNX Developer Agent Status

- Status: `active`
- Phase: `FREEZE`
- Product: `11-developer`
- Branch: `codex/final-developer`
- Runtime checkpoint: `8f352d0159eef0ab60fb6411e949cfcf3aafb551`
- Current package-source checkpoint: `9bcb984d475a39cc9fcd7e46fbb00adaee0421ca`
- Remote target: `origin/codex/final-developer`
- Local/upstream equality: verified at `9bcb984d475a39cc9fcd7e46fbb00adaee0421ca` before current evidence-only edits

## Latest verified delivery

The current-source macOS arm64 unsigned Testnet Preview embeds exact source/tree/runtime/SBOM provenance and passed extracted install, strict ad-hoc/no-Team-ID verification, resource self-test, GUI cold start, bundled server observation and child cleanup. API Studio current-source installation is therefore verified on macOS arm64 only.

## Artifact evidence

- Source commit: `9bcb984d475a39cc9fcd7e46fbb00adaee0421ca`
- Source tree: `a0c61afe7ba9e209eab326dcc02fc6568de201d8`
- Runtime checkpoint: `8f352d0159eef0ab60fb6411e949cfcf3aafb551`
- ZIP SHA-256: `55ec683a9ec59db89331bb4ae45c2666ae4e26921b59ac6ec8284efe268281f9`
- ZIP bytes: `38450127`
- Embedded SBOM SHA-256: `801af226eda24a8ad4e880f8d36da197ef8af375b62153435dd4c0c75cc8ac12`
- Signing class: `adhoc-no-team-id`
- Hosted: false
- Production signed: false

## Test state

- Developer client: 22 passed
- Developer Web: 17 passed
- Browser module syntax: passed
- Static claim/workflow check: passed
- Standalone Web build: passed
- Live compile check: passed with chain ID 6423 and bounded-EVM truth preserved
- Same-origin proxy check: passed
- Desktop sandbox denial: 2 passed
- Windows source boundary: passed; no current Windows build claimed
- No-placeholder scan: passed through `grep` fallback
- Credential-leak scan: passed through `grep` fallback
- Repository static check: passed
- macOS package build: passed from clean pushed source
- macOS extracted provenance/self-test/cold-start/cleanup: passed

## Release truth

- implementedLocal: true
- testedLocal: true
- installedLocal overall: true
- current-source API Studio installedLocal on macOS arm64: true
- current-source API Studio installedLocal on Windows x64: false
- integratedCentral: false
- deployedStaging: false
- deployedPublic: false
- downloadHosted: false
- productionSigned: false
- storeReleased: false

## Current blockers

No blocker prevents local engineering. Current-source Windows proof depends on GitHub Actions availability. Central acceptance remains pending for Wallet/Auth, AI Gateway, Data Fabric audit events, Integration freeze, Security/SRE host broker review and provider-owned templates. Public deployment, immutable hosting and production signing require later owner/operator inputs.

## Exact next action

Trigger the Windows workflow for `codex/final-developer`; verify current-source compile, portable extraction, resource self-test, WPF cold launch, bundled server observation, child cleanup, exact hash/bytes/provenance and unsigned-no-Authenticode classification.
