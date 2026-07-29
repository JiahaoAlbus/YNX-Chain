# Security Platform Integration Handoff

## Authority

Owner: `30-security-sre-release`

Source commit: `aa5d5e92d28a872c8d449eadbb7acbadc3094e97`

Contract: `release/integration/security-platform-contract.json`

This platform owns the security framework, enforcement tools, release evidence, artifact verification policy, backup/restore controls, CI/CD gates, monitoring integration contract, and incident-response contract. It does not own user assets, business execution, treasury, governance, mint/burn, bridge transfer, payment execution, or any product owner's signing authority.

## Current acceptance state

- Local implementation: accepted by Product 30 tests.
- Local tests: accepted; security suite and repository suite pass.
- Remote validation: accepted for exact source `aa5d5e92d28a872c8d449eadbb7acbadc3094e97`; CI, Security, and Security Platform Gates completed successfully.
- Branch controls: strict required checks, code-owner review, last-push approval, linear history, conversation resolution, and force-push/deletion rejection are enabled; administrator enforcement and signed commits remain final-lock actions.
- Local encrypted restore drill: passed for the committed `security-platform/` metadata set.
- Local reproducible artifact drill: passed for source commit `aa5d5e92d28a872c8d449eadbb7acbadc3094e97`, including SBOM, provenance, test signature, tamper rejection, wrong-identity rejection, and unsigned-public rejection.
- Clean installation: a Git archive of the same source passed locked dependency installation, production dependency audit, workspace build, policy verification, and CLI cold start.
- Artifact distribution: not hosted; the active artifact remains local/test-signed and is not public-release eligible.
- Central integration: not accepted.
- Staging deployment: not evidenced.
- Public deployment: not evidenced.
- Production signing: not evidenced.
- External input boundary: `release/security-platform/operator-inputs.request.json` records the minimum metadata and approvals still required without requesting value material.

## Product-owner inputs

Each product owner must provide a handoff containing:

- product and service identity;
- environment and trust-domain binding;
- allowed audiences and scopes;
- certificate subject/SAN requirements;
- sensitive-material classes and named owners;
- artifact classes and release targets;
- health/version dependency truth;
- backup data sets, consistency rules, and recovery boundary;
- incident types, pause authority, communication owner, and recovery owner;
- test vectors and expected fail-closed errors.

Do not send value material, signing material, recovery material, or full authentication tokens in the handoff.

## Central owners

- `01-chain-core`: validator/deploy/chain-state backup and rollback boundary.
- `02-wallet-auth`: product session, device, mandate, revoke, mobile signing boundary.
- `13-monitor`: SLO, alerts, synthetic checks, status and incident routing.
- `15-trust`: disclosure, appeal, correction and evidence handling.
- `18-docs-compliance`: public security claims and disclosure review.
- `19-oracle`: reporter identity, provider access metadata and incident contract.
- `21-bridge`: signer/MPC/HSM, pause and recovery boundary.
- `26-data-fabric`: audit, canonical event, ledger and integrity verification.
- `28-website`: hosted artifact, public status and SEO/crawler SRE targets.
- `29-integration`: unique release contract, merge order and shared Testnet proof.
- `31-governance`: security policy, timelock and emergency-control authority.

## Fail-closed defaults

Until accepted by the relevant owner:

- no cross-product allow policy is emitted;
- backup schedules remain suspended;
- deployment workflows remain validation-only;
- service identity is required but not asserted as installed;
- monitoring and sensitive-material manager manifests remain detached candidates;
- all public and production release states remain false.

## Verification

```bash
npm run security:verify
npm run security:test
npm run security:integration
npm test
npm run lint
```

Shared vectors: `docs/integration/SECURITY_PLATFORM_CROSS_PRODUCT_TEST_VECTORS.json`.
